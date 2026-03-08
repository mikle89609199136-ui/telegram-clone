// app.js — клиентская логика SPA

// ==================== ИНИЦИАЛИЗАЦИЯ ====================
const socket = io({
  auth: { token: localStorage.getItem('token') },
  reconnection: true,
  reconnectionAttempts: 5,
  reconnectionDelay: 1000,
});

let currentUser = null;
let currentChatId = null;
let chats = [];
let messages = [];
let contacts = [];
let folders = [];
let editMode = false;
let selectedItems = [];
let contextMessage = null;

// DOM элементы
let appEl;

document.addEventListener('DOMContentLoaded', async () => {
  appEl = document.getElementById('app');
  const token = localStorage.getItem('token');

  if (!token && window.location.pathname !== '/') {
    window.location.href = '/';
    return;
  }

  if (token) {
    try {
      await loadUser();
      await loadChats();
      await loadContacts();
      await loadFolders();
      renderMainLayout();
      setupSocket();
    } catch (err) {
      console.error('Failed to initialize app', err);
      localStorage.removeItem('token');
      window.location.href = '/';
    }
  } else {
    // Показываем страницу входа/регистрации (она загружается отдельно)
    // В chat.html она не нужна, так как это основное приложение.
    // Страница входа будет в корне (index.html), но по условию задачи у нас только chat.html.
    // Для простоты сделаем редирект на корень, где index.html содержит формы.
    window.location.href = '/';
  }
});

// ==================== ЗАГРУЗКА ДАННЫХ ====================
async function loadUser() {
  const res = await fetch('/api/users/me', {
    headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
  });
  if (!res.ok) throw new Error('Failed to load user');
  currentUser = await res.json();
  applyTheme(currentUser.theme, currentUser.wallpaper);
}

async function loadChats() {
  const res = await fetch('/api/chats', {
    headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
  });
  if (!res.ok) throw new Error('Failed to load chats');
  chats = await res.json();
}

async function loadContacts() {
  const res = await fetch('/api/contacts', {
    headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
  });
  if (!res.ok) throw new Error('Failed to load contacts');
  contacts = await res.json();
}

async function loadFolders() {
  const res = await fetch('/api/folders', {
    headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
  });
  if (!res.ok) throw new Error('Failed to load folders');
  folders = await res.json();
}

// ==================== РЕНДЕР ====================
function renderMainLayout() {
  // Определяем, десктоп или мобила
  const isDesktop = window.innerWidth >= 768;
  appEl.className = isDesktop ? 'desktop-layout' : '';

  appEl.innerHTML = `
    <div class="sidebar">
      <div class="top-bar">
        <h1>${currentUser?.username || 'Чаты'}</h1>
        <button class="btn-icon" onclick="showSettings()">⚙️</button>
      </div>
      <div class="search-box">
        <input type="text" id="global-search" placeholder="Поиск..." oninput="globalSearch()">
      </div>
      <div class="chats-list" id="chat-list"></div>
    </div>
    <div class="main-content" id="main-content">
      <div class="chat-placeholder" id="chat-placeholder" style="display: flex; align-items: center; justify-content: center; height: 100%; color: var(--text-secondary);">
        Выберите чат
      </div>
    </div>
  `;

  renderChatList();

  // Если есть текущий чат (например, после перезагрузки), открываем его
  if (currentChatId) {
    openChat(currentChatId);
  }
}

