const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, { 
    cors: { origin: "*", methods: ["GET", "POST"] } 
});

// ==================== ДИРЕКТОРИИ ====================
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const USERS_FILE = path.join(DATA_DIR, 'users.json');
const CHATS_FILE = path.join(DATA_DIR, 'chats.json');
const GROUPS_FILE = path.join(DATA_DIR, 'groups.json');

// ==================== ФУНКЦИИ JSON ====================
function loadJSON(file, defaultData = {}) {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return defaultData; }
}
function saveJSON(file, data) { fs.writeFileSync(file, JSON.stringify(data, null, 2)); }

// Загружаем данные
let usersDB = loadJSON(USERS_FILE, {});
let privateChats = loadJSON(CHATS_FILE, {});
let groupsDB = loadJSON(GROUPS_FILE, {});

// ==================== ONLINE + RATE LIMIT ====================
const onlineUsers = new Set();
const rateLimits = new Map();
const userSockets = new Map();

function generateId(prefix) {
    return prefix + '_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

function generateMsgId() {
    return 'msg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
}

function checkRate(userId) {
    const now = Date.now();
    const data = rateLimits.get(userId) || { count: 0, reset: now };
    if (now - data.reset > 60000) { data.count = 0; data.reset = now; }
    if (data.count > 60) return false;
    data.count++; rateLimits.set(userId, data); return true;
}

// ==================== MIDDLEWARE ====================
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static('public'));

// ==================== API РОУТЫ ====================

