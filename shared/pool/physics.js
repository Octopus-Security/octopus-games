// 8-ball pool physics. Pure, deterministic, JSON-friendly.
//
// Units: millimetres, seconds. Screen-style axes: +x right, +y down; an angle of
// 0 shoots along +x and PI/2 along +y. The playing area is W x H = 2000 x 1000
// (2:1). Ball ids: 0 cue, 1-7 solids, 8 the eight, 9-15 stripes.
//
// Determinism rules followed here: no Math.random, no Date, no object-key or Set
// iteration (everything walks arrays in index order), and only IEEE-exact
// operations in the integration loop (+ - * / sqrt). Trig is used once per shot to
// turn the quantised angle into a direction.
//
// Ball model: linear velocity v and an angular "surface speed" w (= R * omega,
// same units as v, in the table plane). Rolling without slipping means w == v.
// slip u = v - w. Cloth friction acts on slip while it is non-zero (sliding),
// then on speed (rolling). A cue-ball hit above/below centre sets w != v, which
// is what makes follow and draw work after a collision (the collision changes v
// but not w, so the cloth then drags the ball forward or back).
//
// Side spin (spinX) is accepted but ignored: it needs a third spin axis, cushion
// throw and cue squirt to mean anything, and without those it would be a
// button that does nothing visible. See RULES.md.

export const W = 2000;
export const H = 1000;
export const R = 26;
export const D = 2 * R;

export const HEAD_X = W / 4; // head string; the kitchen is x <= HEAD_X
export const FOOT_X = (3 * W) / 4; // foot spot, apex of the rack

const G = 9810;
const MU_SLIDE = 0.2;
const MU_ROLL = 0.012;
const E_BALL = 0.95;
const E_CUSHION = 0.75;
export const V_MAX = 7000; // mm/s at power 1 (speed = V_MAX * power^2)
const SPIN_GAIN = 1.25; // w = SPIN_GAIN * spinY * v0 (spinY 1 = a hit half a radius above centre)
const SLIP_EPS = 0.5;

const SUBSTEPS_PER_SEC = 480;
const H_SUB = 1 / SUBSTEPS_PER_SEC;
export const MAX_SECONDS = 40;
export const MAX_SUBSTEPS = SUBSTEPS_PER_SEC * MAX_SECONDS;
const FRAME_STRIDE = 8; // 60 frames per second, before down-sampling
export const MAX_FRAMES = 240;
const MAX_CUSHION_EVENTS = 48;
const CUSHION_EVENT_MIN_SPEED = 25;

const CM = 3.2 * R; // corner mouth: knuckle distance from the corner along an edge
const SM = 2.3 * R; // side mouth: knuckle distance from the pocket centre line

// Capture discs. A ball whose centre enters one is pocketed.
export const POCKETS = [
  { x: -12, y: -12, r: 62 }, // 0 top-left
  { x: W / 2, y: -14, r: 36 }, // 1 top-middle
  { x: W + 12, y: -12, r: 62 }, // 2 top-right
  { x: -12, y: H + 12, r: 62 }, // 3 bottom-left
  { x: W / 2, y: H + 14, r: 36 }, // 4 bottom-middle
  { x: W + 12, y: H + 12, r: 62 }, // 5 bottom-right
];

// Jaw tips: points a ball bounces off at the ends of each cushion.
export const KNUCKLES = [
  [CM, 0], [W / 2 - SM, 0], [W / 2 + SM, 0], [W - CM, 0],
  [CM, H], [W / 2 - SM, H], [W / 2 + SM, H], [W - CM, H],
  [0, CM], [0, H - CM], [W, CM], [W, H - CM],
];

const q3 = (v) => {
  const r = Math.round(v * 1000) / 1000;
  return r === 0 ? 0 : r;
};

// ---------------------------------------------------------------- world

function makeWorld(balls) {
  const bs = [];
  for (let i = 0; i < 16; i++) {
    const p = balls[i];
    bs.push({ x: p ? p[0] : 0, y: p ? p[1] : 0, vx: 0, vy: 0, wx: 0, wy: 0, on: !!p });
  }
  return {
    b: bs, step: 0, events: [], cushionEvents: 0, firstContact: null,
    pocketed: [], offTable: [], cushionAfterContact: 0, cushionBalls: [],
  };
}

/** Linear plus rotational kinetic energy (per unit mass, w in surface-speed units). */
export function kineticEnergy(world) {
  let e = 0;
  for (let i = 0; i < 16; i++) {
    const b = world.b[i];
    if (!b.on) continue;
    e += 0.5 * (b.vx * b.vx + b.vy * b.vy) + 0.2 * (b.wx * b.wx + b.wy * b.wy);
  }
  return e;
}

