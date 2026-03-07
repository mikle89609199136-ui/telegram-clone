const express = require('express');
const router = express.Router();
const { query } = require('./data');
const { isValidUsername, sanitize, getAvatarColor } = require('./utils');
const { redis } = require('./database');
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

    // Получаем статистику
    const stats = await query(`
      SELECT 
        (SELECT COUNT(*) FROM messages WHERE sender_id = $1) as messages_count,
        (SELECT COUNT(*) FROM chats c JOIN chat_members cm ON cm.chat_id = c.id WHERE cm.user_id = $1) as chats_count,
        (SELECT COUNT(*) FROM contacts WHERE user_id = $1) as contacts_count,
        (SELECT COUNT(*) FROM files WHERE user_id = $1) as files_count,
        (SELECT COUNT(*) FROM calls WHERE caller_id = $1 OR callee_id = $1) as calls_count
    `, [req.user.id]);

    // Проверяем онлайн-статус
    const devices = await redis.sMembers(`user:${req.user.id}:devices`);
    let online = false;
    for (const dev of devices) {
      if (await redis.exists(`online:${req.user.id}:${dev}`)) {
        online = true;
        break;
      }
    }

    res.json({
      ...user.rows[0],
      online,
      stats: stats.rows[0]
    });
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

    // Проверяем, есть ли пользователь в контактах у текущего
    const isContact = await query(
      'SELECT 1 FROM contacts WHERE user_id = $1 AND contact_id = $2',
      [req.user.id, userId]
    );

    // Проверяем онлайн-статус
    const devices = await redis.sMembers(`user:${userId}:devices`);
    let online = false;
    for (const dev of devices) {
      if (await redis.exists(`online:${userId}:${dev}`)) {
        online = true;
        break;
      }
    }

    // Получаем общие чаты
    const commonChats = await query(`
      SELECT c.id, c.name, c.type, c.avatar
      FROM chats c
      JOIN chat_members cm1 ON cm1.chat_id = c.id AND cm1.user_id = $1
      JOIN chat_members cm2 ON cm2.chat_id = c.id AND cm2.user_id = $2
      WHERE c.type IN ('group', 'channel')
    `, [req.user.id, userId]);

    res.json({
      ...user.rows[0],
      online,
      isInContacts: isContact.rows.length > 0,
      commonChats: commonChats.rows
    });
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
    
    // Уведомляем через WebSocket об изменении профиля
    const io = req.app.get('io');
    if (io) {
      io.to(`user:${req.user.id}`).emit('profileUpdated', result.rows[0]);
    }

    res.json(result.rows[0]);
  } catch (err) {
    logger.error('Error updating profile:', err);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

// ==================== ПОЛУЧЕНИЕ АВАТАРА ПО УМОЛЧАНИЮ (цветной) ====================
router.get('/avatar/color/:seed', (req, res) => {
  const { seed } = req.params;
  const color = getAvatarColor(seed);
  res.json({ color });
});

// ==================== СТАТИСТИКА ПОЛЬЗОВАТЕЛЯ ====================
router.get('/:userId/stats', async (req, res) => {
  const { userId } = req.params;

  try {
    // Проверяем, что пользователь существует
    const user = await query('SELECT id FROM users WHERE id = $1', [userId]);
    if (user.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const stats = await query(`
      SELECT 
        (SELECT COUNT(*) FROM messages WHERE sender_id = $1) as messages_count,
        (SELECT COUNT(*) FROM chats c JOIN chat_members cm ON cm.chat_id = c.id WHERE cm.user_id = $1) as chats_count,
        (SELECT COUNT(*) FROM contacts WHERE user_id = $1) as contacts_count,
        (SELECT COUNT(*) FROM files WHERE user_id = $1) as files_count,
        (SELECT COUNT(*) FROM calls WHERE caller_id = $1 OR callee_id = $1) as calls_count,
        (SELECT COUNT(*) FROM reactions WHERE user_id = $1) as reactions_given,
        (SELECT COUNT(*) FROM reactions r JOIN messages m ON m.id = r.message_id WHERE m.sender_id = $1) as reactions_received
    `, [userId]);

    res.json(stats.rows[0]);
  } catch (err) {
    logger.error('Error fetching user stats:', err);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

module.exports = router;
