const { Sequelize, DataTypes } = require('sequelize');
const path = require('path');

const sequelize = new Sequelize({
  dialect: 'sqlite',
  storage: path.join(__dirname, '../../data/games.db'),
  logging: false,
});

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

async function initDb() {
  await sequelize.authenticate();
  await sequelize.sync({ alter: true });
}

module.exports = { sequelize, GameSave, GameScore, Setting, GameControls, CraftingRecipe, CraftingGoal, initDb };
