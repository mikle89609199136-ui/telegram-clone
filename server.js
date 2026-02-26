const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
  pingTimeout: 20000
});

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

const USERS_FILE = path.join(DATA_DIR, 'users.json');
const CHATS_FILE = path.join(DATA_DIR, 'chats.json');

function loadUsers() {
  try { return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8')); }
  catch { return {}; }
}
function saveUsers(users) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}
function loadChats() {
  try { return JSON.parse(fs.readFileSync(CHATS_FILE, 'utf8')); }
  catch { return {}; }
}
function saveChats(chats) {
  fs.writeFileSync(CHATS_FILE, JSON.stringify(chats, null, 2));
}

let usersDB = loadUsers();
let privateChats = loadChats();
const onlineUsers = new Map();
const rateLimits = new Map();

function checkRate(userId) {
  const now = Date.now();
  const data = rateLimits.get(userId) || {count: 0, reset: now};
  if (now - data.reset > 60000) data.count = 0;
  if (data.count > 30) return false;
  data.count++;
  rateLimits.set(userId, data);
  return true;
}

app.use(cors());
app.use(express.json({ limit: '10mb' }));

app.post('/api/register', (req, res) => {
  const { email, password, username, confirmPassword } = req.body;
  if (!email || !email.includes('@') || !username || password.length < 6 || 
      password !== confirmPassword || usersDB[email]) {
    return res.status(400).json({ error: 'Неверные данные' });
  }

  const userId = 'user_' + Date.now() + '_' + Math.random().toString(36).substr(2,9);
  usersDB[email] = {
    id: userId, email: email.toLowerCase(), username: username.toLowerCase(),
    name: username.charAt(0).toUpperCase() + username.slice(1),
    avatar: '👤', password,
    created: new Date().toISOString(), lastSeen: null, online: false
  };
  saveUsers(usersDB);
  res.json({ success: true, user: usersDB[email] });
});

app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  for (let email in usersDB) {
    const user = usersDB[email];
    if ((user.username === username.toLowerCase() || user.email === username.toLowerCase()) 
        && user.password === password) {
      user.online = true;
      user.lastSeen = new Date().toISOString();
      saveUsers(usersDB);
      return res.json({ success: true, user });
    }
  }
  res.status(401).json({ error: 'Неверный логин/пароль' });
});

app.get('/api/users', (req, res) => {
  const excludeId = req.query.exclude;
  const users = Object.values(usersDB).map(u => ({
    id: u.id, name: u.name, username: u.username,
    avatar: u.avatar, online: onlineUsers.has(u.id), lastSeen: u.lastSeen
  })).filter(u => !excludeId || u.id !== excludeId);
  res.json(users);
});

app.get('/api/chats/:userId', (req, res) => {
  const userId = req.params.userId;
  const chats = [];
  for (let chatId in privateChats) {
    if (chatId.includes(userId)) {
      const messages = privateChats[chatId] || [];
      const lastMsg = messages[messages.length-1];
      const participants = chatId.split('_');
      const otherId = participants.find(id => id !== userId);
      const otherUser = Object.values(usersDB).find(u => u.id === otherId);
      if (otherUser) {
        chats.push({
          chatId, userId: otherUser.id, name: otherUser.name, avatar: otherUser.avatar,
          online: onlineUsers.has(otherUser.id),
          lastMessage: lastMsg ? { text: lastMsg.text, time: lastMsg.time } : null,
          unread: messages.filter(m => m.to === userId && !m.read).length
        });
      }
    }
  }
  chats.sort((a,b) => (b.lastMessage ? new Date(b.lastMessage.time) : 0) - (a.lastMessage ? new Date(a.lastMessage.time) : 0));
  res.json(chats);
});

app.get('/api/messages/:userId/:otherId', (req, res) => {
  const { userId, otherId } = req.params;
  const chatId = [userId, otherId].sort().join('_');
  const messages = privateChats[chatId] || [];
  if (privateChats[chatId]) {
    privateChats[chatId].forEach(msg => { 
      if (msg.to === userId) msg.read = true; 
    });
    saveChats(privateChats);
  }
  res.json(messages);
});

