const { Pool } = require('pg');
const redis = require('redis');
const config = require('./config');
const logger = require('./logger');

// PostgreSQL пул
const pgPool = new Pool({
  host: config.pg.host,
  port: config.pg.port,
  user: config.pg.user,
  password: config.pg.password,
  database: config.pg.database,
  max: 20, // максимум 20 соединений в пуле
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

pgPool.on('error', (err) => {
  logger.error('Unexpected error on idle PostgreSQL client', err);
  process.exit(-1);
});

// Redis клиент
const redisClient = redis.createClient({
  url: config.redisUrl
});

redisClient.on('error', (err) => logger.error('Redis error:', err));

/**
 * Подключается к Redis и проверяет соединение с PostgreSQL
 */
async function initDatabase() {
  // Подключаемся к Redis
  await redisClient.connect();
  logger.info('✅ Redis connected');

  // Проверяем подключение к PostgreSQL
  const client = await pgPool.connect();
  try {
    await client.query('SELECT 1');
    logger.info('✅ PostgreSQL connected');
  } finally {
    client.release();
  }
}

module.exports = {
  pgPool,
  redis: redisClient,
  initDatabase
};