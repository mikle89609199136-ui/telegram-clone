// profile.js – просмотр профиля пользователя (публичная информация)
const express = require('express');
const router = express.Router();
const authenticateToken = require('./authMiddleware');
const { db } = require('./database');
const logger = require('./logger');

// Получить публичный профиль пользователя
router.get('/:userId', authenticateToken, async (req, res) => {
  try {
    const { userId } = req.params;
    const result = await db.query(
      `SELECT id, username, name, avatar, birthday, status, last_seen
       FROM users WHERE id = $1`,
      [userId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    const user = result.rows[0];

    // Получить общие группы
    const commonGroups = await db.query(
      `SELECT c.id, c.title, c.avatar
       FROM chats c
       JOIN chat_participants cp1 ON c.id = cp1.chat_id
       JOIN chat_participants cp2 ON c.id = cp2.chat_id
       WHERE c.type = 'group' AND cp1.user_id = $1 AND cp2.user_id = $2`,
      [userId, req.user.id]
    );

    // Получить медиа (файлы) из общих чатов
    const media = await db.query(
      `SELECT m.id, m.file_url, m.file_name, m.mime_type, m.created_at
       FROM messages m
       JOIN chat_participants cp ON m.chat_id = cp.chat_id
       WHERE cp.user_id = $1 AND m.type IN ('file', 'photo', 'video')
       ORDER BY m.created_at DESC
       LIMIT 20`,
      [req.user.id] // упрощённо: медиа из всех чатов пользователя
    );

    res.json({ user, commonGroups: commonGroups.rows, media: media.rows });
  } catch (err) {
    logger.error('Get profile error:', err);
    res.status(500).json({ error: 'Failed to get profile' });
  }
});

module.exports = router;
