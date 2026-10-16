'use strict';

// Seeded solar system generator: the whole play area is one system around a star. It produces
// plain data (no art), so the flight view (flight/scene.js), the system map (ui/map.js), map travel
// (flight/travel.js) and the tests all read the same layout:
// - a star at the centre, at (0, 0),
// - planets on orbits that widen outward: hot rocky worlds inside, temperate ones in the middle,
//   gas and ice giants outside; some with rings, giants with moons,
// - asteroid belts (a main belt between the inner and outer planets, often an outer one near the
//   edge) and a few free-floating asteroid fields, every rock placed here with a stable key,
// - nebulae in the outer system: clouds made of overlapping blobs. Inside one, security is a
//   level lower (except right by a station) and sensors reach half as far (game.js),
// - stations orbiting planets (a capital and a major station, both with shipyards, and minor
//   ones) and bases out in space (mining camps in a belt or field, a salvage yard among wrecks),
//   each built in one of three cultures (art only: how it looks and its colour, art/culture.js),
//   and, with overrides.waystation ({ name, opposite? }), an android-run waystation on the outer
//   edge (opposite: across the system from its first gate, and the nebulae kept clear of it),
// - security by distance to the nearest station, a level lower inside a nebula away from the
//   stations (world/security.js says what each level means),
// - pirates in packs by security, and ambushes lying in wait in nebulae and lawless space,
// - hidden shipwrecks (derelicts) away from the stations, found with the ship's sensors,
// - gas pockets in the nebulae: dense knots of gas to collect, like mining an asteroid,
// - jump gates (overrides.gates: [{ angle, to }]) out toward the systems they lead to (world/galaxy.js).
// Derelicts and ambushes are the system's contacts: what sensors ping and map travel runs into.
// Every part can be left out by its params (the galaxy's first system, the tutorial, is a star,
// one planet, a belt, a nebula, the waystation and a gate).
// Positions are world units: from the star, or from overrides.origin when given (where the star
// sits in a galaxy of several systems; the query functions take those positions). Every tuning value lives in SolarSystem.params; pass
// `overrides.params` to generate() to change any of them (nested objects merge, arrays and
// numbers replace).
// Works as a classic browser script (global `SolarSystem`) and as a Node module.

