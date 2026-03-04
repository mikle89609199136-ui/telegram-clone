"use strict";

/* ==========================================================
   SOCKET.IO REAL-TIME ENGINE
   Production Ready
========================================================== */

const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");

const { CONFIG } = require("./config");
const Data = require("./data");

/* ==========================================================
   MEMORY STATE
========================================================== */

const onlineUsers = new Map(); 
// userId -> Set(socketId)

const socketToUser = new Map(); 
// socketId -> { userId, deviceId }

const typingUsers = new Map(); 
// chatId -> Set(userId)

/* ==========================================================
   INIT SOCKET
========================================================== */

function initSocket(httpServer) {

    const io = new Server(httpServer, {
        cors: {
            origin: CONFIG.CORS_ORIGIN,
            methods: ["GET", "POST"]
        }
    });

    global.io = io;

    /* ======================================================
       AUTH MIDDLEWARE
    ====================================================== */

    io.use((socket, next) => {

        try {

            const token =
                socket.handshake.auth?.token;

            if (!token)
                return next(new Error("Unauthorized"));

            const payload =
                jwt.verify(token, CONFIG.JWT_SECRET);

            socket.userId = payload.id;
            socket.deviceId = payload.deviceId;

            next();

        } catch (err) {
            next(new Error("Unauthorized"));
        }
    });

    /* ======================================================
       CONNECTION
    ====================================================== */

    io.on("connection", (socket) => {

        const { userId, deviceId } = socket;

        registerOnline(socket, userId, deviceId);

        /* ================= JOIN CHAT ================= */

        socket.on("join_chat", async (chatId) => {

            const chat =
                await Data.getChatById(chatId);

            if (!chat ||
                !chat.members.includes(userId))
                return;

            socket.join(chatId);
        });

        /* ================= LEAVE CHAT ================= */

        socket.on("leave_chat", (chatId) => {
            socket.leave(chatId);
        });

        /* ================= TYPING ================= */

        socket.on("typing_start", (chatId) => {

            if (!typingUsers.has(chatId))
                typingUsers.set(chatId, new Set());

            typingUsers.get(chatId).add(userId);

            socket.to(chatId)
                .emit("typing_update",
                    Array.from(typingUsers.get(chatId))
                );
        });

        socket.on("typing_stop", (chatId) => {

            if (!typingUsers.has(chatId)) return;

            typingUsers.get(chatId).delete(userId);

            socket.to(chatId)
                .emit("typing_update",
                    Array.from(typingUsers.get(chatId))
                );
        });

        /* ================= READ RECEIPTS ================= */

        socket.on("message_read",
            ({ chatId, messageId }) => {

            socket.to(chatId)
                .emit("message_read_update", {
                    messageId,
                    userId
                });
        });

        /* ================= DELIVERY ACK ================= */

        socket.on("message_delivered",
            ({ chatId, messageId }) => {

            socket.to(chatId)
                .emit("message_delivered_update", {
                    messageId,
                    userId
                });
        });

        /* ================= FORCE SYNC ================= */

        socket.on("force_sync", async () => {

            const chats =
                await Data.fullSync(userId);

            socket.emit("full_sync", chats);
        });

socket.io
Socket.IO
In most cases, the connection will be established with WebSocket, providing a low-overhead communication channel between the server and the client.
20:59
/* ================= DISCONNECT ================= */

        socket.on("disconnect", () => {
            unregisterOnline(socket.id);
        });
    });
}

/* ==========================================================
   ONLINE MANAGEMENT
========================================================== */

function registerOnline(socket, userId, deviceId) {

    if (!onlineUsers.has(userId))
        onlineUsers.set(userId, new Set());

    onlineUsers.get(userId).add(socket.id);

    socketToUser.set(socket.id, {
        userId,
        deviceId
    });

    broadcastPresence(userId, true);
}

function unregisterOnline(socketId) {

    const data = socketToUser.get(socketId);
    if (!data) return;

    const { userId } = data;

    socketToUser.delete(socketId);

    if (onlineUsers.has(userId)) {

        onlineUsers.get(userId)
            .delete(socketId);

        if (onlineUsers.get(userId).size === 0) {
            onlineUsers.delete(userId);
            broadcastPresence(userId, false);
        }
    }
}

/* ==========================================================
   PRESENCE BROADCAST
========================================================== */

function broadcastPresence(userId, isOnline) {

    if (!global.io) return;

    global.io.emit("presence_update", {
        userId,
        isOnline
    });
}

/* ==========================================================
   EXPORTED
========================================================== */

module.exports = initSocket;
