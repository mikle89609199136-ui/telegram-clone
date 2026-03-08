// env.js — проверка обязательных переменных окружения
const logger = require('./logger');

const requiredEnvVars = [
  'JWT_SECRET',
  // Добавьте другие обязательные переменные
];

module.exports = function checkEnv() {
  const missing = requiredEnvVars.filter(varName => !process.env[varName]);
  if (missing.length > 0) {
    logger.error(`Missing required environment variables: ${missing.join(', ')}`);
    process.exit(1);
  }
  logger.info('Environment variables check passed');
};
