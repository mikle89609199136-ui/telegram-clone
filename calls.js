// calls.js – WebRTC signaling and call management
const express = require('express');
const router = express.Router();
const authenticateToken = require('./authMiddleware');
const { db } = require('./database');
const { generateId } = require('./utils');
const logger = require('./logger');

// Start a call
router.post('/start', authenticateToken, async (req, res) => {
  try {
    const { calleeId } = req.body;
    const callerId = req.user.id;

    if (callerId === calleeId) {
      return res.status(400).json({ error: 'Cannot call yourself' });
    }

    const callId = generateId();
    await db.query(
      `INSERT INTO calls (id, caller_id, callee_id, status, started_at)
       VALUES ($1, $2, $3, 'ongoing', NOW())`,
      [callId, callerId, calleeId]
    );

    res.json({ callId });
  } catch (err) {
    logger.error('Start call error:', err);
    res.status(500).json({ error: 'Failed to start call' });
  }
});

// End a call
router.post('/:callId/end', authenticateToken, async (req, res) => {
  try {
    const { callId } = req.params;
    await db.query(
      `UPDATE calls SET status = 'ended', ended_at = NOW() WHERE id = $1`,
      [callId]
    );
    res.json({ success: true });
  } catch (err) {
    logger.error('End call error:', err);
    res.status(500).json({ error: 'Failed to end call' });
  }
});

// Get call history
router.get('/history', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const result = await db.query(
      `SELECT c.*, 
        caller.username as caller_username,
        callee.username as callee_username
       FROM calls c
       JOIN users caller ON c.caller_id = caller.id
       JOIN users callee ON c.callee_id = callee.id
       WHERE c.caller_id = $1 OR c.callee_id = $1
       ORDER BY c.started_at DESC
       LIMIT 50`,
      [userId]
    );
    res.json(result.rows);
  } catch (err) {
    logger.error('Get call history error:', err);
    res.status(500).json({ error: 'Failed to get call history' });
  }
});

module.exports = router;
