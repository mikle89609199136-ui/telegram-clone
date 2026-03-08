// notifications.js — управление уведомлениями и push-подписками
const express = require('express');
const router = express.Router();
const authenticateToken = require('./authMiddleware');
const { db } = require('./database');
const logger = require('./logger');

// Получить настройки уведомлений
router.get('/settings', authenticateToken, async (req, res) => {
  try {
    const result = await db.query(
      'SELECT notification_settings FROM users WHERE id = $1',
      [req.user.id]
    );
    res.json(result.rows[0]?.notification_settings || {});
  } catch (err) {
    logger.error('Get notification settings error:', err);
    res.status(500).json({ error: 'Ошибка получения настроек уведомлений' });
  }
});

// Обновить настройки уведомлений
router.put('/settings', authenticateToken, async (req, res) => {
  try {
    const settings = req.body;
    await db.query(
      'UPDATE users SET notification_settings = $1 WHERE id = $2',
      [JSON.stringify(settings), req.user.id]
    );
    res.json({ success: true });
  } catch (err) {
    logger.error('Update notification settings error:', err);
    res.status(500).json({ error: 'Ошибка обновления настроек уведомлений' });
  }
});

// Зарегистрировать push-подписку
router.post('/subscribe', authenticateToken, async (req, res) => {
  try {
    const subscription = req.body;
    await db.query(
      `INSERT INTO push_subscriptions (user_id, endpoint, keys)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, endpoint) DO UPDATE SET keys = EXCLUDED.keys`,
      [req.user.id, subscription.endpoint, JSON.stringify(subscription.keys)]
    );
    res.json({ success: true });
  } catch (err) {
    logger.error('Push subscribe error:', err);
    res.status(500).json({ error: 'Ошибка подписки на уведомления' });
  }
});

// Удалить подписку
router.delete('/subscribe/:endpoint', authenticateToken, async (req, res) => {
  try {
    const { endpoint } = req.params;
    await db.query(
      'DELETE FROM push_subscriptions WHERE user_id = $1 AND endpoint = $2',
      [req.user.id, endpoint]
    );
    res.json({ success: true });
  } catch (err) {
    logger.error('Push unsubscribe error:', err);
    res.status(500).json({ error: 'Ошибка отписки от уведомлений' });
  }
});

module.exports = router;
