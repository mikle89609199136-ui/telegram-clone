// media.js — получение медиафайлов
const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs-extra');
const authenticateToken = require('./authMiddleware');
const config = require('./config');
const logger = require('./logger');

// Получение файла по имени
router.get('/:filename', authenticateToken, async (req, res) => {
  try {
    const { filename } = req.params;
    const filePath = path.join(config.UPLOAD.dir, filename);

    if (!await fs.pathExists(filePath)) {
      return res.status(404).json({ error: 'Файл не найден' });
    }

    // Дополнительно можно проверить, имеет ли пользователь доступ к сообщению
    res.sendFile(filePath);
  } catch (err) {
    logger.error('Get media error:', err);
    res.status(500).json({ error: 'Ошибка получения файла' });
  }
});

module.exports = router;
