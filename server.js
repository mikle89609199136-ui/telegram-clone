const fs = require('fs');
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

// 🗄️ БАЗА ДАННЫХ (память навсегда)
const usersDB = {};                    // {email: {username, password, profile, settings}}
const sessions = {};                   // {sessionId: {userId, username, device}}
const chatsDB = {};                    // {chatId: {messages, folder}}
const blacklists = {};                 // {userId: [blockedUsers]}
const devices = {};                    // {userId: [deviceInfo]}
const favorites = {};                  // {userId: [savedMessages]}
const wallpapers = {};                 // {chatId: wallpaper}
let messageId = 0;

// Темы
const themes = {
    telegram: {bg: '#f0f2f5', sidebar: '#1f2937', sent: '#0088cc', received: '#e5e5ea'},
    dark: {bg: '#111b21', sidebar: '#202c33', sent: '#005c73', received: '#2a3942'},
    blueOcean: {bg: '#e3f2fd', sidebar: '#0277bd', sent: '#01579b', received: '#bbdefb'},
    purple: {bg: '#f3e5f5', sidebar: '#7b1fa2', sent: '#4a148c', received: '#e1bee7'}
};

app.use(cors());
app.use(express.json());
app.use(express.static('uploads'));

// Генератор кодов
function generateCode() {
    return Math.random().toString().slice(2, 8);
}

