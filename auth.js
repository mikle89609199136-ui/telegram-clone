// auth.js — маршруты регистрации, входа, восстановления пароля

const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const { v4: uuidv4 } = require('uuid');
const { getData, saveData } = require('./data');

// Конфигурация почты
const transporter = nodemailer.createTransporter({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

// ===================== РЕГИСТРАЦИЯ =====================
router.post('/register', async (req, res) => {
  try {
    const { email, username, password, confirmPassword } = req.body;

    // Валидация
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

    // Проверка уникальности
    const users = getData('users.json');
    const existing = users.find(u => u.email === email || u.username === username);
    if (existing) {
      return res.status(409).json({ error: 'Email или @username уже заняты' });
    }

    // Хеширование пароля
    const hashedPassword = await bcrypt.hash(password, 12);

    // Новый пользователь
    const newUser = {
      id: uuidv4(),
      email,
      username, // без @
      password: hashedPassword,
      avatar: null, // будет установлен позже
      status: 'online',
      lastSeen: new Date().toISOString(),
      createdAt: new Date().toISOString()
    };

    users.push(newUser);
    saveData('users.json', users);

    // Генерация JWT на 1 год
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
    // Поиск по email или username (с @ или без)
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

    // Обновляем статус и lastSeen
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

// ===================== ЗАБЫЛИ ПАРОЛЬ =====================
router.post('/forgot', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ error: 'Введите email' });
    }

    const users = getData('users.json');
    const user = users.find(u => u.email === email);
    if (!user) {
      return res.status(404).json({ error: 'Пользователь с таким email не найден' });
    }

    // Генерация 6-значного кода
    const code = Math.floor(100000 + Math.random() * 900000).toString();

    // Сохраняем код в временное хранилище
    const codes = getData('codes.json');
    // Удаляем старые коды для этого email
    const filtered = codes.filter(c => c.email !== email);
    filtered.push({
      email,
      code,
      expires: Date.now() + 10 * 60 * 1000 // 10 минут
    });
    saveData('codes.json', filtered);

    // Отправка письма
    await transporter.sendMail({
      from: `"Zhuravlev Messenger" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: '🔐 Код восстановления пароля',
      html: `
        <div style="font-family: sans-serif; max-width: 400px; margin: 0 auto; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 40px; border-radius: 20px; color: white; text-align: center;">
          <h1 style="font-size: 48px; letter-spacing: 8px; margin: 0;">${code}</h1>
          <p style="opacity: 0.9;">Код действителен 10 минут</p>
        </div>
        <p style="text-align: center; color: #666;">Если вы не запрашивали восстановление, проигнорируйте это письмо.</p>
      `
    });

    res.json({ success: true, message: 'Код отправлен на почту' });
  } catch (err) {
    console.error('Ошибка forgot:', err);
    res.status(500).json({ error: 'Ошибка отправки кода' });
  }
});

// ===================== ПРОВЕРКА КОДА =====================
router.post('/verify-code', (req, res) => {
  const { email, code } = req.body;
  const codes = getData('codes.json');
  const valid = codes.find(c => c.email === email && c.code === code && Date.now() < c.expires);

  res.json({ valid: !!valid });
});

// ===================== СБРОС ПАРОЛЯ =====================
router.post('/reset-password', async (req, res) => {
  try {
    const { email, code, newPassword, confirmPassword } = req.body;

    if (newPassword !== confirmPassword) {
      return res.status(400).json({ error: 'Пароли не совпадают' });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'Пароль должен быть минимум 6 символов' });
    }

    const codes = getData('codes.json');
    const validCode = codes.find(c => c.email === email && c.code === code && Date.now() < c.expires);
    if (!validCode) {
      return res.status(400).json({ error: 'Неверный или просроченный код' });
    }

    const users = getData('users.json');
    const user = users.find(u => u.email === email);
    if (!user) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }

    user.password = await bcrypt.hash(newPassword, 12);
    saveData('users.json', users);

    // Удаляем использованный код
    const remainingCodes = codes.filter(c => c.email !== email);
    saveData('codes.json', remainingCodes);

    res.json({ success: true, message: 'Пароль успешно изменён' });
  } catch (err) {
    console.error('Ошибка сброса пароля:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

module.exports = router;
