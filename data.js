// data.js
const fs = require('fs-extra');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const DATA_DIR = path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const CHATS_FILE = path.join(DATA_DIR, 'chats.json');
const MESSAGES_FILE = path.join(DATA_DIR, 'messages.json');

// Гарантируем, что папка data существует
fs.ensureDirSync(DATA_DIR);

// Инициализация файлов, если их нет
const initFile = (file, defaultData) => {
  if (!fs.existsSync(file)) {
    fs.writeJsonSync(file, defaultData, { spaces: 2 });
  }
};
initFile(USERS_FILE, {});
initFile(CHATS_FILE, {});
initFile(MESSAGES_FILE, {});

// ==================== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ====================
const readJSON = (file) => fs.readJsonSync(file);
const writeJSON = (file, data) => fs.writeJsonSync(file, data, { spaces: 2 });

// ==================== ПОЛЬЗОВАТЕЛИ ====================
function addUser(user) {
  const users = readJSON(USERS_FILE);
  // Генерируем уникальный числовой ID, как в Telegram
  const userId = Date.now() + Math.floor(Math.random() * 1000);
  const newUser = { 
    ...user, 
    id: userId, 
    password: user.password, // уже захеширован
    createdAt: new Date().toISOString(),
    lastSeen: new Date().toISOString(),
    status: 'online',
    avatar: user.avatar || '👤',
    bio: '',
    phone: ''
  };
  users[userId] = newUser;
  writeJSON(USERS_FILE, users);
  return newUser;
}

function findUserByUsername(username) {
  const users = readJSON(USERS_FILE);
  return Object.values(users).find(u => u.username === username);
}

function findUserById(id) {
  const users = readJSON(USERS_FILE);
  return users[id];
}

function getAllUsers() {
  const users = readJSON(USERS_FILE);
  return Object.values(users).map(u => ({
    id: u.id,
    name: u.name,
    username: u.username,
    avatar: u.avatar,
    bio: u.bio,
    lastSeen: u.lastSeen,
    status: u.status
  }));
}

function updateUser(id, updates) {
  const users = readJSON(USERS_FILE);
  if (users[id]) {
    users[id] = { ...users[id], ...updates };
    writeJSON(USERS_FILE, users);
  }
  return users[id];
}

// ==================== ЧАТЫ ====================
function addChat(chat) {
  const chats = readJSON(CHATS_FILE);
  const chatId = chat.id || `chat_${uuidv4()}`;
  const newChat = {
    ...chat,
    id: chatId,
    createdAt: new Date().toISOString(),
    participants: [...new Set([chat.owner, ...(chat.participants || [])])], // Уникальные участники
    admins: chat.admins || [chat.owner],
    permissions: chat.permissions || {},
    banned: [],
    pinnedMessages: [],
    lastMessage: chat.lastMessage || null,
    lastMessageTime: chat.lastMessageTime || Date.now()
  };
  chats[chatId] = newChat;
  writeJSON(CHATS_FILE, chats);
  return newChat;
}

function getChatsForUser(userId) {
  const chats = readJSON(CHATS_FILE);
  return Object.values(chats).filter(c => c.participants.includes(userId));
}

function getChatById(chatId) {
  const chats = readJSON(CHATS_FILE);
  return chats[chatId];
}

function updateChat(chatId, updates) {
  const chats = readJSON(CHATS_FILE);
  if (chats[chatId]) {
    chats[chatId] = { ...chats[chatId], ...updates };
    writeJSON(CHATS_FILE, chats);
  }
  return chats[chatId];
}

// ==================== СООБЩЕНИЯ ====================
function addMessage(chatId, message) {
  const messages = readJSON(MESSAGES_FILE);
  if (!messages[chatId]) messages[chatId] = [];
  
  const newMsg = {
    ...message,
    id: message.id || `msg_${uuidv4()}`,
    chatId: chatId,
    time: message.time || Date.now(),
    reactions: message.reactions || {},
    replyTo: message.replyTo || null,
    edited: false
  };
  messages[chatId].push(newMsg);
  writeJSON(MESSAGES_FILE, messages);
  
  // Обновляем lastMessage в чате
  updateChat(chatId, {
    lastMessage: newMsg.content || (newMsg.type === 'poll' ? '📊 Опрос' : '📎 Медиа'),
    lastMessageTime: newMsg.time
  });
  
  return newMsg;
}

function getMessages(chatId, limit = 50, before = null) {
  const messages = readJSON(MESSAGES_FILE);
  let msgs = messages[chatId] || [];
  // Сортируем по времени (от новых к старым)
  msgs.sort((a, b) => b.time - a.time);
  if (before) {
    msgs = msgs.filter(m => m.time < before);
  }
  return msgs.slice(0, limit);
}

// Экспортируем все новые функции
module.exports = {
  addUser,
  findUserByUsername,
  findUserById,
  getAllUsers,
  updateUser,
  addChat,
  getChatsForUser,
  getChatById,
  updateChat,
  addMessage,
  getMessages
};
