/**
 * StadiumPulse — Service Worker
 * Keeps the app shell available offline while avoiding stale HTML/JS/CSS mismatches.
 *
 * @module sw
 */

const CACHE_NAME = 'stadiumpulse-v5';

/** @const {string[]} Same-origin app shell assets to pre-cache */
const APP_SHELL_ASSETS = [
  '/',
  '/index.html',
  '/index.css',
  '/app.js',
  '/manifest.json'
];

/**
 * Returns true when the request targets the local app shell.
 * @param {Request} request - Incoming fetch request
 * @returns {boolean} Whether the request is part of the app shell
 */
function isAppShellRequest(request) {
  const url = new URL(request.url);
  return url.origin === self.location.origin && APP_SHELL_ASSETS.includes(url.pathname);
}

/**
 * Returns true when the request targets an API endpoint.
 * @param {Request} request - Incoming fetch request
 * @returns {boolean} Whether the request is an API request
 */
function isApiRequest(request) {
  return new URL(request.url).pathname.startsWith('/api/');
}

/**
 * Caches a successful same-origin response.
 * @param {Request} request - Request key
 * @param {Response} response - Response to cache
 * @returns {Promise<void>} Cache write promise
 */
async function cacheSuccessfulResponse(request, response) {
  if (!response || !response.ok) return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  const cache = await caches.open(CACHE_NAME);
  await cache.put(request, response.clone());
}

/**
 * Network-first strategy with cache fallback.
 * @param {Request} request - Request to resolve
 * @returns {Promise<Response>} Network or cached response
 */
async function networkFirst(request) {
  try {
    const response = await fetch(request);
    await cacheSuccessfulResponse(request, response);
    return response;
  } catch (error) {
    const cached = await caches.match(request);
    if (cached) return cached;
    throw error;
  }
}

/**
 * Cache-first strategy with network refresh fallback.
 * @param {Request} request - Request to resolve
 * @returns {Promise<Response>} Cached or network response
 */
async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  await cacheSuccessfulResponse(request, response);
  return response;
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
    ))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  // Let Google-hosted resources bypass the service worker entirely.
  if (url.origin !== self.location.origin) {
    return;
  }

  if (isApiRequest(event.request) || isAppShellRequest(event.request) || event.request.mode === 'navigate') {
    event.respondWith(networkFirst(event.request));
    return;
  }

  event.respondWith(cacheFirst(event.request));
});
