let socket = null;
let currentUser = null;
let currentChat = null;
let chats = [];
let messages = {};
let typingTimeouts = {};
let mediaRecorder = null;
let recordedChunks = [];
let peerConnection = null;
let localStream = null;
let remoteStream = null;
let callActive = false;
let currentCallId = null;
let uploadControllers = new Map();
let emojiPickerVisible = false;
let contextMessageId = null;
let pinnedMessages = [];
let unreadCounts = {};
let stickers = [];
let gifs = [];
let audioPlayer = null;
let currentlyPlaying = null;

const token = localStorage.getItem('token');
const API_BASE = '/api';

// ==================== УТИЛИТЫ ====================
function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

function sanitizeHtml(text) {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

function showError(message) {
  // Временное решение – alert, потом заменить на pixel popup
  alert('Error: ' + message);
}

// ==================== SERVICE WORKER ====================
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/public/sw.js')
    .then(reg => console.log('SW registered', reg))
    .catch(err => console.error('SW registration failed', err));
}

// ==================== WEBSOCKET ====================
function connectSocket() {
  socket = io(window.location.origin, {
    auth: { token },
    reconnection: true,
    reconnectionAttempts: 5,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    timeout: 20000
  });

  socket.on('connect', () => {
    console.log('Socket connected');
    loadChats();
  });

  socket.on('connect_error', (err) => {
    console.error('Socket connection error', err);
    showError('Connection lost. Reconnecting...');
  });

  socket.on('disconnect', () => {
    console.log('Socket disconnected');
  });

  socket.on('reconnect', (attempt) => {
    console.log('Socket reconnected after', attempt, 'attempts');
    loadChats();
  });

  socket.on('reconnect_error', (err) => {
    console.error('Socket reconnect error', err);
  });

  socket.on('newMessage', (message) => {
    if (currentChat && currentChat.id === message.chatId) {
      renderMessage(message);
      markAsRead(message.chatId, [message.id]);
    }
    updateChatListItem(message.chatId, message);
    playNotificationSound();
  });

  socket.on('userTyping', ({ userId, username, isTyping }) => {
    if (currentChat && currentChat.id === userId) { // исправлено: нужно передавать chatId
      showTypingIndicator(userId, username, isTyping);
    }
  });

  socket.on('messagesRead', ({ userId, messageIds }) => {
    messageIds.forEach(id => {
      const msgEl = document.querySelector(`.message[data-id="${id}"]`);
      if (msgEl) msgEl.dataset.status = 'read';
    });
  });

  socket.on('reactionUpdated', ({ messageId, reactions }) => {
    updateReactions(messageId, reactions);
  });

  socket.on('messageEdited', ({ messageId, newContent }) => {
    const msgEl = document.querySelector(`.message[data-id="${messageId}"] .message-text`);
    if (msgEl) msgEl.textContent = sanitizeHtml(newContent);
  });

  socket.on('messageDeleted', ({ messageId }) => {
    const msgEl = document.querySelector(`.message[data-id="${messageId}"]`);
    if (msgEl) msgEl.remove();
  });

  socket.on('messagePinned', ({ messageId, pinned }) => {
    if (pinned && currentChat) {
      loadPinnedMessages(currentChat.id);
    }
  });

  socket.on('messageUnpinned', ({ messageId }) => {
    if (currentChat) {
      loadPinnedMessages(currentChat.id);
    }
  });

  socket.on('newNotification', (notification) => {
    showPixelNotification(notification);
  });

  // WebRTC signalling
  socket.on('callOffer', async ({ callId, offer, from, isVideo }) => {
    if (confirm(`Incoming ${isVideo ? 'video' : 'voice'} call from ${from}. Accept?`)) {
      await acceptCall(callId, offer, isVideo);
    } else {
      socket.emit('callReject', { callId });
    }
  });

  socket.on('callAnswer', ({ answer }) => {
    if (peerConnection) {
      peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
    }
  });

  socket.on('callIceCandidate', ({ candidate }) => {
    if (peerConnection) {
      peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
    }
  });

  socket.on('callEnd', () => {
    endCall();
    alert('Call ended');
  });

  socket.on('callReject', () => {
    endCall();
    alert('Call rejected');
  });

  socket.on('callTimeout', () => {
    endCall();
    alert('Call timed out');
  });
}

