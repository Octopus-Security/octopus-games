// Chess as a multiplayer game-type plugin (see MULTIPLAYER.md).
// Seat 0 plays white, seat 1 plays black. Everything here is pure: state in,
// state out, JSON-serialisable, no clocks and no randomness.
import {
  START_FEN, parseFen, toFen, positionKey, legalMoves, make, toSan, inCheck,
  kingSquare, insufficientMaterial, sqName, sqIndex,
} from './rules.js';

export class IllegalMove extends Error {
  constructor(message) {
    super(message);
    this.name = 'IllegalMove';
    this.code = 'ILLEGAL_MOVE';
  }
}

const seatColor = seat => (seat === 0 ? 'w' : 'b');
const colorSeat = c => (c === 'w' ? 0 : 1);

function clone(x) { return JSON.parse(JSON.stringify(x)); }

function initialState(_seed) {
  const pos = parseFen(START_FEN);
  return {
    fen: START_FEN,
    turn: 0,
    history: [],
    reps: { [positionKey(pos)]: 1 },
    drawOffer: null,
    result: null,
  };
}

function describe(m) {
  return { from: sqName(m.from), to: sqName(m.to), ...(m.promo ? { promotion: m.promo } : {}) };
}

/** Result for the position after a move, or null if the game goes on. */
function positionResult(pos, reps) {
  const legal = legalMoves(pos);
  if (!legal.length) {
    return inCheck(pos)
      ? { winner: 1 - colorSeat(pos.turn), reason: 'checkmate' }
      : { winner: null, reason: 'stalemate' };
  }
  if (insufficientMaterial(pos)) return { winner: null, reason: 'insufficient_material' };
  if (pos.half >= 100) return { winner: null, reason: 'fifty_move' };
  if ((reps[positionKey(pos)] || 0) >= 3) return { winner: null, reason: 'threefold_repetition' };
  return null;
}

/**
 * move is one of
 *   { from:'e2', to:'e4', promotion?:'q'|'r'|'b'|'n' }   (only on your turn)
 *   { t:'resign' } | { t:'offerDraw' } | { t:'acceptDraw' } | { t:'declineDraw' }
 */
function applyMove(state, move, seat) {
  if (seat !== 0 && seat !== 1) throw new IllegalMove('not a seat');
  if (!move || typeof move !== 'object') throw new IllegalMove('bad move');
  if (state.result) throw new IllegalMove('the game is over');
  const next = clone(state);
  const events = [];
  const end = (winner, reason) => {
    next.result = { winner, reason };
    next.drawOffer = null;
    events.push({ type: 'end', winner, reason });
  };

  switch (move.t) {
    case 'resign':
      end(1 - seat, 'resignation');
      return { state: next, events };
    case 'offerDraw':
      if (next.drawOffer !== null) throw new IllegalMove(next.drawOffer === seat ? 'you already offered a draw' : 'accept or decline the offer first');
      next.drawOffer = seat;
      events.push({ type: 'drawOffer', seat });
      return { state: next, events };
    case 'acceptDraw':
      if (next.drawOffer !== 1 - seat) throw new IllegalMove('there is no draw offer to accept');
      end(null, 'agreement');
      return { state: next, events };
    case 'declineDraw':
      if (next.drawOffer !== 1 - seat) throw new IllegalMove('there is no draw offer to decline');
      next.drawOffer = null;
      events.push({ type: 'drawDeclined', seat });
      return { state: next, events };
    case undefined:
    case 'move':
      break;
    default:
      throw new IllegalMove('unknown move type');
  }

  if (seat !== state.turn) throw new IllegalMove('not your turn');
  const from = sqIndex(move.from), to = sqIndex(move.to);
  if (from < 0 || to < 0) throw new IllegalMove('bad squares');
  const promo = move.promotion ? String(move.promotion).toLowerCase() : '';
  if (promo && !/^[qrbn]$/.test(promo)) throw new IllegalMove('bad promotion piece');

  const pos = parseFen(state.fen);
  const legal = legalMoves(pos);
  const candidates = legal.filter(m => m.from === from && m.to === to);
  if (!candidates.length) throw new IllegalMove('illegal move');
  const m = candidates.find(c => c.promo === promo);
  if (!m) throw new IllegalMove(candidates[0].promo ? 'promotion piece required' : 'this move is not a promotion');

  const san = toSan(pos, m, legal);
  make(pos, m);
  const fen = toFen(pos);
  const key = positionKey(pos);
  next.reps[key] = (next.reps[key] || 0) + 1;
  next.fen = fen;
  next.turn = colorSeat(pos.turn);
  next.drawOffer = null; // a move lapses any standing offer
  next.history.push({ seat, san, fen, ...describe(m) });
  events.push({ type: 'move', seat, san, ...describe(m) });
  if (inCheck(pos)) events.push({ type: 'check', seat: next.turn });
  const res = positionResult(pos, next.reps);
  if (res) end(res.winner, res.reason);
  return { state: next, events };
}

function status(state) {
  if (state.result) return { turn: null, over: true, winner: state.result.winner, reason: state.result.reason };
  return { turn: state.turn, over: false, winner: null, reason: null };
}

/** Chess has no hidden information, so every seat and spectator sees the same board. */
function view(state, seat) {
  const pos = parseFen(state.fen);
  const last = state.history[state.history.length - 1] || null;
  const myTurn = !state.result && (seat === 0 || seat === 1) && seat === state.turn;
  const legalList = myTurn
    ? legalMoves(pos).map(m => ({ from: sqName(m.from), to: sqName(m.to), ...(m.promo ? { promotion: m.promo } : {}) }))
    : [];
  const checked = inCheck(pos);
  return {
    fen: state.fen,
    board: pos.b.slice(),
    turn: state.result ? null : state.turn,
    history: state.history.map(h => ({ seat: h.seat, san: h.san, from: h.from, to: h.to })),
    lastMove: last ? { from: last.from, to: last.to } : null,
    check: checked ? sqName(kingSquare(pos, pos.turn)) : null,
    legalMoves: legalList,
    drawOffer: state.drawOffer,
    result: state.result,
  };
}

export default { type: 'chess', title: 'Chess', seats: 2, initialState, applyMove, view, status };
export { initialState, applyMove, view, status };
