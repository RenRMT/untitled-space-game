// Design cultures for the procedural art.
//
// A culture is a small set of design-language parameters that every asset generator reads:
// hull family, corner rounding, proportions, wing type, engine count, surface detail,
// asymmetry, station topology and a palette. Cultures come from two sources:
// - lineages: hand-tuned design traditions, sampled within their ranges per system. Settled
//   stations are built in the three human ones (wedge, block, shard; world/solar-system.js); alien
//   (organic) and android (machine) are non-human cultures, made with xeno(seed),
// - kitbash: pirates assemble each asset from parts of the three.
// The culture's map colour becomes the accent (markings, line art).
// ES module (`ArtCulture`); also runs in Node (the tests).

import { ArtUtil } from './util.js';
import { hashInt, mulberry32, seedToInt } from '../core/rng.js';

const ArtCulture = (() => {
  const U = ArtUtil;

  // Numeric fields are [min, max] ranges; arrays of strings are options picked per culture.
  const LINEAGES = {
    wedge: {
      label: 'Wedge', note: 'Angular deltas with blunt sterns; spoked wheel stations on a solar spine.',
      hull: 'wedge', round: [0, 0.05], length: [0.95, 1.15], width: [0.95, 1.1], span: [0.9, 1.15], sweep: [0.45, 0.75],
      wings: ['delta', 'swept'], engines: [1, 2], greeble: [0.35, 0.6], asym: [0, 0], stripes: [1, 2],
      insignia: ['chevron', 'bar'], station: 'wheel', arrays: 'solar',
      colors: { hull: '#c3cbd5', hull2: '#7a8696', trim: '#e6ecf2', glass: '#7df9ff', light: '#b6ff8a', flame: '#ffb347', panel: '#2f5aa0' },
    },
    block: {
      label: 'Block', note: 'Modular slabs and side pods; lattice stations of stacked modules and radiator fins.',
      hull: 'block', round: [0, 0.08], length: [1.0, 1.2], width: [1.1, 1.3], span: [0.6, 0.85], sweep: [0, 0.2],
      wings: ['pods', 'fins'], engines: [2, 4], greeble: [0.65, 0.95], asym: [0, 0.1], stripes: [1, 3],
      insignia: ['bar', 'diamond'], station: 'lattice', arrays: 'radiator',
      colors: { hull: '#b9b59b', hull2: '#6e6a52', trim: '#d9d4b6', glass: '#ffd66b', light: '#ff9a3c', flame: '#fff2b3', panel: '#8a8f96' },
    },
    shard: {
      label: 'Shard', note: 'Needle prows and blade wings; radial crystal stations.',
      hull: 'shard', round: [0, 0], length: [1.15, 1.4], width: [0.8, 0.95], span: [0.85, 1.2], sweep: [0.65, 0.95],
      wings: ['blade', 'delta'], engines: [1, 1], greeble: [0.05, 0.2], asym: [0, 0.15], stripes: [0, 1],
      insignia: ['diamond', 'chevron'], station: 'star', arrays: 'none',
      colors: { hull: '#646b7d', hull2: '#363b48', trim: '#9aa3b8', glass: '#c77dff', light: '#e0b0ff', flame: '#c77dff', panel: '#4a3a6a' },
    },
    // Non-human cultures. `wing`, `engine` and `strut` colours override render.js's metal defaults.
    alien: {
      label: 'Alien', note: 'Grown, not built: lobed seed-pod hulls, frond and membrane wings, bioluminescent eyes and spots; hive stations of cells and tendrils.',
      hull: 'bio', round: [0.75, 1], length: [0.9, 1.1], width: [1.1, 1.35], span: [0.8, 1.1], sweep: [0.5, 0.9],
      wings: ['fronds', 'membrane'], engines: [1, 3], greeble: [0.4, 0.7], asym: [0.05, 0.2], stripes: [2, 4],
      insignia: ['eye'], station: 'hive', arrays: 'none',
      colors: { hull: '#7a5a6e', hull2: '#4a3048', trim: '#c9a883', glass: '#9dff6a', light: '#c4ff5a', flame: '#9dff6a', panel: '#5a7a3a', wing: '#8e6470', engine: '#2a1a24', strut: '#5a3a4e' },
    },
    android: {
      label: 'Android', note: 'Machine geometry with no crew to house: stepped right-angle hulls, detached vane wings and floating cargo cubes, sensor slits for cockpits, circuit traces; monolith stations ringed by orbiting cubes.',
      hull: 'synth', round: [0, 0], length: [1.0, 1.1], width: [0.9, 1.0], span: [0.9, 1.1], sweep: [0, 0],
      wings: ['vanes', 'halo'], engines: [2, 2], greeble: [0.5, 0.8], asym: [0, 0], stripes: [1, 2],
      insignia: ['square'], station: 'monolith', arrays: 'none',
      colors: { hull: '#22262d', hull2: '#3a4048', trim: '#e8ecf0', glass: '#e6f6ff', light: '#5ad8ff', flame: '#9ae8ff', panel: '#14181e', wing: '#2c3139', engine: '#0c0e12', strut: '#4a515b' },
    },
  };
  const HUMAN = ['wedge', 'block', 'shard']; // what pirates and settled systems draw from
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
    for (const k of ['wing', 'engine', 'strut']) if (colors[k]) pal[k] = colors[k];
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
    c.pal = palette(L.colors, accent, r);
    return Object.assign(c, extra);
  }

  // Drifters (kitbash): freelancers, salvagers, explorers and outlaws on the periphery. Each asset
  // is rebuilt from parts of the three human cultures, patched and kept flying.
  function kitbash(donors, seed, accent, extra = {}) {
    const r = mulberry32(seed >>> 0);
    const base = create(pickFrom(HUMAN, r), seed, accent);
    const c = {
      ...base, lineage: 'kitbash', label: 'Kitbash', note: 'Freelancers, salvagers, explorers and outlaws on the periphery. Hulls rebuilt from Wedge, Block and Shard parts: mismatched wings and engines, strapped-on tanks, trusses where segments used to be.',
      donors, asym: 0.4, greeble: 0.75,
    };
    c.pal = {
      ...base.pal, hull: '#8f877a', hull2: '#4f4a42', trim: '#b8ad98', glass: '#9fe0d0', light: '#ffc85a', flame: '#ffb050', panel: '#3e5a66',
      strut: '#6a645a', engine: '#3a3631',
    };
    return Object.assign(c, extra);
  }

  // The cultures of a generated galaxy: those its stations are built in (galaxy.cultures: lineage,
  // colour), the androids among them being xeno(seed)'s, and the pirates (the Drifters), who
  // kitbash from the three human ones and build the Drifters' stations too.
  //   of(cultureId) -> the culture with that id (world/solar-system.js CULTURES), pirates -> the pirates' culture
  function forGalaxy(galaxy) {
    const base = seedToInt(galaxy.seed);
    const human = new Map(galaxy.cultures.filter((c) => HUMAN.includes(c.lineage))
      .map((c) => [c.id, create(c.lineage, hashInt(base, c.id, 0xa47), c.color, { cultureId: c.id, name: c.name, color: c.color, kind: 'settled' })]));
    // Kept under `pirates` for the game's code; shown as the Drifters.
    const pirates = kitbash([...human.values()], hashInt(base, 99, 0xa47), '#d8824a', { name: 'Drifters', color: '#d8824a', kind: 'pirates' });
    const settled = galaxy.cultures.map((c) => (c.lineage === 'android' ? Object.assign(xeno(galaxy.seed).android, { cultureId: c.id })
      : c.lineage === 'kitbash' ? Object.assign(pirates, { cultureId: c.id }) : human.get(c.id)));
    return { cultures: settled, pirates, of: (id) => settled[id] || settled[0] };
  }

  const legacy = create('wedge', 1, '#7df9ff', { name: 'Original', kind: 'legacy', engines: 1, stripes: 0 });
  legacy.pal = { ...LEGACY_PAL };

  // The non-human cultures for a system seed: { alien, android }.
  function xeno(seed) {
    const base = seedToInt(seed);
    return {
      alien: create('alien', hashInt(base, 50, 0xa47), '#c86ad8', { name: 'Alien', color: '#c86ad8', kind: 'alien' }),
      android: create('android', hashInt(base, 51, 0xa47), '#4fd8ff', { name: 'Android', color: '#4fd8ff', kind: 'android' }),
    };
  }

  return { LINEAGES, HUMAN, create, kitbash, forGalaxy, xeno, legacy };
})();

export { ArtCulture };
