const express = require('express');
const { query } = require('./database');
const logger = require('./logger');
const router = express.Router();

router.get('/me', async (req, res) => {
  try {
    const result = await query(
      'SELECT id, uid, username, email, avatar, bio, verified, online, last_seen, created_at FROM users WHERE id = $1',
      [req.userId]
    );
    res.json(result.rows[0]);
  } catch (err) {
    logger.error('Get me error', err);
    res.status(500).json({ error: 'Database error' });
  }
});

router.get('/:id', async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: 'Invalid user ID' });

  try {
    const result = await query(
      `SELECT u.id, u.uid, u.username, u.avatar, u.bio, u.verified, u.online, u.last_seen,
        (SELECT privacy_last_seen FROM user_settings WHERE user_id = u.id) as privacy_last_seen
       FROM users u WHERE u.id = $1`,
      [id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'User not found' });

    const user = result.rows[0];
    if (user.privacy_last_seen === 'nobody') {
      user.last_seen = null;
    } else if (user.privacy_last_seen === 'contacts') {
      const contactCheck = await query(
        'SELECT 1 FROM contacts WHERE user_id = $1 AND contact_id = $2',
        [req.userId, id]
      );
      if (!contactCheck.rows.length) {
        user.last_seen = null;
      }
    }
    delete user.privacy_last_seen;
    res.json(user);
  } catch (err) {
    logger.error('Get user error', err);
    res.status(500).json({ error: 'Database error' });
  }
});

router.put('/me', async (req, res) => {
  const { username, bio, avatar } = req.body;
  const updates = [];
  const params = [];
  let idx = 1;

  if (username) {
    if (!/^[a-zA-Z0-9_]{3,30}$/.test(username)) {
      return res.status(400).json({ error: 'Invalid username' });
    }
    updates.push(`username = $${idx++}`);
    params.push(username);
  }
  if (bio !== undefined) {
    updates.push(`bio = $${idx++}`);
    params.push(bio);
  }
  if (avatar !== undefined) {
    updates.push(`avatar = $${idx++}`);
    params.push(avatar);
  }

  if (!updates.length) return res.status(400).json({ error: 'No fields to update' });

  params.push(req.userId);
  try {
    const result = await query(
      `UPDATE users SET ${updates.join(', ')}, updated_at = NOW() WHERE id = $${idx} RETURNING id, username, avatar, bio`,
      params
    );
    res.json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Username already taken' });
    }
    logger.error('Update user error', err);
    res.status(500).json({ error: 'Database error' });
  }
});

async function setOnline(userId) {
  await query('UPDATE users SET online = true, last_seen = NOW() WHERE id = $1', [userId]);
}

async function setOffline(userId) {
  await query('UPDATE users SET online = false, last_seen = NOW() WHERE id = $1', [userId]);
}

module.exports = router;
module.exports.setOnline = setOnline;
module.exports.setOffline = setOffline;
