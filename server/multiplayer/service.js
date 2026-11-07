'use strict';
/**
 * Two-seat turn-based matches: challenges, invite links, guests, live updates.
 * Read MULTIPLAYER.md before changing anything here; the access rules are the
 * point of this file.
 *
 *   guestRouter  mounted at /play BEFORE the SSO and app-access gates. Exposes
 *                one match per request (page, state, moves, events) and nothing else.
 *   apiRouter    mounted at /api/play behind login and the app gate: create and
 *                answer challenges, create and revoke invite links, list mine.
 *
 * Tokens (invite tokens, guest seat tokens) are never logged and never put in a
 * query string. The server is authoritative: clients send moves, the plugin validates.
 */
const crypto = require('crypto');
const express = require('express');
const { Op } = require('sequelize');
const { isIllegalMove } = require('./engines');

const DEFAULT_LIMITS = {
  openPerUser: 20,          // matches a user may have in challenge / open / active at once
  inviteDays: 7,            // an unclaimed invite or unanswered challenge expires after this
  pendingPerTarget: 3,      // unanswered challenges from one user to one name
  moveWindowMs: 10000, moveMax: 10,   // per seat
  sseMaxPerMatch: 40,
  heartbeatMs: 25000,
  cookieMaxAgeS: 30 * 24 * 3600,
};
const SEAT_COOKIE = 'octopus_seat';
const LIVE = ['challenge', 'open', 'active'];
const TOKEN_RE = /^[A-Za-z0-9_-]{32}$/;
const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const USERNAME_RE = /^[A-Za-z0-9_.-]{1,64}$/;

const newToken = () => crypto.randomBytes(24).toString('base64url'); // 192 bits, 32 chars
const sha = s => crypto.createHash('sha256').update(String(s)).digest('hex');
const safeEq = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length === b.length &&
  crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
const lc = s => String(s).toLowerCase();

