const express = require('express');
const { query } = require('./database');
const logger = require('./logger');
const router = express.Router();

router.get('/users', async (req, res) => {
  const q = req.query.q;
  if (!q || q.length < 2) return res.json([]);
  try {
    const result = await query(
      `SELECT id, uid, username, avatar, bio, online
       FROM users
       WHERE username ILIKE $1 OR (bio ILIKE $1 AND bio IS NOT NULL)
       LIMIT 20`,
      [`%${q}%`]
    );
    res.json(result.rows);
  } catch (err) {
    logger.error('Search users error', err);
    res.status(500).json({ error: 'Database error' });
  }
});

router.get('/messages', async (req, res) => {
  const { q, chatId } = req.query;
  if (!q || q.length < 2 || !chatId) return res.status(400).json({ error: 'Missing parameters' });

  try {
    const result = await query(
      `SELECT m.id, m.uid, m.type, m.content as text, m.media, m.created_at,
              u.id as sender_id, u.username as sender_username, u.avatar as sender_avatar
       FROM messages m
       LEFT JOIN users u ON m.sender_id = u.id
       WHERE m.chat_id = $1 AND m.deleted = false AND m.content ILIKE $2
       ORDER BY m.created_at DESC
       LIMIT 50`,
      [chatId, `%${q}%`]
    );
    res.json(result.rows.map(r => ({
      id: r.id,
      uid: r.uid,
      type: r.type,
      text: r.text,
      media: r.media,
      created_at: r.created_at,
      sender: r.sender_id ? {
        id: r.sender_id,
        username: r.sender_username,
        avatar: r.sender_avatar
      } : null
    })));
  } catch (err) {
    logger.error('Search messages error', err);
    res.status(500).json({ error: 'Database error' });
  }
});

router.get('/chats', async (req, res) => {
  const q = req.query.q;
  const userId = req.userId;
  if (!q || q.length < 2) return res.json([]);

  try {
    const result = await query(
      `SELECT DISTINCT c.id, c.uid, c.type, c.title, c.avatar,
              (SELECT row_to_json(msg) FROM (
                 SELECT m.id, m.content as text, m.created_at
                 FROM messages m WHERE m.chat_id = c.id AND m.deleted = false
                 ORDER BY m.created_at DESC LIMIT 1
               ) msg) as last_message
       FROM chats c
       LEFT JOIN chat_members cm ON c.id = cm.chat_id
       LEFT JOIN users u ON cm.user_id = u.id
       WHERE c.type IN ('group', 'channel') AND c.title ILIKE $1
          OR (c.type = 'private' AND u.username ILIKE $1)
       LIMIT 20`,
      [`%${q}%`]
    );
    res.json(result.rows);
  } catch (err) {
    logger.error('Search chats error', err);
    res.status(500).json({ error: 'Database error' });
  }
});

module.exports = router;
