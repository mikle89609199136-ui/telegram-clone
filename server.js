const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const multer = require('multer');
const sharp = require('sharp');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});

// ==================== КОНФИГУРАЦИЯ ====================
const JWT_SECRET = 'telegram-pro-super-secret-key-2026';
const SALT_ROUNDS = 10;
const PORT = process.env.PORT || 3000;

// Настройка почты (ЗАМЕНИТЕ НА СВОИ ДАННЫЕ)
const EMAIL_USER = 'your-email@gmail.com';
const EMAIL_PASS = 'your-app-password';

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: EMAIL_USER,
        pass: EMAIL_PASS
    }
});

// ==================== ДИРЕКТОРИИ ====================
const DATA_DIR = path.join(__dirname, 'data');
const UPLOADS_DIR = path.join(__dirname, 'uploads');
const AVATARS_DIR = path.join(UPLOADS_DIR, 'avatars');
const FILES_DIR = path.join(UPLOADS_DIR, 'files');

[DATA_DIR, UPLOADS_DIR, AVATARS_DIR, FILES_DIR].forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// ==================== ФАЙЛЫ ДАННЫХ ====================
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const CHATS_FILE = path.join(DATA_DIR, 'chats.json');
const GROUPS_FILE = path.join(DATA_DIR, 'groups.json');
const CODES_FILE = path.join(DATA_DIR, 'codes.json');

// ==================== ФУНКЦИИ ЗАГРУЗКИ/СОХРАНЕНИЯ ====================
function loadJSON(file, defaultData = {}) {
    try {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
        return defaultData;
    }
}

function saveJSON(file, data) {
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

// Загружаем все данные
let usersDB = loadJSON(USERS_FILE, {});
let privateChats = loadJSON(CHATS_FILE, {});
let groupsDB = loadJSON(GROUPS_FILE, {});
let resetCodesDB = loadJSON(CODES_FILE, {});

// ==================== ВСПОМОГАТЕЛЬНЫЕ ДАННЫЕ ====================
const onlineUsers = new Set();
const rateLimits = new Map();
const userSockets = new Map(); // userId -> socketId

// ==================== ФУНКЦИИ ====================
function generateUserId() {
    return 'user_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

function generateChatId(userId1, userId2) {
    return [userId1, userId2].sort().join('_');
}

function generateGroupId() {
    return 'group_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

function generateMessageId() {
    return 'msg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
}

function generateResetCode() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

function checkRate(userId) {
    const now = Date.now();
    const data = rateLimits.get(userId) || { count: 0, reset: now };
    if (now - data.reset > 60000) {
        data.count = 0;
        data.reset = now;
    }
    if (data.count > 60) return false;
    data.count++;
    rateLimits.set(userId, data);
    return true;
}

// ==================== MIDDLEWARE ====================
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use('/uploads', express.static(UPLOADS_DIR));
app.use(express.static('public'));

// Middleware для проверки JWT
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: 'Требуется авторизация' });
    }

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ error: 'Недействительный токен' });
        }
        req.user = user;
        next();
    });
}

// ==================== НАСТРОЙКИ MULTER ====================
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        if (file.fieldname === 'avatar') {
            cb(null, AVATARS_DIR);
        } else {
            cb(null, FILES_DIR);
        }
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({
    storage: storage,
    limits: { fileSize: 50 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (file.fieldname === 'avatar') {
            if (!file.mimetype.startsWith('image/')) {
                return cb(new Error('Только изображения'));
            }
        }
        cb(null, true);
    }
});

// ==================== API РОУТЫ ====================

