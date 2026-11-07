// Computer opponent for pool (8-ball and 9-ball). Classic shot search, no learning
// and no network: it runs inside the player's browser (in a Web Worker), so it costs
// the server nothing.
//
// For every ball it may legally hit and every pocket, it computes the ghost-ball
// aim (where the cue ball must be at contact so the object ball leaves toward the
// pocket), a power estimate from the distances, and a few power / follow / draw
// variants. Each candidate is simulated with the SAME deterministic physics and
// rules the host uses (simulateShot + resolveShot), so "legal hit", "pocketed a
// ball of mine", "scratched" and "who is to play next" are read from the engine,
// not guessed. The result is scored (pocketing and keeping the turn, a foul being
// very bad, how easy the next shot is, how easy a shot is left for the opponent)
// and the best one is played with a level-dependent aim and power error. When
// nothing pockets, the best-scoring legal "safe" hit (a gentle direct hit that
// leaves little) wins, because safes are in the candidate list too.
//
// The work is capped: at most `maxSims` simulations and a wall-clock budget per turn.

import {
  W, H, R, D, HEAD_X, POCKETS, simulateShot, resolveShot, cuePlacementProblem,
  targetOf, groupOf, lowestBall,
} from '../pool/index.js';

export const LEVELS = {
  easy: { maxSims: 8, budgetMs: 500, aimSigma: 0.04, powerSigma: 0.2, leave: false, powers: [1.2], spins: [0], pairs: 5, pick: 3 },
  medium: { maxSims: 30, budgetMs: 1200, aimSigma: 0.011, powerSigma: 0.07, leave: true, powers: [1.15, 1.6], spins: [0], pairs: 8, pick: 1 },
  hard: { maxSims: 70, budgetMs: 1800, aimSigma: 0.003, powerSigma: 0.02, leave: true, powers: [1.0, 1.35, 1.8], spins: [0, 0.45, -0.45], pairs: 10, pick: 1 },
};

const clock = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const DECEL = 117.7; // mm/s^2: rolling friction, see physics.js (MU_ROLL * g)
const V_MAX = 7000;

// ---------------------------------------------------------------- geometry

/** Where an object ball should be aimed for a pocket: the mouth, a little inside the cushion. */
function pocketAim(p) {
  const cx = W / 2, cy = H / 2;
  const dx = cx - p.x, dy = cy - p.y;
  const len = Math.hypot(dx, dy);
  const inset = p.r > 50 ? 48 : 20;
  return [p.x + (dx / len) * inset, p.y + (dy / len) * inset];
}
const AIMS = POCKETS.map(pocketAim);

function distToSegment(px, py, ax, ay, bx, by) {
  const vx = bx - ax, vy = by - ay;
  const len2 = vx * vx + vy * vy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / len2));
  return Math.hypot(px - (ax + t * vx), py - (ay + t * vy));
}

function pathClear(balls, a, b, skip) {
  for (let i = 1; i < 16; i++) {
    if (skip.indexOf(i) >= 0 || !balls[i]) continue;
    if (distToSegment(balls[i][0], balls[i][1], a[0], a[1], b[0], b[1]) < D - 1) return false;
  }
  return true;
}

/** Geometry of cue `c` potting ball `t` in pocket `pi`, or null if it is blocked or too thin. */
function cutShot(balls, c, id, pi) {
  const t = balls[id];
  const [px, py] = AIMS[pi];
  const ux = px - t[0], uy = py - t[1];
  const d2 = Math.hypot(ux, uy);
  if (d2 < 1) return null;
  const nx = ux / d2, ny = uy / d2;
  const g = [t[0] - nx * D, t[1] - ny * D]; // ghost ball: the cue ball's centre at contact
  if (g[0] < R || g[0] > W - R || g[1] < R || g[1] > H - R) return null;
  const cx = g[0] - c[0], cy = g[1] - c[1];
  const d1 = Math.hypot(cx, cy);
  if (d1 < 1) return null;
  const cos = (cx * nx + cy * ny) / d1;
  if (cos < 0.25) return null; // thinner than about 75 degrees
  if (!pathClear(balls, c, g, [id])) return null;
  if (!pathClear(balls, t, [px, py], [id])) return null;
  const quality = Math.pow(cos, 1.5) / (1 + (d1 + d2) / 1800);
  return { id, pocket: pi, angle: Math.atan2(cy, cx), d1, d2, cos, quality, ghost: g };
}

