const { getQueue } = require('./utils');
const logger = require('./logger');

async function startNotificationWorker() {
  const queue = getQueue('notifications');
  queue.process(async (job) => {
    const { type, message } = job.data;
    logger.info('Processing notification', { type, messageId: message.id });
    // In real app, send push notifications via FCM/APNS
    // For MVP, we just log
  });
}

module.exports = { startNotificationWorker };
