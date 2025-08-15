self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open('sendlike-v2').then(cache => {
    return cache.addAll(['/', '/index.html', '/style.css', '/script.js', '/manifest.json' ]);
  }));
});
self.addEventListener('activate', (e) => { e.waitUntil(self.clients.claim()); });
self.addEventListener('fetch', (e) => {
  e.respondWith(caches.match(e.request).then(res => res || fetch(e.request)));
});
