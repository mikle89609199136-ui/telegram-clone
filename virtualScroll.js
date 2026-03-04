/* ==========================================================
   VIRTUAL SCROLL ENGINE
   High Performance Chat Renderer
========================================================== */

(() => {

"use strict";

/* ==========================================================
   CONFIG
========================================================== */

const VS_CONFIG = {
    itemHeightEstimate: 72,
    buffer: 8,
    scrollThreshold: 150,
    autoStickThreshold: 50
};

/* ==========================================================
   CLASS
========================================================== */

class VirtualScroll {

    constructor(container, renderItem) {

        this.container = container;
        this.renderItem = renderItem;

        this.items = [];
        this.rendered = new Map();

        this.scrollTop = 0;
        this.viewportHeight = 0;

        this.startIndex = 0;
        this.endIndex = 0;

        this.stickToBottom = true;

        this.spacerTop = document.createElement("div");
        this.spacerBottom = document.createElement("div");

        this.container.innerHTML = "";
        this.container.appendChild(this.spacerTop);
        this.container.appendChild(this.spacerBottom);

        this.bind();
    }

    /* ====================================================== */

    bind() {

        this.container.addEventListener("scroll", () => {
            this.onScroll();
        });

        new ResizeObserver(() => {
            this.viewportHeight = this.container.clientHeight;
            this.update();
        }).observe(this.container);
    }

    /* ====================================================== */

    setItems(items) {

        this.items = items || [];
        this.update(true);
    }

    /* ====================================================== */

    appendItem(item) {

        this.items.push(item);

        if (this.stickToBottom) {
            this.update(true);
            this.scrollToBottom();
        } else {
            this.update();
        }
    }

    /* ====================================================== */

    prependItems(newItems) {

        const previousHeight = this.container.scrollHeight;

        this.items = [...newItems, ...this.items];

        this.update(true);

        const newHeight = this.container.scrollHeight;
        this.container.scrollTop += newHeight - previousHeight;
    }

    /* ====================================================== */

    onScroll() {

        const scrollTop = this.container.scrollTop;
        const maxScroll = this.container.scrollHeight - this.viewportHeight;

        this.stickToBottom =
            (maxScroll - scrollTop) < VS_CONFIG.autoStickThreshold;

        if (Math.abs(scrollTop - this.scrollTop) > VS_CONFIG.scrollThreshold) {
            this.scrollTop = scrollTop;
            this.update();
        }
    }

    /* ====================================================== */

    update(force = false) {

        if (!this.items.length) return;

        this.viewportHeight = this.container.clientHeight;

        const scrollTop = this.container.scrollTop;

        const estimatedStart =
            Math.floor(scrollTop / VS_CONFIG.itemHeightEstimate);

        const visibleCount =
            Math.ceil(this.viewportHeight / VS_CONFIG.itemHeightEstimate);

        const start =
            Math.max(0, estimatedStart - VS_CONFIG.buffer);

        const end =
            Math.min(
                this.items.length,
                start + visibleCount + VS_CONFIG.buffer * 2
            );

        if (!force &&
            start === this.startIndex &&
            end === this.endIndex) return;

        this.startIndex = start;
        this.endIndex = end;

        this.renderRange();
    }

    /* ====================================================== */

    renderRange() {

        const fragment = document.createDocumentFragment();

        const topHeight =
            this.startIndex * VS_CONFIG.itemHeightEstimate;
20:44


const bottomHeight =
            (this.items.length - this.endIndex)
            * VS_CONFIG.itemHeightEstimate;

        this.spacerTop.style.height = topHeight + "px";
        this.spacerBottom.style.height = bottomHeight + "px";

        this.rendered.forEach((node, key) => {
            if (key < this.startIndex || key >= this.endIndex) {
                node.remove();
                this.rendered.delete(key);
            }
        });

        for (let i = this.startIndex; i < this.endIndex; i++) {

            if (this.rendered.has(i)) continue;

            const item = this.items[i];
            const element = this.renderItem(item, i);

            fragment.appendChild(element);
            this.rendered.set(i, element);
        }

        this.container.insertBefore(fragment, this.spacerBottom);
    }

    /* ====================================================== */

    scrollToBottom() {
        this.container.scrollTop = this.container.scrollHeight;
    }

    /* ====================================================== */

    destroy() {
        this.container.innerHTML = "";
        this.rendered.clear();
    }
}

/* ==========================================================
   STORE INTEGRATION
========================================================== */

let virtualInstance = null;

function initializeVirtualScroll() {

    const container =
        document.getElementById("chatMessages");

    if (!container) return;

    virtualInstance = new VirtualScroll(
        container,
        renderMessageItem
    );

    Store.subscribe((state) => {

        const chatId = state.activeChatId;
        if (!chatId) return;

        const messages = state.messages[chatId] || [];

        virtualInstance.setItems(messages);
    });
}

/* ==========================================================
   RENDER MESSAGE
========================================================== */

function renderMessageItem(message) {

    const div = document.createElement("div");

    div.className =
        "message " +
        (message.senderId === Store.getState().user?.id
            ? "outgoing"
            : "incoming");

    div.innerHTML = `
        <div class="message-bubble">
            <div class="message-text">
                ${AIEngine
                    ? AIEngine.parseMarkdown(message.text)
                    : escapeHTML(message.text)}
            </div>
            <div class="message-time">
                ${formatTime(message.createdAt)}
            </div>
        </div>
    `;

    return div;
}

/* ==========================================================
   UTIL
========================================================== */

function formatTime(ts) {

    const d = new Date(ts);
    return d.getHours().toString().padStart(2,"0") + ":" +
           d.getMinutes().toString().padStart(2,"0");
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

/* ==========================================================
   INIT
========================================================== */

document.addEventListener("DOMContentLoaded", () => {
    initializeVirtualScroll();
});

/* ==========================================================
   EXPORT
========================================================== */

window.VirtualScrollEngine = {
    getInstance: () => virtualInstance
};

})();