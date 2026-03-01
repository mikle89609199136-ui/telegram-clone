// Хранилище в памяти (при перезапуске данные теряются)
let users = [];
let chats = [];
let messages = {};
let publicChats = [];

function addUser(user) {
  users.push(user);
  return user;
}

function findUserByUsername(username) {
  return users.find(u => u.username === username);
}

function findUserById(id) {
  return users.find(u => u.id === id);
}

function getAllUsers() {
  return users.map(u => ({ id: u.id, name: u.name, username: u.username, avatar: u.avatar }));
}

function addChat(chat) {
  chats.push(chat);
  if (chat.public) {
    publicChats.push({
      id: chat.id,
      type: chat.type,
      name: chat.name,
      avatar: chat.avatar,
      description: chat.description,
      participants: chat.participants,
      owner: chat.owner
    });
  }
  messages[chat.id] = [];
  return chat;
}

function getChatsForUser(userId) {
  return chats.filter(c => c.participants.includes(userId));
}

function getPublicChats() {
  return publicChats;
}

function addMessage(chatId, message) {
  if (!messages[chatId]) messages[chatId] = [];
  messages[chatId].push(message);
  const chat = chats.find(c => c.id === chatId);
  if (chat) {
    chat.lastMessage = message.content.length > 30 ? message.content.slice(0,30)+'…' : message.content;
    chat.lastTime = message.time;
  }
  return message;
}

function getMessages(chatId) {
  return messages[chatId] || [];
}

module.exports = {
  users,
  chats,
  messages,
  publicChats,
  addUser,
  findUserByUsername,
  findUserById,
  getAllUsers,
  addChat,
  getChatsForUser,
  getPublicChats,
  addMessage,
  getMessages
};
