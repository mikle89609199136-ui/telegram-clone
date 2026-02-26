const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, { 
    cors: { origin: "*", methods: ["GET", "POST"] } 
});

// БАЗА ДАННЫХ
const usersDB = {};
const sessions = {};
const chatsDB = {};
let messageId = 0;

app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
    res.send(`<!DOCTYPE html>
<html>
<head>
    <title>Telegram PRO</title>
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
        *{margin:0;padding:0;box-sizing:border-box;font-family:system-ui,-apple-system,sans-serif}
        body{background:linear-gradient(135deg,#0088cc,#00c4b4);min-height:100vh}
        #auth{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:white;padding:40px;border-radius:24px;max-width:400px;width:90%;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,0.3)}
        h1{font-size:2.5em;background:linear-gradient(135deg,#0088cc,#00c4b4);-webkit-background-clip:text;-webkit-text-fill-color:transparent;margin-bottom:30px}
        .auth-btn{display:block;width:100%;padding:14px;margin:10px 0;background:#4285f4;color:white;border:none;border-radius:12px;font-size:16px;cursor:pointer;font-weight:500}
        .auth-btn.apple{background:#000}
        .auth-btn:hover{opacity:0.9}
        input{display:block;width:100%;padding:14px;margin:10px 0;border:1px solid #ddd;border-radius:12px;font-size:16px;box-sizing:border-box}
        #app{display:none;flex-direction:column;height:100vh}
        @media(min-width:769px){#app{flex-direction:row}}
        #sidebar{width:100%;height:50vh;background:#1f2937;color:white;padding:20px;overflow:auto}@media(min-width:769px){#sidebar{width:350px;height:100vh}}
        #chat-area{flex:1;display:flex;flex-direction:column;background:#f0f2f5}
        #chat-header{height:60px;background:#0088cc;color:white;padding:0 20px;display:flex;align-items:center;justify-content:space-between}
        #messages{flex:1;overflow-y:auto;padding:20px}
        #input-area{display:flex;padding:20px;gap:10px;background:white;border-top:1px solid #eee}
        .user-item{padding:15px;cursor:pointer;border-radius:12px;margin:5px 0;background:rgba(255,255,255,0.1);transition:0.3s}
        .user-item:hover,.user-item.active{background:#0088cc}
        .msg{padding:12px 16px;margin:8px 0;border-radius:18px;max-width:70%;word-wrap:break-word}
        .msg.sent{background:#0088cc;color:white;margin-left:auto}
        .msg.received{background:#e5e5ea}
        .msg-time{font-size:12px;opacity:0.7;margin-top:4px}
        input[type="text"],textarea{flex:1;padding:12px;border:none;border-radius:25px;outline:none;font-size:16px}
        button{padding:12px 20px;background:#0088cc;color:white;border:none;border-radius:25px;cursor:pointer;font-size:16px}
        button:hover{background:#006ba0}
        .nav-bar{display:flex;background:#0088cc;color:white;padding:15px;gap:20px}
        .nav-btn{background:none;border:none;color:white;font-size:20px;cursor:pointer;padding:10px}
        .nav-active{background:rgba(255,255,255,0.2);border-radius:10px}
        .settings{padding:20px}
        .setting{margin:15px 0;padding:15px;background:rgba(255,255,255,0.8);border-radius:12px}
        select, input[type="file"]{width:100%;padding:12px;border:1px solid #ddd;border-radius:8px;margin:5px 0}
    </style>
</head>
<body>
    <div id="auth">
        <h1>Telegram PRO</h1>
        <button class="auth-btn" onclick="googleLogin()">🔐 Google</button>
        <button class="auth-btn apple" onclick="appleLogin()">🍎 Apple</button>
        <input id="code-input" placeholder="Код (123456)" maxlength="6">
        <button onclick="login()">Войти</button>
        <div style="margin-top:20px;color:#666;font-size:14px">Код всегда: <b>123456</b></div>
    </div>

    <div id="app">
        <div class="nav-bar">
            <button class="nav-btn nav-active" onclick="showChats()">💬 Чаты</button>
            <button class="nav-btn" onclick="showFriends()">👥 Друзья</button>
            <button class="nav-btn" onclick="showSettings()">⚙️ Настройки</button>
        </div>

        <div id="sidebar">
            <div style="margin-bottom:20px;font-size:18px;font-weight:bold">Онлайн (<span id="online-count">0</span>)</div>
            <input id="search-user" placeholder="@username поиск" style="width:100%;padding:12px;border-radius:20px;margin-bottom:15px;border:none">
            <div id="chat-list"></div>
        </div>

        <div id="chat-area">
            <div id="chat-header">
                <div style="display:flex;align-items:center;gap:12px;cursor:pointer" onclick="showProfile()">
                    <div id="avatar" style="width:40px;height:40px;border-radius:50%;background:#0088cc;color:white;display:flex;align-items:center;justify-content:center;font-size:18px">👤</div>
                    <div>
                        <div id="chat-title">Выберите чат</div>
                        <div id="chat-subtitle" style="font-size:12px;opacity:0.8">Telegram PRO</div>
                    </div>
                </div>
                <button onclick="toggleInfo()" style="background:none;border:none;color:white;font-size:24px;cursor:pointer">ℹ️</button>
            </div>
            <div id="messages">Добро пожаловать в Telegram PRO! 👋</div>
            <div id="input-area" style="display:none">
                <button id="attach-btn" style="font-size:20px;padding:12px">📎</button>
                <input id="message-input" placeholder="Напишите сообщение...">
                <button id="emoji-btn" style="font-size:20px;padding:12px">😀</button>
                <button id="send-btn">Отправить</button>
            </div>
        </div>
    </div>

    <script src="/socket.io/socket.io.js"></script>
    <script>
        const socket = io();
        let currentUser = null;
        let currentChat = null;
        let users = {};
        let selectedNav = 'chats';

        // Авторизация
        function googleLogin() {
            const code = '123456';
            alert('Google код: ' + code);
            doLogin(code);
        }

        function appleLogin() {
            const code = '123456';
            alert('Apple код: ' + code);
            doLogin(code);
        }

        function doLogin(code) {
            if (code === '123456') {
                currentUser = {
                    id: Date.now().toString(),
                    username: '@user' + Math.floor(Math.random() * 1000),
                    name: 'Пользователь',
                    avatar: '👤',
                    device: navigator.userAgent.slice(0, 30),
                    firstLogin: !usersDB[currentUser.id]
                };
                document.getElementById('auth').style.display = 'none';
                document.getElementById('app').style.display = 'flex';
                socket.emit('login', currentUser);
                showWelcome();
            } else {
                alert('Неверный код!');
            }
        }

        function login() {
            const code = document.getElementById('code-input').value;
            doLogin(code);
        }

        function showWelcome() {
            const msg = currentUser.firstLogin ? 
                '🎉 Добро пожаловать в Telegram PRO!' : 
                `👋 ${currentUser.username} вошел в ${new Date().toLocaleTimeString('ru-RU')}`;
            addMessage(msg, true, 'system');
        }

        // Навигация
        function showChats() {
            selectedNav = 'chats';
            updateNavButtons();
            document.getElementById('chat-list').style.display = 'block';
        }

        function showFriends() {
            selectedNav = 'friends';
            updateNavButtons();
            document.getElementById('chat-list').innerHTML = '<div style="padding:20px;text-align:center;color:#999">Список друзей скоро!</div>';
        }

        function showSettings() {
            selectedNav = 'settings';
            updateNavButtons();
            document.getElementById('chat-list').innerHTML = `
                <div class="settings">
                    <div class="setting">
                        <h3>👤 Профиль</h3>
                        <input id="edit-name" placeholder="Имя" value="${currentUser.name}">
                        <input id="edit-username" placeholder="@username" value="${currentUser.username}">
                        <input type="file" id="avatar-upload" accept="image/*" style="margin:10px 0">
                        <button onclick="saveProfile()">Сохранить</button>
                    </div>
                    <div class="setting">
                        <h3>🎨 Тема</h3>
                        <select id="theme-select" onchange="changeTheme(this.value)">
                            <option value="telegram">Telegram</option>
                            <option value="dark">Темная</option>
                            <option value="blue">Синий</option>
                            <option value="purple">Фиолетовый</option>
                        </select>
                    </div>
                    <div class="setting">
                        <h3>📱 Устройства</h3>
                        <div>ПК • ${new Date().toLocaleString()}</div>
                    </div>
                </div>
            `;
        }

        function updateNavButtons() {
            document.querySelectorAll('.nav-btn').forEach((btn, i) => {
                btn.classList.toggle('nav-active', ['chats', 'friends', 'settings'][i] === selectedNav);
            });
        }

        function saveProfile() {
            currentUser.name = document.getElementById('edit-name').value || currentUser.name;
            currentUser.username = document.getElementById('edit-username').value || currentUser.username;
            document.getElementById('avatar').textContent = currentUser.avatar;
            alert('Профиль сохранен!');
        }

        function changeTheme(theme) {
            document.body.style.setProperty('--bg-color', theme === 'dark' ? '#111' : '#f0f2f5');
            document.body.style.setProperty('--sidebar-color', theme === 'dark' ? '#202c33' : '#1f2937');
        }

        // Чаты
        document.getElementById('search-user').addEventListener('input', (e) => {
            const query = e.target.value.toLowerCase();
            socket.emit('search-users', query);
        });

        socket.on('users', (userList) => {
            users = userList;
            updateUserList();
        });

        function updateUserList() {
            const list = document.getElementById('chat-list');
            list.innerHTML = '';
            Object.values(users).forEach(user => {
                if (user.id !== currentUser.id) {
                    const item = document.createElement('div');
                    item.className = 'user-item';
                    item.onclick = () => openChat(user);
                    item.innerHTML = \`
                        <div style="display:flex;align-items:center;gap:12px">
                            <div style="width:50px;height:50px;border-radius:50%;background:#0088cc;color:white;display:flex;align-items:center;justify-content:center;font-size:20px">\${user.avatar}</div>
                            <div>
                                <div style="font-weight:500">\${user.name}</div>
                                <div style="font-size:13px;color:#ccc">\${user.username}</div>
                            </div>
                        </div>
                    \`;
                    list.appendChild(item);
                }
            });
            document.getElementById('online-count').textContent = Object.keys(users).length;
        }

        function openChat(user) {
            currentChat = user;
            document.querySelectorAll('.user-item').forEach(item => item.classList.remove('active'));
            event.currentTarget.classList.add('active');
            document.getElementById('chat-title').textContent = user.name;
            document.getElementById('chat-subtitle').textContent = user.username;
            document.getElementById('avatar').textContent = user.avatar;
            document.getElementById('input-area').style.display = 'flex';
            socket.emit('get-history', { to: user.id });
        }

        // Сообщения
        function addMessage(text, isSent, type = 'text') {
            const messages = document.getElementById('messages');
            const msg = document.createElement('div');
            msg.className = \`msg \${isSent ? 'sent' : 'received'}\`;
            msg.innerHTML = \`
                <div>\${text}</div>
                <div class="msg-time">\${new Date().toLocaleTimeString('ru-RU', {hour: '2-digit', minute: '2-digit'})}</div>
            \`;
            messages.appendChild(msg);
            messages.scrollTop = messages.scrollHeight;
        }

        document.getElementById('message-input').addEventListener('keypress', e => {
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
                text: text
            });
            document.getElementById('message-input').value = '';
        }

        socket.on('message', (data) => {
            if (currentChat && currentChat.id === data.from) {
                addMessage(data.text, false);
            }
        });

        socket.on('new-message', (data) => {
            if (currentChat && currentChat.id === data.to) {
                addMessage(data.text, true);
            }
        });

        socket.on('history', (messages) => {
            document.getElementById('messages').innerHTML = '';
            messages.forEach(msg => {
                addMessage(msg.text, msg.from === currentUser.id);
            });
        });

        // Socket события
        socket.on('login-success', (userList) => {
            users = userList;
            updateUserList();
        });

        function showProfile() {
            alert(\`👤 Профиль\nИмя: \${currentUser.name}\nЛогин: \${currentUser.username}\nУстройство: \${currentUser.device}\`);
        }

        function toggleInfo() {
            alert('ℹ️ Telegram PRO v2.0\n• Личные сообщения\n• Темы\n• Поиск @username\n• Многоустройственная синхронизация');
        }

        // Фокус на поле ввода
        document.getElementById('message-input').focus();
    </script>
</body>
</html>`);
});

