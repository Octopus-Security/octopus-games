'use strict';
// Match tables. Defined by a function so database.js can create them AFTER its
// own `sync({ alter: true })` (these two are created with a plain, additive
// `sync()`, never altered) and so tests can build them on an in-memory database.
const { DataTypes } = require('sequelize');

function defineMatchModels(sequelize) {
  const seat = i => ({
    [`seat${i}Kind`]:      { type: DataTypes.STRING(8),  allowNull: true },   // 'user' | 'guest' | null (empty)
    [`seat${i}Name`]:      { type: DataTypes.STRING(64), allowNull: true },   // username as typed, or guest display name
    [`seat${i}Key`]:       { type: DataTypes.STRING(64), allowNull: true },   // lower-cased username; null for guests
    [`seat${i}TokenHash`]: { type: DataTypes.STRING(64), allowNull: true },   // sha256 of a guest seat token
  });

  const Match = sequelize.define('Match', {
    id:        { type: DataTypes.STRING(36), primaryKey: true },
    type:      { type: DataTypes.STRING(32), allowNull: false },
    // challenge | open | active | finished | declined | cancelled | revoked | expired
    status:    { type: DataTypes.STRING(16), allowNull: false },
    state:     { type: DataTypes.TEXT, allowNull: false },          // engine state, JSON
    seed:      { type: DataTypes.STRING(64), allowNull: true },
    version:   { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    ...seat(0), ...seat(1),
    createdBy: { type: DataTypes.STRING(64), allowNull: false },
    inviteToken: { type: DataTypes.STRING(64), allowNull: true },   // null once revoked
    inviteRevokedAt: { type: DataTypes.DATE, allowNull: true },
    expiresAt: { type: DataTypes.DATE, allowNull: true },           // challenges and unclaimed invites only
    lastMoveAt: { type: DataTypes.DATE, allowNull: true },
    winner:    { type: DataTypes.INTEGER, allowNull: true },
    reason:    { type: DataTypes.STRING(32), allowNull: true },
  }, {
    tableName: 'Matches', timestamps: true,
    indexes: [
      { unique: true, fields: ['inviteToken'] },
      { fields: ['seat0Key'] }, { fields: ['seat1Key'] }, { fields: ['createdBy'] }, { fields: ['status'] },
    ],
  });

  const MatchMove = sequelize.define('MatchMove', {
    id:      { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    matchId: { type: DataTypes.STRING(36), allowNull: false },
    ply:     { type: DataTypes.INTEGER, allowNull: false },        // the match version this move produced
    seat:    { type: DataTypes.INTEGER, allowNull: false },
    move:    { type: DataTypes.TEXT, allowNull: false },           // JSON as submitted
    events:  { type: DataTypes.TEXT, allowNull: false, defaultValue: '[]' },
  }, {
    tableName: 'MatchMoves', timestamps: true,
    indexes: [{ unique: true, fields: ['matchId', 'ply'] }],
  });

  return { Match, MatchMove };
}

module.exports = { defineMatchModels };