/** Speed (as a power) that carries the object ball to the pocket, before the variant scale. */
function powerFor(shot) {
  const vObj = Math.sqrt(2 * DECEL * shot.d2) + 260;
  const vCue = vObj / Math.max(shot.cos, 0.3);
  const v0 = Math.sqrt(vCue * vCue + 2 * DECEL * 1.3 * shot.d1);
  return v0;
}
const powerOfSpeed = (v) => Math.max(0.12, Math.min(1, Math.sqrt(v / V_MAX)));

// ---------------------------------------------------------------- rules glue

function targetIds(state, seat) {
  const out = [];
  if (state.variant === '9ball') {
    const low = lowestBall(state.balls);
    return low === null ? out : [low];
  }
  const t = targetOf(state, seat);
  for (let id = 1; id <= 15; id++) {
    if (!state.balls[id]) continue;
    if (t === 'open' ? id !== 8 : t === 'eight' ? id === 8 : groupOf(id) === t) out.push(id);
  }
  return out;
}

/** How good the best clean shot looks from the current cue position (0..1). */
function bestQuality(balls, ids) {
  if (!balls[0]) return 0;
  let best = 0;
  for (const id of ids) for (let p = 0; p < 6; p++) {
    const c = cutShot(balls, balls[0], id, p);
    if (c && c.quality > best) best = c.quality;
  }
  return Math.min(1, best * 1.6);
}

function scoreResult(res, seat, level, state) {
  const n = res.state;
  if (n.over) return n.winner === seat ? 1e6 : -1e6;
  const ls = n.lastShot;
  const fouled = ls.fouls.length > 0;
  const nine = state.variant === '9ball';
  const opp = 1 - seat;
  let s = 0;
  const downs = ls.pocketed.filter((id) => id !== 0);
  if (fouled) s -= 3500;
  else for (const id of downs) {
    if (nine || state.breakShot) s += 1000;
    else if (n.groups[seat] && groupOf(id) === n.groups[seat]) s += 1000;
    else if (n.groups[opp] && groupOf(id) === n.groups[opp]) s -= 900;
    else s += 600;
  }
  if (!fouled && n.turn === seat) {
    s += 400;
    if (level.leave) s += 500 * bestQuality(n.balls, targetIds(n, seat));
  } else if (!fouled && level.leave) {
    s -= 450 * bestQuality(n.balls, targetIds(n, opp));
  }
  return s;
}

// ---------------------------------------------------------------- candidates

