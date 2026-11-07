'use strict';
// Chess rules: perft against the published node counts, then every end condition.
// Run: node --test test/chess-engine.test.js
const { test, before } = require('node:test');
const assert = require('node:assert');

let rules, chess;
before(async () => {
  rules = await import('../shared/chess/rules.js');
  chess = (await import('../shared/chess/index.js')).default;
});

const PERFT = [
  ['start position d4', 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', 4, 197281],
  ['start position d1-3', 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', 3, 8902],
  ['Kiwipete d3', 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1', 3, 97862],
  ['Kiwipete d2', 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1', 2, 2039],
  ['position 3 d4', '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1', 4, 43238],
  ['position 4 d3', 'r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1', 3, 9467],
  ['position 4 mirrored d3', 'r2q1rk1/pP1p2pp/Q4n2/bbp1p3/Np6/1B3NBn/pPPP1PPP/R3K2R b KQ - 0 1', 3, 9467],
  ['position 5 d3', 'rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8', 3, 62379],
  ['position 6 d3', 'r4rk1/1pp1qppp/p1np1n2/2b1p1B1/2B1P1b1/P1NP1N2/1PP1QPPP/R4RK1 w - - 0 10', 3, 89890],
];
for (const [name, fen, depth, nodes] of PERFT) {
  test(`perft ${name} = ${nodes}`, () => {
    assert.strictEqual(rules.perft(rules.parseFen(fen), depth), nodes);
  });
}

test('FEN round trips', () => {
  const f = 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1';
  assert.strictEqual(rules.toFen(rules.parseFen(f)), f);
});

// ── helpers ────────────────────────────────────────────────────────────────
function play(moves, state = chess.initialState(1)) {
  let events = [];
  for (const mv of moves) {
    const seat = typeof mv === 'object' && mv.seat !== undefined ? mv.seat : state.turn;
    const m = typeof mv === 'string' ? { from: mv.slice(0, 2), to: mv.slice(2, 4), promotion: mv[4] } : mv;
    ({ state, events } = chess.applyMove(state, m, seat));
  }
  return { state, events };
}
const illegal = (state, move, seat) => assert.throws(() => chess.applyMove(state, move, seat), e => e.name === 'IllegalMove');
/** A state from a FEN, for the end conditions that are quicker to set up than to reach. */
function fromFen(fen, extra = {}) {
  const pos = rules.parseFen(fen);
  return { fen, turn: pos.turn === 'w' ? 0 : 1, history: [], reps: { [rules.positionKey(pos)]: 1 }, drawOffer: null, result: null, ...extra };
}

test('the plugin has the documented shape', () => {
  assert.strictEqual(chess.type, 'chess');
  assert.strictEqual(chess.seats, 2);
  for (const k of ['initialState', 'applyMove', 'view', 'status']) assert.strictEqual(typeof chess[k], 'function');
  const s = chess.initialState(7);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(s)), s);
  assert.deepStrictEqual(chess.status(s), { turn: 0, over: false, winner: null, reason: null });
});

test('applyMove does not mutate its input', () => {
  const s = chess.initialState(1);
  const frozen = JSON.stringify(s);
  chess.applyMove(s, { from: 'e2', to: 'e4' }, 0);
  assert.strictEqual(JSON.stringify(s), frozen);
});

test('wrong turn, wrong piece and bad input are IllegalMove', () => {
  const s = chess.initialState(1);
  illegal(s, { from: 'e7', to: 'e5' }, 1);   // not black's turn
  illegal(s, { from: 'e2', to: 'e5' }, 0);   // pawn three squares
  illegal(s, { from: 'e7', to: 'e5' }, 0);   // white moving a black pawn
  illegal(s, { from: 'z9', to: 'e5' }, 0);
  illegal(s, { from: 'e2', to: 'e4' }, 2);   // not a seat
  illegal(s, null, 0);
  illegal(s, { t: 'nonsense' }, 0);
});

test('fool\'s mate: checkmate, SAN with #, FEN stored', () => {
  const { state, events } = play(['f2f3', 'e7e5', 'g2g4', 'd8h4']);
  assert.deepStrictEqual(chess.status(state), { turn: null, over: true, winner: 1, reason: 'checkmate' });
  assert.deepStrictEqual(state.history.map(h => h.san), ['f3', 'e5', 'g4', 'Qh4#']);
  assert.ok(state.history.every(h => /^[^ ]+ [wb] [KQkq-]+ [a-h1-8-]+ \d+ \d+$/.test(h.fen)));
  assert.ok(events.some(e => e.type === 'end' && e.reason === 'checkmate'));
  illegal(state, { from: 'a2', to: 'a3' }, 0); // over
});

test('stalemate', () => {
  const s2 = fromFen('7k/8/5K2/6Q1/8/8/8/8 w - - 0 1');
  const res = play(['g5g6'], s2);
  assert.deepStrictEqual(chess.status(res.state), { turn: null, over: true, winner: null, reason: 'stalemate' });
});

test('castling both sides, rights lost, not through check, not out of check', () => {
  let { state } = play(['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1c4', 'g8f6', 'e1g1']);
  assert.strictEqual(state.history[state.history.length - 1].san, 'O-O');
  assert.ok(state.fen.startsWith('r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQ1RK1'));
  // queenside for black, and the white king cannot castle once it moved
  ({ state } = play(['d7d6', 'b1c3', 'c8e6', 'd2d3', 'd8d7', 'c1e3', 'e8c8'], state));
  assert.strictEqual(state.history[state.history.length - 1].san, 'O-O-O');
  // through an attacked square
  const through = fromFen('4k3/8/8/8/8/5r2/8/R3K2R w KQ - 0 1');
  illegal(through, { from: 'e1', to: 'g1' }, 0);
  illegal(fromFen('4k3/8/8/8/8/8/4r3/R3K2R w KQ - 0 1'), { from: 'e1', to: 'g1' }, 0); // out of check
  // after a rook moves, that side is gone
  const s = fromFen('4k3/8/8/8/8/8/8/R3K2R w KQ - 0 1');
  const moved = play(['h1h2', 'e8e7', 'h2h1', 'e7e8'], s).state;
  illegal(moved, { from: 'e1', to: 'g1' }, 0);
  assert.ok(play([{ from: 'e1', to: 'c1' }], moved).state);
});

test('en passant: only immediately, removes the pawn', () => {
  const { state } = play(['e2e4', 'a7a6', 'e4e5', 'd7d5', 'e5d6']);
  assert.strictEqual(state.history[4].san, 'exd6');
  assert.ok(state.fen.startsWith('rnbqkbnr/1pp1pppp/p2P4/8/8/8/PPPP1PPP/RNBQKBNR'));
  const late = play(['e2e4', 'a7a6', 'e4e5', 'd7d5', 'a2a3', 'a6a5']).state;
  illegal(late, { from: 'e5', to: 'd6' }, 0);
});

test('promotion needs a piece, honours the choice, and rejects it elsewhere', () => {
  const s = fromFen('8/P6k/8/8/8/8/8/K7 w - - 0 1');
  illegal(s, { from: 'a7', to: 'a8' }, 0);
  illegal(s, { from: 'a7', to: 'a8', promotion: 'k' }, 0);
  const q = play(['a7a8q'], s).state;
  assert.ok(q.fen.startsWith('Q7/7k'));
  assert.strictEqual(q.history[0].san, 'a8=Q');
  const n = play(['a7a8n'], s).state;
  assert.strictEqual(n.history[0].san, 'a8=N');
  const mate = play(['a7a8r'], fromFen('7k/P7/6K1/8/8/8/8/8 w - - 0 1')).state;
  assert.strictEqual(mate.history[0].san, 'a8=R#');
  illegal(chess.initialState(1), { from: 'e2', to: 'e4', promotion: 'q' }, 0);
});

test('SAN disambiguation', () => {
  const s = fromFen('4k3/8/8/8/8/8/4K3/R6R w - - 0 1');
  assert.strictEqual(play(['a1d1'], s).state.history[0].san, 'Rad1');
  const s2 = fromFen('4k3/R7/8/8/8/8/8/R3K3 w - - 0 1');
  assert.strictEqual(play(['a1a4'], s2).state.history[0].san, 'R1a4');
});

test('check is reported and a pinned piece cannot move', () => {
  const { state, events } = play(['e2e4', 'f7f5', 'd1h5']);
  assert.ok(events.some(e => e.type === 'check'));
  assert.strictEqual(chess.view(state, 1).check, 'e8');
  illegal(state, { from: 'a7', to: 'a6' }, 1); // must answer the check
});

test('threefold repetition draws', () => {
  const shuffle = ['g1f3', 'g8f6', 'f3g1', 'f6g8'];
  const { state } = play([...shuffle, ...shuffle]);
  assert.deepStrictEqual(chess.status(state), { turn: null, over: true, winner: null, reason: 'threefold_repetition' });
});

test('fifty-move rule draws; a mate on the 100th half-move still mates', () => {
  const s = fromFen('7k/8/8/8/8/8/R7/K7 w - - 99 80');
  const { state } = play(['a2b2'], s);
  assert.strictEqual(chess.status(state).reason, 'fifty_move');
  const m = fromFen('7k/R7/6K1/8/8/8/8/8 w - - 99 80');
  assert.strictEqual(chess.status(play(['a7a8'], m).state).reason, 'checkmate');
  const reset = fromFen('7k/8/8/8/8/8/p7/K7 b - - 99 80');
  assert.strictEqual(chess.status(play([{ from: 'h8', to: 'g8' }], reset).state).reason, 'fifty_move');
});

test('insufficient material', () => {
  for (const f of [
    '7k/8/8/8/8/8/8/K7 w - - 0 1',
    '7k/8/8/8/8/8/8/KB6 w - - 0 1',
    '7k/8/8/8/8/8/8/KN6 w - - 0 1',
    '2b4k/8/8/8/8/8/8/K2B4 w - - 0 1',
  ]) assert.ok(rules.insufficientMaterial(rules.parseFen(f)), f);
  for (const f of [
    '7k/8/8/8/8/8/8/KNN5 w - - 0 1',
    '7k/8/8/8/8/8/8/KBb5 w - - 0 1',
    '7k/8/8/8/8/8/P7/K7 w - - 0 1',
    '7k/8/8/8/8/8/8/KR6 w - - 0 1',
  ]) assert.ok(!rules.insufficientMaterial(rules.parseFen(f)), f);
  // reached by capture: the game ends the moment the last piece goes
  const r = play(['c1b2'], fromFen('7k/8/8/8/8/8/1n6/K1B5 w - - 0 1')).state;
  assert.strictEqual(chess.status(r).reason, 'insufficient_material');
});

test('resign works for either seat at any time', () => {
  let r = play([{ t: 'resign', seat: 1 }]).state; // black resigns on white's turn
  assert.deepStrictEqual(chess.status(r), { turn: null, over: true, winner: 0, reason: 'resignation' });
  r = play([{ t: 'resign', seat: 0 }]).state;
  assert.strictEqual(chess.status(r).winner, 1);
  illegal(r, { t: 'resign' }, 0);
});

test('draw offers: offer, accept, decline, lapse on a move', () => {
  const base = play(['e2e4']).state;
  illegal(base, { t: 'acceptDraw' }, 1);            // nothing offered
  const offered = play([{ t: 'offerDraw', seat: 1 }], base).state;
  assert.strictEqual(offered.drawOffer, 1);
  illegal(offered, { t: 'offerDraw' }, 1);           // twice
  illegal(offered, { t: 'acceptDraw' }, 1);          // own offer
  illegal(offered, { t: 'offerDraw' }, 0);           // pending offer from the other side
  const agreed = play([{ t: 'acceptDraw', seat: 0 }], offered).state;
  assert.deepStrictEqual(chess.status(agreed), { turn: null, over: true, winner: null, reason: 'agreement' });
  const declined = play([{ t: 'declineDraw', seat: 0 }], offered).state;
  assert.strictEqual(declined.drawOffer, null);
  const lapsed = play(['e7e5'], offered).state;      // black moves after offering
  assert.strictEqual(lapsed.drawOffer, null);
  const lapsed2 = play([{ t: 'offerDraw', seat: 0 }, 'e7e5'], base).state; // white offers, black moves on
  assert.strictEqual(lapsed2.drawOffer, null);
});

test('view: legal moves only for the seat to move, board flips are the client\'s job', () => {
  const s = chess.initialState(1);
  assert.strictEqual(chess.view(s, 0).legalMoves.length, 20);
  assert.strictEqual(chess.view(s, 1).legalMoves.length, 0);
  assert.strictEqual(chess.view(s, null).legalMoves.length, 0);
  assert.strictEqual(chess.view(s, null).board.length, 64);
});
