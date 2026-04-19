const express = require('express');
const session = require('express-session');
const axios = require('axios');
const path = require('path');
const { initDb } = require('./database');
const gamesRouter = require('./routes/games');

const app = express();
const PORT = process.env.PORT || 3013;
const CORTEX_URL = process.env.CORTEX_URL || 'http://octopus-cortex:3010';
const AUTH_SERVICE_URL = process.env.AUTH_SERVICE_URL || 'http://octopus-auth:3002';

app.use(express.json());
app.use(session({
  secret: process.env.SESSION_SECRET || 'changeme',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, maxAge: 7 * 24 * 60 * 60 * 1000 },
}));

function getClientIp(req) {
  return (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress;
}

async function tailscaleOnly(req, res, next) {
  const ip = getClientIp(req);
  try {
    await axios.get(`${CORTEX_URL}/api/check-ip`, { headers: { 'x-forwarded-for': ip } });
    next();
  } catch {
    res.status(403).json({ error: 'Access denied. Request access via Discord.' });
  }
}

function requireLogin(req, res, next) {
  if (req.session.userId) return next();
  res.status(401).json({ error: 'NOT_AUTHENTICATED' });
}

// Auth routes
app.post('/login', tailscaleOnly, async (req, res) => {
  const { username, password } = req.body;
  try {
    const r = await axios.post(`${AUTH_SERVICE_URL}/api/auth/login`, { username, password });
    if (r.data.success) {
      req.session.userId = r.data.username || username;
      req.session.username = req.session.userId;
      res.json({ ok: true });
    } else {
      res.status(401).json({ error: 'Invalid credentials' });
    }
  } catch (err) {
    if (err?.response?.status === 401) return res.status(401).json({ error: 'Invalid credentials' });
    res.status(503).json({ error: 'Auth service unavailable' });
  }
});

app.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/me', tailscaleOnly, requireLogin, (req, res) => {
  res.json({ username: req.session.username });
});

// Game save API
app.use('/api/games', tailscaleOnly, requireLogin, gamesRouter);

// Serve client
app.use(tailscaleOnly, express.static(path.join(__dirname, '../client/dist')));
app.get('*', tailscaleOnly, (_req, res) => {
  res.sendFile(path.join(__dirname, '../client/dist/index.html'));
});

initDb().then(() => {
  app.listen(PORT, () => console.log(`Octopus Games running on :${PORT}`));
}).catch(err => {
  console.error('DB init failed:', err);
  process.exit(1);
});
