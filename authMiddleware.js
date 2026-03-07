const jwt = require('jsonwebtoken');
const config = require('./config');
const { query } = require('./database');

async function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'No token provided' });

  const token = authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Invalid token format' });

  try {
    const decoded = jwt.verify(token, config.jwtSecret);
    const session = await query('SELECT user_id FROM sessions WHERE token = $1', [token]);
    if (!session.rows.length) {
      return res.status(401).json({ error: 'Session expired' });
    }
    req.userId = decoded.userId;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired' });
    }
    return res.status(401).json({ error: 'Invalid token' });
  }
}

async function socketAuth(socket, next) {
  const token = socket.handshake.auth.token;
  if (!token) return next(new Error('Authentication error'));

  try {
    const decoded = jwt.verify(token, config.jwtSecret);
    const session = await query('SELECT user_id FROM sessions WHERE token = $1', [token]);
    if (!session.rows.length) {
      return next(new Error('Session expired'));
    }
    socket.userId = decoded.userId;
    next();
  } catch (err) {
    next(new Error('Authentication error'));
  }
}

module.exports = authMiddleware;
module.exports.socketAuth = socketAuth;
