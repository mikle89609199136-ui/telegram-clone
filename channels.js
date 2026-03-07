const express = require('express');
const router = express.Router();
const { query, transaction } = require('./data');
const { generateId, sanitize } = require('./utils');
const logger = require('./logger');
const { ROLES, checkPermission, PERMISSIONS } = require('./security');

// ==================== СОЗДАНИЕ КАНАЛА ====================
router.post('/', async (req, res) => {
  const { name, description, isPublic = true, username } = req.body;
  
  if (!name || name.trim().length < 3) {
    return res.status(400).json({ error: 'Channel name must be at least 3 characters' });
  }

  const chatId = generateId();
  const channelUsername = username || `channel_${chatId.substring(0, 8)}`;

  try {
    // Проверяем уникальность username (если задан)
    if (username) {
      const existing = await query('SELECT id FROM chats WHERE name = $1 AND type = $2', [username, 'channel']);
      if (existing.rows.length > 0) {
        return res.status(409).json({ error: 'Channel username already taken' });
      }
    }

    await transaction(async (client) => {
      // Создаём запись в chats
      await client.query(`
        INSERT INTO chats (id, type, name, description, owner_id, is_public, created_at)
        VALUES ($1, 'channel', $2, $3, $4, $5, NOW())
      `, [chatId, name, description, req.user.id, isPublic]);

      // Добавляем создателя как владельца
      await client.query(`
        INSERT INTO chat_members (chat_id, user_id, role, joined_at)
        VALUES ($1, $2, $3, NOW())
      `, [chatId, req.user.id, ROLES.OWNER]);

      // Если задан username, обновляем (можно хранить в отдельном поле или использовать name)
      if (username) {
        await client.query('UPDATE chats SET name = $1 WHERE id = $2', [username, chatId]);
      }
    });

    logger.info(`Channel created: ${name} (${chatId}) by user ${req.user.id}`);
    res.status(201).json({ 
      id: chatId, 
      name, 
      description, 
      isPublic, 
      username: username || null,
      subscribers: 1,
      postsCount: 0
    });
  } catch (err) {
    logger.error('Error creating channel:', err);
    res.status(500).json({ error: 'Failed to create channel' });
  }
});

// ==================== ПОЛУЧЕНИЕ СПИСКА КАНАЛОВ, НА КОТОРЫЕ ПОДПИСАН ПОЛЬЗОВАТЕЛЬ ====================
router.get('/my', async (req, res) => {
  try {
    const channels = await query(`
      SELECT c.*,
        (SELECT COUNT(*) FROM chat_members WHERE chat_id = c.id) as subscribers_count,
        (SELECT row_to_json(m) FROM messages m WHERE m.chat_id = c.id ORDER BY m.created_at DESC LIMIT 1) as last_post,
        (SELECT COUNT(*) FROM messages WHERE chat_id = c.id) as posts_count
      FROM chats c
      JOIN chat_members cm ON cm.chat_id = c.id
      WHERE cm.user_id = $1 AND c.type = 'channel'
      ORDER BY cm.joined_at DESC
    `, [req.user.id]);

    res.json(channels.rows);
  } catch (err) {
    logger.error('Error fetching my channels:', err);
    res.status(500).json({ error: 'Failed to fetch channels' });
  }
});

