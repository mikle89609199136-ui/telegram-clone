"use strict";

/* ==========================================================
   DATA LAYER
   File-based persistence + in-memory index
========================================================== */

const fs = require("fs");
const path = require("path");

const DB_PATH = path.join(__dirname, "database.json");

/* ==========================================================
   INITIAL STRUCTURE
========================================================== */

let db = {
    users: [],
    devices: {},          // userId -> [devices]
    refreshTokens: {},    // userId -> { deviceId: token }
    chats: [],
    messages: {},         // chatId -> [messages]
    aiLogs: [],
    moderationLogs: []
};

/* ==========================================================
   INIT
========================================================== */

function init() {
    if (fs.existsSync(DB_PATH)) {
        const raw = fs.readFileSync(DB_PATH);
        db = JSON.parse(raw);
    } else {
        persist();
    }
}

function persist() {
    const tempPath = DB_PATH + ".tmp";
    fs.writeFileSync(tempPath, JSON.stringify(db, null, 2));
    fs.renameSync(tempPath, DB_PATH);
}

init();

/* ==========================================================
   USER SECTION
========================================================== */

async function createUser(user) {
    db.users.push(user);
    db.devices[user.id] = [];
    db.refreshTokens[user.id] = {};
    persist();
    return user;
}

async function findUserByEmail(email) {
    return db.users.find(u => u.email === email);
}

async function findUserById(id) {
    return db.users.find(u => u.id === id);
}

async function getAllUsers() {
    return db.users;
}

/* ==========================================================
   DEVICE SECTION
========================================================== */

async function attachDevice(userId, deviceId) {
    if (!db.devices[userId])
        db.devices[userId] = [];

    if (!db.devices[userId].includes(deviceId))
        db.devices[userId].push(deviceId);

    persist();
}

async function removeDevice(userId, deviceId) {
    if (!db.devices[userId]) return;

    db.devices[userId] =
        db.devices[userId].filter(d => d !== deviceId);

    if (db.refreshTokens[userId])
        delete db.refreshTokens[userId][deviceId];

    persist();
}

async function removeAllDevices(userId) {
    db.devices[userId] = [];
    db.refreshTokens[userId] = {};
    persist();
}

async function getUserDevices(userId) {
    return db.devices[userId] || [];
}

/* ==========================================================
   REFRESH TOKENS
========================================================== */

async function saveRefreshToken(userId, deviceId, token) {
    if (!db.refreshTokens[userId])
        db.refreshTokens[userId] = {};

    db.refreshTokens[userId][deviceId] = token;
    persist();
}

async function getRefreshToken(userId, deviceId) {
    return db.refreshTokens[userId]
        ? db.refreshTokens[userId][deviceId]
        : null;
}

/* ==========================================================
   CHAT SECTION
========================================================== */

async function createChat(chat) {
    db.chats.push(chat);
    db.messages[chat.id] = [];
    persist();
    return chat;
}

async function getChatById(chatId) {
    return db.chats.find(c => c.id === chatId);
}

async function getUserChats(userId) {
    return db.chats.filter(c =>
        c.members.includes(userId)
    );
}

async function deleteChat(chatId) {
    db.chats = db.chats.filter(c => c.id !== chatId);
    delete db.messages[chatId];
    persist();
}

/* ==========================================================
   MESSAGE SECTION
========================================================== */

async function addMessage(chatId, message) {
    if (!db.messages[chatId])
        db.messages[chatId] = [];

    db.messages[chatId].push(message);
    persist();
    return message;
}
20:48
async function getMessages(chatId, limit = 100) {
    const msgs = db.messages[chatId] || [];
    return msgs.slice(-limit);
}

async function deleteMessage(chatId, messageId) {
    if (!db.messages[chatId]) return;

    db.messages[chatId] =
        db.messages[chatId].filter(m => m.id !== messageId);

    persist();
}

async function editMessage(chatId, messageId, newText) {
    const msgs = db.messages[chatId];
    if (!msgs) return;

    const msg = msgs.find(m => m.id === messageId);
    if (msg) {
        msg.text = newText;
        msg.edited = true;
        persist();
    }
}

/* ==========================================================
   FULL SYNC
========================================================== */

async function fullSync(userId) {
    const chats = await getUserChats(userId);

    return chats.map(chat => ({
        ...chat,
        messages: db.messages[chat.id] || []
    }));
}

/* ==========================================================
   AI LOGGING
========================================================== */

async function logAI(entry) {
    db.aiLogs.push({
        ...entry,
        createdAt: Date.now()
    });
    persist();
}

async function getAILogs() {
    return db.aiLogs;
}

/* ==========================================================
   MODERATION
========================================================== */

async function logModeration(action) {
    db.moderationLogs.push({
        ...action,
        createdAt: Date.now()
    });
    persist();
}

async function getModerationLogs() {
    return db.moderationLogs;
}

/* ==========================================================
   ADMIN
========================================================== */

async function setUserRole(userId, role) {
    const user = await findUserById(userId);
    if (!user) return;
    user.role = role;
    persist();
}

/* ==========================================================
   EXPORT
========================================================== */

module.exports = {
    createUser,
    findUserByEmail,
    findUserById,
    getAllUsers,

    attachDevice,
    removeDevice,
    removeAllDevices,
    getUserDevices,

    saveRefreshToken,
    getRefreshToken,

    createChat,
    getChatById,
    getUserChats,
    deleteChat,

    addMessage,
    getMessages,
    deleteMessage,
    editMessage,

    fullSync,

    logAI,
    getAILogs,

    logModeration,
    getModerationLogs,

    setUserRole
};
