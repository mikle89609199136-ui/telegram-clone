const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, { 
    cors: { origin: "*", methods: ["GET", "POST"] } 
});

// БАЗА ДАННЫХ ПОЛЬЗОВАТЕЛЕЙ И ЧАТОВ (память сайта)
const usersDB = {};           // {email: {username, password, verified: true}}
const sessions = {};          // {sessionId: {userId, username}}
const chats = {
    private: {},              // "user1-user2": [messages]
    userMessages: {}          // userId: {toUserId: [messages]}
};
const resetCodes = {};        // {email: code}

app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
    res.send('<!DOCTYPE html><html><head><title>Telegram</title><meta name="viewport" content="width=device-width, initial-scale=1.0"><style>*{margin:0;padding:0;box-sizing:border-box;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}body{background:linear-gradient(135deg,#0088cc,#00c4b4);min-height:100vh}@media (max-width:768px){#app-container{padding:10px}#sidebar{width:100%;height:40vh;max-height:250px}#chat-area{height:60vh}.user-item{padding:12px 15px;font-size:14px}.msg{max-width:85%}}#app-container{max-width:1200px;margin:0 auto;padding:20px}#auth{display:flex;gap:20px;justify-content:center;flex-wrap:wrap}@media (max-width:768px){#auth{flex-direction:column;align-items:center}}#register,#login,#forgot{background:white;padding:30px;border-radius:20px;width:100%;max-width:380px;box-shadow:0 20px 40px rgba(0,0,0,0.2)}#chat-app{display:none;flex-direction:row;height:80vh}@media (max-width:768px){#chat-app{flex-direction:column;height:90vh}}#sidebar{width:320px;background:#1f2937;color:white;padding:20px;overflow-y:auto;border-radius:15px 0 0 15px}@media (max-width:768px){#sidebar{width:100%;height:40vh;border-radius:15px 15px 0 0}}#chat-area{flex:1;display:flex;flex-direction:column;background:#f0f2f5;border-radius:0 15px 15px 15px}#chat-header{height:60px;background:#0088cc;color:white;padding:0 20px;display:flex;align-items:center;justify-content:space-between;box-shadow:0 2px 10px rgba(0,0,0,0.1);border-radius:0 15px 0 0}#messages{flex:1;overflow-y:auto;padding:20px}#chat-input{display:flex;padding:20px;gap:10px;background:white;border-top:1px solid #eee;border-radius:0 0 15px 15px}.user-list{margin-top:20px}.user-item{padding:15px;cursor:pointer;border-radius:12px;margin:5px 0;background:#374151;transition:all 0.2s}.user-item:hover{background:#4b5563}.user-item.active{background:#0088cc !important;box-shadow:0 4px 12px rgba(0,136,204,0.4)}.user-name{font-weight:500;font-size:16px}.user-id{font-size:12px;opacity:0.8}.msg{padding:12px 16px;margin:8px 0;border-radius:18px;max-width:70%;word-wrap:break-word;box-shadow:0 1px 2px rgba(0,0,0,0.1)}.msg.sent{background:#0088cc;color:white;margin-left:auto;text-align:right}.msg.received{background:#e5e5ea;color:#333}.msg-time{font-size:11px;opacity:0.7;margin-top:4px}input{padding:14px;border:1px solid #ddd;border-radius:12px;font-size:16px;width:100%;margin:8px 0}input:focus{outline:none;border-color:#0088cc;box-shadow:0 0 0 3px rgba(0,136,204,0.1)}button{padding:12px 24px;background:#0088cc;color:white;border:none;border-radius:12px;cursor:pointer;font-size:16px;font-weight:500;transition:all 0.2s}button:hover{background:#006ba0}button:active{transform:scale(0.98)}.error{color:#ef4444;margin:10px 0;font-size:14px}.success{color:#10b981;margin:10px 0;font-size:14px}h1,h2,h3{color:#0088cc;text-align:center}h2{font-size:1.5em;margin-bottom:20px}.form-group{margin-bottom:15px}</style></head><body><div id="app-container"><div id="auth"><div id="register"><h2>📝 Регистрация</h2><div class="form-group"><input id="reg-email" type="email" placeholder="email@gmail.com"></div><div class="form-group"><input id="reg-username" placeholder="@username"></div><div class="form-group"><input id="reg-password" type="password" placeholder="Пароль"></div><div class="form-group"><input id="reg-code" placeholder="Код с почты"></div><button onclick="register()">Зарегистрироваться</button><button onclick="showLogin()">Уже есть аккаунт?</button></div><div id="login" style="display:none"><h2>🔐 Вход</h2><div class="form-group"><input id="login-username" placeholder="@username"></div><div class="form-group"><input id="login-password" type="password" placeholder="Пароль"></div><button onclick="login()">Войти</button><button onclick="showRegister()">Регистрация</button><button onclick="showForgot()">Забыл пароль</button></div><div id="forgot" style="display:none"><h2>🔑 Сброс пароля</h2><div class="form-group"><input id="forgot-email" type="email" placeholder="email@gmail.com"></div><div class="form-group"><input id="forgot-code" placeholder="Код с почты"></div><div class="form-group"><input id="new-password" type="password" placeholder="Новый пароль"></div><button onclick="resetPassword()">Сменить пароль</button><button onclick="showLogin()">Назад ко входу</button></div></div><div id="chat-app"><div id="sidebar"><h3>👥 Онлайн (<span id="online-count">0</span>)</h3><div id="user-list" class="user-list"></div></div><div id="chat-area"><div id="chat-header"><span id="chat-title">@Все</span><button onclick="leavePrivateChat()">← Общий чат</button></div><div id="messages">Добро пожаловать в Telegram!</div><div id="chat-input"><input id="msg-input" placeholder="Напиши сообщение... (Enter)" autofocus><button onclick="sendMsg()">➤</button></div></div></div></div><script src="/socket.io/socket.io.js"></script><script>const socket=io();let currentUser=null,currentChat=null,isPrivateChat=false;window.userChats={};function focusInput(){setTimeout(()=>{document.getElementById("msg-input").focus()},100)}function showRegister(){document.getElementById("register").style.display="block";document.getElementById("login").style.display="none";document.getElementById("forgot").style.display="none"}function showLogin(){document.getElementById("register").style.display="none";document.getElementById("login").style.display="block";document.getElementById("forgot").style.display="none"}function showForgot(){document.getElementById("register").style.display="none";document.getElementById("login").style.display="none";document.getElementById("forgot").style.display="block"}async function register(){const email=document.getElementById("reg-email").value.trim(),username=document.getElementById("reg-username").value.trim(),password=document.getElementById("reg-password").value,code=document.getElementById("reg-code").value;if(!email||!username||!password)return document.getElementById("register").innerHTML+="<div class=\\"error\\">Заполните все поля</div>";const r=await fetch("/register",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email,username,password,code})});const d=await r.json();if(d.success){currentUser=d.user;document.getElementById("chat-app").style.display="flex";document.getElementById("auth").style.display="none";socket.emit("login",d.user);focusInput()}else document.getElementById("register").innerHTML+="<div class=\\"error\\">"+d.error+"</div>"}async function login(){const username=document.getElementById("login-username").value.trim(),password=document.getElementById("login-password").value;if(!username||!password)return document.getElementById("login").innerHTML+="<div class=\\"error\\">Заполните поля</div>";const r=await fetch("/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({username,password})});const d=await r.json();if(d.success){currentUser=d.user;document.getElementById("chat-app").style.display="flex";document.getElementById("auth").style.display="none";socket.emit("login",d.user);focusInput()}else document.getElementById("login").innerHTML+="<div class=\\"error\\">"+d.error+"</div>"}async function resetPassword(){const email=document.getElementById("forgot-email").value.trim(),code=document.getElementById("forgot-code").value,newPassword=document.getElementById("new-password").value;if(!email||!code||!newPassword)return document.getElementById("forgot").innerHTML+="<div class=\\"error\\">Заполните поля</div>";const r=await fetch("/reset-password",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email,code,newPassword})});const d=await r.json();if(d.success){document.getElementById("forgot").innerHTML="<div class=\\"success\\">Пароль изменен! Войдите</div>";setTimeout(showLogin,2000)}else document.getElementById("forgot").innerHTML+="<div class=\\"error\\">"+d.error+"</div>"}function sendMsg(){const text=document.getElementById("msg-input").value.trim();if(!text||!currentUser)return;const target=isPrivateChat&&currentChat?currentChat:null;socket.emit("message",{text,target});document.getElementById("msg-input").value=""}function selectUser(targetUsername){currentChat=targetUsername;isPrivateChat=true;document.getElementById("chat-title").textContent="@" + targetUsername;document.querySelectorAll(".user-item").forEach(e=>e.classList.remove("active"));document.querySelector("[data-user=\'"+targetUsername+"\']").classList.add("active");loadChatHistory(targetUsername);focusInput()}function leavePrivateChat(){isPrivateChat=false;currentChat=null;document.getElementById("chat-title").textContent="@Все";document.querySelectorAll(".user-item").forEach(e=>e.classList.remove("active"));loadChatHistory(null);focusInput()}function loadChatHistory(target){const messagesEl=document.getElementById("messages");messagesEl.innerHTML="Загрузка истории...";socket.emit("get-history",{target})}function addMessage(msg,isOwn){const messagesEl=document.getElementById("messages");const msgEl=document.createElement("div");msgEl.className="msg "+(isOwn?"sent":"received");msgEl.innerHTML="<strong>@"+msg.from+":</strong> "+msg.text+"<div class=\\"msg-time\\">"+msg.time+"</div>";messagesEl.appendChild(msgEl);messagesEl.scrollTop=messagesEl.scrollHeight}socket.on("user-list",users=>{const listEl=document.getElementById("user-list");document.getElementById("online-count").textContent=Object.keys(users).length;listEl.innerHTML="";Object.entries(users).forEach(([id,user])=>{if(id!==socket.id){const div=document.createElement("div");div.className="user-item";div.dataset.user=user.username;div.onclick=()=>selectUser(user.username);div.innerHTML="<div class=\\"user-name\\">"+user.username+"</div><div class=\\"user-id\\">"+id.slice(-4)+"</div>";listEl.appendChild(div)}})});socket.on("message",msg=>{addMessage(msg,msg.from===currentUser.username)});socket.on("history",data=>{const messagesEl=document.getElementById("messages");messagesEl.innerHTML="";data.forEach(msg=>addMessage(msg,msg.from===currentUser.username))});document.addEventListener("keydown",e=>{if(e.key==="Enter"&&!e.shiftKey&&document.getElementById("chat-app").style.display!=="none"){e.preventDefault();sendMsg()}});document.getElementById("msg-input").addEventListener("blur",()=>setTimeout(focusInput,100));</script></body></html>');
});

