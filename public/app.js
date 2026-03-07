// public/app.js – клиентская логика CraneApp Messenger
// ЧАСТЬ 1: Глобальные переменные, утилиты, инициализация, авторизация

// ==================== ГЛОБАЛЬНЫЕ ПЕРЕМЕННЫЕ ====================
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
let notificationContainer = null;
let activeCalls = new Map();
let reconnectAttempts = 0;
let pingInterval = null;
let messageQueue = [];
let isOnline = navigator.onLine;
let currentTheme = 'dark';
let currentLanguage = 'ru';

const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_DELAY = 2000;
const PING_INTERVAL = 30000;

// Токен из localStorage
let token = localStorage.getItem('token');

// Базовый URL API
const API_BASE = '/api';

// ==================== УТИЛИТЫ ====================

/**
 * Генерирует уникальный ID (для временных сообщений, загрузок и т.д.)
 * @returns {string}
 */
function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substring(2) + 
         Math.random().toString(36).substring(2);
}

/**
 * Очищает HTML от опасных тегов (XSS protection)
 * @param {string} text
 * @returns {string}
 */
function sanitizeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Debounce функция для поиска и других частых событий
 * @param {Function} func
 * @param {number} wait
 * @returns {Function}
 */
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

/**
 * Throttle функция для ограничения частоты вызовов
 * @param {Function} func
 * @param {number} limit
 * @returns {Function}
 */
function throttle(func, limit) {
  let inThrottle;
  return function(...args) {
    if (!inThrottle) {
      func.apply(this, args);
      inThrottle = setTimeout(() => inThrottle = false, limit);
    }
  };
}

/**
 * Показывает ошибку пользователю
 * @param {string} message
 */
function showError(message) {
  const notification = document.createElement('div');
  notification.className = 'notification error';
  notification.innerHTML = `
    <div class="notification-title">Error</div>
    <div class="notification-body">${message}</div>
    <div class="notification-time">just now</div>
  `;
  showNotification(notification);
}

/**
 * Показывает успешное уведомление
 * @param {string} message
 */
function showSuccess(message) {
  const notification = document.createElement('div');
  notification.className = 'notification success';
  notification.innerHTML = `
    <div class="notification-title">Success</div>
    <div class="notification-body">${message}</div>
    <div class="notification-time">just now</div>
  `;
  showNotification(notification);
}

/**
 * Показывает уведомление
 * @param {HTMLElement} notification
 */
function showNotification(notification) {
  if (!notificationContainer) {
    notificationContainer = document.createElement('div');
    notificationContainer.className = 'notification-container';
    document.body.appendChild(notificationContainer);
  }
  
  notificationContainer.appendChild(notification);
  
  // Автоматически скрываем через 5 секунд
  setTimeout(() => {
    if (notification.parentNode) {
      notification.style.animation = 'slideOutRight 0.3s ease';
      setTimeout(() => {
        if (notification.parentNode) {
          notification.remove();
        }
      }, 300);
    }
  }, 5000);
}

/**
 * Показывает in-app уведомление в Pixel стиле
 * @param {Object} notification
 */
function showPixelNotification(notification) {
  const notifEl = document.createElement('div');
  notifEl.className = 'notification';
  notifEl.innerHTML = `
    <div class="notification-title">${notification.type || 'Notification'}</div>
    <div class="notification-body">${notification.payload?.text || ''}</div>
    <div class="notification-time">${new Date(notification.createdAt).toLocaleTimeString()}</div>
  `;
  
  notifEl.addEventListener('click', () => {
    if (notification.payload?.url) {
      window.location.href = notification.payload.url;
    }
  });
  
  showNotification(notifEl);
}

/**
 * Воспроизводит звук уведомления
 */
function playNotificationSound() {
  const audio = new Audio('/sounds/notification.mp3');
  audio.play().catch(err => console.log('Audio play failed:', err));
}

/**
 * Форматирует время сообщения
 * @param {string} dateStr
 * @returns {string}
 */
function formatMessageTime(dateStr) {
  const date = new Date(dateStr);
  const now = new Date();
  const diff = now - date;
  
  if (diff < 60 * 1000) return 'now';
  if (diff < 60 * 60 * 1000) return `${Math.floor(diff / (60 * 1000))}m`;
  if (diff < 24 * 60 * 60 * 1000) return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return date.toLocaleDateString([], { day: '2-digit', month: '2-digit' });
}

/**
 * Форматирует дату
 * @param {string} dateStr
 * @returns {string}
 */
function formatDate(dateStr) {
  const date = new Date(dateStr);
  return date.toLocaleDateString('ru-RU', { 
    day: 'numeric', 
    month: 'long', 
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

/**
 * Проверяет, находится ли элемент в области видимости
 * @param {HTMLElement} el
 * @returns {boolean}
 */
function isElementInViewport(el) {
  const rect = el.getBoundingClientRect();
  return (
    rect.top >= 0 &&
    rect.left >= 0 &&
    rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) &&
    rect.right <= (window.innerWidth || document.documentElement.clientWidth)
  );
}

/**
 * Прокручивает элемент в видимую область
 * @param {HTMLElement} el
 * @param {string} behavior
 */
function scrollIntoView(el, behavior = 'smooth') {
  if (el) {
    el.scrollIntoView({ behavior, block: 'center' });
  }
}

/**
 * Копирует текст в буфер обмена
 * @param {string} text
 * @returns {Promise<boolean>}
 */
async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    showSuccess('Copied to clipboard');
    return true;
  } catch (err) {
    console.error('Copy failed:', err);
    showError('Failed to copy');
    return false;
  }
}

/**
 * Скачивает файл по URL
 * @param {string} url
 * @param {string} filename
 */
function downloadFile(url, filename) {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename || 'download';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

/**
 * Получает параметры из URL
 * @returns {Object}
 */
function getUrlParams() {
  const params = new URLSearchParams(window.location.search);
  const result = {};
  for (const [key, value] of params) {
    result[key] = value;
  }
  return result;
}

/**
 * Обновляет параметры URL без перезагрузки
 * @param {Object} params
 */
function updateUrlParams(params) {
  const url = new URL(window.location);
  for (const [key, value] of Object.entries(params)) {
    if (value === null) {
      url.searchParams.delete(key);
    } else {
      url.searchParams.set(key, value);
    }
  }
  window.history.pushState({}, '', url);
}

// ==================== SERVICE WORKER ====================

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then(registration => {
        console.log('ServiceWorker registered:', registration);
        
        // Проверяем обновления
        registration.addEventListener('updatefound', () => {
          const newWorker = registration.installing;
          console.log('New service worker found:', newWorker);
          
          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              console.log('New version available');
              showNotification({
                type: 'update',
                payload: {
                  text: 'New version available. Refresh to update.'
                }
              });
            }
          });
        });
      })
      .catch(err => {
        console.error('ServiceWorker registration failed:', err);
      });
  });

  // Обработка сообщений от Service Worker
  navigator.serviceWorker.addEventListener('message', event => {
    console.log('Message from ServiceWorker:', event.data);
  });
}

// ==================== ONLINE / OFFLINE ====================

window.addEventListener('online', () => {
  console.log('App is online');
  isOnline = true;
  showSuccess('Connection restored');
  if (socket && !socket.connected) {
    socket.connect();
  }
  processMessageQueue();
});

window.addEventListener('offline', () => {
  console.log('App is offline');
  isOnline = false;
  showError('No internet connection');
});

async function processMessageQueue() {
  if (!isOnline || messageQueue.length === 0) return;
  
  console.log('Processing message queue:', messageQueue.length);
  
  while (messageQueue.length > 0) {
    const message = messageQueue.shift();
    try {
      await sendMessageWithRetry(message);
    } catch (err) {
      console.error('Failed to send queued message:', err);
      messageQueue.unshift(message);
      break;
    }
  }
}

async function sendMessageWithRetry(message, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      return await new Promise((resolve, reject) => {
        socket.emit('sendMessage', message, (response) => {
          if (response && response.error) {
            reject(new Error(response.error));
          } else {
            resolve(response);
          }
        });
      });
    } catch (err) {
      if (i === retries - 1) throw err;
      await new Promise(r => setTimeout(r, 1000 * (i + 1)));
    }
  }
}

// ==================== ТЕМЫ ====================

/**
 * Устанавливает тему приложения
 * @param {string} theme
 */
function setTheme(theme) {
  document.body.classList.remove('theme-light', 'theme-dark', 'theme-neon');
  document.body.classList.add(`theme-${theme}`);
  currentTheme = theme;
  localStorage.setItem('theme', theme);
}

/**
 * Переключает тему
 */
function toggleTheme() {
  const themes = ['dark', 'light', 'neon'];
  const currentIndex = themes.indexOf(currentTheme);
  const nextIndex = (currentIndex + 1) % themes.length;
  setTheme(themes[nextIndex]);
}

// ==================== ЯЗЫКИ ====================

const translations = {
  ru: {
    'chats': 'Чаты',
    'contacts': 'Контакты',
    'calls': 'Звонки',
    'channels': 'Каналы',
    'settings': 'Настройки',
    'profile': 'Профиль',
    'search': 'Поиск',
    'send': 'Отправить',
    'message': 'Сообщение',
    'online': 'В сети',
    'offline': 'Не в сети',
    'typing': 'печатает...',
    'new_message': 'Новое сообщение',
    'edit': 'Редактировать',
    'delete': 'Удалить',
    'forward': 'Переслать',
    'reply': 'Ответить',
    'copy': 'Копировать',
    'pin': 'Закрепить',
    'unpin': 'Открепить'
  },
  en: {
    'chats': 'Chats',
    'contacts': 'Contacts',
    'calls': 'Calls',
    'channels': 'Channels',
    'settings': 'Settings',
    'profile': 'Profile',
    'search': 'Search',
    'send': 'Send',
    'message': 'Message',
    'online': 'Online',
    'offline': 'Offline',
    'typing': 'typing...',
    'new_message': 'New message',
    'edit': 'Edit',
    'delete': 'Delete',
    'forward': 'Forward',
    'reply': 'Reply',
    'copy': 'Copy',
    'pin': 'Pin',
    'unpin': 'Unpin'
  }
};

/**
 * Переводит текст
 * @param {string} key
 * @returns {string}
 */
function t(key) {
  return translations[currentLanguage]?.[key] || key;
}

/**
 * Устанавливает язык
 * @param {string} lang
 */
function setLanguage(lang) {
  if (translations[lang]) {
    currentLanguage = lang;
    localStorage.setItem('language', lang);
    updateUITexts();
  }
}

/**
 * Обновляет тексты в UI
 */
function updateUITexts() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.dataset.i18n;
    el.textContent = t(key);
  });
}

// ==================== ИНИЦИАЛИЗАЦИЯ ====================

/**
 * Загружает сохранённые настройки
 */
function loadSavedSettings() {
  const savedTheme = localStorage.getItem('theme');
  if (savedTheme) {
    setTheme(savedTheme);
  }
  
  const savedLanguage = localStorage.getItem('language');
  if (savedLanguage) {
    setLanguage(savedLanguage);
  }
}

/**
 * Инициализирует приложение
 */
function initApp() {
  loadSavedSettings();
  
  if (token) {
    // Проверяем валидность токена
    fetch(`${API_BASE}/auth/verify`, {
      headers: { 'Authorization': `Bearer ${token}` }
    })
      .then(res => {
        if (res.ok) {
          return res.json();
        } else {
          throw new Error('Invalid token');
        }
      })
      .then(data => {
        currentUser = data.user;
        connectSocket();
        showMainScreen();
      })
      .catch(err => {
        console.error(err);
        localStorage.removeItem('token');
        token = null;
        initAuth();
      });
  } else {
    initAuth();
  }
}

// Запускаем приложение после загрузки DOM
document.addEventListener('DOMContentLoaded', initApp);

// Обработка ошибок на уровне window
window.addEventListener('error', (event) => {
  console.error('Global error:', event.error);
  showError('An error occurred');
});

window.addEventListener('unhandledrejection', (event) => {
  console.error('Unhandled rejection:', event.reason);
  showError('An error occurred');
});// public/app.js – клиентская логика CraneApp Messenger
// ЧАСТЬ 2: WebSocket и авторизация

// ==================== WEBSOCKET ====================

/**
 * Подключается к WebSocket серверу
 */
