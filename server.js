// server.js – конфигурация Express и middleware

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const path = require('path');
const rateLimit = require('express-rate-limit');
const fs = require('fs').promises;
const config = require('./config');
const logger = require('./logger');
const authenticateToken = require('./authMiddleware');

const app = express();

// Создаём папку для загрузок, если её нет
(async () => {
  try {
    await fs.mkdir(path.join(__dirname, config.upload.dir), { recursive: true });
    logger.info(`Uploads directory ensured: ${config.upload.dir}`);
  } catch (err) {
    logger.error('Failed to create uploads directory', err);
  }
})();

// Безопасность
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.socket.io"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https://i.ibb.co", "blob:"],
      connectSrc: ["'self'", "wss:", "https://cdn.socket.io"],
      mediaSrc: ["'self'", "blob:"],
      fontSrc: ["'self'", "https://fonts.googleapis.com"],
    }
  }
}));

// Сжатие ответов
app.use(compression());

// CORS
app.use(cors({
  origin: config.clientUrl,
  credentials: true,
  optionsSuccessStatus: 200
}));

// Парсинг JSON и URL-encoded
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Логирование запросов
app.use(morgan('combined', {
  stream: { write: message => logger.info(message.trim()) }
}));

// Rate limiting для API
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 минут
  max: 100, // максимум 100 запросов с одного IP
  message: { error: 'Too many requests, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/', limiter);

// Статические файлы
app.use('/public', express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, config.upload.dir)));

// Маршруты API (все подключаются сюда)
app.use('/api/auth', require('./auth'));
app.use('/api/users', authenticateToken, require('./users'));
app.use('/api/messages', authenticateToken, require('./messages'));
app.use('/api/chats', authenticateToken, require('./chats'));
app.use('/api/channels', authenticateToken, require('./channels'));
app.use('/api/contacts', authenticateToken, require('./contacts'));
app.use('/api/media', authenticateToken, require('./media'));
app.use('/api/calls', authenticateToken, require('./calls'));
app.use('/api/profile', authenticateToken, require('./profile'));
app.use('/api/settings', authenticateToken, require('./settings'));
app.use('/api/search', authenticateToken, require('./search'));
app.use('/api/notifications', authenticateToken, require('./notifications'));
app.use('/api/upload', authenticateToken, require('./upload'));
app.use('/api/ai', authenticateToken, require('./ai'));

// Health check (для Railway)
app.get('/health', (req, res) => {
  res.json({ status: '🟢 OK', timestamp: new Date().toISOString() });
});

// 404
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Глобальный обработчик ошибок
app.use((err, req, res, next) => {
  logger.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

module.exports = app;
