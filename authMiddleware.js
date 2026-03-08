// authMiddleware.js — проверка JWT токена
const jwt = require('jsonwebtoken');
const config = require('./config');
const logger = require('./logger');

module.exports = function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Токен не предоставлен' });
  }

  jwt.verify(token, config.JWT_SECRET, (err, user) => {
    if (err) {
      logger.warn('Invalid token', err.message);
      return res.status(403).json({ error: 'Неверный или просроченный токен' });
    }
    req.user = user;
    next();
  });
};
