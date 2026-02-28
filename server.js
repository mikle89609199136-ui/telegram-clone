require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const path = require('path');
const fs = require('fs-extra');
const socketIo = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, { cors: { origin: '*' } });

const PORT = process.env.PORT || 3000;

// Создаём папки для данных
const DATA_DIR = path.join(__dirname, 'data');
fs.ensureDirSync(DATA_DIR);

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Маршруты
app.get('/health', (req, res) => res.json({ status: 'OK', version: '10.0' }));

// Все остальные запросы отдаём фронтенд
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'chat.html'));
});

// Socket.IO для будущих реалтайм-функций
io.on('connection', (socket) => {
  console.log('New client connected');
  socket.on('disconnect', () => console.log('Client disconnected'));
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});
