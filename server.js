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
    res.send('<!DOCTYPE html><html><head><title>Telegram</title><meta name="viewport" content="width=device-width, initial-scale=1.0"><style>*{margin:0;padding:0;box-sizing:border-box;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}body{background:linear-gradient(135deg,#0088cc,#00c4b4);height:100vh;overflow:hidden}@media (max-width: 768px) {#app{flex-direction:column;height:100vh}#sidebar{width:100%;height:40%;max-height:200px}#chat-area{flex:1;height:60%}#chat-header{padding:15px 20px}.user-item{padding:12px 15px;font-size:14px}.msg{max-width:85%}input,button{padding:12px;font-size:15px}}@media (max-width: 480px) {#sidebar{height:35%;max-height:160px}}#app{display:flex;height:100vh}#sidebar{width:300px;background:#1f2937;color:white;padding:20px;overflow-y:auto}#chat-area{flex:1;display:flex;flex-direction:column;background:white}#chat-header{height:60px;background:#0088cc;color:white;padding:20px;display:flex;align-items:center;justify-content:space-between;box-shadow:0 2px 10px rgba(0,0,0,0.1)}#messages{flex:1;overflow-y:auto;padding:20px;background:#f0f2f5}#chat-input{display:flex;padding:20px;gap:10px;background:white;border-top:1px solid #eee;position:sticky;bottom:0}.user-list{margin-top:20px}.user-item{padding:15px;cursor:pointer;border-radius:12px;margin:5px 0;background:#374151;transition:all 0.2s}.user-item:hover{background:#4b5563}.user-item.active{background:#0088cc;box-shadow:0 4px 12px rgba(0,136,204,0.4)}.msg{padding:12px 16px;margin:10px 0;border-radius:18px;max-width:70%;word-wrap:break-word;box-shadow:0 1px 2px rgba(0,0,0,0.1)}.msg.sent{background:#0088cc;color:white;margin-left:auto;text-align:right}.msg.received{background:#e5e5ea;color:#333}input{padding:14px;border:none;border-radius:25px;font-size:16px;flex:1;outline:none;background:#f0f2f5}input:focus{background:white;box-shadow:0 0 0 3px rgba(0,136,204,0.2)}button{padding:14px 20px;background:#0088cc;color:white;border:none;border-radius:25px;cursor:pointer;font-size:16px;font-weight:500;flex-shrink:0}#login{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:white;padding:40px;border-radius:20px;width:90%;max-width:400px;text-align:center;box-shadow:0 20px 40px rgba(0,0,0,0.3);z-index:1000}h1{color:#0088cc;margin-bottom:30px;font-size:2em}input{width:100%;margin:10px 0;padding:15px;border:1px solid #ddd;border-radius:12px;font-size:16px}</style></head><body><div id="login"><h1>Telegram</h1><input id="email" type="email" placeholder="test@mail.ru"><button onclick="sendCode()">Код</button><input id="code" type="text" placeholder="123456" maxlength="6"><button onclick="verifyCode()">Войти</button><div style="margin-top:20px;font-size:14px;color:#666">Код: 123456</div></div><div id="app" style="display:none"><div id="sidebar"><h3>Онлайн (<span id="online-count">0</span>)</h3><div id="user-list" class="user-list"></div></div><div id="chat-area"><div id="chat-header"><span id="chat-title">Чат</span><button onclick="leavePrivateChat()">←</button></div><div id="messages">Готов к чату!</div><div id="chat-input"><input id="msg-input" placeholder="Сообщение... Enter" autofocus><button onclick="sendMsg()">➤</button></div></div></div><script src="/socket.io/socket.io.js"></script><script>const socket=io();let userId=null,currentChat=null,isPrivate=false;function focusInput(){const i=document.getElementById("msg-input");setTimeout(()=>{i.focus();i.scrollIntoView({behavior:"smooth",block:"end"})},100)}async function sendCode(){const e=document.getElementById("email").value.trim();if(!e)return alert("Почта");await fetch("/send-code",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email:e})});alert("Код: 123456");document.getElementById("code").focus()}async function verifyCode(){const c=document.getElementById("code").value;if(c.length<6)return alert("Код");const r=await fetch("/verify-code",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({code:c})});const d=await r.json();if(d.success){userId=d.userId;document.getElementById("login").style.display="none";document.getElementById("app").style.display="flex";socket.emit("register",{userId,email:document.getElementById("email").value});setTimeout(focusInput,500)}else alert("Неверный код: 123456")}function sendMsg(){const t=document.getElementById("msg-input").value.trim();if(!t||!userId)return;if(isPrivate&&currentChat)socket.emit("private-message",{to:currentChat,text:t});else socket.emit("message",{text:t});document.getElementById("msg-input").value=""}function selectUser(id){currentChat=id;isPrivate=true;const u=window.users[id];const n=u?u.email.split("@")[0]:id.slice(-4);document.getElementById("chat-title").textContent="Чат с "+n;document.getElementById("messages").innerHTML="<div style=\\"text-align:center;color:#666;padding:40px\\">Начните...</div>";document.querySelectorAll(".user-item").forEach(e=>e.classList.remove("active"));document.querySelector("[data-user=\'"+id+"\']").classList.add("active");setTimeout(focusInput,300)}function leavePrivateChat(){isPrivate=false;currentChat=null;document.getElementById("chat-title").textContent="Чат";document.querySelectorAll(".user-item").forEach(e=>e.classList.remove("active"));setTimeout(focusInput,200)}socket.on("users-update",u=>{window.users=u;const l=document.getElementById("user-list");document.getElementById("online-count").textContent=Object.keys(u).length;l.innerHTML="";Object.entries(u).forEach(([id,d])=>{if(id!==socket.id){const e=document.createElement("div");e.className="user-item";e.dataset.user=id;e.onclick=()=>selectUser(id);e.innerHTML="<div>"+d.email.split("@")[0]+"</div><div>"+id.slice(-4)+"</div>";l.appendChild(e)}})});function addMsg(m,sent){const d=document.getElementById("messages"),e=document.createElement("div");e.className="msg "+(sent?"sent":"received");e.innerHTML="<strong>"+(m.fromUser||m.from)+":</strong> "+m.text+"<br><small>"+m.time+"</small>";d.appendChild(e);d.scrollTop=d.scrollHeight}socket.on("new-message",m=>addMsg(m));socket.on("private-message",m=>{if(isPrivate&&currentChat===m.fromSocket)addMsg(m,m.fromUser===socket.id.slice(-4))});document.addEventListener("keydown",e=>{if(e.key==="Enter"&&!e.shiftKey&&document.getElementById("app").style.display!=="none"){e.preventDefault();sendMsg()}});document.getElementById("msg-input").addEventListener("blur",function(){setTimeout(()=>this.focus(),150)});</script></body></html>');
});

app.post('/send-code', (req, res) => {
    console.log("Код для " + req.body.email + ": 123456");
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
    console.log('Подключился: ' + socket.id);
    
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
    console.log("Telegram на порту " + PORT);
});
