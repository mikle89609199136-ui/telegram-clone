"use strict";

/* ==========================================================
   AUTH MODULE
   JWT + Refresh + Device Binding
========================================================== */

const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");
const crypto = require("crypto");

const { CONFIG } = require("./config");
const Data = require("./data");

/* ==========================================================
   TOKEN HELPERS
========================================================== */

function generateAccessToken(user, deviceId) {

    return jwt.sign(
        {
            id: user.id,
            role: user.role,
            deviceId
        },
        CONFIG.JWT_SECRET,
        { expiresIn: "15m" }
    );
}

function generateRefreshToken(user, deviceId) {

    return jwt.sign(
        {
            id: user.id,
            deviceId,
            type: "refresh"
        },
        CONFIG.JWT_REFRESH_SECRET,
        { expiresIn: "30d" }
    );
}

function verifyAccessToken(token) {
    return jwt.verify(token, CONFIG.JWT_SECRET);
}

function verifyRefreshToken(token) {
    return jwt.verify(token, CONFIG.JWT_REFRESH_SECRET);
}

/* ==========================================================
   PASSWORD
========================================================== */

async function hashPassword(password) {
    return bcrypt.hash(password, 12);
}

async function comparePassword(password, hash) {
    return bcrypt.compare(password, hash);
}

/* ==========================================================
   REGISTER
========================================================== */

async function register(req, res) {

    try {

        const { email, password, username, deviceId } = req.body;

        if (!email || !password || !username)
            return res.status(400).json({ error: "Missing fields" });

        const existing = await Data.findUserByEmail(email);
        if (existing)
            return res.status(400).json({ error: "User exists" });

        const hashed = await hashPassword(password);

        const user = await Data.createUser({
            id: crypto.randomUUID(),
            email,
            username,
            password: hashed,
            role: "user",
            createdAt: Date.now()
        });

        await Data.attachDevice(user.id, deviceId);

        const accessToken = generateAccessToken(user, deviceId);
        const refreshToken = generateRefreshToken(user, deviceId);

        await Data.saveRefreshToken(user.id, deviceId, refreshToken);

        res.json({
            accessToken,
            refreshToken,
            user: sanitizeUser(user)
        });

    } catch (err) {
        res.status(500).json({ error: "Register error" });
    }
}

/* ==========================================================
   LOGIN
========================================================== */

async function login(req, res) {

    try {

        const { email, password, deviceId } = req.body;

        const user = await Data.findUserByEmail(email);
        if (!user)
            return res.status(400).json({ error: "Invalid credentials" });

        const valid = await comparePassword(password, user.password);
        if (!valid)
            return res.status(400).json({ error: "Invalid credentials" });

        await Data.attachDevice(user.id, deviceId);

        const accessToken = generateAccessToken(user, deviceId);
        const refreshToken = generateRefreshToken(user, deviceId);

        await Data.saveRefreshToken(user.id, deviceId, refreshToken);

        res.json({
            accessToken,
            refreshToken,
            user: sanitizeUser(user)
        });

    } catch (err) {
        res.status(500).json({ error: "Login error" });
    }
}

/* ==========================================================
   REFRESH
========================================================== */

async function refresh(req, res) {

    try {

        const { refreshToken } = req.body;
20:47
if (!refreshToken)
            return res.status(400).json({ error: "No token" });

        const payload = verifyRefreshToken(refreshToken);

        const saved = await Data.getRefreshToken(
            payload.id,
            payload.deviceId
        );

        if (saved !== refreshToken)
            return res.status(403).json({ error: "Invalid token" });

        const user = await Data.findUserById(payload.id);
        if (!user)
            return res.status(404).json({ error: "User not found" });

        const newAccessToken =
            generateAccessToken(user, payload.deviceId);

        const newRefreshToken =
            generateRefreshToken(user, payload.deviceId);

        await Data.saveRefreshToken(
            user.id,
            payload.deviceId,
            newRefreshToken
        );

        res.json({
            accessToken: newAccessToken,
            refreshToken: newRefreshToken
        });

    } catch (err) {
        res.status(403).json({ error: "Refresh error" });
    }
}

/* ==========================================================
   LOGOUT DEVICE
========================================================== */

async function logoutDevice(req, res) {

    try {

        const { deviceId } = req.body;
        const userId = req.user.id;

        await Data.removeDevice(userId, deviceId);

        res.json({ success: true });

    } catch (err) {
        res.status(500).json({ error: "Logout device error" });
    }
}

/* ==========================================================
   LOGOUT ALL
========================================================== */

async function logoutAll(req, res) {

    try {

        await Data.removeAllDevices(req.user.id);

        res.json({ success: true });

    } catch (err) {
        res.status(500).json({ error: "Logout all error" });
    }
}

/* ==========================================================
   AUTH MIDDLEWARE
========================================================== */

function protect(req, res, next) {

    const header = req.headers.authorization;

    if (!header)
        return res.status(401).json({ error: "No token" });

    try {

        const token = header.split(" ")[1];
        const payload = verifyAccessToken(token);

        req.user = payload;

        next();

    } catch (err) {
        res.status(401).json({ error: "Unauthorized" });
    }
}

/* ==========================================================
   ROLE CHECK
========================================================== */

function requireRole(role) {

    return (req, res, next) => {

        if (!req.user)
            return res.status(401).json({ error: "Unauthorized" });

        if (req.user.role !== role &&
            req.user.role !== "superadmin")
            return res.status(403).json({ error: "Forbidden" });

        next();
    };
}

/* ==========================================================
   SANITIZE
========================================================== */

function sanitizeUser(user) {

    return {
        id: user.id,
        email: user.email,
        username: user.username,
        role: user.role
    };
}

/* ==========================================================
   EXPORT
========================================================== */

module.exports = {
    register,
    login,
    refresh,
    logoutDevice,
    logoutAll,
    protect,
    requireRole
};
