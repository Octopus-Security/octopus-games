const express = require('express');
const session = require('express-session');
const axios = require('axios');
const path = require('path');
const { initDb } = require('./database');
const gamesRouter = require('./routes/games');

const app = express();
const PORT = process.env.PORT || 3013;
const AUTH_INTERNAL_URL = process.env.AUTH_SERVICE_URL || 'http://octopus-auth:3002';
const AUTH_EXTERNAL_URL = process.env.AUTH_EXTERNAL_URL || '';

app.use(express.json());
app.use(session({
  secret: process.env.SESSION_SECRET || 'changeme',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, maxAge: 7 * 24 * 60 * 60 * 1000 },
}));

async function callAuth(endpoint, data) {
  try {
    return await axios.post(`${AUTH_INTERNAL_URL}${endpoint}`, data, { timeout: 3000 });
  } catch {
    if (!AUTH_EXTERNAL_URL) throw new Error('Auth service unreachable');
    return await axios.post(`${AUTH_EXTERNAL_URL}${endpoint}`, data, { timeout: 5000 });
  }
}

function requireLogin(req, res, next) {
  if (req.session.userId) return next();
  res.status(401).json({ error: 'NOT_AUTHENTICATED' });
}

// Auth routes
app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    const r = await callAuth('/api/auth/login', { username, password });
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

app.get('/api/me', requireLogin, (req, res) => {
  res.json({ username: req.session.username });
});

// Game save API
app.use('/api/games', requireLogin, gamesRouter);

// Serve client
app.use(express.static(path.join(__dirname, '../client/dist')));
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, '../client/dist/index.html'));
});

initDb().then(() => {
  app.listen(PORT, () => console.log(`Octopus Games running on :${PORT}`));
}).catch(err => {
  console.error('DB init failed:', err);
  process.exit(1);
});
