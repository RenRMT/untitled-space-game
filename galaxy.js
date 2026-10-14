'use strict';

// Seeded galaxy generator. Produces a square grid of sectors with:
// - settled space following a noise field that thins toward the frontier, leaving irregular voids,
// - a main faction whose capital is always the centre sector and whose dominance fades outward,
// - major factions of uneven size and small minor factions, grown along chains of nearby systems,
//   so territories are irregular, sometimes share contested borders, and may have colonies,
// - independent systems and outposts scattered through settled and deep space,
// - known space as small charted pockets around each system and outpost; everything between
//   them, even inside a faction's border, is uncharted,
// - Waystations (neutral safe havens) on the outer edge of settled space, named by a registry
//   code ("Waystation KX-418"),
// - lanes inside territories, gates between them, and a few hidden routes (together `routes`,
//   the fast-travel network: every route has a gate at each end),
// - deep-space encounters recreated on demand from the seed and sector coordinates.
// Two start styles (`overrides.start`):
// - 'core' (default): the player starts at the main capital in the centre, with its network charted,
// - 'frontier': the same galaxy plus one extra Waystation near a corner or along an edge of the
//   map, where the player starts with nothing else charted (see knowledge.js).
// Every tuning value lives in Galaxy.params; pass `overrides.params` to generate() to change any of
// them for one galaxy (nested objects merge, arrays and numbers replace).
// Works as a classic browser script (global `Galaxy`) and as a Node module.

