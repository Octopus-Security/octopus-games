'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { pool, rng } = require('./pool-helpers');

// Play random-but-seeded legal moves; returns every state reached and every shot's sim data.
async function randomGames(shotsWanted, seedBase) {
  const P = await pool();
  const out = [];
  let shots = 0, game = 0;
  while (shots < shotsWanted) {
    const r = rng(seedBase + game);
    let s = P.initialState(seedBase + game);
    game++;
    for (let guard = 0; guard < 60 && !s.over && shots < shotsWanted; guard++) {
      if (s.inHand && r() < 0.5) {
        for (let tries = 0; tries < 30; tries++) {
          const x = 60 + r() * (s.inHand.kitchen ? 480 : 1880), y = 60 + r() * 880;
          if (!P.cuePlacementProblem(s.balls, x, y, s.inHand.kitchen)) {
            s = P.applyMove(s, { placeCue: { x, y } }, s.turn).state;
            break;
          }
        }
      }
      if (P.view(s).mustCall) s = P.applyMove(s, { callPocket: Math.floor(r() * 6) }, s.turn).state;
      const move = { angle: (r() * 2 - 1) * Math.PI, power: 0.05 + r() * 0.95, spinY: r() * 2 - 1 };
      const res = P.applyMove(s, move, s.turn);
      out.push({ before: s, move, after: res.state, events: res.events });
      s = res.state;
      shots++;
    }
  }
  return out;
}

test('same seed and shots give byte-identical results, also after JSON round trips', async () => {
  const P = await pool();
  const run = async (roundTrip) => {
    const r = rng(99);
    let s = P.initialState('determinism');
    const log = [];
    for (let i = 0; i < 12 && !s.over; i++) {
      if (s.inHand && !s.breakShot) {
        const sp = P.nearestFreeSpot(s.balls, 400, 500, false);
        s = P.applyMove(s, { placeCue: { x: sp[0], y: sp[1] } }, s.turn).state;
      }
      if (P.view(s).mustCall) s = P.applyMove(s, { callPocket: 2 }, s.turn).state;
      const res = P.applyMove(s, { angle: r() * 6 - 3, power: 0.3 + r() * 0.7, spinY: r() - 0.5 }, s.turn);
      log.push(JSON.stringify(res));
      s = roundTrip ? JSON.parse(JSON.stringify(res.state)) : res.state;
    }
    return log.join('\n');
  };
  const a = await run(false), b = await run(false), c = await run(true);
  assert.equal(a, b, 'two runs differ');
  assert.equal(a, c, 'a JSON round trip changed the outcome');
  assert.ok(a.length > 1000);
});

test('physics: same table and shot gives identical frames and events', async () => {
  const P = await pool();
  const s = P.initialState(5);
  const shot = { angle: 0.01, power: 0.9, spinY: 0.3 };
  const x = P.simulateShot({ balls: s.balls }, shot), y = P.simulateShot({ balls: JSON.parse(JSON.stringify(s.balls)) }, shot);
  assert.equal(JSON.stringify(x), JSON.stringify(y));
  assert.ok(x.frames.length <= P.MAX_FRAMES + 1);
  assert.equal(x.frames[0].length, 32);
});

test('1000 seeded shots all terminate within the step cap, with capped output', async () => {
  const P = await pool();
  const games = await randomGames(1000, 1000);
  assert.equal(games.length, 1000);
  let longest = 0;
  for (const g of games) {
    const ls = g.after.lastShot;
    assert.ok(ls.frameCount <= P.MAX_FRAMES + 1, 'frames not capped');
    assert.ok(ls.events.length < 200, 'events not capped');
    longest = Math.max(longest, ls.frameCount);
  }
  assert.ok(longest > 5);
  // and timing out is reported, not hung: a ball can only be moving for MAX_SECONDS
  const t = P.simulateShot({ balls: P.initialState(1).balls }, { angle: 0.3, power: 1, spinY: 1 });
  assert.equal(t.summary.timedOut, false);
  assert.ok(t.summary.seconds <= 40);
});

