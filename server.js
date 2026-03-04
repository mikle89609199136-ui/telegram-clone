import express from 'express'
import http from 'http'
import dotenv from 'dotenv'
import helmet from 'helmet'
import compression from 'compression'
import cors from 'cors'
import morgan from 'morgan'
import rateLimit from 'express-rate-limit'
import { Server } from 'socket.io'
import path from 'path'
import { fileURLToPath } from 'url'

import authRoutes from './auth.js'
import initSocket from './index.js'
import { initDB } from './data.js'

dotenv.config()

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const app = express()
const server = http.createServer(app)

await initDB()

app.use(helmet())
app.use(compression())
app.use(cors())
app.use(express.json({ limit: '10mb' }))
app.use(morgan('dev'))

app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 500
}))

app.use('/api/auth', authRoutes)

app.use(express.static(path.join(__dirname, 'public')))

app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date() })
})

const io = new Server(server, {
  cors: { origin: '*' }
})

initSocket(io)

const PORT = process.env.PORT || 3000

server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`)
})