// ==================== АВТОРИЗАЦИЯ ====================
function initAuth() {
  const tabs = document.querySelectorAll('.tab');
  if (tabs.length) {
    tabs.forEach(tab => {
      tab.addEventListener('click', (e) => {
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        e.target.classList.add('active');
        const formId = e.target.dataset.tab === 'login' ? 'login-form' : 'register-form';
        document.querySelectorAll('.auth-form').forEach(f => f.classList.remove('active'));
        document.getElementById(formId).classList.add('active');
      });
    });
  }

  const loginBtn = document.getElementById('login-btn');
  if (loginBtn) {
    loginBtn.addEventListener('click', async () => {
      const username = document.getElementById('login-username').value;
      const password = document.getElementById('login-password').value;
      try {
        const res = await fetch(`${API_BASE}/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password })
        });
        const data = await res.json();
        if (res.ok) {
          localStorage.setItem('token', data.token);
          window.location.reload(); // Простой способ перезагрузить приложение
        } else {
          showAuthError(data.error || 'Login failed');
        }
      } catch (err) {
        showAuthError('Network error');
      }
    });
  }

  const registerBtn = document.getElementById('register-btn');
  if (registerBtn) {
    registerBtn.addEventListener('click', async () => {
      const username = document.getElementById('reg-username').value;
      const password = document.getElementById('reg-password').value;
      const password2 = document.getElementById('reg-password2').value;
      if (password !== password2) {
        showAuthError('Passwords do not match');
        return;
      }
      try {
        const res = await fetch(`${API_BASE}/auth/register`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password })
        });
        const data = await res.json();
        if (res.ok) {
          localStorage.setItem('token', data.token);
          window.location.reload();
        } else {
          showAuthError(data.error || 'Registration failed');
        }
      } catch (err) {
        showAuthError('Network error');
      }
    });
  }
}

function showAuthError(msg) {
  const errorEl = document.getElementById('auth-error');
  if (errorEl) errorEl.textContent = msg;
}

// ==================== ЗАГРУЗКА ЧАТОВ ====================
async function loadChats() {
  try {
    const res = await fetch(`${API_BASE}/chats`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!res.ok) throw new Error('Failed to load chats');
    chats = await res.json();
    renderChatList();
  } catch (err) {
    console.error('Failed to load chats', err);
    showError('Could not load chats');
  }
}

function renderChatList() {
  const chatListEl = document.getElementById('chat-list');
  if (!chatListEl) return;
  chatListEl.innerHTML = '';
  chats.forEach(chat => {
    const item = document.createElement('div');
    item.className = `chat-item ${currentChat && currentChat.id === chat.id ? 'active' : ''}`;
    item.dataset.id = chat.id;
    const lastMessage = chat.last_message ? sanitizeHtml(chat.last_message.content) : '';
    const time = chat.last_message ? new Date(chat.last_message.created_at).toLocaleTimeString() : '';
    const participants = chat.participants ? chat.participants.map(p => p.username).join(', ') : '';
    const chatName = chat.name || participants;
    
    item.innerHTML = `
      <img src="${chat.avatar || 'https://i.ibb.co/QjTkyWfG/85-20260306202001.png'}" class="chat-avatar">
      <div class="chat-info">
        <div class="chat-name">${chatName}</div>
        <div class="last-message">${lastMessage}</div>
      </div>
      <div class="chat-meta">
        <span class="time">${time}</span>
        ${chat.unread_count ? `<span class="unread-badge">${chat.unread_count}</span>` : ''}
      </div>
    `;
    item.addEventListener('click', () => openChat(chat.id));
    chatListEl.appendChild(item);
  });
}

function updateChatListItem(chatId, lastMessage) {
  const chat = chats.find(c => c.id === chatId);
  if (chat) {
    chat.last_message = lastMessage;
    // Перемещаем чат вверх
    chats = [chat, ...chats.filter(c => c.id !== chatId)];
    renderChatList();
  }
}

// ==================== ОТКРЫТИЕ ЧАТА ====================
async function openChat(chatId) {
  currentChat = chats.find(c => c.id === chatId);
  const chatWindow = document.getElementById('chat-window');
  if (chatWindow) chatWindow.style.display = 'flex';
  
  const chatListPanel = document.querySelector('.chat-list-panel');
  if (chatListPanel) chatListPanel.classList.remove('active');

  try {
    const res = await fetch(`${API_BASE}/chats/${chatId}/messages`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!res.ok) throw new Error('Failed to load messages');
    const msgs = await res.json();
    messages[chatId] = msgs;
    renderMessages(msgs);
  } catch (err) {
    console.error(err);
    showError('Could not load messages');
  }

  const chatAvatar = document.getElementById('chat-avatar');
  const chatName = document.getElementById('chat-name');
  const chatStatus = document.getElementById('chat-status');
  
  if (chatAvatar) chatAvatar.src = currentChat.avatar || 'https://i.ibb.co/QjTkyWfG/85-20260306202001.png';
  if (chatName) chatName.textContent = currentChat.name || 'Chat';
  if (chatStatus) chatStatus.textContent = '';

  loadPinnedMessages(chatId);
  showRightPanel(chatId);
}

function renderMessages(msgs) {
  const area = document.getElementById('messages-area');
  if (!area) return;
  area.innerHTML = '';
  msgs.forEach(msg => renderMessage(msg));
  area.scrollTop = area.scrollHeight;
}

function renderMessage(msg) {
  const area = document.getElementById('messages-area');
  if (!area) return;
  
  const div = document.createElement('div');
  div.className = `message ${msg.sender_id === currentUser?.id ? 'own' : 'other'}`;
  div.dataset.id = msg.id;
  
  const time = new Date(msg.created_at).toLocaleTimeString();
  const status = msg.sender_id === currentUser?.id ? (msg.read ? 'read' : 'delivered') : '';
  const statusIcon = msg.sender_id === currentUser?.id ? (msg.read ? '✓✓' : '✓') : '';
  
  div.innerHTML = `
    <div class="message-bubble">
      <div class="message-text">${sanitizeHtml(msg.content)}</div>
      <div class="message-meta">
        <span class="time">${time}</span>
        ${statusIcon ? `<span class="status" data-status="${status}">${statusIcon}</span>` : ''}
      </div>
    </div>
    <div class="reactions" id="reactions-${msg.id}"></div>
  `;
  
  div.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    showMessageContextMenu(e, msg.id);
  });
  
  area.appendChild(div);
  if (msg.reactions) updateReactions(msg.id, msg.reactions);
}

// ==================== ОТПРАВКА СООБЩЕНИЙ ====================
function sendMessage() {
  const input = document.getElementById('message-text');
  if (!input) return;
  
  const text = input.value.trim();
  if (!text || !currentChat) return;
  input.value = '';

  socket.emit('sendMessage', {
    chatId: currentChat.id,
    content: text,
    replyTo: input.dataset.replyTo || null
  }, (response) => {
    if (response && response.error) {
      showError(response.error);
    }
  });
  
  delete input.dataset.replyTo;
  input.placeholder = 'Message';
}

// ==================== TYPING INDICATOR ====================
let typingTimer;
function handleTyping() {
  if (!currentChat) return;
  socket.emit('typing', { chatId: currentChat.id, isTyping: true });
  clearTimeout(typingTimer);
  typingTimer = setTimeout(() => {
    socket.emit('typing', { chatId: currentChat.id, isTyping: false });
  }, 2000);
}

function showTypingIndicator(userId, username, isTyping) {
  const statusEl = document.getElementById('chat-status');
  if (!statusEl) return;
  
  if (isTyping) {
    statusEl.textContent = `${username} печатает...`;
  } else {
    statusEl.textContent = '';
  }
}

function markAsRead(chatId, messageIds) {
  socket.emit('messagesRead', { chatId, messageIds });
}

// ==================== КОНТЕКСТНОЕ МЕНЮ СООБЩЕНИЯ ====================
function showMessageContextMenu(event, messageId) {
  const oldMenu = document.querySelector('.message-context-menu');
  if (oldMenu) oldMenu.remove();

  const menu = document.createElement('div');
  menu.className = 'message-context-menu pixel-dropdown';
  menu.style.top = event.clientY + 'px';
  menu.style.left = event.clientX + 'px';

  const items = [
    { label: 'Reply', action: () => replyToMessage(messageId) },
    { label: 'Forward', action: () => forwardMessage(messageId) },
    { label: 'Copy', action: () => copyMessage(messageId) },
    { label: 'Edit', action: () => editMessage(messageId) },
    { label: 'Delete', action: () => deleteMessage(messageId) },
    { label: 'Pin', action: () => pinMessage(messageId) }
  ];

  items.forEach(item => {
    const div = document.createElement('div');
    div.className = 'pixel-dropdown-item';
    div.textContent = item.label;
    div.addEventListener('click', () => {
      item.action();
      menu.remove();
    });
    menu.appendChild(div);
  });

  document.body.appendChild(menu);

  setTimeout(() => {
    document.addEventListener('click', function closeMenu(e) {
      if (!menu.contains(e.target)) {
        menu.remove();
        document.removeEventListener('click', closeMenu);
      }
    });
  }, 0);
}

// ==================== ДЕЙСТВИЯ С СООБЩЕНИЯМИ ====================
function replyToMessage(messageId) {
  if (!currentChat) return;
  const msg = messages[currentChat.id]?.find(m => m.id === messageId);
  if (!msg) return;
  const input = document.getElementById('message-text');
  if (!input) return;
  
  input.placeholder = `Reply to ${msg.sender?.username || 'user'}: ${msg.content.substring(0, 30)}...`;
  input.dataset.replyTo = messageId;
  input.focus();
}

function forwardMessage(messageId) {
  if (!currentChat) return;
  showForwardDialog(messageId);
}

async function copyMessage(messageId) {
  const msg = messages[currentChat.id]?.find(m => m.id === messageId);
  if (msg) {
    try {
      await navigator.clipboard.writeText(msg.content);
      alert('Copied to clipboard');
    } catch (err) {
      console.error(err);
    }
  }
}

function editMessage(messageId) {
  if (!currentChat) return;
  const msg = messages[currentChat.id]?.find(m => m.id === messageId);
  if (!msg) return;
  const newText = prompt('Edit message:', msg.content);
  if (newText && newText !== msg.content) {
    socket.emit('editMessage', { messageId, newContent: newText }, (response) => {
      if (response && response.error) {
        showError(response.error);
      }
    });
  }
}

function deleteMessage(messageId) {
  if (!currentChat) return;
  if (confirm('Delete this message?')) {
    socket.emit('deleteMessage', { messageId }, (response) => {
      if (response && response.error) {
        showError(response.error);
      }
    });
  }
}

function pinMessage(messageId) {
  socket.emit('pinMessage', { messageId }, (response) => {
    if (response && response.error) {
      showError(response.error);
    }
  });
}

// ==================== ПЕРЕСЫЛКА СООБЩЕНИЯ ====================
function showForwardDialog(messageId) {
  const modal = document.createElement('div');
  modal.className = 'pixel-modal';
  modal.innerHTML = `
    <div class="modal-content">
      <h3>Forward message</h3>
      <div class="chat-list" id="forward-chat-list"></div>
      <button class="pixel-button" onclick="this.closest('.pixel-modal').remove()">Cancel</button>
    </div>
  `;
  document.body.appendChild(modal);
  
  const list = modal.querySelector('#forward-chat-list');
  if (!list) return;
  
  chats.forEach(chat => {
    const item = document.createElement('div');
    item.className = 'chat-item';
    const chatName = chat.name || (chat.participants ? chat.participants.map(p => p.username).join(', ') : '');
    item.innerHTML = `
      <img src="${chat.avatar || 'https://i.ibb.co/QjTkyWfG/85-20260306202001.png'}" class="chat-avatar">
      <div>${chatName}</div>
    `;
    item.addEventListener('click', () => {
      socket.emit('forwardMessage', { messageId, toChatId: chat.id }, (response) => {
        if (response && response.error) {
          showError(response.error);
        } else {
          modal.remove();
          alert('Message forwarded');
        }
      });
    });
    list.appendChild(item);
  });
}

// ==================== РЕАКЦИИ ====================
function addReaction(messageId, emoji) {
  socket.emit('addReaction', { messageId, emoji }, (response) => {
    if (response && response.error) {
      showError(response.error);
    }
  });
}

function updateReactions(messageId, reactions) {
  const container = document.getElementById(`reactions-${messageId}`);
  if (!container) return;
  container.innerHTML = '';
  reactions.forEach(r => {
    const span = document.createElement('span');
    span.className = 'reaction';
    span.textContent = `${r.emoji} ${r.count}`;
    span.addEventListener('click', () => addReaction(messageId, r.emoji));
    container.appendChild(span);
  });
}

// ==================== ПАНЕЛЬ ЗАКРЕПЛЁННЫХ СООБЩЕНИЙ ====================
async function loadPinnedMessages(chatId) {
  try {
    const res = await fetch(`${API_BASE}/chats/${chatId}/pinned`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    pinnedMessages = await res.json();
    renderPinnedPanel();
  } catch (err) {
    console.error(err);
  }
}

function renderPinnedPanel() {
  let panel = document.getElementById('pinned-panel');
  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'pinned-panel';
    panel.className = 'pinned-panel pixel-panel';
    const chatWindow = document.querySelector('.chat-window');
    if (chatWindow) {
      chatWindow.insertBefore(panel, document.querySelector('.messages-area'));
    }
  }
  panel.innerHTML = '<h4>Pinned</h4>';
  pinnedMessages.forEach(msg => {
    const item = document.createElement('div');
    item.className = 'pinned-message';
    item.innerHTML = `
      <span>${sanitizeHtml(msg.content)}</span>
      <button onclick="jumpToMessage('${msg.id}')">🔝</button>
    `;
    panel.appendChild(item);
  });
  panel.style.display = pinnedMessages.length ? 'block' : 'none';
}

function jumpToMessage(messageId) {
  const msgEl = document.querySelector(`.message[data-id="${messageId}"]`);
  if (msgEl) {
    msgEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    msgEl.classList.add('highlight');
    setTimeout(() => msgEl.classList.remove('highlight'), 2000);
  }
}

// ==================== EMOJI PICKER ====================
function toggleEmojiPicker() {
  const picker = document.getElementById('emoji-picker');
  if (!picker) {
    createEmojiPicker();
  } else {
    picker.style.display = picker.style.display === 'none' ? 'grid' : 'none';
  }
}

function createEmojiPicker() {
  const picker = document.createElement('div');
  picker.id = 'emoji-picker';
  picker.className = 'emoji-picker pixel-panel';
  picker.style.display = 'grid';
  
  const emojis = ['😀','😂','😍','🥰','😎','😢','😡','👍','❤️','🔥','🎉','💯','🤔','😴','🤯','🥶'];
  emojis.forEach(emoji => {
    const btn = document.createElement('button');
    btn.className = 'emoji-btn pixel-button small';
    btn.textContent = emoji;
    btn.addEventListener('click', () => {
      insertEmoji(emoji);
      picker.style.display = 'none';
    });
    picker.appendChild(btn);
  });
  
  const closeBtn = document.createElement('button');
  closeBtn.className = 'pixel-button small';
  closeBtn.textContent = '❌';
  closeBtn.addEventListener('click', () => picker.style.display = 'none');
  picker.appendChild(closeBtn);
  
  const inputArea = document.querySelector('.message-input-area');
  if (inputArea) {
    inputArea.appendChild(picker);
  }
}

function insertEmoji(emoji) {
  const input = document.getElementById('message-text');
  if (input) {
    input.value += emoji;
    input.focus();
  }
}

// ==================== ЗАГРУЗКА ФАЙЛОВ ====================
async function uploadFiles(files) {
  if (!currentChat) return;
  
  for (let file of files) {
    const uploadId = generateId();
    const controller = new AbortController();
    uploadControllers.set(uploadId, controller);

    const formData = new FormData();
    formData.append('file', file);
    
    renderUploadProgress(uploadId, file.name);

    try {
      const response = await fetch(`${API_BASE}/media/upload`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: formData,
        signal: controller.signal
      });

      if (!response.ok) throw new Error('Upload failed');
      
      const data = await response.json();
      socket.emit('sendMessage', {
        chatId: currentChat.id,
        content: data.url,
        type: data.mimeType.startsWith('image/') ? 'image' : 
              data.mimeType.startsWith('video/') ? 'video' : 'file'
      }, (response) => {
        if (response && response.error) {
          showError(response.error);
        }
      });
      removeUploadProgress(uploadId);
      uploadControllers.delete(uploadId);
    } catch (err) {
      if (err.name === 'AbortError') {
        console.log('Upload cancelled');
      } else {
        console.error(err);
        alert('Upload failed');
      }
      removeUploadProgress(uploadId);
    }
  }
}

function renderUploadProgress(id, fileName) {
  const area = document.getElementById('messages-area');
  if (!area) return;
  
  const div = document.createElement('div');
  div.id = `upload-${id}`;
  div.className = 'upload-progress pixel-panel';
  div.innerHTML = `
    <span>${fileName}</span>
    <progress value="0" max="100"></progress>
    <button onclick="window.cancelUpload('${id}')">Cancel</button>
  `;
  area.appendChild(div);
}

function removeUploadProgress(id) {
  const el = document.getElementById(`upload-${id}`);
  if (el) el.remove();
}

window.cancelUpload = function(id) {
  const controller = uploadControllers.get(id);
  if (controller) {
    controller.abort();
    uploadControllers.delete(id);
  }
  removeUploadProgress(id);
};

// ==================== DRAG & DROP ====================
function initDragAndDrop() {
  const messagesArea = document.getElementById('messages-area');
  if (!messagesArea) return;
  
  messagesArea.addEventListener('dragover', (e) => {
    e.preventDefault();
    messagesArea.classList.add('drag-over');
  });
  messagesArea.addEventListener('dragleave', () => {
    messagesArea.classList.remove('drag-over');
  });
  messagesArea.addEventListener('drop', (e) => {
    e.preventDefault();
    messagesArea.classList.remove('drag-over');
    const files = e.dataTransfer.files;
    if (files.length) {
      uploadFiles(files);
    }
  });
}

// ==================== МЕДИА ГАЛЕРЕЯ ====================
function showRightPanel(chatId) {
  let panel = document.getElementById('right-panel');
  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'right-panel';
    panel.className = 'right-panel pixel-panel';
    const mainScreen = document.getElementById('main-screen');
    if (mainScreen) {
      mainScreen.appendChild(panel);
    }
  }
  
  panel.innerHTML = `
    <div class="panel-tabs">
      <button class="tab active" data-tab="media">Media</button>
      <button class="tab" data-tab="files">Files</button>
      <button class="tab" data-tab="links">Links</button>
      <button class="tab" data-tab="voice">Voice</button>
    </div>
    <div class="panel-content" id="panel-content"></div>
  `;
  panel.style.display = 'block';
  
  loadMedia(chatId, 'media');
  
  panel.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      panel.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      loadMedia(chatId, tab.dataset.tab);
    });
  });
}

async function loadMedia(chatId, type) {
  try {
    const res = await fetch(`${API_BASE}/media/chat/${chatId}?type=${type}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!res.ok) throw new Error('Failed to load media');
    const items = await res.json();
    renderMediaItems(items, type);
  } catch (err) {
    console.error(err);
  }
}

function renderMediaItems(items, type) {
  const content = document.getElementById('panel-content');
  if (!content) return;
  content.innerHTML = '';
  
  if (items.length === 0) {
    content.innerHTML = '<p class="no-items">No items</p>';
    return;
  }
  
  if (type === 'media') {
    content.className = 'panel-content media-grid';
    items.forEach(item => {
      const div = document.createElement('div');
      div.className = 'media-item';
      if (item.type === 'image') {
        div.innerHTML = `<img src="${item.content}" onclick="window.openMedia('${item.id}')">`;
      } else if (item.type === 'video') {
        div.innerHTML = `<video src="${item.content}" onclick="window.openMedia('${item.id}')"></video>`;
      }
      content.appendChild(div);
    });
  } else {
    content.className = 'panel-content list-view';
    items.forEach(item => {
      const div = document.createElement('div');
      div.className = 'file-item';
      div.innerHTML = `
        <span>${item.content}</span>
        <button onclick="window.downloadFile('${item.id}')">⬇️</button>
      `;
      content.appendChild(div);
    });
  }
}

window.openMedia = function(mediaId) {
  window.open(`${API_BASE}/media/file/${mediaId}`, '_blank');
};

window.downloadFile = async function(fileId) {
  try {
    const res = await fetch(`${API_BASE}/media/file/${fileId}/download`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!res.ok) throw new Error('Download failed');
    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'file';
    a.click();
    window.URL.revokeObjectURL(url);
  } catch (err) {
    console.error(err);
    alert('Download failed');
  }
};

// ==================== ПОИСК С ДЕБОУНСОМ ====================
const debouncedSearch = debounce(async (query) => {
  if (query.length < 2) return;
  try {
    const res = await fetch(`${API_BASE}/search?q=${encodeURIComponent(query)}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const results = await res.json();
    displaySearchResults(results);
  } catch (err) {
    console.error(err);
  }
}, 300);

function onSearchInput(e) {
  debouncedSearch(e.target.value);
}

function displaySearchResults(results) {
  // Здесь можно отобразить результаты в отдельном окне или панели
  console.log('Search results', results);
}

// ==================== WEBRTC ЗВОНКИ ====================
async function startCall(isVideo = false) {
  if (!currentChat) return;
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ video: isVideo, audio: true });
    peerConnection = new RTCPeerConnection({ 
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
      ] 
    });
    localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));

    peerConnection.ontrack = (event) => {
      remoteStream = event.streams[0];
      showCallUI(isVideo);
    };

    peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        socket.emit('callIceCandidate', { chatId: currentChat.id, candidate: event.candidate });
      }
    };

    peerConnection.oniceconnectionstatechange = () => {
      if (peerConnection.iceConnectionState === 'disconnected' || 
          peerConnection.iceConnectionState === 'failed') {
        handleConnectionLost();
      }
    };

    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    socket.emit('callOffer', { chatId: currentChat.id, offer, isVideo });
    callActive = true;

    setTimeout(() => {
      if (callActive && !peerConnection.currentRemoteDescription) {
        socket.emit('callTimeout', { chatId: currentChat.id });
        endCall();
        alert('Call timed out');
      }
    }, 30000);
  } catch (err) {
    console.error('Call failed', err);
    alert('Could not access camera/microphone');
  }
}

async function acceptCall(callId, offer, isVideo) {
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ video: isVideo, audio: true });
    peerConnection = new RTCPeerConnection({ 
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
      ] 
    });
    localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));

    peerConnection.ontrack = (event) => {
      remoteStream = event.streams[0];
      showCallUI(isVideo);
    };

    peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        socket.emit('callIceCandidate', { chatId: currentChat.id, candidate: event.candidate });
      }
    };

    await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    socket.emit('callAnswer', { chatId: currentChat.id, answer });
    callActive = true;
    currentCallId = callId;
  } catch (err) {
    console.error(err);
  }
}

function endCall() {
  if (peerConnection) peerConnection.close();
  if (localStream) localStream.getTracks().forEach(t => t.stop());
  peerConnection = null;
  localStream = null;
  remoteStream = null;
  callActive = false;
  currentCallId = null;
  const callWindow = document.getElementById('call-window');
  if (callWindow) callWindow.remove();
  socket.emit('callEnd', { chatId: currentChat?.id });
}

function handleConnectionLost() {
  alert('Connection lost');
  endCall();
}

function showCallUI(isVideo) {
  let callWindow = document.getElementById('call-window');
  if (!callWindow) {
    callWindow = document.createElement('div');
    callWindow.id = 'call-window';
    callWindow.className = 'call-window pixel-panel';
    document.body.appendChild(callWindow);
  }

  callWindow.innerHTML = `
    <div class="call-header">
      <span>Call with ${currentChat?.name || 'User'}</span>
      <button onclick="endCall()">❌</button>
    </div>
    <div class="call-video">
      ${isVideo ? '<video id="remote-video" autoplay></video><video id="local-video" autoplay muted></video>' : '<div class="call-avatar">👤</div>'}
    </div>
    <div class="call-controls">
      <button class="pixel-button" onclick="toggleMute()">🔇 Mute</button>
      ${isVideo ? '<button class="pixel-button" onclick="toggleCamera()">📷 Camera</button>' : ''}
      <button class="pixel-button danger" onclick="endCall()">📞 End</button>
    </div>
  `;

  if (isVideo) {
    const localVideo = callWindow.querySelector('#local-video');
    const remoteVideo = callWindow.querySelector('#remote-video');
    if (localVideo && localStream) localVideo.srcObject = localStream;
    if (remoteVideo && remoteStream) remoteVideo.srcObject = remoteStream;
  }
}

function toggleMute() {
  if (localStream) {
    const audioTrack = localStream.getAudioTracks()[0];
    if (audioTrack) audioTrack.enabled = !audioTrack.enabled;
  }
}

function toggleCamera() {
  if (localStream) {
    const videoTrack = localStream.getVideoTracks()[0];
    if (videoTrack) videoTrack.enabled = !videoTrack.enabled;
  }
}

// ==================== AI ФУНКЦИИ ====================
async function summarizeChat() {
  if (!currentChat) return;
  try {
    const res = await fetch(`${API_BASE}/ai/summarize`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json', 
        'Authorization': `Bearer ${token}` 
      },
      body: JSON.stringify({ chatId: currentChat.id })
    });
    const data = await res.json();
    alert('Summary: ' + data.summary);
  } catch (err) {
    console.error(err);
  }
}

async function translateMessage(messageId, targetLang = 'en') {
  if (!currentChat) return;
  const msg = messages[currentChat.id]?.find(m => m.id === messageId);
  if (!msg) return;
  try {
    const res = await fetch(`${API_BASE}/ai/translate`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json', 
        'Authorization': `Bearer ${token}` 
      },
      body: JSON.stringify({ text: msg.content, targetLang })
    });
    const data = await res.json();
    alert('Translation: ' + data.translated);
  } catch (err) {
    console.error(err);
  }
}

async function smartReply() {
  if (!currentChat) return;
  try {
    const res = await fetch(`${API_BASE}/ai/smart-reply`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json', 
        'Authorization': `Bearer ${token}` 
      },
      body: JSON.stringify({ chatId: currentChat.id })
    });
    const data = await res.json();
    const suggestions = data.suggestions.join('\n');
    const chosen = prompt('Smart replies:\n' + suggestions + '\n\nType your choice or cancel');
    if (chosen) {
      const input = document.getElementById('message-text');
      if (input) input.value = chosen;
    }
  } catch (err) {
    console.error(err);
  }
}

// ==================== МОБИЛЬНЫЙ ИНТЕРФЕЙС ====================
function initMobileUI() {
  // Bottom navigation
  const bottomNav = document.createElement('div');
  bottomNav.className = 'bottom-nav';
  bottomNav.innerHTML = `
    <button class="nav-item" data-view="chats">💬</button>
    <button class="nav-item" data-view="contacts">👤</button>
    <button class="nav-item" data-view="search">🔍</button>
    <button class="nav-item" data-view="calls">📞</button>
    <button class="nav-item" data-view="settings">⚙</button>
  `;
  document.getElementById('app').appendChild(bottomNav);

  // Floating Action Button
  const fab = document.createElement('button');
  fab.className = 'fab pixel-button';
  fab.innerHTML = '✚';
  fab.addEventListener('click', showCreateChatModal);
  document.getElementById('app').appendChild(fab);

  // Swipe gestures
  let touchstartX = 0;
  document.addEventListener('touchstart', e => {
    touchstartX = e.changedTouches[0].screenX;
  });
  document.addEventListener('touchend', e => {
    const touchendX = e.changedTouches[0].screenX;
    const swiped = touchendX - touchstartX;
    if (Math.abs(swiped) < 50) return;
    const chatListPanel = document.querySelector('.chat-list-panel');
    if (!chatListPanel) return;
    if (swiped > 0 && window.innerWidth <= 768) {
      chatListPanel.classList.add('active');
    } else if (swiped < 0 && chatListPanel.classList.contains('active')) {
      chatListPanel.classList.remove('active');
    }
  });
}

// ==================== СОЗДАНИЕ ЧАТА ====================
function showCreateChatModal() {
  const modal = document.createElement('div');
  modal.className = 'pixel-modal';
  modal.innerHTML = `
    <div class="modal-content">
      <h3>Create New Chat</h3>
      <select id="chat-type">
        <option value="private">Private Chat</option>
        <option value="group">Group</option>
        <option value="channel">Channel</option>
      </select>
      <input type="text" id="chat-name" placeholder="Name (optional)">
      <textarea id="chat-description" placeholder="Description (optional)"></textarea>
      <div id="member-selector" style="display:none;">
        <input type="text" id="member-search" placeholder="Search users...">
        <div id="member-list"></div>
      </div>
      <button id="create-chat-btn" class="pixel-button primary">Create</button>
      <button class="pixel-button" onclick="this.closest('.pixel-modal').remove()">Cancel</button>
    </div>
  `;
  document.body.appendChild(modal);
  
  const typeSelect = modal.querySelector('#chat-type');
  const memberSelector = modal.querySelector('#member-selector');
  typeSelect.addEventListener('change', () => {
    memberSelector.style.display = (typeSelect.value === 'group') ? 'block' : 'none';
  });
  
  modal.querySelector('#create-chat-btn').addEventListener('click', async () => {
    const type = typeSelect.value;
    const name = modal.querySelector('#chat-name').value;
    const description = modal.querySelector('#chat-description').value;
    let memberIds = [];
    if (type === 'group') {
      // Здесь можно добавить логику выбора пользователей
    }
    try {
      const res = await fetch(`${API_BASE}/chats`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json', 
          'Authorization': `Bearer ${token}` 
        },
        body: JSON.stringify({ type, name, description, memberIds })
      });
      const data = await res.json();
      if (res.ok) {
        modal.remove();
        loadChats();
      } else {
        alert(data.error);
      }
    } catch (err) {
      alert('Failed to create chat');
    }
  });
}

// ==================== ПРОФИЛЬ ====================
function showEditProfileModal() {
  fetch(`${API_BASE}/profile/me`, { 
    headers: { 'Authorization': `Bearer ${token}` } 
  })
    .then(res => res.json())
    .then(user => {
      const modal = document.createElement('div');
      modal.className = 'pixel-modal';
      modal.innerHTML = `
        <div class="modal-content">
          <h3>Edit Profile</h3>
          <img src="${user.avatar || 'https://i.ibb.co/QjTkyWfG/85-20260306202001.png'}" class="avatar-preview">
          <input type="file" id="avatar-upload" accept="image/*">
          <input type="text" id="edit-username" value="${user.username}" placeholder="Username">
          <textarea id="edit-bio" placeholder="Bio">${user.bio || ''}</textarea>
          <button id="save-profile-btn" class="pixel-button primary">Save</button>
          <button class="pixel-button" onclick="this.closest('.pixel-modal').remove()">Cancel</button>
        </div>
      `;
      document.body.appendChild(modal);
      
      modal.querySelector('#avatar-upload').addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (file) {
          const formData = new FormData();
          formData.append('file', file);
          const res = await fetch(`${API_BASE}/media/upload`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` },
            body: formData
          });
          const data = await res.json();
          if (res.ok) {
            modal.querySelector('.avatar-preview').src = data.url;
            modal.dataset.newAvatar = data.url;
          }
        }
      });
      
      modal.querySelector('#save-profile-btn').addEventListener('click', async () => {
        const username = modal.querySelector('#edit-username').value;
        const bio = modal.querySelector('#edit-bio').value;
        const avatar = modal.dataset.newAvatar;
        const body = { username, bio };
        if (avatar) body.avatar = avatar;
        
        const res = await fetch(`${API_BASE}/profile/me`, {
          method: 'PUT',
          headers: { 
            'Content-Type': 'application/json', 
            'Authorization': `Bearer ${token}` 
          },
          body: JSON.stringify(body)
        });
        if (res.ok) {
          modal.remove();
          // обновить отображение профиля
          loadChats(); // перезагрузить чаты, чтобы обновить аватар в сайдбаре
        } else {
          alert('Update failed');
        }
      });
    });
}