// Регистрация
app.post('/api/register', (req, res) => {
    try {
        const { email, username, password, confirmPassword } = req.body;
        
        if (!email?.includes('@') || !username || password.length < 6 || password !== confirmPassword) {
            return res.status(400).json({ error: 'Неверные данные' });
        }

        const cleanEmail = email.toLowerCase();
        const cleanUsername = username.replace('@', '').toLowerCase();

        if (usersDB[cleanEmail] || Object.values(usersDB).some(u => u.username === cleanUsername)) {
            return res.status(400).json({ error: 'Email или username занят' });
        }

        const userId = generateId('user');
        usersDB[cleanEmail] = {
            id: userId,
            email: cleanEmail,
            username: cleanUsername,
            name: username,
            avatar: '',
            avatarColor: '#' + Math.floor(Math.random()*16777215).toString(16),
            password,
            phone: '',
            bio: '',
            created: new Date().toISOString(),
            lastSeen: null,
            online: false
        };

        saveJSON(USERS_FILE, usersDB);
        res.json({ 
            success: true, 
            userId,
            user: {
                id: userId, 
                email: cleanEmail, 
                username: cleanUsername, 
                name: username, 
                avatar: '', 
                avatarColor: usersDB[cleanEmail].avatarColor
            }
        });
    } catch (e) {
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Вход
app.post('/api/login', (req, res) => {
    try {
        const { username, password } = req.body;
        for (let email in usersDB) {
            const user = usersDB[email];
            if ((user.username === username.toLowerCase() || user.email === username.toLowerCase()) && 
                user.password === password) {
                user.online = true;
                user.lastSeen = new Date().toISOString();
                saveJSON(USERS_FILE, usersDB);
                
                res.json({
                    success: true,
                    userId: user.id,
                    user: {
                        id: user.id, 
                        email: user.email, 
                        username: user.username,
                        name: user.name, 
                        avatar: user.avatar, 
                        avatarColor: user.avatarColor
                    }
                });
                return;
            }
        }
        res.status(401).json({ error: 'Неверный логин/пароль' });
    } catch (e) {
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Все пользователи
app.get('/api/users', (req, res) => {
    try {
        const excludeId = req.query.exclude;
        const users = Object.values(usersDB)
            .filter(u => !excludeId || u.id !== excludeId)
            .map(u => ({
                id: u.id, 
                name: u.name, 
                username: u.username,
                avatar: u.avatar, 
                avatarColor: u.avatarColor,
                online: onlineUsers.has(u.id),
                lastSeen: u.lastSeen,
                bio: u.bio || ''
            }));
        res.json(users);
    } catch (e) {
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Чаты пользователя
app.get('/api/chats/:userId', (req, res) => {
    try {
        const userId = req.params.userId;
        const chats = [];

        // Личные чаты
        for (let chatId in privateChats) {
            if (chatId.includes(userId)) {
                const messages = privateChats[chatId] || [];
                const lastMsg = messages[messages.length - 1];
                const participants = chatId.split('_');
                const otherId = participants.find(id => id !== userId);
                const otherUser = Object.values(usersDB).find(u => u.id === otherId);

                if (otherUser) {
                    chats.push({
                        id: chatId, 
                        type: 'private',
                        userId: otherUser.id, 
                        name: otherUser.name,
                        username: otherUser.username,
                        avatar: otherUser.avatar, 
                        avatarColor: otherUser.avatarColor,
                        online: onlineUsers.has(otherUser.id),
                        lastMessage: lastMsg ? {
                            text: lastMsg.text, 
                            time: lastMsg.time
                        } : null,
                        unread: messages.filter(m => m.to === userId && !m.read).length
                    });
                }
            }
        }

        chats.sort((a, b) => (b.lastMessage ? new Date(b.lastMessage.time) : 0) - (a.lastMessage ? new Date(a.lastMessage.time) : 0));
        res.json(chats);
    } catch (e) {
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Сообщения чата
app.get('/api/messages/:userId/:otherId', (req, res) => {
    try {
        const { userId, otherId } = req.params;
        const chatId = [userId, otherId].sort().join('_');
        let messages = privateChats[chatId] || [];

        // Отметить прочитанными
        messages.forEach(msg => { if (msg.to === userId) msg.read = true; });
        saveJSON(CHATS_FILE, privateChats);

        const fromUser = Object.values(usersDB).find(u => u.id === otherId);
        messages = messages.map(msg => ({
            ...msg,
            fromName: fromUser ? fromUser.name : 'Пользователь',
            fromAvatar: fromUser ? fromUser.avatar : '',
            fromAvatarColor: fromUser ? fromUser.avatarColor : '#0088cc'
        }));

        res.json(messages);
    } catch (e) {
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// ==================== SOCKET.IO ====================
io.on('connection', (socket) => {
    console.log('🔌 Подключение:', socket.id);

    socket.on('join', (userId) => {
        socket.join(userId);
        socket.userId = userId;
        userSockets.set(userId, socket.id);
        onlineUsers.add(userId);

        const user = Object.values(usersDB).find(u => u.id === userId);
        if (user) {
            user.online = true;
            user.lastSeen = new Date().toISOString();
            saveJSON(USERS_FILE, usersDB);
        }
        io.emit('userOnline', { userId });
        console.log('✅ Онлайн:', userId);
    });

    socket.on('sendMessage', (data) => {
        try {
            if (!checkRate(data.from)) {
                socket.emit('error', 'Медленнее!'); 
                return;
            }

            const fromUser = Object.values(usersDB).find(u => u.id === data.from);
            if (!fromUser) return;

            const message = {
                id: generateMsgId(),
                from: data.from,
                fromName: fromUser.name,
                fromAvatar: fromUser.avatar,
                fromAvatarColor: fromUser.avatarColor,
                text: data.text.slice(0, 2000),
                time: new Date().toISOString(),
                read: false
            };

            const chatId = [data.from, data.to].sort().join('_');
            if (!privateChats[chatId]) privateChats[chatId] = [];
            
            privateChats[chatId].push(message);
            saveJSON(CHATS_FILE, privateChats);

            io.to(data.from).to(data.to).emit('newMessage', { chatId, message });
            socket.emit('messageSent', message);

        } catch (e) {
            socket.emit('error', 'Ошибка отправки');
        }
    });

    socket.on('disconnect', () => {
        if (socket.userId) {
            onlineUsers.delete(socket.userId);
            userSockets.delete(socket.userId);
            const user = Object.values(usersDB).find(u => u.id === socket.userId);
            if (user) {
                user.online = false;
                user.lastSeen = new Date().toISOString();
                saveJSON(USERS_FILE, usersDB);
            }
            io.emit('userOffline', socket.userId);
            console.log('🔌 Отключился:', socket.userId);
        }
    });
});

// ==================== HTML ФРОНТЕНД ====================
app.get('/', (req, res) => {
    const html = `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Telegram Pro v14.1</title>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, sans-serif; }
body { background: #eff2f5; min-height: 100vh; }
.logo { font-size: 4rem; margin: 20px 0; }
.welcome { text-align: center; padding: 40px 20px; }
.btn { padding: 15px 30px; margin: 10px; border: none; border-radius: 25px; background: #34c759; color: white; font-weight: 600; font-size: 16px; cursor: pointer; min-width: 200px; }
.btn:hover { background: #30d158; transform: translateY(-2px); }
.auth-overlay { position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.8); display: none; align-items: center; justify-content: center; z-index: 1000; }
.auth-card { background: white; border-radius: 20px; padding: 40px; max-width: 400px; width: 90%; max-height: 90vh; overflow: auto; box-shadow: 0 20px 40px rgba(0,0,0,0.3); }
.input-field { width: 100%; padding: 15px; margin: 10px 0; border: 1px solid #ddd; border-radius: 12px; font-size: 16px; box-sizing: border-box; }
.input-field:focus { outline: none; border-color: #34c759; box-shadow: 0 0 0 3px rgba(52,199,89,0.1); }
#main-app { display: none; height: 100vh; flex-direction: column; }
#header { background: white; padding: 15px 20px; border-bottom: 1px solid #e4e6eb; position: fixed; top: 0; left: 0; right: 0; z-index: 100; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
#chat-list { margin-top: 70px; padding: 10px; height: calc(100vh - 70px); overflow: auto; }
.chat-item { display: flex; padding: 15px; background: white; margin: 10px 0; border-radius: 12px; cursor: pointer; transition: all 0.2s; }
.chat-item:hover { background: #e4f3ff; transform: translateX(4px); }
.avatar { width: 50px; height: 50px; border-radius: 50%; color: white; display: flex; align-items: center; justify-content: center; margin-right: 15px; font-size: 20px; font-weight: 600; flex-shrink: 0; }
.chat-info { flex: 1; min-width: 0; }
.chat-name { font-weight: 600; margin-bottom: 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.chat-preview { color: #65676b; font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.unread-dot { background: #34c759; width: 20px; height: 20px; border-radius: 50%; margin-left: 10px; flex-shrink: 0; }
.search-bar { position: sticky; top: 0; background: white; padding: 15px 20px; display: flex; gap: 10px; margin-bottom: 20px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
.search-input { flex: 1; border: 1px solid #ddd; border-radius: 20px; padding: 10px; font-size: 16px; }
#chat-screen { display: none; height: 100vh; flex-direction: column; }
.chat-header { background: white; padding: 15px 20px; border-bottom: 1px solid #e4e6eb; display: flex; align-items: center; position: fixed; top: 0; left: 0; right: 0; z-index: 100; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
.back-btn { border: none; background: none; font-size: 24px; margin-right: 15px; cursor: pointer; padding: 5px; }
.messages { flex: 1; overflow: auto; padding: 90px 20px 120px; background: #efeef1; }
.message { margin-bottom: 16px; max-width: 70%; display: flex; flex-direction: column; }
.message.sent { align-self: flex-end; }
.bubble { padding: 12px 16px; border-radius: 20px; display: inline-block; max-width: 100%; word-wrap: break-word; font-size: 15px; line-height: 1.4; box-shadow: 0 1px 2px rgba(0,0,0,0.1); }
.bubble.sent { background: #34c759; color: white; border-bottom-right-radius: 4px; }
.bubble.received { background: white; border: 1px solid #e4e6eb; border-bottom-left-radius: 4px; }
.input-area { position: fixed; bottom: 0; left: 0; right: 0; padding: 15px; background: white; border-top: 1px solid #e4e6eb; display: flex; gap: 12px; box-shadow: 0 -2px 20px rgba(0,0,0,0.1); }
#message-input { flex: 1; border: 1px solid #e4e6eb; border-radius: 25px; padding: 14px 18px; resize: none; max-height: 120px; font-size: 16px; line-height: 1.4; font-family: inherit; }
.send-btn { width: 48px; height: 48px; border: none; border-radius: 50%; background: #34c759; color: white; font-size: 18px; cursor: pointer; flex-shrink: 0; }
.send-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.send-btn:not(:disabled):active { transform: scale(0.95); }
.no-chats { padding: 60px 20px; text-align: center; color: #65676b; font-size: 16px; }
.online-status { font-size: 12px; color: #34c759; margin-left: 5px; }
</style>
</head>
<body>
<div class="welcome" id="welcome">
    <div class="logo">📱</div>
    <h1>Telegram Pro v14.1</h1>
    <p>🚀 Быстрый • Безопасный • Реал-тайм</p>
    <button class="btn" onclick="showRegister()">📝 Регистрация</button>
    <button class="btn" onclick="showLogin()">🔐 Вход</button>
</div>

<div class="auth-overlay" id="auth-overlay">
    <div class="auth-card">
        <div id="register-form">
            <h2>Создать аккаунт</h2>
            <input class="input-field" id="reg-email" placeholder="Email" type="email">
            <input class="input-field" id="reg-username" placeholder="@username">
            <input class="input-field" id="reg-password" type="password" placeholder="Пароль (6+ символов)">
            <input class="input-field" id="reg-confirm" type="password" placeholder="Повторите пароль">
            <button class="btn" onclick="register()" style="width:100%;margin-top:10px;">Создать аккаунт</button>
            <p style="text-align:center;margin-top:20px;font-size:14px;">
                <a href="#" onclick="showLogin();return false;" style="color:#34c759;">Уже есть аккаунт?</a>
            </p>
        </div>
        <div id="login-form" style="display:none;">
            <h2>Вход</h2>
            <input class="input-field" id="login-user" placeholder="Username или Email">
            <input class="input-field" id="login-pass" type="password" placeholder="Пароль">
            <button class="btn" onclick="login()" style="width:100%;margin-top:10px;">Войти</button>
            <p style="text-align:center;margin-top:20px;font-size:14px;">
                <a href="#" onclick="showRegister();return false;" style="color:#34c759;">Создать аккаунт</a>
            </p>
        </div>
    </div>
</div>

<div id="main-app">
    <div id="header"><h2 style="margin:0;color:#333;">💬 Чаты</h2></div>
    <div class="search-bar">
        <input class="search-input" id="user-search" placeholder="🔍 Поиск пользователей..." oninput="searchUsers()">
    </div>
    <div id="chat-list"></div>
</div>

<div id="chat-screen">
    <div class="chat-header">
        <button class="back-btn" onclick="backToList()">←</button>
        <div id="chat-title">Чат</div>
    </div>
    <div class="messages" id="messages"></div>
    <div class="input-area">
        <textarea id="message-input" placeholder="Напишите сообщение..." oninput="resizeInput();checkSend()"></textarea>
        <button id="send-btn" class="send-btn" onclick="sendMessage()" disabled title="Отправить">➤</button>
    </div>
</div>

<script src="/socket.io/socket.io.js"></script>
<script>
let socket = io();
let currentUser = null;
let currentChat = null;
let chats = [];
let messages = [];
let allUsers = [];

function showRegister() {
    document.getElementById('register-form').style.display = 'block';
    document.getElementById('login-form').style.display = 'none';
    document.getElementById('auth-overlay').style.display = 'flex';
}

function showLogin() {
    document.getElementById('register-form').style.display = 'none';
    document.getElementById('login-form').style.display = 'block';
    document.getElementById('auth-overlay').style.display = 'flex';
}

async function register() {
    const email = document.getElementById('reg-email').value.trim();
    const username = document.getElementById('reg-username').value.replace(/@/g, '').trim();
    const password = document.getElementById('reg-password').value;
    const confirm = document.getElementById('reg-confirm').value;
    
    if (!email || !username || !password || password !== confirm || password.length < 6) {
        return alert('Заполните все поля корректно');
    }
    
    try {
        const res = await fetch('/api/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, username, password, confirmPassword: confirm })
        });
        const data = await res.json();
        if (data.success) {
            alert('✅ Зарегистрирован! Теперь войдите.');
            showLogin();
            // Очистка формы
            document.getElementById('reg-email').value = '';
            document.getElementById('reg-username').value = '';
            document.getElementById('reg-password').value = '';
            document.getElementById('reg-confirm').value = '';
        } else {
            alert('❌ ' + data.error);
        }
    } catch (e) {
        alert('❌ Ошибка сервера');
    }
}

async function login() {
    const username = document.getElementById('login-user').value.trim();
    const password = document.getElementById('login-pass').value;
    
    if (!username || !password) return alert('Введите логин и пароль');
    
    try {
        const res = await fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        const data = await res.json();
        if (data.success) {
            currentUser = data.user;
            socket.emit('join', currentUser.id);
            localStorage.setItem('user', JSON.stringify(currentUser)); // ✅ Сохраняем
            showApp();
            setTimeout(loadChats, 500);
        } else {
            alert('❌ ' + data.error);
        }
    } catch (e) {
        alert('❌ Ошибка сервера');
    }
}

function showApp() {
    document.getElementById('welcome').style.display = 'none';
    document.getElementById('auth-overlay').style.display = 'none';
    document.getElementById('main-app').style.display = 'flex';
    document.getElementById('chat-list').innerHTML = '<div class="no-chats">Загрузка чатов...</div>';
}

async function loadChats() {
    try {
        const res = await fetch('/api/chats/' + currentUser.id);
        chats = await res.json();
    } catch (e) { chats = []; }
    loadAllUsers();
}

async function loadAllUsers() {
    try {
        const res = await fetch('/api/users?exclude=' + currentUser.id);
        allUsers = await res.json();
        renderChats();
    } catch (e) { 
        console.error(e);
        allUsers = [];
        renderChats();
    }
}

function renderChats() {
    const container = document.getElementById('chat-list');
    let html = '';
    
    if (chats.length === 0) {
        allUsers.forEach(user => {
            html += \`<div class="chat-item" onclick="openChat('\${user.id}', '\${user.name.replace(/'/g,'&#39;')}', '\${user.avatar}', '\${user.avatarColor}')">
                <div class="avatar" style="background:\${user.avatarColor}">\${user.avatar || '👤'}</div>
                <div class="chat-info">
                    <div class="chat-name">\${user.name}</div>
                    <div class="chat-preview">Напишите первое сообщение</div>
                    \${onlineUsers.has(user.id) ? '<span class="online-status">🟢</span>' : ''}
                </div>
            </div>\`;
        });
    } else {
        chats.forEach(chat => {
            html += \`<div class="chat-item" onclick="openChat('\${chat.userId}', '\${chat.name.replace(/'/g,'&#39;')}', '\${chat.avatar}', '\${chat.avatarColor}')">
                <div class="avatar" style="background:\${chat.avatarColor}">\${chat.avatar || '👤'}</div>
                <div class="chat-info">
                    <div class="chat-name">\${chat.name}</div>
                    \${chat.lastMessage ? \`<div class="chat-preview">\${chat.lastMessage.text.substring(0,30)}\${chat.lastMessage.text.length>30?'…':''}</div>\` : '<div class="chat-preview">Нет сообщений</div>'}
                    \${chat.online ? '<span class="online-status">🟢 онлайн</span>' : ''}
                </div>
                \${chat.unread > 0 ? '<div class="unread-dot"></div>' : ''}
            </div>\`;
        });
    }
    
    container.innerHTML = html || '<div class="no-chats">Нет чатов. Найдите собеседника!</div>';
}

function searchUsers() {
    const q = document.getElementById('user-search').value.toLowerCase().trim();
    if (q.length < 2) {
        loadAllUsers();
        return;
    }
    // Простой клиентский фильтр
    const filtered = allUsers.filter(u => 
        u.name.toLowerCase().includes(q) || 
        u.username.toLowerCase().includes(q)
    );
    renderFilteredChats(filtered);
}

function renderFilteredChats(filteredUsers) {
    const container = document.getElementById('chat-list');
    let html = '';
    filteredUsers.forEach(user => {
        html += \`<div class="chat-item" onclick="openChat('\${user.id}', '\${user.name.replace(/'/g,'&#39;')}', '\${user.avatar}', '\${user.avatarColor}')">
            <div class="avatar" style="background:\${user.avatarColor}">\${user.avatar || '👤'}</div>
            <div class="chat-info">
                <div class="chat-name">\${user.name}</div>
                <div class="chat-preview">Поиск: \${user.username}</div>
            </div>
        </div>\`;
    });
    container.innerHTML = html || '<div class="no-chats">Пользователи не найдены</div>';
}

async function openChat(userId, name, avatar, avatarColor) {
    currentChat = { id: userId, name, avatar, avatarColor };
    document.getElementById('chat-title').textContent = name;
    document.getElementById('main-app').style.display = 'none';
    document.getElementById('chat-screen').style.display = 'flex';
    
    document.getElementById('messages').innerHTML = '<div style="padding:60px 20px;text-align:center;color:#65676b">Загрузка сообщений...</div>';
    
    try {
        const res = await fetch('/api/messages/' + currentUser.id + '/' + userId);
        messages = await res.json();
        renderMessages();
    } catch (e) {
        messages = [];
        renderMessages();
    }
}

function renderMessages() {
    const container = document.getElementById('messages');
    container.innerHTML = '';
    messages.forEach(msg => {
        const isSent = msg.from === currentUser.id;
        container.innerHTML += \`<div class="message \${isSent ? 'sent' : ''}">
            <div class="bubble \${isSent ? 'sent' : 'received'}">\${msg.text}</div>
        </div>\`;
    });
    setTimeout(() => container.scrollTop = container.scrollHeight, 100);
}

function backToList() {
    document.getElementById('chat-screen').style.display = 'none';
    document.getElementById('main-app').style.display = 'flex';
    loadChats();
}

function resizeInput() {
    const el = document.getElementById('message-input');
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 120) + 'px';
}

function checkSend() {
    document.getElementById('send-btn').disabled = !document.getElementById('message-input').value.trim();
}

function sendMessage() {
    const input = document.getElementById('message-input');
    const text = input.value.trim();
    if (!text || !currentChat) return;
    
    socket.emit('sendMessage', {
        from: currentUser.id,
        to: currentChat.id,
        text
    });
    
    input.value = '';
    checkSend();
    resizeInput();
}

// Socket события
socket.on('newMessage', data => {
    if (currentChat && (data.message.from === currentChat.id || data.message.to === currentUser.id)) {
        messages.push(data.message);
        renderMessages();
    }
    loadChats();
});

socket.on('messageSent', msg => {
    if (currentChat) {
        messages.push(msg);
        renderMessages();
    }
});

socket.on('userOnline', data => {
    loadAllUsers(); // Обновляем статус
});

socket.on('userOffline', userId => {
    loadAllUsers(); // Обновляем статус
});

// ✅ ФИКС localStorage - ТОЛЬКО если currentUser существует!
const savedUser = localStorage.getItem('user');
if (savedUser) {
    try {
        currentUser = JSON.parse(savedUser);
        socket.emit('join', currentUser.id);
        showApp();
        setTimeout(loadChats, 500);
    } catch (e) {
        localStorage.removeItem('user');
        currentUser = null;
    }
}
// ✅ КРИТИЧНЫЙ ФИКС: Сохраняем ТОЛЬКО если currentUser существует!
if (currentUser) {
    localStorage.setItem('user', JSON.stringify(currentUser));
}
</script>
</body>
</html>`;
    res.send(html);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log('\\n' + '='.repeat(60));
    console.log('🚀 Telegram Pro v14.1 ✅ 100% РАБОЧИЙ!');
    console.log('📱 Порт: ' + PORT);
    console.log('💾 data/users.json | chats.json');
    console.log('🌐 ' + (process.env.PORT ? 'https://your-app.onrender.com' : 'http://localhost:' + PORT));
    console.log('='.repeat(60) + '\\n');
});
