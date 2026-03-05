const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const dotenv = require('dotenv');
const helmet = require('helmet');

dotenv.config();

const { register, login, verifyTwoFactor, generateTwoFactorSecret, enableTwoFactorForUser, verifyToken } = require('./auth');
const {
  findUserById, getAllUsers, updateUser,
  createChat, getChatsForUser, getChatById, muteChat, unmuteChat, archiveChat,
  addParticipantToGroup, removeParticipantFromGroup, promoteToAdmin,
  createChannel, getChannelById, subscribeToChannel, unsubscribeFromChannel, createChannelPost,
  createBot, getBotById, getBotsByOwner,
  createMessage, getMessagesForChat, getMessageById, updateMessage, deleteMessage,
  addReaction, removeReaction, pinMessage, unpinMessage
} = require('./data');
const {
  craheappBotChat,
  craheappBotTranslate,
  craheappBotSummarize,
  craheappBotGenerate,
  irisCheckMessage,
  irisAutoBan,
  irisAutoMute,
  irisWarn
} = require('./ai');
const { limiter, xssProtection, authenticate, sanitizeMessage } = require('./security');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

// Middleware
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(limiter);
app.use(xssProtection);

// Static files
app.use(express.static(path.join(__dirname, 'public')));

// Multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, 'uploads');
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, uuidv4() + ext);
  }
});
const upload = multer({ storage });

// REST API

// Auth
app.post('/api/register', async (req, res) => {
  try {
    const { username, password, email } = req.body;
    const result = await register(username, password, email);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const result = await login(username, password);
    res.json(result);
  } catch (err) {
    res.status(401).json({ error: err.message });
  }
});

