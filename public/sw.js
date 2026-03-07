// public/sw.js – Service Worker для push-уведомлений и кэширования

const CACHE_NAME = 'craneapp-v1';
const urlsToCache = [
  '/public/chat.html',
  '/public/style.css',
  '/public/app.js',
  'https://i.ibb.co/QjTkyWfG/85-20260306202001.png'
];

// Установка Service Worker и кэширование основных файлов
self.addEventListener('install', event => {
  console.log('Service Worker installing...');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('Cache opened, adding files...');
        return cache.addAll(urlsToCache);
      })
      .then(() => self.skipWaiting())
  );
});

// Активация и очистка старых кэшей
self.addEventListener('activate', event => {
  console.log('Service Worker activating...');
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            console.log('Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Обработка fetch запросов – стратегия: сначала кэш, потом сеть
self.addEventListener('fetch', event => {
  // Игнорируем запросы не GET и не к нашему origin
  if (event.request.method !== 'GET') {
    return;
  }

  // Для API запросов не используем кэш
  if (event.request.url.includes('/api/')) {
    return;
  }

  event.respondWith(
    caches.match(event.request)
      .then(response => {
        // Возвращаем из кэша, если есть
        if (response) {
          return response;
        }
        // Иначе запрашиваем из сети
        return fetch(event.request).then(
          networkResponse => {
            // Проверяем, нужно ли кэшировать ответ
            if (networkResponse && networkResponse.status === 200) {
              const responseToCache = networkResponse.clone();
              caches.open(CACHE_NAME)
                .then(cache => {
                  cache.put(event.request, responseToCache);
                });
            }
            return networkResponse;
          }
        ).catch(error => {
          console.error('Fetch failed:', error);
          // Можно вернуть офлайн-страницу
          if (event.request.mode === 'navigate') {
            return caches.match('/public/chat.html');
          }
        });
      })
  );
});

// Обработка push-уведомлений
self.addEventListener('push', event => {
  console.log('Push received:', event);
  
  let data = {};
  try {
    data = event.data.json();
  } catch (e) {
    data = {
      title: 'CraneApp',
      body: event.data.text(),
      url: '/'
    };
  }

  const options = {
    body: data.body || 'New message',
    icon: '/public/icon.png',
    badge: '/public/badge.png',
    data: { url: data.url || '/' },
    vibrate: [200, 100, 200],
    actions: [
      { action: 'open', title: 'Open' },
      { action: 'close', title: 'Close' }
    ],
    tag: 'craneapp-notification',
    renotify: true
  };

  event.waitUntil(
    self.registration.showNotification(data.title || 'CraneApp', options)
  );
});

// Обработка клика по уведомлению
self.addEventListener('notificationclick', event => {
  console.log('Notification clicked:', event);
  event.notification.close();

  if (event.action === 'close') {
    return;
  }

  const urlToOpen = event.notification.data?.url || '/';

  event.waitUntil(
    clients.matchAll({
      type: 'window',
      includeUncontrolled: true
    }).then(windowClients => {
      // Проверяем, есть ли уже открытое окно
      for (let client of windowClients) {
        if (client.url === urlToOpen && 'focus' in client) {
          return client.focus();
        }
      }
      // Если нет, открываем новое
      if (clients.openWindow) {
        return clients.openWindow(urlToOpen);
      }
    })
  );
});

// Обработка закрытия уведомления
self.addEventListener('notificationclose', event => {
  console.log('Notification closed:', event);
});

// Фоновая синхронизация (опционально)
self.addEventListener('sync', event => {
  console.log('Background sync:', event);
  if (event.tag === 'sync-messages') {
    event.waitUntil(syncMessages());
  }
});

async function syncMessages() {
  try {
    const cache = await caches.open(CACHE_NAME);
    const requests = await cache.keys();
    // Здесь можно реализовать отправку отложенных сообщений
    console.log('Syncing messages...');
  } catch (err) {
    console.error('Sync failed:', err);
  }
}

// Обработка периодической фоновой синхронизации
self.addEventListener('periodicsync', event => {
  console.log('Periodic sync:', event);
  if (event.tag === 'update-content') {
    event.waitUntil(updateContent());
  }
});

async function updateContent() {
  try {
    const cache = await caches.open(CACHE_NAME);
    // Обновляем кэшированные файлы
    await cache.addAll(urlsToCache);
    console.log('Content updated');
  } catch (err) {
    console.error('Update failed:', err);
  }
}

// Сообщения от клиента
self.addEventListener('message', event => {
  console.log('Message from client:', event.data);
  
  if (event.data === 'skipWaiting') {
    self.skipWaiting();
  }
  
  if (event.data === 'getVersion') {
    event.ports[0].postMessage({ version: '1.0.0' });
  }
});

// Обработка ошибок
self.addEventListener('error', event => {
  console.error('Service Worker error:', event.error);
});

self.addEventListener('unhandledrejection', event => {
  console.error('Unhandled rejection:', event.reason);
});
