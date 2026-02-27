const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, { cors: { origin: "*" } });

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Railway ready
const PORT = process.env.PORT || 3000;

// Data directory
const DATA_DIR = './data';
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR);
}

// Data files
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const CHATS_FILE = path.join(DATA_DIR, 'chats.json');
const MESSAGES_FILE = path.join(DATA_DIR, 'messages.json');

// Init data
if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, JSON.stringify([]));
if (!fs.existsSync(CHATS_FILE)) fs.writeFileSync(CHATS_FILE, JSON.stringify([]));
if (!fs.existsSync(MESSAGES_FILE)) fs.writeFileSync(MESSAGES_FILE, JSON.stringify([]));

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const writeJson = (file, data) => fs.writeFileSync(file, JSON.stringify(data, null, 2));

let users = readJson(USERS_FILE);
let chats = readJson(CHATS_FILE);
let messages = readJson(MESSAGES_FILE);

// Health check for Railway
app.get('/health', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

// Serve chat.html
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'chat.html'));
});

// Auth routes
app.post('/register', async (req, res) => {
    const { email, username, password } = req.body;
    if (users.find(u => u.email === email || u.username === username)) {
        return res.status(400).json({ error: 'Пользователь уже существует' });
    }
    const hashed = await bcrypt.hash(password, 10);
    const user = {
        id: Date.now().toString(),
        email, username, password: hashed, name: username.split(' ')[0],
        created: new Date().toISOString()
    };
    users.push(user);
    writeJson(USERS_FILE, users);
    
    const token = jwt.sign({ id: user.id }, 'zhuravlev-secret-2026', { expiresIn: '1y' });
    res.json({ token, user });
});

app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    const user = users.find(u => u.username === username || u.email === username);
    if (!user || !(await bcrypt.compare(password, user.password))) {
        return res.status(400).json({ error: 'Неверные данные' });
    }
    const token = jwt.sign({ id: user.id }, 'zhuravlev-secret-2026', { expiresIn: '1y' });
    res.json({ token, user });
});

// API routes
app.get('/api/chats', (req, res) => {
    res.json(chats);
});

app.get('/api/messages/:chatId', (req, res) => {
    const chatMessages = messages.filter(m => m.chatId === req.params.chatId);
    res.json(chatMessages);
});

// Socket.io
io.on('connection', (socket) => {
    socket.on('join', (userId) => {
        socket.join(userId);
        socket.emit('userId', userId);
    });
    
    socket.on('message', (data) => {
        const msg = {
            id: Date.now().toString(),
            chatId: data.chatId,
            userId: data.userId,
            text: data.text,
            time: new Date().toISOString()
        };
        messages.push(msg);
        writeJson(MESSAGES_FILE, messages);
        
        // Update last message in chat
        const chat = chats.find(c => c.id === data.chatId);
        if (chat) {
            chat.lastMessage = data.text;
            chat.lastTime = new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
            writeJson(CHATS_FILE, chats);
        }
        
        io.to(data.chatId).emit('message', msg);
        io.emit('chats');
    });
});

server.listen(PORT, () => {
    console.log(`🚀 Zhuravlev Telegram Pro запущен на порту ${PORT}`);
});
