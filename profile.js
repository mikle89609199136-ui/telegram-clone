const express = require('express');
const { query } = require('./database');
const logger = require('./logger');
const router = express.Router();

router.get('/:id?', async (req, res) => {
  const profileId = req.params.id ? parseInt(req.params.id) : req.userId;
  if (isNaN(profileId)) return res.status(400).json({ error: 'Invalid user ID' });

  try {
    const result = await query(
      `SELECT u.id, u.uid, u.username, u.avatar, u.bio, u.verified, u.online, u.last_seen,
        (SELECT privacy_last_seen FROM user_settings WHERE user_id = u.id) as privacy_last_seen,
        (SELECT privacy_profile_photo FROM user_settings WHERE user_id = u.id) as privacy_profile_photo,
        (SELECT count(*) FROM contacts WHERE user_id = $2 AND contact_id = u.id) as is_contact
       FROM users u WHERE u.id = $1`,
      [profileId, req.userId]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'User not found' });

    const profile = result.rows[0];
    if (profile.privacy_last_seen === 'nobody' || (profile.privacy_last_seen === 'contacts' && !profile.is_contact)) {
      profile.last_seen = null;
    }
    if (profile.privacy_profile_photo === 'nobody' || (profile.privacy_profile_photo === 'contacts' && !profile.is_contact)) {
      profile.avatar = null;
    }
    delete profile.privacy_last_seen;
    delete profile.privacy_profile_photo;
    delete profile.is_contact;

    res.json(profile);
  } catch (err) {
    logger.error('Get profile error', err);
    res.status(500).json({ error: 'Database error' });
  }
});

router.put('/', async (req, res) => {
  const userId = req.userId;
  const { username, bio, avatar } = req.body;
  const updates = [];
  const params = [];
  let idx = 1;
  if (username) {
    if (!/^[a-zA-Z0-9_]{3,30}$/.test(username)) return res.status(400).json({ error: 'Invalid username' });
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
  params.push(userId);
  try {
    const result = await query(
      `UPDATE users SET ${updates.join(', ')}, updated_at = NOW() WHERE id = $${idx} RETURNING id, username, avatar, bio`,
      params
    );
    res.json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Username taken' });
    logger.error('Update profile error', err);
    res.status(500).json({ error: 'Database error' });
  }
});

module.exports = router;
