// The main game's service worker (registered by index.html; its scope is the site's root): keeps a
// copy of every file the game loads, so the installed game (manifest.webmanifest) starts offline.
// - Install: fetches the whole list (FILES, written by `npm run sw`, tools/app-sw.js) past the
//   browser's cache, so a new version is cached whole.
// - Fetch: network first, so an online player always gets the files as served (never a mix of old
//   and new modules); the copy when the network fails, or is slower than SLOW ms and a copy is kept.
//   What it fetches it keeps. Only the game's own files and its own page: the race, the idle game
//   and Redshift live under this scope too (race/, idle/, sim/), each with a worker of its own, and
//   their pages are never answered from here.
// - Activate: drops copies of files no longer on the list, and takes over open pages at once.
// The list changes only when a file is added to or removed from the game; editing this file is what
// makes browsers install it again, so the list being in it is what updates the copies.

const CACHE = 'space-game', SLOW = 4000;
// precache:start
const FILES = [
  './',
  'assets/fonts/b612-latin-400-normal.woff2',
  'assets/fonts/b612-latin-700-normal.woff2',
  'assets/fonts/b612-mono-latin-400-normal.woff2',
  'assets/fonts/b612-mono-latin-700-normal.woff2',
  'assets/fonts/barlow-semi-condensed-latin-400-normal.woff2',
  'assets/fonts/barlow-semi-condensed-latin-500-normal.woff2',
  'assets/fonts/barlow-semi-condensed-latin-600-normal.woff2',
  'assets/fonts/barlow-semi-condensed-latin-700-normal.woff2',
  'assets/fonts/chakra-petch-latin-500-normal.woff2',
  'assets/fonts/chakra-petch-latin-600-normal.woff2',
  'assets/fonts/chakra-petch-latin-700-normal.woff2',
  'assets/fonts/ibm-plex-mono-latin-400-normal.woff2',
  'assets/fonts/ibm-plex-mono-latin-500-normal.woff2',
  'assets/fonts/ibm-plex-mono-latin-600-normal.woff2',
  'assets/fonts/martian-mono-latin-wght-normal.woff2',
  'assets/icon-180.png',
  'assets/icon-192.png',
  'assets/icon-512.png',
  'assets/icon.svg',
  'manifest.webmanifest',
  'src/art/androids.js',
  'src/art/blueprints.js',
  'src/art/bodies.js',
  'src/art/crew.js',
  'src/art/culture.js',
  'src/art/equipment.js',
  'src/art/icons.js',
  'src/art/items.js',
  'src/art/portraits.js',
  'src/art/render.js',
  'src/art/sites.js',
  'src/art/sprite-cache.js',
  'src/art/station-roles.js',
  'src/art/surface-globe.js',
  'src/art/surface.js',
  'src/art/turrets.js',
  'src/art/util.js',
  'src/combat/combat-core.js',
  'src/combat/combat-realtime.js',
  'src/combat/combat.js',
  'src/core/clock.js',
  'src/core/display.js',
  'src/core/feedback.js',
  'src/core/format.js',
  'src/core/math.js',
  'src/core/rng.js',
  'src/core/save.js',
  'src/core/sound.js',
  'src/core/store.js',
  'src/core/theme.js',
  'src/flight/collide.js',
  'src/flight/deep-sites.js',
  'src/flight/entities.js',
  'src/flight/flight.js',
  'src/flight/interactions.js',
  'src/flight/scene.js',
  'src/flight/travel.js',
  'src/game/cargo-migrations.js',
  'src/game/cargo.js',
  'src/game/collisions.js',
  'src/game/combat.js',
  'src/game/docking.js',
  'src/game/draw-world.js',
  'src/game/dungeon.js',
  'src/game/field.js',
  'src/game/hud.js',
  'src/game/input.js',
  'src/game/jobs.js',
  'src/game/landing.js',
  'src/game/loop.js',
  'src/game/mining.js',
  'src/game/missions.js',
  'src/game/options.js',
  'src/game/outfitting.js',
  'src/game/progress.js',
  'src/game/quickfit.js',
  'src/game/rewards.js',
  'src/game/screen-fx.js',
  'src/game/selection.js',
  'src/game/sites.js',
  'src/game/squad.js',
  'src/game/starfield.js',
  'src/game/state.js',
  'src/game/structures.js',
  'src/game/surface-run.js',
  'src/game/surface-squad.js',
  'src/game/tips.js',
  'src/game/traffic.js',
  'src/game/travel.js',
  'src/game/update.js',
  'src/game/upgrades.js',
  'src/game/vendor.js',
  'src/game/warp.js',
  'src/game/world.js',
  'src/main.js',
  'src/rules/abilities.js',
  'src/rules/classes.js',
  'src/rules/economy.js',
  'src/rules/goods.js',
  'src/rules/hazards.js',
  'src/rules/hullmods.js',
  'src/rules/industry.js',
  'src/rules/knowledge.js',
  'src/rules/lab.js',
  'src/rules/loadout.js',
  'src/rules/logic.js',
  'src/rules/logistics.js',
  'src/rules/loot.js',
  'src/rules/mining.js',
  'src/rules/mods.js',
  'src/rules/progress.js',
  'src/rules/recipes.js',
  'src/rules/reputation.js',
  'src/rules/research.js',
  'src/rules/screen-fx.js',
  'src/rules/squad.js',
  'src/rules/structures.js',
  'src/rules/survey.js',
  'src/rules/vendor.js',
  'src/story/job-texts.js',
  'src/story/jobs.js',
  'src/story/missions.js',
  'src/ui/callout.js',
  'src/ui/combat-panel.js',
  'src/ui/comms.js',
  'src/ui/context.js',
  'src/ui/factions.js',
  'src/ui/field-bar.js',
  'src/ui/game.css',
  'src/ui/glyphs.js',
  'src/ui/kit-line.css',
  'src/ui/kit-lowpoly.css',
  'src/ui/kit.css',
  'src/ui/kit.js',
  'src/ui/map.js',
  'src/ui/messages.js',
  'src/ui/settings.js',
  'src/ui/station.js',
  'src/ui/ui.js',
  'src/world/deep-space.js',
  'src/world/factions.js',
  'src/world/galaxy-shape.js',
  'src/world/galaxy.js',
  'src/world/orbits.js',
  'src/world/security.js',
  'src/world/solar-system.js',
  'src/world/system-config.js',
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
  // The page under any query (?seed=, ?fresh, ...) is the one page, kept as the scope. Only the
  // root's own page: a page in a folder below is another game's.
  const bare = req.url.split(/[?#]/)[0];
  const page = req.mode === 'navigate' && (bare === SCOPE || bare === `${SCOPE}index.html`);
  const key = page ? SCOPE : req.url.split('#')[0];
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
