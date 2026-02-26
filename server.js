const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, { 
    cors: { 
        origin: "*", 
        methods: ["GET", "POST"]
    } 
});

app.use(cors());
app.use(express.json());

// Главная страница с чатом
app.get('/', (req, res) => {
    res.send(`
<!DOCTYPE html>
<html>
<head>
    <title>🚀 My Telegram</title>
    <style>
        *{margin:0;padding:0;box-sizing:border-box}
        body{font-family:system-ui;background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);height:100vh;display:flex;align-items:center;justify-content:center;color:#333}
        #app{max-width:400px;width:90%;background:white;border-radius:20px;padding:40px;box-shadow:0 20px 40px rgba(0,0,0,0.1)}
        h1{font-size:2em;color:#0088cc;margin-bottom:30px;text-align:center}
        input{width:100%;padding:15px;margin:10px 0;border:1px solid #ddd;border-radius:10px;font-size:16px;box-sizing:border-box}
        button{width:100%;padding:15px;background:#0088cc;color:white;border:none;border-radius:10px;font-size:16px;cursor:pointer;margin:5px 0}
        button:hover{background:#006ba0}
        #chat{display:none;flex-direction:column;height:500px}
        #messages{flex:1;overflow-y:auto;background:#f0f2f5;padding:20px;border-radius:10px;margin:10px 0}
        .msg{margin:10px 0;padding:12px;background:#e3f2fd;border-radius:15px;max-width:80%;word-wrap:break-word}
        .msg-input-container{display:flex}
        #msg-input{flex:1;padding:15px;margin-right:10px;border-radius:25px;border:1px solid #ddd}
        #send-btn{width:60px;padding:15px;background:#0088cc;color:white;border:none;border-radius:25px;cursor:pointer}
    </style>
</head>
<body>
    <div id="app">
        <div id="login">
            <h1>🚀 My Telegram</h1>
            <input id="email" type="email" placeholder="Почта (любая)">
            <button onclick="sendCode()">Отправить код</button>
            <input id="code" type="text" placeholder="123456">
            <button onclick="verifyCode()">Войти</button>
        </div>
        <div id="chat">
            <div id="messages"></div>
            <div class="msg-input-container">
                <input id="msg-input" placeholder="Сообщение...">
                <button id="send-btn" onclick="sendMsg()">➤</button>
            </div>
        </div>
    </div>
    <script src="/socket.io/socket.io.js"></script>
    <script>
        const socket = io();
        let userId = null;
        
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
                document.getElementById('chat').style.display = 'flex';
            } else {
                alert('❌ Неверный код');
            }
        }
        
        function sendMsg() {
            const text = document.getElementById('msg-input').value;
            if (text && userId) {
                socket.emit('message', {toUserId: 'all', text});
                document.getElementById('msg-input').value = '';
            }
        }
        
        socket.on('new-message', (msg) => {
            const div = document.getElementById('messages');
            div.innerHTML += \`
                <div class="msg">
                    <strong>\${msg.from}:</strong> \${msg.text}
                    <br><small style="color:#666;">\${msg.time}</small>
                </div>
            \`;
            div.scrollTop = div.scrollHeight;
        });
        
        document.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                if (document.getElementById('login').style.display !== 'none') {
                    verifyCode();
                } else {
                    sendMsg();
                }
            }
        });
    </script>
</body>
</html>
    `);
});

// API для кода
app.post('/send-code', (req, res) => {
    console.log(`🔑 Код для ${req.body.email}: 123456`);
    res.json({ success: true });
});

app.post('/verify-code', (req, res) => {
    if (req.body.code === '123456') {
        res.json({ success: true, userId: Date.now() });
    } else {
        res.json({ success: false });
    }
});

// Socket.io чат
io.on('connection', (socket) => {
    console.log('👤 Пользователь подключился:', socket.id);
    
    socket.on('message', ({ toUserId, text }) => {
        const message = { 
            id: Date.now(), 
            from: socket.id.slice(-4), 
            text, 
            time: new Date().toLocaleString('ru-RU', { 
                hour: '2-digit', 
                minute: '2-digit' 
            })
        };
        io.emit('new-message', message);
        console.log('💬 Сообщение:', message);
    });
    
    socket.on('disconnect', () => {
        console.log('👤 Пользователь отключился:', socket.id);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 Telegram работает на порту ${PORT}`);
});




