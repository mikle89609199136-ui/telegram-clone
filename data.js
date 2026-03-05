// In‑memory data store with JSON persistence (optional)
const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, 'data.json');

// Initial data structure
let data = {
  users: [],
  chats: [],
  messages: [],
  channels: [],
  bots: [],
  twoFactorSecrets: new Map()
};

// Load from file if exists
if (fs.existsSync(DATA_FILE)) {
  try {
    const raw = fs.readFileSync(DATA_FILE);
    const loaded = JSON.parse(raw);
    // Convert twoFactorSecrets back to Map
    loaded.twoFactorSecrets = new Map(loaded.twoFactorSecrets);
    data = loaded;
  } catch (e) {
    console.error('Failed to load data.json', e);
  }
}

function saveData() {
  const toSave = {
    ...data,
    twoFactorSecrets: Array.from(data.twoFactorSecrets.entries())
  };
  fs.writeFileSync(DATA_FILE, JSON.stringify(toSave, null, 2));
}

// Users
function findUserByUsername(username) {
  return data.users.find(u => u.username === username);
}
function findUserById(id) {
  return data.users.find(u => u.id === id);
}
function createUser(user) {
  data.users.push(user);
  saveData();
  return user;
}
function getAllUsers() {
  return data.users.map(({ passwordHash, ...rest }) => rest);
}
function updateUser(userId, updates) {
  const user = findUserById(userId);
  if (user) Object.assign(user, updates);
  saveData();
  return user;
}

// 2FA
function setTwoFactorSecret(userId, secret) {
  data.twoFactorSecrets.set(userId, secret);
  saveData();
}
function getTwoFactorSecret(userId) {
  return data.twoFactorSecrets.get(userId);
}
function enableTwoFactor(userId) {
  const user = findUserById(userId);
  if (user) user.twoFactorEnabled = true;
  saveData();
}
function disableTwoFactor(userId) {
  const user = findUserById(userId);
  if (user) user.twoFactorEnabled = false;
  saveData();
}

// Chats
function createChat(chat) {
  chat.id = require('uuid').v4();
  chat.createdAt = new Date().toISOString();
  chat.pinnedMessageIds = chat.pinnedMessageIds || [];
  chat.muted = false;
  chat.archived = false;
  data.chats.push(chat);
  saveData();
  return chat;
}
function getChatsForUser(userId) {
  return data.chats.filter(c => c.participants.includes(userId) && !c.archived).map(c => ({
    ...c,
    lastMessage: data.messages.filter(m => m.chatId === c.id).sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt))[0] || null
  }));
}
function getChatById(chatId) {
  return data.chats.find(c => c.id === chatId);
}
function muteChat(chatId, userId) {
  const chat = getChatById(chatId);
  if (chat && chat.participants.includes(userId)) chat.muted = true;
  saveData();
}
function unmuteChat(chatId, userId) {
  const chat = getChatById(chatId);
  if (chat && chat.participants.includes(userId)) chat.muted = false;
  saveData();
}
function archiveChat(chatId, userId) {
  const chat = getChatById(chatId);
  if (chat && chat.participants.includes(userId)) chat.archived = true;
  saveData();
}

// Groups
function addParticipantToGroup(chatId, adminId, newParticipantId) {
  const chat = getChatById(chatId);
  if (chat && chat.type === 'group' && chat.adminIds.includes(adminId) && !chat.participants.includes(newParticipantId)) {
    chat.participants.push(newParticipantId);
    saveData();
  }
}
function removeParticipantFromGroup(chatId, adminId, targetId) {
  const chat = getChatById(chatId);
  if (chat && chat.type === 'group' && chat.adminIds.includes(adminId)) {
    chat.participants = chat.participants.filter(id => id !== targetId);
    chat.adminIds = chat.adminIds.filter(id => id !== targetId);
    saveData();
  }
}
function promoteToAdmin(chatId, adminId, targetId) {
  const chat = getChatById(chatId);
  if (chat && chat.type === 'group' && chat.adminIds.includes(adminId) && chat.participants.includes(targetId) && !chat.adminIds.includes(targetId)) {
    chat.adminIds.push(targetId);
    saveData();
  }
}

