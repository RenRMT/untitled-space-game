// What the player knows about the galaxy (fog of war for the map and the minimap).
// - Systems (world/galaxy.js) are discovered by entering them; the start system is known from the
//   start. The galaxy map shows the discovered ones.
// - In a system, the star, planets, belts, nebulae, gates and every station are charted: where to
//   trade and research is known. The contacts (world/solar-system.js: hidden derelicts and ambushes)
//   are not: each is unknown, pinged (something is there, an unidentified signal) or identified.
// - sense(): the ship's sensors, a few times a second: contacts within sensor range of their
//   edge are identified, those within ping range pinged,
// - pass(): a coarse long-range pass, as during map travel: contacts in reach are only pinged.
// - Deep-space sites (world/deep-space.js): the luminous ones are charted from the start; the dark
//   ones (rogue planets, brown dwarfs, quiet black holes...) are found like contacts but from much
//   further off (SITE, scaled by the scanner's ranges): sense() identifies or pings them, and
//   passSites() pings them along a cruise.
// Saved per galaxy (core/store.js). ES module (`Knowledge`); also runs in Node (the tests).

import { Save } from '../core/save.js';
import { Store } from '../core/store.js';
import { DeepSpace } from '../world/deep-space.js';
import { Galaxy } from '../world/galaxy.js';

const Knowledge = (() => {
  // Defaults for sense(), in world units; the ship's scanner sets the real ranges (rules/loadout.js).
  const SENSOR_RANGE = 3000;
  const PING_RANGE = 7000;
  // How far beyond a dark site's reach the default sensors identify it, and ping it.
  const SITE = { sense: 15000, ping: 60000 };

  function create(galaxy, { fresh = false } = {}) {
    const states = new Map(); // contact id -> 'ping' | 'known'
    const visited = new Set([galaxy.stations[galaxy.startStation].system]); // system indices
    const byId = new Map(galaxy.contacts.map((c) => [c.id, c]));
    const dark = (galaxy.sites || []).filter((s) => !s.visible);
    const siteStates = new Map(); // dark site id -> 'ping' | 'known'
    const storeKey = `knowledge:${Galaxy.saveKey(galaxy)}`;
    let version = 0; // bumps on every change, so the map knows when to redraw
    // Saved a second after a change (core/save.js); save() writes at once.
    // Storage unavailable: knowledge lasts for this session only (core/store.js).
    const saver = Save.debounced(() => Store.setJSON(storeKey, { contacts: [...states], systems: [...visited], sites: [...siteStates] }), 1000);
    const save = saver.now;

    const changed = () => {
      version++;
      saver.change();
    };
    const gap = (c, x, y) => Math.hypot(c.x - x, c.y - y) - c.r;

    function identify(c) {
      if (states.get(c.id) === 'known') return false;
      states.set(c.id, 'known');
      return true;
    }
    function ping(c) {
      if (states.has(c.id)) return false;
      states.set(c.id, 'ping');
      return true;
    }

    // Ship sensors at (x, y). Pings never reach less far than the sensors. Returns the contacts
    // identified just now (for a notice), with the dark sites identified just now as its `sites`.
    function sense(x, y, sensorRange = SENSOR_RANGE, pingRange = PING_RANGE) {
      const found = [];
      let any = false;
      for (const c of galaxy.contacts) {
        const d = gap(c, x, y);
        if (d <= sensorRange) { if (identify(c)) found.push(c); } else if (d <= Math.max(sensorRange, pingRange)) any = ping(c) || any;
      }
      const k = Math.max(1, sensorRange / SENSOR_RANGE);
      const near = sites(x, y, SITE.sense * k, SITE.ping * Math.max(k, pingRange / PING_RANGE));
      if (any || found.length || near.length) changed();
      Object.defineProperty(found, 'sites', { value: near.filter(Boolean) }); // dark sites identified just now
      return found;
    }

    // Dark sites near (x, y): identified within `senseAt` of their reach, pinged within `pingAt`.
    // Returns those identified just now. Moving ones are where they are on the real clock.
    function sites(x, y, senseAt, pingAt) {
      const found = [], now = Date.now() / 1000;
      for (const s of dark) {
        const p = s.path ? DeepSpace.positionAt(s, now) : s;
        const d = Math.hypot(p.x - x, p.y - y) - s.r, was = siteStates.get(s.id);
        if (d <= senseAt && was !== 'known') { siteStates.set(s.id, 'known'); found.push(s); } else if (d <= pingAt && !was) { siteStates.set(s.id, 'ping'); found.push(null); }
      }
      return found;
    }
    // Along a cruise (flight/travel.js): dark sites in ping range are pinged.
    function passSites(x, y, k = 1) {
      if (sites(x, y, -Infinity, SITE.ping * k).length) changed();
    }

    // A coarse pass: contacts within `range` of (x, y) are pinged, nothing identified.
    function pass(x, y, range = PING_RANGE) {
      let any = false;
      for (const c of galaxy.contacts) if (gap(c, x, y) <= range) any = ping(c) || any;
      if (any) changed();
    }

    function load() {
      const d = Store.getJSON(storeKey);
      try {
        for (const [id, v] of d.contacts) if (byId.has(id) && (v === 'ping' || v === 'known')) states.set(id, v);
        for (const i of d.systems || []) if (galaxy.systems[i]) visited.add(i);
        for (const [id, v] of d.sites || []) if (dark.some((x) => x.id === id) && (v === 'ping' || v === 'known')) siteStates.set(id, v);
        return true;
      } catch (e) {
        return false;
      }
    }

    if (fresh) Store.remove(storeKey);
    else load();

    return {
      get version() { return version; },
      sense, pass, passSites, save,
      // A deep-space site: 'known' (luminous ones always), 'ping' or null.
      siteState: (s) => (s.visible ? 'known' : siteStates.get(s.id) || null),
      // Public versions record the change (version bump and save), like sense() and pass() do.
      contactState: (id) => states.get(id) || null,
      // A system entered: true the first time.
      visit: (i) => { if (visited.has(i)) return false; visited.add(i); changed(); return true; },
      visited: (i) => visited.has(i),
      counts: () => {
        let known = 0;
        for (const v of states.values()) if (v === 'known') known++;
        let sitesKnown = 0;
        for (const v of siteStates.values()) if (v === 'known') sitesKnown++;
        return { known, pinged: states.size - known, total: galaxy.contacts.length, sites: { known: sitesKnown, pinged: siteStates.size - sitesKnown, total: dark.length } };
      },
    };
  }

  return { create, SENSOR_RANGE, PING_RANGE, SITE };
})();

export { Knowledge };