function nearestPocket(pt) {
  let best = 0, bd = Infinity;
  for (let i = 0; i < 6; i++) {
    const d = Math.hypot(AIMS[i][0] - pt[0], AIMS[i][1] - pt[1]);
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

function makeCandidates(state, level, cueAt, place) {
  const balls = state.balls.slice();
  if (cueAt) balls[0] = cueAt;
  const ids = targetIds(state, state.turn);
  const cuts = [];
  for (const id of ids) for (let p = 0; p < 6; p++) {
    const c = cutShot(balls, balls[0], id, p);
    if (c) cuts.push(c);
  }
  cuts.sort((a, b) => b.quality - a.quality);
  const out = [];
  const mk = (cut, scale, spinY, tag) => out.push({
    place, tag, pocket: cut.pocket,
    shot: { angle: cut.angle, power: powerOfSpeed(powerFor(cut) * scale), spinY },
    target: cut.id,
  });
  const top = cuts.slice(0, level.pairs);
  for (const c of top) mk(c, level.powers[0], 0, 'pot');
  for (const c of top.slice(0, 4)) for (let i = 1; i < level.powers.length; i++) mk(c, level.powers[i], 0, 'pot');
  for (const c of top.slice(0, 3)) for (const sp of level.spins) if (sp !== 0) mk(c, level.powers[0], sp, 'pot');
  // Safe plays: a direct, gentle hit on the nearest legal ball, then a firmer one.
  const byDist = ids.slice().sort((a, b) => Math.hypot(balls[a][0] - balls[0][0], balls[a][1] - balls[0][1]) - Math.hypot(balls[b][0] - balls[0][0], balls[b][1] - balls[0][1]));
  for (const id of byDist.slice(0, 2)) {
    const t = balls[id];
    const angle = Math.atan2(t[1] - balls[0][1], t[0] - balls[0][0]);
    if (!pathClear(balls, balls[0], t, [id])) continue;
    for (const pw of [0.3, 0.55]) out.push({ place, tag: 'safe', pocket: nearestPocket(t), shot: { angle, power: pw, spinY: 0 }, target: id });
  }
  return out;
}

/** Cue-ball spots for ball in hand: straight-in shots for the most promising ball/pocket pairs. */
function placementCandidates(state, level) {
  const out = [];
  const ids = targetIds(state, state.turn);
  const kitchen = !!(state.inHand && state.inHand.kitchen);
  const tried = [];
  for (const id of ids) for (let p = 0; p < 6; p++) {
    const t = state.balls[id];
    const [px, py] = AIMS[p];
    const d2 = Math.hypot(px - t[0], py - t[1]);
    if (d2 < 1) continue;
    const nx = (px - t[0]) / d2, ny = (py - t[1]) / d2;
    for (const back of [330, 600]) {
      const x = t[0] - nx * (D + back), y = t[1] - ny * (D + back);
      if (x < R || x > W - R || y < R || y > H - R) continue;
      if (cuePlacementProblem(state.balls, x, y, kitchen)) continue;
      const withCue = state.balls.slice();
      withCue[0] = [x, y];
      const cut = cutShot(withCue, [x, y], id, p);
      if (cut) tried.push({ cut, at: [Math.round(x * 10) / 10, Math.round(y * 10) / 10] });
    }
  }
  tried.sort((a, b) => b.cut.quality - a.cut.quality);
  for (const tr of tried.slice(0, level.pairs)) {
    for (let i = 0; i < Math.min(2, level.powers.length); i++) {
      out.push({ place: tr.at, tag: 'pot', pocket: tr.cut.pocket, target: tr.cut.id,
        shot: { angle: tr.cut.angle, power: powerOfSpeed(powerFor(tr.cut) * level.powers[i]), spinY: 0 } });
    }
  }
  return out;
}

function breakCandidates(state, level, rnd) {
  const out = [];
  let apex = null;
  for (let id = 1; id <= 15; id++) if (state.balls[id] && (!apex || state.balls[id][0] < state.balls[apex][0])) apex = id;
  if (apex === null) return out;
  const target = state.balls[apex];
  const ys = level.leave ? [H / 2, H / 2 - 160, H / 2 + 160, H / 2 - 320, H / 2 + 320] : [H / 2 + (rnd() < 0.5 ? -1 : 1) * 120];
  const powers = level === LEVELS.hard ? [0.88, 1] : level === LEVELS.medium ? [0.9] : [0.75];
  for (const y of ys) for (const pw of powers) {
    const x = HEAD_X - 40;
    if (cuePlacementProblem(state.balls, x, y, true)) continue;
    out.push({ place: [x, y], tag: 'break', pocket: 0, target: apex,
      shot: { angle: Math.atan2(target[1] - y, target[0] - x), power: pw, spinY: 0 } });
  }
  return out;
}

// ---------------------------------------------------------------- noise

function gauss(rnd) {
  let u = 0, v = 0;
  while (u === 0) u = rnd();
  while (v === 0) v = rnd();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/**
 * Choose what to do in `state` for the seat to move.
 * opts: { level, rng?, maxSims?, budgetMs? }
 * Returns { moves, info }. `moves` is a list to send in order, for example
 * [{ placeCue }, { callPocket }, { angle, power, spinY }]; every entry is legal
 * for applyMove when applied one after another. info = { sims, ms, tag, score, level }.
 */
export function chooseShot(state, opts = {}) {
  const level = LEVELS[opts.level] || LEVELS.medium;
  const maxSims = opts.maxSims || level.maxSims;
  const budgetMs = opts.budgetMs || level.budgetMs;
  const rnd = opts.rng || Math.random;
  const seat = state.turn;
  const t0 = clock();
  let sims = 0;

  let cands = [];
  if (state.breakShot) cands = breakCandidates(state, level, rnd);
  else {
    if (state.inHand) cands = placementCandidates(state, level);
    cands = cands.concat(makeCandidates(state, level, null, null));
  }
  // Without a candidate (cue ball hemmed in, odd positions) hit the nearest legal ball gently.
  if (!cands.length) {
    const ids = targetIds(state, seat);
    const c = state.balls[0];
    const id = ids.length ? ids[0] : 1;
    const t = state.balls[id] || [W / 2, H / 2];
    cands.push({ place: null, tag: 'fallback', pocket: 0, target: id, shot: { angle: Math.atan2(t[1] - c[1], t[0] - c[0]), power: 0.4, spinY: 0 } });
  }

  const eightTarget = !state.breakShot && state.variant !== '9ball' && targetOf(state, seat) === 'eight';
  if (level.pick > 1) {
    // easy: look at a random few of the leading candidates only
    for (let i = cands.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const x = cands[i]; cands[i] = cands[j]; cands[j] = x; }
  }

  let best = null;
  const evaluated = [];
  for (const cand of cands) {
    if (sims >= maxSims || clock() - t0 > budgetMs) break;
    const balls = state.balls.slice();
    if (cand.place) balls[0] = cand.place;
    const called = eightTarget ? cand.pocket : state.called;
    const sim = simulateShot({ balls }, cand.shot);
    sims++;
    const base = { ...state, balls, called, inHand: null };
    let res;
    try { res = resolveShot(base, seat, cand.shot, sim); } catch { continue; }
    const score = scoreResult(res, seat, level, state);
    const entry = { cand, score };
    evaluated.push(entry);
    if (!best || score > best.score) best = entry;
    if (score >= 1e6) break;
  }
  if (!best) best = { cand: cands[0], score: -Infinity };
  if (level.pick > 1) {
    evaluated.sort((a, b) => b.score - a.score);
    const pool = evaluated.slice(0, level.pick);
    if (pool.length) best = pool[Math.floor(rnd() * pool.length)];
  }

  const shot = {
    angle: best.cand.shot.angle + gauss(rnd) * level.aimSigma,
    power: Math.max(0.1, Math.min(1, best.cand.shot.power * (1 + gauss(rnd) * level.powerSigma))),
    spinY: best.cand.shot.spinY,
  };
  shot.angle = Math.round(shot.angle * 1e5) / 1e5;
  shot.power = Math.round(shot.power * 1e4) / 1e4;

  const moves = [];
  if (best.cand.place) moves.push({ placeCue: { x: best.cand.place[0], y: best.cand.place[1] } });
  if (eightTarget) moves.push({ callPocket: best.cand.pocket });
  moves.push(shot);
  return { moves, info: { sims, ms: Math.round(clock() - t0), tag: best.cand.tag, score: best.score, level: opts.level || 'medium' } };
}

