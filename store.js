/* ==========================================================
   GLOBAL STORE ENGINE
   Production State Manager
========================================================== */

(() => {

"use strict";

/* ==========================================================
   INTERNAL STATE
========================================================== */

const _state = {
    user: null,
    token: null,
    role: "user",

    chats: [],
    activeChatId: null,

    messages: {},

    ui: {
        theme: "dark",
        sidebarOpen: false,
        activeModal: null,
        loading: false
    },

    ai: {
        enabled: true,
        history: []
    },

    devices: {
        current: null,
        sessions: []
    },

    call: {
        active: false,
        peerId: null
    }
};

/* ==========================================================
   SUBSCRIBERS
========================================================== */

const subscribers = [];

/* ==========================================================
   BROADCAST CHANNEL (MULTI TAB SYNC)
========================================================== */

const channel = new BroadcastChannel("messenger_sync");

channel.onmessage = (event) => {
    if (!event.data) return;
    internalSetState(event.data, false);
};

/* ==========================================================
   UTIL
========================================================== */

function deepClone(obj) {
    return JSON.parse(JSON.stringify(obj));
}

function notify() {
    const snapshot = deepClone(_state);
    subscribers.forEach(fn => {
        try { fn(snapshot); } catch(e) { console.error(e); }
    });
}

function persist() {
    try {
        localStorage.setItem("app_state", JSON.stringify(_state));
    } catch (e) {
        console.warn("Persist failed", e);
    }
}

function loadPersisted() {
    const saved = localStorage.getItem("app_state");
    if (!saved) return;
    try {
        const parsed = JSON.parse(saved);
        Object.assign(_state, parsed);
    } catch(e) {
        console.warn("Load state failed");
    }
}

/* ==========================================================
   INTERNAL SETTER
========================================================== */

function internalSetState(partial, broadcast = true) {

    Object.keys(partial).forEach(key => {

        if (typeof partial[key] === "object" && partial[key] !== null) {
            _state[key] = {
                ..._state[key],
                ...partial[key]
            };
        } else {
            _state[key] = partial[key];
        }

    });

    persist();
    notify();

    if (broadcast) {
        channel.postMessage(partial);
    }
}

/* ==========================================================
   PUBLIC API
========================================================== */

function getState() {
    return deepClone(_state);
}

function subscribe(fn) {
    if (typeof fn !== "function") return;
    subscribers.push(fn);
}

function setUser(user, token) {

    internalSetState({
        user,
        token,
        role: user?.role || "user"
    });
}

function logout() {
    localStorage.removeItem("app_state");
    localStorage.removeItem("token");

    internalSetState({
        user: null,
        token: null,
        role: "user",
        chats: [],
        activeChatId: null,
        messages: {}
    });
}

function setChats(chats) {

    if (!Array.isArray(chats)) return;

    internalSetState({
        chats: [...chats]
    });
}

function addChat(chat) {

    if (!chat || !chat.id) return;

    if (_state.chats.find(c => c.id === chat.id)) return;

    internalSetState({
        chats: [..._state.chats, chat]
    });
}

function setActiveChat(chatId) {

    if (!_state.chats.find(c => c.id === chatId)) return;

    internalSetState({
        activeChatId: chatId
    });
}

function setMessages(chatId, messages) {

    if (!chatId || !Array.isArray(messages)) return;

    internalSetState({
        messages: {
chat.id
chat.id – Domain name for sale
Chat.id Domain Enquiry
20:36
..._state.messages,
            [chatId]: [...messages]
        }
    });
}

function addMessage(chatId, message) {

    if (!chatId || !message) return;

    const existing = _state.messages[chatId] || [];

    if (existing.find(m => m.id === message.id)) return;

    internalSetState({
        messages: {
            ..._state.messages,
            [chatId]: [...existing, message]
        }
    });
}

function updateMessage(chatId, messageId, updatedFields) {

    const msgs = _state.messages[chatId];
    if (!msgs) return;

    const updated = msgs.map(m =>
        m.id === messageId ? { ...m, ...updatedFields } : m
    );

    internalSetState({
        messages: {
            ..._state.messages,
            [chatId]: updated
        }
    });
}

function deleteMessage(chatId, messageId) {

    const msgs = _state.messages[chatId];
    if (!msgs) return;

    const filtered = msgs.filter(m => m.id !== messageId);

    internalSetState({
        messages: {
            ..._state.messages,
            [chatId]: filtered
        }
    });
}

function setTheme(theme) {

    internalSetState({
        ui: { theme }
    });

    document.body.className = "theme-" + theme;
}

function setLoading(status) {

    internalSetState({
        ui: { loading: status }
    });
}

function setModal(id) {

    internalSetState({
        ui: { activeModal: id }
    });
}

function enableAI(status) {

    internalSetState({
        ai: { enabled: !!status }
    });
}

function pushAIHistory(entry) {

    internalSetState({
        ai: {
            history: [..._state.ai.history, entry]
        }
    });
}

function setDevice(deviceInfo) {

    internalSetState({
        devices: {
            ..._state.devices,
            current: deviceInfo
        }
    });
}

function setCallState(callData) {

    internalSetState({
        call: {
            ..._state.call,
            ...callData
        }
    });
}

/* ==========================================================
   SECURITY CHECKS
========================================================== */

function isSuperAdmin() {
    return _state.role === "superadmin";
}

function requireAuth() {
    if (!_state.token) {
        window.location.href = "/";
    }
}

/* ==========================================================
   INIT
========================================================== */

loadPersisted();

/* ==========================================================
   EXPORT
========================================================== */

window.Store = {
    getState,
    subscribe,
    setUser,
    logout,
    setChats,
    addChat,
    setActiveChat,
    setMessages,
    addMessage,
    updateMessage,
    deleteMessage,
    setTheme,
    setLoading,
    setModal,
    enableAI,
    pushAIHistory,
    setDevice,
    setCallState,
    isSuperAdmin,
    requireAuth
};

})();