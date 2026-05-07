// Protocol Flight — Service Worker
// Pre-caches reference guide and TPS images for offline use.

const CACHE_NAME = 'flight-assets-v1';

const ASSETS_TO_CACHE = [
  // Europe reference guide
  'https://coochiesan.github.io/Flight/images/europe_1.jpeg',
  'https://coochiesan.github.io/Flight/images/europe_2.jpeg',
  'https://coochiesan.github.io/Flight/images/europe_3.jpeg',
  'https://coochiesan.github.io/Flight/images/europe_4.jpeg',
  'https://coochiesan.github.io/Flight/images/europe_5.jpeg',
  'https://coochiesan.github.io/Flight/images/europe_6.jpeg',
  'https://coochiesan.github.io/Flight/images/europe_7.jpeg',
  // Pacific reference guide
  'https://coochiesan.github.io/Flight/images/pacific_1.jpeg',
  'https://coochiesan.github.io/Flight/images/pacific_2.jpeg',
  'https://coochiesan.github.io/Flight/images/pacific_3.jpeg',
  'https://coochiesan.github.io/Flight/images/pacific_4.jpeg',
  'https://coochiesan.github.io/Flight/images/pacific_5.jpeg',
  'https://coochiesan.github.io/Flight/images/pacific_6.jpeg',
  'https://coochiesan.github.io/Flight/images/pacific_7.jpeg',
  // TPS Variations
  'https://coochiesan.github.io/Flight/images/tps_1.jpeg',
  'https://coochiesan.github.io/Flight/images/tps_2.jpeg',
  'https://coochiesan.github.io/Flight/images/tps_3.jpeg',
];

// Install: fetch and cache all assets
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return Promise.allSettled(
        ASSETS_TO_CACHE.map(url =>
          fetch(url, { cache: 'no-cache' })
            .then(response => {
              if (!response.ok) throw new Error('Failed: ' + url);
              return cache.put(url, response);
            })
            .catch(err => console.warn('[SW] Could not cache:', url, err))
        )
      );
    }).then(() => self.skipWaiting())
  );
});

// Activate: delete old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// Fetch: serve from cache first, fall back to network
self.addEventListener('fetch', event => {
  const url = event.request.url;
  // Only intercept our cached image assets
  if (ASSETS_TO_CACHE.includes(url)) {
    event.respondWith(
      caches.match(event.request).then(cached => {
        if (cached) return cached;
        // Not in cache yet — try network and cache for next time
        return fetch(event.request).then(response => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          }
          return response;
        });
      })
    );
  }
  // All other requests pass through normally
});
