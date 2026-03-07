const jwt = require('jsonwebtoken');
const { redis } = require('./database');
const config = require('./config');
const logger = require('./logger');

/**
 * Middleware для аутентификации запросов по JWT.
 * Добавляет req.user = { id, username, deviceId }
 */
function authenticateToken(req, res, next) {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) {
    return res.status(401).json({ error: 'Unauthorized: no token provided' });
  }

  jwt.verify(token, config.jwt.secret, async (err, user) => {
    if (err) {
      logger.warn('JWT verification failed:', err.message);
      return res.status(403).json({ error: 'Forbidden: invalid token' });
    }

    // Проверяем, что сессия ещё активна в Redis
    const sessionKey = `session:${user.id}:${user.deviceId}`;
    const sessionValid = await redis.get(sessionKey);
    if (!sessionValid) {
      return res.status(401).json({ error: 'Session expired' });
    }

    req.user = user;
    next();
  });
}

module.exports = authenticateToken;
