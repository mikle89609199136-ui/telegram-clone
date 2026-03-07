const { Pool } = require('pg');
const logger = require('./logger');
const config = require('./config');

let primaryPool;
let replicaPool;

async function initDatabase() {
  primaryPool = new Pool({ connectionString: config.databaseUrl });
  if (config.databaseReplicaUrl) {
    replicaPool = new Pool({ connectionString: config.databaseReplicaUrl });
  } else {
    replicaPool = primaryPool;
  }

  primaryPool.on('error', (err) => logger.error('Primary pool error', err));
  if (replicaPool !== primaryPool) replicaPool.on('error', (err) => logger.error('Replica pool error', err));

  await primaryPool.query('SELECT 1');
  logger.info('Database connected');

  await createTables();
  await createIndexes();
}

async function query(text, params, useReplica = false) {
  const pool = useReplica ? replicaPool : primaryPool;
  const start = Date.now();
  try {
    const res = await pool.query(text, params);
    logger.debug('Query executed', { text, duration: Date.now() - start });
    return res;
  } catch (err) {
    logger.error('Query error', { text, params, error: err.message });
    throw err;
  }
}

async function transaction(callback) {
  const client = await primaryPool.connect();
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

async function createTables() {
  const tables = `
    CREATE TABLE IF NOT EXISTS users (
      id BIGSERIAL PRIMARY KEY,
      uid UUID UNIQUE NOT NULL DEFAULT gen_random_uuid(),
      username VARCHAR(50) UNIQUE NOT NULL,
      email VARCHAR(100) UNIQUE NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      avatar TEXT,
      bio TEXT,
      last_seen TIMESTAMPTZ DEFAULT NOW(),
      online BOOLEAN DEFAULT FALSE,
      verified BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token VARCHAR(500) NOT NULL,
      device_info JSONB,
      ip INET,
      last_active TIMESTAMPTZ DEFAULT NOW(),
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS chats (
      id BIGSERIAL PRIMARY KEY,
      uid UUID UNIQUE NOT NULL DEFAULT gen_random_uuid(),
      type VARCHAR(20) NOT NULL,
      title VARCHAR(100),
      avatar TEXT,
      created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS chat_members (
      chat_id BIGINT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role VARCHAR(20) DEFAULT 'member',
      joined_at TIMESTAMPTZ DEFAULT NOW(),
      muted_until TIMESTAMPTZ,
      archived BOOLEAN DEFAULT FALSE,
      pinned BOOLEAN DEFAULT FALSE,
      PRIMARY KEY (chat_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS messages (
      id BIGSERIAL PRIMARY KEY,
      uid UUID UNIQUE NOT NULL DEFAULT gen_random_uuid(),
      chat_id BIGINT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
      sender_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
      type VARCHAR(20) NOT NULL DEFAULT 'text',
      content TEXT,
      media JSONB,
      reply_to BIGINT REFERENCES messages(id) ON DELETE SET NULL,
      forwarded_from BIGINT REFERENCES messages(id) ON DELETE SET NULL,
      views INTEGER DEFAULT 0,
      edited BOOLEAN DEFAULT FALSE,
      deleted BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS message_reactions (
      message_id BIGINT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      reaction VARCHAR(10) NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (message_id, user_id, reaction)
    );

    CREATE TABLE IF NOT EXISTS message_reads (
      message_id BIGINT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      read_at TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (message_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS contacts (
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      contact_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (user_id, contact_id),
      CHECK (user_id != contact_id)
    );

    CREATE TABLE IF NOT EXISTS blocked_users (
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      blocked_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (user_id, blocked_id)
    );

    CREATE TABLE IF NOT EXISTS media (
      id BIGSERIAL PRIMARY KEY,
      uid UUID UNIQUE NOT NULL DEFAULT gen_random_uuid(),
      user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
      filename TEXT NOT NULL,
      mimetype TEXT,
      size BIGINT,
      url TEXT NOT NULL,
      thumbnail_url TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS calls (
      id BIGSERIAL PRIMARY KEY,
      caller_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
      callee_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
      type VARCHAR(10) NOT NULL,
      status VARCHAR(20) NOT NULL,
      started_at TIMESTAMPTZ,
      ended_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS user_settings (
      user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      notifications_enabled BOOLEAN DEFAULT TRUE,
      privacy_last_seen VARCHAR(20) DEFAULT 'everyone',
      privacy_profile_photo VARCHAR(20) DEFAULT 'everyone',
      privacy_read_receipts BOOLEAN DEFAULT TRUE,
      theme VARCHAR(10) DEFAULT 'dark',
      language VARCHAR(10) DEFAULT 'en',
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type VARCHAR(50) NOT NULL,
      data JSONB,
      read BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS ai_history (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role VARCHAR(10) NOT NULL,
      content TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `;
  await query(tables);
}

async function createIndexes() {
  const indexes = `
    CREATE INDEX IF NOT EXISTS idx_messages_chat_id_created ON messages(chat_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_messages_sender_id ON messages(sender_id);
    CREATE INDEX IF NOT EXISTS idx_messages_reply_to ON messages(reply_to);
    CREATE INDEX IF NOT EXISTS idx_chat_members_user_id ON chat_members(user_id);
    CREATE INDEX IF NOT EXISTS idx_chat_members_chat_id ON chat_members(chat_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token);
    CREATE INDEX IF NOT EXISTS idx_contacts_user_id ON contacts(user_id);
    CREATE INDEX IF NOT EXISTS idx_contacts_contact_id ON contacts(contact_id);
    CREATE INDEX IF NOT EXISTS idx_notifications_user_id_read ON notifications(user_id, read);
    CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
    CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
    CREATE INDEX IF NOT EXISTS idx_calls_caller_callee ON calls(caller_id, callee_id);
    CREATE INDEX IF NOT EXISTS idx_media_user_id ON media(user_id);
  `;
  await query(indexes);
}

module.exports = { initDatabase, query, transaction };
