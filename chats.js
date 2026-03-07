const express = require('express');
const { query, transaction } = require('./database');
const { generateId } = require('./utils');
const logger = require('./logger');
const router = express.Router();

router.get('/', async (req, res) => {
  const userId = req.userId;
  try {
    const result = await query(
      `SELECT c.id, c.uid, c.type, c.title, c.avatar, c.created_at,
        (SELECT json_agg(json_build_object('id', u.id, 'username', u.username, 'avatar', u.avatar))
         FROM chat_members cm2 JOIN users u ON cm2.user_id = u.id WHERE cm2.chat_id = c.id) as participants,
        cm.muted_until, cm.archived, cm.pinned,
        (SELECT row_to_json(msg) FROM (
           SELECT m.id, m.uid, m.type, m.content as text, m.media, m.created_at,
                  u.id as sender_id, u.username as sender_username, u.avatar as sender_avatar
           FROM messages m LEFT JOIN users u ON m.sender_id = u.id
           WHERE m.chat_id = c.id AND m.deleted = false
           ORDER BY m.created_at DESC LIMIT 1
         ) msg) as last_message
       FROM chats c
       JOIN chat_members cm ON c.id = cm.chat_id
       WHERE cm.user_id = $1
       ORDER BY cm.pinned DESC, last_message.created_at DESC NULLS LAST`,
      [userId]
    );
    res.json(result.rows);
  } catch (err) {
    logger.error('Get chats error', err);
    res.status(500).json({ error: 'Database error' });
  }
});

router.post('/create/private', async (req, res) => {
  const userId = req.userId;
  const { participantId } = req.body;
  if (!participantId) return res.status(400).json({ error: 'participantId required' });

  if (userId === participantId) {
    return res.status(400).json({ error: 'Cannot create chat with yourself' });
  }

  try {
    // Check if private chat already exists
    const existing = await query(
      `SELECT c.id FROM chats c
       JOIN chat_members cm1 ON c.id = cm1.chat_id
       JOIN chat_members cm2 ON c.id = cm2.chat_id
       WHERE c.type = 'private' AND cm1.user_id = $1 AND cm2.user_id = $2`,
      [userId, participantId]
    );
    if (existing.rows.length) {
      return res.json({ chatId: existing.rows[0].id });
    }

    // Create new private chat
    const chatUid = generateId();
    const chatResult = await query(
      'INSERT INTO chats (uid, type) VALUES ($1, $2) RETURNING id',
      [chatUid, 'private']
    );
    const chatId = chatResult.rows[0].id;

    // Add members
    await query(
      'INSERT INTO chat_members (chat_id, user_id, role) VALUES ($1, $2, $3), ($1, $4, $5)',
      [chatId, userId, 'member', participantId, 'member']
    );

    res.status(201).json({ chatId });
  } catch (err) {
    logger.error('Create private chat error', err);
    res.status(500).json({ error: 'Database error' });
  }
});

router.post('/create/group', async (req, res) => {
  const userId = req.userId;
  const { title, participantIds } = req.body;
  if (!title || !participantIds || !Array.isArray(participantIds)) {
    return res.status(400).json({ error: 'title and participantIds array required' });
  }

  const members = [userId, ...participantIds.filter(id => id !== userId)];
  if (members.length < 2) {
    return res.status(400).json({ error: 'Need at least 2 participants' });
  }

  try {
    const chatUid = generateId();
    const chatResult = await query(
      'INSERT INTO chats (uid, type, title, created_by) VALUES ($1, $2, $3, $4) RETURNING id',
      [chatUid, 'group', title, userId]
    );
    const chatId = chatResult.rows[0].id;

    // Insert members with role: creator for userId, member for others
    const values = members.map((uid, index) => `(${chatId}, ${uid}, '${uid === userId ? 'creator' : 'member'}')`).join(',');
    await query(`INSERT INTO chat_members (chat_id, user_id, role) VALUES ${values}`);

    res.status(201).json({ chatId });
  } catch (err) {
    logger.error('Create group error', err);
    res.status(500).json({ error: 'Database error' });
  }
});

router.post('/create/channel', async (req, res) => {
  const userId = req.userId;
  const { title } = req.body;
  if (!title) return res.status(400).json({ error: 'title required' });

  try {
    const chatUid = generateId();
    const chatResult = await query(
      'INSERT INTO chats (uid, type, title, created_by) VALUES ($1, $2, $3, $4) RETURNING id',
      [chatUid, 'channel', title, userId]
    );
    const chatId = chatResult.rows[0].id;

    await query('INSERT INTO chat_members (chat_id, user_id, role) VALUES ($1, $2, $3)', [chatId, userId, 'creator']);

    res.status(201).json({ chatId });
  } catch (err) {
    logger.error('Create channel error', err);
    res.status(500).json({ error: 'Database error' });
  }
});

router.get('/:chatId', async (req, res) => {
  const chatId = parseInt(req.params.chatId);
  const userId = req.userId;
  if (isNaN(chatId)) return res.status(400).json({ error: 'Invalid chat ID' });

  try {
    const memberCheck = await query('SELECT 1 FROM chat_members WHERE chat_id = $1 AND user_id = $2', [chatId, userId]);
    if (!memberCheck.rows.length) return res.status(403).json({ error: 'Not a member' });

    const result = await query(
      `SELECT c.id, c.uid, c.type, c.title, c.avatar, c.created_at,
        (SELECT json_agg(json_build_object('id', u.id, 'username', u.username, 'avatar', u.avatar, 'role', cm.role))
         FROM chat_members cm JOIN users u ON cm.user_id = u.id WHERE cm.chat_id = c.id) as participants,
        (SELECT privacy_last_seen FROM user_settings WHERE user_id = $2) as my_privacy
       FROM chats c WHERE c.id = $1`,
      [chatId, userId]
    );
    res.json(result.rows[0]);
  } catch (err) {
    logger.error('Get chat error', err);
    res.status(500).json({ error: 'Database error' });
  }
});

router.post('/:chatId/mute', async (req, res) => {
  const chatId = parseInt(req.params.chatId);
  const userId = req.userId;
  const { until } = req.body;
  try {
    await query(
      'UPDATE chat_members SET muted_until = $1 WHERE chat_id = $2 AND user_id = $3',
      [until ? new Date(until) : null, chatId, userId]
    );
    res.json({ success: true });
  } catch (err) {
    logger.error('Mute chat error', err);
    res.status(500).json({ error: 'Database error' });
  }
});

router.post('/:chatId/archive', async (req, res) => {
  const chatId = parseInt(req.params.chatId);
  const userId = req.userId;
  const { archive } = req.body;
  try {
    await query(
      'UPDATE chat_members SET archived = $1 WHERE chat_id = $2 AND user_id = $3',
      [archive, chatId, userId]
    );
    res.json({ success: true });
  } catch (err) {
    logger.error('Archive chat error', err);
    res.status(500).json({ error: 'Database error' });
  }
});

router.post('/:chatId/pin', async (req, res) => {
  const chatId = parseInt(req.params.chatId);
  const userId = req.userId;
  const { pin } = req.body;
  try {
    await query(
      'UPDATE chat_members SET pinned = $1 WHERE chat_id = $2 AND user_id = $3',
      [pin, chatId, userId]
    );
    res.json({ success: true });
  } catch (err) {
    logger.error('Pin chat error', err);
    res.status(500).json({ error: 'Database error' });
  }
});

module.exports = router;
