// messages.js – message handling
const express = require('express');
const router = express.Router();
const authenticateToken = require('./authMiddleware');
const { db } = require('./database');
const { generateId, escapeHtml } = require('./utils');
const logger = require('./logger');

// Get messages for a chat (with pagination)
router.get('/:chatId', authenticateToken, async (req, res) => {
  try {
    const { chatId } = req.params;
    const { limit = 50, before } = req.query;
    const userId = req.user.id;

    const access = await db.query(
      'SELECT 1 FROM chat_participants WHERE chat_id = $1 AND user_id = $2',
      [chatId, userId]
    );
    if (access.rows.length === 0) {
      return res.status(403).json({ error: 'No access to this chat' });
    }

    let query = `
      SELECT m.*, 
             u.username as sender_username, u.avatar as sender_avatar,
             (SELECT json_agg(json_build_object('user_id', r.user_id, 'reaction', r.reaction))
              FROM message_reactions r WHERE r.message_id = m.id) as reactions
      FROM messages m
      JOIN users u ON m.sender_id = u.id
      WHERE m.chat_id = $1
    `;
    const params = [chatId];
    if (before) {
      query += ` AND m.created_at < $2`;
      params.push(new Date(parseInt(before)));
    }
    query += ` ORDER BY m.created_at DESC LIMIT $${params.length + 1}`;
    params.push(parseInt(limit));

    const result = await db.query(query, params);
    res.json(result.rows);
  } catch (err) {
    logger.error('Get messages error:', err);
    res.status(500).json({ error: 'Failed to get messages' });
  }
});

// Send a message
router.post('/:chatId', authenticateToken, async (req, res) => {
  try {
    const { chatId } = req.params;
    const { content, type = 'text', fileUrl, fileName, fileSize, mimeType, pollData, aiMetadata } = req.body;
    const senderId = req.user.id;

    const access = await db.query(
      'SELECT 1 FROM chat_participants WHERE chat_id = $1 AND user_id = $2',
      [chatId, senderId]
    );
    if (access.rows.length === 0) {
      return res.status(403).json({ error: 'No access to this chat' });
    }

    const messageId = generateId();
    await db.query(
      `INSERT INTO messages (id, chat_id, sender_id, content, type, file_url, file_name, file_size, mime_type, poll_data, ai_metadata, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())`,
      [messageId, chatId, senderId, content, type, fileUrl, fileName, fileSize, mimeType, pollData ? JSON.stringify(pollData) : null, aiMetadata ? JSON.stringify(aiMetadata) : null]
    );

    const newMsg = await db.query(
      `SELECT m.*, u.username as sender_username, u.avatar as sender_avatar
       FROM messages m JOIN users u ON m.sender_id = u.id WHERE m.id = $1`,
      [messageId]
    );
    res.status(201).json(newMsg.rows[0]);
  } catch (err) {
    logger.error('Send message error:', err);
    res.status(500).json({ error: 'Failed to send message' });
  }
});

// Add reaction
router.post('/:messageId/reactions', authenticateToken, async (req, res) => {
  try {
    const { messageId } = req.params;
    const { reaction } = req.body;
    const userId = req.user.id;

    await db.query(
      `INSERT INTO message_reactions (message_id, user_id, reaction, created_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (message_id, user_id, reaction) DO NOTHING`,
      [messageId, userId, reaction]
    );
    res.json({ success: true });
  } catch (err) {
    logger.error('Add reaction error:', err);
    res.status(500).json({ error: 'Failed to add reaction' });
  }
});

// Remove reaction
router.delete('/:messageId/reactions/:reaction', authenticateToken, async (req, res) => {
  try {
    const { messageId, reaction } = req.params;
    const userId = req.user.id;
    await db.query(
      'DELETE FROM message_reactions WHERE message_id = $1 AND user_id = $2 AND reaction = $3',
      [messageId, userId, reaction]
    );
    res.json({ success: true });
  } catch (err) {
    logger.error('Remove reaction error:', err);
    res.status(500).json({ error: 'Failed to remove reaction' });
  }
});

// Delete message (for self or for all)
router.delete('/:messageId', authenticateToken, async (req, res) => {
  try {
    const { messageId } = req.params;
    const { forAll } = req.query;
    const userId = req.user.id;

    const msg = await db.query('SELECT sender_id, chat_id FROM messages WHERE id = $1', [messageId]);
    if (msg.rows.length === 0) return res.status(404).json({ error: 'Message not found' });

    if (forAll === 'true') {
      const roleCheck = await db.query(
        'SELECT role FROM chat_participants WHERE chat_id = $1 AND user_id = $2',
        [msg.rows[0].chat_id, userId]
      );
      if (roleCheck.rows.length === 0 || !['owner', 'admin'].includes(roleCheck.rows[0].role)) {
        return res.status(403).json({ error: 'Insufficient permissions to delete for all' });
      }
      await db.query('DELETE FROM messages WHERE id = $1', [messageId]);
    } else {
      await db.query(
        'INSERT INTO hidden_messages (user_id, message_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [userId, messageId]
      );
    }
    res.json({ success: true });
  } catch (err) {
    logger.error('Delete message error:', err);
    res.status(500).json({ error: 'Failed to delete message' });
  }
});

module.exports = router;
