// 8-ball rules on top of physics.js. Pure and deterministic. Every departure
// from a full rulebook is listed in RULES.md.

import {
  H, R, HEAD_X, FOOT_X, simulateShot, normaliseShot, cuePlacementProblem, nearestFreeSpot,
} from './physics.js';

export class IllegalMove extends Error {
  constructor(message) {
    super(message);
    this.name = 'IllegalMove';
    this.code = 'ILLEGAL_MOVE';
  }
}

const q3 = (v) => {
  const r = Math.round(v * 1000) / 1000;
  return r === 0 ? 0 : r;
};
const clone = (o) => JSON.parse(JSON.stringify(o));

export function groupOf(id) {
  if (id >= 1 && id <= 7) return 'solid';
  if (id >= 9 && id <= 15) return 'stripe';
  if (id === 8) return 'eight';
  return 'cue';
}
const GROUP_IDS = {
  solid: [1, 2, 3, 4, 5, 6, 7],
  stripe: [9, 10, 11, 12, 13, 14, 15],
};

// ---------------------------------------------------------------- seeding

function hashSeed(seed) {
  if (typeof seed === 'number' && Number.isFinite(seed)) return Math.floor(seed) >>> 0;
  const str = String(seed);
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(a) {
  return function next() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(arr, rnd) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
  }
  return arr;
}

// Rack slots, row-major: row r holds r + 1 balls. Slot 0 is the apex on the foot
// spot, slot 4 the centre of the third row (the 8), slots 10 and 14 the back corners.
function rackPositions() {
  const out = [];
  const dx = Math.sqrt(3) * R + 0.01;
  const dy = 2 * R + 0.02;
  for (let r = 0; r < 5; r++) {
    for (let c = 0; c <= r; c++) {
      out.push([q3(FOOT_X + r * dx), q3(H / 2 + (c - r / 2) * dy)]);
    }
  }
  return out;
}

export function rackOrder(seed) {
  const rnd = mulberry32(hashSeed(seed));
  const solids = shuffle(GROUP_IDS.solid.slice(), rnd);
  const stripes = shuffle(GROUP_IDS.stripe.slice(), rnd);
  const solidInLeftCorner = rnd() < 0.5;
  const slots = new Array(15).fill(0);
  slots[4] = 8;
  slots[10] = solidInLeftCorner ? solids.pop() : stripes.pop();
  slots[14] = solidInLeftCorner ? stripes.pop() : solids.pop();
  const rest = shuffle(solids.concat(stripes), rnd);
  for (let s = 0; s < 15; s++) if (slots[s] === 0) slots[s] = rest.pop();
  return slots;
}

export function initialState(seed) {
  const slots = rackOrder(seed === undefined ? 0 : seed);
  const pos = rackPositions();
  const balls = new Array(16).fill(null);
  balls[0] = [q3(HEAD_X), q3(H / 2)];
  for (let s = 0; s < 15; s++) balls[slots[s]] = pos[s];
  return {
    type: 'pool',
    v: 1,
    seed: typeof seed === 'number' ? seed : String(seed === undefined ? 0 : seed),
    balls,
    turn: 0,
    groups: [null, null], // 'solid' | 'stripe' per seat once decided
    breakShot: true,
    inHand: { kitchen: true }, // the break: cue ball may be moved behind the head string
    called: null, // pocket index called for the 8
    over: false,
    winner: null,
    reason: null,
    shots: 0,
    lastShot: null,
  };
}

// ---------------------------------------------------------------- queries

/** 'open' | 'solid' | 'stripe' | 'eight' | null (game over) */
export function targetOf(state, seat) {
  if (state.over) return null;
  const g = state.groups[seat];
  if (g === null) return 'open';
  const left = GROUP_IDS[g].some((id) => state.balls[id]);
  return left ? g : 'eight';
}

export function status(state) {
  return {
    turn: state.over ? null : state.turn,
    over: !!state.over,
    winner: state.over ? state.winner : null,
    reason: state.over ? state.reason : null,
  };
}

