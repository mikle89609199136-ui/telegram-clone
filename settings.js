// settings.js – user settings (theme, wallpaper, language, privacy, notifications)
const express = require('express');
const router = express.Router();
const authenticateToken = require('./authMiddleware');
const { db } = require('./database');
const logger = require('./logger');

// Get all settings
router.get('/', authenticateToken, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT theme, wallpaper, language, privacy_settings, notification_settings
       FROM users WHERE id = $1`,
      [req.user.id]
    );
    res.json(result.rows[0] || {});
  } catch (err) {
    logger.error('Get settings error:', err);
    res.status(500).json({ error: 'Failed to get settings' });
  }
});

// Update settings
router.put('/', authenticateToken, async (req, res) => {
  try {
    const { theme, wallpaper, language, privacy_settings, notification_settings } = req.body;
    await db.query(
      `UPDATE users SET
        theme = COALESCE($1, theme),
        wallpaper = COALESCE($2, wallpaper),
        language = COALESCE($3, language),
        privacy_settings = COALESCE($4, privacy_settings::jsonb),
        notification_settings = COALESCE($5, notification_settings::jsonb),
        updated_at = NOW()
       WHERE id = $6`,
      [theme, wallpaper, language, JSON.stringify(privacy_settings), JSON.stringify(notification_settings), req.user.id]
    );
    res.json({ success: true });
  } catch (err) {
    logger.error('Update settings error:', err);
    res.status(500).json({ error: 'Failed to update settings' });
  }
});

// Privacy options: everyone, contacts, nobody
const privacyLevels = ['everyone', 'contacts', 'nobody'];

// Update a specific privacy setting
router.put('/privacy/:key', authenticateToken, async (req, res) => {
  try {
    const { key } = req.params; // phone, lastSeen, photo, status, groups, calls
    const { value } = req.body;
    if (!privacyLevels.includes(value)) {
      return res.status(400).json({ error: 'Invalid privacy level' });
    }

    const user = await db.query('SELECT privacy_settings FROM users WHERE id = $1', [req.user.id]);
    let privacy = user.rows[0]?.privacy_settings || {};
    privacy[key] = value;

    await db.query(
      'UPDATE users SET privacy_settings = $1 WHERE id = $2',
      [JSON.stringify(privacy), req.user.id]
    );
    res.json({ success: true });
  } catch (err) {
    logger.error('Update privacy error:', err);
    res.status(500).json({ error: 'Failed to update privacy' });
  }
});

// Update notification settings
router.put('/notifications', authenticateToken, async (req, res) => {
  try {
    const settings = req.body;
    await db.query(
      'UPDATE users SET notification_settings = $1 WHERE id = $2',
      [JSON.stringify(settings), req.user.id]
    );
    res.json({ success: true });
  } catch (err) {
    logger.error('Update notification settings error:', err);
    res.status(500).json({ error: 'Failed to update notification settings' });
  }
});

module.exports = router;
