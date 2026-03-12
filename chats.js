const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { getData, saveData } = require('./database');
const authMiddleware = require('./authMiddleware');

// Получить все чаты пользователя
router.get('/', authMiddleware, (req, res) => {
  const chats = getData('chats.json');
  const userChats = chats.filter(chat =>
    chat.participants.includes(req.user.userId)
  ).map(chat => ({
    ...chat,
    // можно добавить lastMessage и т.д.
  }));
  res.json(userChats);
});

// Создать личный чат с другим пользователем
router.post('/', authMiddleware, async (req, res) => {
  const { userId } = req.body; // ID собеседника
  if (!userId) return res.status(400).json({ error: 'userId required' });

  const chats = getData('chats.json');
  // Проверим, не существует ли уже чат между этими двумя
  const existing = chats.find(chat =>
    chat.type === 'private' &&
    chat.participants.includes(req.user.userId) &&
    chat.participants.includes(userId)
  );
  if (existing) return res.status(409).json(existing);

  const newChat = {
    id: uuidv4(),
    type: 'private',
    participants: [req.user.userId, userId],
    createdAt: new Date().toISOString(),
    lastMessage: null,
    lastMessageTime: null
  };
  chats.push(newChat);
  saveData('chats.json', chats);
  res.status(201).json(newChat);
});

// Получить информацию о чате (для групп)
router.get('/:chatId', authMiddleware, (req, res) => {
  const chats = getData('chats.json');
  const chat = chats.find(c => c.id === req.params.chatId);
  if (!chat) return res.status(404).json({ error: 'Chat not found' });
  if (!chat.participants.includes(req.user.userId)) {
    return res.status(403).json({ error: 'Access denied' });
  }
  res.json(chat);
});

module.exports = router;
