// chats.js – chat management (private, group, channel)
const express = require('express');
const router = express.Router();
const authenticateToken = require('./authMiddleware');
const { db } = require('./database');
const { generateId } = require('./utils');
const logger = require('./logger');

// Get all chats for current user
router.get('/', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const result = await db.query(
      `SELECT c.*, 
        (SELECT json_agg(json_build_object('id', u.id, 'username', u.username, 'avatar', u.avatar, 'role', cp.role))
         FROM chat_participants cp
         JOIN users u ON cp.user_id = u.id
         WHERE cp.chat_id = c.id) as participants,
        (SELECT m.content FROM messages m WHERE m.chat_id = c.id ORDER BY m.created_at DESC LIMIT 1) as last_message,
        (SELECT m.created_at FROM messages m WHERE m.chat_id = c.id ORDER BY m.created_at DESC LIMIT 1) as last_message_time,
        (SELECT COUNT(*) FROM messages m WHERE m.chat_id = c.id AND m.created_at > COALESCE(
          (SELECT last_read_at FROM chat_participants WHERE chat_id = c.id AND user_id = $1), '1970-01-01'
        )) as unread_count
       FROM chats c
       JOIN chat_participants cp ON c.id = cp.chat_id
       WHERE cp.user_id = $1
       ORDER BY last_message_time DESC NULLS LAST`,
      [userId]
    );
    res.json(result.rows);
  } catch (err) {
    logger.error('Get chats error:', err);
    res.status(500).json({ error: 'Failed to get chats' });
  }
});

// Create private chat
router.post('/private', authenticateToken, async (req, res) => {
  try {
    const { userId: otherUserId } = req.body;
    const myId = req.user.id;

    const existing = await db.query(
      `SELECT c.id FROM chats c
       JOIN chat_participants cp1 ON c.id = cp1.chat_id
       JOIN chat_participants cp2 ON c.id = cp2.chat_id
       WHERE c.type = 'private' AND cp1.user_id = $1 AND cp2.user_id = $2`,
      [myId, otherUserId]
    );
    if (existing.rows.length > 0) {
      return res.json({ chatId: existing.rows[0].id });
    }

    const chatId = generateId();
    await db.query('INSERT INTO chats (id, type, created_by) VALUES ($1, $2, $3)', [chatId, 'private', myId]);
    await db.query(
      'INSERT INTO chat_participants (chat_id, user_id, role) VALUES ($1, $2, $3), ($1, $4, $3)',
      [chatId, myId, 'member', otherUserId]
    );
    res.json({ chatId });
  } catch (err) {
    logger.error('Create private chat error:', err);
    res.status(500).json({ error: 'Failed to create chat' });
  }
});

// Create group
router.post('/group', authenticateToken, async (req, res) => {
  try {
    const { title, avatar, description, privacy, participants } = req.body;
    const myId = req.user.id;
    const chatId = generateId();

    await db.query(
      `INSERT INTO chats (id, type, title, avatar, description, created_by, privacy)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [chatId, 'group', title, avatar, description, myId, privacy || 'public']
    );

    const allParticipants = [myId, ...(participants || [])];
    for (const uid of allParticipants) {
      const role = uid === myId ? 'owner' : 'member';
      await db.query(
        'INSERT INTO chat_participants (chat_id, user_id, role) VALUES ($1, $2, $3)',
        [chatId, uid, role]
      );
    }

    if (privacy === 'private') {
      const link = `https://t.me/joinchat/${generateId()}`;
      await db.query('UPDATE chats SET invite_link = $1 WHERE id = $2', [link, chatId]);
    }

    res.json({ chatId });
  } catch (err) {
    logger.error('Create group error:', err);
    res.status(500).json({ error: 'Failed to create group' });
  }
});