function connectSocket() {
  if (!token) return;
  
  socket = io(window.location.origin, {
    auth: { token },
    reconnection: true,
    reconnectionAttempts: MAX_RECONNECT_ATTEMPTS,
    reconnectionDelay: RECONNECT_DELAY,
    reconnectionDelayMax: 10000,
    timeout: 20000,
    transports: ['websocket', 'polling']
  });

  // ==================== СОБЫТИЯ СОЕДИНЕНИЯ ====================
  socket.on('connect', () => {
    console.log('✅ WebSocket connected');
    reconnectAttempts = 0;
    loadChats();
    loadUser();
    
    // Запускаем ping интервал
    if (pingInterval) clearInterval(pingInterval);
    pingInterval = setInterval(() => {
      socket.emit('ping');
    }, PING_INTERVAL);
    
    // Отправляем накопившиеся сообщения
    processMessageQueue();
  });

  socket.on('connect_error', (err) => {
    console.error('WebSocket connection error:', err);
    reconnectAttempts++;
    
    if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      showError('Connection lost. Please refresh the page.');
    }
  });

  socket.on('disconnect', (reason) => {
    console.log('WebSocket disconnected:', reason);
    if (pingInterval) {
      clearInterval(pingInterval);
      pingInterval = null;
    }
    
    if (reason === 'io server disconnect') {
      // Сервер инициировал отключение, пробуем переподключиться
      setTimeout(() => {
        socket.connect();
      }, RECONNECT_DELAY);
    }
  });

  socket.on('reconnect', (attempt) => {
    console.log(`WebSocket reconnected after ${attempt} attempts`);
    loadChats();
  });

  socket.on('reconnect_error', (err) => {
    console.error('WebSocket reconnect error:', err);
  });

  socket.on('reconnect_failed', () => {
    console.error('WebSocket reconnect failed');
    showError('Unable to reconnect. Please refresh the page.');
  });

  socket.on('pong', (timestamp) => {
    console.debug('Pong received:', timestamp);
  });

  // ==================== СОБЫТИЯ СООБЩЕНИЙ ====================
  socket.on('newMessage', (message) => {
    console.log('New message received:', message);
    
    if (currentChat && currentChat.id === message.chatId) {
      renderMessage(message);
      markAsRead(message.chatId, [message.id]);
      
      // Прокручиваем вниз, если пользователь уже был внизу
      const messagesArea = document.getElementById('messages-area');
      const isNearBottom = messagesArea.scrollHeight - messagesArea.scrollTop - messagesArea.clientHeight < 100;
      if (isNearBottom) {
        setTimeout(() => {
          messagesArea.scrollTop = messagesArea.scrollHeight;
        }, 100);
      }
    }
    
    updateChatListItem(message.chatId, message);
    playNotificationSound();
    
    // Обновляем счётчик непрочитанных для списка чатов
    updateUnreadCount(message.chatId);
  });

  socket.on('userTyping', ({ userId, username, isTyping }) => {
    if (currentChat) {
      showTypingIndicator(userId, username, isTyping);
    }
  });

  socket.on('messagesRead', ({ userId, messageIds }) => {
    messageIds.forEach(id => {
      const msgEl = document.querySelector(`.message[data-id="${id}"]`);
      if (msgEl) {
        const statusEl = msgEl.querySelector('.status');
        if (statusEl) {
          statusEl.dataset.status = 'read';
          statusEl.textContent = '✓✓';
        }
      }
    });
  });

  socket.on('reactionUpdated', ({ messageId, reactions }) => {
    updateReactions(messageId, reactions);
  });

  socket.on('messageEdited', ({ messageId, newContent }) => {
    const msgEl = document.querySelector(`.message[data-id="${messageId}"] .message-text`);
    if (msgEl) {
      msgEl.textContent = sanitizeHtml(newContent);
    }
  });

  socket.on('messageDeleted', ({ messageId }) => {
    const msgEl = document.querySelector(`.message[data-id="${messageId}"]`);
    if (msgEl) {
      msgEl.remove();
    }
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

  // ==================== СОБЫТИЯ ЧАТОВ ====================
  socket.on('chatUpdated', ({ chatId, updates }) => {
    const chatIndex = chats.findIndex(c => c.id === chatId);
    if (chatIndex !== -1) {
      chats[chatIndex] = { ...chats[chatIndex], ...updates };
      renderChatList();
    }
  });

  socket.on('memberAdded', ({ chatId, userId, addedBy }) => {
    if (currentChat && currentChat.id === chatId) {
      loadChatInfo(chatId);
    }
  });

  socket.on('memberRemoved', ({ chatId, userId, removedBy }) => {
    if (currentChat && currentChat.id === chatId) {
      if (userId === currentUser.id) {
        // Нас удалили из чата
        alert('You were removed from this chat');
        UI.closeChat();
      } else {
        loadChatInfo(chatId);
      }
    }
  });

  socket.on('userPromoted', ({ chatId, userId, newRole, promotedBy }) => {
    if (currentChat && currentChat.id === chatId) {
      loadChatInfo(chatId);
    }
  });

  socket.on('userDemoted', ({ chatId, userId, newRole, demotedBy }) => {
    if (currentChat && currentChat.id === chatId) {
      loadChatInfo(chatId);
    }
  });

  socket.on('memberLeft', ({ chatId, userId }) => {
    if (currentChat && currentChat.id === chatId) {
      if (userId === currentUser.id) {
        UI.closeChat();
      } else {
        loadChatInfo(chatId);
      }
    }
  });

  // ==================== СОБЫТИЯ КАНАЛОВ ====================
  socket.on('channelUpdated', ({ channelId, updates }) => {
    console.log('Channel updated:', channelId, updates);
  });

  socket.on('channelDeleted', ({ channelId }) => {
    if (currentChat && currentChat.id === channelId) {
      alert('This channel has been deleted');
      UI.closeChat();
    }
  });

  socket.on('adminAppointed', ({ channelId, userId }) => {
    if (currentChat && currentChat.id === channelId) {
      loadChatInfo(channelId);
    }
  });

  socket.on('adminRemoved', ({ channelId, userId }) => {
    if (currentChat && currentChat.id === channelId) {
      loadChatInfo(channelId);
    }
  });

  // ==================== СОБЫТИЯ ЗВОНКОВ (WebRTC) ====================
  socket.on('incomingCall', async ({ callId, caller, type }) => {
    if (callActive) {
      socket.emit('callReject', { callId });
      return;
    }
    
    const accept = confirm(`Incoming ${type} call from ${caller.username}. Accept?`);
    if (accept) {
      await acceptCall(callId, caller, type);
    } else {
      socket.emit('callReject', { callId });
    }
  });

  socket.on('callOffer', async ({ callId, offer, from, isVideo }) => {
    if (callActive) return;
    await handleCallOffer(callId, offer, from, isVideo);
  });

  socket.on('callAnswer', ({ answer }) => {
    if (peerConnection) {
      peerConnection.setRemoteDescription(new RTCSessionDescription(answer))
        .catch(err => console.error('Error setting remote description:', err));
    }
  });

  socket.on('callIceCandidate', ({ candidate }) => {
    if (peerConnection) {
      peerConnection.addIceCandidate(new RTCIceCandidate(candidate))
        .catch(err => console.error('Error adding ICE candidate:', err));
    }
  });

  socket.on('callEnded', ({ callId }) => {
    if (currentCallId === callId) {
      endCall();
      alert('Call ended');
    }
  });

  socket.on('callRejected', ({ callId }) => {
    if (currentCallId === callId) {
      endCall();
      alert('Call rejected');
    }
  });

  socket.on('callTimeout', ({ callId }) => {
    if (currentCallId === callId) {
      endCall();
      alert('Call timed out');
    }
  });

  // ==================== СОБЫТИЯ УВЕДОМЛЕНИЙ ====================
  socket.on('newNotification', (notification) => {
    showPixelNotification(notification);
  });

  socket.on('profileUpdated', (userData) => {
    if (currentUser && currentUser.id === userData.id) {
      currentUser = { ...currentUser, ...userData };
      updateSidebarAvatar();
    }
  });
}

// ==================== АВТОРИЗАЦИЯ ====================

/**
 * Инициализирует обработчики на экране авторизации
 */
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
        document.getElementById('auth-error').textContent = '';
      });
    });
  }

  const loginBtn = document.getElementById('login-btn');
  if (loginBtn) {
    loginBtn.addEventListener('click', login);
  }

  const registerBtn = document.getElementById('register-btn');
  if (registerBtn) {
    registerBtn.addEventListener('click', register);
  }

  const loginWithTokenBtn = document.getElementById('login-with-token');
  if (loginWithTokenBtn && token) {
    loginWithTokenBtn.style.display = 'block';
    loginWithTokenBtn.addEventListener('click', () => {
      connectSocket();
      loadUser();
      showMainScreen();
    });
  }

  // Обработка Enter в полях ввода
  const inputs = document.querySelectorAll('.auth-form input');
  inputs.forEach(input => {
    input.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        if (input.closest('#login-form')) {
          login();
        } else if (input.closest('#register-form')) {
          register();
        }
      }
    });
  });
}

/**
 * Выполняет вход
 */
async function login() {
  const username = document.getElementById('login-username').value.trim();
  const password = document.getElementById('login-password').value;
  const totpCode = document.getElementById('login-2fa').value;

  if (!username || !password) {
    showAuthError('Please enter username and password');
    return;
  }

  showAuthLoading(true);

  try {
    const response = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, totpCode })
    });

    const data = await response.json();

    if (response.ok) {
      token = data.token;
      localStorage.setItem('token', token);
      currentUser = data.user;
      connectSocket();
      showMainScreen();
    } else {
      if (data.error === '2FA code required') {
        document.getElementById('login-2fa-section').style.display = 'block';
        showAuthError('Please enter 2FA code');
      } else {
        showAuthError(data.error || 'Login failed');
      }
    }
  } catch (err) {
    console.error('Login error:', err);
    showAuthError('Network error. Please try again.');
  } finally {
    showAuthLoading(false);
  }
}

/**
 * Выполняет регистрацию
 */