// ==================== НАСТРОЙКИ ====================
function showSettingsPage() {
  const main = document.getElementById('main-screen');
  if (!main) return;
  
  main.innerHTML = `
    <div class="settings-page pixel-panel">
      <h2>Settings</h2>
      <div class="settings-section">
        <h3>Appearance</h3>
        <select id="theme-select">
          <option value="dark">Dark</option>
          <option value="light">Light</option>
          <option value="neon">Neon</option>
        </select>
      </div>
      <div class="settings-section">
        <h3>Notifications</h3>
        <label><input type="checkbox" id="notif-check"> Enable notifications</label>
      </div>
      <div class="settings-section">
        <h3>Privacy</h3>
        <label>Last seen: 
          <select id="privacy-lastseen">
            <option value="everyone">Everyone</option>
            <option value="contacts">Contacts</option>
            <option value="nobody">Nobody</option>
          </select>
        </label>
      </div>
      <div class="settings-section">
        <h3>Language</h3>
        <select id="lang-select">
          <option value="en">English</option>
          <option value="ru">Русский</option>
        </select>
      </div>
      <button id="save-settings" class="pixel-button primary">Save</button>
      <button id="logout-btn" class="pixel-button">Logout</button>
    </div>
  `;
  
  fetch(`${API_BASE}/settings`, { 
    headers: { 'Authorization': `Bearer ${token}` } 
  })
    .then(res => res.json())
    .then(settings => {
      const themeSelect = document.getElementById('theme-select');
      const notifCheck = document.getElementById('notif-check');
      const privacyLastSeen = document.getElementById('privacy-lastseen');
      const langSelect = document.getElementById('lang-select');
      
      if (themeSelect) themeSelect.value = settings.theme || 'dark';
      if (notifCheck) notifCheck.checked = settings.notifications?.enabled !== false;
      if (privacyLastSeen) privacyLastSeen.value = settings.privacy?.lastSeen || 'everyone';
      if (langSelect) langSelect.value = settings.language || 'en';
    });
  
  const saveBtn = document.getElementById('save-settings');
  if (saveBtn) {
    saveBtn.addEventListener('click', async () => {
      const themeSelect = document.getElementById('theme-select');
      const notifCheck = document.getElementById('notif-check');
      const privacyLastSeen = document.getElementById('privacy-lastseen');
      const langSelect = document.getElementById('lang-select');
      
      const settings = {
        theme: themeSelect ? themeSelect.value : 'dark',
        notifications: { enabled: notifCheck ? notifCheck.checked : true },
        privacy: { lastSeen: privacyLastSeen ? privacyLastSeen.value : 'everyone' },
        language: langSelect ? langSelect.value : 'en'
      };
      await fetch(`${API_BASE}/settings`, {
        method: 'PUT',
        headers: { 
          'Content-Type': 'application/json', 
          'Authorization': `Bearer ${token}` 
        },
        body: JSON.stringify(settings)
      });
      alert('Settings saved');
    });
  }
  
  const logoutBtn = document.getElementById('logout-btn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
      localStorage.removeItem('token');
      location.reload();
    });
  }
}

