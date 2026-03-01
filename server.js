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

// Создаём папку data, если нет
const DATA_DIR = path.join(__dirname, 'data');
fs.ensureDirSync(DATA_DIR);

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Маршруты API
app.use('/api/auth', require('./auth'));
// data.js – вспомогательный модуль, не маршрут
// app.use('/api/data', require('./data')); // ЭТО УДАЛЕНО

// Эндпоинт здоровья
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'OK', version: '12.0' });
});

// Для всех остальных запросов отдаём фронтенд
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'chat.html'));
});

// Socket.IO
require('./index')(io);

// Запуск сервера
server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Сервер запущен на порту ${PORT}`);
});
