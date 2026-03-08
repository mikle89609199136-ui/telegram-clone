// utils.js — вспомогательные функции
const bcrypt = require('bcrypt');
const { v4: uuidv4 } = require('uuid');
const config = require('./config');

// Хеширование пароля
async function hashPassword(password) {
  return bcrypt.hash(password, config.BCRYPT_ROUNDS);
}

// Сравнение пароля с хешем
async function comparePassword(password, hash) {
  return bcrypt.compare(password, hash);
}

// Генерация уникального ID
function generateId() {
  return uuidv4();
}

// Санитизация пользователя (удаление чувствительных полей)
function sanitizeUser(user) {
  if (!user) return null;
  const { password_hash, ...safe } = user;
  return safe;
}

// Форматирование времени для чата
function formatMessageTime(timestamp) {
  const date = new Date(timestamp);
  const now = new Date();
  const diff = now - date;

  if (diff < 60000) return 'только что';
  if (diff < 3600000) return `${Math.floor(diff / 60000)} мин назад`;
  if (diff < 86400000) return date.toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' });
  return date.toLocaleDateString('ru', { day: 'numeric', month: 'short' });
}

// Экранирование HTML (Правило 23)
function escapeHtml(unsafe) {
  if (!unsafe) return '';
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Проверка MIME-типа (Правило 59)
function isAllowedMimeType(mimeType) {
  return config.UPLOAD.allowedMime.includes(mimeType);
}

// Генерация случайной строки
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