// ✅ НОВЫЙ ЭНДПОИНТ ДЛЯ ПОИСКА ПОЛЬЗОВАТЕЛЕЙ
app.get('/api/users/search', (req, res) => {
  const { q } = req.query;
  if (!q) return res.json([]);
  const searchUsers = Object.values(usersDB).filter(u => 
    u.username.toLowerCase().includes(q.toLowerCase()) || 
    u.email.toLowerCase().includes(q.toLowerCase())
  ).slice(0, 10); // топ 10
  res.json(searchUsers.map(u => ({
    id: u.id, name: u.name, username: u.username, avatar: u.avatar
  })));
});

io.on('connection', (socket) => {
  console.log('Connected: ' + socket.id);

  socket.on('join', (userId) => {
    socket.join(userId);
    socket.userId = userId;
    onlineUsers.set(userId, socket.id);
    
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
      socket.emit('error', 'Слишком много сообщений');
      return;
    }
    
    const chatId = [data.from, data.to].sort().join('_');
    if (!privateChats[chatId]) privateChats[chatId] = [];
    
    const message = {
      id: 'msg_' + Date.now() + '_' + Math.random().toString(36).substr(2,5),
      from: data.from, to: data.to, text: data.text.slice(0,1000),
      time: new Date().toISOString(), read: false
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
  });
});

