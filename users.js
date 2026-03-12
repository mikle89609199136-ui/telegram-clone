const express = require('express');
const router = express.Router();
const { getData } = require('./database');
const authMiddleware = require('./authMiddleware');

// Получить список всех пользователей (кроме себя)
router.get('/', authMiddleware, (req, res) => {
  const users = getData('users.json');
  const others = users
    .filter(u => u.id !== req.user.userId)
    .map(u => ({ id: u.id, username: u.username, avatar: u.avatar, status: u.status, lastSeen: u.lastSeen }));
  res.json(others);
});

// Получить информацию о конкретном пользователе
router.get('/:id', authMiddleware, (req, res) => {
  const users = getData('users.json');
  const user = users.find(u => u.id === req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ id: user.id, username: user.username, avatar: user.avatar, status: user.status, lastSeen: user.lastSeen });
});

module.exports = router;
