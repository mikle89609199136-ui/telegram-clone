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

// Хранилище пользователей и чатов
const users = {}; // {socketId: {name, email}}
const privateRooms = {}; // {roomId: [socketId1, socketId2]}

app.get('/', (req, res) => {
    res.send(`
<!DOCTYPE html>
<html>
<head>
    <title>🚀 My Telegram</title>
    <style>
        *{margin:0;padding:0;box-sizing:border-box}
        body{font-family:system-ui;background:linear-gradient(135deg,#0088cc,#00c4b4);height:100vh;overflow:hidden}
        #app{display:flex;height:100vh}
        #sidebar{width:300px;background:#1f2937;color:white;padding:20px}
        #chat-area{flex:1;display:flex;flex-direction:column;background:white}
        #chat-header{height:60px;background:#0088cc;color:white;padding:20px;display:flex;align-items:center;justify-content:space-between}
        #messages{flex:1;overflow-y:auto;padding:20px;background:#f0f2f5}
        #chat-input{display:flex;padding:20px;gap:10px}
        .user-list{margin-top:20px}
        .user-item{padding:12px;cursor:pointer;border-radius:10px;margin-bottom:5px;background:#374151}
        .user-item:hover{background:#4b5563}
        .user-item.active{background:#0088cc}
        .msg{padding:12px;margin-bottom:10px;border-radius:15px;max-width:70%;word-wrap:break-word}
        .msg.sent{background:#0088cc;color:white;margin-left:auto}
        .msg.received{background:#e5e5ea;color:#333}
        input{padding:12px;border:none;border-radius:20px;font-size:16px;flex:1}
        button{padding:12px 20px;background:#0088cc;color:white;border:none;border-radius:20px;cursor:pointer}
        #login{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);background:white;padding:40px;border-radius:20px;box-shadow:0 20px 40px rgba(0,0,0,0.3);width:90%;max-width:400px}
        h1{text-align:center;color:#0088cc;margin-bottom:30px}
    </style>
</head>
<body>
    <div id="login">
        <h1>🚀 My Telegram</h1>
        <input id="email" type="email" placeholder="Почта">
        <button onclick="sendCode()">Отправить код</button>
        <input id="code" type="text" placeholder="123456">
        <button onclick="verifyCode()">Войти</button>
    </div>
    
    <div id="app" style="display:none">
        <div id="sidebar">
            <h3>👥 Онлайн (<span id="online-count">0</span>)</h3>
            <div id="user-list" class="user-list"></div>
        </div>
        <div id="chat-area">
            <div id="chat-header">
                <span id="chat-title">Общий чат</span>
                <button onclick="leavePrivateChat()">← Назад</button>
            </div>
            <div id="messages"></div>
            <div id="chat-input">
                <input id="msg-input" placeholder="Сообщение..." onkeypress="if(event.key==='Enter') sendMsg()">
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

        async function sendCode() {
            const email = document.getElementById('email').value;
            await fetch('/send-code', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({email})
            });
            alert('✅ Код: 123456');
        }

        async function verifyCode() {
            const code = document.getElementById('code').value;
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
            }
        }

        function sendMsg() {
            const text = document.getElementById('msg-input').value;
            if (text && userId) {
                if (isPrivateChat && currentChatUser) {
                    socket.emit('private-message', {to: currentChatUser, text});
                } else {
                    socket.emit('message', {text});
                }
                document.getElementById('msg-input').value = '';
            }
        }

        function selectUser(userId) {
            currentChatUser = userId;
            isPrivateChat = true;
            document.getElementById('chat-title').textContent = `Чат с ${users[userId]?.email || userId.slice(-4)}`;
            document.getElementById('messages').innerHTML = '<div style="text-align:center;color:#666;padding:20px">Начните переписку...</div>';
            document.querySelectorAll('.user-item').forEach(item => item.classList.remove('active'));
            document.querySelector(`[data-user="${userId}"]`).classList.add('active');
        }

        function leavePrivateChat() {
            isPrivateChat = false;
            currentChatUser = null;
            document.getElementById('chat-title').textContent = 'Общий чат';
            document.querySelectorAll('.user-item').forEach(item => item.classList.remove('active'));
        }

        socket.on('users-update', (userList) => {
            Object.assign(users, userList);
            const userListEl = document.getElementById('user-list');
            userListEl.innerHTML = '';
            document.getElementById('online-count').textContent = Object.keys(userList).length;
            
            Object.entries(userList).forEach(([userId, userData]) => {
                const div = document.createElement('div');
                div.className = 'user-item';
                div.dataset.user = userId;
                div.onclick = () => selectUser(userId);
                div.innerHTML = \`<strong>\${userData.email.split('@')[0]}</strong><br><small>\${userId.slice(-4)}</small>\`;
                userListEl.appendChild(div);
            });
        });

        socket.on('new-message', (msg) => {
            const div = document.getElementById('messages');
            const msgEl = document.createElement('div');
            msgEl.className = \`msg \${msg.from === socket.id.slice(-4) ? 'sent' : 'received'}\`;
            msgEl.innerHTML = \`
                <strong>\${msg.from}:</strong> \${msg.text}
                <br><small>\${msg.time}</small>
            \`;
            div.appendChild(msgEl);
            div.scrollTop = div.scrollHeight;
        });

        socket.on('private-message', (msg) => {
            if (isPrivateChat && currentChatUser === msg.from) {
                const div = document.getElementById('messages');
                const msgEl = document.createElement('div');
                msgEl.className = \`msg \${msg.fromUser === socket.id.slice(-4) ? 'sent' : 'received'}\`;
                msgEl.innerHTML = \`
                    <strong>\${msg.fromUser}:</strong> \${msg.text}
                    <br><small>\${msg.time}</small>
                \`;
                div.appendChild(msgEl);
                div.scrollTop = div.scrollHeight;
            }
        });
    </script>
</body>
</html>
    `);
});

app.post('/send-code', (req, res) => {
    console.log(`🔑 Код для ${req.body.email}: 123456`);
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
            id: Date.now(),
            from: socket.id.slice(-4),
            text: data.text,
            time: new Date().toLocaleString('ru-RU', { hour: '2-digit', minute: '2-digit' })
        };
        socket.broadcast.emit('new-message', message);
    });

    socket.on('private-message', (data) => {
        const message = {
            id: Date.now(),
            fromUser: socket.id.slice(-4),
            toUser: data.to.slice(-4),
            text: data.text,
            time: new Date().toLocaleString('ru-RU', { hour: '2-digit', minute: '2-digit' })
        };
        
        // Отправляем только выбранному пользователю
        io.to(data.to).emit('private-message', message);
    });

    socket.on('disconnect', () => {
        delete users[socket.id];
        io.emit('users-update', users);
        console.log('👤 Отключился:', socket.id);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Telegram с ЛС на порту ${PORT}`);
});
