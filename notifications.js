// notifications.js – управление уведомлениями (push, email)
const express = require('express');
const webpush = require('web-push');
const nodemailer = require('nodemailer');
const router = express.Router();
const authenticateToken = require('./authMiddleware');
const { db } = require('./database');
const config = require('./config');
const logger = require('./logger');

// Настройка web-push, только если заданы VAPID ключи
let webpushEnabled = false;
if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(
    'mailto:' + (config.EMAIL.user || 'example@example.com'),
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
  webpushEnabled = true;
} else {
  logger.warn('VAPID keys not set, push notifications disabled');
}

// Email transporter
let transporter;
if (config.EMAIL.host && config.EMAIL.user && config.EMAIL.pass) {
  transporter = nodemailer.createTransport({
    host: config.EMAIL.host,
    port: config.EMAIL.port,
    secure: config.EMAIL.port === 465,
    auth: {
      user: config.EMAIL.user,
      pass: config.EMAIL.pass,
    },
  });
} else {
  logger.warn('Email configuration not set, email notifications disabled');
}

// ========== ЭНДПОИНТЫ ДЛЯ НАСТРОЕК УВЕДОМЛЕНИЙ ==========
router.get('/settings', authenticateToken, async (req, res) => {
  try {
    const result = await db.query(
      'SELECT notification_settings FROM users WHERE id = $1',
      [req.user.id]
    );
    res.json(result.rows[0]?.notification_settings || {});
  } catch (err) {
    logger.error('Get notification settings error:', err);
    res.status(500).json({ error: 'Failed to get notification settings' });
  }
});

router.put('/settings', authenticateToken, async (req, res) => {
  try {
    const settings = req.body;
    await db.query(
      'UPDATE users SET notification_settings = $1 WHERE id = $2',
      [JSON.stringify(settings), req.user.id]
    );
    res.json({ success: true });
  } catch (err) {
    logger.error('Update notification settings error:', err);
    res.status(500).json({ error: 'Failed to update notification settings' });
  }
});

// ========== PUSH-ПОДПИСКИ ==========
router.post('/subscribe', authenticateToken, async (req, res) => {
  try {
    const subscription = req.body;
    await db.query(
      `INSERT INTO push_subscriptions (user_id, endpoint, keys)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, endpoint) DO UPDATE SET keys = EXCLUDED.keys`,
      [req.user.id, subscription.endpoint, JSON.stringify(subscription.keys)]
    );
    res.json({ success: true });
  } catch (err) {
    logger.error('Push subscribe error:', err);
    res.status(500).json({ error: 'Failed to subscribe' });
  }
});

router.delete('/subscribe/:endpoint', authenticateToken, async (req, res) => {
  try {
    const { endpoint } = req.params;
    await db.query(
      'DELETE FROM push_subscriptions WHERE user_id = $1 AND endpoint = $2',
      [req.user.id, endpoint]
    );
    res.json({ success: true });
  } catch (err) {
    logger.error('Push unsubscribe error:', err);
    res.status(500).json({ error: 'Failed to unsubscribe' });
  }
});

// Функция для отправки push-уведомления конкретному пользователю (используется в websocket)
async function sendPushNotification(userId, title, body, data = {}) {
  if (!webpushEnabled) return;

  try {
    const subs = await db.query(
      'SELECT endpoint, keys FROM push_subscriptions WHERE user_id = $1',
      [userId]
    );
    const payload = JSON.stringify({ title, body, data });
    for (const sub of subs.rows) {
      try {
        const subscription = {
          endpoint: sub.endpoint,
          keys: sub.keys,
        };
        await webpush.sendNotification(subscription, payload);
      } catch (err) {
        // Если подписка истекла, удаляем её
        if (err.statusCode === 410) {
          await db.query('DELETE FROM push_subscriptions WHERE endpoint = $1', [sub.endpoint]);
        } else {
          logger.error('Push send error:', err);
        }
      }
    }
  } catch (err) {
    logger.error('Send push notification error:', err);
  }
}

// ========== EMAIL ФУНКЦИИ ==========
async function sendEmail(to, subject, html) {
  if (!transporter) return;
  try {
    await transporter.sendMail({
      from: config.EMAIL.from || config.EMAIL.user,
      to,
      subject,
      html,
    });
  } catch (err) {
    logger.error('Send email error:', err);
  }
}

function sendVerificationEmail(to, token) {
  const link = `${config.FRONTEND_URL}/verify?token=${token}`;
  const html = `<p>Для подтверждения email перейдите по ссылке: <a href="${link}">${link}</a></p>`;
  return sendEmail(to, 'Подтверждение email', html);
}

function sendPasswordResetEmail(to, token) {
  const link = `${config.FRONTEND_URL}/reset-password?token=${token}`;
  const html = `<p>Для сброса пароля перейдите по ссылке: <a href="${link}">${link}</a></p>`;
  return sendEmail(to, 'Сброс пароля', html);
}

module.exports = {
  router,
  sendPushNotification,
  sendVerificationEmail,
  sendPasswordResetEmail,
};