// ==================== ОТОБРАЖЕНИЕ ГЛАВНОГО ЭКРАНА ====================
function showMainScreen() {
  const authScreen = document.getElementById('auth-screen');
  const mainScreen = document.getElementById('main-screen');
  
  if (authScreen) authScreen.classList.remove('active');
  if (mainScreen) mainScreen.classList.add('active');
  
  renderMainLayout();
  loadChats();
  initMobileUI();
  initDragAndDrop();
}

function renderMainLayout() {
  const main = document.getElementById('main-screen');
  if (!main) return;
  
  main.innerHTML = `
    <div class="sidebar">
      <div class="logo" onclick="UI.switchView('chats')">
        <img src="https://i.ibb.co/QjTkyWfG/85-20260306202001.png" alt="CraneApp">
      </div>
      <div class="sidebar-menu">
        <div class="sidebar-item" data-view="chats" onclick="UI.switchView('chats')" title="Chats">💬</div>
        <div class="sidebar-item" data-view="contacts" onclick="UI.switchView('contacts')" title="Contacts">👤</div>
        <div class="sidebar-item" data-view="search" onclick="UI.openSearch()" title="Search">🔍</div>
        <div class="sidebar-item" data-view="calls" onclick="UI.switchView('calls')" title="Calls">📞</div>
        <div class="sidebar-item" data-view="settings" onclick="UI.switchView('settings')" title="Settings">⚙</div>
        <div class="sidebar-item profile" onclick="UI.openProfile()" title="Profile">
          <img id="sidebar-avatar" src="https://i.ibb.co/QjTkyWfG/85-20260306202001.png" alt="Profile">
        </div>
      </div>
    </div>

    <div class="chat-list-panel">
      <div class="panel-header">
        <h2>Chats</h2>
        <button class="new-chat-btn pixel-button small" onclick="UI.showCreateChatModal()">+</button>
      </div>
      <div class="search-box">
        <input type="text" id="chat-search" placeholder="Search chats..." class="pixel-input" oninput="onSearchInput(event)">
      </div>
      <div class="chat-list" id="chat-list"></div>
    </div>

    <div id="chat-window" class="chat-window" style="display: none;">
      <div class="chat-header">
        <button class="back-btn pixel-button icon" onclick="UI.closeChat()">←</button>
        <img id="chat-avatar" src="https://i.ibb.co/QjTkyWfG/85-20260306202001.png" alt="" class="chat-avatar">
        <div class="chat-info">
          <h3 id="chat-name"></h3>
          <span id="chat-status" class="status"></span>
        </div>
        <div class="chat-actions">
          <button class="pixel-button icon" onclick="UI.startCall()" title="Voice call">📞</button>
          <button class="pixel-button icon" onclick="UI.startVideoCall()" title="Video call">📹</button>
          <button class="pixel-button icon" onclick="UI.showChatMenu()" title="Menu">⋮</button>
        </div>
      </div>
      <div class="messages-area" id="messages-area"></div>
      <div class="message-input-area">
        <button class="pixel-button icon emoji-btn" onclick="UI.toggleEmojiPicker()" title="Emoji">😀</button>
        <button class="pixel-button icon attach-btn" onclick="UI.showAttachMenu()" title="Attach">📎</button>
        <input type="text" id="message-text" class="pixel-input" placeholder="Message" onkeypress="UI.handleKeyPress(event)" oninput="UI.handleTyping()">
        <button class="pixel-button primary send-btn" onclick="UI.sendMessage()" title="Send">➤</button>
      </div>
    </div>
  `;

  const rightPanel = document.createElement('div');
  rightPanel.id = 'right-panel';
  rightPanel.className = 'right-panel pixel-panel';
  rightPanel.style.display = 'none';
  main.appendChild(rightPanel);
}

