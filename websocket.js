const jwt = require('jsonwebtoken');
const { redis } = require('./database');
const { query } = require('./data');
const logger = require('./logger');
const config = require('./config');
const { sendPushNotification } = require('./notifications');
const { generateId, sanitize } = require('./utils');
const { checkPermission, PERMISSIONS } = require('./security');

/**
 * Инициализирует Socket.IO сервер
 * @param {http.Server} server - HTTP сервер
 * @returns {SocketIO.Server} экземпляр io
 */
module.exports = (server) => {
  const { Server } = require('socket.io');
  const io = new Server(server, {
    cors: {
      origin: config.clientUrl,
      credentials: true
    },
    pingTimeout: 60000,
    pingInterval: 25000,
    transports: ['websocket', 'polling']
  });

  // ==================== АУТЕНТИФИКАЦИЯ ====================
  io.use(async (socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) {
      return next(new Error('Authentication error: no token'));
    }

    try {
      const decoded = jwt.verify(token, config.jwt.secret);
      // Проверяем сессию в Redis
      const sessionKey = `session:${decoded.id}:${decoded.deviceId}`;
      const sessionValid = await redis.get(sessionKey);
      if (!sessionValid) {
        return next(new Error('Session expired'));
      }
      socket.user = decoded;
      next();
    } catch (err) {
      logger.warn('WebSocket auth error:', err.message);
      next(new Error('Invalid token'));
    }
  });

  // ==================== ПОДКЛЮЧЕНИЕ ====================
  io.on('connection', async (socket) => {
    const { id: userId, username, deviceId } = socket.user;
    logger.info(`🔗 WebSocket connected: user ${username} (device ${deviceId})`);

    // Отмечаем пользователя онлайн в Redis
    const onlineKey = `online:${userId}:${deviceId}`;
    await redis.setEx(onlineKey, 60, '1'); // живёт 60 секунд, обновляется ping'ом
    socket.join(`user:${userId}`); // комната для персональных уведомлений

    // Подписываемся на комнаты чатов, в которых состоит пользователь
    try {
      const chats = await query('SELECT chat_id FROM chat_members WHERE user_id = $1', [userId]);
      chats.rows.forEach(r => {
        socket.join(`chat:${r.chat_id}`);
      });
      logger.debug(`User ${username} joined ${chats.rows.length} chat rooms`);
    } catch (err) {
      logger.error('Failed to subscribe user to chat rooms:', err);
    }

    // ==================== ОТПРАВКА СООБЩЕНИЯ ====================
    socket.on('sendMessage', async ({ chatId, content, type = 'text', replyTo }, callback) => {
      try {
        // Проверка членства в чате
        const member = await query(
          'SELECT 1 FROM chat_members WHERE chat_id = $1 AND user_id = $2',
          [chatId, userId]
        );
        if (member.rows.length === 0) {
          return callback({ error: 'You are not a member of this chat' });
        }

        // Проверка прав на отправку сообщений
        const hasSendPermission = await checkPermission(userId, chatId, PERMISSIONS.SEND_MESSAGE);
        if (!hasSendPermission) {
          return callback({ error: 'You do not have permission to send messages' });
        }

        // Очистка контента от опасного HTML
        const safeContent = sanitize(content);

        // Генерация ID сообщения
        const messageId = generateId();

        // Сохранение в БД
        await query(`
          INSERT INTO messages (id, chat_id, sender_id, content, type, reply_to, created_at)
          VALUES ($1, $2, $3, $4, $5, $6, NOW())
        `, [messageId, chatId, userId, safeContent, type, replyTo]);

        // Получаем информацию об отправителе
        const senderRes = await query('SELECT avatar FROM users WHERE id = $1', [userId]);
        const senderAvatar = senderRes.rows[0]?.avatar;

        // Формируем объект сообщения для отправки
        const message = {
          id: messageId,
          chatId,
          senderId: userId,
          sender: { 
            id: userId, 
            username,
            avatar: senderAvatar
          },
          content: safeContent,
          type,
          replyTo,
          createdAt: new Date().toISOString(),
          read: false,
          edited: false
        };

        // Отправляем всем участникам чата (включая отправителя)
        io.to(`chat:${chatId}`).emit('newMessage', message);

        // Обновляем список чатов у всех (последнее сообщение)
        io.to(`chat:${chatId}`).emit('chatUpdated', { chatId, lastMessage: message });

        // Уведомляем других участников через push (если они не в сети)
        const participants = await query(
          'SELECT user_id FROM chat_members WHERE chat_id = $1 AND user_id != $2',
          [chatId, userId]
        );
        
        for (const p of participants.rows) {
          // Проверяем, есть ли пользователь онлайн (хотя бы одно устройство)
          const devices = await redis.sMembers(`user:${p.user_id}:devices`);
          let online = false;
          for (const dev of devices) {
            if (await redis.exists(`online:${p.user_id}:${dev}`)) {
              online = true;
              break;
            }
          }
          
          if (!online) {
            // Получаем информацию о чате для уведомления
            const chatInfo = await query('SELECT name, type FROM chats WHERE id = $1', [chatId]);
            const chatName = chatInfo.rows[0]?.name || username;
            
            // Отправляем push-уведомление
            await sendPushNotification(
              p.user_id,
              'New message',
              `${username}: ${safeContent.substring(0, 50)}${safeContent.length > 50 ? '...' : ''}`,
              `/chat/${chatId}`
            );
          }
        }

        // Подтверждение успешной отправки (callback)
        if (callback) callback({ success: true, messageId });
      } catch (err) {
        logger.error('sendMessage error:', err);
        if (callback) callback({ error: 'Failed to send message' });
      }
    });

    // ==================== РЕДАКТИРОВАНИЕ СООБЩЕНИЯ ====================
    socket.on('editMessage', async ({ messageId, newContent }, callback) => {
      try {
        // Проверяем, что сообщение принадлежит пользователю
        const msgRes = await query(
          'SELECT chat_id FROM messages WHERE id = $1 AND sender_id = $2',
          [messageId, userId]
        );
        if (msgRes.rows.length === 0) {
          return callback({ error: 'Message not found or not yours' });
        }
        const chatId = msgRes.rows[0].chat_id;
        
        // Проверка прав на редактирование
        const hasEditPermission = await checkPermission(userId, chatId, PERMISSIONS.EDIT_MESSAGE);
        if (!hasEditPermission) {
          return callback({ error: 'You do not have permission to edit messages' });
        }

        const safeContent = sanitize(newContent);

        await query('UPDATE messages SET content = $1, edited = TRUE WHERE id = $2', [safeContent, messageId]);

        io.to(`chat:${chatId}`).emit('messageEdited', { messageId, newContent: safeContent });
        if (callback) callback({ success: true });
      } catch (err) {
        logger.error('editMessage error:', err);
        if (callback) callback({ error: 'Failed to edit message' });
      }
    });

    // ==================== УДАЛЕНИЕ СООБЩЕНИЯ ====================
    socket.on('deleteMessage', async ({ messageId }, callback) => {
      try {
        // Получаем информацию о сообщении
        const msgRes = await query(
          'SELECT chat_id, sender_id FROM messages WHERE id = $1',
          [messageId]
        );
        if (msgRes.rows.length === 0) {
          return callback({ error: 'Message not found' });
        }
        const { chat_id: chatId, sender_id: senderId } = msgRes.rows[0];
        
        // Проверка прав (своё сообщение или есть право удалять чужие)
        let canDelete = false;
        if (senderId === userId) {
          canDelete = true;
        } else {
          canDelete = await checkPermission(userId, chatId, PERMISSIONS.DELETE_MESSAGE);
        }
        
        if (!canDelete) {
          return callback({ error: 'You do not have permission to delete this message' });
        }

        await query('DELETE FROM messages WHERE id = $1', [messageId]);

        io.to(`chat:${chatId}`).emit('messageDeleted', { messageId });
        if (callback) callback({ success: true });
      } catch (err) {
        logger.error('deleteMessage error:', err);
        if (callback) callback({ error: 'Failed to delete message' });
      }
    });

    // ==================== ПЕРЕСЫЛКА СООБЩЕНИЯ ====================
    socket.on('forwardMessage', async ({ messageId, toChatId }, callback) => {
      try {
        // Получаем исходное сообщение
        const msgRes = await query('SELECT content, type FROM messages WHERE id = $1', [messageId]);
        if (msgRes.rows.length === 0) {
          return callback({ error: 'Original message not found' });
        }
        const { content, type } = msgRes.rows[0];

        // Проверяем членство в целевом чате
        const member = await query(
          'SELECT 1 FROM chat_members WHERE chat_id = $1 AND user_id = $2',
          [toChatId, userId]
        );
        if (member.rows.length === 0) {
          return callback({ error: 'You are not a member of target chat' });
        }

        // Проверка прав на отправку в целевом чате
        const hasSendPermission = await checkPermission(userId, toChatId, PERMISSIONS.SEND_MESSAGE);
        if (!hasSendPermission) {
          return callback({ error: 'You do not have permission to send messages to target chat' });
        }

        const newMessageId = generateId();
        await query(`
          INSERT INTO messages (id, chat_id, sender_id, content, type, forwarded, created_at)
          VALUES ($1, $2, $3, $4, $5, true, NOW())
        `, [newMessageId, toChatId, userId, content, type]);

        // Получаем информацию об отправителе
        const senderRes = await query('SELECT avatar FROM users WHERE id = $1', [userId]);
        const senderAvatar = senderRes.rows[0]?.avatar;

        const message = {
          id: newMessageId,
          chatId: toChatId,
          senderId: userId,
          sender: { 
            id: userId, 
            username,
            avatar: senderAvatar
          },
          content,
          type,
          forwarded: true,
          createdAt: new Date().toISOString()
        };

        io.to(`chat:${toChatId}`).emit('newMessage', message);
        io.to(`chat:${toChatId}`).emit('chatUpdated', { chatId: toChatId, lastMessage: message });
        
        if (callback) callback({ success: true, messageId: newMessageId });
      } catch (err) {
        logger.error('forwardMessage error:', err);
        if (callback) callback({ error: 'Failed to forward message' });
      }
    });

    // ==================== ЗАКРЕПЛЕНИЕ СООБЩЕНИЯ ====================
    socket.on('pinMessage', async ({ messageId }, callback) => {
      try {
        const msgRes = await query('SELECT chat_id FROM messages WHERE id = $1', [messageId]);
        if (msgRes.rows.length === 0) {
          return callback({ error: 'Message not found' });
        }
        const chatId = msgRes.rows[0].chat_id;

        // Проверяем права на закрепление
        const hasPinPermission = await checkPermission(userId, chatId, PERMISSIONS.PIN_MESSAGE);
        if (!hasPinPermission) {
          return callback({ error: 'Insufficient permissions to pin messages' });
        }

        // Снимаем закрепление со всех других сообщений в чате (оставляем только одно)
        await query('UPDATE messages SET pinned = false WHERE chat_id = $1', [chatId]);
        await query('UPDATE messages SET pinned = true WHERE id = $1', [messageId]);

        io.to(`chat:${chatId}`).emit('messagePinned', { messageId, pinned: true });
        if (callback) callback({ success: true });
      } catch (err) {
        logger.error('pinMessage error:', err);
        if (callback) callback({ error: 'Failed to pin message' });
      }
    });

    // ==================== ОТКРЕПЛЕНИЕ СООБЩЕНИЯ ====================
    socket.on('unpinMessage', async ({ messageId }, callback) => {
      try {
        const msgRes = await query('SELECT chat_id FROM messages WHERE id = $1', [messageId]);
        if (msgRes.rows.length === 0) {
          return callback({ error: 'Message not found' });
        }
        const chatId = msgRes.rows[0].chat_id;

        // Проверяем права на открепление
        const hasPinPermission = await checkPermission(userId, chatId, PERMISSIONS.PIN_MESSAGE);
        if (!hasPinPermission) {
          return callback({ error: 'Insufficient permissions to unpin messages' });
        }

        await query('UPDATE messages SET pinned = false WHERE id = $1', [messageId]);

        io.to(`chat:${chatId}`).emit('messageUnpinned', { messageId });
        if (callback) callback({ success: true });
      } catch (err) {
        logger.error('unpinMessage error:', err);
        if (callback) callback({ error: 'Failed to unpin message' });
      }
    });

    // ==================== ДОБАВЛЕНИЕ РЕАКЦИИ ====================
    socket.on('addReaction', async ({ messageId, emoji }, callback) => {
      try {
        // Проверяем, существует ли сообщение
        const msgRes = await query('SELECT chat_id FROM messages WHERE id = $1', [messageId]);
        if (msgRes.rows.length === 0) {
          return callback({ error: 'Message not found' });
        }
        const chatId = msgRes.rows[0].chat_id;

        // Проверка прав на реакции
        const hasReactPermission = await checkPermission(userId, chatId, PERMISSIONS.REACT);
        if (!hasReactPermission) {
          return callback({ error: 'You do not have permission to react' });
        }

        // Вставляем реакцию (игнорируем дубликаты)
        await query(`
          INSERT INTO reactions (message_id, user_id, emoji, created_at)
          VALUES ($1, $2, $3, NOW())
          ON CONFLICT (message_id, user_id, emoji) DO NOTHING
        `, [messageId, userId, emoji]);

        // Получаем обновлённый список реакций
        const reactionsRes = await query(`
          SELECT json_agg(json_build_object('emoji', emoji, 'count', count)) as reactions
          FROM (
            SELECT emoji, COUNT(*) as count
            FROM reactions
            WHERE message_id = $1
            GROUP BY emoji
          ) r
        `, [messageId]);
        const reactions = reactionsRes.rows[0]?.reactions || [];

        io.to(`chat:${chatId}`).emit('reactionUpdated', { messageId, reactions });
        if (callback) callback({ success: true, reactions });
      } catch (err) {
        logger.error('addReaction error:', err);
        if (callback) callback({ error: 'Failed to add reaction' });
      }
    });

    // ==================== УДАЛЕНИЕ РЕАКЦИИ ====================
    socket.on('removeReaction', async ({ messageId, emoji }, callback) => {
      try {
        const msgRes = await query('SELECT chat_id FROM messages WHERE id = $1', [messageId]);
        if (msgRes.rows.length === 0) {
          return callback({ error: 'Message not found' });
        }
        const chatId = msgRes.rows[0].chat_id;

        await query(
          'DELETE FROM reactions WHERE message_id = $1 AND user_id = $2 AND emoji = $3',
          [messageId, userId, emoji]
        );

        const reactionsRes = await query(`
          SELECT json_agg(json_build_object('emoji', emoji, 'count', count)) as reactions
          FROM (
            SELECT emoji, COUNT(*) as count
            FROM reactions
            WHERE message_id = $1
            GROUP BY emoji
          ) r
        `, [messageId]);
        const reactions = reactionsRes.rows[0]?.reactions || [];

        io.to(`chat:${chatId}`).emit('reactionUpdated', { messageId, reactions });
        if (callback) callback({ success: true, reactions });
      } catch (err) {
        logger.error('removeReaction error:', err);
        if (callback) callback({ error: 'Failed to remove reaction' });
      }
    });

    // ==================== ИНДИКАТОР ПЕЧАТАНИЯ ====================
    socket.on('typing', ({ chatId, isTyping }) => {
      // Отправляем остальным участникам чата
      socket.to(`chat:${chatId}`).emit('userTyping', {
        userId,
        username,
        isTyping
      });
    });

    // ==================== ПРОЧТЕНИЕ СООБЩЕНИЙ ====================
    socket.on('messagesRead', async ({ chatId, messageIds }, callback) => {
      try {
        // Отмечаем сообщения как прочитанные
        await query(
          'UPDATE messages SET read = TRUE WHERE id = ANY($1::uuid[]) AND chat_id = $2',
          [messageIds, chatId]
        );

        // Уведомляем отправителей, что их сообщения прочитаны
        io.to(`chat:${chatId}`).emit('messagesRead', {
          userId,
          messageIds
        });

        if (callback) callback({ success: true });
      } catch (err) {
        logger.error('messagesRead error:', err);
        if (callback) callback({ error: 'Failed to mark messages as read' });
      }
    });

    // ==================== ВХОДЯЩИЙ ЗВОНОК (WebRTC signaling) ====================
    socket.on('callOffer', ({ chatId, offer, isVideo }) => {
      socket.to(`chat:${chatId}`).emit('callOffer', {
        callId: generateId(),
        offer,
        from: userId,
        username,
        isVideo
      });
    });

    socket.on('callAnswer', ({ chatId, answer }) => {
      socket.to(`chat:${chatId}`).emit('callAnswer', {
        answer,
        from: userId
      });
    });

    socket.on('callIceCandidate', ({ chatId, candidate }) => {
      socket.to(`chat:${chatId}`).emit('callIceCandidate', {
        candidate,
        from: userId
      });
    });

    socket.on('callReject', ({ chatId }) => {
      socket.to(`chat:${chatId}`).emit('callReject', { from: userId });
    });

    socket.on('callEnd', ({ chatId }) => {
      socket.to(`chat:${chatId}`).emit('callEnd', { from: userId });
    });

    // ==================== ПИНГ (обновление онлайн-статуса) ====================
    socket.on('ping', () => {
      redis.setEx(`online:${userId}:${deviceId}`, 60, '1');
      socket.emit('pong', Date.now());
    });

    // ==================== ОТКЛЮЧЕНИЕ ====================
    socket.on('disconnect', async () => {
      logger.info(`❌ WebSocket disconnected: user ${username} (device ${deviceId})`);
      await redis.del(`online:${userId}:${deviceId}`);
      
      // Проверяем, остались ли у пользователя онлайн-устройства
      const devices = await redis.sMembers(`user:${userId}:devices`);
      let anyOnline = false;
      for (const dev of devices) {
        if (await redis.exists(`online:${userId}:${dev}`)) {
          anyOnline = true;
          break;
        }
      }
      
      // Если ни одно устройство не онлайн, обновляем last_seen в БД
      if (!anyOnline) {
        await query('UPDATE users SET last_seen = NOW() WHERE id = $1', [userId]);
      }
    });
  });

  return io;
};
