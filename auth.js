// auth.js — маршруты аутентификации (регистрация, вход, выход, восстановление)
const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const config = require('./config');
const logger = require('./logger');
const { db } = require('./database');
const { hashPassword, comparePassword, sanitizeUser } = require('./utils');
const { sendVerificationEmail, sendPasswordResetEmail } = require('./email'); // будет в notify

// Регистрация
router.post('/register', async (req, res) => {
  try {
    const { username, email, password } = req.body;

    if (!username || !email || !password) {
      return res.status(400).json({ error: 'Все поля обязательны' });
    }

    // Проверка существования
    const existing = await db.query(
      'SELECT id FROM users WHERE username = $1 OR email = $2',
      [username, email]
    );
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Имя пользователя или email уже заняты' });
    }

    const hashed = await hashPassword(password);
    const userId = uuidv4();

    await db.query(
      `INSERT INTO users (id, username, email, password_hash, status, last_seen)
       VALUES ($1, $2, $3, $4, 'offline', NOW())`,
      [userId, username, email, hashed]
    );

    const token = jwt.sign({ id: userId, username }, config.JWT_SECRET, {
      expiresIn: config.JWT_EXPIRES_IN,
    });

    // Запоминаем сессию (устройство)
    const deviceInfo = req.headers['user-agent'];
    const sessionId = uuidv4();
    await db.query(
      `INSERT INTO sessions (id, user_id, token, device_info, expires_at)
       VALUES ($1, $2, $3, $4, NOW() + INTERVAL '1 year')`,
      [sessionId, userId, token, deviceInfo]
    );

    // Отправка приветственного письма (опционально)
    // sendVerificationEmail(email, token);

    res.status(201).json({
      token,
      user: { id: userId, username, email, avatar: null, status: 'offline' }
    });
  } catch (err) {
    logger.error('Registration error:', err);
    res.status(500).json({ error: 'Ошибка регистрации' });
  }
});

// Вход
router.post('/login', async (req, res) => {
  try {
    const { identifier, password } = req.body;

    if (!identifier || !password) {
      return res.status(400).json({ error: 'Введите логин и пароль' });
    }

    const result = await db.query(
      'SELECT * FROM users WHERE username = $1 OR email = $1',
      [identifier]
    );
    const user = result.rows[0];

    if (!user || !(await comparePassword(password, user.password_hash))) {
      return res.status(401).json({ error: 'Неверный логин или пароль' });
    }

    // Обновляем статус
    await db.query(
      'UPDATE users SET status = $1, last_seen = NOW() WHERE id = $2',
      ['online', user.id]
    );

    const token = jwt.sign({ id: user.id, username: user.username }, config.JWT_SECRET, {
      expiresIn: config.JWT_EXPIRES_IN,
    });

    // Запоминаем сессию
    const deviceInfo = req.headers['user-agent'];
    const sessionId = uuidv4();
    await db.query(
      `INSERT INTO sessions (id, user_id, token, device_info, expires_at)
       VALUES ($1, $2, $3, $4, NOW() + INTERVAL '1 year')`,
      [sessionId, user.id, token, deviceInfo]
    );

    res.json({
      token,
      user: sanitizeUser(user)
    });
  } catch (err) {
    logger.error('Login error:', err);
    res.status(500).json({ error: 'Ошибка входа' });
  }
});

// Выход (удаляем сессию)
router.post('/logout', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (token) {
      await db.query('DELETE FROM sessions WHERE token = $1', [token]);
    }
    res.json({ success: true });
  } catch (err) {
    logger.error('Logout error:', err);
    res.status(500).json({ error: 'Ошибка выхода' });
  }
});

// Запрос на восстановление пароля
router.post('/forgot', async (req, res) => {
  try {
    const { email } = req.body;
    const result = await db.query('SELECT id FROM users WHERE email = $1', [email]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Пользователь с таким email не найден' });
    }

    const resetToken = jwt.sign({ email }, config.JWT_SECRET, { expiresIn: '1h' });
    await sendPasswordResetEmail(email, resetToken);

    res.json({ success: true, message: 'Инструкции отправлены на email' });
  } catch (err) {
    logger.error('Forgot password error:', err);
    res.status(500).json({ error: 'Ошибка отправки письма' });
  }
});

// Сброс пароля
router.post('/reset', async (req, res) => {
  try {
    const { token, newPassword } = req.body;
    let decoded;
    try {
      decoded = jwt.verify(token, config.JWT_SECRET);
    } catch {
      return res.status(400).json({ error: 'Неверная или просроченная ссылка' });
    }

    const hashed = await hashPassword(newPassword);
    await db.query('UPDATE users SET password_hash = $1 WHERE email = $2', [hashed, decoded.email]);

    // Удаляем все сессии пользователя
    const userResult = await db.query('SELECT id FROM users WHERE email = $1', [decoded.email]);
    if (userResult.rows[0]) {
      await db.query('DELETE FROM sessions WHERE user_id = $1', [userResult.rows[0].id]);
    }

    res.json({ success: true });
  } catch (err) {
    logger.error('Reset password error:', err);
    res.status(500).json({ error: 'Ошибка смены пароля' });
  }
});

module.exports = router;
