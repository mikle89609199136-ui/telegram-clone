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
    bio: 'everyone',
    calls: 'contacts',
    forwardedMessages: 'contacts',
    groupsInvites: 'everyone'   // 'everyone', 'contacts'
  },
  chat: {
    fontSize: 16,
    enterToSend: true,
    archiveOnMute: false,
    showStickers: true,
    showEmoji: true
  },
  security: {
    twoFactorAuth: false,
    activeSessions: []
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

    // Сохраняем только разрешённые поля, объединяя с текущими
    const currentJson = await redis.get(getSettingsKey(req.user.id));
    const current = currentJson ? JSON.parse(currentJson) : DEFAULT_SETTINGS;
    
    const updated = { ...current, ...newSettings };
    
    await redis.set(getSettingsKey(req.user.id), JSON.stringify(updated));
    res.json({ success: true, settings: updated });
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
  const { section } = req.params; // 'theme', 'notifications', 'privacy', 'chat', 'security'
  const updates = req.body;

  const allowedSections = ['theme', 'language', 'notifications', 'privacy', 'chat', 'security'];
  if (!allowedSections.includes(section)) {
    return res.status(400).json({ error: 'Invalid section' });
  }

  try {
    const settingsJson = await redis.get(getSettingsKey(req.user.id));
    const settings = settingsJson ? JSON.parse(settingsJson) : DEFAULT_SETTINGS;

    if (!settings[section] && typeof settings[section] !== 'object') {
      settings[section] = {};
    }

    // Глубокое слияние для объекта
    if (typeof updates === 'object' && !Array.isArray(updates)) {
      settings[section] = { ...settings[section], ...updates };
    } else {
      settings[section] = updates;
    }

    await redis.set(getSettingsKey(req.user.id), JSON.stringify(settings));
    res.json({ success: true, section: settings[section] });
  } catch (err) {
    logger.error('Error updating settings section:', err);
    res.status(500).json({ error: 'Failed to update settings' });
  }
});

// ==================== ПОЛУЧИТЬ КОНКРЕТНЫЙ РАЗДЕЛ ====================
router.get('/:section', async (req, res) => {
  const { section } = req.params;

  const allowedSections = ['theme', 'language', 'notifications', 'privacy', 'chat', 'security'];
  if (!allowedSections.includes(section)) {
    return res.status(400).json({ error: 'Invalid section' });
  }

  try {
    const settingsJson = await redis.get(getSettingsKey(req.user.id));
    const settings = settingsJson ? JSON.parse(settingsJson) : DEFAULT_SETTINGS;
    
    res.json({ [section]: settings[section] || null });
  } catch (err) {
    logger.error('Error fetching settings section:', err);
    res.status(500).json({ error: 'Failed to fetch settings' });
  }
});

// ==================== ДОБАВИТЬ ЧАТ В ИГНОРИРУЕМЫЕ (MUTE) ====================
router.post('/mute/:chatId', async (req, res) => {
  const { chatId } = req.params;

  try {
    const settingsJson = await redis.get(getSettingsKey(req.user.id));
    const settings = settingsJson ? JSON.parse(settingsJson) : DEFAULT_SETTINGS;

    if (!settings.notifications.mutedChats.includes(chatId)) {
      settings.notifications.mutedChats.push(chatId);
      await redis.set(getSettingsKey(req.user.id), JSON.stringify(settings));
    }

    res.json({ success: true, mutedChats: settings.notifications.mutedChats });
  } catch (err) {
    logger.error('Error muting chat:', err);
    res.status(500).json({ error: 'Failed to mute chat' });
  }
});

// ==================== УБРАТЬ ЧАТ ИЗ ИГНОРИРУЕМЫХ (UNMUTE) ====================
router.delete('/mute/:chatId', async (req, res) => {
  const { chatId } = req.params;

  try {
    const settingsJson = await redis.get(getSettingsKey(req.user.id));
    const settings = settingsJson ? JSON.parse(settingsJson) : DEFAULT_SETTINGS;

    settings.notifications.mutedChats = settings.notifications.mutedChats.filter(id => id !== chatId);
    await redis.set(getSettingsKey(req.user.id), JSON.stringify(settings));

    res.json({ success: true, mutedChats: settings.notifications.mutedChats });
  } catch (err) {
    logger.error('Error unmuting chat:', err);
    res.status(500).json({ error: 'Failed to unmute chat' });
  }
});

module.exports = router;