app.get('/', (req, res) => {
    res.send(`<!DOCTYPE html>
<html>
<head>
    <title>Telegram Web</title>
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <link href="https://fonts.googleapis.com/icon?family=Material+Icons" rel="stylesheet">
    <style>
        *{margin:0;padding:0;box-sizing:border-box;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
        :root{--bg:#f0f2f5;--sidebar:#1f2937;--sent:#0088cc;--received:#e5e5ea;--text:#111}
        [data-theme="dark"]{--bg:#111b21;--sidebar:#202c33;--sent:#005c73;--received:#2a3942;--text:#e4e6ea}
        [data-theme="blue"]{--bg:#e3f2fd;--sidebar:#0277bd;--sent:#01579b;--received:#bbdefb;--text:#01579b}
        [data-theme="purple"]{--bg:#f3e5f5;--sidebar:#7b1fa2;--sent:#4a148c;--received:#e1bee7;--text:#4a148c}
        body{background:var(--bg);color:var(--text);min-height:100vh}
        
        /* Адаптив */
        @media (max-width:768px){#app{flex-direction:column}#sidebar{width:100%;height:35vh}}
        
        /* Главный контейнер */
        #app{display:flex;max-width:1400px;margin:0 auto;min-height:100vh}
        
        /* Боковая панель чатов */
        #chat-list{width:320px;background:var(--sidebar);color:white;overflow-y:auto}
        #chat-list::-webkit-scrollbar{width:6px}#chat-list::-webkit-scrollbar-track{background:transparent}#chat-list::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.3)}
        .chat-item{padding:12px 16px;cursor:pointer;border-radius:8px;margin:4px 12px;transition:all 0.2s;display:flex;align-items:center;gap:12px;position:relative}
        .chat-item:hover{background:rgba(255,255,255,0.1)}
        .chat-item.active{background:rgba(255,255,255,0.15)}
        .chat-folder{font-size:11px;background:#10b981;color:white;padding:2px 6px;border-radius:4px}
        .chat-preview{font-size:13px;opacity:0.8;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;width:200px}
        .chat-time{font-size:11px;opacity:0.6;margin-left:auto}
        
        /* Основной чат */
        #main-chat{flex:1;display:flex;flex-direction:column;background:var(--bg)}
        #chat-header{height:60px;background:var(--sidebar);color:white;padding:0 20px;display:flex;align-items:center;justify-content:space-between;box-shadow:0 1px 3px rgba(0,0,0,0.1)}
        #profile-info{display:flex;align-items:center;gap:12px;cursor:pointer}
        #profile-pic{width:40px;height:40px;border-radius:50%;background:#0088cc;display:flex;align-items:center;justify-content:center;font-size:16px}
        
        /* Сообщения */
        #messages{flex:1;overflow-y:auto;padding:20px 20px 100px;max-height:calc(100vh - 200px)}
        #messages::-webkit-scrollbar{width:6px}
        .message{padding:8px 12px;margin:4px 0;border-radius:18px;max-width:70%;word-wrap:break-word;position:relative}
        .message.sent{background:var(--sent);color:white;margin-left:auto;text-align:right}
        .message.received{background:var(--received);color:var(--text)}
        .message-time{font-size:11px;opacity:0.7;margin-top:4px}
        
        /* Поле ввода */
        #input-area{position:sticky;bottom:0;background:var(--bg);padding:16px 20px;display:flex;align-items:flex-end;gap:12px}
        #attach-btn,#emoji-btn{background:none;border:none;font-size:24px;cursor:pointer;padding:8px;color:var(--text);border-radius:50%;width:48px;height:48px;display:flex;align-items:center;justify-content:center}
        #attach-btn{order:1}#emoji-btn{order:3;margin-left:auto}@media (min-width:769px){#attach-btn{order:3}#emoji-btn{order:1}}
        #attach-btn:hover,#emoji-btn:hover{background:rgba(0,0,0,0.1)}
        #message-input{flex:1;min-height:48px;max-height:120px;padding:12px 16px;border-radius:25px;border:1px solid #ddd;resize:none;outline:none;font-size:16px}
        #send-btn{background:var(--sent);color:white;border:none;border-radius:50%;width:48px;height:48px;cursor:pointer;font-size:18px}
        
        /* Навигация */
        #nav-bar{height:60px;background:var(--sidebar);color:white;padding:0 24px;display:flex;align-items:center;gap:8px;box-shadow:0 2px 10px rgba(0,0,0,0.1)}
        .nav-btn{background:none;border:none;color:white;font-size:20px;cursor:pointer;padding:8px;border-radius:8px;transition:0.2s}
        .nav-btn:hover{background:rgba(255,255,255,0.1)}
        .nav-active{background:rgba(255,255,255,0.2)}
        
        /* Модальные окна */
        .modal{position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.8);display:flex;align-items:center;justify-content:center;z-index:1000}
        .modal-content{background:white;border-radius:20px;padding:30px;max-width:500px;width:90%;max-height:90vh;overflow-y:auto}
        .modal-close{position:absolute;top:20px;right:24px;font-size:28px;cursor:pointer;color:#999}
        
        /* Форма авторизации */
        #auth-screen{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:white;padding:40px;border-radius:24px;width:90%;max-width:420px;box-shadow:0 25px 50px rgba(0,0,0,0.3);text-align:center}
        .auth-btn{padding:14px 24px;background:#4285f4;color:white;border:none;border-radius:12px;font-size:16px;font-weight:500;cursor:pointer;margin:8px;width:100%;display:flex;align-items:center;justify-content:center;gap:12px}
        .auth-btn.apple{background:#000}
        .auth-btn:hover{opacity:0.9}
        .form-group{margin:16px 0}
        input{padding:14px;border:1px solid #ddd;border-radius:12px;width:100%;font-size:16px}
        input:focus{outline:none;border-color:var(--sent);box-shadow:0 0 0 3px rgba(0,136,204,0.1)}
        
        /* Настройки */
        .settings-section{margin:24px 0;padding:20px;border-radius:12px;background:rgba(255,255,255,0.7)}
        .setting-item{display:flex;align-items:center;justify-content:space-between;padding:12px 0;cursor:pointer}
        
        /* Аватарки */
        .avatar{width:48px;height:48px;border-radius:50%;background:linear-gradient(135deg,var(--sent),#00c4b4);display:flex;align-items:center;justify-content:center;color:white;font-weight:500}
        
        /* Эмодзи */
        #emoji-panel{display:none;background:white;border-radius:12px;padding:12px;max-height:200px;overflow-y:auto;box-shadow:0 10px 30px rgba(0,0,0,0.3);position:absolute;bottom:80px;right:20px;width:280px;grid-template-columns:repeat(auto-fill,minmax(40px,1fr));gap:8px;display:grid}
        
        /* Анимации */
        @keyframes fadeIn{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
        .fade-in{animation:fadeIn 0.3s ease-out}
    </style>
</head>
<body>
    <!-- Экран авторизации -->
    <div id="auth-screen">
        <h1 style="font-size:2.5em;margin-bottom:30px;background:linear-gradient(135deg,#0088cc,#00c4b4);-webkit-background-clip:text;-webkit-text-fill-color:transparent;font-weight:700">
            Telegram
        </h1>
        <button class="auth-btn" onclick="googleAuth()">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="#4285f4">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
            </svg>
            Вход через Google
        </button>
        <button class="auth-btn apple" onclick="appleAuth()">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="white">
                <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.06 2.47-1.63.03-2.28-.94-4.16-.94s-2.55.97-4.17.94c-1.35-.02-2.25 1.23-3.06 2.47-.54.97-1.85 1.16-2.6.58-.78-.6-.8-1.77-.1-2.62.63-.78 1.6-2.06 2.38-3.24C2.58 15.15 1.68 13.3 1.7 11.2c0-2.03.9-3.88 2.38-5.35.78-.9 1.75-1.8 2.38-3.24.7-.58 1.5-.49 2.6.58.83 1.24 1.71 2.45 3.06 2.47 1.63.03 2.28-.94 4.16-.94s2.55.97 4.17.94c1.35.02 2.25-1.23 3.06-2.47.54-.97 1.85-1.16 2.6-.58.78.6.8 1.77.1 2.62-.63.78-1.6 2.06-2.38 3.24-.8 1.2-1.71 2.38-2.38 3.35.83 1.24 1.71 2.45 3.06 2.47 1.35.02 2.46-.91 3.15-2.11.83-.78 1.33-1.62 1.33-2.35 0-1.37-.63-2.55-1.44-3.3z"/>
            </svg>
            Вход через Apple
        </button>
        <div style="margin-top:30px;font-size:14px;color:#666">
            или используйте номер телефона
        </div>
        <div class="form-group">
            <input id="phone-code" placeholder="Код подтверждения (123456)" maxlength="6">
            <button onclick="phoneAuth()" style="margin-top:10px;width:100%;padding:12px;background:var(--sent)">Подтвердить</button>
        </div>
    </div>

    <!-- Основное приложение -->
    <div id="app" style="display:none">
        <!-- Навигация -->
        <div id="nav-bar">
            <button class="nav-btn nav-active" onclick="showSection('chats')" title="Чаты"><i class="material-icons">chat</i></button>
            <button class="nav-btn" onclick="showSection('friends')" title="Друзья"><i class="material-icons">people</i></button>
            <button class="nav-btn" onclick="showSection('settings')" title="Настройки"><i class="material-icons">settings</i></button>
        </div>

        <!-- Контент -->
        <div id="main-content">
            <!-- Список чатов -->
            <div id="chats-section">
                <div id="chat-list"></div>
            </div>

            <!-- Друзья -->
            <div id="friends-section" style="display:none;padding:20px">
                <h2>Друзья</h2>
                <div id="friends-list"></div>
            </div>

            <!-- Настройки -->
            <div id="settings-section" style="display:none;padding:20px">
                <div class="settings-section">
                    <h3>👤 Мой профиль</h3>
                    <div class="setting-item">
                        <span>Аватарка</span>
                        <input type="file" id="avatar-upload" accept="image/*" style="display:none">
                        <button onclick="document.getElementById('avatar-upload').click()">Изменить</button>
                    </div>
                    <div class="form-group">
                        <input id="profile-name" placeholder="Имя и фамилия">
                        <input id="profile-username" placeholder="@username">
                        <input id="profile-phone" placeholder="Телефон">
                        <input id="profile-birthday" type="date">
                    </div>
                    <button onclick="saveProfile()">Сохранить</button>
                </div>
                <div class="settings-section">
                    <h3>📁 Папки</h3>
                    <div id="folders-list"></div>
                    <button onclick="addFolder()">+ Новая папка</button>
                </div>
                <div class="settings-section">
                    <h3>🔒 Конфиденциальность</h3>
                    <label><input type="checkbox" id="hide-online"> Скрыть онлайн</label><br>
                    <label><input type="checkbox" id="hide-media"> Блокировать медиа</label>
                </div>
                <div class="settings-section">
                    <h3>🎨 Оформление</h3>
                    <select id="theme-select">
                        <option value="telegram">Telegram</option>
                        <option value="dark">Темная</option>
                        <option value="blue">Синий океан</option>
                        <option value="purple">Фиолетовый</option>
                    </select>
                    <div class="form-group">
                        <input type="file" id="chat-wallpaper" accept="image/*" style="display:none">
                        <button onclick="document.getElementById('chat-wallpaper').click()">Обои чата</button>
                    </div>
                </div>
                <div class="settings-section">
                    <h3>📱 Устройства (1/5)</h3>
                    <div id="devices-list"></div>
                </div>
                <div class="settings-section">
                    <h3>⭐ Возможности Telegram PRO</h3>
                    <ul style="font-size:14px;color:#666">
                        <li>✅ Неограниченная история чатов</li>
                        <li>✅ 7 кастомных папок</li>
                        <li>✅ Темы + обои</li>
                        <li>✅ Поиск по @username</li>
                        <li>✅ Медиа + эмодзи</li>
                        <li>✅ Профили + настройки</li>
                        <li>✅ Многоустройственная синхронизация</li>
                    </ul>
                </div>
            </div>
        </div>

        <!-- Главный чат -->
        <div id="main-chat">
            <div id="chat-header">
                <div id="profile-info">
                    <div id="profile-pic">👤</div>
                    <span id="chat-title">Telegram PRO</span>
                </div>
                <i class="material-icons" style="font-size:24px;cursor:pointer" title="Инфо">info</i>
            </div>
            <div id="messages"></div>
            <div id="input-area">
                <button id="attach-btn" title="Медиа"><i class="material-icons">attach_file</i></button>
                <textarea id="message-input" placeholder="Напишите сообщение..." rows="1"></textarea>
                <button id="emoji-btn" title="Эмодзи"><i class="material-icons">emoji_emotions</i></button>
                <button id="send-btn"><i class="material-icons">send</i></button>
            </div>
        </div>
    </div>

    <!-- Эмодзи панель -->
    <div id="emoji-panel">
        😊😂😍🥰😘🤗🤔🤨😎🤩🥳😭😢🥺😡🤬🤯😱😤😠🤮🤢🤧🤒🤕🤑🤠😈👻👽🤖💩👻
        ❤️🧡💛💚💙💜🖤🤍🤎😇🤡👹👺🧟‍♂️🧟‍♀️🧛‍♂️🧛‍♀️
    </div>

    <script>
        const socket = io();
        let currentUser = null;
        let currentChat = null;
        let folders = {};
        let theme = 'telegram';
        
        // Авторизация Google/Apple
        async function googleAuth() {
            const code = generateCode();
            alert('Код Google отправлен на почту: ' + code);
            await phoneAuth(code);
        }
        
        async function appleAuth() {
            const code = generateCode();
            alert('Код Apple отправлен на почту: ' + code);
            await phoneAuth(code);
        }
        
        async function phoneAuth(code = '123456') {
            // Симуляция реальной авторизации
            currentUser = {
                id: Date.now().toString(),
                username: '@user' + Math.floor(Math.random()*1000),
                name: 'Пользователь',
                device: navigator.userAgent.slice(0,50),
                online: true,
                avatar: '👤'
            };
            
            document.getElementById('auth-screen').style.display = 'none';
            document.getElementById('app').style.display = 'flex';
            socket.emit('login', currentUser);
            loadSettings();
            showWelcome();
        }
        
        function generateCode() {
            return Math.random().toString().slice(2, 8);
        }
        
        function showWelcome() {
            const welcome = currentUser.firstLogin ? 
                '🎉 Добро пожаловать в Telegram PRO! Создайте первый чат.' :
                \`👋 @\${currentUser.username} вошел с ${new Date().toLocaleString('ru-RU',{hour:'2-digit',minute:'2-digit'})} с ${currentUser.device.slice(0,20)}\`;
            
            addSystemMessage(welcome);
        }
        
        function addSystemMessage(text) {
            const messagesEl = document.getElementById('messages');
            const msg = document.createElement('div');
            msg.style.cssText = 'text-align:center;color:#666;font-size:14px;padding:12px;margin:8px 0';
            msg.textContent = text;
            messagesEl.appendChild(msg);
        }
        
        // Навигация
        function showSection(section) {
            document.querySelectorAll('#main-content > div').forEach(div => div.style.display = 'none');
            document.getElementById(section + '-section').style.display = 'block';
            document.querySelectorAll('.nav-btn').forEach(btn => btn.classList.remove('nav-active'));
            event.target.classList.add('nav-active');
        }
        
        // Поиск и чаты
        socket.on('user-list', (users) => {
            updateChatList(users);
            updateFriendsList(users);
        });
        
        function updateChatList(users) {
            const listEl = document.getElementById('chat-list');
            listEl.innerHTML = '';
            
            Object.values(users).forEach(user => {
                if (user.id !== currentUser.id) {
                    const chatEl = document.createElement('div');
                    chatEl.className = 'chat-item';
                    chatEl.onclick = () => openChat(user);
                    chatEl.innerHTML = \`
                        <div class="avatar">\${user.avatar}</div>
                        <div>
                            <div class="user-name">\${user.name}</div>
                            <div class="chat-preview">@\${user.username} • онлайн</div>
                        </div>
                        <div class="chat-folder">\${getFolderForUser(user.username)}</div>
                    \`;
                    listEl.appendChild(chatEl);
                }
            });
        }
        
        function openChat(user) {
            currentChat = user;
            document.querySelectorAll('.chat-item').forEach(el => el.classList.remove('active'));
            event.currentTarget.classList.add('active');
            document.getElementById('chat-title').textContent = user.name;
            document.getElementById('profile-pic').textContent = user.avatar;
            loadChatHistory(user.id);
        }
        
        // Отправка сообщений
        document.getElementById('message-input').addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
            }
        });
        
        document.getElementById('send-btn').onclick = sendMessage;
        
        function sendMessage() {
            const text = document.getElementById('message-input').value.trim();
            if (!text || !currentChat) return;
            
            socket.emit('message', {
                to: currentChat.id,
                text: text,
                type: 'text'
            });
            
            document.getElementById('message-input').value = '';
        }
        
        // Эмодзи
        document.getElementById('emoji-btn').onclick = () => {
            const panel = document.getElementById('emoji-panel');
            panel.style.display = panel.style.display === 'grid' ? 'none' : 'grid';
        };
        
        document.getElementById('emoji-panel').onclick = (e) => {
            if (e.target.textContent.length === 2) {
                document.getElementById('message-input').value += e.target.textContent;
                document.getElementById('emoji-panel').style.display = 'none';
            }
        };
        
        // Система настроек
        function loadSettings() {
            document.getElementById('theme-select').value = theme;
            applyTheme(theme);
        }
        
        document.getElementById('theme-select').onchange = (e) => {
            theme = e.target.value;
            applyTheme(theme);
            document.documentElement.setAttribute('data-theme', theme);
        };
        
        function applyTheme(themeName) {
            document.documentElement.style.setProperty('--bg', themes[themeName].bg);
            document.documentElement.style.setProperty('--sidebar', themes[themeName].sidebar);
            document.documentElement.style.setProperty('--sent', themes[themeName].sent);
            document.documentElement.style.setProperty('--received', themes[themeName].received);
        }
        
        // Инициализация
        socket.on('connect', () => {
            console.log('✅ Telegram PRO подключен!');
        });
    </script>
</body>
</html>`);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log("🚀 Telegram PRO v2.0 на порту " + PORT);
});
