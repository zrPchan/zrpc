// Bump cache name when assets change so clients get the updated index.html
const CACHE = "bottle-v4";
const ASSETS = ["/","/index.html","/history.html","/app.js","/history.js","/styles.css","/manifest.json",
  "/apple-touch-icon.png","/apple-touch-icon.svg","/icons/icon-192.svg","/icons/icon-512.svg",
  "/icons/icon-192.png","/icons/icon-512.png",
  "/icons/splash-1125x2436.svg","/icons/splash-1242x2688.svg","/icons/splash-828x1792.svg",
  "/icons/splash-750x1334.svg","/icons/splash-640x1136.svg","/icons/splash-1536x2048.svg","/icons/splash-2048x2732.svg"];

self.addEventListener("install", e => {
  // Pre-cache core assets. Do NOT call skipWaiting() automatically here; wait for client
  // confirmation to activate a new service worker to avoid resource mismatch.
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(ASSETS))
  );
});

// Remove old caches on activate so clients don't keep using stale index.html
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.map(k => { if(k !== CACHE) return caches.delete(k); return Promise.resolve(); })
    )).then(() => self.clients.claim())
  );
});

// Allow clients to instruct the waiting service worker to skipWaiting and become active.
self.addEventListener('message', event => {
  try{
    if(event.data && event.data.type === 'SKIP_WAITING'){
      self.skipWaiting();
    }
  }catch(e){/* ignore */}
});

// Cache-first strategy: serve from cache if available, else fallback to network.
self.addEventListener("fetch", e => {
  // For navigation requests (HTML), prefer network-first so users get the latest index.html
  // which helps picking up a new service worker and assets without reinstalling the PWA.
  const req = e.request;
  const isNavigate = req.mode === 'navigate' || (req.headers && req.headers.get && req.headers.get('accept') && req.headers.get('accept').includes('text/html'));
  if(isNavigate){
    e.respondWith(
      fetch(req).then(resp => {
        // update cache copy for offline fallback
        try{ const clone = resp.clone(); caches.open(CACHE).then(c => c.put(req, clone)); }catch(_){/* ignore */}
        return resp;
      }).catch(()=> caches.match(req))
    );
    return;
  }

  // For other requests use cache-first
  e.respondWith(
    caches.match(req).then(cached => cached || fetch(req).then(resp => {
      try{
        if(req.method === 'GET' && new URL(req.url).origin === self.location.origin){
          const respClone = resp.clone();
          caches.open(CACHE).then(c => c.put(req, respClone));
        }
      }catch(err){ /* ignore */ }
      return resp;
    }).catch(()=> cached))
  );
});

// Handle incoming Web Push messages. The server should send a JSON payload
// (stringified) with at least { title, body, tag, data } or no payload.
self.addEventListener('push', event => {
  let payload = {};
  try{
    if(event.data){ payload = event.data.json(); }
  }catch(e){ payload = {}; }
  const title = payload.title || 'Sand Study';
  const options = Object.assign({
    body: payload.body || '時間です',
    tag: payload.tag || 'sandstudy-push',
    data: payload.data || {}
  }, payload.options || {});

  event.waitUntil(self.registration.showNotification(title, options));
});

// When a notification created by this SW is clicked, try to focus an existing client
// or open a new window/tab. Also send a message to the client so it can open the end modal.
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const urlToOpen = new URL('/', self.location.origin).href;

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
      for (let client of windowClients) {
        // If there's an open client, focus it and post a message
        if (client.url === urlToOpen || client.url.startsWith(self.location.origin)) {
          client.focus();
          client.postMessage({ type: 'notification-click', data: event.notification.data || {} });
          return;
        }
      }
      // No client to focus, open a new window
      if (self.clients.openWindow) {
        return self.clients.openWindow(urlToOpen).then(newClient => {
          // not all browsers support postMessage on the returned client
          try { if (newClient) newClient.postMessage({ type: 'notification-click', data: event.notification.data || {} }); } catch (e) { /* ignore */ }
        });
      }
    })
  );
});
