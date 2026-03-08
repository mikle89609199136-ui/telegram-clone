// database.js – database connection and models (PostgreSQL)
const { Pool } = require('pg');
const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');
const path = require('path');
const logger = require('./logger');
const config = require('./config');

let db;

if (config.DB.dialect === 'postgres') {
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

  // Initialize tables
  const init = async () => {
    const client = await pool.connect();
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS users (
          id VARCHAR(36) PRIMARY KEY,
          username VARCHAR(50) UNIQUE NOT NULL,
          email VARCHAR(255) UNIQUE NOT NULL,
          password_hash VARCHAR(255) NOT NULL,
          name VARCHAR(100),
          avatar TEXT,
          birthday DATE,
          status VARCHAR(20) DEFAULT 'offline',
          last_seen TIMESTAMP DEFAULT NOW(),
          theme VARCHAR(20) DEFAULT 'dark',
          wallpaper VARCHAR(20) DEFAULT 'default',
          language VARCHAR(10) DEFAULT 'ru',
          privacy_settings JSONB DEFAULT '{}',
          notification_settings JSONB DEFAULT '{}',
          created_at TIMESTAMP DEFAULT NOW(),
          updated_at TIMESTAMP DEFAULT NOW()
        )
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS sessions (
          id VARCHAR(36) PRIMARY KEY,
          user_id VARCHAR(36) REFERENCES users(id) ON DELETE CASCADE,
          token TEXT NOT NULL,
          device_info TEXT,
          created_at TIMESTAMP DEFAULT NOW(),
          expires_at TIMESTAMP
        )
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS chats (
          id VARCHAR(36) PRIMARY KEY,
          type VARCHAR(20) NOT NULL CHECK (type IN ('private', 'group', 'channel')),
          title VARCHAR(255),
          avatar TEXT,
          description TEXT,
          created_by VARCHAR(36) REFERENCES users(id),
          privacy VARCHAR(20) DEFAULT 'public',
          invite_link TEXT,
          created_at TIMESTAMP DEFAULT NOW(),
          updated_at TIMESTAMP DEFAULT NOW()
        )
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS chat_participants (
          chat_id VARCHAR(36) REFERENCES chats(id) ON DELETE CASCADE,
          user_id VARCHAR(36) REFERENCES users(id) ON DELETE CASCADE,
          role VARCHAR(20) DEFAULT 'member',
          joined_at TIMESTAMP DEFAULT NOW(),
          last_read_at TIMESTAMP DEFAULT NOW(),
          PRIMARY KEY (chat_id, user_id)
        )
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS messages (
          id VARCHAR(36) PRIMARY KEY,
          chat_id VARCHAR(36) REFERENCES chats(id) ON DELETE CASCADE,
          sender_id VARCHAR(36) REFERENCES users(id),
          content TEXT,
          type VARCHAR(20) DEFAULT 'text',
          file_url TEXT,
          file_name TEXT,
          file_size INTEGER,
          mime_type TEXT,
          poll_data JSONB,
          ai_metadata JSONB,
          created_at TIMESTAMP DEFAULT NOW(),
          updated_at TIMESTAMP DEFAULT NOW()
        )
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS message_reactions (
          message_id VARCHAR(36) REFERENCES messages(id) ON DELETE CASCADE,
          user_id VARCHAR(36) REFERENCES users(id) ON DELETE CASCADE,
          reaction VARCHAR(10) NOT NULL,
          created_at TIMESTAMP DEFAULT NOW(),
          PRIMARY KEY (message_id, user_id, reaction)
        )
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS contacts (
          user_id VARCHAR(36) REFERENCES users(id) ON DELETE CASCADE,
          contact_id VARCHAR(36) REFERENCES users(id) ON DELETE CASCADE,
          local_name VARCHAR(100),
          created_at TIMESTAMP DEFAULT NOW(),
          PRIMARY KEY (user_id, contact_id)
        )
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS folders (
          id VARCHAR(36) PRIMARY KEY,
          user_id VARCHAR(36) REFERENCES users(id) ON DELETE CASCADE,
          name VARCHAR(100) NOT NULL,
          color VARCHAR(20) DEFAULT 'black',
          created_at TIMESTAMP DEFAULT NOW()
        )
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS folder_chats (
          folder_id VARCHAR(36) REFERENCES folders(id) ON DELETE CASCADE,
          chat_id VARCHAR(36) REFERENCES chats(id) ON DELETE CASCADE,
          PRIMARY KEY (folder_id, chat_id)
        )
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS calls (
          id VARCHAR(36) PRIMARY KEY,
          caller_id VARCHAR(36) REFERENCES users(id),
          callee_id VARCHAR(36) REFERENCES users(id),
          status VARCHAR(20) DEFAULT 'ongoing',
          started_at TIMESTAMP DEFAULT NOW(),
          ended_at TIMESTAMP
        )
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS push_subscriptions (
          user_id VARCHAR(36) REFERENCES users(id) ON DELETE CASCADE,
          endpoint TEXT NOT NULL,
          keys JSONB NOT NULL,
          created_at TIMESTAMP DEFAULT NOW(),
          PRIMARY KEY (user_id, endpoint)
        )
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS ai_logs (
          id VARCHAR(36) PRIMARY KEY,
          user_id VARCHAR(36) REFERENCES users(id),
          chat_id VARCHAR(36) REFERENCES chats(id),
          request TEXT,
          response TEXT,
          model VARCHAR(50),
          tokens_used INTEGER,
          created_at TIMESTAMP DEFAULT NOW()
        )
      `);

      logger.info('Database tables initialized');
    } catch (err) {
      logger.error('Failed to initialize tables', err);
    } finally {
      client.release();
    }
  };
  init();
} else {
  // SQLite fallback (simplified, not for production)
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
  // SQLite init similar to above but omitted for brevity (would use run instead of query)
}

module.exports = { db };
