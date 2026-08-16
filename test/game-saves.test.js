'use strict';

/**
 * Game saves must actually save.
 *
 * routes/games.js predated Octopus Auth and read `req.session.userId`. Nothing
 * has mounted express-session since the move to SSO — the package is still a
 * dependency, which is what made that read look plausible — so `req.session`
 * was undefined and the access threw BEFORE the handler's own try/catch. Every
 * save and every load answered 500, from the initial scaffold onwards.
 *
 * Underneath it sat a second fault that the first one hid: the POST used
 * `upsert` with `conflictFields: ['userId','gameSlug']`, and GameSaves declares
 * no unique constraint on those columns. SQLite rejects that outright. Fixing
 * only the identity would have moved the 500, not removed it — which is why
 * these tests drive the real router against a real table rather than asserting
 * on the shape of the code.
 *
 * Run: node --test test/game-saves.test.js
 */

const { test } = require('node:test');
const assert   = require('node:assert');
const express  = require('express');
const { Sequelize, DataTypes } = require('sequelize');

// GameSaves exactly as server/database.js declares it — no indexes option. If a
// unique constraint is ever added there, this copy must follow, or these tests
// stop describing production.
const sequelize = new Sequelize({ dialect: 'sqlite', storage: ':memory:', logging: false });
const GameSave = sequelize.define('GameSave', {
  id:       { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  userId:   { type: DataTypes.STRING,  allowNull: false },
  gameSlug: { type: DataTypes.STRING,  allowNull: false },
  data:     { type: DataTypes.TEXT,    allowNull: false, defaultValue: '{}' },
}, { tableName: 'GameSaves', timestamps: true });

const dbFile = require.resolve('../server/database.js');
require.cache[dbFile] = { id: dbFile, filename: dbFile, loaded: true, exports: { GameSave, sequelize } };

const gamesRouter = require('../server/routes/games');

/** An app mounted exactly as index.js mounts it: SSO has set req.user, no session. */
function appFor(user) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = user; next(); });
  app.use('/api/games', gamesRouter);
  return app;
}

function listen(app) {
  return new Promise(resolve => {
    const srv = app.listen(0, () => resolve({
      url: `http://127.0.0.1:${srv.address().port}`,
      close: () => srv.close(),
    }));
  });
}

const NICK  = { userId: 7,  username: 'psychopathy', role: 'admin' };
const OTHER = { userId: 42, username: 'someone',     role: 'user'  };

async function save(srv, slug, body) {
  const r = await fetch(`${srv.url}/api/games/${slug}/save`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  return { status: r.status, body: await r.json() };
}

async function load(srv, slug) {
  const r = await fetch(`${srv.url}/api/games/${slug}/save`);
  return { status: r.status, body: await r.json() };
}

test('a save round-trips — the whole feature, which returned 500 either way', async () => {
  await sequelize.sync({ force: true });
  const srv = await listen(appFor(NICK));
  try {
    assert.equal((await save(srv, 'tetris', { level: 3, score: 900 })).status, 200);
    const got = await load(srv, 'tetris');
    assert.equal(got.status, 200);
    assert.deepEqual(got.body, { level: 3, score: 900 });
  } finally { srv.close(); }
});

test('saving twice overwrites rather than piling up rows', async () => {
  // The upsert this replaced could not have done it: no unique constraint on
  // (userId, gameSlug) means ON CONFLICT has nothing to match and SQLite refuses.
  await sequelize.sync({ force: true });
  const srv = await listen(appFor(NICK));
  try {
    await save(srv, 'tetris', { score: 10 });
    await save(srv, 'tetris', { score: 20 });
    await save(srv, 'tetris', { score: 30 });

    assert.deepEqual((await load(srv, 'tetris')).body, { score: 30 },
      'a load must return the LATEST save, not the first row written');
    assert.equal(await GameSave.count({ where: { userId: '7', gameSlug: 'tetris' } }), 1,
      'one row per account per game');
  } finally { srv.close(); }
});

test('two accounts do not see each other\'s progress', async () => {
  await sequelize.sync({ force: true });
  const mine   = await listen(appFor(NICK));
  const theirs = await listen(appFor(OTHER));
  try {
    await save(mine,   'tetris', { score: 999 });
    await save(theirs, 'tetris', { score: 1 });

    assert.deepEqual((await load(mine,   'tetris')).body, { score: 999 });
    assert.deepEqual((await load(theirs, 'tetris')).body, { score: 1 });
  } finally { mine.close(); theirs.close(); }
});

test('saves are per game, not one slot per account', async () => {
  await sequelize.sync({ force: true });
  const srv = await listen(appFor(NICK));
  try {
    await save(srv, 'tetris', { score: 5 });
    await save(srv, 'snake',  { score: 6 });
    assert.deepEqual((await load(srv, 'tetris')).body, { score: 5 });
    assert.deepEqual((await load(srv, 'snake')).body,  { score: 6 });
  } finally { srv.close(); }
});

test('no save yet reads as empty, not as an error', async () => {
  await sequelize.sync({ force: true });
  const srv = await listen(appFor(NICK));
  try {
    const got = await load(srv, 'never-played');
    assert.equal(got.status, 200);
    assert.deepEqual(got.body, {});
  } finally { srv.close(); }
});

test('identity is the account id, so a rename does not orphan a save', async () => {
  // ownerOf prefers userId for the reason planner's ownership.js does: a
  // username can change, and the row would then belong to nobody.
  await sequelize.sync({ force: true });
  const before = await listen(appFor(NICK));
  try { await save(before, 'tetris', { score: 77 }); } finally { before.close(); }

  const after = await listen(appFor({ ...NICK, username: 'renamed' }));
  try {
    assert.deepEqual((await load(after, 'tetris')).body, { score: 77 });
  } finally { after.close(); }
});
