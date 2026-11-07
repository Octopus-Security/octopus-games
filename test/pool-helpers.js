// Shared helpers for the pool tests. Not a test file (no .test.js suffix).
'use strict';

let mod;
async function pool() {
  if (!mod) mod = await import('../shared/pool/index.js');
  return mod;
}

function rng(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Build a mid-game state with chosen ball positions: { 0: [x, y], 3: [x, y], ... }. */
async function setup(positions, opts = {}) {
  const P = await pool();
  const s = P.initialState(1);
  s.balls = new Array(16).fill(null);
  for (const k of Object.keys(positions)) s.balls[Number(k)] = positions[k];
  s.breakShot = !!opts.breakShot;
  s.inHand = opts.inHand || null;
  s.groups = opts.groups || [null, null];
  s.turn = opts.turn === undefined ? 0 : opts.turn;
  return s;
}

/** A hand-made simulation result for resolveShot. */
function fakeSim(balls, summary) {
  return {
    finalState: { balls },
    frames: [],
    frameDt: 1 / 30,
    events: [],
    summary: Object.assign({
      firstContact: 1, pocketed: [], offTable: [], cueScratch: false,
      cushionAfterContact: 1, cushionBalls: [], seconds: 1, timedOut: false,
    }, summary),
  };
}

module.exports = { pool, rng, setup, fakeSim };
