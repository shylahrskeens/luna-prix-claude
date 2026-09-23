/* Luna Prix service worker.
 *
 * Its only jobs are to make the game installable as an app and to let it start
 * without a network once it has been opened. It is deliberately dull:
 *   - the page itself is fetched from the network first, so a new build is
 *     picked up immediately and a judge never sees a stale game;
 *   - the hashed bundles are immutable, so they are served from the cache;
 *   - everything else falls through to the network. That includes the Vite
 *     dev server's /src and /node_modules modules and the Axie Mixer content
 *     pack under /assets/axie/, none of which may be cached here: v1 cached
 *     every same-origin GET and served five-day-old source in development.
 */
const CACHE = 'luna-prix-v2';
/** Vite's build output: /assets/<name>-<8 hex>.<ext>. The Axie pack lives at
 *  /assets/axie/ and never matches (no hash segment). */
const HASHED = /\/assets\/(?!axie\/)[^/]+-[A-Za-z0-9_-]{8}\.[a-z0-9]+$/;
const SHELL = ['./', './index.html', './manifest.webmanifest', './icons/icon-192.png'];

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => undefined));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;   // fonts and anything else: straight to the network

  const isPage = req.mode === 'navigate';
  if (isPage) {
    e.respondWith(
      fetch(req)
        .then((res) => { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); return res; })
        .catch(() => caches.match(req).then((hit) => hit || caches.match('./index.html'))),
    );
    return;
  }
  if (!HASHED.test(url.pathname)) return;   // dev modules, the Axie pack, everything else: network
  e.respondWith(
    caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    })),
  );
});