function renderChatList() {
  const listEl = document.getElementById('chat-list');
  if (!listEl) return;
  listEl.innerHTML = '';

  // Сортировка: закреплённые сверху, потом по дате последнего сообщения
  const sorted = [...chats].sort((a, b) => {
    if (a.pinned && !b.pinned) return -1;
    if (!a.pinned && b.pinned) return 1;
    return (b.lastMessageTime || 0) - (a.lastMessageTime || 0);
  });

  sorted.forEach(chat => {
    const item = document.createElement('div');
    item.className = `chat-item ${chat.pinned ? 'pinned' : ''} ${editMode ? 'edit-mode' : ''}`;
    item.dataset.id = chat.id;

    if (editMode) {
      const checkbox = document.createElement('div');
      checkbox.className = `chat-checkbox ${selectedItems.includes(chat.id) ? 'selected' : ''}`;
      checkbox.textContent = selectedItems.includes(chat.id) ? '✓' : '';
      item.appendChild(checkbox);
    }

    item.innerHTML += `
      <div class="chat-avatar">${chat.avatar || '👤'}</div>
      <div class="chat-info">
        <div class="chat-name">${escapeHtml(chat.title || 'Без названия')}</div>
        <div class="chat-last-msg">${escapeHtml(chat.lastMessage || '')}</div>
      </div>
      <div class="chat-meta">
        <div class="chat-time">${formatTime(chat.lastMessageTime)}</div>
        ${chat.unreadCount ? `<div class="chat-unread">${chat.unreadCount}</div>` : ''}
        ${chat.pinned ? '<span class="chat-pin">📌</span>' : ''}
      </div>
    `;

    item.addEventListener('click', (e) => {
      if (editMode) {
        toggleSelectChat(chat.id, e);
      } else {
        openChat(chat.id);
      }
    });

    listEl.appendChild(item);
  });
}

function renderMessages() {
  const content = document.getElementById('main-content');
  if (!content) return;

  const chat = chats.find(c => c.id === currentChatId);
  if (!chat) return;

  content.innerHTML = `
    <div class="chat-window">
      <div class="chat-header" onclick="openChatInfo('${chat.id}')">
        <button class="back-btn" onclick="event.stopPropagation(); closeChat()">←</button>
        <div class="chat-header-info">
          <div class="chat-header-name">${escapeHtml(chat.title || '')}</div>
          <div class="chat-header-status" id="chat-status">онлайн</div>
        </div>
        <button class="btn-icon" onclick="event.stopPropagation(); showChatMenu('${chat.id}')">⋮</button>
      </div>
      <div class="messages-area" id="messages-area"></div>
      <div class="input-area">
        <button class="attach-btn" onclick="document.getElementById('file-input').click()">📎</button>
        <div class="input-wrapper">
          <input type="text" id="message-input" placeholder="Сообщение" oninput="handleTyping()">
          <button class="emoji-btn" onclick="toggleEmojiPicker()">😀</button>
          <button class="voice-btn" id="send-btn" onclick="sendMessage()">🎤</button>
        </div>
      </div>
      <input type="file" id="file-input" onchange="uploadFile()" style="display: none;">
      <div id="emoji-picker" class="emoji-picker" style="display: none;"></div>
    </div>
  `;

  renderMessageList();
  initEmojiPicker();
  scrollToBottom();
}

function renderMessageList() {
  const area = document.getElementById('messages-area');
  if (!area) return;
  area.innerHTML = '';

  const msgs = messages.filter(m => m.chatId === currentChatId);
  msgs.sort((a, b) => a.createdAt - b.createdAt);

  msgs.forEach(msg => {
    const isOwn = msg.senderId === currentUser.id;
    const sender = isOwn ? currentUser : contacts.find(c => c.id === msg.senderId) || { username: 'Unknown', avatar: '👤' };

    const msgDiv = document.createElement('div');
    msgDiv.className = `message ${isOwn ? 'own' : 'other'}`;
    msgDiv.dataset.id = msg.id;

    let headerHtml = '';
    if (!isOwn && chat.type !== 'private') {
      headerHtml = `
        <div class="message-header" onclick="showUserProfile('${msg.senderId}')">
          <div class="message-sender-avatar">${sender.avatar}</div>
          <span class="message-sender-name">${escapeHtml(sender.username)}</span>
        </div>
      `;
    }

    let contentHtml = '';
    if (msg.type === 'text') {
      contentHtml = escapeHtml(msg.content);
    } else if (msg.type === 'file') {
      contentHtml = `<div class="file-message"><span class="file-icon">📎</span><span>${escapeHtml(msg.fileName)}</span></div>`;
    } else if (msg.type === 'photo') {
      contentHtml = `<img src="${msg.fileUrl}" style="max-width:200px; max-height:200px; border-radius:8px;">`;
    } else if (msg.type === 'video') {
      contentHtml = `<video src="${msg.fileUrl}" controls style="max-width:200px; max-height:200px; border-radius:8px;"></video>`;
    } else if (msg.type === 'voice') {
      contentHtml = `<audio src="${msg.fileUrl}" controls></audio>`;
    }

    let reactionsHtml = '';
    if (msg.reactions && msg.reactions.length) {
      reactionsHtml = '<div class="message-reactions">' + msg.reactions.map(r => `<span class="reaction" onclick="addReaction('${msg.id}', '${r}')">${r}</span>`).join('') + '</div>';
    }

    msgDiv.innerHTML = `
      ${headerHtml}
      <div class="message-bubble">${contentHtml}</div>
      <div class="message-time">${formatTime(msg.createdAt)}</div>
      ${reactionsHtml}
    `;

    msgDiv.addEventListener('contextmenu', (e) => showMessageContextMenu(e, msg));
    area.appendChild(msgDiv);
  });
}

