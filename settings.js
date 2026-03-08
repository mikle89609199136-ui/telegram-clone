// settings.js — настройки пользователя (темы, язык, приватность и т.д.)
const express = require('express');
const router = express.Router();
const authenticateToken = require('./authMiddleware');
const { db } = require('./database');
const logger = require('./logger');

// Получить все настройки пользователя
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
    res.status(500).json({ error: 'Ошибка получения настроек' });
  }
});

// Обновить настройки
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
    res.status(500).json({ error: 'Ошибка обновления настроек' });
  }
});

module.exports = router;
