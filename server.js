// server.js — точка входа Express + Socket.IO + маршруты

require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const path = require('path');
const fs = require('fs-extra');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const morgan = require('morgan');

// Импорт собственных модулей
const authRoutes = require('./auth');
const dataModule = require('./data');
const socketHandler = require('./index');

const app = express();
const server = http.createServer(app);

// Конфигурация
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error('❌ JWT_SECRET не задан! Укажите его в .env');
  process.exit(1);
}

// Создаём необходимые директории
const DATA_DIR = path.join(__dirname, 'data');
const UPLOADS_DIR = path.join(__dirname, 'uploads');
fs.ensureDirSync(DATA_DIR);
fs.ensureDirSync(path.join(UPLOADS_DIR, 'avatars'));
fs.ensureDirSync(path.join(UPLOADS_DIR, 'files'));

// Middleware безопасности и оптимизации
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https://img2.pngindir.com"],
    }
  }
}));
app.use(compression());
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(morgan('combined'));

// Rate limiting для API
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 минут
  max: 200,
  message: { error: 'Слишком много запросов, попробуйте позже' }
});
app.use('/api/', apiLimiter);

// Статические файлы: фронтенд и загрузки
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(UPLOADS_DIR));

// Подключаем маршруты аутентификации
app.use('/api/auth', authRoutes);

// Эндпоинт проверки здоровья для Railway
app.get('/health', (req, res) => {
  res.status(200).json({
    status: '🟢 Zhuravlev Messenger работает',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// Инициализация Socket.IO
const io = socketHandler(server);

// Обработка ошибок
app.use((err, req, res, next) => {
  console.error('❌ Серверная ошибка:', err.stack);
  res.status(500).json({ error: 'Внутренняя ошибка сервера' });
});

// Запуск сервера на 0.0.0.0 (обязательно для Railway)
server.listen(PORT, '0.0.0.0', () => {
  console.log(`
  🚀 Zhuravlev Telegram Clone запущен!
  🌐 http://localhost:${PORT}
  📧 Почта: ${process.env.EMAIL_USER ? '✅' : '❌ не настроена'}
  ⚡ WebSocket: активен
  📁 Данные: ${DATA_DIR}
  `);
});

