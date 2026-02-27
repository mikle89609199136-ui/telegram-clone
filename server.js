/***********************
 * 🚀 ИМПОРТЫ - ОСНОВА
 ***********************/
const express = require('express');           // 🌐 HTTP сервер
const http = require('http');                 // 🔌 HTTP протокол  
const socketIo = require('socket.io');        // ⚡ Real-time чаты
const cors = require('cors');                 // 🔗 Frontend-Backend
const fs = require('fs');                     // 💾 Файлы JSON
const path = require('path');                 // 📁 Пути файлов
const bcrypt = require('bcryptjs');           // 🔐 Хэш паролей
const jwt = require('jsonwebtoken');          // 🆔 Токены 1 год

/***********************
 * 🏗️ ИНИЦИАЛИЗАЦИЯ СЕРВЕРА
 ***********************/
const app = express();                        // Создаем Express app
const server = http.createServer(app);        // HTTP сервер поверх Express
const io = socketIo(server, {                 // Socket.io для real-time
    cors: { origin: "*" }                     // Разрешаем все домены
});

const PORT = process.env.PORT || 3000;        // 🚪 Порт (Railway=случайный)
const DATA_DIR = './data';                    // 📁 Папка с данными

// ✅ СОЗДАЕМ ПАПКУ data/ если нету
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    console.log('📁 Создана папка data/');
}

/***********************
 * 📄 JSON ФАЙЛЫ - БАЗА ДАННЫХ
 ***********************/
const files = {
    users: path.join(DATA_DIR, 'users.json'),     // 👥 Пользователи
    chats: path.join(DATA_DIR, 'chats.json'),     // 💬 Чаты
    messages: path.join(DATA_DIR, 'messages.json'), // 📨 Сообщения
    recovery: path.join(DATA_DIR, 'recovery.json'), // 🔢 OTP коды
    blocks: path.join(DATA_DIR, 'blocks.json')      // 🚫 Блокировки
};

// ✅ СОЗДАЕМ ПУСТЫЕ JSON файлы
Object.values(files).forEach(file => {
    if (!fs.existsSync(file)) {
        fs.writeFileSync(file, '[]');
        console.log(`📄 Создан: ${path.basename(file)}`);
    }
});

/***********************
 * 🔧 ФУНКЦИИ РАБОТЫ С JSON
 ***********************/
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8') || '[]');
const writeJson = (file, data) => fs.writeFileSync(file, JSON.stringify(data, null, 2));

// ✅ ГРУЗИМ ДАННЫЕ ИЗ ФАЙЛОВ
let users = readJson(files.users);
let chats = readJson(files.chats);
let messages = readJson(files.messages);
let recoveryCodes = readJson(files.recovery);
let blocks = readJson(files.blocks);

/***********************
 * 🔐 КЛЮЧИ БЕЗОПАСНОСТИ
 ***********************/
const JWT_SECRET = 'ZhuravlevPro2026Secret!@#';  // 🆔 JWT подпись
const ENCRYPTION_KEY = 'ZhuravlevPro2026!@#';    // 🔒 Шифрование

/***********************
 * 🌐 МIDDLEWARE - ОСНОВА
 ***********************/
app.use(cors());                              // ✅ CORS для браузера
app.use(express.json());                      // ✅ Парсим JSON
app.use(express.static('.'));                 // ✅ Отдаем chat.html

/***********************
 * 🩺 HEALTH CHECK
 ***********************/
app.get('/health', (req, res) => {
    res.json({ 
        status: '🟢 OK', 
        timestamp: new Date().toISOString(),
        users: users.length,
        chats: chats.length,
        messages: messages.length
    });
});

/***********************
 * 📱 ГЛАВНАЯ СТРАНИЦА
 ***********************/
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'chat.html'));
});

/***********************
 * 🔐 МIDDLEWARE АВТОРИЗАЦИИ
 ***********************/
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    
    if (!token) {
        return res.status(401).json({ error: 'Токен отсутствует' });
    }
    
    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ error: 'Неверный токен' });
        }
        req.user = user;
        next();
    });
};

/***********************
 * 📝 РЕГИСТРАЦИЯ - НОВЫЙ ПОЛЬЗОВАТЕЛЬ
 ***********************/
app.post('/api/register', async (req, res) => {
    console.log('🔄 Регистрация:', req.body.username);
    
    const { email, username, password } = req.body;
    
    // ✅ ПРОВЕРЯЕМ СУЩЕСТВОВАНИЕ
    if (users.find(u => u.email === email || u.username === username)) {
        return res.json({ success: false, error: 'Пользователь уже существует' });
    }
    
    // ✅ ХЭШИРУЕМ ПАРОЛЬ
    const hashedPassword = await bcrypt.hash(password, 12);
    const userId = Date.now().toString();  // ✅ Уникальный ID
    
    // ✅ СОЗДАЕМ ПОЛЬЗОВАТЕЛЯ
    const user = {
        id: userId,
        email,
        username: username.replace('@', ''),
        name: username.split(' ')[0] || 'User',
        password: hashedPassword,
        avatar: `https://ui-avatars.com/api/?name=${username}&background=34c759&color=fff&size=128`,
        settings: {
            notifications: true,
            theme: 'light',
            language: 'ru',
            privacy: { lastSeen: 'all', photo: 'all' },
            phone: '',
            birthday: ''
        },
        created: new Date().toISOString()
    };
    
    users.push(user);
    writeJson(files.users, users);
    
    // ✅ ПРИВЕТСТВЕННЫЙ ЧАТ
    const welcomeChat = {
        id: `welcome_${userId}`,
        name: 'Zhuravlev Bot 🤖',
        type: 'service',
        userId: userId,
        members: [userId],
        lastMessage: 'Добро пожаловать в Zhuravlev Messenger! 🎉\n\nFast. Secure. Synced.',
        lastTime: new Date().toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'}),
        unread: 1,
        pinned: true,
        lastAuthor: 'bot'
    };
    chats.push(welcomeChat);
    writeJson(files.chats, chats);
    
    // ✅ JWT ТОКЕН НА 1 ГОД
    const token = jwt.sign({ id: userId }, JWT_SECRET, { expiresIn: '365d' });
    
    console.log('✅ Зарегистрирован:', username);
    res.json({ success: true, token, user });
});