// Socket.io обработчики
io.on('connection', (socket) => {
    console.log('👤 Подключение:', socket.id);

    socket.on('login', (user) => {
        sessions[socket.id] = user.id;
        usersDB[user.id] = user;
        
        // Отправляем список пользователей
        const userList = {};
        Object.values(usersDB).forEach(u => {
            userList[u.id] = u;
        });
        
        socket.broadcast.emit('users', userList);
        socket.emit('login-success', userList);
    });

    socket.on('message', (data) => {
        const userId = sessions[socket.id];
        if (!userId || !data.to) return;

        const message = {
            id: messageId++,
            from: userId,
            to: data.to,
            text: data.text,
            time: new Date(),
            type: 'text'
        };

        // Сохраняем историю
        if (!chatsDB[data.to + '-' + userId]) chatsDB[data.to + '-' + userId] = [];
        if (!chatsDB[userId + '-' + data.to]) chatsDB[userId + '-' + data.to] = [];
        
        chatsDB[data.to + '-' + userId].push(message);
        chatsDB[userId + '-' + data.to].push(message);

        // Отправляем получателю
        io.to(data.to).emit('new-message', message);
        
        // Отправляем отправителю
        socket.emit('message', message);
    });

    socket.on('get-history', (data) => {
        const userId = sessions[socket.id];
        const chatKey = data.to + '-' + userId;
        socket.emit('history', chatsDB[chatKey] || []);
    });

    socket.on('search-users', (query) => {
        const results = {};
        Object.values(usersDB).forEach(user => {
            if (user.username.toLowerCase().includes(query.toLowerCase()) && user.id !== sessions[socket.id]) {
                results[user.id] = user;
            }
        });
        socket.emit('users', results);
    });

    socket.on('disconnect', () => {
        delete sessions[socket.id];
        console.log('👤 Отключение:', socket.id);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log("🚀 Telegram PRO v2.0 на порту " + PORT);
});
