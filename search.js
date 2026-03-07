const express = require('express');
const router = express.Router();
const { query } = require('./data');
const logger = require('./logger');

// ==================== ГЛАВНЫЙ ПОИСК ====================
// GET /api/search?q=текст&type=all|users|messages|files|chats&filter=media|links
router.get('/', async (req, res) => {
  const { q, type = 'all', filter } = req.query;
  if (!q || q.length < 2) {
    return res.json({});
  }

  try {
    const results = {};

    // Поиск пользователей
    if (type === 'all' || type === 'users') {
      const users = await query(`
        SELECT id, username, avatar, status
        FROM users
        WHERE username ILIKE $1
        LIMIT 20
      `, [`%${q}%`]);
      results.users = users.rows;
    }

    // Поиск сообщений (только в чатах, где пользователь участник)
    if (type === 'all' || type === 'messages') {
      let sql = `
        SELECT m.id, m.content, m.created_at, m.chat_id, m.type, u.username, u.avatar
        FROM messages m
        JOIN users u ON u.id = m.sender_id
        WHERE m.content ILIKE $1
          AND EXISTS (SELECT 1 FROM chat_members cm WHERE cm.chat_id = m.chat_id AND cm.user_id = $2)
      `;
      const params = [`%${q}%`, req.user.id];
      if (filter === 'media') {
        sql += ` AND m.type IN ('image', 'video', 'file')`;
      } else if (filter === 'links') {
        sql += ` AND m.content LIKE '%http%'`;
      }
      sql += ` ORDER BY m.created_at DESC LIMIT 50`;
      const messages = await query(sql, params);
      results.messages = messages.rows;
    }

    // Поиск файлов (принадлежащих пользователю или в общих чатах)
    if (type === 'all' || type === 'files') {
      // Сначала файлы, загруженные самим пользователем
      const myFiles = await query(`
        SELECT f.id, f.filename, f.path, f.mime_type, f.size, f.created_at
        FROM files f
        WHERE f.user_id = $1 AND f.filename ILIKE $2
        LIMIT 20
      `, [req.user.id, `%${q}%`]);

      // Также ищем файлы, которые были отправлены как сообщения в доступных чатах
      const chatFiles = await query(`
        SELECT m.id, m.content, m.created_at, m.chat_id, m.type
        FROM messages m
        WHERE m.type IN ('image','video','file')
          AND m.content ILIKE $1
          AND EXISTS (SELECT 1 FROM chat_members cm WHERE cm.chat_id = m.chat_id AND cm.user_id = $2)
        LIMIT 20
      `, [`%${q}%`, req.user.id]);

      results.files = [...myFiles.rows, ...chatFiles.rows];
    }

    // Поиск чатов (по названию, если это группа/канал)
    if (type === 'all' || type === 'chats') {
      const chats = await query(`
        SELECT c.id, c.name, c.avatar, c.type
        FROM chats c
        JOIN chat_members cm ON cm.chat_id = c.id
        WHERE c.name ILIKE $1 AND cm.user_id = $2
        LIMIT 20
      `, [`%${q}%`, req.user.id]);
      results.chats = chats.rows;
    }

    res.json(results);
  } catch (err) {
    logger.error('Search error:', err);
    res.status(500).json({ error: 'Search failed' });
  }
});

// ==================== ПОИСК ПОЛЬЗОВАТЕЛЕЙ (для приглашения в группу) ====================
router.get('/users', async (req, res) => {
  const { q } = req.query;
  if (!q || q.length < 2) {
    return res.json([]);
  }

  try {
    const users = await query(`
      SELECT id, username, avatar, status
      FROM users
      WHERE username ILIKE $1
      LIMIT 20
    `, [`%${q}%`]);
    res.json(users.rows);
  } catch (err) {
    logger.error('User search error:', err);
    res.status(500).json({ error: 'Search failed' });
  }
});

// ==================== ПОИСК СООБЩЕНИЙ В КОНКРЕТНОМ ЧАТЕ ====================
router.get('/chat/:chatId', async (req, res) => {
  const { chatId } = req.params;
  const { q } = req.query;
  if (!q || q.length < 2) {
    return res.json([]);
  }

  try {
    // Проверка доступа
    const member = await query(
      'SELECT 1 FROM chat_members WHERE chat_id = $1 AND user_id = $2',
      [chatId, req.user.id]
    );
    if (member.rows.length === 0) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const messages = await query(`
      SELECT m.id, m.content, m.created_at, m.type, u.username, u.avatar
      FROM messages m
      JOIN users u ON u.id = m.sender_id
      WHERE m.chat_id = $1 AND m.content ILIKE $2
      ORDER BY m.created_at DESC
      LIMIT 50
    `, [chatId, `%${q}%`]);

    res.json(messages.rows);
  } catch (err) {
    logger.error('Chat search error:', err);
    res.status(500).json({ error: 'Search failed' });
  }
});

// ==================== ПОИСК КАНАЛОВ (публичных) ====================
router.get('/channels', async (req, res) => {
  const { q } = req.query;
  if (!q || q.length < 2) {
    return res.json([]);
  }

  try {
    const channels = await query(`
      SELECT c.id, c.name, c.description, c.avatar,
        (SELECT COUNT(*) FROM chat_members WHERE chat_id = c.id) as subscribers_count
      FROM chats c
      WHERE c.type = 'channel' AND c.is_public = true AND c.name ILIKE $1
      LIMIT 20
    `, [`%${q}%`]);
    res.json(channels.rows);
  } catch (err) {
    logger.error('Channel search error:', err);
    res.status(500).json({ error: 'Search failed' });
  }
});

module.exports = router;