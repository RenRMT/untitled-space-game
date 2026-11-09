// Redshift's service worker (registered by sim/index.html; its scope is /sim/): keeps a copy of every
// file the sim loads, so the installed game (sim/manifest.webmanifest) starts offline.
// - Install: fetches the whole list (FILES, written by `npm run sim:sw`, tools/app-sw.js) past
//   the browser's cache, so a new version is cached whole.
// - Fetch: network first, so an online player always gets the files as served (never a mix of old
//   and new modules); the copy when the network fails, or is slower than SLOW ms and a copy is kept.
//   What it fetches it keeps. Only the sim's own files: anything else goes to the network as usual.
// - Activate: drops copies of files no longer on the list, and takes over open pages at once.
// The list changes only when a file is added to or removed from the sim; editing this file is what
// makes browsers install it again, so the list being in it is what updates the copies.

const CACHE = 'redshift', SLOW = 4000;
// precache:start
const FILES = [
  '../assets/fonts/b612-latin-400-normal.woff2',
  '../assets/fonts/b612-latin-700-normal.woff2',
  '../assets/fonts/b612-mono-latin-400-normal.woff2',
  '../assets/fonts/b612-mono-latin-700-normal.woff2',
  '../assets/fonts/barlow-semi-condensed-latin-400-normal.woff2',
  '../assets/fonts/barlow-semi-condensed-latin-500-normal.woff2',
  '../assets/fonts/barlow-semi-condensed-latin-600-normal.woff2',
  '../assets/fonts/barlow-semi-condensed-latin-700-normal.woff2',
  '../assets/fonts/chakra-petch-latin-500-normal.woff2',
  '../assets/fonts/chakra-petch-latin-600-normal.woff2',
  '../assets/fonts/chakra-petch-latin-700-normal.woff2',
  '../assets/fonts/ibm-plex-mono-latin-400-normal.woff2',
  '../assets/fonts/ibm-plex-mono-latin-500-normal.woff2',
  '../assets/fonts/ibm-plex-mono-latin-600-normal.woff2',
  '../assets/fonts/martian-mono-latin-wght-normal.woff2',
  '../assets/sim-icon-180.png',
  '../assets/sim-icon-192.png',
  '../assets/sim-icon-512.png',
  '../assets/sim-icon.svg',
  '../src/art/androids.js',
  '../src/art/blueprints.js',
  '../src/art/bodies.js',
  '../src/art/crew.js',
  '../src/art/culture.js',
  '../src/art/equipment.js',
  '../src/art/icons.js',
  '../src/art/items.js',
  '../src/art/portraits.js',
  '../src/art/render.js',
  '../src/art/sites.js',
  '../src/art/sprite-cache.js',
  '../src/art/station-roles.js',
  '../src/art/surface.js',
  '../src/art/turrets.js',
  '../src/art/util.js',
  '../src/core/display.js',
  '../src/core/feedback.js',
  '../src/core/math.js',
  '../src/core/rng.js',
  '../src/core/save.js',
  '../src/core/store.js',
  '../src/core/theme.js',
  '../src/rules/goods.js',
  '../src/sim/config.js',
  '../src/sim/events.js',
  '../src/sim/faces.js',
  '../src/sim/main.js',
  '../src/sim/map.js',
  '../src/sim/people.js',
  '../src/sim/rules.js',
  '../src/sim/save.js',
  '../src/sim/screens.js',
  '../src/sim/sheets.js',
  '../src/sim/sim.css',
  '../src/sim/story.js',
  '../src/sim/world.js',
  '../src/ui/glyphs.js',
  '../src/ui/kit-line.css',
  '../src/ui/kit-lowpoly.css',
  '../src/ui/kit.css',
  '../src/ui/kit.js',
  '../src/ui/ui.js',
  './',
  'manifest.webmanifest',
];
// precache:end
const SCOPE = new URL('./', self.location).href;
const URLS = new Set(FILES.map((f) => new URL(f, SCOPE).href));

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll([...URLS].map((u) => new Request(u, { cache: 'reload' })));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    for (const req of await cache.keys()) if (!URLS.has(req.url)) await cache.delete(req);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  // The page under any query (?seed=, ?fresh, ...) is the one page, kept as the scope.
  const key = req.mode === 'navigate' && req.url.startsWith(SCOPE) ? SCOPE : req.url.split('#')[0];
  if (!URLS.has(key)) return;
  e.respondWith(networkFirst(req, key));
});

async function networkFirst(req, key) {
  const cache = await caches.open(CACHE);
  const kept = await cache.match(key);
  const net = fetch(req).then((res) => {
    if (res.ok && !res.redirected) { // a redirect can't answer a page load
      const copy = res.clone();
      cache.put(key, copy).catch(() => {}); // storage full: still served
    }
    return res;
  });
  if (!kept) return net;
  const slow = new Promise((resolve) => setTimeout(() => resolve(kept), SLOW));
  return Promise.race([net.catch(() => kept), slow]);
}
