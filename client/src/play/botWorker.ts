// Web Worker that runs the computer opponents (shared/bots) off the UI thread.
// Classic search only: it receives a position, answers with a move, and has no
// network access of any kind.
import { chooseMove } from '../../../shared/bots/chess.js';
import { chooseShot } from '../../../shared/bots/pool.js';

interface Req { id: number; kind: 'chess' | 'pool'; level: 'easy' | 'medium' | 'hard'; fen?: string; state?: any }
const ctx = self as unknown as {
  onmessage: ((e: { data: Req }) => void) | null;
  postMessage: (m: unknown) => void;
};

ctx.onmessage = (e) => {
  const { id, kind, level } = e.data;
  try {
    const result = kind === 'chess' ? chooseMove(e.data.fen!, { level }) : chooseShot(e.data.state, { level });
    ctx.postMessage({ id, ok: true, result });
  } catch (err) {
    ctx.postMessage({ id, ok: false, error: (err as Error).message });
  }
};