// ==================== ГЛОБАЛЬНЫЙ UI ОБЪЕКТ ====================
window.UI = {
  switchView: (view) => {
    console.log('Switching to', view);
    if (view === 'settings') {
      showSettingsPage();
    }
  },
  openSearch: () => {
    // Показать поиск
    alert('Search feature coming soon');
  },
  openProfile: () => {
    showEditProfileModal();
  },
  showCreateChatModal,
  closeChat: () => {
    const chatWindow = document.getElementById('chat-window');
    if (chatWindow) chatWindow.style.display = 'none';
    currentChat = null;
  },
  startCall: () => startCall(false),
  startVideoCall: () => startCall(true),
  showChatMenu: () => {
    // Меню чата
  },
  toggleEmojiPicker,
  showAttachMenu: () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = 'image/*,video/*,audio/*,.pdf,.doc,.docx,.txt';
    input.onchange = (e) => {
      if (e.target.files.length) {
        uploadFiles(e.target.files);
      }
    };
    input.click();
  },
  sendMessage,
  handleTyping,
  handleKeyPress: (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }
};

window.AI = {
  summarizeChat,
  translateMessage: (id) => translateMessage(id, 'en'),
  smartReply
};

// ==================== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ====================
function playNotificationSound() {
  // Можно реализовать позже
}

function showPixelNotification(notification) {
  // Показ in-app уведомления в Pixel стиле (можно реализовать позже)
  console.log('Notification:', notification);
}

// ==================== ИНИЦИАЛИЗАЦИЯ ====================
document.addEventListener('DOMContentLoaded', () => {
  if (token) {
    // Пытаемся получить информацию о текущем пользователе
    fetch(`${API_BASE}/profile/me`, {
      headers: { 'Authorization': `Bearer ${token}` }
    })
      .then(res => {
        if (res.ok) {
          return res.json();
        } else {
          throw new Error('Invalid token');
        }
      })
      .then(user => {
        currentUser = user;
        connectSocket();
        showMainScreen();
      })
      .catch(err => {
        console.error(err);
        localStorage.removeItem('token');
        initAuth();
      });
  } else {
    initAuth();
  }
});
