const express = require('express');
const axios = require('axios');
const path = require('path');
const { initDb, Setting } = require('./database');
const gamesRouter = require('./routes/games');
const wikiRouter  = require('./routes/wiki');

const app = express();
const PORT = process.env.PORT || 3013;
const AUTH_INTERNAL_URL = process.env.AUTH_SERVICE_URL || 'http://octopus-auth:3002';
const AUTH_EXTERNAL_URL = process.env.AUTH_EXTERNAL_URL || '';
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'psychopathy';

app.use(express.json());

// ── Stateless SSO auth ────────────────────────────────────────────────────────
// Verify the shared octopus_sso cookie against octopus-auth (cached) → req.user.
const SSO_COOKIE      = 'octopus_sso';
const AUTH_LOGIN_BASE = process.env.AUTH_PUBLIC_URL || AUTH_EXTERNAL_URL || 'https://auth.octopustechnology.net';
const _verifyCache = new Map();

function parseCookies(req) {
  const out = {};
  const header = req.headers.cookie;
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > -1) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

async function verifyToken(token) {
  const cached = _verifyCache.get(token);
  if (cached && cached.exp > Date.now()) return cached.user;
  try {
    const r = await axios.post(`${AUTH_INTERNAL_URL}/api/auth/verify`, {}, {
      headers: { Authorization: `Bearer ${token}` }, timeout: 5000,
    });
    if (r.data && r.data.valid && r.data.user) {
      _verifyCache.set(token, { user: r.data.user, exp: Date.now() + 5 * 60 * 1000 });
      return r.data.user;
    }
  } catch { /* invalid or auth unreachable → unauthenticated */ }
  return null;
}

app.use(async (req, res, next) => {
  const token = parseCookies(req)[SSO_COOKIE];
  if (token) {
    const user = await verifyToken(token);
    if (user) req.user = { username: user.username, role: user.role, token };
  }
  next();
});

async function callAuth(endpoint, data) {
  try {
    return await axios.post(`${AUTH_INTERNAL_URL}${endpoint}`, data, { timeout: 3000 });
  } catch {
    if (!AUTH_EXTERNAL_URL) throw new Error('Auth service unreachable');
    return await axios.post(`${AUTH_EXTERNAL_URL}${endpoint}`, data, { timeout: 5000 });
  }
}

function requireLogin(req, res, next) {
  if (req.user) return next();
  res.status(401).json({ error: 'NOT_AUTHENTICATED' });
}

function requireAdmin(req, res, next) {
  if (req.user && (req.user.username === ADMIN_USERNAME || req.user.role === 'admin')) return next();
  res.status(403).json({ error: 'Forbidden' });
}

// Auth is centralized at auth.octopustechnology.net.
function doLogout(req, res) {
  const back = encodeURIComponent(`https://${req.get('host')}/`);
  res.redirect(`${AUTH_LOGIN_BASE}/logout?redirect=${back}`);
}
app.get('/logout', doLogout);
app.post('/logout', doLogout);

app.get('/api/me', (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'NOT_AUTHENTICATED' });
  res.json({ username: req.user.username, role: req.user.role });
});

// Game save API
app.use('/api/games', requireLogin, gamesRouter);

// Wiki / reference (public search + pokédex + ror2-chars; controls require login per-route)
app.use('/api/wiki', wikiRouter);

// ── Public game servers API ───────────────────────────────────────────────────
const CORTEX_URL = process.env.CORTEX_URL || 'http://octopus-cortex:3010';
const INTERNAL_SECRET = process.env.INTERNAL_SECRET || '';

app.get('/api/public/game-servers', async (req, res) => {
  try {
    const r = await axios.get(`${CORTEX_URL}/api/internal/game-servers`, {
      headers: { 'x-internal-secret': INTERNAL_SECRET },
      timeout: 8000,
    });
    const all = r.data;
    const user = req.user;
    const isAdmin = user?.username === ADMIN_USERNAME || user?.role === 'admin';

    const filtered = all.filter(s => {
      if (s.visibility === 'public') return true;
      if (!user) return false;
      if (isAdmin) return true;
      const allowed = (s.allowedUsers || '').split(',').map(u => u.trim().toLowerCase()).filter(Boolean);
      return allowed.includes(user.username.toLowerCase());
    });

    const result = filtered.map(s => {
      const base = { id: s.id, name: s.name, game: s.game, label: s.label, emoji: s.emoji, status: s.status, visibility: s.visibility };
      if (user) {
        return { ...base, serverIP: s.serverIP, port: s.port, password: s.password, gameVersion: s.gameVersion, description: s.description };
      }
      return base;
    });

    res.json(result);
  } catch (err) {
    res.status(502).json({ error: 'Could not reach game server service' });
  }
});