/** Guest display name: 1-24 characters, trimmed, letters/digits/space/_ - . only. */
function sanitizeGuestName(raw) {
  if (typeof raw !== 'string') return null;
  if (/[\p{C}]/u.test(raw)) return null;                 // control characters, newlines, tabs
  const name = raw.normalize('NFC').trim().replace(/ +/g, ' ');
  if (!name || [...name].length > 24) return null;
  if (!/^[\p{L}\p{N} _.-]+$/u.test(name)) return null;
  return name;
}
const escapeHtml = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function cookieValue(req, name) {
  const raw = req.headers.cookie;
  if (!raw) return null;
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

const asyncH = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function createPlay({ getModels, getEngines, indexFile, now = Date.now, limits = {} }) {
  const L = { ...DEFAULT_LIMITS, ...limits };
  const models = () => getModels();
  const date = () => new Date(now());

  // ── live updates ────────────────────────────────────────────────────────────
  const streams = new Map(); // matchId -> Set<{ res, role, timer }>
  function broadcast(m) {
    const set = streams.get(m.id);
    if (!set) return;
    const data = JSON.stringify({ version: m.version, status: m.status });
    for (const c of set) { try { c.res.write(`event: update\ndata: ${data}\n\n`); } catch { /* closed */ } }
  }
  function closeSpectators(matchId) {
    const set = streams.get(matchId);
    if (!set) return;
    for (const c of set) if (c.role === 'spectator') { try { c.res.write('event: closed\ndata: {}\n\n'); c.res.end(); } catch { /* gone */ } }
  }
  function openStream(req, res, m, role) {
    const set = streams.get(m.id) || new Set();
    if (set.size >= L.sseMaxPerMatch) return res.status(429).json({ error: 'TOO_MANY_STREAMS' });
    res.status(200).set({
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-store, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();
    res.write(`retry: 3000\nevent: update\ndata: ${JSON.stringify({ version: m.version, status: m.status })}\n\n`);
    const client = { res, role, timer: null };
    client.timer = setInterval(() => { try { res.write(': hb\n\n'); } catch { /* closed */ } }, L.heartbeatMs);
    if (client.timer.unref) client.timer.unref();
    set.add(client);
    streams.set(m.id, set);
    req.on('close', () => {
      clearInterval(client.timer);
      set.delete(client);
      if (!set.size) streams.delete(m.id);
    });
    return undefined;
  }

  // ── per-seat move rate limit ────────────────────────────────────────────────
  const moveTimes = new Map();
  function moveAllowed(matchId, seat) {
    const key = `${matchId}:${seat}`;
    const t = now();
    const recent = (moveTimes.get(key) || []).filter(x => t - x < L.moveWindowMs);
    if (recent.length >= L.moveMax) { moveTimes.set(key, recent); return false; }
    recent.push(t);
    moveTimes.set(key, recent);
    if (moveTimes.size > 5000) for (const [k, v] of moveTimes) if (!v.length || t - v[v.length - 1] > L.moveWindowMs) moveTimes.delete(k);
    return true;
  }

  // ── lookups ─────────────────────────────────────────────────────────────────
  async function expireStale() {
    const { Match } = models();
    await Match.update({ status: 'expired' }, { where: { status: { [Op.in]: ['challenge', 'open'] }, expiresAt: { [Op.lt]: date() } } });
  }
  const byId = async id => (ID_RE.test(String(id)) ? models().Match.findByPk(id) : null);
  const byToken = async tok => (TOKEN_RE.test(String(tok)) ? models().Match.findOne({ where: { inviteToken: tok } }) : null);

  function actorFor(req, m) {
    if (req.user && req.user.username) {
      const key = lc(req.user.username);
      for (const i of [0, 1]) if (m[`seat${i}Kind`] === 'user' && m[`seat${i}Key`] === key) return { seat: i, kind: 'user' };
    }
    const tok = cookieValue(req, SEAT_COOKIE);
    if (tok && TOKEN_RE.test(tok)) {
      const h = sha(tok);
      for (const i of [0, 1]) if (m[`seat${i}Kind`] === 'guest' && safeEq(h, m[`seat${i}TokenHash`])) return { seat: i, kind: 'guest', token: tok };
    }
    return { seat: null, kind: null };
  }

  const isCreator = (req, m) => !!req.user && lc(req.user.username) === lc(m.createdBy);

  /** One match as one viewer may see it. Never includes hashes or other people's tokens. */
  async function present(m, actor, req) {
    const engine = (await getEngines()).get(m.type);
    const state = JSON.parse(m.state);
    const creatorKey = lc(m.createdBy);
    const seats = [0, 1].map(i => ({
      name: m[`seat${i}Name`], kind: m[`seat${i}Kind`],
      joined: !!m[`seat${i}Kind`] && !(m.status === 'challenge' && m[`seat${i}Key`] !== creatorKey),
    }));
    const live = m.status === 'active' || m.status === 'finished';
    const out = {
      id: m.id, type: m.type, status: m.status, version: m.version,
      createdBy: m.createdBy, createdAt: m.createdAt, lastMoveAt: m.lastMoveAt, expiresAt: m.expiresAt,
      seats,
      you: { seat: actor.seat, role: actor.seat === null ? 'spectator' : 'player', kind: actor.kind,
             creator: actor.seat !== null && isCreator(req, m) },
      game: engine ? engine.status(state) : null,
      view: engine ? engine.view(state, live ? actor.seat : null) : null,
    };
    if (out.you.creator && m.inviteToken) out.invite = { path: `/play/i/${m.inviteToken}` };
    return out;
  }

  const noStore = (_req, res, next) => {
    res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex' });
    next();
  };
  const notFound = res => res.status(404).json({ error: 'NOT_FOUND' });
  const sendPage = (res) => res.sendFile(indexFile);
  const errorHandler = (err, _req, res, _next) => {
    console.error('[play]', err && err.message); // message only: never a request, header or token
    if (!res.headersSent) res.status(500).json({ error: 'SERVER_ERROR' });
  };

  // ═══ guest-reachable routes ═════════════════════════════════════════════════
  const guestRouter = express.Router();
  guestRouter.use(noStore);

  // ---- seat holders: /play/m/:id/* -------------------------------------------
  async function seatMatch(req, res) {
    await expireStale();
    const m = await byId(req.params.id);
    if (!m) { notFound(res); return null; }
    const actor = actorFor(req, m);
    if (actor.seat === null) { notFound(res); return null; }
    return { m, actor };
  }

  guestRouter.get('/m/:id', asyncH(async (req, res) => {
    const r = await seatMatch(req, res);
    if (r) sendPage(res);
  }));

  guestRouter.get('/m/:id/state', asyncH(async (req, res) => {
    const r = await seatMatch(req, res);
    if (!r) return;
    if (r.actor.kind === 'guest') { // keep a long-running correspondence game signed in
      res.append('Set-Cookie', seatCookie(r.m.id, r.actor.token));
    }
    res.json(await present(r.m, r.actor, req));
  }));

  guestRouter.get('/m/:id/events', asyncH(async (req, res) => {
    const r = await seatMatch(req, res);
    if (r) openStream(req, res, r.m, 'player');
  }));

  guestRouter.post('/m/:id/moves', asyncH(async (req, res) => {
    const r = await seatMatch(req, res);
    if (!r) return;
    const { m, actor } = r;
    const body = req.body || {};
    if (!Number.isInteger(body.version) || !body.move || typeof body.move !== 'object' ||
        JSON.stringify(body.move).length > 2000) {
      return res.status(400).json({ error: 'BAD_REQUEST' });
    }
    if (m.status !== 'active') return res.status(409).json({ error: 'NOT_ACTIVE', status: m.status, version: m.version });
    if (!moveAllowed(m.id, actor.seat)) return res.status(429).json({ error: 'RATE_LIMITED' });
    if (body.version !== m.version) return res.status(409).json({ error: 'STALE', version: m.version });

    const engine = (await getEngines()).get(m.type);
    if (!engine) return res.status(500).json({ error: 'SERVER_ERROR' });
    let result;
    try {
      result = engine.applyMove(JSON.parse(m.state), body.move, actor.seat);
    } catch (e) {
      if (isIllegalMove(e)) return res.status(422).json({ error: 'ILLEGAL_MOVE', message: String(e.message).slice(0, 200) });
      throw e;
    }
    const game = engine.status(result.state);
    const { Match, MatchMove } = models();
    // The version guard is the concurrency control: of two moves based on the
    // same version, exactly one update matches.
    const [n] = await Match.update({
      state: JSON.stringify(result.state), version: m.version + 1, lastMoveAt: date(),
      status: game.over ? 'finished' : 'active',
      winner: game.over ? game.winner : null, reason: game.over ? game.reason : null,
    }, { where: { id: m.id, version: m.version, status: 'active' } });
    if (!n) {
      await m.reload();
      return res.status(409).json({ error: 'STALE', version: m.version });
    }
    try {
      await MatchMove.create({ matchId: m.id, ply: m.version + 1, seat: actor.seat,
        move: JSON.stringify(body.move), events: JSON.stringify(result.events || []) });
    } catch (e) { console.error('[play] move log failed:', e.message); }
    await m.reload();
    broadcast(m);
    res.json(await present(m, actor, req));
  }));

  // ---- invite links: /play/i/:token/* ----------------------------------------
  async function linkMatch(req, res) {
    await expireStale();
    const m = await byToken(req.params.token);
    if (!m) { notFound(res); return null; }
    return { m, actor: actorFor(req, m) };
  }

  guestRouter.get('/i/:token', asyncH(async (req, res) => {
    const r = await linkMatch(req, res);
    if (r) sendPage(res);
  }));

  guestRouter.get('/i/:token/info', asyncH(async (req, res) => {
    const r = await linkMatch(req, res);
    if (!r) return;
    const { m, actor } = r;
    const engine = (await getEngines()).get(m.type);
    res.json({
      type: m.type, title: engine ? engine.title || m.type : m.type, status: m.status,
      host: m.createdBy, seatOpen: m.status === 'open',
      you: actor.seat === null ? null : { seat: actor.seat }, matchId: actor.seat === null ? null : m.id,
    });
  }));

  guestRouter.get('/i/:token/state', asyncH(async (req, res) => {
    const r = await linkMatch(req, res);
    if (r) res.json(await present(r.m, r.actor, req));
  }));

  guestRouter.get('/i/:token/events', asyncH(async (req, res) => {
    const r = await linkMatch(req, res);
    if (r) openStream(req, res, r.m, r.actor.seat === null ? 'spectator' : 'player');
  }));

  const seatCookie = (matchId, token) =>
    `${SEAT_COOKIE}=${token}; Path=/play/m/${matchId}; Max-Age=${L.cookieMaxAgeS}; HttpOnly; Secure; SameSite=Lax`;

  guestRouter.post('/i/:token/claim', asyncH(async (req, res) => {
    const r = await linkMatch(req, res);
    if (!r) return;
    const { m, actor } = r;
    if (actor.seat !== null) return res.json({ matchId: m.id, role: 'player', seat: actor.seat });
    if (m.status === 'expired') return res.status(410).json({ error: 'EXPIRED' });
    if (m.status !== 'open') return res.json({ role: 'spectator', status: m.status });

    const free = m.seat0Kind ? 1 : 0;
    const { Match } = models();
    const values = { status: 'active', version: m.version + 1, lastMoveAt: date(), expiresAt: null };
    let guestToken = null;
    if (req.user) {
      const key = lc(req.user.username);
      if (await openCount(req.user.username, key) >= L.openPerUser) return res.status(429).json({ error: 'TOO_MANY_MATCHES' });
      Object.assign(values, { [`seat${free}Kind`]: 'user', [`seat${free}Name`]: req.user.username, [`seat${free}Key`]: key });
    } else {
      const name = sanitizeGuestName((req.body || {}).name);
      if (!name) return res.status(400).json({ error: 'BAD_NAME', message: 'Use 1-24 letters, numbers, spaces, dots, dashes or underscores.' });
      if (lc(name) === lc(m[`seat${1 - free}Name`] || '')) return res.status(400).json({ error: 'NAME_TAKEN' });
      guestToken = newToken();
      Object.assign(values, { [`seat${free}Kind`]: 'guest', [`seat${free}Name`]: name, [`seat${free}Key`]: null, [`seat${free}TokenHash`]: sha(guestToken) });
    }
    // Exactly one claimant can match "still open and this seat still empty".
    const [n] = await Match.update(values, { where: { id: m.id, status: 'open', [`seat${free}Kind`]: null } });
    await m.reload();
    if (!n) return res.json({ role: 'spectator', status: m.status });
    if (guestToken) res.append('Set-Cookie', seatCookie(m.id, guestToken));
    broadcast(m);
    res.json({ matchId: m.id, role: 'player', seat: free });
  }));

  guestRouter.use(errorHandler);

  // ═══ signed-in routes ═══════════════════════════════════════════════════════
  const apiRouter = express.Router();
  apiRouter.use(noStore);

  async function openCount(username, key) {
    const { Match } = models();
    return Match.count({ where: {
      status: { [Op.in]: LIVE },
      [Op.or]: [
        { createdBy: username },
        { status: 'active', [Op.or]: [{ seat0Key: key }, { seat1Key: key }] },
      ],
    } });
  }

  async function parseCreate(req, res) {
    await expireStale();
    const engines = await getEngines();
    const { type, color, variant } = req.body || {};
    if (typeof type !== 'string' || !engines.has(type)) { res.status(400).json({ error: 'UNKNOWN_TYPE' }); return null; }
    if (color !== undefined && !['white', 'black', 'random', 'first', 'second'].includes(color)) { res.status(400).json({ error: 'BAD_COLOR' }); return null; }
    // Rules variant (pool: '8ball' | '9ball'). Only what the engine lists is accepted.
    const engine = engines.get(type);
    if (variant !== undefined && !(Array.isArray(engine.variants) && engine.variants.includes(variant))) { res.status(400).json({ error: 'BAD_VARIANT' }); return null; }
    if (await openCount(req.user.username, lc(req.user.username)) >= L.openPerUser) {
      res.status(429).json({ error: 'TOO_MANY_MATCHES', message: `You can have at most ${L.openPerUser} open matches.` });
      return null;
    }
    const mine = color === 'white' || color === 'first' ? 0 : color === 'black' || color === 'second' ? 1 : crypto.randomInt(0, 2);
    const seed = crypto.randomBytes(8).toString('hex');
    return { engine, type, mine, seed, variant };
  }

  function baseValues(req, c, status) {
    const me = req.user.username;
    return {
      id: crypto.randomUUID(), type: c.type, status, seed: c.seed, version: 0,
      state: JSON.stringify(c.engine.initialState(c.seed, c.variant === undefined ? undefined : { variant: c.variant })),
      createdBy: me, expiresAt: new Date(now() + L.inviteDays * 24 * 3600 * 1000),
      [`seat${c.mine}Kind`]: 'user', [`seat${c.mine}Name`]: me, [`seat${c.mine}Key`]: lc(me),
    };
  }

  apiRouter.get('/types', asyncH(async (_req, res) => {
    const engines = await getEngines();
    res.json([...engines.values()].map(e => ({ type: e.type, title: e.title || e.type })));
  }));

  // Challenge a username. The username is NOT looked up: a name nobody holds
  // gets the same 201 and the same pending match as one somebody does.
  apiRouter.post('/challenges', asyncH(async (req, res) => {
    const opp = (req.body || {}).opponent;
    if (typeof opp !== 'string' || !USERNAME_RE.test(opp.trim())) return res.status(400).json({ error: 'BAD_USERNAME' });
    const target = opp.trim();
    if (lc(target) === lc(req.user.username)) return res.status(400).json({ error: 'SELF_CHALLENGE' });
    const c = await parseCreate(req, res);
    if (!c) return;
    const { Match } = models();
    const pending = await Match.count({ where: { status: 'challenge', createdBy: req.user.username, [Op.or]: [{ seat0Key: lc(target) }, { seat1Key: lc(target) }] } });
    if (pending >= L.pendingPerTarget) return res.status(429).json({ error: 'TOO_MANY_PENDING' });
    const m = await Match.create({
      ...baseValues(req, c, 'challenge'),
      [`seat${1 - c.mine}Kind`]: 'user', [`seat${1 - c.mine}Name`]: target, [`seat${1 - c.mine}Key`]: lc(target),
    });
    res.status(201).json({ id: m.id, status: m.status });
  }));

  apiRouter.post('/invites', asyncH(async (req, res) => {
    const c = await parseCreate(req, res);
    if (!c) return;
    const token = newToken();
    const m = await models().Match.create({ ...baseValues(req, c, 'open'), inviteToken: token });
    res.status(201).json({ id: m.id, status: m.status, invite: { path: `/play/i/${token}` } });
  }));

  async function mineOr404(req, res) {
    await expireStale();
    const m = await byId(req.params.id);
    const actor = m && actorFor(req, m);
    if (!m || actor.seat === null) { notFound(res); return null; }
    return { m, actor };
  }
  async function setStatus(m, from, values) {
    const [n] = await models().Match.update({ ...values, version: m.version + 1 }, { where: { id: m.id, status: from, version: m.version } });
    await m.reload();
    return n;
  }

  apiRouter.post('/matches/:id/accept', asyncH(async (req, res) => {
    const r = await mineOr404(req, res);
    if (!r) return;
    const { m, actor } = r;
    if (m.status !== 'challenge' || isCreator(req, m)) return res.status(409).json({ error: 'NOT_PENDING' });
    if (await openCount(req.user.username, lc(req.user.username)) >= L.openPerUser) return res.status(429).json({ error: 'TOO_MANY_MATCHES' });
    const n = await setStatus(m, 'challenge', { status: 'active', lastMoveAt: date(), expiresAt: null,
      [`seat${actor.seat}Name`]: req.user.username });
    if (!n) return res.status(409).json({ error: 'NOT_PENDING' });
    broadcast(m);
    res.json(await present(m, actorFor(req, m), req));
  }));

  apiRouter.post('/matches/:id/decline', asyncH(async (req, res) => {
    const r = await mineOr404(req, res);
    if (!r) return;
    if (r.m.status !== 'challenge' || isCreator(req, r.m)) return res.status(409).json({ error: 'NOT_PENDING' });
    if (!await setStatus(r.m, 'challenge', { status: 'declined' })) return res.status(409).json({ error: 'NOT_PENDING' });
    broadcast(r.m);
    res.json({ id: r.m.id, status: r.m.status });
  }));

  apiRouter.post('/matches/:id/cancel', asyncH(async (req, res) => {
    const r = await mineOr404(req, res);
    if (!r) return;
    if (!isCreator(req, r.m)) return notFound(res);
    if (!['challenge', 'open'].includes(r.m.status)) return res.status(409).json({ error: 'NOT_PENDING' });
    if (!await setStatus(r.m, r.m.status, { status: 'cancelled', inviteToken: null })) return res.status(409).json({ error: 'NOT_PENDING' });
    broadcast(r.m); closeSpectators(r.m.id);
    res.json({ id: r.m.id, status: r.m.status });
  }));

  // Revoke the link. Unclaimed: the match is dead. In play: the players keep
  // playing, but the link stops working and spectators are dropped.
  apiRouter.post('/matches/:id/revoke-invite', asyncH(async (req, res) => {
    const r = await mineOr404(req, res);
    if (!r) return;
    if (!isCreator(req, r.m)) return notFound(res);
    const { Match } = models();
    if (!r.m.inviteToken) return res.status(409).json({ error: 'NO_INVITE' });
    const values = { inviteToken: null, inviteRevokedAt: date(), version: r.m.version + 1 };
    if (r.m.status === 'open') values.status = 'revoked';
    const [n] = await Match.update(values, { where: { id: r.m.id, version: r.m.version } });
    await r.m.reload();
    if (!n) return res.status(409).json({ error: 'STALE' });
    broadcast(r.m); closeSpectators(r.m.id);
    res.json({ id: r.m.id, status: r.m.status });
  }));

  apiRouter.get('/matches', asyncH(async (req, res) => {
    await expireStale();
    const { Match } = models();
    const me = req.user.username, key = lc(me);
    const engines = await getEngines();
    const rows = await Match.findAll({
      where: { [Op.or]: [{ seat0Key: key }, { seat1Key: key }] },
      order: [['updatedAt', 'DESC']], limit: 100,
    });
    const shape = m => {
      const seat = m.seat0Key === key ? 0 : 1;
      const state = JSON.parse(m.state);
      const engine = engines.get(m.type);
      const game = engine ? engine.status(state) : null;
      const opp = m[`seat${1 - seat}Name`];
      return {
        id: m.id, type: m.type, status: m.status, version: m.version, createdBy: m.createdBy,
        seat, opponent: opp, opponentKind: m[`seat${1 - seat}Kind`],
        yourTurn: m.status === 'active' && !!game && game.turn === seat,
        winner: m.winner, reason: m.reason, lastMoveAt: m.lastMoveAt, expiresAt: m.expiresAt,
        ...(lc(m.createdBy) === key && m.inviteToken ? { invite: { path: `/play/i/${m.inviteToken}` } } : {}),
      };
    };
    const incoming = rows.filter(m => m.status === 'challenge' && lc(m.createdBy) !== key).slice(0, 50).map(shape);
    const matches = rows.filter(m => !(m.status === 'challenge' && lc(m.createdBy) !== key))
      .filter(m => LIVE.includes(m.status) || m.status === 'finished').slice(0, 50).map(shape);
    res.json({ incoming, matches });
  }));

  apiRouter.use(errorHandler);

  return { guestRouter, apiRouter, streams, _internal: { sanitizeGuestName, escapeHtml } };
}

module.exports = { createPlay, sanitizeGuestName, escapeHtml, SEAT_COOKIE, DEFAULT_LIMITS };
