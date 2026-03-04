/* ==========================================================
   DEVICE ENGINE
   Multi-Device + Self Sync System
========================================================== */

(() => {

"use strict";

/* ==========================================================
   CONFIG
========================================================== */

const DEVICE_CONFIG = {
    storageKey: "device_info",
    heartbeatInterval: 30000,
    syncChannel: "device_sync_channel"
};

/* ==========================================================
   INTERNAL STATE
========================================================== */

let deviceInfo = null;
let heartbeatTimer = null;

const syncChannel = new BroadcastChannel(DEVICE_CONFIG.syncChannel);

/* ==========================================================
   INIT
========================================================== */

document.addEventListener("DOMContentLoaded", () => {
    initializeDevice();
});

/* ==========================================================
   DEVICE INIT
========================================================== */

function initializeDevice() {

    const saved = localStorage.getItem(DEVICE_CONFIG.storageKey);

    if (saved) {
        deviceInfo = JSON.parse(saved);
    } else {
        deviceInfo = createDevice();
        persistDevice();
    }

    Store.setDevice(deviceInfo);

    startHeartbeat();
    bindSyncChannel();
}

/* ==========================================================
   CREATE DEVICE
========================================================== */

function createDevice() {

    return {
        deviceId: generateUUID(),
        deviceName: detectDeviceName(),
        platform: navigator.platform,
        userAgent: navigator.userAgent,
        createdAt: Date.now(),
        lastActive: Date.now()
    };
}

/* ==========================================================
   HEARTBEAT
========================================================== */

function startHeartbeat() {

    stopHeartbeat();

    heartbeatTimer = setInterval(() => {
        updateLastActive();
        notifyServerHeartbeat();
    }, DEVICE_CONFIG.heartbeatInterval);
}

function stopHeartbeat() {
    if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
    }
}

function updateLastActive() {
    deviceInfo.lastActive = Date.now();
    persistDevice();
}

/* ==========================================================
   SERVER HEARTBEAT
========================================================== */

function notifyServerHeartbeat() {

    if (!Store.getState().token) return;

    fetch("/api/device/heartbeat", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": "Bearer " + Store.getState().token
        },
        body: JSON.stringify({
            deviceId: deviceInfo.deviceId,
            lastActive: deviceInfo.lastActive
        })
    }).catch(() => {});
}

/* ==========================================================
   SYNC SYSTEM
========================================================== */

function bindSyncChannel() {

    syncChannel.onmessage = (event) => {

        const data = event.data;
        if (!data) return;

        if (data.originDeviceId === deviceInfo.deviceId) return;

        if (data.type === "NEW_MESSAGE") {
            handleIncomingSyncMessage(data);
        }

        if (data.type === "FORCE_SYNC") {
            forceFullSync();
        }
    };
}

/* ==========================================================
   SELF SYNC MESSAGE
========================================================== */

function broadcastMessage(message) {

    syncChannel.postMessage({
        type: "NEW_MESSAGE",
        originDeviceId: deviceInfo.deviceId,
        originMessageId: message.id,
        chatId: message.chatId,
        payload: message
    });
}

function handleIncomingSyncMessage(data) {

    const { chatId, payload, originMessageId } = data;

message.id
Panen77 ⚡ Link Platfrom Resmi Slot Deposit Pulsa 10rb Tanpa Potongan Gratis Admin
Hanya modal receh di situs Panen77 sudah bisa main slot gacor dengan metode deposit pulsa cuma 10rb gratis tanpa potongan biaya admin xl atau telkomsel menyediakan penawar...
20:42
const state = Store.getState();
    const existing = state.messages[chatId] || [];

    if (existing.find(m => m.id === originMessageId)) return;

    Store.addMessage(chatId, payload);
}

/* ==========================================================
   FORCE SYNC
========================================================== */

function forceFullSync() {

    if (!Store.getState().token) return;

    fetch("/api/device/full-sync", {
        headers: {
            "Authorization": "Bearer " + Store.getState().token
        }
    })
    .then(res => res.json())
    .then(data => {

        if (!data.chats) return;

        Store.setChats(data.chats);

        data.chats.forEach(chat => {
            if (chat.messages) {
                Store.setMessages(chat.id, chat.messages);
            }
        });

    })
    .catch(() => {});
}

function triggerForceSync() {

    syncChannel.postMessage({
        type: "FORCE_SYNC",
        originDeviceId: deviceInfo.deviceId
    });
}

/* ==========================================================
   DEVICE MANAGEMENT
========================================================== */

async function fetchDevices() {

    if (!Store.getState().token) return [];

    const res = await fetch("/api/device/list", {
        headers: {
            "Authorization": "Bearer " + Store.getState().token
        }
    });

    if (!res.ok) return [];

    return await res.json();
}

async function logoutDevice(targetDeviceId) {

    if (!Store.getState().token) return;

    await fetch("/api/device/logout", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": "Bearer " + Store.getState().token
        },
        body: JSON.stringify({
            deviceId: targetDeviceId
        })
    });

    UIEngine.showToast("Устройство отключено", "success");
}

/* ==========================================================
   LOGOUT CURRENT DEVICE
========================================================== */

function logoutCurrentDevice() {

    stopHeartbeat();

    localStorage.removeItem(DEVICE_CONFIG.storageKey);

    Store.logout();

    window.location.href = "/";
}

/* ==========================================================
   UTIL
========================================================== */

function persistDevice() {
    localStorage.setItem(
        DEVICE_CONFIG.storageKey,
        JSON.stringify(deviceInfo)
    );
}

function generateUUID() {

    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx"
        .replace(/[xy]/g, function(c) {
            const r = Math.random() * 16 | 0;
            const v = c === "x" ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
}

function detectDeviceName() {

    const ua = navigator.userAgent;

    if (/Android/i.test(ua)) return "Android Device";
    if (/iPhone|iPad|iPod/i.test(ua)) return "iOS Device";
    if (/Win/i.test(navigator.platform)) return "Windows PC";
    if (/Mac/i.test(navigator.platform)) return "Mac Device";
    if (/Linux/i.test(navigator.platform)) return "Linux Device";

    return "Unknown Device";
}

/* ==========================================================
   ONLINE / OFFLINE
========================================================== */

window.addEventListener("online", () => {
    UIEngine.showToast("Вы онлайн", "success");
    triggerForceSync();
});

window.addEventListener("offline", () => {
    UIEngine.showToast("Вы оффлайн", "warning");
});

/* ==========================================================
   EXPORT
========================================================== */

window.DeviceEngine = {
    getCurrentDevice: () => deviceInfo,
    broadcastMessage,
    fetchDevices,
    logoutDevice,
    logoutCurrentDevice,
    triggerForceSync
};

})();
chat.id
chat.id – Domain name for sale