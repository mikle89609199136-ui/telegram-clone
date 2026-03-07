const CACHE_NAME = 'craheapp-v1';
const urlsToCache = [
  '/',
  '/style.css',
  '/app.js',
  '/socket.io/socket.io.js',
  '/default-avatar.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(urlsToCache))
  );
});

self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request)
      .then(response => response || fetch(event.request))
  );
});
