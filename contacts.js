const express = require('express');
const { query } = require('./database');
const logger = require('./logger');
const router = express.Router();

router.get('/', async (req, res) => {
  const userId = req.userId;
  try {
    const result = await query(
      `SELECT u.id, u.uid, u.username, u.avatar, u.bio, u.online, u.last_seen
       FROM contacts c JOIN users u ON c.contact_id = u.id
       WHERE c.user_id = $1
       ORDER BY u.username`,
      [userId]
    );
    res.json(result.rows);
  } catch (err) {
    logger.error('Get contacts error', err);
    res.status(500).json({ error: 'Database error' });
  }
});

router.post('/add', async (req, res) => {
  const userId = req.userId;
  const { contactId } = req.body;
  if (!contactId) return res.status(400).json({ error: 'contactId required' });
  if (userId === contactId) return res.status(400).json({ error: 'Cannot add yourself' });

  try {
    await query(
      'INSERT INTO contacts (user_id, contact_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [userId, contactId]
    );
    res.json({ success: true });
  } catch (err) {
    logger.error('Add contact error', err);
    res.status(500).json({ error: 'Database error' });
  }
});

router.delete('/:contactId', async (req, res) => {
  const userId = req.userId;
  const contactId = parseInt(req.params.contactId);
  if (isNaN(contactId)) return res.status(400).json({ error: 'Invalid contact ID' });

  try {
    await query('DELETE FROM contacts WHERE user_id = $1 AND contact_id = $2', [userId, contactId]);
    res.json({ success: true });
  } catch (err) {
    logger.error('Remove contact error', err);
    res.status(500).json({ error: 'Database error' });
  }
});

router.post('/block', async (req, res) => {
  const userId = req.userId;
  const { blockedId } = req.body;
  if (!blockedId) return res.status(400).json({ error: 'blockedId required' });
  if (userId === blockedId) return res.status(400).json({ error: 'Cannot block yourself' });

  try {
    await query(
      'INSERT INTO blocked_users (user_id, blocked_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [userId, blockedId]
    );
    await query('DELETE FROM contacts WHERE user_id = $1 AND contact_id = $2', [userId, blockedId]);
    res.json({ success: true });
  } catch (err) {
    logger.error('Block user error', err);
    res.status(500).json({ error: 'Database error' });
  }
});

router.delete('/unblock/:blockedId', async (req, res) => {
  const userId = req.userId;
  const blockedId = parseInt(req.params.blockedId);
  if (isNaN(blockedId)) return res.status(400).json({ error: 'Invalid blocked ID' });

  try {
    await query('DELETE FROM blocked_users WHERE user_id = $1 AND blocked_id = $2', [userId, blockedId]);
    res.json({ success: true });
  } catch (err) {
    logger.error('Unblock user error', err);
    res.status(500).json({ error: 'Database error' });
  }
});

module.exports = router;