test('no ball overlaps another, or leaves the cloth, after any resolved shot', async () => {
  const P = await pool();
  const games = await randomGames(300, 5000);
  for (const g of games) {
    const b = g.after.balls;
    for (let i = 0; i < 16; i++) {
      if (!b[i]) continue;
      assert.ok(b[i][0] >= 0 && b[i][0] <= P.W && b[i][1] >= 0 && b[i][1] <= P.H, 'ball ' + i + ' off the cloth');
      for (let j = i + 1; j < 16; j++) {
        if (!b[j]) continue;
        const d = Math.hypot(b[i][0] - b[j][0], b[i][1] - b[j][1]);
        assert.ok(d >= P.D - 1e-9, `balls ${i} and ${j} overlap (${d})`);
      }
    }
    for (let i = 0; i < 16; i++) if (b[i]) assert.ok(b[i][0] >= P.R - 1e-9 || b[i][1] >= 0);
  }
});

test('energy never increases, step after step', async () => {
  const P = await pool();
  const { createWorld, stepWorld, kineticEnergy, allAtRest } = await import('../shared/pool/physics.js');
  const r = rng(77);
  for (let k = 0; k < 24; k++) {
    const s = P.initialState(300 + k);
    const w = createWorld({ balls: s.balls }, { angle: r() * 6.28 - 3.14, power: 0.2 + r() * 0.8, spinY: r() * 2 - 1 });
    let prev = kineticEnergy(w);
    assert.ok(prev > 0);
    for (let i = 0; i < 480 * 12 && !allAtRest(w); i++) {
      stepWorld(w);
      const e = kineticEnergy(w);
      assert.ok(e <= prev * (1 + 1e-12) + 1e-9, `energy rose at step ${i}: ${prev} -> ${e}`);
      prev = e;
    }
  }
});

test('follow runs the cue ball on, draw pulls it back, and a stun shot sits between', async () => {
  const P = await pool();
  const balls = new Array(16).fill(null);
  balls[0] = [700, 500]; balls[1] = [1000, 500];
  const { createWorld, stepWorld } = await import('../shared/pool/physics.js');
  const xAfter = (spinY) => {
    const w = createWorld({ balls }, { angle: 0, power: 0.6, spinY });
    for (let i = 0; i < 480 * 1.0; i++) stepWorld(w);
    return w.b[0].x;
  };
  const draw = xAfter(-1), stun = xAfter(0), follow = xAfter(1);
  assert.ok(draw < stun && stun < follow, `${draw} ${stun} ${follow}`);
  assert.ok(draw < 960, 'draw should come back from the contact point');
});

test('balls can be pocketed in a side and a corner pocket', async () => {
  const P = await pool();
  const side = new Array(16).fill(null);
  side[0] = [1000, 400]; side[3] = [1000, 120]; side[9] = [300, 800];
  const a = P.simulateShot({ balls: side }, { angle: -Math.PI / 2, power: 0.6 });
  assert.deepEqual(a.summary.pocketed.map((p) => p.ball), [3]);
  assert.equal(a.summary.pocketed[0].pocket, 1);
  const corner = new Array(16).fill(null);
  corner[0] = [400, 400]; corner[5] = [200, 200]; corner[9] = [1500, 800];
  const b = P.simulateShot({ balls: corner }, { angle: -3 * Math.PI / 4, power: 0.5 });
  assert.deepEqual(b.summary.pocketed.map((p) => p.ball), [5]);
  assert.equal(b.summary.pocketed[0].pocket, 0);
});

test('aimGuide finds the first ball and the cushion', async () => {
  const P = await pool();
  const balls = new Array(16).fill(null);
  balls[0] = [500, 500]; balls[4] = [1000, 500];
  const g = P.aimGuide(balls, 0);
  assert.equal(g.ball, 4);
  assert.ok(Math.abs(g.point[0] - (1000 - P.D)) < 1e-6);
  const wall = P.aimGuide(balls, Math.PI);
  assert.equal(wall.ball, null);
  assert.ok(Math.abs(wall.point[0] - P.R) < 1e-6);
});
