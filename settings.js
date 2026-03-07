const express = require('express');
const router = express.Router();
const { redis } = require('./database');
const logger = require('./logger');

// Ключ для хранения настроек в Redis
const getSettingsKey = (userId) => `settings:${userId}`;

// Настройки по умолчанию
const DEFAULT_SETTINGS = {
  theme: 'dark',
  language: 'ru',
  notifications: {
    enabled: true,
    sound: true,
    vibration: true,
    showPreview: true,
    mutedChats: []
  },
  privacy: {
    lastSeen: 'everyone',      // 'everyone', 'contacts', 'nobody'
    profilePhoto: 'everyone',
    calls: 'contacts',
    forwardedMessages: 'contacts'
  },
  chat: {
    fontSize: 16,
    enterToSend: true,
    archiveOnMute: false
  }
};

// ==================== ПОЛУЧИТЬ НАСТРОЙКИ ====================
router.get('/', async (req, res) => {
  try {
    const settingsJson = await redis.get(getSettingsKey(req.user.id));
    const settings = settingsJson ? JSON.parse(settingsJson) : DEFAULT_SETTINGS;
    res.json(settings);
  } catch (err) {
    logger.error('Error fetching settings:', err);
    res.status(500).json({ error: 'Failed to fetch settings' });
  }
});

// ==================== СОХРАНИТЬ НАСТРОЙКИ ====================
router.put('/', async (req, res) => {
  const newSettings = req.body;

  try {
    // Базовая валидация (можно расширить)
    if (typeof newSettings !== 'object') {
      return res.status(400).json({ error: 'Invalid settings format' });
    }

    await redis.set(getSettingsKey(req.user.id), JSON.stringify(newSettings));
    res.json({ success: true });
  } catch (err) {
    logger.error('Error saving settings:', err);
    res.status(500).json({ error: 'Failed to save settings' });
  }
});

// ==================== СБРОС К НАСТРОЙКАМ ПО УМОЛЧАНИЮ ====================
router.post('/reset', async (req, res) => {
  try {
    await redis.set(getSettingsKey(req.user.id), JSON.stringify(DEFAULT_SETTINGS));
    res.json({ success: true, settings: DEFAULT_SETTINGS });
  } catch (err) {
    logger.error('Error resetting settings:', err);
    res.status(500).json({ error: 'Failed to reset settings' });
  }
});

// ==================== ОБНОВЛЕНИЕ КОНКРЕТНОГО РАЗДЕЛА ====================
router.patch('/:section', async (req, res) => {
  const { section } = req.params; // 'theme', 'notifications', 'privacy', 'chat'
  const updates = req.body;

  try {
    const settingsJson = await redis.get(getSettingsKey(req.user.id));
    const settings = settingsJson ? JSON.parse(settingsJson) : DEFAULT_SETTINGS;

    if (!settings[section]) {
      return res.status(400).json({ error: 'Invalid section' });
    }

    // Простое объединение объектов
    settings[section] = { ...settings[section], ...updates };

    await redis.set(getSettingsKey(req.user.id), JSON.stringify(settings));
    res.json({ success: true, section: settings[section] });
  } catch (err) {
    logger.error('Error updating settings section:', err);
    res.status(500).json({ error: 'Failed to update settings' });
  }
});

module.exports = router;