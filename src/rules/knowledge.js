// What the player knows about the galaxy (fog of war for the map and the minimap).
// - Systems (world/galaxy.js) are discovered by entering them; the start system is known from the
//   start. The galaxy map shows the discovered ones.
// - In a system, the star, planets, belts, nebulae, gates and every station are charted: where to
//   trade and research is known. The contacts (world/solar-system.js: hidden derelicts and ambushes)
//   are not: each is unknown, pinged (something is there, an unidentified signal) or identified.
// - sense(): the ship's sensors, a few times a second: contacts within sensor range of their
//   edge are identified, those within ping range pinged,
// - pass(): a coarse long-range pass, as during map travel: contacts in reach are only pinged.
// Saved per galaxy (core/store.js). ES module (`Knowledge`); also runs in Node (the tests).

import { Save } from '../core/save.js';
import { Store } from '../core/store.js';
import { Galaxy } from '../world/galaxy.js';

const Knowledge = (() => {
  // Defaults for sense(), in world units; the ship's scanner sets the real ranges (rules/loadout.js).
  const SENSOR_RANGE = 3000;
  const PING_RANGE = 7000;

  function create(galaxy, { fresh = false } = {}) {
    const states = new Map(); // contact id -> 'ping' | 'known'
    const visited = new Set([galaxy.stations[galaxy.startStation].system]); // system indices
    const byId = new Map(galaxy.contacts.map((c) => [c.id, c]));
    const storeKey = `knowledge:${Galaxy.saveKey(galaxy)}`;
    let version = 0; // bumps on every change, so the map knows when to redraw
    // Saved a second after a change (core/save.js); save() writes at once.
    // Storage unavailable: knowledge lasts for this session only (core/store.js).
    const saver = Save.debounced(() => Store.setJSON(storeKey, { contacts: [...states], systems: [...visited] }), 1000);
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
    // identified just now (for a notice).
    function sense(x, y, sensorRange = SENSOR_RANGE, pingRange = PING_RANGE) {
      const found = [];
      let any = false;
      for (const c of galaxy.contacts) {
        const d = gap(c, x, y);
        if (d <= sensorRange) { if (identify(c)) found.push(c); } else if (d <= Math.max(sensorRange, pingRange)) any = ping(c) || any;
      }
      if (any || found.length) changed();
      return found;
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
        return true;
      } catch (e) {
        return false;
      }
    }

    if (fresh) Store.remove(storeKey);
    else load();

    return {
      get version() { return version; },
      sense, pass, save,
      // Public versions record the change (version bump and save), like sense() and pass() do.
      contactState: (id) => states.get(id) || null,
      // A system entered: true the first time.
      visit: (i) => { if (visited.has(i)) return false; visited.add(i); changed(); return true; },
      visited: (i) => visited.has(i),
      counts: () => {
        let known = 0;
        for (const v of states.values()) if (v === 'known') known++;
        return { known, pinged: states.size - known, total: galaxy.contacts.length };
      },
    };
  }

  return { create, SENSOR_RANGE, PING_RANGE };
})();

export { Knowledge };
