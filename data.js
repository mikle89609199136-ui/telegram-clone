const fs = require('fs-extra');
const path = require('path');

const DATA_DIR = './data';

module.exports = (app) => {
  // Получить чаты
  app.get('/api/data/chats', (req, res) => {
    const chats = fs.readJsonSync(path.join(DATA_DIR, 'chats.json')) || [];
    res.json(chats);
  });

  // Сохранить сообщение
  app.post('/api/data/message', (req, res) => {
    const { chatId, content } = req.body;
    const chats = fs.readJsonSync(path.join(DATA_DIR, 'chats.json')) || [];
    const chat = chats.find(c => c.id === chatId);

    if (chat) {
      chat.messages = chat.messages || [];
      chat.messages.push({
        id: Date.now(),
        content,
        timestamp: new Date().toISOString()
      });
      fs.writeJsonSync(path.join(DATA_DIR, 'chats.json'), chats);
      res.json({ success: true });
    } else {
      res.status(404).json({ error: 'Chat not found' });
    }
  });

  // Инициализация БД
  ['users.json', 'chats.json'].forEach(file => {
    if (!fs.existsSync(path.join(DATA_DIR, file))) {
      fs.writeJsonSync(path.join(DATA_DIR, file), []);
    }
  });
};
