const jwt = require('jsonwebtoken');
const { getData, saveData } = require('./database');

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

module.exports = (server) => {
  const io = require('socket.io')(server, {
    cors: { origin: '*' }
  });

  // Аутентификация через JWT
  io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) return next(new Error('Authentication error'));
    jwt.verify(token, JWT_SECRET, (err, decoded) => {
      if (err) return next(new Error('Invalid token'));
      socket.userId = decoded.userId;
      socket.username = decoded.username;
      next();
    });
  });

  io.on('connection', (socket) => {
    console.log(`User ${socket.username} (${socket.userId}) connected`);

    // Присоединяемся к комнате своего userId для личных уведомлений
    socket.join(`user:${socket.userId}`);

    // Присоединиться к чату (комната чата)
    socket.on('joinChat', (chatId) => {
      socket.join(`chat:${chatId}`);
    });

    // Отправить сообщение
    socket.on('sendMessage', async (data) => {
      const { chatId, content, type = 'text' } = data;

      // Сохраняем в БД
      const messages = getData('messages.json');
      const newMessage = {
        id: require('uuid').v4(),
        chatId,
        senderId: socket.userId,
        senderUsername: socket.username,
        content,
        type,
        timestamp: Date.now(),
        read: false
      };
      messages.push(newMessage);
      saveData('messages.json', messages);

      // Отправляем всем в комнате чата
      io.to(`chat:${chatId}`).emit('newMessage', newMessage);

      // Обновляем lastMessage в чате
      const chats = getData('chats.json');
      const chat = chats.find(c => c.id === chatId);
      if (chat) {
        chat.lastMessage = content;
        chat.lastMessageTime = Date.now();
        saveData('chats.json', chats);
      }
    });

    // Статус "печатает"
    socket.on('typing', ({ chatId, isTyping }) => {
      socket.to(`chat:${chatId}`).emit('userTyping', {
        userId: socket.userId,
        username: socket.username,
        isTyping
      });
    });

    // Прочитано
    socket.on('markRead', ({ chatId, messageIds }) => {
      // Обновить статус прочтения в БД
      const messages = getData('messages.json');
      messages.forEach(msg => {
        if (msg.chatId === chatId && messageIds.includes(msg.id)) {
          msg.read = true;
        }
      });
      saveData('messages.json', messages);
      socket.to(`chat:${chatId}`).emit('messagesRead', {
        readerId: socket.userId,
        messageIds
      });
    });

    // Отключение
    socket.on('disconnect', () => {
      console.log(`User ${socket.username} disconnected`);
      // Обновляем статус в users.json
      const users = getData('users.json');
      const user = users.find(u => u.id === socket.userId);
      if (user) {
        user.status = 'offline';
        user.lastSeen = new Date().toISOString();
        saveData('users.json', users);
      }
    });
  });

  return io;
};
