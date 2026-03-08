// database.js — подключение к БД (PostgreSQL или SQLite)
const { Pool } = require('pg');
const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');
const path = require('path');
const logger = require('./logger');
const config = require('./config');

let db;

// Выбор диалекта
if (config.DB.dialect === 'postgres') {
  // PostgreSQL (Правило 56: пул закрывается при завершении)
  const pool = new Pool({
    host: config.DB.host,
    port: config.DB.port,
    database: config.DB.name,
    user: config.DB.user,
    password: config.DB.password,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
  });

  pool.on('error', (err) => {
    logger.error('Unexpected error on idle client', err);
    process.exit(-1);
  });

  // Закрытие соединений при выходе
  process.on('SIGINT', async () => {
    await pool.end();
    logger.info('Database pool closed');
    process.exit(0);
  });

  db = {
    query: (text, params) => pool.query(text, params),
    getClient: () => pool.connect(),
    end: () => pool.end(),
  };
} else {
  // SQLite (для разработки)
  const dbPath = config.DB.storage;
  const sqliteDb = new sqlite3.Database(dbPath, (err) => {
    if (err) {
      logger.error('Failed to open SQLite database', err);
      process.exit(1);
    }
  });

  db = {
    query: async (sql, params = []) => {
      return new Promise((resolve, reject) => {
        sqliteDb.all(sql, params, (err, rows) => {
          if (err) reject(err);
          else resolve({ rows });
        });
      });
    },
    run: async (sql, params = []) => {
      return new Promise((resolve, reject) => {
        sqliteDb.run(sql, params, function(err) {
          if (err) reject(err);
          else resolve({ lastID: this.lastID, changes: this.changes });
        });
      });
    },
    end: () => sqliteDb.close(),
  };
}

module.exports = { db };
