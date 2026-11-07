// Computer opponent for chess: a classic alpha-beta searcher. Plain arithmetic on
// the board in ../chess/rules.js, no network and no dependencies. It runs inside
// the player's browser (in a Web Worker), so it costs the server nothing.
//
//  - iterative deepening under a wall-clock budget (the last finished depth wins)
//  - negamax with alpha-beta, check extension
//  - move ordering: previous best move, captures by MVV-LVA, promotions, killer
//    moves, then a small history table
//  - quiescence search on captures and promotions
//  - evaluation: material plus piece-square tables (written here, king table
//    switches to an endgame table when little material is left)
//
// Strength is not measured against any engine or rating list. Treat the level
// names as relative: easy < medium < hard.

import { parseFen, legalMoves, make, undo, inCheck, sqName } from '../chess/rules.js';

export const LEVELS = {
  // Shallow search, noisy root scores, and a chance of simply playing a random legal move.
  easy: { maxDepth: 2, timeMs: 350, blunder: 0.3, noise: 70 },
  medium: { maxDepth: 5, timeMs: 1100, blunder: 0, noise: 0 },
  hard: { maxDepth: 12, timeMs: 2000, blunder: 0, noise: 0 },
};

const MATE = 100000;
const VAL = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };

// Piece-square tables from white's point of view, indexed like the board
// (0 = a8 ... 63 = h1). Black reads them mirrored with i ^ 56.
// prettier-ignore
const PST = {
  p: [
     0,  0,  0,  0,  0,  0,  0,  0,
    60, 60, 60, 60, 60, 60, 60, 60,
    20, 20, 28, 38, 38, 28, 20, 20,
     8,  8, 14, 32, 32, 14,  8,  8,
     2,  2,  8, 28, 28,  8,  2,  2,
     4, -2, -6,  4,  4, -6, -2,  4,
     4,  8,  8,-24,-24,  8,  8,  4,
     0,  0,  0,  0,  0,  0,  0,  0],
  n: [
   -50,-40,-30,-30,-30,-30,-40,-50,
   -40,-20,  0,  4,  4,  0,-20,-40,
   -30,  4, 12, 17, 17, 12,  4,-30,
   -30,  0, 17, 22, 22, 17,  0,-30,
   -30,  4, 17, 22, 22, 17,  4,-30,
   -30,  0, 12, 16, 16, 12,  0,-30,
   -40,-20,  0,  2,  2,  0,-20,-40,
   -50,-40,-30,-30,-30,-30,-40,-50],
  b: [
   -20,-10,-10,-10,-10,-10,-10,-20,
   -10,  0,  0,  0,  0,  0,  0,-10,
   -10,  0,  6, 10, 10,  6,  0,-10,
   -10,  4,  6, 10, 10,  6,  4,-10,
   -10,  0, 10, 10, 10, 10,  0,-10,
   -10, 10, 10, 10, 10, 10, 10,-10,
   -10,  6,  0,  0,  0,  0,  6,-10,
   -20,-10,-10,-10,-10,-10,-10,-20],
  r: [
     0,  0,  0,  0,  0,  0,  0,  0,
     6, 10, 10, 10, 10, 10, 10,  6,
    -4,  0,  0,  0,  0,  0,  0, -4,
    -4,  0,  0,  0,  0,  0,  0, -4,
    -4,  0,  0,  0,  0,  0,  0, -4,
    -4,  0,  0,  0,  0,  0,  0, -4,
    -4,  0,  0,  0,  0,  0,  0, -4,
     0,  0,  0,  4,  4,  0,  0,  0],
  q: [
   -20,-10,-10, -4, -4,-10,-10,-20,
   -10,  0,  0,  0,  0,  0,  0,-10,
   -10,  0,  4,  4,  4,  4,  0,-10,
    -4,  0,  4,  4,  4,  4,  0, -4,
    -4,  0,  4,  4,  4,  4,  0, -4,
   -10,  4,  4,  4,  4,  4,  0,-10,
   -10,  0,  4,  0,  0,  0,  0,-10,
   -20,-10,-10, -4, -4,-10,-10,-20],
  kMid: [
   -30,-40,-40,-50,-50,-40,-40,-30,
   -30,-40,-40,-50,-50,-40,-40,-30,
   -30,-40,-40,-50,-50,-40,-40,-30,
   -30,-40,-40,-50,-50,-40,-40,-30,
   -20,-30,-30,-40,-40,-30,-30,-20,
   -10,-20,-20,-20,-20,-20,-20,-10,
    20, 20,  0,  0,  0,  0, 20, 20,
    20, 30, 12,  0,  0, 10, 30, 20],
  kEnd: [
   -50,-30,-30,-30,-30,-30,-30,-50,
   -30,-20,-10,  0,  0,-10,-20,-30,
   -30,-10, 20, 30, 30, 20,-10,-30,
   -30,-10, 30, 40, 40, 30,-10,-30,
   -30,-10, 30, 40, 40, 30,-10,-30,
   -30,-10, 20, 30, 30, 20,-10,-30,
   -30,-30,  0,  0,  0,  0,-30,-30,
   -50,-40,-30,-20,-20,-30,-40,-50],
};

