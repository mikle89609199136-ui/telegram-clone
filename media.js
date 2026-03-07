const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const sharp = require('sharp');
const fs = require('fs').promises;
const { query } = require('./data');
const { generateId } = require('./utils');
const logger = require('./logger');
const config = require('./config');

// ==================== НАСТРОЙКА MULTER ====================
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, config.upload.dir);
    fs.mkdir(uploadDir, { recursive: true })
      .then(() => cb(null, uploadDir))
      .catch(err => cb(err));
  },
  filename: (req, file, cb) => {
    const unique = `${Date.now()}-${generateId()}${path.extname(file.originalname)}`;
    cb(null, unique);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: config.upload.maxSize },
  fileFilter: (req, file, cb) => {
    const allowed = [
      'image/jpeg', 'image/png', 'image/gif', 'image/webp',
      'video/mp4', 'video/webm', 'video/ogg',
      'audio/mpeg', 'audio/ogg', 'audio/wav', 'audio/mp3',
      'application/pdf', 'application/zip', 'application/x-zip-compressed',
      'text/plain', 'application/msword', 
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    ];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type'), false);
    }
  }
});

// ==================== ЗАГРУЗКА ФАЙЛА ====================
router.post('/upload', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  try {
    let processedPath = req.file.path;
    let thumbnailPath = null;
    let dimensions = null;

    // Оптимизация и создание миниатюры для изображений
    if (req.file.mimetype.startsWith('image/')) {
      const image = sharp(req.file.path);
      const metadata = await image.metadata();
      dimensions = { width: metadata.width, height: metadata.height };
      
      // Оптимизация для больших изображений
      if (metadata.width > 1920 || metadata.height > 1080) {
        const outputPath = path.join(path.dirname(req.file.path), `opt-${req.file.filename}`);
        await image
          .resize(1920, 1080, { fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: 80 })
          .toFile(outputPath);
        processedPath = outputPath;
      }

      // Создаём миниатюру
      const thumbPath = path.join(path.dirname(req.file.path), `thumb-${req.file.filename}.jpg`);
      await sharp(req.file.path)
        .resize(200, 200, { fit: 'cover' })
        .jpeg({ quality: 60 })
        .toFile(thumbPath);
      thumbnailPath = thumbPath;
    }
    
    // Получаем длительность для видео/аудио (можно добавить позже с помощью ffmpeg)

    const fileId = generateId();
    await query(`
      INSERT INTO files (id, user_id, filename, path, mime_type, size, thumbnail, dimensions, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
    `, [
      fileId,
      req.user.id,
      req.file.originalname,
      processedPath,
      req.file.mimetype,
      req.file.size,
      thumbnailPath,
      dimensions ? JSON.stringify(dimensions) : null
    ]);

    res.json({
      id: fileId,
      url: `/uploads/${path.basename(processedPath)}`,
      thumbnail: thumbnailPath ? `/uploads/${path.basename(thumbnailPath)}` : null,
      filename: req.file.originalname,
      mimeType: req.file.mimetype,
      size: req.file.size,
      dimensions
    });
  } catch (err) {
    logger.error('File upload error:', err);
    res.status(500).json({ error: 'File processing failed' });
  }
});

// ==================== ПОЛУЧЕНИЕ СПИСКА ФАЙЛОВ ПОЛЬЗОВАТЕЛЯ ====================
router.get('/my', async (req, res) => {
  const { type = 'all', limit = 50, offset = 0 } = req.query;
  
  try {
    let sql = `
      SELECT id, filename, path, mime_type, size, thumbnail, dimensions, created_at
      FROM files
      WHERE user_id = $1
    `;
    const params = [req.user.id];
    
    if (type !== 'all') {
      sql += ` AND mime_type LIKE $2`;
      params.push(`${type}%`);
    }
    
    sql += ` ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(parseInt(limit), parseInt(offset));
    
    const files = await query(sql, params);
    res.json(files.rows);
  } catch (err) {
    logger.error('Error fetching user files:', err);
    res.status(500).json({ error: 'Failed to fetch files' });
  }
});

// ==================== ПОЛУЧЕНИЕ МЕДИАФАЙЛОВ ИЗ ЧАТА (ГАЛЕРЕЯ) ====================
router.get('/chat/:chatId', async (req, res) => {
  const { chatId } = req.params;
  const { type = 'all', limit = 50, offset = 0 } = req.query;

  try {
    // Проверка доступа к чату
    const member = await query(
      'SELECT 1 FROM chat_members WHERE chat_id = $1 AND user_id = $2',
      [chatId, req.user.id]
    );
    if (member.rows.length === 0) {
      return res.status(403).json({ error: 'Access denied' });
    }

    let sql = `
      SELECT m.id, m.content, m.type, m.created_at, u.username, u.avatar
      FROM messages m
      JOIN users u ON u.id = m.sender_id
      WHERE m.chat_id = $1
    `;
    const params = [chatId];

    if (type === 'image' || type === 'video' || type === 'file' || type === 'audio') {
      sql += ` AND m.type = $2`;
      params.push(type);
    } else if (type === 'link') {
      sql += ` AND m.content LIKE '%http%'`;
    }

    sql += ` ORDER BY m.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(parseInt(limit), parseInt(offset));

    const result = await query(sql, params);
    res.json(result.rows);
  } catch (err) {
    logger.error('Error fetching media from chat:', err);
    res.status(500).json({ error: 'Failed to fetch media' });
  }
});

