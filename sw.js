// Protocol Flight — Service Worker
// Pre-caches the app shell (index.html) and reference guide / TPS images for offline use.
// Strategy: cache-first with a fast network race, so the app loads instantly even on
// networks that are "online" but can't actually reach github.io (e.g. flight deck wifi).

// ── BUMP THIS WITH EVERY DEPLOY to force cache refresh on all clients ──────
// One sw.js for both repos (.101): app shell = the folder this file is served
// from (…/Flight/ or …/FlightBeta/); each repo keeps its own cache prefix so
// the two never delete each other's caches on the same device.
const SCOPE = new URL('./', self.location.href).href;
const CACHE_PREFIX = /\/FlightBeta\//.test(SCOPE) ? 'flightbeta-assets-' : 'flight-assets-';
const SHELL_INDEX = SCOPE + 'index.html';
const CACHE_NAME = CACHE_PREFIX + 'v2026-11-09.101';
const NETWORK_TIMEOUT_MS = 4000;

// App shell — required for the app to load offline / on restricted networks
const SHELL_ASSETS = [
  SCOPE,
  SHELL_INDEX,
];

const IMAGE_ASSETS = [
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

const ASSETS_TO_CACHE = [...SHELL_ASSETS, ...IMAGE_ASSETS];

// Fetch with a timeout so a hung/blackholed request (e.g. captive/restricted wifi)
// fails fast instead of stalling the page load.
function fetchWithTimeout(request, ms) {
  return new Promise((resolve, reject) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => { ctrl.abort(); reject(new Error('timeout')); }, ms);
    const opts = (request instanceof Request) ? { signal: ctrl.signal } : { signal: ctrl.signal, cache: 'no-cache' };
    fetch(request, opts)
      .then(res => { clearTimeout(timer); resolve(res); })
      .catch(err => { clearTimeout(timer); reject(err); });
  });
}

// Install: precache app shell + images, then activate immediately.
// A new CACHE_NAME means this runs fresh on every version bump.
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return Promise.allSettled(
        ASSETS_TO_CACHE.map(url =>
          fetchWithTimeout(url, 10000)
            .then(response => {
              if (!response.ok) throw new Error('Failed: ' + url);
              return cache.put(url, response);
            })
            .catch(err => console.warn('[SW] Could not cache:', url, err))
        )
      );
    }).then(() => self.skipWaiting())  // activate immediately, don't wait for old clients to close
  );
});

// Activate: delete ALL old caches (anything not matching current CACHE_NAME),
// then claim all open clients so the new SW takes over without a reload.
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k.startsWith(CACHE_PREFIX) && k !== CACHE_NAME).map(k => {
          console.log('[SW] Deleting old cache:', k);
          return caches.delete(k);
        })
      )
    ).then(() => self.clients.claim())  // take control of all open tabs immediately
  );
});

// Message handler: FORCE_UPDATE — bypass cache, fetch fresh shell from network,
// overwrite the cached copy, then tell all clients to reload.
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'FORCE_UPDATE') {
    event.waitUntil((async () => {
      try {
        const cache = await caches.open(CACHE_NAME);
        const fresh = await fetch(SHELL_INDEX, { cache: 'reload' });
        if (fresh && fresh.ok) {
          await cache.put(SHELL_INDEX, fresh.clone());
          await cache.put(SCOPE, fresh.clone());
        }
      } catch (e) { /* ignore — reload anyway */ }
      const clients = await self.clients.matchAll({ type: 'window' });
      clients.forEach(c => c.postMessage({ type: 'RELOAD_NOW' }));
    })());
  }
});

// Fetch:
//  - Navigation requests and known shell assets: cache-first, background network
//    refresh so next load gets updated content.
//  - Known image assets: cache-first, network fallback.
//  - Everything else: pass through to network.
self.addEventListener('fetch', event => {
  const req = event.request;
  const url = req.url;
  const isNavigation = req.mode === 'navigate';
  const isShellAsset = SHELL_ASSETS.includes(url);
  const isImageAsset = IMAGE_ASSETS.includes(url);

  if (isNavigation || isShellAsset) {
    event.respondWith(
      caches.open(CACHE_NAME).then(async cache => {
        const cached = await cache.match(isNavigation ? SHELL_INDEX : req);

        // Always try to refresh from network in the background (best effort, fast timeout)
        const networkUpdate = fetchWithTimeout(req, NETWORK_TIMEOUT_MS)
          .then(async response => {
            if (response && response.ok) {
              const oldTag = cached ? (cached.headers.get('etag') || cached.headers.get('last-modified') || '') : '';
              const newTag = response.headers.get('etag') || response.headers.get('last-modified') || '';
              cache.put(SHELL_INDEX, response.clone());
              if (isShellAsset) cache.put(req, response.clone());
              if (cached && newTag && oldTag !== newTag) {
                const clients = await self.clients.matchAll({ type: 'window' });
                clients.forEach(c => c.postMessage({ type: 'SW_UPDATED' }));
              }
            }
            return response;
          })
          .catch(() => null);

        if (cached) {
          networkUpdate.catch(() => {});
          return cached;
        }

        const fresh = await networkUpdate;
        if (fresh) return fresh;

        return new Response(
          '<!DOCTYPE html><html><body style="background:#0a0c0f;color:#e8eaf0;font-family:sans-serif;padding:40px;text-align:center">' +
          '<h2>Offline</h2><p>No cached version of the app is available yet. Connect once to an unrestricted network to prime the offline cache.</p>' +
          '</body></html>',
          { status: 503, headers: { 'Content-Type': 'text/html' } }
        );
      })
    );
    return;
  }

  if (isImageAsset) {
    event.respondWith(
      caches.match(req).then(cached => {
        if (cached) return cached;
        return fetchWithTimeout(req, NETWORK_TIMEOUT_MS).then(response => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(req, clone));
          }
          return response;
        }).catch(() => cached);
      })
    );
    return;
  }

  // All other requests pass through normally
});
