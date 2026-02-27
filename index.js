const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');

module.exports = (app) => {
  const io = new Server(app, {
    cors: { origin: '*' }
  });

  const JWT_SECRET = 'telegram-pro-v5-secret';

  io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    jwt.verify(token, JWT_SECRET, (err, user) => {
      if (err) return next(new Error('Auth failed'));
      socket.user = user;
      next();
    });
  });

  io.on('connection', (socket) => {
    console.log(`${socket.user.id} connected`);

    socket.on('joinChat', (chatId) => {
      socket.join(chatId);
    });

    socket.on('sendMessage', (data) => {
      socket.to(data.chatId).emit('newMessage', data);
    });

    socket.on('disconnect', () => {
      console.log(`${socket.user.id} disconnected`);
    });
  });
};
