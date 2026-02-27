// server.js — финальная версия (исправлены все ошибки)

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

const authRoutes = require('./auth');
const socketHandler = require('./index');

const app = express();
const server = http.createServer(app);

// ✅ Доверяем прокси (Railway)
app.set('trust proxy', 1);

const PORT = process.env.PORT || 3000;

// ✅ Временный JWT_SECRET (чтобы сервер точно запустился)
let JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.warn('⚠️ JWT_SECRET не задан! Использую временное значение (только для теста)');
  JWT_SECRET = 'temp_secret_for_test_only_123456';
}
// Принудительно устанавливаем в process.env, чтобы auth.js видел переменную
process.env.JWT_SECRET = JWT_SECRET;

// Создаём директории
const DATA_DIR = path.join(__dirname, 'data');
const UPLOADS_DIR = path.join(__dirname, 'uploads');
fs.ensureDirSync(DATA_DIR);
fs.ensureDirSync(path.join(UPLOADS_DIR, 'avatars'));
fs.ensureDirSync(path.join(UPLOADS_DIR, 'files'));

// Middleware
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

// Rate limiting
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  message: { error: 'Слишком много запросов' }
});
app.use('/api/', apiLimiter);

// Статические файлы из папки public
app.use(express.static(path.join(__dirname, 'public')));

// ✅ Подключаем маршруты аутентификации по пути /api (теперь /api/register, /api/login и т.д.)
app.use('/api', authRoutes);

// Эндпоинт здоровья
app.get('/health', (req, res) => {
  res.status(200).json({
    status: '🟢 Zhuravlev Messenger работает',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// ✅ Для всех остальных GET-запросов отдаём chat.html (поддержка SPA)
app.get('*', (req, res) => {
  const chatPath = path.join(__dirname, 'public', 'chat.html');
  if (fs.existsSync(chatPath)) {
    res.sendFile(chatPath);
  } else {
    res.status(404).send('❌ chat.html не найден в папке public. Создайте его!');
  }
});

// Socket.IO
const io = socketHandler(server);

// Обработка ошибок
app.use((err, req, res, next) => {
  console.error('❌ Серверная ошибка:', err.stack);
  res.status(500).json({ error: 'Внутренняя ошибка сервера' });
});

// Запуск
server.listen(PORT, '0.0.0.0', () => {
  console.log(`
  🚀 Zhuravlev Telegram Clone запущен!
  🌐 http://localhost:${PORT}
  🔑 JWT_SECRET: ${JWT_SECRET === 'temp_secret_for_test_only_123456' ? '⚠️ временный' : '✅ из переменных'}
  ⚡ WebSocket: активен
  `);
});