app.post('/api/2fa/verify', async (req, res) => {
  try {
    const { userId, token } = req.body;
    const result = await verifyTwoFactor(userId, token);
    if (result) res.json(result);
    else res.status(401).json({ error: 'Invalid 2FA token' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/2fa/generate', authenticate, async (req, res) => {
  try {
    const result = await generateTwoFactorSecret(req.user.userId);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/2fa/enable', authenticate, async (req, res) => {
  try {
    const { token } = req.body;
    const success = await enableTwoFactorForUser(req.user.userId, token);
    if (success) res.json({ success: true });
    else res.status(400).json({ error: 'Invalid token' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Users
app.get('/api/users', authenticate, (req, res) => {
  const allUsers = getAllUsers().filter(u => u.id !== req.user.userId);
  res.json(allUsers);
});

app.get('/api/users/:id', authenticate, (req, res) => {
  const user = findUserById(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const { passwordHash, ...safeUser } = user;
  res.json(safeUser);
});

app.put('/api/users/profile', authenticate, (req, res) => {
  const { username, email, bio, avatar } = req.body;
  const updates = {};
  if (username) updates.username = username;
  if (email) updates.email = email;
  if (bio) updates.bio = bio;
  if (avatar) updates.avatar = avatar;
  updateUser(req.user.userId, updates);
  res.json({ success: true });
});

// Chats
app.get('/api/chats', authenticate, (req, res) => {
  const userChats = getChatsForUser(req.user.userId);
  res.json(userChats);
});

app.post('/api/chats', authenticate, (req, res) => {
  const { type, name, participants } = req.body;
  if (!type || !participants || !Array.isArray(participants)) {
    return res.status(400).json({ error: 'Invalid data' });
  }
  if (!participants.includes(req.user.userId)) participants.push(req.user.userId);
  const chat = createChat({
    type,
    name: name || (type === 'direct' ? null : 'New Group'),
    participants,
    adminIds: type === 'group' ? [req.user.userId] : [],
    pinnedMessageIds: []
  });
  res.json(chat);
});

app.post('/api/chats/:id/mute', authenticate, (req, res) => {
  muteChat(req.params.id, req.user.userId);
  res.json({ success: true });
});

app.post('/api/chats/:id/unmute', authenticate, (req, res) => {
  unmuteChat(req.params.id, req.user.userId);
  res.json({ success: true });
});

app.post('/api/chats/:id/archive', authenticate, (req, res) => {
  archiveChat(req.params.id, req.user.userId);
  res.json({ success: true });
});

// Groups
app.post('/api/groups/:chatId/add', authenticate, (req, res) => {
  const { userId } = req.body;
  addParticipantToGroup(req.params.chatId, req.user.userId, userId);
  res.json({ success: true });
});

app.post('/api/groups/:chatId/remove', authenticate, (req, res) => {
  const { userId } = req.body;
  removeParticipantFromGroup(req.params.chatId, req.user.userId, userId);
  res.json({ success: true });
});

app.post('/api/groups/:chatId/promote', authenticate, (req, res) => {
  const { userId } = req.body;
  promoteToAdmin(req.params.chatId, req.user.userId, userId);
  res.json({ success: true });
});

// Channels
app.post('/api/channels', authenticate, (req, res) => {
  const { name, description } = req.body;
  const channel = createChannel({
    name,
    description,
    creatorId: req.user.userId,
    subscribers: [req.user.userId]
  });
  res.json(channel);
});

app.get('/api/channels/:id', authenticate, (req, res) => {
  const channel = getChannelById(req.params.id);
  if (!channel) return res.status(404).json({ error: 'Channel not found' });
  res.json(channel);
});

app.post('/api/channels/:id/subscribe', authenticate, (req, res) => {
  subscribeToChannel(req.params.id, req.user.userId);
  res.json({ success: true });
});

app.post('/api/channels/:id/unsubscribe', authenticate, (req, res) => {
  unsubscribeFromChannel(req.params.id, req.user.userId);
  res.json({ success: true });
});

app.post('/api/channels/:id/posts', authenticate, (req, res) => {
  const { content, mediaUrl } = req.body;
  const post = createChannelPost(req.params.id, req.user.userId, content, mediaUrl);
  if (post) res.json(post);
  else res.status(403).json({ error: 'Not authorized' });
});

// Bots
app.post('/api/bots', authenticate, (req, res) => {
  const { name, description } = req.body;
  const bot = createBot({
    name,
    description,
    ownerId: req.user.userId
  });
  res.json(bot);
});

app.get('/api/bots', authenticate, (req, res) => {
  const bots = getBotsByOwner(req.user.userId);
  res.json(bots);
});

// Messages
app.get('/api/messages/:chatId', authenticate, (req, res) => {
  const chat = getChatById(req.params.chatId);
  if (!chat || !chat.participants.includes(req.user.userId)) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const msgs = getMessagesForChat(req.params.chatId);
  res.json(msgs);
});

app.post('/api/messages', authenticate, (req, res) => {
  const { chatId, content, type = 'text', mediaUrl, replyTo } = req.body;
  if (!chatId || (!content && !mediaUrl)) {
    return res.status(400).json({ error: 'Invalid message' });
  }
  const chat = getChatById(chatId);
  if (!chat || !chat.participants.includes(req.user.userId)) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const sanitizedContent = content ? sanitizeMessage(content) : '';
  const message = createMessage({
    chatId,
    senderId: req.user.userId,
    content: sanitizedContent,
    type,
    mediaUrl,
    replyTo: replyTo || null,
    reactions: {}
  });
  // Broadcast via socket
  io.to(chatId).emit('message:new', message);
  res.json(message);
});

app.put('/api/messages/:id', authenticate, (req, res) => {
  const { content } = req.body;
  const message = getMessageById(req.params.id);
  if (!message || message.senderId !== req.user.userId) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const sanitized = sanitizeMessage(content);
  const updated = updateMessage(req.params.id, { content: sanitized });
  io.to(message.chatId).emit('message:edit', updated);
  res.json(updated);
});

app.delete('/api/messages/:id', authenticate, (req, res) => {
  const message = getMessageById(req.params.id);
  if (!message || message.senderId !== req.user.userId) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  deleteMessage(req.params.id);
  io.to(message.chatId).emit('message:delete', req.params.id);
  res.json({ success: true });
});

// Reactions
app.post('/api/messages/:id/reactions', authenticate, (req, res) => {
  const { emoji, action } = req.body;
  const message = getMessageById(req.params.id);
  if (!message) return res.status(404).json({ error: 'Message not found' });
  const chat = getChatById(message.chatId);
  if (!chat.participants.includes(req.user.userId)) return res.status(403).json({ error: 'Forbidden' });
  if (action === 'add') {
    addReaction(req.params.id, req.user.userId, emoji);
  } else if (action === 'remove') {
    removeReaction(req.params.id, req.user.userId, emoji);
  }
  io.to(message.chatId).emit('message:reaction', { messageId: req.params.id, emoji, action, userId: req.user.userId });
  res.json({ success: true });
});

// Pins
app.post('/api/chats/:id/pin', authenticate, (req, res) => {
  const { messageId } = req.body;
  pinMessage(req.params.id, messageId);
  res.json({ success: true });
});

// File upload
app.post('/api/upload', authenticate, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const fileUrl = `/uploads/${req.file.filename}`;
  res.json({ url: fileUrl, filename: req.file.originalname });
});

// AI endpoints
app.post('/api/ai/chat', authenticate, async (req, res) => {
  const { message, chatId } = req.body;
  const reply = await craheappBotChat(message, req.user.userId, chatId);
  res.json({ reply });
});

app.post('/api/ai/translate', authenticate, async (req, res) => {
  const { text, targetLanguage } = req.body;
  const translated = await craheappBotTranslate(text, targetLanguage);
  res.json({ translated });
});

app.post('/api/ai/summarize', authenticate, async (req, res) => {
  const { messages } = req.body;
  const summary = await craheappBotSummarize(messages);
  res.json({ summary });
});

app.post('/api/ai/generate', authenticate, async (req, res) => {
  const { prompt } = req.body;
  const generated = await craheappBotGenerate(prompt);
  res.json({ generated });
});

// IRIS endpoints (moderation)
app.post('/api/iris/check', authenticate, async (req, res) => {
  const { content, chatId } = req.body;
  const result = await irisCheckMessage(content, chatId);
  res.json(result);
});

// Socket.IO
io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  const decoded = verifyToken(token);
  if (!decoded) return next(new Error('Authentication error'));
  socket.userId = decoded.userId;
  socket.username = decoded.username;
  next();
});

io.on('connection', (socket) => {
  console.log(`User ${socket.userId} connected`);

  socket.on('joinChat', (chatId) => {
    socket.join(chatId);
  });

  socket.on('leaveChat', (chatId) => {
    socket.leave(chatId);
  });

  socket.on('typing', ({ chatId, isTyping }) => {
    socket.to(chatId).emit('typing', { userId: socket.userId, username: socket.username, isTyping });
  });

  socket.on('disconnect', () => {
    console.log(`User ${socket.userId} disconnected`);
  });
});

// Serve frontend
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'chat.html'));
});

// Start server
function startServer() {
  const PORT = process.env.PORT || 3000;
  server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}

module.exports = { startServer };
