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

// ==================== НАСТРОЙКА ХРАНЕНИЯ ДАННЫХ ====================
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

const USERS_FILE = path.join(DATA_DIR, 'users.json');
const CHATS_FILE = path.join(DATA_DIR, 'chats.json');

// Чтение/запись пользователей
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

// Чтение/запись чатов
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

// Инициализация
let usersDB = loadUsers();
let privateChats = loadChats();
const onlineUsers = new Map(); // userId -> socketId

// Rate limiting
const rateLimits = new Map();
function checkRate(userId) {
  const now = Date.now();
  const data = rateLimits.get(userId) || { count: 0, reset: now + 60000 };
  if (now > data.reset) {
    data.count = 0;
    data.reset = now + 60000;
  }
  if (data.count > 30) return false;
  data.count++;
  rateLimits.set(userId, data);
  return true;
}

// ==================== МИДЛВАРЫ ====================
app.use(compression());
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1d' }));
app.set('trust proxy', 1);

// ==================== API МАРШРУТЫ ====================

// Регистрация
app.post('/api/register', (req, res) => {
  const { email, password, username, confirmPassword } = req.body;

  if (!email.includes('@') || !username || password.length < 6 || password !== confirmPassword) {
    return res.status(400).json({ error: 'Неверные данные или пароли не совпадают' });
  }
  if (usersDB[email]) {
    return res.status(400).json({ error: 'Аккаунт с таким email уже существует' });
  }

  const userId = `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  usersDB[email] = {
    id: userId,
    email,
    username: username.toLowerCase(),
    name: username.charAt(0).toUpperCase() + username.slice(1),
    avatar: '👤',
    password, // в реальном проекте нужно хешировать!
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
  if (usersDB[email]) {
    const code = Math.floor(100000 + Math.random() * 900000);
    usersDB[email].recoveryCode = code;
    usersDB[email].recoveryExpires = Date.now() + 300000;
    saveUsers(usersDB);
    console.log(`📧 Код для ${email}: ${code}`); // в реальном проекте отправляйте на email
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

// Получить всех пользователей (кроме текущего)
app.get('/api/users', (req, res) => {
  const excludeId = req.query.exclude;
  const users = Object.values(usersDB).map(u => ({
    id: u.id, name: u.name, username: u.username,
    avatar: u.avatar, online: u.online, lastSeen: u.lastSeen
  })).filter(u => !excludeId || u.id !== excludeId);
  res.json(users);
});

// Получить чаты текущего пользователя
app.get('/api/chats/:userId', (req, res) => {
  const userId = req.params.userId;
  const chats = [];
  for (let chatId in privateChats) {
    if (chatId.includes(userId)) {
      const messages = privateChats[chatId];
      const lastMsg = messages.length > 0 ? messages[messages.length - 1] : null;
      // Определяем собеседника
      const participants = chatId.split('_');
      const otherId = participants.find(id => id !== userId);
      const otherUser = Object.values(usersDB).find(u => u.id === otherId);
      if (otherUser) {
        chats.push({
          chatId,
          userId: otherUser.id,
          name: otherUser.name,
          avatar: otherUser.avatar,
          online: otherUser.online,
          lastMessage: lastMsg ? { text: lastMsg.text, time: lastMsg.time, from: lastMsg.from } : null,
          unread: messages.filter(m => m.to === userId && !m.read).length
        });
      }
    }
  }
  // Сортируем по последнему сообщению
  chats.sort((a, b) => {
    const timeA = a.lastMessage ? new Date(a.lastMessage.time) : 0;
    const timeB = b.lastMessage ? new Date(b.lastMessage.time) : 0;
    return timeB - timeA;
  });
  res.json(chats);
});

// Получить историю сообщений с конкретным пользователем
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
  console.log('🔌 Пользователь подключился:', socket.id);

  socket.on('join', (userId) => {
    socket.join(userId);
    socket.userId = userId;
    onlineUsers.set(userId, socket.id);

    // Обновляем статус online в базе
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
      text: data.text,
      time: new Date().toISOString(),
      read: false,
      edited: false
    };

    privateChats[chatId].push(message);
    saveChats(privateChats);

    // Отправляем получателю, если онлайн
    io.to(data.from).to(data.to).emit('newMessage', { chatId, message });
  });

  socket.on('typing', (data) => {
    socket.to(data.to).emit('typing', { from: data.from });
  });

  socket.on('disconnect', () => {
    if (socket.userId) {
      onlineUsers.delete(socket.userId);

      // Обновляем статус в базе
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
    console.log('🔌 Пользователь отключился:', socket.id);
  });
});

// ==================== КЛИЕНТ (HTML + CSS + JS) ====================
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
      --blue: #0088cc;
      --white: #ffffff;
      --gray: #8e8e93;
      --bg: #eff2f5;
      --chatlist: #f8f9fa;
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
    .auth-link { color: #007aff; text-decoration: none; font-weight: 600; font-size: 1.05rem; cursor: pointer; }
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

    #main-app { display: none; height: 100vh; overflow: hidden; flex-direction: column; background: var(--bg); }
    .chat-list-screen, .chat-screen { display: none; height: 100%; }
    .chat-list-screen.active { display: block; }

    #chat-list-container { width: 100%; height: calc(100vh - 82px); background: var(--chatlist); overflow-y: auto; padding: 1.8rem 0; }
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

    .chat-messages { flex: 1; overflow-y: auto; padding: 2rem 1.6rem; background: var(--bg); margin-top: 75px; padding-bottom: 120px; }
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
    #send-button:disabled { opacity: 0.5; cursor: not-allowed; }

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

  <!-- Auth Overlay -->
  <div id="auth-overlay">
    <!-- Registration Form -->
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
        Already have an account? <a class="auth-link" onclick="showLoginForm(); return false;">Sign In</a>
      </p>
    </div>

    <!-- Login Form -->
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
        <a class="auth-link" onclick="showRegisterForm(); return false;">Create new account</a>
      </p>
      <p style="margin-top:1.5rem; text-align:center;">
        <a class="auth-link" onclick="showForgotPassword(); return false;">Forgot Password?</a>
      </p>
    </div>

    <!-- Forgot Password -->
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
        <a class="auth-link" onclick="showLoginForm(); return false;">← Back to Sign In</a>
      </p>
    </div>

    <!-- Code Verification -->
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
        <a class="auth-link" onclick="showForgotPassword(); return false;">← Back</a>
      </p>
    </div>

    <!-- New Password -->
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
        <a class="auth-link" onclick="showCodeForm(); return false;">← Back</a>
      </p>
    </div>
  </div>

  <!-- Main App -->
  <div id="main-app">
    <div id="chat-list-screen" class="chat-list-screen active">
      <div class="search-bar">
        <input class="search-input" placeholder="Search chats" id="chat-search" oninput="filterChats()">
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
        <textarea id="message-input" placeholder="Type a message..." rows="1" oninput="autoResize(this); checkSendButton()"></textarea>
        <button id="send-button" onclick="sendMessage()" disabled>➤</button>
      </div>
    </div>

    <nav class="bottom-nav">
      <button class="nav-item active" onclick="showChats()">💬</button>
      <button class="nav-item" onclick="showContacts()">👥</button>
      <button class="nav-item" onclick="showSettings()">⚙️</button>
    </nav>
  </div>

  <script src="/socket.io/socket.io.js"></script>
  <script>
    const socket = io();
    let currentUser = null;
    let currentChat = null;
    let recoveryEmail = '';
    let allUsers = [];
    let chats = [];
    let messages = [];
    let typingTimeout = null;

    // ========== УПРАВЛЕНИЕ ЭКРАНАМИ ==========
    function showRegisterForm() {
      hideAllForms();
      document.getElementById('register-form').style.display = 'block';
      document.getElementById('auth-overlay').style.display = 'block';
      setTimeout(() => document.querySelector('.auth-card.visible')?.classList.remove('visible'), 10);
      document.querySelector('#register-form').classList.add('visible');
    }

    function showLoginForm() {
      hideAllForms();
      document.getElementById('login-form').style.display = 'block';
      document.getElementById('auth-overlay').style.display = 'block';
      document.querySelector('#login-form').classList.add('visible');
    }

    function showForgotPassword() {
      hideAllForms();
      document.getElementById('forgot-password-form').style.display = 'block';
      document.getElementById('auth-overlay').style.display = 'block';
      document.querySelector('#forgot-password-form').classList.add('visible');
    }

    function showCodeForm() {
      hideAllForms();
      document.getElementById('code-form').style.display = 'block';
      document.getElementById('auth-overlay').style.display = 'block';
      document.querySelector('#code-form').classList.add('visible');
      setupCodeInputs();
    }

    function showNewPasswordForm() {
      hideAllForms();
      document.getElementById('new-password-form').style.display = 'block';
      document.getElementById('auth-overlay').style.display = 'block';
      document.querySelector('#new-password-form').classList.add('visible');
    }

    function hideAllForms() {
      document.querySelectorAll('.auth-card').forEach(form => {
        form.style.display = 'none';
        form.classList.remove('visible');
      });
    }

    function closeAuth() {
      document.getElementById('auth-overlay').style.display = 'none';
    }

    // ========== РЕГИСТРАЦИЯ ==========
    async function registerUser() {
      const email = document.getElementById('reg-email').value.trim();
      const username = document.getElementById('reg-username').value.trim();
      const password = document.getElementById('reg-password').value;
      const confirmPassword = document.getElementById('reg-confirm-password').value;

      if (!email || !username || !password || !confirmPassword) {
        alert('Заполните все поля');
        return;
      }

      const res = await fetch('/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, username, password, confirmPassword })
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
        alert(data.error || 'Ошибка регистрации');
      }
    }

    // ========== ЛОГИН ==========
    async function loginUser() {
      const username = document.getElementById('login-username').value.trim();
      const password = document.getElementById('login-password').value;

      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
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

    // ========== ВОССТАНОВЛЕНИЕ ПАРОЛЯ ==========
    async function sendRecoveryCode() {
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
        showCodeForm();
      } else {
        alert(data.error || 'Ошибка');
      }
    }

    function setupCodeInputs() {
      const inputs = document.querySelectorAll('.code-input');
      inputs.forEach((input, index) => {
        input.value = '';
        input.addEventListener('input', (e) => {
          if (e.target.value.length === 1 && index < inputs.length - 1) {
            inputs[index + 1].focus();
          }
        });
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Backspace' && !e.target.value && index > 0) {
            inputs[index - 1].focus();
          }
        });
      });
      inputs[0].focus();
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
          showNewPasswordForm();
        }, 500);
      } else {
        inputs.forEach(i => i.classList.add('error'));
        setTimeout(() => inputs.forEach(i => i.classList.remove('error')), 1000);
        alert(data.error || 'Неверный код');
      }
    }

    async function resetPassword() {
      const newPass = document.getElementById('new-password').value;
      const confirm = document.getElementById('new-confirm-password').value;
      if (!newPass || newPass.length < 6) return alert('Пароль должен быть минимум 6 символов');
      if (newPass !== confirm) return alert('Пароли не совпадают');

      const res = await fetch('/api/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: recoveryEmail, newPassword: newPass })
      });
      const data = await res.json();
      if (data.success) {
        alert('Пароль изменён, теперь войдите');
        showLoginForm();
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
        const lastMsg = chat.lastMessage ? (chat.lastMessage.from === currentUser.id ? 'Вы: ' : '') + chat.lastMessage.text : 'Нет сообщений';
        const time = chat.lastMessage ? new Date(chat.lastMessage.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
        container.innerHTML += \`
          <div class="chat-item" onclick="openChat('\${chat.userId}', '\${chat.name}', '\${chat.avatar}')">
            <div class="chat-avatar">\${chat.avatar}</div>
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

      // Загружаем историю
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
        const time = new Date(msg.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        container.innerHTML += \`
          <div class="message \${isSent ? 'sent' : ''}">
            <div class="msg-bubble \${bubbleClass}">
              \${msg.text}
              <span class="msg-time">\${time}</span>
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
      loadChats(); // обновить список (непрочитанные и т.д.)
    }

    function autoResize(textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = (textarea.scrollHeight) + 'px';
    }

    function checkSendButton() {
      const input = document.getElementById('message-input');
      const btn = document.getElementById('send-button');
      btn.disabled = !input.value.trim();
    }

    async function sendMessage() {
      const input = document.getElementById('message-input');
      const text = input.value.trim();
      if (!text || !currentChat) return;

      const message = {
        from: currentUser.id,
        to: currentChat.id,
        text: text
      };
      socket.emit('message', message);
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
      // Обновить список чатов (последнее сообщение)
      loadChats();
    });

    socket.on('userOnline', (userId) => {
      // можно обновить индикатор в шапке чата
    });

    socket.on('userOffline', (userId) => {
      // аналогично
    });

    // ========== НАВИГАЦИЯ ==========
    function showChats() {
      document.querySelectorAll('.nav-item').forEach((btn, idx) => {
        btn.classList.toggle('active', idx === 0);
      });
      document.getElementById('chat-list-screen').classList.add('active');
      document.getElementById('chat-screen').style.display = 'none';
      loadChats();
    }

    function showContacts() {
      alert('Контакты в разработке');
    }

    function showSettings() {
      alert('Настройки в разработке');
    }

    function filterChats() {
      // TODO: фильтрация по имени
    }

    function toggleEditMode() {
      alert('Режим редактирования');
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

// ==================== ЗАПУСК СЕРВЕРА ====================
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Сервер запущен на порту ${PORT}`);
});
