// ai.js — простой AI-бот (заглушка)
const express = require('express');
const router = express.Router();
const authenticateToken = require('./authMiddleware');
const logger = require('./logger');

// Эндпоинт для общения с AI
router.post('/chat', authenticateToken, async (req, res) => {
  try {
    const { message } = req.body;
    // Здесь можно вызвать внешний API (OpenAI и т.п.)
    const reply = `Получил ваше сообщение: "${message}". Я ещё учусь.`;
    res.json({ reply });
  } catch (err) {
    logger.error('AI chat error:', err);
    res.status(500).json({ error: 'Ошибка AI' });
  }
});

module.exports = router;
