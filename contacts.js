const express = require('express');
const router = express.Router();
const { query } = require('./data');
const logger = require('./logger');

// ==================== ПОЛУЧЕНИЕ СПИСКА КОНТАКТОВ ====================
router.get('/', async (req, res) => {
  try {
    const contacts = await query(`
      SELECT u.id, u.username, u.avatar, u.status, u.last_seen, c.name as custom_name
      FROM contacts c
      JOIN users u ON u.id = c.contact_id
      WHERE c.user_id = $1
      ORDER BY u.username
    `, [req.user.id]);

    res.json(contacts.rows);
  } catch (err) {
    logger.error('Error fetching contacts:', err);
    res.status(500).json({ error: 'Failed to fetch contacts' });
  }
});

// ==================== ДОБАВЛЕНИЕ КОНТАКТА ====================
router.post('/', async (req, res) => {
  const { contactId, name } = req.body;
  if (!contactId) {
    return res.status(400).json({ error: 'contactId required' });
  }

  try {
    // Проверяем, что пользователь с таким ID существует
    const user = await query('SELECT id FROM users WHERE id = $1', [contactId]);
    if (user.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Нельзя добавить самого себя
    if (contactId === req.user.id) {
      return res.status(400).json({ error: 'Cannot add yourself as contact' });
    }

    await query(`
      INSERT INTO contacts (user_id, contact_id, name, created_at)
      VALUES ($1, $2, $3, NOW())
      ON CONFLICT (user_id, contact_id) DO NOTHING
    `, [req.user.id, contactId, name || null]);

    res.status(201).json({ success: true });
  } catch (err) {
    logger.error('Error adding contact:', err);
    res.status(500).json({ error: 'Failed to add contact' });
  }
});

// ==================== УДАЛЕНИЕ КОНТАКТА ====================
router.delete('/:contactId', async (req, res) => {
  const { contactId } = req.params;

  try {
    await query('DELETE FROM contacts WHERE user_id = $1 AND contact_id = $2', [req.user.id, contactId]);
    res.json({ success: true });
  } catch (err) {
    logger.error('Error deleting contact:', err);
    res.status(500).json({ error: 'Failed to delete contact' });
  }
});

// ==================== ПОИСК ПОЛЬЗОВАТЕЛЕЙ ДЛЯ ДОБАВЛЕНИЯ В КОНТАКТЫ ====================
router.get('/search/:query', async (req, res) => {
  const { query: searchQuery } = req.params;
  if (searchQuery.length < 2) {
    return res.json([]);
  }

  try {
    // Ищем пользователей, которых ещё нет в контактах, и не самого себя
    const users = await query(`
      SELECT u.id, u.username, u.avatar, u.status
      FROM users u
      WHERE u.username ILIKE $1
        AND u.id != $2
        AND NOT EXISTS (
          SELECT 1 FROM contacts c
          WHERE c.user_id = $2 AND c.contact_id = u.id
        )
      LIMIT 20
    `, [`%${searchQuery}%`, req.user.id]);

    res.json(users.rows);
  } catch (err) {
    logger.error('Error searching users for contacts:', err);
    res.status(500).json({ error: 'Search failed' });
  }
});

// ==================== ПОЛУЧЕНИЕ КОНТАКТА ПО ID ====================
router.get('/:contactId', async (req, res) => {
  const { contactId } = req.params;

  try {
    const contact = await query(`
      SELECT u.id, u.username, u.avatar, u.status, u.last_seen, u.bio, c.name as custom_name
      FROM contacts c
      JOIN users u ON u.id = c.contact_id
      WHERE c.user_id = $1 AND c.contact_id = $2
    `, [req.user.id, contactId]);

    if (contact.rows.length === 0) {
      return res.status(404).json({ error: 'Contact not found' });
    }

    res.json(contact.rows[0]);
  } catch (err) {
    logger.error('Error fetching contact:', err);
    res.status(500).json({ error: 'Failed to fetch contact' });
  }
});

// ==================== ОБНОВЛЕНИЕ ИМЕНИ КОНТАКТА (пользовательское имя) ====================
router.put('/:contactId', async (req, res) => {
  const { contactId } = req.params;
  const { name } = req.body;

  try {
    await query(
      'UPDATE contacts SET name = $1 WHERE user_id = $2 AND contact_id = $3',
      [name || null, req.user.id, contactId]
    );
    res.json({ success: true });
  } catch (err) {
    logger.error('Error updating contact:', err);
    res.status(500).json({ error: 'Failed to update contact' });
  }
});

module.exports = router;