// Регистрация
app.post('/api/register', async (req, res) => {
    try {
        const { email, username, password, confirmPassword } = req.body;

        if (!email || !email.includes('@')) {
            return res.status(400).json({ error: 'Введите корректный email' });
        }
        if (!username || username.length < 3) {
            return res.status(400).json({ error: 'Юзернейм минимум 3 символа' });
        }
        if (password !== confirmPassword) {
            return res.status(400).json({ error: 'Пароли не совпадают' });
        }
        if (password.length < 6) {
            return res.status(400).json({ error: 'Пароль минимум 6 символов' });
        }

        const cleanUsername = username.replace('@', '').toLowerCase();
        const cleanEmail = email.toLowerCase();

        const emailExists = Object.values(usersDB).some(u => u.email === cleanEmail);
        const usernameExists = Object.values(usersDB).some(u => u.username === cleanUsername);

        if (emailExists) {
            return res.status(400).json({ error: 'Email уже зарегистрирован' });
        }
        if (usernameExists) {
            return res.status(400).json({ error: 'Юзернейм уже занят' });
        }

        const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);
        const userId = generateUserId();

        const newUser = {
            id: userId,
            email: cleanEmail,
            username: cleanUsername,
            name: username,
            avatar: '',
            avatarColor: '#' + Math.floor(Math.random()*16777215).toString(16),
            password: hashedPassword,
            phone: '',
            bio: '',
            created: new Date().toISOString(),
            lastSeen: null,
            online: false,
            settings: {
                notifications: true,
                sound: true,
                theme: 'light',
                language: 'ru',
                privacy: {
                    lastSeen: 'everyone',
                    avatar: 'everyone',
                    phone: 'nobody'
                }
            },
            folders: [],
            pinned: [],
            blocked: []
        };

        usersDB[cleanEmail] = newUser;
        saveJSON(USERS_FILE, usersDB);

        const token = jwt.sign(
            { id: userId, email: cleanEmail, username: cleanUsername },
            JWT_SECRET,
            { expiresIn: '365d' }
        );

        res.json({
            success: true,
            token,
            user: {
                id: userId,
                email: cleanEmail,
                username: cleanUsername,
                name: username,
                avatar: '',
                avatarColor: newUser.avatarColor
            }
        });

    } catch (error) {
        console.error('Register error:', error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Вход
app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;

        let user = null;
        for (let email in usersDB) {
            if (usersDB[email].username === username.toLowerCase() || usersDB[email].email === username.toLowerCase()) {
                user = usersDB[email];
                break;
            }
        }

        if (!user) {
            return res.status(401).json({ error: 'Неверный логин или пароль' });
        }

        const validPassword = await bcrypt.compare(password, user.password);
        if (!validPassword) {
            return res.status(401).json({ error: 'Неверный логин или пароль' });
        }

        user.online = true;
        user.lastSeen = new Date().toISOString();
        saveJSON(USERS_FILE, usersDB);

        const token = jwt.sign(
            { id: user.id, email: user.email, username: user.username },
            JWT_SECRET,
            { expiresIn: '365d' }
        );

        res.json({
            success: true,
            token,
            user: {
                id: user.id,
                email: user.email,
                username: user.username,
                name: user.name,
                avatar: user.avatar,
                avatarColor: user.avatarColor
            }
        });

    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Получить всех пользователей (кроме себя)
app.get('/api/users', authenticateToken, (req, res) => {
    try {
        const users = Object.values(usersDB)
            .filter(u => u.id !== req.user.id)
            .map(u => ({
                id: u.id,
                name: u.name,
                username: u.username,
                avatar: u.avatar,
                avatarColor: u.avatarColor,
                online: onlineUsers.has(u.id),
                lastSeen: u.lastSeen,
                bio: u.bio
            }));

        res.json(users);

    } catch (error) {
        console.error('Get users error:', error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Получить чаты пользователя
app.get('/api/chats', authenticateToken, (req, res) => {
    try {
        const userId = req.user.id;
        const chats = [];

        // Личные чаты
        for (let chatId in privateChats) {
            if (chatId.includes(userId)) {
                const messages = privateChats[chatId] || [];
                const lastMsg = messages[messages.length - 1];
                const participants = chatId.split('_');
                const otherId = participants.find(id => id !== userId);
                const otherUser = Object.values(usersDB).find(u => u.id === otherId);

                if (otherUser) {
                    const unreadCount = messages.filter(m => m.to === userId && !m.read).length;

                    chats.push({
                        id: chatId,
                        type: 'private',
                        userId: otherUser.id,
                        name: otherUser.name,
                        username: otherUser.username,
                        avatar: otherUser.avatar,
                        avatarColor: otherUser.avatarColor,
                        online: onlineUsers.has(otherUser.id),
                        lastMessage: lastMsg ? {
                            id: lastMsg.id,
                            text: lastMsg.text,
                            time: lastMsg.time,
                            from: lastMsg.from,
                            read: lastMsg.read
                        } : null,
                        unread: unreadCount
                    });
                }
            }
        }

        // Групповые чаты
        for (let groupId in groupsDB) {
            const group = groupsDB[groupId];
            if (group.members.includes(userId)) {
                const lastMsg = group.messages ? group.messages[group.messages.length - 1] : null;
                const unreadCount = group.messages ? group.messages.filter(m => !m.readBy?.includes(userId)).length : 0;

                chats.push({
                    id: groupId,
                    type: 'group',
                    name: group.name,
                    avatar: group.avatar,
                    avatarColor: group.avatarColor,
                    members: group.members.length,
                    lastMessage: lastMsg ? {
                        id: lastMsg.id,
                        text: lastMsg.text,
                        time: lastMsg.time,
                        from: lastMsg.from,
                        fromName: lastMsg.fromName
                    } : null,
                    unread: unreadCount
                });
            }
        }

        chats.sort((a, b) => {
            const timeA = a.lastMessage ? new Date(a.lastMessage.time) : 0;
            const timeB = b.lastMessage ? new Date(b.lastMessage.time) : 0;
            return timeB - timeA;
        });

        res.json(chats);

    } catch (error) {
        console.error('Get chats error:', error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Получить сообщения чата
app.get('/api/messages/:chatId', authenticateToken, (req, res) => {
    try {
        const userId = req.user.id;
        const { chatId } = req.params;
        let messages = [];

        if (chatId.includes('_')) {
            // Личный чат
            messages = privateChats[chatId] || [];

            if (privateChats[chatId]) {
                privateChats[chatId].forEach(msg => {
                    if (msg.to === userId) {
                        msg.read = true;
                    }
                });
                saveJSON(CHATS_FILE, privateChats);
            }

            messages = messages.map(msg => {
                const fromUser = Object.values(usersDB).find(u => u.id === msg.from);
                return {
                    ...msg,
                    fromName: fromUser ? fromUser.name : 'Пользователь',
                    fromAvatar: fromUser ? fromUser.avatar : '',
                    fromAvatarColor: fromUser ? fromUser.avatarColor : '#0088cc'
                };
            });

        } else if (chatId.startsWith('group_')) {
            // Групповой чат
            const group = groupsDB[chatId];
            if (group && group.members.includes(userId)) {
                messages = group.messages || [];

                if (group.messages) {
                    group.messages.forEach(msg => {
                        if (!msg.readBy) msg.readBy = [];
                        if (!msg.readBy.includes(userId)) {
                            msg.readBy.push(userId);
                        }
                    });
                    saveJSON(GROUPS_FILE, groupsDB);
                }

                messages = messages.map(msg => {
                    const fromUser = Object.values(usersDB).find(u => u.id === msg.from);
                    return {
                        ...msg,
                        fromName: fromUser ? fromUser.name : 'Пользователь',
                        fromAvatar: fromUser ? fromUser.avatar : '',
                        fromAvatarColor: fromUser ? fromUser.avatarColor : '#0088cc'
                    };
                });
            }
        }

        res.json(messages);

    } catch (error) {
        console.error('Get messages error:', error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Получить информацию о пользователе
app.get('/api/user/:userId', authenticateToken, (req, res) => {
    try {
        const { userId } = req.params;
        const user = Object.values(usersDB).find(u => u.id === userId);

        if (!user) {
            return res.status(404).json({ error: 'Пользователь не найден' });
        }

        res.json({
            id: user.id,
            name: user.name,
            username: user.username,
            avatar: user.avatar,
            avatarColor: user.avatarColor,
            online: onlineUsers.has(user.id),
            lastSeen: user.lastSeen,
            bio: user.bio,
            phone: user.settings.privacy.phone === 'everyone' ? user.phone : null,
            commonChats: []
        });

    } catch (error) {
        console.error('Get user error:', error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Обновить профиль
app.put('/api/user/profile', authenticateToken, upload.single('avatar'), async (req, res) => {
    try {
        const userId = req.user.id;
        const { name, bio, phone } = req.body;

        const user = Object.values(usersDB).find(u => u.id === userId);
        if (!user) {
            return res.status(404).json({ error: 'Пользователь не найден' });
        }

        if (name) user.name = name;
        if (bio !== undefined) user.bio = bio;
        if (phone !== undefined) user.phone = phone;

        if (req.file) {
            const avatarPath = req.file.path;
            const processedAvatarPath = path.join(AVATARS_DIR, `processed_${req.file.filename}`);

            await sharp(avatarPath)
                .resize(200, 200, { fit: 'cover' })
                .jpeg({ quality: 80 })
                .toFile(processedAvatarPath);

            user.avatar = `/uploads/avatars/processed_${req.file.filename}`;
        }

        saveJSON(USERS_FILE, usersDB);

        res.json({
            success: true,
            user: {
                id: user.id,
                name: user.name,
                username: user.username,
                avatar: user.avatar,
                avatarColor: user.avatarColor,
                bio: user.bio,
                phone: user.phone
            }
        });

    } catch (error) {
        console.error('Update profile error:', error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Обновить настройки
app.put('/api/user/settings', authenticateToken, (req, res) => {
    try {
        const userId = req.user.id;
        const { notifications, sound, theme, language, privacy } = req.body;

        const user = Object.values(usersDB).find(u => u.id === userId);
        if (!user) {
            return res.status(404).json({ error: 'Пользователь не найден' });
        }

        if (notifications !== undefined) user.settings.notifications = notifications;
        if (sound !== undefined) user.settings.sound = sound;
        if (theme !== undefined) user.settings.theme = theme;
        if (language !== undefined) user.settings.language = language;
        if (privacy) {
            if (privacy.lastSeen) user.settings.privacy.lastSeen = privacy.lastSeen;
            if (privacy.avatar) user.settings.privacy.avatar = privacy.avatar;
            if (privacy.phone) user.settings.privacy.phone = privacy.phone;
        }

        saveJSON(USERS_FILE, usersDB);

        res.json({
            success: true,
            settings: user.settings
        });

    } catch (error) {
        console.error('Update settings error:', error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Смена пароля (авторизованный)
app.post('/api/change-password', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;
        const { oldPassword, newPassword, confirmPassword } = req.body;

        const user = Object.values(usersDB).find(u => u.id === userId);
        if (!user) {
            return res.status(404).json({ error: 'Пользователь не найден' });
        }

        const validPassword = await bcrypt.compare(oldPassword, user.password);
        if (!validPassword) {
            return res.status(400).json({ error: 'Неверный старый пароль' });
        }

        if (newPassword !== confirmPassword) {
            return res.status(400).json({ error: 'Пароли не совпадают' });
        }

        if (newPassword.length < 6) {
            return res.status(400).json({ error: 'Пароль минимум 6 символов' });
        }

        const hashedPassword = await bcrypt.hash(newPassword, SALT_ROUNDS);
        user.password = hashedPassword;
        saveJSON(USERS_FILE, usersDB);

        res.json({ success: true, message: 'Пароль успешно изменен' });

    } catch (error) {
        console.error('Change password error:', error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Отправка кода восстановления
app.post('/api/forgot-password', async (req, res) => {
    try {
        const { email } = req.body;

        if (!email || !email.includes('@')) {
            return res.status(400).json({ error: 'Введите корректный email' });
        }

        const user = usersDB[email.toLowerCase()];
        if (!user) {
            return res.status(404).json({ error: 'Пользователь не найден' });
        }

        const code = generateResetCode();
        const expiresAt = Date.now() + 10 * 60 * 1000;

        resetCodesDB[email.toLowerCase()] = {
            code,
            expiresAt,
            attempts: 0
        };
        saveJSON(CODES_FILE, resetCodesDB);

        try {
            await transporter.sendMail({
                from: EMAIL_USER,
                to: email,
                subject: 'Восстановление пароля - Telegram Pro',
                html: `
                    <h2>Восстановление пароля</h2>
                    <p>Ваш код подтверждения: <strong>${code}</strong></p>
                    <p>Код действителен 10 минут.</p>
                `
            });
            res.json({ success: true, message: 'Код отправлен на email' });
        } catch (emailError) {
            console.log(`📧 Код для ${email}: ${code}`);
            res.json({ success: true, message: 'Код отправлен (проверьте консоль)' });
        }

    } catch (error) {
        console.error('Forgot password error:', error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Проверка кода восстановления
app.post('/api/verify-code', (req, res) => {
    try {
        const { email, code } = req.body;

        const resetData = resetCodesDB[email.toLowerCase()];
        if (!resetData) {
            return res.status(400).json({ error: 'Код не найден' });
        }

        if (Date.now() > resetData.expiresAt) {
            delete resetCodesDB[email.toLowerCase()];
            saveJSON(CODES_FILE, resetCodesDB);
            return res.status(400).json({ error: 'Код истек' });
        }

        if (resetData.attempts >= 5) {
            delete resetCodesDB[email.toLowerCase()];
            saveJSON(CODES_FILE, resetCodesDB);
            return res.status(400).json({ error: 'Слишком много попыток' });
        }

        if (resetData.code !== code) {
            resetData.attempts++;
            saveJSON(CODES_FILE, resetCodesDB);
            return res.status(400).json({ error: 'Неверный код' });
        }

        res.json({ success: true });

    } catch (error) {
        console.error('Verify code error:', error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Смена пароля (неавторизованный)
app.post('/api/reset-password', async (req, res) => {
    try {
        const { email, newPassword, confirmPassword } = req.body;

        if (newPassword !== confirmPassword) {
            return res.status(400).json({ error: 'Пароли не совпадают' });
        }
        if (newPassword.length < 6) {
            return res.status(400).json({ error: 'Пароль минимум 6 символов' });
        }

        const user = usersDB[email.toLowerCase()];
        if (!user) {
            return res.status(404).json({ error: 'Пользователь не найден' });
        }

        const hashedPassword = await bcrypt.hash(newPassword, SALT_ROUNDS);
        user.password = hashedPassword;
        saveJSON(USERS_FILE, usersDB);

        delete resetCodesDB[email.toLowerCase()];
        saveJSON(CODES_FILE, resetCodesDB);

        res.json({ success: true, message: 'Пароль успешно изменен' });

    } catch (error) {
        console.error('Reset password error:', error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Загрузить файл
app.post('/api/upload', authenticateToken, upload.single('file'), (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'Файл не загружен' });
        }

        res.json({
            success: true,
            file: {
                filename: req.file.filename,
                originalName: req.file.originalname,
                path: `/uploads/files/${req.file.filename}`,
                size: req.file.size,
                mimetype: req.file.mimetype
            }
        });

    } catch (error) {
        console.error('Upload error:', error);
        res.status(500).json({ error: 'Ошибка загрузки файла' });
    }
});

// Создать группу
app.post('/api/groups', authenticateToken, (req, res) => {
    try {
        const userId = req.user.id;
        const { name, memberIds } = req.body;

        if (!name || name.length < 3) {
            return res.status(400).json({ error: 'Название группы минимум 3 символа' });
        }

        const members = [userId, ...(memberIds || [])];
        const groupId = generateGroupId();

        const newGroup = {
            id: groupId,
            name,
            avatar: '',
            avatarColor: '#' + Math.floor(Math.random()*16777215).toString(16),
            createdBy: userId,
            members,
            messages: [],
            created: new Date().toISOString()
        };

        groupsDB[groupId] = newGroup;
        saveJSON(GROUPS_FILE, groupsDB);

        res.json({
            success: true,
            group: {
                id: groupId,
                name,
                avatar: '',
                avatarColor: newGroup.avatarColor,
                members: members.length
            }
        });

    } catch (error) {
        console.error('Create group error:', error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// ==================== SOCKET.IO ====================
io.on('connection', (socket) => {
    console.log('🔌 Новое подключение:', socket.id);

    socket.on('join', (userId) => {
        socket.join(userId);
        socket.userId = userId;
        userSockets.set(userId, socket.id);
        onlineUsers.add(userId);

        const user = Object.values(usersDB).find(u => u.id === userId);
        if (user) {
            user.online = true;
            user.lastSeen = new Date().toISOString();
            saveJSON(USERS_FILE, usersDB);
        }

        io.emit('userOnline', { userId, lastSeen: new Date().toISOString() });
        console.log('✅ Пользователь онлайн:', userId);
    });

    socket.on('sendMessage', (data) => {
        try {
            if (!checkRate(data.from)) {
                socket.emit('error', 'Слишком много сообщений. Подождите минуту.');
                return;
            }

            const fromUser = Object.values(usersDB).find(u => u.id === data.from);
            if (!fromUser) return;

            const message = {
                id: generateMessageId(),
                from: data.from,
                fromName: fromUser.name,
                fromAvatar: fromUser.avatar,
                fromAvatarColor: fromUser.avatarColor,
                text: data.text.slice(0, 4000),
                time: new Date().toISOString(),
                read: false,
                edited: false
            };

            if (data.chatId) {
                if (data.chatId.includes('_')) {
                    // Личный чат
                    if (!privateChats[data.chatId]) {
                        privateChats[data.chatId] = [];
                    }
                    privateChats[data.chatId].push(message);
                    saveJSON(CHATS_FILE, privateChats);

                    const participants = data.chatId.split('_');
                    const toUser = participants.find(id => id !== data.from);
                    io.to(toUser).emit('newMessage', { chatId: data.chatId, message });

                } else if (data.chatId.startsWith('group_')) {
                    // Групповой чат
                    const group = groupsDB[data.chatId];
                    if (group && group.members.includes(data.from)) {
                        if (!group.messages) group.messages = [];
                        group.messages.push({
                            ...message,
                            readBy: [data.from]
                        });
                        saveJSON(GROUPS_FILE, groupsDB);

                        group.members.forEach(memberId => {
                            if (memberId !== data.from) {
                                io.to(memberId).emit('newMessage', { chatId: data.chatId, message });
                            }
                        });
                    }
                }

                socket.emit('messageSent', { chatId: data.chatId, message });

            } else {
                // Новый личный чат
                const chatId = generateChatId(data.from, data.to);
                if (!privateChats[chatId]) {
                    privateChats[chatId] = [];
                }
                privateChats[chatId].push(message);
                saveJSON(CHATS_FILE, privateChats);

                io.to(data.from).to(data.to).emit('newMessage', { chatId, message });
            }

        } catch (error) {
            console.error('Send message error:', error);
            socket.emit('error', 'Ошибка при отправке сообщения');
        }
    });

    socket.on('typing', (data) => {
        const { chatId, isTyping } = data;
        const participants = chatId.split('_');
        const toUser = participants.find(id => id !== socket.userId);
        if (toUser) {
            io.to(toUser).emit('userTyping', { chatId, userId: socket.userId, isTyping });
        }
    });

    socket.on('messagesRead', (data) => {
        try {
            const { chatId, messageIds } = data;

            if (chatId.includes('_')) {
                const chat = privateChats[chatId];
                if (chat) {
                    chat.forEach(msg => {
                        if (messageIds.includes(msg.id) && msg.to === socket.userId) {
                            msg.read = true;
                        }
                    });
                    saveJSON(CHATS_FILE, privateChats);
                }
            } else if (chatId.startsWith('group_')) {
                const group = groupsDB[chatId];
                if (group && group.messages) {
                    group.messages.forEach(msg => {
                        if (messageIds.includes(msg.id) && msg.from !== socket.userId) {
                            if (!msg.readBy) msg.readBy = [];
                            if (!msg.readBy.includes(socket.userId)) {
                                msg.readBy.push(socket.userId);
                            }
                        }
                    });
                    saveJSON(GROUPS_FILE, groupsDB);
                }
            }

            const participants = chatId.split('_');
            participants.forEach(userId => {
                if (userId !== socket.userId) {
                    io.to(userId).emit('messagesReadReceipt', { chatId, messageIds, userId: socket.userId });
                }
            });

        } catch (error) {
            console.error('Messages read error:', error);
        }
    });

    socket.on('disconnect', () => {
        if (socket.userId) {
            onlineUsers.delete(socket.userId);
            userSockets.delete(socket.userId);

            const user = Object.values(usersDB).find(u => u.id === socket.userId);
            if (user) {
                user.online = false;
                user.lastSeen = new Date().toISOString();
                saveJSON(USERS_FILE, usersDB);
            }

            io.emit('userOffline', { userId: socket.userId, lastSeen: new Date().toISOString() });
            console.log('🔌 Пользователь отключился:', socket.userId);
        }
    });
});

// ==================== ЗАПУСК СЕРВЕРА ====================
server.listen(PORT, '0.0.0.0', () => {
    console.log('\n' + '='.repeat(50));
    console.log('🚀 Telegram Pro v3.0 ✅ Запущен!');
    console.log('📱 Порт: ' + PORT);
    console.log('💾 Данные: ' + DATA_DIR);
    console.log('='.repeat(50) + '\n');
});
