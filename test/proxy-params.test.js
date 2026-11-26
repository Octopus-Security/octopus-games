'use strict';
// Public URL values that are pasted into a path on the game-server service.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { safeParam } = require('../server/proxy-params');

test('plain ids and tokens pass', () => {
  assert.strictEqual(safeParam('serverId', '12'), '12');
  assert.strictEqual(safeParam('modId', '7'), '7');
  assert.strictEqual(safeParam('token', 'a1b2c3d4e5f60718293a4b5c6d7e8f90'), 'a1b2c3d4e5f60718293a4b5c6d7e8f90');
});

test('anything that could change the path is refused', () => {
  for (const bad of ['1/../../x', '../x', '1%2f..', '1?x=1', '1#a', '', ' 1', '1 ', '1.5', '-1', 'abc', '1\n', undefined, ['1']]) {
    assert.strictEqual(safeParam('serverId', bad), null, JSON.stringify(bad));
    assert.strictEqual(safeParam('modId', bad), null, JSON.stringify(bad));
  }
  for (const bad of ['a/b', '..', 'a b', 'a?b', 'a#b', '', 'x'.repeat(129), undefined]) {
    assert.strictEqual(safeParam('token', bad), null, JSON.stringify(bad));
  }
  assert.throws(() => safeParam('nope', '1'));
});

test('every public proxy route runs its parameters through safeParam', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server', 'index.js'), 'utf8');
  assert.ok(!/\$\{req\.params\.(serverId|modId|token|id)\}/.test(src.split("require('./proxy-params')")[1] || src), 'a route builds a cortex path from a raw parameter');
});
