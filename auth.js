---

## 📁 Файл 5: `auth.js`

```javascript
// auth.js – регистрация и вход

const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { getData, saveData } = require('./data');

router.post('/register', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password || password.length < 6) {
      return res.status(400).json({ error: 'Invalid username or password (min 6 chars)' });
    }

    const users = getData('users.json');
    if (users.find(u => u.username === username)) {
      return res.status(409).json({ error: 'Username already taken' });
    }

    const hashed = await bcrypt.hash(password, 12);
    const user = {
      id: uuidv4(),
      username,
      password: hashed,
      avatar: null,
      status: 'online',
      lastSeen: new Date().toISOString(),
      createdAt: new Date().toISOString()
    };
    users.push(user);
    saveData('users.json', users);

    // Создаём устройство
    const devices = getData('devices.json');
    const deviceId = uuidv4();
    devices.push({
      id: deviceId,
      userId: user.id,
      name: req.headers['user-agent'] || 'Unknown',
      ip: req.ip,
      lastSeen: new Date().toISOString(),
      revoked: false
    });
    saveData('devices.json', devices);

    const token = jwt.sign(
      { id: user.id, username: user.username, deviceId },
      process.env.JWT_SECRET,
      { expiresIn: '365d' }
    );
    res.status(201).json({ token, user: { id: user.id, username: user.username, avatar: user.avatar } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const users = getData('users.json');
    const user = users.find(u => u.username === username);
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(401).json({ error: 'Invalid credentials' });

    // Обновляем или создаём устройство
    const devices = getData('devices.json');
    let deviceId = req.body.deviceId;
    let device = devices.find(d => d.id === deviceId && d.userId === user.id && !d.revoked);
    if (!device) {
      deviceId = uuidv4();
      devices.push({
        id: deviceId,
        userId: user.id,
        name: req.headers['user-agent'] || 'Unknown',
        ip: req.ip,
        lastSeen: new Date().toISOString(),
        revoked: false
      });
      saveData('devices.json', devices);
    } else {
      device.lastSeen = new Date().toISOString();
      saveData('devices.json', devices);
    }

    user.status = 'online';
    user.lastSeen = new Date().toISOString();
    saveData('users.json', users);

    const token = jwt.sign(
      { id: user.id, username: user.username, deviceId },
      process.env.JWT_SECRET,
      { expiresIn: '365d' }
    );
    res.json({ token, user: { id: user.id, username: user.username, avatar: user.avatar } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
