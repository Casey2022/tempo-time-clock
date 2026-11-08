const CACHE_NAME = 'tempo-shell-v14';
const APP_SHELL = [
  './',
  './index.html',
  './styles.css',
  './storage.js',
  './app-config.js',
  './supabase-client.js',
  './auth.js',
  './cloud-sync.js',
  './photos.js',
  './app.js',
  './manifest.webmanifest',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.105.0',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);

  // Bypass cache for Supabase backend API calls (auth, REST)
  if (url.hostname.includes('supabase.co')) return;

  // Network first so new deploys show up right away; the cache is the offline fallback.
  event.respondWith(
    fetch(event.request).then((response) => {
      if (response && response.status === 200 && (response.type === 'basic' || response.type === 'cors')) {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
      }
      return response;
    }).catch(() => caches.match(event.request, { ignoreSearch: true }).then((cached) => {
      if (cached) return cached;
      if (event.request.mode === 'navigate') return caches.match('./index.html');
      return Response.error();
    }))
  );
});
