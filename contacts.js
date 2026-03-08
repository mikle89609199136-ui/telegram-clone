// contacts.js — контакты и локальные имена
const express = require('express');
const router = express.Router();
const authenticateToken = require('./authMiddleware');
const { db } = require('./database');
const logger = require('./logger');

// Получить список контактов
router.get('/', authenticateToken, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT u.id, u.username, u.name, u.avatar, u.status, u.last_seen,
              c.local_name
       FROM contacts c
       JOIN users u ON c.contact_id = u.id
       WHERE c.user_id = $1`,
      [req.user.id]
    );
    res.json(result.rows);
  } catch (err) {
    logger.error('Get contacts error:', err);
    res.status(500).json({ error: 'Ошибка получения контактов' });
  }
});

// Добавить контакт
router.post('/', authenticateToken, async (req, res) => {
  try {
    const { contactId, localName } = req.body;
    const userId = req.user.id;

    const user = await db.query('SELECT id FROM users WHERE id = $1', [contactId]);
    if (user.rows.length === 0) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }

    await db.query(
      `INSERT INTO contacts (user_id, contact_id, local_name, created_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (user_id, contact_id) DO UPDATE SET local_name = EXCLUDED.local_name`,
      [userId, contactId, localName]
    );
    res.json({ success: true });
  } catch (err) {
    logger.error('Add contact error:', err);
    res.status(500).json({ error: 'Ошибка добавления контакта' });
  }
});

// Удалить контакт
router.delete('/:contactId', authenticateToken, async (req, res) => {
  try {
    const { contactId } = req.params;
    await db.query(
      'DELETE FROM contacts WHERE user_id = $1 AND contact_id = $2',
      [req.user.id, contactId]
    );
    res.json({ success: true });
  } catch (err) {
    logger.error('Delete contact error:', err);
    res.status(500).json({ error: 'Ошибка удаления контакта' });
  }
});

module.exports = router;