function isMoving(b) {
  return b.vx !== 0 || b.vy !== 0 || b.wx !== 0 || b.wy !== 0;
}

function tNow(world) {
  return q3(world.step * H_SUB);
}

function friction(b) {
  const ux = b.vx - b.wx, uy = b.vy - b.wy;
  const um = Math.sqrt(ux * ux + uy * uy);
  if (um > SLIP_EPS) {
    const a = MU_SLIDE * G * H_SUB;
    if (um > 3.5 * a) {
      const nx = ux / um, ny = uy / um;
      b.vx -= nx * a; b.vy -= ny * a;
      b.wx += 2.5 * nx * a; b.wy += 2.5 * ny * a;
      return;
    }
  }
  // slip is gone (or would vanish this step): merge, conserving angular
  // momentum about the contact point, then roll
  if (um !== 0) {
    const mx = (b.vx + 0.4 * b.wx) / 1.4, my = (b.vy + 0.4 * b.wy) / 1.4;
    b.vx = mx; b.vy = my; b.wx = mx; b.wy = my;
  }
  const s = Math.sqrt(b.vx * b.vx + b.vy * b.vy);
  const ar = MU_ROLL * G * H_SUB;
  if (s <= ar) {
    b.vx = 0; b.vy = 0; b.wx = 0; b.wy = 0;
  } else {
    b.vx -= (b.vx / s) * ar; b.vy -= (b.vy / s) * ar;
    b.wx = b.vx; b.wy = b.vy;
  }
}

function noteCushion(world, i, speed) {
  if (i !== 0 && world.cushionBalls.indexOf(i) < 0) world.cushionBalls.push(i);
  const after = world.firstContact !== null;
  if (after) world.cushionAfterContact++;
  if (speed >= CUSHION_EVENT_MIN_SPEED && world.cushionEvents < MAX_CUSHION_EVENTS) {
    world.cushionEvents++;
    world.events.push({ type: 'cushion', ball: i, t: tNow(world), afterContact: after });
  }
}

// Reflect velocity and spin about unit normal n (pointing from the obstacle to
// the ball). Both normal components scale by -e, so a rolling ball keeps rolling.
function bounce(world, i, b, nx, ny, e) {
  const vn = b.vx * nx + b.vy * ny;
  if (vn >= 0) return;
  const wn = b.wx * nx + b.wy * ny;
  b.vx -= (1 + e) * vn * nx; b.vy -= (1 + e) * vn * ny;
  b.wx -= (1 + e) * wn * nx; b.wy -= (1 + e) * wn * ny;
  noteCushion(world, i, -vn);
}

function pocketBall(world, i, b, pocket) {
  b.on = false;
  b.vx = b.vy = b.wx = b.wy = 0;
  world.pocketed.push({ ball: i, pocket });
  world.events.push({ type: 'pocket', ball: i, pocket, t: tNow(world) });
  if (i === 0) world.events.push({ type: 'scratch', t: tNow(world) });
}

// A straight cushion exists only where the coordinate is outside the pocket mouths.
function inEndWallRange(v) {
  return v >= CM && v <= H - CM;
}
function inSideWallRange(v) {
  return (v >= CM && v <= W / 2 - SM) || (v >= W / 2 + SM && v <= W - CM);
}

function walls(world, i, b) {
  for (let k = 0; k < KNUCKLES.length; k++) {
    const dx = b.x - KNUCKLES[k][0], dy = b.y - KNUCKLES[k][1];
    const d2 = dx * dx + dy * dy;
    if (d2 < R * R) {
      const d = Math.sqrt(d2);
      const nx = d === 0 ? 0 : dx / d, ny = d === 0 ? -1 : dy / d;
      b.x = KNUCKLES[k][0] + nx * R; b.y = KNUCKLES[k][1] + ny * R;
      bounce(world, i, b, nx, ny, E_CUSHION);
    }
  }
  if (inSideWallRange(b.x)) {
    if (b.y < R) { b.y = R; bounce(world, i, b, 0, 1, E_CUSHION); }
    else if (b.y > H - R) { b.y = H - R; bounce(world, i, b, 0, -1, E_CUSHION); }
  }
  if (inEndWallRange(b.y)) {
    if (b.x < R) { b.x = R; bounce(world, i, b, 1, 0, E_CUSHION); }
    else if (b.x > W - R) { b.x = W - R; bounce(world, i, b, -1, 0, E_CUSHION); }
  }
}

