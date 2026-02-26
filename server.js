const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, { 
    cors: { origin: "*", methods: ["GET", "POST"] } 
});

app.use(cors());
app.use(express.json());

const users = {};

app.get('/', (req, res) => {
    res.send(`<!DOCTYPE html>
<html>
<head>
    <title>🚀 Telegram</title>
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
        *{margin:0;padding:0;box-sizing:border-box;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}
        body{background:linear-gradient(135deg,#0088cc,#00c4b4);height:100vh;overflow:hidden;-webkit-user-select:none;user-select:none}
        
        /* МОБИЛЬНЫЙ АДАПТИВ */
        @media (max-width: 768px) {
            #app{flex-direction:column;height:100vh}
            #sidebar{width:100%;height:40%;max-height:200px}
            #chat-area{flex:1;height:60%}
            #chat-header{padding:15px 20px}
            .user-item{padding:12px 15px;font-size:14px}
            .msg{max-width:85%}
            input{padding:12px;font-size:15px}
            button{padding:12px 16px;font-size:15px}
        }
        
        @media (max-width: 480px) {
            #sidebar{height:35%;max-height:160px}
            #chat-area{height:65%}
            h3{font-size:16px}
        }
        
        /* ОСНОВНОЙ СТИЛЬ */
        #app{display:flex;height:100vh}
        #sidebar{width:300px;background:#1f2937;color:white;padding:20px;overflow-y:auto}
        #chat-area{flex:1;display:flex;flex-direction:column;background:white}
        #chat-header{height:60px;background:#0088cc;color:white;padding:20px;display:flex;align-items:center;justify-content:space-between;box-shadow:0 2px 10px rgba(0,0,0,0.1)}
        #messages{flex:1;overflow-y:auto;padding:20px;background:#f0f2f5;scroll-behavior:smooth}
        #chat-input{display:flex;padding:20px;gap:10px;background:white;border-top:1px solid #eee;position:sticky;bottom:0}
        
        .user-list{margin-top:20px}
        .user-item{padding:15px;cursor:pointer;border-radius:12px;margin:5px 0;background:#374151;transition:all 0.2s;position:relative}
        .user-item:hover{background:#4b5563}
        .user-item.active{background:#0088cc !important;box-shadow:0 4px 12px rgba(0,136,204,0.4)}
        .user-name{font-size:16px;font-weight:500}
        .user-id{font-size:12px;opacity:0.8}
        
        .msg{padding:12px 16px;margin:10px 0;border-radius:18px;max-width:70%;word-wrap:break-word;box-shadow:0 1px 2px rgba(0,0,0,0.1);position:relative}
        .msg.sent{background:#0088cc;color:white;margin-left:auto;text-align:right}
        .msg.received{background:#e5e5ea;color:#333}
        
        input{padding:14px;border:none;border-radius:25px;font-size:16px;flex:1;outline:none;background:#f0f2f5}
        input:focus{background:white;box-shadow:0 0 0 3px rgba(0,136,204,0.2)}
        button{padding:14px 20px;background:#0088cc;color:white;border:none;border-radius:25px;cursor:pointer;font-size:16px;font-weight:500;flex-shrink:0}
        button:active{background:#006ba0;transform:scale(0.98)}
        
        #login{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:white;padding:40px;border-radius:20px;width:90%;max-width:400px;text-align:center;box-shadow:0 20px 40px rgba(0,0,0,0.3);z-index:1000}
        h1{color:#0088cc;margin-bottom:30px;font-size:2em}
        input{width:100%;margin:10px 0;padding:15px;border:1px solid #ddd;border-radius:12px;font-size:16px}
        
        /* МОБИЛЬНЫЕ ФИЧИ */
        .mobile-only{display:none}
        @media (max-width: 768px) {.mobile-only{display:block}}
        .desktop-only{display:block}
        @media (max-width: 768px) {.desktop-only{display:none}}
    </style>
</head>
<body>
    <div id="login">
        <h1>🚀 Telegram</h1>
        <input id="email" type="email" placeholder="test@mail.ru">
        <button onclick="sendCode()">Отправить код</button>
        <input id="code" type="text" placeholder="123456" maxlength="6">
        <button onclick="verifyCode()">Войти</button>
        <div style="margin-top:20px;font-size:14px;color:#666">Код всегда: <strong>123456</strong></div>
    </div>
    
    <div id="app" style="display:none">
        <div id="sidebar">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:15px">
                <h3>👥 Онлайн</h3>
                <span id="online-count" class="mobile-only" style="background:#10b981;padding:4px 8px;border-radius:12px;font-size:12px">0</span>
            </div>
            <div id="user-list" class="user-list"></div>
        </div>
        <div id="chat-area">
            <div id="chat-header">
                <span id="chat-title">Общий чат</span>
                <button class="desktop-only" onclick="leavePrivateChat()">← Назад</button>
            </div>
            <div id="messages">Добро пожаловать в Telegram! 👋<br><small style="color:#666">Откройте вторую вкладку для ЛС</small></div>
            <div id="chat-input">
                <input id="msg-input" placeholder="Сообщение... (Enter)" autofocus>
                <button onclick="sendMsg()">➤</button>
            </div>
        </div>
    </div>

    <script src="/socket.io/socket.io.js"></script>
    <script>
        const socket = io();
        let userId = null;
        let currentChatUser = null;
        let isPrivateChat = false;

        // МОБИЛЬНЫЙ ФИКС клавиатуры
        function focusInput() {
            const input = document.getElementById('msg-input');
            requestAnimationFrame(() => {
                input.focus();
                input.scrollIntoView({ behavior: 'smooth', block: 'end' });
            });
        }

        // Touch события для мобильных
        document.addEventListener('touchstart', function(e) {
            const input = document.getElementById('msg-input');
            if (!input.matches(':focus')) {
                e.preventDefault();
                focusInput();
            }
        }, { passive: false });

        async function sendCode() {
            const email = document.getElementById('email').value.trim();
            if (!email) return alert('Введите почту');
            
            try {
                await fetch('/send-code', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({email})
                });
                alert('✅ Код: 123456');
                document.getElementById('code').focus();
            } catch (e) {
                alert('Ошибка');
            }
        }

        async function verifyCode() {
            const code = document.getElementById('code').value;
            if (code.length < 6) return alert('Введите код');
            
            try {
                const res = await fetch('/verify-code', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({code})
                });
                const data = await res.json();
                
                if (data.success) {
                    userId = data.userId;
                    document.getElementById('login').style.display = 'none';
                    document.getElementById('app').style.display = 'flex';
                    socket.emit('register', {userId, email: document.getElementById('email').value});
                    setTimeout(focusInput, 500);
                } else {
                    alert('❌ Неверный код (123456)');
                }
            } catch (e) {
                alert('Ошибка сервера');
            }
        }

        function sendMsg() {
            const text = document.getElementById('msg-input').value.trim();
            if (!text || !userId) return;
            
            if (isPrivateChat && currentChatUser) {
                socket.emit('private-message', {to: currentChatUser, text});
            } else {
                socket.emit('message', {text});
            }
            document.getElementById('msg-input').value = '';
        }

        function selectUser(userSocketId) {
            currentChatUser = userSocketId;
            isPrivateChat = true;
            const userData = window.users[userSocketId];
            const username = userData ? userData.email.split('@')[0] : userSocketId.slice(-4);
            document.getElementById('chat-title').textContent = \`Чат с \${username}\`;
            document.getElementById('messages').innerHTML = '<div style="text-align:center;color:#666;padding:40px;font-size:16px">Начните переписку...</div>';
            
            document.querySelectorAll('.user-item').forEach(item => item.classList.remove('active'));
            const activeItem = document.querySelector(\`[data-user="\${userSocketId}"]\`);
            if (activeItem) activeItem.classList.add('active');
            
            setTimeout(focusInput, 300);
        }

        function leavePrivateChat() {
            isPrivateChat = false;
            currentChatUser = null;
            document.getElementById('chat-title').textContent = 'Общий чат';
            document.querySelectorAll('.user-item').forEach(item => item.classList.remove('active'));
            document.getElementById('messages').innerHTML = 'Общий чат активен!';
            setTimeout(focusInput, 200);
        }

        socket.on('users-update', (userList) => {
            window.users = userList;
            const userListEl = document.getElementById('user-list');
            document.getElementById('online-count').textContent = Object.keys(userList).length;
            
            userListEl.innerHTML = '';
            Object.entries(userList).forEach(([socketId, userData]) => {
                if (socketId !== socket.id) {
                    const div = document.createElement('div');
                    div.className = 'user-item';
                    div.dataset.user = socketId;
                    div.onclick = () => selectUser(socketId);
                    div.innerHTML = \`
                        <div class="user-name">\${userData.email.split('@')[0]}</div>
                        <div class="user-id">\${socketId.slice(-4)}</div>
                    \`;
                    userListEl.appendChild(div);
                }
            });
        });

        function addMessage(msg, isSent = false) {
            const messagesEl = document.getElementById('messages');
            const msgEl = document.createElement('div');
            msgEl.className = \`msg \${isSent ? 'sent' : 'received'}\`;
            msgEl.innerHTML = \`
                <strong>\${msg.fromUser || msg.from}:</strong> \${msg.text}
                <br><small>\${msg.time}</small>
            \`;
            messagesEl.appendChild(msgEl);
            messagesEl.scrollTop = messagesEl.scrollHeight;
        }

        socket.on('new-message', (msg) => addMessage(msg));
        socket.on('private-message', (msg) => {
            if (isPrivateChat && currentChatUser === msg.fromSocket) {
                addMessage(msg, msg.fromUser === socket.id.slice(-4));
            }
        });

        // Enter + мобильная клавиатура
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey && document.getElementById('app').style.display !== 'none') {
                e.preventDefault();
                sendMsg();
            }
        });

        // Клавиатура всегда активна
        document.getElementById('msg-input').addEventListener('blur', function() {
            setTimeout(() => this.focus(), 150);
        });

        // Touch для мобильных кнопок
        document.querySelectorAll('button, .user-item').forEach(el => {
            el.addEventListener('touchstart', function(e) {
                this.style.transform = 'scale(0.95)';
            });
            el.addEventListener('touchend', function(e) {
                this.style.transform = '';
            });
        });
    </script>
</body>
</html>`);
});

