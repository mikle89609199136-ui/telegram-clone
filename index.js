"use strict";

/* ==========================================================
   MAIN ENTRY POINT
   Production Bootstrap
========================================================== */

require("dotenv").config();

const http = require("http");
const express = require("express");
const helmet = require("helmet");
const compression = require("compression");
const cors = require("cors");
const rateLimit = require("express-rate-limit");

const { CONFIG } = require("./config");
const serverApp = require("./server");
const initSocket = require("./socket");

/* ==========================================================
   EXPRESS INIT
========================================================== */

const app = express();

/* ==========================================================
   SECURITY
========================================================== */

app.use(helmet());

app.use(cors({
    origin: CONFIG.CORS_ORIGIN,
    credentials: true
}));

app.use(compression());

app.use(express.json({
    limit: "10mb"
}));

app.use(express.urlencoded({
    extended: true,
    limit: "10mb"
}));

/* ==========================================================
   RATE LIMIT
========================================================== */

const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 500,
    standardHeaders: true,
    legacyHeaders: false
});

app.use("/api/", limiter);

/* ==========================================================
   HEALTH CHECK
========================================================== */

app.get("/health", (req, res) => {
    res.json({
        status: "ok",
        uptime: process.uptime(),
        timestamp: Date.now()
    });
});

/* ==========================================================
   STATIC FILES
========================================================== */

app.use(express.static("public"));

/* ==========================================================
   API ROUTES
========================================================== */

app.use("/api", serverApp);

/* ==========================================================
   HTTP SERVER
========================================================== */

const httpServer = http.createServer(app);

/* ==========================================================
   SOCKET INIT
========================================================== */

initSocket(httpServer);

/* ==========================================================
   START SERVER
========================================================== */

httpServer.listen(CONFIG.PORT, () => {
    console.log("======================================");
    console.log("🚀  Messenger Server Started");
    console.log("PORT:", CONFIG.PORT);
    console.log("ENV:", CONFIG.NODE_ENV);
    console.log("======================================");
});

/* ==========================================================
   GLOBAL ERROR HANDLING
========================================================== */

process.on("uncaughtException", (err) => {
    console.error("Uncaught Exception:", err);
    process.exit(1);
});

process.on("unhandledRejection", (reason) => {
    console.error("Unhandled Rejection:", reason);
});

/* ==========================================================
   GRACEFUL SHUTDOWN
========================================================== */

function shutdown() {

    console.log("Graceful shutdown...");

    httpServer.close(() => {
        console.log("HTTP server closed");
        process.exit(0);
    });

    setTimeout(() => {
        process.exit(1);
    }, 10000);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
