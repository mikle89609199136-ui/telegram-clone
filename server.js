const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, { cors: { origin: "*" } });

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// Фейковая авторизация (код всегда 123456)
app.post('/send-code', (req, res) => {
    console.log(`🔑 Код для ${req.body.email}: 123456`);
    res.json({ success: true });
});

app.post('/verify-code', (req, res) => {
    if (req.body.code === '123456') {
        res.json({ success: true, userId: Date.now() });
    } else {
        res.json({ success: false });
    }
});

// Чат
const rooms = {};
io.on('connection', (socket) => {
    socket.on('message', ({ toUserId, text }) => {
        const message = { 
            id: Date.now(), 
            from: socket.id.slice(-4), 
            text, 
            time: new Date().toLocaleString('ru') 
        };
        io.emit('new-message', message);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 Telegram на порту ${PORT}`);
    console.log(`Открой: http://localhost:${PORT}`);
});
