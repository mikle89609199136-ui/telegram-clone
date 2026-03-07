const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { query, transaction } = require('./database');
const logger = require('./logger');
const config = require('./config');
const { validateEmail, validateUsername, generateId } = require('./utils');
const rateLimit = require('express-rate-limit');
const router = express.Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  skipSuccessfulRequests: true,
  keyGenerator: (req) => req.ip
});

router.post('/register', async (req, res) => {
  const { username, email, password } = req.body;
  if (!username || !email || !password) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  if (!validateUsername(username)) {
    return res.status(400).json({ error: 'Invalid username (3-30 letters, numbers, underscore)' });
  }
  if (!validateEmail(email)) {
    return res.status(400).json({ error: 'Invalid email' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }

  try {
    const existing = await query('SELECT id FROM users WHERE email = $1 OR username = $2', [email, username]);
    if (existing.rows.length) {
      return res.status(409).json({ error: 'Email or username already taken' });
    }

    const hash = await bcrypt.hash(password, config.bcryptRounds);
    const result = await query(
      'INSERT INTO users (username, email, password_hash) VALUES ($1, $2, $3) RETURNING id, uid, username, email, avatar, bio, verified',
      [username, email, hash]
    );
    const user = result.rows[0];
    await query('INSERT INTO user_settings (user_id) VALUES ($1)', [user.id]);

    const tokens = await generateTokens(user.id, req);
    res.status(201).json({ user, ...tokens });
  } catch (err) {
    logger.error('Register error', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/login', loginLimiter, async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' });
  }

  try {
    const result = await query('SELECT id, username, email, password_hash, avatar, bio, verified FROM users WHERE email = $1', [email]);
    const user = result.rows[0];
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const tokens = await generateTokens(user.id, req);
    const { password_hash, ...safeUser } = user;
    res.json({ user: safeUser, ...tokens });
  } catch (err) {
    logger.error('Login error', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/refresh', async (req, res) => {
  const { refreshToken } = req.body;
  if (!refreshToken) return res.status(401).json({ error: 'No refresh token' });

  try {
    const payload = jwt.verify(refreshToken, config.jwtRefreshSecret);
    const session = await query('SELECT user_id FROM sessions WHERE token = $1', [refreshToken]);
    if (!session.rows.length) {
      return res.status(401).json({ error: 'Invalid refresh token' });
    }
    const newTokens = await generateTokens(payload.userId, req, refreshToken);
    res.json(newTokens);
  } catch (err) {
    logger.error('Refresh error', err);
    return res.status(401).json({ error: 'Invalid refresh token' });
  }
});

router.post('/logout', require('./authMiddleware'), async (req, res) => {
  const authHeader = req.headers.authorization;
  const token = authHeader.split(' ')[1];
  await query('DELETE FROM sessions WHERE token = $1', [token]);
  res.json({ success: true });
});

router.post('/logout-all', require('./authMiddleware'), async (req, res) => {
  await query('DELETE FROM sessions WHERE user_id = $1', [req.userId]);
  res.json({ success: true });
});

async function generateTokens(userId, req, oldToken = null) {
  const accessToken = jwt.sign({ userId }, config.jwtSecret, { expiresIn: config.jwtAccessExpiry });
  const refreshToken = jwt.sign({ userId }, config.jwtRefreshSecret, { expiresIn: config.jwtRefreshExpiry });

  const deviceInfo = {
    userAgent: req.headers['user-agent'],
    ip: req.ip,
  };
  await query(
    'INSERT INTO sessions (user_id, token, device_info, ip) VALUES ($1, $2, $3, $4)',
    [userId, refreshToken, deviceInfo, req.ip]
  );

  if (oldToken) {
    await query('DELETE FROM sessions WHERE token = $1', [oldToken]);
  }

  return { accessToken, refreshToken };
}

module.exports = router;