async function register() {
  const username = document.getElementById('reg-username').value.trim();
  const password = document.getElementById('reg-password').value;
  const password2 = document.getElementById('reg-password2').value;

  if (!username || !password) {
    showAuthError('Please fill all fields');
    return;
  }

  if (password !== password2) {
    showAuthError('Passwords do not match');
    return;
  }

  if (password.length < 8) {
    showAuthError('Password must be at least 8 characters');
    return;
  }

  showAuthLoading(true);

  try {
    const response = await fetch(`${API_BASE}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });

    const data = await response.json();

    if (response.ok) {
      token = data.token;
      localStorage.setItem('token', token);
      currentUser = data.user;
      connectSocket();
      showMainScreen();
    } else {
      showAuthError(data.error || 'Registration failed');
    }
  } catch (err) {
    console.error('Registration error:', err);
    showAuthError('Network error. Please try again.');
  } finally {
    showAuthLoading(false);
  }
}

/**
 * Показывает ошибку на форме авторизации
 * @param {string} msg
 */
function showAuthError(msg) {
  const errorEl = document.getElementById('auth-error');
  if (errorEl) {
    errorEl.textContent = msg;
  }
}

/**
 * Показывает/скрывает индикатор загрузки
 * @param {boolean} show
 */
function showAuthLoading(show) {
  const loader = document.getElementById('auth-loading');
  const buttons = document.querySelectorAll('.auth-form .pixel-button');
  
  if (loader) {
    loader.style.display = show ? 'block' : 'none';
  }
  
  buttons.forEach(btn => {
    btn.disabled = show;
  });
}

/**
 * Загружает информацию о текущем пользователе
 */
async function loadUser() {
  try {
    const response = await fetch(`${API_BASE}/profile/me`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    
    if (response.ok) {
      currentUser = await response.json();
      updateSidebarAvatar();
      updateProfileScreen();
    }
  } catch (err) {
    console.error('Error loading user:', err);
  }
}

/**
 * Обновляет аватар в сайдбаре
 */
function updateSidebarAvatar() {
  const sidebarAvatar = document.getElementById('sidebar-avatar');
  if (sidebarAvatar && currentUser?.avatar) {
    sidebarAvatar.src = currentUser.avatar;
  }
}

/**
 * Обновляет экран профиля
 */
function updateProfileScreen() {
  const usernameEl = document.getElementById('profile-username');
  const bioEl = document.getElementById('profile-bio');
  const avatarEl = document.getElementById('profile-avatar');
  const messagesEl = document.getElementById('profile-messages');
  const chatsEl = document.getElementById('profile-chats');
  const contactsEl = document.getElementById('profile-contacts');
  
  if (usernameEl && currentUser) {
    usernameEl.textContent = currentUser.username;
  }
  
  if (bioEl && currentUser) {
    bioEl.textContent = currentUser.bio || 'No bio yet';
  }
  
  if (avatarEl && currentUser?.avatar) {
    avatarEl.src = currentUser.avatar;
  }
  
  if (currentUser?.stats) {
    if (messagesEl) messagesEl.textContent = currentUser.stats.messages_count || 0;
    if (chatsEl) chatsEl.textContent = currentUser.stats.chats_count || 0;
    if (contactsEl) contactsEl.textContent = currentUser.stats.contacts_count || 0;
  }
}

/**
 * Загружает список чатов
 */
async function loadChats() {
  try {
    const response = await fetch(`${API_BASE}/chats`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    
    if (!response.ok) throw new Error('Failed to load chats');
    
    chats = await response.json();
    renderChatList();
    updateUnreadBadge();
  } catch (err) {
    console.error('Failed to load chats:', err);
    showError('Could not load chats');
  }
}

/**
 * Обновляет общее количество непрочитанных сообщений
 */
function updateUnreadBadge() {
  const totalUnread = chats.reduce((sum, chat) => sum + (chat.unread_count || 0), 0);
  const badge = document.getElementById('chats-badge');
  if (badge) {
    badge.textContent = totalUnread > 99 ? '99+' : totalUnread;
    badge.style.display = totalUnread > 0 ? 'block' : 'none';
  }
}

/**
 * Обновляет количество непрочитанных для конкретного чата
 * @param {string} chatId
 */
function updateUnreadCount(chatId) {
  const chat = chats.find(c => c.id === chatId);
  if (chat) {
    chat.unread_count = (chat.unread_count || 0) + 1;
    renderChatList();
    updateUnreadBadge();
  }
}

/**
 * Отмечает сообщения как прочитанные
 * @param {string} chatId
 * @param {Array} messageIds
 */
function markAsRead(chatId, messageIds) {
  if (!messageIds || messageIds.length === 0) return;
  
  socket.emit('messagesRead', { chatId, messageIds });
  
  const chat = chats.find(c => c.id === chatId);
  if (chat) {
    chat.unread_count = 0;
    renderChatList();
    updateUnreadBadge();
  }
}

/**
 * Загружает информацию о чате
 * @param {string} chatId
 */
async function loadChatInfo(chatId) {
  try {
    const response = await fetch(`${API_BASE}/chats/${chatId}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    
    if (!response.ok) throw new Error('Failed to load chat info');
    
    const chat = await response.json();
    renderChatInfo(chat);
  } catch (err) {
    console.error(err);
  }
}

/**
 * Отображает информацию о чате
 * @param {Object} chat
 */
function renderChatInfo(chat) {
  const panel = document.getElementById('chat-info-panel');
  if (!panel) return;
  
  let html = '<div class="info-panel">';
  
  if (chat.description) {
    html += `
      <div class="chat-info-section">
        <h4>Description</h4>
        <p>${sanitizeHtml(chat.description)}</p>
      </div>
    `;
  }
  
  html += `
    <div class="chat-info-section">
      <h4>Members (${chat.members?.length || 0})</h4>
      <div class="member-list">
  `;
  
  if (chat.members) {
    chat.members.forEach(member => {
      html += `
        <div class="member-item" onclick="UI.openUserProfile('${member.id}')">
          <img src="${member.avatar || 'https://i.ibb.co/QjTkyWfG/85-20260306202001.png'}" class="member-avatar">
          <span class="member-name">${member.username}</span>
          <span class="member-role ${member.role}">${member.role}</span>
        </div>
      `;
    });
  }
  
  html += '</div></div></div>';
  panel.innerHTML = html;
}

// ==================== ВЫХОД ====================

/**
 * Выход из аккаунта
 */
async function logout() {
  try {
    await fetch(`${API_BASE}/auth/logout`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` }
    });
  } catch (err) {
    console.error('Logout error:', err);
  } finally {
    localStorage.removeItem('token');
    token = null;
    currentUser = null;
    
    if (socket) {
      socket.disconnect();
      socket = null;
    }
    
    if (pingInterval) {
      clearInterval(pingInterval);
      pingInterval = null;
    }
    
    // Показываем экран авторизации
    document.getElementById('main-screen').classList.remove('active');
    document.getElementById('auth-screen').classList.add('active');
  }
}// public/app.js – клиентская логика CraneApp Messenger
// ЧАСТЬ 3: Рендеринг чатов и сообщений

// ==================== РЕНДЕРИНГ ЧАТОВ ====================

/**
 * Отрисовывает список чатов
 */
function renderChatList() {
  const chatListEl = document.getElementById('chat-list');
  if (!chatListEl) return;
  
  chatListEl.innerHTML = '';
  
  if (!chats || chats.length === 0) {
    chatListEl.innerHTML = '<div class="empty-state">No chats yet. Start a new chat!</div>';
    return;
  }
  
  chats.forEach(chat => {
    const item = createChatItem(chat);
    chatListEl.appendChild(item);
  });
}

/**
 * Создаёт элемент чата для списка
 * @param {Object} chat
 * @returns {HTMLElement}
 */
function createChatItem(chat) {
  const item = document.createElement('div');
  item.className = `chat-item ${currentChat && currentChat.id === chat.id ? 'active' : ''}`;
  item.dataset.id = chat.id;
  
  const lastMessage = chat.last_message ? sanitizeHtml(chat.last_message.content) : '';
  const time = chat.last_message ? formatMessageTime(chat.last_message.created_at) : '';
  
  let chatName = '';
  if (chat.name) {
    chatName = chat.name;
  } else if (chat.participants) {
    const otherParticipants = chat.participants.filter(p => p.id !== currentUser?.id);
    chatName = otherParticipants.map(p => p.username).join(', ');
  }
  
  const avatarUrl = chat.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(chatName)}&background=7a2bff&color=fff&size=48`;
  
  let statusIndicator = '';
  if (chat.type === 'private' && chat.onlineStatus) {
    statusIndicator = `<span class="online-indicator ${chat.onlineStatus}"></span>`;
  }
  
  item.innerHTML = `
    <div class="chat-avatar-container">
      <img src="${avatarUrl}" class="chat-avatar" alt="${chatName}" onerror="this.src='https://i.ibb.co/QjTkyWfG/85-20260306202001.png'">
      ${statusIndicator}
    </div>
    <div class="chat-info">
      <div class="chat-name">${chatName}</div>
      <div class="last-message">${lastMessage}</div>
    </div>
    <div class="chat-meta">
      <span class="time">${time}</span>
      ${chat.unread_count ? `<span class="unread-badge">${chat.unread_count > 99 ? '99+' : chat.unread_count}</span>` : ''}
      ${chat.pinned ? '<span class="pinned-icon">📌</span>' : ''}
      ${chat.muted ? '<span class="muted-icon">🔇</span>' : ''}
    </div>
  `;
  
  item.addEventListener('click', () => openChat(chat.id));
  
  // Добавляем контекстное меню для чата
  item.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    showChatContextMenu(e, chat);
  });
  
  return item;
}

/**
 * Показывает контекстное меню для чата
 * @param {Event} e
 * @param {Object} chat
 */
function showChatContextMenu(e, chat) {
  const menu = document.createElement('div');
  menu.className = 'message-context-menu pixel-dropdown';
  menu.style.top = e.clientY + 'px';
  menu.style.left = e.clientX + 'px';
  
  const items = [
    { label: chat.pinned ? 'Unpin' : 'Pin', action: () => togglePinChat(chat.id) },
    { label: chat.muted ? 'Unmute' : 'Mute', action: () => toggleMuteChat(chat.id) },
    { label: 'Archive', action: () => archiveChat(chat.id) },
    { label: 'Delete', action: () => deleteChat(chat.id) },
    { label: 'Mark as read', action: () => markChatAsRead(chat.id) }
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

/**
 * Обновляет элемент чата в списке при новом сообщении
 * @param {string} chatId
 * @param {Object} lastMessage
 */
function updateChatListItem(chatId, lastMessage) {
  const chatIndex = chats.findIndex(c => c.id === chatId);
  if (chatIndex !== -1) {
    chats[chatIndex].last_message = lastMessage;
    // Перемещаем чат в начало списка
    const chat = chats.splice(chatIndex, 1)[0];
    chats.unshift(chat);
    renderChatList();
  }
}

/**
 * Переключает закрепление чата
 * @param {string} chatId
 */
async function togglePinChat(chatId) {
  const chat = chats.find(c => c.id === chatId);
  if (!chat) return;
  
  try {
    const response = await fetch(`${API_BASE}/chats/${chatId}/pin`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    
    if (response.ok) {
      chat.pinned = !chat.pinned;
      renderChatList();
    }
  } catch (err) {
    console.error(err);
  }
}

/**
 * Переключает mute чата
 * @param {string} chatId
 */
async function toggleMuteChat(chatId) {
  const chat = chats.find(c => c.id === chatId);
  if (!chat) return;
  
  try {
    const response = await fetch(`${API_BASE}/chats/${chatId}/mute`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    
    if (response.ok) {
      chat.muted = !chat.muted;
      renderChatList();
    }
  } catch (err) {
    console.error(err);
  }
}

/**
 * Архивирует чат
 * @param {string} chatId
 */
async function archiveChat(chatId) {
  try {
    const response = await fetch(`${API_BASE}/chats/${chatId}/archive`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    
    if (response.ok) {
      chats = chats.filter(c => c.id !== chatId);
      renderChatList();
      if (currentChat && currentChat.id === chatId) {
        UI.closeChat();
      }
    }
  } catch (err) {
    console.error(err);
  }
}

/**
 * Удаляет чат
 * @param {string} chatId
 */
async function deleteChat(chatId) {
  if (!confirm('Delete this chat?')) return;
  
  try {
    const response = await fetch(`${API_BASE}/chats/${chatId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    
    if (response.ok) {
      chats = chats.filter(c => c.id !== chatId);
      renderChatList();
      if (currentChat && currentChat.id === chatId) {
        UI.closeChat();
      }
    }
  } catch (err) {
    console.error(err);
  }
}

/**
 * Отмечает чат как прочитанный
 * @param {string} chatId
 */
async function markChatAsRead(chatId) {
  const chat = chats.find(c => c.id === chatId);
  if (!chat || !chat.unread_count) return;
  
  try {
    await fetch(`${API_BASE}/chats/${chatId}/read`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    
    chat.unread_count = 0;
    renderChatList();
    updateUnreadBadge();
  } catch (err) {
    console.error(err);
  }
}

// ==================== ОТКРЫТИЕ ЧАТА ====================

/**
 * Открывает чат по ID
 * @param {string} chatId
 */
async function openChat(chatId) {
  currentChat = chats.find(c => c.id === chatId);
  const chatWindow = document.getElementById('chat-window');
  if (chatWindow) chatWindow.style.display = 'flex';
  
  const chatListPanel = document.querySelector('.chat-list-panel');
  if (chatListPanel) chatListPanel.classList.remove('active');

  // Загружаем сообщения
  try {
    const response = await fetch(`${API_BASE}/chats/${chatId}/messages`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!response.ok) throw new Error('Failed to load messages');
    const msgs = await response.json();
    messages[chatId] = msgs;
    renderMessages(msgs);
  } catch (err) {
    console.error(err);
    showError('Could not load messages');
  }

  // Обновляем заголовок чата
  const chatAvatar = document.getElementById('chat-avatar');
  const chatName = document.getElementById('chat-name');
  const chatStatus = document.getElementById('chat-status');
  
  if (chatAvatar) {
    chatAvatar.src = currentChat.avatar || 'https://i.ibb.co/QjTkyWfG/85-20260306202001.png';
  }
  
  if (chatName) {
    let name = currentChat.name;
    if (!name && currentChat.participants) {
      const otherParticipants = currentChat.participants.filter(p => p.id !== currentUser?.id);
      name = otherParticipants.map(p => p.username).join(', ');
    }
    chatName.textContent = name || 'Chat';
  }
  
  if (chatStatus) {
    chatStatus.textContent = '';
    chatStatus.classList.remove('online', 'typing');
  }

  // Загружаем закреплённые сообщения
  loadPinnedMessages(chatId);
  
  // Показываем правую панель
  showRightPanel(chatId);
  
  // Отмечаем сообщения как прочитанные
  if (currentChat.unread_count > 0) {
    markChatAsRead(chatId);
  }
}

/**
 * Отрисовывает сообщения в чате
 * @param {Array} msgs
 */
function renderMessages(msgs) {
  const area = document.getElementById('messages-area');
  if (!area) return;
  
  area.innerHTML = '';
  
  if (!msgs || msgs.length === 0) {
    area.innerHTML = '<div class="empty-state">No messages yet. Send the first message!</div>';
    return;
  }
  
  msgs.forEach(msg => renderMessage(msg));
  area.scrollTop = area.scrollHeight;
}

/**
 * Отрисовывает одно сообщение
 * @param {Object} msg
 */
function renderMessage(msg) {
  const area = document.getElementById('messages-area');
  if (!area) return;
  
  const div = document.createElement('div');
  div.className = `message ${msg.sender_id === currentUser?.id ? 'own' : 'other'}`;
  div.dataset.id = msg.id;
  
  const time = new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const status = msg.sender_id === currentUser?.id ? (msg.read ? 'read' : 'delivered') : '';
  const statusIcon = msg.sender_id === currentUser?.id ? (msg.read ? '✓✓' : '✓') : '';
  
  let content = '';
  switch (msg.type) {
    case 'image':
      content = `<img src="${msg.content}" class="message-image" onclick="window.openMedia('${msg.id}')">`;
      break;
    case 'video':
      content = `<video src="${msg.content}" controls class="message-video"></video>`;
      break;
    case 'audio':
      content = `<audio src="${msg.content}" controls class="message-audio"></audio>`;
      break;
    case 'file':
      content = `<div class="message-file" onclick="window.downloadFile('${msg.id}')">
                  <span class="file-icon">📄</span>
                  <span class="file-name">${msg.content.split('/').pop()}</span>
                </div>`;
      break;
    case 'location':
      content = `<a href="${msg.content}" target="_blank" class="message-location">📍 Location</a>`;
      break;
    case 'contact':
      content = `<div class="message-contact">👤 ${msg.content}</div>`;
      break;
    default:
      content = sanitizeHtml(msg.content);
  }
  
  let replyHtml = '';
  if (msg.reply_to) {
    const repliedMsg = messages[currentChat.id]?.find(m => m.id === msg.reply_to);
    if (repliedMsg) {
      replyHtml = `<div class="reply-preview" onclick="jumpToMessage('${msg.reply_to}')">
                    <span class="reply-sender">${repliedMsg.sender?.username}:</span>
                    <span class="reply-content">${sanitizeHtml(repliedMsg.content.substring(0, 50))}</span>
                  </div>`;
    }
  }
  
  let forwardHtml = msg.forwarded ? '<span class="forward-badge">📨 Forwarded</span>' : '';
  
  div.innerHTML = `
    <div class="message-bubble">
      ${replyHtml}
      ${forwardHtml}
      <div class="message-content">${content}</div>
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
  
  // Двойной клик для реакции
  div.addEventListener('dblclick', () => {
    addReaction(msg.id, '❤️');
  });
  
  area.appendChild(div);
  if (msg.reactions) updateReactions(msg.id, msg.reactions);
}

/**
 * Загружает больше сообщений (пагинация)
 */
async function loadMoreMessages() {
  if (!currentChat || !messages[currentChat.id] || messages[currentChat.id].length === 0) return;
  
  const oldestMessage = messages[currentChat.id][0];
  if (!oldestMessage) return;
  
  try {
    const response = await fetch(`${API_BASE}/chats/${currentChat.id}/messages?before=${oldestMessage.created_at}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    
    if (!response.ok) throw new Error('Failed to load more messages');
    
    const olderMessages = await response.json();
    if (olderMessages.length === 0) return;
    
    messages[currentChat.id] = [...olderMessages, ...messages[currentChat.id]];
    
    const area = document.getElementById('messages-area');
    const scrollHeight = area.scrollHeight;
    
    renderMessages(messages[currentChat.id]);
    
    // Восстанавливаем позицию прокрутки
    area.scrollTop = area.scrollHeight - scrollHeight;
  } catch (err) {
    console.error(err);
  }
}

// Добавляем обработчик прокрутки для пагинации
const messagesArea = document.getElementById('messages-area');
if (messagesArea) {
  messagesArea.addEventListener('scroll', throttle(() => {
    if (messagesArea.scrollTop < 100) {
      loadMoreMessages();
    }
  }, 500));
}// public/app.js – клиентская логика CraneApp Messenger
// ЧАСТЬ 4: Действия с сообщениями, эмодзи, загрузка файлов

// ==================== ОТПРАВКА СООБЩЕНИЙ ====================

/**
 * Отправляет сообщение
 */
function sendMessage() {
  const input = document.getElementById('message-text');
  if (!input) return;
  
  const text = input.value.trim();
  if (!text || !currentChat) return;
  
  // Очищаем поле ввода
  input.value = '';

  // Создаём временное сообщение для оптимистичного UI
  const tempId = generateId();
  const tempMessage = {
    id: tempId,
    chatId: currentChat.id,
    senderId: currentUser.id,
    sender: { id: currentUser.id, username: currentUser.username },
    content: text,
    type: 'text',
    createdAt: new Date().toISOString(),
    read: false,
    edited: false,
    temp: true
  };
  
  // Добавляем в UI
  renderMessage(tempMessage);
  
  // Отправляем через WebSocket
  socket.emit('sendMessage', {
    chatId: currentChat.id,
    content: text,
    replyTo: input.dataset.replyTo || null
  }, (response) => {
    if (response && response.error) {
      showError(response.error);
      // Удаляем временное сообщение
      document.querySelector(`.message[data-id="${tempId}"]`)?.remove();
    } else if (response && response.messageId) {
      // Заменяем временное сообщение на реальное
      const tempEl = document.querySelector(`.message[data-id="${tempId}"]`);
      if (tempEl) {
        tempEl.dataset.id = response.messageId;
        tempEl.classList.remove('temp');
      }
    }
  });
  
  delete input.dataset.replyTo;
  input.placeholder = 'Message';
}

/**
 * Отправляет голосовое сообщение
 */
async function sendVoiceMessage(audioBlob) {
  if (!currentChat || !audioBlob) return;
  
  const formData = new FormData();
  formData.append('file', audioBlob, 'voice.webm');
  
  try {
    const response = await fetch(`${API_BASE}/media/upload`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` },
      body: formData
    });
    
    if (!response.ok) throw new Error('Upload failed');
    
    const data = await response.json();
    
    socket.emit('sendMessage', {
      chatId: currentChat.id,
      content: data.url,
      type: 'audio'
    });
  } catch (err) {
    console.error(err);
    showError('Failed to send voice message');
  }
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
    statusEl.textContent = `${username} is typing...`;
    statusEl.classList.add('typing');
  } else {
    statusEl.textContent = '';
    statusEl.classList.remove('typing');
  }
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
    { label: 'Pin', action: () => pinMessage(messageId) },
    { label: 'Translate', action: () => translateMessage(messageId, 'en') }
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
    await copyToClipboard(msg.content);
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
  if (!confirm('Delete this message?')) return;
  
  socket.emit('deleteMessage', { messageId }, (response) => {
    if (response && response.error) {
      showError(response.error);
    }
  });
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
    
    let chatName = chat.name;
    if (!chatName && chat.participants) {
      const otherParticipants = chat.participants.filter(p => p.id !== currentUser?.id);
      chatName = otherParticipants.map(p => p.username).join(', ');
    }
    
    item.innerHTML = `
      <img src="${chat.avatar || 'https://i.ibb.co/QjTkyWfG/85-20260306202001.png'}" class="chat-avatar">
      <div class="chat-info">
        <div class="chat-name">${chatName}</div>
      </div>
    `;
    
    item.addEventListener('click', () => {
      socket.emit('forwardMessage', { messageId, toChatId: chat.id }, (response) => {
        if (response && response.error) {
          showError(response.error);
        } else {
          modal.remove();
          showSuccess('Message forwarded');
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

function removeReaction(messageId, emoji) {
  socket.emit('removeReaction', { messageId, emoji }, (response) => {
    if (response && response.error) {
      showError(response.error);
    }
  });
}

function updateReactions(messageId, reactions) {
  const container = document.getElementById(`reactions-${messageId}`);
  if (!container) return;
  
  container.innerHTML = '';
  
  if (!reactions || reactions.length === 0) return;
  
  reactions.forEach(r => {
    const span = document.createElement('span');
    span.className = 'reaction';
    span.textContent = `${r.emoji} ${r.count}`;
    
    if (r.userReacted) {
      span.classList.add('user-reacted');
    }
    
    span.addEventListener('click', () => {
      if (r.userReacted) {
        removeReaction(messageId, r.emoji);
      } else {
        addReaction(messageId, r.emoji);
      }
    });
    
    container.appendChild(span);
  });
}

// ==================== ПАНЕЛЬ ЗАКРЕПЛЁННЫХ СООБЩЕНИЙ ====================

async function loadPinnedMessages(chatId) {
  try {
    const response = await fetch(`${API_BASE}/chats/${chatId}/pinned`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    pinnedMessages = await response.json();
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
  
  if (pinnedMessages.length === 0) {
    panel.style.display = 'none';
    return;
  }
  
  panel.innerHTML = '<h4>Pinned</h4>';
  
  pinnedMessages.forEach(msg => {
    const msgDiv = document.createElement('div');
    msgDiv.className = 'pinned-message';
    msgDiv.innerHTML = `
      <span onclick="jumpToMessage('${msg.id}')">${sanitizeHtml(msg.content.substring(0, 50))}</span>
      <button onclick="event.stopPropagation(); unpinMessage('${msg.id}')">❌</button>
    `;
    panel.appendChild(msgDiv);
  });
  
  panel.style.display = 'block';
}

function jumpToMessage(messageId) {
  const msgEl = document.querySelector(`.message[data-id="${messageId}"]`);
  if (msgEl) {
    msgEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    msgEl.classList.add('highlight');
    setTimeout(() => msgEl.classList.remove('highlight'), 2000);
  }
}

function unpinMessage(messageId) {
  socket.emit('unpinMessage', { messageId }, (response) => {
    if (response && response.error) {
      showError(response.error);
    }
  });
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
  
  const emojiCategories = [
    ['😀', '😂', '😍', '🥰', '😎', '😢', '😡', '👍'],
    ['❤️', '🔥', '🎉', '💯', '⭐', '🍕', '⚽', '🎵'],
    ['🐶', '🐱', '🐼', '🐨', '🦊', '🐸', '🐧', '🐤'],
    ['🍎', '🍕', '🍔', '🌮', '🍣', '🍰', '🍩', '☕']
  ];
  
  emojiCategories.forEach(category => {
    category.forEach(emoji => {
      const btn = document.createElement('button');
      btn.className = 'emoji-btn pixel-button small';
      btn.textContent = emoji;
      btn.addEventListener('click', () => {
        insertEmoji(emoji);
        picker.style.display = 'none';
      });
      picker.appendChild(btn);
    });
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

// ==================== ЗАПИСЬ ГОЛОСОВЫХ СООБЩЕНИЙ ====================

let mediaRecorder = null;
let audioChunks = [];

async function startVoiceRecording() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaRecorder = new MediaRecorder(stream);
    audioChunks = [];
    
    mediaRecorder.ondataavailable = event => {
      audioChunks.push(event.data);
    };
    
    mediaRecorder.onstop = () => {
      const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
      sendVoiceMessage(audioBlob);
      stream.getTracks().forEach(track => track.stop());
    };
    
    mediaRecorder.start();
    
    // Показываем индикатор записи
    showRecordingIndicator();
    
    // Автоматически останавливаем через 60 секунд
    setTimeout(() => {
      if (mediaRecorder && mediaRecorder.state === 'recording') {
        stopVoiceRecording();
      }
    }, 60000);
    
  } catch (err) {
    console.error('Voice recording failed:', err);
    showError('Could not access microphone');
  }
}

function stopVoiceRecording() {
  if (mediaRecorder && mediaRecorder.state === 'recording') {
    mediaRecorder.stop();
    hideRecordingIndicator();
  }
}

function cancelVoiceRecording() {
  if (mediaRecorder && mediaRecorder.state === 'recording') {
    mediaRecorder.stop();
    audioChunks = [];
    hideRecordingIndicator();
  }
}

function showRecordingIndicator() {
  const indicator = document.createElement('div');
  indicator.id = 'recording-indicator';
  indicator.className = 'recording-indicator';
  indicator.innerHTML = `
    <span class="recording-dot"></span>
    <span>Recording...</span>
    <button onclick="stopVoiceRecording()" class="pixel-button small">Stop</button>
    <button onclick="cancelVoiceRecording()" class="pixel-button small">Cancel</button>
  `;
  document.querySelector('.message-input-area').appendChild(indicator);
}

function hideRecordingIndicator() {
  const indicator = document.getElementById('recording-indicator');
  if (indicator) indicator.remove();
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
      
      // Определяем тип сообщения на основе MIME-типа
      let messageType = 'file';
      if (data.mimeType.startsWith('image/')) messageType = 'image';
      else if (data.mimeType.startsWith('video/')) messageType = 'video';
      else if (data.mimeType.startsWith('audio/')) messageType = 'audio';
      
      socket.emit('sendMessage', {
        chatId: currentChat.id,
        content: data.url,
        type: messageType
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
        showError('Upload failed');
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

function updateUploadProgress(id, percent) {
  const prog = document.querySelector(`#upload-${id} progress`);
  if (prog) prog.value = percent;
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
}// public/app.js – клиентская логика CraneApp Messenger
// ЧАСТЬ 5: Поиск, звонки, AI функции

// ==================== ПОИСК ====================

const debouncedSearch = debounce(async (query) => {
  if (query.length < 2) return;
  
  try {
    const response = await fetch(`${API_BASE}/search?q=${encodeURIComponent(query)}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const results = await response.json();
    displaySearchResults(results);
  } catch (err) {
    console.error(err);
  }
}, 300);

function onSearchInput(e) {
  const query = e.target.value.trim();
  if (query.length === 0) {
    clearSearch();
  } else {
    debouncedSearch(query);
  }
}

function clearSearch() {
  const resultsDiv = document.getElementById('search-results');
  if (resultsDiv) {
    resultsDiv.innerHTML = '';
  }
}

function displaySearchResults(results) {
  const resultsDiv = document.getElementById('search-results');
  if (!resultsDiv) return;
  
  resultsDiv.innerHTML = '';
  
  if (results.users && results.users.length > 0) {
    const section = document.createElement('div');
    section.className = 'search-section';
    section.innerHTML = '<h3>Users</h3>';
    results.users.forEach(user => {
      section.innerHTML += `
        <div class="search-result-item" onclick="UI.openUserProfile('${user.id}')">
          <img src="${user.avatar || 'https://i.ibb.co/QjTkyWfG/85-20260306202001.png'}" class="search-result-avatar">
          <div class="search-result-info">
            <div class="search-result-title">${user.username}</div>
            <div class="search-result-subtitle">${user.online ? '🟢 Online' : '⚫ Offline'}</div>
          </div>
        </div>
      `;
    });
    resultsDiv.appendChild(section);
  }
  
  if (results.messages && results.messages.length > 0) {
    const section = document.createElement('div');
    section.className = 'search-section';
    section.innerHTML = '<h3>Messages</h3>';
    results.messages.forEach(msg => {
      section.innerHTML += `
        <div class="search-result-item" onclick="UI.openChat('${msg.chat_id}')">
          <img src="${msg.avatar || 'https://i.ibb.co/QjTkyWfG/85-20260306202001.png'}" class="search-result-avatar">
          <div class="search-result-info">
            <div class="search-result-title">${msg.username}</div>
            <div class="search-result-subtitle">${sanitizeHtml(msg.content.substring(0, 50))}...</div>
          </div>
        </div>
      `;
    });
    resultsDiv.appendChild(section);
  }
  
  if (results.chats && results.chats.length > 0) {
    const section = document.createElement('div');
    section.className = 'search-section';
    section.innerHTML = '<h3>Chats</h3>';
    results.chats.forEach(chat => {
      section.innerHTML += `
        <div class="search-result-item" onclick="UI.openChat('${chat.id}')">
          <img src="${chat.avatar || 'https://i.ibb.co/QjTkyWfG/85-20260306202001.png'}" class="search-result-avatar">
          <div class="search-result-info">
            <div class="search-result-title">${chat.name}</div>
            <div class="search-result-subtitle">${chat.type}</div>
          </div>
        </div>
      `;
    });
    resultsDiv.appendChild(section);
  }
  
  if (results.channels && results.channels.length > 0) {
    const section = document.createElement('div');
    section.className = 'search-section';
    section.innerHTML = '<h3>Channels</h3>';
    results.channels.forEach(channel => {
      section.innerHTML += `
        <div class="search-result-item" onclick="UI.openChannel('${channel.id}')">
          <img src="${channel.avatar || 'https://i.ibb.co/QjTkyWfG/85-20260306202001.png'}" class="search-result-avatar">
          <div class="search-result-info">
            <div class="search-result-title">${channel.name}</div>
            <div class="search-result-subtitle">${channel.subscribers_count} subscribers</div>
          </div>
        </div>
      `;
    });
    resultsDiv.appendChild(section);
  }
  
  if (resultsDiv.children.length === 0) {
    resultsDiv.innerHTML = '<p class="no-results">No results found</p>';
  }
}

// ==================== WEBRTC ЗВОНКИ ====================

/**
 * Начинает звонок
 * @param {boolean} isVideo - видео звонок или нет
 */
async function startCall(isVideo = false) {
  if (!currentChat) return;
  
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ 
      video: isVideo, 
      audio: true 
    });
    
    peerConnection = new RTCPeerConnection({ 
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' }
      ] 
    });
    
    localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));

    peerConnection.ontrack = (event) => {
      remoteStream = event.streams[0];
      showCallUI(isVideo);
    };

    peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        socket.emit('callIceCandidate', { 
          chatId: currentChat.id, 
          candidate: event.candidate 
        });
      }
    };

    peerConnection.oniceconnectionstatechange = () => {
      console.log('ICE connection state:', peerConnection.iceConnectionState);
      if (peerConnection.iceConnectionState === 'disconnected' || 
          peerConnection.iceConnectionState === 'failed') {
        handleConnectionLost();
      }
    };

    peerConnection.onconnectionstatechange = () => {
      console.log('Connection state:', peerConnection.connectionState);
    };

    const offer = await peerConnection.createOffer({
      offerToReceiveAudio: true,
      offerToReceiveVideo: isVideo
    });
    
    await peerConnection.setLocalDescription(offer);
    
    socket.emit('callOffer', { 
      chatId: currentChat.id, 
      offer, 
      isVideo 
    });
    
    callActive = true;

    // Таймаут на ответ
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

/**
 * Принимает входящий звонок
 * @param {string} callId
 * @param {Object} offer
 * @param {boolean} isVideo
 */
async function acceptCall(callId, offer, isVideo) {
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ 
      video: isVideo, 
      audio: true 
    });
    
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
        socket.emit('callIceCandidate', { 
          chatId: currentChat.id, 
          candidate: event.candidate 
        });
      }
    };

    await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    
    socket.emit('callAnswer', { 
      chatId: currentChat.id, 
      answer 
    });
    
    callActive = true;
    currentCallId = callId;
    
  } catch (err) {
    console.error(err);
    endCall();
  }
}

/**
 * Завершает звонок
 */
function endCall() {
  if (peerConnection) {
    peerConnection.close();
    peerConnection = null;
  }
  
  if (localStream) {
    localStream.getTracks().forEach(t => t.stop());
    localStream = null;
  }
  
  remoteStream = null;
  callActive = false;
  currentCallId = null;
  
  const callWindow = document.getElementById('call-window');
  if (callWindow) callWindow.remove();
  
  if (currentChat) {
    socket.emit('callEnd', { chatId: currentChat.id });
  }
}

/**
 * Обрабатывает потерю соединения
 */
function handleConnectionLost() {
  alert('Connection lost');
  endCall();
}

/**
 * Показывает UI звонка
 * @param {boolean} isVideo
 */
function showCallUI(isVideo) {
  let callWindow = document.getElementById('call-window');
  if (!callWindow) {
    callWindow = document.createElement('div');
    callWindow.id = 'call-window';
    callWindow.className = 'call-window pixel-panel';
    document.body.appendChild(callWindow);
  }

  let contactName = 'User';
  if (currentChat) {
    if (currentChat.name) {
      contactName = currentChat.name;
    } else if (currentChat.participants) {
      const otherParticipants = currentChat.participants.filter(p => p.id !== currentUser?.id);
      contactName = otherParticipants.map(p => p.username).join(', ');
    }
  }

  callWindow.innerHTML = `
    <div class="call-header">
      <span>Call with ${contactName}</span>
      <button onclick="endCall()">❌</button>
    </div>
    <div class="call-timer" id="call-timer">00:00</div>
    <div class="call-video">
      ${isVideo ? 
        '<video id="remote-video" autoplay playsinline></video><video id="local-video" autoplay playsinline muted></video>' : 
        '<div class="call-avatar">👤</div>'
      }
    </div>
    <div class="call-controls">
      <button class="pixel-button" onclick="toggleMute()" id="mute-btn">🔇 Mute</button>
      ${isVideo ? '<button class="pixel-button" onclick="toggleCamera()" id="camera-btn">📷 Camera</button>' : ''}
      <button class="pixel-button" onclick="toggleSpeaker()" id="speaker-btn">🔊 Speaker</button>
      <button class="pixel-button danger" onclick="endCall()">📞 End</button>
    </div>
  `;

  if (isVideo) {
    const localVideo = callWindow.querySelector('#local-video');
    const remoteVideo = callWindow.querySelector('#remote-video');
    if (localVideo && localStream) localVideo.srcObject = localStream;
    if (remoteVideo && remoteStream) remoteVideo.srcObject = remoteStream;
  }
  
  // Таймер звонка
  let seconds = 0;
  const timer = document.getElementById('call-timer');
  const timerInterval = setInterval(() => {
    seconds++;
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    timer.textContent = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }, 1000);
  
  // Очищаем интервал при завершении звонка
  const originalEndCall = endCall;
  window.endCall = () => {
    clearInterval(timerInterval);
    originalEndCall();
  };
}

/**
 * Переключает mute микрофона
 */
function toggleMute() {
  if (localStream) {
    const audioTrack = localStream.getAudioTracks()[0];
    if (audioTrack) {
      audioTrack.enabled = !audioTrack.enabled;
      const muteBtn = document.getElementById('mute-btn');
      if (muteBtn) {
        muteBtn.textContent = audioTrack.enabled ? '🔇 Mute' : '🔊 Unmute';
      }
    }
  }
}

/**
 * Переключает камеру
 */
function toggleCamera() {
  if (localStream) {
    const videoTrack = localStream.getVideoTracks()[0];
    if (videoTrack) {
      videoTrack.enabled = !videoTrack.enabled;
      const cameraBtn = document.getElementById('camera-btn');
      if (cameraBtn) {
        cameraBtn.textContent = videoTrack.enabled ? '📷 Camera' : '📷 Camera Off';
      }
    }
  }
}

/**
 * Переключает динамик
 */
function toggleSpeaker() {
  if (remoteStream) {
    // В браузерах нельзя напрямую переключить динамик,
    // но можно попробовать изменить аудио-выход
    const audio = document.querySelector('audio');
    if (audio && audio.setSinkId) {
      // Переключение между динамиком и наушниками
      console.log('Speaker toggle not fully implemented');
    }
  }
}

// ==================== AI ФУНКЦИИ ====================

/**
 * Суммаризирует чат
 */
async function summarizeChat() {
  if (!currentChat) return;
  
  try {
    const response = await fetch(`${API_BASE}/ai/summarize`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json', 
        'Authorization': `Bearer ${token}` 
      },
      body: JSON.stringify({ chatId: currentChat.id })
    });
    
    const data = await response.json();
    
    if (data.summary) {
      alert('Summary:\n\n' + data.summary);
    } else {
      showError('Failed to generate summary');
    }
  } catch (err) {
    console.error(err);
    showError('Failed to summarize chat');
  }
}

/**
 * Переводит сообщение
 * @param {string} messageId
 * @param {string} targetLang
 */
async function translateMessage(messageId, targetLang = 'en') {
  if (!currentChat) return;
  
  const msg = messages[currentChat.id]?.find(m => m.id === messageId);
  if (!msg) return;
  
  try {
    const response = await fetch(`${API_BASE}/ai/translate`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json', 
        'Authorization': `Bearer ${token}` 
      },
      body: JSON.stringify({ text: msg.content, targetLang })
    });
    
    const data = await response.json();
    
    if (data.translated) {
      // Показываем перевод в модальном окне
      const modal = document.createElement('div');
      modal.className = 'pixel-modal';
      modal.innerHTML = `
        <div class="modal-content">
          <h3>Translation</h3>
          <p><strong>Original:</strong> ${sanitizeHtml(msg.content)}</p>
          <p><strong>Translated:</strong> ${sanitizeHtml(data.translated)}</p>
          <button class="pixel-button" onclick="this.closest('.pixel-modal').remove()">Close</button>
        </div>
      `;
      document.body.appendChild(modal);
    } else {
      showError('Translation failed');
    }
  } catch (err) {
    console.error(err);
    showError('Failed to translate message');
  }
}

/**
 * Генерирует умные ответы
 */
async function smartReply() {
  if (!currentChat) return;
  
  try {
    const response = await fetch(`${API_BASE}/ai/smart-reply`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json', 
        'Authorization': `Bearer ${token}` 
      },
      body: JSON.stringify({ chatId: currentChat.id })
    });
    
    const data = await response.json();
    
    if (!data.suggestions || data.suggestions.length === 0) {
      alert('No suggestions available');
      return;
    }
    
    // Показываем предложения в виде кнопок
    const modal = document.createElement('div');
    modal.className = 'pixel-modal';
    modal.innerHTML = `
      <div class="modal-content">
        <h3>Smart Replies</h3>
        <div style="display: flex; flex-direction: column; gap: 8px;">
          ${data.suggestions.map(s => `<button class="pixel-button" onclick="window.useSmartReply('${s}')">${s}</button>`).join('')}
        </div>
        <button class="pixel-button" onclick="this.closest('.pixel-modal').remove()">Cancel</button>
      </div>
    `;
    document.body.appendChild(modal);
    
    window.useSmartReply = (reply) => {
      document.getElementById('message-text').value = reply;
      modal.remove();
      delete window.useSmartReply;
    };
    
  } catch (err) {
    console.error(err);
    showError('Failed to generate smart replies');
  }
}

/**
 * Проверяет сообщение на спам
 * @param {string} text
 * @returns {Promise<boolean>}
 */
async function checkSpam(text) {
  try {
    const response = await fetch(`${API_BASE}/ai/detect-spam`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json', 
        'Authorization': `Bearer ${token}` 
      },
      body: JSON.stringify({ text })
    });
    
    const data = await response.json();
    return data.isSpam || false;
  } catch (err) {
    console.error(err);
    return false;
  }
} 
// public/app.js – клиентская логика CraneApp Messenger
// ЧАСТЬ 6: Мобильный интерфейс, создание чата, профиль, настройки

// ==================== МОБИЛЬНЫЙ ИНТЕРФЕЙС ====================

/**
 * Инициализирует мобильный интерфейс
 */
function initMobileUI() {
  // Bottom navigation уже есть в HTML
  
  // Floating Action Button уже есть в HTML
  
  // Swipe gestures для открытия/закрытия списка чатов
  let touchstartX = 0;
  let touchendX = 0;
  
  document.addEventListener('touchstart', e => {
    touchstartX = e.changedTouches[0].screenX;
  });
  
  document.addEventListener('touchend', e => {
    touchendX = e.changedTouches[0].screenX;
    handleSwipe();
  });
  
  function handleSwipe() {
    const swiped = touchendX - touchstartX;
    if (Math.abs(swiped) < 50) return;
    
    const chatListPanel = document.querySelector('.chat-list-panel');
    if (!chatListPanel) return;
    
    if (swiped > 0 && window.innerWidth <= 768) {
      // Свайп вправо – открыть список чатов
      chatListPanel.classList.add('active');
    } else if (swiped < 0 && chatListPanel.classList.contains('active')) {
      // Свайп влево – закрыть
      chatListPanel.classList.remove('active');
    }
  }
  
  // Обработка свайпов для правой панели
  let touchstartY = 0;
  document.addEventListener('touchstart', e => {
    touchstartY = e.changedTouches[0].screenY;
  });
  
  document.addEventListener('touchend', e => {
    const touchendY = e.changedTouches[0].screenY;
    const swiped = touchendY - touchstartY;
    
    const rightPanel = document.getElementById('right-panel');
    if (!rightPanel) return;
    
    if (Math.abs(swiped) > 100 && window.innerWidth <= 768) {
      if (swiped < 0) {
        // Свайп вверх – закрыть
        rightPanel.classList.remove('active');
      }
    }
  });
  
  // Адаптация размера шрифта для мобильных
  if (window.innerWidth <= 768) {
    document.documentElement.style.fontSize = '14px';
  }
  
  // Обработка изменения ориентации
  window.addEventListener('resize', () => {
    if (window.innerWidth <= 768) {
      document.documentElement.style.fontSize = '14px';
    } else {
      document.documentElement.style.fontSize = '16px';
    }
  });
}

// ==================== СОЗДАНИЕ ЧАТА ====================

/**
 * Показывает модальное окно создания чата
 */
function showCreateChatModal() {
  const modal = document.createElement('div');
  modal.className = 'pixel-modal';
  modal.innerHTML = `
    <div class="modal-content">
      <h3>Create New Chat</h3>
      <select id="chat-type" class="pixel-input">
        <option value="private">Private Chat</option>
        <option value="group">Group</option>
        <option value="channel">Channel</option>
      </select>
      <input type="text" id="chat-name" placeholder="Name (optional for private)" class="pixel-input">
      <textarea id="chat-description" placeholder="Description (optional)" rows="3" class="pixel-input"></textarea>
      <div id="member-selector" style="display:none;">
        <input type="text" id="member-search" placeholder="Search users..." class="pixel-input">
        <div id="member-list" style="max-height: 200px; overflow-y: auto; margin-top: 8px;"></div>
      </div>
      <div id="selected-members" style="display: flex; flex-wrap: wrap; gap: 4px; margin: 8px 0;"></div>
      <div style="display: flex; gap: 8px; justify-content: flex-end; margin-top: 16px;">
        <button id="create-chat-btn" class="pixel-button primary">Create</button>
        <button class="pixel-button" onclick="this.closest('.pixel-modal').remove()">Cancel</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  
  const typeSelect = modal.querySelector('#chat-type');
  const memberSelector = modal.querySelector('#member-selector');
  const memberSearch = modal.querySelector('#member-search');
  const memberList = modal.querySelector('#member-list');
  const selectedMembersDiv = modal.querySelector('#selected-members');
  const selectedMembers = new Set();
  
  // Обработка изменения типа чата
  typeSelect.addEventListener('change', () => {
    const isGroup = typeSelect.value === 'group';
    const isChannel = typeSelect.value === 'channel';
    memberSelector.style.display = isGroup ? 'block' : 'none';
    
    const nameInput = document.getElementById('chat-name');
    if (isGroup) {
      nameInput.placeholder = 'Group name (required)';
      nameInput.required = true;
    } else if (isChannel) {
      nameInput.placeholder = 'Channel name (required)';
      nameInput.required = true;
    } else {
      nameInput.placeholder = 'Name (optional for private)';
      nameInput.required = false;
    }
  });
  
  // Поиск пользователей для добавления в группу
  if (memberSearch) {
    memberSearch.addEventListener('input', debounce(async () => {
      const query = memberSearch.value.trim();
      if (query.length < 2) return;
      
      try {
        const response = await fetch(`${API_BASE}/users/search/${query}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        const users = await response.json();
        
        memberList.innerHTML = '';
        users.forEach(user => {
          if (user.id === currentUser?.id) return;
          if (selectedMembers.has(user.id)) return;
          
          const div = document.createElement('div');
          div.className = 'member-item';
          div.innerHTML = `
            <img src="${user.avatar || 'https://i.ibb.co/QjTkyWfG/85-20260306202001.png'}" class="member-avatar">
            <span class="member-name">${user.username}</span>
            <button class="pixel-button small" onclick="addMemberToSelection('${user.id}', '${user.username}', '${user.avatar || ''}')">Add</button>
          `;
          memberList.appendChild(div);
        });
      } catch (err) {
        console.error(err);
      }
    }, 300));
  }
  
  // Функция для добавления участника
  window.addMemberToSelection = (userId, username, avatar) => {
    if (selectedMembers.has(userId)) return;
    selectedMembers.add(userId);
    
    const chip = document.createElement('div');
    chip.className = 'member-chip';
    chip.dataset.userId = userId;
    chip.innerHTML = `
      <img src="${avatar || 'https://i.ibb.co/QjTkyWfG/85-20260306202001.png'}" class="member-chip-avatar">
      <span>${username}</span>
      <button onclick="removeMemberFromSelection('${userId}')">×</button>
    `;
    selectedMembersDiv.appendChild(chip);
    
    // Обновляем список результатов
    if (memberList) {
      const items = memberList.querySelectorAll('.member-item');
      items.forEach(item => {
        const addBtn = item.querySelector('button');
        if (addBtn && addBtn.onclick?.toString().includes(userId)) {
          item.remove();
        }
      });
    }
  };
  
  window.removeMemberFromSelection = (userId) => {
    selectedMembers.delete(userId);
    const chip = document.querySelector(`.member-chip[data-user-id="${userId}"]`);
    if (chip) chip.remove();
  };
  
  // Создание чата
  modal.querySelector('#create-chat-btn').addEventListener('click', async () => {
    const type = typeSelect.value;
    const name = document.getElementById('chat-name').value;
    const description = document.getElementById('chat-description').value;
    
    let memberIds = [];
    if (type === 'group') {
      memberIds = Array.from(selectedMembers);
      if (!name || name.length < 3) {
        alert('Group name must be at least 3 characters');
        return;
      }
    } else if (type === 'channel') {
      if (!name || name.length < 3) {
        alert('Channel name must be at least 3 characters');
        return;
      }
    } else if (type === 'private') {
      // Для личного чата нужно выбрать пользователя
      alert('Private chat creation - please use the contacts page to start a chat');
      modal.remove();
      return;
    }
    
    try {
      const response = await fetch(`${API_BASE}/chats`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json', 
          'Authorization': `Bearer ${token}` 
        },
        body: JSON.stringify({ type, name, description, memberIds })
      });
      
      const data = await response.json();
      if (response.ok) {
        modal.remove();
        loadChats();
        if (data.id) {
          openChat(data.id);
        }
      } else {
        alert(data.error || 'Failed to create chat');
      }
    } catch (err) {
      console.error(err);
      alert('Failed to create chat');
    }
  });
}

// ==================== ПРОФИЛЬ ====================

/**
 * Показывает модальное окно редактирования профиля
 */
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
          <div style="text-align: center; margin-bottom: 16px; position: relative;">
            <img src="${user.avatar || 'https://i.ibb.co/QjTkyWfG/85-20260306202001.png'}" 
                 id="profile-avatar-preview"
                 style="width: 100px; height: 100px; border-radius: 50%; border: 2px solid var(--accent-pink); cursor: pointer;">
            <input type="file" id="avatar-upload" accept="image/*" style="display: none;">
          </div>
          <input type="text" id="edit-username" value="${user.username}" placeholder="Username" class="pixel-input">
          <textarea id="edit-bio" placeholder="Bio" class="pixel-input" rows="3">${user.bio || ''}</textarea>
          <select id="edit-status" class="pixel-input">
            <option value="online" ${user.status === 'online' ? 'selected' : ''}>Online</option>
            <option value="away" ${user.status === 'away' ? 'selected' : ''}>Away</option>
            <option value="busy" ${user.status === 'busy' ? 'selected' : ''}>Busy</option>
            <option value="offline" ${user.status === 'offline' ? 'selected' : ''}>Offline</option>
          </select>
          <div style="display: flex; gap: 8px; justify-content: flex-end; margin-top: 16px;">
            <button id="save-profile-btn" class="pixel-button primary">Save</button>
            <button class="pixel-button" onclick="this.closest('.pixel-modal').remove()">Cancel</button>
          </div>
        </div>
      `;
      document.body.appendChild(modal);
      
      const avatarPreview = modal.querySelector('#profile-avatar-preview');
      const avatarUpload = modal.querySelector('#avatar-upload');
      
      avatarPreview.addEventListener('click', () => {
        avatarUpload.click();
      });
      
      avatarUpload.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (file) {
          const formData = new FormData();
          formData.append('file', file);
          
          try {
            const res = await fetch(`${API_BASE}/media/upload`, {
              method: 'POST',
              headers: { 'Authorization': `Bearer ${token}` },
              body: formData
            });
            const data = await res.json();
            if (res.ok) {
              avatarPreview.src = data.url;
              modal.dataset.newAvatar = data.url;
            }
          } catch (err) {
            console.error(err);
          }
        }
      });
      
      modal.querySelector('#save-profile-btn').addEventListener('click', async () => {
        const username = modal.querySelector('#edit-username').value;
        const bio = modal.querySelector('#edit-bio').value;
        const status = modal.querySelector('#edit-status').value;
        const avatar = modal.dataset.newAvatar;
        
        const body = { username, bio, status };
        if (avatar) body.avatar = avatar;
        
        try {
          const res = await fetch(`${API_BASE}/profile/me`, {
            method: 'PUT',
            headers: { 
              'Content-Type': 'application/json', 
              'Authorization': `Bearer ${token}` 
            },
            body: JSON.stringify(body)
          });
          
          if (res.ok) {
            const updatedUser = await res.json();
            currentUser = { ...currentUser, ...updatedUser };
            updateSidebarAvatar();
            updateProfileScreen();
            modal.remove();
            showSuccess('Profile updated');
          } else {
            alert('Update failed');
          }
        } catch (err) {
          console.error(err);
        }
      });
    });
}

// ==================== НАСТРОЙКИ ====================

/**
 * Показывает страницу настроек
 */
function showSettingsPage() {
  const main = document.getElementById('main-screen');
  if (!main) return;
  
  // Скрываем основные панели
  document.querySelector('.sidebar').style.display = 'none';
  document.querySelector('.chat-list-panel').style.display = 'none';
  document.getElementById('chat-window').style.display = 'none';
  document.getElementById('right-panel').style.display = 'none';
  
  // Показываем настройки
  document.getElementById('settings-screen').style.display = 'block';
  
  // Загружаем настройки
  loadSettings();
}

/**
 * Загружает настройки пользователя
 */
async function loadSettings() {
  try {
    const response = await fetch(`${API_BASE}/settings`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    
    if (!response.ok) throw new Error('Failed to load settings');
    
    const settings = await response.json();
    applySettings(settings);
  } catch (err) {
    console.error(err);
  }
}

/**
 * Применяет настройки к интерфейсу
 * @param {Object} settings
 */
function applySettings(settings) {
  // Применяем тему
  if (settings.theme) {
    setTheme(settings.theme);
  }
  
  // Применяем язык
  if (settings.language) {
    setLanguage(settings.language);
  }
  
  // Применяем настройки уведомлений
  if (settings.notifications) {
    // Сохраняем в localStorage или глобальной переменной
    localStorage.setItem('notifications', JSON.stringify(settings.notifications));
  }
  
  // Применяем настройки чата
  if (settings.chat) {
    const messageInput = document.getElementById('message-text');
    if (messageInput && settings.chat.enterToSend !== undefined) {
      // Обработка Enter будет в соответствующем месте
    }
    
    if (settings.chat.fontSize) {
      document.documentElement.style.fontSize = settings.chat.fontSize + 'px';
    }
  }
}

/**
 * Сохраняет настройки
 * @param {Object} settings
 */
async function saveSettings(settings) {
  try {
    const response = await fetch(`${API_BASE}/settings`, {
      method: 'PUT',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}` 
      },
      body: JSON.stringify(settings)
    });
    
    if (response.ok) {
      applySettings(settings);
      showSuccess('Settings saved');
    } else {
      showError('Failed to save settings');
    }
  } catch (err) {
    console.error(err);
  }
}

// ==================== НАВИГАЦИЯ ====================

/**
 * Возврат на главный экран
 */
function goBack() {
  // Скрываем все дополнительные экраны
  document.getElementById('contacts-screen').style.display = 'none';
  document.getElementById('calls-screen').style.display = 'none';
  document.getElementById('channels-screen').style.display = 'none';
  document.getElementById('settings-screen').style.display = 'none';
  document.getElementById('search-screen').style.display = 'none';
  document.getElementById('profile-screen').style.display = 'none';
  
  // Показываем основной интерфейс
  document.querySelector('.sidebar').style.display = 'flex';
  document.querySelector('.chat-list-panel').style.display = 'flex';
  
  if (currentChat) {
    document.getElementById('chat-window').style.display = 'flex';
    document.getElementById('right-panel').style.display = 'block';
  }
  
  // Очищаем URL параметры
  updateUrlParams({ view: null });
}

/**
 * Переключение между видами
 * @param {string} view
 */
function switchView(view) {
  goBack(); // Сначала скрываем все дополнительные экраны
  
  switch(view) {
    case 'chats':
      // Уже на главной
      updateUrlParams({ view: null });
      break;
    case 'contacts':
      document.getElementById('contacts-screen').style.display = 'block';
      loadContacts();
      updateUrlParams({ view: 'contacts' });
      break;
    case 'calls':
      document.getElementById('calls-screen').style.display = 'block';
      loadCalls();
      updateUrlParams({ view: 'calls' });
      break;
    case 'channels':
      document.getElementById('channels-screen').style.display = 'block';
      loadChannels();
      updateUrlParams({ view: 'channels' });
      break;
    case 'settings':
      showSettingsPage();
      updateUrlParams({ view: 'settings' });
      break;
    case 'search':
      document.getElementById('search-screen').style.display = 'block';
      updateUrlParams({ view: 'search' });
      break;
    case 'profile':
      document.getElementById('profile-screen').style.display = 'block';
      updateProfileScreen();
      updateUrlParams({ view: 'profile' });
      break;
  }
}

// ==================== ЗАГРУЗКА ДАННЫХ ДЛЯ ЭКРАНОВ ====================

/**
 * Загружает список контактов
 */
async function loadContacts() {
  try {
    const response = await fetch(`${API_BASE}/contacts`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const contacts = await response.json();
    
    const list = document.getElementById('contacts-list');
    if (!list) return;
    
    if (contacts.length === 0) {
      list.innerHTML = '<div class="empty-state">No contacts yet. Add some!</div>';
      return;
    }
    
    list.innerHTML = contacts.map(contact => `
      <div class="contact-item" onclick="UI.openChat('${contact.id}')">
        <img src="${contact.avatar || 'https://i.ibb.co/QjTkyWfG/85-20260306202001.png'}" class="contact-avatar">
        <div class="contact-info">
          <div class="contact-name">${contact.custom_name || contact.username}</div>
          <div class="contact-status ${contact.online ? 'online' : ''}">${contact.online ? 'Online' : 'Offline'}</div>
        </div>
        <div class="contact-actions">
          <button class="pixel-button small" onclick="event.stopPropagation(); UI.startCallWith('${contact.id}')">📞</button>
          <button class="pixel-button small" onclick="event.stopPropagation(); UI.removeContact('${contact.id}')">❌</button>
        </div>
      </div>
    `).join('');
  } catch (err) {
    console.error(err);
  }
}

/**
 * Загружает историю звонков
 */
async function loadCalls() {
  try {
    const response = await fetch(`${API_BASE}/calls/history`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const calls = await response.json();
    
    const list = document.getElementById('calls-history');
    if (!list) return;
    
    if (calls.length === 0) {
      list.innerHTML = '<div class="empty-state">No calls yet</div>';
      return;
    }
    
    list.innerHTML = calls.map(call => `
      <div class="call-item" onclick="UI.openChat('${call.contact.id}')">
        <img src="${call.contact.avatar || 'https://i.ibb.co/QjTkyWfG/85-20260306202001.png'}" class="call-avatar">
        <div class="call-info">
          <div class="call-name">${call.contact.name}</div>
          <div class="call-meta">
            <span class="call-direction ${call.direction}">
              ${call.direction === 'incoming' ? '📥' : '📤'} ${call.direction}
            </span>
            <span class="call-status ${call.status}">${call.status}</span>
            <span>${formatDate(call.started_at)}</span>
          </div>
        </div>
      </div>
    `).join('');
  } catch (err) {
    console.error(err);
  }
}

/**
 * Загружает список каналов
 */
async function loadChannels() {
  try {
    const response = await fetch(`${API_BASE}/channels/my`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const channels = await response.json();
    
    const list = document.getElementById('channels-list');
    if (!list) return;
    
    if (channels.length === 0) {
      list.innerHTML = '<div class="empty-state">No channels yet. Create one!</div>';
      return;
    }
    
    list.innerHTML = channels.map(channel => `
      <div class="channel-item" onclick="UI.openChat('${channel.id}')">
        <img src="${channel.avatar || 'https://i.ibb.co/QjTkyWfG/85-20260306202001.png'}" class="channel-avatar">
        <div class="channel-info">
          <div class="channel-name">${channel.name}</div>
          <div class="channel-meta">
            <span>👥 ${channel.subscribers_count}</span>
            <span>📝 ${channel.posts_count}</span>
          </div>
        </div>
        <button class="channel-subscribe-btn pixel-button small subscribed" onclick="event.stopPropagation(); UI.unsubscribeChannel('${channel.id}')">✓ Subscribed</button>
      </div>
    `).join('');
  } catch (err) {
    console.error(err);
  }
}

/**
 * Показывает главный экран
 */
function showMainScreen() {
  document.getElementById('auth-screen').classList.remove('active');
  document.getElementById('main-screen').classList.add('active');
  
  // Показываем основные панели
  document.querySelector('.sidebar').style.display = 'flex';
  document.querySelector('.chat-list-panel').style.display = 'flex';
  
  loadChats();
  initMobileUI();
  initDragAndDrop();
  
  // Проверяем URL параметры
  const params = getUrlParams();
  if (params.view && params.view !== 'chats') {
    switchView(params.view);
  }
}
// public/app.js – клиентская логика CraneApp Messenger
// ЧАСТЬ 7: Глобальный объект UI и завершение

// ==================== ГЛОБАЛЬНЫЙ UI ОБЪЕКТ ====================

window.UI = {
  // Навигация
  switchView,
  goBack,
  
  // Чат
  openChat: (chatId) => openChat(chatId),
  closeChat: () => {
    document.getElementById('chat-window').style.display = 'none';
    document.getElementById('right-panel').style.display = 'none';
    currentChat = null;
    updateUrlParams({ chat: null });
  },
  
  // Звонки
  startCall: () => startCall(false),
  startVideoCall: () => startCall(true),
  startCallWith: async (userId) => {
    try {
      const response = await fetch(`${API_BASE}/calls/start`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}` 
        },
        body: JSON.stringify({ calleeId: userId, type: 'voice' })
      });
      
      if (response.ok) {
        const data = await response.json();
        currentCallId = data.callId;
      }
    } catch (err) {
      console.error(err);
    }
  },
  
  // Профиль
  openProfile: showEditProfileModal,
  editProfile: showEditProfileModal,
  changeAvatar: () => {
    document.getElementById('avatar-upload')?.click();
  },
  shareProfile: () => {
    if (currentUser) {
      const url = `${window.location.origin}/user/${currentUser.id}`;
      copyToClipboard(url);
    }
  },
  blockUser: async () => {
    if (!currentChat || currentChat.type !== 'private') return;
    
    const otherParticipant = currentChat.participants?.find(p => p.id !== currentUser?.id);
    if (!otherParticipant) return;
    
    if (confirm(`Block ${otherParticipant.username}?`)) {
      try {
        await fetch(`${API_BASE}/users/${otherParticipant.id}/block`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}` }
        });
        showSuccess('User blocked');
        UI.closeChat();
      } catch (err) {
        console.error(err);
      }
    }
  },
  
  // Создание
  showCreateChatModal,
  showCreateChannelModal: () => {
    const modal = document.createElement('div');
    modal.className = 'pixel-modal';
    modal.innerHTML = `
      <div class="modal-content">
        <h3>Create Channel</h3>
        <input type="text" id="channel-name" placeholder="Channel name" class="pixel-input">
        <input type="text" id="channel-username" placeholder="Username (optional)" class="pixel-input">
        <textarea id="channel-description" placeholder="Description" rows="3" class="pixel-input"></textarea>
        <label style="display: flex; align-items: center; gap: 8px; margin: 8px 0;">
          <input type="checkbox" id="channel-public" checked> Public channel
        </label>
        <div style="display: flex; gap: 8px; justify-content: flex-end;">
          <button id="create-channel-btn" class="pixel-button primary">Create</button>
          <button class="pixel-button" onclick="this.closest('.pixel-modal').remove()">Cancel</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    
    modal.querySelector('#create-channel-btn').addEventListener('click', async () => {
      const name = document.getElementById('channel-name').value;
      const username = document.getElementById('channel-username').value;
      const description = document.getElementById('channel-description').value;
      const isPublic = document.getElementById('channel-public').checked;
      
      if (!name || name.length < 3) {
        alert('Channel name must be at least 3 characters');
        return;
      }
      
      try {
        const response = await fetch(`${API_BASE}/channels`, {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}` 
          },
          body: JSON.stringify({ name, username, description, isPublic })
        });
        
        const data = await response.json();
        if (response.ok) {
          modal.remove();
          loadChannels();
          openChat(data.id);
        } else {
          alert(data.error || 'Failed to create channel');
        }
      } catch (err) {
        console.error(err);
      }
    });
  },
  
  // Контакты
  showAddContact: () => {
    document.getElementById('contacts-screen').style.display = 'block';
    document.getElementById('contact-search').focus();
  },
  addContact: async (userId) => {
    try {
      await fetch(`${API_BASE}/contacts`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}` 
        },
        body: JSON.stringify({ contactId: userId })
      });
      loadContacts();
      showSuccess('Contact added');
    } catch (err) {
      console.error(err);
    }
  },
  removeContact: async (contactId) => {
    if (confirm('Remove this contact?')) {
      try {
        await fetch(`${API_BASE}/contacts/${contactId}`, {
          method: 'DELETE',
          headers: { 'Authorization': `Bearer ${token}` }
        });
        loadContacts();
        showSuccess('Contact removed');
      } catch (err) {
        console.error(err);
      }
    }
  },
  
  // Каналы
  subscribeChannel: async (channelId) => {
    try {
      await fetch(`${API_BASE}/channels/${channelId}/subscribe`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      loadChannels();
      showSuccess('Subscribed to channel');
    } catch (err) {
      console.error(err);
    }
  },
  unsubscribeChannel: async (channelId) => {
    if (confirm('Unsubscribe from this channel?')) {
      try {
        await fetch(`${API_BASE}/channels/${channelId}/unsubscribe`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}` }
        });
        loadChannels();
        showSuccess('Unsubscribed from channel');
      } catch (err) {
        console.error(err);
      }
    }
  },
  
  // Сообщения
  sendMessage,
  handleTyping,
  handleKeyPress: (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      const settings = JSON.parse(localStorage.getItem('settings') || '{}');
      const enterToSend = settings.chat?.enterToSend !== false;
      
      if (enterToSend) {
        e.preventDefault();
        sendMessage();
      }
    }
  },
  
  // Emoji
  toggleEmojiPicker,
  
  // Прикрепление
  showAttachMenu: () => {
    const menu = document.getElementById('attach-menu');
    if (menu) {
      menu.style.display = menu.style.display === 'none' ? 'flex' : 'none';
    }
  },
  attachFile: (type) => {
    const input = document.createElement('input');
    input.type = 'file';
    
    if (type === 'image') input.accept = 'image/*';
    else if (type === 'video') input.accept = 'video/*';
    else if (type === 'audio') input.accept = 'audio/*';
    else if (type === 'voice') {
      startVoiceRecording();
      document.getElementById('attach-menu').style.display = 'none';
      return;
    }
    
    input.multiple = type === 'file';
    input.onchange = (e) => {
      if (e.target.files.length) {
        uploadFiles(e.target.files);
      }
      document.getElementById('attach-menu').style.display = 'none';
    };
    input.click();
  },
  attachLocation: () => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(async (position) => {
        const { latitude, longitude } = position.coords;
        const mapUrl = `https://maps.google.com/?q=${latitude},${longitude}`;
        
        socket.emit('sendMessage', {
          chatId: currentChat.id,
          content: mapUrl,
          type: 'location'
        });
        
        document.getElementById('attach-menu').style.display = 'none';
      });
    } else {
      alert('Geolocation not supported');
    }
  },
  attachContact: () => {
    // Показываем список контактов для отправки
    const modal = document.createElement('div');
    modal.className = 'pixel-modal';
    modal.innerHTML = `
      <div class="modal-content">
        <h3>Share Contact</h3>
        <div class="contacts-list" id="share-contacts-list"></div>
        <button class="pixel-button" onclick="this.closest('.pixel-modal').remove()">Cancel</button>
      </div>
    `;
    document.body.appendChild(modal);
    
    fetch(`${API_BASE}/contacts`, {
      headers: { 'Authorization': `Bearer ${token}` }
    })
      .then(res => res.json())
      .then(contacts => {
        const list = document.getElementById('share-contacts-list');
        if (!list) return;
        
        list.innerHTML = contacts.map(contact => `
          <div class="contact-item" onclick="UI.shareContact('${contact.id}')">
            <img src="${contact.avatar || 'https://i.ibb.co/QjTkyWfG/85-20260306202001.png'}" class="contact-avatar">
            <div class="contact-info">
              <div class="contact-name">${contact.custom_name || contact.username}</div>
            </div>
          </div>
        `).join('');
      });
  },
  shareContact: (contactId) => {
    socket.emit('sendMessage', {
      chatId: currentChat.id,
      content: contactId,
      type: 'contact'
    });
    document.querySelector('.pixel-modal').remove();
    document.getElementById('attach-menu').style.display = 'none';
  },
  
  // Поиск
  onSearchInput,
  globalSearch: () => {
    switchView('search');
    setTimeout(() => {
      document.getElementById('global-search').focus();
    }, 100);
  },
  searchContacts: debounce(async () => {
    const query = document.getElementById('contact-search').value;
    if (query.length < 2) {
      loadContacts();
      return;
    }
    
    try {
      const response = await fetch(`${API_BASE}/contacts/search/${query}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const users = await response.json();
      
      const list = document.getElementById('contacts-list');
      if (!list) return;
      
      if (users.length === 0) {
        list.innerHTML = '<div class="empty-state">No users found</div>';
        return;
      }
      
      list.innerHTML = users.map(user => `
        <div class="contact-item" onclick="UI.addContact('${user.id}')">
          <img src="${user.avatar || 'https://i.ibb.co/QjTkyWfG/85-20260306202001.png'}" class="contact-avatar">
          <div class="contact-info">
            <div class="contact-name">${user.username}</div>
            <div class="contact-status ${user.online ? 'online' : ''}">${user.online ? 'Online' : 'Offline'}</div>
          </div>
          <button class="pixel-button small">Add</button>
        </div>
      `).join('');
    } catch (err) {
      console.error(err);
    }
  }, 300),
  searchChannels: debounce(async () => {
    const query = document.getElementById('channel-search').value;
    const activeTab = document.querySelector('#channels-screen .tab.active')?.dataset.tab || 'my';
    
    if (activeTab === 'my') {
      loadChannels();
      return;
    }
    
    try {
      const response = await fetch(`${API_BASE}/channels/public?search=${encodeURIComponent(query)}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const channels = await response.json();
      
      const list = document.getElementById('channels-list');
      if (!list) return;
      
      if (channels.length === 0) {
        list.innerHTML = '<div class="empty-state">No channels found</div>';
        return;
      }
      
      list.innerHTML = channels.map(channel => `
        <div class="channel-item" onclick="UI.openChat('${channel.id}')">
          <img src="${channel.avatar || 'https://i.ibb.co/QjTkyWfG/85-20260306202001.png'}" class="channel-avatar">
          <div class="channel-info">
            <div class="channel-name">${channel.name}</div>
            <div class="channel-meta">
              <span>👥 ${channel.subscribers_count}</span>
              <span>📝 ${channel.posts_count}</span>
            </div>
          </div>
          <button class="channel-subscribe-btn pixel-button small" onclick="event.stopPropagation(); UI.subscribeChannel('${channel.id}')">Subscribe</button>
        </div>
      `).join('');
    } catch (err) {
      console.error(err);
    }
  }, 300),
  
  // Настройки
  openAppearance: () => {
    const modal = document.createElement('div');
    modal.className = 'pixel-modal';
    modal.innerHTML = `
      <div class="modal-content">
        <h3>Appearance</h3>
        <div class="settings-section">
          <label>Theme</label>
          <select id="theme-select" class="pixel-input">
            <option value="dark">Dark</option>
            <option value="light">Light</option>
            <option value="neon">Neon</option>
          </select>
        </div>
        <div class="settings-section">
          <label>Font Size</label>
          <input type="range" id="font-size" min="12" max="24" value="16" class="pixel-input">
        </div>
        <div style="display: flex; gap: 8px; justify-content: flex-end;">
          <button id="save-appearance" class="pixel-button primary">Save</button>
          <button class="pixel-button" onclick="this.closest('.pixel-modal').remove()">Cancel</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    
    document.getElementById('theme-select').value = currentTheme;
    
    modal.querySelector('#save-appearance').addEventListener('click', async () => {
      const theme = document.getElementById('theme-select').value;
      const fontSize = document.getElementById('font-size').value;
      
      setTheme(theme);
      document.documentElement.style.fontSize = fontSize + 'px';
      
      const settings = await fetch(`${API_BASE}/settings`).then(res => res.json());
      settings.theme = theme;
      settings.chat = settings.chat || {};
      settings.chat.fontSize = parseInt(fontSize);
      await saveSettings(settings);
      
      modal.remove();
    });
  },
  
  openNotifications: () => {
    const modal = document.createElement('div');
    modal.className = 'pixel-modal';
    modal.innerHTML = `
      <div class="modal-content">
        <h3>Notifications</h3>
        <div class="settings-section">
          <label style="display: flex; align-items: center;">
            <input type="checkbox" id="notif-enabled" checked> Enable notifications
          </label>
          <label style="display: flex; align-items: center;">
            <input type="checkbox" id="notif-sound" checked> Sound
          </label>
          <label style="display: flex; align-items: center;">
            <input type="checkbox" id="notif-vibration" checked> Vibration
          </label>
          <label style="display: flex; align-items: center;">
            <input type="checkbox" id="notif-preview" checked> Show message preview
          </label>
        </div>
        <div style="display: flex; gap: 8px; justify-content: flex-end;">
          <button id="save-notifications" class="pixel-button primary">Save</button>
          <button class="pixel-button" onclick="this.closest('.pixel-modal').remove()">Cancel</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    
    modal.querySelector('#save-notifications').addEventListener('click', async () => {
      const settings = await fetch(`${API_BASE}/settings`).then(res => res.json());
      settings.notifications = {
        enabled: document.getElementById('notif-enabled').checked,
        sound: document.getElementById('notif-sound').checked,
        vibration: document.getElementById('notif-vibration').checked,
        showPreview: document.getElementById('notif-preview').checked
      };
      await saveSettings(settings);
      modal.remove();
    });
  },
  
  openPrivacy: () => {
    const modal = document.createElement('div');
    modal.className = 'pixel-modal';
    modal.innerHTML = `
      <div class="modal-content">
        <h3>Privacy & Security</h3>
        <div class="settings-section">
          <label>Last Seen</label>
          <select id="privacy-lastseen" class="pixel-input">
            <option value="everyone">Everyone</option>
            <option value="contacts">My Contacts</option>
            <option value="nobody">Nobody</option>
          </select>
        </div>
        <div class="settings-section">
          <label>Profile Photo</label>
          <select id="privacy-photo" class="pixel-input">
            <option value="everyone">Everyone</option>
            <option value="contacts">My Contacts</option>
            <option value="nobody">Nobody</option>
          </select>
        </div>
        <div class="settings-section">
          <label style="display: flex; align-items: center;">
            <input type="checkbox" id="privacy-2fa"> Enable 2FA
          </label>
        </div>
        <div style="display: flex; gap: 8px; justify-content: flex-end;">
          <button id="save-privacy" class="pixel-button primary">Save</button>
          <button class="pixel-button" onclick="this.closest('.pixel-modal').remove()">Cancel</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    
    modal.querySelector('#save-privacy').addEventListener('click', async () => {
      const settings = await fetch(`${API_BASE}/settings`).then(res => res.json());
      settings.privacy = {
        lastSeen: document.getElementById('privacy-lastseen').value,
        profilePhoto: document.getElementById('privacy-photo').value
      };
      await saveSettings(settings);
      
      if (document.getElementById('privacy-2fa').checked) {
        // Запрос на включение 2FA
        const response = await fetch(`${API_BASE}/auth/2fa/enable`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}` }
        });
        
        if (response.ok) {
          const data = await response.json();
          showQRCode(data.qrCode, data.secret);
        }
      }
      
      modal.remove();
    });
  },
  
  openLanguage: () => {
    const modal = document.createElement('div');
    modal.className = 'pixel-modal';
    modal.innerHTML = `
      <div class="modal-content">
        <h3>Language</h3>
        <select id="language-select" class="pixel-input">
          <option value="ru">Русский</option>
          <option value="en">English</option>
        </select>
        <div style="display: flex; gap: 8px; justify-content: flex-end; margin-top: 16px;">
          <button id="save-language" class="pixel-button primary">Save</button>
          <button class="pixel-button" onclick="this.closest('.pixel-modal').remove()">Cancel</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    
    document.getElementById('language-select').value = currentLanguage;
    
    modal.querySelector('#save-language').addEventListener('click', async () => {
      const lang = document.getElementById('language-select').value;
      setLanguage(lang);
      
      const settings = await fetch(`${API_BASE}/settings`).then(res => res.json());
      settings.language = lang;
      await saveSettings(settings);
      
      modal.remove();
    });
  },
  
  openDevices: async () => {
    try {
      const response = await fetch(`${API_BASE}/auth/devices`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const devices = await response.json();
      
      const modal = document.createElement('div');
      modal.className = 'pixel-modal';
      modal.innerHTML = `
        <div class="modal-content">
          <h3>Active Devices</h3>
          <div class="devices-list">
            ${devices.map(device => `
              <div class="device-item">
                <div>
                  <strong>${device.name}</strong>
                  <div>${device.ip} · ${new Date(device.created_at).toLocaleDateString()}</div>
                </div>
                <span class="device-status ${device.online ? 'online' : 'offline'}">
                  ${device.online ? 'Online' : 'Offline'}
                </span>
                ${device.id !== req.user.deviceId ? `
                  <button class="pixel-button small danger" onclick="UI.terminateDevice('${device.id}')">Terminate</button>
                ` : ''}
              </div>
            `).join('')}
          </div>
          <button class="pixel-button" onclick="this.closest('.pixel-modal').remove()">Close</button>
        </div>
      `;
      document.body.appendChild(modal);
    } catch (err) {
      console.error(err);
    }
  },
  
  terminateDevice: async (deviceId) => {
    if (confirm('Terminate this session?')) {
      try {
        await fetch(`${API_BASE}/auth/devices/${deviceId}`, {
          method: 'DELETE',
          headers: { 'Authorization': `Bearer ${token}` }
        });
        showSuccess('Session terminated');
        UI.openDevices();
      } catch (err) {
        console.error(err);
      }
    }
  },
  
  openStorage: () => {
    // Показываем статистику использования хранилища
    const modal = document.createElement('div');
    modal.className = 'pixel-modal';
    modal.innerHTML = `
      <div class="modal-content">
        <h3>Storage</h3>
        <div class="settings-section">
          <p>Cache size: Calculating...</p>
          <button class="pixel-button" onclick="UI.clearCache()">Clear Cache</button>
        </div>
        <button class="pixel-button" onclick="this.closest('.pixel-modal').remove()">Close</button>
      </div>
    `;
    document.body.appendChild(modal);
    
    // Оценка размера кэша
    if ('caches' in window) {
      caches.open(CACHE_NAME).then(cache => {
        cache.keys().then(keys => {
          let totalSize = 0;
          Promise.all(keys.map(request => {
            return cache.match(request).then(response => {
              if (response) {
                return response.blob().then(blob => {
                  totalSize += blob.size;
                });
              }
            });
          })).then(() => {
            const sizeInMB = (totalSize / (1024 * 1024)).toFixed(2);
            modal.querySelector('.settings-section p').textContent = 
              `Cache size: ${sizeInMB} MB (${keys.length} files)`;
          });
        });
      });
    }
  },
  
  clearCache: async () => {
    if ('caches' in window) {
      await caches.delete(CACHE_NAME);
      await caches.open(CACHE_NAME);
      showSuccess('Cache cleared');
      UI.openStorage();
    }
  },
  
  openHelp: () => {
    window.open('https://github.com/craneapp/messenger/wiki', '_blank');
  },
  
  // Выход
  logout,
  
  // Утилиты
  openUserProfile: (userId) => {
    // Открываем профиль пользователя
    window.open(`/user/${userId}`, '_blank');
  },
  
  showChatMenu: () => {
    if (!currentChat) return;
    
    const modal = document.createElement('div');
    modal.className = 'pixel-modal';
    modal.innerHTML = `
      <div class="modal-content">
        <h3>Chat Menu</h3>
        <button class="pixel-button" onclick="summarizeChat()">📝 Summarize chat</button>
        <button class="pixel-button" onclick="UI.clearHistory()">🗑️ Clear history</button>
        <button class="pixel-button danger" onclick="UI.deleteChat()">❌ Delete chat</button>
        <button class="pixel-button" onclick="this.closest('.pixel-modal').remove()">Cancel</button>
      </div>
    `;
    document.body.appendChild(modal);
  },
  
  clearHistory: async () => {
    if (!currentChat || !confirm('Clear chat history?')) return;
    
    try {
      await fetch(`${API_BASE}/chats/${currentChat.id}/clear`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      messages[currentChat.id] = [];
      renderMessages([]);
      showSuccess('Chat history cleared');
    } catch (err) {
      console.error(err);
    }
  },
  
  deleteChat: async () => {
    if (!currentChat || !confirm('Delete this chat?')) return;
    
    try {
      await fetch(`${API_BASE}/chats/${currentChat.id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      chats = chats.filter(c => c.id !== currentChat.id);
      UI.closeChat();
      renderChatList();
      showSuccess('Chat deleted');
    } catch (err) {
      console.error(err);
    }
  }
};

// ==================== AI ОБЪЕКТ ====================

window.AI = {
  summarizeChat,
  translateMessage: (id) => translateMessage(id, 'en'),
  smartReply
};

// ==================== MIGRATIONS ====================

/**
 * Миграции для обновления структуры данных в localStorage
 */
const migrations = [
  {
    version: '1.0.0',
    up: () => {
      // Миграция с версии 1.0.0
      if (!localStorage.getItem('settings')) {
        localStorage.setItem('settings', JSON.stringify({
          theme: 'dark',
          language: 'ru',
          notifications: {
            enabled: true,
            sound: true,
            vibration: true,
            showPreview: true
          }
        }));
      }
    }
  },
  {
    version: '2.0.0',
    up: () => {
      // Миграция с версии 2.0.0
      const settings = JSON.parse(localStorage.getItem('settings') || '{}');
      if (!settings.chat) {
        settings.chat = {
          fontSize: 16,
          enterToSend: true
        };
        localStorage.setItem('settings', JSON.stringify(settings));
      }
    }
  }
];

/**
 * Запускает миграции
 */
function runMigrations() {
  const currentVersion = localStorage.getItem('app_version') || '0.0.0';
  
  migrations.forEach(migration => {
    if (compareVersions(migration.version, currentVersion) > 0) {
      console.log(`Running migration to version ${migration.version}`);
      migration.up();
      localStorage.setItem('app_version', migration.version);
    }
  });
}

/**
 * Сравнивает версии
 * @param {string} v1
 * @param {string} v2
 * @returns {number}
 */
function compareVersions(v1, v2) {
  const parts1 = v1.split('.').map(Number);
  const parts2 = v2.split('.').map(Number);
  
  for (let i = 0; i < 3; i++) {
    if (parts1[i] > parts2[i]) return 1;
    if (parts1[i] < parts2[i]) return -1;
  }
  return 0;
}

// ==================== ФИНАЛЬНАЯ ИНИЦИАЛИЗАЦИЯ ====================

// Запускаем миграции
runMigrations();

// Инициализация уже запущена в части 1
// Весь код выше будет выполняться после загрузки DOM

// Экспортируем для глобального доступа
window.generateId = generateId;
window.sanitizeHtml = sanitizeHtml;
window.formatMessageTime = formatMessageTime;
window.formatDate = formatDate;
window.copyToClipboard = copyToClipboard;
window.downloadFile = downloadFile;
