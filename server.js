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

// ========================================
// БАЗЫ ДАННЫХ (Telegram PRO v8.0)
// ========================================
const usersDB = {};
const privateMessages = {}; // {userId_chatId: [{from, text, time, read}]}
const groups = {};
const onlineUsers = new Set();
const userSessions = {};
let messageId = 0;

// Telegram темы
const themes = {
    telegram: {bg: '#eff2f5', chatlist: '#f8f9fa', sent: '#34c759', received: '#ffffff'},
    dark: {bg: '#000000', chatlist: '#111111', sent: '#005c73', received: '#1f1f1f'},
    light: {bg: '#ffffff', chatlist: '#f0f2f5', sent: '#007bff', received: '#f1f3f4'}
};

// Rate limiting
const rateLimits = new Map();
function rateLimit(userId) {
    const now = Date.now();
    const data = rateLimits.get(userId) || {count: 0, reset: now};
    if (now - data.reset > 60000) data.count = 0;
    if (data.count > 50) return false;
    data.count++;
    rateLimits.set(userId, data);
    return true;
}

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ========================================
// API АУТЕНТИФИКАЦИЯ (Telegram Style)
// ========================================
app.post('/api/register', (req, res) => {
    const { email, password, username } = req.body;
    
    if (!email.includes('@') || !password || password.length < 6 || !username || usersDB[email]) {
        return res.status(400).json({ error: 'Email или username занят' });
    }
    
    const userId = `user_${Date.now()}_${Math.floor(Math.random()*1000)}`;
    usersDB[email] = { 
        id: userId, 
        email, 
        username: username.toLowerCase(),
        name: username.charAt(0).toUpperCase() + username.slice(1),
        avatar: '👤', 
        password,
        theme: 'telegram',
        online: false,
        lastSeen: null,
        created: new Date().toISOString()
    };
    res.json({ success: true, user: usersDB[email] });
});

app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    
    for (let email in usersDB) {
        const user = usersDB[email];
        if ((user.username === username || user.email === username) && user.password === password) {
            user.online = true;
            user.lastSeen = new Date().toISOString();
            res.json({ success: true, user });
            return;
        }
    }
    res.status(401).json({ error: 'Неверные данные' });
});

// Получить всех пользователей
app.get('/api/users', (req, res) => {
    const users = Object.values(usersDB).map(u => ({
        id: u.id, 
        name: u.name, 
        username: u.username, 
        avatar: u.avatar,
        online: u.online,
        lastSeen: u.lastSeen
    }));
    res.json(users);
});

