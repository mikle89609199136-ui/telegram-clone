const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, { cors: { origin: "*" } });

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const PORT = process.env.PORT || 3000;
const DATA_DIR = './data';
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const files = {
    users: path.join(DATA_DIR, 'users.json'),
    chats: path.join(DATA_DIR, 'chats.json'),
    messages: path.join(DATA_DIR, 'messages.json'),
    recovery: path.join(DATA_DIR, 'recovery.json'),
    blocks: path.join(DATA_DIR, 'blocks.json'),
    folders: path.join(DATA_DIR, 'folders.json')
};

Object.values(files).forEach(file => {
    if (!fs.existsSync(file)) fs.writeFileSync(file, '[]');
});

const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8') || '[]');
const writeJson = (file, data) => fs.writeFileSync(file, JSON.stringify(data, null, 2));

let users = readJson(files.users);
let chats = readJson(files.chats);
let messages = readJson(files.messages);
let recoveryCodes = readJson(files.recovery);
let blocks = readJson(files.blocks);
let folders = readJson(files.folders) || [{ id: 'all', name: 'Все', chats: [] }];

// Health check для Railway
app.get('/health', (req, res) => res.json({ status: 'ok', users: users.length }));

// Главная страница - Telegram Pro интерфейс
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

// API Регистрация
app.post('/api/register', async (req, res) => {
    const { email, username, password } = req.body;
    
    if (users.find(u => u.email === email || u.username === username)) {
        return res.json({ error: 'Пользователь уже существует' });
    }
    
    const hashed = await bcrypt.hash(password, 12);
    const user = {
        id: Date.now().toString(),
        email, 
        username: username.replace('@', ''),
        name: username.split(' ')[0],
        password: hashed,
        avatar: `https://ui-avatars.com/api/?name=${username}&background=34c759&color=fff`,
        created: new Date().toISOString(),
        settings: {
            notifications: true,
            theme: 'blue',
            language: 'ru',
            privacy: { lastSeen: 'all', photo: 'all' },
            phone: '',
            birthday: ''
        }
    };
    
    users.push(user);
    writeJson(files.users, users);
    
    // Авто-создаем приветственный чат
    const welcomeChat = {
        id: 'welcome_' + Date.now(),
        name: 'Telegram Pro',
        type: 'service',
        userId: user.id,
        created: new Date().toISOString(),
        lastMessage: 'Добро пожаловать в Telegram Pro! 🎉',
        lastTime: new Date().toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'}),
        unread: 1,
        pinned: true,
        members: [user.id]
    };
    chats.push(welcomeChat);
    writeJson(files.chats, chats);
    
    const token = Buffer.from(JSON.stringify({ id: user.id, exp: Date.now() + 365*24*60*60*1000 })).toString('base64');
    res.json({ success: true, token, user });
});

// API Login
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    const user = users.find(u => u.username === username);
    
    if (!user || !await bcrypt.compare(password, user.password)) {
        return res.json({ error: 'Неверный логин или пароль' });
    }
    
    const token = Buffer.from(JSON.stringify({ id: user.id, exp: Date.now() + 365*24*60*60*1000 })).toString('base64');
    res.json({ success: true, token, user });
});

// API Forgot Password + OTP
app.post('/api/send-otp', (req, res) => {
    const { email } = req.body;
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    
    recoveryCodes = recoveryCodes.filter(r => r.email !== email);
    recoveryCodes.push({ email, code, expires: Date.now() + 5*60*1000 });
    writeJson(files.recovery, recoveryCodes);
    
    console.log(`🔢 OTP ${code} для ${email}`);
    res.json({ success: true });
});

app.post('/api/verify-otp', (req, res) => {
    const { email, code } = req.body;
    const record = recoveryCodes.find(r => r.email === email && r.code === code && Date.now() < r.expires);
    
    if (record) {
        res.json({ success: true });
    } else {
        res.json({ error: 'Неверный код' });
    }
});

app.post('/api/reset-password', async (req, res) => {
    const { email, password } = req.body;
    const user = users.find(u => u.email === email);
    
    if (user) {
        user.password = await bcrypt.hash(password, 12);
        writeJson(files.users, users);
        res.json({ success: true });
    } else {
        res.json({ error: 'Пользователь не найден' });
    }
});

// API Чаты
app.get('/api/chats', (req, res) => {
    const userChats = chats.filter(c => c.members.includes(getUserId(req)));
    res.json(userChats);
});

app.post('/api/chats', (req, res) => {
    const chat = {
        id: Date.now().toString(),
        name: req.body.name,
        type: req.body.type || 'private',
        userId: getUserId(req),
        members: req.body.members || [getUserId(req)],
        created: new Date().toISOString(),
        lastMessage: '',
        lastTime: '',
        unread: 0,
        pinned: false,
        notifications: true
    };
    chats.push(chat);
    writeJson(files.chats, chats);
    res.json(chat);
});

function getUserId(req) {
    const token = req.headers.authorization?.split(' ')[1];
    if (token) {
        try {
            return JSON.parse(Buffer.from(token, 'base64')).id;
        } catch {}
    }
    return null;
}

app.get('/api/messages/:chatId', (req, res) => {
    const chatMessages = messages.filter(m => m.chatId === req.params.chatId);
    res.json(chatMessages.sort((a, b) => new Date(a.time) - new Date(b.time)));
});

// Socket.IO
io.on('connection', (socket) => {
    socket.on('message', (data) => {
        const message = {
            id: Date.now().toString(),
            chatId: data.chatId,
            userId: data.userId,
            name: data.name,
            text: data.text,
            time: new Date().toISOString(),
            read: false,
            edited: false
        };
        
        messages.push(message);
        writeJson(files.messages, messages);
        
        const chat = chats.find(c => c.id === data.chatId);
        if (chat) {
            chat.lastMessage = data.text.substring(0, 30);
            chat.lastTime = new Date().toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'});
            writeJson(files.chats, chats);
        }
        
        io.emit('message', message);
        io.emit('chats-update');
    });
});

server.listen(PORT, () => {
    console.log(`🚀 Telegram Pro v18.0 на порту ${PORT}`);
});
