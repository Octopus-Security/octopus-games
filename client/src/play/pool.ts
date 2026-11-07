// Online pool: the match page's renderer for the 'pool' game type, same signature as
// renderChess. The server is authoritative: this sends the player's move, then shows
// whatever state comes back. A shot that arrives (yours or the opponent's) is played
// back from state.lastShot by the board.
import { mountPool, type PoolPanel } from './poolUi';
import type { GameScreen } from './gameScreen';
import type { MatchState } from './api';
import type { PoolMove } from '../games/pool/PoolView';

export interface PoolCtx {
  match: MatchState;
  send: (move: Record<string, unknown>) => Promise<string | null>;
}

interface Live { panel: PoolPanel; busy: boolean; ctx: PoolCtx }
const live = new WeakMap<GameScreen, Live>();

export function renderPool(screen: GameScreen, ctx: PoolCtx): void {
  const m = ctx.match;
  let l = live.get(screen);
  if (!l || !l.panel.el.isConnected) {
    const st: Live = {
      busy: false,
      ctx,
      panel: mountPool(screen, {
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
    live.set(screen, st);
    l = st;
  }
  l.ctx = ctx;
  const seat = m.you.seat;
  const active = m.status === 'active';
  const name = (s: 0 | 1): string => (m.seats[s].name || 'Opponent') + (m.seats[s].kind === 'guest' ? ' (guest)' : '');
  l.panel.opts.names = [name(0), name(1)];
  // A finished game still knows which seat you were, so the banner can say "You won".
  l.panel.opts.localSeat = (active || m.status === 'finished') && seat !== null ? seat : -1;
  l.panel.opts.statusOverride = () => {
    if (m.status === 'challenge') return 'Waiting for the challenge to be accepted';
    if (m.status === 'open') return 'Waiting for someone to open the invite link';
    if (!active && m.status !== 'finished') return `This match was ${m.status}`;
    return null;
  };
  const kind = m.view.variant === '9ball' ? '9-ball' : '8-ball';
  l.panel.opts.hint = `${kind}. Drag back from anywhere on the table to aim, release to shoot. Tap the table to skip a replay.`;
  l.panel.setView(m.view, true);
}
