/**
 * NFL Matchup Analyzer - service worker.
 *
 * Summary:
 *   Makes the installed app work offline.
 *   - App files (page, styles, script, icons) are served from the cache right
 *     away while a fresh copy downloads in the background, so code updates
 *     appear the next time the app opens.
 *   - Data files (data/*.json) always try the network first so you see the
 *     latest stats and lines, and fall back to the saved copy when offline.
 *   Bump CACHE_VERSION whenever the APP_SHELL list changes to drop old caches.
 *   Weather from Open-Meteo (another site) is never cached here, so it is
 *   always live (and missing when offline).
 *
 * Input files (cached from this folder):
 *   index.html, styles.css, app.js, stadiums.json, manifest.webmanifest, icons/*.png, data/*.json
 * Output files:
 *   None. Responses are stored in the browser's Cache Storage only.
 *
 * Location: D:\OneDrive\Code\DFS_direct\NFL\nfl-matchups\sw.js
 */

const CACHE_VERSION = 'nfl-matchups-v3';

const APP_SHELL = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './stadiums.json',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_VERSION).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;

  if (url.pathname.includes('/data/')) {
    event.respondWith(
      caches.open(CACHE_VERSION).then((cache) => fetch(request)
        .then((response) => {
          if (response.ok) cache.put(request, response.clone());
          return response;
        })
        .catch(() => cache.match(request, { ignoreSearch: true }))),
    );
    return;
  }

  event.respondWith(
    caches.open(CACHE_VERSION).then(async (cache) => {
      const cached = await cache.match(request, { ignoreSearch: true });
      const network = fetch(request)
        .then((response) => {
          if (response.ok) cache.put(request, response.clone());
          return response;
        })
        .catch(() => cached);
      return cached || network;
    }),
  );
});
