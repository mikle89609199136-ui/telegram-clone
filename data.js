// data.js
import pkg from 'pg'
import { v4 as uuidv4 } from 'uuid'

const { Pool } = pkg

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('railway')
    ? { rejectUnauthorized: false }
    : false
})

export async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS devices (
      id UUID PRIMARY KEY,
      user_id UUID REFERENCES users(id) ON DELETE CASCADE,
      name TEXT,
      refresh_token TEXT,
      revoked_at TIMESTAMP NULL,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS messages (
      id UUID PRIMARY KEY,
      sender_id UUID,
      receiver_id UUID,
      content TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `)

  console.log("✅ Database initialized")
}

export async function createUser(username, passwordHash) {
  const id = uuidv4()
  await pool.query(
    `INSERT INTO users (id, username, password_hash) VALUES ($1,$2,$3)`,
    [id, username, passwordHash]
  )
  return id
}

export async function findUserByUsername(username) {
  const res = await pool.query(
    `SELECT * FROM users WHERE username=$1`,
    [username]
  )
  return res.rows[0]
}

export async function createDevice(userId, name, refreshToken) {
  const id = uuidv4()
  await pool.query(
    `INSERT INTO devices (id,user_id,name,refresh_token)
     VALUES ($1,$2,$3,$4)`,
    [id, userId, name, refreshToken]
  )
  return id
}

export async function saveMessage(senderId, receiverId, content) {
  await pool.query(
    `INSERT INTO messages (id,sender_id,receiver_id,content)
     VALUES ($1,$2,$3,$4)`,
    [uuidv4(), senderId, receiverId, content]
  )
}

export async function getMessages(userA, userB) {
  const res = await pool.query(
    `SELECT * FROM messages
     WHERE (sender_id=$1 AND receiver_id=$2)
        OR (sender_id=$2 AND receiver_id=$1)
     ORDER BY created_at ASC`,
    [userA, userB]
  )
  return res.rows
}
