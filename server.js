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

// БАЗЫ ДАННЫХ
const usersDB = {};
const privateChats = {};
const groups = {};
const userSessions = {};
const blockedUsers = {};
const onlineUsers = new Set();
let globalId = 0;

const telegramColors = {
    primary: '#34c759',
    blue: '#0088cc',
    white: '#ffffff',
    gray: '#8e8e93',
    bg: '#eff2f5',
    chatlist: '#f8f9fa'
};

const rateLimits = new Map();
function checkRate(userId) {
    const now = Date.now();
    const data = rateLimits.get(userId) || {count: 0, reset: now};
    if (now - data.reset > 60000) data.count = 0;
    if (data.count > 30) return false;
    data.count++;
    rateLimits.set(userId, data);
    return true;
}

app.use(cors());
app.use(express.json({limit: '50mb'}));
app.use(express.static(path.join(__dirname, 'public')));

// API ROUTES
app.post('/api/register', (req, res) => {
    const {email, password, username, confirmPassword} = req.body;
    
    if (!email.includes('@') || !username || password.length < 6 || password !== confirmPassword || usersDB[email]) {
        return res.status(400).json({error: 'Неверные данные или аккаунт существует'});
    }
    
    const userId = `user_${Date.now()}_${Math.random().toString(36).substr(2,9)}`;
    usersDB[email] = {
        id: userId,
        email,
        username: username.toLowerCase(),
        name: username.charAt(0).toUpperCase() + username.slice(1),
        avatar: '👤',
        password,
        theme: 'telegram',
        phone: '',
        birthday: '',
        created: new Date().toISOString(),
        lastSeen: null,
        online: false,
        folders: {},
        pinned: [],
        notifications: {}
    };
    
    res.json({success: true, user: usersDB[email]});
});

app.post('/api/login', (req, res) => {
    const {username, password} = req.body;
    
    for (let email in usersDB) {
        const user = usersDB[email];
        if ((user.username === username || user.email === username) && user.password === password) {
            user.online = true;
            user.lastSeen = new Date().toISOString();
            const sessionToken = user.id + '_' + Date.now();
            userSessions[sessionToken] = {userId: user.id, expires: Date.now() + 31536000000};
            res.json({success: true, user, sessionToken});
            return;
        }
    }
    res.status(401).json({error: 'Неверный логин или пароль'});
});

app.post('/api/forgot-password', (req, res) => {
    const {email} = req.body;
    if (usersDB[email]) {
        const code = Math.floor(100000 + Math.random() * 900000);
        usersDB[email].recoveryCode = code;
        usersDB[email].recoveryExpires = Date.now() + 300000;
        console.log(`📧 Код для ${email}: ${code}`);
        res.json({success: true});
    } else {
        res.status(404).json({error: 'Email не найден'});
    }
});

app.post('/api/verify-code', (req, res) => {
    const {email, code} = req.body;
    if (usersDB[email] && 
        usersDB[email].recoveryCode == code && 
        Date.now() < usersDB[email].recoveryExpires) {
        res.json({success: true});
    } else {
        res.status(400).json({error: 'Неверный код'});
    }
});

app.post('/api/reset-password', (req, res) => {
    const {email, newPassword} = req.body;
    if (usersDB[email]) {
        usersDB[email].password = newPassword;
        delete usersDB[email].recoveryCode;
        delete usersDB[email].recoveryExpires;
        res.json({success: true});
    } else {
        res.status(400).json({error: 'Пользователь не найден'});
    }
});

app.get('/api/users', (req, res) => {
    const users = Object.values(usersDB).map(u => ({
        id: u.id, name: u.name, username: u.username, 
        avatar: u.avatar, online: u.online, lastSeen: u.lastSeen
    }));
    res.json(users);
});

