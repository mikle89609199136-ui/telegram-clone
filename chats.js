const express = require('express');
const router = express.Router();
const { query, transaction } = require('./data');
const { generateId } = require('./utils');
const logger = require('./logger');
const { ROLES, checkPermission, PERMISSIONS } = require('./security');

// ==================== ПОЛУЧЕНИЕ ВСЕХ ЧАТОВ ПОЛЬЗОВАТЕЛЯ ====================
router.get('/', async (req, res) => {
  try {
    const result = await query(`
      SELECT c.*,
        (SELECT json_agg(json_build_object('id', u.id, 'username', u.username, 'avatar', u.avatar, 'role', cm.role))
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

    // Добавляем информацию о непрочитанных сообщениях и форматируем
    const chatsWithInfo = await Promise.all(result.rows.map(async (chat) => {
      // Получаем онлайн-статус участников (для личных чатов)
      let onlineStatus = null;
      if (chat.type === 'private' && chat.participants) {
        const otherParticipant = chat.participants.find(p => p.id !== req.user.id);
        if (otherParticipant) {
          const devices = await require('./database').redis.sMembers(`user:${otherParticipant.id}:devices`);
          let online = false;
          for (const dev of devices) {
            if (await require('./database').redis.exists(`online:${otherParticipant.id}:${dev}`)) {
              online = true;
              break;
            }
          }
          onlineStatus = online ? 'online' : 'offline';
        }
      }

      return {
        ...chat,
        onlineStatus,
        last_message: chat.last_message ? {
          ...chat.last_message,
          formattedTime: require('./utils').formatRelativeTime(chat.last_message.created_at)
        } : null
      };
    }));

    res.json(chatsWithInfo);
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

  if (type === 'private' && (!memberIds || memberIds.length !== 1)) {
    return res.status(400).json({ error: 'Private chat requires exactly one other member' });
  }

  if (type === 'group' && (!name || name.length < 3)) {
    return res.status(400).json({ error: 'Group name must be at least 3 characters' });
  }

  const client = await query.pool.connect();
  try {
    await client.query('BEGIN');

    const chatId = generateId();
    
    // Для личного чата проверяем, не существует ли уже такой чат
    if (type === 'private') {
      const existingChat = await client.query(`
        SELECT c.id FROM chats c
        JOIN chat_members cm1 ON cm1.chat_id = c.id
        JOIN chat_members cm2 ON cm2.chat_id = c.id
        WHERE c.type = 'private' 
          AND cm1.user_id = $1 
          AND cm2.user_id = $2
      `, [req.user.id, memberIds[0]]);
      
      if (existingChat.rows.length > 0) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'Private chat already exists', chatId: existingChat.rows[0].id });
      }
    }

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
      // Добавляем второго участника
      await client.query(`
        INSERT INTO chat_members (chat_id, user_id, role, joined_at)
        VALUES ($1, $2, $3, NOW())
      `, [chatId, memberIds[0], ROLES.MEMBER]);
    } else if (type === 'group') {
      // Добавляем переданных участников (если есть)
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
    
    // Получаем созданный чат для ответа
    const newChat = await query(`
      SELECT c.*,
        (SELECT json_agg(json_build_object('id', u.id, 'username', u.username, 'avatar', u.avatar, 'role', cm.role))
         FROM chat_members cm
         JOIN users u ON u.id = cm.user_id
         WHERE cm.chat_id = c.id) as participants
      FROM chats c
      WHERE c.id = $1
    `, [chatId]);

    res.status(201).json(newChat.rows[0]);
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
      SELECT u.id, u.username, u.avatar, cm.role, cm.joined_at,
        (SELECT COUNT(*) > 0 FROM devices d 
         WHERE d.user_id = u.id 
           AND EXISTS (SELECT 1 FROM redis WHERE key = 'online:' || u.id || ':' || d.id)) as online
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
    // Проверка, что чат существует и это группа
    const chatType = await query('SELECT type FROM chats WHERE id = $1', [chatId]);
    if (chatType.rows.length === 0) {
      return res.status(404).json({ error: 'Chat not found' });
    }
    if (chatType.rows[0].type !== 'group') {
      return res.status(400).json({ error: 'Can only add members to groups' });
    }

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

    // Уведомление через WebSocket
    const io = req.app.get('io');
    if (io) {
      io.to(`chat:${chatId}`).emit('memberAdded', { chatId, userId, addedBy: req.user.id });
    }

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

    // Получаем роль удаляемого
    const targetRoleRes = await query(
      'SELECT role FROM chat_members WHERE chat_id = $1 AND user_id = $2',
      [chatId, userId]
    );
    const targetRole = targetRoleRes.rows[0]?.role;

    // Проверки
    if (!targetRole) {
      return res.status(404).json({ error: 'User not in chat' });
    }
    if (targetRole === 'owner') {
      return res.status(403).json({ error: 'Cannot kick the owner' });
    }
    if (targetRole === 'admin' && actorRole !== 'owner') {
      return res.status(403).json({ error: 'Only owner can kick admins' });
    }

    await query('DELETE FROM chat_members WHERE chat_id = $1 AND user_id = $2', [chatId, userId]);

    // Уведомление через WebSocket
    const io = req.app.get('io');
    if (io) {
      io.to(`chat:${chatId}`).emit('memberRemoved', { chatId, userId, removedBy: req.user.id });
    }

    res.json({ success: true });
  } catch (err) {
    logger.error('Error removing member:', err);
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

    // Уведомление через WebSocket
    const io = req.app.get('io');
    if (io) {
      io.to(`chat:${chatId}`).emit('userPromoted', { chatId, userId, newRole: ROLES.ADMIN, promotedBy: req.user.id });
    }

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
    // Только владелец может понижать
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

    // Уведомление через WebSocket
    const io = req.app.get('io');
    if (io) {
      io.to(`chat:${chatId}`).emit('userDemoted', { chatId, userId, newRole: ROLES.MEMBER, demotedBy: req.user.id });
    }

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
      // Проверяем, есть ли другие админы для передачи прав
      const otherAdmins = await query(
        'SELECT user_id FROM chat_members WHERE chat_id = $1 AND role = $2 AND user_id != $3',
        [chatId, ROLES.ADMIN, req.user.id]
      );
      
      if (otherAdmins.rows.length > 0) {
        // Передаём права первому админу
        await query(
          'UPDATE chat_members SET role = $1 WHERE chat_id = $2 AND user_id = $3',
          [ROLES.OWNER, chatId, otherAdmins.rows[0].user_id]
        );
      } else {
        // Если нет админов, удаляем чат
        await query('DELETE FROM chats WHERE id = $1', [chatId]);
        res.json({ success: true, chatDeleted: true });
        return;
      }
    }

    await query('DELETE FROM chat_members WHERE chat_id = $1 AND user_id = $2', [chatId, req.user.id]);

    // Уведомление через WebSocket
    const io = req.app.get('io');
    if (io) {
      io.to(`chat:${chatId}`).emit('memberLeft', { chatId, userId: req.user.id });
    }

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

    // Добавляем отформатированное время
    const pinnedWithTime = pinned.rows.map(msg => ({
      ...msg,
      formattedTime: require('./utils').formatRelativeTime(msg.created_at)
    }));

    res.json(pinnedWithTime);
  } catch (err) {
    logger.error('Error fetching pinned messages:', err);
    res.status(500).json({ error: 'Failed to fetch pinned messages' });
  }
});

// ==================== ОБНОВЛЕНИЕ ИНФОРМАЦИИ О ЧАТЕ (только для групп/каналов) ====================
router.put('/:chatId', async (req, res) => {
  const { chatId } = req.params;
  const { name, description, avatar } = req.body;

  try {
    // Проверка прав на редактирование
    const hasEditPermission = await checkPermission(req.user.id, chatId, PERMISSIONS.EDIT_INFO);
    if (!hasEditPermission) {
      return res.status(403).json({ error: 'No permission to edit chat info' });
    }

    const updates = [];
    const params = [];
    let idx = 1;

    if (name) {
      updates.push(`name = $${idx++}`);
      params.push(name);
    }
    if (description !== undefined) {
      updates.push(`description = $${idx++}`);
      params.push(description);
    }
    if (avatar !== undefined) {
      updates.push(`avatar = $${idx++}`);
      params.push(avatar);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    params.push(chatId);
    await query(`UPDATE chats SET ${updates.join(', ')} WHERE id = $${idx}`, params);

    // Уведомление через WebSocket
    const io = req.app.get('io');
    if (io) {
      io.to(`chat:${chatId}`).emit('chatUpdated', { chatId, updates: req.body });
    }

    res.json({ success: true });
  } catch (err) {
    logger.error('Error updating chat:', err);
    res.status(500).json({ error: 'Failed to update chat' });
  }
});

module.exports = router;