function initEmojiPicker() {
  const picker = document.getElementById('emoji-picker');
  if (!picker) return;
  const emojis = ['😊','😂','❤️','👍','🔥','😢','😡','🎉','👏','💯','🤔','🙏','😁','😎','🤣','🥰','😘','🤗','😐','😴','🤯','🥳','🤩','😱','🤬','👻','💀','👽'];
  picker.innerHTML = emojis.map(e => `<span class="emoji-item" onclick="addEmoji('${e}')">${e}</span>`).join('');
}

function scrollToBottom() {
  const area = document.getElementById('messages-area');
  if (area) area.scrollTop = area.scrollHeight;
}

// ==================== API ВЗАИМОДЕЙСТВИЯ ====================
async function openChat(chatId) {
  currentChatId = chatId;
  try {
    const res = await fetch(`/api/messages/${chatId}`, {
      headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
    });
    if (!res.ok) throw new Error('Failed to load messages');
    messages = await res.json();
    renderMessages();
    socket.emit('joinChat', chatId);
  } catch (err) {
    console.error(err);
  }
}

function closeChat() {
  currentChatId = null;
  renderMainLayout(); // возвращаемся к списку
}

async function sendMessage() {
  const input = document.getElementById('message-input');
  const content = input.value.trim();
  if (!content || !currentChatId) return;

  try {
    const res = await fetch(`/api/messages/${currentChatId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${localStorage.getItem('token')}`
      },
      body: JSON.stringify({ content, type: 'text' })
    });
    if (!res.ok) throw new Error('Failed to send message');
    const newMsg = await res.json();
    messages.push(newMsg);
    renderMessageList();
    input.value = '';
    document.getElementById('send-btn').className = 'voice-btn';
    document.getElementById('send-btn').textContent = '🎤';
    scrollToBottom();
  } catch (err) {
    console.error(err);
  }
}

