// ai.js – IRIS AI assistant endpoints
const express = require('express');
const router = express.Router();
const authenticateToken = require('./authMiddleware');
const { db } = require('./database');
const { generateId } = require('./utils');
const config = require('./config');
const logger = require('./logger');
const { OpenAI } = require('openai');

let openai = null;
if (config.AI.provider === 'openai' && config.AI.openaiApiKey) {
  openai = new OpenAI({ apiKey: config.AI.openaiApiKey });
}

// Helper to log AI requests
async function logAI(userId, chatId, request, response, model, tokens) {
  try {
    await db.query(
      `INSERT INTO ai_logs (id, user_id, chat_id, request, response, model, tokens_used, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
      [generateId(), userId, chatId, request, response, model, tokens]
    );
  } catch (err) {
    logger.error('Failed to log AI request:', err);
  }
}

// Generic AI request handler
async function callAI(prompt, systemPrompt = 'You are IRIS, a helpful assistant inside a messaging app.') {
  if (!openai) {
    throw new Error('AI provider not configured');
  }
  try {
    const completion = await openai.chat.completions.create({
      model: config.AI.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt },
      ],
      max_tokens: 500,
    });
    const response = completion.choices[0].message.content;
    const tokens = completion.usage.total_tokens;
    return { response, tokens };
  } catch (err) {
    logger.error('OpenAI error:', err);
    throw err;
  }
}

// POST /api/ai/ask – ask IRIS a question (in context of a chat)
router.post('/ask', authenticateToken, async (req, res) => {
  try {
    const { chatId, question } = req.body;
    const userId = req.user.id;

    if (!question) {
      return res.status(400).json({ error: 'Question is required' });
    }

    // Optional: check if user is in chat
    if (chatId) {
      const access = await db.query(
        'SELECT 1 FROM chat_participants WHERE chat_id = $1 AND user_id = $2',
        [chatId, userId]
      );
      if (access.rows.length === 0) {
        return res.status(403).json({ error: 'No access to this chat' });
      }
    }

    // Prepare context: fetch recent messages if chatId provided
    let context = '';
    if (chatId) {
      const recent = await db.query(
        `SELECT u.username, m.content FROM messages m
         JOIN users u ON m.sender_id = u.id
         WHERE m.chat_id = $1
         ORDER BY m.created_at DESC
         LIMIT 20`,
        [chatId]
      );
      context = recent.rows.reverse().map(r => `${r.username}: ${r.content}`).join('\n');
    }

    const prompt = context ? `Chat history:\n${context}\n\nUser question: ${question}` : question;
    const system = 'You are IRIS, an AI assistant integrated into a messenger. Answer helpfully and concisely.';

    const { response, tokens } = await callAI(prompt, system);

    // Log the interaction
    await logAI(userId, chatId, question, response, config.AI.model, tokens);

    res.json({ answer: response });
  } catch (err) {
    logger.error('AI ask error:', err);
    res.status(500).json({ error: 'AI request failed' });
  }
});

// POST /api/ai/summarize – summarize recent messages in a chat
router.post('/summarize', authenticateToken, async (req, res) => {
  try {
    const { chatId } = req.body;
    const userId = req.user.id;

    const access = await db.query(
      'SELECT 1 FROM chat_participants WHERE chat_id = $1 AND user_id = $2',
      [chatId, userId]
    );
    if (access.rows.length === 0) {
      return res.status(403).json({ error: 'No access to this chat' });
    }

    const recent = await db.query(
      `SELECT u.username, m.content, m.created_at FROM messages m
       JOIN users u ON m.sender_id = u.id
       WHERE m.chat_id = $1
       ORDER BY m.created_at DESC
       LIMIT 100`,
      [chatId]
    );
    const messages = recent.rows.reverse().map(r => `${r.username}: ${r.content}`).join('\n');

    const prompt = `Summarize the following conversation in a few sentences:\n${messages}`;
    const system = 'You are an AI assistant that summarizes conversations.';
    const { response, tokens } = await callAI(prompt, system);

    await logAI(userId, chatId, 'summarize', response, config.AI.model, tokens);
    res.json({ summary: response });
  } catch (err) {
    logger.error('AI summarize error:', err);
    res.status(500).json({ error: 'Summarization failed' });
  }
});

// POST /api/ai/translate – translate a message
router.post('/translate', authenticateToken, async (req, res) => {
  try {
    const { text, targetLang = 'English' } = req.body;
    if (!text) {
      return res.status(400).json({ error: 'Text to translate is required' });
    }

    const prompt = `Translate the following text to ${targetLang}:\n${text}`;
    const system = 'You are a translator AI. Only output the translated text, no explanations.';
    const { response, tokens } = await callAI(prompt, system);

    await logAI(req.user.id, null, `translate to ${targetLang}`, response, config.AI.model, tokens);
    res.json({ translated: response });
  } catch (err) {
    logger.error('AI translate error:', err);
    res.status(500).json({ error: 'Translation failed' });
  }
});

// POST /api/ai/generate – generate text (e.g., help writing a message)
router.post('/generate', authenticateToken, async (req, res) => {
  try {
    const { prompt } = req.body;
    if (!prompt) {
      return res.status(400).json({ error: 'Prompt is required' });
    }

    const system = 'You are a creative writing assistant. Generate text based on the user\'s request.';
    const { response, tokens } = await callAI(prompt, system);

    await logAI(req.user.id, null, prompt, response, config.AI.model, tokens);
    res.json({ generated: response });
  } catch (err) {
    logger.error('AI generate error:', err);
    res.status(500).json({ error: 'Generation failed' });
  }
});

// GET /api/ai/history – get AI interaction history for user
router.get('/history', authenticateToken, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT * FROM ai_logs WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50`,
      [req.user.id]
    );
    res.json(result.rows);
  } catch (err) {
    logger.error('Get AI history error:', err);
    res.status(500).json({ error: 'Failed to get history' });
  }
});

module.exports = router;
