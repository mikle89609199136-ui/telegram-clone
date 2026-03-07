// index.js – точка входа приложения

require('dotenv').config();
const http = require('http');
const app = require('./server');
const { initDatabase } = require('./database');
const checkEnv = require('./env');
const logger = require('./logger');
const config = require('./config');

// Проверяем переменные окружения
checkEnv();

// Создаём HTTP сервер
const server = http.createServer(app);

// Инициализируем WebSocket (передаём сервер)
const io = require('./websocket')(server);
app.set('io', io); // делаем io доступным в маршрутах при необходимости

// Подключаемся к базам данных и запускаем сервер
initDatabase()
  .then(() => {
    server.listen(config.port, '0.0.0.0', () => {
      logger.info(`🚀 CraneApp Messenger started on port ${config.port}`);
      logger.info(`🌐 Web client: http://localhost:${config.port}/public/chat.html`);
      logger.info(`🔧 Environment: ${config.nodeEnv}`);
    });
  })
  .catch(err => {
    logger.error('Failed to initialize database:', err);
    process.exit(1);
  });

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully');
  server.close(() => {
    logger.info('HTTP server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down gracefully');
  server.close(() => {
    logger.info('HTTP server closed');
    process.exit(0);
  });
});
