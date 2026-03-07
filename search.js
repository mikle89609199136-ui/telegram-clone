const express = require('express');
const router = express.Router();
const { query } = require('./data');
const { redis } = require('./database');
const logger = require('./logger');

// ==================== ГЛАВНЫЙ ПОИСК ====================
// GET /api/search?q=текст&type=all|users|messages|files|chats|channels&filter=media|links
router.get('/', async (req, res) => {
  const { q, type = 'all', filter, limit = 20, offset = 0 } = req.query;
  
  if (!q || q.length < 2) {
    return res.json({});
  }

  try {
    const results = {};

    // Поиск пользователей
    if (type === 'all' || type === 'users') {
      const users = await query(`
        SELECT id, username, avatar, status,
          (SELECT COUNT(*) > 0 FROM devices d 
           WHERE d.user_id = u.id 
             AND EXISTS (SELECT 1 FROM redis WHERE key = 'online:' || u.id || ':' || d.id)) as online
        FROM users u
        WHERE username ILIKE $1
        LIMIT $2 OFFSET $3
      `, [`%${q}%`, parseInt(limit), parseInt(offset)]);
      results.users = users.rows;
    }

    // Поиск сообщений (только в чатах, где пользователь участник)
    if (type === 'all' || type === 'messages') {
      let sql = `
        SELECT m.id, m.content, m.created_at, m.chat_id, m.type, u.username, u.avatar,
          (SELECT name FROM chats WHERE id = m.chat_id) as chat_name
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
      
      sql += ` ORDER BY m.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
      params.push(parseInt(limit), parseInt(offset));
      
      const messages = await query(sql, params);
      results.messages = messages.rows;
    }

    // Поиск файлов (принадлежащих пользователю или в общих чатах)
    if (type === 'all' || type === 'files') {
      // Сначала файлы, загруженные самим пользователем
      const myFiles = await query(`
        SELECT f.id, f.filename, f.path, f.mime_type, f.size, f.created_at,
          'file' as type, f.filename as name
        FROM files f
        WHERE f.user_id = $1 AND f.filename ILIKE $2
        LIMIT $3 OFFSET $4
      `, [req.user.id, `%${q}%`, parseInt(limit), parseInt(offset)]);

      // Также ищем файлы, которые были отправлены как сообщения в доступных чатах
      const chatFiles = await query(`
        SELECT m.id, m.content, m.created_at, m.chat_id, m.type,
          (SELECT name FROM chats WHERE id = m.chat_id) as chat_name,
          u.username as sender_name
        FROM messages m
        JOIN users u ON u.id = m.sender_id
        WHERE m.type IN ('image','video','file')
          AND m.content ILIKE $1
          AND EXISTS (SELECT 1 FROM chat_members cm WHERE cm.chat_id = m.chat_id AND cm.user_id = $2)
        LIMIT $3 OFFSET $4
      `, [`%${q}%`, req.user.id, parseInt(limit), parseInt(offset)]);

      results.files = [...myFiles.rows, ...chatFiles.rows];
    }

    // Поиск чатов (по названию, если это группа/канал)
    if (type === 'all' || type === 'chats') {
      const chats = await query(`
        SELECT c.id, c.name, c.avatar, c.type,
          (SELECT COUNT(*) FROM chat_members WHERE chat_id = c.id) as members_count
        FROM chats c
        JOIN chat_members cm ON cm.chat_id = c.id
        WHERE c.name ILIKE $1 AND cm.user_id = $2
        LIMIT $3 OFFSET $4
      `, [`%${q}%`, req.user.id, parseInt(limit), parseInt(offset)]);
      results.chats = chats.rows;
    }

    // Поиск каналов (публичных)
    if (type === 'all' || type === 'channels') {
      const channels = await query(`
        SELECT c.id, c.name, c.description, c.avatar,
          (SELECT COUNT(*) FROM chat_members WHERE chat_id = c.id) as subscribers_count
        FROM chats c
        WHERE c.type = 'channel' AND c.is_public = true AND c.name ILIKE $1
        LIMIT $2 OFFSET $3
      `, [`%${q}%`, parseInt(limit), parseInt(offset)]);
      results.channels = channels.rows;
    }

    res.json(results);
  } catch (err) {
    logger.error('Search error:', err);
    res.status(500).json({ error: 'Search failed' });
  }
});

