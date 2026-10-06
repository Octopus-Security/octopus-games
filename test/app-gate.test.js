'use strict';

/**
 * The per-app access gate (appAccess.js) and its wiring.
 *
 * Hiding a hub tile is presentation; this is the enforcement. Semantics are
 * octopus-math's: auth answers, an admin always passes (auth says so), a
 * missing row means allowed, unreachable auth serves the last answer or fails
 * OPEN, and a slug auth does not know is allowed with a warning.
 *
 * Run: node --test test/app-gate.test.js
 */

const { test } = require('node:test');
const assert   = require('node:assert');
const fs       = require('node:fs');
const path     = require('node:path');
const { createAppGate } = require('../server/appAccess');

const root  = path.join(__dirname, '..');
const index = fs.readFileSync(path.join(root, 'server/index.js'), 'utf8');
const compose = fs.readFileSync(path.join(root, 'docker-compose.yml'), 'utf8');

const SLUG = 'games';
const answer = (status, body) => async () => ({ status, ok: status >= 200 && status < 300, json: async () => body });
const http = require('node:http');

function serve(gate, user) {
  const express = require('express');
  const app = express();
  app.use((req, _res, next) => { if (user) req.user = user; next(); });
  app.use((req, res, next) => (req.user ? gate(req, res, next) : next()));  // as index.js mounts it
  app.get('/page', (_q, r) => r.send('secret page'));
  app.get('/api/data', (_q, r) => r.json({ data: 1 }));
  return new Promise(res => { const s = app.listen(0, () => res(s)); });
}
const get = (s, p) => new Promise((res, rej) => http.get({ port: s.address().port, path: p }, r => {
  let b = ''; r.on('data', d => b += d); r.on('end', () => res({ status: r.statusCode, body: b }));
}).on('error', rej));

test('refused: a denied account gets an HTML page, and 403 JSON on /api/', async () => {
  const s = await serve(createAppGate({ authUrl: 'http://a', slug: SLUG, appName: 'X', fetchImpl: answer(200, { allowed: false }) }), { username: 'u', role: 'user' });
  try {
    const page = await get(s, '/page');
    assert.strictEqual(page.status, 403);
    assert.ok(!page.body.includes('secret page'));
    const api = await get(s, '/api/data');
    assert.strictEqual(api.status, 403);
    assert.strictEqual(JSON.parse(api.body).code, 'no_access');
  } finally { s.close(); }
});

test('allowed: passes through (the default when auth has no row says allowed:true)', async () => {
  const s = await serve(createAppGate({ authUrl: 'http://a', slug: SLUG, fetchImpl: answer(200, { allowed: true }) }), { username: 'u', role: 'user' });
  try { assert.strictEqual((await get(s, '/page')).body, 'secret page'); } finally { s.close(); }
});

test('signed-out visitors are untouched by the gate (public surfaces stay public)', async () => {
  const s = await serve(createAppGate({ authUrl: 'http://a', slug: SLUG, fetchImpl: answer(200, { allowed: false }) }), null);
  try { assert.strictEqual((await get(s, '/page')).status, 200); } finally { s.close(); }
});

test('auth unreachable with no history fails open', async () => {
  const s = await serve(createAppGate({ authUrl: 'http://a', slug: SLUG, fetchImpl: async () => { throw new Error('down'); } }), { username: 'u', role: 'user' });
  try { assert.strictEqual((await get(s, '/page')).status, 200); } finally { s.close(); }
});

test('/api/build reports the mounted gate, derived not typed', () => {
  assert.strictEqual(createAppGate({ authUrl: 'http://a', slug: SLUG }).slug, SLUG);
  assert.strictEqual(createAppGate({ authUrl: 'http://a', slug: '' }).slug, null);
  assert.match(index, /\.\.\.\(appAccessGate\.slug \? \{ gate: appAccessGate\.slug \} : \{\}\)/);
  assert.ok(!new RegExp(`gate: ['"]${SLUG}['"]`).test(index), 'gate must not be a pasted constant');
});

test('wiring: slug default, compose, gate ahead of the routes and static client', () => {
  assert.ok(index.includes(`process.env.APP_ACCESS_SLUG || '${SLUG}'`));
  assert.ok(compose.includes(`APP_ACCESS_SLUG=\${APP_ACCESS_SLUG:-${SLUG}}`));
  const mount = index.indexOf('appAccessGate(req, res, next)');
  assert.ok(mount > 0);
  assert.ok(mount < index.indexOf("app.use('/api/games'"), 'gate must precede the first guarded route');
  assert.ok(mount < index.indexOf('express.static'));
});
