const express = require('express');
const router = express.Router();
const axios = require('axios');
const { query } = require('./data');
const config = require('./config');
const logger = require('./logger');

// Проверка наличия API-ключа
const hasApiKey = !!config.openai.apiKey;
if (!hasApiKey) {
  logger.warn('OpenAI API key not set. AI features will return mock responses.');
}

// ==================== ПЕРЕВОД СООБЩЕНИЯ ====================
router.post('/translate', async (req, res) => {
  const { text, targetLang = 'ru', sourceLang = 'auto' } = req.body;
  
  if (!text) {
    return res.status(400).json({ error: 'Text required' });
  }

  if (!hasApiKey) {
    return res.json({ 
      translated: `[Mock translation to ${targetLang}]: ${text}`,
      sourceLang: sourceLang !== 'auto' ? sourceLang : 'en'
    });
  }

  try {
    const response = await axios.post('https://api.openai.com/v1/chat/completions', {
      model: config.openai.model,
      messages: [
        { 
          role: 'system', 
          content: `You are a translator. Translate the following text to ${targetLang}. 
                   ${sourceLang !== 'auto' ? `The source language is ${sourceLang}.` : 'Detect the source language automatically.'}
                   Output only the translation, without any additional text.` 
        },
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
    
    res.json({ 
      translated: translation,
      sourceLang: sourceLang !== 'auto' ? sourceLang : 'detected'
    });
  } catch (err) {
    logger.error('Translation error:', err);
    res.status(500).json({ error: 'Translation failed' });
  }
});

// ==================== СУММАРИЗАЦИЯ ЧАТА ====================
router.post('/summarize', async (req, res) => {
  const { chatId, messageCount = 50, format = 'paragraph' } = req.body;
  
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
      SELECT m.content, u.username, m.created_at
      FROM messages m
      JOIN users u ON u.id = m.sender_id
      WHERE m.chat_id = $1 AND m.type = 'text'
      ORDER BY m.created_at DESC
      LIMIT $2
    `, [chatId, messageCount]);

    if (messages.rows.length === 0) {
      return res.json({ summary: 'No messages to summarize' });
    }

    const conversation = messages.rows
      .reverse()
      .map(m => `${m.username} (${new Date(m.created_at).toLocaleTimeString()}): ${m.content}`)
      .join('\n');

    if (!hasApiKey) {
      return res.json({ 
        summary: `[Mock summary of ${messages.rows.length} messages]`,
        messageCount: messages.rows.length
      });
    }

    const formatPrompt = format === 'bullet' 
      ? 'Provide the summary as bullet points.'
      : 'Provide the summary as a coherent paragraph.';

    const response = await axios.post('https://api.openai.com/v1/chat/completions', {
      model: config.openai.model,
      messages: [
        { 
          role: 'system', 
          content: `Summarize the following conversation in a few sentences. Focus on key topics, decisions, and important moments. ${formatPrompt}` 
        },
        { role: 'user', content: conversation }
      ],
      temperature: 0.5,
      max_tokens: 500
    }, {
      headers: {
        'Authorization': `Bearer ${config.openai.apiKey}`,
        'Content-Type': 'application/json'
      }
    });
    
    const summary = response.data.choices[0].message.content;
    
    res.json({ 
      summary,
      messageCount: messages.rows.length,
      format
    });
  } catch (err) {
    logger.error('Summarization error:', err);
    res.status(500).json({ error: 'Summarization failed' });
  }
});

// ==================== УМНЫЕ ОТВЕТЫ (SMART REPLY) ====================
router.post('/smart-reply', async (req, res) => {
  const { chatId, contextMessage, count = 3 } = req.body;
  
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
      
      if (messages.rows.length === 0) {
        return res.json({ suggestions: [] });
      }
      
      context = messages.rows
        .reverse()
        .map(m => `${m.username}: ${m.content}`)
        .join('\n');
    }

    if (!hasApiKey) {
      const mockSuggestions = [
        'OK',
        'Thanks!',
        '👍',
        'Sounds good',
        'I agree',
        'Let me think about it',
        'Sure!',
        'No problem'
      ].slice(0, count);
      return res.json({ suggestions: mockSuggestions });
    }

    const response = await axios.post('https://api.openai.com/v1/chat/completions', {
      model: config.openai.model,
      messages: [
        { 
          role: 'system', 
          content: `You are a helpful messaging assistant. Suggest ${count} brief, natural, and contextually appropriate replies to the last message in the conversation. 
                   Each reply should be no longer than 60 characters. Return ONLY the replies, one per line, without numbering or quotes.` 
        },
        { role: 'user', content: context }
      ],
      temperature: 0.7,
      max_tokens: count * 30,
      n: 1
    }, {
      headers: {
        'Authorization': `Bearer ${config.openai.apiKey}`,
        'Content-Type': 'application/json'
      }
    });
    
    const suggestions = response.data.choices[0].message.content
      .split('\n')
      .map(s => s.trim())
      .filter(s => s.length > 0)
      .slice(0, count);

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

  if (!hasApiKey) {
    return res.json({ 
      isSpam: false, 
      confidence: 0,
      categories: []
    });
  }

  try {
    const response = await axios.post('https://api.openai.com/v1/chat/completions', {
      model: config.openai.model,
      messages: [
        { 
          role: 'system', 
          content: 'You are a spam detection system. Analyze the following message and respond with a JSON object containing:\n' +
                   '- "isSpam": boolean (true if message is spam)\n' +
                   '- "confidence": number between 0 and 1\n' +
                   '- "categories": array of strings (possible categories: "advertisement", "phishing", "scam", "harassment", "misinformation", "other")\n' +
                   'Respond with valid JSON only.'
        },
        { role: 'user', content: text }
      ],
      temperature: 0.2,
      max_tokens: 150,
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
  const { prompt, style = 'cute' } = req.body;
  
  if (!prompt) {
    return res.status(400).json({ error: 'Prompt required' });
  }

  if (!hasApiKey) {
    return res.json({ 
      imageUrl: null, 
      error: 'OpenAI API key not set',
      mock: true 
    });
  }

  try {
    // Используем DALL-E для генерации изображения
    const enhancedPrompt = `Create a sticker for a messenger app. Style: ${style}. Subject: ${prompt}. 
                           The sticker should be simple, expressive, and suitable for use as an emoji or reaction. 
                           Transparent background preferred.`;

    const response = await axios.post('https://api.openai.com/v1/images/generations', {
      model: 'dall-e-3',
      prompt: enhancedPrompt,
      n: 1,
      size: '1024x1024',
      quality: 'standard',
      response_format: 'url'
    }, {
      headers: {
        'Authorization': `Bearer ${config.openai.apiKey}`,
        'Content-Type': 'application/json'
      }
    });
    
    const imageUrl = response.data.data[0].url;
    
    // Здесь можно сохранить изображение в своё хранилище
    // и вернуть локальный URL
    
    res.json({ 
      imageUrl,
      prompt: enhancedPrompt
    });
  } catch (err) {
    logger.error('Sticker generation error:', err);
    res.status(500).json({ error: 'Sticker generation failed' });
  }
});

// ==================== АНАЛИЗ НАСТРОЕНИЯ ====================
router.post('/sentiment', async (req, res) => {
  const { text } = req.body;
  
  if (!text) {
    return res.status(400).json({ error: 'Text required' });
  }

  if (!hasApiKey) {
    return res.json({ 
      sentiment: 'neutral',
      score: 0.5,
      mock: true
    });
  }

  try {
    const response = await axios.post('https://api.openai.com/v1/chat/completions', {
      model: config.openai.model,
      messages: [
        { 
          role: 'system', 
          content: 'Analyze the sentiment of the following message. Respond with a JSON object containing:\n' +
                   '- "sentiment": string (one of: "positive", "negative", "neutral", "mixed")\n' +
                   '- "score": number between 0 and 1 (0 = very negative, 1 = very positive)\n' +
                   '- "confidence": number between 0 and 1\n' +
                   'Respond with valid JSON only.'
        },
        { role: 'user', content: text }
      ],
      temperature: 0.2,
      max_tokens: 100,
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
    logger.error('Sentiment analysis error:', err);
    res.status(500).json({ error: 'Sentiment analysis failed' });
  }
});

module.exports = router;
