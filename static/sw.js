// ==========================================================================
// Service Worker for бТИИ-262 Расписание (Offline & Instant Cache PWA)
// Optimized for Render cold start (~40-50s) & flaky university Wi-Fi
// ==========================================================================

const CACHE_NAME = 'btii262-v2.0.0';
const STATIC_ASSETS = [
  '/',
  '/manifest.json',
  '/favicon.ico',
  '/static/favicon.svg',
  '/static/css/style.css',
  '/static/css/style.css?v=3.0',
  '/static/js/app.js',
  '/static/js/app.js?v=3.0',
  '/static/js/auth.js',
  '/static/js/auth.js?v=3.0',
  '/static/js/schedule.js',
  '/static/js/schedule.js?v=3.0',
  '/static/js/tasks.js',
  '/static/js/tasks.js?v=3.0',
  '/api/schedule',
  '/api/students'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return Promise.all(
        STATIC_ASSETS.map((asset) => {
          return cache.add(asset).catch((err) => {
            console.warn('[SW] Precache skipped for:', asset, err.message);
          });
        })
      );
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            console.log('[SW] Deleting old cache:', key);
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Helper: fetch with timeout for slow networks / cold start
function fetchWithTimeout(request, timeoutMs = 3500) {
  return new Promise((resolve, reject) => {
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      reject(new Error('Network timeout (Render cold start)'));
    }, timeoutMs);

    fetch(request)
      .then((res) => {
        if (!timedOut) {
          clearTimeout(timer);
          resolve(res);
        }
      })
      .catch((err) => {
        if (!timedOut) {
          clearTimeout(timer);
          reject(err);
        }
      });
  });
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Only handle GET requests
  if (request.method !== 'GET') {
    return;
  }

  // Non-http schemes (extensions, chrome:, etc.)
  if (!url.protocol.startsWith('http')) {
    return;
  }

  // API requests (Schedule, students, tasks, notes)
  // Network-first with fast 3.5s timeout race & 50x fallback to Cache
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetchWithTimeout(request, 3500)
        .then((response) => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
            return response;
          }
          // Server returned 500/502/503/504 (e.g. Render spinning up)
          if (response && response.status >= 500) {
            return caches.match(request, { ignoreSearch: true }).then((cached) => {
              if (cached) return cached;
              return response;
            });
          }
          return response;
        })
        .catch(() => {
          // Fallback to cache on network failure or cold start timeout
          return caches.match(request, { ignoreSearch: true }).then((cached) => {
            if (cached) return cached;
            return new Response(JSON.stringify({ error: 'Офлайн-режим (из кеша)', offline: true }), {
              status: 503,
              headers: { 'Content-Type': 'application/json; charset=utf-8' }
            });
          });
        })
    );
    return;
  }

  // Static Assets & Navigation -> Stale-while-revalidate with ignoreSearch: true
  event.respondWith(
    caches.match(request, { ignoreSearch: true }).then((cachedResponse) => {
      const fetchPromise = fetch(request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const clone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return networkResponse;
        })
        .catch(() => {
          // If network fails and nothing in cache, return root for navigation
          if (request.mode === 'navigate') {
            return caches.match('/', { ignoreSearch: true });
          }
          return null;
        });

      return cachedResponse || fetchPromise;
    })
  );
});
