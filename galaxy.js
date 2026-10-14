'use strict';

// Seeded galaxy generator. Produces a square grid of sectors with:
// - settled space following a noise field that thins toward the frontier, leaving irregular voids,
// - settled systems: a capital in the centre sector (where the player starts), larger systems with
//   several stations and smaller ones, each built in one of three cultures (art only: how its
//   stations look and their colour; see art/culture.js),
// - outposts (mining camps and salvage yards) scattered through settled and deep space,
// - known space as small charted pockets around each system and outpost; everything between them
//   is uncharted,
// - security per sector from the distance to the nearest settled system (security.js says what
//   it means: pirates and loot),
// - deep-space encounters recreated on demand from the seed and sector coordinates.
// Every tuning value lives in Galaxy.params; pass `overrides.params` to generate() to change any of
// them for one galaxy (nested objects merge, arrays and numbers replace).
// Works as a classic browser script (global `Galaxy`) and as a Node module.

const Galaxy = (() => {
  const { hashInt, mulberry32, seedToInt, weightedPick } = typeof require === 'function' ? require('./rng.js') : globalThis;

  // Bump whenever a change to the generator (or to sector contents) moves things around for the
  // same seed and settings, so saved charts and cargo from the old layout are not reused.
  const VERSION = 2;

  const DEFAULTS = {
    size: 80,
    sectorUnits: 16000, // world units per sector side
    frontier: 7, // width of the outer frontier ring, in sectors
    // Settlement density: two octaves of value noise plus a pull toward the centre.
    density: { cell1: 14, cell2: 6, noise1: 0.6, noise2: 0.25, radial: 0.55, cutoff: 0.5 },
    systems: { count: [120, 150], spacing: 2, major: 0.35 }, // major: share of systems that are large
    outposts: { count: [150, 250], spacing: 0 }, // spacing: minimum distance to any other settlement
    // Safe, charted pocket radius around each settlement, in sectors.
    pockets: { capital: 1.5, major: 1, minor: 0.6, outpost: 0.4 },
    // Security by distance (in sectors) from the nearest settled system: at most `high` away is
    // high security, then medium, then low; further than `low` is lawless.
    security: { high: 1.5, medium: 3.5, low: 6 },
    encounterChance: { deep: 0.07, frontier: 0.18 },
  };

  // The three cultures settled systems are built in (art/culture.js lineages), each with its
  // colour on the map and in space. The capital's is the first.
  const CULTURES = [
    { id: 0, lineage: 'wedge', name: 'Wedge', color: '#5fa8ff' },
    { id: 1, lineage: 'block', name: 'Block', color: '#e0a030' },
    { id: 2, lineage: 'shard', name: 'Shard', color: '#3fbf6a' },
  ];
  // Outposts: mining camps sit in an asteroid field, salvage yards among wrecks (sector.js).
  const OUTPOST_TYPES = ['mining camp', 'salvage yard'];
  // Deep-space contacts, one row per type: its label on things in space, its name in notices and
  // with an article in the map's prompt, its colour on the map, whether it attacks, and how often
  // it turns up in each zone outside the pockets (weights). Derelicts hold salvage; ambushes are a
  // pirate pack lying in wait.
  const CONTACT_TYPES = {
    derelict: { label: 'Derelict', name: 'derelict', prompt: 'a derelict', color: '#9aa4b8', weight: { deep: 4, frontier: 2 } },
    ambush: { label: 'Ambush', name: 'ambush', prompt: 'an ambush', color: '#ff4d4d', hostile: true, weight: { deep: 2, frontier: 4 } },
  };
  const ENCOUNTERS = {}; // zone -> [[type, weight]], for weightedPick
  for (const [type, t] of Object.entries(CONTACT_TYPES)) {
    for (const [zone, w] of Object.entries(t.weight || {})) (ENCOUNTERS[zone] ||= []).push([type, w]);
  }
  const isHostile = (type) => !!CONTACT_TYPES[type].hostile;
  const SYLLABLES = ['ka', 'ri', 'to', 'ven', 'sol', 'mar', 'dra', 'li', 'on', 'tha', 'ce', 'rus',
    'vo', 'ix', 'al', 'nor', 'pe', 'zan', 'el', 'qua', 'bel', 'cor', 'dun', 'ae', 'syr', 'tal'];
  const LOCATION_TYPES = ['station', 'planet', 'outpost'];

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
    const rnd = mulberry32(seedInt);
    const randInt = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));
    const shuffle = (arr) => {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(rnd() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      return arr;
    };
    const { size, frontier: F } = P;
    const C = Math.floor(size / 2);
    const N = size * size;
    const idx = (x, y) => y * size + x;
    const inner = (x, y) => x >= F && y >= F && x <= size - 1 - F && y <= size - 1 - F;
    const centre = { x: C, y: C };
    const settledRadius = size / 2 - F;

    // ---------- Density field ----------
    function noise(x, y, cell, salt) {
      const gx = x / cell;
      const gy = y / cell;
      const ix = Math.floor(gx);
      const iy = Math.floor(gy);
      const smooth = (t) => t * t * (3 - 2 * t);
      const fx = smooth(gx - ix);
      const fy = smooth(gy - iy);
      const v = (i, j) => hashInt(i, j, (seedInt ^ salt) >>> 0) / 4294967296;
      const top = v(ix, iy) + (v(ix + 1, iy) - v(ix, iy)) * fx;
      const bottom = v(ix, iy + 1) + (v(ix + 1, iy + 1) - v(ix, iy + 1)) * fx;
      return top + (bottom - top) * fy;
    }
    const D = P.density;
    const maxDensity = D.noise1 + D.noise2 + D.radial;
    const settle = new Float32Array(N);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (!inner(x, y)) continue;
        const r = Math.min(1, Math.hypot(x - C, y - C) / settledRadius);
        const d = D.noise1 * noise(x, y, D.cell1, 0x51ed) + D.noise2 * noise(x, y, D.cell2, 0xa3c5) + D.radial * (1 - r);
        settle[idx(x, y)] = Math.max(0, (d - D.cutoff) / (maxDensity - D.cutoff));
      }
    }

    // ---------- Names ----------
    const usedNames = new Set();
    function makeName() {
      for (;;) {
        let s = '';
        for (let i = randInt(2, 3); i > 0; i--) s += SYLLABLES[Math.floor(rnd() * SYLLABLES.length)];
        s = s[0].toUpperCase() + s.slice(1);
        if (!usedNames.has(s) && s.length <= 9) { usedNames.add(s); return s; }
      }
    }

    // ---------- Systems ----------
    const systems = [];
    const addSystem = (x, y, extra = {}) => {
      const s = { id: systems.length, name: '', x, y, capital: false, major: false, culture: 0, locations: [], ...extra };
      systems.push(s);
      return s;
    };
    const tooClose = (x, y, min) => systems.some((s) => dist(s, { x, y }) < min);

    addSystem(C, C, { capital: true, major: true }); // the capital, where the player starts
    const innerSectors = [];
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (inner(x, y)) innerSectors.push({ x, y });
    const order = shuffle([...innerSectors]);
    const systemTarget = randInt(...P.systems.count);
    for (let pass = 0; pass < 12 && systems.length < systemTarget; pass++) {
      for (const { x, y } of order) {
        if (systems.length >= systemTarget) break;
        const p = settle[idx(x, y)] ** 1.5 * 0.12 * (1 + pass);
        if (rnd() < p && !tooClose(x, y, P.systems.spacing)) addSystem(x, y, { major: rnd() < P.systems.major });
      }
    }

    // Cultures by region: the capital's culture in the middle, the other two on opposite sides,
    // each system taking the culture of the nearest of three anchors.
    const a0 = rnd() * Math.PI * 2, reach = settledRadius * 0.6;
    const anchors = [centre, ...[0, 1].map((i) => ({ x: C + Math.cos(a0 + i * Math.PI) * reach, y: C + Math.sin(a0 + i * Math.PI) * reach }))];
    const cultureAt = (x, y) => anchors.reduce((best, a, i) => (dist(a, { x, y }) < dist(anchors[best], { x, y }) ? i : best), 0);
    for (const s of systems) s.culture = cultureAt(s.x, s.y);

    // ---------- Outposts: single settlements, thinning out into deep space ----------
    const occupied = new Set(systems.map((s) => idx(s.x, s.y)));
    const outposts = [];
    const outpostTarget = randInt(...P.outposts.count);
    const allSectors = shuffle(Array.from({ length: N }, (_, i) => ({ x: i % size, y: Math.floor(i / size) })));
    for (let pass = 0; pass < 10 && outposts.length < outpostTarget; pass++) {
      for (const { x, y } of allSectors) {
        if (outposts.length >= outpostTarget) break;
        if (occupied.has(idx(x, y))) continue;
        const p = (inner(x, y) ? 0.004 + 0.03 * settle[idx(x, y)] : 0.0015) * (1 + pass);
        if (rnd() >= p) continue;
        if (P.outposts.spacing && (tooClose(x, y, P.outposts.spacing) || outposts.some((o) => dist(o, { x, y }) < P.outposts.spacing))) continue;
        outposts.push({ id: outposts.length, x, y, type: OUTPOST_TYPES[Math.floor(rnd() * OUTPOST_TYPES.length)], culture: cultureAt(x, y) });
        occupied.add(idx(x, y));
      }
    }

    // ---------- Names and locations ----------
    for (const s of systems) {
      s.name = makeName();
      const [lo, hi] = s.capital ? [4, 6] : s.major ? [3, 5] : [1, 3];
      for (let i = 0, n = randInt(lo, hi); i < n; i++) {
        const type = i === 0 ? 'station' : LOCATION_TYPES[Math.floor(rnd() * LOCATION_TYPES.length)];
        const label = type === 'planet' ? 'Prime' : type === 'station' ? 'Station' : 'Outpost';
        s.locations.push({ type, name: `${s.name} ${label}${i ? ' ' + (i + 1) : ''}` });
      }
    }
    for (const o of outposts) {
      const t = o.type.split(' ');
      o.name = `${makeName()} ${t[t.length - 1][0].toUpperCase()}${t[t.length - 1].slice(1)}`;
    }
    const startSystem = 0; // the capital

    // ---------- Pockets: small charted, safe bubbles around settlements ----------
    const PK = P.pockets;
    const pockets = [];
    for (const s of systems) {
      const r = s.capital ? PK.capital : s.major ? PK.major : PK.minor;
      pockets.push({ kind: 'system', id: s.id, name: s.name, culture: s.culture, x: s.x + 0.5, y: s.y + 0.5, r });
      s.pocket = r;
    }
    for (const o of outposts) {
      pockets.push({ kind: 'outpost', id: o.id, name: o.name, culture: o.culture, x: o.x + 0.5, y: o.y + 0.5, r: PK.outpost });
      o.pocket = PK.outpost;
    }
    // Pockets touching each sector, for quick lookups.
    const pocketCells = new Map();
    for (const pk of pockets) {
      for (let y = Math.floor(pk.y - pk.r); y <= Math.floor(pk.y + pk.r); y++) {
        for (let x = Math.floor(pk.x - pk.r); x <= Math.floor(pk.x + pk.r); x++) {
          if (x < 0 || y < 0 || x >= size || y >= size) continue;
          const k = idx(x, y);
          if (!pocketCells.has(k)) pocketCells.set(k, []);
          pocketCells.get(k).push(pk);
        }
      }
    }
    const clampInt = (v) => Math.max(0, Math.min(size - 1, v));
    // The pocket containing a point in fractional sector coordinates (the most central one if
    // pockets overlap), or null.
    function pocketAt(fx, fy) {
      const list = pocketCells.get(idx(clampInt(Math.floor(fx)), clampInt(Math.floor(fy))));
      let best = null;
      for (const pk of list || []) {
        const d = Math.hypot(fx - pk.x, fy - pk.y);
        if (d <= pk.r && (!best || d / pk.r < best.d / best.r)) best = { ...pk, d };
      }
      return best;
    }
    const zoneOf = (x, y) => (pocketAt(x + 0.5, y + 0.5) ? 'pocket' : inner(x, y) ? 'deep' : 'frontier');

    // ---------- Security: distance to the nearest settled system ----------
    const settledDist = new Float32Array(N).fill(Infinity);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        for (const s of systems) settledDist[idx(x, y)] = Math.min(settledDist[idx(x, y)], dist(s, { x, y }));
      }
    }
    const SEC = P.security;
    const securityOf = (x, y) => {
      if (x < 0 || y < 0 || x >= size || y >= size) return 0;
      const d = settledDist[idx(x, y)];
      return d <= SEC.high ? 3 : d <= SEC.medium ? 2 : d <= SEC.low ? 1 : 0;
    };

    // ---------- Deep space: contacts anywhere outside the pockets ----------
    function deepSector(x, y) {
      if (x < 0 || y < 0 || x >= size || y >= size) return null;
      const zone = zoneOf(x, y);
      if (zone === 'pocket' || occupied.has(idx(x, y))) return null;
      if (hashInt(x, y, seedInt) / 4294967296 >= P.encounterChance[zone]) return null;
      const type = weightedPick(ENCOUNTERS[zone], hashInt(x, y, seedInt + 1) / 4294967296);
      return { type, hostile: isHostile(type) };
    }

    // Where a sector is: its zone, security, the pocket it lies in and how far it is from the
    // nearest settled system (in sectors).
    function territoryOf(x, y) {
      if (x < 0 || y < 0 || x >= size || y >= size) return null;
      return { x, y, zone: zoneOf(x, y), security: securityOf(x, y), pocket: pocketAt(x + 0.5, y + 0.5), settledDist: settledDist[idx(x, y)] };
    }

    return {
      seed, size, sectorUnits: P.sectorUnits, frontier: F, centre,
      cultures: CULTURES, systems, outposts, pockets, startSystem,
      territoryOf, deepSector, securityOf, pocketAt,
      cultureColor: (id) => (CULTURES[id] || CULTURES[0]).color,
      inFrontier: (x, y) => !inner(x, y),
    };
  }

  // localStorage key part identifying one generated galaxy: the same seed with other generator
  // settings or another generator version is another galaxy.
  const saveKey = (g) => `${g.seed}:${g.size}:${g.systems.length}:${g.outposts.length}:v${VERSION}`;

  return { generate, params: DEFAULTS, VERSION, saveKey, CONTACT_TYPES, CULTURES };
})();

if (typeof module !== 'undefined') module.exports = Galaxy;
