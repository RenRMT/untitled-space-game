'use strict';

// What the player knows about the galaxy (fog of war for the map):
// - explored sectors,
// - known systems and outposts (their pockets count as explored),
// - deep-space contacts, either pinged (something is there) or identified.
// It starts with every settled system charted (and the outposts in their pockets): where to trade
// and research is known; what lies between them is found by flying (sensors) and travelling on the
// map. Saved per galaxy (store.js).
// Browser script (global `Knowledge`).

const Knowledge = (() => {
  // Defaults for sense(); the ship's scanner sets the real ranges.
  const SENSOR_RANGE = 1; // sectors around the ship that get explored and identified
  const PING_RANGE = 2; // contacts within this many sectors show up as unidentified signals

  function create(galaxy, { fresh = false } = {}) {
    const { size } = galaxy;
    const idx = (x, y) => y * size + x;
    const inside = (x, y) => x >= 0 && y >= 0 && x < size && y < size;
    const explored = new Uint8Array(size * size);
    const systems = new Set();
    const outposts = new Set();
    const contacts = new Map(); // sector index -> 'ping' | 'known'
    const systemAt = new Map(galaxy.systems.map((s) => [idx(s.x, s.y), s]));
    const outpostAt = new Map(galaxy.outposts.map((o) => [idx(o.x, o.y), o]));
    const storeKey = `knowledge:${Galaxy.saveKey(galaxy)}`;
    let version = 0; // bumps on every change, so the map knows when to redraw
    let saveTimer = null;

    const changed = () => {
      version++;
      if (saveTimer) return;
      saveTimer = setTimeout(() => { saveTimer = null; save(); }, 1000);
    };

    function explore(x, y) {
      if (!inside(x, y) || explored[idx(x, y)]) return false;
      explored[idx(x, y)] = 1;
      return true;
    }
    // Every sector whose centre lies in a settlement's pocket.
    function explorePocket(px, py, r) {
      let any = false;
      for (let y = Math.floor(py - r); y <= Math.floor(py + r); y++) {
        for (let x = Math.floor(px - r); x <= Math.floor(px + r); x++) {
          if (Math.hypot(x + 0.5 - px, y + 0.5 - py) <= r || (x === Math.floor(px) && y === Math.floor(py))) any = explore(x, y) || any;
        }
      }
      return any;
    }

    function knowOutpost(o) {
      if (outposts.has(o.id)) return false;
      outposts.add(o.id);
      explorePocket(o.x + 0.5, o.y + 0.5, o.pocket);
      return true;
    }
    function knowSystem(s) {
      if (systems.has(s.id)) return false;
      systems.add(s.id);
      explorePocket(s.x + 0.5, s.y + 0.5, s.pocket);
      // Outposts inside the system's pocket come with it.
      for (const o of galaxy.outposts) if (Math.hypot(o.x - s.x, o.y - s.y) <= s.pocket) knowOutpost(o);
      return true;
    }
    // Arriving in a sector: everything in it is identified.
    function revealSector(x, y) {
      if (!inside(x, y)) return false;
      let any = explore(x, y);
      const s = systemAt.get(idx(x, y));
      if (s) any = knowSystem(s) || any;
      const o = outpostAt.get(idx(x, y));
      if (o) any = knowOutpost(o) || any;
      if (galaxy.deepSector(x, y) && contacts.get(idx(x, y)) !== 'known') { contacts.set(idx(x, y), 'known'); any = true; }
      return any;
    }
    // Something is out there: mark a contact as an unidentified signal.
    function ping(x, y) {
      if (!inside(x, y) || contacts.has(idx(x, y)) || !galaxy.deepSector(x, y)) return false;
      contacts.set(idx(x, y), 'ping');
      return true;
    }

    // Ship sensors at a position in fractional sector coordinates. The ranges come from the fitted
    // scanner (loadout.js); pings never reach less far than the sensors.
    function sense(fx, fy, sensorRange = SENSOR_RANGE, pingRange = PING_RANGE) {
      const sx = Math.floor(fx), sy = Math.floor(fy);
      const reach = Math.max(sensorRange, pingRange);
      let any = false;
      for (let y = sy - reach; y <= sy + reach; y++) {
        for (let x = sx - reach; x <= sx + reach; x++) {
          const near = Math.abs(x - sx) <= sensorRange && Math.abs(y - sy) <= sensorRange;
          any = (near ? revealSector(x, y) : ping(x, y)) || any;
        }
      }
      if (any) changed();
    }

    // Coarse long-range pass, as during map travel: the sector is explored, contacts only pinged.
    function pass(x, y) {
      let any = explore(x, y);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) any = ping(x + dx, y + dy) || any;
      if (any) changed();
    }

    // Storage unavailable: knowledge lasts for this session only (store.js).
    function save() {
      if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
      Store.setJSON(storeKey, {
        explored: Array.from(explored.reduce((acc, v, i) => (v && acc.push(i), acc), [])),
        systems: [...systems], outposts: [...outposts], contacts: [...contacts],
      });
    }
    function load() {
      const d = Store.getJSON(storeKey);
      if (!d) return false;
      try {
        for (const i of d.explored) explored[i] = 1;
        d.systems.forEach((v) => systems.add(v));
        d.outposts.forEach((v) => outposts.add(v));
        d.contacts.forEach(([k, v]) => contacts.set(k, v));
        return true;
      } catch (e) {
        return false;
      }
    }

    // Starting charts: every settled system, with the outposts in its pocket.
    function chartStart() {
      for (const s of galaxy.systems) knowSystem(s);
      changed();
    }

    if (fresh) Store.remove(storeKey);
    if (fresh || !load()) chartStart();

    return {
      get version() { return version; },
      sense, pass, save,
      // Public versions record the change (version bump and save), like sense() and pass() do.
      revealSector: (x, y) => { const any = revealSector(x, y); if (any) changed(); return any; },
      isExplored: (x, y) => inside(x, y) && explored[idx(x, y)] === 1,
      knowsSystem: (id) => systems.has(id),
      knowsOutpost: (id) => outposts.has(id),
      contactState: (x, y) => (inside(x, y) ? contacts.get(idx(x, y)) || null : null),
      // A faction is known once any of its systems or outposts is.
      knowsFaction: (fid) => galaxy.systems.some((s) => s.faction === fid && systems.has(s.id))
        || galaxy.outposts.some((o) => o.faction === fid && outposts.has(o.id)),
      counts: () => ({ systems: systems.size, outposts: outposts.size }),
    };
  }

  return { create, SENSOR_RANGE, PING_RANGE };
})();
