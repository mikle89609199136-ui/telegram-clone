// utils.js – helper functions
const bcrypt = require('bcrypt');
const { v4: uuidv4 } = require('uuid');
const config = require('./config');

async function hashPassword(password) {
  return bcrypt.hash(password, config.BCRYPT_ROUNDS);
}

async function comparePassword(password, hash) {
  return bcrypt.compare(password, hash);
}

function generateId() {
  return uuidv4();
}

function sanitizeUser(user) {
  if (!user) return null;
  const { password_hash, ...safe } = user;
  return safe;
}

function formatMessageTime(timestamp) {
  const date = new Date(timestamp);
  const now = new Date();
  const diff = now - date;

  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)} min ago`;
  if (diff < 86400000) return date.toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' });
  return date.toLocaleDateString('ru', { day: 'numeric', month: 'short' });
}

function escapeHtml(unsafe) {
  if (!unsafe) return '';
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function isAllowedMimeType(mimeType) {
  return config.UPLOAD.allowedMime.includes(mimeType);
}

function randomString(length = 10) {
  return Math.random().toString(36).substring(2, 2 + length);
}

module.exports = {
  hashPassword,
  comparePassword,
  generateId,
  sanitizeUser,
  formatMessageTime,
  escapeHtml,
  isAllowedMimeType,
  randomString,
};
