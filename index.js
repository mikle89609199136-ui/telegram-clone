// index.js — обработчики Socket.IO для чата

const { getData, saveData } = require('./data');
const { v4: uuidv4 } = require('uuid');

module.exports = (server) => {
  const io = require('socket.io')(server, {
    cors: { origin: '*' }
  });

  // Middleware аутентификации через JWT
  io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) {
      return next(new Error('Токен не предоставлен'));
    }

    try {
      const jwt = require('jsonwebtoken');
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      socket.user = decoded; // { id, username }
      next();
    } catch (err) {
      next(new Error('Неверный токен'));
    }
  });

  io.on('connection', (socket) => {
    const userId = socket.user.id;
    console.log(`🔗 Пользователь ${socket.user.username} (${userId}) подключился`);

    // Присоединяем к комнате пользователя (для личных уведомлений)
    socket.join(`user:${userId}`);

    // Получить список чатов пользователя
    socket.on('getChats', () => {
      const chats = getData('chats.json');
      const userChats = chats.filter(chat =>
        chat.participants && chat.participants.includes(userId)
      );
      socket.emit('chatsList', userChats);
    });

    // Присоединиться к конкретному чату
    socket.on('joinChat', (chatId) => {
      socket.join(`chat:${chatId}`);
    });

    // Отправить сообщение
    socket.on('sendMessage', async (data) => {
      const { chatId, content, type = 'text', replyTo } = data;

      // Загружаем чаты и проверяем, что пользователь участник
      const chats = getData('chats.json');
      const chat = chats.find(c => c.id === chatId);
      if (!chat || !chat.participants.includes(userId)) {
        return socket.emit('error', 'Нет доступа к чату');
      }

      // Создаём сообщение
      const message = {
        id: uuidv4(),
        chatId,
        senderId: userId,
        senderUsername: socket.user.username,
        content,
        type,
        replyTo,
        timestamp: new Date().toISOString(),
        read: false,
        status: 'delivered' // для отправителя
      };

      // Сохраняем в историю
      const messages = getData('messages.json');
      messages.push(message);
      saveData('messages.json', messages);

      // Обновляем последнее сообщение в чате
      chat.lastMessage = {
        content: content.length > 50 ? content.slice(0, 50) + '…' : content,
        timestamp: message.timestamp,
        senderId: userId
      };
      saveData('chats.json', chats);

      // Отправляем сообщение всем в комнате чата
      io.to(`chat:${chatId}`).emit('newMessage', message);

      // Подтверждение отправителю
      socket.emit('messageSent', { ...message, status: 'sent' });
    });

    // Статус "печатает"
    socket.on('typing', ({ chatId, isTyping }) => {
      socket.to(`chat:${chatId}`).emit('userTyping', {
        userId,
        username: socket.user.username,
        isTyping
      });
    });

    // Прочтение сообщений
    socket.on('markRead', ({ chatId, messageIds }) => {
      const messages = getData('messages.json');
      let updated = false;
      messages.forEach(msg => {
        if (msg.chatId === chatId && messageIds.includes(msg.id) && msg.senderId !== userId) {
          msg.read = true;
          updated = true;
        }
      });
      if (updated) {
        saveData('messages.json', messages);
        io.to(`chat:${chatId}`).emit('messagesRead', { readerId: userId, messageIds });
      }
    });

    // Отключение
    socket.on('disconnect', () => {
      console.log(`❌ Пользователь ${socket.user.username} отключился`);

      // Обновляем статус в users.json
      const users = getData('users.json');
      const user = users.find(u => u.id === userId);
      if (user) {
        user.status = 'offline';
        user.lastSeen = new Date().toISOString();
        saveData('users.json', users);
      }
    });
  });

  return io;
};
