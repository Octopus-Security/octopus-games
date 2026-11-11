const { Sequelize, DataTypes } = require('sequelize');
const path = require('path');
const { defineMatchModels } = require('./multiplayer/models');

const sequelize = new Sequelize({
  dialect: 'sqlite',
  storage: path.join(__dirname, '../../data/games.db'),
  logging: false,
});

// Sequelize's sqlite connection manager does NOT run the afterConnect hook, and
// it opens a handle per transaction, so the pragmas are applied by wrapping
// getConnection: once per connection, awaited before the first query uses it.
// The db lives in the games_data volume DIRECTORY (/app/data), so the -wal/-shm
// files sit in the volume and WAL is safe.
const PRAGMAS = 'PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA synchronous=NORMAL;';
const cm = sequelize.connectionManager;
const origGetConnection = cm.getConnection.bind(cm);
cm.getConnection = async function getConnection(options) {
  const conn = await origGetConnection(options);
  if (!conn.__pragmas) {
    conn.__pragmas = new Promise((resolve, reject) => conn.exec(PRAGMAS, err => (err ? reject(err) : resolve())));
  }
  await conn.__pragmas;
  return conn;
};

const GameSave = sequelize.define('GameSave', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  userId: { type: DataTypes.STRING, allowNull: false },
  gameSlug: { type: DataTypes.STRING, allowNull: false },
  data: { type: DataTypes.TEXT, allowNull: false, defaultValue: '{}' },
}, { tableName: 'GameSaves', timestamps: true });

const GameScore = sequelize.define('GameScore', {
  id:       { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  userId:   { type: DataTypes.STRING, allowNull: false },
  gameSlug: { type: DataTypes.STRING, allowNull: false },
  score:    { type: DataTypes.INTEGER, allowNull: false },
  metadata: { type: DataTypes.TEXT, defaultValue: '{}' },
}, { tableName: 'GameScores', timestamps: true });

const Setting = sequelize.define('Setting', {
  key:   { type: DataTypes.STRING, primaryKey: true },
  value: { type: DataTypes.TEXT, allowNull: false, defaultValue: '' },
}, { tableName: 'Settings', timestamps: false });

const GameControls = sequelize.define('GameControls', {
  id:       { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  username: { type: DataTypes.STRING, allowNull: true },  // null = site-wide default
  game:     { type: DataTypes.STRING, allowNull: false },
  controls: { type: DataTypes.TEXT, allowNull: false, defaultValue: '[]' },
}, { tableName: 'GameControls', timestamps: true });

// Admin-authored recipe override — takes precedence over wiki Cargo data for
// that (game, itemName) pair. Fixes wiki gaps/errors or adds items the wiki
// doesn't track at all.
const CraftingRecipe = sequelize.define('CraftingRecipe', {
  id:          { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  game:        { type: DataTypes.STRING, allowNull: false },
  itemName:    { type: DataTypes.STRING, allowNull: false },
  station:     { type: DataTypes.STRING, allowNull: true, defaultValue: '' },
  amount:      { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
  ingredients: { type: DataTypes.TEXT, allowNull: false, defaultValue: '[]' }, // JSON [{name,qty}]
}, { tableName: 'CraftingRecipes', timestamps: true, indexes: [{ unique: true, fields: ['game', 'itemName'] }] });

// A user's saved crafting goal — a snapshot of the recipe totals at the time
// it was saved (so the checklist doesn't shift if wiki data changes later),
// plus which materials have been checked off.
const CraftingGoal = sequelize.define('CraftingGoal', {
  id:       { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  username: { type: DataTypes.STRING, allowNull: false },
  game:     { type: DataTypes.STRING, allowNull: false },
  itemName: { type: DataTypes.STRING, allowNull: false },
  totals:   { type: DataTypes.TEXT, allowNull: false, defaultValue: '[]' },   // JSON [{name,qty,url}]
  checked:  { type: DataTypes.TEXT, allowNull: false, defaultValue: '[]' },   // JSON [materialName,...]
}, { tableName: 'CraftingGoals', timestamps: true });

// Multiplayer tables are defined AFTER the alter-sync above and created with a
// plain additive sync() (CREATE TABLE IF NOT EXISTS) — never altered, never forced.
// Filled in by initDb(); routes read it lazily.
const multiplayer = {};

async function initDb() {
  await sequelize.authenticate();
  await sequelize.sync({ alter: true });
  // Owner/lookup indexes. Idempotent; sync() does not reliably add indexes to an
  // existing table, so these are explicit.
  for (const sql of [
    'CREATE INDEX IF NOT EXISTS game_saves_user_game ON GameSaves (userId, gameSlug)',
    'CREATE INDEX IF NOT EXISTS game_scores_game_score ON GameScores (gameSlug, score)',
    'CREATE INDEX IF NOT EXISTS game_scores_user ON GameScores (userId)',
    'CREATE INDEX IF NOT EXISTS game_controls_user ON GameControls (username)',
    'CREATE INDEX IF NOT EXISTS crafting_goals_user ON CraftingGoals (username)',
  ]) await sequelize.query(sql);
  Object.assign(multiplayer, defineMatchModels(sequelize));
  await multiplayer.Match.sync();
  await multiplayer.MatchMove.sync();
}

module.exports = { sequelize, GameSave, GameScore, Setting, GameControls, CraftingRecipe, CraftingGoal, multiplayer, initDb };
