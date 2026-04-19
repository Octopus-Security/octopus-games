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

async function initDb() {
  await sequelize.authenticate();
  await sequelize.sync({ alter: true });
}

module.exports = { sequelize, GameSave, initDb };
