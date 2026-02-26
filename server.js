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
    res.send(`<!DOCTYPE html><html><head><title>Telegram</title><style>*{margin:0;padding:0;box-sizing:border-box;font-family:system-ui}body{background:linear-gradient(135deg,#0088cc,#00c4b4);height:100vh}#app{display:flex;height:100vh}#sidebar{width:300px;background:#1f2937;color:white;padding:20px}#chat-area{flex:1;display:flex;flex-direction:column}#chat-header{height:60px;background:#0088cc;color:white;padding:20px;display:flex;align-items:center;justify-content:space-between}#messages{flex:1;overflow-y:auto;padding:20px;background:#f0f2f5}#chat-input{display:flex;padding:20px;gap:10px}.user-list{margin-top:20px}.user-item{padding:15px;cursor:pointer;border-radius:10px;margin:5px 0;background:#374151}.user-item:hover{background:#4b5563}.user-item.active{background:#0088cc}.msg{padding:12px;margin:10px 0;border-radius:18px;max-width:70%}.msg.sent{background:#0088cc;color:white;margin-left:auto}.msg.received{background:#e5e5ea}input,button{padding:12px;border:none;border-radius:25px;font-size:16px}button{background:#0088cc;color:white;cursor:pointer;flex-shrink:0}#login{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:white;padding:40px;border-radius:20px;width:90%;max-width:400px;text-align:center;box-shadow:0 20px 40px rgba(0,0,0,0.3)}h1{color:#0088cc;margin-bottom:20px}input{width:100%;margin:10px 0}</style></head><body><div id="login"><h1>🚀 Telegram</h1><input id="email" placeholder="Почта"><button onclick="sendCode()">Код</button><input id="code" placeholder="123456"><button onclick="verifyCode()">Войти</button></div><div id="app" style="display:none"><div id="sidebar"><h3>👥 Онлайн (<span id="online-count">0</span>)</h3><div id="user-list"></div></div><div id="chat-area"><div id="chat-header"><span id="chat-title">Чат</span><button onclick="backToMain()">←</button></div><div id="messages">Готов к чату!</div><div id="chat-input"><input id="msg-input" placeholder="Сообщение..."><button onclick="sendMsg()">➤</button></div></div></div><script src="/socket.io/socket.io.js"></script><script>const socket=io();let userId=null,currentChat=null,isPrivate=false;async function sendCode(){await fetch('/send-code',{method:'POST',headers:{"Content-Type":"application/json"},body:JSON.stringify({email:document.getElementById('email').value})});alert('Код:123456')}async function verifyCode(){const r=await fetch('/verify-code',{method:'POST',headers:{"Content-Type":"application/json"},body:JSON.stringify({code:document.getElementById('code').value})});const d=await r.json();if(d.success){userId=d.userId;document.getElementById('login').style.display='none';document.getElementById('app').style.display='flex';socket.emit('register',{userId,email:document.getElementById('email').value})}}function sendMsg(){const t=document.getElementById('msg-input').value.trim();if(t&&userId){if(isPrivate&&currentChat)socket.emit('private-message',{to:currentChat,text:t});else socket.emit('message',{text:t});document.getElementById('msg-input').value=''}}function selectUser(id){currentChat=id;isPrivate=true;document.getElementById('chat-title').textContent='Чат с '+window.users[id].email.split('@')[0];document.getElementById('messages').innerHTML='Начните разговор...';document.querySelectorAll('.user-item').forEach(e=>e.classList.remove('active'));document.querySelector("[data-user='"+id+"']").classList.add('active')}function backToMain(){isPrivate=false;currentChat=null;document.getElementById('chat-title').textContent='Чат';document.querySelectorAll('.user-item').forEach(e=>e.classList.remove('active'))}socket.on('users-update',u=>{window.users=u;const l=document.getElementById('user-list'),c=document.getElementById('online-count');l.innerHTML='';c.textContent=Object.keys(u).length;Object.entries(u).forEach(([id,d])=>{if(id!==socket.id){const e=document.createElement('div');e.className='user-item';e.dataset.user=id;e.onclick=()=>selectUser(id);e.innerHTML=d.email.split('@')[0]+'<br><small>'+id.slice(-4)+'</small>';l.appendChild(e)}})});socket.on('new-message',m=>addMsg(m,false));socket.on('private-message',m=>{if(isPrivate&&currentChat===m.fromSocket)addMsg(m,true)});function addMsg(m,sent){const d=document.getElementById('messages'),e=document.createElement('div');e.className='msg '+(sent||m.from===socket.id.slice(-4)?'sent':'received');e.innerHTML='<strong>'+ (m.fromUser||m.from) +':</strong> '+m.text+'<br><small>'+m.time+'</small>';d.appendChild(e);d.scrollTop=d.scrollHeight}document.getElementById('msg-input').onkeypress=e=>e.key==='Enter'&&sendMsg();</script></body></html>`);
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
    console.log(`🚀 Telegram на порту ${PORT}`);
});
