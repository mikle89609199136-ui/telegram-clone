// env.js – временная версия для диагностики (без process.exit)
const logger = require('./logger');

const requiredEnvVars = ['JWT_SECRET'];

module.exports = function checkEnv() {
  const missing = requiredEnvVars.filter(varName => !process.env[varName]);
  if (missing.length > 0) {
    logger.warn(`⚠️ Missing recommended environment variables: ${missing.join(', ')}`);
    logger.warn('The server will still start, but some features may not work.');
  } else {
    logger.info('✅ Environment variables check passed');
  }
  // Отладка: выведем все ключи переменных окружения
  logger.debug('All environment variables keys:', Object.keys(process.env).join(', '));
};
