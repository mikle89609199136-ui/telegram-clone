// migrate.js – migrations are handled automatically in database.js
const { db } = require('./database');
const logger = require('./logger');

async function runMigrations() {
  logger.info('Migrations are handled automatically by database.js');
  process.exit(0);
}

runMigrations();
