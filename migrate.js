const { initDatabase } = require('./database');
const logger = require('./logger');

async function migrate() {
  logger.info('Running migrations...');
  await initDatabase();
  logger.info('Migrations completed');
  process.exit(0);
}

migrate().catch(err => {
  logger.error('Migration failed', err);
  process.exit(1);
});
