// websocket.js — все real-time события
const jwt = require('jsonwebtoken');
const config = require('./config');
const logger = require('./logger');
const { db } = require('./database');
const { generateId } = require('./utils');

module.exports = (io) => {
  io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) return next(new Error('Token missing'));

    jwt.verify(token, config.JWT_SECRET, (err, user) => {
      if (err) return next(new Error('Invalid token'));
      socket.userId = user.id;
      socket.username = user.username;
      next();
    });
  });

  io.on('connection', async (socket) => {
    const userId = socket.userId;
    logger.info(`User ${socket.username} connected`);

    // Обновляем статус
    await db.query('UPDATE users SET status = $1, last_seen = NOW() WHERE id = $2', ['online', userId]);

    // Подключаем к комнатам чатов
    const chats = await db.query('SELECT chat_id FROM chat_participants WHERE user_id = $1', [userId]);
    chats.rows.forEach(row => socket.join(`chat:${row.chat_id}`));
    socket.join(`user:${userId}`);

    // Отправка сообщения
    socket.on('sendMessage', async (data) => {
      try {
        const { chatId, content, type = 'text' } = data;
        // проверка доступа
        const access = await db.query('SELECT 1 FROM chat_participants WHERE chat_id = $1 AND user_id = $2', [chatId, userId]);
        if (access.rows.length === 0) return socket.emit('error', 'No access');

        const messageId = generateId();
        await db.query(
          `INSERT INTO messages (id, chat_id, sender_id, content, type, created_at)
           VALUES ($1, $2, $3, $4, $5, NOW())`,
          [messageId, chatId, userId, content, type]
        );

        const newMsg = await db.query(
          `SELECT m.*, u.username as sender_username, u.avatar as sender_avatar
           FROM messages m JOIN users u ON m.sender_id = u.id WHERE m.id = $1`,
          [messageId]
        );
        io.to(`chat:${chatId}`).emit('newMessage', newMsg.rows[0]);
      } catch (err) {
        logger.error('Socket sendMessage error:', err);
      }
    });

    // Печатает
    socket.on('typing', ({ chatId, isTyping }) => {
      socket.to(`chat:${chatId}`).emit('userTyping', { userId, username: socket.username, isTyping });
    });

    // Прочтение
    socket.on('readMessages', async ({ chatId, messageIds }) => {
      await db.query('UPDATE chat_participants SET last_read_at = NOW() WHERE chat_id = $1 AND user_id = $2', [chatId, userId]);
      socket.to(`chat:${chatId}`).emit('messagesRead', { userId, messageIds });
    });

    // Присоединиться к новому чату
    socket.on('joinChat', (chatId) => {
      socket.join(`chat:${chatId}`);
    });

    // Отключение
    socket.on('disconnect', async () => {
      logger.info(`User ${socket.username} disconnected`);
      await db.query('UPDATE users SET status = $1, last_seen = NOW() WHERE id = $2', ['offline', userId]);
    });
  });

  // Правило 57: переподключение на клиенте уже должно быть настроено
};
