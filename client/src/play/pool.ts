// Online pool: the match page's renderer for the 'pool' game type, same signature as
// renderChess. The server is authoritative: this sends the player's move, then shows
// whatever state comes back. A shot that arrives (yours or the opponent's) is played
// back from state.lastShot by the board.
import { h } from './dom';
import { mountPool, type PoolPanel } from './poolUi';
import type { MatchState } from './api';
import type { PoolMove } from '../games/pool/PoolView';

export interface PoolCtx {
  match: MatchState;
  send: (move: Record<string, unknown>) => Promise<string | null>;
}

interface Live { panel: PoolPanel; busy: boolean; ctx: PoolCtx }
const live = new WeakMap<HTMLElement, Live>();

export function renderPool(root: HTMLElement, ctx: PoolCtx): void {
  const m = ctx.match;
  let l = live.get(root);
  if (!l || !l.panel.el.isConnected) {
    const holder = h('div', 'w-full');
    // Fits a 360px-wide phone: the table is turned upright and takes the height that is left.
    holder.style.cssText = 'height:calc(100vh - 170px);height:calc(100dvh - 170px);min-height:440px;max-height:900px;';
    const note = h('div', 'px-4 py-2 text-xs text-gray-500');
    note.id = 'poolMatchNote';
    root.replaceChildren(holder, note);
    const st: Live = {
      busy: false,
      ctx,
      panel: mountPool(holder, {
        names: ['Player 1', 'Player 2'],
        localSeat: -1,
        onMove: (move: PoolMove) => {
          if (st.busy) return;
          st.busy = true;
          void st.ctx.send(move as unknown as Record<string, unknown>).then((err) => {
            st.busy = false;
            if (err) st.panel.setNotice(err);
          });
        },
      }),
    };
    live.set(root, st);
    l = st;
  }
  l.ctx = ctx;
  const seat = m.you.seat;
  const active = m.status === 'active';
  const name = (s: 0 | 1): string => (m.seats[s].name || 'Waiting for opponent') + (m.seats[s].kind === 'guest' ? ' (guest)' : '');
  l.panel.opts.names = [name(0), name(1)];
  l.panel.opts.localSeat = active && seat !== null ? seat : -1;
  l.panel.opts.statusOverride = () => {
    if (m.status === 'challenge') return 'Challenge not accepted yet.';
    if (m.status === 'open') return 'Waiting for someone to open the invite link.';
    if (!active && m.status !== 'finished') return `This match was ${m.status}.`;
    if (seat === null && m.status === 'active' && m.view.turn !== null) return `${name(m.view.turn)} to shoot. You are watching.`;
    return null;
  };
  const kind = m.view.variant === '9ball' ? '9-ball' : '8-ball';
  const note = root.querySelector('#poolMatchNote');
  if (note) note.textContent = `${kind}. Drag back from anywhere on the table to aim, release to shoot. Tap the table to skip a replay.`;
  l.panel.setView(m.view, true);
}
