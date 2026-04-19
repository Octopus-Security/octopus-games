const express = require('express');
const { GameSave } = require('../database');

const router = express.Router();

// GET /api/games/:slug/save
router.get('/:slug/save', async (req, res) => {
  const userId = req.session.userId;
  const { slug } = req.params;
  try {
    const record = await GameSave.findOne({ where: { userId, gameSlug: slug } });
    res.json(record ? JSON.parse(record.data) : {});
  } catch (err) {
    res.status(500).json({ error: String(err.message) });
  }
});

// POST /api/games/:slug/save
router.post('/:slug/save', async (req, res) => {
  const userId = req.session.userId;
  const { slug } = req.params;
  try {
    const [record] = await GameSave.upsert({
      userId,
      gameSlug: slug,
      data: JSON.stringify(req.body),
    }, { conflictFields: ['userId', 'gameSlug'] });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: String(err.message) });
  }
});

module.exports = router;