const SolarSystem = (() => {
  const isNode = typeof require === 'function' && typeof module !== 'undefined';
  const { hashInt, mulberry32, seedToInt, weightedPick } = isNode ? require('../core/rng.js') : globalThis;
  const Sec = isNode ? require('./security.js') : Security;
  const TAU = Math.PI * 2;

  // Bump whenever a change to the generator moves things around for the same seed and settings,
  // so saved charts and cargo from the old layout are not reused.
  const VERSION = 4;

  const DEFAULTS = {
    radius: 48000, // the system's edge, in world units from the star
    star: {
      classes: [['M', 4], ['K', 3], ['G', 3], ['A', 1], ['B', 1]],
      r: { M: [380, 440], K: [420, 480], G: [440, 510], A: [490, 550], B: [530, 600] },
    },
    // Orbits: the first at `first`, each next one `gap` further, gaps growing by `growth` per
    // orbit; nothing beyond `edge` of the radius. One orbit is the main belt's.
    planets: { count: [5, 7], first: [5200, 6400], gap: [3800, 5600], growth: 1.1, edge: 0.86 },
    moons: { gas: [1, 3], blue: [0, 2], terran: [0, 1], desert: [0, 1] }, // [min, max] by planet type
    // Belts: the main one takes the first orbit past `at` of the radius; an outer one (chance
    // `outer`) runs inside the edge. Rocks come in clumps every `clump` units along the belt, a
    // share `fill` of the clumps there.
    belts: { at: 0.3, width: [1800, 2600], outer: 0.55, clump: 2600, rocks: [6, 13], fill: { main: 0.85, outer: 0.4 } },
    fields: { count: [2, 4], rocks: [18, 32], spread: [1100, 1600] },
    nebulae: { count: [1, 3], r: [4500, 7500] },
    // capital, major, yard: whether the system has its capital, its major hub and a salvage yard.
    stations: { capital: true, major: true, minor: [2, 3], miningCamps: [1, 2], yard: true },
    // Security by distance (world units) to the nearest station: at most `high` away is high
    // security, then medium, then low; further than `low` is lawless. A nebula takes a level off,
    // except right by a station.
    security: { high: 8000, medium: 16000, low: 26000 },
    // Pirates: the system is split into cells this big, each rolling for packs as world/security.js
    // says for the security at its centre, scaled by `density`. Plus ambushes: one per nebula
    // and a few in lawless space.
    // nebulaAmbushes: whether every nebula hides an ambush.
    pirates: { cell: 13000, density: 0.5, lawlessAmbushes: [1, 2], nebulaAmbushes: true },
    derelicts: { count: [6, 9], spacing: 6000 },
    // Gas pockets per nebula (by its radius: `per` units of radius each, within count), at least
    // `spacing` apart and `clear` from the pirates lying in wait there; r: their size.
    gas: { count: [3, 7], per: 1100, spacing: 800, clear: 1500, r: [55, 100] },
  };

  // The cultures stations are built in (art/culture.js lineages), each with its colour on the map
  // and in space: the three settled (human) ones, the capital's first, and the androids, who run
  // only the waystation. Gates and wrecks are the settled cultures' (SETTLED).
  const CULTURES = [
    { id: 0, lineage: 'wedge', name: 'Wedge', color: '#5fa8ff' },
    { id: 1, lineage: 'block', name: 'Block', color: '#e0a030' },
    { id: 2, lineage: 'shard', name: 'Shard', color: '#3fbf6a' },
    { id: 3, lineage: 'android', name: 'Android', color: '#4fd8ff' },
  ];
  const SETTLED = 3;
  const ANDROID = 3;
  // Contacts, one row per type: its label on things in space, its name in notices and with an
  // article in the map's prompt, its colour on the map, and whether it attacks. Derelicts are
  // hidden wrecks with salvage; ambushes are a pirate pack lying in wait.
  const CONTACT_TYPES = {
    derelict: { label: 'Derelict', name: 'derelict', prompt: 'a derelict', color: '#9aa4b8' },
    ambush: { label: 'Ambush', name: 'ambush', prompt: 'an ambush', color: '#ff4d4d', hostile: true },
  };
  // Planet types by how far out their orbit is (a share of the radius).
  const PLANET_ZONES = [
    { upTo: 0.2, types: [['lava', 3], ['desert', 3], ['terran', 1]] },
    { upTo: 0.42, types: [['terran', 4], ['desert', 2], ['ice', 1]] },
    { upTo: Infinity, types: [['gas', 4], ['blue', 3], ['ice', 2]] },
  ];
  const PLANET_SIZE = { gas: [300, 420], blue: [240, 330], terran: [170, 230], desert: [160, 220], ice: [150, 210], lava: [140, 200] };
  const RING_CHANCE = { gas: 0.6, blue: 0.4 };
  // Moon and nebula types are art/bodies.js's (MOONS, NEBULAE); a nebula's colour on the map and
  // in the HUD is its type's line colour there.
  const MOON_TYPES = [['grey', 3], ['ice', 3], ['rust', 2], ['dark', 2], ['sulfur', 1]];
  const NEBULA_TYPES = [['emission', 3], ['reflection', 3], ['ion', 2], ['ember', 2], ['dust', 1]];
  const NEBULA_COLORS = { emission: '#ff6ab0', reflection: '#7ab8ff', ion: '#5affd0', ember: '#ffaa4a', dust: '#a08870' };
  const ASTEROIDS = {
    main: [['stony', 3], ['metal', 2], ['carbon', 1]],
    outer: [['ice', 3], ['carbon', 2], ['stony', 1]],
    field: [['carbon', 3], ['stony', 2], ['ice', 2], ['metal', 1]],
  };
  // Nominal station sizes for keeping things clear of them (the art decides the real size).
  const STATION_SIZE = { major: 260, minor: 140 };
  const GATE_SIZE = 320;
  const WAYSTATION_CLEAR = 6000; // no pirate packs this close to the waystation
  const SYLLABLES = ['ka', 'ri', 'to', 'ven', 'sol', 'mar', 'dra', 'li', 'on', 'tha', 'ce', 'rus',
    'vo', 'ix', 'al', 'nor', 'pe', 'zan', 'el', 'qua', 'bel', 'cor', 'dun', 'ae', 'syr', 'tal'];
  const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];

  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

  // Defaults with overrides merged in: plain objects merge, everything else replaces.
  function mergeParams(base, over) {
    if (!over) return base;
    const out = { ...base };
    for (const [k, v] of Object.entries(over)) {
      const b = base[k];
      out[k] = v && typeof v === 'object' && !Array.isArray(v) && b && typeof b === 'object' && !Array.isArray(b) ? mergeParams(b, v) : v;
    }
    return out;
  }

  function generate(seed, overrides = {}) {
    const P = mergeParams(DEFAULTS, overrides.params);
    const seedInt = seedToInt(seed);
    const R = P.radius;
    // Each feature draws from its own stream, so tuning one doesn't reshuffle the others.
    const stream = (salt, i = 0) => mulberry32(hashInt(seedInt, i, salt));
    const rnd = stream(0x5017);
    const between = (r, [lo, hi]) => lo + r() * (hi - lo);
    const count = (r, [lo, hi]) => lo + Math.floor(r() * (hi - lo + 1));
    const nextSeed = (r) => Math.floor(r() * 4294967295);
    const polar = (a, d) => ({ x: Math.cos(a) * d, y: Math.sin(a) * d });

    const usedNames = new Set();
    function makeName() {
      for (;;) {
        let s = '';
        for (let i = count(rnd, [2, 3]); i > 0; i--) s += SYLLABLES[Math.floor(rnd() * SYLLABLES.length)];
        s = s[0].toUpperCase() + s.slice(1);
        if (!usedNames.has(s) && s.length <= 9) { usedNames.add(s); return s; }
      }
    }
    const name = makeName();

    // ---------- Star ----------
    const cls = weightedPick(P.star.classes, rnd());
    const star = { name, cls, r: Math.round(between(rnd, P.star.r[cls])), seed: nextSeed(rnd) % 997, x: 0, y: 0 };
    star.reach = star.r * 3.2; // its glow: keep clear of this

    // ---------- Orbits, planets and moons ----------
    const rp = stream(0x91a7);
    const orbits = [];
    const nOrbits = count(rp, P.planets.count) + 1; // one is the main belt's
    for (let d = between(rp, P.planets.first), i = 0; orbits.length < nOrbits && d <= R * P.planets.edge; i++) {
      orbits.push(d);
      d += between(rp, P.planets.gap) * P.planets.growth ** i;
    }
    let beltOrbit = orbits.findIndex((d, i) => i > 0 && d >= R * P.belts.at);
    if (beltOrbit < 0) beltOrbit = orbits.length - 1;

    const planets = [];
    const moons = [];
    orbits.forEach((orbit, i) => {
      if (i === beltOrbit) return;
      const zone = PLANET_ZONES.find((z) => orbit / R <= z.upTo);
      const type = weightedPick(zone.types, rp());
      const r = Math.round(between(rp, PLANET_SIZE[type]));
      const ring = rp() < (RING_CHANCE[type] || 0.1);
      const angle = rp() * TAU;
      const p = {
        id: planets.length, name: `${name} ${ROMAN[planets.length]}`, type, r, ring, ringTilt: -0.35 + (rp() - 0.5) * 0.5,
        seed: nextSeed(rp) % 9973, orbit, angle, ...polar(angle, orbit), moons: [],
      };
      p.body = ring ? r * 1.95 : r * 1.1; // how far the planet itself reaches
      p.extent = p.body; // ... and with its moons
      const n = P.moons[type] ? count(rp, P.moons[type]) : 0;
      for (let k = 0; k < n; k++) {
        const mr = Math.round(between(rp, [55, 95]));
        const d = p.body + 300 + k * 280 + mr;
        const a = rp() * TAU;
        const m = {
          id: moons.length, parent: p.id, name: `${p.name} ${'abcd'[k]}`, type: weightedPick(MOON_TYPES, rp()), r: mr,
          ringTilt: 0, seed: nextSeed(rp) % 9973, orbit: d, x: p.x + Math.cos(a) * d, y: p.y + Math.sin(a) * d,
        };
        moons.push(m);
        p.moons.push(m.id);
        p.extent = Math.max(p.extent, d + mr);
      }
      planets.push(p);
    });

    // ---------- Belts ----------
    const rb = stream(0xbe17);
    const belts = [{ id: 0, kind: 'main', name: `${name} Belt`, r: orbits[beltOrbit], width: between(rb, P.belts.width) }];
    if (rb() < P.belts.outer) {
      const width = between(rb, P.belts.width);
      belts.push({ id: 1, kind: 'outer', name: 'Outer Belt', r: R - width / 2 - 1800, width });
    }
    const beltAt = (x, y, pad = 0) => belts.find((b) => Math.abs(Math.hypot(x, y) - b.r) < b.width / 2 + pad) || null;

    // ---------- Nebulae ----------
    // Where an `opposite` waystation will go (across from the first gate), for the nebulae to keep
    // clear of.
    const wayOpposite = overrides.waystation && overrides.waystation.opposite && overrides.gates && overrides.gates.length;
    const waySpot = wayOpposite ? polar(overrides.gates[0].angle + Math.PI, R * 0.9) : null;
    const rn = stream(0x7eb1);
    const nebulae = [];
    for (let i = 0, n = count(rn, P.nebulae.count), tries = 0; nebulae.length < n && tries < 200; tries++) {
      const r = between(rn, P.nebulae.r);
      const lo = R * 0.4 + r, hi = R * 0.95 - r;
      if (hi <= lo) continue;
      const at = polar(rn() * TAU, between(rn, [lo, hi]));
      if (nebulae.some((o) => dist(o, at) < o.r + r + 2500)) continue;
      if (waySpot && dist(waySpot, at) < r + 8000) continue; // leave room for the waystation
      // Overlapping blobs, all inside r of the centre: one big core and a few around it.
      const blobs = [{ dx: 0, dy: 0, r: r * between(rn, [0.55, 0.68]) }];
      for (let k = count(rn, [4, 7]); k > 0; k--) {
        const br = r * between(rn, [0.3, 0.5]), a = rn() * TAU, d = between(rn, [0.25, 1]) * (r - br);
        blobs.push({ dx: Math.cos(a) * d, dy: Math.sin(a) * d, r: br });
      }
      const type = weightedPick(NEBULA_TYPES, rn());
      nebulae.push({ id: i++, name: `${makeName()} Nebula`, ...at, r, blobs, type, color: NEBULA_COLORS[type], seed: nextSeed(rn) });
    }
    function nebulaAt(x, y) {
      for (const n of nebulae) {
        if (Math.hypot(x - n.x, y - n.y) > n.r) continue;
        if (n.blobs.some((b) => Math.hypot(x - n.x - b.dx, y - n.y - b.dy) < b.r * 0.95)) return n;
      }
      return null;
    }

    // ---------- Stations around planets ----------
    const rs = stream(0x57a7);
    const stations = [];
    const addStation = (o) => {
      const s = { id: stations.length, key: `st${stations.length}`, seed: nextSeed(rs), culture: 0, ...o };
      s.reach = STATION_SIZE[s.size];
      stations.push(s);
      return s;
    };
    // A spot beside a planet, clear of its rings and moons.
    function besidePlanet(p, size) {
      const d = p.body + STATION_SIZE[size] + 240, a0 = rs() * TAU;
      let at = null;
      for (let i = 0; i < 24; i++) {
        at = { x: p.x + Math.cos(a0 + i * 0.6) * d, y: p.y + Math.sin(a0 + i * 0.6) * d };
        if (p.moons.every((id) => dist(moons[id], at) > moons[id].r + STATION_SIZE[size] + 220)) break;
      }
      return at;
    }
    const free = new Set(planets.map((p) => p.id));
    const take = (p) => { free.delete(p.id); return p; };
    const temperate = planets.filter((p) => p.orbit / R > PLANET_ZONES[0].upTo && p.orbit / R <= PLANET_ZONES[1].upTo);
    const nearest = (list, d) => [...list].sort((a, b) => Math.abs(a.orbit - d) - Math.abs(b.orbit - d))[0];
    if (P.stations.capital) {
      const capitalAt = take(temperate.find((p) => p.type === 'terran') || nearest(temperate.length ? temperate : planets, R * 0.3));
      addStation({ name: `${makeName()} Station`, size: 'major', planet: capitalAt.id, ...besidePlanet(capitalAt, 'major'), market: { kind: 'system', type: 'capital' } });
    }
    const giants = planets.filter((p) => free.has(p.id) && (p.type === 'gas' || p.type === 'blue') && p.orbit < R * 0.7);
    const majorAt = giants.length ? giants[0] : planets.filter((p) => free.has(p.id)).sort((a, b) => a.orbit - b.orbit)[0];
    if (P.stations.major && majorAt) addStation({ name: `${makeName()} Hub`, size: 'major', planet: take(majorAt).id, ...besidePlanet(majorAt, 'major'), market: { kind: 'system', type: 'major' } });
    const rest = planets.filter((p) => free.has(p.id));
    for (let i = rest.length - 1; i > 0; i--) { const j = Math.floor(rs() * (i + 1)); [rest[i], rest[j]] = [rest[j], rest[i]]; }
    for (const p of rest.slice(0, count(rs, P.stations.minor))) {
      addStation({ name: `${makeName()} ${rs() < 0.5 ? 'Port' : 'Station'}`, size: 'minor', planet: take(p).id, ...besidePlanet(p, 'minor'), market: { kind: 'system', type: 'minor' } });
    }

    // What things must keep clear of: the star's glow, each planet with its moons, each station
    // and gate.
    let gates = [];
    const blockers = () => [
      { x: 0, y: 0, r: star.reach },
      ...planets.map((p) => ({ x: p.x, y: p.y, r: p.extent })),
      ...stations.map((s) => ({ x: s.x, y: s.y, r: s.reach })),
      ...gates.map((g) => ({ x: g.x, y: g.y, r: g.reach })),
    ];
    const clear = (at, pad, list = blockers()) => list.every((b) => dist(b, at) >= b.r + pad);

    // ---------- Jump gates: in the outer system, toward the system each leads to ----------
    const rg = stream(0x6a7e);
    gates = (overrides.gates || []).map((g, i) => {
      let at = null;
      for (let tries = 0; tries < 80 && !at; tries++) {
        const c = polar(g.angle + (tries ? (rg() - 0.5) * Math.min(1.6, tries * 0.06) : 0), R * between(rg, [0.74, 0.84]));
        if (clear(c, 2500) && !nebulaAt(c.x, c.y) && !beltAt(c.x, c.y, 1200)) at = c;
      }
      at = at || polar(g.angle, R * 0.8);
      return { id: i, key: `g${i}`, name: `${name} Gate`, to: g.to, ...at, seed: nextSeed(rg), culture: Math.floor(rg() * SETTLED), reach: GATE_SIZE };
    });

    // ---------- Asteroid fields ----------
    const rf = stream(0xf1e1);
    const fields = [];
    for (let n = count(rf, P.fields.count), tries = 0; fields.length < n && tries < 300; tries++) {
      const spread = between(rf, P.fields.spread);
      const at = polar(rf() * TAU, between(rf, [R * 0.3, R * 0.9 - spread]));
      if (!clear(at, spread + 1500) || beltAt(at.x, at.y, spread + 800) || fields.some((f) => dist(f, at) < f.spread + spread + 4000)) continue;
      fields.push({ id: fields.length, name: `${makeName()} Field`, ...at, spread, rocks: count(rf, P.fields.rocks) });
    }

    // ---------- Bases: mining camps in a belt or field, a salvage yard among wrecks ----------
    const campSites = [belts[0], ...(belts[1] ? [belts[1]] : []), ...fields];
    for (let i = 0, n = count(rs, P.stations.miningCamps); i < n && i < campSites.length; i++) {
      const site = campSites[i];
      let at = null;
      for (let tries = 0; tries < 60 && !at; tries++) {
        const c = site.spread ? { x: site.x, y: site.y } : polar(rs() * TAU, site.r);
        if (clear(c, 2500) && !nebulaAt(c.x, c.y)) at = c;
      }
      if (!at) continue;
      const camp = addStation({ name: `${makeName()} Camp`, size: 'minor', ...at, market: { kind: 'outpost', type: 'mining camp' } });
      if (site.spread) site.camp = camp.id;
    }
    let yard = null;
    for (let tries = 0; P.stations.yard && tries < 200 && !yard; tries++) {
      const at = polar(rs() * TAU, between(rs, [R * 0.45, R * 0.8]));
      if (!clear(at, 3500) || nebulaAt(at.x, at.y) || beltAt(at.x, at.y, 1500) || stations.some((s) => dist(s, at) < 6000)) continue;
      yard = addStation({ name: `${makeName()} Yard`, size: 'minor', ...at, market: { kind: 'outpost', type: 'salvage yard' } });
    }
    // Cultures: the capital's is the first; the others take turns, so all three are present.
    const order = [1, 2, 0];
    stations.slice(1).forEach((s, i) => { s.culture = order[(i + Math.floor(rs() * 2)) % 3]; });
    if (stations.length > 2 && !stations.some((s) => s.culture === 1)) stations[1].culture = 1;
    if (stations.length > 2 && !stations.some((s) => s.culture === 2)) stations[2].culture = 2;

    // ---------- The waystation: android-run, alone on the outer edge ----------
    // From its own stream, so the rest of the system stays as it was. Clear of everything else,
    // well away from the nebulae (and the ambushes in them), the belts, the gates and the other
    // stations.
    if (overrides.waystation) {
      const rw = stream(0x3a75);
      let at = null;
      for (let tries = 0; tries < 300 && !at; tries++) {
        // Opposite: near the far side from the first gate, straying further the longer it looks.
        const a = wayOpposite ? Math.atan2(gates[0].y, gates[0].x) + Math.PI + (rw() - 0.5) * Math.min(Math.PI, 0.3 + tries * 0.02) : rw() * TAU;
        const c = polar(a, R * between(rw, [0.88, 0.93]));
        if (clear(c, 3000) && nebulae.every((n) => dist(n, c) > n.r + 6000) && !beltAt(c.x, c.y, 2000) && stations.every((o) => dist(o, c) > 7000) && gates.every((g) => dist(g, c) > 7000)) at = c;
      }
      at = at || (waySpot ? { ...waySpot } : polar(rw() * TAU, R * 0.9));
      addStation({ name: overrides.waystation.name, size: 'minor', ...at, culture: ANDROID, waystation: true, market: { kind: 'outpost', type: 'waystation' } });
    }

    // ---------- Security: distance to the nearest station, lower in a nebula ----------

    const SEC = P.security;
    const stationDist = (x, y) => stations.reduce((m, s) => Math.min(m, Math.hypot(x - s.x, y - s.y)), Infinity);
    function securityAt(x, y) {
      const d = stationDist(x, y);
      const level = d <= SEC.high ? 3 : d <= SEC.medium ? 2 : d <= SEC.low ? 1 : 0;
      return level < 3 && nebulaAt(x, y) ? Math.max(0, level - 1) : level;

    }

    // ---------- Wrecks, contacts and pirates ----------
    const rw = stream(0x3ec4);
    const wrecks = [];
    const contacts = [];
    const packs = [];
    const randomCulture = (r) => Math.floor(r() * SETTLED);
    // spoils: floating things around it (flight/scene.js picks them); cargo: 'trade' for a freighter's
    // goods, else by what the wreck was.
    const addWreck = (type, culture, x, y, extra = {}) => {
      const w = { key: `w${wrecks.length}`, type, culture, seed: nextSeed(rw), x, y, angle: rw() * TAU, tumble: (rw() - 0.5) * 0.04, spoils: 1 + Math.floor(rw() * 3), contact: null, ...extra };
      wrecks.push(w);
      return w;
    };
    const addContact = (type, x, y, r, extra = {}) => {
      const c = { id: `c${contacts.length}`, type, x, y, r, hostile: !!CONTACT_TYPES[type].hostile, ...extra };
      contacts.push(c);
      return c;
    };
    if (yard) {
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * TAU + rw() * 1.2, d = between(rw, [380, 800]);
        addWreck(rw() < 0.75 ? 'wreck-ship' : 'wreck-station', randomCulture(rw), yard.x + Math.cos(a) * d, yard.y + Math.sin(a) * d);
      }
    }

    // Pack layout (world/security.js PACK): members circle the centre; centres keep `spacing` apart,
    // `clear` from stations and the star (docking stays safe) and inside the edge.
    const { spacing, orbit: [o0, o1], clear: packClear, margin } = Sec.PACK;
    const rk = stream(0x9ac5);
    const packBlock = blockers();
    const packFits = (at) => Math.hypot(at.x, at.y) <= R - margin - o1
      && clear(at, packClear + o1, packBlock.filter((b, i) => i === 0 || i > planets.length))
      && planets.every((p) => dist(p, at) >= p.extent + 400 + o1)
      && packs.every((k) => dist(k, at) >= spacing)
      && stations.every((st) => !st.waystation || dist(st, at) >= WAYSTATION_CLEAR + o1); // its safe zone
    let shipCount = 0;
    const addPack = (at, size, tier, ambush) => {
      const k = { id: packs.length, x: at.x, y: at.y, tier, ambush, level: securityAt(at.x, at.y), ships: [] };
      for (let i = 0; i < size; i++) {
        const orbit = o0 + rk() * (o1 - o0);
        k.ships.push({ key: `s${shipCount++}`, orbit, speed: (rk() < 0.5 ? -1 : 1) * (160 + rk() * (ambush ? 60 : 30)), a0: rk() * TAU, seed: nextSeed(rk) });
      }
      packs.push(k);
      return k;
    };
    // An ambush: one pack, as big as the biggest at its security or one larger, around the wreck
    // of the ship it caught, with that ship's cargo floating about.
    const addAmbush = (at) => {
      const S = Sec.pirates(securityAt(at.x, at.y));
      const size = Math.max(...S.size.map(([s]) => s)) + Math.floor(rk() * 2);
      const k = addPack(at, size, Sec.pick(rk, S.tier), true);
      const c = addContact('ambush', at.x, at.y, o1 + 400, { pack: k.id });
      addWreck('wreck-ship', randomCulture(rw), at.x, at.y, { spoils: 2 + Math.floor(rw() * 2), cargo: 'trade', contact: c.id });
    };
    const inside = (n) => {
      const b = n.blobs[Math.floor(rk() * n.blobs.length)], a = rk() * TAU, d = Math.sqrt(rk()) * b.r * 0.7;
      return { x: n.x + b.dx + Math.cos(a) * d, y: n.y + b.dy + Math.sin(a) * d };
    };
    for (const n of P.pirates.nebulaAmbushes ? nebulae : []) {
      for (let tries = 0; tries < 60; tries++) {
        const at = inside(n);
        if (nebulaAt(at.x, at.y) && packFits(at)) { addAmbush(at); break; }
      }
    }
    for (let n = count(rk, P.pirates.lawlessAmbushes), tries = 0; n > 0 && tries < 200; tries++) {
      const at = polar(rk() * TAU, Math.sqrt(rk()) * R);
      if (securityAt(at.x, at.y) === 0 && !nebulaAt(at.x, at.y) && packFits(at)) { addAmbush(at); n--; }
    }
    // Packs, cell by cell: whether a cell has any and how many by the security at its centre;
    // each pack's size and gear by the security where it is.
    const cell = P.pirates.cell;
    for (let cy = -R; cy < R; cy += cell) {
      for (let cx = -R; cx < R; cx += cell) {
        const mid = { x: cx + cell / 2, y: cy + cell / 2 };
        if (Math.hypot(mid.x, mid.y) > R) continue;
        const S = Sec.pirates(securityAt(mid.x, mid.y));
        if (rk() >= S.chance * P.pirates.density) continue;
        for (let i = 0, n = count(rk, S.packs); i < n; i++) {
          let at = null;
          for (let tries = 0; tries < 40 && !at; tries++) {
            const c = { x: cx + rk() * cell, y: cy + rk() * cell };
            if (packFits(c)) at = c;
          }
          if (!at) break;
          const here = Sec.pirates(securityAt(at.x, at.y));
          addPack(at, Sec.pick(rk, here.size), Sec.pick(rk, here.tier), false);
        }
      }
    }

    // Derelicts: hidden away from the stations, in nebulae, along the belts or anywhere outside
    // high security; a station wreck, or a few ship wrecks together.
    const rd = stream(0xde7e);
    const derelictSpot = () => {
      const how = rd();
      if (how < 0.35 && nebulae.length) return inside(nebulae[Math.floor(rd() * nebulae.length)]);
      if (how < 0.6) { const b = belts[Math.floor(rd() * belts.length)]; return polar(rd() * TAU, b.r + (rd() - 0.5) * b.width); }
      return polar(rd() * TAU, between(rd, [R * 0.2, R * 0.95]));
    };
    for (let n = count(rd, P.derelicts.count), tries = 0; n > 0 && tries < 400; tries++) {
      const at = derelictSpot();
      if (Math.hypot(at.x, at.y) > R - 1500 || securityAt(at.x, at.y) >= 3 || !clear(at, 1200)
        || stations.some((s) => dist(s, at) < 4000) || contacts.some((c) => dist(c, at) < P.derelicts.spacing)) continue;
      const c = addContact('derelict', at.x, at.y, 700);
      const culture = randomCulture(rd);
      if (rd() < 0.4) addWreck('wreck-station', culture, at.x, at.y, { contact: c.id, name: CONTACT_TYPES.derelict.label });
      else {
        for (let i = 0, k = 2 + Math.floor(rd() * 2); i < k; i++) {
          const a = rd() * TAU, d = i ? between(rd, [150, 450]) : 0;
          addWreck('wreck-ship', culture, at.x + Math.cos(a) * d, at.y + Math.sin(a) * d, { contact: c.id, ...(i ? {} : { name: CONTACT_TYPES.derelict.label }) });
        }
      }
      n--;
    }

    // ---------- Asteroids ----------
    // Every rock: { key, x, y, type, r, seed, spin0, tumble }. None inside a planet's reach or
    // under a station.
    const asteroids = [];
    const rockBlock = blockers().slice(1);
    function rock(r, x, y, types) {
      const at = { x, y };
      if (rockBlock.some((b) => dist(b, at) < b.r + 120)) return;
      asteroids.push({
        key: `a${asteroids.length}`, x, y, type: weightedPick(types, r()), r: 8 + r() ** 2.2 * 44,
        seed: Math.floor(r() * 4294967295), spin0: r() * TAU, tumble: (r() - 0.5) * 0.5,
      });
    }
    function cluster(r, cx, cy, n, spread, types) {
      for (let i = 0; i < n; i++) {
        const a = r() * TAU, d = spread * Math.sqrt(r());
        rock(r, cx + Math.cos(a) * d, cy + Math.sin(a) * d, types);
      }
    }
    for (const b of belts) {
      const r = stream(0xa57e, b.id), clumps = Math.floor((TAU * b.r) / P.belts.clump);
      for (let i = 0; i < clumps; i++) {
        if (r() >= P.belts.fill[b.kind]) continue;
        const a = ((i + r() * 0.6) / clumps) * TAU;
        for (let k = count(r, P.belts.rocks); k > 0; k--) {
          const aa = a + ((r() - 0.5) * P.belts.clump * 0.8) / b.r, d = b.r + (r() + r() - 1) * (b.width / 2);
          rock(r, Math.cos(aa) * d, Math.sin(aa) * d, ASTEROIDS[b.kind]);
        }
      }
    }
    fields.forEach((f, i) => cluster(stream(0xf1e2, i), f.x, f.y, f.rocks, f.spread, ASTEROIDS.field));
    // A mining camp sits in a thicker clump of the rock it lives on.
    for (const s of stations) {
      if (s.market.type !== 'mining camp') continue;
      const b = beltAt(s.x, s.y, 200);
      cluster(stream(0xca4b, s.id), s.x, s.y, 25 + Math.floor(rs() * 16), 1500, b ? ASTEROIDS[b.kind] : ASTEROIDS.field);
    }

    // ---------- Gas pockets: knots of dense gas inside the nebulae ----------
    // From their own stream, after everything else, so adding them moved nothing. Each lies inside
    // one of its nebula's blobs, clear of the ambush pack waiting there.
    const pockets = [];
    nebulae.forEach((n) => {
      const r = stream(0x6a55, n.id), G = P.gas;
      const want = Math.max(G.count[0], Math.min(G.count[1], Math.round(n.r / G.per)));
      for (let made = 0, tries = 0; made < want && tries < 300; tries++) {
        const b = n.blobs[Math.floor(r() * n.blobs.length)], a = r() * TAU, d = Math.sqrt(r()) * b.r * 0.75;
        const at = { x: n.x + b.dx + Math.cos(a) * d, y: n.y + b.dy + Math.sin(a) * d };
        if (nebulaAt(at.x, at.y) !== n || packs.some((k) => dist(k, at) < G.clear) || pockets.some((q) => dist(q, at) < G.spacing)) continue;
        pockets.push({ key: `gp${pockets.length}`, nebula: n.id, type: n.type, x: at.x, y: at.y, r: Math.round(between(r, G.r)), seed: nextSeed(r) });
        made++;
      }
    });

    // ---------- Into place: everything moves with the star to the origin ----------
    // Generation above is around (0, 0); the query functions below and the ones above
    // (securityAt, nebulaAt, stationDist) take positions from here on.
    const O = { x: 0, y: 0, ...overrides.origin };
    for (const o of [star, ...planets, ...moons, ...fields, ...nebulae, ...stations, ...wrecks, ...contacts, ...packs, ...asteroids, ...gates, ...pockets]) {
      o.x += O.x;
      o.y += O.y;
    }
    for (const b of belts) Object.assign(b, { cx: O.x, cy: O.y }); // belts circle the star

    // Where a point is: its security, the nebula it's in, and what it's near (a body, belt or
    // field), for the HUD and the map.
    function regionAt(x, y) {
      const at = { x, y };
      let body = null, bodyD = Infinity; // the nearest planet or moon, by its edge
      for (const list of [planets, moons]) for (const p of list) {
        const d = dist(p, at) - (p.extent || p.r);
        if (d < bodyD) { body = p; bodyD = d; }
      }
      const near = bodyD < 3000 ? body
        : beltAt(x - O.x, y - O.y, 500) || fields.find((f) => dist(f, at) < f.spread + 500) || null;
      return { security: securityAt(x, y), nebula: nebulaAt(x, y), near, fromStar: Math.hypot(x - O.x, y - O.y) };
    }

    return {
      seed, name, radius: R, origin: O, cultures: CULTURES, star, planets, moons, belts, fields, nebulae,
      stations, wrecks, contacts, packs, asteroids, gates, pockets, startStation: 0,
      securityAt, nebulaAt, regionAt, stationDist,
      cultureColor: (id) => (CULTURES[id] || CULTURES[0]).color,
    };
  }

  // localStorage key part identifying one generated system: the same seed with other generator
  // settings or another generator version is another system.
  const saveKey = (s) => `${s.seed}:${s.radius}:${s.planets.length}:${s.stations.length}:${s.asteroids.length}:v${VERSION}`;

  return { generate, params: DEFAULTS, VERSION, saveKey, CONTACT_TYPES, CULTURES, SETTLED, ANDROID };
})();

if (typeof module !== 'undefined') module.exports = SolarSystem;