// API РЕГИСТРАЦИИ И ВХОДА
app.post('/register', (req, res) => {
    const {email, username, password, code} = req.body;
    
    // Проверка кода подтверждения
    if (code !== "123456") {
        return res.json({success: false, error: "Неверный код. Используйте 123456"});
    }
    
    if (usersDB[email]) {
        return res.json({success: false, error: "Аккаунт уже существует! Войдите"});
    }
    
    usersDB[email] = {
        username: username.replace('@', ''),
        password: password,
        verified: true
    };
    
    console.log("Новый пользователь: " + username + " (" + email + ")");
    res.json({success: true, user: {username: username.replace('@', ''), email}});
});

app.post('/login', (req, res) => {
    const {username, password} = req.body;
    const user = Object.values(usersDB).find(u => u.username === username.replace('@', ''));
    
    if (!user || user.password !== password) {
        return res.json({success: false, error: "Неверный логин или пароль"});
    }
    
    const sessionId = Date.now().toString();
    sessions[sessionId] = {userId: sessionId, username: user.username};
    
    res.json({success: true, user: {username: user.username, sessionId}});
});

app.post('/send-reset-code', (req, res) => {
    const {email} = req.body;
    resetCodes[email] = "123456";
    console.log("Код сброса для " + email + ": 123456");
    res.json({success: true});
});

