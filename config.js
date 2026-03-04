"use strict";

/* ==========================================================
   GLOBAL CONFIGURATION
   Production-Ready Central Config
========================================================== */

require("dotenv").config();

/* ==========================================================
   ENV HELPERS
========================================================== */

function getEnv(key, fallback = null) {
    if (process.env[key] !== undefined) {
        return process.env[key];
    }
    return fallback;
}

function requireEnv(key) {
    if (!process.env[key]) {
        throw new Error(`Missing required ENV variable: ${key}`);
    }
    return process.env[key];
}

function toNumber(value, fallback) {
    const n = Number(value);
    return isNaN(n) ? fallback : n;
}

function toBool(value, fallback = false) {
    if (value === undefined) return fallback;
    return value === "true" || value === true;
}

/* ==========================================================
   CORE ENVIRONMENT
========================================================== */

const NODE_ENV = getEnv("NODE_ENV", "development");

const IS_PROD = NODE_ENV === "production";
const IS_DEV = NODE_ENV === "development";

/* ==========================================================
   SERVER
========================================================== */

const PORT = toNumber(getEnv("PORT"), 3000);

const CORS_ORIGIN = getEnv(
    "CORS_ORIGIN",
    IS_DEV ? "*" : requireEnv("CORS_ORIGIN")
);

/* ==========================================================
   JWT CONFIG
========================================================== */

const JWT_SECRET = requireEnv("JWT_SECRET");
const JWT_REFRESH_SECRET = requireEnv("JWT_REFRESH_SECRET");

const JWT_ACCESS_EXPIRES = getEnv("JWT_ACCESS_EXPIRES", "15m");
const JWT_REFRESH_EXPIRES = getEnv("JWT_REFRESH_EXPIRES", "30d");

/* ==========================================================
   SECURITY
========================================================== */

const BCRYPT_ROUNDS = toNumber(
    getEnv("BCRYPT_ROUNDS"),
    12
);

const RATE_LIMIT_WINDOW_MS = toNumber(
    getEnv("RATE_LIMIT_WINDOW_MS"),
    15 * 60 * 1000
);

const RATE_LIMIT_MAX = toNumber(
    getEnv("RATE_LIMIT_MAX"),
    500
);

const BODY_LIMIT = getEnv("BODY_LIMIT", "10mb");

/* ==========================================================
   SOCKET CONFIG
========================================================== */

const SOCKET_PING_TIMEOUT = toNumber(
    getEnv("SOCKET_PING_TIMEOUT"),
    20000
);

const SOCKET_PING_INTERVAL = toNumber(
    getEnv("SOCKET_PING_INTERVAL"),
    25000
);

/* ==========================================================
   AI CONFIG
========================================================== */

const AI_ENABLED = toBool(
    getEnv("AI_ENABLED"),
    true
);

const AI_PROVIDER = getEnv(
    "AI_PROVIDER",
    "mock"
);

const AI_MODEL = getEnv(
    "AI_MODEL",
    "gpt-4"
);

const AI_TIMEOUT_MS = toNumber(
    getEnv("AI_TIMEOUT_MS"),
    30000
);

const AI_MAX_TOKENS = toNumber(
    getEnv("AI_MAX_TOKENS"),
    2048
);

/* ==========================================================
   STORAGE
========================================================== */

const STORAGE_TYPE = getEnv(
    "STORAGE_TYPE",
    "file" // file | postgres
);

const DATABASE_URL = getEnv(
    "DATABASE_URL",
    null
);

/* ==========================================================
   REDIS (FUTURE SCALING)
========================================================== */

const REDIS_ENABLED = toBool(
    getEnv("REDIS_ENABLED"),
    false
);

const REDIS_URL = getEnv(
    "REDIS_URL",
    null
);

/* ==========================================================
   UPLOADS
========================================================== */

const UPLOAD_MAX_SIZE = toNumber(
    getEnv("UPLOAD_MAX_SIZE"),
    20 * 1024 * 1024
);

const UPLOAD_ALLOWED_TYPES = (
    getEnv("UPLOAD_ALLOWED_TYPES",
        "image/png,image/jpeg,application/pdf"
    )
).split(",");
21:01
/* ==========================================================
   FEATURE FLAGS
========================================================== */

const FEATURES = Object.freeze({

    ENABLE_AI: AI_ENABLED,
    ENABLE_MODERATION: true,
    ENABLE_TYPING_INDICATOR: true,
    ENABLE_READ_RECEIPTS: true,
    ENABLE_DELIVERY_RECEIPTS: true,
    ENABLE_DEVICE_SYNC: true,
    ENABLE_ADMIN_PANEL: true

});

/* ==========================================================
   LOGGING
========================================================== */

const LOG_LEVEL = getEnv(
    "LOG_LEVEL",
    IS_PROD ? "info" : "debug"
);

const ENABLE_REQUEST_LOG = toBool(
    getEnv("ENABLE_REQUEST_LOG"),
    IS_DEV
);

/* ==========================================================
   VALIDATION CHECK
========================================================== */

function validateProductionSafety() {

    if (IS_PROD) {

        if (JWT_SECRET.length < 32)
            throw new Error("JWT_SECRET too weak");

        if (JWT_REFRESH_SECRET.length < 32)
            throw new Error("JWT_REFRESH_SECRET too weak");

        if (CORS_ORIGIN === "*")
            throw new Error("CORS_ORIGIN must not be '*' in production");
    }
}

validateProductionSafety();

/* ==========================================================
   FREEZE CONFIG
========================================================== */

const CONFIG = Object.freeze({

    NODE_ENV,
    IS_PROD,
    IS_DEV,

    PORT,
    CORS_ORIGIN,

    JWT_SECRET,
    JWT_REFRESH_SECRET,
    JWT_ACCESS_EXPIRES,
    JWT_REFRESH_EXPIRES,

    BCRYPT_ROUNDS,
    RATE_LIMIT_WINDOW_MS,
    RATE_LIMIT_MAX,
    BODY_LIMIT,

    SOCKET_PING_TIMEOUT,
    SOCKET_PING_INTERVAL,

    AI_ENABLED,
    AI_PROVIDER,
    AI_MODEL,
    AI_TIMEOUT_MS,
    AI_MAX_TOKENS,

    STORAGE_TYPE,
    DATABASE_URL,

    REDIS_ENABLED,
    REDIS_URL,

    UPLOAD_MAX_SIZE,
    UPLOAD_ALLOWED_TYPES,

    FEATURES,

    LOG_LEVEL,
    ENABLE_REQUEST_LOG

});

/* ==========================================================
   EXPORT
========================================================== */

module.exports = { CONFIG };