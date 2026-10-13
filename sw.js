/**
 * Service Worker für die installierte App (Runde 31: für schlechtes Netz).
 *
 * Drei Sorten Anfragen, drei Strategien:
 *  1. Eigene Dateien (index.html, Icons, Manifest): Netz zuerst, aber höchstens
 *     3 s warten — dann der gespeicherte Stand. Kommt das Netz später doch
 *     noch, landet die neue Version im Cache für den nächsten Start. Vorher
 *     hing die App bei Funkloch-am-Rand bis zum Browser-Timeout (~1 min).
 *  2. Mitgelieferte Bibliotheken (vendor/, z. B. Leaflet): Cache zuerst. Der
 *     Dateiname trägt die Version, ändert sich also nie unter derselben URL.
 *     (Bis Runde 31 kamen Leaflet von cdnjs und Schriften von Google — seit
 *     Runde 32 liegt Leaflet im Repo und die App nutzt Systemschriften.)
 *  3. Kartenkacheln (tile.openstreetmap.org): Cache zuerst, im Hintergrund
 *     auffrischen. Gecacht wird nur, was man ohnehin angesehen hat — kein
 *     Vorab-Download (verbietet die OSM-Nutzungsrichtlinie). Höchstens
 *     4000 Kacheln (~50–80 MB), die ältesten fliegen zuerst raus.
 *     Fehlt offline eine Kachel, wird sie aus einer gespeicherten gröberen
 *     Kachel (bis 4 Stufen höher) hochskaliert — unscharf statt leer
 *     (Runde 35). Diese Ersatzkacheln werden nicht gespeichert.
 */
const APP = 'rheinjagd-app-v2';
// Name wird auch in der App benutzt (Einstellungen → Kartenspeicher leeren).
const LIB = 'rheinjagd-lib-v1';
const TILES = 'rheinjagd-tiles-v1';
const TILE_MAX = 4000;
const FALLBACK_UP = 4;
const NET_WAIT_MS = 3000;

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (![APP, LIB, TILES].includes(k)) await caches.delete(k);
    await self.clients.claim();
  })());
});

const isLib = (u) => u.origin === self.location.origin && u.pathname.includes('/vendor/');
const isTile = (u) => /(^|\.)tile\.openstreetmap\.org$/.test(u.hostname);

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const u = new URL(req.url);
  if (isLib(u)) e.respondWith(cacheFirst(req, LIB));
  else if (u.origin === self.location.origin) e.respondWith(appFirst(e, req));
  else if (isTile(u)) e.respondWith(tile(e, req));
});

/** Netz mit Zeitlimit, sonst Cache; das Netz darf im Hintergrund nachliefern. */
async function appFirst(e, req) {
  const cache = await caches.open(APP);
  const net = fetch(req).then((res) => {
    if (res.ok) cache.put(req, res.clone());
    return res;
  });
  e.waitUntil(net.catch(() => {}));
  const cached = async () => (await cache.match(req, { ignoreSearch: true })) ||
    (req.mode === 'navigate'
      ? (await cache.match('./', { ignoreSearch: true })) ||
        (await cache.match('index.html', { ignoreSearch: true }))
      : undefined);
  const timer = new Promise((ok) => setTimeout(ok, NET_WAIT_MS, 'timeout'));
  try {
    const first = await Promise.race([net, timer]);
    if (first !== 'timeout') return first;
    const hit = await cached();
    return hit || await net;           // nichts im Cache: doch aufs Netz warten
  } catch (err) {
    const hit = await cached();
    if (hit) return hit;
    throw err;
  }
}

async function cacheFirst(req, name) {
  const cache = await caches.open(name);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) cache.put(req, res.clone());
  return res;
}

/** Kachel: sofort aus dem Cache, im Hintergrund auffrischen. */
async function tile(e, req) {
  const cache = await caches.open(TILES);
  const hit = await cache.match(req);
  const net = fetch(req).then(async (res) => {
    // Nur CORS-Antworten: undurchsichtige zählen im Speicher ein Vielfaches.
    if (res.ok && res.type === 'cors') {
      await cache.put(req, res.clone());
      trim(cache);
    }
    return res;
  });
  if (hit) { e.waitUntil(net.catch(() => {})); return hit; }
  try {
    const res = await net;
    if (res.ok) return res;
    return (await coarser(cache, req.url)) || res;
  } catch (err) {
    const alt = await coarser(cache, req.url);
    if (alt) return alt;
    throw err;
  }
}

/** Ersatz aus einer gespeicherten Vorfahren-Kachel: Ausschnitt hochskaliert. */
async function coarser(cache, url) {
  const m = /\/(\d+)\/(\d+)\/(\d+)(\.png)/.exec(url);
  if (!m || typeof OffscreenCanvas === 'undefined') return null;
  const z = +m[1], x = +m[2], y = +m[3];
  for (let d = 1; d <= FALLBACK_UP && d <= z; d++) {
    const n = 1 << d, px = x >> d, py = y >> d;
    const up = new URL(url.replace(m[0], '/' + (z - d) + '/' + px + '/' + py + m[4]));
    let hit = null;
    // Leaflet verteilt die Kacheln auf a./b./c. — die gröbere kann unter jedem liegen.
    for (const h of ['a.', 'b.', 'c.', '']) {
      up.hostname = h + 'tile.openstreetmap.org';
      if ((hit = await cache.match(up.href))) break;
    }
    if (!hit) continue;
    try {
      const img = await createImageBitmap(await hit.blob());
      const size = img.width / n;
      const c = new OffscreenCanvas(256, 256);
      const g = c.getContext('2d');
      g.imageSmoothingEnabled = true;
      g.drawImage(img, (x - px * n) * size, (y - py * n) * size, size, size, 0, 0, 256, 256);
      const blob = await c.convertToBlob({ type: 'image/png' });
      return new Response(blob, { headers: { 'Content-Type': 'image/png' } });
    } catch (_) { return null; }
  }
  return null;
}

let trimming = false;
async function trim(cache) {
  if (trimming) return;
  trimming = true;
  try {
    const keys = await cache.keys();
    for (let k = 0; k < keys.length - TILE_MAX; k++) await cache.delete(keys[k]);
  } finally { trimming = false; }
}
