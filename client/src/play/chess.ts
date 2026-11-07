import { h, button, BTN_DANGER, BTN_QUIET, BTN_PRIMARY } from './dom';
import type { MatchState } from './api';

interface LegalMove { from: string; to: string; promotion?: string }
interface ChessView {
  board: string[];                  // 64 entries, a8 first; '' empty, upper = white
  turn: 0 | 1 | null;
  history: { seat: 0 | 1; san: string; from: string; to: string }[];
  lastMove: { from: string; to: string } | null;
  check: string | null;
  legalMoves: LegalMove[];
  drawOffer: 0 | 1 | null;
  result: { winner: 0 | 1 | null; reason: string } | null;
}

const SVG = 'http://www.w3.org/2000/svg';

// Original, simple vector pieces on a 45x45 grid. Colours are set per side.
const SHAPES: Record<string, string> = {
  p: '<circle cx="22.5" cy="13" r="5.5"/><path d="M16 34C16 26 19 22 22.5 20C26 22 29 26 29 34Z"/>',
  r: '<path d="M12 9h4v4h4V9h5v4h4V9h4v9H12Z"/><path d="M15 18h15l2 16H13Z"/>',
  n: '<path d="M13 35C13 26 15 20 20 16L17 12L22 9C28 9 33 15 32 24C31 28 31 31 32 35Z"/><circle cx="23" cy="16" r="1.4" fill="__S__" stroke="none"/>',
  b: '<circle cx="22.5" cy="8" r="2.6"/><ellipse cx="22.5" cy="19" rx="6.5" ry="9"/><path d="M16 34C17 29 19 28 22.5 28C26 28 28 29 29 34Z"/><path d="M19.5 19h6M22.5 16v6" fill="none"/>',
  q: '<path d="M11 14L16 28L19.5 14L22.5 28L25.5 14L29 28L34 14L31 35H14Z"/><circle cx="11" cy="13" r="2.2"/><circle cx="19.5" cy="11" r="2.2"/><circle cx="25.5" cy="11" r="2.2"/><circle cx="34" cy="13" r="2.2"/>',
  k: '<path d="M22.5 4v10M18 8.5h9" fill="none"/><path d="M13 35C12 27 15 21 22.5 19C30 21 33 27 32 35Z"/><rect x="15" y="17" width="15" height="4" rx="2"/>',
};

function pieceSvg(p: string): SVGElement {
  const white = p === p.toUpperCase();
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 45 45');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', 'w-full h-full pointer-events-none');
  const fill = white ? '#f8fafc' : '#1e293b';
  const stroke = white ? '#0f172a' : '#f1f5f9';
  svg.innerHTML =
    `<g fill="${fill}" stroke="${stroke}" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round">` +
    `${SHAPES[p.toLowerCase()].replace(/__S__/g, stroke)}<rect x="9" y="35" width="27" height="4.5" rx="2"/></g>`;
  return svg;
}

const PIECE_NAME: Record<string, string> = { p: 'pawn', r: 'rook', n: 'knight', b: 'bishop', q: 'queen', k: 'king' };
const sqOf = (i: number): string => 'abcdefgh'[i & 7] + (8 - (i >> 3));

function reasonText(reason: string | null): string {
  return ({
    checkmate: 'checkmate', stalemate: 'stalemate', resignation: 'resignation', agreement: 'agreement',
    insufficient_material: 'insufficient material', fifty_move: 'the fifty-move rule', threefold_repetition: 'threefold repetition',
  } as Record<string, string>)[reason || ''] || reason || '';
}

export interface ChessCtx {
  match: MatchState;
  send: (move: Record<string, unknown>) => Promise<string | null>;   // resolves to an error message, if any
}

/** Local UI state that survives re-renders from live updates. */
interface UiState { selected: string | null; promo: { from: string; to: string } | null; confirmResign: boolean }
const ui = new WeakMap<HTMLElement, UiState>();

