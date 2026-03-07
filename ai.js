const express = require('express');
const fetch = require('node-fetch');
const { query } = require('./database');
const { addToQueue } = require('./utils');
const logger = require('./logger');
const config = require('./config');
const router = express.Router();

const rateLimit = require('express-rate-limit');
const aiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: config.aiRateLimit,
  keyGenerator: (req) => req.userId,
});

router.post('/message', aiLimiter, async (req, res) => {
  const { message } = req.body;
  if (!message || message.length > 1000) {
    return res.status(400).json({ error: 'Message required and max 1000 chars' });
  }

  try {
    await query('INSERT INTO ai_history (user_id, role, content) VALUES ($1, $2, $3)', [req.userId, 'user', message]);
    const jobId = await addToQueue('ai', { userId: req.userId, message }, { timeout: 30000 });
    res.json({ status: 'processing', jobId });
  } catch (err) {
    logger.error('AI request error', err);
    res.status(500).json({ error: 'Internal error' });
  }
});

async function processAiRequest(job) {
  const { userId, message } = job.data;
  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.openaiApiKey}`,
      },
      body: JSON.stringify({
        model: config.aiModel,
        messages: [{ role: 'user', content: message }],
        max_tokens: config.aiMaxTokens,
      }),
    });
    const data = await response.json();
    const reply = data.choices[0].message.content;

    await query('INSERT INTO ai_history (user_id, role, content) VALUES ($1, $2, $3)', [userId, 'assistant', reply]);

    const redis = require('./utils').getRedis();
    await redis.publish('ai_response', JSON.stringify({ userId, reply }));
  } catch (err) {
    logger.error('AI processing error', err);
  }
}

module.exports = router;
module.exports.processAiRequest = processAiRequest;
