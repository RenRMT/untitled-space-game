// Planet surfaces: the ground the player flies over when landed in a planet's atmosphere, in the
// line and lowpoly styles. Same camera as the low-poly assets (orthographic, Art.config.tilt from
// straight down, heights rising up the screen) and the same world light (Art.kit.LIGHT).
//
// A surface is a grid of T×T tiles built from three corner grids, so any layout is seamless:
//   C[i][j] 0/1: high ground. Each tile takes its cliff piece from its four corners (marching
//     squares: plateau, edge, outer corner, inner corner, saddle, rotated). Cut points sit on the
//     shared tile edges at a seeded offset, so neighbours meet. On gas giants the same grid marks
//     storm fronts instead: no solid geometry, the cloud deck churns up and darkens there.
//   G[i][j] 0..1: weight between the biome's ground kinds a (1) and b (0).
//   G2[i][j] 0..1: weight of the third ground kind c, over the other two.
// Biomes with a sea (terrain) flood everything below sea level; ground kind b is the sea floor.
// Open tiles get at most one prop, picked from the biome's variants for land or water:
//   small (passable clutter), hole (a depression; may hold water or glow), tall (blocks flight:
//   a rock column, or on gas giants a storm pocket).
// Cliffs, storm fronts and tall props rise above FLY and block.
//
//   const w = ArtSurface.generate(planetType, seed, { w, h, cover, tall, site })
//   ArtSurface.generateSteps(planetType, seed, o)  // the same as a generator: a row at each next()
//   ArtSurface.render(w, style, { dpr }) -> { canvas, w, h, pad }   // whole surface; cache it
//   ArtSurface.renderRegion(w, style, { i0, j0, i1, j1, dpr }) -> layer  // tiles [i0, i1) × [j0, j1)
//   ArtSurface.renderRegionSteps(w, style, o)  // the same as a generator: a little of the work at each next()
//   ArtSurface.farImage(w, style) -> layer                          // the whole surface, low detail
//   ArtSurface.farBuilder(w, style) -> { step(budgetMs) -> done, layer }  // ... built across frames
//   ArtSurface.draw(ctx, w, style, { lw, extra, region })           // ctx maps projected units
//   ArtSurface.drawLive(ctx, w, style, t, { lw, all })             // lightning in storms
//   ArtSurface.blocked(w, x, y, r), overlay(w) -> { fill, edge } at flight altitude
//   ArtSurface.siteDist(w, x, y)   // how far (x, y) is outside the landing site's edge (< 0: inside)
//   A layer: { canvas, x0, y0, sx, sy }: canvas px = (x − x0)·sx across, (projected y − y0)·sy down.
//   site: [i0, j0, i1, j1], the landing site's corners in tiles, ringed by a natural rim: cliffs (or
//     storm fronts) with gaps to fly through, or open sea on worlds with a sea. W.site.leave: how far
//     past the edge the player has left the site.
//   ArtSurface.sample(type, kind)  // 3×3 world showing one asset in its centre tile (asset sheets);
//     kind: a | b | c | plateau | edge | outer | inner | saddle | small0.. | hole0.. | tall0..
//   ArtSurface.project(w, x, y, z), heightAt(w, x, y), shadowShift(z), BIOMES, TYPES, SURFACE_OF, T, FLY, PAD
//   Moons: generate(moonSurface(moonType), …); one template per ArtBodies moon type, colour only (MOON_SURFACES).
// ES module (`ArtSurface`); needs a browser.

import { Art } from './render.js';
import { ArtBodies } from './bodies.js';

