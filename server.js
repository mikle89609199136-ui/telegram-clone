// server.js – основной сервер Express + Socket.IO

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
const jwt = require('jsonwebtoken');

const authRoutes = require('./auth');
const socketHandler = require('./index');
const { getData } = require('./data');

const app = express();
const server = http.createServer(app);

// Проверка JWT_SECRET
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.includes('your_')) {
  console.error('❌ JWT_SECRET must be set to a secure value');
  process.exit(1);
}

const PORT = process.env.PORT || 3000;
const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:3000';

// Доверие прокси (Railway)
app.set('trust proxy', 1);

// Директории данных
const DATA_DIR = path.join(__dirname, 'data');
fs.ensureDirSync(DATA_DIR);
fs.ensureDirSync(path.join(__dirname, 'uploads'));

// Helmet с настройками CSP (без unsafe-inline для безопасности, но с nonce)
// Для простоты используем более строгую политику, но фронтенд должен поддерживать nonce
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "https://cdn.socket.io"],
      styleSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https://img2.pngindir.com"],
      connectSrc: ["'self'", "wss:", "https://cdn.socket.io"],
    }
  }
}));

app.use(compression());
app.use(cors({ origin: CLIENT_URL, credentials: true }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan('combined'));

// Rate limiting
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: 'Too many requests' }
});
app.use('/api/', apiLimiter);

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  skipSuccessfulRequests: true
});

// Статические файлы
app.use(express.static(path.join(__dirname, 'public')));

// API маршруты
app.use('/api/auth', authLimiter, authRoutes);

// Middleware для проверки JWT (для защищённых маршрутов)
function authenticateToken(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'Invalid token' });
    req.user = user;
    next();
  });
}

// Пример защищённого маршрута – список устройств
app.get('/api/devices', authenticateToken, (req, res) => {
  const devices = getData('devices.json').filter(d => d.userId === req.user.id);
  res.json(devices);
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: '🟢 OK', timestamp: new Date().toISOString() });
});

// SPA fallback – все остальные маршруты отдаём chat.html
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'chat.html'));
});

// Socket.IO
const io = require('socket.io')(server, {
  cors: { origin: CLIENT_URL, credentials: true }
});
socketHandler(io);

// Глобальный обработчик ошибок
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal server error' });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`
  🚀 Zhuravlev Messenger запущен!
  🌐 http://localhost:${PORT}
  🔑 JWT_SECRET: ✅
  ⚡ WebSocket: активен
  `);
});
