const { query, transaction } = require('./database');
const { addToQueue, generateId } = require('./utils');
const logger = require('./logger');

async function saveMessage(chatId, senderId, data) {
  const { text, type = 'text', media, replyTo, forwardedFrom } = data;
  if (!text && !media) throw new Error('Message content required');

  const messageUid = generateId();
  const result = await query(
    `INSERT INTO messages (uid, chat_id, sender_id, type, content, media, reply_to, forwarded_from)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
    [messageUid, chatId, senderId, type, text || null, media ? JSON.stringify(media) : null, replyTo || null, forwardedFrom || null]
  );
  const message = result.rows[0];

  // Update chat last message
  await query('UPDATE chats SET last_message_id = $1 WHERE id = $2', [message.id, chatId]);

  // Queue notifications
  await addToQueue('notifications', { type: 'new_message', message });

  // Get sender info
  const sender = await query('SELECT id, username, avatar FROM users WHERE id = $1', [senderId]);
  message.sender = sender.rows[0] || null;

  return message;
}

async function getMessages(chatId, limit = 50, before = null) {
  let sql = `
    SELECT m.*,
           u.id as sender_id, u.username as sender_username, u.avatar as sender_avatar,
           r.id as reply_id, r.content as reply_content, r.type as reply_type
    FROM messages m
    LEFT JOIN users u ON m.sender_id = u.id
    LEFT JOIN messages r ON m.reply_to = r.id
    WHERE m.chat_id = $1 AND m.deleted = false
  `;
  const params = [chatId];
  if (before) {
    sql += ' AND m.id < $2';
    params.push(before);
  }
  sql += ' ORDER BY m.created_at DESC LIMIT $' + (params.length + 1);
  params.push(limit);

  const result = await query(sql, params);
  const messages = result.rows.map(row => ({
    id: row.id,
    uid: row.uid,
    chat_id: row.chat_id,
    type: row.type,
    text: row.content,
    media: row.media,
    reply_to: row.reply_id ? {
      id: row.reply_id,
      content: row.reply_content,
      type: row.reply_type
    } : null,
    forwarded_from: row.forwarded_from,
    views: row.views,
    edited: row.edited,
    created_at: row.created_at,
    sender: row.sender_id ? {
      id: row.sender_id,
      username: row.sender_username,
      avatar: row.sender_avatar
    } : null
  }));
  return messages;
}

async function editMessage(messageId, userId, newText) {
  return transaction(async (client) => {
    const msg = await client.query('SELECT sender_id FROM messages WHERE id = $1 AND deleted = false', [messageId]);
    if (!msg.rows.length || msg.rows[0].sender_id !== userId) {
      throw new Error('Not allowed');
    }
    const result = await client.query(
      'UPDATE messages SET content = $1, edited = true, updated_at = NOW() WHERE id = $2 RETURNING *',
      [newText, messageId]
    );
    return result.rows[0];
  });
}

async function deleteMessage(messageId, userId, deleteForAll = false) {
  return transaction(async (client) => {
    if (deleteForAll) {
      const msg = await client.query('SELECT sender_id FROM messages WHERE id = $1', [messageId]);
      if (!msg.rows.length || msg.rows[0].sender_id !== userId) {
        throw new Error('Not allowed');
      }
      await client.query('UPDATE messages SET deleted = true WHERE id = $1', [messageId]);
    } else {
      await client.query('UPDATE messages SET deleted = true WHERE id = $1 AND sender_id = $2', [messageId, userId]);
    }
  });
}

async function reactToMessage(messageId, userId, reaction) {
  return transaction(async (client) => {
    await client.query(
      `INSERT INTO message_reactions (message_id, user_id, reaction)
       VALUES ($1, $2, $3)
       ON CONFLICT (message_id, user_id, reaction) DO NOTHING`,
      [messageId, userId, reaction]
    );
    const reactions = await client.query(
      'SELECT reaction, COUNT(*) FROM message_reactions WHERE message_id = $1 GROUP BY reaction',
      [messageId]
    );
    return reactions.rows;
  });
}

async function markAsRead(chatId, userId, messageIds) {
  if (!messageIds || !messageIds.length) return;
  const values = messageIds.map(id => `(${id}, ${userId})`).join(',');
  await query(
    `INSERT INTO message_reads (message_id, user_id) VALUES ${values} ON CONFLICT DO NOTHING`
  );
}

async function getUnreadCount(userId, chatId) {
  const result = await query(
    `SELECT COUNT(*) FROM messages m
     WHERE m.chat_id = $1 AND m.deleted = false
       AND NOT EXISTS (SELECT 1 FROM message_reads mr WHERE mr.message_id = m.id AND mr.user_id = $2)`,
    [chatId, userId]
  );
  return parseInt(result.rows[0].count);
}

module.exports = {
  saveMessage,
  getMessages,
  editMessage,
  deleteMessage,
  reactToMessage,
  markAsRead,
  getUnreadCount,
};
