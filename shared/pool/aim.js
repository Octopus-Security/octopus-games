// Pure input maths for the pool table: aiming is one gesture (point at the table),
// power is another (a separate pull-back control). Nothing here touches the DOM.

/** Pull distance, in CSS pixels, that gives full power on the power control. */
export const FULL_PULL_PX = 170;
/** Below this power a release is a cancel, not a shot. */
export const MIN_POWER = 0.03;
/** A pointer closer than this to the cue ball (table units) gives no direction. */
export const AIM_DEADZONE = 2;
/** Space held this long (ms) reaches full power. */
export const CHARGE_MS = 1600;
export const FINE_STEP = Math.PI / 360; // 0.5 degree
export const COARSE_STEP = Math.PI / 60; // 3 degrees

/** Angle the cue ball will travel when aimed at pointer (both [x, y]); null if too close to tell. */
export function aimAngleFromPointer(cue, pointer) {
  const dx = pointer[0] - cue[0], dy = pointer[1] - cue[1];
  if (Math.hypot(dx, dy) < AIM_DEADZONE) return null;
  return Math.atan2(dy, dx);
}

/**
 * Power 0..1 from a drag on the power control. dx and dy are the pointer's movement
 * since it was pressed (screen pixels, +y down). Pulling left or down builds power;
 * pushing right or up cannot go below zero. Anything under MIN_POWER is 0 (cancel).
 */
export function powerFromDrag(dx, dy, full = FULL_PULL_PX) {
  const pull = Math.max(-dx, dy, 0);
  const p = Math.min(1, pull / full);
  return p < MIN_POWER ? 0 : p;
}

/** Power 0..1 after holding Space for ms milliseconds. */
export function powerFromHold(ms) {
  const p = Math.min(1, Math.max(0, ms) / CHARGE_MS);
  return p < MIN_POWER ? 0 : p;
}

/** A power below the threshold, or non-finite, is a cancel. */
export function isShot(power) {
  return Number.isFinite(power) && power >= MIN_POWER;
}

/** Nudge an angle by one key press. dir is -1 (counter-clockwise on screen) or +1. Result is in (-PI, PI]. */
export function stepAngle(angle, dir, coarse = false) {
  let a = angle + dir * (coarse ? COARSE_STEP : FINE_STEP);
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a <= -Math.PI) a += 2 * Math.PI;
  return a;
}