/** Static evaluation in centipawns from the side to move's point of view. */
export function evaluate(pos) {
  let mat = 0; // non-pawn, non-king material of both sides, to pick the king table
  for (let i = 0; i < 64; i++) {
    const p = pos.b[i];
    if (p) { const t = p.toLowerCase(); if (t !== 'p' && t !== 'k') mat += VAL[t]; }
  }
  const endgame = mat <= 2600;
  let score = 0;
  for (let i = 0; i < 64; i++) {
    const p = pos.b[i];
    if (!p) continue;
    const white = p < 'a';
    const t = p.toLowerCase();
    const table = t === 'k' ? (endgame ? PST.kEnd : PST.kMid) : PST[t];
    const v = VAL[t] + table[white ? i : i ^ 56];
    score += white ? v : -v;
  }
  return pos.turn === 'w' ? score : -score;
}

const clock = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
class Timeout {}

function pieceValueAt(pos, sq) {
  const p = pos.b[sq];
  return p ? VAL[p.toLowerCase()] : 0;
}

function search(pos, level, rng) {
  const deadline = clock() + level.timeMs;
  let nodes = 0;
  const killers = [];
  const history = new Map();

  function tick() {
    if ((++nodes & 1023) === 0 && clock() > deadline) throw new Timeout();
  }

  function scoreMove(m, ply, first) {
    if (first && m.from === first.from && m.to === first.to && m.promo === first.promo) return 1e7;
    const captured = m.flag === 'ep' ? 100 : pieceValueAt(pos, m.to);
    if (captured || m.flag === 'ep') return 1e6 + 10 * captured - VAL[pos.b[m.from].toLowerCase()] / 10;
    if (m.promo) return 9e5 + VAL[m.promo];
    const k = killers[ply];
    if (k) {
      if (k[0] && k[0].from === m.from && k[0].to === m.to) return 8e5;
      if (k[1] && k[1].from === m.from && k[1].to === m.to) return 7e5;
    }
    return history.get(m.from * 64 + m.to) || 0;
  }

  function ordered(moves, ply, first) {
    const scored = moves.map((m) => [scoreMove(m, ply, first), m]);
    scored.sort((a, b) => b[0] - a[0]);
    return scored.map((x) => x[1]);
  }

  function quiesce(alpha, beta, ply, qd) {
    tick();
    const checked = inCheck(pos);
    let best;
    if (!checked) {
      best = evaluate(pos);
      if (best >= beta) return best;
      if (best > alpha) alpha = best;
    } else best = -MATE + ply;
    if (qd <= 0 && !checked) return best;
    if (qd <= -6) return evaluate(pos);
    const legal = legalMoves(pos);
    if (!legal.length) return checked ? -MATE + ply : 0;
    const pool = checked ? legal : legal.filter((m) => m.flag === 'ep' || m.promo || pos.b[m.to]);
    for (const m of ordered(pool, ply, null)) {
      const u = make(pos, m);
      const sc = -quiesce(-beta, -alpha, ply + 1, qd - 1);
      undo(pos, m, u);
      if (sc > best) best = sc;
      if (sc > alpha) alpha = sc;
      if (alpha >= beta) break;
    }
    return best;
  }

  function negamax(depth, alpha, beta, ply) {
    tick();
    const checked = inCheck(pos);
    if (checked && ply < 30) depth++;
    if (depth <= 0) return quiesce(alpha, beta, ply, 4);
    if (pos.half >= 100) return 0;
    const legal = legalMoves(pos);
    if (!legal.length) return checked ? -MATE + ply : 0;
    let best = -Infinity;
    for (const m of ordered(legal, ply, null)) {
      const u = make(pos, m);
      const sc = -negamax(depth - 1, -beta, -alpha, ply + 1);
      undo(pos, m, u);
      if (sc > best) best = sc;
      if (sc > alpha) alpha = sc;
      if (alpha >= beta) {
        if (!pos.b[m.to] && !m.promo) {
          const k = killers[ply] || (killers[ply] = [null, null]);
          if (!k[0] || k[0].from !== m.from || k[0].to !== m.to) { k[1] = k[0]; k[0] = m; }
          const key = m.from * 64 + m.to;
          history.set(key, (history.get(key) || 0) + depth * depth);
        }
        break;
      }
    }
    return best;
  }

  /** Score every root move with a full window to `depth` (used by easy, and as the iteration body). */
  function rootSearch(moves, depth, first) {
    let alpha = -Infinity;
    const results = [];
    for (const m of ordered(moves, 0, first)) {
      const u = make(pos, m);
      const sc = -negamax(depth - 1, -MATE * 2, -(alpha > -Infinity ? alpha : -MATE * 2), 1);
      undo(pos, m, u);
      results.push([sc, m]);
      if (sc > alpha) alpha = sc;
    }
    return results;
  }

  return { rootSearch, nodes: () => nodes, Timeout };
}

