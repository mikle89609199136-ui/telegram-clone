const express = require('express');
const router = express.Router();
const { query, transaction } = require('./data');
const { generateId } = require('./utils');
const logger = require('./logger');
const { ROLES } = require('./security');

// ==================== ПОЛУЧЕНИЕ ВСЕХ ЧАТОВ ПОЛЬЗОВАТЕЛЯ ====================
router.get('/', async (req, res) => {
  try {
    const result = await query(`
      SELECT c.*,
        (SELECT json_agg(json_build_object('id', u.id, 'username', u.username, 'avatar', u.avatar))
         FROM chat_members cm
         JOIN users u ON u.id = cm.user_id
         WHERE cm.chat_id = c.id) as participants,
        (SELECT row_to_json(m) FROM messages m WHERE m.chat_id = c.id ORDER BY m.created_at DESC LIMIT 1) as last_message,
        (SELECT COUNT(*) FROM messages WHERE chat_id = c.id AND read = false AND sender_id != $1) as unread_count
      FROM chats c
      JOIN chat_members cm ON cm.chat_id = c.id
      WHERE cm.user_id = $1
      ORDER BY (SELECT created_at FROM messages WHERE chat_id = c.id ORDER BY created_at DESC LIMIT 1) DESC NULLS LAST
    `, [req.user.id]);

    res.json(result.rows);
  } catch (err) {
    logger.error('Error fetching chats:', err);
    res.status(500).json({ error: 'Failed to fetch chats' });
  }
});

// ==================== СОЗДАНИЕ НОВОГО ЧАТА (личный или группа) ====================
router.post('/', async (req, res) => {
  const { type, name, description, memberIds } = req.body; // type: 'private' или 'group'
  if (!['private', 'group'].includes(type)) {
    return res.status(400).json({ error: 'Invalid chat type' });
  }

  const client = await query.pool.connect();
  try {
    await client.query('BEGIN');

    const chatId = generateId();
    await client.query(`
      INSERT INTO chats (id, type, name, description, owner_id, created_at)
      VALUES ($1, $2, $3, $4, $5, NOW())
    `, [chatId, type, name || null, description || null, req.user.id]);

    // Добавляем создателя как OWNER
    await client.query(`
      INSERT INTO chat_members (chat_id, user_id, role, joined_at)
      VALUES ($1, $2, $3, NOW())
    `, [chatId, req.user.id, ROLES.OWNER]);

    if (type === 'private') {
      // Личный чат с одним другим пользователем
      if (!memberIds || memberIds.length !== 1) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Private chat requires exactly one other member' });
      }
      await client.query(`
        INSERT INTO chat_members (chat_id, user_id, role, joined_at)
        VALUES ($1, $2, $3, NOW())
      `, [chatId, memberIds[0], ROLES.MEMBER]);
    } else if (type === 'group') {
      // Группа: добавляем переданных участников (если есть)
      if (memberIds && memberIds.length > 0) {
        for (const uid of memberIds) {
          if (uid !== req.user.id) {
            await client.query(`
              INSERT INTO chat_members (chat_id, user_id, role, joined_at)
              VALUES ($1, $2, $3, NOW())
            `, [chatId, uid, ROLES.MEMBER]);
          }
        }
      }
    }

    await client.query('COMMIT');
    res.status(201).json({ id: chatId, type, name, description });
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error('Error creating chat:', err);
    res.status(500).json({ error: 'Failed to create chat' });
  } finally {
    client.release();
  }
});

// ==================== ПОЛУЧЕНИЕ ИНФОРМАЦИИ О ЧАТЕ ====================
router.get('/:chatId', async (req, res) => {
  const { chatId } = req.params;

  try {
    // Проверяем членство
    const member = await query(
      'SELECT 1 FROM chat_members WHERE chat_id = $1 AND user_id = $2',
      [chatId, req.user.id]
    );
    if (member.rows.length === 0) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const chat = await query('SELECT * FROM chats WHERE id = $1', [chatId]);
    if (chat.rows.length === 0) {
      return res.status(404).json({ error: 'Chat not found' });
    }

    const members = await query(`
      SELECT u.id, u.username, u.avatar, cm.role, cm.joined_at
      FROM chat_members cm
      JOIN users u ON u.id = cm.user_id
      WHERE cm.chat_id = $1
    `, [chatId]);

    res.json({ ...chat.rows[0], members: members.rows });
  } catch (err) {
    logger.error('Error fetching chat info:', err);
    res.status(500).json({ error: 'Failed to fetch chat info' });
  }
});

// ==================== ПОЛУЧЕНИЕ РОЛИ ТЕКУЩЕГО ПОЛЬЗОВАТЕЛЯ В ЧАТЕ ====================
router.get('/:chatId/myrole', async (req, res) => {
  const { chatId } = req.params;

  try {
    const roleRes = await query(
      'SELECT role FROM chat_members WHERE chat_id = $1 AND user_id = $2',
      [chatId, req.user.id]
    );
    if (roleRes.rows.length === 0) {
      return res.status(404).json({ error: 'Not a member' });
    }
    res.json({ role: roleRes.rows[0].role });
  } catch (err) {
    logger.error('Error fetching role:', err);
    res.status(500).json({ error: 'Failed to fetch role' });
  }
});

