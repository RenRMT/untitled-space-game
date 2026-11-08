// Ship equipment blueprints: the fitted gear a ship carries (weapons, shield, scanner, engine,
// computer), drawn by art/render.js in all its styles, like the items in art/items.js. Unlike
// salvage these are whole, working units: clean hulls, lit glass and lights, each in its own
// colour (accents, lights, glass and the line-style outline), so a type reads the same in every
// style and as a menu icon (art/icons.js).
//
//   ArtEquipment.KINDS                 -> [{ id, name, group, color: [h, s, l] }] in display order
//   ArtEquipment.GROUPS                -> { weapon, defence, systems } group labels
//   ArtEquipment.has(id)               -> whether id is an equipment kind
//   ArtEquipment.kit(b, culture, r)    -> the culture parts kit (below), shared with art/turrets.js
//   ArtEquipment.outline(family, w, h, r) -> a housing outline in a hull family
//   ArtEquipment.create(id, seed, { color?, culture? }) -> blueprint (type 'item'; kind, category 'equipment', label)
//     culture: an art/culture.js culture; the unit is then built in its design language and colours
//     (see Culture variants below); without one it is the culture-neutral unit in its type colour
//
// ES module (`ArtEquipment`); also runs in Node (the tests).

import { ArtBlueprints } from './blueprints.js';
import { ArtUtil } from './util.js';
import { hashInt, mulberry32 } from '../core/rng.js';

