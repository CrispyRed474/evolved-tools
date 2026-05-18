// Service Worker for Evolved Floors Quote Tool
// Cache strategy: cache-first for app shell, network-first for API calls

const CACHE_NAME = 'evolved-quote-v7';
const SHELL_ASSETS = [
  '/',
  '/index.html',
  '/index-offline.html'
];

// Install: cache app shell
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[SW] Caching app shell...');
      return cache.addAll(SHELL_ASSETS).catch(err => {
        console.log('[SW] Some assets failed to cache (may be offline):', err);
      });
    })
  );
});

// Activate: clean up old caches
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((names) => {
      return Promise.all(
        names.map((name) => {
          if (name !== CACHE_NAME) {
            console.log('[SW] Deleting old cache:', name);
            return caches.delete(name);
          }
        })
      );
    })
  );
});

// Fetch: cache-first for shell assets, network-first for everything else
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  
  // Only handle same-origin requests
  if (url.origin !== self.location.origin) {
    return;
  }

  // For HTML and main assets: cache-first
  if (SHELL_ASSETS.some(asset => url.pathname.endsWith(asset) || asset === '/' && url.pathname === '/')) {
    e.respondWith(
      caches.match(e.request).then((response) => {
        return response || fetch(e.request);
      }).catch(() => {
        // Offline fallback for main page
        return caches.match('/index.html') || new Response('Offline - cache failed', { status: 503 });
      })
    );
  } else {
    // For everything else: network-first
    e.respondWith(
      fetch(e.request)
        .then((response) => {
          // Cache successful responses
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(e.request, clone);
            });
          }
          return response;
        })
        .catch(() => {
          // Fall back to cache if network fails
          return caches.match(e.request);
        })
    );
  }
});

// Listen for sync requests from the app
self.addEventListener('sync', (e) => {
  if (e.tag === 'sync-queue') {
    e.waitUntil(self.clients.matchAll().then(clients => {
      clients.forEach(client => {
        client.postMessage({ type: 'SYNC_REQUESTED' });
      });
    }));
  }
});
