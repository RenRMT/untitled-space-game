'use strict';

// What the player knows about the system (fog of war for the map and the minimap). The star,
// planets, belts, nebulae and every station are charted from the start: where to trade and
// research is known. The contacts (solar-system.js: hidden derelicts and ambushes) are not:
// each is unknown, pinged (something is there, an unidentified signal) or identified.
// - sense(): the ship's sensors, a few times a second: contacts within sensor range of their
//   edge are identified, those within ping range pinged,
// - pass(): a coarse long-range pass, as during map travel: contacts in reach are only pinged.
// Saved per system (store.js). Browser script (global `Knowledge`).

const Knowledge = (() => {
  // Defaults for sense(), in world units; the ship's scanner sets the real ranges (loadout.js).
  const SENSOR_RANGE = 3000;
  const PING_RANGE = 7000;

  function create(system, { fresh = false } = {}) {
    const states = new Map(); // contact id -> 'ping' | 'known'
    const byId = new Map(system.contacts.map((c) => [c.id, c]));
    const storeKey = `knowledge:${SolarSystem.saveKey(system)}`;
    let version = 0; // bumps on every change, so the map knows when to redraw
    let saveTimer = null;

    const changed = () => {
      version++;
      if (saveTimer) return;
      saveTimer = setTimeout(() => { saveTimer = null; save(); }, 1000);
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
      for (const c of system.contacts) {
        const d = gap(c, x, y);
        if (d <= sensorRange) { if (identify(c)) found.push(c); } else if (d <= Math.max(sensorRange, pingRange)) any = ping(c) || any;
      }
      if (any || found.length) changed();
      return found;
    }

    // A coarse pass: contacts within `range` of (x, y) are pinged, nothing identified.
    function pass(x, y, range = PING_RANGE) {
      let any = false;
      for (const c of system.contacts) if (gap(c, x, y) <= range) any = ping(c) || any;
      if (any) changed();
    }

    // Storage unavailable: knowledge lasts for this session only (store.js).
    function save() {
      if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
      Store.setJSON(storeKey, { contacts: [...states] });
    }
    function load() {
      const d = Store.getJSON(storeKey);
      try {
        for (const [id, v] of d.contacts) if (byId.has(id) && (v === 'ping' || v === 'known')) states.set(id, v);
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
      reveal: (id) => { const c = byId.get(id); const any = !!c && identify(c); if (any) changed(); return any; },
      contactState: (id) => states.get(id) || null,
      counts: () => {
        let known = 0;
        for (const v of states.values()) if (v === 'known') known++;
        return { known, pinged: states.size - known, total: system.contacts.length };
      },
    };
  }

  return { create, SENSOR_RANGE, PING_RANGE };
})();
