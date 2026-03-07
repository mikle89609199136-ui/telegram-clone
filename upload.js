const express = require('express');
const router = express.Router();
const mediaRouter = require('./media');

// Перенаправляем все запросы на media.js
router.use('/', mediaRouter);

// Добавляем дополнительные эндпоинты, если нужно
router.post('/avatar', async (req, res) => {
  // Специальный эндпоинт для загрузки аватара
  // Перенаправляем на media с дополнительной логикой
  const { file } = req;
  if (!file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }
  
  try {
    // Используем ту же логику, что и в media, но добавляем обновление профиля
    const result = await mediaRouter.handleUpload(req, res);
    
    // После успешной загрузки обновляем аватар пользователя
    if (result && result.id) {
      await require('./data').query(
        'UPDATE users SET avatar = $1 WHERE id = $2',
        [result.url, req.user.id]
      );
    }
    
    return result;
  } catch (err) {
    logger.error('Avatar upload error:', err);
    res.status(500).json({ error: 'Avatar upload failed' });
  }
});

module.exports = router;
