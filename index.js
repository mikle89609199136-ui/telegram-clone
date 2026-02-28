const { getData, saveData } = require('./data');
const { v4: uuidv4 } = require('uuid');

module.exports = (io) => {
    io.use((socket, next) => {
        const token = socket.handshake.auth.token;
        if (!token) return next(new Error('Authentication error'));
        try {
            const jwt = require('jsonwebtoken');
            const user = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
            socket.user = user;
            next();
        } catch {
            next(new Error('Invalid token'));
        }
    });

    io.on('connection', (socket) => {
        console.log(`User ${socket.user.username} connected`);

        socket.on('joinChat', (chatId) => {
            socket.join(chatId);
        });

        socket.on('sendMessage', (data) => {
            const { chatId, content } = data;
            const message = {
                id: uuidv4(),
                chatId,
                senderId: socket.user.id,
                senderUsername: socket.user.username,
                content,
                time: Date.now(),
                reactions: []
            };

            // Сохраняем сообщение в JSON
            const messages = getData('messages.json');
            messages.push(message);
            saveData('messages.json', messages);

            // Обновляем последнее сообщение в чате
            const chats = getData('chats.json');
            const chat = chats.find(c => c.id === chatId);
            if (chat) {
                chat.lastMessage = content.length > 30 ? content.slice(0,30)+'…' : content;
                chat.lastTime = Date.now();
                saveData('chats.json', chats);
            }

            // Отправляем сообщение всем в комнате
            io.to(chatId).emit('newMessage', message);
        });

        socket.on('typing', ({ chatId, isTyping }) => {
            socket.to(chatId).emit('userTyping', {
                chatId,
                username: socket.user.username,
                isTyping
            });
        });

        socket.on('disconnect', () => {
            console.log(`User ${socket.user.username} disconnected`);
        });
    });
};
