// search.js — глобальный поиск и поиск по сообщениям
const express = require('express');
const router = express.Router();
const authenticateToken = require('./authMiddleware');
const { db } = require('./database');
const logger = require('./logger');

// Глобальный поиск пользователей, каналов, групп
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { q } = req.query;
    if (!q || q.length < 2) {
      return res.json({ users: [], chats: [] });
    }

    // Поиск пользователей
    const users = await db.query(
      `SELECT id, username, avatar, status, last_seen
       FROM users
       WHERE username ILIKE $1 OR name ILIKE $1
       LIMIT 20`,
      [`%${q}%`]
    );

    // Поиск публичных чатов (групп и каналов)
    const chats = await db.query(
      `SELECT id, type, title, avatar, description, privacy
       FROM chats
       WHERE (type = 'group' OR type = 'channel') AND privacy = 'public' AND title ILIKE $1
       LIMIT 20`,
      [`%${q}%`]
    );

    res.json({ users: users.rows, chats: chats.rows });
  } catch (err) {
    logger.error('Global search error:', err);
    res.status(500).json({ error: 'Ошибка поиска' });
  }
});

// Поиск сообщений в конкретном чате
router.get('/messages/:chatId', authenticateToken, async (req, res) => {
  try {
    const { chatId } = req.params;
    const { q } = req.query;
    const userId = req.user.id;

    if (!q || q.length < 2) {
      return res.json([]);
    }

    // Проверка доступа
    const access = await db.query(
      'SELECT 1 FROM chat_participants WHERE chat_id = $1 AND user_id = $2',
      [chatId, userId]
    );
    if (access.rows.length === 0) {
      return res.status(403).json({ error: 'Нет доступа к чату' });
    }

    const result = await db.query(
      `SELECT m.*, u.username as sender_username, u.avatar as sender_avatar
       FROM messages m
       JOIN users u ON m.sender_id = u.id
       WHERE m.chat_id = $1 AND m.content ILIKE $2
       ORDER BY m.created_at DESC
       LIMIT 50`,
      [chatId, `%${q}%`]
    );

    res.json(result.rows);
  } catch (err) {
    logger.error('Message search error:', err);
    res.status(500).json({ error: 'Ошибка поиска сообщений' });
  }
});

module.exports = router;