const Galaxy = (() => {
  const { hashInt, mulberry32, seedToInt, weightedPick } = typeof require === 'function' ? require('./rng.js') : globalThis;

  // Bump whenever a change to the generator (or to sector contents) moves things around for the
  // same seed and settings, so saved charts and cargo from the old layout are not reused.
  const VERSION = 1;

  const DEFAULTS = {
    size: 80,
    sectorUnits: 16000, // world units per sector side
    frontier: 7, // width of the outer frontier ring, in sectors
    // Settlement density: two octaves of value noise plus a pull toward the centre.
    density: { cell1: 14, cell2: 6, noise1: 0.6, noise2: 0.25, radial: 0.55, cutoff: 0.5 },
    systems: { count: [120, 150], spacing: 2 },
    outposts: { count: [150, 250], spacing: 0 }, // spacing: minimum distance to any other settlement
    linkRange: 6, // systems this close are neighbours: territories grow and lanes run between them
    main: { size: [14, 20], strength: 1.4, sigma: 1.5, reach: 0.6, reachSigma: 13 },
    majors: { count: [7, 9], size: [4, 16], spacing: 14, minFromCentre: 14, sigma: 1.35, reach: 0.3, reachSigma: 8 },
    minors: { count: [15, 25], size: [1, 3], spacing: 5, strength: 0.7, sigma: 1.1 },
    exclaveChance: 0.35, // chance a major faction has a colony away from home
    ownThreshold: 0.3, // minimum control to own a sector
    contestedRatio: 0.6, // a rival with this share of the owner's control contests the sector
    unaligned: 0.1, // baseline presence of no faction, so every faction fades toward the edges
    gateRange: 14,
    waystations: { count: [6, 9], minDist: 3, maxDist: 6, spacing: 8 },
    // Safe, charted pocket radius around each settlement, in sectors.
    pockets: { mainCapital: 1.5, capital: 1, minorCapital: 0.7, major: 0.7, minor: 0.5, independent: 0.5, waystation: 0.7, outpost: 0.4 },
    encounterChance: { claimed: 0.04, deep: 0.07, frontier: 0.18 },
  };

  const MAJOR_COLORS = ['#3d8bff', '#e0a030', '#3fbf6a', '#b065e0', '#2ec4c4', '#e06aa0', '#a0c040', '#e07a3a', '#7a8cff'];
  const NETWORKS = [
    { key: 'waystations', name: 'Waystations', color: '#f2f2f2', neutral: true },
    { key: 'pirates', name: 'Pirates', color: '#ff4d4d' },
    { key: 'smugglers', name: 'Smugglers', color: '#c9a36b' },
    { key: 'guild', name: 'Guild', color: '#9fd3ff' },
  ];
  const MINOR_SUFFIXES = ['Compact', 'League', 'Union', 'Assembly', 'Free State', 'Collective', 'Directorate', 'Concord'];
  const OUTPOST_TYPES = ['mining camp', 'trading post', 'research outpost', 'refinery', 'hermitage', 'salvage yard'];
  const ENCOUNTERS = {
    claimed: [['derelict', 3], ['distress', 3], ['ambush', 1], ['anomaly', 1]],
    deep: [['derelict', 4], ['distress', 3], ['ambush', 2], ['anomaly', 1]],
    frontier: [['derelict', 2], ['distress', 1], ['ambush', 4], ['anomaly', 3]],
  };
  const HOSTILE = new Set(['ambush']);
  const SYLLABLES = ['ka', 'ri', 'to', 'ven', 'sol', 'mar', 'dra', 'li', 'on', 'tha', 'ce', 'rus',
    'vo', 'ix', 'al', 'nor', 'pe', 'zan', 'el', 'qua', 'bel', 'cor', 'dun', 'ae', 'syr', 'tal'];
  const LOCATION_TYPES = ['station', 'planet', 'outpost'];
  // Waystation registry codes: two letters and three digits. No I, O, Q or U, which read as digits
  // or each other.
  const CODE_LETTERS = 'ABCDEFGHJKLMNPRSTVWXYZ';
  const START_STYLES = ['core', 'frontier'];
  const INDEPENDENT = { name: 'Independent', color: '#9aa4b8' };

  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

  function hslToHex(h, s, l) {
    const f = (n) => {
      const k = (n + h / 30) % 12;
      const c = l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1));
      return Math.round(c * 255).toString(16).padStart(2, '0');
    };
    return `#${f(0)}${f(8)}${f(4)}`;
  }

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
    const C = size / 2;
    const N = size * size;
    const idx = (x, y) => y * size + x;
    const inner = (x, y) => x >= F && y >= F && x <= size - 1 - F && y <= size - 1 - F;
    const centre = { x: C, y: C };
    const settledRadius = C - F;

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
    // A Waystation's registry code ("KX-418"), hashed from its sector rather than drawn from the
    // main random stream, so codes never shift the names of everything generated after them.
    const usedCodes = new Set();
    function registryCode(x, y) {
      const L = CODE_LETTERS.length;
      for (let salt = 0; ; salt++) {
        const h = hashInt(x, y, ((seedInt ^ 0x3a7e) + salt) >>> 0);
        const code = `${CODE_LETTERS[h % L]}${CODE_LETTERS[Math.floor(h / L) % L]}-${100 + (Math.floor(h / (L * L)) % 900)}`;
        if (!usedCodes.has(code)) { usedCodes.add(code); return code; }
      }
    }

    // ---------- Systems ----------
    const systems = [];
    const addSystem = (x, y, extra = {}) => {
      const s = { id: systems.length, name: '', x, y, faction: null, capital: false, locations: [], ...extra };
      systems.push(s);
      return s;
    };
    const tooClose = (x, y, min) => systems.some((s) => dist(s, { x, y }) < min);

    addSystem(C, C); // main capital
    const innerSectors = [];
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (inner(x, y)) innerSectors.push({ x, y });
    const order = shuffle([...innerSectors]);
    const systemTarget = randInt(...P.systems.count);
    for (let pass = 0; pass < 12 && systems.length < systemTarget; pass++) {
      for (const { x, y } of order) {
        if (systems.length >= systemTarget) break;
        const p = settle[idx(x, y)] ** 1.5 * 0.12 * (1 + pass);
        if (rnd() < p && !tooClose(x, y, P.systems.spacing)) addSystem(x, y);
      }
    }

    const neighbours = systems.map(() => []);
    for (let i = 0; i < systems.length; i++) {
      for (let j = i + 1; j < systems.length; j++) {
        const d = dist(systems[i], systems[j]);
        if (d <= P.linkRange) { neighbours[i].push([j, d]); neighbours[j].push([i, d]); }
      }
    }

    // ---------- Factions: grow territories from capitals along neighbouring systems ----------
    const factions = [];
    const addFaction = (props) => {
      const f = { id: factions.length, ...props };
      factions.push(f);
      return f;
    };
    const assigned = new Int16Array(systems.length).fill(-1);
    const countOf = (f) => systems.reduce((n, s) => n + (assigned[s.id] === f ? 1 : 0), 0);

    // Multi-source Dijkstra: cheaper to expand for stronger factions; stops at each faction's cap.
    function grow(seeds) {
      const caps = new Map(seeds.map((s) => [s.f, s.cap]));
      const counts = new Map(seeds.map((s) => [s.f, countOf(s.f)]));
      const queue = seeds.map((s) => ({ cost: 0, sys: s.sys, f: s.f }));
      const added = [];
      while (queue.length) {
        let best = 0;
        for (let i = 1; i < queue.length; i++) if (queue[i].cost < queue[best].cost) best = i;
        const { cost, sys, f } = queue.splice(best, 1)[0];
        if (assigned[sys] >= 0 || counts.get(f) >= caps.get(f)) continue;
        assigned[sys] = f;
        counts.set(f, counts.get(f) + 1);
        added.push(sys);
        for (const [n, d] of neighbours[sys]) {
          if (assigned[n] < 0) queue.push({ cost: cost + d / factions[f].strength, sys: n, f });
        }
      }
      return added;
    }

    // Main faction from the centre.
    addFaction({ name: 'Faction 1', color: '#ed2939', kind: 'major', main: true, strength: P.main.strength, centre });
    systems[0].capital = true;
    grow([{ f: 0, sys: 0, cap: randInt(...P.main.size) }]);

    // Major factions: capitals in dense areas, spread apart, of uneven size.
    const M = P.majors;
    // Room to grow: unclaimed neighbouring systems.
    const localDensity = (s) => neighbours[s.id].filter(([n]) => assigned[n] < 0).length;
    const majorCandidates = systems
      .filter((s) => assigned[s.id] < 0 && dist(s, centre) >= M.minFromCentre)
      .map((s) => ({ s, room: localDensity(s), score: (1 + localDensity(s)) * (0.6 + 0.8 * rnd()) }))
      .sort((a, b) => b.score - a.score);
    const majorTarget = randInt(...M.count);
    let majorCapitals = [];
    // Relax spacing, then the room-to-grow requirement, until enough capitals fit.
    for (let minRoom = 3; minRoom >= 1 && majorCapitals.length < M.count[0]; minRoom--) {
      for (let spacing = M.spacing; spacing >= 9 && majorCapitals.length < M.count[0]; spacing--) {
        majorCapitals = [];
        for (const { s, room } of majorCandidates) {
          if (majorCapitals.length >= majorTarget) break;
          if (room >= minRoom && majorCapitals.every((o) => dist(o, s) >= spacing)) majorCapitals.push(s);
        }
      }
    }
    majorCapitals.sort((a, b) => Math.atan2(a.y - C, a.x - C) - Math.atan2(b.y - C, b.x - C));
    const colors = shuffle([...MAJOR_COLORS]);
    const mainSize = countOf(0);
    const majorSeeds = majorCapitals.map((s, i) => {
      // Skewed toward small; always smaller than the main faction.
      const cap = Math.min(mainSize - 2, Math.round(M.size[0] + (M.size[1] - M.size[0]) * rnd() ** 2));
      const f = addFaction({
        name: `Faction ${i + 2}`, color: colors[i], kind: 'major',
        strength: 0.6 + cap / 16, centre: { x: s.x, y: s.y },
      });
      s.capital = true;
      return { f: f.id, sys: s.id, cap };
    });
    grow(majorSeeds);

    // Colonies: some majors claim a small cluster away from home.
    for (const { f, sys } of majorSeeds) {
      if (rnd() >= P.exclaveChance) continue;
      const home = systems.filter((s) => assigned[s.id] === f);
      if (home.length >= mainSize - 2) continue;
      const options = systems.filter((s) => assigned[s.id] < 0
        && home.every((h) => dist(h, s) >= 10) && dist(s, systems[sys]) <= 26);
      if (!options.length) continue;
      const start = options[Math.floor(rnd() * options.length)];
      const cap = Math.min(mainSize - 1, home.length + randInt(1, 2));
      for (const id of grow([{ f, sys: start.id, cap }])) systems[id].exclave = true;
    }

    // Minor factions: small territories in the remaining systems, between and inside the majors.
    const minorTarget = randInt(...P.minors.count);
    const free = shuffle(systems.filter((x) => assigned[x.id] < 0));
    let minorCapitals = [];
    for (let spacing = P.minors.spacing; spacing >= 2 && minorCapitals.length < P.minors.count[0]; spacing--) {
      minorCapitals = [];
      for (const s of free) {
        if (minorCapitals.length >= minorTarget) break;
        if (minorCapitals.every((o) => dist(o, s) >= spacing)) minorCapitals.push(s);
      }
    }
    const hue0 = rnd() * 360;
    const minorSeeds = minorCapitals.map((s, i) => {
      const f = addFaction({
        name: `${makeName()} ${MINOR_SUFFIXES[Math.floor(rnd() * MINOR_SUFFIXES.length)]}`,
        color: hslToHex((hue0 + i * 137.5) % 360, 0.35, 0.6),
        kind: 'minor', strength: P.minors.strength, centre: { x: s.x, y: s.y },
      });
      s.capital = true;
      return { f: f.id, sys: s.id, cap: randInt(...P.minors.size) };
    });
    grow(minorSeeds);

    for (const s of systems) s.faction = assigned[s.id] >= 0 ? assigned[s.id] : null;
    const T = factions.length; // territorial factions
    const majorIds = factions.filter((f) => f.kind === 'major').map((f) => f.id);

    for (const m of NETWORKS) addFaction({ kind: 'network', ...m });
    for (const [i, o] of (overrides.factions || []).entries()) if (factions[i]?.kind === 'major' && o) Object.assign(factions[i], o);
    for (const [key, o] of Object.entries(overrides.networks || {})) {
      const f = factions.find((x) => x.key === key);
      if (f) Object.assign(f, o);
    }
    const factionByKey = (key) => factions.find((f) => f.key === key).id;

    // ---------- Influence ----------
    const control = new Float32Array(N * T);
    for (const s of systems) {
      if (s.faction === null) continue;
      const f = factions[s.faction];
      const sigma = f.main ? P.main.sigma : f.kind === 'major' ? M.sigma : P.minors.sigma;
      const w = s.capital ? 1 : 0.8;
      const R = Math.ceil(sigma * 3);
      for (let dy = -R; dy <= R; dy++) {
        for (let dx = -R; dx <= R; dx++) {
          const x = s.x + dx;
          const y = s.y + dy;
          if (x < 0 || y < 0 || x >= size || y >= size) continue;
          const v = w * Math.exp(-(dx * dx + dy * dy) / (2 * sigma * sigma));
          const k = idx(x, y) * T + s.faction;
          if (v > control[k]) control[k] = v;
        }
      }
    }
    function reach(f, x, y) {
      const fac = factions[f];
      if (fac.kind !== 'major') return 0;
      const d2 = (fac.centre.x - x) ** 2 + (fac.centre.y - y) ** 2;
      if (fac.main) return P.main.reach * Math.exp(-d2 / (2 * P.main.reachSigma ** 2));
      return M.reach * (fac.strength / 1.2) * Math.exp(-d2 / (2 * M.reachSigma ** 2));
    }

    const owner = new Int16Array(N).fill(-1);
    const rival = new Int16Array(N).fill(-1);
    const shares = new Float32Array(N * T);
    const unaligned = new Float32Array(N);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = idx(x, y);
        let total = P.unaligned;
        let top = -1;
        let second = -1;
        for (let f = 0; f < T; f++) {
          const c = control[i * T + f];
          const p = c + reach(f, x, y); // reach() is 0 for minor factions
          shares[i * T + f] = p;
          total += p;
          if (top < 0 || c > control[i * T + top]) { second = top; top = f; } else if (second < 0 || c > control[i * T + second]) second = f;
        }
        for (let f = 0; f < T; f++) shares[i * T + f] /= total;
        unaligned[i] = P.unaligned / total;
        const topC = control[i * T + top];
        if (topC >= P.ownThreshold) {
          owner[i] = top;
          const secondC = second >= 0 ? control[i * T + second] : 0;
          if (secondC >= P.ownThreshold * 0.6 && secondC >= P.contestedRatio * topC) rival[i] = second;
        }
      }
    }
    // Sorted shares; faction null is the unaligned remainder.
    const presenceAt = (x, y) => {
      const i = idx(x, y);
      const list = [{ faction: null, share: unaligned[i] }];
      for (let f = 0; f < T; f++) if (shares[i * T + f] >= 0.005) list.push({ faction: f, share: shares[i * T + f] });
      return list.sort((a, b) => b.share - a.share);
    };
    const ownerAt = (x, y) => owner[idx(x, y)];

    // ---------- Waystations: neutral stations on the outer edge of settled space ----------
    const occupied = new Set(systems.map((s) => idx(s.x, s.y)));
    const WS = P.waystations;
    // Distance to the nearest owned sector. Only distances up to WS.maxDist matter, so search that
    // neighbourhood instead of every owned sector; anything further away is Infinity.
    const distToKnown = (x, y) => {
      const R = Math.ceil(WS.maxDist);
      let best = Infinity;
      for (let ky = Math.max(0, y - R); ky <= Math.min(size - 1, y + R); ky++) {
        for (let kx = Math.max(0, x - R); kx <= Math.min(size - 1, x + R); kx++) {
          if (ownerAt(kx, ky) >= 0) best = Math.min(best, Math.hypot(kx - x, ky - y));
        }
      }
      return best;
    };
    const wsCandidates = innerSectors
      .filter(({ x, y }) => ownerAt(x, y) < 0 && !occupied.has(idx(x, y)) && Math.hypot(x - C, y - C) >= settledRadius * 0.45)
      .map(({ x, y }) => ({ x, y, r: Math.hypot(x - C, y - C), a: Math.atan2(y - C, x - C), dk: distToKnown(x, y) }))
      .filter((c) => c.dk >= WS.minDist && c.dk <= WS.maxDist);
    const wsTarget = randInt(...WS.count);
    const waystations = [];
    const placeWaystation = (pool) => {
      const open = pool.filter((c) => waystations.every((f) => dist(f, c) >= WS.spacing)).sort((p, q) => q.r - p.r);
      if (!open.length) return;
      const c = open[Math.floor(rnd() * Math.ceil(open.length / 3))]; // favour the outermost
      waystations.push(addSystem(c.x, c.y, { faction: factionByKey('waystations'), waystation: true }));
      occupied.add(idx(c.x, c.y));
    };
    // One per angular slice, then fill up anywhere if slices came up empty.
    const angle0 = rnd() * Math.PI * 2;
    for (let i = 0; i < wsTarget; i++) {
      const lo = angle0 + (i / wsTarget) * Math.PI * 2;
      const hi = lo + Math.PI * 2 / wsTarget;
      const inSlice = (a) => { const t = ((a - lo) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2); return t < hi - lo; };
      placeWaystation(wsCandidates.filter((c) => inSlice(c.a)));
    }
    while (waystations.length < WS.count[0]) {
      const before = waystations.length;
      placeWaystation(wsCandidates);
      if (waystations.length === before) break;
    }

    // ---------- Outposts: single settlements, thinning out into deep space ----------
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
        const o = ownerAt(x, y);
        outposts.push({ id: outposts.length, x, y, type: OUTPOST_TYPES[Math.floor(rnd() * OUTPOST_TYPES.length)], faction: o >= 0 ? o : null });
        occupied.add(idx(x, y));
      }
    }

    // ---------- Names and locations ----------
    for (const s of systems) {
      if (s.waystation) {
        s.name = `Waystation ${registryCode(s.x, s.y)}`;
        s.locations = [{ type: 'station', name: s.name }];
        continue;
      }
      s.name = makeName();
      const kind = s.faction === null ? 'independent' : factions[s.faction].kind;
      const [lo, hi] = kind === 'major' ? [3, 6] : kind === 'minor' ? [2, 4] : [1, 3];
      for (let i = 0, n = randInt(lo, hi); i < n; i++) {
        const type = i === 0 ? 'station' : LOCATION_TYPES[Math.floor(rnd() * LOCATION_TYPES.length)];
        const label = type === 'planet' ? 'Prime' : type === 'station' ? 'Station' : 'Outpost';
        s.locations.push({ type, name: `${s.name} ${label}${i ? ' ' + (i + 1) : ''}` });
      }
      s.presence = presenceAt(s.x, s.y).filter((p) => p.share >= 0.02);
      s.dominance = s.faction === null ? 0 : (s.presence.find((p) => p.faction === s.faction)?.share ?? 0);
    }
    for (const o of outposts) {
      const t = o.type.split(' ');
      o.name = `${makeName()} ${t[t.length - 1][0].toUpperCase()}${t[t.length - 1].slice(1)}`;
    }

    // ---------- Lanes: within each connected cluster of a faction's systems ----------
    const lanes = [];
    const clustersOf = (list) => {
      const parent = new Map(list.map((s) => [s.id, s.id]));
      const find = (i) => (parent.get(i) === i ? i : find(parent.get(i)));
      for (const a of list) for (const b of list) if (a.id < b.id && dist(a, b) <= P.linkRange + 1) parent.set(find(a.id), find(b.id));
      const groups = new Map();
      for (const s of list) {
        const r = find(s.id);
        if (!groups.has(r)) groups.set(r, []);
        groups.get(r).push(s);
      }
      return [...groups.values()];
    };
    const linkKey = (a, b) => (a < b ? `${a}-${b}` : `${b}-${a}`);
    const clustersByFaction = [];
    for (let f = 0; f < T; f++) {
      const clusters = clustersOf(systems.filter((s) => s.faction === f));
      clustersByFaction[f] = clusters;
      for (const list of clusters) {
        if (list.length < 2) continue;
        const inTree = new Set([list[0].id]);
        const tree = new Set();
        let longest = 0;
        while (inTree.size < list.length) {
          let best = null;
          for (const a of list) {
            if (!inTree.has(a.id)) continue;
            for (const b of list) {
              if (inTree.has(b.id)) continue;
              const d = dist(a, b);
              if (!best || d < best.d) best = { a, b, d };
            }
          }
          inTree.add(best.b.id);
          tree.add(linkKey(best.a.id, best.b.id));
          lanes.push({ a: best.a.id, b: best.b.id });
          longest = Math.max(longest, best.d);
        }
        if (list.length < 4) continue;
        const extras = [];
        for (const a of list) {
          for (const b of list) {
            const d = dist(a, b);
            if (a.id < b.id && !tree.has(linkKey(a.id, b.id)) && d <= longest * 1.5) extras.push({ a: a.id, b: b.id, d });
          }
        }
        extras.sort((p, q) => p.d - q.d);
        for (const e of extras.slice(0, randInt(1, 2))) lanes.push({ a: e.a, b: e.b });
      }
    }

    // ---------- Gates: between factions, plus hidden routes ----------
    const homeOf = (f) => {
      const capital = systems.find((s) => s.faction === f && s.capital);
      return clustersByFaction[f].find((c) => c.includes(capital));
    };
    function closestPair(listA, listB) {
      let best = null;
      for (const a of listA) {
        for (const b of listB) {
          const d = dist(a, b);
          if (!best || d < best.d) best = { a: a.id, b: b.id, d };
        }
      }
      return best;
    }
    const pairOf = (fa, fb) => closestPair(homeOf(fa), homeOf(fb));
    const gates = [];
    const gateKeys = new Set();
    const factionLinks = [];
    function addGate(fa, fb, hidden = false) {
      const k = linkKey(fa, fb) + (hidden ? 'h' : '');
      if (gateKeys.has(k)) return;
      gateKeys.add(k);
      const p = pairOf(fa, fb);
      gates.push({ a: p.a, b: p.b, hidden });
      if (!hidden) factionLinks.push([fa, fb]);
    }
    const componentOf = (start) => {
      const seen = new Set([start]);
      for (let grew = true; grew;) {
        grew = false;
        for (const [a, b] of factionLinks) if (seen.has(a) !== seen.has(b)) { seen.add(a); seen.add(b); grew = true; }
      }
      return seen;
    };

    // 1–2 outlying majors get no gates at all.
    const outlying = majorIds.filter((f) => f !== 0)
      .sort((p, q) => dist(factions[q].centre, centre) - dist(factions[p].centre, centre))
      .slice(0, randInt(1, 2));
    const isolated = new Set(outlying);
    const gated = majorIds.filter((f) => !isolated.has(f));

    // Majors: a spanning network over nearby pairs, a few loops, and links to the main network.
    const pairs = [];
    for (const a of gated) for (const b of gated) if (a < b) pairs.push({ a, b, d: pairOf(a, b).d });
    pairs.sort((p, q) => p.d - q.d);
    const extraPairs = [];
    for (const p of pairs) {
      if (p.d > P.gateRange) break;
      if (!componentOf(p.a).has(p.b)) addGate(p.a, p.b); else extraPairs.push(p);
    }
    for (const p of extraPairs.slice(0, Math.round(gated.length * 0.3))) addGate(p.a, p.b);
    for (const f of gated) {
      const main = componentOf(0);
      if (main.has(f)) continue;
      const best = [...main].sort((p, q) => pairOf(f, p).d - pairOf(f, q).d)[0];
      addGate(f, best);
    }
    // Minors: about half connect to their nearest gated neighbour; the rest are deep-space enclaves.
    const minorIds = factions.filter((f) => f.kind === 'minor').map((f) => f.id);
    for (const f of minorIds) {
      if (rnd() >= 0.5) continue;
      const near = gated.map((g) => ({ g, d: pairOf(f, g).d })).sort((p, q) => p.d - q.d)[0];
      if (near && near.d <= P.gateRange) addGate(f, near.g);
    }
    // Colonies: usually gated to home.
    for (const f of gated) {
      for (const cluster of clustersByFaction[f]) {
        if (cluster === homeOf(f) || rnd() >= 0.6) continue;
        const p = closestPair(cluster, homeOf(f));
        gates.push({ a: p.a, b: p.b, hidden: false });
      }
    }
    // Hidden routes: into each isolated major, sometimes to a Waystation.
    for (const f of isolated) {
      const target = [...gated].sort((p, q) => pairOf(f, p).d - pairOf(f, q).d)[0];
      addGate(f, target, true);
    }
    if (waystations.length && rnd() < 0.6) {
      const ws = waystations[Math.floor(rnd() * waystations.length)];
      const near = systems.filter((s) => s.faction !== null && !s.waystation).sort((p, q) => dist(p, ws) - dist(q, ws))[0];
      gates.push({ a: near.id, b: ws.id, hidden: true });
    }
    for (const f of factions) if (f.kind !== 'network') f.isolated = isolated.has(f.id);

    // Networks without land operate inside a few territories.
    for (const f of factions) {
      if (f.kind !== 'network' || f.neutral) continue;
      f.operatesIn = shuffle([...majorIds, ...minorIds]).slice(0, randInt(3, 6));
    }

    // ---------- Routes: the fast-travel network (every route gets a gate at each end) ----------
    const routes = [
      ...lanes.map((l) => ({ a: l.a, b: l.b, kind: 'lane' })),
      ...gates.map((g) => ({ a: g.a, b: g.b, kind: g.hidden ? 'hidden' : 'gate' })),
    ].map((r, link) => ({ ...r, link }));

    // ---------- Frontier start: a lone Waystation out by the edge ----------
    // Added after everything else, from its own random stream, so the rest of the galaxy is exactly
    // the core-style galaxy for the same seed. It has no routes: the way in is through deep space.
    const startStyle = START_STYLES.includes(overrides.start) ? overrides.start : 'core';
    let startSystem = 0;
    if (startStyle === 'frontier') {
      const sr = mulberry32((seedInt ^ 0xf2a7) >>> 0);
      const inset = () => 2 + Math.floor(sr() * 3); // 2–4 sectors in from the map's edge
      const side = (a) => (sr() < 0.5 ? a : size - 1 - a);
      let x, y;
      if (sr() < 0.5) { // a corner
        x = side(inset());
        y = side(inset());
      } else { // somewhere along an edge, clear of the corners
        const t = F + Math.floor(sr() * (size - 2 * F));
        const a = inset();
        [x, y] = [[a, t], [size - 1 - a, t], [t, a], [t, size - 1 - a]][Math.floor(sr() * 4)];
      }
      // The nearest free sector that is still in the frontier, a little in from the very edge.
      const ok = (cx, cy) => cx >= 1 && cy >= 1 && cx <= size - 2 && cy <= size - 2 && !inner(cx, cy) && !occupied.has(idx(cx, cy));
      search: for (let r = 0; r <= 4; r++) {
        for (let dy = -r; dy <= r; dy++) {
          for (let dx = -r; dx <= r; dx++) {
            if (Math.max(Math.abs(dx), Math.abs(dy)) === r && ok(x + dx, y + dy)) { x += dx; y += dy; break search; }
          }
        }
      }
      const s = addSystem(x, y, { faction: factionByKey('waystations'), waystation: true, start: true });
      s.name = `Waystation ${registryCode(x, y)}`;
      s.locations = [{ type: 'station', name: s.name }];
      waystations.push(s);
      occupied.add(idx(x, y));
      startSystem = s.id;
    }
    // Waystations keep their neighbourhood safe: no hostile contacts within 1 sector (2 around the
    // frontier start, which sits in raider country), and no frontier raiders there either (sector.js).
    const nearWaystation = (x, y) => waystations.some((w) => Math.max(Math.abs(w.x - x), Math.abs(w.y - y)) <= (w.start ? 2 : 1));

    // ---------- Pockets: small charted, safe bubbles around settlements ----------
    const PK = P.pockets;
    const pockets = [];
    for (const s of systems) {
      const f = s.faction === null ? null : factions[s.faction];
      const r = s.waystation ? PK.waystation
        : !f ? PK.independent
          : s.capital && f.main ? PK.mainCapital
            : s.capital ? (f.kind === 'major' ? PK.capital : PK.minorCapital)
              : f.kind === 'major' ? PK.major : PK.minor;
      pockets.push({ kind: 'system', id: s.id, name: s.name, faction: s.faction, x: s.x + 0.5, y: s.y + 0.5, r });
      s.pocket = r;
    }
    for (const o of outposts) {
      pockets.push({ kind: 'outpost', id: o.id, name: o.name, faction: o.faction, x: o.x + 0.5, y: o.y + 0.5, r: PK.outpost });
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
    const zoneOf = (x, y) => (pocketAt(x + 0.5, y + 0.5) ? 'pocket' : ownerAt(x, y) >= 0 ? 'claimed' : inner(x, y) ? 'deep' : 'frontier');

    // ---------- Deep space: contacts anywhere outside the pockets ----------
    const story = (overrides.storyPois || []).map((p) => ({ ...p, type: 'story', hostile: false }));
    function deepSector(x, y) {
      if (x < 0 || y < 0 || x >= size || y >= size) return null;
      const zone = zoneOf(x, y);
      if (zone === 'pocket') return null;
      const s = story.find((p) => p.x === x && p.y === y);
      if (s) return s;
      if (occupied.has(idx(x, y))) return null;
      if (hashInt(x, y, seedInt) / 4294967296 >= P.encounterChance[zone]) return null;
      let table = ENCOUNTERS[zone];
      if (nearWaystation(x, y)) table = table.filter(([t]) => !HOSTILE.has(t));
      const type = weightedPick(table, hashInt(x, y, seedInt + 1) / 4294967296);
      return { type, hostile: HOSTILE.has(type) };
    }

    function territoryOf(x, y) {
      if (x < 0 || y < 0 || x >= size || y >= size) return null;
      const o = ownerAt(x, y);
      const pres = presenceAt(x, y);
      const r = rival[idx(x, y)];
      return {
        x, y,
        zone: zoneOf(x, y),
        pocket: pocketAt(x + 0.5, y + 0.5),
        owner: o >= 0 ? o : null,
        contestedBy: r >= 0 ? r : null,
        dominance: o >= 0 ? pres.find((p) => p.faction === o).share : 0,
        presence: pres.filter((p) => p.share >= 0.02),
      };
    }

    // A faction's colour and name by id; null (independent) gets a neutral grey (theme.js's
    // neutral) and 'Independent'.
    const factionColor = (fid) => (fid === null || fid === undefined || !factions[fid] ? INDEPENDENT.color : factions[fid].color);
    const factionName = (fid) => (fid === null || fid === undefined || !factions[fid] ? INDEPENDENT.name : factions[fid].name);

    return {
      seed, size, sectorUnits: P.sectorUnits, frontier: F, centre,
      factions, systems, outposts, lanes, gates, routes, pockets,
      start: startStyle, startSystem,
      territoryOf, deepSector, pocketAt, nearWaystation, factionColor, factionName,
      inFrontier: (x, y) => !inner(x, y),
    };
  }

  // localStorage key part identifying one generated galaxy: the same seed with other generator
  // settings, another generator version or another start style is another galaxy. (Core-style keys
  // keep their old form, so existing saves still load.)
  const saveKey = (g) => `${g.seed}:${g.size}:${g.systems.length}:${g.outposts.length}:v${VERSION}${g.start === 'frontier' ? ':frontier' : ''}`;

  return { generate, params: DEFAULTS, VERSION, saveKey, START_STYLES };
})();

if (typeof module !== 'undefined') module.exports = Galaxy;
