// The race's service worker (registered by race/index.html; its scope is /race/): keeps a copy of
// every file the race loads, so the installed race (race/manifest.webmanifest) starts offline.
// - Install: fetches the whole list (FILES, written by `npm run race:sw`, tools/race-sw.js) past
//   the browser's cache, so a new version is cached whole.
// - Fetch: network first, so an online player always gets the files as served (never a mix of old
//   and new modules); the copy when the network fails, or is slower than SLOW ms and a copy is kept.
//   What it fetches it keeps. Only the race's own files: anything else goes to the network as usual.
// - Activate: drops copies of files no longer on the list, and takes over open pages at once.
// The list changes only when a file is added to or removed from the race; editing this file is what
// makes browsers install it again, so the list being in it is what updates the copies.

const CACHE = 'exo-drift', SLOW = 4000;
// precache:start
const FILES = [
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
  '../assets/race-icon-180.png',
  '../assets/race-icon-192.png',
  '../assets/race-icon-512.png',
  '../assets/race-icon.svg',
  '../src/art/androids.js',
  '../src/art/blueprints.js',
  '../src/art/bodies.js',
  '../src/art/crew.js',
  '../src/art/culture.js',
  '../src/art/icons.js',
  '../src/art/items.js',
  '../src/art/portraits.js',
  '../src/art/render.js',
  '../src/art/sprite-cache.js',
  '../src/art/surface-globe.js',
  '../src/art/surface.js',
  '../src/art/util.js',
  '../src/core/display.js',
  '../src/core/feedback.js',
  '../src/core/format.js',
  '../src/core/math.js',
  '../src/core/rng.js',
  '../src/core/save.js',
  '../src/core/store.js',
  '../src/flight/collide.js',
  '../src/flight/flight.js',
  '../src/race/career.js',
  '../src/race/config.js',
  '../src/race/contact.js',
  '../src/race/draw.js',
  '../src/race/dust.js',
  '../src/race/handling.js',
  '../src/race/input.js',
  '../src/race/line.js',
  '../src/race/main.js',
  '../src/race/menu.css',
  '../src/race/menu.js',
  '../src/race/pickups.js',
  '../src/race/pilot.js',
  '../src/race/rival.js',
  '../src/race/run.js',
  '../src/race/storm.js',
  '../src/race/track.js',
  '../src/race/view.js',
  '../src/rules/abilities.js',
  '../src/rules/goods.js',
  '../src/rules/lab.js',
  '../src/rules/loadout.js',
  '../src/rules/logic.js',
  '../src/rules/mods.js',
  '../src/rules/squad.js',
  '../src/ui/kit-lowpoly.css',
  '../src/ui/kit.css',
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
  // The page under any query (?biome=, ?seed=, ...) is the one page, kept as the scope.
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
