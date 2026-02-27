const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const CryptoJS = require('crypto-js');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, { cors: { origin: "*" } });

app.use(cors());
app.use(express.json());
app.use(express.static('.'));

const PORT = process.env.PORT || 3000;
const DATA_DIR = './data';
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const files = {
    users: path.join(DATA_DIR, 'users.json'),
    chats: path.join(DATA_DIR, 'chats.json'),
    messages: path.join(DATA_DIR, 'messages.json'),
    recovery: path.join(DATA_DIR, 'recovery.json'),
    blocks: path.join(DATA_DIR, 'blocks.json')
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

const JWT_SECRET = 'ZhuravlevPro2026Secret!';
const ENCRYPTION_KEY = 'ZhuravlevPro2026!@#';

// 🚀 Health Check
app.get('/health', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

// 📱 Главная страница
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'chat.html')));

// 🔐 Middleware авторизации
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Access denied' });
    
    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ error: 'Invalid token' });
        req.user = user; next();
    });
};

// 📝 Регистрация
app.post('/api/register', async (req, res) => {
    const { email, username, password } = req.body;
    
    if (users.find(u => u.email === email || u.username === username)) {
        return res.json({ error: 'Пользователь уже существует' });
    }
    
    const hashedPassword = await bcrypt.hash(password, 12);
    const userId = Date.now().toString();
    const user = {
        id: userId, email, username: username.replace('@', ''),
        name: username.split(' ')[0], password: hashedPassword,
        avatar: `https://ui-avatars.com/api/?name=${username}&background=34c759&color=fff&size=128`,
        settings: {
            notifications: true, theme: 'light', language: 'ru',
            privacy: { lastSeen: 'all', photo: 'all' }, phone: '', birthday: ''
        },
        created: new Date().toISOString()
    };
    
    users.push(user); writeJson(files.users, users);
    
    // Приветственный чат
    const welcomeChat = {
        id: `welcome_${userId}`, name: 'Zhuravlev Bot', type: 'service',
        userId: userId, members: [userId], lastMessage: 'Welcome to Zhuravlev Messenger! 🎉',
        lastTime: new Date().toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'}),
        unread: 1, pinned: true, lastAuthor: 'bot'
    };
    chats.push(welcomeChat); writeJson(files.chats, chats);
    
    const token = jwt.sign({ id: userId }, JWT_SECRET, { expiresIn: '1y' });
    res.json({ success: true, token, user });
});

// 🔑 Вход
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    const user = users.find(u => u.username === username);
    
    if (!user || !await bcrypt.compare(password, user.password)) {
        return res.json({ error: 'Неверный логин или пароль' });
    }
    
    const token = jwt.sign({ id: user.id }, JWT_SECRET, { expiresIn: '1y' });
    res.json({ success: true, token, user });
});

// 🔢 OTP код
app.post('/api/send-otp', (req, res) => {
    const { email } = req.body;
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expires = Date.now() + 5 * 60 * 1000; // 5 минут
    
    recoveryCodes = recoveryCodes.filter(r => r.email !== email);
    recoveryCodes.push({ email, code, expires });
    writeJson(files.recovery, recoveryCodes);
    
    // TODO: Отправка на реальный email
    console.log(`🔢 OTP ${code} для ${email}`);
    res.json({ success: true });
});

app.post('/api/verify-otp', (req, res) => {
    const { email, code } = req.body;
    const record = recoveryCodes.find(r => 
        r.email === email && r.code === code && Date.now() < r.expires
    );
    res.json({ success: !!record });
});

app.post('/api/reset-password', async (req, res) => {
    const { email, newPassword } = req.body;
    const user = users.find(u => u.email === email);
    if (!user) return res.json({ error: 'Пользователь не найден' });
    
    user.password = await bcrypt.hash(newPassword, 12);
    writeJson(files.users, users);
    res.json({ success: true });
});

// 📋 Чаты
app.get('/api/chats', authenticateToken, (req, res) => {
    const userChats = chats.filter(c => c.userId === req.user.id || c.members?.includes(req.user.id));
    res.json(userChats);
});

// 💬 Сообщения
app.get('/api/messages/:chatId', authenticateToken, (req, res) => {
    if (!chats.find(c => c.id === req.params.chatId && 
        (c.userId === req.user.id || c.members?.includes(req.user.id)))) {
        return res.status(403).json({ error: 'Access denied' });
    }
    
    const chatMessages = messages.filter(m => m.chatId === req.params.chatId);
    res.json(chatMessages.sort((a, b) => new Date(a.time) - new Date(b.time)));
});

// 📶 Socket.IO
io.on('connection', (socket) => {
    socket.on('message', (data) => {
        const message = {
            id: Date.now().toString(),
            chatId: data.chatId,
            userId: data.userId,
            name: data.name,
            text: data.text, // Уже зашифровано на клиенте
            time: new Date().toISOString(),
            read: false
        };
        
        messages.push(message);
        writeJson(files.messages, messages);
        
        const chat = chats.find(c => c.id === data.chatId);
        if (chat) {
            chat.lastMessage = data.text.substring(0, 30);
            chat.lastTime = new Date().toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'});
            chat.lastAuthor = data.userId;
            chat.unread = (chat.unread || 0) + 1;
            writeJson(files.chats, chats);
        }
        
        io.emit('message', message);
    });
});

server.listen(PORT, () => {
    console.log(`🚀 Telegram Pro v20.0: http://localhost:${PORT}`);
    console.log(`✅ Health: http://localhost:${PORT}/health`);
});
