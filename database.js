// database.js – database connection and models (SQLite version)
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs-extra');
const logger = require('./logger');
const config = require('./config');

let db;

// SQLite
const dbPath = config.DB.storage;
fs.ensureDirSync(path.dirname(dbPath));

const sqliteDb = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    logger.error('Failed to open SQLite database', err);
    process.exit(1);
  }
});

// Обёртка для async/await
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

// Автоматическое создание таблиц при первом запуске
const initSqlite = async () => {
  try {
    await db.run(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        name TEXT,
        avatar TEXT,
        birthday TEXT,
        status TEXT DEFAULT 'offline',
        last_seen TEXT DEFAULT CURRENT_TIMESTAMP,
        theme TEXT DEFAULT 'dark',
        wallpaper TEXT DEFAULT 'default',
        language TEXT DEFAULT 'ru',
        privacy_settings TEXT DEFAULT '{}',
        notification_settings TEXT DEFAULT '{}',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await db.run(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT,
        token TEXT NOT NULL,
        device_info TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        expires_at TEXT,
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    await db.run(`
      CREATE TABLE IF NOT EXISTS chats (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL CHECK(type IN ('private','group','channel')),
        title TEXT,
        avatar TEXT,
        description TEXT,
        created_by TEXT,
        privacy TEXT DEFAULT 'public',
        invite_link TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await db.run(`
      CREATE TABLE IF NOT EXISTS chat_participants (
        chat_id TEXT,
        user_id TEXT,
        role TEXT DEFAULT 'member',
        joined_at TEXT DEFAULT CURRENT_TIMESTAMP,
        last_read_at TEXT DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (chat_id, user_id),
        FOREIGN KEY(chat_id) REFERENCES chats(id) ON DELETE CASCADE,
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    await db.run(`
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        chat_id TEXT,
        sender_id TEXT,
        content TEXT,
        type TEXT DEFAULT 'text',
        file_url TEXT,
        file_name TEXT,
        file_size INTEGER,
        mime_type TEXT,
        poll_data TEXT,
        ai_metadata TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(chat_id) REFERENCES chats(id) ON DELETE CASCADE,
        FOREIGN KEY(sender_id) REFERENCES users(id)
      )
    `);

    await db.run(`
      CREATE TABLE IF NOT EXISTS message_reactions (
        message_id TEXT,
        user_id TEXT,
        reaction TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (message_id, user_id, reaction),
        FOREIGN KEY(message_id) REFERENCES messages(id) ON DELETE CASCADE,
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    await db.run(`
      CREATE TABLE IF NOT EXISTS contacts (
        user_id TEXT,
        contact_id TEXT,
        local_name TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (user_id, contact_id),
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY(contact_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    await db.run(`
      CREATE TABLE IF NOT EXISTS folders (
        id TEXT PRIMARY KEY,
        user_id TEXT,
        name TEXT NOT NULL,
        color TEXT DEFAULT 'black',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    await db.run(`
      CREATE TABLE IF NOT EXISTS folder_chats (
        folder_id TEXT,
        chat_id TEXT,
        PRIMARY KEY (folder_id, chat_id),
        FOREIGN KEY(folder_id) REFERENCES folders(id) ON DELETE CASCADE,
        FOREIGN KEY(chat_id) REFERENCES chats(id) ON DELETE CASCADE
      )
    `);

    await db.run(`
      CREATE TABLE IF NOT EXISTS calls (
        id TEXT PRIMARY KEY,
        caller_id TEXT,
        callee_id TEXT,
        status TEXT DEFAULT 'ongoing',
        started_at TEXT DEFAULT CURRENT_TIMESTAMP,
        ended_at TEXT,
        FOREIGN KEY(caller_id) REFERENCES users(id),
        FOREIGN KEY(callee_id) REFERENCES users(id)
      )
    `);

    await db.run(`
      CREATE TABLE IF NOT EXISTS push_subscriptions (
        user_id TEXT,
        endpoint TEXT NOT NULL,
        keys TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (user_id, endpoint),
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    await db.run(`
      CREATE TABLE IF NOT EXISTS ai_logs (
        id TEXT PRIMARY KEY,
        user_id TEXT,
        chat_id TEXT,
        request TEXT,
        response TEXT,
        model TEXT,
        tokens_used INTEGER,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(user_id) REFERENCES users(id),
        FOREIGN KEY(chat_id) REFERENCES chats(id) ON DELETE CASCADE
      )
    `);

    await db.run(`
      CREATE TABLE IF NOT EXISTS hidden_messages (
        user_id TEXT,
        message_id TEXT,
        PRIMARY KEY (user_id, message_id),
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY(message_id) REFERENCES messages(id) ON DELETE CASCADE
      )
    `);

    logger.info('SQLite tables initialized');
  } catch (err) {
    logger.error('Failed to initialize SQLite tables', err);
  }
};

initSqlite();

module.exports = { db };
