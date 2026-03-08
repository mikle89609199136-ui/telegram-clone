// public/app.js – полная клиентская логика SPA (Telegram-like messenger + IRIS AI)

// ==================== ГЛОБАЛЬНЫЕ ПЕРЕМЕННЫЕ ====================
let socket = null;
let currentUser = null;
let currentChatId = null;
let currentChat = null;
let chats = [];
let messages = [];
let contacts = [];
let folders = [];
let editMode = false;
let selectedItems = [];
let contextMessage = null;
let activeMenus = {
  create: false,
  attach: false,
  emoji: false,
  iris: false,
  context: false
};
let typingTimeout = null;
let isDesktop = window.innerWidth >= 768;
let devicePlatform = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) ? 'mobile' : 'desktop';
let notificationPermission = false;
let currentTheme = localStorage.getItem('theme') || 'dark';
let currentWallpaper = localStorage.getItem('wallpaper') || 'default';
let currentLanguage = localStorage.getItem('language') || 'ru';
let pendingMessages = new Map(); // для оптимистичных сообщений

// DOM элементы (будут инициализированы позже)
let appEl;
let mainContentEl;
let sidebarLeftEl;
let sidebarRightEl;

// ==================== ИНИЦИАЛИЗАЦИЯ ПРИЛОЖЕНИЯ ====================
document.addEventListener('DOMContentLoaded', async () => {
  appEl = document.getElementById('app');
  const token = localStorage.getItem('token');

  // Если нет токена, редирект на страницу входа (которая должна быть в корне)
  if (!token) {
    window.location.href = '/';
    return;
  }

  try {
    await loadUser();
    await loadChats();
    await loadContacts();
    await loadFolders();
    renderMainLayout();
    setupSocket();
    applyTheme(currentTheme, currentWallpaper);
    requestNotificationPermission();
    window.addEventListener('resize', handleResize);
  } catch (err) {
    console.error('Failed to initialize app:', err);
    localStorage.removeItem('token');
    window.location.href = '/';
  }
});