// ========================================
// TELEGRAM MOBILE UI v8.0
// ========================================
app.get('/', (req, res) => {
    res.send(`<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Telegram PRO</title>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', system-ui, sans-serif; }
body { background: linear-gradient(135deg, #0088cc 0%, #005f99 50%, #003d73 100%); min-height: 100vh; }

/* Welcome Screen */
#welcome { position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); text-align: center; color: white; z-index: 1000; max-width: 90vw; }
.welcome-logo { font-size: clamp(3.5rem, 12vw, 6rem); font-weight: 900; background: linear-gradient(135deg, #34c759, #5ac8fa, #ff3b30); -webkit-background-clip: text; -webkit-text-fill-color: transparent; margin-bottom: 1rem; }
.welcome-title { font-size: clamp(1.5rem, 6vw, 2.2rem); font-weight: 700; margin-bottom: 2rem; }
.btn-telegram { display: block; width: 90%; max-width: 380px; margin: 0 auto 1.5rem; padding: 1.4rem 2rem; background: linear-gradient(135deg, #34c759, #30d158); color: white; border: none; border-radius: 20px; font-size: clamp(1.1rem, 5vw, 1.4rem); font-weight: 600; cursor: pointer; transition: all 0.3s; box-shadow: 0 12px 35px rgba(52, 199, 89, 0.4); }
.btn-telegram:hover { transform: translateY(-2px); box-shadow: 0 18px 45px rgba(52, 199, 89, 0.5); }
.btn-login { background: rgba(255,255,255,0.2); backdrop-filter: blur(20px); }

/* Auth Forms */
.auth-container { display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.8); z-index: 1001; }
.auth-form { position: absolute; bottom: 0; left: 0; right: 0; background: white; border-radius: 32px 32px 0 0; padding: 2.5rem 2rem 3rem; max-height: 90vh; overflow-y: auto; }
.auth-header { text-align: center; margin-bottom: 2.5rem; }
.auth-title { font-size: 2.2rem; font-weight: 800; color: #000; margin-bottom: 0.5rem; }
.auth-subtitle { color: #8e8e93; font-size: 1.1rem; }
.form-group { margin-bottom: 1.8rem; }
.form-label { display: block; font-weight: 600; color: #3c3c43; margin-bottom: 0.6rem; font-size: 0.95rem; }
input { width: 100%; padding: 1.2rem 1.4rem; border: 2px solid #e5e5ea; border-radius: 16px; font-size: 1.05rem; transition: all 0.3s; background: #f2f2f7; }
input:focus { outline: none; border-color: #34c759; box-shadow: 0 0 0 4px rgba(52, 199, 89, 0.1); }
.username-warning { font-size: 0.85rem; color: #ff3b30; margin-top: 0.4rem; }
.auth-link { color: #007aff; text-decoration: none; font-weight: 600; }
.auth-link:hover { text-decoration: underline; }

/* Code inputs */
.code-inputs { display: flex; gap: 1rem; justify-content: center; margin: 2.5rem 0; }
.code-input { width: 60px; height: 60px; font-size: 1.8rem; font-weight: 700; text-align: center; border: 3px solid #e5e5ea; border-radius: 16px; transition: all 0.3s; background: #f2f2f7; }
.code-input:focus { border-color: #34c759; box-shadow: 0 0 0 4px rgba(52, 199, 89, 0.15); }
.code-input.success { border-color: #34c759; background: #d4edda; }
.code-input.error { border-color: #ff3b30; background: #f8d7da; animation: shake 0.5s; }
@keyframes shake { 0%, 100% { transform: translateX(0); } 25% { transform: translateX(-6px); } 75% { transform: translateX(6px); } }

/* Main App */
#app { display: none; height: 100vh; overflow: hidden; flex-direction: column; background: var(--bg-chat, #eff2f5); }
#chat-header { height: 70px; background: rgba(255,255,255,0.9); backdrop-filter: blur(20px); border-bottom: 1px solid #e5e5ea; display: flex; align-items: center; padding: 0 1.5rem; position: fixed; top: 0; left: 0; right: 0; z-index: 100; }
.header-back { width: 44px; height: 44px; border-radius: 50%; border: none; background: rgba(0,0,0,0.1); font-size: 1.4rem; cursor: pointer; margin-right: 1rem; display: flex; align-items: center; justify-content: center; }
.header-title { font-weight: 800; font-size: 1.15rem; flex: 1; }
.header-avatar { width: 40px; height: 40px; border-radius: 50%; background: #34c759; color: white; font-size: 1.1rem; display: flex; align-items: center; justify-content: center; margin-left: auto; }

#sidebar { width: 100%; height: calc(100vh - 110px); background: var(--bg-chatlist, #f8f9fa); overflow-y: auto; padding: 1.5rem 1rem; margin-top: 70px; }
.search-bar { display: flex; align-items: center; padding: 1rem 1.2rem; background: white; border-radius: 20px; margin-bottom: 1.5rem; box-shadow: 0 2px 10px rgba(0,0,0,0.08); }
#search-chats { flex: 1; border: none; background: none; padding: 0.8rem; font-size: 1rem; }
.chat-item { display: flex; padding: 1rem 1rem 1rem 1.2rem; margin-bottom: 0.3rem; border-radius: 16px; cursor: pointer; transition: all 0.2s; background: white; }
.chat-item:hover, .chat-item.active { background: #e8f5e8; transform: translateX(4px); }
.chat-avatar { width: 56px; height: 56px; border-radius: 50%; background: var(--sent, #34c759); color: white; display: flex; align-items: center; justify-content: center; font-size: 1.4rem; margin-right: 1.2rem; flex-shrink: 0; }
.chat-info { flex: 1; min-width: 0; }
.chat-name { font-weight: 700; font-size: 1rem; margin-bottom: 0.3rem; color: #000; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.chat-preview { font-size: 0.9rem; color: #8e8e93; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.chat-meta { display: flex; align-items: center; font-size: 0.8rem; color: #8e8e93; min-width: 80px; }
.read-status { margin-right: 0.5rem; }
.unread-count { background: #34c759; color: white; border-radius: 12px; padding: 0.2rem 0.6rem; font-size: 0.75rem; font-weight: 700; min-width: 20px; text-align: center; }

#chat-area { flex: 1; display: flex; flex-direction: column; margin-top: 70px; padding-bottom: 90px; }
#messages { flex: 1; overflow-y: auto; padding: 1.5rem 1.2rem; background: var(--bg-chat, #eff2f5); }
.message { margin-bottom: 1rem; display: flex; align-items: flex-end; max-width: 80%; animation: messageSlide 0.3s ease-out; }
.message.sent { margin-left: auto; flex-direction: row-reverse; }
.msg-bubble { max-width: 100%; padding: 1rem 1.3rem; border-radius: 20px; position: relative; font-size: 0.98rem; line-height: 1.4; word-wrap: break-word; }
.msg-bubble.sent { background: linear-gradient(135deg, var(--sent, #34c759), #30d158); color: white; border-bottom-right-radius: 8px; box-shadow: 0 2px 8px rgba(52, 199, 89, 0.3); }
.msg-bubble.received { background: white; color: #000; border-bottom-left-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
.msg-time { font-size: 0.75rem; opacity: 0.8; margin-left: 0.6rem; font-weight: 600; }
.read-indicator { position: absolute; bottom: 4px; right: 8px; font-size: 0.75rem; }
@keyframes messageSlide { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }

#input-area { position: fixed; bottom: 0; left: 0; right: 0; background: rgba(255,255,255,0.95); backdrop-filter: blur(25px); padding: 1rem 1.5rem; display: flex; align-items: flex-end; gap: 1rem; border-top: 1px solid #e5e5ea; }
.attach-btn { width: 48px; height: 48px; border-radius: 50%; border: none; background: #f2f2f7; font-size: 1.3rem; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: all 0.2s; }
.attach-btn:hover { background: #e5e5ea; }
#message-input { flex: 1; padding: 1rem 1.3rem; border: 2px solid #e5e5ea; border-radius: 25px; font-size: 1rem; resize: none; max-height: 140px; min-height: 48px; background: #f2f2f7; }
#message-input:focus { outline: none; border-color: #34c759; }
#send-btn { width: 48px; height: 48px; border-radius: 50%; border: none; background: var(--sent, #34c759); color: white; font-size: 1.3rem; cursor: pointer; transition: all 0.2s; display: flex; align-items: center; justify-content: center; }
#send-btn:hover:not(:disabled) { background: #30d158; transform: scale(1.05); }
#send-btn:disabled { opacity: 0.5; cursor: not-allowed; }

/* Bottom Navigation */
.bottom-nav { position: fixed; bottom: 0; left: 0; right: 0; height: 70px; background: rgba(255,255,255,0.95); backdrop-filter: blur(25px); display: flex; border-top: 1px solid #e5e5ea; z-index: 99; }
.nav-item { flex: 1; padding: 1rem 0; text-align: center; border: none; background: none; cursor: pointer; transition: all 0.3s; font-size: 1.5rem; }
.nav-item.active { color: var(--sent, #34c759); }
</style>
</head>
<body>
<!-- Welcome Screen -->
<div id="welcome">
    <div class="welcome-logo">📱</div>
    <h1 class="welcome-title">Telegram PRO</h1>
    <p style="font-size: 1.1rem; opacity: 0.9; margin-bottom: 3rem;">Fast. Secure. Everywhere.</p>
    <button class="btn-telegram" onclick="showRegister()">📝 Start Messaging</button>
    <button class="btn-login btn-telegram" onclick="showLogin()">🔐 Have an Account</button>
</div>

<!-- Auth Forms -->
<div id="auth-container" class="auth-container">
    <!-- Register -->
    <div id="register-form" class="auth-form">
        <div class="auth-header">
            <h2 class="auth-title">Create Account</h2>
            <p class="auth-subtitle">Join Telegram PRO</p>
        </div>
        <div class="form-group">
            <label class="form-label">Email</label>
            <input id="reg-email" type="email" placeholder="your@email.com">
        </div>
        <div class="form-group">
            <label class="form-label">Username</label>
            <input id="reg-username" placeholder="@username">
            <div class="username-warning">Username нельзя изменить после регистрации</div>
        </div>
        <div class="form-group">
            <label class="form-label">Password</label>
            <input id="reg-password" type="password" placeholder="••••••••">
        </div>
        <div class="form-group">
            <label class="form-label">Confirm Password</label>
            <input id="reg-password2" type="password" placeholder="••••••••">
        </div>
        <button class="btn-telegram" style="width:100%; margin-top:1.5rem;" onclick="register()">Create Account</button>
        <p style="margin-top:1.5rem; text-align:center;"><a href="#" class="auth-link" onclick="showLogin()">Already have account? Login</a></p>
    </div>

    <!-- Login -->
    <div id="login-form" class="auth-form" style="display:none;">
        <div class="auth-header">
            <h2 class="auth-title">Welcome Back</h2>
        </div>
        <div class="form-group">
            <label class="form-label">Username or Email</label>
            <input id="login-username" placeholder="@username or email">
        </div>
        <div class="form-group">
            <label class="form-label">Password</label>
            <input id="login-password" type="password" placeholder="••••••••">
        </div>
        <button class="btn-telegram" style="width:100%; margin-top:1.5rem;" onclick="login()">Sign In</button>
        <p style="margin-top:1.5rem; text-align:center;">
            <a href="#" class="auth-link" onclick="showRegister()">Create new account</a>
        </p>
    </div>
</div>

<!-- Main App -->
<div id="app">
    <div id="chat-header" style="display:none;">
        <button class="header-back" onclick="showChats()">←</button>
        <div id="header-title" class="header-title"></div>
        <div id="header-avatar" class="header-avatar"></div>
    </div>
    
    <div id="sidebar">
        <div class="search-bar">
            <input id="search-chats" placeholder="Search">
        </div>
        <div id="chat-list"></div>
    </div>
    
    <div id="chat-area" style="display:none;">
        <div id="messages"></div>
        <div id="input-area">
            <button class="attach-btn">📎</button>
            <div id="message-input-container">
                <textarea id="message-input" placeholder="Message" rows="1"></textarea>
            </div>
            <button class="attach-btn">😀</button>
            <button id="send-btn" disabled>➤</button>
        </div>
    </div>
    
    <div class="bottom-nav">
        <button class="nav-item active" onclick="showChats()">💬</button>
        <button class="nav-item" onclick="showSettings()">⚙️</button>
    </div>
</div>

<script src="/socket.io/socket.io.js"></script>
<script>
const socket = io();
let currentUser = null, currentChat = null;
const themes = ${JSON.stringify(themes)};

// Показать/скрыть формы
function showWelcome() {
    document.getElementById('welcome').style.display = 'block';
    document.getElementById('auth-container').style.display = 'none';
    document.getElementById('app').style.display = 'none';
}

function showRegister() {
    showWelcome();
    setTimeout(() => {
        document.getElementById('welcome').style.display = 'none';
        document.getElementById('auth-container').style.display = 'block';
        document.getElementById('register-form').style.display = 'block';
    }, 200);
}

function showLogin() {
    document.getElementById('register-form').style.display = 'none';
    document.getElementById('login-form').style.display = 'block';
}

// Регистрация
async function register() {
    const email = document.getElementById('reg-email').value.trim();
    const username = document.getElementById('reg-username').value.trim().replace('@', '');
    const password = document.getElementById('reg-password').value;
    const password2 = document.getElementById('reg-password2').value;
    
    if (!email.includes('@') || !username || password.length < 6 || password !== password2) {
        return alert('✅ Проверьте данные! Пароль минимум 6 символов');
    }
    
    try {
        const res = await fetch('/api/register', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({email, password, username})
        });
        const data = await res.json();
        if (data.success) {
            currentUser = data.user;
            showMainApp();
            loadChats();
            addWelcomeMessage();
        } else {
            alert('❌ ' + data.error);
        }
    } catch(e) {
        alert('❌ Ошибка сервера');
    }
}

// Вход
async function login() {
    const username = document.getElementById('login-username').value.trim();
    const password = document.getElementById('login-password').value;
    
    try {
        const res = await fetch('/api/login', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({username, password})
        });
        const data = await res.json();
        if (data.success) {
            currentUser = data.user;
            showMainApp();
            loadChats();
        } else {
            alert('❌ ' + data.error);
        }
    } catch(e) {
        alert('❌ Ошибка сервера');
    }
}

function showMainApp() {
    document.getElementById('welcome').style.display = 'none';
    document.getElementById('auth-container').style.display = 'none';
    document.getElementById('app').style.display = 'flex';
    document.getElementById('sidebar').style.display = 'block';
    socket.emit('user_online', currentUser);
}

function showChats() {
    document.querySelector('.nav-item').classList.add('active');
    document.querySelectorAll('.nav-item')[1].classList.remove('active');
    document.getElementById('sidebar').style.display = 'block';
    document.getElementById('chat-area').style.display = 'none';
}

async function loadChats() {
    const res = await fetch('/api/users');
    const users = await res.json();
    const chatList = document.getElementById('chat-list');
    chatList.innerHTML = '';
    
    users.filter(u => u.id !== currentUser.id).forEach(user => {
        const chat = document.createElement('div');
        chat.className = 'chat-item';
        chat.onclick = () => openChat(user);
        chat.innerHTML = \`
            <div class="chat-avatar">\${user.avatar}</div>
            <div class="chat-info">
                <div class="chat-name">\${user.name}</div>
                <div class="chat-preview">\${user.username}</div>
            </div>
            <div class="chat-meta">
                <div class="read-status">✓✓</div>
                <div>14:32</div>
            </div>
        \`;
        chatList.appendChild(chat);
    });
}

function openChat(user) {
    currentChat = user;
    document.querySelectorAll('.chat-item').forEach(item => item.classList.remove('active'));
    event.currentTarget.classList.add('active');
    
    document.getElementById('sidebar').style.display = 'none';
    document.getElementById('chat-area').style.display = 'flex';
    document.querySelector('.nav-item').classList.remove('active');
    document.querySelectorAll('.nav-item')[1].classList.add('active');
    
    document.getElementById('chat-header').style.display = 'flex';
    document.getElementById('header-title').textContent = user.name;
    document.getElementById('header-avatar').textContent = user.avatar;
    document.getElementById('messages').innerHTML = '<div style="text-align:center;color:#8e8e93;padding:4rem;font-size:1.1rem;">Начните безопасный чат</div>';
}

function addWelcomeMessage() {
    const messages = document.getElementById('messages');
    const msg = document.createElement('div');
    msg.className = 'message received';
    msg.style.marginTop = '2rem';
    msg.innerHTML = \`
        <div class="msg-bubble received">Добро пожаловать в Telegram PRO! 
        Этот чат защищён end-to-end шифрованием 🔒</div>
    \`;
    messages.appendChild(msg);
}

async function sendMessage() {
    const text = document.getElementById('message-input').value.trim();
    if (!text || !currentChat || !rateLimit(currentUser.id)) return;
    
    socket.emit('send_message', {
        to: currentChat.id,
        text: text,
        from: currentUser.id
    });
    
    addMessage(text, true);
    document.getElementById('message-input').value = '';
}

function addMessage(text, isSent) {
    const messages = document.getElementById('messages');
    const msg = document.createElement('div');
    msg.className = \`message \${isSent ? 'sent' : 'received'}\`;
    msg.innerHTML = \`
        <div class="msg-bubble \${isSent ? 'sent' : 'received'}">\${text}</div>
        <div class="msg-time">\${new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</div>
        \${isSent ? '<div class="read-indicator">✓✓</div>' : ''}
    \`;
    messages.appendChild(msg);
    messages.scrollTop = messages.scrollHeight;
    
    // Адаптивная высота textarea
    const textarea = document.getElementById('message-input');
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 140) + 'px';
}

// Socket события
socket.on('new_message', (data) => {
    if (currentChat?.id === data.from) {
        addMessage(data.text, false);
    }
});

socket.on('user_online', (users) => {
    loadChats();
});

// Input события
document.getElementById('message-input').addEventListener('input', function() {
    const sendBtn = document.getElementById('send-btn');
    sendBtn.disabled = this.value.trim() === '';
});

document.getElementById('message-input').addEventListener('keypress', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
    }
});

document.getElementById('send-btn').onclick = sendMessage;

// Настройки (заглушка)
function showSettings() {
    alert('⚙️ Настройки в разработке...');
}
</script>
</body>
</html>`);
});

// ========================================
// SOCKET.IO (Real-time)
// ========================================
io.on('connection', (socket) => {
    socket.on('user_online', (user) => {
        onlineUsers.add(user.id);
        socket.broadcast.emit('user_online', Object.values(usersDB));
        socket.emit('user_online', Object.values(usersDB));
    });
    
    socket.on('send_message', (data) => {
        if (!data.to || !data.from || !rateLimit(data.from)) return;
        
        const message = {
            id: messageId++,
            from: data.from,
            to: data.to,
            text: data.text,
            time: new Date()
        };
        
        socket.to(data.to).emit('new_message', message);
        socket.emit('new_message', message);
    });
    
    socket.on('disconnect', () => {
        // Update user status
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log('\\n🚀 Telegram PRO v8.0 LIVE!');
    console.log('📍 Port:', PORT);
    console.log('👥 Готов к работе!');
});