/***********************
 * 🔑 ВХОД - СУЩЕСТВУЮЩИЙ ПОЛЬЗОВАТЕЛЬ
 ***********************/
app.post('/api/login', async (req, res) => {
    console.log('🔄 Вход:', req.body.username);
    
    const { username, password } = req.body;
    const user = users.find(u => u.username === username);
    
    // ✅ ПРОВЕРЯЕМ ПАРОЛЬ
    if (!user || !await bcrypt.compare(password, user.password)) {
        console.log('❌ Неверный логин/пароль');
        return res.json({ success: false, error: 'Неверный логин или пароль' });
    }
    
    // ✅ JWT ТОКЕН НА 1 ГОД
    const token = jwt.sign({ id: user.id }, JWT_SECRET, { expiresIn: '365d' });
    
    console.log('✅ Вошел:', username);
    res.json({ success: true, token, user });
});

/***********************
 * 🔢 OTP - ВОССТАНОВЛЕНИЕ ПАРОЛЯ
 ***********************/
app.post('/api/send-otp', (req, res) => {
    const { email } = req.body;
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expires = Date.now() + 5 * 60 * 1000; // 5 минут
    
    // ✅ УДАЛЯЕМ СТАРЫЕ КОДЫ
    recoveryCodes = recoveryCodes.filter(r => r.email !== email);
    recoveryCodes.push({ email, code, expires });
    writeJson(files.recovery, recoveryCodes);
    
    console.log(`🔢 OTP ${code} отправлен на ${email}`);
    res.json({ success: true, message: 'Код отправлен (проверьте консоль)' });
});

app.post('/api/verify-otp', (req, res) => {
    const { email, code } = req.body;
    const record = recoveryCodes.find(r => 
        r.email === email && 
        r.code === code && 
        Date.now() < r.expires
    );
    
    res.json({ success: !!record });
});

app.post('/api/reset-password', async (req, res) => {
    const { email, newPassword } = req.body;
    const user = users.find(u => u.email === email);
    
    if (!user) {
        return res.json({ success: false, error: 'Пользователь не найден' });
    }
    
    user.password = await bcrypt.hash(newPassword, 12);
    writeJson(files.users, users);
    
    console.log('🔄 Пароль сброшен:', email);
    res.json({ success: true });
});

/***********************
 * 📋 ЧАТЫ - СПИСОК
 ***********************/
app.get('/api/chats', (req, res) => {
    // ✅ Все чаты для всех (пока без авторизации)
    const userChats = chats.filter(c => !c.private || c.members?.includes('all'));
    res.json(userChats);
});

/***********************
 * 💬 СООБЩЕНИЯ - ПО ЧАТУ
 ***********************/
app.get('/api/messages/:chatId', (req, res) => {
    const chatMessages = messages.filter(m => m.chatId === req.params.chatId);
    res.json(chatMessages.sort((a, b) => new Date(a.time) - new Date(b.time)));
});

/***********************
 * ⚡ SOCKET.IO - REAL-TIME
 ***********************/
io.on('connection', (socket) => {
    console.log('🔌 Подключен клиент:', socket.id);
    
    socket.on('message', (data) => {
        console.log('📨 Сообщение:', data);
        
        // ✅ СОЗДАЕМ СООБЩЕНИЕ
        const message = {
            id: Date.now().toString(),
            chatId: data.chatId,
            userId: data.userId || 'anonymous',
            name: data.name || 'User',
            text: data.text,  // Уже зашифровано на клиенте
            time: new Date().toISOString(),
            read: false
        };
        
        messages.push(message);
        writeJson(files.messages, messages);
        
        // ✅ ОБНОВЛЯЕМ ЧАТ
        const chat = chats.find(c => c.id === data.chatId);
        if (chat) {
            chat.lastMessage = data.text.substring(0, 30);
            chat.lastTime = new Date().toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'});
            chat.lastAuthor = data.userId;
            chat.unread = (chat.unread || 0) + 1;
            writeJson(files.chats, chats);
        }
        
        // ✅ ОТПРАВЛЯЕМ ВСЕМ
        io.emit('message', message);
    });
    
    socket.on('disconnect', () => {
        console.log('🔌 Отключен:', socket.id);
    });
});

/***********************
 * 🚀 ЗАПУСК СЕРВЕРА
 ***********************/
server.listen(PORT, () => {
    console.log(`\n🚀 Telegram Pro v20.0 запущен!`);
    console.log(`📱 Главная: http://localhost:${PORT}`);
    console.log(`🩺 Health:  http://localhost:${PORT}/health`);
    console.log(`📊 Пользователей: ${users.length}`);
    console.log(`💬 Чатов: ${chats.length}`);
    console.log(`📨 Сообщений: ${messages.length}`);
    console.log(`\n✅ Готов к деплою на Railway!\n`);
});

/***********************
 * 🛡️ ОБРАБОТКА ОШИБОК
 ***********************/
process.on('uncaughtException', (error) => {
    console.error('💥 КРИТИЧЕСКАЯ ОШИБКА:', error);
    process.exit(1);
});
