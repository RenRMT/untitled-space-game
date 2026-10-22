// The play area. It is pared back to a single solar system (world/solar-system.js) for now, so the
// core gameplay can be worked on: a showcase holding one of each planet and moon type, one of each
// kind of station, one nebula, one asteroid field, a jump gate (Wedge-built) and a wormhole. The
// gate and the wormhole lead to each other. Galaxy.generate makes the system, gives each station
// the faction of the culture it's built in (world/factions.js), and gathers everything into one
// object that reads like a single system with a list of systems around it, as the flight view
// (flight/scene.js, game/), map travel (flight/travel.js), fog of war (rules/knowledge.js) and
// the map (ui/map.js) expect; the multi-system galaxy (regions, routes, politics) can come back
// on the same shape.
// - systems[i]: each system as SolarSystem.generate made it, already in place, plus `index` and
//   its politics: region { key, label }, holder (faction id or null), branch (null), factions
//   [{ id, hidden, stations }], situations ([]: no local situations yet), places (names jobs
//   could use),
// - links: [[i, j]] gate links between systems by index (i < j): none with one system,
// - stars, planets, moons, ...: every system's together. Ids are indices into these lists (a
//   station's planet, a moon's parent, a contact's pack) and keys are unique across systems (the
//   first system's keep their own; later ones get an `i.` prefix), so saves and lookups need no
//   system. Each thing also says which system it belongs to (`system`); stations their `owner`,
// - gates: { ..., system, link, to, wormhole? } with link the id of the gate (or wormhole) at the
//   other end,
// - systemAt(x, y): the system a point is in (within its radius), or null in deep space;
//   nearestSystem(x, y): the one whose edge is closest,
// - securityAt, nebulaAt, regionAt, stationDist as for one system; deep space is lawless and
//   empty.
// ES module (`Galaxy`); also runs in Node (the tests).

import { hashInt, mulberry32, seedToInt } from '../core/rng.js';
import { Factions } from './factions.js';
import { SolarSystem } from './solar-system.js';

const Galaxy = (() => {
  const SS = SolarSystem;

  // Bump whenever a change here moves systems or gates for the same seed.
  const VERSION = 4;

  const DEFAULTS = {
    // The system's params, over SolarSystem.params: one of each planet type (inner to outer) and
    // each moon type, no belts, one asteroid field and one nebula, and one of each station: the
    // capital, the major hub, a minor station, a mining camp (in the field) and a salvage yard,
    // with the waystation on the outer edge across from the gate; no pirates.
    system: {
      radius: 40000,
      kinds: { planets: ['lava', 'desert', 'terran', 'ice', 'gas', 'blue'], moons: ['grey', 'ice', 'rust', 'dark', 'sulfur'] },
      planets: { first: [4800, 5400], gap: [3400, 4000], growth: 1.08, edge: 0.9 },
      moons: { gas: [2, 2], blue: [1, 1], terran: [1, 1], ice: [1, 1], desert: [0, 0], lava: [0, 0] },
      belts: { main: false, outer: 0 },
      fields: { count: [1, 1], rocks: [70, 90], spread: [2000, 2400] },
      nebulae: { count: [1, 1], r: [4500, 6000] },
      stations: { capital: true, major: true, minor: [1, 1], miningCamps: [1, 1], yard: true },
      // No pirates: the game is about gathering under hazards now (notes/hazards.md), not fighting.
      pirates: { density: 0, lawlessAmbushes: [0, 0], nebulaAmbushes: false },
    },
    // The station cultures (SolarSystem.CULTURES ids) by station type; the waystation is android.
    cultures: { capital: 0, major: 1, minor: 2, 'mining camp': 1, 'salvage yard': SS.DRIFTER },
    // The jump gate, in this culture; the wormhole a quarter turn round from it.
    gate: { culture: 0 },
    // The android-run waystation the game starts at, on the outer edge across from the gate.
    waystation: { name: 'Waystation HD-1863' },
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

  // Who owns what: each station the faction of the culture it's built in.
  function settle(system, G) {
    const owned = new Map();
    for (const st of system.stations) {
      if (!st.waystation && G.cultures[st.market.type] !== undefined) st.culture = G.cultures[st.market.type];
      st.owner = Factions.ofCulture(SS.CULTURES[st.culture].lineage).id;
      owned.set(st.owner, (owned.get(st.owner) || 0) + 1);
    }
    const first = (type) => system.stations.find((st) => st.market.type === type);
    const places = {
      system: system.name, station: (first('capital') || system.stations[0] || {}).name, hub: (first('major') || {}).name,
      camp: (first('mining camp') || {}).name, yard: (first('salvage yard') || {}).name,
      waystation: (system.stations.find((st) => st.waystation) || {}).name, nebula: system.nebulae[0] && system.nebulae[0].name,
    };
    const factions = Factions.LIST.filter((f) => owned.has(f.id) || f.id === Factions.PIRATES)
      .map((f) => ({ id: f.id, hidden: f.hidden, stations: owned.get(f.id) || 0 }));
    Object.assign(system, { region: { key: 'home', label: 'Home system' }, holder: null, branch: null, factions, situations: [], places });
    return system;
  }

  // config: { params (over the system's), galaxy: overriding DEFAULTS }
  function generate(seed, config = {}) {
    const G = merge(DEFAULTS, config.galaxy);
    const base = seedToInt(seed);
    const r = mulberry32(hashInt(base, 0, 0x6a1a));
    const params = merge(merge(SS.params, G.system), config.params);

    // The gate in a direction from the seed, the wormhole a quarter turn on; each leads to the other.
    const a0 = r() * Math.PI * 2;
    const gates = [{ angle: a0, to: 0, culture: G.gate.culture }, { angle: a0 + Math.PI / 2, to: 0, wormhole: true }];
    const systems = [SS.generate(seed, { params, gates, waystation: { name: G.waystation.name, opposite: true } })];
    systems.forEach((s, i) => { s.index = i; settle(s, G); });
    const links = [];

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
    // Gate pairs: each gate knows the one at the other end.
    for (const g of all.gates) g.link = all.gates.find((o) => o !== g && o.system === g.to && o.to === g.system).id;

    const inSystem = (s, x, y) => Math.hypot(x - s.origin.x, y - s.origin.y) <= s.radius;
    const systemAt = (x, y) => systems.find((s) => inSystem(s, x, y)) || null;
    const edgeDist = (s, x, y) => Math.hypot(x - s.origin.x, y - s.origin.y) - s.radius;
    const nearestSystem = (x, y) => systems.reduce((b, s) => (edgeDist(s, x, y) < edgeDist(b, x, y) ? s : b));

    return {
      seed, name: systems[0].name, cultures: SS.CULTURES, systems, links, ...all,
      startStation: 0, // the first station: the capital
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
