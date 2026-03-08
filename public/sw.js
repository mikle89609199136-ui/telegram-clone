// sw.js — Service Worker для PWA и push-уведомлений

const CACHE_NAME = 'zhuravlev-telegram-v1';
const urlsToCache = [
  '/',
  '/chat.html',
  '/style.css',
  '/app.js',
  '/manifest.json'
];

// Установка и кэширование статики
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(urlsToCache);
    })
  );
});

// Перехват запросов – сначала из кэша, потом с сети
self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((response) => {
      return response || fetch(event.request);
    })
  );
});

// Обработка push-уведомлений
self.addEventListener('push', (event) => {
  let data = {};
  if (event.data) {
    try {
      data = event.data.json();
    } catch (e) {
      data = { title: 'Уведомление', body: event.data.text() };
    }
  }

  const options = {
    body: data.body || 'Новое сообщение',
    icon: '/icon-192.png',
    badge: '/badge-72.png',
    data: data.url || '/',
    vibrate: [200, 100, 200],
    actions: data.actions || []
  };

  event.waitUntil(
    self.registration.showNotification(data.title || 'Zhuravlev Telegram', options)
  );
});

// Клик по уведомлению
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const urlToOpen = event.notification.data || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url === urlToOpen && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(urlToOpen);
      }
    })
  );
});

// Активация – удаление старых кэшей
self.addEventListener('activate', (event) => {
  const cacheWhitelist = [CACHE_NAME];
  event.waitUntil(
    caches.keys().then((keyList) => {
      return Promise.all(
        keyList.map((key) => {
          if (!cacheWhitelist.includes(key)) {
            return caches.delete(key);
          }
        })
      );
    })
  );
});
