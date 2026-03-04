/* =========================================================
   UI ENGINE
   Production Interface Controller
========================================================= */

(() => {

"use strict";

/* =========================================================
   UI STATE
========================================================= */

const UIState = {
    activeModal: null,
    sidebarOpen: false,
    contextMenuOpen: false,
    dropdownOpen: null,
    loading: false
};

/* =========================================================
   DOM CACHE
========================================================= */

const UI = {
    sidebar: document.getElementById("sidebar"),
    sidebarToggle: document.getElementById("sidebarToggle"),
    modalOverlay: document.getElementById("modalOverlay"),
    contextMenu: document.getElementById("contextMenu"),
    toastContainer: document.getElementById("toastContainer"),
    loader: document.getElementById("globalLoader")
};

/* =========================================================
   INIT
========================================================= */

document.addEventListener("DOMContentLoaded", () => {
    bindUIEvents();
});

/* =========================================================
   SIDEBAR
========================================================= */

function toggleSidebar() {

    UIState.sidebarOpen = !UIState.sidebarOpen;

    if (UIState.sidebarOpen) {
        UI.sidebar.classList.add("active");
    } else {
        UI.sidebar.classList.remove("active");
    }
}

function closeSidebar() {
    UIState.sidebarOpen = false;
    UI.sidebar.classList.remove("active");
}

/* =========================================================
   MODAL SYSTEM
========================================================= */

function openModal(id) {

    closeAllModals();

    const modal = document.getElementById(id);
    if (!modal) return;

    modal.classList.remove("hidden");
    UIState.activeModal = modal;

    trapFocus(modal);
}

function closeModal() {
    if (!UIState.activeModal) return;

    UIState.activeModal.classList.add("hidden");
    UIState.activeModal = null;
}

function closeAllModals() {
    document.querySelectorAll(".modal").forEach(m => {
        m.classList.add("hidden");
    });
    UIState.activeModal = null;
}

/* =========================================================
   FOCUS TRAP (ACCESSIBILITY)
========================================================= */

function trapFocus(modal) {

    const focusable = modal.querySelectorAll(
        'a[href], button, textarea, input, select'
    );

    if (!focusable.length) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    modal.addEventListener("keydown", e => {

        if (e.key !== "Tab") return;

        if (e.shiftKey) {
            if (document.activeElement === first) {
                e.preventDefault();
                last.focus();
            }
        } else {
            if (document.activeElement === last) {
                e.preventDefault();
                first.focus();
            }
        }
    });

    first.focus();
}

/* =========================================================
   CONTEXT MENU
========================================================= */

function openContextMenu(x, y) {

    if (!UI.contextMenu) return;

    UI.contextMenu.style.top = y + "px";
    UI.contextMenu.style.left = x + "px";
    UI.contextMenu.classList.remove("hidden");

    UIState.contextMenuOpen = true;
}

function closeContextMenu() {
    if (!UI.contextMenu) return;
    UI.contextMenu.classList.add("hidden");
    UIState.contextMenuOpen = false;
}

/* =========================================================
   DROPDOWN SYSTEM
========================================================= */

function toggleDropdown(id) {

    const dropdown = document.getElementById(id);
    if (!dropdown) return;

    if (UIState.dropdownOpen && UIState.dropdownOpen !== dropdown) {
20:33
UIState.dropdownOpen.classList.add("hidden");
    }

    dropdown.classList.toggle("hidden");

    UIState.dropdownOpen =
        dropdown.classList.contains("hidden") ? null : dropdown;
}

/* =========================================================
   TOAST SYSTEM (ADVANCED)
========================================================= */

function showToast(message, type = "info", duration = 4000) {

    const toast = document.createElement("div");
    toast.className = "toast " + type;
    toast.innerHTML = `
        <div class="toast-content">${escapeHTML(message)}</div>
        <button class="toast-close">✕</button>
    `;

    UI.toastContainer.appendChild(toast);

    toast.querySelector(".toast-close").onclick = () => {
        toast.remove();
    };

    setTimeout(() => {
        toast.remove();
    }, duration);
}

/* =========================================================
   LOADER
========================================================= */

function showLoader() {
    if (!UI.loader) return;
    UI.loader.classList.remove("hidden");
    UIState.loading = true;
}

function hideLoader() {
    if (!UI.loader) return;
    UI.loader.classList.add("hidden");
    UIState.loading = false;
}

/* =========================================================
   AI PANEL UI
========================================================= */

function openAIPanel() {
    openModal("aiModal");
}

function closeAIPanel() {
    closeModal();
}

/* =========================================================
   ADMIN PANEL UI
========================================================= */

function openAdminPanel() {
    openModal("adminModal");
}

function closeAdminPanel() {
    closeModal();
}

/* =========================================================
   OUTSIDE CLICK HANDLER
========================================================= */

document.addEventListener("click", e => {

    if (UIState.contextMenuOpen && !UI.contextMenu.contains(e.target)) {
        closeContextMenu();
    }

    if (UIState.dropdownOpen && !UIState.dropdownOpen.contains(e.target)) {
        UIState.dropdownOpen.classList.add("hidden");
        UIState.dropdownOpen = null;
    }
});

/* =========================================================
   ESC KEY HANDLER
========================================================= */

document.addEventListener("keydown", e => {

    if (e.key === "Escape") {

        if (UIState.activeModal) closeModal();
        if (UIState.contextMenuOpen) closeContextMenu();
        if (UIState.sidebarOpen) closeSidebar();
    }
});

/* =========================================================
   BIND UI EVENTS
========================================================= */

function bindUIEvents() {

    if (UI.sidebarToggle) {
        UI.sidebarToggle.onclick = toggleSidebar;
    }

    document.querySelectorAll("[data-open-modal]")
        .forEach(btn => {
            btn.onclick = () => openModal(btn.dataset.openModal);
        });

    document.querySelectorAll("[data-close-modal]")
        .forEach(btn => {
            btn.onclick = closeModal;
        });
}

/* =========================================================
   UTIL
========================================================= */

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

/* =========================================================
   GLOBAL EXPORT
========================================================= */

window.UIEngine = {
    openModal,
    closeModal,
    showToast,
    showLoader,
    hideLoader,
    openContextMenu,
    closeContextMenu,
    openAdminPanel,
    openAIPanel
};

})();