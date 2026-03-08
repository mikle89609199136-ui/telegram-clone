// data.js — простой интерфейс для JSON-файлов (как fallback)
const fs = require('fs-extra');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
fs.ensureDirSync(DATA_DIR);

function getData(filename) {
  const filePath = path.join(DATA_DIR, filename);
  try {
    return fs.readJsonSync(filePath, { throws: false }) || [];
  } catch {
    return [];
  }
}

function saveData(filename, data) {
  const filePath = path.join(DATA_DIR, filename);
  fs.writeJsonSync(filePath, data, { spaces: 2 });
}

module.exports = { getData, saveData };
