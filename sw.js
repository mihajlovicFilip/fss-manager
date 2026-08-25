/**
 * Service worker — makes the app open and print with no network at all.
 *
 * Everything is precached on install and served cache-first afterwards, so a
 * laptop carried into a sports hall behaves exactly as it did in the office.
 * Bump CACHE when any file below changes; the old cache is deleted on
 * activate, so a stale sheet can never outlive a release.
 */

const CACHE = 'fss-manager-v41';

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

  // Navigations fall back to the cached shell, so a deep link or a reload
  // offline still opens the app instead of the browser's error page.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match('index.html', { ignoreSearch: true }))
    );
    return;
  }

  event.respondWith(
    caches.match(request, { ignoreSearch: true }).then((hit) => hit || fetch(request))
  );
});