// SOCKET.IO
io.on('connection', (socket) => {
    console.log('🔌 Пользователь подключился:', socket.id);
    
    socket.on('join', (userId) => {
        socket.join(userId);
        onlineUsers.add(userId);
        io.emit('userOnline', userId);
    });

    socket.on('message', (data) => {
        if (!checkRate(data.from)) {
            socket.emit('error', 'Rate limit exceeded');
            return;
        }
        
        const chatId = data.chatId || `${data.from}_${data.to}`.split('_').sort().join('_');
        if (!privateChats[chatId]) privateChats[chatId] = [];
        
        const message = {
            id: `msg_${Date.now()}_${Math.random().toString(36).substr(2,5)}`,
            from: data.from,
            to: data.to,
            text: data.text,
            time: new Date().toISOString(),
            read: false,
            edited: false
        };
        
        privateChats[chatId].push(message);
        io.to(data.from).to(data.to).emit('newMessage', {chatId, message});
    });

    socket.on('disconnect', () => {
        console.log('🔌 Пользователь отключился');
    });
});

// MAIN APP ✅ ПОЛНЫЙ HTML
app.get('/', (req, res) => {
    res.send(`<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
<title>Zhuravlev Messenger</title>
<link href="https://fonts.googleapis.com/css2?family=SF+Pro+Display:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">
<style>
* { margin: 0; padding: 0; box-sizing: border-box; font-family: 'SF Pro Display', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
html, body { height: 100%; overflow-x: hidden; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); }

:root {
    --primary-color: #34c759;
    --chat-bg: #eff2f5;
    --chatlist-bg: #f8f9fa;
}

#welcome-screen { 
    position: fixed; top: 0; left: 0; width: 100%; height: 100%; 
    background: linear-gradient(135deg, #0088cc 0%, #005f99 50%, #003d73 100%);
    display: flex; flex-direction: column; align-items: center; justify-content: center; 
    text-align: center; color: white; padding: 2rem; z-index: 1000;
}
.zhuravlev-logo { 
    font-size: clamp(4rem, 15vw, 8rem); font-weight: 900; 
    background: linear-gradient(135deg, #34c759 0%, #5ac8fa 50%, #ff3b30 100%);
    -webkit-background-clip: text; -webkit-text-fill-color: transparent; 
    margin-bottom: 1.5rem; animation: logoFloat 3s ease-in-out infinite;
}
@keyframes logoFloat { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-10px); } }
.welcome-title { font-size: clamp(2rem, 8vw, 3rem); font-weight: 800; margin-bottom: 1rem; }
.welcome-subtitle { font-size: 1.2rem; opacity: 0.9; margin-bottom: 4rem; }

.telegram-btn { 
    width: 90%; max-width: 380px; padding: 1.6rem 3rem; margin-bottom: 1.8rem; 
    background: linear-gradient(135deg, var(--primary-color) 0%, #30d158 100%); 
    color: white; border: none; border-radius: 28px; font-size: clamp(1.15rem, 5vw, 1.4rem); 
    font-weight: 700; cursor: pointer; transition: all 0.3s; box-shadow: 0 14px 40px rgba(52,199,89,0.4);
}
.telegram-btn:hover { transform: translateY(-4px); box-shadow: 0 22px 50px rgba(52,199,89,0.5); }
.login-btn { background: rgba(255,255,255,0.2); backdrop-filter: blur(25px); border: 1px solid rgba(255,255,255,0.2); }

#auth-overlay { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.7); z-index: 1001; display: none; }
.auth-card { 
    position: absolute; bottom: 0; left: 0; right: 0; background: white; border-radius: 36px 36px 0 0; 
    padding: 3rem 2.8rem 4rem; max-height: 90vh; overflow-y: auto; transform: translateY(100%); 
    transition: transform 0.45s cubic-bezier(0.25,0.46,0.45,0.94);
}
.auth-card.visible { transform: translateY(0); }
.auth-header { text-align: center; margin-bottom: 3rem; }
.auth-title { font-size: 2.6rem; font-weight: 800; color: #000; margin-bottom: 0.7rem; }
.auth-subtitle { color: #8e8e93; font-size: 1.2rem; font-weight: 500; }
.form-field { margin-bottom: 2.3rem; }
.field-label { display: block; font-weight: 600; color: #3c3c43; margin-bottom: 0.9rem; font-size: 1rem; }
.field-input { 
    width: 100%; padding: 1.4rem 1.6rem; border: 2px solid #e5e5ea; border-radius: 20px; 
    font-size: 1.1rem; background: #f2f2f7; transition: all 0.3s; font-family: inherit;
}
.field-input:focus { outline: none; border-color: var(--primary-color); box-shadow: 0 0 0 4px rgba(52,199,89,0.12); }
.warning-text { font-size: 0.9rem; color: #ff9500; margin-top: 0.7rem; background: #fff5e6; padding: 0.8rem; border-radius: 12px; border-left: 4px solid #ff9500; }
.auth-link { color: #007aff; text-decoration: none; font-weight: 600; font-size: 1.05rem; }
.auth-link:hover { text-decoration: underline; }

.code-grid { display: flex; gap: 1.4rem; justify-content: center; margin: 3.5rem 0 3rem; }
.code-input { 
    width: 68px; height: 68px; font-size: 2.2rem; font-weight: 800; text-align: center; 
    border: 3px solid #e5e5ea; border-radius: 20px; background: #f2f2f7; transition: all 0.3s; 
    font-family: monospace;
}
.code-input:focus { border-color: var(--primary-color); }
.code-input.success { border-color: var(--primary-color) !important; background: #d4edda !important; }
.code-input.error { border-color: #ff3b30 !important; background: #f8d7da !important; animation: shake 0.6s; }
@keyframes shake { 0%,100%{transform:translateX(0);}20%{transform:translateX(-10px);}40%{transform:translateX(10px);} }

#main-app { display: none; height: 100vh; overflow: hidden; flex-direction: column; background: var(--chat-bg); }
.chat-list-screen, .chat-screen { display: none; }
.chat-list-screen.active { display: block; }

#chat-list-container { width: 100%; height: calc(100vh - 82px); background: var(--chatlist-bg); overflow-y: auto; padding: 1.8rem 0; }
.search-bar { position: sticky; top: 0; background: white; padding: 1.3rem 1.8rem; display: flex; align-items: center; box-shadow: 0 3px 15px rgba(0,0,0,0.1); z-index: 10; margin-bottom: 1.2rem; }
.search-input { flex: 1; border: none; background: #f2f2f7; padding: 1.1rem 1.4rem; border-radius: 22px; font-size: 1.05rem; }
.search-edit { background: var(--primary-color); color: white; border-radius: 22px; padding: 1.1rem 1rem; margin-left: 0.8rem; font-weight: 600; border: none; cursor: pointer; }

.chat-item { display: flex; padding: 1.2rem 1.8rem; margin: 0 1.2rem; border-radius: 18px; cursor: pointer; background: white; margin-bottom: 0.6rem; box-shadow: 0 2px 8px rgba(0,0,0,0.06); transition: all 0.25s; }
.chat-item:hover { background: #f0f8f0; transform: translateX(4px); }
.chat-avatar { width: 56px; height: 56px; border-radius: 28px; background: var(--primary-color); color: white; display: flex; align-items: center; justify-content: center; font-size: 1.4rem; margin-right: 1.4rem; }
.chat-info { flex: 1; min-width: 0; }
.chat-name { font-weight: 700; font-size: 1.05rem; margin-bottom: 0.3rem; color: #000; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.chat-preview { font-size: 0.95rem; color: #8e8e93; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.chat-meta { display: flex; align-items: center; font-size: 0.85rem; color: #8e8e93; min-width: 80px; justify-content: flex-end; }
.read-status { margin-right: 0.7rem; font-size: 1.05rem; }

.chat-header { height: 75px; background: rgba(255,255,255,0.97); backdrop-filter: blur(30px); border-bottom: 1px solid #e5e5ea; display: flex; align-items: center; padding: 0 1.8rem; position: fixed; top: 0; left: 0; right: 0; z-index: 200; }
.header-back { width: 48px; height: 48px; border-radius: 24px; border: none; background: rgba(0,0,0,0.08); font-size: 1.45rem; cursor: pointer; margin-right: 1.2rem; display: flex; align-items: center; justify-content: center; }
.header-title { font-weight: 800; font-size: 1.25rem; flex: 1; }
.header-avatar { width: 44px; height: 44px; border-radius: 22px; background: var(--primary-color); color: white; font-size: 1.2rem; display: flex; align-items: center; justify-content: center; }

.chat-messages { flex: 1; overflow-y: auto; padding: 2rem 1.6rem; background: var(--chat-bg); margin-top: 75px; padding-bottom: 120px; }
.message { margin-bottom: 1.4rem; display: flex; align-items: flex-end; max-width: 84%; animation: messageSlide 0.4s; }
.message.sent { margin-left: auto; flex-direction: row-reverse; }
.msg-bubble { max-width: 100%; padding: 1.2rem 1.6rem; border-radius: 24px; font-size: 1rem; line-height: 1.5; box-shadow: 0 2px 6px rgba(0,0,0,0.1); position: relative; }
.msg-bubble.sent { background: var(--primary-color); color: white; border-bottom-right-radius: 10px; }
.msg-bubble.received { background: white; color: #000; border-bottom-left-radius: 10px; }
.msg-time { font-size: 0.78rem; opacity: 0.9; margin-left: 0.8rem; font-weight: 600; margin-top: 0.15rem; }
.read-indicator { position: absolute; bottom: 6px; right: 10px; font-size: 0.8rem; }
@keyframes messageSlide { from { opacity: 0; transform: translateY(30px); } to { opacity: 1; transform: translateY(0); } }

.message-input-area { 
    position: fixed; bottom: 0; left: 0; right: 0; background: rgba(255,255,255,0.98); 
    backdrop-filter: blur(35px); padding: 1.4rem 1.8rem; display: flex; align-items: flex-end; 
    gap: 1.4rem; border-top: 1px solid #e5e5ea; z-index: 150;
}
.attach-btn { width: 54px; height: 54px; border-radius: 27px; border: none; background: #f2f2f7; font-size: 1.45rem; cursor: pointer; }
#message-input { flex: 1; padding: 1.2rem 1.6rem; border: 2px solid #e5e5ea; border-radius: 30px; font-size: 1.05rem; resize: none; max-height: 160px; min-height: 54px; background: #f2f2f7; }
#send-button { width: 54px; height: 54px; border-radius: 27px; border: none; background: var(--primary-color); color: white; font-size: 1.45rem; cursor: pointer; }

.bottom-nav { position: fixed; bottom: 0; left: 0; right: 0; height: 82px; background: rgba(255,255,255,0.98); backdrop-filter: blur(35px); display: flex; border-top: 1px solid #e5e5ea; z-index: 100; }
.nav-item { flex: 1; padding: 1.3rem 0; text-align: center; border: none; background: none; cursor: pointer; font-size: 1.6rem; color: #8e8e93; }
.nav-item.active { color: var(--primary-color); }
</style>
</head>
<body>
<!-- Welcome Screen -->
<div id="welcome-screen">
    <div class="zhuravlev-logo">📱</div>
    <h1 class="welcome-title">Zhuravlev Messenger</h1>
    <p class="welcome-subtitle">Fast. Secure. Everywhere you are.</p>
    <button class="telegram-btn" onclick="showRegisterForm()">📝 Registration</button>
    <button class="login-btn telegram-btn" onclick="showLoginForm()">🔐 Sign In</button>
</div>

<!-- ✅ ПОЛНЫЙ Auth Overlay -->
<div id="auth-overlay">
    <!-- ✅ Registration Form -->
    <div id="register-form" class="auth-card">
        <div class="auth-header">
            <h2 class="auth-title">Create Account</h2>
            <p class="auth-subtitle">Welcome to Zhuravlev Messenger</p>
        </div>
        <div class="form-field">
            <label class="field-label">Email Address</label>
            <input class="field-input" id="reg-email" type="email" placeholder="your@email.com" required>
        </div>
        <div class="form-field">
            <label class="field-label">Username</label>
            <input class="field-input" id="reg-username" placeholder="@username" required>
            <div class="warning-text">⚠️ Username нельзя будет изменить после регистрации (привязан к почте навсегда)</div>
        </div>
        <div class="form-field">
            <label class="field-label">Password</label>
            <input class="field-input" id="reg-password" type="password" placeholder="••••••••" required>
        </div>
        <div class="form-field">
            <label class="field-label">Confirm Password</label>
            <input class="field-input" id="reg-confirm-password" type="password" placeholder="••••••••" required>
        </div>
        <button class="telegram-btn" style="width:100%; margin-top:2.5rem;" onclick="registerUser()">Create My Account</button>
        <p style="margin-top:2.5rem; text-align:center; color:#8e8e93;">
            Already have an account? <a href="#" class="auth-link" onclick="showLoginForm(); return false;">Sign In</a>
        </p>
    </div>

    <!-- ✅ Login Form -->
    <div id="login-form" class="auth-card" style="display:none;">
        <div class="auth-header">
            <h2 class="auth-title">Welcome Back</h2>
            <p class="auth-subtitle">Sign in to continue</p>
        </div>
        <div class="form-field">
            <label class="field-label">Username or Email</label>
            <input class="field-input" id="login-username" placeholder="@username or email" required>
        </div>
        <div class="form-field">
            <label class="field-label">Password</label>
            <input class="field-input" id="login-password" type="password" placeholder="••••••••" required>
        </div>
        <button class="telegram-btn" style="width:100%; margin-top:2.5rem;" onclick="loginUser()">Sign In</button>
        <p style="margin-top:2rem; text-align:center;">
            <a href="#" class="auth-link" onclick="showRegisterForm(); return false;">Create new account</a>
        </p>
        <p style="margin-top:1.5rem; text-align:center;">
            <a href="#" class="auth-link" onclick="showForgotPassword(); return false;">Forgot Password?</a>
        </p>
    </div>

    <!-- ✅ Forgot Password -->
    <div id="forgot-password-form" class="auth-card" style="display:none;">
        <div class="auth-header">
            <h2 class="auth-title">Forgot Password?</h2>
            <p class="auth-subtitle">Enter email to receive recovery code</p>
        </div>
        <div class="form-field">
            <label class="field-label">Email Address</label>
            <input class="field-input" id="forgot-email" type="email" placeholder="your@email.com">
        </div>
        <button class="telegram-btn" style="width:100%; margin-top:2rem;" onclick="sendRecoveryCode()">Send Code</button>
        <p style="margin-top:2rem; text-align:center;">
            <a href="#" class="auth-link" onclick="showLoginForm(); return false;">← Back to Sign In</a>
        </p>
    </div>

    <!-- ✅ Code Verification -->
    <div id="code-form" class="auth-card" style="display:none;">
        <div class="auth-header">
            <h2 class="auth-title">Enter Code</h2>
            <p class="auth-subtitle">Check your email for 6-digit code</p>
        </div>
        <div class="code-grid">
            <input class="code-input" maxlength="1">
            <input class="code-input" maxlength="1">
            <input class="code-input" maxlength="1">
            <input class="code-input" maxlength="1">
            <input class="code-input" maxlength="1">
            <input class="code-input" maxlength="1">
        </div>
        <button class="telegram-btn" style="width:100%; margin-top:3rem;" onclick="verifyCode()">Verify Code</button>
        <p style="margin-top:2rem; text-align:center;">
            <a href="#" class="auth-link" onclick="showForgotPassword(); return false;">← Back</a>
        </p>
    </div>

    <!-- ✅ New Password -->
    <div id="new-password-form" class="auth-card" style="display:none;">
        <div class="auth-header">
            <h2 class="auth-title">New Password</h2>
            <p class="auth-subtitle">Enter new password twice</p>
        </div>
        <div class="form-field">
            <label class="field-label">New Password</label>
            <input class="field-input" id="new-password" type="password" placeholder="••••••••">
        </div>
        <div class="form-field">
            <label class="field-label">Confirm Password</label>
            <input class="field-input" id="new-confirm-password" type="password" placeholder="••••••••">
        </div>
        <button class="telegram-btn" style="width:100%; margin-top:2.5rem;" onclick="resetPassword()">Set New Password</button>
        <p style="margin-top:2rem; text-align:center;">
            <a href="#" class="auth-link" onclick="showCodeForm(); return false;">← Back</a>
        </p>
    </div>
</div>

<!-- Main App -->
<div id="main-app">
    <div id="chat-list-screen" class="chat-list-screen">
        <div class="search-bar">
            <input class="search-input" placeholder="Search chats" id="chat-search">
            <button class="search-edit" onclick="toggleEditMode()">Edit</button>
        </div>
        <div id="chat-list-container"></div>
    </div>

    <div id="chat-screen" class="chat-screen">
        <div class="chat-header">
            <button class="header-back" onclick="backToChats()">←</button>
            <div class="header-title" id="chat-title">Chat</div>
            <div class="header-avatar" id="chat-avatar">👤</div>
        </div>
        <div class="chat-messages" id="chat-messages"></div>
        <div class="message-input-area">
            <button class="attach-btn">📎</button>
            <textarea id="message-input" placeholder="Type a message..." rows="1"></textarea>
            <button id="send-button" disabled>➤</button>
        </div>
    </div>

    <nav class="bottom-nav">
        <button class="nav-item active" onclick="showChats()">chat</button>
        <button class="nav-item" onclick="showContacts()">contacts</button>
        <button class="nav-item" onclick="showSettings()">settings</button>
    </nav>
</div>

<script>
const socket = io();
let currentUser = null;
let currentChat = null;
let recoveryEmail = '';

// ✅ ВСЕ JS ФУНКЦИИ
function showRegisterForm() {
    hideAllForms();
    document.getElementById('register-form').style.display = 'block';
    document.getElementById('auth-overlay').style.display = 'block';
    document.querySelector('.auth-card').classList.add('visible');
}

function showLoginForm() {
    hideAllForms();
    document.getElementById('login-form').style.display = 'block';
    document.getElementById('auth-overlay').style.display = 'block';
    document.querySelector('.auth-card').classList.add('visible');
}

function showForgotPassword() {
    hideAllForms();
    document.getElementById('forgot-password-form').style.display = 'block';
    document.getElementById('auth-overlay').style.display = 'block';
    document.querySelector('.auth-card').classList.add('visible');
}

function showCodeForm() {
    hideAllForms();
    document.getElementById('code-form').style.display = 'block';
    setupCodeInputs();
}

function hideAllForms() {
    document.querySelectorAll('.auth-card').forEach(form => {
        form.style.display = 'none';
        form.classList.remove('visible');
    });
}

function registerUser() {
    const email = document.getElementById('reg-email').value;
    const username = document.getElementById('reg-username').value;
    const password = document.getElementById('reg-password').value;
    const confirmPassword = document.getElementById('reg-confirm-password').value;

    fetch('/api/register', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({email, username, password, confirmPassword})
    })
    .then(res => res.json())
    .then(data => {
        if (data.success) {
            alert('✅ Аккаунт создан успешно!');
            showLoginForm();
        } else {
            alert('❌ ' + data.error);
        }
    });
}

function loginUser() {
    const username = document.getElementById('login-username').value;
    const password = document.getElementById('login-password').value;

    fetch('/api/login', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({username, password})
    })
    .then(res => res.json())
    .then(data => {
        if (data.success) {
            currentUser = data.user;
            socket.emit('join', currentUser.id);
            document.getElementById('main-app').style.display = 'flex';
            document.getElementById('welcome-screen').style.display = 'none';
            document.getElementById('auth-overlay').style.display = 'none';
            loadChats();
        } else {
            alert('❌ ' + data.error);
        }
    });
}

function sendRecoveryCode() {
    const email = document.getElementById('forgot-email').value;
    fetch('/api/forgot-password', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({email})
    })
    .then(res => res.json())
    .then(data => {
        if (data.success) {
            alert('✅ Код отправлен на почту!');
            recoveryEmail = email;
            showCodeForm();
        } else {
            alert('❌ ' + data.error);
        }
    });
}

function setupCodeInputs() {
    const inputs = document.querySelectorAll('.code-input');
    inputs.forEach((input, index) => {
        input.oninput = (e) => {
            if (e.target.value.length === 1 && index < 5) {
                inputs[index + 1].focus();
            }
        };
        input.onkeydown = (e) => {
            if (e.key === 'Backspace' && !input.value && index > 0) {
                inputs[index - 1].focus();
            }
        };
    });
}

function verifyCode() {
    const code = Array.from(document.querySelectorAll('.code-input')).map(i => i.value).join('');
    if (code.length !== 6) return alert('Введите полный 6-значный код');

    fetch('/api/verify-code', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({email: recoveryEmail, code: parseInt(code)})
    })
    .then(res => res.json())
    .then(data => {
        if (data.success) {
            document.querySelectorAll('.code-input').forEach(input => input.classList.add('success'));
            setTimeout(() => {
                hideAllForms();
                document.getElementById('new-password-form').style.display = 'block';
                document.getElementById('auth-overlay').style.display = 'block';
            }, 500);
        } else {
            document.querySelectorAll('.code-input').forEach(input => {
                input.classList.add('error');
                input.value = '';
            });
            setTimeout(() => {
                document.querySelectorAll('.code-input').forEach(input => input.classList.remove('error'));
            }, 1000);
        }
    });
}

function resetPassword() {
    const newPassword = document.getElementById('new-password').value;
    const confirmPassword = document.getElementById('new-confirm-password').value;

    if (newPassword !== confirmPassword) return alert('Пароли не совпадают');
    if (newPassword.length < 6) return alert('Пароль должен содержать минимум 6 символов');

    fetch('/api/reset-password', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({email: recoveryEmail, newPassword})
    })
    .then(res => res.json())
    .then(data => {
        if (data.success) {
            alert('✅ Пароль успешно изменен!');
            showLoginForm();
        } else {
            alert('❌ ' + data.error);
        }
    });
}

// Chat Functions
function loadChats() {
    fetch('/api/users')
    .then(res => res.json())
    .then(users => {
        const container = document.getElementById('chat-list-container');
        container.innerHTML = '';
        users.forEach(user => {
            if (user.id !== currentUser.id) {
                const chatItem = document.createElement('div');
                chatItem.className = 'chat-item';
                chatItem.onclick = () => openChat(user);
                chatItem.innerHTML = \`
                    <div class="chat-avatar">\${user.avatar}</div>
                    <div class="chat-info">
                        <div class="chat-name">\${user.name}</div>
                        <div class="chat-preview">No messages yet</div>
                    </div>
                    <div class="chat-meta">
                        <span class="read-status">✓✓</span>
                        <span>14:30</span>
                    </div>
                \`;
                container.appendChild(chatItem);
            }
        });
    });
}

function openChat(user) {
    currentChat = user;
    document.getElementById('chat-list-screen').classList.remove('active');
    document.getElementById('chat-screen').style.display = 'block';
    document.getElementById('chat-title').textContent = user.name;
    document.getElementById('chat-avatar').textContent = user.avatar;
    document.getElementById('chat-messages').innerHTML = '';
    document.getElementById('message-input').focus();
    setupMessageInput();
}

function backToChats() {
    document.getElementById('chat-screen').style.display = 'none';
    document.getElementById('chat-list-screen').classList.add('active');
}

function setupMessageInput() {
    const input = document.getElementById('message-input');
    const sendBtn = document.getElementById('send-button');
    
    input.oninput = () => {
        sendBtn.disabled = !input.value.trim();
    };
    
    sendBtn.onclick = sendMessage;
    
    input.onkeydown = (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    };
}

function sendMessage() {
    const input = document.getElementById('message-input');
    const text = input.value.trim();
    if (!text || !currentChat) return;
    
    const message = {
        from: currentUser.id,
        to: currentChat.id,
        text: text,
        chatId: \`\${currentUser.id}_\${currentChat.id}\`.split('_').sort().join('_')
    };
    
    socket.emit('message', message);
    input.value = '';
    document.getElementById('send-button').disabled = true;
}

socket.on('newMessage', (data) => {
    if (currentChat && data.chatId.includes(currentUser.id)) {
        addMessageToChat(data.message, data.message.from === currentUser.id);
    }
});

function addMessageToChat(message, isSent) {
    const messagesContainer = document.getElementById('chat-messages');
    const messageEl = document.createElement('div');
    messageEl.className = 'message ' + (isSent ? 'sent' : '');
    const time = new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
    messageEl.innerHTML = \`
        <div class="msg-bubble \${isSent ? 'sent' : 'received'}\">
            \${message.text}
            <span class="msg-time">\${time}</span>
            \${isSent ? '<span class="read-indicator">✓✓</span>' : ''}
        </div>
    \`;
    messagesContainer.appendChild(messageEl);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

// Navigation
function showChats() { document.getElementById('chat-list-screen').classList.add('active'); }
function showContacts() { alert('📱 Contacts coming soon'); }
function showSettings() { alert('⚙️ Settings coming soon'); }
function toggleEditMode() { alert('✏️ Edit mode coming soon'); }

// Close overlay on outside click
document.getElementById('auth-overlay').onclick = (e) => {
    if (e.target.id === 'auth-overlay') {
        document.getElementById('auth-overlay').style.display = 'none';
    }
};
</script>
</body>
</html>`);
});

server.listen(process.env.PORT || 3000, () => {
    console.log('🚀 Zhuravlev Messenger v12.0 ✅ Запущен!');
});