function checkPockets(world, i, b) {
  for (let p = 0; p < POCKETS.length; p++) {
    const dx = b.x - POCKETS[p].x, dy = b.y - POCKETS[p].y;
    if (dx * dx + dy * dy < POCKETS[p].r * POCKETS[p].r) { pocketBall(world, i, b, p); return true; }
  }
  // safety net: a ball that somehow leaves the cloth entirely counts as off the table
  if (b.x < -150 || b.x > W + 150 || b.y < -150 || b.y > H + 150) {
    b.on = false; b.vx = b.vy = b.wx = b.wy = 0;
    world.offTable.push(i);
    world.events.push({ type: 'offTable', ball: i, t: tNow(world) });
    return true;
  }
  return false;
}

function collide(world, i, j) {
  const a = world.b[i], b = world.b[j];
  const dx = b.x - a.x, dy = b.y - a.y;
  const d2 = dx * dx + dy * dy;
  if (d2 >= D * D) return;
  const d = Math.sqrt(d2);
  const nx = d === 0 ? 1 : dx / d, ny = d === 0 ? 0 : dy / d;
  const push = (D - d) / 2;
  a.x -= nx * push; a.y -= ny * push;
  b.x += nx * push; b.y += ny * push;
  if (i === 0 && world.firstContact === null) {
    world.firstContact = j;
    world.events.push({ type: 'contact', ball: j, t: tNow(world) });
  }
  const vn = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
  if (vn >= 0) return;
  const imp = (-(1 + E_BALL) * vn) / 2;
  a.vx -= imp * nx; a.vy -= imp * ny;
  b.vx += imp * nx; b.vy += imp * ny;
}

/** Advance one fixed substep (1/480 s). Exported for tests. */
export function stepWorld(world) {
  const bs = world.b;
  for (let i = 0; i < 16; i++) {
    const b = bs[i];
    if (!b.on || !isMoving(b)) continue;
    friction(b);
    b.x += b.vx * H_SUB; b.y += b.vy * H_SUB;
  }
  for (let i = 0; i < 16; i++) {
    if (!bs[i].on) continue;
    const mi = isMoving(bs[i]);
    for (let j = i + 1; j < 16; j++) {
      if (!bs[j].on) continue;
      if (!mi && !isMoving(bs[j])) continue;
      collide(world, i, j);
    }
  }
  for (let i = 0; i < 16; i++) {
    const b = bs[i];
    if (!b.on) continue;
    if (checkPockets(world, i, b)) continue;
    walls(world, i, b);
    checkPockets(world, i, b);
  }
  world.step++;
}

export function allAtRest(world) {
  for (let i = 0; i < 16; i++) if (world.b[i].on && isMoving(world.b[i])) return false;
  return true;
}

function snapshot(world) {
  const f = new Array(32);
  for (let i = 0; i < 16; i++) {
    const b = world.b[i];
    f[2 * i] = b.on ? Math.round(b.x) : -1;
    f[2 * i + 1] = b.on ? Math.round(b.y) : -1;
  }
  return f;
}

// Push overlapping balls apart and back inside the cushions. Positions only, so
// it can never add energy; iterated because fixing one pair can create another.
function relax(world) {
  const bs = world.b;
  const target = D + 0.005;
  for (let it = 0; it < 80; it++) {
    let moved = false;
    for (let i = 0; i < 16; i++) {
      if (!bs[i].on) continue;
      for (let j = i + 1; j < 16; j++) {
        if (!bs[j].on) continue;
        const dx = bs[j].x - bs[i].x, dy = bs[j].y - bs[i].y;
        const d2 = dx * dx + dy * dy;
        if (d2 >= target * target) continue;
        const d = Math.sqrt(d2);
        const nx = d === 0 ? 1 : dx / d, ny = d === 0 ? 0 : dy / d;
        const push = (target - d) / 2 + 1e-9;
        bs[i].x -= nx * push; bs[i].y -= ny * push;
        bs[j].x += nx * push; bs[j].y += ny * push;
        moved = true;
      }
    }
    for (let i = 0; i < 16; i++) {
      const b = bs[i];
      if (!b.on) continue;
      if (inSideWallRange(b.x)) {
        if (b.y < R) { b.y = R; moved = true; } else if (b.y > H - R) { b.y = H - R; moved = true; }
      }
      if (inEndWallRange(b.y)) {
        if (b.x < R) { b.x = R; moved = true; } else if (b.x > W - R) { b.x = W - R; moved = true; }
      }
    }
    if (!moved) break;
  }
}

