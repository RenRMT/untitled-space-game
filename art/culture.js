'use strict';

// Faction design cultures for the procedural art.
//
// A culture is a small set of design-language parameters that every asset generator reads:
// hull family, corner rounding, proportions, wing type, engine count, surface detail,
// asymmetry, station topology and a palette. Cultures come from three sources:
// - lineages: six hand-tuned design traditions (below), sampled within their ranges per faction,
// - descent: minor factions inherit from the nearest major, more strongly the closer they are,
// - kitbash: pirates assemble each asset from parts of the cultures they raid.
// The faction's map colour becomes the accent (markings, line art), so related factions share
// silhouettes but still read as different owners.
// Works as a classic browser script (global `ArtCulture`) and as a Node module.

const ArtCulture = (() => {
  const isNode = typeof require === 'function' && typeof module !== 'undefined';
  const U = isNode ? require('./util.js') : ArtUtil;
  const { mulberry32, hashInt } = isNode ? require('../rng.js') : globalThis;

  // Numeric fields are [min, max] ranges; arrays of strings are options picked per faction.
  const LINEAGES = {
    wedge: {
      label: 'Wedge', note: 'Angular deltas with blunt sterns; spoked wheel stations on a solar spine.', gate: 'ring', gateNote: 'Gates are clamped rings on solar-panelled anchor arms.',
      hull: 'wedge', round: [0, 0.05], length: [0.95, 1.15], width: [0.95, 1.1], span: [0.9, 1.15], sweep: [0.45, 0.75],
      wings: ['delta', 'swept'], engines: [1, 2], greeble: [0.35, 0.6], asym: [0, 0], stripes: [1, 2],
      insignia: ['chevron', 'bar'], station: 'wheel', arrays: 'solar',
      colors: { hull: '#c3cbd5', hull2: '#7a8696', trim: '#e6ecf2', glass: '#7df9ff', light: '#b6ff8a', flame: '#ffb347', panel: '#2f5aa0' },
    },
    arc: {
      label: 'Arc', note: 'Rounded hulls and crescent wings; saucer stations ringed with pods.', gate: 'halo', gateNote: 'Gates are smooth halos ringed with pods and emitter domes.',
      hull: 'arc', round: [0.75, 1], length: [0.85, 1.0], width: [1.05, 1.25], span: [0.95, 1.2], sweep: [0.1, 0.4],
      wings: ['crescent', 'forward'], engines: [2, 3], greeble: [0.1, 0.25], asym: [0, 0], stripes: [0, 1],
      insignia: ['dot', 'ring'], station: 'disk', arrays: 'none',
      colors: { hull: '#e6dcc6', hull2: '#a39374', trim: '#fff6e4', glass: '#9ff0e0', light: '#ffd36b', flame: '#7fd0ff', panel: '#3a6a8a' },
    },
    block: {
      label: 'Block', note: 'Modular slabs and side pods; lattice stations of stacked modules and radiator fins.', gate: 'frame', gateNote: 'Gates are square or hex frames of modules with radiator fins at each corner.',
      hull: 'block', round: [0, 0.08], length: [1.0, 1.2], width: [1.1, 1.3], span: [0.6, 0.85], sweep: [0, 0.2],
      wings: ['pods', 'fins'], engines: [2, 4], greeble: [0.65, 0.95], asym: [0, 0.1], stripes: [1, 3],
      insignia: ['bar', 'diamond'], station: 'lattice', arrays: 'radiator',
      colors: { hull: '#b9b59b', hull2: '#6e6a52', trim: '#d9d4b6', glass: '#ffd66b', light: '#ff9a3c', flame: '#fff2b3', panel: '#8a8f96' },
    },
    shard: {
      label: 'Shard', note: 'Needle prows and blade wings; radial crystal stations.', gate: 'pylons', gateNote: 'Gates are two or three crystal pylons with orbiting shards.',
      hull: 'shard', round: [0, 0], length: [1.15, 1.4], width: [0.8, 0.95], span: [0.85, 1.2], sweep: [0.65, 0.95],
      wings: ['blade', 'delta'], engines: [1, 1], greeble: [0.05, 0.2], asym: [0, 0.15], stripes: [0, 1],
      insignia: ['diamond', 'chevron'], station: 'star', arrays: 'none',
      colors: { hull: '#646b7d', hull2: '#363b48', trim: '#9aa3b8', glass: '#c77dff', light: '#e0b0ff', flame: '#c77dff', panel: '#4a3a6a' },
    },
    spindle: {
      label: 'Spindle', note: 'Long spines with strung-out modules; linear truss stations around one spin ring.', gate: 'spar', gateNote: 'Gates are a spin ring held between two module-strung trusses.',
      hull: 'spindle', round: [0.3, 0.6], length: [1.3, 1.6], width: [0.7, 0.85], span: [0.45, 0.7], sweep: [0.2, 0.5],
      wings: ['fins', 'none'], engines: [1, 3], greeble: [0.3, 0.5], asym: [0, 0], stripes: [1, 2],
      insignia: ['ring', 'bar'], station: 'truss', arrays: 'solar',
      colors: { hull: '#e8eef5', hull2: '#8ea2bd', trim: '#ffffff', glass: '#5fc4e8', light: '#7fd0ff', flame: '#9fd3ff', panel: '#24478a' },
    },
    coral: {
      label: 'Coral', note: 'Asymmetric organic hulls; clustered pod stations joined by tendrils.', gate: 'maw', gateNote: 'Gates are a ring of organic lobes joined by tendrils.',
      hull: 'coral', round: [0.85, 1], length: [0.85, 1.0], width: [1.1, 1.3], span: [0.8, 1.1], sweep: [0.2, 0.6],
      wings: ['lobes'], engines: [1, 2], greeble: [0.05, 0.2], asym: [0.35, 0.6], stripes: [0, 0],
      insignia: ['dot'], station: 'cluster', arrays: 'none',
      colors: { hull: '#a8888c', hull2: '#5f4a50', trim: '#d8b8b0', glass: '#6affc8', light: '#6affc8', flame: '#8aff8a', panel: '#4a6a50' },
    },
  };
  const NUMERIC = ['round', 'length', 'width', 'span', 'sweep', 'greeble', 'asym'];
  const DISCRETE = ['hull', 'wings', 'insignia', 'station', 'arrays', 'gate'];
  const PALETTE_KEYS = ['hull', 'hull2', 'trim', 'glass', 'light', 'flame', 'panel'];

  // The original game palette, used by the player ship and Tarsis Station.
  const LEGACY_PAL = {
    hull: '#d8dde3', hull2: '#7a8696', trim: '#eef1f4', glass: '#2fb8c8', light: '#b6ff8a', flame: '#ffb347',
    panel: '#2f5aa0', accent: '#7df9ff', line: '#7df9ff',
  };

  const pickFrom = (list, r) => list[Math.floor(r() * list.length)];

  function palette(colors, accent, r) {
    const acc = U.tune(accent, { s: [0.45, 1], l: [0.45, 0.62] });
    const pal = {};
    // A faint faction tint on the hull plus a little per-faction jitter.
    const jitter = 0.92 + r() * 0.16;
    for (const k of PALETTE_KEYS) pal[k] = colors[k];
    pal.hull = U.shade(U.mix(colors.hull, acc, 0.08), jitter);
    pal.hull2 = U.shade(U.mix(colors.hull2, acc, 0.1), jitter);
    pal.accent = acc;
    pal.line = U.tune(U.mix(acc, '#ffffff', 0.25), { s: [0.55, 1], l: [0.62, 0.78] });
    return pal;
  }

  function create(lineage, seed, accent = '#9aa4b8', extra = {}) {
    const L = LINEAGES[lineage];
    const r = mulberry32(seed >>> 0);
    const c = { lineage, label: L.label, note: L.note, seed: seed >>> 0 };
    for (const k of NUMERIC) c[k] = U.lerp(L[k][0], L[k][1], r());
    c.engines = Math.round(U.lerp(L.engines[0], L.engines[1], r()));
    c.stripes = Math.round(U.lerp(L.stripes[0], L.stripes[1], r()));
    c.hull = L.hull;
    c.wings = pickFrom(L.wings, r);
    c.insignia = pickFrom(L.insignia, r);
    c.station = L.station;
    c.arrays = L.arrays;
    // Gate design language; only majors can build gates (see ArtBlueprints.canBuildGate).
    c.gate = L.gate;
    c.pal = palette(L.colors, accent, r);
    return Object.assign(c, extra);
  }

  // A culture descended from `parent`: `influence` (0..1) is how much it keeps.
  function descend(parent, seed, accent, influence, extra = {}) {
    const r = mulberry32((seed ^ 0x9e3779b9) >>> 0);
    const lineages = Object.keys(LINEAGES);
    const own = create(pickFrom(lineages, r), seed, accent);
    const c = { ...own, seed: seed >>> 0 };
    for (const k of NUMERIC) c[k] = U.lerp(own[k], parent[k], influence);
    c.engines = Math.round(U.lerp(own.engines, parent.engines, influence));
    c.stripes = Math.round(U.lerp(own.stripes, parent.stripes, influence));
    const keepLineage = r() < 0.35 + influence * 0.6;
    if (keepLineage) Object.assign(c, { lineage: parent.lineage, label: parent.label, note: parent.note });
    for (const k of DISCRETE) c[k] = r() < influence ? parent[k] : own[k];
    if (keepLineage) c.hull = parent.hull;
    c.pal = { ...own.pal };
    for (const k of PALETTE_KEYS) c.pal[k] = U.mix(own.pal[k], parent.pal[k], influence);
    return Object.assign(c, { parent: parent.factionId, influence }, extra);
  }

  // Pirates: each asset borrows its parts from the cultures they raid.
  function kitbash(donors, seed, accent, extra = {}) {
    const r = mulberry32(seed >>> 0);
    const base = create(pickFrom(Object.keys(LINEAGES), r), seed, accent);
    const c = {
      ...base, lineage: 'kitbash', label: 'Kitbash', note: 'Captured hulls rebuilt from mismatched parts; patched, asymmetric and scorched.',
      donors, asym: 0.45, greeble: 0.7,
    };
    c.pal = {
      ...base.pal, hull: '#8f8578', hull2: '#4f4840', trim: '#b8ab98', glass: '#ff8a6b', light: '#ff5a4a', flame: '#ff7a3a', panel: '#5a4a3a',
    };
    return Object.assign(c, extra);
  }

  function seedInt(seed) {
    if (Number.isInteger(seed)) return seed >>> 0;
    let h = 2166136261;
    for (const ch of String(seed)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
    return h >>> 0;
  }

  // Cultures for every faction in a generated galaxy, plus one for independents.
  function forGalaxy(galaxy) {
    const base = seedInt(galaxy.seed);
    const r = mulberry32(hashInt(base, 7, 0xc0ffee));
    const fseed = (id) => hashInt(base, id, 0xa47);
    const byId = new Map();
    const majors = galaxy.factions.filter((f) => f.kind === 'major');

    // Main faction keeps the game's own wedge language; the others draw from a shuffled deck,
    // so lineages repeat only when there are more majors than lineages.
    const deck = ['arc', 'block', 'shard', 'spindle', 'coral'];
    for (let i = deck.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [deck[i], deck[j]] = [deck[j], deck[i]]; }
    deck.push('wedge');
    let k = 0;
    for (const f of majors) {
      const lineage = f.main ? 'wedge' : deck[k++ % deck.length];
      byId.set(f.id, create(lineage, fseed(f.id), f.color, { factionId: f.id, name: f.name, kind: f.kind }));
    }

    for (const f of galaxy.factions.filter((x) => x.kind === 'minor')) {
      const near = majors
        .map((m) => ({ m, d: Math.hypot(m.centre.x - f.centre.x, m.centre.y - f.centre.y) }))
        .sort((a, b) => a.d - b.d)[0];
      const influence = U.clamp(0.9 - near.d / 30, 0.25, 0.85);
      byId.set(f.id, descend(byId.get(near.m.id), fseed(f.id), f.color, influence, { factionId: f.id, name: f.name, kind: f.kind }));
    }

    for (const f of galaxy.factions.filter((x) => x.kind === 'network')) {
      const meta = { factionId: f.id, name: f.name, kind: f.kind };
      let c;
      if (f.key === 'pirates') {
        const donors = (f.operatesIn || []).map((id) => byId.get(id)).filter(Boolean);
        c = kitbash(donors.length ? donors : [...byId.values()].slice(0, 3), fseed(f.id), f.color, meta);
      } else if (f.key === 'smugglers') {
        c = descend(create('shard', fseed(f.id) + 1, f.color), fseed(f.id), f.color, 0.55, meta);
        c.pal.hull = '#4a4f5a';
        c.pal.hull2 = '#262a32';
      } else if (f.key === 'guild') {
        c = create('block', fseed(f.id), f.color, { ...meta, greeble: 1 });
      } else {
        // Freeports: neutral white wheel stations.
        c = create('wedge', fseed(f.id), f.color, meta);
        c.pal.hull = '#e8eaee';
        c.pal.hull2 = '#9aa0aa';
        c.pal.line = '#f2f4f8';
      }
      byId.set(f.id, c);
    }

    const independent = create('wedge', hashInt(base, 999, 0x1d), '#9aa4b8', { factionId: null, name: 'Independent', kind: 'independent', round: 0.35 });
    independent.pal.line = '#aeb8cc';
    return {
      cultures: byId,
      independent,
      of: (factionId) => (factionId === null || factionId === undefined ? independent : byId.get(factionId) || independent),
    };
  }

  const legacy = create('wedge', 1, '#7df9ff', { factionId: null, name: 'Original', kind: 'legacy', engines: 1, stripes: 0 });
  legacy.pal = { ...LEGACY_PAL };

  return { LINEAGES, create, descend, kitbash, forGalaxy, legacy };
})();

if (typeof module !== 'undefined') module.exports = ArtCulture;
