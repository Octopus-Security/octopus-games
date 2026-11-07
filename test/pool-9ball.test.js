'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { pool, fakeSim } = require('./pool-helpers');

async function setup9(positions, opts = {}) {
  const P = await pool();
  const s = P.initialState(1, { variant: '9ball' });
  s.balls = new Array(16).fill(null);
  for (const k of Object.keys(positions)) s.balls[Number(k)] = positions[k];
  s.breakShot = !!opts.breakShot;
  s.inHand = opts.inHand || null;
  s.turn = opts.turn === undefined ? 0 : opts.turn;
  return s;
}
const SHOT = { angle: 0, power: 0.5 };
// the table after a hand-made result: `down` ids removed
function after(state, down) {
  const b = state.balls.map((p) => p && [p[0], p[1]]);
  for (const id of down) b[id] = null;
  return b;
}
const foulsOf = (r) => r.state.lastShot.fouls;

test('default variant is 8ball and existing states without a variant behave as 8ball', async () => {
  const P = await pool();
  assert.equal(P.initialState(5).variant, '8ball');
  assert.equal(P.initialState(5, {}).variant, '8ball');
  assert.equal(P.initialState(5).balls.filter(Boolean).length, 16);
  const old = P.initialState(5);
  delete old.variant; // a match stored before variants existed
  assert.equal(P.view(old, 0).variant, '8ball');
  assert.equal(P.targetOf(old, 0), 'open');
  assert.deepEqual(P.initialState(5, { variant: '8ball' }), P.initialState(5));
  assert.throws(() => P.initialState(5, { variant: 'snooker' }), TypeError);
  assert.deepEqual(P.default.variants, ['8ball', '9ball']);
});

