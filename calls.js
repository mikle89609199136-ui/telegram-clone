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

  if (!['voice', 'video'].includes(type)) {
    return res.status(400).json({ error: 'Invalid call type' });
  }

  try {
    // Проверяем, что вызываемый пользователь существует
    const user = await query('SELECT id, username FROM users WHERE id = $1', [calleeId]);
    if (user.rows.length === 0) {
      return res.status(404).json({ error: 'Callee not found' });
    }

    // Проверяем, не занят ли пользователь другим звонком
    const activeCall = await query(
      'SELECT id FROM calls WHERE (caller_id = $1 OR callee_id = $1) AND status = $2',
      [calleeId, 'ongoing']
    );
    if (activeCall.rows.length > 0) {
      return res.status(409).json({ error: 'User is already in a call' });
    }

    const callId = generateId();
    await query(`
      INSERT INTO calls (id, caller_id, callee_id, type, status, started_at)
      VALUES ($1, $2, $3, $4, 'ongoing', NOW())
    `, [callId, req.user.id, calleeId, type]);

    logger.info(`Call started: ${callId} (${type}) from ${req.user.id} to ${calleeId}`);

    // Получаем информацию о звонящем
    const caller = await query('SELECT username, avatar FROM users WHERE id = $1', [req.user.id]);

    // Уведомляем через WebSocket
    const io = req.app.get('io');
    if (io) {
      io.to(`user:${calleeId}`).emit('incomingCall', {
        callId,
        caller: {
          id: req.user.id,
          username: caller.rows[0].username,
          avatar: caller.rows[0].avatar
        },
        type
      });
    }

    res.json({ 
      callId,
      callee: {
        id: calleeId,
        username: user.rows[0].username
      }
    });
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
      'SELECT * FROM calls WHERE id = $1 AND (caller_id = $2 OR callee_id = $2) AND status = $3',
      [callId, req.user.id, 'ongoing']
    );
    if (call.rows.length === 0) {
      return res.status(403).json({ error: 'Not a participant of this call or call already ended' });
    }

    await query(`
      UPDATE calls SET status = 'completed', ended_at = NOW(),
        duration = EXTRACT(EPOCH FROM (NOW() - started_at))
      WHERE id = $1
    `, [callId]);

    // Уведомляем другого участника
    const callData = call.rows[0];
    const otherParticipant = callData.caller_id === req.user.id ? callData.callee_id : callData.caller_id;
    
    const io = req.app.get('io');
    if (io) {
      io.to(`user:${otherParticipant}`).emit('callEnded', { callId });
    }

    res.json({ success: true });
  } catch (err) {
    logger.error('Error ending call:', err);
    res.status(500).json({ error: 'Failed to end call' });
  }
});

// ==================== ОТКЛОНИТЬ ЗВОНОК ====================
router.post('/:callId/reject', async (req, res) => {
  const { callId } = req.params;

  try {
    // Проверяем, что пользователь является вызываемым
    const call = await query(
      'SELECT * FROM calls WHERE id = $1 AND callee_id = $2 AND status = $3',
      [callId, req.user.id, 'ongoing']
    );
    if (call.rows.length === 0) {
      return res.status(403).json({ error: 'Not the callee of this call or call already ended' });
    }

    await query('UPDATE calls SET status = $1 WHERE id = $2', ['rejected', callId]);

    // Уведомляем звонящего
    const io = req.app.get('io');
    if (io) {
      io.to(`user:${call.rows[0].caller_id}`).emit('callRejected', { callId });
    }

    res.json({ success: true });
  } catch (err) {
    logger.error('Error rejecting call:', err);
    res.status(500).json({ error: 'Failed to reject call' });
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
  const { limit = 50, offset = 0 } = req.query;

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
      LIMIT $2 OFFSET $3
    `, [req.user.id, parseInt(limit), parseInt(offset)]);

    // Форматируем для фронтенда
    const history = result.rows.map(call => {
      const isCaller = call.caller_id === req.user.id;
      return {
        id: call.id,
        type: call.type,
        status: call.status,
        started_at: call.started_at,
        ended_at: call.ended_at,
        duration: call.duration,
        contact: isCaller ? {
          id: call.callee_id,
          name: call.callee_name,
          avatar: call.callee_avatar
        } : {
          id: call.caller_id,
          name: call.caller_name,
          avatar: call.caller_avatar
        },
        direction: isCaller ? 'outgoing' : 'incoming'
      };
    });

    res.json(history);
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

    const callData = call.rows[0];
    const isCaller = callData.caller_id === req.user.id;

    res.json({
      id: callData.id,
      type: callData.type,
      status: callData.status,
      started_at: callData.started_at,
      ended_at: callData.ended_at,
      duration: callData.duration,
      contact: isCaller ? {
        id: callData.callee_id,
        name: callData.callee_name,
        avatar: callData.callee_avatar
      } : {
        id: callData.caller_id,
        name: callData.caller_name,
        avatar: callData.caller_avatar
      },
      direction: isCaller ? 'outgoing' : 'incoming'
    });
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

// ==================== ПОЛУЧИТЬ АКТИВНЫЙ ЗВОНОК ====================
router.get('/active/current', async (req, res) => {
  try {
    const active = await query(
      'SELECT * FROM calls WHERE (caller_id = $1 OR callee_id = $1) AND status = $2',
      [req.user.id, 'ongoing']
    );

    if (active.rows.length === 0) {
      return res.json(null);
    }

    const call = active.rows[0];
    const otherId = call.caller_id === req.user.id ? call.callee_id : call.caller_id;
    
    const otherUser = await query('SELECT username, avatar FROM users WHERE id = $1', [otherId]);

    res.json({
      id: call.id,
      type: call.type,
      started_at: call.started_at,
      contact: {
        id: otherId,
        username: otherUser.rows[0].username,
        avatar: otherUser.rows[0].avatar
      },
      isCaller: call.caller_id === req.user.id
    });
  } catch (err) {
    logger.error('Error fetching active call:', err);
    res.status(500).json({ error: 'Failed to fetch active call' });
  }
});

module.exports = router;