// ==================== ПОЛУЧЕНИЕ ФАЙЛА ПО ID (для просмотра) ====================
router.get('/file/:fileId', async (req, res) => {
  const { fileId } = req.params;

  try {
    const fileRes = await query('SELECT * FROM files WHERE id = $1', [fileId]);
    if (fileRes.rows.length === 0) {
      return res.status(404).json({ error: 'File not found' });
    }

    const file = fileRes.rows[0];
    const filePath = path.join(__dirname, config.upload.dir, path.basename(file.path));

    try {
      await fs.access(filePath);
    } catch {
      return res.status(404).json({ error: 'File not found on disk' });
    }

    res.sendFile(filePath);
  } catch (err) {
    logger.error('Error serving file:', err);
    res.status(500).json({ error: 'Failed to get file' });
  }
});

// ==================== СКАЧИВАНИЕ ФАЙЛА ====================
router.get('/file/:fileId/download', async (req, res) => {
  const { fileId } = req.params;

  try {
    const fileRes = await query('SELECT * FROM files WHERE id = $1', [fileId]);
    if (fileRes.rows.length === 0) {
      return res.status(404).json({ error: 'File not found' });
    }

    const file = fileRes.rows[0];
    const filePath = path.join(__dirname, config.upload.dir, path.basename(file.path));

    try {
      await fs.access(filePath);
    } catch {
      return res.status(404).json({ error: 'File not found on disk' });
    }

    res.download(filePath, file.filename);
  } catch (err) {
    logger.error('Error downloading file:', err);
    res.status(500).json({ error: 'Failed to download file' });
  }
});

// ==================== ПОЛУЧЕНИЕ МИНИАТЮРЫ ФАЙЛА ====================
router.get('/file/:fileId/thumbnail', async (req, res) => {
  const { fileId } = req.params;

  try {
    const fileRes = await query('SELECT thumbnail FROM files WHERE id = $1', [fileId]);
    if (fileRes.rows.length === 0 || !fileRes.rows[0].thumbnail) {
      return res.status(404).json({ error: 'Thumbnail not found' });
    }

    const thumbPath = path.join(__dirname, config.upload.dir, path.basename(fileRes.rows[0].thumbnail));
    
    try {
      await fs.access(thumbPath);
    } catch {
      return res.status(404).json({ error: 'Thumbnail not found on disk' });
    }

    res.sendFile(thumbPath);
  } catch (err) {
    logger.error('Error serving thumbnail:', err);
    res.status(500).json({ error: 'Failed to get thumbnail' });
  }
});

// ==================== УДАЛЕНИЕ ФАЙЛА (только владелец) ====================
router.delete('/file/:fileId', async (req, res) => {
  const { fileId } = req.params;

  try {
    const fileRes = await query('SELECT * FROM files WHERE id = $1 AND user_id = $2', [fileId, req.user.id]);
    if (fileRes.rows.length === 0) {
      return res.status(404).json({ error: 'File not found or not yours' });
    }

    const file = fileRes.rows[0];
    // Удаляем файлы с диска
    try {
      await fs.unlink(file.path);
      if (file.thumbnail) {
        await fs.unlink(file.thumbnail);
      }
    } catch (err) {
      logger.warn('Failed to delete file from disk:', err);
    }

    await query('DELETE FROM files WHERE id = $1', [fileId]);

    res.json({ success: true });
  } catch (err) {
    logger.error('Error deleting file:', err);
    res.status(500).json({ error: 'Failed to delete file' });
  }
});

// ==================== ПОЛУЧЕНИЕ ИНФОРМАЦИИ О ФАЙЛЕ ====================
router.get('/file/:fileId/info', async (req, res) => {
  const { fileId } = req.params;

  try {
    const fileRes = await query('SELECT id, filename, mime_type, size, dimensions, created_at FROM files WHERE id = $1', [fileId]);
    if (fileRes.rows.length === 0) {
      return res.status(404).json({ error: 'File not found' });
    }

    res.json(fileRes.rows[0]);
  } catch (err) {
    logger.error('Error fetching file info:', err);
    res.status(500).json({ error: 'Failed to fetch file info' });
  }
});

module.exports = router;
