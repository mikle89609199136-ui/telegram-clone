// logger.js — модуль логирования (в консоль и файл)
const fs = require('fs-extra');
const path = require('path');
const config = require('./config'); // Будет создан позже

const logDir = path.join(__dirname, 'logs');
fs.ensureDirSync(logDir);

const levels = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

class Logger {
  constructor(level = 'info') {
    this.level = level;
    this.logFile = path.join(logDir, 'app.log');
    this.errorFile = path.join(logDir, 'error.log');
  }

  _write(level, message, ...args) {
    if (levels[level] < levels[this.level]) return;

    const timestamp = new Date().toISOString();
    const formatted = `[${timestamp}] [${level.toUpperCase()}] ${message} ${args.length ? JSON.stringify(args) : ''}\n`;

    // В консоль (кроме debug в production)
    if (process.env.NODE_ENV !== 'production' || level !== 'debug') {
      console[level === 'debug' ? 'log' : level](formatted.trim());
    }

    // В файл
    fs.appendFileSync(this.logFile, formatted);
    if (level === 'error') {
      fs.appendFileSync(this.errorFile, formatted);
    }
  }

  debug(message, ...args) { this._write('debug', message, ...args); }
  info(message, ...args) { this._write('info', message, ...args); }
  warn(message, ...args) { this._write('warn', message, ...args); }
  error(message, ...args) { this._write('error', message, ...args); }
}

module.exports = new Logger(process.env.NODE_ENV === 'development' ? 'debug' : 'info');
