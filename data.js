const fs = require('fs-extra');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');

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

// Инициализация пустых файлов при необходимости
['users.json', 'chats.json', 'messages.json'].forEach(file => {
    const filePath = path.join(DATA_DIR, file);
    if (!fs.existsSync(filePath)) {
        fs.writeJsonSync(filePath, [], { spaces: 2 });
    }
});

module.exports = { getData, saveData };
