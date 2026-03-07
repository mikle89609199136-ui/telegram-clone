const express = require('express');
const router = express.Router();
const { query } = require('./data');
const logger = require('./logger');

// ==================== ПОЛУЧЕНИЕ ИНФОРМАЦИИ О ПОЛЬЗОВАТЕЛЕ ПО ID ====================
router.get('/:userId', async (req, res) => {
  const { userId } = req.params;

  try {
    const user = await query(`
      SELECT id, username, avatar, bio, status, last_seen, created_at
      FROM users
      WHERE id = $1
    `, [userId]);

    if (user.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json(user.rows[0]);
  } catch (err) {
    logger.error('Error fetching user:', err);
    res.status(500).json({ error: 'Failed to fetch user' });
  }
});

// ==================== ПОИСК ПОЛЬЗОВАТЕЛЕЙ ПО ИМЕНИ ====================
router.get('/search/:query', async (req, res) => {
  const { query: searchQuery } = req.params;
  if (searchQuery.length < 2) {
    return res.json([]);
  }

  try {
    const users = await query(`
      SELECT id, username, avatar, status
      FROM users
      WHERE username ILIKE $1
      LIMIT 20
    `, [`%${searchQuery}%`]);

    res.json(users.rows);
  } catch (err) {
    logger.error('Error searching users:', err);
    res.status(500).json({ error: 'Search failed' });
  }
});

// ==================== ПОЛУЧЕНИЕ СПИСКА УЧАСТНИКОВ ЧАТА ====================
router.get('/chat/:chatId', async (req, res) => {
  const { chatId } = req.params;

  try {
    // Проверяем, что текущий пользователь является участником чата
    const memberCheck = await query(
      'SELECT 1 FROM chat_members WHERE chat_id = $1 AND user_id = $2',
      [chatId, req.user.id]
    );
    if (memberCheck.rows.length === 0) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const members = await query(`
      SELECT u.id, u.username, u.avatar, u.status, cm.role, cm.joined_at
      FROM chat_members cm
      JOIN users u ON u.id = cm.user_id
      WHERE cm.chat_id = $1
      ORDER BY cm.joined_at ASC
    `, [chatId]);

    res.json(members.rows);
  } catch (err) {
    logger.error('Error fetching chat members:', err);
    res.status(500).json({ error: 'Failed to fetch members' });
  }
});

module.exports = router;