async function uploadFile() {
  const fileInput = document.getElementById('file-input');
  const file = fileInput.files[0];
  if (!file || !currentChatId) return;

  const formData = new FormData();
  formData.append('file', file);
  try {
    const res = await fetch(`/api/upload/chat/${currentChatId}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
      body: formData
    });
    if (!res.ok) throw new Error('Upload failed');
    const newMsg = await res.json();
    messages.push(newMsg);
    renderMessageList();
    fileInput.value = '';
  } catch (err) {
    console.error(err);
  }
}

async function addReaction(messageId, reaction) {
  try {
    await fetch(`/api/messages/${messageId}/reactions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${localStorage.getItem('token')}`
      },
      body: JSON.stringify({ reaction })
    });
    // Обновим сообщение локально
    const msg = messages.find(m => m.id === messageId);
    if (msg) {
      if (!msg.reactions) msg.reactions = [];
      if (!msg.reactions.includes(reaction)) msg.reactions.push(reaction);
      renderMessageList();
    }
  } catch (err) {
    console.error(err);
  }
}

// ==================== УТИЛИТЫ ====================
function formatTime(timestamp) {
  if (!timestamp) return '';
  const d = new Date(timestamp);
  return d.toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' });
}

function escapeHtml(unsafe) {
  if (!unsafe) return '';
  return unsafe.replace(/[&<>"']/g, function(m) {
    if (m === '&') return '&amp;';
    if (m === '<') return '&lt;';
    if (m === '>') return '&gt;';
    if (m === '"') return '&quot;';
    return '&#039;';
  });
}

function applyTheme(theme, wallpaper) {
  document.body.className = '';
  if (theme) document.body.classList.add(theme + '-theme');
  if (wallpaper) document.body.classList.add('wallpaper-' + wallpaper);
}

function handleTyping() {
  const input = document.getElementById('message-input');
  const btn = document.getElementById('send-btn');
  if (input && btn) {
    if (input.value.trim()) {
      btn.className = 'voice-btn send-btn';
      btn.textContent = '➤';
      socket.emit('typing', { chatId: currentChatId, isTyping: true });
    } else {
      btn.className = 'voice-btn';
      btn.textContent = '🎤';
      socket.emit('typing', { chatId: currentChatId, isTyping: false });
    }
  }
}

function toggleEmojiPicker() {
  const picker = document.getElementById('emoji-picker');
  if (picker) picker.style.display = picker.style.display === 'none' ? 'grid' : 'none';
}

function addEmoji(emoji) {
  const input = document.getElementById('message-input');
  if (input) {
    input.value += emoji;
    input.focus();
    handleTyping();
  }
  toggleEmojiPicker();
}

// ==================== КОНТЕКСТНОЕ МЕНЮ ====================
function showMessageContextMenu(e, msg) {
  e.preventDefault();
  contextMessage = msg;
  const menu = document.getElementById('message-context-menu');
  if (!menu) {
    // Создаём меню, если его нет
    const newMenu = document.createElement('div');
    newMenu.id = 'message-context-menu';
    newMenu.className = 'message-context-menu';
    newMenu.innerHTML = `
      <div class="message-context-item" onclick="contextReply()">↩️ Ответить</div>
      <div class="message-context-item" onclick="contextForward()">➡️ Переслать</div>
      <div class="message-context-item" onclick="contextCopy()">📋 Копировать</div>
      <div class="message-context-item" onclick="contextReact('👍')">👍 Поставить реакцию</div>
      <div class="message-context-item" onclick="contextReact('❤️')">❤️ Поставить реакцию</div>
      <div class="message-context-item" onclick="contextReact('😮')">😮 Поставить реакцию</div>
      <div class="message-context-item" onclick="contextReact('😢')">😢 Поставить реакцию</div>
      <div class="message-context-item" onclick="contextReact('😡')">😡 Поставить реакцию</div>
      <div class="message-context-item" onclick="contextDelete()">❌ Удалить</div>
    `;
    document.body.appendChild(newMenu);
    document.getElementById('message-context-menu').style.display = 'block';
    document.getElementById('message-context-menu').style.left = e.pageX + 'px';
    document.getElementById('message-context-menu').style.top = e.pageY + 'px';
  } else {
    menu.style.display = 'block';
    menu.style.left = e.pageX + 'px';
    menu.style.top = e.pageY + 'px';
  }

  // Закрыть по клику вне
  setTimeout(() => {
    document.addEventListener('click', function hide() {
      const menuEl = document.getElementById('message-context-menu');
      if (menuEl) menuEl.style.display = 'none';
      document.removeEventListener('click', hide);
    }, { once: true });
  }, 10);
}

function contextReply() {
  if (contextMessage) {
    const input = document.getElementById('message-input');
    input.value = `@${contextMessage.senderUsername} ` + input.value;
    input.focus();
  }
}

function contextForward() {
  alert('Функция пересылки будет позже');
}

function contextCopy() {
  if (contextMessage) {
    navigator.clipboard.writeText(contextMessage.content);
  }
}

function contextReact(emoji) {
  if (contextMessage) {
    addReaction(contextMessage.id, emoji);
  }
}

async function contextDelete() {
  if (!contextMessage) return;
  if (!confirm('Удалить сообщение?')) return;
  try {
    await fetch(`/api/messages/${contextMessage.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
    });
    messages = messages.filter(m => m.id !== contextMessage.id);
    renderMessageList();
  } catch (err) {
    console.error(err);
  }
}

