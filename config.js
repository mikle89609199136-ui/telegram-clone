// config.js — централизованная конфигурация
const path = require('path');

require('dotenv').config();

module.exports = {
  // Сервер
  PORT: process.env.PORT || 3000,
  NODE_ENV: process.env.NODE_ENV || 'development',

  // JWT
  JWT_SECRET: process.env.JWT_SECRET,
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '365d',

  // База данных
  DB: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT) || 5432,
    name: process.env.DB_NAME || 'telegram_clone',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    dialect: process.env.DB_DIALECT || 'postgres', // или 'sqlite'
    storage: path.join(__dirname, 'data', 'database.sqlite'),
  },

  // Email
  EMAIL: {
    host: process.env.EMAIL_HOST,
    port: parseInt(process.env.EMAIL_PORT) || 587,
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
    from: process.env.EMAIL_FROM || 'Zhuravlev Telegram <noreply@yourdomain.com>',
  },

  // Загрузка файлов (Правила 59, 60)
  UPLOAD: {
    dir: process.env.UPLOAD_DIR || path.join(__dirname, 'uploads'),
    maxSize: parseInt(process.env.MAX_FILE_SIZE) || 50 * 1024 * 1024, // 50 MB
    allowedMime: process.env.ALLOWED_MIME_TYPES
      ? process.env.ALLOWED_MIME_TYPES.split(',')
      : ['image/jpeg', 'image/png', 'image/gif', 'video/mp4', 'audio/mpeg', 'application/pdf'],
  },

  // Redis
  REDIS_URL: process.env.REDIS_URL,

  // Frontend URL
  FRONTEND_URL: process.env.FRONTEND_URL || 'http://localhost:3000',

  // Rate limiting (Правило 58)
  RATE_LIMIT: {
    windowMs: 15 * 60 * 1000,
    max: 100,
  },

  // Безопасность
  BCRYPT_ROUNDS: 12,
};
