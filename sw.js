/**
 * Service worker — makes the app open and print with no network at all.
 *
 * Everything is precached on install. Serving is **network-first with a cache
 * fallback**, which for this application is the only sane order: the server is
 * always on localhost, so "network" costs nothing and the browser can never
 * show yesterday's build. When the server is not running — the genuinely
 * offline case — the cache answers instead.
 *
 * It used to be cache-first, and that produced the worst possible failure: the
 * folder on disk was current while the browser kept serving an older release,
 * with no visible sign of it. Hence also the version marker in the navigation.
 *
 * Bump CACHE whenever any file below changes; the old cache is deleted on
 * activate.
 */

const CACHE = 'fss-manager-v63';

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
  'assets/js/club-forms.js',
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

  // `cache: 'reload'` zaobilazi keš pregledača. Bez toga service worker ume
  // da dobije staru kopiju iz njega i da je pošteno sačuva kao „poslednje
  // viđeno" — pa se stara verzija drži i kad je server odavno nova.
  // Navigacija se izuzima: zahtev za stranu ne sme da se preslaže sa drugim
  // podešavanjima, pregledač na to odgovara greškom.
  const fresh = request.mode !== 'navigate'
    && new URL(request.url).origin === self.location.origin
    ? fetch(request, { cache: 'reload' }) : fetch(request);

  event.respondWith(
    fresh
      .then((response) => {
        // Što je viđeno, to je i sačuvano — keš tako uvek drži poslednje
        // stanje, a ne ono od instalacije.
        if (response.ok && new URL(request.url).origin === self.location.origin) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(() => caches.match(request, { ignoreSearch: true }).then((hit) => hit
        // Deep link ili osvežavanje bez servera i dalje otvara aplikaciju,
        // umesto stranice o grešci.
        || (request.mode === 'navigate'
          ? caches.match('index.html', { ignoreSearch: true }) : undefined)))
  );
});
