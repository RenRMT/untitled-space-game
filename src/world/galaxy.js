// The play area: several solar systems (world/solar-system.js) far apart in one open space, joined by
// jump gates. Galaxy.generate places each system, generates it there with a gate toward each
// system it links to, and gathers everything into one object that reads like a single system:
// the flight view (flight/scene.js, game/), map travel (flight/travel.js) and fog of war (rules/knowledge.js) work
// on all of it at once in world units, and the map (ui/map.js) shows one system at a time or the
// galaxy.
// - systems[i]: each system as SolarSystem.generate made it, already in place, plus `index`,
// - stars, planets, moons, ...: every system's together. Ids are indices into these lists (a
//   station's planet, a moon's parent, a contact's pack) and keys are unique across systems (the
//   first system's keep their own; later ones get an `i.` prefix), so saves and lookups need no
//   system. Each thing also says which system it belongs to (`system`),
// - gates: { ..., system, link, to } with link the id of the gate at the other end,
// - systemAt(x, y): the system a point is in (within its radius), or null in deep space;
//   nearestSystem(x, y): the one whose edge is closest,
// - securityAt, nebulaAt, regionAt, stationDist as for one system; deep space is lawless and
//   empty.
// The first system is generated from the seed itself, so it is the system the seed always gave
// (apart from its gate). ES module (`Galaxy`); also runs in Node (the tests).

import { hashInt, mulberry32, seedToInt } from '../core/rng.js';
import { SolarSystem } from './solar-system.js';