// ==================== ЗАГРУЗКА ДАННЫХ С СЕРВЕРА ====================
async function loadUser() {
  const res = await fetch('/api/users/me', {
    headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
  });
  if (!res.ok) throw new Error('Failed to load user');
  currentUser = await res.json();
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

// ==================== ОСНОВНОЙ РЕНДЕР ====================
function renderMainLayout() {
  isDesktop = window.innerWidth >= 768;
  appEl.className = isDesktop ? 'desktop-layout' : '';

  // Создаём структуру трёх колонок (для десктопа) или одной колонки (для мобильных)
  if (isDesktop) {
    appEl.innerHTML = `
      <div class="sidebar-left" id="sidebar-left">
        ${renderLeftSidebar()}
      </div>
      <div class="main-content" id="main-content">
        <div class="chat-placeholder" id="chat-placeholder" style="display: flex; align-items: center; justify-content: center; height: 100%; color: var(--text-secondary);">
          <div style="text-align: center;">
            <div style="font-size: 48px; margin-bottom: 16px;">💬</div>
            <div>Выберите чат для начала общения</div>
          </div>
        </div>
      </div>
      <div class="sidebar-right" id="sidebar-right" style="display: none;">
        <!-- Правая панель будет заполняться при открытии чата -->
      </div>
    `;
  } else {
    appEl.innerHTML = `
      <div class="main-content" id="main-content">
        ${renderMobileMainView()}
      </div>
    `;
  }

  // Если уже был открыт чат, восстанавливаем его
  if (currentChatId) {
    openChat(currentChatId);
  } else {
    renderChatList();
  }
}

function renderLeftSidebar() {
  return `
    <div class="top-bar">
      <h1>${currentUser?.username || 'Чаты'}</h1>
      <button class="btn-icon" onclick="showSettings()">⚙️</button>
    </div>
    <div class="search-box">
      <input type="text" id="global-search" placeholder="Поиск..." oninput="globalSearch()">
    </div>
    <div class="chats-list" id="chat-list"></div>
  `;
}

function renderMobileMainView() {
  return `
    <div class="top-bar">
      <h1>${currentUser?.username || 'Чаты'}</h1>
      <button class="btn-icon" onclick="showSettings()">⚙️</button>
    </div>
    <div class="search-box">
      <input type="text" id="global-search" placeholder="Поиск..." oninput="globalSearch()">
    </div>
    <div class="chats-list" id="chat-list"></div>
  `;
}

// ==================== РЕНДЕР СПИСКА ЧАТОВ ====================
function renderChatList() {
  const listEl = document.getElementById('chat-list');
  if (!listEl) return;
  listEl.innerHTML = '';

  // Сортировка: закреплённые сверху, затем по дате последнего сообщения
  const sorted = [...chats].sort((a, b) => {
    if (a.pinned && !b.pinned) return -1;
    if (!a.pinned && b.pinned) return 1;
    return (b.lastMessageTime || 0) - (a.lastMessageTime || 0);
  });

  sorted.forEach(chat => {
    const item = document.createElement('div');
    item.className = `chat-item ${chat.pinned ? 'pinned' : ''} ${editMode ? 'edit-mode' : ''}`;
    item.dataset.id = chat.id;
    item.dataset.type = chat.type;

    if (editMode) {
      const checkbox = document.createElement('div');
      checkbox.className = `chat-checkbox ${selectedItems.includes(chat.id) ? 'selected' : ''}`;
      checkbox.textContent = selectedItems.includes(chat.id) ? '✓' : '';
      item.appendChild(checkbox);
    }

    // Аватар
    const avatarDiv = document.createElement('div');
    avatarDiv.className = 'chat-avatar';
    if (chat.avatar && chat.avatar.startsWith('<img')) {
      avatarDiv.innerHTML = chat.avatar;
    } else {
      avatarDiv.textContent = chat.avatar || (chat.type === 'group' ? '👥' : chat.type === 'channel' ? '📢' : '👤');
    }

    // Информация о чате
    const infoDiv = document.createElement('div');
    infoDiv.className = 'chat-info';
    let displayName = chat.title || '';
    if (chat.type === 'private' && chat.participants) {
      const other = chat.participants.find(p => p.id !== currentUser?.id);
      if (other) {
        displayName = other.username;
        const localName = contacts.find(c => c.id === other.id)?.localName;
        if (localName) displayName += ` (${localName})`;
      }
    }
    infoDiv.innerHTML = `
      <div class="chat-name">${escapeHtml(displayName)}</div>
      <div class="chat-last-msg">${escapeHtml(chat.lastMessage || '')}</div>
    `;

    // Мета-информация
    const metaDiv = document.createElement('div');
    metaDiv.className = 'chat-meta';
    metaDiv.innerHTML = `
      <div class="chat-time">${formatTime(chat.lastMessageTime)}</div>
      ${chat.unreadCount ? `<div class="chat-unread">${chat.unreadCount}</div>` : ''}
      ${chat.pinned ? '<span class="chat-pin">📌</span>' : ''}
    `;

    item.appendChild(avatarDiv);
    item.appendChild(infoDiv);
    item.appendChild(metaDiv);

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

// ==================== УТИЛИТЫ ====================
function formatTime(timestamp) {
  if (!timestamp) return '';
  const d = new Date(timestamp);
  const now = new Date();
  const diff = now - d;
  if (diff < 60000) return 'только что';
  if (diff < 3600000) return `${Math.floor(diff / 60000)} мин`;
  if (diff < 86400000) return d.toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString('ru', { day: 'numeric', month: 'short' });
}

function escapeHtml(unsafe) {
  if (!unsafe) return '';
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function handleResize() {
  isDesktop = window.innerWidth >= 768;
  if (currentChatId) {
    // Перерендерим с учётом новой ширины
    renderMainLayout();
    openChat(currentChatId);
  } else {
    renderMainLayout();
  }
}
// ==================== WEBSOCKET ====================
function setupSocket() {
  socket = io({
    auth: { token: localStorage.getItem('token') },
    reconnection: true,
    reconnectionAttempts: 5,
    reconnectionDelay: 1000
  });

  socket.on('connect', () => {
    console.log('Socket connected');
    if (currentChatId) socket.emit('joinChat', currentChatId);
  });

  socket.on('newMessage', (msg) => {
    if (msg.chatId === currentChatId) {
      // Добавляем сообщение, если оно не дубликат
      if (!messages.some(m => m.id === msg.id)) {
        messages.push(msg);
        renderMessages();
        scrollToBottom();
        // Отметить как прочитанное
        socket.emit('readMessages', { chatId: currentChatId, messageIds: [msg.id] });
      }
    } else {
      // Обновляем список чатов (последнее сообщение)
      const chat = chats.find(c => c.id === msg.chatId);
      if (chat) {
        chat.lastMessage = msg.content;
        chat.lastMessageTime = msg.createdAt;
        chat.unreadCount = (chat.unreadCount || 0) + 1;
        renderChatList();
      }
      // Показать уведомление
      showNotification('Новое сообщение', `${msg.senderUsername}: ${msg.content}`, { chatId: msg.chatId });
    }
  });

  socket.on('userTyping', ({ username, isTyping }) => {
    const status = document.getElementById('chat-status');
    if (status) {
      status.textContent = isTyping ? `${username} печатает...` : 'онлайн';
    }
  });

  socket.on('messagesRead', ({ userId, messageIds }) => {
    // Можно обновить статусы сообщений (галочки)
    // Для простоты не реализуем
  });

  socket.on('error', (err) => {
    console.error('Socket error:', err);
  });

  socket.on('disconnect', () => {
    console.log('Socket disconnected, attempting reconnect...');
  });
}

// ==================== IRIS AI ====================
function toggleIrisPanel() {
  const panel = document.getElementById('iris-panel');
  if (panel) {
    panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
    if (panel.style.display === 'block') document.getElementById('iris-input')?.focus();
  }
}

function handleIrisKeyDown(e) {
  if (e.key === 'Enter') askIris();
}

async function askIris(command) {
  const input = document.getElementById('iris-input');
  let query = '';
  if (command === 'summarize') {
    query = 'Сделай краткое резюме последних сообщений в этом чате.';
  } else if (command === 'translate') {
    query = 'Переведи последнее сообщение на русский.';
  } else if (command === 'search') {
    query = 'Найди информацию о ' + (input?.value || '');
  } else if (command === 'answer') {
    query = input?.value || '';
  } else {
    query = input?.value || '';
  }

  if (!query.trim()) return;

  // Оптимистичное добавление сообщения от IRIS
  const tempId = 'iris-' + Date.now();
  const tempMsg = {
    id: tempId,
    chatId: currentChatId,
    senderId: 'iris',
    senderUsername: 'IRIS',
    content: '🤔 Думаю...',
    type: 'ai',
    createdAt: new Date().toISOString(),
    reactions: []
  };
  messages.push(tempMsg);
  renderMessages();
  scrollToBottom();
  if (input) input.value = '';
  toggleIrisPanel();

  try {
    const res = await fetch('/api/ai/query', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${localStorage.getItem('token')}`
      },
      body: JSON.stringify({
        chatId: currentChatId,
        query,
        context: messages.slice(-20) // последние 20 сообщений как контекст
      })
    });
    if (!res.ok) throw new Error('AI request failed');
    const data = await res.json();
    const index = messages.findIndex(m => m.id === tempId);
    if (index !== -1) {
      messages[index].content = data.response || 'Извините, я не смог обработать запрос.';
      renderMessages();
    }
  } catch (err) {
    console.error(err);
    const index = messages.findIndex(m => m.id === tempId);
    if (index !== -1) {
      messages[index].content = 'Ошибка связи с IRIS. Попробуйте позже.';
      renderMessages();
    }
  }
}

// ==================== КОНТЕКСТНОЕ МЕНЮ СООБЩЕНИЯ ====================
function showMessageContextMenu(e, msg) {
  e.preventDefault();
  contextMessage = msg;

  // Закрыть другие меню
  closeAllMenus();

  let menu = document.getElementById('message-context-menu');
  if (!menu) {
    menu = document.createElement('div');
    menu.id = 'message-context-menu';
    menu.className = 'message-context-menu';
    document.body.appendChild(menu);
  }

  const isOwn = msg.senderId === currentUser?.id;
  menu.innerHTML = `
    <div class="message-context-item" onclick="replyToMessage()">↩️ Ответить</div>
    <div class="message-context-item" onclick="forwardMessage()">➡️ Переслать</div>
    <div class="message-context-item" onclick="copyMessage()">📋 Копировать текст</div>
    <div class="message-context-item" onclick="addReaction('👍')">👍 Поставить реакцию</div>
    <div class="message-context-item" onclick="addReaction('❤️')">❤️ Поставить реакцию</div>
    <div class="message-context-item" onclick="addReaction('😮')">😮 Поставить реакцию</div>
    <div class="message-context-item" onclick="addReaction('😢')">😢 Поставить реакцию</div>
    <div class="message-context-item" onclick="addReaction('😡')">😡 Поставить реакцию</div>
    ${isOwn ? '<div class="message-context-item" onclick="deleteMessage()">❌ Удалить</div>' : ''}
    ${!isOwn ? '<div class="message-context-item" onclick="reportMessage()">⚠️ Пожаловаться</div>' : ''}
  `;

  menu.style.display = 'block';
  menu.style.left = e.pageX + 'px';
  menu.style.top = e.pageY + 'px';

  // Закрыть по клику вне
  setTimeout(() => {
    document.addEventListener('click', function hide() {
      if (menu) menu.style.display = 'none';
      document.removeEventListener('click', hide);
    }, { once: true });
  }, 10);
}

function replyToMessage() {
  if (!contextMessage) return;
  const input = document.getElementById('message-input');
  if (input) {
    input.value = `@${contextMessage.senderUsername} ` + input.value;
    input.focus();
  }
}

function forwardMessage() {
  alert('Функция пересылки будет реализована позже');
}

function copyMessage() {
  if (contextMessage) {
    navigator.clipboard.writeText(contextMessage.content).then(() => {
      // Показать уведомление
    }).catch(err => console.error(err));
  }
}

async function addReaction(emoji) {
  if (!contextMessage) return;
  try {
    await fetch(`/api/messages/${contextMessage.id}/reactions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${localStorage.getItem('token')}`
      },
      body: JSON.stringify({ reaction: emoji })
    });
    // Обновить локально
    if (!contextMessage.reactions) contextMessage.reactions = [];
    contextMessage.reactions.push({ user_id: currentUser.id, reaction: emoji });
    renderMessages();
  } catch (err) {
    console.error(err);
  }
}

async function deleteMessage() {
  if (!contextMessage || !confirm('Удалить сообщение?')) return;
  try {
    await fetch(`/api/messages/${contextMessage.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
    });
    messages = messages.filter(m => m.id !== contextMessage.id);
    renderMessages();
  } catch (err) {
    console.error(err);
  }
}

function reportMessage() {
  alert('Жалоба отправлена модераторам');
}

// ==================== МЕНЮ СОЗДАНИЯ (КНОПКА "+") ====================
function toggleCreateMenu() {
  closeAllMenus();
  let menu = document.getElementById('create-menu');
  if (!menu) {
    menu = document.createElement('div');
    menu.id = 'create-menu';
    menu.className = 'create-menu';
    menu.innerHTML = `
      <div class="create-menu-item" onclick="createPrivateChat()">
        <i>💬</i> <span>Новый чат</span>
      </div>
      <div class="create-menu-item" onclick="createGroup()">
        <i>👥</i> <span>Новая группа</span>
      </div>
      <div class="create-menu-item" onclick="createChannel()">
        <i>📢</i> <span>Новый канал</span>
      </div>
      <div class="create-menu-item" onclick="addContact()">
        <i>📇</i> <span>Добавить контакт</span>
      </div>
    `;
    document.body.appendChild(menu);
  }
  menu.style.display = 'block';
  menu.style.top = 'calc(var(--header-height) + 8px)';
  menu.style.right = '16px';

  setTimeout(() => {
    document.addEventListener('click', function hide() {
      if (menu) menu.style.display = 'none';
      document.removeEventListener('click', hide);
    }, { once: true });
  }, 10);
}

function createPrivateChat() {
  const username = prompt('Введите username пользователя:');
  if (!username) return;
  // Поиск пользователя и создание чата
  alert('Функция создания чата будет реализована');
}

function createGroup() {
  alert('Функция создания группы будет реализована');
}

function createChannel() {
  alert('Функция создания канала будет реализована');
}

function addContact() {
  const userId = prompt('Введите ID пользователя или username:');
  if (!userId) return;
  fetch('/api/contacts', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${localStorage.getItem('token')}`
    },
    body: JSON.stringify({ contactId: userId })
  })
    .then(res => res.json())
    .then(data => {
      if (data.success) {
        alert('Контакт добавлен');
        loadContacts();
      } else {
        alert('Ошибка: ' + (data.error || 'Неизвестная ошибка'));
      }
    })
    .catch(err => console.error(err));
}

// ==================== МЕНЮ ВЛОЖЕНИЙ (КНОПКА "📎") ====================
function toggleAttachMenu() {
  closeAllMenus();
  let menu = document.getElementById('attach-menu');
  if (!menu) {
    menu = document.createElement('div');
    menu.id = 'attach-menu';
    menu.className = 'attach-menu';
    menu.innerHTML = `
      <div class="attach-menu-item" onclick="attachPhoto()">
        <i>📷</i> <span>Фото</span>
      </div>
      <div class="attach-menu-item" onclick="attachVideo()">
        <i>🎥</i> <span>Видео</span>
      </div>
      <div class="attach-menu-item" onclick="attachFile()">
        <i>📎</i> <span>Файл</span>
      </div>
      <div class="attach-menu-item" onclick="attachContact()">
        <i>📇</i> <span>Контакт</span>
      </div>
      <div class="attach-menu-item" onclick="attachLocation()">
        <i>📍</i> <span>Геолокация</span>
      </div>
    `;
    document.body.appendChild(menu);
  }
  menu.style.display = 'block';
  menu.style.bottom = 'calc(var(--input-height) + 80px)';
  menu.style.left = '16px';

  setTimeout(() => {
    document.addEventListener('click', function hide() {
      if (menu) menu.style.display = 'none';
      document.removeEventListener('click', hide);
    }, { once: true });
  }, 10);
}

function attachPhoto() {
  const input = document.getElementById('file-input');
  input.accept = 'image/*';
  input.click();
}

function attachVideo() {
  const input = document.getElementById('file-input');
  input.accept = 'video/*';
  input.click();
}

function attachFile() {
  const input = document.getElementById('file-input');
  input.accept = '*/*';
  input.click();
}

function attachContact() {
  alert('Отправка контакта будет позже');
}

function attachLocation() {
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(async (pos) => {
      const { latitude, longitude } = pos.coords;
      // Отправить как сообщение
      const content = `📍 Местоположение: https://maps.google.com/?q=${latitude},${longitude}`;
      const tempId = 'temp-' + Date.now();
      const tempMsg = {
        id: tempId,
        chatId: currentChatId,
        senderId: currentUser.id,
        senderUsername: currentUser.username,
        content,
        type: 'text',
        createdAt: new Date().toISOString()
      };
      messages.push(tempMsg);
      renderMessages();
      try {
        const res = await fetch(`/api/messages/${currentChatId}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${localStorage.getItem('token')}`
          },
          body: JSON.stringify({ content, type: 'text' })
        });
        const newMsg = await res.json();
        const idx = messages.findIndex(m => m.id === tempId);
        if (idx !== -1) messages[idx] = newMsg;
        renderMessages();
      } catch (err) {
        messages = messages.filter(m => m.id !== tempId);
        renderMessages();
      }
    });
  } else {
    alert('Геолокация не поддерживается');
  }
}

// ==================== МЕНЮ ЧАТА (ТРИ ТОЧКИ) ====================
function showChatMenu() {
  if (!currentChat) return;
  const actions = [
    'Поиск в чате',
    'Очистить историю',
    'Удалить чат',
    'Заблокировать пользователя',
    'Отключить уведомления'
  ];
  // Упрощённо через prompt
  const choice = prompt('Выберите действие:\n1 - Поиск\n2 - Очистить\n3 - Удалить\n4 - Заблокировать\n5 - Уведомления');
  if (choice === '1') {
    const query = prompt('Введите текст для поиска:');
    if (query) searchInChat(query);
  } else if (choice === '2') {
    if (confirm('Очистить всю историю?')) clearChatHistory();
  } else if (choice === '3') {
    if (confirm('Удалить чат?')) deleteChat();
  } else if (choice === '4') {
    blockUser();
  } else if (choice === '5') {
    toggleMuteChat();
  }
}

async function searchInChat(query) {
  try {
    const res = await fetch(`/api/search/messages/${currentChatId}?q=${encodeURIComponent(query)}`, {
      headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
    });
    const results = await res.json();
    if (results.length === 0) {
      alert('Ничего не найдено');
      return;
    }
    // Показываем первое найденное сообщение
    const first = results[0];
    // Прокрутить к сообщению (нужно будет реализовать выделение)
    alert(`Найдено сообщение: ${first.content}`);
  } catch (err) {
    console.error(err);
  }
}

async function clearChatHistory() {
  // Удалить все сообщения в чате (только для себя)
  // API пока нет, заглушка
  alert('Функция очистки истории будет позже');
}

async function deleteChat() {
  // Удалить чат (покинуть/удалить)
  if (confirm('Вы уверены?')) {
    // Пока просто закрываем чат и убираем из списка
    chats = chats.filter(c => c.id !== currentChatId);
    closeChat();
    renderChatList();
  }
}

function blockUser() {
  alert('Пользователь заблокирован');
}

function toggleMuteChat() {
  alert('Уведомления отключены');
}

// ==================== ГЛОБАЛЬНЫЙ ПОИСК ====================
async function globalSearch() {
  const query = document.getElementById('global-search')?.value;
  if (!query || query.length < 2) {
    renderChatList();
    return;
  }
  try {
    const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`, {
      headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
    });
    const data = await res.json();
    renderSearchResults(data);
  } catch (err) {
    console.error(err);
  }
}

function renderSearchResults(data) {
  const listEl = document.getElementById('chat-list');
  if (!listEl) return;
  listEl.innerHTML = '';

  if (data.users && data.users.length) {
    const header = document.createElement('div');
    header.className = 'search-header';
    header.textContent = 'Пользователи';
    listEl.appendChild(header);
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
  }

  if (data.chats && data.chats.length) {
    const header = document.createElement('div');
    header.className = 'search-header';
    header.textContent = 'Каналы и группы';
    listEl.appendChild(header);
    data.chats.forEach(chat => {
      const item = document.createElement('div');
      item.className = 'chat-item';
      item.innerHTML = `
        <div class="chat-avatar">${chat.avatar || (chat.type === 'group' ? '👥' : '📢')}</div>
        <div class="chat-info">
          <div class="chat-name">${escapeHtml(chat.title)}</div>
          <div class="chat-last-msg">${chat.description || ''}</div>
        </div>
      `;
      item.addEventListener('click', () => openChat(chat.id));
      listEl.appendChild(item);
    });
  }

  if ((!data.users || !data.users.length) && (!data.chats || !data.chats.length)) {
    listEl.innerHTML = '<div style="text-align: center; padding: 20px; color: var(--text-secondary);">Ничего не найдено</div>';
  }
}

// ==================== ПРОФИЛЬ И НАСТРОЙКИ ====================
function showSettings() {
  // Заглушка – переход на страницу настроек
  alert('Страница настроек (будет реализована)');
}

function showUserProfile(userId) {
  // Заглушка – открыть профиль
  alert('Профиль пользователя ' + userId);
}

function openChatInfo() {
  if (currentChat) {
    if (currentChat.type === 'private') {
      const otherId = currentChat.participants?.find(p => p.id !== currentUser?.id);
      if (otherId) showUserProfile(otherId);
    } else {
      alert('Информация о группе/канале');
    }
  }
}

function closeChat() {
  currentChatId = null;
  currentChat = null;
  renderMainLayout();
}

// ==================== ПАПКИ ====================
function showFolders() {
  alert('Управление папками (будет позже)');
}

// ==================== УВЕДОМЛЕНИЯ ====================
function requestNotificationPermission() {
  if (Notification.permission === 'granted') {
    notificationPermission = true;
  } else if (Notification.permission !== 'denied') {
    Notification.requestPermission().then(perm => {
      notificationPermission = perm === 'granted';
    });
  }
}

function showNotification(title, body, data = {}) {
  if (!notificationPermission || !document.hidden) return;
  try {
    const notification = new Notification(title, {
      body,
      icon: '/icon-192.png',
      badge: '/badge-72.png',
      data
    });
    notification.onclick = (e) => {
      e.preventDefault();
      if (data.chatId) {
        window.focus();
        openChat(data.chatId);
      }
    };
  } catch (err) {
    console.error(err);
  }
}

// ==================== ТЕМЫ И ОБОИ ====================
function applyTheme(theme, wallpaper) {
  document.body.className = '';
  document.body.classList.add(theme + '-theme');
  document.body.classList.add('wallpaper-' + wallpaper);
  localStorage.setItem('theme', theme);
  localStorage.setItem('wallpaper', wallpaper);
}

function toggleEmojiPicker() {
  const picker = document.getElementById('emoji-picker');
  if (picker) {
    picker.style.display = picker.style.display === 'none' ? 'grid' : 'none';
  }
}

function closeAllMenus() {
  const menus = ['create-menu', 'attach-menu', 'emoji-picker', 'iris-panel', 'message-context-menu'];
  menus.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });
}

// ==================== ЭКСПОРТ ГЛОБАЛЬНЫХ ФУНКЦИЙ ====================
// Для вызова из HTML
window.showSettings = showSettings;
window.showUserProfile = showUserProfile;
window.openChat = openChat;
window.closeChat = closeChat;
window.sendMessage = sendMessage;
window.uploadFile = uploadFile;
window.handleTyping = handleTyping;
window.handleKeyDown = handleKeyDown;
window.toggleEmojiPicker = toggleEmojiPicker;
window.addEmoji = addEmoji;
window.toggleCreateMenu = toggleCreateMenu;
window.toggleAttachMenu = toggleAttachMenu;
window.toggleIrisPanel = toggleIrisPanel;
window.askIris = askIris;
window.handleIrisKeyDown = handleIrisKeyDown;
window.globalSearch = globalSearch;
window.toggleEditMode = toggleEditMode;
window.toggleSelectChat = toggleSelectChat;
window.deleteSelectedChats = deleteSelectedChats;
window.pinSelectedChats = pinSelectedChats;
window.addToFolder = addToFolder;
window.showFolders = showFolders;
window.openChatInfo = openChatInfo;
window.showChatMenu = showChatMenu;
window.downloadFile = downloadFile;
window.openImage = openImage;
window.attachPhoto = attachPhoto;
window.attachVideo = attachVideo;
window.attachFile = attachFile;
window.attachContact = attachContact;
window.attachLocation = attachLocation;
window.replyToMessage = replyToMessage;
window.forwardMessage = forwardMessage;
window.copyMessage = copyMessage;
window.addReaction = addReaction;
window.deleteMessage = deleteMessage;
window.reportMessage = reportMessage;

// ==================== ДОПОЛНИТЕЛЬНЫЕ ФУНКЦИИ РЕЖИМА РЕДАКТИРОВАНИЯ ====================
function toggleEditMode() {
  editMode = !editMode;
  const editBar = document.getElementById('edit-bar');
  if (editBar) {
    editBar.style.display = editMode ? 'flex' : 'none';
  }
  document.getElementById('edit-btn').textContent = editMode ? 'Готово' : 'Изм.';
  if (!editMode) selectedItems = [];
  renderChatList();
}

function toggleSelectChat(chatId, e) {
  e.stopPropagation();
  const idx = selectedItems.indexOf(chatId);
  if (idx === -1) selectedItems.push(chatId);
  else selectedItems.splice(idx, 1);
  document.getElementById('edit-counter').textContent = `${selectedItems.length} выбрано`;
  renderChatList();
}

function deleteSelectedChats() {
  if (selectedItems.length === 0) return;
  if (!confirm(`Удалить ${selectedItems.length} чат(ов)?`)) return;
  chats = chats.filter(c => !selectedItems.includes(c.id));
  selectedItems = [];
  toggleEditMode();
  renderChatList();
}

function pinSelectedChats() {
  chats.forEach(c => {
    if (selectedItems.includes(c.id)) {
      c.pinned = !c.pinned;
    }
  });
  selectedItems = [];
  toggleEditMode();
  renderChatList();
}

function addToFolder() {
  alert('Добавить в папку (будет реализовано)');
}