app.post('/reset-password', (req, res) => {
    const {email, code, newPassword} = req.body;
    
    if (resetCodes[email] !== code) {
        return res.json({success: false, error: "Неверный код сброса"});
    }
    
    if (!usersDB[email]) {
        return res.json({success: false, error: "Пользователь не найден"});
    }
    
    usersDB[email].password = newPassword;
    delete resetCodes[email];
    
    res.json({success: true});
});

io.on('connection', (socket) => {
    console.log('Подключился: ' + socket.id);
    
    socket.on('login', (user) => {
        sessions[socket.id] = user;
        io.emit('user-list', sessions);
        socket.emit('history', []);
        console.log('Вошел: @' + user.username);
    });
    
    socket.on('message', (data) => {
        const session = sessions[socket.id];
        if (!session) return;
        
        const message = {
            from: session.username,
            text: data.text,
            time: new Date().toLocaleString('ru-RU', {hour: '2-digit', minute: '2-digit'}),
            to: data.target
        };
        
        // Сохраняем ЛС
        if (data.target) {
            const chatKey = [session.username, data.target].sort().join('-');
            if (!chats.private[chatKey]) chats.private[chatKey] = [];
            chats.private[chatKey].push(message);
        }
        
        io.emit('message', message);
    });
    
    socket.on('get-history', (data) => {
        const session = sessions[socket.id];
        if (!session || !data.target) return [];
        
        const chatKey = [session.username, data.target].sort().join('-');
        socket.emit('history', chats.private[chatKey] || []);
    });
    
    socket.on('disconnect', () => {
        delete sessions[socket.id];
        io.emit('user-list', sessions);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log("Telegram PRO на порту " + PORT);
});
