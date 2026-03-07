let socket, currentUser, currentChatId, token = localStorage.getItem('token'), refreshToken = localStorage.getItem('refreshToken');
const apiBase = '/';

async function apiRequest(endpoint, options = {}) {
  options.headers = options.headers || {};
  if (token) options.headers['Authorization'] = `Bearer ${token}`;
  options.headers['Content-Type'] = 'application/json';
  let res = await fetch(apiBase + endpoint, options);
  if (res.status === 401) {
    const ok = await refreshAccessToken();
    if (ok) {
      options.headers['Authorization'] = `Bearer ${token}`;
      res = await fetch(apiBase + endpoint, options);
    } else {
      logout();
      showPage('login-page');
      throw new Error('Unauthorized');
    }
  }
  return res.json();
}

async function refreshAccessToken() {
  if (!refreshToken) return false;
  const res = await fetch('/auth/refresh', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken })
  });
  if (res.ok) {
    const data = await res.json();
    token = data.accessToken;
    refreshToken = data.refreshToken;
    localStorage.setItem('token', token);
    localStorage.setItem('refreshToken', refreshToken);
    return true;
  }
  return false;
}

function logout() {
  localStorage.removeItem('token');
  localStorage.removeItem('refreshToken');
  token = refreshToken = null;
  currentUser = null;
  if (socket) socket.disconnect();
  showPage('login-page');
}

function showPage(pageId) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById(pageId).classList.add('active');
}

function renderLoginPage() {
  return `
    <div class="auth-container">
      <h2>Login to Craheapp</h2>
      <form id="login-form">
        <input type="email" id="login-email" placeholder="Email" required>
        <input type="password" id="login-password" placeholder="Password" required>
        <button type="submit">Login</button>
      </form>
      <p>No account? <a href="#" onclick="showPage('register-page')">Register</a></p>
    </div>
  `;
}

function renderRegisterPage() {
  return `
    <div class="auth-container">
      <h2>Create Craheapp Account</h2>
      <form id="register-form">
        <input type="text" id="register-username" placeholder="Username" required>
        <input type="email" id="register-email" placeholder="Email" required>
        <input type="password" id="register-password" placeholder="Password" required>
        <input type="password" id="register-confirm" placeholder="Confirm password" required>
        <button type="submit">Create account</button>
      </form>
      <p>Already have an account? <a href="#" onclick="showPage('login-page')">Login</a></p>
    </div>
  `;
}

function renderMainPage() {
  return `
    <div class="messenger-container">
      <div class="sidebar">
        <div class="sidebar-header">
          <div class="menu-button" onclick="toggleSideMenu()">☰</div>
          <div class="app-title">Craheapp</div>
          <div class="search-button" onclick="toggleSearch()">🔍</div>
          <div class="new-chat-button" onclick="openNewChat()">✚</div>
        </div>
        <div id="search-bar" class="search-box hidden">
          <input type="text" id="search-input" placeholder="Search users, chats, messages...">
        </div>
        <div class="chat-filters">
          <div class="filter-tab active" data-filter="all">All</div>
          <div class="filter-tab" data-filter="unread">Unread</div>
          <div class="filter-tab" data-filter="groups">Groups</div>
          <div class="filter-tab" data-filter="channels">Channels</div>
        </div>
        <div class="chats-list" id="chats-list"></div>
        <div class="ai-button" onclick="openAiChat()">🤖 AI Assistant</div>
      </div>
      <div class="chat-area" id="chat-area">
        <div class="chat-header" id="chat-header">
          <div class="chat-header-avatar" onclick="openProfile()">
            <img id="chat-avatar" src="" alt="">
          </div>
          <div class="chat-header-info">
            <div class="chat-header-name" id="chat-title"></div>
            <div class="chat-header-status" id="chat-status"></div>
          </div>
          <div class="chat-header-actions">
            <div class="icon-button" onclick="startVoiceCall()">📞</div>
            <div class="icon-button" onclick="startVideoCall()">📹</div>
            <div class="icon-button" onclick="openChatMenu()">⋯</div>
          </div>
        </div>
        <div class="messages-area" id="messages-area"></div>
        <div class="message-input-area">
          <div class="emoji-button" onclick="toggleEmoji()">😊</div>
          <div class="attach-button" onclick="document.getElementById('file-input').click()">📎</div>
          <input type="file" id="file-input" style="display: none" multiple>
          <input type="text" id="message-text" class="message-input" placeholder="Write a message...">
          <div class="voice-button" onclick="startVoiceRecording()">🎤</div>
          <div class="send-button" onclick="sendMessage()">➤</div>
        </div>
      </div>
      <div class="right-panel" id="right-panel"></div>
    </div>
  `;
}

