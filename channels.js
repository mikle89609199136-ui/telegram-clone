const express = require('express');
const { query } = require('./database');
const router = express.Router();

router.get('/:channelId/subscribers', async (req, res) => {
  const channelId = parseInt(req.params.channelId);
  const result = await query(
    'SELECT u.id, u.username, u.avatar FROM chat_members cm JOIN users u ON cm.user_id = u.id WHERE cm.chat_id = $1 AND cm.role = $2',
    [channelId, 'member']
  );
  res.json(result.rows);
});

router.post('/:channelId/join', async (req, res) => {
  const channelId = parseInt(req.params.channelId);
  const userId = req.userId;
  await query(
    'INSERT INTO chat_members (chat_id, user_id, role) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
    [channelId, userId, 'member']
  );
  res.json({ success: true });
});

router.post('/:channelId/leave', async (req, res) => {
  const channelId = parseInt(req.params.channelId);
  const userId = req.userId;
  await query('DELETE FROM chat_members WHERE chat_id = $1 AND user_id = $2 AND role = $3', [channelId, userId, 'member']);
  res.json({ success: true });
});

module.exports = router;
