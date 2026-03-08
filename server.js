// server.js – главный файл сервера (исправленная версия для Railway)
require('dotenv').config();
const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs-extra');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');

// Импорт конфигурации и утилит
const config = require('./config');
const logger = require('./logger');
const envCheck = require('./env');
const { corsOptions, limiter, helmetConfig } = require('./security');
const { handleMulterError, router: uploadRouter } = require('./upload');
const { db } = require('./database');
const websocket = require('./websocket');

// ========== ПРОВЕРКА ПЕРЕМЕННЫХ ОКРУЖЕНИЯ ==========
envCheck(); // теперь не убивает процесс, а только предупреждает

// Для отладки выведем наличие JWT_SECRET
logger.info(`JWT_SECRET present: ${!!process.env.JWT_SECRET}`);
if (!process.env.JWT_SECRET) {
  logger.warn('JWT_SECRET not set, using insecure default for development (DO NOT USE IN PRODUCTION)');
  process.env.JWT_SECRET = 'dev_secret_for_testing_only_123';
}

const app = express();
const server = http.createServer(app);

// ========== НАСТРОЙКИ БЕЗОПАСНОСТИ И MIDDLEWARE ==========
app.use(helmet(helmetConfig));
app.use(cors(corsOptions));
app.use(compression());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(morgan('combined', { stream: { write: message => logger.info(message.trim()) } }));

// Rate limiting для API
app.use('/api/', limiter);

// Статические файлы из public
app.use(express.static(path.join(__dirname, 'public')));

// Загруженные файлы
app.use('/uploads', express.static(config.UPLOAD.dir));

// ========== МАРШРУТЫ ==========
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
app.use('/api/notifications', require('./notifications').router);
app.use('/api/ai', require('./ai'));
app.use('/api/upload', uploadRouter);

// ========== HEALTH CHECK ДЛЯ RAILWAY ==========
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

// Обработчик ошибок multer
app.use(handleMulterError);

// SPA fallback: для всех остальных маршрутов отдаём chat.html
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'chat.html'));
});

// ========== ЗАПУСК СЕРВЕРА ==========
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  logger.info(`🚀 Server running on port ${PORT}`);
  logger.info(`Health check: http://localhost:${PORT}/health`);
});

// ========== ГРЭЙСФУЛ ШАГДАУН ==========
async function shutdown(signal) {
  logger.info(`${signal} received, shutting down gracefully...`);
  server.close(async () => {
    await db.end();
    logger.info('Database pool closed');
    process.exit(0);
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
