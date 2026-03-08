// config.js – centralized configuration
const path = require('path');
require('dotenv').config();

module.exports = {
  PORT: process.env.PORT || 3000,
  NODE_ENV: process.env.NODE_ENV || 'development',

  JWT_SECRET: process.env.JWT_SECRET,
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '365d',

  DB: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT) || 5432,
    name: process.env.DB_NAME || 'telegram_clone',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    dialect: process.env.DB_DIALECT || 'postgres',
    storage: path.join(__dirname, 'data', 'database.sqlite'),
  },

  EMAIL: {
    host: process.env.EMAIL_HOST,
    port: parseInt(process.env.EMAIL_PORT) || 587,
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
    from: process.env.EMAIL_FROM || 'Zhuravlev Messenger <noreply@yourdomain.com>',
  },

  UPLOAD: {
    dir: process.env.UPLOAD_DIR || path.join(__dirname, 'uploads'),
    maxSize: parseInt(process.env.MAX_FILE_SIZE) || 50 * 1024 * 1024,
    allowedMime: process.env.ALLOWED_MIME_TYPES
      ? process.env.ALLOWED_MIME_TYPES.split(',')
      : ['image/jpeg', 'image/png', 'image/gif', 'video/mp4', 'audio/mpeg', 'application/pdf'],
  },

  REDIS_URL: process.env.REDIS_URL,
  FRONTEND_URL: process.env.FRONTEND_URL || 'http://localhost:3000',

  RATE_LIMIT: {
    windowMs: 15 * 60 * 1000,
    max: 100,
  },

  BCRYPT_ROUNDS: 12,

  AI: {
    provider: process.env.AI_PROVIDER || 'openai',
    openaiApiKey: process.env.OPENAI_API_KEY,
    model: process.env.IRIS_MODEL || 'gpt-4',
  },
};