export function view(state, seat) {
  const s = clone(state);
  const turnTarget = targetOf(state, state.turn);
  return {
    type: 'pool',
    you: seat === undefined ? null : seat,
    turn: s.over ? null : s.turn,
    over: s.over,
    winner: s.winner,
    reason: s.reason,
    balls: s.balls,
    groups: s.groups,
    targets: [targetOf(state, 0), targetOf(state, 1)],
    inHand: s.over ? null : s.inHand,
    breakShot: s.breakShot,
    called: s.called,
    mustCall: !s.over && turnTarget === 'eight' && s.called === null,
    shots: s.shots,
    lastShot: s.lastShot,
  };
}

// ---------------------------------------------------------------- moves

function respot(balls, id) {
  const [x, y] = nearestFreeSpot(balls, FOOT_X, H / 2, false, id);
  balls[id] = [x, y];
  return [x, y];
}

export function applyMove(state, move, seat) {
  if (!state || state.type !== 'pool') throw new IllegalMove('not a pool state');
  if (state.over) throw new IllegalMove('the game is over');
  if (seat !== 0 && seat !== 1) throw new IllegalMove('bad seat');
  if (seat !== state.turn) throw new IllegalMove('not your turn');
  if (!move || typeof move !== 'object' || Array.isArray(move)) throw new IllegalMove('move must be an object');

  const isPlace = 'placeCue' in move;
  const isCall = 'callPocket' in move;
  const isShot = 'angle' in move || 'power' in move;
  if (isPlace + isCall + isShot !== 1) {
    throw new IllegalMove('a move is exactly one of { placeCue }, { callPocket } or a shot { angle, power }');
  }

  const next = clone(state);

  if (isPlace) {
    if (!state.inHand) throw new IllegalMove('no ball in hand');
    const pc = move.placeCue;
    if (!pc || typeof pc !== 'object') throw new IllegalMove('placeCue needs { x, y }');
    if (typeof pc.x !== 'number' || typeof pc.y !== 'number') throw new IllegalMove('placeCue needs numeric x and y');
    const x = q3(pc.x), y = q3(pc.y);
    const problem = cuePlacementProblem(next.balls, x, y, !!state.inHand.kitchen);
    if (problem) throw new IllegalMove(problem);
    next.balls[0] = [x, y];
    return { state: next, events: [{ type: 'place', seat, x, y }] };
  }

  if (isCall) {
    const p = move.callPocket;
    if (!Number.isInteger(p) || p < 0 || p > 5) throw new IllegalMove('callPocket must be a pocket number 0-5');
    if (targetOf(state, seat) !== 'eight') throw new IllegalMove('a pocket is only called for the 8 ball');
    next.called = p;
    return { state: next, events: [{ type: 'call', seat, pocket: p }] };
  }

  // ---- a shot
  const shot = normaliseShot(move);
  if (!shot) throw new IllegalMove('bad shot: angle (number), power (0 to 1) and optional spinY (-1 to 1) required');
  const target = targetOf(state, seat);
  if (target === 'eight' && state.called === null) throw new IllegalMove('call a pocket for the 8 first');
  if (!state.balls[0]) throw new IllegalMove('no cue ball on the table');

  const sim = simulateShot({ balls: state.balls }, shot);
  return resolveShot(state, seat, shot, sim);
}

/**
 * Keep only the balls that moved. tracks[b] is null for a ball that never moved
 * (it is where the state says it is), else 2 * frameCount integers x0,y0,x1,y1,...
 * in mm with -1,-1 once off the table.
 */
export function compactTracks(frames) {
  const n = frames.length;
  const tracks = [];
  for (let b = 0; b < 16; b++) {
    let moved = false;
    for (let f = 1; f < n && !moved; f++) {
      moved = frames[f][2 * b] !== frames[0][2 * b] || frames[f][2 * b + 1] !== frames[0][2 * b + 1];
    }
    if (!moved) { tracks.push(null); continue; }
    const t = new Array(2 * n);
    for (let f = 0; f < n; f++) { t[2 * f] = frames[f][2 * b]; t[2 * f + 1] = frames[f][2 * b + 1]; }
    tracks.push(t);
  }
  return { frameCount: n, tracks };
}

/**
 * Apply the rules to a finished simulation. Exported so tests can feed it hand-made
 * results (for example a ball off the table, which the physics all but prevents).
 */
