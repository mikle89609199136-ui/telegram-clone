const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const nodemailer = require('nodemailer');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, { cors: { origin: "*" } });

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// Railway config
const PORT = process.env.PORT || 3000;
const DATA_DIR = './data';

if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

const dataFiles = {
    users: path.join(DATA_DIR, 'users.json'),
    chats: path.join(DATA_DIR, 'chats.json'),
    messages: path.join(DATA_DIR, 'messages.json'),
    recovery: path.join(DATA_DIR, 'recovery.json')
};

Object.values(dataFiles).forEach(file => {
    if (!fs.existsSync(file)) {
        fs.writeFileSync(file, '[]');
    }
});

const readData = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const writeData = (file, data) => fs.writeFileSync(file, JSON.stringify(data, null, 2));

// Email transporter (для production используй реальные SMTP настройки)
const transporter = nodemailer.createTransporter({
    jsonTransport: true // Только логирование для демо
});

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

// Главная страница
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// API Регистрация/Вход
app.post('/api/register', async (req, res) => {
    const { email, username, password } = req.body;
    
    let users = readData(dataFiles.users);
    
    if (users.find(u => u.email === email || u.username === username)) {
        return res.status(400).json({ error: 'Пользователь уже существует' });
    }
    
    const hashedPassword = await bcrypt.hash(password, 10);
    const user = {
        id: Date.now().toString(),
        email,
        username,
        password: hashedPassword,
        name: username.split('@')[0],
        avatarColor: `hsl(${Math.random() * 360}, 70%, 60%)`,
        created: new Date().toISOString(),
        settings: { notifications: true, theme: 'light', language: 'ru' }
    };
    
    users.push(user);
    writeData(dataFiles.users, users);
    
    res.json({ 
        success: true, 
        token: Buffer.from(JSON.stringify({ id: user.id, username: user.username })).toString('base64'),
        user 
    });
});

app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    let users = readData(dataFiles.users);
    
    const user = users.find(u => u.username === username || u.email === username);
    if (!user || !await bcrypt.compare(password, user.password)) {
        return res.status(400).json({ error: 'Неверные данные' });
    }
    
    res.json({ 
        success: true,
        token: Buffer.from(JSON.stringify({ id: user.id, username: user.username })).toString('base64'),
        user 
    });
});

// Отправка кода восстановления (лог в консоль для демо)
app.post('/api/send-code', (req, res) => {
    const { email } = req.body;
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    
    // Сохраняем код
    let recovery = readData(dataFiles.recovery);
    recovery = recovery.filter(r => r.email !== email);
    recovery.push({ email, code, expires: Date.now() + 5 * 60 * 1000 });
    writeData(dataFiles.recovery, recovery);
    
    console.log(`💌 Код ${code} отправлен на ${email}`);
    
    // Имитация отправки email
    transporter.sendMail({
        from: 'no-reply@zhuravlev-telegram.pro',
        to: email,
        subject: 'Код подтверждения',
        text: `Ваш код: ${code}`
    }, (err, info) => {
        if (err) console.error('Email error:', err);
    });
    
    res.json({ success: true, code }); // Для демо возвращаем код
});

app.post('/api/verify-code', (req, res) => {
    const { email, code } = req.body;
    let recovery = readData(dataFiles.recovery);
    
    const record = recovery.find(r => r.email === email && r.code === code && Date.now() < r.expires);
    if (record) {
        res.json({ success: true });
    } else {
        res.status(400).json({ error: 'Неверный или просроченный код' });
    }
});

app.post('/api/reset-password', async (req, res) => {
    const { email, newPassword } = req.body;
    let users = readData(dataFiles.users);
    
    const user = users.find(u => u.email === email);
    if (!user) return res.status(400).json({ error: 'Пользователь не найден' });
    
    user.password = await bcrypt.hash(newPassword, 10);
    writeData(dataFiles.users, users);
    
    res.json({ success: true });
});

// API Чаты и сообщения
app.get('/api/chats', (req, res) => {
    const chats = readData(dataFiles.chats);
    res.json(chats);
});

app.get('/api/messages/:chatId', (req, res) => {
    const messages = readData(dataFiles.messages).filter(m => m.chatId === req.params.chatId);
    res.json(messages.sort((a, b) => new Date(a.time) - new Date(b.time)));
});

// Создание чата
app.post('/api/chats', (req, res) => {
    const { name, userId } = req.body;
    let chats = readData(dataFiles.chats);
    
    const chat = {
        id: Date.now().toString(),
        name,
        userId,
        created: new Date().toISOString(),
        lastMessage: '',
        lastTime: '',
        unread: 0,
        readStatus: '',
        pinned: false
    };
    
    chats.push(chat);
    writeData(dataFiles.chats, chats);
    res.json(chat);
});

// Socket.io
io.on('connection', (socket) => {
    console.log('👤 Пользователь подключился:', socket.id);
    
    socket.on('message', (data) => {
        const message = {
            id: Date.now().toString(),
            chatId: data.chatId,
            userId: data.userId,
            name: data.name,
            text: data.text,
            time: new Date().toISOString(),
            read: false
        };
        
        let messages = readData(dataFiles.messages);
        messages.push(message);
        writeData(dataFiles.messages, messages);
        
        // Обновляем чат
        let chats = readData(dataFiles.chats);
        const chat = chats.find(c => c.id === data.chatId);
        if (chat) {
            chat.lastMessage = data.text.substring(0, 50);
            chat.lastTime = new Date().toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'});
            writeData(dataFiles.chats, chats);
        }
        
        // Рассылаем всем в чате
        io.emit('message', message);
        io.emit('chats');
    });
    
    socket.on('disconnect', () => {
        console.log('👤 Пользователь отключился:', socket.id);
    });
});

server.listen(PORT, () => {
    console.log(`🚀 Zhuravlev Telegram Pro v16.0 запущен на порту ${PORT}`);
    console.log(`📱 Главная: http://localhost:${PORT}`);
    console.log(`✅ Railway готов: /health`);
});
