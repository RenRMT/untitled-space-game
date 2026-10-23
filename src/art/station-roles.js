// Station roles: refinery, factory, shipyard, research station and command center, each built in a
// culture's design language (module shapes, tanks, arrays, palette). Where a culture's existing
// major station already fits a role (EXISTING), create() returns that station instead. A size
// ('major' or 'minor', as world/solar-system.js sizes stations) scales a build to match.
// Blueprints draw in both styles like any other (art/render.js treats them as stations).
// ES module (`ArtStationRoles`).

import { ArtUtil } from './util.js';
import { ArtBlueprints } from './blueprints.js';
import { hashInt, mulberry32 } from '../core/rng.js';

const ArtStationRoles = (() => {
  const U = ArtUtil, { TAU } = U, B = ArtBlueprints;
  const ROLES = ['refinery', 'factory', 'shipyard', 'research', 'command'];
  const LABEL = { refinery: 'Refinery', factory: 'Factory', shipyard: 'Shipyard', research: 'Research station', command: 'Command center' };
  const DESC = { refinery: 'tank ring, cracking tower, scoop boom', factory: 'halls on a line, furnace', shipyard: 'dock, hull on the slip', research: 'dish, sensor booms, labs', command: 'armoured hub, docks, turrets' };
  // The role each culture's existing major station takes: the wheel and the hive are seats of
  // power, the lattice is industry, the crystal star and the monolith are instruments.
  const EXISTING = { wedge: 'command', block: 'factory', shard: 'research', alien: 'command', android: 'research', kitbash: 'command' };
  const SCALE = { major: 1.2, minor: 0.75 };

  const P = (pts, x, y, a) => pts.map((p) => U.add(U.rot(p, a), [x, y]));
  const NEUTRAL = new Set(['glass', 'accent', 'dark', 'panel', 'strut', 'flame']);

  // The design language of the next component: hull family and a material lookup. Drifters take
  // each component from a different donor, its colours pulled toward rust.
  function lang(c, r) {
    if (c.lineage !== 'kitbash' || !c.donors?.length) return { f: c.hull, m: (k) => k };
    const d = c.donors[Math.floor(r() * c.donors.length)];
    return { f: d.hull, m: (k) => (NEUTRAL.has(k) ? k : U.mix(d.pal[k] || d.pal.hull, '#8a8070', 0.25)) };
  }

  function shape(f, w, h, r) {
    const W = w / 2, H = h / 2, k = Math.min(w, h) * 0.24;
    switch (f) {
      case 'wedge': return [[-W + k, -H], [W - k, -H], [W, -H + k], [W, H - k], [W - k, H], [-W + k, H], [-W, H - k], [-W, -H + k]];
      case 'shard': return [[W, 0], [W - k * 1.6, -H], [-W + k * 1.6, -H], [-W, 0], [-W + k * 1.6, H], [W - k * 1.6, H]];
      case 'bio': return U.blob(0, 0, W, H, r, 0.22, 10);
      default: return U.rect(0, 0, w, h);
    }
  }

  // A module: chamfered (wedge), slab with panel cells (block), lozenge (shard), lobe (alien),
  // block with a sensor square (android).
  function mod(b, L, x, y, w, h, a, mat, r, o = {}) {
    const s = Math.min(w, h), roof = L.f === 'shard' || L.f === 'bio', lvl = o.lvl ?? 2, layer = o.layer || 'fixed';
    const grid = L.f === 'block' && w > h * 1.5 ? [Math.round(w / h), 1] : undefined;
    b.poly(P(shape(L.f, w, h, r), x, y, a), L.m(mat), { h: s * 0.45, bevel: s * (roof ? 0.3 : 0.1), roof, grid, ...o, lvl, layer });
    if (L.f === 'synth' && !o.plain) b.poly(U.rect(x, y, s * 0.28, s * 0.28, a), 'glass', { lvl: lvl + 0.05, h: (o.h ?? s * 0.45) * 1.05, layer });
  }

  // A round store: tank (wedge), cylinder bank (block), hex crystal (shard), sac (alien), cube (android).
  function tank(b, L, x, y, s, r, o = {}) {
    const lvl = o.lvl ?? 2, a = o.a || 0, lay = { layer: o.layer || 'fixed' };
    switch (L.f) {
      case 'block':
        b.poly(U.rect(x, y, s * 1.8, s * 1.3, a), L.m('hull'), { ...lay, lvl, h: s * 0.9, bevel: s * 0.35, grid: [3, 1] }); break;
      case 'shard':
        b.poly(U.circle(x, y, s, 6, a), L.m('hull2'), { ...lay, lvl, h: s * 0.4, bevel: s * 0.5, roof: true });
        b.poly(U.circle(x, y, s * 0.4, 6, a + Math.PI / 6), 'glass', { ...lay, lvl: lvl + 0.1, h: s * 0.6 }); break;
      case 'bio':
        b.poly(U.blob(x, y, s * 1.05, s * 0.95, r, 0.25, 10), L.m('wing'), { ...lay, lvl, h: s * 0.6, bevel: s * 0.5, roof: true });
        b.circle(x, y, s * 0.35, 'glass', { ...lay, lvl: lvl + 0.1, h: s * 0.7, dome: true }); break;
      case 'synth':
        b.poly(U.rect(x, y, s * 1.7, s * 1.7, a), L.m('hull2'), { ...lay, lvl, h: s * 0.7, bevel: s * 0.15 });
        b.poly(U.rect(x, y, s * 0.6, s * 0.6, a), 'glass', { ...lay, lvl: lvl + 0.1, h: s * 0.72 }); break;
      default:
        b.circle(x, y, s, L.m('trim'), { ...lay, lvl, h: s * 0.8, dome: true });
        b.circle(x, y, s * 0.3, 'accent', { ...lay, lvl: lvl + 0.1, h: s * 0.82 });
    }
  }

  // An appendage from (x, y) along angle a: solar panel (wedge), radiator pair (block), crystal
  // blade (shard), frond with a bud (alien), a line of floating cubes (android).
  function array(b, L, c, x, y, a, len, R, r, o = {}) {
    const d = [Math.cos(a), Math.sin(a)], n = [-d[1], d[0]], lvl = o.lvl ?? 1;
    const at = (t, side = 0) => [x + d[0] * t + n[0] * side, y + d[1] * t + n[1] * side];
    const [mx, my] = at(len * 0.55);
    switch (L.f) {
      case 'wedge':
        b.strut(x, y, ...at(len * 0.15), R * 0.03, 'strut', { lvl: lvl - 0.1, thin: true });
        b.poly(U.rect(mx, my, len * 0.8, R * 0.2, a), 'panel', { lvl, h: R * 0.02, grid: [5, 1] }); break;
      case 'block':
        b.strut(x, y, ...at(len), R * 0.035, 'strut', { lvl: lvl - 0.1, thin: true });
        for (const s of [-1, 1]) b.poly(U.rect(...at(len * 0.55, s * R * 0.09), len * 0.8, R * 0.1, a), 'panel', { lvl, h: R * 0.02, grid: [6, 1] });
        break;
      case 'shard':
        b.poly([at(0), at(len * 0.25, R * 0.07), at(len), at(len * 0.25, -R * 0.07)], L.m('hull2'), { lvl, h: R * 0.04, bevel: R * 0.05, roof: true });
        b.poly([at(len * 0.15), at(len * 0.3, R * 0.02), at(len * 0.85), at(len * 0.3, -R * 0.02)], 'accent', { lvl: lvl + 0.1, h: R * 0.05 });
        b.light(...at(len), 2, c.pal.light, { blink: r() * 3 }); break;
      case 'bio': {
        const ph = r() * TAU, curl = (r() - 0.5) * 0.8;
        const line = Array.from({ length: 9 }, (_, k) => { const u = k / 8, aa = a + curl * u * u + Math.sin(u * 5 + ph) * 0.08; return [x + Math.cos(aa) * len * u, y + Math.sin(aa) * len * u]; });
        b.poly(U.strip(line, (u) => R * 0.08 * (1 - u * 0.75)), 'hull2', { lvl, h: R * 0.05, bevel: R * 0.04, roof: true });
        b.circle(...line[8], R * 0.045, 'glass', { lvl: lvl + 0.1, h: R * 0.06, dome: true });
        b.light(...line[8], 2, c.pal.light, { blink: r() * 3 }); break;
      }
      case 'synth': {
        const k = Math.max(2, Math.round(len / (R * 0.2))), s = R * 0.09;
        b.strut(x, y, ...at(len), R * 0.012, 'accent', { lvl: lvl - 0.1, thin: true });
        for (let i = 1; i <= k; i++) b.poly(U.rect(...at((len * i) / k), s, s, a), 'trim', { lvl, h: R * 0.06, bevel: s * 0.15 });
        break;
      }
    }
  }

  const nav = (b, x1, y1, x2, y2) => { b.light(x1, y1, 3, '#ff4d4d', { blink: 0 }); b.light(x2, y2, 3, '#4dff88', { blink: 0 }); };

  // ---------- Refinery: a round tank farm about a cracking tower, a scoop boom, a flare boom ----------

  function scoop(b, L, x, R, r) {
    switch (L.f) {
      case 'block':
        b.poly(U.rect(x + R * 0.17, 0, R * 0.34, R * 0.56), L.m('hull'), { lvl: 2, h: R * 0.12, bevel: R * 0.03, grid: [1, 4] });
        b.poly(U.rect(x + R * 0.35, 0, R * 0.04, R * 0.5), 'accent', { lvl: 2.2, h: R * 0.13 });
        return [x + R * 0.34, R * 0.28];
      case 'shard':
        for (const s of [-1, 1]) b.poly([[x, s * R * 0.04], [x + R * 0.5, s * R * 0.36], [x + R * 0.28, s * R * 0.1]], L.m('hull2'), { lvl: 2, h: R * 0.05, bevel: R * 0.05, roof: true });
        b.poly([[x + R * 0.05, 0], [x + R * 0.3, -R * 0.05], [x + R * 0.42, 0], [x + R * 0.3, R * 0.05]], 'glass', { lvl: 2.1, h: R * 0.06 });
        return [x + R * 0.5, R * 0.36];
      case 'bio':
        b.poly(U.blob(x + R * 0.2, 0, R * 0.24, R * 0.3, r, 0.2, 10), L.m('trim'), { lvl: 2, h: R * 0.1, bevel: R * 0.08, roof: true });
        b.poly(U.blob(x + R * 0.28, 0, R * 0.1, R * 0.18, r, 0.2, 9), 'dark', { lvl: 2.2, h: R * 0.11 });
        return [x + R * 0.3, R * 0.28];
      case 'synth': {
        const c0 = x + R * 0.25, S = R * 0.46, t = R * 0.06;
        for (const [dx, dy, w, h] of [[0, -S / 2, S, t], [0, S / 2, S, t], [-S / 2, 0, t, S - t]]) b.poly(U.rect(c0 + dx, dy, w, h), L.m('hull2'), { lvl: 2, h: R * 0.08, bevel: t * 0.3 });
        return [c0 + S / 2, S / 2];
      }
      default:
        b.poly([[x, -R * 0.07], [x + R * 0.45, -R * 0.3], [x + R * 0.5, -R * 0.3], [x + R * 0.5, R * 0.3], [x + R * 0.45, R * 0.3], [x, R * 0.07]], L.m('hull'), { lvl: 2, h: R * 0.1, bevel: R * 0.04 });
        b.poly(U.rect(x + R * 0.47, 0, R * 0.03, R * 0.5), 'accent', { lvl: 2.2, h: R * 0.11 });
        return [x + R * 0.5, R * 0.3];
    }
  }

  function spine(b, L, x0, x1, w, R, r, mat = 'hull2', lvl = 3) {
    if (L.f === 'bio') {
      const ph = r() * TAU, line = Array.from({ length: 9 }, (_, k) => [x0 + (x1 - x0) * (k / 8), Math.sin((k / 8) * 3 + ph) * R * 0.04]);
      b.poly(U.strip(line, w * 0.7), L.m(mat), { lvl, h: R * 0.08, bevel: R * 0.06, roof: true });
    } else mod(b, L, (x0 + x1) / 2, 0, x1 - x0, w, 0, mat, r, { lvl, h: R * 0.08 });
  }

  function refinery(b, c, r, R) {
    const core = lang(c, r), N = core.f === 'shard' ? 6 : core.f === 'bio' ? 7 : 6, d = R * 0.44, a0 = Math.PI / N;
    // Pipe ring joining the tanks, and a spoke from each tank to the tower.
    b.ring(0, 0, d, R * 0.035, core.m('strut'), { lvl: 0.5, h: R * 0.03 });
    for (let i = 0; i < N; i++) {
      const a = a0 + (i / N) * TAU, x = Math.cos(a) * d, y = Math.sin(a) * d, s = R * (0.15 + (i % 2) * 0.03);
      b.strut(0, 0, x, y, R * 0.045, 'strut', { lvl: 1, h: R * 0.04, thin: true });
      tank(b, c.lineage === 'kitbash' ? lang(c, r) : core, x, y, s, r, { a });
      b.light(x + Math.cos(a) * s * 0.7, y + Math.sin(a) * s * 0.7, 2, c.pal.light, { blink: i * 0.6 });
    }
    // Cracking tower: stepped rings rising to a hot core.
    tank(b, core, 0, 0, R * 0.2, r, { lvl: 3 });
    b.ring(0, 0, R * 0.26, R * 0.03, core.m('trim'), { lvl: 2.8, h: R * 0.14 });
    b.circle(0, 0, R * 0.06, 'flame', { lvl: 3.5, h: R * 0.24 });
    b.light(0, 0, 3, c.pal.flame, { blink: 0.4 });
    // A long boom to the gas scoop, and a short one to the flare.
    const bx = R * 1.15;
    spine(b, core, d * 0.2, bx, R * 0.08, R, r, 'hull2', 0.8);
    const [tx, ty] = scoop(b, lang(c, r), bx, R, r);
    b.strut(-d * 0.3, 0, -R * 0.95, 0, R * 0.035, 'strut', { lvl: 0.8, thin: true });
    for (let k = 0; k < 3; k++) b.circle(-R * (0.98 + k * 0.07), (k - 1) * R * 0.025, R * (0.05 - k * 0.012), 'flame', { lvl: 1 + k * 0.1, h: R * 0.04 });
    b.light(-R * 0.98, 0, 3, c.pal.flame, { blink: 1.1 });
    for (const sg of [-1, 1]) array(b, lang(c, r), c, -R * 0.62, sg * R * 0.02, Math.PI - sg * 1.25, R * 0.45, R, r);
    nav(b, tx, -ty, tx, ty);
  }

  // ---------- Factory: assembly halls on a production line, a furnace feeding it ----------

  function factory(b, c, r, R) {
    const xs = [-0.62, 0, 0.62].map((v) => v * R), w = R * 0.5, h = R * 0.32, core = lang(c, r);
    spine(b, core, -R * 0.9, R * 0.9, R * 0.1, R, r, 'hull2', 1.5);
    xs.forEach((x, i) => {
      const L = lang(c, r);
      mod(b, L, x, 0, w, h, 0, i === 1 ? 'hull' : 'hull2', r, { lvl: 2, h: R * 0.12 });
      for (const sg of [-1, 1]) {
        for (const dx of [-w * 0.28, w * 0.28]) {
          b.poly(U.rect(x + dx, sg * (h / 2 + R * 0.035), R * 0.09, R * 0.07), L.m('trim'), { lvl: 2.4, h: R * 0.1, bevel: R * 0.01 });
        }
        b.light(x, sg * (h / 2 + R * 0.02), 2, c.pal.light, { blink: i * 0.7 + sg });
      }
    });
    b.poly(U.rect(0, 0, R * 1.75, R * 0.045), 'accent', { lvl: 3, h: R * 0.13 });
    for (let k = 0; k < 7; k++) {
      const x = -R * 0.78 + k * R * 0.26;
      if (core.f === 'bio') b.circle(x, 0, R * 0.035, 'glass', { lvl: 3.1, h: R * 0.15, dome: true });
      else b.poly(U.rect(x, 0, R * 0.06, R * 0.06, core.f === 'shard' ? Math.PI / 4 : 0), core.f === 'synth' ? 'glass' : 'trim', { lvl: 3.1, h: R * 0.15 });
    }
    tank(b, core, -R * 1.05, 0, R * 0.2, r, { lvl: 3 });
    b.light(-R * 1.05, 0, 3, c.pal.flame, { blink: 0.2 });
    for (const sg of [-1, 1]) {
      b.poly(U.rect(R * 1.02, sg * R * 0.1, R * 0.3, R * 0.05), core.m('hull2'), { lvl: 2, h: R * 0.06, bevel: R * 0.01 });
      for (const x of [xs[0], xs[2]]) array(b, lang(c, r), c, x, sg * (h / 2 + R * 0.07), sg * Math.PI / 2, R * 0.55, R, r);
    }
    nav(b, R * 1.17, -R * 0.1, R * 1.17, R * 0.1);
  }

  // ---------- Shipyard: an open dock, gantries across it, a hull half-built on the slip ----------

  function hullHalf(f, L, W) {
    switch (f) {
      case 'block': return [[L / 2, 0], [L / 2, W * 0.6], [L * 0.35, W], [-L / 2, W], [-L / 2, 0]];
      case 'shard': return [[L / 2, 0], [-L * 0.1, W * 0.55], [-L / 2, W * 0.8], [-L / 2, 0]];
      case 'synth': return [[L / 2, 0], [L / 2, W * 0.4], [L * 0.1, W * 0.4], [L * 0.1, W], [-L / 2, W], [-L / 2, 0]];
      default: return [[L / 2, 0], [L * 0.1, W * 0.5], [-L / 2, W], [-L / 2, 0]];
    }
  }

  function arm(b, L, x0, y, len, R, r, sg) {
    const x1 = x0 + len;
    switch (L.f) {
      case 'bio': {
        const line = Array.from({ length: 10 }, (_, k) => { const u = k / 9; return [x0 + len * u, y - sg * R * 0.12 * u ** 3 + Math.sin(u * 6) * R * 0.015]; });
        b.poly(U.strip(line, (u) => R * 0.13 * (1 - u * 0.5)), L.m('hull'), { lvl: 2, h: R * 0.08, bevel: R * 0.06, roof: true });
        return line[9];
      }
      case 'shard':
        b.poly([[x0, y - R * 0.07], [x1, y], [x0, y + R * 0.07], [x0 - R * 0.05, y]], L.m('hull2'), { lvl: 2, h: R * 0.07, bevel: R * 0.06, roof: true });
        return [x1, y];
      case 'synth': {
        const n = 6, seg = len / n;
        for (let i = 0; i < n; i++) b.poly(U.rect(x0 + seg * (i + 0.5), y, seg * 0.82, R * 0.12), L.m(i % 2 ? 'hull2' : 'trim'), { lvl: 2, h: R * 0.08, bevel: R * 0.01 });
        return [x1, y];
      }
      default:
        mod(b, L, x0 + len / 2, y, len, R * 0.13, 0, 'hull2', r, { lvl: 2, h: R * 0.08 });
        return [x1, y];
    }
  }

  function shipyard(b, c, r, R) {
    const base = lang(c, r), bx = -R * 0.85, gap = R * 0.4, len = R * 1.75;
    mod(b, base, bx, 0, R * 0.3, gap * 2 + R * 0.3, 0, 'hull', r, { lvl: 3, h: R * 0.14 });
    const tips = [-1, 1].map((sg) => {
      const L = c.lineage === 'kitbash' ? lang(c, r) : base;
      const tip = arm(b, L, bx + R * 0.1, sg * gap, len, R, r, sg);
      for (let k = 1; k < 4; k++) b.light(bx + R * 0.1 + (len * k) / 4, sg * (gap + R * 0.065), 1.8, c.pal.light, { blink: k * 0.5 });
      return tip;
    });
    // The hull on the slip: stern plated, bow still open frames on a keel.
    const sx = R * 0.15, SL = R * 1.1, SW = gap * 0.6;
    if (base.f === 'bio') {
      b.poly(U.blob(sx, 0, SL * 0.4, SW, r, 0.15, 12), base.m('wing'), { lvl: 1, h: R * 0.08, bevel: R * 0.07, roof: true });
      b.circle(sx - SL * 0.05, 0, SW * 0.45, 'glass', { lvl: 1.2, h: R * 0.1, dome: true });
    } else {
      const hull = U.mirror(hullHalf(base.f, SL, SW)), cut = -SL * 0.05;
      const plated = U.clipPoly(hull, -1, 0, -cut);
      if (plated) b.poly(P(plated, sx, 0, 0), base.m('hull2'), { lvl: 1, h: R * 0.06, bevel: R * 0.03 });
      b.strut(sx + cut, 0, sx + SL / 2, 0, R * 0.025, 'strut', { lvl: 1.1, thin: true });
      for (let x = cut + SL * 0.1; x < SL / 2 - SL * 0.04; x += SL * 0.11) {
        const s = U.spanAt(hull, x);
        if (s) b.strut(sx + x, s[0], sx + x, s[1], R * 0.015, 'strut', { lvl: 1.2, thin: true });
      }
    }
    for (const fx of [-0.35, 0.1, 0.55]) {
      const x = fx * R, cy = (r() - 0.5) * gap;
      b.strut(x, -gap, x, gap, R * 0.04, base.f === 'bio' ? 'hull2' : 'strut', { lvl: 4, h: R * 0.04, thin: true });
      b.poly(U.rect(x, cy, R * 0.1, R * 0.08), 'accent', { lvl: 4.5, h: R * 0.05 });
      b.light(x, cy, 2, c.pal.flame, { blink: fx * 3 });
    }
    for (const sg of [-1, 1]) array(b, base, c, bx - R * 0.15, sg * R * 0.3, Math.PI - sg * 0.6, R * 0.5, R, r);
    nav(b, ...tips[0], ...tips[1]);
  }

  // ---------- Research station: a big dish or sensor, booms, labs round a hub ----------

  function sensor(b, L, c, x, D, R, r) {
    switch (L.f) {
      case 'block':
        b.poly(U.rect(x, 0, D * 1.8, D * 1.8), L.m('hull2'), { lvl: 1.9, h: R * 0.03, bevel: R * 0.01 });
        b.poly(U.rect(x, 0, D * 1.6, D * 1.6), 'panel', { lvl: 2, h: R * 0.04, grid: [5, 5] }); break;
      case 'shard':
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * TAU, d = [Math.cos(a), Math.sin(a)], q = [-d[1], d[0]];
          b.poly([[x + d[0] * D * 0.45 + q[0] * D * 0.18, d[1] * D * 0.45 + q[1] * D * 0.18], [x + d[0] * D, d[1] * D], [x + d[0] * D * 0.45 - q[0] * D * 0.18, d[1] * D * 0.45 - q[1] * D * 0.18]], L.m('hull2'), { lvl: 2, h: R * 0.04, bevel: R * 0.05, roof: true });
        }
        b.poly(U.circle(x, 0, D * 0.5, 6, Math.PI / 6), 'glass', { lvl: 2.5, h: R * 0.08, bevel: R * 0.06, roof: true }); break;
      case 'bio':
        b.poly(U.blob(x, 0, D, D * 0.78, r, 0.12, 12), L.m('trim'), { lvl: 2, h: R * 0.08, bevel: R * 0.08, roof: true });
        b.circle(x, 0, D * 0.5, 'glass', { lvl: 2.2, h: R * 0.1, dome: true });
        b.circle(x, 0, D * 0.2, 'dark', { lvl: 2.3, h: R * 0.11 }); break;
      case 'synth':
        b.poly(U.rect(x, 0, D * 1.5, D * 1.5), L.m('hull2'), { lvl: 2, h: R * 0.05, bevel: R * 0.01, grid: [3, 3] });
        b.poly(U.rect(x, 0, D * 0.6, D * 0.6, Math.PI / 4), 'glass', { lvl: 2.2, h: R * 0.08 }); break;
      default:
        b.circle(x, 0, D, L.m('hull2'), { lvl: 2, h: R * 0.03 });
        b.ring(x, 0, D * 0.62, R * 0.012, L.m('trim'), { lvl: 2.1, h: R * 0.035 });
        b.ring(x, 0, D, R * 0.035, L.m('trim'), { lvl: 2.2, h: R * 0.04 });
        for (let i = 0; i < 3; i++) { const a = (i / 3) * TAU; b.strut(x + Math.cos(a) * D, Math.sin(a) * D, x, 0, R * 0.02, 'strut', { lvl: 2.5, h: R * 0.08, thin: true }); }
        b.circle(x, 0, R * 0.05, 'glass', { lvl: 2.6, h: R * 0.09, dome: true });
    }
    b.light(x, 0, 2.4, c.pal.light, { blink: 0.8 });
  }

  function research(b, c, r, R) {
    const hub = lang(c, r), hx = -R * 0.3, D = R * 0.44, dx = R * 0.45;
    b.poly(U.rect((hx + dx) / 2, 0, dx - hx, R * 0.08), hub.m('hull2'), { lvl: 1, h: R * 0.04 });
    sensor(b, lang(c, r), c, dx, D, R, r);
    for (const sg of [-1, 1]) {
      const L = c.lineage === 'kitbash' ? lang(c, r) : hub, ly = sg * R * 0.4;
      b.strut(hx, 0, hx, ly, R * 0.05, 'strut', { lvl: 1, thin: true });
      mod(b, L, hx, ly, R * 0.3, R * 0.2, 0, 'trim', r, { lvl: 2.5, h: R * 0.1 });
      array(b, L, c, hx, sg * R * 0.5, sg * Math.PI / 2, R * 0.45, R, r);
      const a = Math.PI - sg * 0.55;
      if (hub.f === 'bio') { array(b, hub, c, hx, 0, a, R * 0.95, R, r); continue; }
      const ex = hx + Math.cos(a) * R * 0.95, ey = Math.sin(a) * R * 0.95;
      b.strut(hx, 0, ex, ey, R * 0.025, 'strut', { lvl: 1, h: R * 0.03, thin: true });
      for (const t of [0.55, 0.8]) {
        const px = hx + Math.cos(a) * R * 0.95 * t, py = Math.sin(a) * R * 0.95 * t, q = R * 0.07;
        b.strut(px - Math.sin(a) * q, py + Math.cos(a) * q, px + Math.sin(a) * q, py - Math.cos(a) * q, R * 0.02, 'strut', { lvl: 1, thin: true });
      }
      if (hub.f === 'synth') b.poly(U.rect(ex, ey, R * 0.07, R * 0.07, a), 'trim', { lvl: 1.1, h: R * 0.05 });
      else if (hub.f === 'shard') b.poly(U.circle(ex, ey, R * 0.05, 4, a), 'glass', { lvl: 1.1, h: R * 0.05 });
      else b.circle(ex, ey, R * 0.04, hub.m('trim'), { lvl: 1.1, h: R * 0.05, dome: true });
      b.light(ex, ey, 2.2, sg < 0 ? '#ff4d4d' : '#4dff88', { blink: 0 });
    }
    mod(b, hub, hx, 0, R * 0.34, R * 0.34, hub.f === 'synth' ? Math.PI / 4 : 0, 'hull', r, { lvl: 3, h: R * 0.16 });
    b.circle(hx, 0, R * 0.06, 'glass', { lvl: 3.3, h: R * 0.17, dome: true });
  }

  // ---------- Command center: an armoured hub in a slow-turning ring, docks and turrets ----------

  function plate(b, L, a, R, r) {
    const S = { layer: 'spin' }, d = R * 0.66, x = Math.cos(a) * d, y = Math.sin(a) * d;
    switch (L.f) {
      case 'block': b.poly(U.rect(x, y, R * 0.14, R * 0.34, a), L.m('hull2'), { ...S, lvl: 1, h: R * 0.08, bevel: R * 0.02, grid: [1, 3] }); break;
      case 'shard': {
        const q = [-Math.sin(a), Math.cos(a)], o = (t, w) => [Math.cos(a) * t + q[0] * w, Math.sin(a) * t + q[1] * w];
        b.poly([o(R * 0.56, -R * 0.1), o(R * 0.9, 0), o(R * 0.56, R * 0.1), o(R * 0.6, 0)], L.m('hull2'), { ...S, lvl: 1, h: R * 0.05, bevel: R * 0.06, roof: true });
        break;
      }
      case 'bio': b.poly(U.blob(x, y, R * 0.1, R * 0.15, r, 0.25, 9, a), L.m('trim'), { ...S, lvl: 1, h: R * 0.08, bevel: R * 0.07, roof: true }); break;
      case 'synth': b.poly(U.rect(x, y, R * 0.13, R * 0.13, a), L.m('trim'), { ...S, lvl: 1, h: R * 0.08, bevel: R * 0.02 }); break;
      default: b.poly(U.sector(0, 0, d, R * 0.14, a - 0.28, a + 0.28, 3), L.m('hull2'), { ...S, lvl: 1, h: R * 0.08, bevel: R * 0.03 });
    }
  }

  function command(b, c, r, R) {
    b.bp.layers = ['spin', 'fixed'];
    b.bp.spinRate = 0.04;
    const core = lang(c, r), f = core.f;
    const M = f === 'shard' ? 6 : f === 'bio' ? 7 : 8, A = f === 'shard' || f === 'bio' ? 3 : 4, a0 = A === 4 ? Math.PI / 4 : -Math.PI / 2;
    for (let i = 0; i < M; i++) plate(b, c.lineage === 'kitbash' ? lang(c, r) : core, (i / M) * TAU + Math.PI / M, R, r);
    for (let i = 0; i < A; i++) {
      const a = a0 + (i / A) * TAU, L = c.lineage === 'kitbash' ? lang(c, r) : core, d0 = R * 0.3, d1 = R * 1.05;
      const ex = Math.cos(a) * d1, ey = Math.sin(a) * d1;
      if (L.f === 'bio') {
        const line = Array.from({ length: 8 }, (_, k) => { const u = k / 7, aa = a + Math.sin(u * 4) * 0.08, d = d0 + (d1 - d0) * u; return [Math.cos(aa) * d, Math.sin(aa) * d]; });
        b.poly(U.strip(line, (u) => R * 0.1 * (1 - u * 0.3)), L.m('hull'), { lvl: 2.5, h: R * 0.08, bevel: R * 0.06, roof: true });
      } else mod(b, L, Math.cos(a) * (d0 + d1) / 2, Math.sin(a) * (d0 + d1) / 2, d1 - d0, R * 0.1, a, 'hull', r, { lvl: 2.5, h: R * 0.08, plain: true });
      if (L.f === 'synth') b.poly(U.rect(ex, ey, R * 0.12, R * 0.12, a), 'trim', { lvl: 2.7, h: R * 0.09 });
      else b.ring(ex, ey, R * 0.06, R * 0.03, L.m('trim'), { lvl: 2.7, h: R * 0.09 });
      b.light(ex, ey, 2.4, c.pal.light, { blink: i * 0.6 });
    }
    const hubPts = f === 'block' ? U.rect(0, 0, R * 0.74, R * 0.74) : f === 'shard' ? U.circle(0, 0, R * 0.42, 6, Math.PI / 6)
      : f === 'bio' ? U.blob(0, 0, R * 0.44, R * 0.4, r, 0.2, 11) : f === 'synth' ? U.rect(0, 0, R * 0.62, R * 0.62, Math.PI / 4) : U.circle(0, 0, R * 0.42, 8, Math.PI / 8);
    b.poly(hubPts, core.m('hull'), { lvl: 3, h: R * 0.18, bevel: R * (f === 'shard' || f === 'bio' ? 0.14 : 0.05), roof: f === 'shard' || f === 'bio', grid: f === 'block' ? [3, 3] : undefined });
    for (let i = 0; i < A; i++) {
      const a = a0 + ((i + 0.5) / A) * TAU, d = R * 0.32, x = Math.cos(a) * d, y = Math.sin(a) * d;
      if (f === 'synth' || f === 'block') b.poly(U.rect(x, y, R * 0.11, R * 0.11, a), core.m('trim'), { lvl: 4, h: R * 0.22, bevel: R * 0.02 });
      else b.circle(x, y, R * 0.06, core.m('trim'), { lvl: 4, h: R * 0.22, dome: true });
      for (const o of [-0.25, 0.25]) {
        const q = [-Math.sin(a) * R * 0.025 * Math.sign(o), Math.cos(a) * R * 0.025 * Math.sign(o)];
        b.strut(x + q[0], y + q[1], x + q[0] + Math.cos(a) * R * 0.14, y + q[1] + Math.sin(a) * R * 0.14, R * 0.018, 'strut', { lvl: 4.1, h: R * 0.23, thin: true });
      }
    }
    mod(b, core, 0, 0, R * 0.24, R * 0.24, f === 'synth' ? Math.PI / 4 : 0, 'trim', r, { lvl: 5, h: R * 0.26, plain: true });
    b.poly(U.circle(0, 0, R * 0.06, f === 'bio' || f === 'wedge' ? 12 : f === 'shard' ? 6 : 4), 'glass', { lvl: 5.5, h: R * 0.28 });
    const aa = a0 + Math.PI / A;
    b.strut(0, 0, Math.cos(aa) * R * 0.2, Math.sin(aa) * R * 0.2, R * 0.015, 'accent', { lvl: 5.6, h: R * 0.3, thin: true });
    b.light(Math.cos(aa) * R * 0.2, Math.sin(aa) * R * 0.2, 2.4, c.pal.light, { blink: 0.3 });
  }

  const BUILD = { refinery, factory, shipyard, research, command };

  // A role in the culture's language, always newly built.
  function build(role, culture, seed = 1, size = 'major') {
    const s = seed >>> 0, r = mulberry32(hashInt(s, 20 + ROLES.indexOf(role), culture.seed));
    const b = B.builder(`station-${role}-${size}`, culture, s);
    const R = 110 * (SCALE[size] || 1) * (0.92 + r() * 0.16);
    BUILD[role](b, culture, r, R);
    if (culture.lineage === 'kitbash') {
      B.addPatches(b, culture, r, U.circle(0, 0, R * 0.6, 12), R * 0.1, 5);
      const a = r() * TAU;
      B.truss(b, Math.cos(a) * R * 0.45, Math.sin(a) * R * 0.45, Math.cos(a) * R * 1.05, Math.sin(a) * R * 1.05, R * 0.07);
    }
    b.bp.role = role;
    b.bp.label = `${LABEL[role]} · ${DESC[role]}`;
    return B.finish(b.bp);
  }

  const existingRole = (culture) => EXISTING[culture.lineage] || null;
  // The culture's existing station (of that size) where it fits the role, else a new build.
  function create(role, culture, seed = 1, size = 'major') {
    if (existingRole(culture) === role) { const bp = B.create(`station-${size}`, culture, seed); bp.role = role; return bp; }
    return build(role, culture, seed, size);
  }

  return { ROLES, LABEL, DESC, EXISTING, existingRole, create, build };
})();

export { ArtStationRoles };