export function resolveShot(state, seat, shot, sim) {
  const opp = 1 - seat;
  const sum = sim.summary;
  const next = clone(state);
  next.balls = clone(sim.finalState.balls);
  const balls = next.balls;
  const target = targetOf(state, seat);
  const events = [{ type: 'shot', seat, shot }].concat(clone(sim.events));

  const fouls = [];
  const foul = (reason) => { if (fouls.indexOf(reason) < 0) fouls.push(reason); };

  const pocketedIds = sum.pocketed.map((p) => p.ball);
  const eightPocket = sum.pocketed.find((p) => p.ball === 8);
  const eightGone = !!eightPocket || sum.offTable.indexOf(8) >= 0;
  let objectsDown = pocketedIds.filter((id) => id !== 0); // ordered, 8 included

  if (sum.cueScratch) foul('scratch');
  if (sum.firstContact === null) foul('no-contact');
  if (!state.breakShot && sum.firstContact !== null) {
    const fc = sum.firstContact;
    let legal;
    if (target === 'open') legal = fc !== 8;
    else if (target === 'eight') legal = fc === 8;
    else legal = groupOf(fc) === target;
    if (!legal) foul('wrong-ball');
  }
  if (!state.breakShot && sum.firstContact !== null && objectsDown.length === 0 &&
      sum.offTable.filter((id) => id !== 0).length === 0 && sum.cushionAfterContact === 0) {
    foul('no-cushion');
  }
  if (state.breakShot && !(objectsDown.length > 0 || sum.cushionBalls.length >= 4)) foul('illegal-break');
  const offObjects = sum.offTable.filter((id) => id !== 0);
  if (offObjects.length) foul('off-table');

  let over = false, winner = null, reason = null;
  const respotted = [];

  if (eightGone && state.breakShot) {
    // the 8 on the break is spotted again, nobody wins or loses
    objectsDown = objectsDown.filter((id) => id !== 8);
    respotted.push(8);
  } else if (eightGone) {
    let lose = null;
    if (target !== 'eight') lose = 'eight-early';
    else if (sum.offTable.indexOf(8) >= 0) lose = 'eight-off-table';
    else if (sum.cueScratch) lose = 'eight-scratch';
    else if (fouls.length) lose = 'eight-foul';
    else if (eightPocket.pocket !== state.called) lose = 'eight-wrong-pocket';
    over = true;
    winner = lose ? opp : seat;
    reason = lose || 'eight-pocketed';
  }

  for (const id of offObjects) if (respotted.indexOf(id) < 0 && (id !== 8 || !over)) respotted.push(id);

  if (!over) {
    for (const id of respotted.slice().sort((a, b) => a - b)) {
      const [x, y] = respot(balls, id);
      events.push({ type: 'respot', ball: id, x, y });
    }
  }
  for (const f of fouls) events.push({ type: 'foul', seat, reason: f });

  const fouled = fouls.length > 0;
  let again = false;
  if (!over) {
    if (sum.cueScratch) {
      const [x, y] = nearestFreeSpot(balls, HEAD_X, H / 2, false, 0);
      balls[0] = [x, y];
    }
    if (!fouled && !state.breakShot && next.groups[seat] === null) {
      const first = objectsDown.find((id) => id !== 8);
      if (first !== undefined) {
        next.groups[seat] = groupOf(first);
        next.groups[opp] = next.groups[seat] === 'solid' ? 'stripe' : 'solid';
        events.push({ type: 'groups', seat, group: next.groups[seat], opponent: next.groups[opp] });
      }
    }
    if (!fouled) {
      if (state.breakShot) again = objectsDown.length > 0;
      else again = objectsDown.some((id) => groupOf(id) === next.groups[seat]);
    }
  }

  next.over = over;
  next.winner = over ? winner : null;
  next.reason = over ? reason : null;
  next.called = null;
  next.breakShot = false;
  next.shots = state.shots + 1;
  if (over) {
    next.inHand = null;
    next.turn = seat;
    events.push({ type: 'gameOver', winner, reason });
  } else {
    next.turn = again ? seat : opp;
    next.inHand = fouled ? { kitchen: false } : null;
    events.push({ type: 'turn', seat: next.turn, inHand: !!next.inHand });
  }
  next.lastShot = {
    seat,
    shot,
    ...compactTracks(sim.frames),
    frameDt: sim.frameDt,
    events: clone(sim.events),
    firstContact: sum.firstContact,
    pocketed: pocketedIds,
    fouls,
    respotted,
  };
  return { state: next, events };
}
