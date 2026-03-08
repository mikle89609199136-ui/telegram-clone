// users.js — управление пользователями
const express = require('express');
const router = express.Router();
const authenticateToken = require('./authMiddleware');
const { db } = require('./database');
const { sanitizeUser } = require('./utils');

// Получить информацию о текущем пользователе
router.get('/me', authenticateToken, async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM users WHERE id = $1', [req.user.id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }
    res.json(sanitizeUser(result.rows[0]));
  } catch (err) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Получить пользователя по ID или username
router.get('/:identifier', authenticateToken, async (req, res) => {
  try {
    const { identifier } = req.params;
    const result = await db.query(
      'SELECT id, username, email, avatar, status, last_seen FROM users WHERE id = $1 OR username = $1',
      [identifier]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Обновить профиль
router.put('/me', authenticateToken, async (req, res) => {
  try {
    const { name, avatar, birthday } = req.body;
    const userId = req.user.id;
    await db.query(
      'UPDATE users SET name = COALESCE($1, name), avatar = COALESCE($2, avatar), birthday = COALESCE($3, birthday), updated_at = NOW() WHERE id = $4',
      [name, avatar, birthday, userId]
    );
    const result = await db.query('SELECT * FROM users WHERE id = $1', [userId]);
    res.json(sanitizeUser(result.rows[0]));
  } catch (err) {
    res.status(500).json({ error: 'Ошибка обновления профиля' });
  }
});

// Получить список устройств (сессий)
router.get('/me/devices', authenticateToken, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT id, device_info, created_at, expires_at 
       FROM sessions 
       WHERE user_id = $1 
       ORDER BY created_at DESC`,
      [req.user.id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Ошибка получения устройств' });
  }
});

// Удалить сессию (выйти с устройства)
router.delete('/me/devices/:sessionId', authenticateToken, async (req, res) => {
  try {
    const { sessionId } = req.params;
    await db.query('DELETE FROM sessions WHERE id = $1 AND user_id = $2', [sessionId, req.user.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Ошибка удаления сессии' });
  }
});

module.exports = router;
