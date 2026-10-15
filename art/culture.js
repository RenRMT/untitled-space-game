'use strict';

// Design cultures for the procedural art.
//
// A culture is a small set of design-language parameters that every asset generator reads:
// hull family, corner rounding, proportions, wing type, engine count, surface detail,
// asymmetry, station topology and a palette. Cultures come from two sources:
// - lineages: three hand-tuned design traditions (below: wedge, block, shard), sampled within
//   their ranges per galaxy; settled systems are built in one of them (galaxy.js),
// - kitbash: pirates assemble each asset from parts of the three.
// The culture's map colour becomes the accent (markings, line art).
// Works as a classic browser script (global `ArtCulture`) and as a Node module.

const ArtCulture = (() => {
  const isNode = typeof require === 'function' && typeof module !== 'undefined';
  const U = isNode ? require('./util.js') : ArtUtil;
  const { mulberry32, hashInt, seedToInt } = isNode ? require('../rng.js') : globalThis;

  // Numeric fields are [min, max] ranges; arrays of strings are options picked per culture.
  const LINEAGES = {
    wedge: {
      label: 'Wedge', note: 'Angular deltas with blunt sterns; spoked wheel stations on a solar spine.', gate: 'ring', gateNote: 'Gates are clamped rings on solar-panelled anchor arms.',
      hull: 'wedge', round: [0, 0.05], length: [0.95, 1.15], width: [0.95, 1.1], span: [0.9, 1.15], sweep: [0.45, 0.75],
      wings: ['delta', 'swept'], engines: [1, 2], greeble: [0.35, 0.6], asym: [0, 0], stripes: [1, 2],
      insignia: ['chevron', 'bar'], station: 'wheel', arrays: 'solar',
      colors: { hull: '#c3cbd5', hull2: '#7a8696', trim: '#e6ecf2', glass: '#7df9ff', light: '#b6ff8a', flame: '#ffb347', panel: '#2f5aa0' },
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
  };
  const NUMERIC = ['round', 'length', 'width', 'span', 'sweep', 'greeble', 'asym'];
  const PALETTE_KEYS = ['hull', 'hull2', 'trim', 'glass', 'light', 'flame', 'panel'];

  // The original game palette, used by the player ship.
  const LEGACY_PAL = {
    hull: '#d8dde3', hull2: '#7a8696', trim: '#eef1f4', glass: '#2fb8c8', light: '#b6ff8a', flame: '#ffb347',
    panel: '#2f5aa0', accent: '#7df9ff', line: '#7df9ff',
  };

  const pickFrom = (list, r) => list[Math.floor(r() * list.length)];

  function palette(colors, accent, r) {
    const acc = U.tune(accent, { s: [0.45, 1], l: [0.45, 0.62] });
    const pal = {};
    // A faint tint of the culture's colour on the hull plus a little jitter.
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
    c.gate = L.gate; // the form of its jump gates (art/blueprints.js)
    c.pal = palette(L.colors, accent, r);
    return Object.assign(c, extra);
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

  // The cultures of a generated galaxy: the three its settled systems are built in
  // (galaxy.cultures: lineage, colour), and the pirates, who kitbash from all three.
  //   of(cultureId) -> the culture with that id (galaxy.js CULTURES), pirates -> the pirates' culture
  function forGalaxy(galaxy) {
    const base = seedToInt(galaxy.seed);
    const settled = galaxy.cultures.map((c) => create(c.lineage, hashInt(base, c.id, 0xa47), c.color, { cultureId: c.id, name: c.name, color: c.color, kind: 'settled' }));
    const pirates = kitbash(settled, hashInt(base, 99, 0xa47), '#ff4d4d', { name: 'Pirates', color: '#ff4d4d', kind: 'pirates' });
    return { cultures: settled, pirates, of: (id) => settled[id] || settled[0] };
  }

  const legacy = create('wedge', 1, '#7df9ff', { name: 'Original', kind: 'legacy', engines: 1, stripes: 0 });
  legacy.pal = { ...LEGACY_PAL };

  return { LINEAGES, create, kitbash, forGalaxy, legacy };
})();

if (typeof module !== 'undefined') module.exports = ArtCulture;
