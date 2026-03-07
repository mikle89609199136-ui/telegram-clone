const express = require('express');
const router = express.Router();
const { query } = require('./data');
const { generateId, sanitize, formatRelativeTime } = require('./utils');
const logger = require('./logger');
const { checkPermission, PERMISSIONS } = require('./security');

// ==================== ПОЛУЧЕНИЕ СООБЩЕНИЙ ЧАТА (с пагинацией) ====================
router.get('/:chatId', async (req, res) => {
  const { chatId } = req.params;
  const { limit = 50, before, after } = req.query;

  try {
    // Проверка доступа к чату
    const member = await query(
      'SELECT 1 FROM chat_members WHERE chat_id = $1 AND user_id = $2',
      [chatId, req.user.id]
    );
    if (member.rows.length === 0) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Проверка права на просмотр истории
    const canViewHistory = await checkPermission(req.user.id, chatId, PERMISSIONS.VIEW_HISTORY);
    if (!canViewHistory) {
      return res.status(403).json({ error: 'No permission to view chat history' });
    }

    let sql = `
      SELECT m.*, u.username, u.avatar
      FROM messages m
      JOIN users u ON u.id = m.sender_id
      WHERE m.chat_id = $1
    `;
    const params = [chatId];
    let paramIndex = 2;

    if (before) {
      params.push(before);
      sql += ` AND m.created_at < $${paramIndex++}`;
    }
    if (after) {
      params.push(after);
      sql += ` AND m.created_at > $${paramIndex++}`;
    }
    
    sql += ` ORDER BY m.created_at DESC LIMIT $${paramIndex}`;
    params.push(parseInt(limit));

    const result = await query(sql, params);
    
    // Получаем реакции для каждого сообщения
    const messagesWithReactions = await Promise.all(result.rows.map(async (msg) => {
      const reactionsRes = await query(`
        SELECT json_agg(json_build_object(
          'emoji', emoji, 
          'count', count,
          'userReacted', (SELECT COUNT(*) > 0 FROM reactions r2 WHERE r2.message_id = $1 AND r2.user_id = $2 AND r2.emoji = reactions.emoji)
        )) as reactions
        FROM (
          SELECT emoji, COUNT(*) as count
          FROM reactions
          WHERE message_id = $1
          GROUP BY emoji
        ) reactions
      `, [msg.id, req.user.id]);
      
      return {
        ...msg,
        reactions: reactionsRes.rows[0]?.reactions || [],
        formattedTime: formatRelativeTime(msg.created_at)
      };
    }));

    // Возвращаем в хронологическом порядке (от старых к новым)
    res.json(messagesWithReactions.reverse());
  } catch (err) {
    logger.error('Error fetching messages:', err);
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

// ==================== ПОЛУЧЕНИЕ ОДНОГО СООБЩЕНИЯ ====================
router.get('/single/:messageId', async (req, res) => {
  const { messageId } = req.params;

  try {
    const message = await query(`
      SELECT m.*, u.username, u.avatar
      FROM messages m
      JOIN users u ON u.id = m.sender_id
      WHERE m.id = $1
    `, [messageId]);

    if (message.rows.length === 0) {
      return res.status(404).json({ error: 'Message not found' });
    }

    const msg = message.rows[0];
    
    // Проверка доступа к чату
    const member = await query(
      'SELECT 1 FROM chat_members WHERE chat_id = $1 AND user_id = $2',
      [msg.chat_id, req.user.id]
    );
    if (member.rows.length === 0) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Получаем реакции
    const reactionsRes = await query(`
      SELECT json_agg(json_build_object(
        'emoji', emoji, 
        'count', count,
        'userReacted', (SELECT COUNT(*) > 0 FROM reactions r2 WHERE r2.message_id = $1 AND r2.user_id = $2 AND r2.emoji = reactions.emoji)
      )) as reactions
      FROM (
        SELECT emoji, COUNT(*) as count
        FROM reactions
        WHERE message_id = $1
        GROUP BY emoji
      ) reactions
    `, [msg.id, req.user.id]);

    res.json({
      ...msg,
      reactions: reactionsRes.rows[0]?.reactions || [],
      formattedTime: formatRelativeTime(msg.created_at)
    });
  } catch (err) {
    logger.error('Error fetching single message:', err);
    res.status(500).json({ error: 'Failed to fetch message' });
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
    // Проверка членства в чате
    const member = await query(
      'SELECT 1 FROM chat_members WHERE chat_id = $1 AND user_id = $2',
      [chatId, req.user.id]
    );
    if (member.rows.length === 0) {
      return res.status(403).json({ error: 'Not a member' });
    }

    // Проверка прав на отправку
    const hasSendPermission = await checkPermission(req.user.id, chatId, PERMISSIONS.SEND_MESSAGE);
    if (!hasSendPermission) {
      return res.status(403).json({ error: 'No permission to send messages' });
    }

    const messageId = generateId();
    const safeContent = sanitize(content);

    await query(`
      INSERT INTO messages (id, chat_id, sender_id, content, type, reply_to, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, NOW())
    `, [messageId, chatId, req.user.id, safeContent, type, replyTo]);

    // Получаем информацию об отправителе
    const senderRes = await query('SELECT username, avatar FROM users WHERE id = $1', [req.user.id]);
    const sender = senderRes.rows[0];

    const message = {
      id: messageId,
      chatId,
      senderId: req.user.id,
      sender: { 
        id: req.user.id, 
        username: sender.username,
        avatar: sender.avatar
      },
      content: safeContent,
      type,
      replyTo,
      created_at: new Date().toISOString(),
      formattedTime: formatRelativeTime(new Date()),
      reactions: []
    };

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
    // Проверяем, что сообщение принадлежит пользователю
    const msgRes = await query(
      'SELECT chat_id, sender_id FROM messages WHERE id = $1',
      [messageId]
    );
    if (msgRes.rows.length === 0) {
      return res.status(404).json({ error: 'Message not found' });
    }
    
    const { chat_id: chatId, sender_id: senderId } = msgRes.rows[0];
    
    // Проверка прав
    let canEdit = false;
    if (senderId === req.user.id) {
      canEdit = true;
    } else {
      canEdit = await checkPermission(req.user.id, chatId, PERMISSIONS.EDIT_MESSAGE);
    }
    
    if (!canEdit) {
      return res.status(403).json({ error: 'No permission to edit this message' });
    }

    const result = await query(
      'UPDATE messages SET content = $1, edited = TRUE WHERE id = $2 RETURNING *',
      [sanitize(content), messageId]
    );
    
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
    // Получаем информацию о сообщении
    const msgRes = await query(
      'SELECT chat_id, sender_id FROM messages WHERE id = $1',
      [messageId]
    );
    if (msgRes.rows.length === 0) {
      return res.status(404).json({ error: 'Message not found' });
    }
    
    const { chat_id: chatId, sender_id: senderId } = msgRes.rows[0];
    
    // Проверка прав
    let canDelete = false;
    if (senderId === req.user.id) {
      canDelete = true;
    } else {
      canDelete = await checkPermission(req.user.id, chatId, PERMISSIONS.DELETE_MESSAGE);
    }
    
    if (!canDelete) {
      return res.status(403).json({ error: 'No permission to delete this message' });
    }

    const result = await query(
      'DELETE FROM messages WHERE id = $1 RETURNING id',
      [messageId]
    );
    
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
      SELECT emoji, COUNT(*) as count,
        (SELECT COUNT(*) > 0 FROM reactions r2 WHERE r2.message_id = $1 AND r2.user_id = $2 AND r2.emoji = reactions.emoji) as userReacted
      FROM reactions
      WHERE message_id = $1
      GROUP BY emoji
    `, [messageId, req.user.id]);
    
    res.json(result.rows);
  } catch (err) {
    logger.error('Error fetching reactions:', err);
    res.status(500).json({ error: 'Failed to fetch reactions' });
  }
});

// ==================== ДОБАВЛЕНИЕ РЕАКЦИИ (REST) ====================
router.post('/:messageId/reactions', async (req, res) => {
  const { messageId } = req.params;
  const { emoji } = req.body;

  if (!emoji) {
    return res.status(400).json({ error: 'Emoji required' });
  }

  try {
    // Проверяем существование сообщения
    const msgRes = await query('SELECT chat_id FROM messages WHERE id = $1', [messageId]);
    if (msgRes.rows.length === 0) {
      return res.status(404).json({ error: 'Message not found' });
    }
    
    const chatId = msgRes.rows[0].chat_id;
    
    // Проверка права на реакции
    const hasReactPermission = await checkPermission(req.user.id, chatId, PERMISSIONS.REACT);
    if (!hasReactPermission) {
      return res.status(403).json({ error: 'No permission to react' });
    }

    await query(`
      INSERT INTO reactions (message_id, user_id, emoji, created_at)
      VALUES ($1, $2, $3, NOW())
      ON CONFLICT (message_id, user_id, emoji) DO NOTHING
    `, [messageId, req.user.id, emoji]);

    res.json({ success: true });
  } catch (err) {
    logger.error('Error adding reaction:', err);
    res.status(500).json({ error: 'Failed to add reaction' });
  }
});

// ==================== УДАЛЕНИЕ РЕАКЦИИ (REST) ====================
router.delete('/:messageId/reactions', async (req, res) => {
  const { messageId } = req.params;
  const { emoji } = req.body;

  try {
    await query(
      'DELETE FROM reactions WHERE message_id = $1 AND user_id = $2 AND emoji = $3',
      [messageId, req.user.id, emoji]
    );

    res.json({ success: true });
  } catch (err) {
    logger.error('Error removing reaction:', err);
    res.status(500).json({ error: 'Failed to remove reaction' });
  }
});

// ==================== ПЕРЕСЫЛКА СООБЩЕНИЯ (REST) ====================
router.post('/:messageId/forward', async (req, res) => {
  const { messageId } = req.params;
  const { toChatId } = req.body;

  try {
    // Получаем исходное сообщение
    const msgRes = await query('SELECT content, type FROM messages WHERE id = $1', [messageId]);
    if (msgRes.rows.length === 0) {
      return res.status(404).json({ error: 'Original message not found' });
    }
    const { content, type } = msgRes.rows[0];

    // Проверяем членство в целевом чате
    const member = await query(
      'SELECT 1 FROM chat_members WHERE chat_id = $1 AND user_id = $2',
      [toChatId, req.user.id]
    );
    if (member.rows.length === 0) {
      return res.status(403).json({ error: 'Not a member of target chat' });
    }

    // Проверка прав на отправку в целевом чате
    const hasSendPermission = await checkPermission(req.user.id, toChatId, PERMISSIONS.SEND_MESSAGE);
    if (!hasSendPermission) {
      return res.status(403).json({ error: 'No permission to send messages to target chat' });
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

// ==================== ПОИСК СООБЩЕНИЙ В ЧАТЕ ====================
router.get('/search/:chatId', async (req, res) => {
  const { chatId } = req.params;
  const { q, limit = 50 } = req.query;

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
      LIMIT $3
    `, [chatId, `%${q}%`, parseInt(limit)]);

    res.json(messages.rows);
  } catch (err) {
    logger.error('Error searching messages:', err);
    res.status(500).json({ error: 'Search failed' });
  }
});

module.exports = router;
