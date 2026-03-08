// channels.js – channel specific operations
const express = require('express');
const router = express.Router();
const authenticateToken = require('./authMiddleware');
const { db } = require('./database');
const logger = require('./logger');

// Subscribe to a channel
router.post('/:channelId/subscribe', authenticateToken, async (req, res) => {
  try {
    const { channelId } = req.params;
    const userId = req.user.id;

    const channel = await db.query('SELECT type FROM chats WHERE id = $1', [channelId]);
    if (channel.rows.length === 0 || channel.rows[0].type !== 'channel') {
      return res.status(400).json({ error: 'Not a channel' });
    }

    await db.query(
      `INSERT INTO chat_participants (chat_id, user_id, role)
       VALUES ($1, $2, 'member')
       ON CONFLICT DO NOTHING`,
      [channelId, userId]
    );
    res.json({ success: true });
  } catch (err) {
    logger.error('Subscribe to channel error:', err);
    res.status(500).json({ error: 'Failed to subscribe' });
  }
});

// Unsubscribe from channel
router.delete('/:channelId/subscribe', authenticateToken, async (req, res) => {
  try {
    const { channelId } = req.params;
    const userId = req.user.id;
    await db.query(
      'DELETE FROM chat_participants WHERE chat_id = $1 AND user_id = $2',
      [channelId, userId]
    );
    res.json({ success: true });
  } catch (err) {
    logger.error('Unsubscribe from channel error:', err);
    res.status(500).json({ error: 'Failed to unsubscribe' });
  }
});

module.exports = router;
