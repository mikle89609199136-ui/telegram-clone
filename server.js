require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { authenticateToken } = require('./auth');
const data = require('./data');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET;

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static('public'));

// Регистрация
app.post('/api/register', async (req, res) => {
  const { username, password, name } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
  if (data.findUserByUsername(username)) return res.status(400).json({ error: 'User already exists' });

  const hashedPassword = await bcrypt.hash(password, 10);
  const newUser = {
    id: username,
    username,
    password: hashedPassword,
    name: name || username,
    avatar: '👤',
    birthday: '',
    phone: ''
  };
  data.addUser(newUser);

  const token = jwt.sign({ id: username, username }, JWT_SECRET);
  res.json({ token, user: { id: username, name: newUser.name, avatar: newUser.avatar } });
});

// Вход
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  const user = data.findUserByUsername(username);
  if (!user) return res.status(400).json({ error: 'Invalid credentials' });

  const valid = await bcrypt.compare(password, user.password);
  if (!valid) return res.status(400).json({ error: 'Invalid credentials' });

  const token = jwt.sign({ id: username, username }, JWT_SECRET);
  res.json({ token, user: { id: username, name: user.name, avatar: user.avatar } });
});

// Все пользователи
app.get('/api/users', authenticateToken, (req, res) => {
  res.json(data.getAllUsers());
});

// Публичные чаты
app.get('/api/public-chats', authenticateToken, (req, res) => {
  res.json(data.getPublicChats());
});

// Чаты пользователя
app.get('/api/chats', authenticateToken, (req, res) => {
  res.json(data.getChatsForUser(req.user.id));
});

// Создать чат
app.post('/api/chats', authenticateToken, (req, res) => {
  const { type, name, avatar, participants, description, privacy, permissions, link, owner } = req.body;
  const newChat = {
    id: (type === 'group' ? 'group_' : type === 'channel' ? 'channel_' : 'private_') + Date.now(),
    type,
    name,
    avatar: avatar || '📷',
    participants: [req.user.id, ...(participants || [])],
    lastMessage: type === 'group' ? 'Группа создана' : type === 'channel' ? 'Канал создан' : '',
    lastTime: Date.now(),
    unread: 0,
    pinned: false,
    description: description || '',
    privacy: privacy || 'public',
    public: privacy === 'public',
    link: link || null,
    owner: owner || req.user.id,
    admins: [req.user.id],
    permissions: permissions || {},
    banned: []
  };
  data.addChat(newChat);
  res.json(newChat);
});

// Сообщения чата
app.get('/api/chats/:id/messages', authenticateToken, (req, res) => {
  res.json(data.getMessages(req.params.id));
});

// Отправить сообщение
app.post('/api/chats/:id/messages', authenticateToken, (req, res) => {
  const chatId = req.params.id;
  const { content, type, fileName, pollQuestion, pollOptions, pollMultiple, pollQuiz } = req.body;
  const newMsg = {
    id: Date.now().toString(),
    senderId: req.user.id,
    content: content || '',
    time: Date.now(),
    type: type || 'text',
    reactions: [],
    fileName,
    pollQuestion,
    pollOptions,
    pollMultiple,
    pollQuiz
  };
  data.addMessage(chatId, newMsg);
  io.to(chatId).emit('newMessage', { ...newMsg, chatId });
  res.json(newMsg);
});

// WebSocket
io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  if (!token) return next(new Error('Authentication error'));
  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return next(new Error('Authentication error'));
    socket.user = user;
    next();
  });
});

io.on('connection', (socket) => {
  console.log(`User connected: ${socket.user.username}`);

  socket.on('joinChat', (chatId) => {
    socket.join(chatId);
  });

  socket.on('leaveChat', (chatId) => {
    socket.leave(chatId);
  });

  socket.on('typing', ({ chatId, isTyping }) => {
    socket.to(chatId).emit('userTyping', { username: socket.user.username, isTyping });
  });

  socket.on('disconnect', () => {
    console.log(`User disconnected: ${socket.user.username}`);
  });
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