// Create channel
router.post('/channel', authenticateToken, async (req, res) => {
  try {
    const { title, avatar, description, privacy } = req.body;
    const myId = req.user.id;
    const chatId = generateId();

    await db.query(
      `INSERT INTO chats (id, type, title, avatar, description, created_by, privacy)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [chatId, 'channel', title, avatar, description, myId, privacy || 'public']
    );

    await db.query(
      'INSERT INTO chat_participants (chat_id, user_id, role) VALUES ($1, $2, $3)',
      [chatId, myId, 'owner']
    );

    if (privacy === 'private') {
      const link = `https://t.me/joinchat/${generateId()}`;
      await db.query('UPDATE chats SET invite_link = $1 WHERE id = $2', [link, chatId]);
    }

    res.json({ chatId });
  } catch (err) {
    logger.error('Create channel error:', err);
    res.status(500).json({ error: 'Failed to create channel' });
  }
});

// Get chat info
router.get('/:chatId', authenticateToken, async (req, res) => {
  try {
    const { chatId } = req.params;
    const result = await db.query(
      `SELECT c.*, 
        (SELECT json_agg(json_build_object('id', u.id, 'username', u.username, 'avatar', u.avatar, 'role', cp.role))
         FROM chat_participants cp
         JOIN users u ON cp.user_id = u.id
         WHERE cp.chat_id = c.id) as participants
       FROM chats c
       WHERE c.id = $1`,
      [chatId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Chat not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    logger.error('Get chat info error:', err);
    res.status(500).json({ error: 'Failed to get chat info' });
  }
});

// Update chat (only owner/admin)
router.put('/:chatId', authenticateToken, async (req, res) => {
  try {
    const { chatId } = req.params;
    const { title, avatar, description, privacy } = req.body;

    const roleCheck = await db.query(
      'SELECT role FROM chat_participants WHERE chat_id = $1 AND user_id = $2',
      [chatId, req.user.id]
    );
    if (roleCheck.rows.length === 0 || !['owner', 'admin'].includes(roleCheck.rows[0].role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    await db.query(
      `UPDATE chats SET 
        title = COALESCE($1, title),
        avatar = COALESCE($2, avatar),
        description = COALESCE($3, description),
        privacy = COALESCE($4, privacy),
        updated_at = NOW()
       WHERE id = $5`,
      [title, avatar, description, privacy, chatId]
    );
    res.json({ success: true });
  } catch (err) {
    logger.error('Update chat error:', err);
    res.status(500).json({ error: 'Failed to update chat' });
  }
});

// Add participant
router.post('/:chatId/participants', authenticateToken, async (req, res) => {
  try {
    const { chatId } = req.params;
    const { userId } = req.body;

    const roleCheck = await db.query(
      'SELECT role FROM chat_participants WHERE chat_id = $1 AND user_id = $2',
      [chatId, req.user.id]
    );
    if (roleCheck.rows.length === 0 || !['owner', 'admin'].includes(roleCheck.rows[0].role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    await db.query(
      'INSERT INTO chat_participants (chat_id, user_id, role) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
      [chatId, userId, 'member']
    );
    res.json({ success: true });
  } catch (err) {
    logger.error('Add participant error:', err);
    res.status(500).json({ error: 'Failed to add participant' });
  }
});

// Remove participant
router.delete('/:chatId/participants/:userId', authenticateToken, async (req, res) => {
  try {
    const { chatId, userId } = req.params;
    const myId = req.user.id;
    if (myId === userId) {
      await db.query('DELETE FROM chat_participants WHERE chat_id = $1 AND user_id = $2', [chatId, userId]);
    } else {
      const roleCheck = await db.query(
        'SELECT role FROM chat_participants WHERE chat_id = $1 AND user_id = $2',
        [chatId, myId]
      );
      if (roleCheck.rows.length === 0 || !['owner', 'admin'].includes(roleCheck.rows[0].role)) {
        return res.status(403).json({ error: 'Insufficient permissions' });
      }
      await db.query('DELETE FROM chat_participants WHERE chat_id = $1 AND user_id = $2', [chatId, userId]);
    }
    res.json({ success: true });
  } catch (err) {
    logger.error('Remove participant error:', err);
    res.status(500).json({ error: 'Failed to remove participant' });
  }
});

module.exports = router;
