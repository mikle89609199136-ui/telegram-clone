const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { getData, saveData } = require('./database');
const authMiddleware = require('./authMiddleware');

// Получить сообщения из конкретного чата
router.get('/:chatId', authMiddleware, (req, res) => {
  const { chatId } = req.params;
  const messages = getData('messages.json');
  const chatMessages = messages.filter(m => m.chatId === chatId).sort((a, b) => a.timestamp - b.timestamp);
  res.json(chatMessages);
});

// Отправить сообщение (сохраняется в БД, а через WebSocket отправляется сразу)
// Но этот эндпоинт может использоваться как fallback или для синхронизации
router.post('/', authMiddleware, (req, res) => {
  const { chatId, content, type = 'text' } = req.body;
  if (!chatId || !content) return res.status(400).json({ error: 'chatId and content required' });

  const messages = getData('messages.json');
  const newMessage = {
    id: uuidv4(),
    chatId,
    senderId: req.user.userId,
    content,
    type,
    timestamp: Date.now(),
    read: false
  };
  messages.push(newMessage);
  saveData('messages.json', messages);
  res.status(201).json(newMessage);
});

module.exports = router;