function attachAuthListeners() {
  document.getElementById('login-form')?.addEventListener('submit', async e => {
    e.preventDefault();
    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;
    const res = await apiRequest('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
    if (res.accessToken) {
      token = res.accessToken;
      refreshToken = res.refreshToken;
      localStorage.setItem('token', token);
      localStorage.setItem('refreshToken', refreshToken);
      currentUser = res.user;
      initSocket();
      showPage('main-page');
      loadChats();
    } else {
      alert(res.error || 'Login failed');
    }
  });

  document.getElementById('register-form')?.addEventListener('submit', async e => {
    e.preventDefault();
    const username = document.getElementById('register-username').value;
    const email = document.getElementById('register-email').value;
    const password = document.getElementById('register-password').value;
    const confirm = document.getElementById('register-confirm').value;
    if (password !== confirm) return alert('Passwords do not match');
    const res = await apiRequest('/auth/register', { method: 'POST', body: JSON.stringify({ username, email, password }) });
    if (res.accessToken) {
      token = res.accessToken;
      refreshToken = res.refreshToken;
      localStorage.setItem('token', token);
      localStorage.setItem('refreshToken', refreshToken);
      currentUser = res.user;
      initSocket();
      showPage('main-page');
      loadChats();
    } else {
      alert(res.error || 'Registration failed');
    }
  });
}

function initSocket() {
  socket = io({ auth: { token } });
  socket.on('connect', () => console.log('Socket connected'));
  socket.on('newMessage', msg => {
    if (currentChatId === msg.chat_id) {
      appendMessage(msg);
    } else {
      loadChats();
    }
  });
  socket.on('typing', data => {
    if (data.chatId === currentChatId) {
      document.getElementById('chat-status').innerText = 'typing...';
    }
  });
  socket.on('stopTyping', data => {
    if (data.chatId === currentChatId) {
      document.getElementById('chat-status').innerText = 'online';
    }
  });
  socket.on('messagesRead', data => {
    // update read status in UI
  });
  socket.on('ai_response', data => {
    if (currentChatId === 'ai') {
      appendAiMessage(data.reply);
    }
  });
  socket.on('userOnline', userId => { /* update contact list */ });
  socket.on('userOffline', userId => { /* update contact list */ });
}

async function loadChats() {
  const chats = await apiRequest('/chats');
  const list = document.getElementById('chats-list');
  if (!list) return;
  list.innerHTML = chats.map(c => {
    let title = c.title;
    let avatar = c.avatar || '/default-avatar.png';
    if (c.type === 'private' && c.participants) {
      const other = c.participants.find(p => p.id !== currentUser.id);
      if (other) {
        title = other.username;
        avatar = other.avatar || '/default-avatar.png';
      }
    }
    const lastMsg = c.last_message ? (c.last_message.text || 'Media') : '';
    const time = c.last_message ? new Date(c.last_message.created_at).toLocaleTimeString() : '';
    const unread = ''; // TODO: fetch unread count
    return `
      <div class="chat-item ${c.id === currentChatId ? 'active' : ''}" data-chat-id="${c.id}" onclick="openChat(${c.id})">
        <img src="${avatar}" class="chat-avatar">
        <div class="chat-info">
          <div class="chat-name">${title} ${c.pinned ? '📌' : ''}</div>
          <div class="chat-last-message">${lastMsg}</div>
        </div>
        <div class="chat-meta">
          <span class="chat-time">${time}</span>
          ${unread ? `<span class="unread-badge">${unread}</span>` : ''}
        </div>
      </div>
    `;
  }).join('');
}

async function openChat(chatId) {
  currentChatId = chatId;
  document.querySelectorAll('.chat-item').forEach(item => item.classList.remove('active'));
  document.querySelector(`.chat-item[data-chat-id="${chatId}"]`)?.classList.add('active');

  const chatInfo = await apiRequest(`/chats/${chatId}`);
  document.getElementById('chat-title').innerText = chatInfo.title || 'Chat';
  document.getElementById('chat-avatar').src = chatInfo.avatar || '/default-avatar.png';
  document.getElementById('chat-status').innerText = '';

  const messages = await apiRequest(`/messages/chat/${chatId}?limit=50`);
  renderMessages(messages);
  socket.emit('joinChat', chatId);
}

function renderMessages(msgs) {
  const area = document.getElementById('messages-area');
  area.innerHTML = msgs.map(m => {
    const isOutgoing = m.sender && m.sender.id === currentUser.id;
    return `
      <div class="message ${isOutgoing ? 'outgoing' : 'incoming'}" data-message-id="${m.id}">
        <div class="message-bubble">
          ${m.type === 'text' ? `<p class="message-text">${escapeHtml(m.text)}</p>` : ''}
          ${m.media ? renderMedia(m.media) : ''}
          ${m.reply_to ? `<div class="reply-preview">↩️ ${escapeHtml(m.reply_to.content)}</div>` : ''}
          <span class="message-time">${new Date(m.created_at).toLocaleTimeString()}</span>
        </div>
      </div>
    `;
  }).join('');
  area.scrollTop = area.scrollHeight;
}

function escapeHtml(unsafe) {
  return unsafe.replace(/[&<>"]/g, m => {
    if (m === '&') return '&amp;';
    if (m === '<') return '&lt;';
    if (m === '>') return '&gt;';
    if (m === '"') return '&quot;';
    return m;
  });
}

function renderMedia(media) {
  if (Array.isArray(media)) media = media[0];
  if (!media) return '';
  const url = media.url;
  if (url.match(/\.(jpeg|jpg|gif|png|webp)$/i)) {
    return `<img src="${url}" class="media-image" onclick="openMediaViewer('${url}')">`;
  } else if (url.match(/\.(mp4|webm|ogg)$/i)) {
    return `<video src="${url}" controls class="media-video"></video>`;
  } else if (url.match(/\.(mp3|wav|m4a)$/i)) {
    return `<audio src="${url}" controls class="media-audio"></audio>`;
  } else {
    return `<a href="${url}" target="_blank" class="media-file">📎 ${media.filename || 'File'}</a>`;
  }
}

function appendMessage(m) {
  const area = document.getElementById('messages-area');
  const div = document.createElement('div');
  div.className = `message ${m.sender && m.sender.id === currentUser.id ? 'outgoing' : 'incoming'}`;
  div.dataset.messageId = m.id;
  div.innerHTML = `
    <div class="message-bubble">
      ${m.type === 'text' ? `<p class="message-text">${escapeHtml(m.text)}</p>` : ''}
      ${m.media ? renderMedia(m.media) : ''}
      ${m.reply_to ? `<div class="reply-preview">↩️ ${escapeHtml(m.reply_to.content)}</div>` : ''}
      <span class="message-time">${new Date(m.created_at).toLocaleTimeString()}</span>
    </div>
  `;
  area.appendChild(div);
  area.scrollTop = area.scrollHeight;
}

async function sendMessage() {
  const input = document.getElementById('message-text');
  const text = input.value.trim();
  const fileInput = document.getElementById('file-input');
  const files = fileInput.files;

  let media = [];
  if (files.length) {
    for (let file of files) {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/upload', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: fd
      }).then(r => r.json());
      if (res.url) {
        media.push({ url: res.url, type: file.type, filename: file.name });
      }
    }
    fileInput.value = '';
  }

  if (!text && !media.length) return;

  socket.emit('sendMessage', {
    chatId: currentChatId,
    text,
    type: media.length ? (media[0].type.startsWith('image') ? 'image' : media[0].type.startsWith('video') ? 'video' : 'file') : 'text',
    media
  });

  input.value = '';
}

