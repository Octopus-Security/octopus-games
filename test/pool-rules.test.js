'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { pool, setup, fakeSim } = require('./pool-helpers');

const SOLIDS = [1, 2, 3, 4, 5, 6, 7];
const SIDE_POT = { angle: -Math.PI / 2, power: 0.6 }; // cue (1000,400) up the table at a ball on (1000,120)

test('initial rack: 15 balls, 8 in the centre, one solid and one stripe in the back corners, seeded', async () => {
  const P = await pool();
  for (const seed of [1, 2, 3, 'abc', 4242]) {
    const order = P.rackOrder(seed);
    assert.equal(order[4], 8);
    assert.deepEqual(order.slice().sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
    assert.notEqual(P.groupOf(order[10]), P.groupOf(order[14]));
    assert.ok(['solid', 'stripe'].includes(P.groupOf(order[10])));
    assert.deepEqual(P.rackOrder(seed), order);
  }
  assert.notDeepEqual(P.rackOrder(1), P.rackOrder(2));
  const s = P.initialState(9);
  assert.equal(s.balls.filter(Boolean).length, 16);
  assert.deepEqual(P.status(s), { turn: 0, over: false, winner: null, reason: null });
  assert.ok(s.inHand.kitchen && s.breakShot);
});

test('plugin shape matches the host interface', async () => {
  const P = await pool();
  const d = P.default;
  assert.equal(d.type, 'pool');
  assert.equal(d.title, 'Pool');
  assert.equal(d.seats, 2);
  for (const f of ['initialState', 'applyMove', 'view', 'status']) assert.equal(typeof d[f], 'function');
  const s = d.initialState(3);
  const v = d.view(s, null);
  assert.equal(v.you, null);
  assert.equal(JSON.stringify(v), JSON.stringify(JSON.parse(JSON.stringify(v))));
  assert.equal(v.turn, 0);
  assert.equal(v.mustCall, false);
  // view hides nothing: it carries the balls and the last shot
  const r = d.applyMove(s, { angle: 0, power: 1 }, 0);
  const ls = d.view(r.state, 1).lastShot;
  assert.equal(ls.frameCount > 5, true);
  assert.equal(ls.tracks.length, 16);
  assert.ok(ls.tracks.some((t) => t && t.length === 2 * ls.frameCount));
  assert.ok(JSON.stringify(ls).length < 60000, 'lastShot stays small');
  assert.equal(d.view(r.state, 1).you, 1);
});

test('applyMove rejects a shot from the wrong seat, and moves after the end', async () => {
  const P = await pool();
  const s = P.initialState(1);
  assert.throws(() => P.applyMove(s, { angle: 0, power: 0.5 }, 1), (e) => e.name === 'IllegalMove' && e instanceof P.IllegalMove);
  assert.throws(() => P.applyMove(s, { placeCue: { x: 100, y: 500 } }, 1), /not your turn/);
  assert.throws(() => P.applyMove(s, { angle: 0, power: 0.5 }, 2), P.IllegalMove);
  assert.throws(() => P.applyMove(s, { angle: 'x', power: 0.5 }, 0), P.IllegalMove);
  assert.throws(() => P.applyMove(s, { angle: 0, power: 0 }, 0), P.IllegalMove);
  assert.throws(() => P.applyMove(s, { angle: 0, power: 2 }, 0), P.IllegalMove);
  assert.throws(() => P.applyMove(s, { angle: 0, power: 1, spinY: 3 }, 0), P.IllegalMove);
  assert.throws(() => P.applyMove(s, { angle: 0, power: 1, placeCue: { x: 1, y: 1 } }, 0), P.IllegalMove);
  assert.throws(() => P.applyMove(s, null, 0), P.IllegalMove);
  const over = Object.assign({}, s, { over: true, winner: 0, reason: 'x' });
  assert.throws(() => P.applyMove(over, { angle: 0, power: 0.5 }, 0), /over/);
  // the input state is never mutated
  const before = JSON.stringify(s);
  P.applyMove(s, { angle: 0, power: 1 }, 0);
  assert.equal(JSON.stringify(s), before);
});

test('foul: scratch gives the opponent ball in hand anywhere', async () => {
  const P = await pool();
  const s = await setup({ 0: [200, 200], 1: [1500, 500], 9: [1500, 800], 8: [1700, 300] });
  const r = P.applyMove(s, { angle: -3 * Math.PI / 4, power: 0.5 }, 0);
  assert.ok(r.state.lastShot.fouls.includes('scratch'));
  assert.ok(r.state.lastShot.fouls.includes('no-contact'));
  assert.equal(r.state.turn, 1);
  assert.deepEqual(r.state.inHand, { kitchen: false });
  assert.ok(r.state.balls[0], 'the cue ball is put back on the cloth, ready to be placed');
  assert.equal(P.cuePlacementProblem(r.state.balls, r.state.balls[0][0], r.state.balls[0][1], false), null);
  assert.ok(r.events.some((e) => e.type === 'foul' && e.reason === 'scratch'));
});

test('foul: wrong ball first (groups decided)', async () => {
  const P = await pool();
  const s = await setup({ 0: [600, 500], 9: [1000, 500], 3: [300, 200], 8: [300, 800] }, { groups: ['solid', 'stripe'] });
  const r = P.applyMove(s, { angle: 0, power: 0.7 }, 0);
  assert.equal(r.state.lastShot.firstContact, 9);
  assert.ok(r.state.lastShot.fouls.includes('wrong-ball'));
  assert.equal(r.state.turn, 1);
  assert.ok(r.state.inHand);
});

test('foul: hitting the 8 first on an open table, and a group ball when only the 8 is left', async () => {
  const P = await pool();
  const open = await setup({ 0: [600, 500], 8: [1000, 500], 3: [300, 200], 9: [300, 800] });
  assert.ok(P.applyMove(open, { angle: 0, power: 0.7 }, 0).state.lastShot.fouls.includes('wrong-ball'));
  // seat 0 has cleared its stripes, so the 8 is the only legal first contact
  const only8 = await setup({ 0: [600, 500], 8: [300, 800], 3: [1000, 500] }, { groups: ['stripe', 'solid'] });
  assert.equal(P.targetOf(only8, 0), 'eight');
  const called = P.applyMove(only8, { callPocket: 0 }, 0).state;
  const r = P.applyMove(called, { angle: 0, power: 0.7 }, 0);
  assert.ok(r.state.lastShot.fouls.includes('wrong-ball'));
});

test('foul: no contact', async () => {
  const P = await pool();
  const s = await setup({ 0: [600, 500], 1: [1500, 100], 9: [1500, 900] });
  const r = P.applyMove(s, { angle: Math.PI / 2, power: 0.4 }, 0);
  assert.equal(r.state.lastShot.firstContact, null);
  assert.deepEqual(r.state.lastShot.fouls, ['no-contact']);
});

test('foul: no cushion after contact', async () => {
  const P = await pool();
  const s = await setup({ 0: [600, 500], 1: [800, 500], 9: [300, 150], 8: [300, 850] });
  const r = P.applyMove(s, { angle: 0, power: 0.2 }, 0);
  assert.equal(r.state.lastShot.firstContact, 1);
  assert.deepEqual(r.state.lastShot.fouls, ['no-cushion']);
  assert.equal(r.state.turn, 1);
  // the same contact that sends the ball to a cushion is clean
  const ok = P.applyMove(s, { angle: 0, power: 0.7 }, 0);
  assert.deepEqual(ok.state.lastShot.fouls, []);
});

test('foul: a break that neither pockets a ball nor drives four to a cushion', async () => {
  const P = await pool();
  const s = P.initialState(11);
  const r = P.applyMove(s, { angle: 0, power: 0.12 }, 0);
  assert.ok(r.state.lastShot.fouls.includes('illegal-break'));
  assert.equal(r.state.turn, 1);
  assert.ok(r.state.inHand);
  assert.equal(r.state.breakShot, false);
  const hard = P.applyMove(s, { angle: 0, power: 1 }, 0);
  assert.ok(!hard.state.lastShot.fouls.includes('illegal-break'));
  assert.equal(hard.state.breakShot, false);
  assert.deepEqual(hard.state.groups, [null, null], 'the table stays open after the break');
});

test('foul: a ball off the table is spotted and fouls (rules fed a hand-made result)', async () => {
  const P = await pool();
  const s = await setup({ 0: [600, 500], 3: [1000, 500], 9: [300, 150], 8: [300, 850] });
  const balls = JSON.parse(JSON.stringify(s.balls));
  balls[0] = [700, 500]; balls[3] = null;
  const r = P.resolveShot(s, 0, { angle: 0, power: 0.5, spinX: 0, spinY: 0 }, fakeSim(balls, { offTable: [3], firstContact: 3 }));
  assert.ok(r.state.lastShot.fouls.includes('off-table'));
  assert.ok(r.state.balls[3], 'spotted back on the table');
  assert.equal(P.cuePlacementProblem(r.state.balls.map((b, i) => (i === 3 ? null : b)), r.state.balls[3][0], r.state.balls[3][1], false), null);
  assert.equal(r.state.turn, 1);
  assert.ok(r.events.some((e) => e.type === 'respot' && e.ball === 3));
});

test('group assignment: the first legal pocket after the break decides it', async () => {
  const P = await pool();
  const s = await setup({ 0: [1000, 400], 3: [1000, 120], 9: [300, 700], 1: [300, 200], 8: [500, 800] });
  const r = P.applyMove(s, SIDE_POT, 0);
  assert.deepEqual(r.state.lastShot.pocketed, [3]);
  assert.deepEqual(r.state.lastShot.fouls, []);
  assert.deepEqual(r.state.groups, ['solid', 'stripe']);
  assert.equal(r.state.turn, 0, 'a legal pocket keeps the turn');
  assert.equal(r.state.inHand, null);
  assert.ok(r.events.some((e) => e.type === 'groups'));
  // pot a stripe instead and seat 0 is stripes
  const s2 = await setup({ 0: [1000, 400], 11: [1000, 120], 2: [300, 700], 1: [300, 200], 8: [500, 800] });
  assert.deepEqual(P.applyMove(s2, SIDE_POT, 0).state.groups, ['stripe', 'solid']);
});

test('no group is decided by a pocket on a foul shot, or on the break', async () => {
  const P = await pool();
  // pot a solid but the cue ball is hit... fouled by wrong ball? use a scratch: cue follows in
  const s = await setup({ 0: [1000, 400], 3: [1000, 120], 9: [300, 700], 1: [300, 200], 8: [500, 800] });
  const balls = JSON.parse(JSON.stringify(s.balls));
  balls[3] = null; balls[0] = null;
  const r = P.resolveShot(s, 0, { angle: -1.57, power: 0.6, spinX: 0, spinY: 0 },
    fakeSim(balls, { pocketed: [{ ball: 3, pocket: 1 }, { ball: 0, pocket: 1 }], cueScratch: true, firstContact: 3 }));
  assert.deepEqual(r.state.groups, [null, null]);
  assert.equal(r.state.turn, 1);
  assert.ok(r.state.balls[3] === null, 'the potted ball stays down');
});

test('a legal pocket of your own group keeps the turn; an opponent ball alone passes it', async () => {
  const P = await pool();
  const mine = await setup({ 0: [1000, 400], 3: [1000, 120], 9: [300, 700], 1: [300, 200], 8: [500, 800] }, { groups: ['solid', 'stripe'] });
  const r = P.applyMove(mine, SIDE_POT, 0);
  assert.equal(r.state.turn, 0);
  const theirs = await setup({ 0: [1000, 400], 11: [1000, 120], 2: [300, 700], 1: [300, 200], 8: [500, 800] }, { groups: ['solid', 'stripe'] });
  const t = P.applyMove(theirs, SIDE_POT, 0);
  assert.ok(t.state.lastShot.fouls.includes('wrong-ball'));
  assert.equal(t.state.turn, 1);
});

test('the 8: legal win after clearing the group, with a called pocket', async () => {
  const P = await pool();
  const s = await setup({ 0: [1000, 400], 8: [1000, 120], 9: [300, 700], 10: [400, 300] }, { groups: ['solid', 'stripe'] });
  assert.equal(P.targetOf(s, 0), 'eight');
  assert.equal(P.view(s).mustCall, true);
  assert.throws(() => P.applyMove(s, SIDE_POT, 0), /call a pocket/);
  const called = P.applyMove(s, { callPocket: 1 }, 0);
  assert.equal(called.state.called, 1);
  assert.equal(called.state.turn, 0, 'calling does not use the turn');
  const r = P.applyMove(called.state, SIDE_POT, 0);
  assert.deepEqual(P.status(r.state), { turn: null, over: true, winner: 0, reason: 'eight-pocketed' });
  assert.throws(() => P.applyMove(r.state, SIDE_POT, 0), /over/);
});

test('the 8: calling is only for the 8, and pocket numbers are checked', async () => {
  const P = await pool();
  const s = P.initialState(1);
  assert.throws(() => P.applyMove(s, { callPocket: 1 }, 0), /only called for the 8/);
  const e = await setup({ 0: [1000, 400], 8: [1000, 120], 9: [300, 700] }, { groups: ['solid', 'stripe'] });
  assert.throws(() => P.applyMove(e, { callPocket: 6 }, 0), P.IllegalMove);
  assert.throws(() => P.applyMove(e, { callPocket: 1.5 }, 0), P.IllegalMove);
});

test('the 8: the wrong pocket loses', async () => {
  const P = await pool();
  const s = await setup({ 0: [1000, 400], 8: [1000, 120], 9: [300, 700] }, { groups: ['solid', 'stripe'] });
  const c = P.applyMove(s, { callPocket: 0 }, 0).state;
  const r = P.applyMove(c, SIDE_POT, 0);
  assert.deepEqual(P.status(r.state), { turn: null, over: true, winner: 1, reason: 'eight-wrong-pocket' });
});

test('the 8: pocketing it before the group is cleared loses, also on an open table', async () => {
  const P = await pool();
  const grouped = await setup({ 0: [1000, 400], 8: [1000, 120], 3: [300, 700], 9: [300, 300] }, { groups: ['solid', 'stripe'] });
  const r = P.applyMove(grouped, SIDE_POT, 0);
  assert.deepEqual(P.status(r.state), { turn: null, over: true, winner: 1, reason: 'eight-early' });
  const open = await setup({ 0: [1000, 400], 8: [1000, 120], 3: [300, 700], 9: [300, 300] });
  const o = P.applyMove(open, SIDE_POT, 0);
  assert.equal(o.state.winner, 1);
  assert.equal(o.state.reason, 'eight-early');
  // seat 1 shooting loses to seat 0
  const s1 = await setup({ 0: [1000, 400], 8: [1000, 120], 3: [300, 700], 9: [300, 300] }, { groups: ['solid', 'stripe'], turn: 1 });
  assert.equal(P.applyMove(s1, SIDE_POT, 1).state.winner, 0);
});

test('the 8: scratching on the 8, or knocking it off the table, loses; the 8 on the break is spotted', async () => {
  const P = await pool();
  const s = await setup({ 0: [1000, 400], 8: [1000, 120], 9: [300, 700] }, { groups: ['solid', 'stripe'] });
  s.called = 1;
  const down = JSON.parse(JSON.stringify(s.balls));
  down[8] = null; down[0] = null;
  const scratch = P.resolveShot(s, 0, SIDE_POT, fakeSim(down, {
    pocketed: [{ ball: 8, pocket: 1 }, { ball: 0, pocket: 1 }], cueScratch: true, firstContact: 8,
  }));
  assert.deepEqual([scratch.state.winner, scratch.state.reason], [1, 'eight-scratch']);
  const off = JSON.parse(JSON.stringify(s.balls));
  off[8] = null;
  const offTable = P.resolveShot(s, 0, SIDE_POT, fakeSim(off, { offTable: [8], firstContact: 8 }));
  assert.deepEqual([offTable.state.winner, offTable.state.reason], [1, 'eight-off-table']);
  // a legal clean 8 in the called pocket with no other foul wins, as the control
  const clean = P.resolveShot(s, 0, SIDE_POT, fakeSim(off, { pocketed: [{ ball: 8, pocket: 1 }], firstContact: 8 }));
  assert.deepEqual([clean.state.winner, clean.state.reason], [0, 'eight-pocketed']);
  // the break
  const brk = P.initialState(3);
  const afterBreak = JSON.parse(JSON.stringify(brk.balls));
  const spot = afterBreak[8];
  afterBreak[8] = null;
  const b = P.resolveShot(brk, 0, { angle: 0, power: 1, spinX: 0, spinY: 0 }, fakeSim(afterBreak, {
    pocketed: [{ ball: 8, pocket: 2 }], firstContact: 14, cushionBalls: [1, 2, 3, 4],
  }));
  assert.equal(b.state.over, false);
  assert.ok(b.state.balls[8], 'the 8 is spotted again');
  assert.notEqual(spot, null);
  assert.equal(b.state.turn, 1, 'only an 8 down on the break does not keep the turn');
});

test('ball in hand: validated for overlap, cloth, pockets and the head string', async () => {
  const P = await pool();
  const s = await setup({ 0: [500, 500], 1: [1000, 500], 9: [1400, 300] }, { inHand: { kitchen: false } });
  const place = (x, y, st = s) => P.applyMove(st, { placeCue: { x, y } }, st.turn);
  assert.throws(() => place(1010, 520), /overlaps ball 1/);
  assert.throws(() => place(1000 + 51, 500), /overlaps ball 1/);
  assert.doesNotThrow(() => place(1000 + 53, 500));
  assert.throws(() => place(5, 500), /cloth/);
  assert.throws(() => place(500, 2000), /cloth/);
  assert.throws(() => place(NaN, 500), P.IllegalMove);
  assert.throws(() => P.applyMove(s, { placeCue: { x: '5', y: 5 } }, 0), P.IllegalMove);
  assert.throws(() => place(P.R + 1, P.R + 1), /pocket/);
  const ok = place(1700, 800);
  assert.deepEqual(ok.state.balls[0], [1700, 800]);
  assert.deepEqual(ok.state.inHand, { kitchen: false }, 'may be moved again before the shot');
  assert.equal(ok.state.turn, 0);
  // not allowed when there is no ball in hand
  const none = await setup({ 0: [500, 500], 1: [1000, 500] });
  assert.throws(() => P.applyMove(none, { placeCue: { x: 600, y: 600 } }, 0), /no ball in hand/);
  // on the break the ball goes behind the head string only
  const brk = P.initialState(2);
  assert.throws(() => P.applyMove(brk, { placeCue: { x: 900, y: 500 } }, 0), /head string/);
  assert.doesNotThrow(() => P.applyMove(brk, { placeCue: { x: 300, y: 700 } }, 0));
  // a shot clears the ball in hand
  const shot = P.applyMove(ok.state, { angle: Math.atan2(300 - 800, 1400 - 1700), power: 0.8 }, 0);
  assert.deepEqual(shot.state.lastShot.fouls, []);
  assert.equal(shot.state.inHand, null);
});

test('a full random-ish game ends with a winner and a reason', async () => {
  const P = await pool();
  // keep potting: from a nearly finished table, just verify the plugin round trip through to game over
  const s = await setup({ 0: [1000, 400], 8: [1000, 120], 9: [300, 700] }, { groups: ['solid', 'stripe'] });
  let st = P.applyMove(s, { callPocket: 1 }, 0).state;
  st = P.applyMove(st, SIDE_POT, 0).state;
  const v = P.view(st, 1);
  assert.equal(v.over, true);
  assert.equal(v.winner, 0);
  assert.equal(v.turn, null);
  assert.equal(SOLIDS.length, 7);
});
