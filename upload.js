// upload.js — настройка multer для загрузки файлов
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

// Правило 59
const fileFilter = (req, file, cb) => {
  if (!isAllowedMimeType(file.mimetype)) {
    cb(new Error('Недопустимый тип файла'), false);
  } else {
    cb(null, true);
  }
};

// Правило 60
const upload = multer({
  storage,
  limits: { fileSize: config.UPLOAD.maxSize },
  fileFilter,
});

const handleMulterError = (err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'Файл слишком большой' });
    }
    return res.status(400).json({ error: err.message });
  }
  if (err) {
    return res.status(400).json({ error: err.message });
  }
  next();
};

module.exports = { upload, handleMulterError };