// ==================== ПОЛУЧЕНИЕ ПУБЛИЧНЫХ КАНАЛОВ (ДЛЯ ПОИСКА) ====================
router.get('/public', async (req, res) => {
  const { search, limit = 20, offset = 0 } = req.query;
  
  try {
    let sql = `
      SELECT c.*,
        (SELECT COUNT(*) FROM chat_members WHERE chat_id = c.id) as subscribers_count,
        (SELECT COUNT(*) FROM messages WHERE chat_id = c.id) as posts_count
      FROM chats c
      WHERE c.type = 'channel' AND c.is_public = true
    `;
    const params = [];
    
    if (search && search.length > 0) {
      sql += ` AND (c.name ILIKE $${params.length + 1} OR c.description ILIKE $${params.length + 1})`;
      params.push(`%${search}%`);
    }
    
    sql += ` ORDER BY subscribers_count DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(parseInt(limit), parseInt(offset));
    
    const channels = await query(sql, params);
    res.json(channels.rows);
  } catch (err) {
    logger.error('Error fetching public channels:', err);
    res.status(500).json({ error: 'Failed to fetch public channels' });
  }
});

// ==================== ПОЛУЧЕНИЕ ИНФОРМАЦИИ О КАНАЛЕ ====================
router.get('/:channelId', async (req, res) => {
  const { channelId } = req.params;
  
  try {
    const channel = await query('SELECT * FROM chats WHERE id = $1 AND type = $2', [channelId, 'channel']);
    if (channel.rows.length === 0) {
      return res.status(404).json({ error: 'Channel not found' });
    }

    // Проверяем, подписан ли текущий пользователь (для приватных каналов)
    if (!channel.rows[0].is_public) {
      const member = await query('SELECT 1 FROM chat_members WHERE chat_id = $1 AND user_id = $2', [channelId, req.user.id]);
      if (member.rows.length === 0) {
        return res.status(403).json({ error: 'Private channel' });
      }
    }

    const subscribers = await query('SELECT COUNT(*) FROM chat_members WHERE chat_id = $1', [channelId]);
    const posts = await query('SELECT COUNT(*) FROM messages WHERE chat_id = $1', [channelId]);
    
    // Получаем роль текущего пользователя в канале
    const userRoleRes = await query('SELECT role FROM chat_members WHERE chat_id = $1 AND user_id = $2', [channelId, req.user.id]);
    const userRole = userRoleRes.rows[0]?.role || null;

    res.json({
      ...channel.rows[0],
      subscribers_count: parseInt(subscribers.rows[0].count),
      posts_count: parseInt(posts.rows[0].count),
      userRole
    });
  } catch (err) {
    logger.error('Error fetching channel info:', err);
    res.status(500).json({ error: 'Failed to fetch channel info' });
  }
});

// ==================== ПОДПИСАТЬСЯ НА КАНАЛ ====================
router.post('/:channelId/subscribe', async (req, res) => {
  const { channelId } = req.params;

  try {
    const channel = await query('SELECT is_public FROM chats WHERE id = $1 AND type = $2', [channelId, 'channel']);
    if (channel.rows.length === 0) {
      return res.status(404).json({ error: 'Channel not found' });
    }

    if (!channel.rows[0].is_public) {
      return res.status(403).json({ error: 'Private channel, invite required' });
    }

    await query(`
      INSERT INTO chat_members (chat_id, user_id, role, joined_at)
      VALUES ($1, $2, $3, NOW())
    `, [channelId, req.user.id, ROLES.MEMBER]);

    logger.info(`User ${req.user.id} subscribed to channel ${channelId}`);
    
    // Получаем обновлённое количество подписчиков
    const subscribers = await query('SELECT COUNT(*) FROM chat_members WHERE chat_id = $1', [channelId]);
    
    res.json({ 
      success: true, 
      subscribers_count: parseInt(subscribers.rows[0].count)
    });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Already subscribed' });
    }
    logger.error('Error subscribing to channel:', err);
    res.status(500).json({ error: 'Failed to subscribe' });
  }
});

// ==================== ОТПИСАТЬСЯ ОТ КАНАЛА ====================
router.post('/:channelId/unsubscribe', async (req, res) => {
  const { channelId } = req.params;

  try {
    // Проверяем, не является ли пользователь владельцем (владелец не может отписаться, только удалить канал)
    const roleRes = await query('SELECT role FROM chat_members WHERE chat_id = $1 AND user_id = $2', [channelId, req.user.id]);
    if (roleRes.rows.length === 0) {
      return res.status(404).json({ error: 'Not subscribed' });
    }
    if (roleRes.rows[0].role === ROLES.OWNER) {
      return res.status(403).json({ error: 'Owner cannot unsubscribe. Delete the channel instead.' });
    }

    await query('DELETE FROM chat_members WHERE chat_id = $1 AND user_id = $2', [channelId, req.user.id]);
    logger.info(`User ${req.user.id} unsubscribed from channel ${channelId}`);
    
    // Получаем обновлённое количество подписчиков
    const subscribers = await query('SELECT COUNT(*) FROM chat_members WHERE chat_id = $1', [channelId]);
    
    res.json({ 
      success: true,
      subscribers_count: parseInt(subscribers.rows[0].count)
    });
  } catch (err) {
    logger.error('Error unsubscribing from channel:', err);
    res.status(500).json({ error: 'Failed to unsubscribe' });
  }
});

// ==================== ПОЛУЧЕНИЕ ПОСТОВ КАНАЛА (СООБЩЕНИЙ) ====================
router.get('/:channelId/posts', async (req, res) => {
  const { channelId } = req.params;
  const { limit = 20, before, after } = req.query;

  try {
    // Проверяем доступ (публичный или подписка)
    const channel = await query('SELECT is_public FROM chats WHERE id = $1 AND type = $2', [channelId, 'channel']);
    if (channel.rows.length === 0) {
      return res.status(404).json({ error: 'Channel not found' });
    }
    if (!channel.rows[0].is_public) {
      const member = await query('SELECT 1 FROM chat_members WHERE chat_id = $1 AND user_id = $2', [channelId, req.user.id]);
      if (member.rows.length === 0) {
        return res.status(403).json({ error: 'Private channel' });
      }
    }

    let sql = `
      SELECT m.*, u.username, u.avatar,
        (SELECT COUNT(*) FROM reactions WHERE message_id = m.id) as reactions_count
      FROM messages m
      JOIN users u ON u.id = m.sender_id
      WHERE m.chat_id = $1
    `;
    const params = [channelId];
    let paramIndex = 2;

    if (before) {
      params.push(before);
      sql += ` AND m.created_at < $${paramIndex++}`;
    }
    if (after) {
      params.push(after);
      sql += ` AND m.created_at > $${paramIndex++}`;
    }
    
    sql += ` ORDER BY m.created_at DESC LIMIT $${paramIndex}`;
    params.push(parseInt(limit));

    const posts = await query(sql, params);
    
    // Добавляем информацию о том, лайкнул ли текущий пользователь пост
    const postsWithInfo = await Promise.all(posts.rows.map(async (post) => {
      const userReaction = await query(
        'SELECT emoji FROM reactions WHERE message_id = $1 AND user_id = $2 LIMIT 1',
        [post.id, req.user.id]
      );
      return {
        ...post,
        userReacted: userReaction.rows[0]?.emoji || null,
        formattedTime: require('./utils').formatRelativeTime(post.created_at)
      };
    }));

    res.json(postsWithInfo);
  } catch (err) {
    logger.error('Error fetching channel posts:', err);
    res.status(500).json({ error: 'Failed to fetch posts' });
  }
});

// ==================== СОЗДАНИЕ ПОСТА В КАНАЛЕ ====================
router.post('/:channelId/posts', async (req, res) => {
  const { channelId } = req.params;
  const { content, type = 'text' } = req.body;

  if (!content) {
    return res.status(400).json({ error: 'Content required' });
  }

  try {
    // Проверка прав: нужно быть участником с правом отправки сообщений (админ или владелец)
    const roleRes = await query('SELECT role FROM chat_members WHERE chat_id = $1 AND user_id = $2', [channelId, req.user.id]);
    if (roleRes.rows.length === 0) {
      return res.status(403).json({ error: 'Not a member' });
    }
    const role = roleRes.rows[0].role;
    if (![ROLES.OWNER, ROLES.ADMIN].includes(role)) {
      return res.status(403).json({ error: 'Only admins can post' });
    }

    const messageId = generateId();
    const safeContent = sanitize(content);

    await query(`
      INSERT INTO messages (id, chat_id, sender_id, content, type, created_at)
      VALUES ($1, $2, $3, $4, $5, NOW())
    `, [messageId, channelId, req.user.id, safeContent, type]);

    // Получаем информацию об авторе
    const senderRes = await query('SELECT username, avatar FROM users WHERE id = $1', [req.user.id]);
    const sender = senderRes.rows[0];

    const message = {
      id: messageId,
      chatId: channelId,
      senderId: req.user.id,
      sender: { 
        id: req.user.id, 
        username: sender.username,
        avatar: sender.avatar
      },
      content: safeContent,
      type,
      created_at: new Date().toISOString(),
      formattedTime: require('./utils').formatRelativeTime(new Date()),
      reactions_count: 0,
      userReacted: null
    };

    // Уведомляем подписчиков через WebSocket
    const io = req.app.get('io');
    if (io) {
      io.to(`chat:${channelId}`).emit('newMessage', message);
    }

    res.status(201).json(message);
  } catch (err) {
    logger.error('Error creating post:', err);
    res.status(500).json({ error: 'Failed to create post' });
  }
});

// ==================== СТАТИСТИКА КАНАЛА ====================
router.get('/:channelId/stats', async (req, res) => {
  const { channelId } = req.params;

  try {
    // Проверка доступа (хотя статистику можно сделать публичной)
    const channel = await query('SELECT is_public FROM chats WHERE id = $1 AND type = $2', [channelId, 'channel']);
    if (channel.rows.length === 0) {
      return res.status(404).json({ error: 'Channel not found' });
    }

    const subscribers = await query('SELECT COUNT(*) FROM chat_members WHERE chat_id = $1', [channelId]);
    const posts = await query('SELECT COUNT(*) FROM messages WHERE chat_id = $1', [channelId]);
    const views = await query('SELECT SUM(views) FROM messages WHERE chat_id = $1', [channelId]);
    
    // Получаем статистику по дням за последние 30 дней
    const dailyStats = await query(`
      SELECT 
        DATE(created_at) as date,
        COUNT(*) as posts_count,
        SUM(views) as views_count
      FROM messages
      WHERE chat_id = $1 AND created_at > NOW() - INTERVAL '30 days'
      GROUP BY DATE(created_at)
      ORDER BY date DESC
    `, [channelId]);

    res.json({
      subscribers: parseInt(subscribers.rows[0].count),
      posts: parseInt(posts.rows[0].count),
      views: views.rows[0]?.sum || 0,
      daily: dailyStats.rows
    });
  } catch (err) {
    logger.error('Error fetching channel stats:', err);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

// ==================== РЕДАКТИРОВАНИЕ КАНАЛА (только владелец) ====================
router.put('/:channelId', async (req, res) => {
  const { channelId } = req.params;
  const { name, description, isPublic } = req.body;

  try {
    // Проверка, что пользователь – владелец
    const ownerCheck = await query(
      'SELECT 1 FROM chat_members WHERE chat_id = $1 AND user_id = $2 AND role = $3',
      [channelId, req.user.id, ROLES.OWNER]
    );
    if (ownerCheck.rows.length === 0) {
      return res.status(403).json({ error: 'Only owner can edit channel' });
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
    if (isPublic !== undefined) {
      updates.push(`is_public = $${idx++}`);
      params.push(isPublic);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    params.push(channelId);
    await query(`UPDATE chats SET ${updates.join(', ')} WHERE id = $${idx}`, params);

    // Уведомление подписчиков об изменении
    const io = req.app.get('io');
    if (io) {
      io.to(`chat:${channelId}`).emit('channelUpdated', { channelId, updates: req.body });
    }

    res.json({ success: true });
  } catch (err) {
    logger.error('Error updating channel:', err);
    res.status(500).json({ error: 'Failed to update channel' });
  }
});

// ==================== УДАЛЕНИЕ КАНАЛА (только владелец) ====================
router.delete('/:channelId', async (req, res) => {
  const { channelId } = req.params;

  try {
    const ownerCheck = await query(
      'SELECT 1 FROM chat_members WHERE chat_id = $1 AND user_id = $2 AND role = $3',
      [channelId, req.user.id, ROLES.OWNER]
    );
    if (ownerCheck.rows.length === 0) {
      return res.status(403).json({ error: 'Only owner can delete channel' });
    }

    // Уведомляем подписчиков перед удалением
    const io = req.app.get('io');
    if (io) {
      io.to(`chat:${channelId}`).emit('channelDeleted', { channelId });
    }

    // Удаляем канал (каскадно удалятся сообщения и подписки)
    await query('DELETE FROM chats WHERE id = $1', [channelId]);

    logger.info(`Channel ${channelId} deleted by user ${req.user.id}`);
    res.json({ success: true });
  } catch (err) {
    logger.error('Error deleting channel:', err);
    res.status(500).json({ error: 'Failed to delete channel' });
  }
});

// ==================== НАЗНАЧЕНИЕ АДМИНИСТРАТОРА (только владелец) ====================
router.post('/:channelId/admins', async (req, res) => {
  const { channelId } = req.params;
  const { userId } = req.body;

  try {
    const ownerCheck = await query(
      'SELECT 1 FROM chat_members WHERE chat_id = $1 AND user_id = $2 AND role = $3',
      [channelId, req.user.id, ROLES.OWNER]
    );
    if (ownerCheck.rows.length === 0) {
      return res.status(403).json({ error: 'Only owner can appoint admins' });
    }

    await query(
      'UPDATE chat_members SET role = $1 WHERE chat_id = $2 AND user_id = $3',
      [ROLES.ADMIN, channelId, userId]
    );

    const io = req.app.get('io');
    if (io) {
      io.to(`chat:${channelId}`).emit('adminAppointed', { channelId, userId });
    }

    res.json({ success: true });
  } catch (err) {
    logger.error('Error appointing admin:', err);
    res.status(500).json({ error: 'Failed to appoint admin' });
  }
});

// ==================== УДАЛЕНИЕ АДМИНИСТРАТОРА (только владелец) ====================
router.delete('/:channelId/admins/:userId', async (req, res) => {
  const { channelId, userId } = req.params;

  try {
    const ownerCheck = await query(
      'SELECT 1 FROM chat_members WHERE chat_id = $1 AND user_id = $2 AND role = $3',
      [channelId, req.user.id, ROLES.OWNER]
    );
    if (ownerCheck.rows.length === 0) {
      return res.status(403).json({ error: 'Only owner can remove admins' });
    }

    await query(
      'UPDATE chat_members SET role = $1 WHERE chat_id = $2 AND user_id = $3',
      [ROLES.MEMBER, channelId, userId]
    );

    const io = req.app.get('io');
    if (io) {
      io.to(`chat:${channelId}`).emit('adminRemoved', { channelId, userId });
    }

    res.json({ success: true });
  } catch (err) {
    logger.error('Error removing admin:', err);
    res.status(500).json({ error: 'Failed to remove admin' });
  }
});

module.exports = router;
