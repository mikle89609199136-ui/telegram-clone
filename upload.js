// upload.js – file upload configuration
const multer = require('multer');
const path = require('path');
const fs = require('fs-extra');
const { v4: uuidv4 } = require('uuid');
const config = require('./config');
const logger = require('./logger');
const { isAllowedMimeType } = require('./utils');

fs.ensureDirSync(config.UPLOAD.dir);

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, config.UPLOAD.dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const filename = `${uuidv4()}${ext}`;
    cb(null, filename);
  },
});

const fileFilter = (req, file, cb) => {
  if (!isAllowedMimeType(file.mimetype)) {
    cb(new Error('File type not allowed'), false);
  } else {
    cb(null, true);
  }
};

const upload = multer({
  storage,
  limits: { fileSize: config.UPLOAD.maxSize },
  fileFilter,
});

const handleMulterError = (err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File too large' });
    }
    return res.status(400).json({ error: err.message });
  }
  if (err) {
    return res.status(400).json({ error: err.message });
  }
  next();
};

// Also export a router for file upload endpoints
const express = require('express');
const router = express.Router();
const authenticateToken = require('./authMiddleware');
const { db } = require('./database');
const { generateId } = require('./utils');

router.post('/chat/:chatId', authenticateToken, upload.single('file'), async (req, res) => {
  try {
    const { chatId } = req.params;
    const file = req.file;
    if (!file) return res.status(400).json({ error: 'No file uploaded' });

    // Save file info in database as a message
    const messageId = generateId();
    const fileUrl = `/uploads/${file.filename}`;
    await db.query(
      `INSERT INTO messages (id, chat_id, sender_id, type, file_url, file_name, file_size, mime_type, created_at)
       VALUES ($1, $2, $3, 'file', $4, $5, $6, $7, NOW())`,
      [messageId, chatId, req.user.id, fileUrl, file.originalname, file.size, file.mimetype]
    );

    const newMsg = await db.query(
      `SELECT m.*, u.username as sender_username, u.avatar as sender_avatar
       FROM messages m JOIN users u ON m.sender_id = u.id WHERE m.id = $1`,
      [messageId]
    );
    res.status(201).json(newMsg.rows[0]);
  } catch (err) {
    logger.error('File upload error:', err);
    res.status(500).json({ error: 'Upload failed' });
  }
});

module.exports = { upload, handleMulterError, router };
