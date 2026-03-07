const express = require('express');
const multer = require('multer');
const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const sharp = require('sharp');
const { v4: uuidv4 } = require('uuid');
const config = require('./config');
const { addToQueue } = require('./utils');
const logger = require('./logger');
const { query } = require('./database');

const router = express.Router();

const s3 = new S3Client({
  endpoint: config.s3.endpoint,
  credentials: {
    accessKeyId: config.s3.accessKey,
    secretAccessKey: config.s3.secretKey,
  },
  forcePathStyle: true,
  tls: config.s3.useSSL,
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.uploadLimit },
  fileFilter: (req, file, cb) => {
    const allowedMime = /^image\/(jpeg|png|gif|webp)|^video\/(mp4|webm)|^audio\/(mpeg|ogg|wav)|application\/pdf|application\/zip/;
    if (!allowedMime.test(file.mimetype)) {
      return cb(new Error('File type not allowed'), false);
    }
    cb(null, true);
  },
});

router.post('/', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const fileId = uuidv4();
  const ext = req.file.originalname.split('.').pop();
  const key = `uploads/${fileId}.${ext}`;
  const thumbnailKey = `thumbnails/${fileId}.jpg`;

  await s3.send(new PutObjectCommand({
    Bucket: config.s3.bucket,
    Key: key,
    Body: req.file.buffer,
    ContentType: req.file.mimetype,
    Metadata: {
      originalname: req.file.originalname,
      userId: req.userId.toString(),
    },
  }));

  let thumbnailUrl = null;
  if (req.file.mimetype.startsWith('image/') && req.file.mimetype !== 'image/gif') {
    const thumbnail = await sharp(req.file.buffer)
      .resize(200, 200, { fit: 'cover' })
      .jpeg({ quality: 80 })
      .toBuffer();
    await s3.send(new PutObjectCommand({
      Bucket: config.s3.bucket,
      Key: thumbnailKey,
      Body: thumbnail,
      ContentType: 'image/jpeg',
    }));
    thumbnailUrl = `${config.cdnUrl}/${thumbnailKey}`;
  }

  const url = `${config.cdnUrl}/${key}`;
  await query(
    'INSERT INTO media (uid, user_id, filename, mimetype, size, url, thumbnail_url) VALUES ($1, $2, $3, $4, $5, $6, $7)',
    [fileId, req.userId, req.file.originalname, req.file.mimetype, req.file.size, url, thumbnailUrl]
  );

  await addToQueue('media', { fileId, key, mimetype: req.file.mimetype });

  res.json({ url, thumbnail: thumbnailUrl, fileId });
});

router.get('/signed/:key', async (req, res) => {
  const key = req.params.key;
  try {
    const command = new GetObjectCommand({ Bucket: config.s3.bucket, Key: key });
    const signedUrl = await getSignedUrl(s3, command, { expiresIn: 3600 });
    res.json({ url: signedUrl });
  } catch (err) {
    logger.error('Signed URL error', err);
    res.status(500).json({ error: 'Could not generate URL' });
  }
});

module.exports = router;
