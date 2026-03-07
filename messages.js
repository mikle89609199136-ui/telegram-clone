const express = require('express');
const router = express.Router();
const { query } = require('./data');
const { generateId, sanitize } = require('./utils');
const logger = require('./logger');

// ==================== ПОЛУЧЕНИЕ СООБЩЕНИЙ ЧАТА (с пагинацией) ====================
router.get('/:chatId', async (req, res) => {
  const { chatId } = req.params;
  const { limit = 50, before } = req.query;

  try {
    // Проверка доступа к чату
    const member = await query(
      'SELECT 1 FROM chat_members WHERE chat_id = $1 AND user_id = $2',
      [chatId, req.user.id]
    );
    if (member.rows.length === 0) {
      return res.status(403).json({ error: 'Access denied' });
    }

    let sql = `
      SELECT m.*, u.username, u.avatar
      FROM messages m
      JOIN users u ON u.id = m.sender_id
      WHERE m.chat_id = $1
    `;
    const params = [chatId];
    if (before) {
      params.push(before);
      sql += ` AND m.created_at < $2`;
    }
    sql += ` ORDER BY m.created_at DESC LIMIT $${params.length + 1}`;
    params.push(parseInt(limit));

    const result = await query(sql, params);
    // Возвращаем в хронологическом порядке (от старых к новым)
    res.json(result.rows.reverse());
  } catch (err) {
    logger.error('Error fetching messages:', err);
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

// ==================== ОТПРАВКА СООБЩЕНИЯ (REST, дублёр WebSocket) ====================
router.post('/:chatId', async (req, res) => {
  const { chatId } = req.params;
  const { content, type = 'text', replyTo } = req.body;
  if (!content) {
    return res.status(400).json({ error: 'Content required' });
  }

  try {
    const member = await query(
      'SELECT 1 FROM chat_members WHERE chat_id = $1 AND user_id = $2',
      [chatId, req.user.id]
    );
    if (member.rows.length === 0) {
      return res.status(403).json({ error: 'Not a member' });
    }

    const messageId = generateId();
    const safeContent = sanitize(content);

    await query(`
      INSERT INTO messages (id, chat_id, sender_id, content, type, reply_to, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, NOW())
    `, [messageId, chatId, req.user.id, safeContent, type, replyTo]);

    const message = {
      id: messageId,
      chatId,
      senderId: req.user.id,
      sender: { id: req.user.id, username: req.user.username },
      content: safeContent,
      type,
      replyTo,
      created_at: new Date().toISOString()
    };

    // Уведомление через WebSocket (если нужно) можно отправить, но обычно через WebSocket уже
    // Здесь просто возвращаем сообщение
    res.status(201).json(message);
  } catch (err) {
    logger.error('Error sending message via REST:', err);
    res.status(500).json({ error: 'Failed to send message' });
  }
});

// ==================== РЕДАКТИРОВАНИЕ СООБЩЕНИЯ ====================
router.put('/:messageId', async (req, res) => {
  const { messageId } = req.params;
  const { content } = req.body;
  if (!content) {
    return res.status(400).json({ error: 'Content required' });
  }

  try {
    const result = await query(
      'UPDATE messages SET content = $1, edited = TRUE WHERE id = $2 AND sender_id = $3 RETURNING *',
      [sanitize(content), messageId, req.user.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Message not found or not yours' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    logger.error('Error editing message:', err);
    res.status(500).json({ error: 'Failed to edit message' });
  }
});

// ==================== УДАЛЕНИЕ СООБЩЕНИЯ ====================
router.delete('/:messageId', async (req, res) => {
  const { messageId } = req.params;

  try {
    const result = await query(
      'DELETE FROM messages WHERE id = $1 AND sender_id = $2 RETURNING id',
      [messageId, req.user.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Message not found or not yours' });
    }
    res.json({ success: true });
  } catch (err) {
    logger.error('Error deleting message:', err);
    res.status(500).json({ error: 'Failed to delete message' });
  }
});

// ==================== ПОЛУЧЕНИЕ РЕАКЦИЙ НА СООБЩЕНИЕ ====================
router.get('/:messageId/reactions', async (req, res) => {
  const { messageId } = req.params;

  try {
    const result = await query(`
      SELECT emoji, COUNT(*) as count
      FROM reactions
      WHERE message_id = $1
      GROUP BY emoji
    `, [messageId]);
    res.json(result.rows);
  } catch (err) {
    logger.error('Error fetching reactions:', err);
    res.status(500).json({ error: 'Failed to fetch reactions' });
  }
});

// ==================== ПЕРЕСЫЛКА СООБЩЕНИЯ (REST) ====================
router.post('/:messageId/forward', async (req, res) => {
  const { messageId } = req.params;
  const { toChatId } = req.body;

  try {
    const msgRes = await query('SELECT content, type FROM messages WHERE id = $1', [messageId]);
    if (msgRes.rows.length === 0) {
      return res.status(404).json({ error: 'Original message not found' });
    }
    const { content, type } = msgRes.rows[0];

    const member = await query(
      'SELECT 1 FROM chat_members WHERE chat_id = $1 AND user_id = $2',
      [toChatId, req.user.id]
    );
    if (member.rows.length === 0) {
      return res.status(403).json({ error: 'Not a member of target chat' });
    }

    const newMessageId = generateId();
    await query(`
      INSERT INTO messages (id, chat_id, sender_id, content, type, forwarded, created_at)
      VALUES ($1, $2, $3, $4, $5, true, NOW())
    `, [newMessageId, toChatId, req.user.id, content, type]);

    res.json({ success: true, messageId: newMessageId });
  } catch (err) {
    logger.error('Error forwarding message:', err);
    res.status(500).json({ error: 'Failed to forward message' });
  }
});

// ==================== ЗАКРЕПЛЕНИЕ СООБЩЕНИЯ (REST) ====================
router.post('/:messageId/pin', async (req, res) => {
  const { messageId } = req.params;

  try {
    const msgRes = await query('SELECT chat_id FROM messages WHERE id = $1', [messageId]);
    if (msgRes.rows.length === 0) {
      return res.status(404).json({ error: 'Message not found' });
    }
    const chatId = msgRes.rows[0].chat_id;

    // Проверка прав
    const roleRes = await query(
      'SELECT role FROM chat_members WHERE chat_id = $1 AND user_id = $2',
      [chatId, req.user.id]
    );
    const role = roleRes.rows[0]?.role;
    if (!['owner', 'admin'].includes(role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    // Снимаем закрепление с других
    await query('UPDATE messages SET pinned = false WHERE chat_id = $1', [chatId]);
    await query('UPDATE messages SET pinned = true WHERE id = $1', [messageId]);

    res.json({ success: true });
  } catch (err) {
    logger.error('Error pinning message:', err);
    res.status(500).json({ error: 'Failed to pin message' });
  }
});

module.exports = router;