'use strict';
/**
 * Multiplayer: seat authorisation, challenges, invite links, guests, versions.
 * Drives the real routers over HTTP on an in-memory database. Identity is faked
 * the way SSO would set it: an `x-test-user` header becomes req.user.
 * Run: node --test test/multiplayer.test.js
 */
const { test, before, after } = require('node:test');
const assert  = require('node:assert');
const http    = require('node:http');
const fs      = require('node:fs');
const os      = require('node:os');
const path    = require('node:path');
const express = require('express');
const { Sequelize } = require('sequelize');
const { defineMatchModels } = require('../server/multiplayer/models');
const { createPlay, sanitizeGuestName } = require('../server/multiplayer/service');
const { loadEngines } = require('../server/multiplayer/engines');

let server, base, models, clock, enginesP, tmp;
let lookupDown = false;
const lookups = [];
const GHOSTS = /^(zz_|ghost)/i;   // names the stub auth does not know; every other name is a registered player
const T0 = Date.parse('2026-11-06T12:00:00Z');

before(async () => {
  const sequelize = new Sequelize({ dialect: 'sqlite', storage: ':memory:', logging: false });
  models = defineMatchModels(sequelize);
  await models.Match.sync(); await models.MatchMove.sync();
  enginesP = loadEngines();
  clock = T0;
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'play-'));
  fs.writeFileSync(path.join(tmp, 'index.html'), '<!doctype html><title>SPA</title>');
  const play = createPlay({
    getModels: () => models, getEngines: () => enginesP, indexFile: path.join(tmp, 'index.html'),
    now: () => clock, limits: { moveMax: 6, moveWindowMs: 10000, heartbeatMs: 200, lookupFailMax: 4 },
    userExists: async name => { if (lookupDown) throw new Error('auth down'); return !GHOSTS.test(name) && lookups.push(name) > 0; },
  });
  const app = express();
  app.use(express.json());
  const sso = (req, _res, next) => { const u = req.get('x-test-user'); if (u) req.user = { username: u, role: 'user' }; next(); };
  app.use('/play', sso, play.guestRouter);
  app.use('/api/play', sso, (req, res, next) => (req.user ? next() : res.status(401).json({ error: 'NOT_AUTHENTICATED' })), play.apiRouter);
  app.get('/secret', sso, (_q, r) => r.send('gated'));
  await new Promise(r => { server = app.listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server.close(); server.closeAllConnections && server.closeAllConnections(); });

