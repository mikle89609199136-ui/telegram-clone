const Redis = require('ioredis');
const Bull = require('bull');
const { v4: uuidv4 } = require('uuid');
const config = require('./config');
const logger = require('./logger');

let redis;
let queues = {};

function getRedis() {
  if (!redis) {
    redis = new Redis(config.redisUrl, {
      tls: config.redisTls ? {} : undefined,
      retryStrategy: (times) => Math.min(times * 50, 2000)
    });
    redis.on('error', (err) => logger.error('Redis error', err));
  }
  return redis;
}

function getQueue(name) {
  if (!queues[name]) {
    queues[name] = new Bull(name, config.queueUrl, {
      redis: { tls: config.redisTls ? {} : undefined }
    });
    queues[name].on('error', (err) => logger.error(`Queue ${name} error`, err));
  }
  return queues[name];
}

async function addToQueue(name, data, opts = {}) {
  const queue = getQueue(name);
  const job = await queue.add(data, opts);
  return job.id;
}

function generateId() {
  return uuidv4();
}

function sanitizeHtml(html) {
  // Basic sanitization (use a library in production)
  return html.replace(/<script.*?>.*?<\/script>/gi, '');
}

function escapeHtml(unsafe) {
  return unsafe.replace(/[&<>"]/g, (m) => {
    if (m === '&') return '&amp;';
    if (m === '<') return '&lt;';
    if (m === '>') return '&gt;';
    if (m === '"') return '&quot;';
    return m;
  });
}

function validateEmail(email) {
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return re.test(email);
}

function validateUsername(username) {
  const re = /^[a-zA-Z0-9_]{3,30}$/;
  return re.test(username);
}

function maskPassword(pass) {
  return pass ? '********' : '';
}

module.exports = {
  getRedis,
  getQueue,
  addToQueue,
  generateId,
  sanitizeHtml,
  escapeHtml,
  validateEmail,
  validateUsername,
  maskPassword,
};
