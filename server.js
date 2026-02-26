const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, { 
    cors: { origin: "*", methods: ["GET", "POST"] } 
});

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const users = {};

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.post('/send-code', (req, res) => {
    console.log(`🔑 Код для ${req.body.email}: 123456`);
    res.json({ success: true });
});

app.post('/verify-code', (req, res) => {
    if (req.body.code === '123456') {
        res.json({ success: true, userId: Date.now().toString() });
    } else {
        res.json({ success: false });
    }
});

io.on('connection', (socket) => {
    console.log('👤 Подключился:', socket.id);
    
    socket.on('register', (userData) => {
        users[socket.id] = userData;
        io.emit('users-update', users);
    });

    socket.on('message', (data) => {
        const message = { 
            from: socket.id.slice(-4),
            text: data.text,
            time: new Date().toLocaleString('ru-RU', { hour: '2-digit', minute: '2-digit' })
        };
        socket.broadcast.emit('new-message', message);
    });

    socket.on('private-message', (data) => {
        const message = {
            fromUser: socket.id.slice(-4),
            fromSocket: socket.id,
            text: data.text,
            time: new Date().toLocaleString('ru-RU', { hour: '2-digit', minute: '2-digit' })
        };
        io.to(data.to).emit('private-message', message);
        socket.emit('private-message', message);
    });

    socket.on('disconnect', () => {
        delete users[socket.id];
        io.emit('users-update', users);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Сервер на ${PORT}`);
});
