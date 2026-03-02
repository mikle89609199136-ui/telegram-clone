// server.js
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

// ==================== АУТЕНТИФИКАЦИЯ ====================
app.post('/api/register', async (req, res) => {
  const { username, password, name } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
  if (data.findUserByUsername(username)) return res.status(400).json({ error: 'User already exists' });

  const hashedPassword = await bcrypt.hash(password, 10);
  const newUser = data.addUser({
    username,
    password: hashedPassword,
    name: name || username,
    avatar: '👤'
  });

  const token = jwt.sign({ id: newUser.id, username: newUser.username }, JWT_SECRET);
  res.json({ token, user: { id: newUser.id, name: newUser.name, avatar: newUser.avatar, username: newUser.username } });
});

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  const user = data.findUserByUsername(username);
  if (!user) return res.status(400).json({ error: 'Invalid credentials' });

  const valid = await bcrypt.compare(password, user.password);
  if (!valid) return res.status(400).json({ error: 'Invalid credentials' });

  const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET);
  res.json({ token, user: { id: user.id, name: user.name, avatar: user.avatar, username: user.username } });
});

// ==================== ПОЛЬЗОВАТЕЛИ ====================
app.get('/api/users', authenticateToken, (req, res) => {
  res.json(data.getAllUsers());
});

app.get('/api/users/:id', authenticateToken, (req, res) => {
  const user = data.findUserById(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ id: user.id, name: user.name, username: user.username, avatar: user.avatar, bio: user.bio, lastSeen: user.lastSeen });
});

// ==================== ЧАТЫ ====================
app.get('/api/chats', authenticateToken, (req, res) => {
  const chats = data.getChatsForUser(req.user.id);
  // Обогащаем чаты информацией о пользователях для отображения
  const enrichedChats = chats.map(chat => {
    if (chat.type === 'private') {
      const otherParticipantId = chat.participants.find(p => p != req.user.id);
      const otherUser = data.findUserById(otherParticipantId);
      return {
        ...chat,
        name: otherUser?.name || 'Deleted User',
        avatar: otherUser?.avatar || '👤'
      };
    }
    return chat;
  });
  res.json(enrichedChats);
});

app.post('/api/chats', authenticateToken, (req, res) => {
  const { type, name, avatar, participants, description, privacy, permissions } = req.body;
  const newChat = data.addChat({
    type,
    name: type === 'private' ? '' : name, // Для лички имя подставим позже
    avatar: avatar || (type === 'private' ? '' : '📷'),
    participants: participants || [],
    description: description || '',
    privacy: privacy || 'public',
    owner: req.user.id,
    permissions: permissions || {}
  });
  res.json(newChat);
});

// ==================== СООБЩЕНИЯ ====================
app.get('/api/chats/:id/messages', authenticateToken, (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  const before = req.query.before ? parseInt(req.query.before) : null;
  res.json(data.getMessages(req.params.id, limit, before));
});

app.post('/api/chats/:id/messages', authenticateToken, (req, res) => {
  const chatId = req.params.id;
  const { content, type, replyTo, pollQuestion, pollOptions, pollMultiple, pollQuiz } = req.body;
  
  const newMsg = data.addMessage(chatId, {
    senderId: req.user.id,
    content: content || '',
    type: type || 'text',
    replyTo,
    pollQuestion,
    pollOptions,
    pollMultiple,
    pollQuiz
  });
  
  // Отправляем через сокет всем в чате
  io.to(chatId).emit('new_message', newMsg);
  res.json(newMsg);
});

// ==================== СОКЕТ ====================
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
  console.log(`User connected: ${socket.user.username} (${socket.user.id})`);
  
  // Обновляем статус пользователя на "онлайн"
  data.updateUser(socket.user.id, { status: 'online', lastSeen: new Date().toISOString() });
  
  socket.on('join_chat', (chatId) => {
    socket.join(chatId);
    console.log(`${socket.user.username} joined chat ${chatId}`);
  });
  
  socket.on('leave_chat', (chatId) => {
    socket.leave(chatId);
  });
  
  socket.on('typing', ({ chatId, isTyping }) => {
    socket.to(chatId).emit('user_typing', { userId: socket.user.id, username: socket.user.username, isTyping });
  });
  
  socket.on('mark_read', ({ chatId, messageId }) => {
    // Логика отметки прочтения
    socket.to(chatId).emit('message_read', { userId: socket.user.id, messageId });
  });
  
  socket.on('disconnect', () => {
    console.log(`User disconnected: ${socket.user.username}`);
    data.updateUser(socket.user.id, { status: 'offline', lastSeen: new Date().toISOString() });
  });
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
