const express = require('express');
const http = require('http');
const cluster = require('cluster');
const os = require('os');
const compression = require('compression');
const dotenv = require('dotenv');
const { Server } = require('socket.io');
const { createAdapter } = require('@socket.io/redis-adapter');
const { createClient } = require('redis');
const { initDatabase } = require('./database');
const logger = require('./logger');
const config = require('./config');

dotenv.config();

const SERVICE = config.service;

if (cluster.isMaster && config.nodeEnv === 'production' && SERVICE === 'api') {
  const numWorkers = os.cpus().length;
  logger.info(`Master setting up ${numWorkers} workers`);
  for (let i = 0; i < numWorkers; i++) cluster.fork();
  cluster.on('exit', (worker) => {
    logger.error(`Worker ${worker.process.pid} died, restarting...`);
    cluster.fork();
  });
} else {
  startService(SERVICE);
}

async function startService(service) {
  await initDatabase();

  const redisPub = createClient({ url: config.redisUrl, socket: { tls: config.redisTls } });
  const redisSub = createClient({ url: config.redisUrl, socket: { tls: config.redisTls } });
  redisPub.on('error', (err) => logger.error('Redis pub error', err));
  redisSub.on('error', (err) => logger.error('Redis sub error', err));
  await redisPub.connect();
  await redisSub.connect();

  const app = express();
  const server = http.createServer(app);
  const io = new Server(server, {
    cors: { origin: config.corsOrigin },
    adapter: createAdapter(redisPub, redisSub),
    pingTimeout: 60000,
    pingInterval: 25000,
    transports: ['websocket', 'polling']
  });

  app.use(compression());
  app.use(express.json({ limit: config.maxMessageSize }));
  app.use(express.urlencoded({ extended: true, limit: config.maxMessageSize }));
  require('./security').applySecurity(app);

  app.get('/health', (req, res) => res.send('OK'));
  app.get('/metrics', async (req, res) => {
    const client = require('prom-client');
    res.set('Content-Type', client.register.contentType);
    res.end(await client.register.metrics());
  });

  if (service === 'api' || service === 'all') {
    app.use('/auth', require('./auth'));
    app.use('/users', require('./authMiddleware'), require('./users'));
    app.use('/chats', require('./authMiddleware'), require('./chats'));
    app.use('/messages', require('./authMiddleware'), require('./messages'));
    app.use('/contacts', require('./authMiddleware'), require('./contacts'));
    app.use('/profile', require('./authMiddleware'), require('./profile'));
    app.use('/settings', require('./authMiddleware'), require('./settings'));
    app.use('/search', require('./authMiddleware'), require('./search'));
    app.use('/calls', require('./authMiddleware'), require('./calls'));
    app.use('/upload', require('./authMiddleware'), require('./upload'));
    app.use('/ai', require('./authMiddleware'), require('./ai'));
    app.use(express.static('public'));
  }

  if (service === 'ws' || service === 'all') {
    const socketAuth = require('./authMiddleware').socketAuth;
    io.use(socketAuth);
    io.on('connection', (socket) => {
      const userId = socket.userId;
      socket.join(`user:${userId}`);

      socket.on('joinChat', (chatId) => {
        socket.join(`chat:${chatId}`);
      });

      socket.on('leaveChat', (chatId) => {
        socket.leave(`chat:${chatId}`);
      });

      socket.on('sendMessage', async (data) => {
        try {
          const message = await require('./messages').saveMessage(data.chatId, userId, data);
          io.to(`chat:${data.chatId}`).emit('newMessage', message);
        } catch (err) {
          logger.error('sendMessage error', err);
          socket.emit('error', { message: 'Failed to send message' });
        }
      });

      socket.on('typing', (data) => {
        socket.to(`chat:${data.chatId}`).emit('typing', { userId, chatId: data.chatId });
      });

      socket.on('stopTyping', (data) => {
        socket.to(`chat:${data.chatId}`).emit('stopTyping', { userId, chatId: data.chatId });
      });

      socket.on('readMessages', async (data) => {
        try {
          await require('./messages').markAsRead(data.chatId, userId, data.messageIds);
          socket.to(`chat:${data.chatId}`).emit('messagesRead', { userId, messageIds: data.messageIds });
        } catch (err) {
          logger.error('readMessages error', err);
        }
      });

      socket.on('call:offer', (data) => require('./calls').handleOffer(socket, data));
      socket.on('call:answer', (data) => require('./calls').handleAnswer(socket, data));
      socket.on('call:ice-candidate', (data) => require('./calls').handleIceCandidate(socket, data));
      socket.on('call:end', (data) => require('./calls').handleEnd(socket, data));

      socket.on('disconnect', async () => {
        await require('./users').setOffline(userId);
        socket.broadcast.emit('userOffline', userId);
      });
    });
  }

  if (service === 'media') {
    app.use('/upload', require('./upload'));
  }

  if (service === 'ai') {
    app.use('/ai', require('./ai'));
  }

  const port = config.port;
  server.listen(port, '0.0.0.0', () => {
    logger.info(`${service} service listening on port ${port}`);
  });

  const gracefulShutdown = async () => {
    logger.info('Received shutdown signal, closing server...');
    server.close(async () => {
      await redisPub.quit();
      await redisSub.quit();
      process.exit(0);
    });
  };
  process.on('SIGTERM', gracefulShutdown);
  process.on('SIGINT', gracefulShutdown);

  process.on('uncaughtException', (err) => {
    logger.error('Uncaught exception', err);
  });
  process.on('unhandledRejection', (err) => {
    logger.error('Unhandled rejection', err);
  });
}