/**
 * Pick a move for the side to move in `fen`.
 * opts: { level: 'easy'|'medium'|'hard', timeMs?, rng? (() => [0,1)), maxDepth? }
 * Returns { from, to, promotion?, depth, nodes, ms, score } or null when there is no legal move.
 * Always a legal move: the result is one of legalMoves(pos), with a random legal
 * move as the fallback if the clock ran out before depth 1 finished.
 */
export function chooseMove(fen, opts = {}) {
  const level = { ...(LEVELS[opts.level] || LEVELS.medium) };
  if (opts.timeMs) level.timeMs = opts.timeMs;
  if (opts.maxDepth) level.maxDepth = opts.maxDepth;
  const rng = opts.rng || Math.random;
  const t0 = clock();
  const pos = parseFen(fen);
  const legal = legalMoves(pos);
  if (!legal.length) return null;
  const out = (m, depth, nodes, score) => ({
    from: sqName(m.from), to: sqName(m.to), ...(m.promo ? { promotion: m.promo } : {}),
    depth, nodes, ms: Math.round(clock() - t0), score,
  });
  if (legal.length === 1) return out(legal[0], 0, 0, 0);

  if (level.blunder && rng() < level.blunder) {
    return out(legal[Math.floor(rng() * legal.length)], 0, 0, 0);
  }

  const s = search(pos, level, rng);
  let best = legal[0];
  let bestScore = 0;
  let reached = 0;
  try {
    let first = null;
    for (let depth = 1; depth <= level.maxDepth; depth++) {
      const results = s.rootSearch(legal, depth, first);
      if (level.noise) for (const r of results) r[0] += (rng() * 2 - 1) * level.noise;
      results.sort((a, b) => b[0] - a[0]);
      best = results[0][1];
      bestScore = Math.round(results[0][0]);
      first = best;
      reached = depth;
      if (Math.abs(bestScore) > MATE - 100) break; // a forced mate is on the board
    }
  } catch (e) {
    if (!(e instanceof s.Timeout)) throw e;
  }
  return out(best, reached, s.nodes(), bestScore);
}