// ── Public game server share pages (proxied from cortex) ─────────────────────
// These are public — no login required. Cortex holds the data and renders HTML.

async function proxyCortex(req, res, cortexPath) {
  try {
    const r = await axios.get(`${CORTEX_URL}${cortexPath}`, {
      responseType: 'stream',
      timeout: 15000,
      validateStatus: () => true,
    });
    res.status(r.status);
    const ct = r.headers['content-type'];
    const cd = r.headers['content-disposition'];
    if (ct) res.setHeader('content-type', ct);
    if (cd) res.setHeader('content-disposition', cd);
    r.data.pipe(res);
  } catch (err) {
    res.status(502).send('<html><body style="background:#111;color:#e74c3c;font-family:sans-serif;padding:40px"><h2>Could not reach game server service</h2></body></html>');
  }
}

// Token-gated short links: /m/:token → cortex resolves and redirects to /modpack/:id
app.get('/m/:token', async (req, res) => {
  try {
    const r = await axios.get(`${CORTEX_URL}/m/${req.params.token}`, {
      maxRedirects: 0,
      validateStatus: () => true,
      timeout: 5000,
    });
    if (r.status === 301 || r.status === 302) {
      // Location from cortex is a relative path like /modpack/:id — redirect to same path here
      return res.redirect(r.headers.location || '/');
    }
    res.status(r.status).send(typeof r.data === 'string' ? r.data : JSON.stringify(r.data));
  } catch (err) {
    res.status(502).send('<h2>Could not reach game server service</h2>');
  }
});

// Modpack join page
app.get('/modpack/:serverId', (req, res) => proxyCortex(req, res, `/modpack/${req.params.serverId}`));

// Mod file downloads
app.get('/modpack/:serverId/download/:modId', (req, res) => proxyCortex(req, res, `/modpack/${req.params.serverId}/download/${req.params.modId}`));

// ── Arcade game visibility (admin controls which games guests can access) ─────

// Returns slug → true/false map. Missing slugs default to true (public).
app.get('/api/public/arcade-visibility', async (req, res) => {
  try {
    const row = await Setting.findByPk('arcadeVisibility');
    const map = row ? JSON.parse(row.value) : {};
    res.json(map);
  } catch {
    res.json({});
  }
});

// body: { slug, access: 'public'|'members'|'whitelist', allowedUsers?: 'user1,user2' }
app.patch('/api/admin/arcade-visibility', requireAdmin, async (req, res) => {
  const { slug, access, allowedUsers } = req.body || {};
  if (!slug || !['public', 'members', 'whitelist'].includes(access)) {
    return res.status(400).json({ error: 'slug and access (public|members|whitelist) required' });
  }
  try {
    const row = await Setting.findByPk('arcadeVisibility');
    const map = row ? JSON.parse(row.value) : {};
    map[slug] = { access, allowedUsers: allowedUsers || '' };
    await Setting.upsert({ key: 'arcadeVisibility', value: JSON.stringify(map) });
    res.json({ ok: true, map });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Game server visibility (proxied through to cortex) ────────────────────────

app.patch('/api/admin/game-servers/:id/visibility', requireAdmin, async (req, res) => {
  try {
    const { visibility, allowedUsers } = req.body || {};
    const r = await axios.patch(
      `${CORTEX_URL}/api/internal/game-servers/${req.params.id}/visibility`,
      { visibility, allowedUsers },
      { headers: { 'x-internal-secret': INTERNAL_SECRET }, timeout: 8000 }
    );
    res.status(r.status).json(r.data);
  } catch (err) {
    res.status(502).json({ error: 'Could not reach game server service' });
  }
});

// Serve client — public, no login required (frontend handles guest mode)
app.use(express.static(path.join(__dirname, '../client/dist')));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../client/dist/index.html'));
});

initDb().then(() => {
  app.listen(PORT, () => console.log(`Octopus Games running on :${PORT}`));
}).catch(err => {
  console.error('DB init failed:', err);
  process.exit(1);
});
