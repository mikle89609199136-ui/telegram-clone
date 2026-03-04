"use strict";

/* ==========================================================
   MAIN API SERVER
   Production Business Logic Layer
========================================================== */

const express = require("express");
const crypto = require("crypto");

const Auth = require("./auth");
const Data = require("./data");

const router = express.Router();

/* ==========================================================
   UTILITIES
========================================================== */

function generateId() {
    return crypto.randomUUID();
}

function validateText(text) {
    return typeof text === "string" &&
        text.trim().length > 0 &&
        text.length <= 5000;
}

function validateArray(arr) {
    return Array.isArray(arr);
}

function safeAsync(fn) {
    return (req, res, next) =>
        Promise.resolve(fn(req, res, next))
            .catch(next);
}

/* ==========================================================
   AUTH ROUTES
========================================================== */

router.post("/auth/register", Auth.register);
router.post("/auth/login", Auth.login);
router.post("/auth/refresh", Auth.refresh);

router.post("/auth/logout-device",
    Auth.protect,
    Auth.logoutDevice
);

router.post("/auth/logout-all",
    Auth.protect,
    Auth.logoutAll
);

/* ==========================================================
   CHAT ROUTES
========================================================== */

router.post("/chat/create",
    Auth.protect,
    safeAsync(async (req, res) => {

        const { title, members } = req.body;

        if (!title || !validateArray(members))
            return res.status(400).json({ error: "Invalid input" });

        const chat = await Data.createChat({
            id: generateId(),
            title: title.trim(),
            members: [...new Set([...members, req.user.id])],
            createdAt: Date.now(),
            type: "group"
        });

        res.json(chat);
    })
);

router.get("/chat/list",
    Auth.protect,
    safeAsync(async (req, res) => {

        const chats =
            await Data.getUserChats(req.user.id);

        res.json(chats);
    })
);

router.delete("/chat/:id",
    Auth.protect,
    safeAsync(async (req, res) => {

        await Data.deleteChat(req.params.id);

        if (global.io) {
            global.io.to(req.params.id)
                .emit("chat_deleted", req.params.id);
        }

        res.json({ success: true });
    })
);

/* ==========================================================
   MESSAGE ROUTES
========================================================== */

router.post("/message/send",
    Auth.protect,
    safeAsync(async (req, res) => {

        const { chatId, text } = req.body;

        if (!validateText(text))
            return res.status(400).json({ error: "Invalid text" });

        const message = await Data.addMessage(chatId, {
            id: generateId(),
            chatId,
            senderId: req.user.id,
            text: text.trim(),
            createdAt: Date.now(),
            edited: false
        });

        if (global.io) {
            global.io.to(chatId)
                .emit("new_message", message);
        }

        res.json(message);
    })
);

router.get("/message/:chatId",
    Auth.protect,
    safeAsync(async (req, res) => {

        const messages =
            await Data.getMessages(req.params.chatId);

        res.json(messages);
    })
);

router.delete("/message/:chatId/:messageId",
    Auth.protect,
    safeAsync(async (req, res) => {

        await Data.deleteMessage(
            req.params.chatId,
            req.params.messageId
        );

        if (global.io) {
            global.io.to(req.params.chatId)
                .emit("message_deleted",
                    req.params.messageId
                );
        }

        res.json({ success: true });
    })
);

router.put("/message/:chatId/:messageId",
    Auth.protect,
    safeAsync(async (req, res) => {
20:56
const { text } = req.body;

        if (!validateText(text))
            return res.status(400).json({ error: "Invalid text" });

        await Data.editMessage(
            req.params.chatId,
            req.params.messageId,
            text.trim()
        );

        if (global.io) {
            global.io.to(req.params.chatId)
                .emit("message_edited", {
                    messageId: req.params.messageId,
                    text: text.trim()
                });
        }

        res.json({ success: true });
    })
);

/* ==========================================================
   DEVICE ROUTES
========================================================== */

router.post("/device/heartbeat",
    Auth.protect,
    (req, res) => {
        res.json({ ok: true });
    }
);

router.get("/device/list",
    Auth.protect,
    safeAsync(async (req, res) => {

        const devices =
            await Data.getUserDevices(req.user.id);

        res.json(devices);
    })
);

router.post("/device/full-sync",
    Auth.protect,
    safeAsync(async (req, res) => {

        const chats =
            await Data.fullSync(req.user.id);

        res.json({ chats });
    })
);

/* ==========================================================
   AI STREAMING
========================================================== */

router.post("/ai",
    Auth.protect,
    safeAsync(async (req, res) => {

        const { message } = req.body;

        if (!validateText(message))
            return res.status(400).end();

        res.setHeader("Content-Type", "text/plain");
        res.setHeader("Transfer-Encoding", "chunked");

        const aiResponse =
            "AI response to: " + message;

        const tokens = aiResponse.split(" ");

        for (const token of tokens) {
            await new Promise(r => setTimeout(r, 60));
            res.write(token + " ");
        }

        res.end();

        await Data.logAI({
            userId: req.user.id,
            input: message,
            output: aiResponse
        });
    })
);

/* ==========================================================
   MODERATION
========================================================== */

router.post("/moderation/report",
    Auth.protect,
    safeAsync(async (req, res) => {

        const { messageId, reason } = req.body;

        await Data.logModeration({
            userId: req.user.id,
            messageId,
            reason
        });

        res.json({ success: true });
    })
);

/* ==========================================================
   ADMIN ROUTES
========================================================== */

router.get("/admin/users",
    Auth.protect,
    Auth.requireRole("admin"),
    safeAsync(async (req, res) => {

        const users =
            await Data.getAllUsers();

        res.json(users);
    })
);

router.post("/admin/role",
    Auth.protect,
    Auth.requireRole("superadmin"),
    safeAsync(async (req, res) => {

        const { userId, role } = req.body;

        await Data.setUserRole(userId, role);

        res.json({ success: true });
    })
);

/* ==========================================================
   ERROR HANDLER
========================================================== */

router.use((err, req, res, next) => {

    console.error("API Error:", err);

    res.status(500).json({
        error: "Internal Server Error"
    });
});

/* ==========================================================
   404
========================================================== */

router.use((req, res) => {
    res.status(404).json({ error: "Not found" });
});

/* ==========================================================
   EXPORT
========================================================== */

module.exports = router;