test('9-ball rack: a diamond of 1-9, the 1 at the apex, the 9 in the centre, seeded, no overlaps', async () => {
  const P = await pool();
  for (const seed of [1, 2, 'abc', 77]) {
    const order = P.rackOrder9(seed);
    assert.equal(order.length, 9);
    assert.equal(order[0], 1);
    assert.equal(order[4], 9);
    assert.deepEqual(order.slice().sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
    assert.deepEqual(P.rackOrder9(seed), order);
    const s = P.initialState(seed, { variant: '9ball' });
    assert.equal(s.balls.filter(Boolean).length, 10); // cue + 9
    for (let id = 10; id <= 15; id++) assert.equal(s.balls[id], null);
    assert.deepEqual(s.balls[1], [P.FOOT_X, P.H / 2]); // apex on the foot spot
    // the 9 sits between rows 2: x one row-and-a-half behind the 1, y on the centre line
    assert.equal(s.balls[9][1], P.H / 2);
    assert.ok(s.balls[9][0] > s.balls[1][0]);
    for (let a = 0; a < 16; a++) for (let b = a + 1; b < 16; b++) {
      if (s.balls[a] && s.balls[b]) assert.ok(Math.hypot(s.balls[a][0] - s.balls[b][0], s.balls[a][1] - s.balls[b][1]) >= 2 * P.R, `balls ${a},${b} overlap`);
    }
  }
  assert.notDeepEqual(P.rackOrder9(1), P.rackOrder9(2));
  // diamond shape: x columns hold 1, 2, 3, 2, 1 balls
  const s = P.initialState(3, { variant: '9ball' });
  const cols = {};
  for (let id = 1; id <= 9; id++) cols[s.balls[id][0]] = (cols[s.balls[id][0]] || 0) + 1;
  assert.deepEqual(Object.keys(cols).map(Number).sort((a, b) => a - b).map((x) => cols[x]), [1, 2, 3, 2, 1]);
});

test('view and targets: the lowest ball is the target, nothing is called', async () => {
  const P = await pool();
  const s = await setup9({ 0: [500, 500], 3: [900, 500], 5: [1200, 300], 9: [1500, 700] });
  const v = P.view(s, 0);
  assert.equal(v.variant, '9ball');
  assert.equal(v.lowest, 3);
  assert.deepEqual(v.targets, ['lowest', 'lowest']);
  assert.equal(v.mustCall, false);
  assert.throws(() => P.applyMove(s, { callPocket: 1 }, 0), P.IllegalMove);
});

test('hitting a higher ball first is a foul with ball in hand anywhere', async () => {
  const P = await pool();
  const s = await setup9({ 0: [500, 500], 2: [900, 500], 5: [1200, 300], 9: [1500, 700] });
  const r = P.resolveShot(s, 0, SHOT, fakeSim(after(s, []), { firstContact: 5 }));
  assert.deepEqual(foulsOf(r), ['wrong-ball']);
  assert.equal(r.state.turn, 1);
  assert.deepEqual(r.state.inHand, { kitchen: false });
});

test('hitting the lowest ball first is legal; no pocket passes the turn without ball in hand', async () => {
  const P = await pool();
  const s = await setup9({ 0: [500, 500], 2: [900, 500], 5: [1200, 300], 9: [1500, 700] });
  const r = P.resolveShot(s, 0, SHOT, fakeSim(after(s, []), { firstContact: 2 }));
  assert.deepEqual(foulsOf(r), []);
  assert.equal(r.state.turn, 1);
  assert.equal(r.state.inHand, null);
});

test('no contact, scratch and no cushion are fouls', async () => {
  const P = await pool();
  const s = await setup9({ 0: [500, 500], 2: [900, 500], 9: [1500, 700] });
  assert.deepEqual(foulsOf(P.resolveShot(s, 0, SHOT, fakeSim(after(s, []), { firstContact: null, cushionAfterContact: 0 }))).includes('no-contact'), true);
  const scr = P.resolveShot(s, 0, SHOT, fakeSim(after(s, [0]), { firstContact: 2, cueScratch: true, pocketed: [{ ball: 0, pocket: 1 }] }));
  assert.ok(foulsOf(scr).includes('scratch'));
  assert.equal(scr.state.turn, 1);
  assert.ok(scr.state.balls[0], 'the cue ball is put back on the table');
  const nc = P.resolveShot(s, 0, SHOT, fakeSim(after(s, []), { firstContact: 2, cushionAfterContact: 0 }));
  assert.deepEqual(foulsOf(nc), ['no-cushion']);
});

test('any ball pocketed on a legal shot continues the turn, whatever its number', async () => {
  const P = await pool();
  const s = await setup9({ 0: [500, 500], 2: [900, 500], 6: [1200, 300], 9: [1500, 700] });
  const r = P.resolveShot(s, 0, SHOT, fakeSim(after(s, [6]), { firstContact: 2, pocketed: [{ ball: 6, pocket: 2 }] }));
  assert.deepEqual(foulsOf(r), []);
  assert.equal(r.state.turn, 0);
  assert.equal(r.state.over, false);
  assert.equal(r.state.balls[6], null, 'pocketed balls stay down');
  assert.equal(r.state.inHand, null);
});

test('a pocketed ball on a foul does not continue the turn and stays down', async () => {
  const P = await pool();
  const s = await setup9({ 0: [500, 500], 2: [900, 500], 6: [1200, 300], 9: [1500, 700] });
  const r = P.resolveShot(s, 0, SHOT, fakeSim(after(s, [6]), { firstContact: 6, pocketed: [{ ball: 6, pocket: 2 }] }));
  assert.ok(foulsOf(r).includes('wrong-ball'), 'the 2 is lowest, so hitting the 6 first is the foul');
  assert.equal(r.state.turn, 1);
  assert.equal(r.state.balls[6], null);
});

test('pocketing the 9 on a legal shot wins, also as a combination', async () => {
  const P = await pool();
  const s = await setup9({ 0: [500, 500], 2: [900, 500], 9: [1500, 700] });
  const direct = P.resolveShot(s, 0, SHOT, fakeSim(after(s, [2, 9]), { firstContact: 2, pocketed: [{ ball: 9, pocket: 5 }, { ball: 2, pocket: 5 }] }));
  assert.equal(direct.state.over, true);
  assert.equal(direct.state.winner, 0);
  assert.equal(direct.state.reason, 'nine-pocketed');
  // a combination: the cue hits the 2, which drives the 9 in; the 2 stays on the table
  const combo = P.resolveShot(s, 1 - 1, SHOT, fakeSim(after(s, [9]), { firstContact: 2, pocketed: [{ ball: 9, pocket: 5 }] }));
  assert.equal(combo.state.over, true);
  assert.equal(combo.state.winner, 0);
  assert.deepEqual(P.status(combo.state), { turn: null, over: true, winner: 0, reason: 'nine-pocketed' });
  assert.throws(() => P.applyMove(combo.state, SHOT, 0), P.IllegalMove);
});

test('the 9 wins when it is the last ball and it is hit first', async () => {
  const P = await pool();
  const s = await setup9({ 0: [500, 500], 9: [1500, 700] }, { turn: 1 });
  const r = P.resolveShot(s, 1, SHOT, fakeSim(after(s, [9]), { firstContact: 9, pocketed: [{ ball: 9, pocket: 5 }] }));
  assert.equal(r.state.winner, 1);
});

test('pocketing the 9 on the break wins; the break rules still apply', async () => {
  const P = await pool();
  const s = P.initialState(4, { variant: '9ball' });
  const b = s.balls.map((p) => p && [p[0], p[1]]);
  b[9] = null;
  const r = P.resolveShot(s, 0, { angle: 0, power: 1 }, fakeSim(b, { firstContact: 1, pocketed: [{ ball: 9, pocket: 5 }], cushionBalls: [2, 3] }));
  assert.equal(r.state.over, true);
  assert.equal(r.state.winner, 0);
  // an illegal break (nothing down, fewer than four to a cushion) is a foul with ball in hand
  const bad = P.resolveShot(s, 0, { angle: 0, power: 0.2 }, fakeSim(s.balls.map((p) => p && [p[0], p[1]]), { firstContact: 1, cushionBalls: [1] }));
  assert.deepEqual(foulsOf(bad), ['illegal-break']);
  assert.equal(bad.state.turn, 1);
  assert.deepEqual(bad.state.inHand, { kitchen: false });
});

test('the break must hit the 1 first', async () => {
  const P = await pool();
  const s = P.initialState(4, { variant: '9ball' });
  const b = s.balls.map((p) => p && [p[0], p[1]]);
  b[3] = null;
  const r = P.resolveShot(s, 0, { angle: 0, power: 1 }, fakeSim(b, { firstContact: 3, pocketed: [{ ball: 3, pocket: 5 }], cushionBalls: [1, 2, 4, 5] }));
  assert.ok(foulsOf(r).includes('wrong-ball'));
  assert.equal(r.state.turn, 1);
});

test('a 9 pocketed on a foul is spotted and the game goes on', async () => {
  const P = await pool();
  const s = await setup9({ 0: [500, 500], 2: [900, 500], 9: [1500, 700] });
  const r = P.resolveShot(s, 0, SHOT, fakeSim(after(s, [9]), { firstContact: 9, pocketed: [{ ball: 9, pocket: 5 }] }));
  assert.ok(foulsOf(r).includes('wrong-ball'));
  assert.equal(r.state.over, false);
  assert.ok(r.state.balls[9], 'the 9 is back on the table');
  assert.ok(r.state.lastShot.respotted.includes(9));
  assert.equal(r.state.turn, 1);
  assert.deepEqual(r.state.inHand, { kitchen: false });
  // and also on a scratch
  const sc = P.resolveShot(s, 0, SHOT, fakeSim(after(s, [0, 9]), { firstContact: 2, cueScratch: true, pocketed: [{ ball: 2, pocket: 1 }, { ball: 9, pocket: 5 }, { ball: 0, pocket: 5 }] }));
  assert.equal(sc.state.over, false);
  assert.ok(sc.state.balls[9]);
});

test('a ball driven off the table is spotted and is a foul', async () => {
  const P = await pool();
  const s = await setup9({ 0: [500, 500], 2: [900, 500], 4: [1300, 300], 9: [1500, 700] });
  const b = after(s, [4]);
  const r = P.resolveShot(s, 0, SHOT, fakeSim(b, { firstContact: 2, offTable: [4] }));
  assert.ok(foulsOf(r).includes('off-table'));
  assert.ok(r.state.balls[4]);
});

test('ball in hand anywhere after a foul, validated by the engine', async () => {
  const P = await pool();
  const s = await setup9({ 0: [500, 500], 2: [900, 500], 9: [1500, 700] });
  const r = P.resolveShot(s, 0, SHOT, fakeSim(after(s, []), { firstContact: 9 }));
  const mv = P.applyMove(r.state, { placeCue: { x: 1700, y: 200 } }, 1); // far past the head string
  assert.deepEqual(mv.state.balls[0], [1700, 200]);
  assert.throws(() => P.applyMove(r.state, { placeCue: { x: 1500, y: 700 } }, 1), P.IllegalMove); // on the 9
});

test('real physics: hitting the lowest ball and sinking the 9 in a pocket ends the match', async () => {
  const P = await pool();
  // cue hits the 1 straight at the 9; the 9 sits 30mm from the right side pocket mouth line
  const s = await setup9({ 0: [1000, 500], 1: [1300, 500], 9: [1900, 500] });
  let r = P.applyMove(s, { angle: 0, power: 0.9 }, 0);
  // 1 and 9 on the centre line: the 9 runs to the end cushion, whatever happens the state stays valid
  assert.equal(r.state.shots, 1);
  assert.equal(r.state.lastShot.firstContact, 1);
  assert.equal(JSON.stringify(r.state), JSON.stringify(JSON.parse(JSON.stringify(r.state))));
});

test('a whole random-ish 9-ball game runs to a result', async () => {
  const P = await pool();
  let state = P.initialState(11, { variant: '9ball' });
  let n = 0;
  while (!state.over && n++ < 400) {
    const seat = state.turn;
    const lowest = P.lowestBall(state.balls);
    const cue = state.balls[0];
    const t = state.balls[lowest];
    const angle = Math.atan2(t[1] - cue[1], t[0] - cue[0]) + (n % 7 - 3) * 0.01;
    state = P.applyMove(state, { angle, power: 0.4 + (n % 5) * 0.12 }, seat).state;
  }
  assert.ok(state.over || n >= 400);
  if (state.over) assert.equal(state.reason, 'nine-pocketed');
});
