// notifications.js – push notifications and email
const express = require('express');
const router = express.Router();
const webpush = require('web-push');
const nodemailer = require('nodemailer');
const authenticateToken = require('./authMiddleware');
const { db } = require('./database');
const config = require('./config');
const logger = require('./logger');

// Configure web-push (if VAPID keys are set)
if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(
    'mailto:' + config.EMAIL.user,
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
}

// Email transporter
let transporter = null;
if (config.EMAIL.host && config.EMAIL.user) {
  transporter = nodemailer.createTransporter({
    host: config.EMAIL.host,
    port: config.EMAIL.port,
    secure: config.EMAIL.port === 465,
    auth: {
      user: config.EMAIL.user,
      pass: config.EMAIL.pass,
    },
  });
}

// Send email function
async function sendEmail(to, subject, html) {
  if (!transporter) return;
  try {
    await transporter.sendMail({
      from: config.EMAIL.from,
      to,
      subject,
      html,
    });
  } catch (err) {
    logger.error('Failed to send email:', err);
  }
}

// Send verification email
async function sendVerificationEmail(to, token) {
  const link = `${config.FRONTEND_URL}/verify?token=${token}`;
  const html = `<p>Please verify your email by clicking <a href="${link}">this link</a>.</p>`;
  return sendEmail(to, 'Verify your email', html);
}

// Send password reset email
async function sendPasswordResetEmail(to, token) {
  const link = `${config.FRONTEND_URL}/reset-password?token=${token}`;
  const html = `<p>To reset your password, click <a href="${link}">this link</a>. It expires in 1 hour.</p>`;
  return sendEmail(to, 'Password reset', html);
}

// Get notification settings for current user
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

// Subscribe to push notifications
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

// Unsubscribe
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

// Send a push notification to a specific user (internal function)
async function sendPushNotification(userId, title, body, data = {}) {
  try {
    const subs = await db.query(
      'SELECT endpoint, keys FROM push_subscriptions WHERE user_id = $1',
      [userId]
    );
    for (const row of subs.rows) {
      const subscription = {
        endpoint: row.endpoint,
        keys: row.keys,
      };
      const payload = JSON.stringify({ title, body, data });
      webpush.sendNotification(subscription, payload).catch(err => {
        logger.error('Push send error:', err);
        // If subscription expired, remove it
        if (err.statusCode === 410) {
          db.query('DELETE FROM push_subscriptions WHERE endpoint = $1', [row.endpoint]);
        }
      });
    }
  } catch (err) {
    logger.error('Failed to send push notification:', err);
  }
}

module.exports = {
  router,
  sendEmail,
  sendVerificationEmail,
  sendPasswordResetEmail,
  sendPushNotification,
};
