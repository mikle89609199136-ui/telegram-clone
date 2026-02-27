// 📦 ИМПОРТЫ - основные библиотеки
const express = require('express');        // Веб-сервер
const http = require('http');              // HTTP сервер для Socket.io
const socketIo = require('socket.io');     // Real-time связь (сообщения мгновенно)
const cors = require('cors');              // Разрешение CORS (фронт ↔ сервер)
const fs = require('fs');                  // Работа с файлами (база данных JSON)
const path = require('path');              // Пути к файлам
const bcrypt = require('bcryptjs');        // Хэширование паролей (безопасность)

console.log('🚀 Запуск Zhuravlev Telegram Pro v17.0...');

// 🏗️ СОЗДАНИЕ СЕРВЕРА
const app = express();
const server = http.createServer(app);
const io = socketIo(server, { 
    cors: { origin: "*" }  // Разрешаем подключения с любого сайта
});

// 🔧 МИДЛВАР - обработка запросов
app.use(cors());                           // ✅ CORS для фронтенда
app.use(express.json());                   // ✅ Парсинг JSON в POST запросах

// 🌐 РЕЙЛВЕЙ ДЕПЛОЙ - обязательные настройки
const PORT = process.env.PORT || 3000;     // Порт Railway или 3000 локально

// 💾 БАЗА ДАННЫХ - папка data/ с JSON файлами
const DATA_DIR = './data';
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR);
    console.log('📁 Создана папка data/');
}

// 📁 ФАЙЛЫ БАЗЫ ДАННЫХ
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const CHATS_FILE = path.join(DATA_DIR, 'chats.json');
const MESSAGES_FILE = path.join(DATA_DIR, 'messages.json');
const RECOVERY_FILE = path.join(DATA_DIR, 'recovery.json');

// 🆕 ИНИЦИАЛИЗАЦИЯ - создаем пустые файлы если нет
[USERS_FILE, CHATS_FILE, MESSAGES_FILE, RECOVERY_FILE].forEach(file => {
    if (!fs.existsSync(file)) {
        fs.writeFileSync(file, '[]');
        console.log(`📄 Создан ${path.basename(file)}`);
    }
});

// 🔄 ФУНКЦИИ РАБОТЫ С JSON
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const writeJson = (file, data) => {
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
    console.log(`💾 Сохранено в ${path.basename(file)}: ${data.length} записей`);
};

// 📊 ГЛОБАЛЬНЫЕ ПЕРЕМЕННЫЕ
let users = readJson(USERS_FILE);
let chats = readJson(CHATS_FILE);
let messages = readJson(MESSAGES_FILE);

// ✅ HEALTH CHECK для Railway деплоя
app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        timestamp: new Date().toISOString(),
        users: users.length,
        chats: chats.length,
        messages: messages.length
    });
});
console.log('✅ Health check готов: /health');

// 🏠 ГЛАВНАЯ СТРАНИЦА - отдаем chat.html
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'chat.html'));
});

// 🔐 API АВТОРИЗАЦИИ

// Регистрация
app.post('/api/register', async (req, res) => {
    const { email, username, password } = req.body;
    
    // Проверка уникальности
    if (users.find(u => u.email === email || u.username === username)) {
        return res.status(400).json({ error: '👤 Пользователь уже существует' });
    }
    
    // Хэшируем пароль
    const hashedPassword = await bcrypt.hash(password, 12);
    
    // Создаем пользователя
    const user = {
        id: Date.now().toString(),
        email,
        username: username.startsWith('@') ? username.slice(1) : username,
        name: username.split(' ')[0],
        password: hashedPassword,
        avatarColor: `hsl(${Math.random() * 360}, 70%, 60%)`,
        created: new Date().toISOString(),
        settings: {
            notifications: true,
            theme: 'light',
            language: 'ru',
            privacy: { lastSeen: 'all', profilePhoto: 'all' }
        }
    };
    
    users.push(user);
    writeJson(USERS_FILE, users);
    
    // Токен для localStorage (1 год)
    const token = Buffer.from(JSON.stringify({ id: user.id, username: user.username })).toString('base64');
    
    console.log(`👤 Новый пользователь: ${user.username}`);
    res.json({ success: true, token, user });
});

// Вход
app.post('/api/login', async (req, res) => {
    const { login, password } = req.body; // login = username или email
    
    const user = users.find(u => 
        u.username === login || u.email === login
    );
    
    if (!user || !await bcrypt.compare(password, user.password)) {
        return res.status(400).json({ error: '❌ Неверный логин или пароль' });
    }
    
    const token = Buffer.from(JSON.stringify({ id: user.id, username: user.username })).toString('base64');
    
    console.log(`🔓 Вход: ${user.username}`);
    res.json({ success: true, token, user });
});