const Galaxy = (() => {
  const SS = SolarSystem;

  // Bump whenever a change here moves systems or gates for the same seed.
  const VERSION = 2;

  const DEFAULTS = {
    // Space between the systems' edges: about five minutes' flight at the Courier's top speed
    // (650 units/s, rules/loadout.js).
    gap: 195000,
    // Each system's generator settings (SolarSystem.params), merged over the config's own params.
    // The first is the tutorial: a small system with one planet, the main belt, one nebula, the
    // android waystation on one edge and the jump gate on the other, and nothing else: no other
    // stations, no derelicts, no pirates (the opening missions bring their own), high security
    // throughout (medium in the nebula). The second is half the usual size: fewer, closer planets,
    // smaller nebulae, fewer stations and derelicts, and security falling off over shorter
    // distances.
    systems: [
      {
        radius: 22000,
        planets: { count: [1, 1], first: [5200, 6000], gap: [3800, 4800] },
        belts: { outer: 0, width: [1400, 1900] },
        fields: { count: [0, 0] },
        nebulae: { count: [1, 1], r: [3500, 4500] },
        stations: { capital: false, major: false, minor: [0, 0], miningCamps: [0, 0], yard: false },
        security: { high: 1e9, medium: 2e9, low: 3e9 },
        pirates: { density: 0, lawlessAmbushes: [0, 0], nebulaAmbushes: false },
        derelicts: { count: [0, 0] },
      },
      {
        radius: 24000,
        planets: { count: [3, 5], first: [2600, 3300], gap: [1900, 2800] },
        belts: { width: [1100, 1600], clump: 2000 },
        fields: { count: [1, 2], spread: [800, 1200] },
        nebulae: { count: [0, 1], r: [2800, 4000] },
        stations: { minor: [1, 2], miningCamps: [1, 1] },
        security: { high: 5000, medium: 10000, low: 16000 },
        pirates: { cell: 9000, lawlessAmbushes: [0, 1] },
        derelicts: { count: [3, 5], spacing: 4000 },
      },
    ],
    links: [[0, 1]], // jump gate pairs, by system index
    // The android-run waystation the game starts at, on the first system's outer edge, across the
    // system from its gate.
    waystation: { system: 0, name: 'Waystation HD-1863', opposite: true },
  };

  // A copy of `base` with `over` merged in: plain objects merge, everything else replaces.
  function merge(base, over) {
    if (!over) return base;
    const out = { ...base };
    for (const [k, v] of Object.entries(over)) {
      const b = base[k];
      out[k] = v && typeof v === 'object' && !Array.isArray(v) && b && typeof b === 'object' && !Array.isArray(b) ? merge(b, v) : v;
    }
    return out;
  }

  // config: { params (for every system), galaxy: { gap, systems, links } overriding DEFAULTS }
  function generate(seed, config = {}) {
    const G = { ...DEFAULTS, ...config.galaxy };
    const base = seedToInt(seed);
    const r = mulberry32(hashInt(base, 0, 0x6a1a));
    const params = G.systems.map((p) => merge(merge(SS.params, config.params), p));

    // Where each system's star is: the first at (0, 0), each next one `gap` beyond the edges of
    // the one before it, in a random direction.
    const origins = [{ x: 0, y: 0 }];
    for (let i = 1; i < params.length; i++) {
      const prev = origins[i - 1], a = r() * Math.PI * 2;
      const d = params[i - 1].radius + G.gap + params[i].radius;
      origins.push({ x: prev.x + Math.cos(a) * d, y: prev.y + Math.sin(a) * d });
    }
    const gatesOf = (i) => G.links.flatMap(([a, b]) => (a === i ? [b] : b === i ? [a] : []))
      .map((to) => ({ to, angle: Math.atan2(origins[to].y - origins[i].y, origins[to].x - origins[i].x) }));
    const systems = params.map((p, i) => {
      const waystation = G.waystation && G.waystation.system === i ? { name: G.waystation.name, opposite: !!G.waystation.opposite } : null;
      const s = SS.generate(i === 0 ? seed : hashInt(base, i, 0x5e57), { params: p, origin: origins[i], gates: gatesOf(i), waystation });
      s.index = i;
      return s;
    });

    // Everything together, renumbered and rekeyed.
    const all = { stars: [], planets: [], moons: [], belts: [], fields: [], nebulae: [], stations: [], wrecks: [], contacts: [], packs: [], asteroids: [], gates: [], pockets: [] };
    for (const s of systems) {
      const pre = s.index === 0 ? '' : `${s.index}.`;
      const off = Object.fromEntries(Object.entries(all).map(([k, list]) => [k, list.length]));
      const tag = (o) => { o.system = s.index; return o; };
      tag(s.star);
      for (const p of s.planets) { p.id += off.planets; p.moons = p.moons.map((m) => m + off.moons); }
      for (const m of s.moons) { m.id += off.moons; m.parent += off.planets; }
      for (const st of s.stations) { st.id += off.stations; st.key = pre + st.key; if (st.planet !== undefined) st.planet += off.planets; }
      for (const c of s.contacts) { c.id = pre + c.id; if (c.pack !== undefined) c.pack += off.packs; }
      for (const k of s.packs) { k.id += off.packs; for (const sh of k.ships) sh.key = pre + sh.key; }
      for (const w of s.wrecks) { w.key = pre + w.key; if (w.contact) w.contact = pre + w.contact; }
      for (const a of s.asteroids) a.key = pre + a.key;
      for (const q of s.pockets) { q.key = pre + q.key; q.nebula += off.nebulae; }
      for (const g of s.gates) { g.id += off.gates; g.key = pre + g.key; }
      for (const f of s.fields) if (f.camp !== undefined) f.camp += off.stations;
      for (const [k, list] of Object.entries({ ...s, stars: [s.star] })) {
        if (!all[k]) continue;
        for (const o of list) all[k].push(tag(o));
      }
    }
    // Gate pairs: each gate knows the one at the other end, and is named for where it leads.
    for (const g of all.gates) {
      const there = all.gates.find((o) => o.system === g.to && o.to === g.system);
      g.link = there.id;
      g.name = `${systems[g.to].name} Gate`;
    }

    const inSystem = (s, x, y) => Math.hypot(x - s.origin.x, y - s.origin.y) <= s.radius;
    const systemAt = (x, y) => systems.find((s) => inSystem(s, x, y)) || null;
    const edgeDist = (s, x, y) => Math.hypot(x - s.origin.x, y - s.origin.y) - s.radius;
    const nearestSystem = (x, y) => systems.reduce((b, s) => (edgeDist(s, x, y) < edgeDist(b, x, y) ? s : b));

    return {
      seed, name: systems[0].name, cultures: SS.CULTURES, systems, links: G.links, ...all,
      startStation: 0, // the first system's first station: the waystation in the tutorial system
      waystation: all.stations.findIndex((st) => st.waystation), // its id, or -1 without one
      systemAt, nearestSystem,
      securityAt: (x, y) => { const s = systemAt(x, y); return s ? s.securityAt(x, y) : 0; },
      nebulaAt: (x, y) => { const s = systemAt(x, y); return s ? s.nebulaAt(x, y) : null; },
      stationDist: (x, y) => Math.min(...systems.map((s) => s.stationDist(x, y))),
      // As for one system, plus the system it's in (null in deep space).
      regionAt(x, y) {
        const s = systemAt(x, y);
        if (s) return { ...s.regionAt(x, y), system: s };
        const n = nearestSystem(x, y);
        return { security: 0, nebula: null, near: null, fromStar: Math.hypot(x - n.origin.x, y - n.origin.y), system: null };
      },
      cultureColor: (id) => (SS.CULTURES[id] || SS.CULTURES[0]).color,
    };
  }

  // localStorage key part identifying one generated galaxy: every system's own key, and this
  // module's version.
  const saveKey = (g) => `${g.systems.map(SS.saveKey).join('+')}:g${VERSION}`;

  return { generate, params: DEFAULTS, VERSION, saveKey };
})();

export { Galaxy };
