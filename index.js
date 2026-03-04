socket.to(`chat:${chatId}`).emit('messageDelivered', { messageId, userId: socket.user.id });
    });

    // Подтверждение прочтения
    socket.on('messageRead', ({ messageId, chatId }) => {
      socket.to(`chat:${chatId}`).emit('messageRead', { messageId, userId: socket.user.id });
    });

    // Отзыв устройства (revoke)
    socket.on('revokeDevice', ({ deviceId }) => {
      // Проверяем, что устройство принадлежит пользователю
      const devices = getData('devices.json');
      const device = devices.find(d => d.id === deviceId && d.userId === socket.user.id);
      if (!device) return;
      device.revoked = true;
      saveData('devices.json', devices);
      // Уведомляем все устройства пользователя (кроме текущего)
      devices.filter(d => d.userId === socket.user.id && d.id !== socket.user.deviceId).forEach(d => {
        io.to(`device:${socket.user.id}:${d.id}`).emit('deviceRevoked', { deviceId });
      });
      // Отключаем отозванное устройство
      io.to(`device:${socket.user.id}:${deviceId}`).emit('forceLogout', { reason: 'DEVICE_REVOKED' });
    });

    socket.on('disconnect', () => {
      console.log(`User ${socket.user.username} disconnected`);
      const users = getData('users.json');
      const user = users.find(u => u.id === socket.user.id);
      if (user) {
        user.status = 'offline';
        user.lastSeen = new Date().toISOString();
        saveData('users.json', users);
      }
    });
  });
};
