// Host side of the computer opponents. The search runs in a Web Worker so the page
// never freezes, and every answer is held back to a minimum "thinking" time so a
// reply never looks instant. Nothing here touches the network.
import type { ChessBotMove } from '../../../shared/bots/chess.js';
import type { PoolBotResult } from '../../../shared/bots/pool.js';
import type { PoolState } from '../../../shared/pool/index.js';

export type Level = 'easy' | 'medium' | 'hard';
export const LEVEL_NAMES: Record<Level, string> = { easy: 'Easy', medium: 'Medium', hard: 'Hard' };

/** Shortest time a computer move takes to appear, per game. */
export const MIN_THINK_MS = { chess: 700, pool: 900 };

const sleep = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms));

export class BotHost {
  private worker: Worker | null = null;
  private pending = new Map<number, { ok: (v: any) => void; fail: (e: Error) => void }>();
  private seq = 0;
  private dead = false;

  private ensure(): Worker | null {
    if (this.worker || this.dead) return this.worker;
    try {
      const w = new Worker(new URL('./botWorker.ts', import.meta.url), { type: 'module' });
      w.onmessage = (e: MessageEvent) => {
        const p = this.pending.get(e.data.id);
        if (!p) return;
        this.pending.delete(e.data.id);
        if (e.data.ok) p.ok(e.data.result); else p.fail(new Error(e.data.error || 'bot failed'));
      };
      w.onerror = () => {
        for (const p of this.pending.values()) p.fail(new Error('bot worker crashed'));
        this.pending.clear();
        this.worker = null;
      };
      this.worker = w;
    } catch { this.dead = true; }
    return this.worker;
  }

  private ask(msg: Record<string, unknown>): Promise<any> {
    const w = this.ensure();
    if (!w) return this.askOnMainThread(msg);
    return new Promise((ok, fail) => {
      const id = ++this.seq;
      this.pending.set(id, { ok, fail });
      w.postMessage({ id, ...msg });
    });
  }

  /** Only when a Worker cannot be created at all (very old browsers): still correct, but it blocks briefly. */
  private async askOnMainThread(msg: Record<string, unknown>): Promise<any> {
    await sleep(30); // let the "thinking" indicator paint first
    if (msg.kind === 'chess') {
      const m = await import('../../../shared/bots/chess.js');
      return m.chooseMove(msg.fen as string, { level: msg.level as Level });
    }
    const m = await import('../../../shared/bots/pool.js');
    return m.chooseShot(msg.state as PoolState, { level: msg.level as Level });
  }

  async chess(fen: string, level: Level): Promise<ChessBotMove | null> {
    const [res] = await Promise.all([this.ask({ kind: 'chess', fen, level }), sleep(MIN_THINK_MS.chess)]);
    return res;
  }

  async pool(state: PoolState, level: Level): Promise<PoolBotResult> {
    const [res] = await Promise.all([this.ask({ kind: 'pool', state, level }), sleep(MIN_THINK_MS.pool)]);
    return res;
  }

  destroy(): void {
    this.dead = true;
    this.worker?.terminate();
    this.worker = null;
    for (const p of this.pending.values()) p.fail(new Error('stopped'));
    this.pending.clear();
  }
}