function openAiChat() {
  currentChatId = 'ai';
  document.getElementById('chat-title').innerText = 'AI Assistant';
  document.getElementById('chat-avatar').src = '/ai-avatar.png';
  document.getElementById('chat-status').innerText = 'online';
  document.getElementById('messages-area').innerHTML = '<div class="message incoming"><div class="message-bubble">Hello! I am your AI assistant. Ask me anything.</div></div>';
  document.querySelector('.send-button').onclick = sendAiMessage;
}

async function sendAiMessage() {
  const input = document.getElementById('message-text');
  const text = input.value.trim();
  if (!text) return;
  appendMessage({ sender: { id: currentUser.id }, text, type: 'text', created_at: new Date() });
  input.value = '';
  await apiRequest('/ai/message', { method: 'POST', body: JSON.stringify({ message: text }) });
}

function appendAiMessage(reply) {
  const area = document.getElementById('messages-area');
  const div = document.createElement('div');
  div.className = 'message incoming';
  div.innerHTML = `<div class="message-bubble">${reply}</div>`;
  area.appendChild(div);
  area.scrollTop = area.scrollHeight;
}

function toggleSearch() {
  const bar = document.getElementById('search-bar');
  bar.classList.toggle('hidden');
}

function openNewChat() {
  // open modal to create chat
}

function openProfile() {
  // show profile panel
}

function startVoiceCall() {
  // initiate WebRTC call
}

function startVideoCall() {
  // initiate video call
}

function toggleEmoji() {
  // open emoji picker
}

function startVoiceRecording() {
  // voice message recording
}

const app = document.getElementById('app');
function render() {
  if (token) {
    apiRequest('/users/me').then(user => {
      currentUser = user;
      app.innerHTML = `
        <div id="login-page" class="page">${renderLoginPage()}</div>
        <div id="register-page" class="page">${renderRegisterPage()}</div>
        <div id="main-page" class="page active">${renderMainPage()}</div>
      `;
      attachAuthListeners();
      initSocket();
      loadChats();
    }).catch(() => logout());
  } else {
    app.innerHTML = `
      <div id="login-page" class="page active">${renderLoginPage()}</div>
      <div id="register-page" class="page">${renderRegisterPage()}</div>
    `;
    attachAuthListeners();
  }
}

render();
