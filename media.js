// media.js – serve uploaded files
const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs-extra');
const authenticateToken = require('./authMiddleware');
const config = require('./config');
const logger = require('./logger');

// Get file by filename
router.get('/:filename', authenticateToken, async (req, res) => {
  try {
    const { filename } = req.params;
    const filePath = path.join(config.UPLOAD.dir, filename);

    if (!await fs.pathExists(filePath)) {
      return res.status(404).json({ error: 'File not found' });
    }

    // Optional: check if user has access to the message containing this file
    // For simplicity, we allow access if authenticated

    res.sendFile(filePath);
  } catch (err) {
    logger.error('Get media error:', err);
    res.status(500).json({ error: 'Failed to get file' });
  }
});

// Get thumbnail (for images/videos) – just serve original for now
router.get('/thumbnail/:filename', authenticateToken, async (req, res) => {
  // In a real app, you'd generate a thumbnail; here we redirect to original
  res.redirect(`/api/media/${req.params.filename}`);
});

module.exports = router;
