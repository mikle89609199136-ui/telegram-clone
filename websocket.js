// websocket.js – Socket.IO realtime events
const jwt = require('jsonwebtoken');
const { Server } = require('socket.io');
const config = require('./config');
const logger = require('./logger');
const { db } = require('./database');
const { generateId, formatMessageTime } = require('./utils');
const { sendPushNotification } = require('./notifications');

module.exports = (server) => {
  const io = new Server(server, {
    cors: {
      origin: config.FRONTEND_URL,
      methods: ['GET', 'POST'],
    },
    pingTimeout: 60000,
    pingInterval: 25000,
  });

  // Authentication middleware for socket
  io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) {
      return next(new Error('Authentication error: token missing'));
    }
    jwt.verify(token, config.JWT_SECRET, (err, user) => {
      if (err) {
        return next(new Error('Authentication error: invalid token'));
      }
      socket.userId = user.id;
      socket.username = user.username;
      next();
    });
  });

  io.on('connection', async (socket) => {
    const userId = socket.userId;
    logger.info(`User ${socket.username} (${userId}) connected`);

    // Update user status to online
    await db.query('UPDATE users SET status = $1, last_seen = NOW() WHERE id = $2', ['online', userId]);

    // Join rooms for all chats the user is part of
    const chats = await db.query('SELECT chat_id FROM chat_participants WHERE user_id = $1', [userId]);
    chats.rows.forEach(row => {
      socket.join(`chat:${row.chat_id}`);
    });
    // Personal room for notifications
    socket.join(`user:${userId}`);

    // --- Event handlers ---

    // Send a new message
    socket.on('sendMessage', async (data) => {
      try {
        const { chatId, content, type = 'text', fileUrl, fileName, fileSize, mimeType, pollData, aiMetadata } = data;
        const senderId = userId;

        // Check access
        const access = await db.query(
          'SELECT 1 FROM chat_participants WHERE chat_id = $1 AND user_id = $2',
          [chatId, senderId]
        );
        if (access.rows.length === 0) {
          socket.emit('error', { message: 'No access to this chat' });
          return;
        }

        const messageId = generateId();
        await db.query(
          `INSERT INTO messages (id, chat_id, sender_id, content, type, file_url, file_name, file_size, mime_type, poll_data, ai_metadata, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())`,
          [messageId, chatId, senderId, content, type, fileUrl, fileName, fileSize, mimeType, pollData ? JSON.stringify(pollData) : null, aiMetadata ? JSON.stringify(aiMetadata) : null]
        );

        const newMsg = await db.query(
          `SELECT m.*, u.username as sender_username, u.avatar as sender_avatar
           FROM messages m
           JOIN users u ON m.sender_id = u.id
           WHERE m.id = $1`,
          [messageId]
        );
        const message = newMsg.rows[0];

        // Broadcast to chat room
        io.to(`chat:${chatId}`).emit('newMessage', message);

        // Update chat's last message time
        await db.query('UPDATE chats SET updated_at = NOW() WHERE id = $1', [chatId]);

        // Send push notifications to other participants
        const participants = await db.query(
          'SELECT user_id FROM chat_participants WHERE chat_id = $1 AND user_id != $2',
          [chatId, senderId]
        );
        for (const p of participants.rows) {
          const user = await db.query('SELECT notification_settings FROM users WHERE id = $1', [p.user_id]);
          const settings = user.rows[0]?.notification_settings || {};
          if (settings.messages !== false) {
            const title = `New message from ${socket.username}`;
            const body = content.length > 50 ? content.substring(0, 50) + '…' : content;
            sendPushNotification(p.user_id, title, body, { chatId, messageId });
          }
        }
      } catch (err) {
        logger.error('sendMessage error:', err);
        socket.emit('error', { message: 'Failed to send message' });
      }
    });

    // Typing indicator
    socket.on('typing', ({ chatId, isTyping }) => {
      socket.to(`chat:${chatId}`).emit('userTyping', {
        userId,
        username: socket.username,
        isTyping,
      });
    });

    // Mark messages as read
    socket.on('readMessages', async ({ chatId, messageIds }) => {
      try {
        // Update last_read_at for the user in this chat
        await db.query(
          'UPDATE chat_participants SET last_read_at = NOW() WHERE chat_id = $1 AND user_id = $2',
          [chatId, userId]
        );
        // Notify others that these messages were read
        socket.to(`chat:${chatId}`).emit('messagesRead', { userId, messageIds });
      } catch (err) {
        logger.error('readMessages error:', err);
      }
    });

    // Join a new chat (after being added)
    socket.on('joinChat', (chatId) => {
      socket.join(`chat:${chatId}`);
    });

    // Leave a chat (if removed)
    socket.on('leaveChat', (chatId) => {
      socket.leave(`chat:${chatId}`);
    });

    // Disconnect
    socket.on('disconnect', async () => {
      logger.info(`User ${socket.username} disconnected`);
      await db.query('UPDATE users SET status = $1, last_seen = NOW() WHERE id = $2', ['offline', userId]);
    });
  });

  // Правило 57: клиент сам должен переподключаться; на сервере дополнительно ничего не нужно
  return io;
};
