const express = require('express');
const router = express.Router();
const mediaRouter = require('./media');

// Перенаправляем все запросы на media.js
router.use('/', mediaRouter);

module.exports = router;