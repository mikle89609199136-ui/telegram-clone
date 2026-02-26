const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const path = require('path');
const compression = require('compression');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
  pingTimeout: 20000,
  pingInterval: 25000,
  transports: ['websocket']
});

// ==================== ПЕРСИСТЕНТНОЕ ХРАНЕНИЕ ====================
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

const USERS_FILE = path.join(DATA_DIR, 'users.json');
const CHATS_FILE = path.join(DATA_DIR, 'chats.json');

function loadUsers() {
  try {
    return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
  } catch {
    return {};
  }
}
function saveUsers(users) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

function loadChats() {
  try {
    return JSON.parse(fs.readFileSync(CHATS_FILE, 'utf8'));
  } catch {
    return {};
  }
}
function saveChats(chats) {
  fs.writeFileSync(CHATS_FILE, JSON.stringify(chats, null, 2));
}

let usersDB = loadUsers();
let privateChats = loadChats();
const onlineUsers = new Set(); // для быстрого доступа
const rateLimits = new Map();

// ==================== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ====================
function checkRate(userId) {
  const now = Date.now();
  const data = rateLimits.get(userId) || { count: 0, reset: now };
  if (now - data.reset > 60000) {
    data.count = 0;
    data.reset = now;
  }
  if (data.count > 30) return false;
  data.count++;
  rateLimits.set(userId, data);
  return true;
}

// ==================== МИДЛВАРЫ ====================
app.use(compression({ level: 6, threshold: 1024 }));
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1y', etag: false }));

// ==================== API ====================

