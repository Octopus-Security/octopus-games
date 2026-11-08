'use strict';
// Pool input maths: aim comes from the pointer, power from the separate pull-back control.
const { test } = require('node:test');
const assert = require('node:assert/strict');

let A;
test.before(async () => { A = await import('../shared/pool/aim.js'); });

test('aim angle points from the cue ball to the pointer', () => {
  assert.equal(A.aimAngleFromPointer([100, 100], [200, 100]), 0);
  assert.equal(A.aimAngleFromPointer([100, 100], [100, 200]), Math.PI / 2);
  assert.equal(A.aimAngleFromPointer([100, 100], [100, 0]), -Math.PI / 2);
  assert.ok(Math.abs(A.aimAngleFromPointer([100, 100], [0, 100])) - Math.PI < 1e-12);
});

test('aim works for a pointer far outside the table (cue against a rail)', () => {
  const a = A.aimAngleFromPointer([1990, 60], [2600, -300]);
  assert.ok(a < 0 && a > -Math.PI / 2);
});

test('a pointer on the cue ball gives no direction', () => {
  assert.equal(A.aimAngleFromPointer([100, 100], [100.5, 100.5]), null);
});

test('power grows with a pull left or down and caps at 1', () => {
  assert.equal(A.powerFromDrag(-A.FULL_PULL_PX / 2, 0), 0.5);
  assert.equal(A.powerFromDrag(0, A.FULL_PULL_PX / 4), 0.25);
  assert.equal(A.powerFromDrag(-9999, 0), 1);
  assert.equal(A.powerFromDrag(0, 9999), 1);
});

test('pushing right or up, or not moving, is zero power', () => {
  assert.equal(A.powerFromDrag(50, 0), 0);
  assert.equal(A.powerFromDrag(0, -50), 0);
  assert.equal(A.powerFromDrag(0, 0), 0);
});

test('dragging back to zero cancels: tiny power is 0 and is not a shot', () => {
  assert.equal(A.powerFromDrag(-1, 0), 0);
  assert.equal(A.isShot(A.powerFromDrag(-1, 0)), false);
  assert.equal(A.isShot(A.powerFromDrag(-60, 0)), true);
  assert.equal(A.isShot(NaN), false);
});

test('holding space charges linearly to full', () => {
  assert.equal(A.powerFromHold(0), 0);
  assert.equal(A.powerFromHold(A.CHARGE_MS / 2), 0.5);
  assert.equal(A.powerFromHold(A.CHARGE_MS * 3), 1);
});

test('arrow keys step the angle, shift is coarser, and it wraps', () => {
  assert.equal(A.stepAngle(0, 1), A.FINE_STEP);
  assert.equal(A.stepAngle(0, -1, true), -A.COARSE_STEP);
  assert.ok(A.COARSE_STEP > A.FINE_STEP);
  const w = A.stepAngle(Math.PI - 1e-6, 1, true);
  assert.ok(w > -Math.PI && w < -Math.PI + 0.1);
});
