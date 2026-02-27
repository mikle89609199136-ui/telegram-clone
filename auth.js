const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const fs = require('fs-extra');
const { v4: uuidv4 } = require('uuid');

const DATA_DIR = './data';
const JWT_SECRET = process.env.JWT_SECRET || 'telegram-pro-v5-secret';

const transporter = nodemailer.createTransporter({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

module.exports = (app) => {
  // Регистрация
  app.post('/api/auth/register', async (req, res) => {
    try {
      const { email, username, password } = req.body;
      const users = fs.readJsonSync(`${DATA_DIR}/users.json`) || [];
      
      if (users.find(u => u.email === email || u.username === username)) {
        return res.status(400).json({ error: 'User exists' });
      }

      const hashed = await bcrypt.hash(password, 12);
      const user = {
        id: uuidv4(),
        email,
        username,
        password: hashed,
        createdAt: new Date().toISOString()
      };

      users.push(user);
      fs.writeJsonSync(`${DATA_DIR}/users.json`, users);

      const token = jwt.sign({ id: user.id }, JWT_SECRET, { expiresIn: '1y' });
      res.json({ token, user });
    } catch (error) {
      res.status(500).json({ error: 'Registration failed' });
    }
  });

  // Логин
  app.post('/api/auth/login', async (req, res) => {
    try {
      const { username, password } = req.body;
      const users = fs.readJsonSync(`${DATA_DIR}/users.json`) || [];
      const user = users.find(u => u.username === username);

      if (!user || !(await bcrypt.compare(password, user.password))) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      const token = jwt.sign({ id: user.id }, JWT_SECRET, { expiresIn: '1y' });
      res.json({ token, user });
    } catch (error) {
      res.status(500).json({ error: 'Login failed' });
    }
  });

  // Забыл пароль
  app.post('/api/auth/forgot', async (req, res) => {
    const { email } = req.body;
    const code = Math.floor(100000 + Math.random() * 900000);
    
    await transporter.sendMail({
      to: email,
      subject: 'Telegram Pro - Код',
      html: `<h1>${code}</h1>`
    });

    fs.writeJsonSync(`${DATA_DIR}/codes.json`, [{ email, code }]);
    res.json({ success: true });
  });
};

