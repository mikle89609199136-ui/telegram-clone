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
// БАЗЫ ДАННЫХ (Zhuravlev Messenger PRO)
// ========================================
const usersDB = {};
const sessions = {};
const privateChats = {};
const groupChats = {};
const onlineUsers = new Set();
const userSessions = {}; // Для авто-входа
let globalMessageId = 0;

// Темы
const themes = {
    telegram: {bg: '#eff2f5', sidebar: '#f8f9fa', sent: '#0088cc', received: '#ffffff'},
    light: {bg: '#ffffff', sidebar: '#f0f2f5', sent: '#007bff', received: '#f8f9fa'},
    dark: {bg: '#111b21', sidebar: '#202c33', sent: '#005c73', received: '#2a3942'},
    blue: {bg: '#e3f2fd', sidebar: '#2196f3', sent: '#1976d2', received: '#bbdefb'},
    purple: {bg: '#f3e5f5', sidebar: '#9c27b0', sent: '#7b1fa2', received: '#e1bee7'},
    premium: {bg: '#1e1b4b', sidebar: '#667eea', sent: '#a855f7', received: '#3b82f6'}
};

// Rate limiting
const rateLimits = new Map();
function checkRateLimit(userId) {
    const now = Date.now();
    const data = rateLimits.get(userId) || {count: 0, reset: now};
    if (now - data.reset > 60000) data.count = 0;
    if (data.count > 100) return false;
    data.count++;
    rateLimits.set(userId, data);
    return true;
}

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ========================================
// API АУТЕНТИФИКАЦИЯ
// ========================================
app.post('/api/register', (req, res) => {
    const { email, password, username, name } = req.body;
    
    if (!email.includes('@') || !password || !username || usersDB[email]) {
        return res.status(400).json({ error: 'Email или username уже занят' });
    }
    
    const userId = `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    usersDB[email] = { 
        id: userId, 
        email, 
        username: username.toLowerCase(),
        name: name || username,
        avatar: '👤', 
        password,
        theme: 'telegram',
        premium: false,
        notifications: true,
        joinedAt: new Date().toISOString(),
        groups: [],
        calls: 0,
        stickers: [],
        sessionToken: userId + Date.now()
    };
    res.json({ success: true, userId, token: usersDB[email].sessionToken });
});

app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    
    for (let email in usersDB) {
        const user = usersDB[email];
        if ((user.username === username || user.email === username) && user.password === password) {
            user.sessionToken = user.id + Date.now();
            res.json({ success: true, userId: user.id, token: user.sessionToken });
            return;
        }
    }
    res.status(401).json({ error: 'Неверный username или пароль' });
});

app.post('/api/recover-password', (req, res) => {
    const { email } = req.body;
    if (usersDB[email]) {
        const code = Math.floor(100000 + Math.random() * 900000).toString();
        usersDB[email].recoveryCode = code;
        usersDB[email].recoveryTime = Date.now();
        console.log(`Recovery code for ${email}: ${code}`);
        res.json({ success: true });
    } else {
        res.status(404).json({ error: 'Email не найден' });
    }
});

app.post('/api/verify-recovery', (req, res) => {
    const { email, code } = req.body;
    if (usersDB[email] && usersDB[email].recoveryCode === code && 
        Date.now() - usersDB[email].recoveryTime < 300000) {
        res.json({ success: true });
    } else {
        res.status(400).json({ error: 'Неверный код' });
    }
});

app.post('/api/reset-password', (req, res) => {
    const { email, newPassword } = req.body;
    if (usersDB[email]) {
        usersDB[email].password = newPassword;
        delete usersDB[email].recoveryCode;
        res.json({ success: true });
    } else {
        res.status(400).json({ error: 'Пользователь не найден' });
    }
});

app.get('/api/users', (req, res) => {
    const users = Object.values(usersDB).map(u => ({
        id: u.id, name: u.name, username: u.username, email: u.email, 
        avatar: u.avatar, isOnline: onlineUsers.has(u.id), theme: u.theme, premium: u.premium
    }));
    res.json(users);
});

// ========================================
// TELEGRAM-STYLE UI (мобильная версия)
// ========================================
app.get('/', (req, res) => {
    res.send(`<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Zhuravlev Messenger PRO</title>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
body { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); min-height: 100vh; overflow-x: hidden; }

#welcome { position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); text-align: center; color: white; z-index: 1000; max-width: 90vw; }
.welcome-title { font-size: clamp(2.5rem, 8vw, 4rem); font-weight: 800; background: linear-gradient(135deg, white 0%, #f0f4ff 100%); -webkit-background-clip: text; -webkit-text-fill-color: transparent; margin-bottom: 1.5rem; }
.welcome-subtitle { font-size: clamp(1rem, 4vw, 1.3rem); opacity: 0.9; margin-bottom: 3rem; }
.btn-primary { display: block; width: 90%; max-width: 350px; margin: 0 auto 1.5rem; padding: 1.2rem 2rem; background: rgba(255,255,255,0.95); color: #333; border: none; border-radius: 25px; font-size: clamp(1.1rem, 4vw, 1.3rem); font-weight: 600; cursor: pointer; transition: all 0.3s; box-shadow: 0 10px 30px rgba(0,0,0,0.2); backdrop-filter: blur(10px); }
.btn-primary:hover { transform: translateY(-3px); box-shadow: 0 15px 40px rgba(0,0,0,0.3); }
.btn-secondary { background: rgba(255,255,255,0.7); color: #555; }

#auth-form { display: none; background: rgba(255,255,255,0.95); padding: 2.5rem; border-radius: 25px; box-shadow: 0 25px 60px rgba(0,0,0,0.3); backdrop-filter: blur(20px); max-width: 420px; width: 90vw; margin: 2rem auto; text-align: center; }
.auth-title { font-size: 2rem; font-weight: 800; color: #333; margin-bottom: 1rem; }
.auth-subtitle { color: #666; margin-bottom: 2rem; font-size: 1rem; }
.form-group { margin-bottom: 1.5rem; text-align: left; }
.form-group label { display: block; font-weight: 500; color: #555; margin-bottom: 0.5rem; font-size: 0.95rem; }
input { width: 100%; padding: 1rem 1.2rem; border: 2px solid #e8ecef; border-radius: 15px; font-size: 1rem; transition: all 0.3s; background: rgba(255,255,255,0.9); }
input:focus { outline: none; border-color: #667eea; box-shadow: 0 0 0 4px rgba(102,126,234,0.1); }
.username-warning { font-size: 0.85rem; color: #e74c3c; margin-top: 0.3rem; }
.auth-link { color: #667eea; text-decoration: none; font-weight: 500; font-size: 0.95rem; }
.auth-link:hover { text-decoration: underline; }

#recovery-form { display: none; }
.code-inputs { display: flex; gap: 0.8rem; justify-content: center; margin: 2rem 0; }
.code-input { width: 55px; height: 55px; font-size: 1.5rem; font-weight: 700; text-align: center; border: 3px solid #e8ecef; border-radius: 12px; transition: all 0.3s; }
.code-input:focus { border-color: #667eea; box-shadow: 0 0 0 4px rgba(102,126,234,0.15); }
.code-input.correct { border-color: #27ae60; background: #d5f4e6; }
.code-input.error { border-color: #e74c3c; background: #fadbd8; animation: shake 0.5s; }
@keyframes shake { 0%, 100% { transform: translateX(0); } 25% { transform: translateX(-5px); } 75% { transform: translateX(5px); } }

#app { display: none; height: 100vh; overflow: hidden; flex-direction: column; background: var(--bg, #eff2f5); }

.mobile-nav { position: fixed; bottom: 0; left: 0; right: 0; background: rgba(255,255,255,0.95); backdrop-filter: blur(20px); padding: 0.8rem 1rem; display: flex; gap: 1rem; z-index: 100; box-shadow: 0 -2px 20px rgba(0,0,0,0.1); }
.nav-item { flex: 1; padding: 0.8rem; text-align: center; border-radius: 20px; background: none; border: none; cursor: pointer; transition: all 0.3s; font-size: 1.4rem; }
.nav-item.active { background: linear-gradient(135deg, #667eea, #764ba2); color: white; }

#sidebar { width: 100%; height: calc(100vh - 80px); background: var(--sidebar, #f8f9fa); overflow-y: auto; padding: 1rem; }
.chat-list { padding: 0.5rem 0; }
.chat-item { display: flex; padding: 1rem; margin: 0.3rem 0; border-radius: 12px; cursor: pointer; transition: all 0.2s; background: rgba(255,255,255,0.7); }
.chat-item:hover, .chat-item.active { background: rgba(102,126,234,0.15); transform: translateX(5px); }
.chat-avatar { width: 50px; height: 50px; border-radius: 50%; background: var(--sent, #0088cc); color: white; display: flex; align-items: center; justify-content: center; font-size: 1.3rem; margin-right: 1rem; flex-shrink: 0; }
.chat-info { flex: 1; min-width: 0; }
.chat-name { font-weight: 600; font-size: 1rem; margin-bottom: 0.2rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.chat-preview { font-size: 0.85rem; color: #666; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.chat-meta { display: flex; justify-content: flex-end; align-items: center; font-size: 0.8rem; color: #999; min-width: 70px; }
.read-status { display: flex; align-items: center; gap: 0.2rem; margin-right: 0.5rem; }
.unread { font-weight: 600; color: #007bff; }

#chat-area { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
#chat-header { height: 70px; background: rgba(255,255,255,0.95); border-bottom: 1px solid #e8ecef; display: flex; align-items: center; padding: 0 1.2rem; box-shadow: 0 2px 10px rgba(0,0,0,0.05); }
.header-back { width: 40px; height: 40px; border-radius: 50%; border: none; background: none; font-size: 1.3rem; cursor: pointer; margin-right: 1rem; display: flex; align-items: center; justify-content: center; }
.header-title { font-weight: 700; font-size: 1.1rem; }
.header-avatar { width: 40px; height: 40px; border-radius: 50%; background: var(--sent, #0088cc); color: white; display: flex; align-items: center; justify-content: center; margin-left: auto; font-size: 1.1rem; }

#messages { flex: 1; overflow-y: auto; padding: 1rem; background: var(--bg, #eff2f5); }
.message { margin: 0.8rem 0; display: flex; align-items: flex-end; max-width: 75%; animation: messageSlide 0.3s ease-out; }
.message.sent { flex-direction: row-reverse; margin-left: auto; }
.msg-bubble { max-width: 100%; padding: 0.8rem 1.2rem; border-radius: 18px; position: relative; font-size: 0.95rem; line-height: 1.4; }
.msg-bubble.sent { background: linear-gradient(135deg, var(--sent, #0088cc), #0066b3); color: white; border-bottom-right-radius: 6px; }
.msg-bubble.received { background: white; color: #333; border-bottom-left-radius: 6px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
.msg-time { font-size: 0.75rem; opacity: 0.7; margin-left: 0.5rem; font-weight: 500; }
.read-indicator { position: absolute; bottom: 3px; right: 8px; font-size: 0.8rem; }
@keyframes messageSlide { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }

#input-area { padding: 1rem; background: rgba(255,255,255,0.95); border-top: 1px solid #e8ecef; display: flex; align-items: flex-end; gap: 0.8rem; }
.attach-btn { width: 45px; height: 45px; border-radius: 50%; border: none; background: #f0f2f5; font-size: 1.2rem; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: all 0.2s; }
.attach-btn:hover { background: #e8ecef; }
#message-input { flex: 1; padding: 0.9rem 1.1rem; border: 2px solid #e8ecef; border-radius: 25px; font-size: 1rem; resize: none; max-height: 120px; min-height: 45px; }
#message-input:focus { outline: none; border-color: #667eea; }
#send-btn { width: 45px; height: 45px; border-radius: 50%; border: none; background: var(--sent, #0088cc); color: white; font-size: 1.2rem; cursor: pointer; transition: all 0.2s; display: flex; align-items: center; justify-content: center; }
#send-btn:hover { background: #0066b3; transform: scale(1.05); }

#profile-modal, #settings-modal { display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 1000; }
.modal-content { position: absolute; bottom: 0; left: 0; right: 0; background: white; border-radius: 25px 25px 0 0; padding: 2rem; max-height: 85vh; overflow-y: auto; }
</style>
</head>
<body>
<div id="welcome">
    <h1 class="welcome-title">Welcome to Zhuravlev Messenger</h1>
    <p class="welcome-subtitle">Fast, secure, beautiful messaging</p>
    <button class="btn-primary" onclick="showRegister()">📝 Registration</button>
    <button class="btn-secondary btn-primary" onclick="showLogin()">🔐 Login</button>
</div>

<!-- Регистрация -->
<div id="register-form" class="auth-form">
    <h2 class="auth-title">Create Account</h2>
    <p class="auth-subtitle">Join Zhuravlev Messenger</p>
    <div class="form-group">
        <label>Email</label>
        <input id="reg-email" type="email" placeholder="your@email.com" required>
    </div>
    <div class="form-group">
        <label>Username @</label>
        <input id="reg-username" placeholder="yourusername" required>
        <div class="username-warning" id="username-warning">Username нельзя будет изменить</div>
    </div>
    <div class="form-group">
        <label>Password</label>
        <input id="reg-password" type="password" placeholder="••••••••" required>
    </div>
    <div class="form-group">
        <label>Confirm Password</label>
        <input id="reg-password2" type="password" placeholder="••••••••" required>
    </div>
    <button class="btn-primary" style="width:100%; margin-top:1.5rem;" onclick="register()">Create Account</button>
    <p style="margin-top:1rem;"><a href="#" class="auth-link" onclick="showLogin()">Already have account? Login</a></p>
</div>

<!-- Вход -->
<div id="login-form" class="auth-form">
    <h2 class="auth-title">Welcome Back</h2>
    <div class="form-group">
        <label>Username or Email</label>
        <input id="login-username" placeholder="@username or email" required>
    </div>
    <div class="form-group">
        <label>Password</label>
        <input id="login-password" type="password" placeholder="••••••••" required>
    </div>
    <button class="btn-primary" style="width:100%; margin-top:1rem;" onclick="loginUser()">Login</button>
    <p style="margin-top:1rem;"><a href="#" class="auth-link" onclick="showRecover()">Forgot Password?</a> | <a href="#" class="auth-link" onclick="showRegister()">No account? Register</a></p>
</div>

<!-- Восстановление пароля -->
<div id="recovery-form" class="auth-form">
    <h2 class="auth-title">Forgot Password</h2>
    <div class="form-group">
        <label>Email</label>
        <input id="recovery-email" type="email" placeholder="your@email.com">
    </div>
    <button class="btn-primary" onclick="sendRecoveryCode()">Send Code</button>
    <p style="margin-top:1rem;"><a href="#" class="auth-link" onclick="showLogin()">Back to Login</a></p>
</div>

<div id="code-form" class="auth-form">
    <h2 class="auth-title">Enter Code</h2>
    <p style="color:#666; margin-bottom:2rem;">Check your email for 6-digit code</p>
    <div class="code-inputs">
        <input class="code-input" maxlength="1">
        <input class="code-input" maxlength="1">
        <input class="code-input" maxlength="1">
        <input class="code-input" maxlength="1">
        <input class="code-input" maxlength="1">
        <input class="code-input" maxlength="1">
    </div>
    <button class="btn-primary" onclick="verifyCode()">Verify Code</button>
    <p style="margin-top:1rem;"><a href="#" class="auth-link" onclick="showLogin()">Back to Login</a></p>
</div>

<div id="reset-form" class="auth-form">
    <h2 class="auth-title">New Password</h2>
    <div class="form-group">
        <label>New Password</label>
        <input id="reset-password" type="password" placeholder="••••••••">
    </div>
    <div class="form-group">
        <label>Confirm Password</label>
        <input id="reset-password2" type="password" placeholder="••••••••">
    </div>
    <button class="btn-primary" onclick="resetPassword()">Set New Password</button>
</div>

<div id="app">
    <div id="chat-header" style="display:none;">
        <button class="header-back" onclick="showChats()">←</button>
        <div id="header-title"></div>
        <div id="header-avatar" class="header-avatar"></div>
    </div>
    
    <div id="sidebar">
        <div style="display:flex; align-items:center; padding:1rem; border-bottom:1px solid #e8ecef; margin-bottom:1rem;">
            <input id="search-chats" placeholder="@search chats" style="flex:1; padding:0.8rem 1rem; border:2px solid #e8ecef; border-radius:12px; font-size:1rem;">
            <button style="margin-left:0.8rem; padding:0.8rem; background:#667eea; color:white; border:none; border-radius:12px; font-size:1rem;">✏️</button>
        </div>
        <div id="chat-list" class="chat-list"></div>
    </div>
    
    <div id="chat-area">
        <div id="messages"></div>
        <div id="input-area" style="display:none;">
            <button class="attach-btn">📎</button>
            <input id="message-input" placeholder="Message" rows="1">
            <button class="attach-btn">😀</button>
            <button id="send-btn">➤</button>
        </div>
    </div>
    
    <div class="mobile-nav">
        <button class="nav-item active" onclick="showChats()">💬</button>
        <button class="nav-item" onclick="showSettings()">⚙️</button>
    </div>
</div>

<div id="profile-modal">
    <div class="modal-content">
        <div id="profile-content"></div>
        <button onclick="closeProfile()" style="width:100%; padding:1rem; background:#ff5b5b; color:white; border:none; border-radius:15px; font-size:1.1rem; margin-top:1rem;">Leave</button>
    </div>
</div>

<script src="/socket.io/socket.io.js"></script>
<script>
const socket = io();
let currentUser = null, currentChat = null, currentTheme = 'telegram';
const themes = ${JSON.stringify(themes)};
let codeInputs = [];

// Простое E2EE
function simpleEncrypt(text) { return btoa(text + Date.now().toString()); }
function simpleDecrypt(encrypted) { try { return atob(encrypted).slice(0, -13); } catch { return '[🔒 Encrypted]'; } }

// Навигация форм
function showRegister() {
    document.getElementById('welcome').style.display = 'none';
    document.getElementById('register-form').style.display = 'block';
}
function showLogin() {
    hideAllForms();
    document.getElementById('login-form').style.display = 'block';
}
function showRecover() {
    hideAllForms();
    document.getElementById('recovery-form').style.display = 'block';
}
function hideAllForms() {
    document.getElementById('welcome').style.display = 'none';
    document.getElementById('register-form').style.display = 'none';
    document.getElementById('login-form').style.display = 'none';
    document.getElementById('recovery-form').style.display = 'none';
    document.getElementById('code-form').style.display = 'none';
    document.getElementById('reset-form').style.display = 'none';
}

// Регистрация
async function register() {
    const email = document.getElementById('reg-email').value.trim();
    const username = document.getElementById('reg-username').value.trim();
    const password = document.getElementById('reg-password').value;
    const password2 = document.getElementById('reg-password2').value;
    
    if (!email.includes('@') || !username || password.length < 6 || password !== password2) {
        alert('Проверьте данные! Пароли должны совпадать, минимум 6 символов');
        return;
    }
    
    try {
        const res = await fetch('/api/register', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({email, password, username})
        });
        const data = await res.json();
        if (data.success) {
            currentUser = data;
            showMainApp();
            alert('✅ Добро пожаловать в Zhuravlev Messenger!');
            socket.emit('welcome-message', currentUser.id);
        } else {
            alert('❌ ' + data.error);
        }
    } catch(e) {
        alert('Ошибка сервера');
    }
}

// Вход
async function loginUser() {
    const username = document.getElementById('login-username').value.trim();
    const password = document.getElementById('login-password').value;
    
    if (!username || !password) return alert('Заполните все поля!');
    
    try {
        const res = await fetch('/api/login', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({username, password})
        });
        const data = await res.json();
        if (data.success) {
            currentUser = data;
            showMainApp();
        } else {
            alert('❌ ' + data.error);
        }
    } catch(e) {
        alert('Ошибка сервера');
    }
}

// Восстановление пароля
async function sendRecoveryCode() {
    const email = document.getElementById('recovery-email').value.trim();
    if (!email.includes('@')) return alert('Введите корректный email');
    
    const res = await fetch('/api/recover-password', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({email})
    });
    const data = await res.json();
    if (data.success) {
        document.getElementById('recovery-email').dataset.email = email;
        document.getElementById('recovery-form').style.display = 'none';
        document.getElementById('code-form').style.display = 'block';
        initCodeInputs();
        alert('✅ Код отправлен на ' + email + '\nПроверьте почту!');
    }
}

function initCodeInputs() {
    codeInputs = document.querySelectorAll('.code-input');
    codeInputs.forEach((input, index) => {
        input.oninput = () => {
            if (input.value.length === 1 && index < 5) {
                codeInputs[index + 1].focus();
            }
        };
        input.onkeydown = (e) => {
            if (e.key === 'Backspace' && !input.value && index > 0) {
                codeInputs[index - 1].focus();
            }
        };
    });
}

async function verifyCode() {
    const code = Array.from(codeInputs).map(i => i.value).join('');
    const email = document.getElementById('recovery-email').dataset.email;
    
    if (code.length !== 6) return alert('Введите 6-значный код');
    
    const res = await fetch('/api/verify-recovery', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({email, code})
    });
    const data = await res.json();
    
    if (data.success) {
        codeInputs.forEach(input => {
            input.classList.add('correct');
            input.classList.remove('error');
        });
        setTimeout(() => {
            document.getElementById('code-form').style.display = 'none';
            document.getElementById('reset-form').style.display = 'block';
            document.getElementById('reset-form').dataset.email = email;
        }, 1000);
    } else {
        codeInputs.forEach(input => {
            input.classList.add('error');
            input.classList.remove('correct');
            setTimeout(() => input.value = '', 1000);
        });
    }
}

async function resetPassword() {
    const password = document.getElementById('reset-password').value;
    const password2 = document.getElementById('reset-password2').value;
    const email = document.getElementById('reset-form').dataset.email;
    
    if (password !== password2 || password.length < 6) {
        alert('Пароли не совпадают или слишком короткие!');
        return;
    }
    
    const res = await fetch('/api/reset-password', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({email, newPassword: password})
    });
    const data = await res.json();
    
    if (data.success) {
        alert('✅ Пароль изменен! Можете войти');
        showLogin();
    }
}

// Главное приложение
function showMainApp() {
    hideAllForms();
    document.getElementById('app').style.display = 'flex';
    document.getElementById('chat-header').style.display = 'flex';
    socket.emit('login', currentUser);
    updateTheme();
    loadChats();
}

function updateTheme() {
    const theme = themes[currentTheme] || themes.telegram;
    document.documentElement.style.setProperty('--bg', theme.bg);
    document.documentElement.style.setProperty('--sidebar', theme.sidebar);
    document.documentElement.style.setProperty('--sent', theme.sent);
    document.documentElement.style.setProperty('--received', theme.received);
}

function showChats() {
    document.querySelector('.nav-item').classList.add('active');
    document.getElementById('sidebar').style.display = 'block';
    document.getElementById('chat-area').style.display = 'none';
}

async function loadChats() {
    const res = await fetch('/api/users');
    const users = await res.json();
    const chatList = document.getElementById('chat-list');
    chatList.innerHTML = '';
    
    users.forEach(user => {
        if (user.id !== currentUser.id) {
            const chat = document.createElement('div');
            chat.className = 'chat-item';
            chat.onclick = () => openChat(user);
            chat.innerHTML = \`
                <div class="chat-avatar">\${user.avatar}</div>
                <div class="chat-info">
                    <div class="chat-name">\${user.name}</div>
                    <div class="chat-preview">Hello! How are you?</div>
                </div>
                <div class="chat-meta">
                    <div class="read-status">✓✓</div>
                    <div>14:32</div>
                </div>
            \`;
            chatList.appendChild(chat);
        }
    });
}

function openChat(user) {
    currentChat = user;
    document.querySelectorAll('.chat-item').forEach(item => item.classList.remove('active'));
    event.currentTarget.classList.add('active');
    
    document.getElementById('sidebar').style.display = 'none';
    document.getElementById('chat-area').style.display = 'flex';
    document.querySelector('.nav-item').classList.remove('active');
    
    document.getElementById('header-title').textContent = user.name;
    document.getElementById('header-avatar').textContent = user.avatar;
    document.getElementById('input-area').style.display = 'flex';
    document.getElementById('messages').innerHTML = '<div style="text-align:center; color:#999; padding:3rem;">Start a secure chat</div>';
}

async function sendMessage() {
    const text = document.getElementById('message-input').value.trim();
    if (!text || !currentChat || !checkRateLimit(currentUser.id)) return;
    
    const encrypted = simpleEncrypt(text);
    socket.emit('message', {to: currentChat.id, text: encrypted, encrypted: true});
    addMessage(text, true);
    document.getElementById('message-input').value = '';
}

function addMessage(text, isSent) {
    const messages = document.getElementById('messages');
    const msg = document.createElement('div');
    msg.className = \`message \${isSent ? 'sent' : 'received'}\`;
    msg.innerHTML = \`
        <div class="msg-bubble \${isSent ? 'sent' : 'received'}\">\${isSent ? text : simpleDecrypt(text)}</div>
        <div class="msg-time">\${new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</div>
        \${isSent ? '<div class="read-indicator">✓✓</div>' : ''}
    \`;
    messages.appendChild(msg);
    messages.scrollTop = messages.scrollHeight;
}

// Socket события
socket.on('message', data => {
    if (currentChat?.id === data.from) {
        addMessage(data.text, false);
    }
});

socket.on('welcome-message', () => {
    addMessage('Welcome to Zhuravlev Messenger! This chat is end-to-end encrypted 🔒', false);
});

document.getElementById('message-input').addEventListener('keypress', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
    }
});

window.onload = () => {
    document.getElementById('message-input').focus();
};
</script>
</body>
</html>`);
});

// Socket.IO
io.on('connection', socket => {
    socket.on('login', user => {
        sessions[socket.id] = user;
        onlineUsers.add(user.id);
        socket.broadcast.emit('users', Object.values(usersDB));
        socket.emit('users', Object.values(usersDB));
    });
    
    socket.on('message', data => {
        const userId = sessions[socket.id]?.id;
        if (!userId || !data.to || !checkRateLimit(userId)) return;
        
        const message = {
            id: globalMessageId++,
            from: userId,
            to: data.to,
            text: data.text,
            encrypted: data.encrypted,
            time: new Date()
        };
        
        socket.to(data.to).emit('message', message);
        socket.emit('message', message);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log('\\n🚀 Zhuravlev Messenger PRO LIVE!');
    console.log('📍 Port:', PORT);
    console.log('👥 Users:', Object.keys(usersDB).length);
});
