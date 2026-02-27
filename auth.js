// auth.js — упрощённая версия (без восстановления пароля)

const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { getData, saveData } = require('./data');

// ===================== РЕГИСТРАЦИЯ =====================
router.post('/register', async (req, res) => {
  try {
    const { email, username, password, confirmPassword } = req.body;

    if (!email || !username || !password || !confirmPassword) {
      return res.status(400).json({ error: 'Все поля обязательны' });
    }
    if (password !== confirmPassword) {
      return res.status(400).json({ error: 'Пароли не совпадают' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Пароль должен быть минимум 6 символов' });
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: 'Некорректный email' });
    }

    const users = getData('users.json');
    const existing = users.find(u => u.email === email || u.username === username);
    if (existing) {
      return res.status(409).json({ error: 'Email или @username уже заняты' });
    }

    const hashedPassword = await bcrypt.hash(password, 12);

    const newUser = {
      id: uuidv4(),
      email,
      username,
      password: hashedPassword,
      avatar: null,
      status: 'online',
      lastSeen: new Date().toISOString(),
      createdAt: new Date().toISOString()
    };

    users.push(newUser);
    saveData('users.json', users);

    const token = jwt.sign(
      { id: newUser.id, username: newUser.username },
      process.env.JWT_SECRET,
      { expiresIn: '365d' }
    );

    res.status(201).json({
      success: true,
      token,
      user: {
        id: newUser.id,
        username: newUser.username,
        email: newUser.email,
        avatar: newUser.avatar
      }
    });
  } catch (err) {
    console.error('Ошибка регистрации:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// ===================== ВХОД =====================
router.post('/login', async (req, res) => {
  try {
    const { identifier, password } = req.body;

    if (!identifier || !password) {
      return res.status(400).json({ error: 'Введите логин и пароль' });
    }

    const users = getData('users.json');
    const user = users.find(u =>
      u.email === identifier ||
      u.username === identifier ||
      `@${u.username}` === identifier
    );

    if (!user) {
      return res.status(401).json({ error: 'Неверный логин или пароль' });
    }

    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.status(401).json({ error: 'Неверный логин или пароль' });
    }

    user.status = 'online';
    user.lastSeen = new Date().toISOString();
    saveData('users.json', users);

    const token = jwt.sign(
      { id: user.id, username: user.username },
      process.env.JWT_SECRET,
      { expiresIn: '365d' }
    );

    res.json({
      success: true,
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        avatar: user.avatar
      }
    });
  } catch (err) {
    console.error('Ошибка входа:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// ⚠️ Маршруты для восстановления пароля удалены – они не работают без почты

module.exports = router;
