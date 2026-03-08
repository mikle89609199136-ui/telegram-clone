// server.js — основной файл сервера (настройка Express, middleware, маршруты)
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const fs = require('fs-extra');
const compression = require('compression');
const morgan = require('morgan');
const config = require('./config');
const logger = require('./logger');
const checkEnv = require('./env');
const { corsOptions, limiter, helmetConfig } = require('./security');
const { handleMulterError } = require('./upload');
const { db } = require('./database');
const authMiddleware = require('./authMiddleware');

// Проверка переменных окружения
checkEnv();

// Создание директорий
fs.ensureDirSync(config.UPLOAD.dir);
fs.ensureDirSync(path.join(__dirname, 'logs'));
fs.ensureDirSync(path.join(__dirname, 'data'));

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: { origin: config.FRONTEND_URL, methods: ['GET', 'POST'] },
  pingTimeout: 60000,
  pingInterval: 25000,
});

// Middleware
app.use(compression());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan('combined', { stream: { write: (message) => logger.info(message.trim()) } }));

// Безопасность
app.use(require('helmet')(helmetConfig));
app.use(require('cors')(corsOptions));
app.use('/api/', limiter); // Правило 58

// Статические файлы из public (Правило 61)
app.use(express.static(path.join(__dirname, 'public')));

// Подключение маршрутов
app.use('/api/auth', require('./auth'));
app.use('/api/users', require('./users'));
app.use('/api/chats', require('./chats'));
app.use('/api/messages', require('./messages'));
app.use('/api/channels', require('./channels'));
app.use('/api/contacts', require('./contacts'));
app.use('/api/calls', require('./calls'));
app.use('/api/media', require('./media'));
app.use('/api/search', require('./search'));
app.use('/api/settings', require('./settings'));
app.use('/api/profile', require('./profile'));
app.use('/api/notifications', require('./notifications'));
app.use('/api/ai', require('./ai'));
app.use('/api/upload', require('./upload')); // будет экспортировать маршруты загрузки

// Обработка ошибок multer
app.use(handleMulterError);

// Health check для Railway
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Для всех остальных путей отдаём chat.html (SPA)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'chat.html'));
});

// Socket.IO
const socketHandler = require('./index')(io); // Если мы вынесем обработчики в отдельный файл, но можно и здесь
// Пока оставим встроенным для простоты
io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  if (!token) return next(new Error('Authentication error'));
  const jwt = require('jsonwebtoken');
  jwt.verify(token, config.JWT_SECRET, (err, user) => {
    if (err) return next(new Error('Invalid token'));
    socket.userId = user.id;
    socket.username = user.username;
    next();
  });
});

io.on('connection', async (socket) => {
  logger.info(`Socket connected: ${socket.username} (${socket.userId})`);

  // Обновляем статус
  await db.query('UPDATE users SET status = $1, last_seen = NOW() WHERE id = $2', ['online', socket.userId]);

  // Присоединяем к комнатам чатов
  const chats = await db.query('SELECT chat_id FROM chat_participants WHERE user_id = $1', [socket.userId]);
  chats.rows.forEach(row => socket.join(`chat:${row.chat_id}`));
  socket.join(`user:${socket.userId}`);

  // Обработчики событий
  socket.on('sendMessage', async (data) => {
    try {
      const { chatId, content, type } = data;
      // Проверка доступа
      const access = await db.query('SELECT 1 FROM chat_participants WHERE chat_id = $1 AND user_id = $2', [chatId, socket.userId]);
      if (access.rows.length === 0) return;

      const messageId = require('uuid').v4();
      await db.query(
        `INSERT INTO messages (id, chat_id, sender_id, content, type, created_at) VALUES ($1, $2, $3, $4, $5, NOW())`,
        [messageId, chatId, socket.userId, content, type]
      );
      const newMsg = await db.query(
        `SELECT m.*, u.username as sender_username, u.avatar as sender_avatar
         FROM messages m JOIN users u ON m.sender_id = u.id WHERE m.id = $1`,
        [messageId]
      );
      io.to(`chat:${chatId}`).emit('newMessage', newMsg.rows[0]);

      // Обновление последнего сообщения в чате (можно через триггер)
    } catch (err) {
      logger.error('Socket sendMessage error:', err);
    }
  });

  socket.on('typing', ({ chatId, isTyping }) => {
    socket.to(`chat:${chatId}`).emit('userTyping', { userId: socket.userId, username: socket.username, isTyping });
  });

  socket.on('disconnect', async () => {
    logger.info(`Socket disconnected: ${socket.username}`);
    await db.query('UPDATE users SET status = $1, last_seen = NOW() WHERE id = $2', ['offline', socket.userId]);
  });
});

// Правило 56: закрытие соединений с БД при завершении
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, closing connections...');
  await db.end();
  server.close(() => process.exit(0));
});

// Запуск сервера
server.listen(config.PORT, '0.0.0.0', () => {
  logger.info(`Server running on port ${config.PORT}`);
});

module.exports = { app, server, io };