app.post('/send-code', (req, res) => {
    console.log(\`🔑 Код для \${req.body.email}: 123456\`);
    res.json({ success: true });
});

app.post('/verify-code', (req, res) => {
    if (req.body.code === '123456') {
        res.json({ success: true, userId: Date.now().toString() });
    } else {
        res.json({ success: false });
    }
});

io.on('connection', (socket) => {
    console.log('👤 Подключился:', socket.id);
    
    socket.on('register', (userData) => {
        users[socket.id] = userData;
        io.emit('users-update', users);
    });

    socket.on('message', (data) => {
        const message = { 
            from: socket.id.slice(-4),
            text: data.text,
            time: new Date().toLocaleString('ru-RU', { hour: '2-digit', minute: '2-digit' })
        };
        socket.broadcast.emit('new-message', message);
    });

    socket.on('private-message', (data) => {
        const message = {
            fromUser: socket.id.slice(-4),
            fromSocket: socket.id,
            text: data.text,
            time: new Date().toLocaleString('ru-RU', { hour: '2-digit', minute: '2-digit' })
        };
        io.to(data.to).emit('private-message', message);
        socket.emit('private-message', message);
    });

    socket.on('disconnect', () => {
        delete users[socket.id];
        io.emit('users-update', users);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(\`🚀 Telegram Mobile на порту \${PORT}\`);
});


