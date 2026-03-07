const express = require('express');
const router = express.Router();
const { query } = require('./data');
const { generateId } = require('./utils');
const logger = require('./logger');

// ==================== НАЧАТЬ ЗВОНОК (СОЗДАТЬ ЗАПИСЬ) ====================
router.post('/start', async (req, res) => {
  const { calleeId, type } = req.body; // type: 'voice', 'video'
  if (!calleeId || !type) {
    return res.status(400).json({ error: 'calleeId and type required' });
  }

  try {
    // Проверяем, что вызываемый пользователь существует
    const user = await query('SELECT id FROM users WHERE id = $1', [calleeId]);
    if (user.rows.length === 0) {
      return res.status(404).json({ error: 'Callee not found' });
    }

    const callId = generateId();
    await query(`
      INSERT INTO calls (id, caller_id, callee_id, type, status, started_at)
      VALUES ($1, $2, $3, $4, 'ongoing', NOW())
    `, [callId, req.user.id, calleeId, type]);

    logger.info(`Call started: ${callId} (${type}) from ${req.user.id} to ${calleeId}`);
    res.json({ callId });
  } catch (err) {
    logger.error('Error starting call:', err);
    res.status(500).json({ error: 'Failed to start call' });
  }
});

// ==================== ЗАВЕРШИТЬ ЗВОНОК ====================
router.post('/:callId/end', async (req, res) => {
  const { callId } = req.params;

  try {
    // Проверяем, что пользователь участвует в звонке (как caller или callee)
    const call = await query(
      'SELECT * FROM calls WHERE id = $1 AND (caller_id = $2 OR callee_id = $2)',
      [callId, req.user.id]
    );
    if (call.rows.length === 0) {
      return res.status(403).json({ error: 'Not a participant of this call' });
    }

    await query(`
      UPDATE calls SET status = 'completed', ended_at = NOW(),
        duration = EXTRACT(EPOCH FROM (NOW() - started_at))
      WHERE id = $1
    `, [callId]);

    res.json({ success: true });
  } catch (err) {
    logger.error('Error ending call:', err);
    res.status(500).json({ error: 'Failed to end call' });
  }
});

// ==================== ОТМЕТИТЬ ЗВОНОК КАК ПРОПУЩЕННЫЙ ====================
router.post('/:callId/missed', async (req, res) => {
  const { callId } = req.params;

  try {
    const call = await query(
      'SELECT * FROM calls WHERE id = $1 AND callee_id = $2',
      [callId, req.user.id]
    );
    if (call.rows.length === 0) {
      return res.status(403).json({ error: 'Not the callee of this call' });
    }

    await query('UPDATE calls SET status = $1 WHERE id = $2', ['missed', callId]);
    res.json({ success: true });
  } catch (err) {
    logger.error('Error marking call as missed:', err);
    res.status(500).json({ error: 'Failed to update call' });
  }
});

// ==================== ПОЛУЧИТЬ ИСТОРИЮ ЗВОНКОВ ПОЛЬЗОВАТЕЛЯ ====================
router.get('/history', async (req, res) => {
  try {
    const result = await query(`
      SELECT c.*,
        u_caller.username as caller_name, u_caller.avatar as caller_avatar,
        u_callee.username as callee_name, u_callee.avatar as callee_avatar
      FROM calls c
      JOIN users u_caller ON u_caller.id = c.caller_id
      JOIN users u_callee ON u_callee.id = c.callee_id
      WHERE c.caller_id = $1 OR c.callee_id = $1
      ORDER BY c.started_at DESC
      LIMIT 100
    `, [req.user.id]);

    res.json(result.rows);
  } catch (err) {
    logger.error('Error fetching call history:', err);
    res.status(500).json({ error: 'Failed to fetch call history' });
  }
});

// ==================== ПОЛУЧИТЬ ИНФОРМАЦИЮ О КОНКРЕТНОМ ЗВОНКЕ ====================
router.get('/:callId', async (req, res) => {
  const { callId } = req.params;

  try {
    const call = await query(`
      SELECT c.*,
        u_caller.username as caller_name, u_caller.avatar as caller_avatar,
        u_callee.username as callee_name, u_callee.avatar as callee_avatar
      FROM calls c
      JOIN users u_caller ON u_caller.id = c.caller_id
      JOIN users u_callee ON u_callee.id = c.callee_id
      WHERE c.id = $1 AND (c.caller_id = $2 OR c.callee_id = $2)
    `, [callId, req.user.id]);

    if (call.rows.length === 0) {
      return res.status(404).json({ error: 'Call not found or access denied' });
    }

    res.json(call.rows[0]);
  } catch (err) {
    logger.error('Error fetching call details:', err);
    res.status(500).json({ error: 'Failed to fetch call details' });
  }
});

// ==================== ПОЛУЧИТЬ НЕОТВЕЧЕННЫЕ ЗВОНКИ ====================
router.get('/missed/unread', async (req, res) => {
  try {
    const missed = await query(`
      SELECT c.*, u_caller.username as caller_name, u_caller.avatar as caller_avatar
      FROM calls c
      JOIN users u_caller ON u_caller.id = c.caller_id
      WHERE c.callee_id = $1 AND c.status = 'missed'
      ORDER BY c.started_at DESC
      LIMIT 50
    `, [req.user.id]);

    res.json(missed.rows);
  } catch (err) {
    logger.error('Error fetching missed calls:', err);
    res.status(500).json({ error: 'Failed to fetch missed calls' });
  }
});

module.exports = router;