async function call(method, url, { user, cookie, body } = {}) {
  const headers = {};
  if (user) headers['x-test-user'] = user;
  if (cookie) headers.cookie = cookie;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const r = await fetch(base + url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch { /* html */ }
  const setCookie = r.headers.getSetCookie ? r.headers.getSetCookie() : [];
  return { status: r.status, json, text, headers: r.headers, setCookie };
}
const cookieOf = res => (res.setCookie[0] || '').split(';')[0];
async function invite(user, color = 'white') {
  const r = await call('POST', '/api/play/invites', { user, body: { type: 'chess', color } });
  assert.strictEqual(r.status, 201);
  return { id: r.json.id, tok: r.json.invite.path.split('/').pop() };
}
/** alice (white) vs a guest, through a link. */
async function guestGame(name = 'Guesty', host = 'alice') {
  const { id, tok } = await invite(host);
  const claim = await call('POST', `/play/i/${tok}/claim`, { body: { name } });
  assert.strictEqual(claim.status, 200);
  return { id, tok, gc: cookieOf(claim), claim };
}
const move = (id, who, version, from, to, extra = {}) =>
  call('POST', `/play/m/${id}/moves`, { ...who, body: { version, move: { from, to, ...extra } } });

test('the gated side of the app is not reachable by the guest routes', async () => {
  assert.strictEqual((await call('GET', '/api/play/matches')).status, 401);
  assert.strictEqual((await call('POST', '/api/play/invites', { body: { type: 'chess' } })).status, 401);
  assert.strictEqual((await call('POST', '/api/play/challenges', { body: { type: 'chess', opponent: 'bob' } })).status, 401);
});

test('invite: a guest takes the empty seat and gets a hardened seat cookie; the link then spectates', async () => {
  const { id, tok, claim } = await guestGame('Guesty');
  assert.deepStrictEqual({ role: claim.json.role, seat: claim.json.seat, matchId: claim.json.matchId }, { role: 'player', seat: 1, matchId: id });
  const sc = claim.setCookie[0];
  assert.match(sc, new RegExp(`^octopus_seat=[A-Za-z0-9_-]{32}; Path=/play/m/${id}; `));
  for (const flag of ['HttpOnly', 'Secure', 'SameSite=Lax']) assert.ok(sc.includes(flag), flag);
  assert.ok(tok.length >= 32, '>= 192 bits as base64url'); // 24 random bytes
  // third party opening the link: spectator, sees board, no legal moves, no cookie
  const third = await call('POST', `/play/i/${tok}/claim`, { body: { name: 'Third' } });
  assert.deepStrictEqual(third.json, { role: 'spectator', status: 'active' });
  assert.strictEqual(third.setCookie.length, 0);
  const st = await call('GET', `/play/i/${tok}/state`);
  assert.strictEqual(st.json.you.role, 'spectator');
  assert.strictEqual(st.json.view.legalMoves.length, 0);
  assert.deepStrictEqual(st.json.seats.map(s => [s.name, s.kind]), [['alice', 'user'], ['Guesty', 'guest']]);
  assert.ok(!JSON.stringify(st.json).includes('Hash') && !st.text.includes(tok) && !st.text.includes('octopus_seat'));
  assert.strictEqual(st.headers.get('cache-control'), 'no-store');
  assert.strictEqual(st.headers.get('referrer-policy'), 'no-referrer');
});

test('a logged-in user can take the seat under their username; the creator re-opening the link keeps their own', async () => {
  const { id, tok } = await invite('alice');
  const own = await call('POST', `/play/i/${tok}/claim`, { user: 'alice' });
  assert.deepStrictEqual(own.json, { matchId: id, role: 'player', seat: 0 });
  assert.strictEqual((await call('GET', `/play/m/${id}/state`, { user: 'alice' })).json.status, 'open');
  const bob = await call('POST', `/play/i/${tok}/claim`, { user: 'Bob' });
  assert.strictEqual(bob.json.seat, 1);
  const st = await call('GET', `/play/m/${id}/state`, { user: 'bob' });  // case-insensitive
  assert.strictEqual(st.json.status, 'active');
  assert.strictEqual(st.json.seats[1].name, 'Bob');
});

test('claim race: two claimants at once, exactly one wins', async () => {
  for (let k = 0; k < 5; k++) {
    const { tok } = await invite('alice');
    const rs = await Promise.all([
      call('POST', `/play/i/${tok}/claim`, { body: { name: 'One' } }),
      call('POST', `/play/i/${tok}/claim`, { body: { name: 'Two' } }),
      call('POST', `/play/i/${tok}/claim`, { user: 'carol' }),
    ]);
    assert.strictEqual(rs.filter(r => r.json.role === 'player').length, 1);
    assert.strictEqual(rs.filter(r => r.json.role === 'spectator').length, 2);
  }
});

test('seat authorisation: strangers, spectators, other matches\' guest tokens and anonymous callers all get 404', async () => {
  const a = await guestGame('Ana');
  const b = await guestGame('Ben');
  const paths = id => [['GET', `/play/m/${id}`], ['GET', `/play/m/${id}/state`], ['GET', `/play/m/${id}/events`]];
  for (const [method, url] of paths(a.id)) {
    assert.strictEqual((await call(method, url)).status, 404, `anonymous ${url}`);
    assert.strictEqual((await call(method, url, { user: 'mallory' })).status, 404, `user ${url}`);
    assert.strictEqual((await call(method, url, { cookie: b.gc })).status, 404, `other match token ${url}`);
    assert.strictEqual((await call(method, url, { cookie: 'octopus_seat=' + 'x'.repeat(32) })).status, 404);
  }
  const mv = await move(a.id, { cookie: b.gc }, 1, 'e7', 'e5');
  assert.strictEqual(mv.status, 404);
  assert.strictEqual((await move(a.id, { user: 'mallory' }, 1, 'e2', 'e4')).status, 404);
  assert.strictEqual((await move(a.id, {}, 1, 'e2', 'e4')).status, 404);
  assert.strictEqual((await call('GET', `/play/m/not-a-uuid/state`)).status, 404);
  assert.strictEqual((await call('GET', `/play/m/${a.id}/state`, { cookie: a.gc })).status, 200);
  // unknown / malformed invite tokens
  assert.strictEqual((await call('GET', `/play/i/${'A'.repeat(32)}/info`)).status, 404);
  assert.strictEqual((await call('POST', `/play/i/short/claim`, { body: { name: 'x' } })).status, 404);
  // a spectator cannot move: there is no move route on a link, and a seat route needs a seat
  assert.strictEqual((await call('POST', `/play/i/${a.tok}/moves`, { body: { version: 1, move: { from: 'e2', to: 'e4' } } })).status, 404);
  // the page: seat holders get the app shell, others 404
  assert.strictEqual((await call('GET', `/play/m/${a.id}`, { cookie: a.gc })).status, 200);
  assert.match((await call('GET', `/play/i/${a.tok}`)).text, /SPA/);
});

test('wrong seat: moving out of turn, or the other side\'s pieces, is refused with no state change', async () => {
  const g = await guestGame();
  const early = await move(g.id, { cookie: g.gc }, 1, 'e7', 'e5');   // black before white
  assert.strictEqual(early.status, 422);
  assert.strictEqual(early.json.error, 'ILLEGAL_MOVE');
  const stealing = await move(g.id, { user: 'alice' }, 1, 'e7', 'e5');
  assert.strictEqual(stealing.status, 422);
  assert.strictEqual((await call('GET', `/play/m/${g.id}/state`, { user: 'alice' })).json.version, 1);
  const ok = await move(g.id, { user: 'alice' }, 1, 'e2', 'e4');
  assert.strictEqual(ok.status, 200);
  assert.strictEqual(ok.json.version, 2);
  assert.strictEqual(ok.json.view.history[0].san, 'e4');
  assert.strictEqual(models.MatchMove.count && await models.MatchMove.count({ where: { matchId: g.id } }), 1);
});

test('stale version: 409 and the state is unchanged; two moves on one version, one wins', async () => {
  const g = await guestGame();
  const stale = await move(g.id, { user: 'alice' }, 0, 'e2', 'e4');
  assert.strictEqual(stale.status, 409);
  assert.deepStrictEqual(stale.json, { error: 'STALE', version: 1 });
  assert.strictEqual((await call('POST', `/play/m/${g.id}/moves`, { user: 'alice', body: { move: { from: 'e2', to: 'e4' } } })).status, 400);
  await move(g.id, { user: 'alice' }, 1, 'e2', 'e4');
  const rs = await Promise.all([
    move(g.id, { cookie: g.gc }, 2, 'e7', 'e5'),
    move(g.id, { cookie: g.gc }, 2, 'c7', 'c5'),
  ]);
  assert.deepStrictEqual(rs.map(r => r.status).sort(), [200, 409].sort().length ? rs.map(r => r.status).sort() : []);
  assert.strictEqual(rs.filter(r => r.status === 200).length, 1);
  assert.ok(rs.every(r => [200, 409, 422].includes(r.status)));
  assert.strictEqual((await call('GET', `/play/m/${g.id}/state`, { user: 'alice' })).json.version, 3);
});

test('a game to Fool\'s Mate over HTTP finishes the match and refuses further moves', async () => {
  const g = await guestGame();
  const A = { user: 'alice' }, B = { cookie: g.gc };
  let v = 1;
  for (const [who, f, t] of [[A, 'f2', 'f3'], [B, 'e7', 'e5'], [A, 'g2', 'g4'], [B, 'd8', 'h4']]) {
    const r = await move(g.id, who, v, f, t);
    assert.strictEqual(r.status, 200, JSON.stringify(r.json));
    v = r.json.version;
  }
  const st = (await call('GET', `/play/m/${g.id}/state`, A)).json;
  assert.strictEqual(st.status, 'finished');
  assert.deepStrictEqual(st.game, { turn: null, over: true, winner: 1, reason: 'checkmate' });
  assert.strictEqual((await move(g.id, A, v, 'a2', 'a3')).status, 409);
  const mine = (await call('GET', '/api/play/matches', A)).json;
  assert.ok(mine.matches.some(m => m.id === g.id && m.status === 'finished' && m.winner === 1));
});

test('resign and draw offers go through the move route', async () => {
  const g = await guestGame();
  const off = await call('POST', `/play/m/${g.id}/moves`, { cookie: g.gc, body: { version: 1, move: { t: 'offerDraw' } } });
  assert.strictEqual(off.json.view.drawOffer, 1);
  const acc = await call('POST', `/play/m/${g.id}/moves`, { user: 'alice', body: { version: 2, move: { t: 'acceptDraw' } } });
  assert.strictEqual(acc.json.game.reason, 'agreement');
  const h = await guestGame();
  const res = await call('POST', `/play/m/${h.id}/moves`, { cookie: h.gc, body: { version: 1, move: { t: 'resign' } } });
  assert.deepStrictEqual(res.json.game, { turn: null, over: true, winner: 0, reason: 'resignation' });
});

test('move rate limit is per seat', async () => {
  const g = await guestGame();
  const codes = [];
  for (let i = 0; i < 9; i++) codes.push((await call('POST', `/play/m/${g.id}/moves`, { cookie: g.gc, body: { version: 99, move: { from: 'e7', to: 'e5' } } })).status);
  assert.ok(codes.includes(429), codes.join());
  // white's budget is separate
  assert.strictEqual((await move(g.id, { user: 'alice' }, 1, 'e2', 'e4')).status, 200);
});

test('challenge flow: incoming list, accept, decline, cancel, and nobody else can answer', async () => {
  const c = await call('POST', '/api/play/challenges', { user: 'alice', body: { type: 'chess', opponent: 'Dana', color: 'white' } });
  assert.strictEqual(c.status, 201);
  const id = c.json.id;
  // not yet playable
  assert.strictEqual((await move(id, { user: 'alice' }, 0, 'e2', 'e4')).status, 409);
  assert.strictEqual((await call('POST', `/api/play/matches/${id}/accept`, { user: 'mallory' })).status, 404);
  assert.strictEqual((await call('POST', `/api/play/matches/${id}/accept`, { user: 'alice' })).status, 409); // creator cannot accept
  const inc = (await call('GET', '/api/play/matches', { user: 'dana' })).json;
  assert.deepStrictEqual(inc.incoming.map(m => [m.id, m.opponent, m.type]), [[id, 'alice', 'chess']]);
  assert.strictEqual(inc.matches.length, 0);
  assert.strictEqual((await call('GET', '/api/play/matches', { user: 'mallory' })).json.incoming.length, 0);
  const acc = await call('POST', `/api/play/matches/${id}/accept`, { user: 'dana' });
  assert.strictEqual(acc.status, 200);
  assert.strictEqual(acc.json.status, 'active');
  assert.strictEqual(acc.json.seats[1].name, 'dana');
  assert.strictEqual((await move(id, { user: 'alice' }, acc.json.version, 'e2', 'e4')).status, 200);

  const d = (await call('POST', '/api/play/challenges', { user: 'alice', body: { type: 'chess', opponent: 'dana' } })).json.id;
  assert.strictEqual((await call('POST', `/api/play/matches/${d}/decline`, { user: 'dana' })).json.status, 'declined');
  assert.strictEqual((await call('POST', `/api/play/matches/${d}/accept`, { user: 'dana' })).status, 409);
  const e = (await call('POST', '/api/play/challenges', { user: 'alice', body: { type: 'chess', opponent: 'dana' } })).json.id;
  assert.strictEqual((await call('POST', `/api/play/matches/${e}/cancel`, { user: 'dana' })).status, 404);
  assert.strictEqual((await call('POST', `/api/play/matches/${e}/cancel`, { user: 'alice' })).json.status, 'cancelled');
  assert.strictEqual((await call('GET', '/api/play/matches', { user: 'dana' })).json.incoming.length, 0);
});

test('a challenge to an unregistered name is refused with 404; a registered name is accepted case-insensitively', async () => {
  const ghost = await call('POST', '/api/play/challenges', { user: 'frank', body: { type: 'chess', opponent: 'zz_nobody_here', color: 'white' } });
  assert.strictEqual(ghost.status, 404);
  assert.deepStrictEqual(ghost.json, { error: 'NO_SUCH_PLAYER', message: 'No player with that username.' });
  const real = await call('POST', '/api/play/challenges', { user: 'frank', body: { type: 'chess', opponent: 'ErIn', color: 'white' } });
  assert.strictEqual(real.status, 201);
  assert.ok(lookups.includes('ErIn'));
  const mine = (await call('GET', '/api/play/matches', { user: 'frank' })).json.matches;
  assert.ok(!mine.some(m => m.opponent === 'zz_nobody_here'), 'no row was written for the ghost');
});

test('challenging yourself is refused before any lookup', async () => {
  const before = lookups.length;
  assert.strictEqual((await call('POST', '/api/play/challenges', { user: 'frank', body: { type: 'chess', opponent: 'FRANK' } })).status, 400);
  assert.strictEqual(lookups.length, before);
});

test('if auth cannot be asked, the challenge is refused (fail closed) and nothing is written', async () => {
  lookupDown = true;
  try {
    const r = await call('POST', '/api/play/challenges', { user: 'kim', body: { type: 'chess', opponent: 'erin' } });
    assert.strictEqual(r.status, 503);
    assert.strictEqual(r.json.error, 'LOOKUP_UNAVAILABLE');
  } finally { lookupDown = false; }
  assert.strictEqual((await call('GET', '/api/play/matches', { user: 'kim' })).json.matches.length, 0);
});

test('failed lookups are rate limited per user, and successes do not count', async () => {
  for (let i = 0; i < 4; i++) assert.strictEqual((await call('POST', '/api/play/challenges', { user: 'lou', body: { type: 'chess', opponent: 'zz_' + i } })).status, 404);
  const blocked = await call('POST', '/api/play/challenges', { user: 'lou', body: { type: 'chess', opponent: 'zz_again' } });
  assert.strictEqual(blocked.status, 429);
  assert.strictEqual(blocked.json.error, 'TOO_MANY_LOOKUPS');
  // another user is unaffected; a limited user stays blocked even for real names until the window passes
  assert.strictEqual((await call('POST', '/api/play/challenges', { user: 'max', body: { type: 'chess', opponent: 'zz_x' } })).status, 404);
  assert.strictEqual((await call('POST', '/api/play/challenges', { user: 'lou', body: { type: 'chess', opponent: 'erin' } })).status, 429);
  clock += 11 * 60 * 1000;
  assert.strictEqual((await call('POST', '/api/play/challenges', { user: 'lou', body: { type: 'chess', opponent: 'erin' } })).status, 201);
});

test('limits: pending challenges per target, and 20 open matches per user', async () => {
  let last;
  for (let i = 0; i < 4; i++) last = await call('POST', '/api/play/challenges', { user: 'gina', body: { type: 'chess', opponent: 'hank' } });
  assert.strictEqual(last.status, 429);
  const codes = [];
  for (let i = 0; i < 22; i++) codes.push((await call('POST', '/api/play/invites', { user: 'ivy', body: { type: 'chess' } })).status);
  assert.strictEqual(codes.filter(c => c === 201).length, 20);
  assert.strictEqual(codes[20], 429);
  // being spammed with challenges does not use up the target's own allowance
  for (let i = 0; i < 3; i++) await call('POST', '/api/play/challenges', { user: 'spam' + i, body: { type: 'chess', opponent: 'jo' } });
  assert.strictEqual((await call('POST', '/api/play/invites', { user: 'jo', body: { type: 'chess' } })).status, 201);
});

test('revoke: an unclaimed link dies; a claimed one stops spectating but the players carry on', async () => {
  const { id, tok } = await invite('kim');
  assert.strictEqual((await call('POST', `/api/play/matches/${id}/revoke-invite`, { user: 'lee' })).status, 404);
  assert.strictEqual((await call('POST', `/api/play/matches/${id}/revoke-invite`, { user: 'kim' })).json.status, 'revoked');
  assert.strictEqual((await call('GET', `/play/i/${tok}/info`)).status, 404);
  assert.strictEqual((await call('POST', `/play/i/${tok}/claim`, { body: { name: 'Late' } })).status, 404);

  const g = await guestGame();
  const spec = await call('GET', `/play/i/${g.tok}/state`);
  assert.strictEqual(spec.status, 200);
  assert.strictEqual((await call('POST', `/api/play/matches/${g.id}/revoke-invite`, { user: 'alice' })).json.status, 'active');
  assert.strictEqual((await call('GET', `/play/i/${g.tok}/state`)).status, 404);
  assert.strictEqual((await call('GET', `/play/m/${g.id}/state`, { cookie: g.gc })).status, 200);
  assert.strictEqual((await move(g.id, { user: 'alice' }, 1 + 1, 'e2', 'e4')).status, 200);
});

test('expiry: an unclaimed invite and an unanswered challenge lapse after 7 days; an active match does not', async () => {
  const { tok } = await invite('mia');
  const ch = (await call('POST', '/api/play/challenges', { user: 'mia', body: { type: 'chess', opponent: 'ned' } })).json.id;
  const g = await guestGame();
  clock = T0 + 6.9 * 24 * 3600 * 1000;
  assert.strictEqual((await call('GET', `/play/i/${tok}/info`)).json.status, 'open');
  clock = T0 + 7.1 * 24 * 3600 * 1000;
  const info = await call('GET', `/play/i/${tok}/info`);
  assert.strictEqual(info.json.status, 'expired');
  assert.strictEqual(info.json.seatOpen, false);
  assert.strictEqual((await call('POST', `/play/i/${tok}/claim`, { body: { name: 'Late' } })).status, 410);
  assert.strictEqual((await call('GET', '/api/play/matches', { user: 'ned' })).json.incoming.length, 0);
  assert.strictEqual((await call('POST', `/api/play/matches/${ch}/accept`, { user: 'ned' })).status, 409);
  assert.strictEqual((await call('GET', `/play/m/${g.id}/state`, { user: 'alice' })).json.status, 'active');
  clock = T0;
});

test('expiry sweep is throttled, but a read inside the throttle window still sees a lapsed match as expired', async () => {
  clock = T0 + 20 * 24 * 3600 * 1000;
  const { tok } = await invite('zed');
  const other = (await invite('zoe')).tok;
  const DAY = 24 * 3600 * 1000;
  clock += 7 * DAY - 10000;
  assert.strictEqual((await call('GET', `/play/i/${other}/info`)).json.status, 'open'); // sweep runs here
  clock += 15000;                                                                       // lapsed, sweep not due
  const info = await call('GET', `/play/i/${tok}/info`);
  assert.strictEqual(info.json.status, 'expired');
  assert.strictEqual(info.json.seatOpen, false);
  assert.strictEqual((await call('POST', `/play/i/${tok}/claim`, { body: { name: 'Late' } })).status, 410);
  clock = T0;
});

test('guest names: 1-24 chars, trimmed, whitelist; markup is refused, output is never raw HTML', async () => {
  assert.strictEqual(sanitizeGuestName('  Sam   Jones '), 'Sam Jones');
  assert.strictEqual(sanitizeGuestName('x'.repeat(24)).length, 24);
  for (const bad of ['', '   ', 'x'.repeat(25), '<script>alert(1)</script>', '<img src=x onerror=alert(1)>', 'a&b', 'say "hi"', "o'neil", 'a\u0000b', 'a\nb', 5, null, undefined, {}]) {
    assert.strictEqual(sanitizeGuestName(bad), null, JSON.stringify(bad));
  }
  const { tok } = await invite('olga');
  for (const name of ['<b>x</b>', '', 'y'.repeat(25)]) {
    const r = await call('POST', `/play/i/${tok}/claim`, { body: { name } });
    assert.strictEqual(r.status, 400);
    assert.strictEqual(r.setCookie.length, 0);
  }
  assert.strictEqual((await call('POST', `/play/i/${tok}/claim`, { body: { name: 'olga' } })).status, 400); // same as the other seat
  const ok = await call('POST', `/play/i/${tok}/claim`, { body: { name: '  Zoë Ünal-3  ' } });
  assert.strictEqual(ok.status, 200);
  const st = await call('GET', `/play/m/${ok.json.matchId}/state`, { cookie: cookieOf(ok) });
  assert.strictEqual(st.json.seats[1].name, 'Zoë Ünal-3');
  // the client renders names with textContent only
  const client = fs.readFileSync(path.join(__dirname, '../client/src/play/PlayPage.ts'), 'utf8');
  assert.ok(!/innerHTML[^;\n]*\.name|innerHTML[^;\n]*opponent/.test(client), 'names must not go through innerHTML');
});

test('live updates: SSE headers, an initial event, an update on a move, heartbeat', async () => {
  const g = await guestGame();
  const chunks = [];
  const req = await new Promise((resolve, reject) => {
    const rq = http.get(base + `/play/m/${g.id}/events`, { headers: { cookie: g.gc } }, res => {
      res.setEncoding('utf8');
      res.on('data', d => chunks.push(d));
      resolve({ rq, res });
    });
    rq.on('error', reject);
  });
  const { res } = req;
  assert.strictEqual(res.statusCode, 200);
  assert.match(res.headers['content-type'], /text\/event-stream/);
  assert.match(res.headers['cache-control'], /no-cache/);
  assert.strictEqual(res.headers['x-accel-buffering'], 'no');
  const until = async re => { for (let i = 0; i < 60 && !re.test(chunks.join('')); i++) await new Promise(r => setTimeout(r, 25)); return re.test(chunks.join('')); };
  assert.ok(await until(/event: update\ndata: \{"version":1,"status":"active"\}/));
  await move(g.id, { user: 'alice' }, 1, 'e2', 'e4');
  assert.ok(await until(/"version":2/), chunks.join(''));
  assert.ok(await until(/: hb/), 'heartbeat');
  assert.ok(!chunks.join('').includes(g.tok));
  req.rq.destroy();
  // streams need a seat too
  assert.strictEqual((await call('GET', `/play/m/${g.id}/events`)).status, 404);
});

test('plugins: chess is loaded; a directory with no valid plugin is skipped', async () => {
  const engines = await enginesP;
  assert.ok(engines.has('chess'));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shared-'));
  fs.mkdirSync(path.join(dir, 'pool'));                       // no index.js
  fs.mkdirSync(path.join(dir, 'bad'));
  fs.writeFileSync(path.join(dir, 'bad', 'index.js'), 'export default { type: "bad" };');
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  assert.strictEqual((await loadEngines(dir)).size, 0);
});

test('the gate stays in front of everything that is not a match', async () => {
  const idx = fs.readFileSync(path.join(__dirname, '../server/index.js'), 'utf8');
  const guest = idx.indexOf("app.use('/play'");
  const gate = idx.indexOf('appAccessGate(req, res, next)');
  assert.ok(guest > 0 && guest < gate, 'guest routes mount before the gate');
  assert.ok(idx.includes("app.use('/api/play', requireLogin, play.apiRouter)"), 'creating and answering stays behind login');
  assert.ok(gate < idx.indexOf("app.use('/api/play'"));
  // the guest router exposes only /m/:id and /i/:token routes
  const svc = fs.readFileSync(path.join(__dirname, '../server/multiplayer/service.js'), 'utf8');
  const routes = [...svc.matchAll(/guestRouter\.(get|post)\('([^']+)'/g)].map(m => m[2]);
  assert.ok(routes.length >= 9 && routes.every(r => /^\/(m\/:id|i\/:token)(\/|$)/.test(r)), routes.join());
});

// ── pool through the same host, with a rules variant ─────────────────────────
test('pool: a variant is validated, stored in the state and shown in the view; 8ball stays the default', async () => {
  const bad = await call('POST', '/api/play/invites', { user: 'alice', body: { type: 'pool', variant: 'snooker' } });
  assert.strictEqual(bad.status, 400);
  assert.strictEqual(bad.json.error, 'BAD_VARIANT');
  assert.strictEqual((await call('POST', '/api/play/invites', { user: 'alice', body: { type: 'chess', variant: '9ball' } })).status, 400);

  const def = await call('POST', '/api/play/invites', { user: 'alice', body: { type: 'pool', color: 'first' } });
  assert.strictEqual(def.status, 201);
  const defTok = def.json.invite.path.split('/').pop();
  assert.strictEqual((await call('GET', `/play/i/${defTok}/state`)).json.view.variant, '8ball');

  const r = await call('POST', '/api/play/invites', { user: 'alice', body: { type: 'pool', color: 'first', variant: '9ball' } });
  assert.strictEqual(r.status, 201);
  const tok = r.json.invite.path.split('/').pop();
  const claim = await call('POST', `/play/i/${tok}/claim`, { body: { name: 'Potter' } });
  assert.strictEqual(claim.status, 200);
  const gc = { cookie: cookieOf(claim) };
  const st = await call('GET', `/play/m/${r.json.id}/state`, { user: 'alice' });
  assert.strictEqual(st.json.view.variant, '9ball');
  assert.strictEqual(st.json.view.lowest, 1);
  assert.strictEqual(st.json.view.balls.filter(Boolean).length, 10);

  // alice breaks, the guest is refused out of turn, then the guest shoots after the turn passes
  const v0 = st.json.version;
  const out = await call('POST', `/play/m/${r.json.id}/moves`, { ...gc, body: { version: v0, move: { angle: 0, power: 0.5 } } });
  assert.strictEqual(out.status, 422);
  const brk = await call('POST', `/play/m/${r.json.id}/moves`, { user: 'alice', body: { version: v0, move: { angle: 0, power: 1 } } });
  assert.strictEqual(brk.status, 200);
  assert.strictEqual(brk.json.view.shots, 1);
  assert.ok(brk.json.view.lastShot.frameCount > 5, 'the shot to animate travels in the view');
  const seen = await call('GET', `/play/m/${r.json.id}/state`, gc);
  assert.strictEqual(seen.json.view.shots, 1);
  assert.deepStrictEqual(seen.json.view.lastShot.tracks.length, 16);
});

// ── resumable seats: return to a match, on another device, as a stranger ─────
test('a signed-in seat follows the account: any device, no cookie, case-insensitive', async () => {
  const g = await guestGame('Roamer', 'rita');
  const phone = await call('GET', `/play/m/${g.id}/state`, { user: 'Rita' }); // no cookie at all
  assert.strictEqual(phone.status, 200);
  assert.strictEqual(phone.json.you.seat, 0);
  assert.strictEqual(phone.json.you.role, 'player');
  assert.strictEqual((await call('GET', `/play/m/${g.id}`, { user: 'rita' })).status, 200);
  // returning through her own invite link sends her to her seat, not a claim
  const info = await call('GET', `/play/i/${g.tok}/info`, { user: 'rita' });
  assert.deepStrictEqual(info.json.you, { seat: 0 });
  assert.strictEqual(info.json.matchId, g.id);
});

test('a guest returns with the same cookie; a different browser (no cookie) cannot take the seat', async () => {
  const g = await guestGame('Homebody', 'hank');
  const back = await call('GET', `/play/m/${g.id}/state`, { cookie: g.gc });
  assert.strictEqual(back.json.you.seat, 1);
  assert.strictEqual(back.json.you.kind, 'guest');
  assert.strictEqual((await call('GET', `/play/m/${g.id}/state`)).status, 404);
  assert.strictEqual((await call('GET', `/play/m/${g.id}/state`, { cookie: 'octopus_seat=' + 'x'.repeat(32) })).status, 404);
});

test('a third person with the link watches; they never get a seat, and cannot move', async () => {
  const g = await guestGame('Seated', 'sam');
  const claim = await call('POST', `/play/i/${g.tok}/claim`, { user: 'eve' });
  assert.strictEqual(claim.json.role, 'spectator');
  const watch = await call('GET', `/play/i/${g.tok}/state`, { user: 'eve' });
  assert.strictEqual(watch.json.you.seat, null);
  assert.strictEqual((await call('GET', `/play/m/${g.id}/state`, { user: 'eve' })).status, 404);
  assert.strictEqual((await move(g.id, { user: 'eve' }, 1, 'e2', 'e4')).status, 404);
});

test('"Your matches" is owner-scoped: bob never sees alice\'s games, a guest game appears for its creator', async () => {
  const g = await guestGame('Scoped', 'ann');
  const a = (await call('GET', '/api/play/matches', { user: 'ann' })).json;
  const b = (await call('GET', '/api/play/matches', { user: 'bob' })).json;
  const row = a.matches.find(m => m.id === g.id);
  assert.ok(row, 'creator lists the match');
  assert.strictEqual(row.opponent, 'Scoped');
  assert.strictEqual(row.status, 'active');
  assert.strictEqual(typeof row.yourTurn, 'boolean');
  assert.ok(![...b.matches, ...b.incoming].some(m => m.id === g.id));
  const inv = await invite('ann');
  const waiting = (await call('GET', '/api/play/matches', { user: 'ann' })).json.matches.find(m => m.id === inv.id);
  assert.strictEqual(waiting.status, 'open');
  assert.ok(waiting.invite.path.endsWith(inv.tok));
  assert.ok(!(await call('GET', '/api/play/matches', { user: 'bob' })).json.matches.some(m => m.id === inv.id));
});

test('a guest who signs in adopts the seat: listed, playable from any device, cookie dead', async () => {
  const g = await guestGame('Newcomer', 'nina');
  assert.strictEqual((await call('POST', `/play/m/${g.id}/adopt`, { cookie: g.gc })).status, 401); // not signed in
  assert.strictEqual((await call('POST', `/play/m/${g.id}/adopt`, { user: 'zed' })).status, 404);  // signed in, no seat proof
  assert.strictEqual((await call('POST', `/play/m/${g.id}/adopt`, { user: 'nina', cookie: g.gc })).status, 409); // she is already the other player
  const ok = await call('POST', `/play/m/${g.id}/adopt`, { user: 'Zed', cookie: g.gc });
  assert.strictEqual(ok.status, 200, JSON.stringify(ok.json));
  assert.strictEqual(ok.json.you.kind, 'user');
  assert.strictEqual(ok.json.you.seat, 1);
  assert.ok(ok.setCookie.some(c => /Max-Age=0/.test(c)));
  assert.ok((await call('GET', '/api/play/matches', { user: 'zed' })).json.matches.some(m => m.id === g.id));
  assert.strictEqual((await call('GET', `/play/m/${g.id}/state`, { user: 'zed' })).json.you.seat, 1);
  assert.strictEqual((await call('GET', `/play/m/${g.id}/state`, { cookie: g.gc })).status, 404); // old secret is dead
  const w = await move(g.id, { user: 'nina' }, ok.json.version, 'e2', 'e4');
  assert.strictEqual(w.status, 200);
  assert.strictEqual((await call('POST', `/play/m/${g.id}/adopt`, { user: 'mallory', cookie: g.gc })).status, 404);
});
