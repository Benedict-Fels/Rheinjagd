/**
 * Service Worker für die installierte App.
 * Strategie: Netz zuerst, Cache nur als Rückfall. So kommt nach jedem
 * Deploy sofort die neue Version — und bei Funkloch (U-Bahn!) öffnet die
 * App trotzdem mit dem letzten Stand. Nur eigene Dateien werden gecacht;
 * Kartenkacheln, Fonts und Leaflet vom CDN laufen ungefiltert durchs Netz.
 */
const CACHE = 'rheinjagd-v1';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith((async () => {
    try {
      const res = await fetch(req);
      if (res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
      }
      return res;
    } catch (err) {
      const hit = await caches.match(req, { ignoreSearch: true });
      if (hit) return hit;
      if (req.mode === 'navigate') {
        const page = await caches.match('./', { ignoreSearch: true }) || await caches.match('index.html', { ignoreSearch: true });
        if (page) return page;
      }
      throw err;
    }
  })());
});
