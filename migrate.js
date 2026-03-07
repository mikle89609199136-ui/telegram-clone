require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs').promises;
const path = require('path');
const logger = console; // можно заменить на более продвинутое логирование

const pool = new Pool({
  host: process.env.PG_HOST || 'localhost',
  port: process.env.PG_PORT || 5432,
  user: process.env.PG_USER || 'postgres',
  password: process.env.PG_PASSWORD || 'postgres',
  database: process.env.PG_DATABASE || 'craneapp',
});

async function runMigrations() {
  const client = await pool.connect();
  try {
    logger.log('Running migrations...');
    
    // Читаем файл миграции
    const migrationSQL = await fs.readFile(
      path.join(__dirname, '..', 'migrations.sql'),
      'utf-8'
    );
    
    // Разделяем на отдельные запросы (по точке с запятой, но осторожно)
    const statements = migrationSQL
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0);
    
    for (let stmt of statements) {
      logger.log(`Executing: ${stmt.substring(0, 60)}...`);
      await client.query(stmt);
    }
    
    logger.log('Migrations completed successfully.');
  } catch (err) {
    logger.error('Migration failed:', err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

runMigrations();