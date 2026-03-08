// server.js — точка входа с правильным health check и слушанием порта
require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const path = require('path');
const fs = require('fs-extra');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');

const config = require('./config');
const logger = require('./logger');
const envCheck = require('./env');
const { corsOptions, limiter, helmetConfig } = require('./security');
const { handleMulterError } = require('./upload');
const { db } = require('./database');
const websocket = require('./websocket'); // если у вас websocket.js

// Проверка обязательных переменных окружения
envCheck();

const app = express();
const server = http.createServer(app);

// Настройка безопасности
app.use(helmet(helmetConfig));
app.use(cors(corsOptions));
app.use(compression());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(morgan('combined', { stream: { write: message => logger.info(message.trim()) } }));

// Rate limiter для всех API
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
app.use('/api/notifications', require('./notifications'));
app.use('/api/ai', require('./ai'));

// Загрузка файлов (обработчик ошибок multer)
app.use('/api/upload', require('./upload')); // если upload.js экспортирует роутер

// HEALTH CHECK — ОБЯЗАТЕЛЬНО ДЛЯ RAILWAY
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// Обработка ошибок multer (если upload.js не имеет своего middleware)
app.use(handleMulterError);

// Для всех остальных запросов отдаём chat.html (SPA)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'chat.html'));
});

// ========== ЗАПУСК СЕРВЕРА ==========
const PORT = config.PORT;
server.listen(PORT, '0.0.0.0', () => {
  logger.info(`🚀 Server running on port ${PORT}`);
  logger.info(`Health check: http://localhost:${PORT}/health`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, closing server...');
  server.close(async () => {
    await db.end();
    logger.info('Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, closing server...');
  server.close(async () => {
    await db.end();
    logger.info('Server closed');
    process.exit(0);
  });
});
