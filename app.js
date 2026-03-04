/* ======================================================
   PRODUCTION APP ENGINE
   Messenger Core
====================================================== */

(() => {

"use strict";

/* ======================================================
   GLOBAL STATE
====================================================== */

const socket = io({
    transports: ["websocket"],
    reconnection: true,
    reconnectionAttempts: 10,
    reconnectionDelay: 1000
});

let state = {
    user: null,
    chats: [],
    activeChat: null,
    messages: {},
    isAdmin: false,
    call: {
        active: false,
        peer: null,
        localStream: null,
        remoteStream: null
    }
};

/* ======================================================
   DOM REFERENCES
====================================================== */

const DOM = {
    chatList: document.getElementById("chatList"),
    messagesContainer: document.getElementById("messagesContainer"),
    messageInput: document.getElementById("messageInput"),
    sendBtn: document.getElementById("sendMessageBtn"),
    toastContainer: document.getElementById("toastContainer"),
    themeSelect: document.getElementById("themeSelect"),
    aiBtn: document.getElementById("aiAssistantBtn"),
    adminBtn: document.getElementById("adminPanelBtn"),
    callOverlay: document.getElementById("callOverlay")
};

/* ======================================================
   INIT
====================================================== */

document.addEventListener("DOMContentLoaded", async () => {

    await authenticate();
    bindUI();
    initNotifications();
    detectDevice();
    loadChats();
});

/* ======================================================
   AUTH
====================================================== */

async function authenticate() {
    const token = localStorage.getItem("token");
    if (!token) {
        window.location.href = "/";
        return;
    }

    const res = await fetch("/auth/validate", {
        headers: { "Authorization": "Bearer " + token }
    });

    if (!res.ok) {
        localStorage.removeItem("token");
        window.location.href = "/";
        return;
    }

    const data = await res.json();
    state.user = data.user;
    state.isAdmin = data.user.role === "superadmin";
}

/* ======================================================
   CHAT LOADING
====================================================== */

async function loadChats() {
    const res = await fetch("/data/chats", {
        headers: authHeader()
    });

    const chats = await res.json();
    state.chats = chats;

    renderChatList();
}

/* ======================================================
   RENDER CHAT LIST
====================================================== */

function renderChatList() {

    DOM.chatList.innerHTML = "";

    state.chats.forEach(chat => {

        const el = document.createElement("div");
        el.className = "chat-item";
        el.dataset.id = chat.id;

        el.innerHTML = `
            <div class="chat-avatar"></div>
            <div>
                <div>${chat.name}</div>
                <small>${chat.lastMessage || ""}</small>
            </div>
        `;

        el.onclick = () => openChat(chat.id);
        DOM.chatList.appendChild(el);
    });
}

/* ======================================================
   OPEN CHAT
====================================================== */

async function openChat(chatId) {

    state.activeChat = chatId;

    if (!state.messages[chatId]) {
        const res = await fetch(`/data/messages/${chatId}`, {
            headers: authHeader()
        });
        state.messages[chatId] = await res.json();
    }

    renderMessages();
}

/* ======================================================
   RENDER MESSAGES
====================================================== */

function renderMessages() {

    DOM.messagesContainer.innerHTML = "";

    const messages = state.messages[state.activeChat] || [];
20:14
messages.forEach(msg => {

        const bubble = document.createElement("div");
        bubble.className = "message-bubble";
        if (msg.senderId === state.user.id) {
            bubble.classList.add("own");
        }

        bubble.innerHTML = `
            <div>${escapeHTML(msg.text)}</div>
        `;

        bubble.oncontextmenu = (e) => {
            e.preventDefault();
            openContextMenu(e, msg);
        };

        DOM.messagesContainer.appendChild(bubble);
    });

    DOM.messagesContainer.scrollTop = DOM.messagesContainer.scrollHeight;
}

/* ======================================================
   SEND MESSAGE
====================================================== */

function bindUI() {

    DOM.sendBtn.onclick = sendMessage;

    DOM.messageInput.addEventListener("keydown", e => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });

    DOM.themeSelect.onchange = (e) => {
        document.body.className = "theme-" + e.target.value;
        localStorage.setItem("theme", e.target.value);
    };

    DOM.aiBtn.onclick = () => openModal("aiModal");
    DOM.adminBtn.onclick = () => {
        if (state.isAdmin) openModal("adminModal");
    };
}

function sendMessage() {

    const text = DOM.messageInput.value.trim();
    if (!text || !state.activeChat) return;

    const message = {
        chatId: state.activeChat,
        text
    };

    socket.emit("message:send", message);
    DOM.messageInput.value = "";
}

/* ======================================================
   SOCKET EVENTS
====================================================== */

socket.on("message:new", msg => {

    if (!state.messages[msg.chatId]) {
        state.messages[msg.chatId] = [];
    }

    state.messages[msg.chatId].push(msg);

    if (msg.chatId === state.activeChat) {
        renderMessages();
    }

    showToast("Новое сообщение");
    showBrowserNotification(msg);
});

/* ======================================================
   CONTEXT MENU
====================================================== */

function openContextMenu(e, msg) {
    const menu = document.getElementById("contextMenu");
    menu.style.top = e.clientY + "px";
    menu.style.left = e.clientX + "px";
    menu.classList.remove("hidden");

    document.getElementById("deleteMessageOption").onclick = () => {
        socket.emit("message:delete", msg.id);
        menu.classList.add("hidden");
    };
}

/* ======================================================
   ADMIN BAN
====================================================== */

function banUser(userId) {
    if (!state.isAdmin) return;
    socket.emit("admin:ban", userId);
}

/* ======================================================
   CALL (WEBRTC SKELETON)
====================================================== */

async function startCall() {

    state.call.localStream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true
    });

    document.getElementById("localVideo").srcObject = state.call.localStream;
    DOM.callOverlay.classList.remove("hidden");
}

/* ======================================================
   NOTIFICATIONS
====================================================== */

function initNotifications() {
    if ("Notification" in window) {
        Notification.requestPermission();
    }
}

function showBrowserNotification(msg) {
    if (Notification.permission === "granted") {
        new Notification("Новое сообщение", {
            body: msg.text
        });
    }
}

/* ======================================================
   TOAST
====================================================== */

function showToast(text) {

    const toast = document.createElement("div");
    toast.className = "toast";
    toast.innerText = text;

    DOM.toastContainer.appendChild(toast);

    setTimeout(() => {
        toast.remove();
    }, 4000);
}
20:14
/* ======================================================
   UTIL
====================================================== */

function authHeader() {
    return {
        "Authorization": "Bearer " + localStorage.getItem("token")
    };
}

function openModal(id) {
    document.getElementById(id).classList.remove("hidden");
}

function escapeHTML(str) {
    return str.replace(/[&<>"']/g, function(m) {
        return {
            "&":"&amp;",
            "<":"&lt;",
            ">":"&gt;",
            "\"":"&quot;",
            "'":"&#39;"
        }[m];
    });
}

function detectDevice() {
    const ua = navigator.userAgent;
    if (/mobile/i.test(ua)) {
        console.log("Mobile device detected");
    }
}

/* ======================================================
   ERROR HANDLER
====================================================== */

window.onerror = function(msg, url, line) {
    console.error("App Error:", msg);
};

})();