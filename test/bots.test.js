'use strict';
// The computer opponents (shared/bots). Pure algorithms, no network, no server.
const test = require('node:test');
const assert = require('node:assert/strict');
const { pool, rng, setup } = require('./pool-helpers');

let chessMods;
async function chess() {
  if (!chessMods) {
    chessMods = {
      bot: await import('../shared/bots/chess.js'),
      rules: await import('../shared/chess/rules.js'),
      plugin: (await import('../shared/chess/index.js')).default,
    };
  }
  return chessMods;
}
let poolBot;
async function pbot() { return poolBot || (poolBot = await import('../shared/bots/pool.js')); }

const FENS = [
  'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
  'r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4',
  'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1', // castling, pins, en-passant bait
  '8/2k5/8/8/8/8/6P1/4K3 b - - 0 1',
  '7k/5P2/6K1/8/8/8/8/8 w - - 0 1', // promotion available
];

// ---------------------------------------------------------------- chess

test('chess bot: always returns a legal move at every level, and in time', async () => {
  const { bot, rules } = await chess();
  for (const level of ['easy', 'medium', 'hard']) {
    const budget = bot.LEVELS[level].timeMs;
    for (const fen of FENS) {
      const t0 = Date.now();
      const mv = bot.chooseMove(fen, { level, rng: rng(7) });
      const ms = Date.now() - t0;
      assert.ok(mv, `${level} found a move for ${fen}`);
      const pos = rules.parseFen(fen);
      const ok = rules.legalMoves(pos).some((m) => rules.sqName(m.from) === mv.from && rules.sqName(m.to) === mv.to && (m.promo || '') === (mv.promotion || ''));
      assert.ok(ok, `${level} ${fen}: ${mv.from}${mv.to} is legal`);
      assert.ok(ms <= budget + 700, `${level} took ${ms}ms against a ${budget}ms budget`);
    }
  }
  assert.equal(bot.chooseMove('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1', { level: 'hard' }), null, 'checkmated side has no move');
});

test('chess bot: finds mate in one (medium and hard, and easy when it does not blunder)', async () => {
  const { bot } = await chess();
  const backRank = '6k1/5ppp/8/8/8/8/8/R3K3 w - - 0 1';
  for (const level of ['medium', 'hard']) {
    const mv = bot.chooseMove(backRank, { level });
    assert.deepEqual([mv.from, mv.to], ['a1', 'a8'], `${level} plays Ra8#`);
  }
  assert.deepEqual(((m) => [m.from, m.to])(bot.chooseMove(backRank, { level: 'easy', rng: () => 0.99 })), ['a1', 'a8']);
});

test('chess bot (medium): does not hang its queen', async () => {
  const { bot, rules } = await chess();
  const queenLost = (fen, mv) => {
    const pos = rules.parseFen(fen);
    const m = rules.legalMoves(pos).find((x) => rules.sqName(x.from) === mv.from && rules.sqName(x.to) === mv.to && (x.promo || '') === (mv.promotion || ''));
    rules.make(pos, m);
    return rules.legalMoves(pos).some((r) => pos.b[r.to] === 'Q');
  };
  // 1. the queen is attacked by a pawn: it has to move (or be defended well enough)
  const attacked = 'rnb1kbnr/pp2pppp/2p5/3Q4/8/8/PPPP1PPP/RNB1KBNR w KQkq - 0 4';
  const a = bot.chooseMove(attacked, { level: 'medium' });
  assert.ok(!queenLost(attacked, a), `medium moved the attacked queen to safety (${a.from}${a.to})`);
  // 2. a poisoned pawn: Qxd5 loses the queen to the queen on d8
  const poisoned = '3qk3/8/8/3p4/8/8/8/3QK3 w - - 0 1';
  const p = bot.chooseMove(poisoned, { level: 'medium' });
  assert.notDeepEqual([p.from, p.to], ['d1', 'd5'], 'medium does not take a defended pawn with its queen');
});

test('chess bot: wins a free queen and plays a whole game against itself through the engine', async () => {
  const { bot, plugin } = await chess();
  const grab = bot.chooseMove('4k3/8/8/3q4/4P3/8/8/4K3 w - - 0 1', { level: 'hard' });
  assert.deepEqual([grab.from, grab.to], ['e4', 'd5'], 'pawn takes the loose queen');
  let state = plugin.initialState();
  for (let i = 0; i < 16 && !plugin.status(state).over; i++) {
    const level = i % 2 ? 'medium' : 'easy';
    const mv = bot.chooseMove(state.fen, { level, timeMs: 120, maxDepth: 3, rng: rng(i + 1) });
    state = plugin.applyMove(state, { from: mv.from, to: mv.to, promotion: mv.promotion }, state.turn).state; // throws if illegal
  }
  assert.ok(state.history.length >= 16 || plugin.status(state).over);
});

// ---------------------------------------------------------------- pool