// ✅ КОРНЕВОЙ МАРШРУТ (с обратными кавычками)
app.get('/', (req, res) => {
  res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Zhuravlev Messenger V28</title><style>*{margin:0;padding:0;box-sizing:border-box;font-family:system-ui,sans-serif;}body{background:#f0f2f5;min-height:100vh;}.welcome{display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;padding:20px;background:linear-gradient(135deg,#667eea,#764ba2);color:white;text-align:center;}.logo{font-size:3rem;margin-bottom:1rem;}.btn{padding:15px 30px;margin:10px;border:none;border-radius:25px;background:#34c759;color:white;font-weight:600;cursor:pointer;transition:transform 0.2s;}.btn:active{transform:scale(0.95);}.auth-overlay{position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.8);display:none;z-index:1000;align-items:center;justify-content:center;}.auth-card{background:white;border-radius:20px;padding:30px;max-width:400px;width:90%;max-height:90vh;overflow:auto;box-shadow:0 20px 40px rgba(0,0,0,0.3);}.input-field{width:100%;padding:15px;margin:10px 0;border:1px solid #ddd;border-radius:12px;box-sizing:border-box;font-size:16px;}.input-field:focus{outline:none;border-color:#34c759;box-shadow:0 0 0 3px rgba(52,199,89,0.1);}#main-app{display:none;height:100vh;flex-direction:column;}#header{background:white;padding:15px 20px;border-bottom:1px solid #e4e6eb;position:fixed;top:0;left:0;right:0;z-index:100;box-shadow:0 2px 10px rgba(0,0,0,0.1);}#chat-list{margin-top:70px;padding:10px;}.chat-item{display:flex;padding:15px;background:white;margin:10px 0;border-radius:12px;cursor:pointer;transition:background 0.2s;}.chat-item:hover{background:#e4f3ff;}.chat-item:active{background:#d0e8ff;}.avatar{width:50px;height:50px;border-radius:50%;background:#34c759;color:white;display:flex;align-items:center;justify-content:center;margin-right:15px;font-size:20px;font-weight:600;flex-shrink:0;}.chat-info{flex:1;min-width:0;}.chat-name{font-weight:600;margin-bottom:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}.chat-preview{color:#65676b;font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}.unread-dot{background:#34c759;width:20px;height:20px;border-radius:50%;margin-left:10px;flex-shrink:0;}#chat-screen{display:none;height:100vh;flex-direction:column;}.chat-header{background:white;padding:15px 20px;border-bottom:1px solid #e4e6eb;display:flex;align-items:center;position:fixed;top:0;left:0;right:0;z-index:100;box-shadow:0 2px 10px rgba(0,0,0,0.1);}.back-btn{border:none;background:none;font-size:24px;margin-right:15px;cursor:pointer;padding:5px;}.messages{flex:1;overflow:auto;padding:90px 20px 120px;background:#efeef1;}.message{margin-bottom:16px;max-width:70%;display:flex;flex-direction:column;}.message.sent{align-self:flex-end;}.bubble{padding:12px 16px;border-radius:20px;display:inline-block;max-width:100%;word-wrap:break-word;font-size:15px;line-height:1.4;box-shadow:0 1px 2px rgba(0,0,0,0.1);}.bubble.sent{background:#34c759;color:white;border-bottom-right-radius:4px;}.bubble.received{background:white;border:1px solid #e4e6eb;border-bottom-left-radius:4px;}.input-area{position:fixed;bottom:0;left:0;right:0;padding:15px;background:white;border-top:1px solid #e4e6eb;display:flex;gap:12px;box-shadow:0 -2px 20px rgba(0,0,0,0.1);}#message-input{flex:1;border:1px solid #e4e6eb;border-radius:25px;padding:14px 18px;resize:none;max-height:120px;font-size:16px;line-height:1.4;font-family:inherit;}.send-btn{width:48px;height:48px;border:none;border-radius:50%;background:#34c759;color:white;font-size:18px;cursor:pointer;flex-shrink:0;transition:transform 0.2s;}.send-btn:disabled{opacity:0.5;cursor:not-allowed;transform:none;}.send-btn:active{transform:scale(0.95);}.no-chats{padding:60px 20px;text-align:center;color:#65676b;font-size:16px;}@media(max-width:480px){.chat-item{padding:12px;}.avatar{width:44px;height:44px;font-size:18px;}}</style></head><body><div class="welcome" id="welcome"><div class="logo">📱</div><h1 style="font-size:2.5rem;margin-bottom:10px;">Zhuravlev Messenger</h1><p style="font-size:1.1rem;opacity:0.9;">Fast. Secure. Real-time.</p><button class="btn" onclick="showRegister()">📝 Регистрация</button><button class="btn" onclick="showLogin()">🔐 Вход</button></div><div class="auth-overlay" id="auth-overlay"><div class="auth-card"><div id="register-form"><h2 style="margin-bottom:20px;color:#333;">Создать аккаунт</h2><input class="input-field" id="reg-email" placeholder="Email" type="email"><input class="input-field" id="reg-username" placeholder="@username"><input class="input-field" id="reg-password" type="password" placeholder="Пароль (6+ символов)"><input class="input-field" id="reg-confirm" type="password" placeholder="Повторите пароль"><button class="btn" onclick="register()" style="width:100%;margin-top:10px;">Создать аккаунт</button><p style="text-align:center;margin-top:20px;font-size:14px;"><a href="#" onclick="showLogin();return false;" style="color:#34c759;">Уже есть аккаунт?</a></p></div><div id="login-form" style="display:none;"><h2 style="margin-bottom:20px;color:#333;">Вход</h2><input class="input-field" id="login-user" placeholder="Имя пользователя или Email"><input class="input-field" id="login-pass" type="password" placeholder="Пароль"><button class="btn" onclick="login()" style="width:100%;margin-top:10px;">Войти</button><p style="text-align:center;margin-top:20px;font-size:14px;"><a href="#" onclick="showRegister();return false;" style="color:#34c759;">Создать аккаунт</a></p></div></div></div><div id="main-app"><div id="header"><h2 style="margin:0;color:#333;">💬 Чаты</h2></div><div id="chat-list"></div></div><div id="chat-screen"><div class="chat-header"><button class="back-btn" onclick="backToList()" title="Назад">←</button><div id="chat-title" style="font-weight:600;font-size:18px;">Чат</div></div><div class="messages" id="messages"></div><div class="input-area"><textarea id="message-input" placeholder="Напишите сообщение..." oninput="resizeInput();checkSend()"></textarea><button id="send-btn" class="send-btn" onclick="sendMessage()" disabled title="Отправить">➤</button></div></div><script src="/socket.io/socket.io.js"></script><script>let socket=io();let currentUser=null;let currentChat=null;let chats=[];let messages=[];function showRegister(){document.getElementById("register-form").style.display="block";document.getElementById("login-form").style.display="none";document.getElementById("auth-overlay").style.display="flex";}function showLogin(){document.getElementById("register-form").style.display="none";document.getElementById("login-form").style.display="block";document.getElementById("auth-overlay").style.display="flex";}async function register(){let email=document.getElementById("reg-email").value.trim();let username=document.getElementById("reg-username").value.replace(/@/g,"").trim();let password=document.getElementById("reg-password").value;let confirm=document.getElementById("reg-confirm").value;if(!email||!username||!password){alert("Заполните все поля");return;}if(!email.includes("@")){alert("Введите корректный email");return;}if(password!==confirm){alert("Пароли не совпадают");return;}if(password.length<6){alert("Пароль должен содержать минимум 6 символов");return;}try{let res=await fetch("/api/register",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email,username,password,confirmPassword:confirm})});let data=await res.json();if(data.success){alert("✅ Регистрация успешна! Теперь войдите.");showLogin();document.getElementById("reg-email").value="";document.getElementById("reg-username").value="";document.getElementById("reg-password").value="";document.getElementById("reg-confirm").value="";}else{alert("❌ "+data.error);}}catch(e){alert("❌ Ошибка сервера. Попробуйте позже.");}}async function login(){let username=document.getElementById("login-user").value.trim();let password=document.getElementById("login-pass").value;if(!username||!password){alert("Введите логин и пароль");return;}try{let res=await fetch("/api/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({username,password})});let data=await res.json();if(data.success){currentUser=data.user;localStorage.setItem("user",JSON.stringify(currentUser));socket.emit("join",currentUser.id);showApp();setTimeout(loadChats,100);}else{alert("❌ "+data.error);}}catch(e){alert("❌ Ошибка сервера");}}function showApp(){document.getElementById("welcome").style.display="none";document.getElementById("auth-overlay").style.display="none";document.getElementById("main-app").style.display="flex";document.getElementById("chat-list").innerHTML="<div class=\'no-chats\'>Загрузка чатов...</div>";}async function loadChats(){try{let res=await fetch("/api/chats/"+currentUser.id);chats=await res.json();renderChats();}catch(e){chats=[];renderChats();}}function renderChats(){let container=document.getElementById("chat-list");if(chats.length===0){container.innerHTML="<div class=\'no-chats\'>Нет чатов. Создайте первый чат!</div>";return;}container.innerHTML="";chats.forEach(function(chat){let unread=chat.unread>0?"<div class=\'unread-dot\'></div>":"";let preview=chat.lastMessage?chat.lastMessage.text.substring(0,30)+(chat.lastMessage.text.length>30?"…":""):"Нет сообщений";let html="<div class=\'chat-item\' onclick=\'openChat(\\'"+chat.userId.replace(/\'/g,"&#39;")+"\\',\\\'"+chat.name.replace(/\'/g,"&#39;")+"\\\')\'>";html+="<div class=\'avatar\'>"+chat.avatar+"</div>";html+="<div class=\'chat-info\'><div class=\'chat-name\'>"+chat.name+"</div><div class=\'chat-preview\'>"+preview+"</div></div>";html+=unread+"</div>";container.innerHTML+=html;});}async function openChat(userId,name){currentChat={id:userId,name:name};document.getElementById("chat-title").textContent=name;document.getElementById("main-app").style.display="none";document.getElementById("chat-screen").style.display="flex";document.getElementById("messages").innerHTML="<div style=\'padding:60px 20px;text-align:center;color:#65676b\'>Загрузка сообщений...</div>";try{let res=await fetch("/api/messages/"+currentUser.id+"/"+userId);messages=await res.json();renderMessages();}catch(e){messages=[];renderMessages();}}function renderMessages(){let container=document.getElementById("messages");container.innerHTML="";messages.forEach(function(msg){let isSent=msg.from===currentUser.id;let html="<div class=\'message"+(isSent?" sent":"")+"\'>";html+="<div class=\'bubble"+(isSent?" sent":" received")+"\'>"+msg.text+"</div></div>";container.innerHTML+=html;});setTimeout(function(){container.scrollTop=container.scrollHeight;},100);}function backToList(){document.getElementById("chat-screen").style.display="none";document.getElementById("main-app").style.display="flex";loadChats();}function resizeInput(){let el=document.getElementById("message-input");el.style.height="auto";el.style.height=Math.min(el.scrollHeight,120)+"px";}function checkSend(){document.getElementById("send-btn").disabled=!document.getElementById("message-input").value.trim();}function sendMessage(){let input=document.getElementById("message-input");let text=input.value.trim();if(!text||!currentChat){return;}socket.emit("message",{from:currentUser.id,to:currentChat.id,text:text});input.value="";checkSend();resizeInput();}socket.on("newMessage",function(data){if(currentChat&&(data.message.from===currentChat.id||data.message.to===currentChat.id)){messages.push(data.message);renderMessages();}loadChats();});window.onload=function(){let savedUser=localStorage.getItem("user");if(savedUser){try{currentUser=JSON.parse(savedUser);socket.emit("join",currentUser.id);showApp();setTimeout(loadChats,500);}catch(e){localStorage.removeItem("user");}}}</script></body></html>`);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log("V28.1 Messenger LIVE on port " + PORT);
});