// A ball that came to rest hanging in a pocket mouth (past the cushion line but
// outside every capture disc) drops into the nearest pocket.
function settleLips(world) {
  for (let i = 0; i < 16; i++) {
    const b = world.b[i];
    if (!b.on) continue;
    if (b.x < R - 0.5 || b.x > W - R + 0.5 || b.y < R - 0.5 || b.y > H - R + 0.5) {
      let best = 0, bd = Infinity;
      for (let p = 0; p < POCKETS.length; p++) {
        const dx = b.x - POCKETS[p].x, dy = b.y - POCKETS[p].y;
        const d2 = dx * dx + dy * dy;
        if (d2 < bd) { bd = d2; best = p; }
      }
      // relax() clamps balls along every straight cushion, so an out-of-bounds
      // ball can only be in a pocket mouth
      pocketBall(world, i, b, best);
    }
  }
}

/** Validate a shot's numeric fields and return the quantised form, or null. */
export function normaliseShot(shot) {
  if (!shot || typeof shot !== 'object') return null;
  const { angle, power } = shot;
  if (typeof angle !== 'number' || !Number.isFinite(angle)) return null;
  if (typeof power !== 'number' || !Number.isFinite(power)) return null;
  if (power <= 0 || power > 1) return null;
  const sy = shot.spinY === undefined ? 0 : shot.spinY;
  if (typeof sy !== 'number' || !Number.isFinite(sy) || sy < -1 || sy > 1) return null;
  if (shot.spinX !== undefined && (typeof shot.spinX !== 'number' || !Number.isFinite(shot.spinX))) return null;
  const a = Math.round(angle * 1e6) / 1e6;
  const p = Math.round(power * 1e4) / 1e4;
  if (p <= 0) return null;
  return { angle: a === 0 ? 0 : a, power: p, spinX: 0, spinY: Math.round(sy * 1e3) / 1e3 || 0 };
}

function applyStrike(world, s) {
  const cue = world.b[0];
  const v0 = s.power * s.power * V_MAX; // quadratic: fine control at low power
  const dx = Math.cos(s.angle), dy = Math.sin(s.angle);
  cue.vx = dx * v0; cue.vy = dy * v0;
  // A centre hit starts with no spin at all (w = 0), so the ball slides and the cloth
  // gradually rolls it. spinY > 0 (follow) gives forward spin, < 0 (draw) backward.
  cue.wx = dx * v0 * SPIN_GAIN * s.spinY;
  cue.wy = dy * v0 * SPIN_GAIN * s.spinY;
}

/**
 * Simulate one shot from rest.
 * table: { balls: ([x, y] | null)[16] }  (null = pocketed). Ball 0 must be on the table.
 * shot:  { angle, power (0,1], spinY -1 draw .. +1 follow, spinX ignored }
 * Returns { finalState: { balls }, frames, frameDt, events, summary }.
 * frames: down-sampled, at most MAX_FRAMES + 1; each is 32 integers (x0,y0,x1,y1,...)
 * in mm, with -1,-1 for a ball that is off the table. frameDt is seconds per frame.
 */
export function simulateShot(table, shot) {
  const s = normaliseShot(shot);
  if (!s) throw new TypeError('bad shot');
  if (!table || !Array.isArray(table.balls) || table.balls.length !== 16 || !table.balls[0]) {
    throw new TypeError('bad table');
  }
  const world = makeWorld(table.balls);
  applyStrike(world, s);

  let stride = FRAME_STRIDE;
  let frames = [snapshot(world)];
  let timedOut = false;
  while (!allAtRest(world)) {
    if (world.step >= MAX_SUBSTEPS) { timedOut = true; break; }
    stepWorld(world);
    if (world.step % stride === 0) {
      frames.push(snapshot(world));
      if (frames.length > MAX_FRAMES) {
        frames = frames.filter((_, i) => i % 2 === 0);
        stride *= 2;
      }
    }
  }
  for (let i = 0; i < 16; i++) {
    const b = world.b[i];
    b.vx = b.vy = b.wx = b.wy = 0;
  }
  relax(world);
  settleLips(world);
  frames.push(snapshot(world));

  const balls = [];
  for (let i = 0; i < 16; i++) {
    const b = world.b[i];
    balls.push(b.on ? [q3(b.x), q3(b.y)] : null);
  }
  return {
    finalState: { balls },
    frames,
    frameDt: stride * H_SUB,
    events: world.events,
    summary: {
      firstContact: world.firstContact,
      pocketed: world.pocketed,
      offTable: world.offTable,
      cueScratch: world.pocketed.some((p) => p.ball === 0) || world.offTable.indexOf(0) >= 0,
      cushionAfterContact: world.cushionAfterContact,
      cushionBalls: world.cushionBalls.slice().sort((a, b) => a - b),
      seconds: q3(world.step * H_SUB),
      timedOut,
    },
  };
}

