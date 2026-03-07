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
  if (!dirty) return '';
  return sanitizeHtml(dirty, {
    allowedTags: ['b', 'i', 'em', 'strong', 'a', 'code', 'pre', 'blockquote', 'p', 'br'],
    allowedAttributes: {
      'a': ['href', 'target', 'rel']
    },
    allowedSchemes: ['http', 'https', 'mailto', 'tel'],
    transformTags: {
      'a': sanitizeHtml.simpleTransform('a', { rel: 'nofollow noopener', target: '_blank' })
    }
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
  const diffWeek = Math.floor(diffDay / 7);
  const diffMonth = Math.floor(diffDay / 30);

  if (diffSec < 60) return 'только что';
  if (diffMin < 60) return `${diffMin} мин назад`;
  if (diffHour < 24) return `${diffHour} ч назад`;
  if (diffDay < 7) return `${diffDay} дн назад`;
  if (diffWeek < 5) return `${diffWeek} нед назад`;
  if (diffMonth < 12) return `${diffMonth} мес назад`;
  return then.toLocaleDateString('ru-RU', { year: 'numeric', month: 'long', day: 'numeric' });
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

/**
 * Генерирует случайный цвет для аватара по умолчанию
 * @param {string} seed
 * @returns {string}
 */
function getAvatarColor(seed) {
  const colors = ['#ff2da6', '#7a2bff', '#2bd6ff', '#ff6b2b', '#2bff8a', '#ff2b4d'];
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = seed.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
}

module.exports = {
  generateId,
  isValidUsername,
  isValidPassword,
  sanitize,
  formatRelativeTime,
  paginate,
  sleep,
  getAvatarColor
};
