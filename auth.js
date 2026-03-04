// auth.js
import express from 'express'
import bcrypt from 'bcrypt'
import jwt from 'jsonwebtoken'
import { v4 as uuidv4 } from 'uuid'
import {
  createUser,
  findUserByUsername,
  createDevice,
  pool
} from './data.js'

const router = express.Router()

function generateAccessToken(userId, deviceId) {
  return jwt.sign(
    { sub: userId, deviceId },
    process.env.JWT_ACCESS_SECRET,
    { expiresIn: process.env.ACCESS_TOKEN_EXPIRES }
  )
}

function generateRefreshToken(userId, deviceId) {
  return jwt.sign(
    { sub: userId, deviceId },
    process.env.JWT_REFRESH_SECRET,
    { expiresIn: process.env.REFRESH_TOKEN_EXPIRES }
  )
}

// REGISTER
router.post('/register', async (req, res) => {
  const { username, password, deviceName } = req.body

  if (!username || !password)
    return res.status(400).json({ error: 'Missing fields' })

  const existing = await findUserByUsername(username)
  if (existing)
    return res.status(409).json({ error: 'User exists' })

  const hash = await bcrypt.hash(password, 10)
  const userId = await createUser(username, hash)

  const tempDeviceId = uuidv4()
  const refreshToken = generateRefreshToken(userId, tempDeviceId)
  const deviceId = await createDevice(userId, deviceName || "Browser", refreshToken)

  const accessToken = generateAccessToken(userId, deviceId)

  res.json({ accessToken, refreshToken, deviceId })
})

// LOGIN
router.post('/login', async (req, res) => {
  const { username, password, deviceName } = req.body

  const user = await findUserByUsername(username)
  if (!user) return res.status(404).json({ error: 'User not found' })

  const valid = await bcrypt.compare(password, user.password_hash)
  if (!valid) return res.status(401).json({ error: 'Wrong password' })

  const tempDeviceId = uuidv4()
  const refreshToken = generateRefreshToken(user.id, tempDeviceId)
  const deviceId = await createDevice(user.id, deviceName || "Browser", refreshToken)

  const accessToken = generateAccessToken(user.id, deviceId)

  res.json({ accessToken, refreshToken, deviceId })
})

// REFRESH
router.post('/refresh', async (req, res) => {
  const { refreshToken } = req.body
  if (!refreshToken) return res.status(400).json({ error: 'No token' })

  try {
    const payload = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET)
    const { sub, deviceId } = payload

    const result = await pool.query(
      `SELECT revoked_at FROM devices WHERE id=$1 AND user_id=$2`,
      [deviceId, sub]
    )

    if (!result.rows.length || result.rows[0].revoked_at)
      return res.status(403).json({ error: 'Device revoked' })

    const accessToken = generateAccessToken(sub, deviceId)
    res.json({ accessToken })
  } catch {
    res.status(403).json({ error: 'Invalid refresh' })
  }
})

export default router