// ==================== SOCKET.IO ====================
function setupSocket() {
  socket.on('connect', () => {
    console.log('Socket connected');
  });

  socket.on('newMessage', (msg) => {
    if (msg.chatId === currentChatId) {
      messages.push(msg);
      renderMessageList();
      scrollToBottom();
    } else {
      // Обновить список чатов (последнее сообщение)
      const chat = chats.find(c => c.id === msg.chatId);
      if (chat) {
        chat.lastMessage = msg.content;
        chat.lastMessageTime = msg.createdAt;
        renderChatList();
      }
    }
  });

  socket.on('userTyping', ({ username, isTyping }) => {
    const statusEl = document.getElementById('chat-status');
    if (statusEl) {
      statusEl.textContent = isTyping ? `${username} печатает...` : 'онлайн';
    }
  });

  socket.on('messagesRead', ({ userId, messageIds }) => {
    // Обновить статусы прочтения
    // ...
  });

  socket.on('error', (err) => {
    console.error('Socket error', err);
  });

  // Правило 57: переподключение
  socket.on('disconnect', () => {
    console.log('Socket disconnected, attempting reconnect...');
    setTimeout(() => socket.connect(), 3000);
  });
}

// ==================== ГЛОБАЛЬНЫЙ ПОИСК ====================
async function globalSearch() {
  const query = document.getElementById('global-search').value;
  if (query.length < 2) {
    renderChatList();
    return;
  }
  try {
    const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`, {
      headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
    });
    if (!res.ok) throw new Error('Search failed');
    const data = await res.json();
    // Отобразить результаты поиска (упрощённо – вставить в список)
    const listEl = document.getElementById('chat-list');
    listEl.innerHTML = '';
    data.users.forEach(user => {
      const item = document.createElement('div');
      item.className = 'contact-item';
      item.innerHTML = `
        <div class="chat-avatar">${user.avatar || '👤'}</div>
        <div class="chat-info">
          <div class="chat-name">${escapeHtml(user.username)}</div>
        </div>
      `;
      item.addEventListener('click', () => showUserProfile(user.id));
      listEl.appendChild(item);
    });
    data.chats.forEach(chat => {
      const item = document.createElement('div');
      item.className = 'chat-item';
      item.innerHTML = `
        <div class="chat-avatar">${chat.avatar || '📢'}</div>
        <div class="chat-info">
          <div class="chat-name">${escapeHtml(chat.title)}</div>
          <div class="chat-last-msg">${chat.description || ''}</div>
        </div>
      `;
      item.addEventListener('click', () => openChat(chat.id));
      listEl.appendChild(item);
    });
  } catch (err) {
    console.error(err);
  }
}

// ==================== ЭКСПОРТ ГЛОБАЛЬНЫХ ФУНКЦИЙ ====================
// Для вызова из HTML
window.showSettings = function() {
  alert('Настройки (заглушка)');
};

window.showUserProfile = function(userId) {
  alert('Профиль пользователя ' + userId);
};

window.showChatMenu = function(chatId) {
  alert('Меню чата ' + chatId);
};

window.openChatInfo = function(chatId) {
  alert('Информация о чате ' + chatId);
};

window.toggleSelectChat = function(chatId, e) {
  e.stopPropagation();
  const idx = selectedItems.indexOf(chatId);
  if (idx === -1) selectedItems.push(chatId);
  else selectedItems.splice(idx, 1);
  renderChatList();
};

window.contextReply = contextReply;
window.contextForward = contextForward;
window.contextCopy = contextCopy;
window.contextReact = contextReact;
window.contextDelete = contextDelete;
window.addEmoji = addEmoji;
window.sendMessage = sendMessage;
window.uploadFile = uploadFile;
window.handleTyping = handleTyping;
window.toggleEmojiPicker = toggleEmojiPicker;
window.globalSearch = globalSearch;
window.closeChat = closeChat;
