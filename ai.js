// ai.js – IRIS AI обработчик запросов (интеграция с OpenAI или другой моделью)
const express = require('express');
const router = express.Router();
const authenticateToken = require('./authMiddleware');
const { db } = require('./database');
const config = require('./config');
const logger = require('./logger');
const { generateId } = require('./utils');

// Настройка OpenAI (если используется)
let openai;
if (config.AI.provider === 'openai' && config.AI.openaiApiKey) {
  const OpenAI = require('openai');
  openai = new OpenAI({ apiKey: config.AI.openaiApiKey });
}

// Обработка AI-запроса
router.post('/query', authenticateToken, async (req, res) => {
  try {
    const { chatId, query, context } = req.body;
    const userId = req.user.id;

    // Проверка доступа к чату (опционально)
    if (chatId) {
      const access = await db.query(
        'SELECT 1 FROM chat_participants WHERE chat_id = $1 AND user_id = $2',
        [chatId, userId]
      );
      if (access.rows.length === 0) {
        return res.status(403).json({ error: 'No access to this chat' });
      }
    }

    let response = '';

    if (openai) {
      // Формируем сообщения для OpenAI
      const messages = [
        {
          role: 'system',
          content: 'Ты IRIS – дружелюбный AI-помощник в мессенджере. Отвечай кратко и полезно.',
        },
      ];
      if (context && context.length) {
        messages.push({
          role: 'user',
          content: 'Контекст чата: ' + context.map(m => `${m.senderUsername}: ${m.content}`).join('\n'),
        });
      }
      messages.push({ role: 'user', content: query });

      const completion = await openai.chat.completions.create({
        model: config.AI.model || 'gpt-3.5-turbo',
        messages,
        max_tokens: 500,
        temperature: 0.7,
      });
      response = completion.choices[0].message.content;
    } else {
      // Заглушка для демо
      response = `[IRIS DEMO] Получен запрос: "${query}". В production здесь будет ответ от AI.`;
    }

    // Сохраняем лог AI-запроса
    const logId = generateId();
    await db.query(
      `INSERT INTO ai_logs (id, user_id, chat_id, request, response, model, tokens_used, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
      [logId, userId, chatId || null, query, response, config.AI.model, 0] // tokens_used можно получить из ответа OpenAI
    );

    // Если запрос относится к конкретному чату, можно отправить ответ как сообщение от IRIS
    if (chatId) {
      const messageId = generateId();
      await db.query(
        `INSERT INTO messages (id, chat_id, sender_id, content, type, ai_metadata, created_at)
         VALUES ($1, $2, $3, $4, 'ai', $5, NOW())`,
        [messageId, chatId, 'iris', response, JSON.stringify({ request: query, model: config.AI.model })]
      );
      // Получить сообщение для возврата
      const newMsg = await db.query(
        `SELECT m.*, u.username as sender_username, u.avatar as sender_avatar
         FROM messages m
         JOIN users u ON m.sender_id = u.id
         WHERE m.id = $1`,
        [messageId]
      );
      return res.json({ response, message: newMsg.rows[0] });
    }

    res.json({ response });
  } catch (err) {
    logger.error('AI query error:', err);
    res.status(500).json({ error: 'AI processing failed' });
  }
});

// Получить историю AI-запросов пользователя
router.get('/history', authenticateToken, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT * FROM ai_logs WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50`,
      [req.user.id]
    );
    res.json(result.rows);
  } catch (err) {
    logger.error('Get AI history error:', err);
    res.status(500).json({ error: 'Failed to get AI history' });
  }
});

module.exports = router;
