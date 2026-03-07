const { query } = require('./database');
const logger = require('./logger');

async function handleOffer(socket, data) {
  const { calleeId, offer, type } = data;
  try {
    const result = await query(
      'INSERT INTO calls (caller_id, callee_id, type, status) VALUES ($1, $2, $3, $4) RETURNING id',
      [socket.userId, calleeId, type, 'started']
    );
    const callId = result.rows[0].id;
    socket.to(`user:${calleeId}`).emit('call:incoming', {
      callId,
      callerId: socket.userId,
      offer,
      type,
    });
  } catch (err) {
    logger.error('handleOffer error', err);
  }
}

async function handleAnswer(socket, data) {
  const { callId, answer, calleeId } = data;
  try {
    await query('UPDATE calls SET status = $1 WHERE id = $2', ['answered', callId]);
    socket.to(`user:${calleeId}`).emit('call:answered', { callId, answer });
  } catch (err) {
    logger.error('handleAnswer error', err);
  }
}

async function handleIceCandidate(socket, data) {
  const { candidate, targetUserId } = data;
  socket.to(`user:${targetUserId}`).emit('call:ice-candidate', { candidate, from: socket.userId });
}

async function handleEnd(socket, data) {
  const { callId } = data;
  try {
    await query('UPDATE calls SET status = $1, ended_at = NOW() WHERE id = $2', ['ended', callId]);
    socket.broadcast.emit('call:ended', { callId });
  } catch (err) {
    logger.error('handleEnd error', err);
  }
}

module.exports = {
  handleOffer,
  handleAnswer,
  handleIceCandidate,
  handleEnd,
};
