/**
 * Service worker — keeps the app opening and printing with no network.
 *
 * Everything is precached on install. Serving is network-first with a cache
 * fallback: the server is localhost, so the network costs nothing and the
 * browser can never show yesterday's build. Without the server, the cache
 * answers instead.
 *
 * It used to be cache-first, which kept serving an old build with no visible
 * sign of it — hence network-first, and the version marker in the navigation.
 *
 * Bump CACHE whenever any file below changes; the old cache is deleted on
 * activate.
 */

const CACHE = 'fss-manager-v65';

const SHELL = [
  './',
  'index.html',
  'documents.html',
  'manifest.webmanifest',
  'assets/css/fonts.css',
  'assets/css/industry.css',
  'assets/css/app.css',
  'assets/css/doc-sheet.css',
  'assets/css/documents.css',
  'assets/js/app.js',
  'assets/js/store.js',
  'assets/js/doc-page.js',
  'assets/js/data.js',
  'assets/js/doc-render.js',
  'assets/js/documents.js',
  'assets/js/draw.js',
  'assets/js/print.js',
  'assets/js/import.js',
  'assets/js/xlsx.js',
  'assets/fonts/barlow-400.woff',
  'assets/fonts/barlow-500.woff',
  'assets/fonts/barlow-600.woff',
  'assets/fonts/barlow-condensed-400.woff',
  'assets/fonts/barlow-condensed-500.woff',
  'assets/fonts/barlow-condensed-600.woff',
  'assets/fonts/barlow-condensed-700.woff',
  'assets/icons/favicon-64.png',
  'assets/icons/icon-192.png',
  'assets/icons/icon-512.png',
  'assets/icons/icon-maskable-512.png',
  'assets/img/fss-grb.png',
  'assets/img/fss-logo.png',
  'form/FSS-Entry-Form.xlsx',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  // cache: 'reload' skips the browser HTTP cache, so the worker never saves
  // a stale copy as the "last seen" state. Navigation requests are excluded
  // because the browser rejects them when their options are changed.
  const fresh = request.mode !== 'navigate'
    && new URL(request.url).origin === self.location.origin
    ? fetch(request, { cache: 'reload' }) : fetch(request);

  event.respondWith(
    fresh
      .then((response) => {
        // Save whatever loads, so the cache always holds the latest
        // state, not the install-time one.
        if (response.ok && new URL(request.url).origin === self.location.origin) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(() => caches.match(request, { ignoreSearch: true }).then((hit) => hit
        // A deep link or refresh with no server still opens the app
        // instead of an error page.
        || (request.mode === 'navigate'
          ? caches.match('index.html', { ignoreSearch: true }) : undefined)))
  );
});
