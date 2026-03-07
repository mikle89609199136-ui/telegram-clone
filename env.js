const logger = require('./logger');

const REQUIRED_VARS = [
  'JWT_SECRET',
  'PG_HOST',
  'PG_USER',
  'PG_PASSWORD',
  'PG_DATABASE',
  'REDIS_URL'
];

/**
 * Проверяет, что все обязательные переменные окружения заданы
 * @throws {Error} если какая-то переменная отсутствует
 */
function checkEnv() {
  const missing = REQUIRED_VARS.filter(key => !process.env[key]);
  if (missing.length > 0) {
    const errorMsg = `Missing required environment variables: ${missing.join(', ')}`;
    logger.error(errorMsg);
    throw new Error(errorMsg);
  }
  logger.info('✅ All required environment variables are set');
}

module.exports = checkEnv;