export function renderChess(root: HTMLElement, ctx: ChessCtx): void {
  const m = ctx.match;
  const v = m.view as ChessView;
  const st = ui.get(root) ?? { selected: null, promo: null, confirmResign: false };
  ui.set(root, st);
  const seat = m.you.seat;
  const playing = m.status === 'active';
  const myTurn = playing && seat !== null && v.turn === seat;
  const flipped = seat === 1;
  if (!myTurn) { st.selected = null; st.promo = null; }

  const targets = new Map<string, LegalMove[]>();
  if (st.selected) for (const lm of v.legalMoves) if (lm.from === st.selected) targets.set(lm.to, [...(targets.get(lm.to) || []), lm]);
  const movable = new Set(v.legalMoves.map(l => l.from));

  const wrap = h('div', 'w-full max-w-[560px] mx-auto');
  const nameOf = (s: 0 | 1): string => {
    const x = m.seats[s];
    return (x.name || 'Waiting for opponent…') + (x.kind === 'guest' ? ' (guest)' : '');
  };
  const bar = (s: 0 | 1): HTMLElement => h('div', 'flex items-center justify-between px-4 py-2 text-sm',
    h('span', 'font-medium text-gray-200 truncate', `${s === 0 ? '⚪' : '⚫'} ${nameOf(s)}`),
    h('span', 'text-xs text-blue-300 shrink-0', playing && v.turn === s ? 'to move' : ''));
  wrap.append(bar(flipped ? 0 : 1));

  // ── board ──
  const board = h('div', 'relative grid grid-cols-8 w-full select-none touch-manipulation');
  board.setAttribute('role', 'grid');
  board.setAttribute('aria-label', 'Chess board');
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const idx = flipped ? 63 - (row * 8 + col) : row * 8 + col;
      const sq = sqOf(idx);
      const p = v.board[idx];
      const dark = ((idx >> 3) + (idx & 7)) % 2 === 1;
      const isLast = !!v.lastMove && (v.lastMove.from === sq || v.lastMove.to === sq);
      const isSel = st.selected === sq;
      const isCheck = v.check === sq;
      const bg = isCheck ? 'bg-red-500' : isSel ? 'bg-yellow-300' : isLast ? (dark ? 'bg-yellow-600/70' : 'bg-yellow-200') : dark ? 'bg-slate-600' : 'bg-slate-300';
      const cell = h('button', `relative aspect-square min-h-[44px] p-0 border-0 ${bg} focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:z-10`) as HTMLButtonElement;
      cell.type = 'button';
      cell.dataset.sq = sq;
      cell.setAttribute('aria-label', p ? `${sq} ${p === p.toUpperCase() ? 'white' : 'black'} ${PIECE_NAME[p.toLowerCase()]}` : sq);
      if (p) cell.append(pieceSvg(p));
      const hit = targets.get(sq);
      if (hit) {
        const dot = h('span', p
          ? 'absolute inset-1 rounded-full border-4 border-blue-500/70 pointer-events-none'
          : 'absolute left-1/2 top-1/2 w-[30%] h-[30%] -translate-x-1/2 -translate-y-1/2 rounded-full bg-blue-600/70 pointer-events-none');
        dot.dataset.legal = '1';
        cell.append(dot);
      }
      if (col === 0) cell.append(h('span', `absolute left-0.5 top-0 text-[10px] leading-none pointer-events-none ${dark ? 'text-slate-300' : 'text-slate-600'}`, String(sq[1])));
      if (row === 7) cell.append(h('span', `absolute right-0.5 bottom-0 text-[10px] leading-none pointer-events-none ${dark ? 'text-slate-300' : 'text-slate-600'}`, sq[0]));
      cell.addEventListener('click', () => onSquare(sq));
      board.append(cell);
    }
  }
  wrap.append(board);
  wrap.append(bar(flipped ? 1 : 0));

  async function submit(move: Record<string, unknown>): Promise<void> {
    st.selected = null; st.promo = null; st.confirmResign = false;
    const err = await ctx.send(move);
    if (err) flash(err);
  }
  function onSquare(sq: string): void {
    if (!myTurn) return;
    st.confirmResign = false;
    if (st.selected && targets.has(sq)) {
      const opts = targets.get(sq)!;
      if (opts.some(o => o.promotion)) { st.promo = { from: st.selected, to: sq }; renderChess(root, ctx); return; }
      void submit({ from: st.selected, to: sq });
      return;
    }
    st.selected = st.selected === sq || !movable.has(sq) ? null : sq;
    renderChess(root, ctx);
  }

  // ── promotion picker ──
  if (st.promo) {
    const pr = st.promo;
    const white = seat === 0;
    const picker = h('div', 'absolute inset-0 z-20 bg-black/60 flex items-center justify-center');
    const card = h('div', 'bg-gray-900 border border-gray-700 rounded-xl p-3 flex flex-col items-center gap-2');
    card.append(h('div', 'text-sm text-gray-300', 'Promote to'));
    const row = h('div', 'flex gap-2');
    for (const t of ['q', 'r', 'b', 'n']) {
      const b = h('button', 'w-14 h-14 rounded-lg bg-slate-300 hover:bg-slate-200 p-1') as HTMLButtonElement;
      b.type = 'button';
      b.setAttribute('aria-label', `Promote to ${PIECE_NAME[t]}`);
      b.dataset.promo = t;
      b.append(pieceSvg(white ? t.toUpperCase() : t));
      b.addEventListener('click', () => void submit({ from: pr.from, to: pr.to, promotion: t }));
      row.append(b);
    }
    card.append(row, button('Cancel', BTN_QUIET, () => { st.promo = null; st.selected = null; renderChess(root, ctx); }));
    picker.append(card);
    board.append(picker);
  }

  // ── status line ──
  const g = m.game;
  let line = '';
  if (m.status === 'finished' && g) {
    const why = reasonText(g.reason);
    line = g.winner === null ? `Draw by ${why}.`
      : seat === null ? `${g.winner === 0 ? 'White' : 'Black'} wins by ${why}.`
      : g.winner === seat ? `You win by ${why}.` : `You lose by ${why}.`;
  } else if (m.status === 'active') {
    const chk = v.check ? ' Check!' : '';
    line = seat === null ? `${v.turn === 0 ? 'White' : 'Black'} to move.${chk}` : myTurn ? `Your move.${chk}` : `Waiting for ${nameOf(v.turn === 0 ? 0 : 1).replace(' (guest)', '')}.${chk}`;
  } else if (m.status === 'challenge') line = 'Challenge not accepted yet.';
  else if (m.status === 'open') line = 'Waiting for someone to open the invite link.';
  else line = `This match was ${m.status}.`;
  const status = h('div', 'px-4 py-2 text-sm font-medium text-white', line);
  status.id = 'statusLine';
  status.setAttribute('role', 'status');
  wrap.append(status);
  const msg = h('div', 'px-4 text-sm text-amber-300 min-h-[1.25rem]');
  msg.id = 'flash';
  wrap.append(msg);

  // ── actions ──
  if (playing && seat !== null) {
    const acts = h('div', 'px-4 py-2 flex flex-wrap gap-2');
    if (v.drawOffer !== null && v.drawOffer !== seat) {
      acts.append(h('span', 'self-center text-sm text-gray-300', 'Draw offered.'),
        button('Accept draw', BTN_PRIMARY, () => void submit({ t: 'acceptDraw' })),
        button('Decline', BTN_QUIET, () => void submit({ t: 'declineDraw' })));
    } else if (v.drawOffer === seat) {
      acts.append(h('span', 'self-center text-sm text-gray-400', 'Draw offered, waiting for a reply.'));
    } else {
      acts.append(button('Offer draw', BTN_QUIET, () => void submit({ t: 'offerDraw' })));
    }
    acts.append(button(st.confirmResign ? 'Tap again to resign' : 'Resign', BTN_DANGER, () => {
      if (!st.confirmResign) { st.confirmResign = true; renderChess(root, ctx); return; }
      void submit({ t: 'resign' });
    }));
    wrap.append(acts);
  }

  // ── move list ──
  const list = h('div', 'px-4 pb-6');
  list.append(h('div', 'text-xs uppercase tracking-wide text-gray-500 mb-1', 'Moves'));
  const moves = h('ol', 'flex flex-wrap gap-x-3 gap-y-1 text-sm text-gray-200 max-h-40 overflow-y-auto');
  moves.id = 'moveList';
  for (let i = 0; i < v.history.length; i += 2) {
    const li = h('li', 'whitespace-nowrap', h('span', 'text-gray-500', `${i / 2 + 1}. `), v.history[i].san + (v.history[i + 1] ? ` ${v.history[i + 1].san}` : ''));
    moves.append(li);
  }
  if (!v.history.length) moves.append(h('li', 'text-gray-600', 'No moves yet.'));
  list.append(moves);
  wrap.append(list);

  root.replaceChildren(wrap);
  function flash(text: string): void { const f = root.querySelector('#flash'); if (f) f.textContent = text; }
}