const ArtEquipment = (() => {
  const U = ArtUtil;
  const B = ArtBlueprints;
  const { TAU } = U;

  // Rounded rectangle (as in art/items.js); duplicate points dropped so low-poly roofs stay star-shaped.
  function rrect(cx, cy, w, h, rad, a = 0, n = 3) {
    rad = Math.min(rad, w / 2, h / 2);
    const qx = w / 2 - rad, qy = h / 2 - rad, out = [];
    [[qx, qy], [-qx, qy], [-qx, -qy], [qx, -qy]].forEach(([x, y], q) => {
      for (let i = 0; i <= n; i++) {
        const t = (q + i / n) * (TAU / 4);
        out.push([x + Math.cos(t) * rad, y + Math.sin(t) * rad]);
      }
    });
    const pts = out.filter((p, i) => { const o = out[(i + 1) % out.length]; return Math.hypot(p[0] - o[0], p[1] - o[1]) > 1e-4; });
    return pts.map((p) => U.add(U.rot(p, a), [cx, cy]));
  }
  const polar = (r, a) => [Math.cos(a) * r, Math.sin(a) * r];

  // ---------- Catalogue ----------

  const GROUPS = { weapon: 'Weapons', defence: 'Defence', systems: 'Ship systems' };
  // Hues spread round the wheel, and lightness varied, so neighbours stay apart.
  const KINDS = [
    { id: 'laser', name: 'Laser', group: 'weapon', color: [356, 0.88, 0.62] },
    { id: 'missile-launcher', name: 'Missile launcher', group: 'weapon', color: [26, 0.95, 0.58] },
    { id: 'plasma-cannon', name: 'Plasma cannon', group: 'weapon', color: [284, 0.82, 0.7] },
    { id: 'shield-generator', name: 'Shield generator', group: 'defence', color: [188, 0.9, 0.6] },
    { id: 'scanner', name: 'Scanner', group: 'systems', color: [54, 0.88, 0.6] },
    { id: 'engine', name: 'Engine', group: 'systems', color: [148, 0.62, 0.56] },
    { id: 'ship-computer', name: 'Ship computer', group: 'systems', color: [218, 0.85, 0.7] },
  ];
  const BY_ID = Object.fromEntries(KINDS.map((k) => [k.id, k]));

  // ---------- Palette ----------

  // Clean, factory-fresh metal tinted a little toward the type's colour; accents, glass, lights and
  // the outline in it.
  const BASE = {
    hull: '#b4bac3', hull2: '#5f6670', trim: '#dde1e6', dark: '#1c2028', copper: '#c9824a', engine: '#3a414c',
  };
  function lineOf([h, s, l]) {
    return U.tune(U.mix(U.fromHsl(h, s, l), '#ffffff', 0.2), { s: [0.45, 1], l: [0.62, 0.8] });
  }
  function pal([h, s, l]) {
    const c = U.fromHsl(h, s, l);
    return {
      ...BASE,
      hull: U.mix(BASE.hull, c, 0.22),
      hull2: U.mix(BASE.hull2, c, 0.25),
      trim: U.mix(BASE.trim, c, 0.12),
      accent: c,
      light: U.tune(c, { l: [0.64, 0.76] }),
      flame: U.tune(c, { l: [0.65, 0.78] }),
      glass: U.tune(c, { s: [0.6, 1], l: [0.58, 0.72] }),
      panel: U.mix(c, '#1c2028', 0.72),
      line: lineOf([h, s, l]),
    };
  }

  // ---------- Builds ----------
  // +x is the front (the muzzle of a weapon, the face of a scanner dish).

  const BUILD = {
    // Slim barrel with focusing collars, capacitor housing and cooling fins; a cut crystal lens at the muzzle.
    laser: (b) => {
      for (const y of [-2.4, -0.8, 0.8, 2.4]) b.poly(U.rect(-10, y, 3.4, 0.9), 'hull2', { lvl: 0.5, h: 2.4 });
      b.strut(-2, 0, 8.6, 0, 2, 'hull2', { lvl: 0.8, h: 1.8 });
      for (const x of [0.8, 3.6, 6.4]) b.poly(rrect(x, 0, 1, 3.4, 0.4), 'trim', { lvl: 1.2, h: 2.2 });
      b.poly(rrect(-5.6, 0, 7.6, 6.4, 1.2), 'hull', { lvl: 1, h: 3, bevel: 1, roof: true });
      b.poly(U.rect(-5.6, 0, 5, 1.4), 'accent', { lvl: 2, h: 0.4, line: false });
      b.poly(rrect(8.8, 0, 1.4, 3.8, 0.5), 'trim', { lvl: 1.3, h: 2.4 });
      b.poly([[9.4, 0], [10.8, -1.7], [13, 0], [10.8, 1.7]], 'glass', { lvl: 1.6, h: 1.6, bevel: 0.5 });
      b.light(-2.8, -2.4, 0.5, '#6bff8a', { blink: 0.3 });
    },

    // A missile on its launch rail: white body, coloured nose and band, tail fins, rail clamps.
    'missile-launcher': (b) => {
      b.poly(U.rect(-0.6, 0, 16.4, 2.6), 'hull2', { lvl: 0.5, h: 1.2, lines: [[-8, 0, 7, 0]] });
      for (const x of [-7.6, 6.6]) b.poly(U.rect(x, 0, 1.6, 5.4), 'hull', { lvl: 0.6, h: 1.4 });
      for (const s of [1, -1]) b.poly([[-4.4, s * 1.4], [-7.2, s * 4.8], [-8.4, s * 4.8], [-7.4, s * 1.4]], 'hull2', { lvl: 1, h: 2, bevel: 0.3 });
      b.poly(rrect(-0.4, 0, 13, 3.4, 1.7), 'trim', { lvl: 1.2, h: 2.6, bevel: 1.2, roof: true });
      b.poly([[5.8, -1.7], [8.2, -1.2], [10.4, 0], [8.2, 1.2], [5.8, 1.7]], 'accent', { lvl: 1.4, h: 2.4, bevel: 0.9, roof: true });
      b.poly(U.rect(2.6, 0, 1, 3.5), 'accent', { lvl: 1.8, h: 0.3, line: false });
      b.poly(U.rect(-3.2, 0, 2.4, 0.9), 'dark', { lvl: 1.8, h: 0.3, line: false });
      b.poly(U.rect(-7.4, 0, 1.2, 2.2), 'dark', { lvl: 1.3, h: 0.3, line: false });
      b.light(-7.6, 2.8, 0.5, b.bp.culture.pal.light, { blink: 0.6 });
    },

    // Containment chamber with a glowing core, then a barrel wound with magnetic coils and a flared muzzle.
    'plasma-cannon': (b) => {
      b.strut(0.5, 0, 9.6, 0, 2.6, 'hull2', { lvl: 0.8, h: 2 });
      for (const x of [2.6, 5, 7.4]) b.poly(rrect(x, 0, 1.3, 4.8, 0.6), 'accent', { lvl: 1.2, h: 2.6, bevel: 0.4 });
      b.poly([[9.2, -1.6], [11.8, -3], [11.8, 3], [9.2, 1.6]], 'hull', { lvl: 1, h: 2.4, bevel: 0.6 });
      for (const s of [1, -1]) b.poly(U.rect(-4, s * 5.4, 3.2, 1.6), 'hull2', { lvl: 0.5, h: 2 });
      b.circle(-4, 0, 5.4, 'hull', { lvl: 1, h: 3.2, bevel: 1.2 });
      b.ring(-4, 0, 4.4, 0.9, 'trim', { lvl: 2, h: 3.4 });
      b.circle(-4, 0, 3.4, 'glass', { lvl: 2.5, h: 0.9, dome: true });
      b.light(11.6, 0, 0.8, b.bp.culture.pal.light, { blink: 1.2 });
    },

    // Hexagonal generator with a glass dome, three emitter arcs on struts that project the field.
    'shield-generator': (b) => {
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * TAU + TAU / 12, [x0, y0] = polar(4.6, a), [x1, y1] = polar(8, a);
        b.strut(x0, y0, x1, y1, 1.2, 'hull2', { lvl: 0.5, h: 1.6 });
        b.poly(U.sector(0, 0, 9, 1.6, a - 0.62, a + 0.62, 8), 'accent', { lvl: 0.8, h: 1.8, bevel: 0.4 });
        const [lx, ly] = polar(9, a);
        b.light(lx, ly, 0.5, b.bp.culture.pal.light, { blink: i * 1.7 });
      }
      b.poly(U.circle(0, 0, 6, 6, TAU / 12), 'hull', { lvl: 1, h: 2.8, bevel: 1.2, roof: true });
      b.ring(0, 0, 4.2, 1, 'trim', { lvl: 2, h: 3.2 });
      b.circle(0, 0, 3.2, 'glass', { lvl: 2.5, h: 0.8, dome: true });
    },

    // Radar dish on a swivel mount with a feed horn and a whip antenna.
    scanner: (b) => {
      b.poly(rrect(-6.4, 0, 5.4, 6.6, 1.2), 'hull2', { lvl: 0.5, h: 2.4, bevel: 0.6, roof: true });
      b.strut(-6.4, 0, 0.4, 0, 1.8, 'hull', { lvl: 0.8, h: 2.6 });
      b.strut(-7.6, -3, -10.6, -7, 0.5, 'trim', { lvl: 1, h: 2.8 });
      b.light(-10.6, -7, 0.55, b.bp.culture.pal.light, { blink: 0.2 });
      b.poly(U.ellipse(1.6, 0, 2.6, 8.4, 0, 18), 'hull', { lvl: 1, h: 3, bevel: 0.8 });
      b.poly(U.ellipse(2.2, 0, 1.7, 6.8, 0, 18), 'panel', { lvl: 1.5, h: 0.3, lines: [[2.2, -6, 2.2, 6], [1, -4, 1, 4], [3.4, -4, 3.4, 4]] });
      for (const s of [1, -1]) b.strut(2.4, s * 5.6, 8, 0, 0.5, 'trim', { lvl: 2, h: 3.2 });
      b.circle(8.2, 0, 1.1, 'glass', { lvl: 2.5, h: 0.6, dome: true });
    },

    // Drive unit: cylindrical body with side tanks and fuel lines, a bell nozzle with a glowing throat.
    engine: (b) => {
      for (const s of [1, -1]) {
        b.poly(rrect(1.6, s * 4.6, 7, 2.6, 1.3), 'hull2', { lvl: 0.5, h: 2.6, bevel: 1, roof: true });
        b.strut(-2, s * 4.4, -6.6, s * 3, 0.8, 'copper', { lvl: 1, h: 3 });
      }
      b.poly([[-5.6, -3], [-11.4, -5.6], [-11.4, 5.6], [-5.6, 3]], 'engine', { lvl: 1, h: 3.2, bevel: 1.2 });
      b.poly([[-6.6, -2.2], [-11, -4.6], [-11, 4.6], [-6.6, 2.2]], 'dark', { lvl: 1.5, h: 0.2, line: false });
      b.poly(U.rect(-10.6, 0, 1, 8.4), 'glass', { lvl: 1.6, h: 0.3, line: false });
      b.poly(U.rect(-11.6, 0, 1, 11.6), 'trim', { lvl: 2, h: 3.4 });
      b.poly(rrect(0.4, 0, 11, 6.6, 1.6), 'hull', { lvl: 1.2, h: 3.6, bevel: 1.2, roof: true });
      b.poly(U.rect(-1.6, 0, 1.2, 6.8), 'accent', { lvl: 2, h: 0.3, line: false });
      b.poly(rrect(6.6, 0, 1.8, 4.4, 0.6), 'hull2', { lvl: 2, h: 0.5 });
      b.light(3.6, -2.2, 0.5, b.bp.culture.pal.light, { blink: 0.8 });
    },

    // Rugged computer core: a cased unit with a lit display, a key row, a vent grille and status lights.
    'ship-computer': (b) => {
      for (const y of [-3, 0, 3]) b.poly(U.rect(-8, y, 2.4, 1.2), 'copper', { lvl: 0.5, h: 1.2 });
      b.poly(rrect(0, 0, 14, 11, 1.4), 'hull', { lvl: 1, h: 3, bevel: 0.8 });
      b.poly(rrect(-1.4, -1.2, 8.2, 5.8, 0.6), 'dark', { lvl: 2, h: 0.3, bevel: 0.2 });
      b.poly(rrect(-1.4, -1.2, 7.2, 4.8, 0.4), 'glass', { lvl: 2.2, h: 0.3, lines: [[-4.4, 0.4, -2.6, -1], [-2.6, -1, -1, 0], [-1, 0, 1.6, -2.6], [-4.6, -2.8, -2, -2.8]] });
      for (let i = 0; i < 4; i++) b.poly(U.rect(-4.4 + i * 2, 3.5, 1.4, 1), i === 3 ? 'accent' : 'hull2', { lvl: 2, h: 0.4, line: false });
      b.poly(U.rect(5.2, 0, 2, 9), 'hull2', { lvl: 2, h: 0.4, lines: [-3, -1.5, 0, 1.5, 3].map((y) => [4.5, y, 5.9, y]) });
      b.light(5.2, -4.8, 0.45, '#6bff8a', { blink: 0.4 });
      b.light(3.2, 3.5, 0.45, b.bp.culture.pal.light, { blink: 1.6 });
    },
  };

  // ---------- Culture variants ----------
  // The same seven units built in a culture's design language (art/culture.js; the overview's
  // Cultures notes). Each build names its parts by function (housing, barrel, collar, tank,
  // appendage, emitter arc, sensor…) and the kit below draws each part in the culture's family:
  //   wedge   chamfered boxes, straight edges, domed round tanks, blue solar panels on struts
  //   block   slabs with panel cells, cylinder banks, paired grey radiator fins
  //   shard   pointed lozenges and needles with ridged tops, hexagonal crystals, light-tipped blades
  //   alien   lobes and wavy veins, nothing straight, sacs with glowing centres, fronds with a bud, eyes
  //   android stepped right angles, squares and diamonds, a sensor square on every module, floating cubes
  //   kitbash every part from a different donor, tinted toward rust, with patches, scorch and a strap
  // Line style takes the culture's line colour; low-poly its palette, lifted toward white for
  // Shard and Android (as their ships are) since items aren't lifted by the renderer.

  const LIFT = { shard: 0.28, android: 0.32 };
  const RUST = '#8a5a3a';
  const LIFTED = ['hull', 'hull2', 'trim', 'panel', 'wing', 'engine', 'strut'];
  function liftPal(c) {
    const k = LIFT[c.lineage], p = { ...c.pal };
    if (k) for (const m of LIFTED) if (p[m]) p[m] = U.mix(p[m], '#ffffff', k);
    return p;
  }
  const place = (pts, cx, cy, a = 0) => pts.map((p) => U.add(U.rot(p, a), [cx, cy]));

  // A housing outline of w (along x) by h, centred on the origin, in family f.
  function outline(f, w, h, r) {
    const W = w / 2, H = h / 2;
    switch (f) {
      case 'block': return U.rect(0, 0, w, h);
      case 'shard': {
        const t = Math.min(w * 0.38, h * 0.9);
        return [[W, 0], [W - t, H], [-W + t * 0.5, H], [-W, 0], [-W + t * 0.5, -H], [W - t, -H]];
      }
      case 'bio': return U.blob(0, 0, W, H, r, 0.22, 9);
      case 'synth': {
        const s = Math.min(w, h) * 0.2;
        return [[W, -H + s], [W, H - s], [W - s, H - s], [W - s, H], [-W + s, H], [-W + s, H - s], [-W, H - s], [-W, -H + s],
          [-W + s, -H + s], [-W + s, -H], [W - s, -H], [W - s, -H + s]];
      }
      default: { // wedge: chamfered, never rounded
        const t = Math.min(w, h) * 0.24;
        return [[W, -H + t], [W, H - t], [W - t, H], [-W + t, H], [-W, H - t], [-W, -H + t], [-W + t, -H], [W - t, -H]];
      }
    }
  }

  function kit(b, c, r) {
    const kb = c.lineage === 'kitbash';
    // Kitbash: each part from a donor; otherwise the culture itself.
    const pick = () => (kb && c.donors?.length ? c.donors[Math.floor(r() * c.donors.length)] : c);
    const fam = (d) => d.hull;
    // A donor's own body colours, tinted toward rust; everything else from the culture.
    const mat = (d, m) => {
      if (!kb || d === c || !['hull', 'hull2', 'trim'].includes(m)) return m;
      const k = LIFT[d.lineage] || 0;
      return U.mix(U.mix(d.pal[m], '#ffffff', k), RUST, 0.25);
    };
    const light = c.pal.light;

    const K = {
      pick, fam, light,
      // A module or housing.
      box(cx, cy, w, h, m, o = {}, a = 0, d = pick()) {
        const f = fam(d), { sensor = true, ...po } = o;
        const grid = f === 'block' && w > 2.5 && h > 2.5 ? [Math.max(1, Math.round(w / 3)), Math.max(1, Math.round(h / 3))] : undefined;
        b.poly(place(outline(f, w, h, r), cx, cy, a), mat(d, m), { roof: f === 'shard', grid, ...po });
        if (f === 'synth' && sensor && Math.min(w, h) > 3) {
          const s = Math.min(w, h) * 0.22;
          b.poly(place(U.rect(0, 0, s, s), cx, cy, a), 'glass', { lvl: (po.lvl || 1) + 0.3, h: 0.3, line: false });
        }
        return d;
      },
      // A round housing about a centre (chambers, generator bases).
      round(cx, cy, R, m, o = {}, d = pick()) {
        const f = fam(d);
        const pts = f === 'block' ? U.rect(cx, cy, R * 1.8, R * 1.8)
          : f === 'shard' ? place(U.circle(0, 0, 1, 6).map(([x, y]) => [x * R * 1.15, y * R * 0.9]), cx, cy)
            : f === 'bio' ? U.blob(cx, cy, R, R * 0.94, r, 0.24, 10)
              : f === 'synth' ? place(U.rect(0, 0, R * 1.42, R * 1.42), cx, cy, TAU / 8)
                : U.circle(cx, cy, R, 8, TAU / 16);
        b.poly(pts, mat(d, m), { roof: f === 'shard', grid: f === 'block' ? [2, 2] : undefined, ...o });
        return d;
      },
      // A glowing core or window: dome, glass slab, crystal, eye or sensor square.
      core(cx, cy, R, o = {}, d = pick()) {
        const f = fam(d), P = { h: 0.8, ...o };
        if (f === 'block') b.poly(U.rect(cx, cy, R * 1.6, R * 1.6), 'glass', { ...P, bevel: R * 0.2 });
        else if (f === 'shard') b.poly([[cx + R * 1.1, cy], [cx, cy + R * 0.8], [cx - R * 1.1, cy], [cx, cy - R * 0.8]], 'glass', { ...P, bevel: R * 0.3 });
        else if (f === 'bio') {
          b.poly(U.ellipse(cx, cy, R, R * 0.72, 0, 14), 'glass', { ...P, dome: true });
          b.poly(U.ellipse(cx, cy, R * 0.22, R * 0.6, 0, 10), 'dark', { lvl: (P.lvl || 1) + 0.2, h: P.h + 0.1, line: false });
        } else if (f === 'synth') {
          b.poly(U.rect(cx, cy, R * 1.5, R * 1.5), 'trim', { ...P, h: P.h * 0.6 });
          b.poly(U.rect(cx, cy, R * 0.9, R * 0.9), 'glass', { ...P, lvl: (P.lvl || 1) + 0.2 });
        } else b.circle(cx, cy, R, 'glass', { ...P, dome: true });
        return d;
      },
      // A barrel from x0 to x1 along y.
      barrel(x0, x1, y, w, m, o = {}, d = pick()) {
        const f = fam(d), L = x1 - x0, M = mat(d, m);
        if (f === 'block') b.poly(U.rect((x0 + x1) / 2, y, L, w * 1.35), M, { grid: [Math.max(2, Math.round(L / 2.4)), 1], ...o });
        else if (f === 'shard') b.poly([[x0, y - w * 0.6], [x1 - L * 0.18, y - w * 0.3], [x1, y], [x1 - L * 0.18, y + w * 0.3], [x0, y + w * 0.6]], M, { roof: true, ...o });
        else if (f === 'bio') {
          const line = Array.from({ length: 11 }, (_, i) => { const t = i / 10; return [x0 + L * t, y + Math.sin(t * TAU * 1.1) * w * 0.28]; });
          b.poly(U.strip(line, (t) => w * (1.15 - 0.45 * t)), M, { roof: true, ...o });
        } else if (f === 'synth') {
          b.strut(x0, y, x1, y, w * 0.28, M, { ...o, h: (o.h || 1) * 0.5, thin: true });
          const n = Math.max(2, Math.round(L / (w * 1.7)));
          for (let i = 0; i < n; i++) b.poly(U.rect(x0 + (i + 0.5) * (L / n), y, w * 0.95, w * 0.95), M, { ...o, lvl: (o.lvl || 1) + 0.1 });
        } else {
          const t = w * 0.3;
          b.poly([[x0, y - w / 2], [x1 - t, y - w / 2], [x1, y - w / 2 + t], [x1, y + w / 2 - t], [x1 - t, y + w / 2], [x0, y + w / 2]], M, o);
        }
        return d;
      },
      // A strut or spine between two points: straight, or a wavy vein, or a thin trace.
      strut(x0, y0, x1, y1, w, m, o = {}, d = pick()) {
        const f = fam(d);
        if (f === 'bio') {
          const dx = x1 - x0, dy = y1 - y0, L = Math.hypot(dx, dy) || 1, nx = -dy / L, ny = dx / L;
          const line = Array.from({ length: 9 }, (_, i) => { const t = i / 8, k = Math.sin(t * TAU) * w * 0.5; return [x0 + dx * t + nx * k, y0 + dy * t + ny * k]; });
          b.poly(U.strip(line, (t) => w * (1.1 - 0.4 * t)), mat(d, m), o);
        } else b.strut(x0, y0, x1, y1, f === 'synth' ? w * 0.45 : f === 'block' ? w * 1.25 : w, mat(d, m), o);
        return d;
      },
      // A store: domed tank, cylinder bank, hexagonal crystal, sac or cube.
      tank(cx, cy, R, m, o = {}, d = pick()) {
        const f = fam(d), M = mat(d, m), lv = o.lvl || 1;
        if (f === 'block') {
          for (const k of [-1, 0, 1]) b.circle(cx + k * R * 0.9, cy, R * 0.48, M, { ...o, h: (o.h || 2) * 0.95 });
          b.poly(U.rect(cx, cy, R * 2.8, R * 0.35), 'hull2', { ...o, lvl: lv + 0.2, h: (o.h || 2) * 1.02, line: false });
        } else if (f === 'shard') {
          b.poly(place(U.circle(0, 0, R, 6).map(([x, y]) => [x * 1.25, y * 0.85]), cx, cy), M, { roof: true, ...o });
          b.poly(U.circle(cx, cy, R * 0.4, 6), 'glass', { lvl: lv + 0.3, h: 0.3, line: false });
        } else if (f === 'bio') {
          b.poly(U.blob(cx, cy, R * 1.1, R * 0.9, r, 0.2, 9), M, { dome: true, ...o });
          b.circle(cx, cy, R * 0.38, 'glass', { lvl: lv + 0.3, h: 0.3, line: false });
        } else if (f === 'synth') {
          b.poly(U.rect(cx, cy, R * 1.6, R * 1.6), M, { bevel: R * 0.12, ...o });
          b.poly(U.rect(cx, cy, R * 0.45, R * 0.45), 'glass', { lvl: lv + 0.3, h: 0.3, line: false });
        } else b.circle(cx, cy, R, M, { dome: true, ...o });
        return d;
      },
      // An appendage from (x0, y0) out to (x1, y1): solar panel, radiator pair, crystal blade,
      // frond with a bud, or a line of floating cubes.
      append(x0, y0, x1, y1, o = {}, d = pick()) {
        const f = fam(d), dx = x1 - x0, dy = y1 - y0, L = Math.hypot(dx, dy) || 1, a = Math.atan2(dy, dx), lv = o.lvl || 0.6, h = o.h || 1.6;
        const at = (t) => [x0 + dx * t, y0 + dy * t];
        if (f === 'block') {
          for (const s of [-1, 1]) b.poly(place(U.rect(L * 0.55, s * L * 0.18, L * 0.9, L * 0.22), x0, y0, a), mat(d, 'hull2'), { lvl: lv, h, lines: [[...at(0.2), ...at(0.95)]] });
        } else if (f === 'shard') {
          b.poly(place([[0, -L * 0.14], [L, 0], [0, L * 0.14]], x0, y0, a), mat(d, 'trim'), { lvl: lv, h, roof: true });
          b.light(x1, y1, 0.5, light, { blink: r() * 2 });
        } else if (f === 'bio') {
          const line = Array.from({ length: 9 }, (_, i) => { const t = i / 8, k = Math.sin(t * Math.PI * 1.5) * L * 0.12; return U.add(at(t), U.rot([0, k], a)); });
          b.poly(U.strip(line, (t) => L * 0.22 * (1 - 0.7 * t)), 'wing', { lvl: lv, h, roof: true });
          b.circle(...line[8], L * 0.1, 'glass', { lvl: lv + 0.1, h: h * 0.9, dome: true });
        } else if (f === 'synth') {
          b.strut(x0, y0, x1, y1, 0.3, 'trim', { lvl: lv, h: h * 0.5, thin: true });
          for (const t of [0.42, 0.7, 0.98]) b.poly(place(U.rect(0, 0, L * 0.18, L * 0.18), ...at(t), a), mat(d, 'hull2'), { lvl: lv + 0.1, h });
        } else {
          b.strut(x0, y0, ...at(0.35), L * 0.08, mat(d, 'hull2'), { lvl: lv, h: h * 0.8 });
          b.poly(place(U.rect(L * 0.68, 0, L * 0.64, L * 0.42), x0, y0, a), 'panel', { lvl: lv + 0.1, h: h * 0.5, grid: [3, 2] });
        }
        return d;
      },
      // A fin pair at the tail (x, from the body edge at |y| = y0, reaching span out).
      fins(x, y0, span, chord, o = {}) {
        for (const s of [1, -1]) {
          const d = pick(), f = fam(d), M = mat(d, 'hull2'), P = { lvl: 1, h: 2, ...o };
          const Y = (v) => s * v;
          if (f === 'block') b.poly(U.rect(x - chord * 0.3, Y(y0 + span / 2), chord, span), M, P);
          else if (f === 'shard') b.poly([[x + chord * 0.6, Y(y0)], [x - chord * 1.4, Y(y0 + span * 1.2)], [x - chord * 0.6, Y(y0)]], M, { ...P, roof: true });
          else if (f === 'bio') b.poly(U.chaikin([[x + chord * 0.5, Y(y0)], [x - chord * 0.4, Y(y0 + span)], [x - chord * 1.2, Y(y0 + span * 0.9)], [x - chord * 0.6, Y(y0)]], 2), 'wing', P);
          else if (f === 'synth') b.poly(U.rect(x - chord * 0.3, Y(y0 + span * 0.65), chord * 0.8, chord * 0.8), M, P);
          else b.poly([[x + chord * 0.4, Y(y0)], [x - chord * 0.6, Y(y0 + span)], [x - chord, Y(y0 + span)], [x - chord * 0.8, Y(y0)]], M, P);
        }
      },
      // A nose or muzzle tip from x0 to x1 (pointing +x), w wide at the base.
      nose(x0, x1, y, w, m, o = {}, d = pick()) {
        const f = fam(d), L = x1 - x0, M = mat(d, m);
        const pts = f === 'block' ? [[x0, y - w / 2], [x1 - L * 0.3, y - w / 2], [x1, y - w * 0.3], [x1, y + w * 0.3], [x1 - L * 0.3, y + w / 2], [x0, y + w / 2]]
          : f === 'shard' ? [[x0, y - w / 2], [x1 + L * 0.5, y], [x0, y + w / 2]]
            : f === 'bio' ? U.chaikin([[x0, y - w / 2], [x1, y - w * 0.15], [x1, y + w * 0.15], [x0, y + w / 2]], 2)
              : f === 'synth' ? [[x0, y - w / 2], [x0 + L * 0.5, y - w / 2], [x0 + L * 0.5, y - w * 0.25], [x1, y - w * 0.25], [x1, y + w * 0.25], [x0 + L * 0.5, y + w * 0.25], [x0 + L * 0.5, y + w / 2], [x0, y + w / 2]]
                : [[x0, y - w / 2], [x1, y - w * 0.12], [x1, y + w * 0.12], [x0, y + w / 2]];
        b.poly(pts, M, { roof: true, ...o });
        return d;
      },
      // A nozzle flaring from x0 (w0 wide) back to x1 (w1 wide).
      nozzle(x0, x1, w0, w1, m, o = {}, d = pick()) {
        const f = fam(d), M = mat(d, m), dx = x1 - x0;
        const pts = f === 'block' ? [[x0, -w0 / 2], [x0 + dx * 0.45, -w0 / 2], [x0 + dx * 0.45, -w1 / 2], [x1, -w1 / 2], [x1, w1 / 2], [x0 + dx * 0.45, w1 / 2], [x0 + dx * 0.45, w0 / 2], [x0, w0 / 2]]
          : f === 'bio' ? U.chaikin([[x0, -w0 / 2], [x0 + dx * 0.6, -w1 * 0.42], [x1, -w1 / 2], [x1, w1 / 2], [x0 + dx * 0.6, w1 * 0.42], [x0, w0 / 2]], 2)
            : f === 'synth' ? [[x0, -w0 / 2], [x0 + dx * 0.5, -w0 / 2], [x0 + dx * 0.5, -w1 / 2], [x1, -w1 / 2], [x1, w1 / 2], [x0 + dx * 0.5, w1 / 2], [x0 + dx * 0.5, w0 / 2], [x0, w0 / 2]]
              : f === 'shard' ? [[x0, -w0 / 2], [x1 - dx * 0.25, -w1 / 2], [x1, -w1 * 0.2], [x1, w1 * 0.2], [x1 - dx * 0.25, w1 / 2], [x0, w0 / 2]]
                : [[x0, -w0 / 2], [x1, -w1 / 2], [x1, w1 / 2], [x0, w0 / 2]];
        b.poly(pts, M, o);
        return { d, pts };
      },
      // An emitter arc at radius R between angles a0 and a1.
      arc(R, a0, a1, w, m, o = {}, d = pick()) {
        const f = fam(d), am = (a0 + a1) / 2, [mx, my] = polar(R, am), len = 2 * R * Math.sin((a1 - a0) / 2);
        if (f === 'bio') b.poly(U.chaikin(U.sector(0, 0, R, w, a0, a1, 8), 1), 'wing', o);
        else if (f === 'synth') for (let i = 0; i < 3; i++) { const aa = a0 + ((i + 0.5) / 3) * (a1 - a0), [x, y] = polar(R, aa); b.poly(place(U.rect(0, 0, w * 1.1, w * 1.1), x, y, aa), mat(d, m), o); }
        else K.box(mx, my, len, w, m, { ...o, sensor: false }, am + TAU / 4, d);
        return d;
      },
      // A sensor head facing +x: dish, phased array, crystal lens, eye or aperture.
      sensor(cx, cy, R, o = {}, d = pick()) {
        const f = fam(d), lv = o.lvl || 1;
        if (f === 'block') {
          b.poly(U.rect(cx, cy, R * 0.5, R * 2), mat(d, 'hull'), { lvl: lv, h: 3, bevel: 0.4 });
          b.poly(U.rect(cx + 0.2, cy, R * 0.34, R * 1.8), 'panel', { lvl: lv + 0.5, h: 0.3, grid: [1, 6] });
        } else if (f === 'shard') {
          b.poly([[cx - R * 0.4, cy], [cx + R * 0.1, cy - R], [cx + R * 0.6, cy], [cx + R * 0.1, cy + R]], mat(d, 'trim'), { lvl: lv, h: 2.6, roof: true });
          b.poly([[cx - R * 0.15, cy], [cx + R * 0.15, cy - R * 0.7], [cx + R * 0.45, cy], [cx + R * 0.15, cy + R * 0.7]], 'glass', { lvl: lv + 0.5, h: 0.6, roof: true });
        } else if (f === 'bio') {
          b.poly(U.blob(cx, cy, R * 0.45, R, r, 0.18, 10), mat(d, 'hull'), { lvl: lv, h: 3 });
          b.poly(U.ellipse(cx + R * 0.1, cy, R * 0.3, R * 0.7, 0, 14), 'glass', { lvl: lv + 0.5, h: 0.6, dome: true });
          b.poly(U.ellipse(cx + R * 0.15, cy, R * 0.1, R * 0.4, 0, 8), 'dark', { lvl: lv + 0.7, h: 0.7, line: false });
        } else if (f === 'synth') {
          for (const [k, m, l] of [[2, 'hull2', 0], [1.4, 'trim', 0.3], [0.8, 'hull2', 0.6]]) b.poly(U.rect(cx, cy, R * 0.32 * k, R * k), mat(d, m), { lvl: lv + l, h: 2.4 - l * 2 });
          b.poly(place(U.rect(0, 0, R * 0.3, R * 0.3), cx, cy, TAU / 8), 'glass', { lvl: lv + 1, h: 0.4 });
        } else {
          b.poly(U.ellipse(cx, cy, R * 0.3, R, 0, 18), mat(d, 'hull'), { lvl: lv, h: 3, bevel: 0.8 });
          b.poly(U.ellipse(cx + 0.6, cy, R * 0.2, R * 0.8, 0, 18), 'panel', { lvl: lv + 0.5, h: 0.3, lines: [[cx + 0.6, cy - R * 0.7, cx + 0.6, cy + R * 0.7]] });
          for (const s of [1, -1]) b.strut(cx + 0.8, cy + s * R * 0.66, cx + R * 0.75, cy, 0.5, 'trim', { lvl: lv + 1, h: 3.2 });
          b.circle(cx + R * 0.78, cy, R * 0.13, 'glass', { lvl: lv + 1.5, h: 0.6, dome: true });
        }
        return d;
      },
    };
    return K;
  }

  const CULTURE_BUILD = {
    laser: (b, K) => {
      K.append(-8.4, -2.4, -11.4, -6.6);
      K.append(-8.4, 2.4, -11.4, 6.6);
      K.barrel(-2, 8.6, 0, 2, 'hull2', { lvl: 0.8, h: 1.8 });
      for (const x of [0.8, 3.6, 6.4]) K.box(x, 0, 1.1, 3.4, 'trim', { lvl: 1.2, h: 2.2, sensor: false });
      K.box(-5.4, 0, 8, 6.4, 'hull', { lvl: 1, h: 3, bevel: 1 });
      b.poly(U.rect(-5.8, 2.2, 4.4, 0.9), 'accent', { lvl: 2, h: 0.3, line: false });
      K.core(10.2, 0, 1.5, { lvl: 1.6, h: 1.4 });
      b.light(-2.4, -2.2, 0.5, K.light, { blink: 0.3 });
    },
    'missile-launcher': (b, K) => {
      K.box(-0.6, 0, 16.4, 2.6, 'hull2', { lvl: 0.5, h: 1.2, sensor: false });
      for (const x of [-7.6, 6.6]) K.box(x, 0, 1.6, 5.4, 'hull', { lvl: 0.6, h: 1.4, sensor: false });
      K.fins(-4.6, 1.4, 3.4, 2.4, { lvl: 1, h: 2 });
      K.box(-0.6, 0, 12.6, 3.4, 'trim', { lvl: 1.2, h: 2.6, bevel: 1, sensor: false });
      K.nose(5.6, 9.8, 0, 3.4, 'accent', { lvl: 1.4, h: 2.4, bevel: 0.8 });
      b.poly(U.rect(2.4, 0, 1, 3.5), 'accent', { lvl: 1.8, h: 0.3, line: false });
      b.light(-7.6, 2.8, 0.5, K.light, { blink: 0.6 });
    },
    'plasma-cannon': (b, K) => {
      for (const s of [1, -1]) K.tank(-4, s * 5.8, 1.6, 'hull2', { lvl: 0.5, h: 2 });
      K.barrel(0.5, 9.6, 0, 2.6, 'hull2', { lvl: 0.8, h: 2 });
      for (const x of [2.6, 5, 7.4]) K.box(x, 0, 1.3, 4.8, 'accent', { lvl: 1.2, h: 2.6, bevel: 0.4, sensor: false });
      K.nose(9.4, 11.8, 0, 4.6, 'hull', { lvl: 1, h: 2.4, bevel: 0.6 });
      K.round(-4, 0, 5.2, 'hull', { lvl: 1, h: 3.2, bevel: 1.2 });
      K.round(-4, 0, 4, 'trim', { lvl: 2, h: 0.4 });
      K.core(-4, 0, 2.8, { lvl: 2.5, h: 0.9 });
      b.light(11, 0, 0.8, K.light, { blink: 1.2 });
    },
    'shield-generator': (b, K) => {
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * TAU + TAU / 12, [x0, y0] = polar(4.4, a), [x1, y1] = polar(8.2, a);
        K.strut(x0, y0, x1, y1, 1.2, 'hull2', { lvl: 0.5, h: 1.6 });
        K.arc(9, a - 0.6, a + 0.6, 1.6, 'accent', { lvl: 0.8, h: 1.8, bevel: 0.4 });
        const [lx, ly] = polar(9, a);
        b.light(lx, ly, 0.5, K.light, { blink: i * 1.7 });
      }
      K.round(0, 0, 6, 'hull', { lvl: 1, h: 2.8, bevel: 1.2 });
      K.round(0, 0, 4.4, 'trim', { lvl: 2, h: 0.4 });
      K.core(0, 0, 3, { lvl: 2.5, h: 0.8 });
    },
    scanner: (b, K) => {
      K.box(-6.4, 0, 5.4, 6.6, 'hull2', { lvl: 0.5, h: 2.4, bevel: 0.6 });
      K.strut(-6.4, 0, 0.4, 0, 1.8, 'hull', { lvl: 0.8, h: 2.6 });
      b.strut(-7.6, -3, -10.6, -7, 0.5, 'trim', { lvl: 1, h: 2.8 });
      b.light(-10.6, -7, 0.55, K.light, { blink: 0.2 });
      K.sensor(2, 0, 8.4, { lvl: 1 });
    },
    engine: (b, K) => {
      for (const s of [1, -1]) {
        K.tank(1.6, s * 4.8, 1.8, 'hull2', { lvl: 0.5, h: 2.6, bevel: 1 });
        K.strut(-2, s * 4.4, -6.6, s * 3, 0.8, 'strut', { lvl: 1, h: 3 });
      }
      K.nozzle(-5.6, -11.4, 6, 11.2, 'engine', { lvl: 1, h: 3.2, bevel: 1.2 });
      b.poly([[-6.6, -2.2], [-11, -4.6], [-11, 4.6], [-6.6, 2.2]], 'dark', { lvl: 1.5, h: 0.2, line: false });
      b.poly(U.rect(-10.6, 0, 1, 8.4), 'glass', { lvl: 1.6, h: 0.3, line: false });
      K.box(0.4, 0, 11, 6.6, 'hull', { lvl: 1.2, h: 3.6, bevel: 1.2 });
      b.poly(U.rect(-1.6, 0, 1.2, 6.8), 'accent', { lvl: 2, h: 0.3, line: false });
      K.box(6.6, 0, 1.8, 4.4, 'hull2', { lvl: 2, h: 0.5, sensor: false });
      b.light(3.6, -2.2, 0.5, K.light, { blink: 0.8 });
    },
    'ship-computer': (b, K) => {
      for (const y of [-3, 0, 3]) K.box(-8, y, 2.4, 1.2, 'hull2', { lvl: 0.5, h: 1.2, sensor: false });
      const d = K.box(0, 0, 14, 11, 'hull', { lvl: 1, h: 3, bevel: 0.8 });
      const f = K.fam(d);
      // The display in the housing's own family: a glass slab, a lens, a membrane eye, a sensor field.
      if (f === 'bio') K.core(-1.4, -1.2, 3.4, { lvl: 2, h: 0.4 }, d);
      else {
        K.box(-1.4, -1.2, 8.2, 5.8, 'dark', { lvl: 2, h: 0.3, sensor: false }, 0, d);
        b.poly(place(outline(f, 7.2, 4.8), -1.4, -1.2), 'glass', { lvl: 2.2, h: 0.3, roof: false, lines: [[-4.4, 0.4, -2.6, -1], [-2.6, -1, -1, 0], [-1, 0, 1.6, -2.6]] });
      }
      for (let i = 0; i < 4; i++) K.box(-4.4 + i * 2, 3.5, 1.4, 1, i === 3 ? 'accent' : 'hull2', { lvl: 2, h: 0.4, line: false, sensor: false });
      K.box(5.2, 0, 2, 9, 'hull2', { lvl: 2, h: 0.4, sensor: false, lines: [-3, -1.5, 0, 1.5, 3].map((y) => [4.5, y, 5.9, y]) });
      b.light(5.2, -4.8, 0.45, '#6bff8a', { blink: 0.4 });
      b.light(3.2, 3.5, 0.45, K.light, { blink: 1.6 });
    },
  };

  // Drifter finish: plates in donor colours and scorch on the biggest part, and a strap across it.
  function kitbashFinish(b, c, r) {
    let big = null, A = 0;
    for (const p of b.bp.parts) if (p.shape === 'poly') { const a = Math.abs(U.area(p.pts)); if (a > A) { A = a; big = p; } }
    if (!big) return;
    const [x0, y0, x1, y1] = U.bbox(big.pts), size = Math.min(x1 - x0, y1 - y0) * 0.22;
    B.addPatches(b, c, r, big.pts, size, 3);
    const x = x0 + (x1 - x0) * (0.3 + r() * 0.4);
    b.strut(x, y0 - 0.4, x + 0.4, y1 + 0.4, 0.7, '#3a3530', { lvl: big.lvl + 2.5, h: 0.2, thin: true });
  }

  function createForCulture(kind, culture, seed) {
    const s = seed >>> 0;
    const r = mulberry32(hashInt(s, 13, kind.length * 131 + kind.charCodeAt(0)));
    const c = { ...culture, pal: liftPal(culture) };
    const b = B.builder('item', c, s);
    CULTURE_BUILD[kind](b, kit(b, culture, r));
    if (culture.lineage === 'kitbash') kitbashFinish(b, culture, r);
    b.bp.line = culture.pal.line;
    const t = BY_ID[kind];
    Object.assign(b.bp, {
      id: `equip:${kind}:${culture.lineage}:${culture.seed ?? 0}:${s}`,
      kind, category: 'equipment', group: t.group, lineage: culture.lineage,
      label: `Equipment · ${culture.name || culture.label} ${t.name.toLowerCase()}`,
    });
    return B.finish(b.bp);
  }

  const has = (id) => !!BY_ID[id];

  function create(kind, seed = 1, o = {}) {
    const t = BY_ID[kind];
    if (!t) throw new Error(`Unknown equipment: ${kind}`);
    if (o.culture) return createForCulture(kind, o.culture, seed);
    const color = o.color || t.color;
    const s = seed >>> 0;
    const r = mulberry32(hashInt(s, 11, kind.length * 131 + kind.charCodeAt(0)));
    const b = B.builder('item', { pal: pal(color), seed: 0 }, s);
    BUILD[kind](b, r);
    Object.assign(b.bp, {
      id: `equip:${kind}:${s}${o.color ? `:${o.color.join(',')}` : ''}`,
      kind, category: 'equipment', group: t.group, label: `Equipment · ${t.name}`,
    });
    return B.finish(b.bp);
  }

  return { KINDS, GROUPS, has, create, kit, outline };
})();

export { ArtEquipment };
