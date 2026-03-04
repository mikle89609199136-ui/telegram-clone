/* ==========================================================
   AI ENGINE
   Production Assistant System
========================================================== */

(() => {

"use strict";

/* ==========================================================
   CONFIG
========================================================== */

const AI_CONFIG = {
    endpoint: "/api/ai",
    maxContextMessages: 20,
    rateLimitMs: 4000,
    systemName: "AI Assistant",
    systemAvatar: "🤖 "
};

/* ==========================================================
   INTERNAL STATE
========================================================== */

let lastRequestTime = 0;
let currentAbortController = null;

/* ==========================================================
   INIT
========================================================== */

document.addEventListener("DOMContentLoaded", () => {
    bindAIUI();
});

/* ==========================================================
   UI BINDING
========================================================== */

function bindAIUI() {

    const sendBtn = document.getElementById("aiSendBtn");
    const input = document.getElementById("aiInput");

    if (!sendBtn || !input) return;

    sendBtn.onclick = handleAISubmit;

    input.addEventListener("keydown", e => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            handleAISubmit();
        }
    });
}

/* ==========================================================
   MAIN SUBMIT
========================================================== */

async function handleAISubmit() {

    const input = document.getElementById("aiInput");
    const text = input.value.trim();
    if (!text) return;

    if (!rateLimitCheck()) {
        UIEngine.showToast("Слишком часто. Подождите.", "warning");
        return;
    }

    input.value = "";

    if (text.startsWith("/")) {
        handleCommand(text);
        return;
    }

    await requestAI(text);
}

/* ==========================================================
   RATE LIMIT
========================================================== */

function rateLimitCheck() {
    const now = Date.now();
    if (now - lastRequestTime < AI_CONFIG.rateLimitMs) {
        return false;
    }
    lastRequestTime = now;
    return true;
}

/* ==========================================================
   COMMANDS
========================================================== */

async function handleCommand(text) {

    const [command, ...rest] = text.split(" ");
    const payload = rest.join(" ");

    switch (command) {

        case "/summary":
            await requestAI(
                "Сделай краткое резюме следующего текста:\n" + payload
            );
            break;

        case "/rewrite":
            await requestAI(
                "Перепиши более формально:\n" + payload
            );
            break;

        case "/analyze":
            await requestAI(
                "Проанализируй:\n" + payload
            );
            break;

        default:
            UIEngine.showToast("Неизвестная команда", "error");
    }
}

/* ==========================================================
   MAIN AI REQUEST
========================================================== */

async function requestAI(userText) {

    if (!Store.getState().ai.enabled) {
        UIEngine.showToast("AI отключен", "error");
        return;
    }

    try {

        UIEngine.showLoader();

        appendAIMessage(userText, true);

        const context = buildContext();

        currentAbortController = new AbortController();

        const response = await fetch(AI_CONFIG.endpoint, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": "Bearer " + Store.getState().token
            },
            body: JSON.stringify({
                message: userText,
                context
            }),
            signal: currentAbortController.signal
20:39


});

        if (!response.ok) {
            throw new Error("AI server error");
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();

        let fullText = "";

        appendAIMessage("", false, true); // placeholder bubble

        while (true) {

            const { done, value } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value);
            fullText += chunk;

            updateLastAIMessage(fullText);
        }

        finalizeAIMessage(fullText);

        Store.pushAIHistory({
            input: userText,
            output: fullText
        });

    } catch (err) {

        if (err.name !== "AbortError") {
            UIEngine.showToast("Ошибка AI", "error");
        }

    } finally {

        UIEngine.hideLoader();
        currentAbortController = null;
    }
}

/* ==========================================================
   CONTEXT BUILDER
========================================================== */

function buildContext() {

    const state = Store.getState();
    const chatId = state.activeChatId;

    if (!chatId) return [];

    const messages = state.messages[chatId] || [];

    return messages
        .slice(-AI_CONFIG.maxContextMessages)
        .map(m => ({
            role: m.senderId === state.user?.id ? "user" : "assistant",
            content: m.text
        }));
}

/* ==========================================================
   MESSAGE RENDERING
========================================================== */

function appendAIMessage(text, isUser = false, placeholder = false) {

    const state = Store.getState();
    const chatId = state.activeChatId;
    if (!chatId) return;

    const message = {
        id: "ai_" + Date.now(),
        senderId: isUser ? state.user.id : "ai_system",
        text,
        createdAt: Date.now(),
        ai: !isUser
    };

    Store.addMessage(chatId, message);

    if (!placeholder) {
        UIEngine.showToast("AI ответ добавлен", "info");
    }
}

function updateLastAIMessage(text) {

    const state = Store.getState();
    const chatId = state.activeChatId;
    const messages = state.messages[chatId];
    if (!messages || !messages.length) return;

    const last = messages[messages.length - 1];
    if (!last.ai) return;

    Store.updateMessage(chatId, last.id, {
        text
    });
}

function finalizeAIMessage(text) {
    // Можно логировать / аналитика
}

/* ==========================================================
   STOP AI
========================================================== */

function stopAI() {
    if (currentAbortController) {
        currentAbortController.abort();
        UIEngine.showToast("AI остановлен", "warning");
    }
}

/* ==========================================================
   MARKDOWN PARSER (SAFE)
========================================================== */

function parseMarkdown(text) {

    if (!text) return "";

    return escapeHTML(text)
        .replace(/```([\s\S]*?)```/g,
            '<pre class="code-block"><code>$1</code></pre>')
        .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
        .replace(/\*(.*?)\*/g, "<em>$1</em>")
        .replace(/\n/g, "<br>");
}

/* ==========================================================
   ESCAPE
========================================================== */

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

/* ==========================================================
   EXPORT
========================================================== */

window.AIEngine = {
    requestAI,
    stopAI,
    parseMarkdown
};

})();
