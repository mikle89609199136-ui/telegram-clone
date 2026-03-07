const express = require('express');
const { query } = require('./database');
const logger = require('./logger');
const router = express.Router();

router.get('/', async (req, res) => {
  const userId = req.userId;
  try {
    let result = await query('SELECT * FROM user_settings WHERE user_id = $1', [userId]);
    if (!result.rows.length) {
      await query('INSERT INTO user_settings (user_id) VALUES ($1)', [userId]);
      result = await query('SELECT * FROM user_settings WHERE user_id = $1', [userId]);
    }
    res.json(result.rows[0]);
  } catch (err) {
    logger.error('Get settings error', err);
    res.status(500).json({ error: 'Database error' });
  }
});

router.put('/', async (req, res) => {
  const userId = req.userId;
  const {
    notifications_enabled,
    privacy_last_seen,
    privacy_profile_photo,
    privacy_read_receipts,
    theme,
    language,
  } = req.body;

  const updates = [];
  const params = [];
  let idx = 1;
  if (notifications_enabled !== undefined) {
    updates.push(`notifications_enabled = $${idx++}`);
    params.push(notifications_enabled);
  }
  if (privacy_last_seen !== undefined) {
    updates.push(`privacy_last_seen = $${idx++}`);
    params.push(privacy_last_seen);
  }
  if (privacy_profile_photo !== undefined) {
    updates.push(`privacy_profile_photo = $${idx++}`);
    params.push(privacy_profile_photo);
  }
  if (privacy_read_receipts !== undefined) {
    updates.push(`privacy_read_receipts = $${idx++}`);
    params.push(privacy_read_receipts);
  }
  if (theme !== undefined) {
    updates.push(`theme = $${idx++}`);
    params.push(theme);
  }
  if (language !== undefined) {
    updates.push(`language = $${idx++}`);
    params.push(language);
  }
  if (!updates.length) return res.status(400).json({ error: 'No settings to update' });

  params.push(userId);
  try {
    const result = await query(
      `UPDATE user_settings SET ${updates.join(', ')}, updated_at = NOW() WHERE user_id = $${idx} RETURNING *`,
      params
    );
    res.json(result.rows[0]);
  } catch (err) {
    logger.error('Update settings error', err);
    res.status(500).json({ error: 'Database error' });
  }
});

module.exports = router;
