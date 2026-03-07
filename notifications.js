// notifications.js – работа с уведомлениями (in-app и push)

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
 * @param {string} type - тип уведомления ('message', 'call', 'mention', 'invite')
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
    await query(
      `INSERT INTO push_subscriptions (user_id, subscription) 
       VALUES ($1, $2) 
       ON CONFLICT (user_id) DO UPDATE SET subscription = $2`,
      [userId, JSON.stringify(subscription)]
    );
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
    await webpush.sendNotification(subscription, JSON.stringify({ title, body, url }));
  } catch (err) {
    logger.error('Push send error:', err);
    // Если подписка истекла или недействительна, удаляем её
    if (err.statusCode === 410) {
      await query('DELETE FROM push_subscriptions WHERE user_id = $1', [userId]);
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

// Экспортируем функции для использования в других модулях
module.exports = { router, addInAppNotification, sendPushNotification };