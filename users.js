const express = require('express');
const router = express.Router();
const { query } = require('./data');
const { redis } = require('./database');
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

    const devices = await redis.sMembers(`user:${userId}:devices`);
    let online = false;
    for (const dev of devices) {
      if (await redis.exists(`online:${userId}:${dev}`)) {
        online = true;
        break;
      }
    }

    const userData = user.rows[0];
    userData.online = online;
    
    if (online) {
      delete userData.last_seen;
    }

    res.json(userData);
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

    const usersWithStatus = await Promise.all(users.rows.map(async (user) => {
      const devices = await redis.sMembers(`user:${user.id}:devices`);
      let online = false;
      for (const dev of devices) {
        if (await redis.exists(`online:${user.id}:${dev}`)) {
          online = true;
          break;
        }
      }
      return { ...user, online };
    }));

    res.json(usersWithStatus);
  } catch (err) {
    logger.error('Error searching users:', err);
    res.status(500).json({ error: 'Search failed' });
  }
});

// ==================== ПОЛУЧЕНИЕ СПИСКА УЧАСТНИКОВ ЧАТА ====================
router.get('/chat/:chatId', async (req, res) => {
  const { chatId } = req.params;

  try {
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
      ORDER BY 
        CASE 
          WHEN cm.role = 'owner' THEN 1
          WHEN cm.role = 'admin' THEN 2
          WHEN cm.role = 'moderator' THEN 3
          ELSE 4
        END,
        cm.joined_at ASC
    `, [chatId]);

    const membersWithStatus = await Promise.all(members.rows.map(async (member) => {
      const devices = await redis.sMembers(`user:${member.id}:devices`);
      let online = false;
      for (const dev of devices) {
        if (await redis.exists(`online:${member.id}:${dev}`)) {
          online = true;
          break;
        }
      }
      return { ...member, online };
    }));

    res.json(membersWithStatus);
  } catch (err) {
    logger.error('Error fetching chat members:', err);
    res.status(500).json({ error: 'Failed to fetch members' });
  }
});

// ==================== ПОЛУЧЕНИЕ СТАТУСА ПОЛЬЗОВАТЕЛЯ (ОНЛАЙН) ====================
router.get('/:userId/status', async (req, res) => {
  const { userId } = req.params;

  try {
    const devices = await redis.sMembers(`user:${userId}:devices`);
    let online = false;
    for (const dev of devices) {
      if (await redis.exists(`online:${userId}:${dev}`)) {
        online = true;
        break;
      }
    }

    if (online) {
      res.json({ status: 'online' });
    } else {
      const user = await query('SELECT last_seen FROM users WHERE id = $1', [userId]);
      res.json({ 
        status: 'offline',
        last_seen: user.rows[0]?.last_seen
      });
    }
  } catch (err) {
    logger.error('Error fetching user status:', err);
    res.status(500).json({ error: 'Failed to fetch status' });
  }
});

module.exports = router;