// Регистрация
app.post('/api/register', (req, res) => {
  const { email, password, username, confirmPassword } = req.body;

  if (!email?.includes('@') || !username || password?.length < 6 || password !== confirmPassword) {
    return res.status(400).json({ error: 'Неверные данные' });
  }
  if (usersDB[email]) {
    return res.status(400).json({ error: 'Email уже используется' });
  }

  const userId = `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  usersDB[email] = {
    id: userId,
    email,
    username: username.toLowerCase(),
    name: username.charAt(0).toUpperCase() + username.slice(1),
    avatar: '👤',
    password,
    created: new Date().toISOString(),
    lastSeen: null,
    online: false
  };

  saveUsers(usersDB);
  res.json({ success: true, user: usersDB[email] });
});

// Логин
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;

  for (let email in usersDB) {
    const user = usersDB[email];
    if ((user.username === username || user.email === username) && user.password === password) {
      user.online = true;
      user.lastSeen = new Date().toISOString();
      saveUsers(usersDB);
      return res.json({ success: true, user });
    }
  }
  res.status(401).json({ error: 'Неверный логин или пароль' });
});

// Восстановление пароля (отправка кода)
app.post('/api/forgot-password', (req, res) => {
  const { email } = req.body;
  const user = usersDB[email];
  if (user) {
    const code = Math.floor(100000 + Math.random() * 900000);
    user.recoveryCode = code;
    user.recoveryExpires = Date.now() + 300000;
    saveUsers(usersDB);
    console.log(`📧 Код для ${email}: ${code}`); // замените на реальную отправку
    res.json({ success: true });
  } else {
    res.status(404).json({ error: 'Email не найден' });
  }
});

// Проверка кода
app.post('/api/verify-code', (req, res) => {
  const { email, code } = req.body;
  const user = usersDB[email];
  if (user && user.recoveryCode == code && Date.now() < user.recoveryExpires) {
    res.json({ success: true });
  } else {
    res.status(400).json({ error: 'Неверный код' });
  }
});

// Сброс пароля
app.post('/api/reset-password', (req, res) => {
  const { email, newPassword } = req.body;
  const user = usersDB[email];
  if (user) {
    user.password = newPassword;
    delete user.recoveryCode;
    delete user.recoveryExpires;
    saveUsers(usersDB);
    res.json({ success: true });
  } else {
    res.status(400).json({ error: 'Пользователь не найден' });
  }
});

// Список всех пользователей (кроме текущего)
app.get('/api/users', (req, res) => {
  const excludeId = req.query.exclude;
  const users = Object.values(usersDB).map(u => ({
    id: u.id, name: u.name, username: u.username,
    avatar: u.avatar, online: onlineUsers.has(u.id), lastSeen: u.lastSeen
  })).filter(u => !excludeId || u.id !== excludeId);
  res.json(users);
});

// Список чатов пользователя
app.get('/api/chats/:userId', (req, res) => {
  const userId = req.params.userId;
  const chats = [];
  for (let chatId in privateChats) {
    if (chatId.includes(userId)) {
      const messages = privateChats[chatId];
      const lastMsg = messages[messages.length - 1] || null;
      const participants = chatId.split('_');
      const otherId = participants.find(id => id !== userId);
      const otherUser = Object.values(usersDB).find(u => u.id === otherId);
      if (otherUser) {
        chats.push({
          chatId,
          userId: otherUser.id,
          name: otherUser.name,
          avatar: otherUser.avatar,
          online: onlineUsers.has(otherUser.id),
          lastMessage: lastMsg ? { text: lastMsg.text, time: lastMsg.time, from: lastMsg.from } : null,
          unread: messages.filter(m => m.to === userId && !m.read).length
        });
      }
    }
  }
  chats.sort((a, b) => (b.lastMessage?.time || 0) - (a.lastMessage?.time || 0));
  res.json(chats);
});

// История сообщений с конкретным пользователем
app.get('/api/messages/:userId/:otherId', (req, res) => {
  const { userId, otherId } = req.params;
  const chatId = [userId, otherId].sort().join('_');
  const messages = privateChats[chatId] || [];
  // Помечаем как прочитанные
  if (privateChats[chatId]) {
    privateChats[chatId].forEach(msg => {
      if (msg.to === userId) msg.read = true;
    });
    saveChats(privateChats);
  }
  res.json(messages);
});

// ==================== SOCKET.IO ====================
io.on('connection', (socket) => {
  console.log('🔌 Подключился:', socket.id);

  socket.on('join', (userId) => {
    socket.join(userId);
    socket.userId = userId;
    onlineUsers.add(userId);

    // Обновляем статус в базе
    for (let email in usersDB) {
      if (usersDB[email].id === userId) {
        usersDB[email].online = true;
        usersDB[email].lastSeen = new Date().toISOString();
        saveUsers(usersDB);
        break;
      }
    }

    io.emit('userOnline', userId);
  });

  socket.on('message', (data) => {
    if (!checkRate(data.from)) {
      socket.emit('error', 'Rate limit exceeded');
      return;
    }

    const chatId = [data.from, data.to].sort().join('_');
    if (!privateChats[chatId]) privateChats[chatId] = [];

    const message = {
      id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
      from: data.from,
      to: data.to,
      text: data.text.slice(0, 1000),
      time: new Date().toISOString(),
      read: false,
      edited: false
    };

    privateChats[chatId].push(message);
    saveChats(privateChats);

    io.to(data.from).to(data.to).emit('newMessage', { chatId, message });
  });

  socket.on('disconnect', () => {
    if (socket.userId) {
      onlineUsers.delete(socket.userId);

      for (let email in usersDB) {
        if (usersDB[email].id === socket.userId) {
          usersDB[email].online = false;
          usersDB[email].lastSeen = new Date().toISOString();
          saveUsers(usersDB);
          break;
        }
      }

      io.emit('userOffline', socket.userId);
    }
    console.log('🔌 Отключился:', socket.id);
  });
});

// ==================== КЛИЕНТ (ВСТРОЕННЫЙ HTML) ====================
app.get('/', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>Zhuravlev Messenger</title>
  <link href="https://fonts.googleapis.com/css2?family=SF+Pro+Display:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; font-family: 'SF Pro Display', -apple-system, sans-serif; }
    :root { --primary: #34c759; --bg: #eff2f5; --chatlist: #f8f9fa; }
    html, body { height: 100%; background: linear-gradient(135deg, #667eea, #764ba2); }
    #welcome-screen {
      position: fixed; inset: 0; background: linear-gradient(135deg, #0088cc, #005f99, #003d73);
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      color: white; padding: 2rem; z-index: 1000;
    }
    .logo { font-size: clamp(4rem,15vw,8rem); font-weight: 900; background: linear-gradient(135deg,#34c759,#5ac8fa,#ff3b30); -webkit-background-clip: text; -webkit-text-fill-color: transparent; margin-bottom: 1.5rem; animation: float 3s infinite; }
    @keyframes float { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-10px)} }
    .btn {
      width: 90%; max-width: 380px; padding: 1.6rem 3rem; margin-bottom: 1.8rem;
      background: linear-gradient(135deg, var(--primary), #30d158); color: white;
      border: none; border-radius: 28px; font-size: clamp(1.15rem,5vw,1.4rem);
      font-weight: 700; cursor: pointer; box-shadow: 0 14px 40px rgba(52,199,89,0.4);
      transition: 0.3s;
    }
    .btn:hover { transform: translateY(-4px); box-shadow: 0 22px 50px rgba(52,199,89,0.5); }
    .btn-outline { background: rgba(255,255,255,0.2); backdrop-filter: blur(25px); border: 1px solid rgba(255,255,255,0.2); }
    #auth-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.7); z-index: 1001; display: none; }
    .auth-card {
      position: absolute; bottom: 0; left: 0; right: 0; background: white; border-radius: 36px 36px 0 0;
      padding: 3rem 2.8rem 4rem; max-height: 90vh; overflow-y: auto; transform: translateY(100%);
      transition: transform 0.45s cubic-bezier(0.25,0.46,0.45,0.94);
    }
    .auth-card.visible { transform: translateY(0); }
    .auth-title { font-size: 2.6rem; font-weight: 800; margin-bottom: 0.7rem; }
    .auth-subtitle { color: #8e8e93; font-size: 1.2rem; margin-bottom: 3rem; }
    .field { margin-bottom: 2rem; }
    .field label { display: block; font-weight: 600; color: #3c3c43; margin-bottom: 0.9rem; }
    .field input {
      width: 100%; padding: 1.4rem 1.6rem; border: 2px solid #e5e5ea; border-radius: 20px;
      font-size: 1.1rem; background: #f2f2f7; transition: 0.3s;
    }
    .field input:focus { outline: none; border-color: var(--primary); box-shadow: 0 0 0 4px rgba(52,199,89,0.12); }
    .warning { font-size: 0.9rem; color: #ff9500; margin-top: 0.7rem; background: #fff5e6; padding: 0.8rem; border-radius: 12px; border-left: 4px solid #ff9500; }
    .auth-link { color: #007aff; text-decoration: none; font-weight: 600; cursor: pointer; }
    .code-grid { display: flex; gap: 1.4rem; justify-content: center; margin: 3.5rem 0; }
    .code-input {
      width: 68px; height: 68px; font-size: 2.2rem; font-weight: 800; text-align: center;
      border: 3px solid #e5e5ea; border-radius: 20px; background: #f2f2f7; font-family: monospace;
    }
    .code-input:focus { border-color: var(--primary); }
    .code-input.success { border-color: var(--primary) !important; background: #d4edda !important; }
    .code-input.error { border-color: #ff3b30 !important; background: #f8d7da !important; animation: shake 0.6s; }
    @keyframes shake { 0%,100%{transform:translateX(0)} 20%{transform:translateX(-10px)} 40%{transform:translateX(10px)} }
    #main-app { display: none; height: 100vh; flex-direction: column; background: var(--bg); }
    .screen { display: none; height: 100%; }
    .screen.active { display: block; }
    #chat-list { height: calc(100vh - 82px); overflow-y: auto; padding: 1.8rem 0; background: var(--chatlist); }
    .search-bar { position: sticky; top: 0; background: white; padding: 1.3rem 1.8rem; display: flex; box-shadow: 0 3px 15px rgba(0,0,0,0.1); z-index: 10; margin-bottom: 1.2rem; }
    .search-input { flex: 1; border: none; background: #f2f2f7; padding: 1.1rem 1.4rem; border-radius: 22px; }
    .search-edit { background: var(--primary); color: white; border-radius: 22px; padding: 1.1rem 1rem; margin-left: 0.8rem; font-weight: 600; border: none; cursor: pointer; }
    .chat-item { display: flex; padding: 1.2rem 1.8rem; margin: 0 1.2rem; border-radius: 18px; background: white; margin-bottom: 0.6rem; box-shadow: 0 2px 8px rgba(0,0,0,0.06); cursor: pointer; transition: 0.25s; }
    .chat-item:hover { background: #f0f8f0; transform: translateX(4px); }
    .avatar { width: 56px; height: 56px; border-radius: 28px; background: var(--primary); color: white; display: flex; align-items: center; justify-content: center; font-size: 1.4rem; margin-right: 1.4rem; }
    .chat-info { flex: 1; min-width: 0; }
    .chat-name { font-weight: 700; font-size: 1.05rem; color: black; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .chat-preview { font-size: 0.95rem; color: #8e8e93; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .chat-meta { display: flex; align-items: center; font-size: 0.85rem; color: #8e8e93; min-width: 80px; justify-content: flex-end; }
    .read-status { margin-right: 0.7rem; font-size: 1.05rem; }
    .chat-header { height: 75px; background: rgba(255,255,255,0.97); backdrop-filter: blur(30px); border-bottom: 1px solid #e5e5ea; display: flex; align-items: center; padding: 0 1.8rem; position: fixed; top: 0; left: 0; right: 0; z-index: 200; }
    .back-btn { width: 48px; height: 48px; border-radius: 24px; border: none; background: rgba(0,0,0,0.08); font-size: 1.45rem; cursor: pointer; margin-right: 1.2rem; }
    .chat-header .title { font-weight: 800; font-size: 1.25rem; flex: 1; }
    .chat-header .avatar { width: 44px; height: 44px; border-radius: 22px; background: var(--primary); color: white; font-size: 1.2rem; display: flex; align-items: center; justify-content: center; }
    .messages { flex: 1; overflow-y: auto; padding: 2rem 1.6rem; background: var(--bg); margin-top: 75px; padding-bottom: 120px; }
    .message { margin-bottom: 1.4rem; display: flex; align-items: flex-end; max-width: 84%; animation: slideIn 0.4s; }
    .message.sent { margin-left: auto; flex-direction: row-reverse; }
    .bubble { max-width: 100%; padding: 1.2rem 1.6rem; border-radius: 24px; font-size: 1rem; line-height: 1.5; box-shadow: 0 2px 6px rgba(0,0,0,0.1); position: relative; }
    .bubble.sent { background: var(--primary); color: white; border-bottom-right-radius: 10px; }
    .bubble.received { background: white; color: black; border-bottom-left-radius: 10px; }
    .time { font-size: 0.78rem; opacity: 0.9; margin-left: 0.8rem; font-weight: 600; }
    .read-indicator { position: absolute; bottom: 6px; right: 10px; font-size: 0.8rem; }
    @keyframes slideIn { from { opacity: 0; transform: translateY(30px); } to { opacity: 1; transform: translateY(0); } }
    .input-area {
      position: fixed; bottom: 0; left: 0; right: 0; background: rgba(255,255,255,0.98);
      backdrop-filter: blur(35px); padding: 1.4rem 1.8rem; display: flex; align-items: flex-end;
      gap: 1.4rem; border-top: 1px solid #e5e5ea; z-index: 150;
    }
    .attach-btn { width: 54px; height: 54px; border-radius: 27px; border: none; background: #f2f2f7; font-size: 1.45rem; cursor: pointer; }
    #message-input { flex: 1; padding: 1.2rem 1.6rem; border: 2px solid #e5e5ea; border-radius: 30px; font-size: 1.05rem; resize: none; max-height: 160px; min-height: 54px; background: #f2f2f7; }
    #send-btn { width: 54px; height: 54px; border-radius: 27px; border: none; background: var(--primary); color: white; font-size: 1.45rem; cursor: pointer; }
    #send-btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .bottom-nav { position: fixed; bottom: 0; left: 0; right: 0; height: 82px; background: rgba(255,255,255,0.98); backdrop-filter: blur(35px); display: flex; border-top: 1px solid #e5e5ea; z-index: 100; }
    .nav-item { flex: 1; padding: 1.3rem 0; text-align: center; border: none; background: none; cursor: pointer; font-size: 1.6rem; color: #8e8e93; }
    .nav-item.active { color: var(--primary); }
    .w-100 { width: 100%; }
    .mt-2 { margin-top: 2rem; }
    .text-center { text-align: center; }
    .text-muted { color: #8e8e93; }
  </style>
</head>
<body>
  <div id="welcome-screen">
    <div class="logo">📱</div>
    <h1 class="welcome-title">Zhuravlev Messenger</h1>
    <p class="welcome-subtitle">Fast. Secure. Everywhere you are.</p>
    <button class="btn" onclick="showRegister()">📝 Registration</button>
    <button class="btn btn-outline" onclick="showLogin()">🔐 Sign In</button>
  </div>

  <div id="auth-overlay">
    <!-- Register -->
    <div id="register-form" class="auth-card">
      <div class="auth-title">Create Account</div>
      <div class="auth-subtitle">Welcome to Zhuravlev Messenger</div>
      <div class="field">
        <label>Email</label>
        <input id="reg-email" type="email" placeholder="your@email.com">
      </div>
      <div class="field">
        <label>Username</label>
        <input id="reg-username" placeholder="@username">
        <div class="warning">⚠️ Username нельзя изменить после регистрации</div>
      </div>
      <div class="field">
        <label>Password</label>
        <input id="reg-password" type="password" placeholder="••••••••">
      </div>
      <div class="field">
        <label>Confirm Password</label>
        <input id="reg-confirm" type="password" placeholder="••••••••">
      </div>
      <button class="btn w-100 mt-2" onclick="register()">Create My Account</button>
      <p class="text-center mt-2 text-muted">Already have an account? <a class="auth-link" onclick="showLogin()">Sign In</a></p>
    </div>

    <!-- Login -->
    <div id="login-form" class="auth-card" style="display:none;">
      <div class="auth-title">Welcome Back</div>
      <div class="auth-subtitle">Sign in to continue</div>
      <div class="field">
        <label>Username or Email</label>
        <input id="login-username" placeholder="@username or email">
      </div>
      <div class="field">
        <label>Password</label>
        <input id="login-password" type="password" placeholder="••••••••">
      </div>
      <button class="btn w-100 mt-2" onclick="login()">Sign In</button>
      <p class="text-center mt-2"><a class="auth-link" onclick="showRegister()">Create new account</a></p>
      <p class="text-center"><a class="auth-link" onclick="showForgot()">Forgot Password?</a></p>
    </div>

    <!-- Forgot -->
    <div id="forgot-form" class="auth-card" style="display:none;">
      <div class="auth-title">Forgot Password?</div>
      <div class="auth-subtitle">Enter email to receive code</div>
      <div class="field">
        <label>Email</label>
        <input id="forgot-email" type="email" placeholder="your@email.com">
      </div>
      <button class="btn w-100 mt-2" onclick="sendRecovery()">Send Code</button>
      <p class="text-center mt-2"><a class="auth-link" onclick="showLogin()">← Back to Sign In</a></p>
    </div>

    <!-- Code -->
    <div id="code-form" class="auth-card" style="display:none;">
      <div class="auth-title">Enter Code</div>
      <div class="auth-subtitle">Check your email for 6-digit code</div>
      <div class="code-grid" id="code-grid">
        <input class="code-input" maxlength="1">
        <input class="code-input" maxlength="1">
        <input class="code-input" maxlength="1">
        <input class="code-input" maxlength="1">
        <input class="code-input" maxlength="1">
        <input class="code-input" maxlength="1">
      </div>
      <button class="btn w-100" onclick="verifyCode()">Verify Code</button>
      <p class="text-center mt-2"><a class="auth-link" onclick="showForgot()">← Back</a></p>
    </div>

    <!-- New Password -->
    <div id="newpass-form" class="auth-card" style="display:none;">
      <div class="auth-title">New Password</div>
      <div class="auth-subtitle">Enter new password twice</div>
      <div class="field">
        <label>New Password</label>
        <input id="new-pass" type="password">
      </div>
      <div class="field">
        <label>Confirm Password</label>
        <input id="new-confirm" type="password">
      </div>
      <button class="btn w-100 mt-2" onclick="resetPass()">Set New Password</button>
      <p class="text-center mt-2"><a class="auth-link" onclick="showCode()">← Back</a></p>
    </div>
  </div>

  <!-- Main App -->
  <div id="main-app">
    <div id="chat-list-screen" class="screen active">
      <div class="search-bar">
        <input class="search-input" placeholder="Search chats" id="chat-search" oninput="filterChats()">
        <button class="search-edit" onclick="alert('Edit mode')">Edit</button>
      </div>
      <div id="chat-list-container"></div>
    </div>

    <div id="chat-screen" class="screen">
      <div class="chat-header">
        <button class="back-btn" onclick="backToChats()">←</button>
        <div class="title" id="chat-title">Chat</div>
        <div class="avatar" id="chat-avatar">👤</div>
      </div>
      <div class="messages" id="chat-messages"></div>
      <div class="input-area">
        <button class="attach-btn">📎</button>
        <textarea id="message-input" placeholder="Type a message..." rows="1" oninput="autoResize(this); checkSendButton()"></textarea>
        <button id="send-btn" onclick="sendMessage()" disabled>➤</button>
      </div>
    </div>

    <nav class="bottom-nav">
      <button class="nav-item active" onclick="showChatList()">💬</button>
      <button class="nav-item" onclick="alert('Contacts')">👥</button>
      <button class="nav-item" onclick="alert('Settings')">⚙️</button>
    </nav>
  </div>

  <script src="/socket.io/socket.io.js"></script>
  <script>
    const socket = io({ transports: ['websocket'] });
    let currentUser = null;
    let currentChat = null;
    let recoveryEmail = '';
    let allUsers = [];
    let chats = [];
    let messages = [];

    // ========== UI ==========
    function showRegister() { showAuthForm('register-form'); }
    function showLogin() { showAuthForm('login-form'); }
    function showForgot() { showAuthForm('forgot-form'); }
    function showCode() { showAuthForm('code-form'); setupCodeInputs(); }
    function showNewPass() { showAuthForm('newpass-form'); }

    function showAuthForm(id) {
      document.querySelectorAll('.auth-card').forEach(el => el.style.display = 'none');
      document.getElementById(id).style.display = 'block';
      document.getElementById('auth-overlay').style.display = 'block';
      setTimeout(() => document.querySelector('.auth-card.visible')?.classList.remove('visible'), 10);
      document.getElementById(id).classList.add('visible');
    }

    function closeAuth() {
      document.getElementById('auth-overlay').style.display = 'none';
    }

    // ========== REGISTER ==========
    async function register() {
      const email = document.getElementById('reg-email').value.trim();
      const username = document.getElementById('reg-username').value.trim();
      const pass = document.getElementById('reg-password').value;
      const confirm = document.getElementById('reg-confirm').value;
      if (!email || !username || !pass || pass !== confirm) return alert('Проверьте поля');

      const res = await fetch('/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, username, password: pass, confirmPassword: confirm })
      });
      const data = await res.json();
      if (data.success) {
        alert('Регистрация успешна, теперь войдите');
        showLogin();
      } else {
        alert(data.error || 'Ошибка');
      }
    }

    // ========== LOGIN ==========
    async function login() {
      const username = document.getElementById('login-username').value.trim();
      const pass = document.getElementById('login-password').value;
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password: pass })
      });
      const data = await res.json();
      if (data.success) {
        currentUser = data.user;
        localStorage.setItem('user', JSON.stringify(currentUser));
        socket.emit('join', currentUser.id);
        closeAuth();
        document.getElementById('welcome-screen').style.display = 'none';
        document.getElementById('main-app').style.display = 'flex';
        loadChats();
        loadAllUsers();
      } else {
        alert(data.error || 'Ошибка входа');
      }
    }

    // ========== FORGOT ==========
    async function sendRecovery() {
      const email = document.getElementById('forgot-email').value.trim();
      if (!email) return alert('Введите email');
      recoveryEmail = email;
      const res = await fetch('/api/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      });
      const data = await res.json();
      if (data.success) {
        alert('Код отправлен (смотри в консоль)');
        showCode();
      } else {
        alert(data.error || 'Ошибка');
      }
    }

    function setupCodeInputs() {
      const inputs = document.querySelectorAll('.code-input');
      inputs.forEach((input, idx) => {
        input.value = '';
        input.oninput = (e) => {
          if (e.target.value.length === 1 && idx < 5) inputs[idx+1].focus();
        };
        input.onkeydown = (e) => {
          if (e.key === 'Backspace' && !e.target.value && idx > 0) inputs[idx-1].focus();
        };
      });
      inputs[0]?.focus();
    }

    async function verifyCode() {
      const inputs = document.querySelectorAll('.code-input');
      const code = Array.from(inputs).map(i => i.value).join('');
      if (code.length !== 6) return alert('Введите 6 цифр');

      const res = await fetch('/api/verify-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: recoveryEmail, code })
      });
      const data = await res.json();
      if (data.success) {
        inputs.forEach(i => i.classList.add('success'));
        setTimeout(() => {
          showNewPass();
          inputs.forEach(i => i.classList.remove('success'));
        }, 500);
      } else {
        inputs.forEach(i => i.classList.add('error'));
        setTimeout(() => inputs.forEach(i => i.classList.remove('error')), 1000);
        alert(data.error || 'Неверный код');
      }
    }

    async function resetPass() {
      const newPass = document.getElementById('new-pass').value;
      const confirm = document.getElementById('new-confirm').value;
      if (!newPass || newPass.length < 6) return alert('Минимум 6 символов');
      if (newPass !== confirm) return alert('Пароли не совпадают');

      const res = await fetch('/api/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: recoveryEmail, newPassword: newPass })
      });
      const data = await res.json();
      if (data.success) {
        alert('Пароль изменён, войдите');
        showLogin();
      } else {
        alert(data.error || 'Ошибка');
      }
    }

    // ========== ЗАГРУЗКА ДАННЫХ ==========
    async function loadAllUsers() {
      if (!currentUser) return;
      const res = await fetch('/api/users?exclude=' + currentUser.id);
      allUsers = await res.json();
    }

    async function loadChats() {
      if (!currentUser) return;
      const res = await fetch('/api/chats/' + currentUser.id);
      chats = await res.json();
      renderChatList();
    }

    function renderChatList() {
      const container = document.getElementById('chat-list-container');
      container.innerHTML = '';
      chats.forEach(chat => {
        const lastMsg = chat.lastMessage
          ? (chat.lastMessage.from === currentUser.id ? 'Вы: ' : '') + chat.lastMessage.text
          : 'Нет сообщений';
        const time = chat.lastMessage ? new Date(chat.lastMessage.time).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' }) : '';
        container.innerHTML += \`
          <div class="chat-item" onclick="openChat('\${chat.userId}', '\${chat.name}', '\${chat.avatar}')">
            <div class="avatar">\${chat.avatar}</div>
            <div class="chat-info">
              <div class="chat-name">\${chat.name}</div>
              <div class="chat-preview">\${lastMsg}</div>
            </div>
            <div class="chat-meta">
              <span class="read-status">\${chat.unread ? '🔵' : ''}</span>
              <span>\${time}</span>
            </div>
          </div>
        \`;
      });
    }

    // ========== ЧАТ ==========
    async function openChat(userId, name, avatar) {
      currentChat = { id: userId, name, avatar };
      document.getElementById('chat-title').innerText = name;
      document.getElementById('chat-avatar').innerText = avatar;
      document.getElementById('chat-list-screen').classList.remove('active');
      document.getElementById('chat-screen').style.display = 'flex';

      const res = await fetch(\`/api/messages/\${currentUser.id}/\${userId}\`);
      messages = await res.json();
      renderMessages();
    }

    function renderMessages() {
      const container = document.getElementById('chat-messages');
      container.innerHTML = '';
      messages.forEach(msg => {
        const isSent = msg.from === currentUser.id;
        const bubbleClass = isSent ? 'sent' : 'received';
        const time = new Date(msg.time).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' });
        container.innerHTML += \`
          <div class="message \${isSent ? 'sent' : ''}">
            <div class="bubble \${bubbleClass}">
              \${msg.text}
              <span class="time">\${time}</span>
              \${isSent ? '<span class="read-indicator">' + (msg.read ? '✓✓' : '✓') + '</span>' : ''}
            </div>
          </div>
        \`;
      });
      container.scrollTop = container.scrollHeight;
    }

    function backToChats() {
      document.getElementById('chat-screen').style.display = 'none';
      document.getElementById('chat-list-screen').classList.add('active');
      currentChat = null;
      loadChats();
    }

    function autoResize(textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = textarea.scrollHeight + 'px';
    }

    function checkSendButton() {
      const input = document.getElementById('message-input');
      const btn = document.getElementById('send-btn');
      btn.disabled = !input.value.trim();
    }

    async function sendMessage() {
      const input = document.getElementById('message-input');
      const text = input.value.trim();
      if (!text || !currentChat) return;

      const msg = { from: currentUser.id, to: currentChat.id, text };
      socket.emit('message', msg);
      input.value = '';
      checkSendButton();
      autoResize(input);
    }

    // ========== СОКЕТЫ ==========
    socket.on('newMessage', (data) => {
      if (currentChat && (data.message.from === currentChat.id || data.message.to === currentChat.id)) {
        messages.push(data.message);
        renderMessages();
      }
      loadChats(); // обновить список чатов
    });

    socket.on('userOnline', (userId) => { /* можно обновить статус */ });
    socket.on('userOffline', (userId) => { /* можно обновить статус */ });

    // ========== НАВИГАЦИЯ ==========
    function showChatList() {
      document.querySelectorAll('.nav-item').forEach((btn, i) => btn.classList.toggle('active', i === 0));
      document.getElementById('chat-list-screen').classList.add('active');
      document.getElementById('chat-screen').style.display = 'none';
      loadChats();
    }

    function filterChats() {
      // реализуйте при необходимости
    }

    // ========== ИНИЦИАЛИЗАЦИЯ ==========
    (function init() {
      const saved = localStorage.getItem('user');
      if (saved) {
        currentUser = JSON.parse(saved);
        socket.emit('join', currentUser.id);
        document.getElementById('welcome-screen').style.display = 'none';
        document.getElementById('main-app').style.display = 'flex';
        loadChats();
        loadAllUsers();
      }
    })();
  </script>
</body>
</html>`);
});

// ==================== ЗАПУСК ====================
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Zhuravlev Messenger запущен на порту ${PORT}`);
});
