// data.js — модуль для чтения/записи JSON-файлов в папке data

const fs = require('fs-extra');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');

// Убеждаемся, что директория существует
fs.ensureDirSync(DATA_DIR);

/**
 * Получить данные из JSON-файла.
 * @param {string} filename - имя файла (например, 'users.json')
 * @returns {Array} - массив объектов
 */
function getData(filename) {
  const filePath = path.join(DATA_DIR, filename);
  try {
    return fs.readJsonSync(filePath, { throws: false }) || [];
  } catch {
    return [];
  }
}

/**
 * Сохранить данные в JSON-файл.
 * @param {string} filename - имя файла
 * @param {Array} data - массив объектов
 */
function saveData(filename, data) {
  const filePath = path.join(DATA_DIR, filename);
  fs.writeJsonSync(filePath, data, { spaces: 2 });
}

/**
 * Инициализация пустых файлов при первом запуске.
 */
function initDataFiles() {
  const files = ['users.json', 'chats.json', 'messages.json', 'codes.json'];
  files.forEach(file => {
    const filePath = path.join(DATA_DIR, file);
    if (!fs.existsSync(filePath)) {
      fs.writeJsonSync(filePath, [], { spaces: 2 });
      console.log(`📁 Создан файл данных: ${file}`);
    }
  });
}

// Автоматическая инициализация при загрузке модуля
initDataFiles();

module.exports = { getData, saveData };