function applyAll(P, state, moves) {
  let s = state;
  for (const m of moves) s = P.applyMove(s, m, s.turn).state;
  return s;
}

test('pool bot: every level returns moves the engine accepts, in both variants, within the caps', async () => {
  const P = await pool();
  const { chooseShot, LEVELS } = await pbot();
  for (const variant of ['8ball', '9ball']) for (const level of ['easy', 'medium', 'hard']) {
    let s = P.initialState(`bot-${variant}-${level}`, { variant });
    for (let i = 0; i < 6 && !s.over; i++) {
      const t0 = Date.now();
      const r = chooseShot(s, { level, rng: rng(i + 3) });
      const ms = Date.now() - t0;
      assert.ok(r.moves.length >= 1 && r.moves.length <= 3);
      assert.ok(r.info.sims <= LEVELS[level].maxSims, `${level} ran ${r.info.sims} sims, cap ${LEVELS[level].maxSims}`);
      assert.ok(ms <= LEVELS[level].budgetMs + 1500, `${level} took ${ms}ms`);
      const last = r.moves[r.moves.length - 1];
      assert.equal(typeof last.angle, 'number');
      assert.ok(last.power > 0 && last.power <= 1);
      s = applyAll(P, s, r.moves); // throws IllegalMove for anything the host would refuse
    }
  }
});

test('pool bot: a tight sim cap and time budget are respected', async () => {
  const P = await pool();
  const { chooseShot } = await pbot();
  const s = P.initialState(5);
  assert.ok(chooseShot(s, { level: 'hard', maxSims: 3 }).info.sims <= 3);
  const t0 = Date.now();
  const r = chooseShot(P.applyMove(s, { angle: 0, power: 1 }, 0).state, { level: 'hard', budgetMs: 1 });
  assert.ok(r.info.sims <= 2 && Date.now() - t0 < 400, 'a 1ms budget stops after the first simulation');
  applyAll(P, P.applyMove(s, { angle: 0, power: 1 }, 0).state, r.moves);
});

test('pool bot (hard): pockets a straight-in shot most of the time', async () => {
  const P = await pool();
  const { chooseShot } = await pbot();
  // cue, the 3 and the middle top pocket are on one vertical line; another ball is nowhere near
  const s = await setup({ 0: [1000, 620], 3: [1000, 150], 12: [1700, 800] }, { groups: [null, null] });
  let potted = 0;
  const N = 12;
  for (let i = 0; i < N; i++) {
    const r = chooseShot(s, { level: 'hard', rng: rng(100 + i) });
    const out = applyAll(P, s, r.moves);
    if (out.lastShot.pocketed.some((id) => id !== 0 && id !== 8) && !out.lastShot.fouls.length) potted++;
  }
  assert.ok(potted >= 9, `hard potted ${potted}/${N}`);
});

test('pool bot: easy errs more than hard on the same shot', async () => {
  const P = await pool();
  const { chooseShot } = await pbot();
  const s = await setup({ 0: [1000, 620], 3: [1000, 150], 12: [1700, 800] });
  const rate = (level) => {
    let n = 0;
    for (let i = 0; i < 20; i++) {
      const out = applyAll(P, s, chooseShot(s, { level, rng: rng(500 + i) }).moves);
      if (out.lastShot.pocketed.includes(3)) n++;
    }
    return n;
  };
  assert.ok(rate('hard') >= rate('easy'), 'hard is at least as accurate as easy');
});

test('pool bot: calls a pocket for the 8, and replaces the cue ball after a foul', async () => {
  const P = await pool();
  const { chooseShot } = await pbot();
  const g = ['solid', 'stripe'];
  const eight = await setup({ 0: [1000, 620], 8: [1000, 150], 12: [1700, 800] }, { groups: g });
  // seat 0 is solids and has none left: the 8 is its target
  const r = chooseShot(eight, { level: 'medium', rng: rng(1) });
  assert.ok('callPocket' in r.moves[0], 'the first move calls a pocket');
  applyAll(P, eight, r.moves);
  const inHand = await setup({ 0: [300, 300], 3: [1300, 400], 12: [1700, 800], 9: [900, 700] }, { inHand: { kitchen: false }, groups: g });
  const h = chooseShot(inHand, { level: 'hard', rng: rng(2) });
  assert.ok('placeCue' in h.moves[0], 'ball in hand: the cue ball is placed first');
  applyAll(P, inHand, h.moves);
});

test('pool bot: breaks legally in both variants', async () => {
  const P = await pool();
  const { chooseShot } = await pbot();
  for (const variant of ['8ball', '9ball']) {
    const s = P.initialState(21, { variant });
    const r = chooseShot(s, { level: 'hard', rng: rng(4) });
    const out = applyAll(P, s, r.moves);
    assert.equal(out.shots, 1);
    assert.ok(!out.lastShot.fouls.includes('illegal-break'), `${variant}: hard breaks legally`);
  }
});