// Channels
function createChannel(channel) {
  channel.id = require('uuid').v4();
  channel.createdAt = new Date().toISOString();
  channel.subscribers = [];
  channel.admins = [channel.creatorId];
  channel.posts = [];
  data.channels.push(channel);
  saveData();
  return channel;
}
function getChannelById(channelId) {
  return data.channels.find(c => c.id === channelId);
}
function subscribeToChannel(channelId, userId) {
  const channel = getChannelById(channelId);
  if (channel && !channel.subscribers.includes(userId)) {
    channel.subscribers.push(userId);
    saveData();
  }
}
function unsubscribeFromChannel(channelId, userId) {
  const channel = getChannelById(channelId);
  if (channel) {
    channel.subscribers = channel.subscribers.filter(id => id !== userId);
    saveData();
  }
}
function createChannelPost(channelId, adminId, content, mediaUrl) {
  const channel = getChannelById(channelId);
  if (channel && channel.admins.includes(adminId)) {
    const post = {
      id: require('uuid').v4(),
      channelId,
      adminId,
      content,
      mediaUrl,
      createdAt: new Date().toISOString(),
      views: 0
    };
    channel.posts.push(post);
    saveData();
    return post;
  }
  return null;
}

// Bots
function createBot(bot) {
  bot.id = require('uuid').v4();
  bot.token = require('crypto').randomBytes(32).toString('hex');
  bot.createdAt = new Date().toISOString();
  data.bots.push(bot);
  saveData();
  return bot;
}
function getBotById(botId) {
  return data.bots.find(b => b.id === botId);
}
function getBotsByOwner(ownerId) {
  return data.bots.filter(b => b.ownerId === ownerId);
}

// Messages
function createMessage(message) {
  message.id = require('uuid').v4();
  message.createdAt = new Date().toISOString();
  message.updatedAt = message.createdAt;
  message.reactions = message.reactions || {};
  message.deleted = false;
  message.edited = false;
  message.views = 0;
  data.messages.push(message);
  saveData();
  return message;
}
function getMessagesForChat(chatId) {
  return data.messages.filter(m => m.chatId === chatId && !m.deleted).sort((a,b) => new Date(a.createdAt) - new Date(b.createdAt));
}
function getMessageById(messageId) {
  return data.messages.find(m => m.id === messageId);
}
function updateMessage(messageId, updates) {
  const msg = getMessageById(messageId);
  if (msg) {
    Object.assign(msg, updates);
    msg.updatedAt = new Date().toISOString();
    msg.edited = true;
    saveData();
  }
  return msg;
}
function deleteMessage(messageId) {
  const msg = getMessageById(messageId);
  if (msg) {
    msg.deleted = true;
    saveData();
  }
  return msg;
}
function addReaction(messageId, userId, emoji) {
  const msg = getMessageById(messageId);
  if (msg) {
    if (!msg.reactions[emoji]) msg.reactions[emoji] = [];
    if (!msg.reactions[emoji].includes(userId)) {
      msg.reactions[emoji].push(userId);
      saveData();
    }
  }
}
function removeReaction(messageId, userId, emoji) {
  const msg = getMessageById(messageId);
  if (msg && msg.reactions[emoji]) {
    msg.reactions[emoji] = msg.reactions[emoji].filter(id => id !== userId);
    if (msg.reactions[emoji].length === 0) delete msg.reactions[emoji];
    saveData();
  }
}
function pinMessage(chatId, messageId) {
  const chat = getChatById(chatId);
  if (chat && !chat.pinnedMessageIds.includes(messageId)) {
    chat.pinnedMessageIds.push(messageId);
    saveData();
  }
}
function unpinMessage(chatId, messageId) {
  const chat = getChatById(chatId);
  if (chat) {
    chat.pinnedMessageIds = chat.pinnedMessageIds.filter(id => id !== messageId);
    saveData();
  }
}

module.exports = {
  users: data.users,
  chats: data.chats,
  messages: data.messages,
  channels: data.channels,
  bots: data.bots,
  twoFactorSecrets: data.twoFactorSecrets,
  findUserByUsername,
  findUserById,
  createUser,
  getAllUsers,
  updateUser,
  setTwoFactorSecret,
  getTwoFactorSecret,
  enableTwoFactor,
  disableTwoFactor,
  createChat,
  getChatsForUser,
  getChatById,
  muteChat,
  unmuteChat,
  archiveChat,
  addParticipantToGroup,
  removeParticipantFromGroup,
  promoteToAdmin,
  createChannel,
  getChannelById,
  subscribeToChannel,
  unsubscribeFromChannel,
  createChannelPost,
  createBot,
  getBotById,
  getBotsByOwner,
  createMessage,
  getMessagesForChat,
  getMessageById,
  updateMessage,
  deleteMessage,
  addReaction,
  removeReaction,
  pinMessage,
  unpinMessage
};
