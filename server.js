const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');

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
    recovery: path.join(DATA_DIR, 'recovery.json')
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

const JWT_SECRET = 'ZhuravlevTelegramPro2026!@#';

// Gmail Transporter
const transporter = nodemailer.createTransporter({
    service: 'gmail',
    auth: {
        user: 'your-gmail@gmail.com', // ← ЗАМЕНИ НА СВОЙ GMAIL
        pass: 'your-app-password'     // ← App Password из Google
    }
});

// Health
app.get('/health', (req, res) => res.json({ status: 'OK', users: users.length }));

// Main page
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'chat.html')));

// REGISTER
app.post('/api/register', async (req, res) => {
    const { email, username, password } = req.body;
    
    if (users.find(u => u.email === email || u.username === username)) {
        return res.json({ success: false, error: 'User exists' });
    }

    const hashedPassword = await bcrypt.hash(password, 12);
    const userId = Date.now().toString();
    
    const user = {
        id: userId, email, username: username.replace('@', ''),
        name: username.split(' ')[0], password: hashedPassword,
        avatar: `https://ui-avatars.com/api/?name=${username}&background=34c759&color=fff`,
        created: new Date().toISOString()
    };
    
    users.push(user);
    writeJson(files.users, users);

    // Welcome chat
    chats.push({
        id: `welcome_${userId}`, name: 'Zhuravlev Bot', type: 'service',
        members: [userId], lastMessage: 'Welcome to Zhuravlev Messenger! 🎉',
        lastTime: new Date().toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'}),
        unread: 1, pinned: true
    });
    writeJson(files.chats, chats);

    const token = jwt.sign({ id: userId }, JWT_SECRET, { expiresIn: '365d' });
    res.json({ success: true, token, user });
});

// LOGIN
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    const user = users.find(u => u.username === username);
    
    if (!user || !await bcrypt.compare(password, user.password)) {
        return res.json({ success: false, error: 'Invalid credentials' });
    }
    
    const token = jwt.sign({ id: user.id }, JWT_SECRET, { expiresIn: '365d' });
    res.json({ success: true, token, user });
});

// OTP
app.post('/api/send-otp', async (req, res) => {
    const { email } = req.body;
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expires = Date.now() + 5 * 60 * 1000;
    
    recoveryCodes = recoveryCodes.filter(r => r.email !== email);
    recoveryCodes.push({ email, code, expires });
    writeJson(files.recovery, recoveryCodes);

    // Send real email
    await transporter.sendMail({
        from: 'Zhuravlev Messenger <your-gmail@gmail.com>',
        to: email,
        subject: 'Your Recovery Code',
        html: `<h2>Your 6-digit code: <b>${code}</b></h2><p>Valid for 5 minutes.</p>`
    });

    res.json({ success: true });
});

app.post('/api/verify-otp', (req, res) => {
    const { email, code } = req.body;
    const record = recoveryCodes.find(r => r.email === email && r.code === code && Date.now() < r.expires);
    res.json({ success: !!record });
});

app.post('/api/reset-password', async (req, res) => {
    const { email, newPassword } = req.body;
    const user = users.find(u => u.email === email);
    if (!user) return res.json({ success: false, error: 'User not found' });
    
    user.password = await bcrypt.hash(newPassword, 12);
    writeJson(files.users, users);
    res.json({ success: true });
});

// API
app.get('/api/chats', (req, res) => {
    res.json(chats);
});

app.get('/api/messages/:chatId', (req, res) => {
    const chatMessages = messages.filter(m => m.chatId === req.params.chatId);
    res.json(chatMessages);
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
            read: false
        };
        
        messages.push(message);
        writeJson(files.messages, messages);
        
        io.emit('message', message);
    });
});

server.listen(PORT, () => {
    console.log(`🚀 Telegram Pro v21.0 on port ${PORT}`);
});
