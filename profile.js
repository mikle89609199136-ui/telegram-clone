const express = require('express');
const router = express.Router();
const { query } = require('./data');
const { isValidUsername, sanitize } = require('./utils');
const logger = require('./logger');

// ==================== ПОЛУЧЕНИЕ ПРОФИЛЯ ТЕКУЩЕГО ПОЛЬЗОВАТЕЛЯ ====================
router.get('/me', async (req, res) => {
  try {
    const user = await query(`
      SELECT id, username, avatar, bio, status, last_seen, created_at
      FROM users
      WHERE id = $1
    `, [req.user.id]);

    if (user.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json(user.rows[0]);
  } catch (err) {
    logger.error('Error fetching profile:', err);
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

// ==================== ПОЛУЧЕНИЕ ПРОФИЛЯ ДРУГОГО ПОЛЬЗОВАТЕЛЯ ПО ID ====================
router.get('/:userId', async (req, res) => {
  const { userId } = req.params;

  try {
    const user = await query(`
      SELECT id, username, avatar, bio, status, last_seen, created_at
      FROM users
      WHERE id = $1
    `, [userId]);

    if (user.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Не показываем last_seen, если пользователь скрыл его в настройках приватности
    // Пока упрощённо – показываем
    res.json(user.rows[0]);
  } catch (err) {
    logger.error('Error fetching user profile:', err);
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

// ==================== ОБНОВЛЕНИЕ ПРОФИЛЯ ====================
router.put('/me', async (req, res) => {
  const { username, bio, avatar, status } = req.body;
  const updates = [];
  const params = [];
  let paramIdx = 1;

  if (username) {
    if (!isValidUsername(username)) {
      return res.status(400).json({ error: 'Invalid username format' });
    }
    // Проверяем уникальность
    const existing = await query('SELECT id FROM users WHERE username = $1 AND id != $2', [username, req.user.id]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Username already taken' });
    }
    updates.push(`username = $${paramIdx++}`);
    params.push(username);
  }

  if (bio !== undefined) {
    updates.push(`bio = $${paramIdx++}`);
    params.push(sanitize(bio));
  }

  if (avatar !== undefined) {
    updates.push(`avatar = $${paramIdx++}`);
    params.push(avatar);
  }

  if (status !== undefined) {
    const allowedStatuses = ['online', 'offline', 'away', 'busy'];
    if (!allowedStatuses.includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }
    updates.push(`status = $${paramIdx++}`);
    params.push(status);
  }

  if (updates.length === 0) {
    return res.status(400).json({ error: 'No fields to update' });
  }

  params.push(req.user.id);
  const sql = `UPDATE users SET ${updates.join(', ')} WHERE id = $${paramIdx} RETURNING id, username, avatar, bio, status`;

  try {
    const result = await query(sql, params);
    res.json(result.rows[0]);
  } catch (err) {
    logger.error('Error updating profile:', err);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

// ==================== ЗАГРУЗКА АВАТАРА (через отдельный эндпоинт upload) ====================
// Фактически загрузка обрабатывается в upload.js, здесь просто ссылка

module.exports = router;