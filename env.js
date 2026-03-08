// env.js — временная версия без остановки
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
};