// ==================== ДОБАВЛЕНИЕ УЧАСТНИКА В ГРУППУ ====================
router.post('/:chatId/members', async (req, res) => {
  const { chatId } = req.params;
  const { userId } = req.body;

  try {
    // Проверка прав (нужна роль admin или owner)
    const actorRoleRes = await query(
      'SELECT role FROM chat_members WHERE chat_id = $1 AND user_id = $2',
      [chatId, req.user.id]
    );
    const actorRole = actorRoleRes.rows[0]?.role;
    if (!['owner', 'admin'].includes(actorRole)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    // Добавляем участника
    await query(
      'INSERT INTO chat_members (chat_id, user_id, role, joined_at) VALUES ($1, $2, $3, NOW())',
      [chatId, userId, ROLES.MEMBER]
    );

    res.json({ success: true });
  } catch (err) {
    if (err.code === '23505') { // unique violation
      return res.status(409).json({ error: 'User already in chat' });
    }
    logger.error('Error adding member:', err);
    res.status(500).json({ error: 'Failed to add member' });
  }
});

// ==================== УДАЛЕНИЕ УЧАСТНИКА (КИК) ====================
router.delete('/:chatId/members/:userId', async (req, res) => {
  const { chatId, userId } = req.params;

  try {
    // Проверка прав
    const actorRoleRes = await query(
      'SELECT role FROM chat_members WHERE chat_id = $1 AND user_id = $2',
      [chatId, req.user.id]
    );
    const actorRole = actorRoleRes.rows[0]?.role;
    if (!['owner', 'admin'].includes(actorRole)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    // Нельзя кикнуть владельца
    const targetRoleRes = await query(
      'SELECT role FROM chat_members WHERE chat_id = $1 AND user_id = $2',
      [chatId, userId]
    );
    const targetRole = targetRoleRes.rows[0]?.role;
    if (targetRole === 'owner') {
      return res.status(403).json({ error: 'Cannot kick the owner' });
    }

    await query('DELETE FROM chat_members WHERE chat_id = $1 AND user_id = $2', [chatId, userId]);
    res.json({ success: true });
  } catch (err) {
    logger.error('Error kicking member:', err);
    res.status(500).json({ error: 'Failed to remove member' });
  }
});

// ==================== ПОВЫШЕНИЕ ДО АДМИНА ====================
router.post('/:chatId/promote', async (req, res) => {
  const { chatId } = req.params;
  const { userId } = req.body;

  try {
    // Только владелец может повышать
    const ownerCheck = await query(
      'SELECT 1 FROM chat_members WHERE chat_id = $1 AND user_id = $2 AND role = $3',
      [chatId, req.user.id, ROLES.OWNER]
    );
    if (ownerCheck.rows.length === 0) {
      return res.status(403).json({ error: 'Only owner can promote' });
    }

    await query(
      'UPDATE chat_members SET role = $1 WHERE chat_id = $2 AND user_id = $3',
      [ROLES.ADMIN, chatId, userId]
    );

    res.json({ success: true });
  } catch (err) {
    logger.error('Error promoting user:', err);
    res.status(500).json({ error: 'Failed to promote user' });
  }
});

// ==================== ПОНИЖЕНИЕ С АДМИНА ====================
router.post('/:chatId/demote', async (req, res) => {
  const { chatId } = req.params;
  const { userId } = req.body;

  try {
    const ownerCheck = await query(
      'SELECT 1 FROM chat_members WHERE chat_id = $1 AND user_id = $2 AND role = $3',
      [chatId, req.user.id, ROLES.OWNER]
    );
    if (ownerCheck.rows.length === 0) {
      return res.status(403).json({ error: 'Only owner can demote' });
    }

    await query(
      'UPDATE chat_members SET role = $1 WHERE chat_id = $2 AND user_id = $3',
      [ROLES.MEMBER, chatId, userId]
    );

    res.json({ success: true });
  } catch (err) {
    logger.error('Error demoting user:', err);
    res.status(500).json({ error: 'Failed to demote user' });
  }
});

// ==================== ВЫХОД ИЗ ГРУППЫ (ПОКИНУТЬ ЧАТ) ====================
router.delete('/:chatId/leave', async (req, res) => {
  const { chatId } = req.params;

  try {
    const roleRes = await query(
      'SELECT role FROM chat_members WHERE chat_id = $1 AND user_id = $2',
      [chatId, req.user.id]
    );
    if (roleRes.rows.length === 0) {
      return res.status(404).json({ error: 'You are not a member' });
    }

    const role = roleRes.rows[0].role;
    if (role === 'owner') {
      return res.status(403).json({ error: 'Owner cannot leave. Transfer ownership first.' });
    }

    await query('DELETE FROM chat_members WHERE chat_id = $1 AND user_id = $2', [chatId, req.user.id]);
    res.json({ success: true });
  } catch (err) {
    logger.error('Error leaving chat:', err);
    res.status(500).json({ error: 'Failed to leave chat' });
  }
});

// ==================== ПОЛУЧЕНИЕ ЗАКРЕПЛЁННЫХ СООБЩЕНИЙ В ЧАТЕ ====================
router.get('/:chatId/pinned', async (req, res) => {
  const { chatId } = req.params;

  try {
    // Проверка доступа
    const member = await query(
      'SELECT 1 FROM chat_members WHERE chat_id = $1 AND user_id = $2',
      [chatId, req.user.id]
    );
    if (member.rows.length === 0) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const pinned = await query(
      'SELECT * FROM messages WHERE chat_id = $1 AND pinned = true ORDER BY created_at DESC',
      [chatId]
    );
    res.json(pinned.rows);
  } catch (err) {
    logger.error('Error fetching pinned messages:', err);
    res.status(500).json({ error: 'Failed to fetch pinned messages' });
  }
});

module.exports = router;