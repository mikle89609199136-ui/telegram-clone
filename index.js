// index.js
import jwt from 'jsonwebtoken'
import {
  saveMessage,
  getMessages,
  pool
} from './data.js'
import { handleAIMessage, AI_USER_ID } from './ai.js'

export default function initSocket(io) {

  // 🔐 AUTH MIDDLEWARE
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token
      if (!token) return next(new Error("No token"))

      const decoded = jwt.verify(token, process.env.JWT_ACCESS_SECRET)
      const { sub, deviceId } = decoded

      const device = await pool.query(
        `SELECT revoked_at FROM devices WHERE id=$1 AND user_id=$2`,
        [deviceId, sub]
      )

      if (!device.rows.length || device.rows[0].revoked_at)
        return next(new Error("Device revoked"))

      socket.userId = sub
      socket.deviceId = deviceId

      next()
    } catch (err) {
      next(new Error("Auth error"))
    }
  })

  io.on('connection', (socket) => {

    const userId = socket.userId
    const deviceId = socket.deviceId

    console.log(`🔌 Connected: ${userId} (${deviceId})`)

    // 📦 Multi-device rooms
    socket.join(`user:${userId}`)
    socket.join(`device:${userId}:${deviceId}`)

    // 📜 LOAD HISTORY
    socket.on('loadHistory', async ({ withUser }, callback) => {
      try {
        const messages = await getMessages(userId, withUser)
        callback({ success: true, messages })
      } catch {
        callback({ success: false })
      }
    })

    // 💬 SEND MESSAGE
    socket.on('sendMessage', async (data, callback) => {
      try {
        const { to, content, assistantType } = data

        if (!content || !to)
          return callback({ success: false })

        // 💾 Save message
        await saveMessage(userId, to, content)

        // 📡 Emit to recipient devices
        io.to(`user:${to}`).emit('message', {
          senderId: userId,
          content
        })

        // 🔁 Self-sync to other devices
        socket.to(`user:${userId}`).emit('message', {
          senderId: userId,
          content
        })

        callback({ success: true })

        // 🤖 If AI
        if (to === AI_USER_ID) {
          await handleAIMessage(io, userId, content, assistantType)
        }

      } catch (err) {
        callback({ success: false })
      }
    })

    // 🔐 DEVICE REVOKE SYNC CHECK
    socket.on('checkDeviceStatus', async (callback) => {
      const result = await pool.query(
        `SELECT revoked_at FROM devices WHERE id=$1`,
        [deviceId]
      )
      callback({
        revoked: result.rows[0]?.revoked_at ? true : false
      })
    })

    socket.on('disconnect', () => {
      console.log(`❌ Disconnected: ${userId}`)
    })
  })
}