/** Test/debug hook: a world with the strike applied, to step by hand. */
export function createWorld(table, shot) {
  const s = normaliseShot(shot);
  if (!s) throw new TypeError('bad shot');
  const world = makeWorld(table.balls);
  applyStrike(world, s);
  return world;
}

/** Placement rule for a ball (default the cue ball, index `self` is ignored). Returns null if fine, else a reason. */
export function cuePlacementProblem(balls, x, y, kitchen, self = 0) {
  if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) {
    return 'position must be numbers';
  }
  if (x < R || x > W - R || y < R || y > H - R) return 'cue ball must be on the cloth';
  if (kitchen && x > HEAD_X) return 'on the break the cue ball goes behind the head string';
  for (let p = 0; p < POCKETS.length; p++) {
    const dx = x - POCKETS[p].x, dy = y - POCKETS[p].y;
    const lim = POCKETS[p].r + 2;
    if (dx * dx + dy * dy < lim * lim) return 'cue ball is in a pocket mouth';
  }
  for (let k = 0; k < KNUCKLES.length; k++) {
    const dx = x - KNUCKLES[k][0], dy = y - KNUCKLES[k][1];
    if (dx * dx + dy * dy < R * R) return 'cue ball overlaps a cushion jaw';
  }
  for (let i = 0; i < 16; i++) {
    const p = balls[i];
    if (!p || i === self) continue;
    const dx = x - p[0], dy = y - p[1];
    if (dx * dx + dy * dy < D * D) return 'overlaps ball ' + i;
  }
  return null;
}

/** Nearest free spot to (x, y), searching outward in a fixed pattern. Deterministic. */
export function nearestFreeSpot(balls, x, y, kitchen, self = 0) {
  for (let ring = 0; ring < 120; ring++) {
    const n = ring === 0 ? 1 : 12;
    for (let a = 0; a < n; a++) {
      const ang = (a * 2 * Math.PI) / 12;
      const cx = q3(x + Math.cos(ang) * ring * 10), cy = q3(y + Math.sin(ang) * ring * 10);
      if (cuePlacementProblem(balls, cx, cy, kitchen, self) === null) return [cx, cy];
    }
  }
  return [q3(HEAD_X), q3(H / 2)];
}

/**
 * Straight-line aiming guide from the cue ball: where the cue ball first touches a
 * ball or a cushion (ignores spin, friction and pocket jaws; a guide, not a
 * prediction). Returns { point:[x,y], ball (id or null), objectDir ({x,y} unit, the
 * struck ball's line), cueDir ({x,y} unit, the cue ball's tangent line) }.
 */
export function aimGuide(balls, angle) {
  const c = balls[0];
  const dx = Math.cos(angle), dy = Math.sin(angle);
  let t = Infinity, hit = null;
  if (dx > 1e-12) t = Math.min(t, (W - R - c[0]) / dx);
  if (dx < -1e-12) t = Math.min(t, (R - c[0]) / dx);
  if (dy > 1e-12) t = Math.min(t, (H - R - c[1]) / dy);
  if (dy < -1e-12) t = Math.min(t, (R - c[1]) / dy);
  for (let i = 1; i < 16; i++) {
    const p = balls[i];
    if (!p) continue;
    const fx = p[0] - c[0], fy = p[1] - c[1];
    const b = fx * dx + fy * dy;
    if (b <= 0) continue;
    const disc = b * b - (fx * fx + fy * fy - D * D);
    if (disc < 0) continue;
    const ti = b - Math.sqrt(disc);
    if (ti >= 0 && ti < t) { t = ti; hit = i; }
  }
  if (!Number.isFinite(t) || t < 0) t = 0;
  const point = [c[0] + dx * t, c[1] + dy * t];
  const out = { point, ball: hit, objectDir: null, cueDir: null };
  if (hit !== null) {
    const ox = balls[hit][0] - point[0], oy = balls[hit][1] - point[1];
    const ol = Math.sqrt(ox * ox + oy * oy) || 1;
    const od = { x: ox / ol, y: oy / ol };
    out.objectDir = od;
    const dot = dx * od.x + dy * od.y;
    const tx = dx - dot * od.x, ty = dy - dot * od.y;
    const tl = Math.sqrt(tx * tx + ty * ty);
    out.cueDir = tl > 1e-9 ? { x: tx / tl, y: ty / tl } : null;
  }
  return out;
}