// 🔢 КОДЫ ВОССТАНОВЛЕНИЯ ПАРОЛЯ
app.post('/api/send-code', (req, res) => {
    const { email } = req.body;
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    
    // Сохраняем код (5 минут жизни)
    let recovery = readJson(RECOVERY_FILE);
    recovery = recovery.filter(r => r.email !== email); // Удаляем старые
    recovery.push({ 
        email, 
        code, 
        expires: Date.now() + 5 * 60 * 1000 // 5 минут
    });
    writeJson(RECOVERY_FILE, recovery);
    
    // ЛОГ В КОНСОЛЬ (для демо, в продакшене - email)
    console.log(`💌 КОД ${code} для ${email}`);
    
    res.json({ success: true, code }); // Возвращаем код для фронта (демо)
});

app.post('/api/verify-code', (req, res) => {
    const { email, code } = req.body;
    const recovery = readJson(RECOVERY_FILE);
    
    const record = recovery.find(r => 
        r.email === email && 
        r.code === code && 
        Date.now() < r.expires
    );
    
    if (record) {
        res.json({ success: true });
    } else {
        res.status(400).json({ error: '❌ Неверный или просроченный код' });
    }
});

// 📱 API ЧАТОВ

// Список чатов
app.get('/api/chats', (req, res) => {
    res.json(chats);
});

// Создать чат
app.post('/api/chats', (req, res) => {
    const { name, userId } = req.body;
    
    const chat = {
        id: Date.now().toString(),
        name,
        userId,
        created: new Date().toISOString(),
        lastMessage: '',
        lastTime: '',
        unread: 0,
        readStatus: '',
        pinned: false,
        members: [userId]
    };
    
    chats.push(chat);
    writeJson(CHATS_FILE, chats);
    
    console.log(`💬 Создан чат: ${chat.name}`);
    res.json(chat);
});

// Сообщения чата
app.get('/api/messages/:chatId', (req, res) => {
    const chatMessages = messages.filter(m => m.chatId === req.params.chatId);
    res.json(chatMessages.sort((a, b) => new Date(a.time) - new Date(b.time)));
});

// 🔥 SOCKET.IO - РЕАЛТАЙМ СООБЩЕНИЯ
io.on('connection', (socket) => {
    console.log(`👤 Подключение: ${socket.id}`);
    
    // Клиент присоединяется к своей комнате
    socket.on('join', (userId) => {
        socket.join(userId);
        console.log(`📡 ${userId} присоединился к комнате`);
    });
    
    // 💬 НОВОЕ СООБЩЕНИЕ
    socket.on('message', (data) => {
        const message = {
            id: Date.now().toString(),
            chatId: data.chatId,
            userId: data.userId,
            name: data.name,
            text: data.text,
            time: new Date().toISOString(),
            read: false
        };
        
        // Сохраняем сообщение
        messages.push(message);
        writeJson(MESSAGES_FILE, messages);
        
        // Обновляем чат (последнее сообщение)
        const chat = chats.find(c => c.id === data.chatId);
        if (chat) {
            chat.lastMessage = data.text.substring(0, 50);
            chat.lastTime = new Date().toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'});
            writeJson(CHATS_FILE, chats);
        }
        
        // ✅ ОТПРАВЛЯЕМ ВСЕМ в чате
        io.emit('message', message);
        io.emit('chats'); // Обновляем списки чатов
        
        console.log(`💬 [${data.chatId}] ${data.name}: ${data.text}`);
    });
    
    // ❌ ОТКЛЮЧЕНИЕ
    socket.on('disconnect', () => {
        console.log(`👋 Отключился: ${socket.id}`);
    });
});

// 🟢 ЗАПУСК СЕРВЕРА
server.listen(PORT, () => {
    console.log(`\n🎉 ZHURAVLEV TELEGRAM PRO v17.0`);
    console.log(`📡 Сервер: http://localhost:${PORT}`);
    console.log(`✅ Railway: http://localhost:${PORT}/health`);
    console.log(`📊 База: ${DATA_DIR}/`);
    console.log(`👥 Пользователей: ${users.length}`);
    console.log(`💬 Чатов: ${chats.length}`);
    console.log(`📨 Сообщений: ${messages.length}`);
    console.log(`\n🚀 Готов к деплою! npm start`);
});