const ArtSurface = (() => {
  const T = 64, TAU = Math.PI * 2, FLY = 30, PAD = 50;
  const nrm = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const sstep = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const hex = (c) => [1, 3, 5].map((k) => parseInt(c.slice(k, k + 2), 16));
  const mixc = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
  const rgb = (c, k = 1, a = 1) => `rgba(${Math.min(255, c[0] * k) | 0},${Math.min(255, c[1] * k) | 0},${Math.min(255, c[2] * k) | 0},${a})`;
  const hash = (a, b, c) => { let h = (a * 374761393 + b * 668265263 + c * 1274126177) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16; return (h >>> 0) / 4294967296; };
  const vnoise = (x, y, s) => {
    const xi = Math.floor(x), yi = Math.floor(y); let u = x - xi, v = y - yi; u = u * u * (3 - 2 * u); v = v * v * (3 - 2 * v);
    return lerp(lerp(hash(xi, yi, s), hash(xi + 1, yi, s), u), lerp(hash(xi, yi + 1, s), hash(xi + 1, yi + 1, s), u), v);
  };
  const fbm = (x, y, s) => vnoise(x, y, s) * 0.57 + vnoise(x * 2.1, y * 2.1, s + 17) * 0.29 + vnoise(x * 4.3, y * 4.3, s + 31) * 0.14;
  const tkey = (i, j) => i * 1000 + j;
  const BG = () => Art.config.bg || '#05060a';
  const LIGHT = () => nrm(Art.kit.LIGHT);
  const shadowShift = (z) => { const L = LIGHT(); return [(-L[0] / L[2]) * z, (-L[1] / L[2]) * z]; };

  // Tall prop profiles: rings [z, r] from the ground up; the last ring is capped. lean: how far the
  // top drifts sideways (seeded direction).
  const PROFILES = {
    hoodoo: { sides: 7, rings: [[0, 13], [30, 10.5], [31, 9], [56, 6.5], [60, 11.5], [70, 10.5]] },
    butte: { sides: 9, rings: [[0, 21], [44, 18], [45, 16.5], [62, 16]] },
    tor: { sides: 8, rings: [[0, 13], [14, 14.5], [16, 10], [30, 12.5], [32, 8], [46, 10], [48, 6], [62, 8], [66, 5]], lean: 4 },
    seastack: { sides: 6, rings: [[0, 10], [5, 7.5], [9, 11], [44, 10], [52, 8], [64, 7.5]], lean: 5 },
    shard: { sides: 4, rings: [[0, 11], [44, 6.5], [72, 0.6]], lean: 12 },
    tower: { sides: 10, rings: [[0, 12], [24, 14.5], [46, 13], [62, 16.5], [70, 14]] },
    spike: { sides: 3, rings: [[0, 15], [8, 11], [40, 5], [68, 0.8]], lean: 6 },
    columns: { sides: 6, rings: [[0, 13], [56, 12], [57, 9.5], [66, 9]] },
    peak: { sides: 9, rings: [[0, 21], [10, 16], [24, 10], [40, 5], [54, 1.5]] },
    block: { sides: 4, rings: [[0, 14], [6, 15], [44, 13], [50, 8.5]], lean: 8 },
  };
  // Small clutter: n pieces of radius r, height r × hMul, top ring at r × taper, apex r × apex above.
  // trees: a cone on the ground (no trunk: the cone hides it from this camera). Kept to a few pieces
  // each: they're a large share of what a chunk of surface has to build and draw.
  const SMALL = {
    rocks: { n: [2, 4], r: [3, 7], sides: 6, hMul: [0.7, 1.2], taper: 0.7, apex: 0.3 },
    skerries: { n: [2, 4], r: [3, 6], sides: 6, hMul: [0.25, 0.45], taper: 0.75, apex: 0.2 },
    seracs: { n: [2, 3], r: [4, 7], sides: 4, hMul: [1.2, 1.8], taper: 0.55, apex: 0.2 },
    drifts: { n: [2, 4], r: [5, 9], sides: 8, hMul: [0.3, 0.5], taper: 0.8, apex: 0.3 },
    scrub: { n: [3, 5], r: [2.5, 4], sides: 7, hMul: [0.5, 0.8], taper: 0.75, apex: 0.4 },
    cones: { n: [2, 3], r: [4, 6], sides: 6, hMul: [1, 1.4], taper: 0.3, apex: 0.1 },
    puffs: { n: [2, 4], r: [5, 9], sides: 9, hMul: [0.5, 0.8], taper: 0.8, apex: 0.45 },
    wisps: { n: [3, 4], r: [4, 7], sides: 8, hMul: [0.3, 0.5], taper: 0.85, apex: 0.35 },
    trees: { n: [3, 5], r: [4, 6.5], sides: 6, trees: true },
  };

  // One entry per surface type, colours from the matching planet palettes (render.js PLANETS).
  // Ground kinds a, b, c: amp (dune height), wave (dune wavelength), rough (noise height), base
  // (height offset), cracks / speck (line colours of crack lines / grit), emit (glows).
  // sea: everything below level is water, shaded shallow → deep. storm: C marks storm fronts.
  // small / hole / tall: prop variants; on: 'land' (default) or 'water'. cSmall: the small variant
  // that crowds ground kind c. hatch: false for gas (Line style never hatches gas).
  const B = {
    desert: {
      label: 'Desert', line: '#ffc08a', hatch: true,
      a: { name: 'Dune sea', sub: 'Asymmetric ripples; lee slopes shaded', col: '#c9774a', amp: 7, wave: 88, rough: 2.4 },
      b: { name: 'Hardpan', sub: 'Flat, cracked', col: '#e2aa72', amp: 0, rough: 2.4, cracks: '#8c5a35' },
      c: { name: 'Gravel reg', sub: 'Stony plain, dark grit', col: '#b8693e', amp: 0.6, wave: 60, rough: 1.6, speck: '#5a2e18' },
      high: { name: 'Mesa', top: '#b8673d', wall: '#a8582f', strata: '#d9925a', h: 56, prof: [[0, 9], [0.28, 2], [0.28, 0, 'strata'], [1, 0]], jit: 0.3 },
      small: [
        { name: 'Boulders', sub: '2–4 rocks, below flight altitude', kind: 'rocks', col: '#9a5030' },
        { name: 'Dry scrub', sub: 'Low thorn bushes', kind: 'scrub', col: '#7a6a3a' },
      ],
      cSmall: 0,
      hole: [
        { name: 'Crater', sub: 'Pressed into the ground height', r: 19, d: 7, floor: '#a8582f' },
        { name: 'Sinkhole', sub: 'Narrow, deep pit', r: 12, d: 11, floor: '#4a2414' },
      ],
      tall: [
        { name: 'Spire', sub: 'Hoodoo column, 70 units tall', kind: 'hoodoo', col: '#a8582f', col2: '#d9925a', top: '#b8673d' },
        { name: 'Butte', sub: 'Flat-topped mass, 62 units tall', kind: 'butte', col: '#a8582f', col2: '#d9925a', top: '#b8673d' },
      ],
      p: { near: 0.4, far: 0.06 },
    },
    terran: {
      label: 'Terran', line: '#8ad0ff', hatch: true,
      a: { name: 'Meadow', sub: 'Rolling grass, long low swells', col: '#5f9a48', amp: 4, wave: 150, rough: 3, base: 1.5 },
      b: { name: 'Ocean', sub: 'Below sea level; shallows lighter', col: '#2f6fa8', amp: 1.5, wave: 70, rough: 1.5, base: -7 },
      c: { name: 'Woodland', sub: 'Darker floor; copses crowd here', col: '#3d6e34', amp: 2, wave: 90, rough: 3.5, base: 2 },
      sea: { level: 0, shallow: '#3f7fc0', deep: '#1d3b6e', sand: '#d9c38a', foam: '#eef2f4' },
      high: { name: 'Crag', top: '#4f8a3c', wall: '#7a6a5a', strata: '#a09080', h: 56, prof: [[0, 6], [0.35, 3.5], [0.38, 1.5], [0.7, 0.8], [0.72, 0], [1, 0]], jit: 0.8 },
      small: [
        { name: 'Copse', sub: '3–5 conifers, below flight altitude', kind: 'trees', col: '#2e5e2e' },
        { name: 'Boulders', sub: 'Grey rocks in the grass', kind: 'rocks', col: '#7a6a5a' },
        { name: 'Skerries', sub: 'Low rocks awash', kind: 'skerries', col: '#7a6a5a', on: 'water' },
      ],
      cSmall: 0,
      hole: [{ name: 'Pond', sub: 'Hollow filled with water', r: 19, d: 7, floor: '#2e5e2e', water: '#3f7fc0' }],
      tall: [
        { name: 'Tor', sub: 'Stacked boulders, 66 units tall', kind: 'tor', col: '#7a6a5a', col2: '#a09080', top: '#4f8a3c' },
        { name: 'Sea stack', sub: 'Wave-cut notch at the waterline', kind: 'seastack', col: '#7a6a5a', col2: '#a09080', top: '#eef2f4', on: 'water' },
      ],
      p: { near: 0.3, far: 0.16 },
    },
    ice: {
      label: 'Ice', line: '#cfeaff', hatch: true,
      a: { name: 'Snowfield', sub: 'Wind-cut sastrugi ridges', col: '#dcebf4', amp: 4, wave: 48, rough: 1.6 },
      b: { name: 'Glare ice', sub: 'Flat, fractured', col: '#a7cbe2', amp: 0, rough: 1, cracks: '#5d8fbd' },
      c: { name: 'Pressure ridges', sub: 'Short, steep ice ridges', col: '#c4dcea', amp: 3.5, wave: 24, rough: 3 },
      high: { name: 'Ice shelf', top: '#f4f9fc', wall: '#5d8fbd', strata: '#a7cbe2', h: 56, prof: [[0, -3], [0.22, -3], [0.26, 0, 'crev'], [1, 0]] },
      small: [
        { name: 'Seracs', sub: 'Leaning ice blocks', kind: 'seracs', col: '#a7cbe2' },
        { name: 'Snow drifts', sub: 'Soft low mounds', kind: 'drifts', col: '#eef6fb' },
      ],
      cSmall: 0,
      hole: [
        { name: 'Ice hole', sub: 'A dark pit in the ice', r: 14, d: 9, floor: '#2c4f73' },
        { name: 'Frost crater', sub: 'Shallow, rimmed bowl', r: 19, d: 6, floor: '#a7cbe2' },
      ],
      tall: [
        { name: 'Ice shard', sub: 'Leaning crystal blade, 72 units tall', kind: 'shard', col: '#a7cbe2', col2: '#dcebf4', top: '#ffffff' },
        { name: 'Frozen tower', sub: 'Bulging ice column, 70 units tall', kind: 'tower', col: '#5d8fbd', col2: '#a7cbe2', top: '#ffffff' },
      ],
      p: { near: 0.4, far: 0.07 },
    },
    lava: {
      label: 'Lava', line: '#ff9a5a', hatch: true,
      a: { name: 'Basalt plain', sub: 'Rough, broken ground', col: '#4a3a34', amp: 2.5, wave: 40, rough: 4 },
      b: { name: 'Lava flow', sub: 'Glowing, crusted plates', col: '#ff6a1a', amp: 0, rough: 0.8, cracks: '#2a201d', emit: true },
      c: { name: 'Ash field', sub: 'Smooth grey ash, cinders', col: '#6a5c58', amp: 1.5, wave: 120, rough: 1, speck: '#2a201d' },
      high: { name: 'Basalt mesa', top: '#6a554c', wall: '#4a3a34', strata: '#8a6e60', h: 56, prof: [[0, 5], [0.14, 3], [0.14, 0, 'cols'], [1, 0]], jit: 0.2 },
      small: [
        { name: 'Rubble', sub: 'Basalt blocks', kind: 'rocks', col: '#4a3a34' },
        { name: 'Fumaroles', sub: 'Small cones, glowing tips', kind: 'cones', col: '#3b2a26', top: '#ffb03a', emit: true },
      ],
      cSmall: 1,
      hole: [
        { name: 'Vent', sub: 'Crater with a glowing floor', r: 19, d: 7, floor: '#ffb03a', emit: true },
        { name: 'Lava lake', sub: 'Hollow filled with lava', r: 20, d: 7, floor: '#3b2a26', water: '#ff6a1a', emit: true },
      ],
      tall: [
        { name: 'Obsidian spike', sub: 'Three-sided leaning blade, 68 units tall', kind: 'spike', col: '#2a201d', col2: '#4a3a34', top: '#3b2a26' },
        { name: 'Basalt columns', sub: 'Hexagonal stack, 66 units tall', kind: 'columns', col: '#3b2a26', col2: '#6a554c', top: '#4a3a34' },
      ],
      p: { near: 0.4, far: 0.06 },
    },
    gas: {
      label: 'Gas giant', line: '#ffcf94', hatch: false, fluid: true,
      a: { name: 'Cloud deck', sub: 'Billowing bands', col: '#cf9358', amp: 7, wave: 140, rough: 3 },
      b: { name: 'Haze', sub: 'Smooth, banded', col: '#ecc994', amp: 0.8, rough: 1.2 },
      c: { name: 'Ammonia streaks', sub: 'Pale, stretched bands', col: '#f3dcae', amp: 2, wave: 220, rough: 0.6 },
      storm: { col: '#5a3424', deep: '#3a2016', bolt: '#fff3c8' },
      high: { name: 'Storm front', sub: 'Churning dark cloud, lightning', h: 0 },
      small: [
        { name: 'Cloudlets', sub: 'Low puffs', kind: 'puffs', col: '#ecc994' },
        { name: 'Wisps', sub: 'Flat, pale puffs', kind: 'wisps', col: '#f3dcae' },
      ],
      cSmall: 1,
      hole: [{ name: 'Downdraft', sub: 'A funnel in the cloud deck', r: 20, d: 8, floor: '#9a5a34' }],
      tall: [{ name: 'Storm pocket', sub: 'Small spiralling storm', kind: 'pocket', r: 16 }],
      p: { near: 0.3, far: 0.08 },
    },
  };
  // Moons: one surface template (regolith, dark maria, bright ejecta, highland scarps, craters),
  // coloured from each moon type's palette in bodies.js MOONS (c: base, dark, light; line).
  const mixHex = (a, b, t) => '#' + mixc(hex(a), hex(b), t).map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
  for (const [id, m] of Object.entries(ArtBodies.MOONS)) {
    const [base, dark, light] = m.c, rock = mixHex(dark, base, 0.5), top = mixHex(base, light, 0.25);
    B['moon-' + id] = {
      label: 'Moon · ' + m.label, moon: id, line: m.line, hatch: true,
      a: { name: 'Regolith', sub: 'Dusty, gently rolling', col: base, amp: 1.5, wave: 70, rough: 2.2 },
      b: { name: 'Mare', sub: 'Flat, darker plain', col: mixHex(dark, base, 0.35), amp: 0, rough: 0.8 },
      c: { name: 'Ejecta', sub: 'Bright rays, scattered grit', col: mixHex(base, light, 0.6), amp: 0.6, wave: 40, rough: 1.4, speck: dark },
      high: { name: 'Highland scarp', top, wall: dark, strata: base, h: 56, prof: [[0, 14], [0.22, 9], [0.26, 6.5], [0.5, 3.5], [0.54, 1], [1, 0]], jit: 0.5 },
      small: [
        { name: 'Boulders', sub: 'Ejected blocks, below flight altitude', kind: 'rocks', col: rock },
        { name: 'Dust mounds', sub: 'Soft low regolith heaps', kind: 'drifts', col: base },
      ],
      cSmall: 0,
      hole: [
        { name: 'Crater', sub: 'Rimmed bowl, dark floor', r: 19, d: 7, floor: dark },
        { name: 'Pit', sub: 'Narrow collapse pit', r: 12, d: 11, floor: mixHex(dark, '#000000', 0.5) },
      ],
      tall: [
        { name: 'Central peak', sub: 'Broad rubble cone, 54 units tall', kind: 'peak', col: dark, col2: base, top },
        { name: 'Ejecta block', sub: 'Tilted megablock, 50 units tall', kind: 'block', col: dark, col2: base, top },
      ],
      p: { near: 0.4, far: 0.06 },
    };
  }
  for (const b of Object.values(B)) {
    b.LN = hex(b.line);
    for (const k of ['a', 'b', 'c']) { b[k].c = hex(b[k].col); if (b[k].cracks) b[k].cc = hex(b[k].cracks); if (b[k].speck) b[k].sc = hex(b[k].speck); }
    if (b.high.top) b.high.c = { top: hex(b.high.top), wall: hex(b.high.wall), strata: hex(b.high.strata) };
    if (b.sea) b.sea.c = { shallow: hex(b.sea.shallow), deep: hex(b.sea.deep), sand: hex(b.sea.sand), foam: hex(b.sea.foam) };
    if (b.storm) b.storm.c = { col: hex(b.storm.col), deep: hex(b.storm.deep), bolt: hex(b.storm.bolt) };
    for (const v of b.small) { v.c = hex(v.col); if (v.col2) v.c2 = hex(v.col2); if (v.top) v.ct = hex(v.top); }
    for (const v of b.hole) { v.c = hex(v.floor); if (v.water) v.w = hex(v.water); }
    for (const v of b.tall) if (v.col) { v.c = [hex(v.col), hex(v.col2)]; v.ct = hex(v.top); }
  }
  const TYPES = Object.keys(B);
  const PROPS = 0.6; // the share of each biome's small-prop chances (p) that get one: fewer to build and draw
  const SURFACE_OF = { desert: 'desert', terran: 'terran', blue: 'terran', ice: 'ice', lava: 'lava', gas: 'gas' };
  const MOON_SURFACES = TYPES.filter((t) => B[t].moon); // 'moon-' + bodies.js moon type
  const moonSurface = (moonType) => 'moon-' + moonType;

  const cam = (W) => { if (!W.cam) { const t = Art.config.tilt; W.cam = { st: Math.sin(t), ct: Math.cos(t) }; } return W.cam; };
  const project = (W, x, y, z) => { const c = cam(W); return [x, y * c.ct - z * c.st]; };

  function hull(pts) {
    const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lo = [], up = [];
    for (const q of p) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
    for (let k = p.length - 1; k >= 0; k--) { const q = p[k]; while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
    return lo.slice(0, -1).concat(up.slice(0, -1));
  }
  const tileOf = (W, x, y) => [clamp(Math.floor(x / T), 0, W.w - 1), clamp(Math.floor(y / T), 0, W.h - 1)];
  function corner(W, g, x, y) {
    const [i, j] = tileOf(W, x, y), fx = clamp(x / T - i, 0, 1), fy = clamp(y / T - j, 0, 1);
    return lerp(lerp(g[i][j], g[i + 1][j], fx), lerp(g[i][j + 1], g[i + 1][j + 1], fx), fy);
  }
  // Weights of ground kinds a, b, c at a point.
  function weights(W, x, y) { const w = corner(W, W.G, x, y), w2 = corner(W, W.G2, x, y); return [w * (1 - w2), (1 - w) * (1 - w2), w2]; }
  const propAt = (W, x, y) => W.props[tkey(...tileOf(W, x, y))];
  // Storm strength 0..1 at a point (gas giants): storm fronts from C, storm pockets from props.
  function storm(W, x, y) {
    const area = sstep(0.4, 0.6, corner(W, W.C, x, y)), pr = propAt(W, x, y);
    let pocket = 0, d = 0, th = 0;
    if (pr && pr.type === 'tall') { d = Math.hypot(x - pr.x, y - pr.y) / pr.r; th = Math.atan2(y - pr.y, x - pr.x); pocket = sstep(1.25, 0.75, d); }
    return { area, pocket, d, th, s: Math.max(area, pocket) };
  }
  function baseHeight(W, x, y) {
    const s = W.seed, bi = B[W.type], wt = weights(W, x, y), warp = 7 * fbm(x / 260, y / 260, s + 9);
    let z = 0, rough = 0;
    ['a', 'b', 'c'].forEach((k, n) => {
      const g = bi[k], w = wt[n]; if (w < 1e-4) return;
      let d = 0;
      if (g.amp) { const u = ((x * 0.74 + y * 0.67) / (g.wave || 80)) * TAU + warp; d = g.amp * (0.5 + 0.5 * Math.sin(u + 0.75 * Math.sin(u))); }
      z += w * (d + (g.base || 0)); rough += w * g.rough;
    });
    z += rough * vnoise(x / 46, y / 46, s + 3);
    if (bi.storm) {
      const st = storm(W, x, y);
      z += st.area * (5 + 9 * fbm(x / 26, y / 26, s + 71));
      if (st.pocket) z += st.pocket * (6 + 5 * Math.sin(3 * st.th + 9 * st.d));
    }
    return z;
  }
  // Height of the solid (or cloud) surface, before the sea; holes included.
  function rawHeight(W, x, y) {
    let z = baseHeight(W, x, y);
    const pr = propAt(W, x, y);
    if (pr && pr.type === 'hole') {
      const v = B[W.type].hole[pr.v], d = Math.hypot(x - pr.x, y - pr.y) / v.r;
      if (d < 1) z -= v.d * (1 - d * d);
      z += v.d * 0.55 * Math.exp(-(((d - 1) / 0.28) ** 2));
      if (v.w && d < 1) { if (pr.wl === undefined) pr.wl = baseHeight(W, pr.x, pr.y) - v.d * 0.5; z = Math.max(z, pr.wl); }
    }
    return z;
  }
  // The surface the player sees: water level where the sea covers the ground.
  function heightAt(W, x, y) { const z = rawHeight(W, x, y), sea = B[W.type].sea; return sea ? Math.max(z, sea.level) : z; }
  const topZ = (W, x, y) => B[W.type].high.h - 3 + 6 * vnoise(x / 34, y / 34, W.seed + 11);

  function makeProp(W, type, v, i, j) {
    const s = W.seed, bi = B[W.type];
    if (type === 'tall') return { type, v, x: (i + 0.5 + (hash(i, j, s + 41) - 0.5) * 0.3) * T, y: (j + 0.5 + (hash(i, j, s + 42) - 0.5) * 0.3) * T, r: bi.tall[v].r || PROFILES[bi.tall[v].kind].rings[0][1] };
    if (type === 'hole') return { type, v, x: (i + 0.5) * T + (hash(i, j, s + 43) - 0.5) * 8, y: (j + 0.5) * T + (hash(i, j, s + 44) - 0.5) * 8 };
    const sm = SMALL[bi.small[v].kind];
    return { type, v, n: sm.n[0] + Math.floor(hash(i, j, s + 45) * (sm.n[1] - sm.n[0] + 1)) };
  }
  // planetType: a planet type (Art.PLANET_TYPES) or a surface type. cover: share of corners that are
  // high ground; tall: chance an open tile gets a tall prop.
  function generate(planetType, seed, o = {}) {
    const g = generateSteps(planetType, seed, o);
    let r;
    while (!(r = g.next()).done);
    return r.value;
  }
  // The same as a generator, a row of the work at each next(); the last returns the surface. So a
  // big one can be made across frames.
  function* generateSteps(planetType, seed, o = {}) {
    const type = SURFACE_OF[planetType] || planetType, bi = B[type];
    const w = o.w || 28, h = o.h || 28, cover = o.cover ?? 0.22, tallP = o.tall ?? 0.035;
    seed = seed + TYPES.indexOf(type) * 1013; // each surface type lays out differently for the same seed
    const C = [], G = [], G2 = [], vals = [];
    for (let i = 0; i <= w; i++) {
      C[i] = []; G[i] = []; G2[i] = [];
      for (let j = 0; j <= h; j++) {
        const v = fbm(i * 0.21, j * 0.21, seed); C[i][j] = v; vals.push(v);
        G[i][j] = sstep(0.38, 0.62, fbm(i * 0.13 + 50, j * 0.13 + 20, seed + 5));
        G2[i][j] = sstep(0.55, 0.72, fbm(i * 0.17 + 90, j * 0.17 + 40, seed + 8));
      }
      yield;
    }
    vals.sort((a, b) => a - b);
    yield;
    const th = vals[Math.min(vals.length - 1, Math.floor((1 - cover) * vals.length))], cx = w >> 1, cy = h >> 1;
    for (let i = 0; i <= w; i++) for (let j = 0; j <= h; j++) C[i][j] = C[i][j] >= th && !(Math.abs(i - cx) <= 2 && Math.abs(j - cy) <= 2) ? 1 : 0;
    const W = { type, seed, w, h, C, G, G2, props: {}, start: [cx * T, cy * T] };
    if (o.site) yield* rim(W, o.site);
    for (let j = 0; j < h; j++, yield) for (let i = 0; i < w; i++) {
      if (C[i][j] || C[i + 1][j] || C[i][j + 1] || C[i + 1][j + 1]) continue;
      let near = false;
      for (let a = i - 1; a <= i + 2; a++) for (let b = j - 1; b <= j + 2; b++) if (C[a] && C[a][b]) near = true;
      const mx = (i + 0.5) * T, my = (j + 0.5) * T;
      const on = bi.sea && rawHeight(W, mx, my) < bi.sea.level - 0.5 ? 'water' : 'land';
      const pick = (list, salt) => { const ok = list.filter((v) => (v.on || 'land') === on); return ok.length ? list.indexOf(ok[Math.floor(hash(i, j, seed + salt) * ok.length)]) : -1; };
      const r = hash(i, j, seed * 7 + 1), start = Math.abs(i + 0.5 - cx) < 2 && Math.abs(j + 0.5 - cy) < 2;
      const inC = on === 'land' && bi.cSmall !== undefined && weights(W, mx, my)[2] > 0.5;
      let t = null, v = -1;
      if (!start && r < tallP) { t = 'tall'; v = pick(bi.tall, 51); }
      else if (r < tallP + PROPS * (inC ? 0.55 : near ? bi.p.near : bi.p.far)) { t = 'small'; v = inC ? bi.cSmall : pick(bi.small, 52); }
      else if (r > 0.955 && !start) { t = 'hole'; v = pick(bi.hole, 53); }
      if (t && v >= 0) W.props[tkey(i, j)] = makeProp(W, t, v, i, j);
    }
    return W;
  }
  // The landing site: a rounded rectangle (corner radius rc tiles, 0.4 of its width: nearly round).
  // siteDist in world units.
  function siteDist(W, x, y) {
    const st = W.site; if (!st) return -1e9;
    const qx = Math.abs(x / T - st.cx) - st.hx, qy = Math.abs(y / T - st.cy) - st.hy;
    return (Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - st.rc) * T;
  }
  // The rim round the landing site, a band of corners from a little inside its edge to a few tiles
  // out (the band meanders a few tiles either way, and its edges wander): high ground (storm fronts on gas giants) with gaps about a fifth of the
  // way round, or on worlds with a sea, open water.
  function* rim(W, [i0, j0, i1, j1]) {
    const { C, G, G2, seed } = W, bi = B[W.type], rc = 0.4 * Math.min(i1 - i0, j1 - j0);
    const cx = (i0 + i1) / 2, cy = (j0 + j1) / 2;
    W.site = { rect: [i0, j0, i1, j1], cx, cy, hx: (i1 - i0) / 2 - rc, hy: (j1 - j0) / 2 - rc, rc, leave: 9 * T };
    const gapN = (i, j) => { const a = Math.atan2(j - cy, i - cx); return fbm(Math.cos(a) * 2.6 + 40, Math.sin(a) * 2.6 + 40, seed + 63); };
    const ring = Array.from({ length: 360 }, (_, k) => gapN(cx + Math.cos((k / 180) * Math.PI), cy + Math.sin((k / 180) * Math.PI))).sort((a, b) => a - b);
    const gapAt = ring[Math.floor(ring.length * 0.8)];
    for (let i = 0; i <= W.w; i++, yield) for (let j = 0; j <= W.h; j++) {
      const e = siteDist(W, i * T, j * T) / T + 12 * (fbm(i * 0.05 + 31, j * 0.05 + 17, seed + 64) - 0.5), inner = -2 + 2.2 * fbm(i * 0.23 + 11, j * 0.23 + 5, seed + 61), outer = inner + 2 + 2.5 * fbm(i * 0.31 + 3, j * 0.31 + 9, seed + 62);
      if (e <= inner || e >= outer) continue;
      if (bi.sea) { G[i][j] = 0; G2[i][j] = 0; C[i][j] = 0; } else C[i][j] = gapN(i, j) > gapAt ? 0 : 1;
    }
  }
  const CARD_C = { plateau: [1, 1, 1, 1], edge: [1, 1, 0, 0], outer: [1, 0, 0, 0], inner: [1, 1, 0, 1], saddle: [1, 0, 1, 0] };
  function sample(type, kind) {
    type = SURFACE_OF[type] || type;
    const bi = B[type], m = /^(small|hole|tall)(\d+)$/.exec(kind), variant = m && bi[m[1]][+m[2]];
    let g = bi.sea ? 1 : 0.5, g2 = 0;
    if (kind === 'a') g = 1; else if (kind === 'b') g = 0; else if (kind === 'c') g2 = 1;
    if (variant && variant.on === 'water') g = 0;
    const C = [], G = [], G2 = [];
    for (let i = 0; i <= 3; i++) { C[i] = []; G[i] = []; G2[i] = []; for (let j = 0; j <= 3; j++) { C[i][j] = 0; G[i][j] = g; G2[i][j] = g2; } }
    const c = CARD_C[kind];
    if (c) { C[1][1] = c[0]; C[2][1] = c[1]; C[2][2] = c[2]; C[1][2] = c[3]; }
    const W = { type, seed: kind === 'saddle' ? 12 : 11, w: 3, h: 3, C, G, G2, props: {} };
    if (m) W.props[tkey(1, 1)] = makeProp(W, m[1], +m[2], 1, 1);
    return W;
  }

  const piecesAt = (W, i, j) => { const m = W.pieces || (W.pieces = {}), k = tkey(i, j); return m[k] || (m[k] = cliffPieces(W, i, j)); };
  function cliffPieces(W, i, j) {
    const C = W.C, s = W.seed, c = [C[i][j], C[i + 1][j], C[i + 1][j + 1], C[i][j + 1]], n = c[0] + c[1] + c[2] + c[3];
    if (!n) return [];
    const smooth = !!B[W.type].storm; // storm fronts follow the blended corner field: cuts at mid-edge, no crags
    const X0 = i * T, Y0 = j * T, X1 = X0 + T, Y1 = Y0 + T, cor = [[X0, Y0], [X1, Y0], [X1, Y1], [X0, Y1]];
    const tt = (a, b, q) => (smooth ? 0.5 : 0.3 + 0.4 * hash(a, b, s * 3 + q));
    const iso = (k) => {
      if (k === 0) return [X0 + tt(i, j, 101) * T, Y0];
      if (k === 1) return [X1, Y0 + tt(i + 1, j, 102) * T];
      if (k === 2) return [X0 + tt(i, j + 1, 101) * T, Y1];
      return [X0, Y0 + tt(i, j, 102) * T];
    };
    const raw = [];
    if (n === 2 && c[0] === c[2] && (smooth || hash(i, j, s + 77) < 0.5)) {
      for (let k = 0; k < 4; k++) if (c[k]) raw.push({ pts: [iso((k + 3) % 4), cor[k], iso(k)], cut: [false, false, true] });
    } else {
      const seq = [];
      for (let k = 0; k < 4; k++) { if (c[k]) seq.push({ p: cor[k], iso: false }); if (c[k] !== c[(k + 1) % 4]) seq.push({ p: iso(k), iso: true }); }
      raw.push({ pts: seq.map((q) => q.p), cut: seq.map((q, m) => q.iso && seq[(m + 1) % seq.length].iso) });
    }
    if (smooth) return raw;
    return raw.map((pc, pi) => {
      const out = { pts: [], cut: [] }, N = pc.pts.length;
      for (let m = 0; m < N; m++) {
        const a = pc.pts[m], b = pc.pts[(m + 1) % N];
        out.pts.push(a); out.cut.push(pc.cut[m]);
        if (!pc.cut[m]) continue;
        const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1, nx = dy / len, ny = -dx / len;
        for (const q of [1, 2]) {
          const t = q / 3 + (hash(i * 8 + m * 2 + q, j * 4 + pi, s + 57) - 0.5) * 0.12, o = (hash(i * 8 + m * 2 + q, j * 4 + pi, s + 58) - 0.5) * 14;
          out.pts.push([clamp(a[0] + dx * t + nx * o, X0, X1), clamp(a[1] + dy * t + ny * o, Y0, Y1)]); out.cut.push(true);
        }
      }
      return out;
    });
  }

  // Runs a generator (the *Steps functions below) to its end and returns what it returns.
  const run = (gen) => { let r; while (!(r = gen.next()).done); return r.value; };

  // Geometry in projected units, style-independent: the whole world's built once and kept; a
  // region's (tiles [i0, i1) × [j0, j1)) is built each time it's asked for.
  function build(W, reg) {
    return !reg && W.geo ? W.geo : run(buildSteps(W, reg));
  }
  // The same as a generator: a row of the work at each next() (renderRegionSteps). Each yield names
  // the work just done, for profiling.
  function* buildSteps(W, reg) {
    if (!reg && W.geo) return W.geo;
    const rg = reg || { i0: 0, j0: 0, i1: W.w, j1: W.h };
    const s = W.seed, bi = B[W.type], L = LIGHT(), { st, ct } = cam(W), VIEW = [0, st, ct], sea = bi.sea;
    const pp = (v) => [v[0], v[1] * ct - v[2] * st];
    const depth = (pts) => { let d = 0; for (const p of pts) d += p[1] * st + p[2] * ct; return d / pts.length; };
    const kOf = (n, sf) => { const m = sf ? nrm([n[0] * (1 - sf), n[1] * (1 - sf), n[2] * (1 - sf) + sf]) : n; return 0.24 + 0.95 * Math.max(0, dot(m, L)); };
    const g = { tris: [], major: [], coast: [], waves: [], lee: [], cracks: [], specks: [], shadow: new Path2D(), shade: [], raised: [], block: {}, talls: [], bolts: [], fronts: [], puffs: [], vortices: [] };
    const addShadow = (pts2, z) => {
      const [sx, sy] = shadowShift(z);
      const sh = hull(pts2.concat(pts2.map((p) => [p[0] + sx, p[1] + sy]))).map((p) => pp([p[0], p[1], heightAt(W, p[0], p[1])]));
      sh.forEach((q, k) => (k ? g.shadow.lineTo(q[0], q[1]) : g.shadow.moveTo(q[0], q[1])));
      g.shadow.closePath(); g.shade.push(sh);
    };
    const N = 4, gs = T / N, X0 = rg.i0 * N, Y0 = rg.j0 * N, GX = rg.i1 * N, GY = rg.j1 * N, V = [];
    for (let gy = Y0; gy <= GY; gy++, yield 'heights') {
      const row = (V[gy - Y0] = []);
      for (let gx = X0; gx <= GX; gx++) {
        const x = gx * gs + (gx > 0 && gx < W.w * N ? (hash(gx, gy, s + 21) - 0.5) * gs * 0.5 : 0);
        const y = gy * gs + (gy > 0 && gy < W.h * N ? (hash(gx, gy, s + 22) - 0.5) * gs * 0.5 : 0);
        const z = rawHeight(W, x, y);
        row[gx - X0] = [x, y, sea ? Math.max(z, sea.level) : z, z];
      }
    }
    const addTri = (a, b, c) => {
      let n = nrm(cross(sub(b, a), sub(c, a))); if (n[2] < 0) n = n.map((v) => -v);
      const mx = (a[0] + b[0] + c[0]) / 3, my = (a[1] + b[1] + c[1]) / 3, wt = weights(W, mx, my);
      let col = [0, 0, 0], k = kOf(n, 0), wash = 0;
      ['a', 'b', 'c'].forEach((q, m) => { col = col.map((v, i) => v + bi[q].c[i] * wt[m]); });
      if (bi.b.emit && wt[1] > 0.5) { k = 0.9 + 0.2 * Math.max(0, dot(n, L)); wash = 0.22 * (wt[1] - 0.5) * 2; }
      if (sea) {
        const raw = (a[3] + b[3] + c[3]) / 3;
        if (a[3] < sea.level && b[3] < sea.level && c[3] < sea.level) { col = mixc(sea.c.shallow, sea.c.deep, clamp((sea.level - raw) / 6, 0, 1)); k = 0.9; }
        else if ((a[2] + b[2] + c[2]) / 3 < sea.level + 1.1) col = mixc(col, sea.c.sand, 0.75);
      }
      if (bi.fluid) { g.tris.push({ pts: [pp(a), pp(b), pp(c)], col: cloudCol(W, mx, my, true), k: 0.55 + 0.6 * Math.max(0, dot(n, L)), wash: 0 }); return; }
      const pr = propAt(W, mx, my);
      if (pr && pr.type === 'hole') {
        const v = bi.hole[pr.v], d = Math.hypot(mx - pr.x, my - pr.y) / v.r;
        if (v.w && d < 1 && Math.abs(a[3] - pr.wl) + Math.abs(b[3] - pr.wl) + Math.abs(c[3] - pr.wl) < 0.05) { col = v.w; k = v.emit ? 1 : 0.9; if (v.emit) wash = 0.4; }
        else if (d < 1.05) {
          col = mixc(col, v.c, v.emit ? sstep(1, 0.4, d) : 0.45);
          if (v.emit && d < 0.75) { k = 1; wash = 0.5; }
        }
      }
      g.tris.push({ pts: [pp(a), pp(b), pp(c)], col, k, wash });
    };
    // A region drawn for its inner tiles (renderRegion) skips the ground cells in its margin, which
    // the clip would hide: all but the cell next to the inner tiles, and all the margin below (its
    // ground can rise into view).
    const inn = rg.inner, cx0 = inn ? inn.i0 * N - 1 : X0, cx1 = inn ? inn.i1 * N + 1 : GX, cy0 = inn ? inn.j0 * N - 1 : Y0;
    for (let gy = Math.max(Y0, cy0); gy < GY; gy++, yield 'ground') for (let gx = Math.max(X0, cx0); gx < Math.min(GX, cx1); gx++) {
      const a = V[gy - Y0][gx - X0], b = V[gy - Y0][gx - X0 + 1], c = V[gy - Y0 + 1][gx - X0 + 1], d = V[gy - Y0 + 1][gx - X0];
      if (hash(gx, gy, s + 23) < 0.5) { addTri(a, b, c); addTri(a, c, d); } else { addTri(a, b, d); addTri(b, c, d); }
    }
    // Contour lines and lee slopes only for a region drawn in the Line style (rg.lines, set by
    // renderRegion); the coast and waves for any with a sea. Neither: no contour grid at all.
    const lines = rg.lines !== false, contoured = lines || !!sea;
    const M = 6, ms = T / M, A0 = rg.i0 * M, B0 = rg.j0 * M, MX = rg.i1 * M, MY = rg.j1 * M, LV = 7.2, Z = [], R = []; // LV: the contour interval (only the major lines: the minor ones cost more than they showed)
    if (contoured) for (let b = B0; b <= MY; b++, yield 'contour heights') { const zr = (Z[b - B0] = []), rr = (R[b - B0] = []); for (let a = A0; a <= MX; a++) { const z = rawHeight(W, a * ms, b * ms); rr[a - A0] = z; zr[a - A0] = sea ? Math.max(z, sea.level) : z; } }
    const cross0 = (zz, q, lev) => {
      const pts = [];
      for (let e = 0; e < 4; e++) {
        const za = zz[e], zb = zz[(e + 1) % 4];
        if ((za < lev) !== (zb < lev)) { const t = (lev - za) / (zb - za), A = q[e], Bq = q[(e + 1) % 4]; pts.push(pp([lerp(A[0], Bq[0], t), lerp(A[1], Bq[1], t), lev])); }
      }
      return pts;
    };
    if (contoured) for (let b = B0; b < MY; b++, yield 'contours') for (let a = A0; a < MX; a++) {
      const zb = Z[b - B0], zn = Z[b - B0 + 1], ia = a - A0;
      const zz = [zb[ia], zb[ia + 1], zn[ia + 1], zn[ia]], x0 = a * ms, y0 = b * ms;
      const q = [[x0, y0], [x0 + ms, y0], [x0 + ms, y0 + ms], [x0, y0 + ms]];
      const lo = Math.min(...zz), hi = Math.max(...zz);
      if (lines) for (let li = Math.ceil(lo / LV); li * LV <= hi; li++) {
        if (sea && li * LV <= sea.level + 0.01) continue;
        const pts = cross0(zz, q, li * LV + 0.001);
        if (pts.length >= 2) g.major.push([pts[0], pts[1]]);
        if (pts.length === 4) g.major.push([pts[2], pts[3]]);
      }
      if (sea) {
        const pts = cross0(zz, q, sea.level + 0.001);
        if (pts.length >= 2) g.coast.push([pts[0], pts[1]]);
        if (pts.length === 4) g.coast.push([pts[2], pts[3]]);
        const rr = [R[b - B0][ia], R[b - B0][ia + 1], R[b - B0 + 1][ia + 1], R[b - B0 + 1][ia]];
        if (Math.max(...rr) < sea.level - 0.6 && hash(a, b, s + 27) < 0.07) {
          const wx = x0 + ms * 0.2, wy = y0 + ms * 0.5;
          g.waves.push([[wx, wy], [wx + 2.5, wy - 1.4], [wx + 5, wy], [wx + 7.5, wy - 1.4]].map((p) => pp([p[0], p[1], sea.level])));
        }
      }
      if (!lines) continue;
      const n = nrm([-((zz[1] - zz[0]) + (zz[2] - zz[3])) / (2 * ms), -((zz[3] - zz[0]) + (zz[2] - zz[1])) / (2 * ms), 1]);
      if (dot(n, L) < 0.5) g.lee.push(q.map((p, k) => pp([p[0], p[1], zz[k]])));
    }
    // o: cliff wall options { deco: 'strata' | 'cols' | 'crev', u: wall width }.
    const addFace = (q, col, hint, o) => {
      let n = nrm(cross(sub(q[1], q[0]), sub(q[3], q[0])));
      if (dot(n, hint) < 0) n = n.map((v) => -v);
      if (dot(n, VIEW) <= 0.001) return;
      g.raised.push({ kind: 'face', pts: q.map(pp), col, wall: !!o, deco: o && o.deco, u: o ? o.u : 0, k: kOf(n, 0.6), dd: dot(n, L), d: depth(q) });
    };
    const addTop = (ring, cut, col, apexZ, emit) => {
      const cx = ring.reduce((t, p) => t + p[0], 0) / ring.length, cy = ring.reduce((t, p) => t + p[1], 0) / ring.length;
      const cen = [cx, cy, apexZ ?? ring.reduce((t, p) => t + p[2], 0) / ring.length];
      const tris = ring.map((p, m) => {
        const t = [cen, p, ring[(m + 1) % ring.length]];
        let n = nrm(cross(sub(t[1], t[0]), sub(t[2], t[0]))); if (n[2] < 0) n = n.map((v) => -v);
        return { pts: t.map(pp), k: emit ? 1.05 : kOf(n, 0.2) };
      });
      g.raised.push({ kind: 'top', ring: ring.map(pp), cut, tris, col, emit, d: depth(ring) });
    };
    // A column of stacked rings (rings: [z, r, base?]; base: a fixed ground height, else per vertex).
    const addColumn = (cx, cy, rings, sides, cols, topCol, salt, apexZ, emit, lean) => {
      const ang = [], rj = [], zt = rings[rings.length - 1][0] || 1;
      for (let k = 0; k < sides; k++) { ang.push((k / sides) * TAU + (hash(k, salt, s + 61) - 0.5) * (6 / sides)); rj.push(0.82 + 0.36 * hash(k, salt, s + 62)); }
      const Rg = rings.map(([z, r, base]) => ang.map((a, k) => { const lx = lean ? lean[0] * z / zt : 0, ly = lean ? lean[1] * z / zt : 0, x = cx + lx + Math.cos(a) * r * rj[k], y = cy + ly + Math.sin(a) * r * rj[k]; return [x, y, (base === undefined ? heightAt(W, x, y) : base) + z]; }));
      for (let m = 0; m < Rg.length - 1; m++) for (let k = 0; k < sides; k++) {
        const A = Rg[m], Bq = Rg[m + 1], k2 = (k + 1) % sides, q = [A[k], A[k2], Bq[k2], Bq[k]];
        const mx = (A[k][0] + A[k2][0]) / 2 - cx, my = (A[k][1] + A[k2][1]) / 2 - cy, dr = rings[m][1] - rings[m + 1][1];
        addFace(q, cols[m % cols.length], [mx, my, dr > 0.5 ? 8 : dr < -0.5 ? -8 : 0]);
      }
      addTop(Rg[Rg.length - 1], Rg[0].map(() => true), topCol, apexZ, emit);
      return Rg;
    };
    // Cliff walls follow high.prof ([f, out, deco?] from foot to rim). Each wall point is pushed
    // out along the mitred normal shared by the two walls meeting there, so neighbours stay joined.
    const PIECES = [], MIT = {}, PK = (p) => Math.round(p[0] * 8) + ',' + Math.round(p[1] * 8);
    for (let j = rg.j0; j < rg.j1; j++) for (let i = rg.i0; i < rg.i1; i++, yield 'cliff edges') {
      const ps = PIECES[j * W.w + i] = piecesAt(W, i, j);
      if (bi.storm) continue;
      for (const pc of ps) pc.pts.forEach((a, m) => {
        if (!pc.cut[m]) return;
        const b = pc.pts[(m + 1) % pc.pts.length], l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
        for (const p of [a, b]) { const v = MIT[PK(p)] = MIT[PK(p)] || [0, 0, 0]; v[0] += (b[1] - a[1]) / l; v[1] += (a[0] - b[0]) / l; v[2]++; }
      });
    }
    const prof = (bi.high && bi.high.prof) || [[0, 0, 'strata'], [1, 0]], jit = (bi.high && bi.high.jit) || 0;
    const offAt = (p, d) => {
      const v = MIT[PK(p)]; if (!d || !v) return p;
      const l = Math.hypot(v[0], v[1]) || 1, f = Math.min(2, v[2] / l) * (1 + jit * (hash(Math.round(p[0]), Math.round(p[1]), s + 71) - 0.5) * 2);
      return [p[0] + (v[0] / l) * d * f, p[1] + (v[1] / l) * d * f];
    };
    const wallPt = (p, f, d, tz) => { const q = offAt(p, d); return [q[0], q[1], f >= 1 ? tz : lerp(heightAt(W, q[0], q[1]), tz, f)]; };
    for (let j = rg.j0; j < rg.j1; j++) for (let i = rg.i0; i < rg.i1; i++, yield 'walls and props') {
      const key = tkey(i, j), pieces = PIECES[j * W.w + i], mx = (i + 0.5) * T, my = (j + 0.5) * T;
      for (const pc of pieces) {
        (g.block[key] = g.block[key] || []).push(pc);
        if (bi.storm) {
          pc.pts.forEach((a, m) => { if (pc.cut[m]) g.fronts.push({ a, b: pc.pts[(m + 1) % pc.pts.length], ph: hash(i * 4 + m, j, s + 90) }); });
          if (hash(i, j, s + 88) < 0.45) { const cx = pc.pts.reduce((t, p) => t + p[0], 0) / pc.pts.length, cy = pc.pts.reduce((t, p) => t + p[1], 0) / pc.pts.length; g.bolts.push({ x: cx, y: cy, ph: hash(i, j, s + 89), id: key }); }
          continue;
        }
        addTop(pc.pts.map((p) => [p[0], p[1], topZ(W, p[0], p[1])]), pc.cut, bi.high.c.top);
        pc.pts.forEach((a, m) => {
          if (!pc.cut[m]) return;
          const b = pc.pts[(m + 1) % pc.pts.length], nx = b[1] - a[1], ny = a[0] - b[0], u = Math.hypot(nx, ny), ta = topZ(W, a[0], a[1]), tb = topZ(W, b[0], b[1]);
          for (let r = 0; r < prof.length - 1; r++) {
            const [f0, d0, deco] = prof[r], [f1, d1] = prof[r + 1];
            addFace([wallPt(a, f0, d0, ta), wallPt(b, f0, d0, tb), wallPt(b, f1, d1, tb), wallPt(a, f1, d1, ta)], f0 === f1 ? bi.high.c.top : bi.high.c.wall, [nx, ny, Math.sign(d0 - d1) * 8], { deco, u });
          }
        });
        addShadow(pc.pts, bi.high.h);
        yield 'cliff walls';
      }
      const pr = W.props[key];
      const wt = weights(W, mx, my), wet = sea && rawHeight(W, mx, my) < sea.level;
      if (!pieces.length && !wet) {
        if (bi.b.cc && !pr && wt[1] > 0.6) {
          const nc = 3 + Math.floor(hash(i, j, s + 81) * 3);
          for (let c = 0; c < nc; c++) {
            let x = (i + 0.12 + 0.76 * hash(i, j * 9 + c, s + 82)) * T, y = (j + 0.12 + 0.76 * hash(i, j * 9 + c, s + 83)) * T, a = hash(i, j * 9 + c, s + 84) * TAU;
            const line = [pp([x, y, heightAt(W, x, y)])];
            for (let k = 0; k < 4; k++) {
              a += (hash(i * 7 + k, j * 9 + c, s + 85) - 0.5) * 1.3;
              const l = 5 + 6 * hash(i * 7 + k, j * 9 + c, s + 86);
              x = clamp(x + Math.cos(a) * l, i * T + 2, (i + 1) * T - 2); y = clamp(y + Math.sin(a) * l, j * T + 2, (j + 1) * T - 2);
              line.push(pp([x, y, heightAt(W, x, y)]));
            }
            g.cracks.push(line);
          }
        }
        ['a', 'b', 'c'].forEach((q, m) => {
          if (!bi[q].sc) return;
          for (let c = 0; c < 26; c++) {
            const x = (i + hash(i, j * 31 + c, s + 95 + m)) * T, y = (j + hash(i * 31 + c, j, s + 96 + m)) * T;
            if (weights(W, x, y)[m] > 0.45) g.specks.push({ p: pp([x, y, heightAt(W, x, y)]), r: 0.5 + hash(c, i + j, s + 97) * 0.7, col: bi[q].sc });
          }
        });
      }
      if (!pr) continue;
      if (pr.type === 'tall') {
        const v = bi.tall[pr.v];
        g.talls.push({ x: pr.x, y: pr.y, r: pr.r, ph: hash(i, j, s + 86) });
        if (v.kind === 'pocket') { g.bolts.push({ x: pr.x, y: pr.y, ph: hash(i, j, s + 87), id: key }); continue; }
        const pf = PROFILES[v.kind], top = pf.rings[pf.rings.length - 1][0];
        const la = hash(i, j, s + 63) * TAU, lean = pf.lean && [Math.cos(la) * pf.lean, Math.sin(la) * pf.lean];
        const Rg = addColumn(pr.x, pr.y, pf.rings, pf.sides, v.c, v.ct, i * 31 + j, undefined, false, lean);
        addShadow(Rg[0].map((p) => [p[0], p[1]]), 0);
        addShadow(Rg[Rg.length - 1].map((p) => [p[0], p[1]]), top);
        yield 'props';
      } else if (pr.type === 'hole' && bi.fluid) {
        g.vortices.push({ x: pr.x, y: pr.y, r: bi.hole[pr.v].r, ph: hash(i, j, s + 85) });
      } else if (pr.type === 'small' && bi.fluid) {
        const v = bi.small[pr.v], sm = SMALL[v.kind];
        for (let c = 0; c < pr.n; c++) {
          const h = (q) => hash(i, j * 7 + c, s + q);
          g.puffs.push({ x: (i + 0.5) * T + (h(91) - 0.5) * 44, y: (j + 0.5) * T + (h(92) - 0.5) * 44, r: lerp(sm.r[0], sm.r[1], h(93)) * 1.4, h: 3 + 4 * h(94), col: v.c, flat: sm.hMul[1] < 0.6 });
        }
      } else if (pr.type === 'small') {
        const v = bi.small[pr.v], sm = SMALL[v.kind];
        for (let c = 0; c < pr.n; c++) {
          const h = (q) => hash(i, j * 7 + c, s + q);
          const bx = (i + 0.5) * T + (h(91) - 0.5) * 44, by = (j + 0.5) * T + (h(92) - 0.5) * 44, base = heightAt(W, bx, by);
          const r = lerp(sm.r[0], sm.r[1], h(93)), salt = i * 97 + j * 7 + c;
          let Rg, hgt;
          if (sm.trees) {
            hgt = r * 2.4 + 3;
            Rg = addColumn(bx, by, [[0, r, base], [0.4, r * 0.9, base]], sm.sides, [v.c], v.c, salt, base + hgt);
          } else {
            hgt = r * lerp(sm.hMul[0], sm.hMul[1], h(94));
            Rg = addColumn(bx, by, [[0, r, base], [hgt, r * sm.taper, base]], sm.sides, [v.c], v.ct || v.c, salt, base + hgt + r * sm.apex, v.emit);
          }
          addShadow(Rg[0].map((p) => [p[0], p[1]]), hgt);
          yield 'props';
        }
      }
    }
    g.raised.sort((a, b) => a.d - b.d);
    if (!reg) W.geo = g;
    return g;
  }

  // Cloud colour at a point (gas giants). q: quantise the tone terms into flat steps.
  function cloudCol(W, x, y, q) {
    const bi = B[W.type], s = W.seed, Q = (v, n) => (q ? Math.round(v * n) / n : v), wt = weights(W, x, y), white = [255, 250, 235];
    let col = [0, 0, 0];
    ['a', 'b', 'c'].forEach((k, m) => { col = col.map((v, i) => v + bi[k].c[i] * wt[m]); });
    const warp = 46 * fbm(x / 230, y / 230, s + 13) + 14 * fbm(x / 60, y / 60, s + 14);
    const band = Q(0.5 + 0.5 * Math.sin((y + warp) / 21 + 2.5 * fbm(x / 400, y / 90, s + 15)), 4);
    col = band > 0.5 ? mixc(col, white, (band - 0.5) * 0.3) : mixc(col, bi.storm.c.col, (0.5 - band) * 0.25);
    const raw = corner(W, W.C, x, y) + (fbm(x / 28, y / 28, s + 72) - 0.5) * 0.7, st = storm(W, x, y);
    const dark = Q(Math.max(sstep(0.2, 0.8, raw), st.pocket * sstep(1.3, 0.3, st.d + (fbm(x / 14, y / 14, s + 73) - 0.5) * 0.5)), 3);
    if (dark > 0.01) col = mixc(col, mixc(bi.storm.c.col, bi.storm.c.deep, Q(fbm(x / 11 + Math.sin(y / 17), y / 11, s + 74), 3)), 0.9 * dark);
    const pr = propAt(W, x, y);
    if (pr && pr.type === 'hole') { const v = bi.hole[pr.v], d = Math.hypot(x - pr.x, y - pr.y) / v.r; col = mixc(col, v.c, 0.6 * Q(sstep(1.2, 0.2, d), 3)); }
    return mixc(col, col, 0).map((v) => v * (0.88 + 0.16 * band));
  }
  // Live motion on gas giants: fast streaks and eddies along storm-front edges, spiral arms on
  // storm pockets, slow funnels on downdrafts. Drawn at a fixed cloud height.
  function flows(ctx, W, g, bi, style, t, lw) {
    const line = style === 'line', col = (a) => (line ? rgb(bi.LN, 1, a) : rgb(bi.storm.c.bolt, 1, a));
    const P = (x, y) => project(W, x, y, 5);
    const poly = (pts) => { ctx.beginPath(); pts.forEach(([x, y], k) => { const q = P(x, y); k ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]); }); };
    if (!line) { flowsLow(ctx, W, g, bi, t, lw, P); return; }
    ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (const f of g.fronts) {
      const [ax, ay] = f.a, dx = f.b[0] - ax, dy = f.b[1] - ay, len = Math.hypot(dx, dy) || 1, nx = dy / len, ny = -dx / len;
      for (let l = 0; l < 3; l++) {
        const pts = [];
        for (let k = 0; k <= 6; k++) { const u = k / 6, px = ax + dx * u, py = ay + dy * u, off = l * 5 - 3 + 4 * Math.sin(t * 3.2 + (px + py) * 0.08 + l * 1.7) + 3 * (fbm(px / 18, py / 18, W.seed + 75 + l) - 0.5) * 2; pts.push([px + nx * off, py + ny * off]); }
        poly(pts); ctx.setLineDash([5 + l * 4, 7 + l * 3]); ctx.lineDashOffset = -t * (95 - l * 25) + f.ph * 40;
        ctx.strokeStyle = col(0.7 - l * 0.18); ctx.lineWidth = lw * (1.2 - l * 0.25); ctx.stroke();
      }
      ctx.setLineDash([]);
      for (let e = 0; e < 2; e++) {
        const u = 0.25 + 0.5 * e + (f.ph - 0.5) * 0.2, ex = ax + dx * u + nx * 7, ey = ay + dy * u + ny * 7, rr = 3.5 + 3 * hash(e, f.ph * 1e4 | 0, 3), a0 = t * (6 + e * 2) * (e ? -1 : 1) + f.ph * TAU, pts = [];
        for (let k = 0; k <= 8; k++) { const a = a0 + (k / 8) * 2.4; pts.push([ex + Math.cos(a) * rr, ey + Math.sin(a) * rr]); }
        poly(pts); ctx.strokeStyle = col(0.55); ctx.lineWidth = lw; ctx.stroke();
      }
    }
    const spiral = (c, R, arms, spin, alpha, ring) => {
      for (let k = 0; k < arms; k++) {
        const pts = [];
        for (let m = 0; m <= 14; m++) { const u = m / 14, r = R * (0.1 + u), a = c.ph * TAU + (k * TAU) / arms - t * spin + u * 2.8; pts.push([c.x + Math.cos(a) * r, c.y + Math.sin(a) * r]); }
        poly(pts); ctx.strokeStyle = col(alpha); ctx.lineWidth = lw * 1.1; ctx.stroke();
      }
      if (!ring) return;
      const pts = []; for (let m = 0; m <= 24; m++) { const a = (m / 24) * TAU; pts.push([c.x + Math.cos(a) * R * 1.15, c.y + Math.sin(a) * R * 1.15]); }
      poly(pts); ctx.setLineDash([4, 6]); ctx.lineDashOffset = -t * 70; ctx.strokeStyle = col(alpha * 0.8); ctx.stroke(); ctx.setLineDash([]);
    };
    for (const p of g.talls) spiral(p, p.r * 1.15, 3, 4.5, 0.75, true);
    for (const v of g.vortices) spiral(v, v.r, 2, 0.9, 0.35, false);
    ctx.restore();
  }

  // Lowpoly storm motion: flat-lit triangles only. Shards race along storm-front edges in three
  // lanes, pinwheels spin beside them; storm pockets are fans of wedges turning fast, ringed by
  // orbiting shards; downdrafts turn slowly in two tones. Each shard is split along its spine into a
  // lit and a shaded half, lit by the key light from its heading.
  function flowsLow(ctx, W, g, bi, t, lw, P) {
    const L = LIGHT(), tones = [bi.storm.c.deep, bi.storm.c.col, bi.a.c, bi.b.c, hex('#fff3c8')];
    const tri = (a, b, c, col) => { const A = P(...a), B2 = P(...b), C = P(...c); ctx.beginPath(); ctx.moveTo(A[0], A[1]); ctx.lineTo(B2[0], B2[1]); ctx.lineTo(C[0], C[1]); ctx.closePath(); ctx.fillStyle = ctx.strokeStyle = col; ctx.fill(); ctx.stroke(); };
    // A shard at (x, y) heading (hx, hy), length l, half-width w: two triangles split along the spine.
    const shard = (x, y, hx, hy, l, w, c) => {
      const nx = -hy, ny = hx, tip = [x + hx * l * 0.6, y + hy * l * 0.6], tail = [x - hx * l * 0.4, y - hy * l * 0.4];
      const lit = nx * L[0] + ny * L[1] < 0, k1 = lit ? 1.12 : 0.72, k2 = lit ? 0.72 : 1.12;
      tri(tip, tail, [x + nx * w, y + ny * w], rgb(c, k1)); tri(tip, tail, [x - nx * w, y - ny * w], rgb(c, k2));
    };
    ctx.save(); ctx.lineJoin = 'miter'; ctx.lineWidth = lw * 0.6;
    for (const f of g.fronts) {
      const [ax, ay] = f.a, dx = f.b[0] - ax, dy = f.b[1] - ay, len = Math.hypot(dx, dy) || 1, hx = dx / len, hy = dy / len, nx = hy, ny = -hx;
      for (let l = 0; l < 3; l++) {
        const n = Math.max(1, Math.round(len / (16 + l * 6))), speed = (95 - l * 25) / len;
        for (let k = 0; k < n; k++) {
          const u = (k / n + t * speed + f.ph) % 1, px = ax + dx * u, py = ay + dy * u, off = l * 5 - 3 + 3 * Math.sin(t * 3.2 + (px + py) * 0.08 + l * 1.7);
          const fade = Math.min(u, 1 - u) * 4; if (fade < 0.35) continue;
          shard(px + nx * off, py + ny * off, hx, hy, (7 - l * 1.5) * Math.min(1, fade), 1.6 - l * 0.3, tones[l + 2]);
        }
      }
      for (let e = 0; e < 2; e++) {
        const u = 0.25 + 0.5 * e + (f.ph - 0.5) * 0.2, ex = ax + dx * u + nx * 7, ey = ay + dy * u + ny * 7, rr = 3.5 + 3 * hash(e, (f.ph * 1e4) | 0, 3), a0 = t * (6 + e * 2) * (e ? -1 : 1) + f.ph * TAU;
        for (let k = 0; k < 3; k++) { const a = a0 + (k * TAU) / 3, b = a + 0.9; tri([ex, ey], [ex + Math.cos(a) * rr, ey + Math.sin(a) * rr], [ex + Math.cos(b) * rr * 0.6, ey + Math.sin(b) * rr * 0.6], rgb(tones[3], k ? 0.8 : 1.1)); }
      }
    }
    const fan = (c, R, arms, spin, cols, ring) => {
      for (let k = 0; k < arms; k++) for (let m = 0; m < 5; m++) {
        const u0 = m / 5, u1 = (m + 1) / 5, a0 = c.ph * TAU + (k * TAU) / arms - t * spin, r0 = R * (0.12 + u0 * 0.95), r1 = R * (0.12 + u1 * 0.95);
        const p0 = [c.x + Math.cos(a0 + u0 * 2.6) * r0, c.y + Math.sin(a0 + u0 * 2.6) * r0], p1 = [c.x + Math.cos(a0 + u1 * 2.6) * r1, c.y + Math.sin(a0 + u1 * 2.6) * r1];
        const w = 0.55 - u0 * 0.3, p2 = [c.x + Math.cos(a0 + u1 * 2.6 - w) * r1 * 0.82, c.y + Math.sin(a0 + u1 * 2.6 - w) * r1 * 0.82];
        tri(p0, p1, p2, rgb(cols[(m + k) % cols.length], m % 2 ? 0.82 : 1.08));
      }
      if (!ring) return;
      for (let k = 0; k < 8; k++) { const a = (k / 8) * TAU - t * spin * 0.7 + c.ph * 5, r = R * 1.2; shard(c.x + Math.cos(a) * r, c.y + Math.sin(a) * r, -Math.sin(a), Math.cos(a), 6, 1.5, tones[k % 2 ? 2 : 3]); }
    };
    for (const p of g.talls) fan(p, p.r * 1.15, 3, -4.5, [tones[1], tones[2], tones[4]], true);
    for (const v of g.vortices) fan(v, v.r, 2, -0.9, [tones[1], tones[2]], false);
    ctx.restore();
  }

  // A polygon as the context's current path: no Path2D to make (and collect) for each of the
  // thousands of triangles and faces a chunk draws.
  const tracePoly = (ctx, pts) => { ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]); for (let k = 1; k < pts.length; k++) ctx.lineTo(pts[k][0], pts[k][1]); ctx.closePath(); };
  const polyPath = (pts) => { const p = new Path2D(); pts.forEach((q, k) => (k ? p.lineTo(q[0], q[1]) : p.moveTo(q[0], q[1]))); p.closePath(); return p; };
  // Diagonal hatching over the union of convex polygons, kept inside box [x0, y0, x1, y1]. Each
  // line's spans are worked out from the polygon edges rather than clipped (a clip per face or per
  // chunk is what made Line style slow to draw). Lines sit on a grid fixed in chunk space, so the
  // spans of neighbouring polygons and of neighbouring boxes meet.
  const ANY = [-Infinity, -Infinity, Infinity, Infinity];
  function hatchPolys(ctx, polys, box, sp, dir, col, lw) {
    const [x0, y0, x1, y1] = box, u = dir > 0 ? (p) => p[0] - p[1] : (p) => p[0] + p[1];
    const items = [];
    for (const P of polys) {
      let lo = Infinity, hi = -Infinity, top = Infinity, bot = -Infinity;
      for (const p of P) { const v = u(p); lo = Math.min(lo, v); hi = Math.max(hi, v); top = Math.min(top, p[1]); bot = Math.max(bot, p[1]); }
      if (bot > y0 && top < y1) items.push([lo, hi, P]);
    }
    if (!items.length) return;
    items.sort((a, b) => a[0] - b[0]);
    const uHi = items.reduce((m, it) => Math.max(m, it[1]), -Infinity), act = [], spans = [];
    let next = 0;
    ctx.beginPath();
    for (let k = Math.ceil(items[0][0] / sp); k * sp <= uHi; k++) {
      const c = k * sp;
      while (next < items.length && items[next][0] <= c) act.push(items[next++]);
      spans.length = 0;
      for (let n = act.length - 1; n >= 0; n--) {
        const it = act[n];
        if (it[1] < c) { act[n] = act[act.length - 1]; act.pop(); continue; }
        const P = it[2];
        let a = Infinity, b = -Infinity;
        for (let m = 0; m < P.length; m++) {
          const p = P[m], q = P[(m + 1) % P.length], up = u(p) - c, uq = u(q) - c;
          if (up <= 0 === uq <= 0) continue;
          const y = p[1] + ((q[1] - p[1]) * up) / (up - uq);
          a = Math.min(a, y); b = Math.max(b, y);
        }
        if (b > a) spans.push([a, b]);
      }
      // x = c + y (dir > 0) or c - y: the box's x range as a y range on this line.
      const ya = Math.max(y0, dir > 0 ? x0 - c : c - x1), yb = Math.min(y1, dir > 0 ? x1 - c : c - x0);
      if (yb <= ya || !spans.length) continue;
      spans.sort((p, q) => p[0] - q[0]);
      const seg = (a, b) => { a = Math.max(a, ya); b = Math.min(b, yb); if (b > a) { ctx.moveTo(dir > 0 ? c + a : c - a, a); ctx.lineTo(dir > 0 ? c + b : c - b, b); } };
      let [a, b] = spans[0];
      for (let m = 1; m < spans.length; m++) {
        if (spans[m][0] <= b) b = Math.max(b, spans[m][1]);
        else { seg(a, b); [a, b] = spans[m]; }
      }
      seg(a, b);
    }
    ctx.strokeStyle = col; ctx.lineWidth = lw; ctx.stroke();
  }
  const BANDS = [[0, 0.22, 0], [0.22, 0.3, 1], [0.3, 0.62, 0], [0.62, 0.7, 1], [0.7, 1, 0]];

  function drawRaised(ctx, o, bi, style, lw) {
    const ln = (a) => rgb(bi.LN, 1, a);
    if (o.kind === 'top') {
      if (style !== 'line') {
        ctx.lineWidth = lw * 0.6;
        for (const t of o.tris) { tracePoly(ctx, t.pts); ctx.fillStyle = ctx.strokeStyle = rgb(o.col, t.k); ctx.fill(); ctx.stroke(); }
      } else {
        tracePoly(ctx, o.ring); ctx.fillStyle = ctx.strokeStyle = BG(); ctx.lineWidth = lw * 0.8; ctx.fill(); ctx.stroke();
        if (o.emit) { ctx.fillStyle = ln(0.75); ctx.fill(); }
        ctx.beginPath();
        o.ring.forEach((p, m) => { if (!o.cut[m]) return; const q = o.ring[(m + 1) % o.ring.length]; ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]); });
        ctx.strokeStyle = ln(1); ctx.lineWidth = lw; ctx.stroke();
      }
      return;
    }
    const q = o.pts, at = (f) => [lerp(q[0][0], q[3][0], f), lerp(q[0][1], q[3][1], f)], bt = (f) => [lerp(q[1][0], q[2][0], f), lerp(q[1][1], q[2][1], f)];
    // Vertical strips: lo/hi run along the foot and rim. cols: basalt columns; crev: crevasse wedges.
    const lo = (u) => [lerp(q[0][0], q[1][0], u), lerp(q[0][1], q[1][1], u)], hi = (u) => [lerp(q[3][0], q[2][0], u), lerp(q[3][1], q[2][1], u)];
    const mid = (u, f) => { const a = lo(u), b = hi(u); return [lerp(a[0], b[0], f), lerp(a[1], b[1], f)]; };
    const rnd = (n) => { const v = Math.sin(q[0][0] * 12.9898 + q[0][1] * 78.233 + n * 37.7) * 43758.5; return v - Math.floor(v); };
    const nCol = Math.max(2, Math.round(o.u / 5)), crev = o.deco === 'crev' ? Array.from({ length: Math.max(1, Math.round(o.u / 12)) }, (_, c) => [(c + 0.25 + 0.5 * rnd(c)) / Math.max(1, Math.round(o.u / 12)), 0.15 + 0.35 * rnd(c + 9)]) : [];
    if (style !== 'line') {
      ctx.lineWidth = lw * 0.6;
      const fill = (pts, col, k) => { tracePoly(ctx, pts); ctx.fillStyle = ctx.strokeStyle = rgb(col, k); ctx.fill(); ctx.stroke(); };
      if (o.deco === 'strata') for (const [f0, f1, c] of BANDS) fill([at(f0), bt(f0), bt(f1), at(f1)], c ? bi.high.c.strata : o.col, o.k);
      else if (o.deco === 'cols') for (let c = 0; c < nCol; c++) fill([lo(c / nCol), lo((c + 1) / nCol), hi((c + 1) / nCol), hi(c / nCol)], c % 2 ? bi.high.c.strata : o.col, o.k * (0.92 + 0.12 * rnd(c)));
      else fill(q, o.col, o.k);
      for (const [u, f] of crev) fill([hi(u - 0.05), hi(u + 0.05), mid(u, f)], o.col, o.k * 0.62);
      return;
    }
    tracePoly(ctx, q); ctx.fillStyle = BG(); ctx.fill();
    // Faces turned from the light hatched; the darkest cross-hatched too.
    if (bi.hatch && o.dd < 0.2) { hatchPolys(ctx, [q], ANY, 4.2, 1, ln(0.6), lw * 0.8); if (o.dd < -0.6) hatchPolys(ctx, [q], ANY, 5, -1, ln(0.5), lw * 0.8); }
    if (o.deco) {
      ctx.beginPath();
      if (o.deco === 'strata') for (const f of [0.26, 0.66]) { const a = at(f), b = bt(f); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); }
      if (o.deco === 'cols') for (let c = 1; c < nCol; c++) { const a = lo(c / nCol), b = hi(c / nCol); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); }
      for (const [u, f] of crev) { const a = hi(u - 0.05), m = mid(u, f), b = hi(u + 0.05); ctx.moveTo(a[0], a[1]); ctx.lineTo(m[0], m[1]); ctx.lineTo(b[0], b[1]); }
      ctx.strokeStyle = ln(0.7); ctx.lineWidth = lw * 0.8; ctx.stroke();
    }
    ctx.lineJoin = 'round'; ctx.lineWidth = lw;
    ctx.beginPath(); ctx.moveTo(q[1][0], q[1][1]); ctx.lineTo(q[2][0], q[2][1]); ctx.moveTo(q[3][0], q[3][1]); ctx.lineTo(q[0][0], q[0][1]);
    ctx.strokeStyle = ln(o.wall ? 0.3 : 1); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(q[0][0], q[0][1]); ctx.lineTo(q[1][0], q[1][1]); ctx.moveTo(q[2][0], q[2][1]); ctx.lineTo(q[3][0], q[3][1]);
    ctx.strokeStyle = ln(1); ctx.stroke();
  }

  // style: 'line' or 'lowpoly'. lw: one screen pixel in ctx units. extra(ctx): drawn over the
  // ground and shadows, under everything raised.
  // region: draw only the tiles [i0, i1) × [j0, j1).
  function draw(ctx, W, style, o = {}) {
    run(drawSteps(ctx, W, style, o));
  }
  // The same as a generator: the geometry a row at a time, then the drawing a batch at a time.
  function* drawSteps(ctx, W, style, o = {}) {
    const g = yield* buildSteps(W, o.region), bi = B[W.type], lw = o.lw || 1, ln = (a) => rgb(bi.LN, 1, a), rg = o.region, ct = cam(W).ct;
    const bb = rg ? [rg.i0 * T - 10, rg.j0 * T * ct - PAD - 10, rg.i1 * T + 10, rg.j1 * T * ct + 10] : [-10, -PAD - 10, W.w * T + 10, W.h * T * ct + 10];
    // Whole-region hatching (lee slopes, shadows) only over the tiles a chunk shows: its margin is clipped off.
    const hb = rg && rg.inner ? [rg.inner.i0 * T - 4, rg.inner.j0 * T * ct - 4, rg.inner.i1 * T + 4, rg.inner.j1 * T * ct + 4] : bb;
    ctx.fillStyle = BG(); ctx.fillRect(bb[0], bb[1], bb[2] - bb[0], bb[3] - bb[1]);
    const lines = (arr, col, w) => { ctx.beginPath(); for (const l of arr) l.forEach((p, k) => (k ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.strokeStyle = col; ctx.lineWidth = w; ctx.stroke(); };
    const specks = (col) => { for (const sp of g.specks) { ctx.beginPath(); ctx.arc(sp.p[0], sp.p[1], sp.r, 0, TAU); if (col) { ctx.strokeStyle = col; ctx.lineWidth = lw * 0.7; ctx.stroke(); } else { ctx.fillStyle = rgb(sp.col, 1, 0.85); ctx.fill(); } } };
    const puffs = () => {
      for (const p of g.puffs) {
        const [x, y] = project(W, p.x, p.y, p.h);
        for (let k = 0; k < (p.flat ? 2 : 3); k++) {
          const r = p.r * (1 - k * 0.28);
          ctx.beginPath(); ctx.ellipse(x + k * 0.8, y - k * 1.6, r * (p.flat ? 1.5 : 1), r * cam(W).ct * (p.flat ? 0.7 : 1), 0, 0, TAU);
          if (style !== 'line') {
            const n = 7, pts = [];
            for (let m = 0; m < n; m++) { const a = (m / n) * TAU + k; pts.push([x + k * 0.8 + Math.cos(a) * r * (p.flat ? 1.5 : 1), y - k * 1.6 + Math.sin(a) * r * cam(W).ct * (p.flat ? 0.7 : 1)]); }
            const c0 = [x + k * 0.8, y - k * 1.6 - r * 0.15];
            pts.forEach((q, m) => { const q2 = pts[(m + 1) % n], up = Math.sin(((m + 0.5) / n) * TAU + k) < 0, left = Math.cos(((m + 0.5) / n) * TAU + k) < 0;
              ctx.beginPath(); ctx.moveTo(c0[0], c0[1]); ctx.lineTo(q[0], q[1]); ctx.lineTo(q2[0], q2[1]); ctx.closePath();
              ctx.fillStyle = ctx.strokeStyle = rgb(p.col, up ? (left ? 1.08 : 1) : 0.86 - k * 0.02); ctx.lineWidth = lw * 0.6; ctx.fill(); ctx.stroke(); });
            continue;
          } else { ctx.setLineDash([2 * lw, 3 * lw]); ctx.strokeStyle = ln(0.5 - k * 0.12); ctx.lineWidth = lw * 0.8; ctx.stroke(); ctx.setLineDash([]); }
        }
      }
    };
    if (bi.fluid) {
      if (style !== 'line') { ctx.imageSmoothingEnabled = true; ctx.lineWidth = lw * 0.6; ctx.lineJoin = 'round'; for (const t of g.tris) { const p = polyPath(t.pts); ctx.fillStyle = ctx.strokeStyle = rgb(t.col, t.k); ctx.fill(p); ctx.stroke(p); } }
      else lines(g.major, ln(0.42), lw * 0.8);
      if (o.extra) o.extra(ctx);
      puffs();
      return;
    }
    if (style !== 'line') {
      ctx.lineWidth = lw * 0.6; ctx.lineJoin = 'round';
      for (let n = 0; n < g.tris.length; n++) {
        if (n % 100 === 99) yield 'draw ground';
        const t = g.tris[n]; tracePoly(ctx, t.pts); ctx.fillStyle = ctx.strokeStyle = rgb(t.col, t.k); ctx.fill(); ctx.stroke();
      }
      yield 'draw ground';
      if (bi.b.cc) lines(g.cracks, bi.b.emit ? rgb(bi.b.cc) : rgb(bi.b.cc, 1, 0.8), lw * (bi.b.emit ? 1.6 : 0.9));
      yield 'draw cracks';
      specks(null);
      yield 'draw specks';
      if (bi.sea) { lines(g.coast, rgb(bi.sea.c.foam, 1, 0.7), lw * 1.3); lines(g.waves, rgb(bi.sea.c.foam, 1, 0.35), lw * 0.9); }
      yield 'draw coast';
      ctx.fillStyle = 'rgba(20,8,4,0.36)'; ctx.fill(g.shadow, 'nonzero');
    } else {
      for (const t of g.tris) if (t.wash) { ctx.fillStyle = ln(t.wash); tracePoly(ctx, t.pts); ctx.fill(); }
      lines(g.major, ln(0.7), lw * 0.8);
      if (bi.sea) { lines(g.coast, ln(1), lw); lines(g.waves, ln(0.45), lw * 0.8); }
      yield 'draw lines';
      // The chunk's hatching in horizontal bands, a step each, so no one step hatches all of it.
      const band = (k) => [hb[0], lerp(hb[1], hb[3], k / 3), hb[2], lerp(hb[1], hb[3], (k + 1) / 3)];
      if (bi.hatch) for (let k = 0; k < 3; k++, yield 'draw lee hatching') hatchPolys(ctx, g.lee, band(k), 4.4, 1, ln(0.45), lw * 0.7);
      if (bi.b.cc) lines(g.cracks, ln(0.7), lw * 0.8);
      specks(ln(0.6));
      yield 'draw cracks';
      if (bi.hatch) for (let k = 0; k < 3; k++, yield 'draw shadow hatching') hatchPolys(ctx, g.shade, band(k), 4, -1, ln(0.55), lw * 0.8);
    }
    if (o.extra) o.extra(ctx);
    yield 'draw ground details';
    for (let n = 0; n < g.raised.length; n++) {
      if (n % 15 === 14) yield 'draw raised';
      drawRaised(ctx, g.raised[n], bi, style, lw);
    }
  }

  // Lightning in storm fronts and pockets: short flashes, drawn live over the surface.
  // all: draw every bolt (a still frame for asset sheets).
  function drawLive(ctx, W, style, t, o = {}) {
    const g = build(W), bi = B[W.type], lw = o.lw || 1;
    if (bi.fluid) flows(ctx, W, g, bi, style, t, lw);
    if (!g.bolts.length) return;
    for (const b of g.bolts) {
      const ph = (t * 0.45 + b.ph) % 1;
      if (!o.all && ph > 0.035) continue;
      const f = o.all ? 1 : Math.floor(t * 24), gz = heightAt(W, b.x, b.y), pts = [];
      for (let k = 0; k <= 5; k++) {
        const j = k === 0 || k === 5 ? 0 : (hash(k, f, b.id) - 0.5) * 9;
        pts.push(project(W, b.x + j, b.y + j * 0.3, lerp(gz + 26, gz + 1, k / 5)));
      }
      ctx.save(); ctx.lineJoin = 'miter';
      if (style !== 'line') {
        if (!o.all) { const c = pts[2], n = 7; ctx.beginPath(); for (let m = 0; m < n; m++) { const a = (m / n) * TAU + b.ph * 6, r = m % 2 ? 13 : 20; ctx.lineTo(c[0] + Math.cos(a) * r, c[1] + Math.sin(a) * r * 0.75); } ctx.closePath(); ctx.fillStyle = rgb(bi.storm.c.bolt, 1, 0.22); ctx.fill(); }
      } else { ctx.strokeStyle = rgb(bi.LN); ctx.lineWidth = lw * 1.2; }
      if (style !== 'line') {
        const wd = lw * 1.4, side = pts.map((p) => [p[0] + wd, p[1]]).concat(pts.slice().reverse().map((p) => [p[0] - wd * 0.4, p[1]]));
        ctx.beginPath(); side.forEach((p, k) => (k ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.closePath(); ctx.fillStyle = rgb(bi.storm.c.bolt); ctx.fill();
      } else { ctx.beginPath(); pts.forEach((p, k) => (k ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.stroke(); }
      ctx.restore();
    }
  }

  // The whole surface into one canvas, 1 world unit per CSS pixel; y is offset by PAD so tall
  // objects on the first row fit. Draw it at (−PAD) and project points with project() + PAD.
  function render(W, style, o = {}) {
    const dpr = o.dpr || Math.min(2, window.devicePixelRatio || 1), w = W.w * T, h = W.h * T * cam(W).ct + PAD + 6;
    const cv = document.createElement('canvas'); cv.width = Math.ceil(w * dpr); cv.height = Math.ceil(h * dpr);
    const ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, PAD * dpr);
    draw(ctx, W, style, { lw: 1 });
    return { canvas: cv, w, h, pad: PAD };
  }

  // Tiles [i0, i1) × [j0, j1) into one canvas: a band of the surface, cut on tile lines (in projected
  // units: x from i0·T, y from j0·T·cos(tilt)), with everything that reaches into it from the
  // tiles around (tall things from the row below, cliff walls from either side). The canvas is whole
  // pixels, a fraction of one past the band, and painted to its edges: no half-covered edge row to
  // show as a seam where it meets the next.
  function renderRegion(W, style, o) {
    return run(renderRegionSteps(W, style, o));
  }
  // The same as a generator, a few milliseconds' work or less at each next(), so a chunk can be
  // built across frames (art/surface-globe.js tiles).
  // o.canvas: one to draw into (a chunk no longer needed), sized to fit, rather than a new one.
  function* renderRegionSteps(W, style, o) {
    const ct = cam(W).ct, dpr = o.dpr || 1, x0 = o.i0 * T, y0 = o.j0 * T * ct, w = (o.i1 - o.i0) * T, h = (o.j1 - o.j0) * T * ct;
    const region = { i0: Math.max(0, o.i0 - 1), j0: Math.max(0, o.j0 - 1), i1: Math.min(W.w, o.i1 + 1), j1: Math.min(W.h, o.j1 + 1), inner: o, lines: style === 'line' };
    const cv = o.canvas || document.createElement('canvas'), cw = Math.ceil(w * dpr), ch = Math.ceil(h * dpr);
    if (cv.width !== cw || cv.height !== ch) { cv.width = cw; cv.height = ch; }
    const ctx = cv.getContext('2d');
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, cw, ch);
    ctx.setTransform(dpr, 0, 0, dpr, -x0 * dpr, -y0 * dpr);
    ctx.beginPath(); ctx.rect(x0, y0, cw / dpr, ch / dpr); ctx.clip();
    yield 'canvas';
    yield* drawSteps(ctx, W, style, { lw: 1, region });
    ctx.restore(); // the clip off again, for the canvas's next use
    return { canvas: cv, x0, y0, sx: dpr, sy: dpr, w, h };
  }
  // The whole surface at low detail (6 world units a pixel, more on surfaces over 150 tiles; o.upp
  // sets it), for the ground far away: ground kinds, sea, high ground and storms in flat colours lit
  // by the slope (Low-poly), or the coast, the cliff edges and a few contours (Line).
  function farImage(W, style, o = {}) {
    const b = farBuilder(W, style, o);
    while (!b.step(Infinity));
    return b.layer;
  }
  // The same, built a row at a time: step(budgetMs) works for about that long and returns true once
  // it's done, when .layer holds it; .progress says how far it's got (0..1). So it can be built across frames.
  function farBuilder(W, style, o = {}) {
    const bi = B[W.type], ct = cam(W).ct, L = LIGHT(), Wu = W.w * T, Hu = W.h * T, upp = o.upp || Math.max(6, Math.max(Wu, Hu) / 1600);
    const nx = Math.ceil(Wu / upp) + 1, ny = Math.ceil((Hu * ct) / upp) + 1, sea = bi.sea, line = style === 'line', q = line ? 2 : 1;
    const F = new Float32Array(nx * ny), Hi = new Float32Array(nx * ny), Raw = new Float32Array(nx * ny);
    const cv = document.createElement('canvas'), ctx = cv.getContext('2d');
    cv.width = nx * q; cv.height = ny * q;
    const im = line ? null : ctx.createImageData(nx, ny);
    // The heights, high ground and sea, a row at a time.
    const fieldRow = (py) => {
      for (let px = 0; px < nx; px++) {
        const x = Math.min(Wu, px * upp), y = Math.min(Hu, (py * upp) / ct), k = py * nx + px;
        const raw = rawHeight(W, x, y), hi = bi.storm ? 0 : sstep(0.3, 0.7, corner(W, W.C, x, y));
        Raw[k] = raw; Hi[k] = hi; F[k] = (sea ? Math.max(raw, sea.level) : raw) * (1 - hi) + hi * bi.high.h;
      }
    };
    // Low-poly: a row of colours.
    const colourRow = (py) => {
      const D = im.data;
      for (let px = 0; px < nx; px++) {
        const k = py * nx + px, x = px * upp, y = (py * upp) / ct;
        let col;
        if (bi.fluid) col = cloudCol(W, x, y, true);
        else {
          const zx = (F[py * nx + Math.min(nx - 1, px + 1)] - F[py * nx + Math.max(0, px - 1)]) / (2 * upp);
          const zy = (F[Math.min(ny - 1, py + 1) * nx + px] - F[Math.max(0, py - 1) * nx + px]) / ((2 * upp) / ct);
          const n = nrm([-zx, -zy, 1]), wt = weights(W, x, y);
          col = [0, 0, 0]; ['a', 'b', 'c'].forEach((g, m) => { col = col.map((v, i) => v + bi[g].c[i] * wt[m]); });
          let kk = 0.24 + 0.95 * Math.max(0, dot(n, L));
          if (bi.b.emit && wt[1] > 0.5) kk = 1;
          // Blended, not thresholded, so edges stay smooth when the image is drawn large.
          if (sea) {
            col = mixc(col, sea.c.sand, 0.75 * sstep(sea.level + 2.6, sea.level + 0.8, Raw[k]));
            const wet = sstep(sea.level + 0.8, sea.level - 1.2, Raw[k]);
            col = mixc(col.map((v) => v * kk), mixc(sea.c.shallow, sea.c.deep, clamp((sea.level - Raw[k]) / 6, 0, 1)).map((v) => v * 0.9), wet);
          } else col = col.map((v) => v * kk);
          if (bi.high.c) col = mixc(col, mixc(bi.high.c.wall, bi.high.c.top, sstep(0.7, 0.95, Hi[k])).map((v) => v * kk), sstep(0.2, 0.65, Hi[k]));
        }
        D[k * 4] = Math.min(255, col[0]); D[k * 4 + 1] = Math.min(255, col[1]); D[k * 4 + 2] = Math.min(255, col[2]); D[k * 4 + 3] = 255;
      }
    };
    // Line: contours by marching squares, at twice the field's resolution, one level a step.
    const iso = (fld, lev, col, w) => {
      ctx.beginPath();
      for (let py = 0; py < ny - 1; py++) for (let px = 0; px < nx - 1; px++) {
        const zz = [fld[py * nx + px], fld[py * nx + px + 1], fld[(py + 1) * nx + px + 1], fld[(py + 1) * nx + px]], c = [[px, py], [px + 1, py], [px + 1, py + 1], [px, py + 1]], pts = [];
        for (let e = 0; e < 4; e++) { const za = zz[e], zb = zz[(e + 1) % 4]; if ((za < lev) !== (zb < lev)) { const t = (lev - za) / (zb - za), A = c[e], Bq = c[(e + 1) % 4]; pts.push([(A[0] + (Bq[0] - A[0]) * t) * q, (A[1] + (Bq[1] - A[1]) * t) * q]); } }
        for (let m = 0; m + 1 < pts.length; m += 2) { ctx.moveTo(pts[m][0], pts[m][1]); ctx.lineTo(pts[m + 1][0], pts[m + 1][1]); }
      }
      ctx.strokeStyle = col; ctx.lineWidth = w; ctx.stroke();
    };
    const lines = () => {
      const jobs = [() => { ctx.fillStyle = BG(); ctx.fillRect(0, 0, cv.width, cv.height); }];
      for (let lev = -6.4; lev < 12; lev += 6.4) if (!sea || lev > sea.level) jobs.push(() => iso(F, lev + 0.01, rgb(bi.LN, 1, 0.35), 1));
      if (sea) jobs.push(() => iso(Raw, sea.level, rgb(bi.LN, 1, 0.9), 1.2));
      if (!bi.storm) jobs.push(() => iso(Hi, 0.5, rgb(bi.LN, 1, 0.9), 1.2));
      else jobs.push(() => iso(Array.from({ length: nx * ny }, (_, k) => corner(W, W.C, (k % nx) * upp, (Math.floor(k / nx) * upp) / ct)), 0.5, rgb(bi.LN, 1, 0.8), 1.2));
      return jobs;
    };
    let stage = 0, row = 0, jobs = null;
    const out = { layer: null, progress: 0 };
    out.step = (budgetMs) => {
      const t0 = performance.now();
      while (!out.layer && performance.now() - t0 < budgetMs) {
        if (stage === 0) { fieldRow(row++); if (row === ny) { stage = 1; row = 0; } }
        else if (!line) {
          colourRow(row++);
          if (row === ny) { ctx.putImageData(im, 0, 0); out.layer = { canvas: cv, x0: 0, y0: 0, sx: q / upp, sy: q / upp }; }
        } else {
          jobs = jobs || lines();
          jobs.shift()();
          if (!jobs.length) out.layer = { canvas: cv, x0: 0, y0: 0, sx: q / upp, sy: q / upp };
        }
      }
      out.progress = out.layer ? 1 : stage === 0 ? (0.5 * row) / ny : line ? 0.5 + 0.5 * (1 - (jobs ? jobs.length : 6) / 6) : 0.5 + (0.5 * row) / ny;
      return !!out.layer;
    };
    return out;
  }

  // Blocked footprints projected at flight altitude, so they sit level with the ship.
  function overlay(W) {
    const g = build(W), fill = new Path2D(), edge = new Path2D(), ct = cam(W).ct;
    for (const k in g.block) for (const pc of g.block[k]) {
      const s2 = pc.pts.map((p) => project(W, p[0], p[1], FLY));
      fill.addPath(polyPath(s2));
      s2.forEach((p, m) => { if (!pc.cut[m]) return; const q = s2[(m + 1) % s2.length]; edge.moveTo(p[0], p[1]); edge.lineTo(q[0], q[1]); });
    }
    for (const t of g.talls) { const [x, y] = project(W, t.x, t.y, FLY); const e = new Path2D(); e.ellipse(x, y, t.r, t.r * ct, 0, 0, TAU); fill.addPath(e); edge.addPath(e); }
    return { fill, edge };
  }
  const inPoly = (x, y, pts) => { let c = false; for (let a = 0, b = pts.length - 1; a < pts.length; b = a++) { const [xa, ya] = pts[a], [xb, yb] = pts[b]; if ((ya > y) !== (yb > y) && x < ((xb - xa) * (y - ya)) / (yb - ya) + xa) c = !c; } return c; };
  // Whether a craft of radius r at (x, y) hits a cliff or storm front, a tall prop or the map edge.
  function blocked(W, x, y, r = 0) {
    if (x < r || y < r || x > W.w * T - r || y > W.h * T - r) return true;
    const i = Math.floor(x / T), j = Math.floor(y / T);
    const probes = [[x, y], [x + r, y], [x - r, y], [x, y + r], [x, y - r]];
    for (let a = i - 1; a <= i + 1; a++) for (let b = j - 1; b <= j + 1; b++) {
      if (a < 0 || b < 0 || a >= W.w || b >= W.h) continue;
      for (const pc of piecesAt(W, a, b)) for (const [px, py] of probes) if (inPoly(px, py, pc.pts)) return true;
      const pr = W.props[tkey(a, b)];
      if (pr && pr.type === 'tall' && Math.hypot(x - pr.x, y - pr.y) < pr.r + r) return true;
    }
    return false;
  }

  return { T, FLY, PAD, BIOMES: B, TYPES, SURFACE_OF, MOON_SURFACES, moonSurface, generate, generateSteps, sample, build, draw, drawLive, render, renderRegion, renderRegionSteps, farImage, farBuilder, overlay, blocked, siteDist, project, heightAt, shadowShift };
})();

export { ArtSurface };
