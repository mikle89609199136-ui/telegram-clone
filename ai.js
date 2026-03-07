const express = require('express');
const router = express.Router();
const axios = require('axios');
const { query } = require('./data');
const config = require('./config');
const logger = require('./logger');

// Проверка наличия API-ключа
if (!config.openai.apiKey) {
  logger.warn('OpenAI API key not set. AI features will return mock responses.');
}

// ==================== ПЕРЕВОД СООБЩЕНИЯ ====================
router.post('/translate', async (req, res) => {
  const { text, targetLang = 'ru' } = req.body;
  if (!text) {
    return res.status(400).json({ error: 'Text required' });
  }

  if (!config.openai.apiKey) {
    return res.json({ translated: `[Mock translation to ${targetLang}]: ${text}` });
  }

  try {
    const response = await axios.post('https://api.openai.com/v1/chat/completions', {
      model: config.openai.model,
      messages: [
        { role: 'system', content: `You are a translator. Translate the following text to ${targetLang}. Output only the translation.` },
        { role: 'user', content: text }
      ],
      temperature: 0.3,
      max_tokens: 1000
    }, {
      headers: {
        'Authorization': `Bearer ${config.openai.apiKey}`,
        'Content-Type': 'application/json'
      }
    });
    const translation = response.data.choices[0].message.content;
    res.json({ translated: translation });
  } catch (err) {
    logger.error('Translation error:', err);
    res.status(500).json({ error: 'Translation failed' });
  }
});

// ==================== СУММАРИЗАЦИЯ ЧАТА ====================
router.post('/summarize', async (req, res) => {
  const { chatId, messageCount = 50 } = req.body;
  if (!chatId) {
    return res.status(400).json({ error: 'ChatId required' });
  }

  try {
    // Проверяем доступ к чату
    const member = await query(
      'SELECT 1 FROM chat_members WHERE chat_id = $1 AND user_id = $2',
      [chatId, req.user.id]
    );
    if (member.rows.length === 0) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const messages = await query(`
      SELECT m.content, u.username
      FROM messages m
      JOIN users u ON u.id = m.sender_id
      WHERE m.chat_id = $1 AND m.type = 'text'
      ORDER BY m.created_at DESC
      LIMIT $2
    `, [chatId, messageCount]);

    if (messages.rows.length === 0) {
      return res.json({ summary: 'No messages to summarize' });
    }

    const conversation = messages.rows.reverse().map(m => `${m.username}: ${m.content}`).join('\n');

    if (!config.openai.apiKey) {
      return res.json({ summary: `[Mock summary of ${messages.rows.length} messages]` });
    }

    const response = await axios.post('https://api.openai.com/v1/chat/completions', {
      model: config.openai.model,
      messages: [
        { role: 'system', content: 'Summarize the following conversation in a few sentences. Focus on key topics and decisions.' },
        { role: 'user', content: conversation }
      ],
      temperature: 0.5,
      max_tokens: 300
    }, {
      headers: {
        'Authorization': `Bearer ${config.openai.apiKey}`,
        'Content-Type': 'application/json'
      }
    });
    const summary = response.data.choices[0].message.content;
    res.json({ summary });
  } catch (err) {
    logger.error('Summarization error:', err);
    res.status(500).json({ error: 'Summarization failed' });
  }
});

// ==================== УМНЫЕ ОТВЕТЫ (SMART REPLY) ====================
router.post('/smart-reply', async (req, res) => {
  const { chatId, contextMessage } = req.body;
  if (!chatId) {
    return res.status(400).json({ error: 'ChatId required' });
  }

  try {
    // Проверка доступа к чату
    const member = await query(
      'SELECT 1 FROM chat_members WHERE chat_id = $1 AND user_id = $2',
      [chatId, req.user.id]
    );
    if (member.rows.length === 0) {
      return res.status(403).json({ error: 'Access denied' });
    }

    let context = contextMessage || '';
    if (!context) {
      const messages = await query(`
        SELECT m.content, u.username
        FROM messages m
        JOIN users u ON u.id = m.sender_id
        WHERE m.chat_id = $1 AND m.type = 'text'
        ORDER BY m.created_at DESC
        LIMIT 10
      `, [chatId]);
      context = messages.rows.reverse().map(m => `${m.username}: ${m.content}`).join('\n');
    }

    if (!config.openai.apiKey) {
      return res.json({ suggestions: ['OK', 'Thanks', '👍', 'Sounds good', 'I agree'] });
    }

    const response = await axios.post('https://api.openai.com/v1/chat/completions', {
      model: config.openai.model,
      messages: [
        { role: 'system', content: 'You are a helpful messaging assistant. Suggest 3 brief, natural replies to the last message.' },
        { role: 'user', content: context }
      ],
      temperature: 0.7,
      max_tokens: 100,
      n: 3
    }, {
      headers: {
        'Authorization': `Bearer ${config.openai.apiKey}`,
        'Content-Type': 'application/json'
      }
    });
    const suggestions = response.data.choices.map(c => c.message.content);
    res.json({ suggestions });
  } catch (err) {
    logger.error('Smart reply error:', err);
    res.status(500).json({ error: 'Smart reply failed' });
  }
});

// ==================== ДЕТЕКЦИЯ СПАМА ====================
router.post('/detect-spam', async (req, res) => {
  const { text } = req.body;
  if (!text) {
    return res.status(400).json({ error: 'Text required' });
  }

  if (!config.openai.apiKey) {
    return res.json({ isSpam: false, confidence: 0 });
  }

  try {
    const response = await axios.post('https://api.openai.com/v1/chat/completions', {
      model: config.openai.model,
      messages: [
        { role: 'system', content: 'You are a spam detection system. Respond with a JSON object containing "isSpam" (boolean) and "confidence" (0-1).' },
        { role: 'user', content: text }
      ],
      temperature: 0.2,
      max_tokens: 50,
      response_format: { type: 'json_object' }
    }, {
      headers: {
        'Authorization': `Bearer ${config.openai.apiKey}`,
        'Content-Type': 'application/json'
      }
    });
    const result = JSON.parse(response.data.choices[0].message.content);
    res.json(result);
  } catch (err) {
    logger.error('Spam detection error:', err);
    res.status(500).json({ error: 'Spam detection failed' });
  }
});

// ==================== ГЕНЕРАЦИЯ СТИКЕРОВ (опционально) ====================
router.post('/generate-sticker', async (req, res) => {
  const { prompt } = req.body;
  if (!prompt) {
    return res.status(400).json({ error: 'Prompt required' });
  }

  if (!config.openai.apiKey) {
    return res.json({ imageUrl: null, error: 'OpenAI API key not set' });
  }

  try {
    // Используем DALL-E для генерации изображения
    const response = await axios.post('https://api.openai.com/v1/images/generations', {
      model: 'dall-e-3',
      prompt: `Create a sticker for a messenger app: ${prompt}`,
      n: 1,
      size: '1024x1024'
    }, {
      headers: {
        'Authorization': `Bearer ${config.openai.apiKey}`,
        'Content-Type': 'application/json'
      }
    });
    const imageUrl = response.data.data[0].url;
    res.json({ imageUrl });
  } catch (err) {
    logger.error('Sticker generation error:', err);
    res.status(500).json({ error: 'Sticker generation failed' });
  }
});

module.exports = router;
