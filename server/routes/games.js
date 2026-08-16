/**
 * Per-account game saves.
 *
 * This file predates the move to Octopus Auth and was never brought across: it
 * read `req.session.userId`, and nothing has mounted express-session since. The
 * package is still in package.json, which is why that looked plausible for so
 * long. `req.session` is therefore undefined and the read threw before the
 * try/catch could see it, so every save and every load has answered 500 since
 * the initial scaffold. Nothing else in this repo writes GameSaves, so that
 * table has never held a row.
 *
 * Identity now comes from `req.user`, which the SSO middleware in index.js sets
 * and `requireLogin` on the mount guarantees. Numeric id first, as in planner's
 * ownership.js and for the same reason: a username can be changed, and the save
 * would then belong to nobody.
 */

const express = require('express');
const { GameSave } = require('../database');

const router = express.Router();

/** Whose save this is. requireLogin runs on the mount, so req.user is set. */
const ownerOf = req => String(req.user.userId ?? req.user.username);

// GET /api/games/:slug/save
router.get('/:slug/save', async (req, res) => {
  const { slug } = req.params;
  try {
    const record = await GameSave.findOne({ where: { userId: ownerOf(req), gameSlug: slug } });
    res.json(record ? JSON.parse(record.data) : {});
  } catch (err) {
    res.status(500).json({ error: String(err.message) });
  }
});

// POST /api/games/:slug/save
//
// Deliberately not `upsert`. GameSaves declares no unique constraint on
// (userId, gameSlug) — CraftingRecipes is the only model here that declares one
// — so the ON CONFLICT the old call emitted was rejected outright by SQLite:
// "ON CONFLICT clause does not match any PRIMARY KEY or UNIQUE constraint".
// This route would still have been broken after fixing the identity above.
//
// findOrCreate needs no constraint and no schema change, which keeps a fix for
// a route that has never worked from touching a live database.
router.post('/:slug/save', async (req, res) => {
  const { slug } = req.params;
  try {
    const [record] = await GameSave.findOrCreate({
      where:    { userId: ownerOf(req), gameSlug: slug },
      defaults: { data: JSON.stringify(req.body) },
    });
    await record.update({ data: JSON.stringify(req.body) });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: String(err.message) });
  }
});

module.exports = router;
