'use strict';

/**
 * The deploy-verification stamp.
 *
 * Portainer polls and reports back to nobody, so "did my fix land" can only be
 * answered by looking for the fix's effect — which is no help when the change
 * is invisible from outside, and actively misleading when a cached client is
 * still serving yesterday's bundle.
 *
 * The property worth defending is that the stamp MOVES when the code moves. A
 * stamp that silently stops tracking is worse than none: it reports "nothing
 * changed" for a deploy that did, and it does so in the confident direction.
 *
 * Run: node --test test/build-stamp.test.js
 */

const { test } = require('node:test');
const assert   = require('node:assert');
const fs       = require('node:fs');
const path     = require('node:path');

const root = path.join(__dirname, '..');
const { BUILD, sourceFiles } = require('../server/build');

/** Append a probe, re-require, restore. Returns the stamp seen with the probe. */
function stampWith(relPath) {
  const target   = path.join(root, relPath);
  const original = fs.readFileSync(target);
  try {
    fs.writeFileSync(target, Buffer.concat([original, Buffer.from('\n// build-stamp probe\n')]));
    delete require.cache[require.resolve('../server/build')];
    return require('../server/build').BUILD;
  } finally {
    fs.writeFileSync(target, original);
    delete require.cache[require.resolve('../server/build')];
  }
}

test('the stamp is a real hash, not the failure value', () => {
  assert.match(BUILD, /^[0-9a-f]{12}$/);
  assert.notStrictEqual(BUILD, 'unknown');
});

test('editing server source moves the stamp', () => {
  assert.notStrictEqual(stampWith('server/index.js'), BUILD,
    'editing server/index.js did not move the stamp');
});

test('editing a route moves it too — routes are deployed behaviour', () => {
  const dir  = path.join(root, 'server', 'routes');
  const name = fs.readdirSync(dir).find(f => f.endsWith('.js'));
  assert.ok(name, 'expected at least one route module');
  assert.notStrictEqual(stampWith(`server/routes/${name}`), BUILD,
    `editing server/routes/${name} did not move the stamp`);
});

// A hand-written file list stops covering the file you just added, and the
// failure is silent. These assert the walk finds things by discovery.
test('the walk covers what ships and excludes dependencies and live data', () => {
  const files = sourceFiles();
  assert.ok(files.includes('server/index.js'), 'server/index.js is not covered by the stamp');
  assert.ok(files.some(f => f.startsWith('server/routes/')), 'routes are not covered');
  assert.ok(files.some(f => f.startsWith('client/')), 'the client is not covered');
  assert.ok(!files.some(f => f.includes('node_modules')), 'node_modules must not be hashed');
  assert.ok(!files.some(f => f.startsWith('data/')), 'live data must not be hashed');
  assert.ok(!files.includes('package-lock.json'), 'the lockfile is deliberately excluded');
});

// If the route drifts behind an auth gate it starts redirecting to the login
// page, and "is this deployed?" becomes unanswerable in exactly the situation
// you most need it — a broken auth path.
test('/api/build is registered ahead of every auth gate', () => {
  const src   = fs.readFileSync(path.join(root, 'server', 'index.js'), 'utf8');
  const at    = src.indexOf("app.get('/api/build'");
  assert.ok(at > 0, '/api/build is not registered in server/index.js');

  const decl = src.slice(at, src.indexOf('}));', at));
  assert.ok(!/requireLogin|requireAdmin|authenticateToken/.test(decl),
    '/api/build must not be behind an auth gate');

  // The static catch-all serves the SPA; anything registered after it is
  // shadowed for GETs that reach it.
  const catchAll = src.indexOf('express.static');
  assert.ok(catchAll > 0, 'expected a static mount to exist');
  assert.ok(at < catchAll, '/api/build is registered after the static catch-all');
});

test('it reports this service, not a copy-pasted neighbour', () => {
  const src = fs.readFileSync(path.join(root, 'server', 'index.js'), 'utf8');
  const at  = src.indexOf("app.get('/api/build'");
  assert.match(src.slice(at, at + 400), /service: 'octopus-games'/);
});