// ==================== ПОИСК ПОЛЬЗОВАТЕЛЕЙ (для приглашения в группу) ====================
router.get('/users', async (req, res) => {
  const { q, limit = 20, offset = 0 } = req.query;
  
  if (!q || q.length < 2) {
    return res.json([]);
  }

  try {
    const users = await query(`
      SELECT id, username, avatar, status,
        (SELECT COUNT(*) > 0 FROM devices d 
         WHERE d.user_id = u.id 
           AND EXISTS (SELECT 1 FROM redis WHERE key = 'online:' || u.id || ':' || d.id)) as online
      FROM users u
      WHERE username ILIKE $1
      LIMIT $2 OFFSET $3
    `, [`%${q}%`, parseInt(limit), parseInt(offset)]);
    res.json(users.rows);
  } catch (err) {
    logger.error('User search error:', err);
    res.status(500).json({ error: 'Search failed' });
  }
});

// ==================== ПОИСК СООБЩЕНИЙ В КОНКРЕТНОМ ЧАТЕ ====================
router.get('/chat/:chatId', async (req, res) => {
  const { chatId } = req.params;
  const { q, limit = 50, offset = 0 } = req.query;
  
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
      SELECT m.id, m.content, m.created_at, m.type, u.username, u.avatar,
        (SELECT json_agg(json_build_object('emoji', emoji, 'count', count))
         FROM (SELECT emoji, COUNT(*) as count FROM reactions WHERE message_id = m.id GROUP BY emoji) r) as reactions
      FROM messages m
      JOIN users u ON u.id = m.sender_id
      WHERE m.chat_id = $1 AND m.content ILIKE $2
      ORDER BY m.created_at DESC
      LIMIT $3 OFFSET $4
    `, [chatId, `%${q}%`, parseInt(limit), parseInt(offset)]);

    res.json(messages.rows);
  } catch (err) {
    logger.error('Chat search error:', err);
    res.status(500).json({ error: 'Search failed' });
  }
});

// ==================== ПОИСК КАНАЛОВ (публичных) ====================
router.get('/channels', async (req, res) => {
  const { q, limit = 20, offset = 0 } = req.query;
  
  if (!q || q.length < 2) {
    return res.json([]);
  }

  try {
    const channels = await query(`
      SELECT c.id, c.name, c.description, c.avatar,
        (SELECT COUNT(*) FROM chat_members WHERE chat_id = c.id) as subscribers_count,
        (SELECT COUNT(*) FROM messages WHERE chat_id = c.id) as posts_count
      FROM chats c
      WHERE c.type = 'channel' AND c.is_public = true AND c.name ILIKE $1
      LIMIT $2 OFFSET $3
    `, [`%${q}%`, parseInt(limit), parseInt(offset)]);
    res.json(channels.rows);
  } catch (err) {
    logger.error('Channel search error:', err);
    res.status(500).json({ error: 'Search failed' });
  }
});

// ==================== ПОИСК ПО ТЭГАМ (хештегам) ====================
router.get('/hashtag/:tag', async (req, res) => {
  const { tag } = req.params;
  const { limit = 50, offset = 0 } = req.query;

  try {
    const messages = await query(`
      SELECT m.id, m.content, m.created_at, m.chat_id, u.username, u.avatar,
        (SELECT name FROM chats WHERE id = m.chat_id) as chat_name
      FROM messages m
      JOIN users u ON u.id = m.sender_id
      WHERE m.content ILIKE $1
        AND EXISTS (SELECT 1 FROM chat_members cm WHERE cm.chat_id = m.chat_id AND cm.user_id = $2)
      ORDER BY m.created_at DESC
      LIMIT $3 OFFSET $4
    `, [`%#${tag}%`, req.user.id, parseInt(limit), parseInt(offset)]);

    res.json(messages.rows);
  } catch (err) {
    logger.error('Hashtag search error:', err);
    res.status(500).json({ error: 'Search failed' });
  }
});

// ==================== ПОИСК ФАЙЛОВ ПО ТИПУ ====================
router.get('/files', async (req, res) => {
  const { q, mimeType, limit = 20, offset = 0 } = req.query;

  try {
    let sql = `
      SELECT f.id, f.filename, f.path, f.mime_type, f.size, f.created_at
      FROM files f
      WHERE f.user_id = $1
    `;
    const params = [req.user.id];
    let paramIdx = 2;

    if (q && q.length >= 2) {
      sql += ` AND f.filename ILIKE $${paramIdx++}`;
      params.push(`%${q}%`);
    }
    if (mimeType) {
      sql += ` AND f.mime_type LIKE $${paramIdx++}`;
      params.push(`${mimeType}%`);
    }

    sql += ` ORDER BY f.created_at DESC LIMIT $${paramIdx++} OFFSET $${paramIdx++}`;
    params.push(parseInt(limit), parseInt(offset));

    const files = await query(sql, params);
    res.json(files.rows);
  } catch (err) {
    logger.error('File search error:', err);
    res.status(500).json({ error: 'Search failed' });
  }
});

module.exports = router;
