const { pgPool } = require('./database');
const logger = require('./logger');

/**
 * Выполняет SQL-запрос с параметрами и логирует время выполнения
 * @param {string} text - SQL запрос
 * @param {Array} params - параметры
 * @returns {Promise<Object>} результат запроса
 */
async function query(text, params) {
  const start = Date.now();
  try {
    const res = await pgPool.query(text, params);
    const duration = Date.now() - start;
    if (duration > 1000) {
      logger.warn('Slow query', { text, duration, rows: res.rowCount });
    } else {
      logger.debug('Executed query', { text, duration, rows: res.rowCount });
    }
    return res;
  } catch (err) {
    logger.error('Query error', { text, error: err.message });
    throw err;
  }
}

/**
 * Выполняет транзакцию с несколькими запросами
 * @param {Function} callback - асинхронная функция, получающая клиента
 * @returns {Promise<any>} результат callback
 */
async function transaction(callback) {
  const client = await pgPool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  query,
  transaction
};
