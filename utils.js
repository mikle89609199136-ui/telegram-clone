const { v4: uuidv4 } = require('uuid');
const sanitizeHtml = require('sanitize-html');

/**
 * Генерирует уникальный ID (UUID v4)
 * @returns {string} UUID
 */
function generateId() {
  return uuidv4();
}

/**
 * Проверяет валидность имени пользователя (только буквы, цифры, _, 3-30 символов)
 * @param {string} username
 * @returns {boolean}
 */
function isValidUsername(username) {
  return /^[a-zA-Z0-9_]{3,30}$/.test(username);
}

/**
 * Проверяет валидность пароля (минимум 8 символов)
 * @param {string} password
 * @returns {boolean}
 */
function isValidPassword(password) {
  return password && password.length >= 8;
}

/**
 * Очищает HTML от опасных тегов и атрибутов (XSS protection)
 * @param {string} dirty
 * @returns {string}
 */
function sanitize(dirty) {
  return sanitizeHtml(dirty, {
    allowedTags: ['b', 'i', 'em', 'strong', 'a', 'code', 'pre', 'blockquote'],
    allowedAttributes: {
      'a': ['href', 'target']
    },
    allowedSchemes: ['http', 'https', 'mailto']
  });
}

/**
 * Форматирует дату в относительный формат (только что, X мин назад, и т.д.)
 * @param {Date|string} date
 * @returns {string}
 */
function formatRelativeTime(date) {
  const now = new Date();
  const then = new Date(date);
  const diffMs = now - then;
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffSec < 60) return 'только что';
  if (diffMin < 60) return `${diffMin} мин назад`;
  if (diffHour < 24) return `${diffHour} ч назад`;
  if (diffDay < 7) return `${diffDay} дн назад`;
  return then.toLocaleDateString();
}

/**
 * Пагинация массива
 * @param {Array} array
 * @param {number} pageSize
 * @param {number} pageNumber (начиная с 1)
 * @returns {Array}
 */
function paginate(array, pageSize, pageNumber) {
  return array.slice((pageNumber - 1) * pageSize, pageNumber * pageSize);
}

/**
 * Задержка (промис)
 * @param {number} ms
 * @returns {Promise}
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = {
  generateId,
  isValidUsername,
  isValidPassword,
  sanitize,
  formatRelativeTime,
  paginate,
  sleep
};