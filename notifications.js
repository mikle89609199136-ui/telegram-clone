const express = require('express');
const router = express.Router();
const webpush = require('web-push');
const { query } = require('./data');
const { generateId } = require('./utils');
const { redis } = require('./database');
const config = require('./config');
const logger = require('./logger');

// Настройка web-push (VAPID)
webpush.setVapidDetails(
  config.vapid.subject,
  config.vapid.publicKey,
  config.vapid.privateKey
);

// ==================== IN-APP УВЕДОМЛЕНИЯ (хранятся в Redis) ====================

// Ключ для списка уведомлений пользователя в Redis
const getNotificationsKey = (userId) => `notifications:${userId}`;

/**
 * Добавляет in-app уведомление для пользователя
 * @param {string} userId - ID получателя
 * @param {string} type - тип уведомления ('message', 'call', 'mention', 'invite', 'channel_post')
 * @param {Object} payload - данные уведомления
 * @returns {Promise<Object>} созданное уведомление
 */
async function addInAppNotification(userId, type, payload) {
  const notif = {
    id: generateId(),
    type,
    payload,
    createdAt: new Date().toISOString(),
    read: false
  };
  await redis.lPush(getNotificationsKey(userId), JSON.stringify(notif));
  // Ограничиваем длину списка (храним последние 100)
  await redis.lTrim(getNotificationsKey(userId), 0, 99);
  
  // Отправляем через WebSocket, если пользователь онлайн
  const io = require('./server').app?.get('io');
  if (io) {
    const devices = await redis.sMembers(`user:${userId}:devices`);
    let online = false;
    for (const dev of devices) {
      if (await redis.exists(`online:${userId}:${dev}`)) {
        online = true;
        break;
      }
    }
    if (online) {
      io.to(`user:${userId}`).emit('newNotification', notif);
    }
  }
  
  return notif;
}

// Получить уведомления пользователя
router.get('/', async (req, res) => {
  try {
    const notifications = await redis.lRange(getNotificationsKey(req.user.id), 0, 49);
    res.json(notifications.map(n => JSON.parse(n)));
  } catch (err) {
    logger.error('Error fetching notifications:', err);
    res.status(500).json({ error: 'Failed to fetch notifications' });
  }
});

// Получить количество непрочитанных уведомлений
router.get('/unread/count', async (req, res) => {
  try {
    const notifications = await redis.lRange(getNotificationsKey(req.user.id), 0, -1);
    const unread = notifications.filter(n => !JSON.parse(n).read).length;
    res.json({ count: unread });
  } catch (err) {
    logger.error('Error counting unread notifications:', err);
    res.status(500).json({ error: 'Failed to count notifications' });
  }
});

// Отметить уведомление как прочитанное (удалить)
router.post('/:id/read', async (req, res) => {
  const { id } = req.params;
  try {
    const list = await redis.lRange(getNotificationsKey(req.user.id), 0, -1);
    for (let item of list) {
      const notif = JSON.parse(item);
      if (notif.id === id) {
        await redis.lRem(getNotificationsKey(req.user.id), 1, item);
        break;
      }
    }
    res.json({ success: true });
  } catch (err) {
    logger.error('Error marking notification as read:', err);
    res.status(500).json({ error: 'Failed to mark notification as read' });
  }
});

// Отметить все уведомления как прочитанные (очистить)
router.post('/read-all', async (req, res) => {
  try {
    await redis.del(getNotificationsKey(req.user.id));
    res.json({ success: true });
  } catch (err) {
    logger.error('Error clearing notifications:', err);
    res.status(500).json({ error: 'Failed to clear notifications' });
  }
});

// ==================== PUSH УВЕДОМЛЕНИЯ (Web Push) ====================

// Сохранить подписку клиента на push-уведомления
router.post('/subscribe', async (req, res) => {
  const subscription = req.body;
  const userId = req.user.id;
  
  try {
    // Проверяем валидность подписки
    if (!subscription || !subscription.endpoint) {
      return res.status(400).json({ error: 'Invalid subscription' });
    }

    await query(
      `INSERT INTO push_subscriptions (user_id, subscription) 
       VALUES ($1, $2) 
       ON CONFLICT (user_id) DO UPDATE SET subscription = $2, updated_at = NOW()`,
      [userId, JSON.stringify(subscription)]
    );
    
    logger.info(`User ${userId} subscribed to push notifications`);
    res.status(201).json({ success: true });
  } catch (err) {
    logger.error('Push subscription error:', err);
    res.status(500).json({ error: 'Failed to subscribe' });
  }
});

// Удалить подписку (при выходе или отключении)
router.delete('/unsubscribe', async (req, res) => {
  try {
    await query('DELETE FROM push_subscriptions WHERE user_id = $1', [req.user.id]);
    logger.info(`User ${req.user.id} unsubscribed from push notifications`);
    res.json({ success: true });
  } catch (err) {
    logger.error('Push unsubscription error:', err);
    res.status(500).json({ error: 'Failed to unsubscribe' });
  }
});

/**
 * Отправляет push-уведомление пользователю
 * @param {string} userId - ID получателя
 * @param {string} title - заголовок
 * @param {string} body - текст
 * @param {string} url - URL для перехода при клике
 * @returns {Promise<void>}
 */
async function sendPushNotification(userId, title, body, url) {
  try {
    const res = await query('SELECT subscription FROM push_subscriptions WHERE user_id = $1', [userId]);
    if (res.rows.length === 0) return;
    
    const subscription = JSON.parse(res.rows[0].subscription);
    
    const payload = JSON.stringify({
      title,
      body,
      url,
      timestamp: Date.now()
    });

    await webpush.sendNotification(subscription, payload);
  } catch (err) {
    logger.error('Push send error:', err);
    // Если подписка истекла или недействительна, удаляем её
    if (err.statusCode === 410 || err.statusCode === 404) {
      await query('DELETE FROM push_subscriptions WHERE user_id = $1', [userId]);
      logger.info(`Removed invalid push subscription for user ${userId}`);
    }
  }
}

// ==================== ЭНДПОИНТ ДЛЯ ТЕСТОВОЙ ОТПРАВКИ (не обязательный) ====================
router.post('/test', async (req, res) => {
  const { userId, title, body } = req.body;
  
  if (!userId || !title || !body) {
    return res.status(400).json({ error: 'userId, title, body required' });
  }

  try {
    await sendPushNotification(userId, title, body, '/');
    res.json({ success: true });
  } catch (err) {
    logger.error('Test push error:', err);
    res.status(500).json({ error: 'Failed to send test push' });
  }
});

// ==================== ПОЛУЧИТЬ СТАТУС PUSH-УВЕДОМЛЕНИЙ ====================
router.get('/status', async (req, res) => {
  try {
    const sub = await query('SELECT 1 FROM push_subscriptions WHERE user_id = $1', [req.user.id]);
    res.json({ enabled: sub.rows.length > 0 });
  } catch (err) {
    logger.error('Error checking push status:', err);
    res.status(500).json({ error: 'Failed to check push status' });
  }
});

// Экспортируем функции для использования в других модулях
module.exports = { router, addInAppNotification, sendPushNotification };
