// Хранилище данных в памяти (при перезапуске всё сбрасывается)
let users = [];           // массив объектов { id, username, password, name, avatar, birthday, phone }
let chats = [];           // массив объектов { id, type, name, avatar, participants, lastMessage, lastTime, unread, pinned, description, privacy, public, link, owner, admins, permissions, banned }
let messages = {};        // объект: { [chatId]: [ { id, senderId, content, time, type, fileName, reactions, pollQuestion, pollOptions, pollMultiple, pollQuiz } ] }
let publicChats = [];     // копии публичных чатов для глобального поиска

// Функции для работы с данными
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
  // Обновляем lastMessage и lastTime в чате
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
