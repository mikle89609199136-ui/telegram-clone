const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const speakeasy = require('speakeasy');
const QRCode = require('qrcode');
const { body, validationResult } = require('express-validator');
const { query, transaction } = require('./data');
const { generateId, isValidUsername, isValidPassword } = require('./utils');
const { redis } = require('./database');
const logger = require('./logger');
const config = require('./config');
const authenticateToken = require('./authMiddleware');

// ==================== РЕГИСТРАЦИЯ ====================
router.post('/register', [
  body('username').isLength({ min: 3, max: 30 }).matches(/^[a-zA-Z0-9_]+$/),
  body('password').isLength({ min: 8 })
], async (req, res) => {
  // Валидация
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { username, password } = req.body;

  try {
    // Проверяем, не занят ли username
    const existing = await query('SELECT id FROM users WHERE username = $1', [username]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Username already taken' });
    }

    // Хешируем пароль
    const hashed = await bcrypt.hash(password, 12);
    const userId = generateId();

    // Сохраняем пользователя
    await transaction(async (client) => {
      await client.query(
        'INSERT INTO users (id, username, password, created_at) VALUES ($1, $2, $3, NOW())',
        [userId, username, hashed]
      );
    });

    // Генерируем JWT (без устройства – первая сессия)
    const token = jwt.sign(
      { id: userId, username },
      config.jwt.secret,
      { expiresIn: config.jwt.expiresIn }
    );

    logger.info(`New user registered: ${username} (${userId})`);
    res.status(201).json({ token, user: { id: userId, username } });
  } catch (err) {
    logger.error('Registration error:', err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// ==================== ЛОГИН ====================
router.post('/login', [
  body('username').notEmpty(),
  body('password').notEmpty()
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { username, password, totpCode } = req.body;

  try {
    // Ищем пользователя
    const userRes = await query('SELECT * FROM users WHERE username = $1', [username]);
    if (userRes.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    const user = userRes.rows[0];

    // Проверяем пароль
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // 2FA проверка, если включена
    if (user.totp_secret) {
      if (!totpCode) {
        return res.status(401).json({ error: '2FA code required' });
      }
      const verified = speakeasy.totp.verify({
        secret: user.totp_secret,
        encoding: 'base32',
        token: totpCode,
        window: 2
      });
      if (!verified) {
        return res.status(401).json({ error: 'Invalid 2FA code' });
      }
    }

    // Сохраняем информацию об устройстве
    const deviceId = generateId();
    const userAgent = req.headers['user-agent'] || 'unknown';
    const ip = req.ip || req.connection.remoteAddress;

    await query(
      `INSERT INTO devices (id, user_id, name, ip, user_agent, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW())`,
      [deviceId, user.id, userAgent, ip, userAgent]
    );

    // Генерируем JWT с deviceId
    const token = jwt.sign(
      { id: user.id, username, deviceId },
      config.jwt.secret,
      { expiresIn: config.jwt.expiresIn }
    );

    // Сохраняем сессию в Redis (срок жизни = сроку жизни токена)
    const ttlSeconds = 7 * 24 * 60 * 60; // 7 дней
    await redis.setEx(`session:${user.id}:${deviceId}`, ttlSeconds, '1');
    await redis.sAdd(`user:${user.id}:devices`, deviceId);

    logger.info(`User logged in: ${username} (${user.id}) from device ${deviceId}`);
    res.json({
      token,
      user: {
        id: user.id,
        username,
        avatar: user.avatar,
        bio: user.bio,
        status: user.status
      }
    });
  } catch (err) {
    logger.error('Login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

// ==================== ВКЛЮЧЕНИЕ 2FA ====================
router.post('/2fa/enable', authenticateToken, async (req, res) => {
  try {
    const secret = speakeasy.generateSecret({
      length: 20,
      name: `${config.appName}:${req.user.username}`
    });

    await query('UPDATE users SET totp_secret = $1 WHERE id = $2', [secret.base32, req.user.id]);

    const qrUrl = await QRCode.toDataURL(secret.otpauth_url);
    res.json({ secret: secret.base32, qrCode: qrUrl });
  } catch (err) {
    logger.error('2FA enable error:', err);
    res.status(500).json({ error: 'Failed to enable 2FA' });
  }
});

// ==================== ОТКЛЮЧЕНИЕ 2FA ====================
router.post('/2fa/disable', authenticateToken, async (req, res) => {
  try {
    await query('UPDATE users SET totp_secret = NULL WHERE id = $1', [req.user.id]);
    res.json({ success: true });
  } catch (err) {
    logger.error('2FA disable error:', err);
    res.status(500).json({ error: 'Failed to disable 2FA' });
  }
});

// ==================== ВЫХОД (удаление сессии) ====================
router.post('/logout', authenticateToken, async (req, res) => {
  try {
    await redis.del(`session:${req.user.id}:${req.user.deviceId}`);
    await redis.sRem(`user:${req.user.id}:devices`, req.user.deviceId);
    res.json({ success: true });
  } catch (err) {
    logger.error('Logout error:', err);
    res.status(500).json({ error: 'Logout failed' });
  }
});

// ==================== ПОЛУЧЕНИЕ СПИСКА УСТРОЙСТВ ====================
router.get('/devices', authenticateToken, async (req, res) => {
  try {
    const devices = await query(`
      SELECT id, name, ip, user_agent, created_at
      FROM devices
      WHERE user_id = $1
      ORDER BY created_at DESC
    `, [req.user.id]);

    res.json(devices.rows);
  } catch (err) {
    logger.error('Fetch devices error:', err);
    res.status(500).json({ error: 'Failed to fetch devices' });
  }
});

// ==================== УДАЛЕНИЕ УСТРОЙСТВА (завершение сессии) ====================
router.delete('/devices/:deviceId', authenticateToken, async (req, res) => {
  const { deviceId } = req.params;
  try {
    // Удаляем запись из БД
    await query('DELETE FROM devices WHERE id = $1 AND user_id = $2', [deviceId, req.user.id]);
    // Удаляем сессию из Redis
    await redis.del(`session:${req.user.id}:${deviceId}`);
    await redis.sRem(`user:${req.user.id}:devices`, deviceId);
    res.json({ success: true });
  } catch (err) {
    logger.error('Delete device error:', err);
    res.status(500).json({ error: 'Failed to remove device' });
  }
});

module.exports = router;
