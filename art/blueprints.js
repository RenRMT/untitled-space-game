'use strict';

// Procedural asset blueprints: style-independent 2D part lists that art/render.js draws in any
// of the four art styles. Coordinates are world units, nose toward +x, +y down (canvas space).
//
// A blueprint is { id, type, culture, parts, lights, engines, layers, spinRate, radius, label }.
// Gate stations ('gate') exist only for major factions: create() returns null otherwise.
// Each part is a polygon, circle or ring with a material (a palette key or a literal hex colour),
// a draw level `lvl`, a layer ('fixed' or 'spin') and, for the low-poly style, a height `h` and an
// optional raised top `bevel` (a ridge or apex with `roof: true`, else a chamfer). Optional extras: `lines` (detail segments), `grid` [nx, ny]
// (panel cells), `thin` (a strut drawn as one line in the line style), `dome` (circles),
// `line: false` (part skipped in the line style), `overlay` (scorch marks drawn over what is below).
// Works as a classic browser script (global `ArtBlueprints`) and as a Node module.

const ArtBlueprints = (() => {
  const isNode = typeof require === 'function' && typeof module !== 'undefined';
  const U = isNode ? require('./util.js') : ArtUtil;
  const { mulberry32, hashInt } = isNode ? require('../rng.js') : globalThis;
  const { TAU, lerp, clamp } = U;

  let nextId = 1;

  function builder(type, culture, seed) {
    const bp = {
      id: nextId++, type, culture, seed, parts: [], lights: [], engines: [],
      layers: ['fixed'], spinRate: 0, glow: false, label: '',
    };
    const part = (shape, props, mat, o) => {
      const p = { shape, ...props, mat, lvl: 0, h: 1, bevel: 0, layer: 'fixed', ...o };
      bp.parts.push(p);
      return p;
    };
    return {
      bp,
      poly: (pts, mat, o = {}) => part('poly', { pts }, mat, o),
      circle: (cx, cy, r, mat, o = {}) => part('circle', { cx, cy, r }, mat, o),
      ring: (cx, cy, r, w, mat, o = {}) => part('ring', { cx, cy, r, w }, mat, o),
      strut: (x1, y1, x2, y2, w, mat, o = {}) => part('poly', { pts: U.strip([[x1, y1], [x2, y2]], w) }, mat, { ...o, thin: o.thin ? [x1, y1, x2, y2] : undefined }),
      light: (x, y, r, color, o = {}) => bp.lights.push({ x, y, r, color, blink: null, layer: 'fixed', ...o }),
      engine: (x, y, w, o = {}) => bp.engines.push({ x, y, w, layer: 'fixed', ...o }),
    };
  }

  function finish(bp) {
    let R = 0;
    const reach = (x, y, pad = 0) => { R = Math.max(R, Math.hypot(x, y) + pad); };
    for (const p of bp.parts) {
      if (p.shape === 'poly') for (const [x, y] of p.pts) reach(x, y);
      else reach(p.cx, p.cy, p.r + (p.w || 0) / 2);
    }
    for (const l of bp.lights) reach(l.x, l.y, l.r);
    bp.bodyRadius = R;
    for (const e of bp.engines) reach(e.x, e.y, e.w * 3);
    bp.radius = R;
    return bp;
  }

  // Kitbash cultures borrow a different donor for each component.
  const donor = (c, r) => (c.lineage === 'kitbash' && c.donors?.length ? c.donors[Math.floor(r() * c.donors.length)] : c);
  const roundIters = (c) => (c.round > 0.6 ? 2 : c.round > 0.2 ? 1 : 0);

  // ---------- Ships ----------

  function hullOutline(c, L, W, r) {
    let half;
    switch (c.hull) {
      case 'arc':
        half = [[L / 2, 0], [L * 0.42, W * 0.45], [L * 0.25, W * 0.82], [0, W], [-L * 0.3, W * 0.95], [-L * 0.47, W * 0.7], [-L / 2, 0]];
        break;
      case 'block':
        half = [[L / 2, 0], [L / 2, W * 0.45], [L * 0.36, W * 0.85], [L * 0.2, W], [-L / 2, W], [-L / 2, 0]];
        break;
      case 'shard':
        half = [[L / 2, 0], [L * 0.05, W * 0.32], [-L * 0.18, W], [-L * 0.32, W * 0.55], [-L / 2, W * 0.75], [-L / 2, 0]];
        break;
      case 'spindle':
        half = [[L / 2, 0], [L * 0.42, W * 0.6], [L * 0.28, W * 0.6], [L * 0.22, W * 0.3], [-L * 0.2, W * 0.3],
          [-L * 0.26, W * 0.7], [-L * 0.44, W * 0.7], [-L / 2, W * 0.4], [-L / 2, 0]];
        break;
      case 'coral': {
        const pts = U.blob(0, 0, L / 2, W, r, 0.35, 11);
        return pts.map(([x, y]) => [x > 0 ? x * 1.12 : x, y]);
      }
      default: // wedge
        half = [[L / 2, 0], [L * 0.12, W * 0.5], [-L * 0.3, W], [-L / 2, W * 0.85], [-L / 2, 0]];
    }
    let pts = U.mirror(half);
    if (c.asym > 0.1) pts = pts.map(([x, y]) => [x, y < 0 ? y * (1 - c.asym * 0.35 * r()) : y]);
    return U.chaikin(pts, roundIters(c));
  }

  function wingShape(kind, s, k, g) {
    const { rootX0, rootX1, rootY, span, sweep, L, W } = g;
    const chord = (rootX1 - rootX0) * 0.45;
    const y = (v) => s * v;
    switch (kind) {
      case 'delta':
        return [[[rootX1, y(rootY)], [rootX0 - sweep * 0.25, y(rootY + span * k)], [rootX0, y(rootY)]]];
      case 'swept':
        return [[[rootX1, y(rootY)], [rootX1 - sweep, y(rootY + span * k)], [rootX1 - sweep - chord, y(rootY + span * k)], [rootX0, y(rootY)]]];
      case 'forward':
        return [[[rootX1, y(rootY)], [rootX1 + sweep * 0.35, y(rootY + span * k)], [rootX1 + sweep * 0.35 - chord, y(rootY + span * k)], [rootX0, y(rootY)]]];
      case 'crescent': {
        const q = (a, b, cp, t) => [lerp(lerp(a[0], cp[0], t), lerp(cp[0], b[0], t), t), lerp(lerp(a[1], cp[1], t), lerp(cp[1], b[1], t), t)];
        const p0 = [rootX1, rootY], tip = [rootX0 - sweep * 0.3, rootY + span * k], p4 = [rootX0, rootY];
        const c1 = [rootX1 + chord * 0.4, rootY + span * k * 1.05], c2 = [rootX0 + (rootX1 - rootX0) * 0.15, rootY + span * k * 0.45];
        const pts = [];
        for (let i = 0; i <= 6; i++) pts.push(q(p0, tip, c1, i / 6));
        for (let i = 1; i <= 6; i++) pts.push(q(tip, p4, c2, i / 6));
        return [pts.map(([px, py]) => [px, y(py)])];
      }
      case 'blade':
        return [[[rootX1, y(rootY)], [rootX0 - sweep * 0.9, y(rootY + span * k * 1.15)], [rootX0 + (rootX1 - rootX0) * 0.3, y(rootY)]]];
      case 'fins': {
        const x = -L * 0.36;
        return [
          [[x + L * 0.14, y(W * 0.6)], [x - L * 0.1, y(W + span * 0.5 * k)], [x - L * 0.06, y(W * 0.6)]],
          [[x + L * 0.42, y(W * 0.5)], [x + L * 0.26, y(W + span * 0.25 * k)], [x + L * 0.24, y(W * 0.5)]],
        ];
      }
      case 'lobes':
        return [U.ellipse(-L * 0.08, y(W * 0.7 + span * 0.38 * k), L * 0.24, span * 0.42 * k, s * (0.3 + g.sweepRaw * 0.6), 12)];
      default:
        return [];
    }
  }

  function ship(culture, seed, role) {
    const r = mulberry32(hashInt(seed, role === 'fighter' ? 1 : 2, culture.seed));
    const b = builder(role, culture, seed);
    const fighter = role === 'fighter';
    const hc = donor(culture, r);
    const L = (fighter ? 34 : 92) * culture.length * (0.92 + r() * 0.16);
    const W = (fighter ? 0.15 : 0.21) * L * hc.width;
    const hull = hullOutline({ ...hc, asym: culture.asym }, L, W, r);
    const hullH = W * 0.55;
    const panelLines = [];
    for (let i = 0; i < (fighter ? 2 : 4); i++) {
      const x = lerp(-L * 0.4, L * 0.25, (i + 0.5 + (r() - 0.5) * 0.4) / (fighter ? 2 : 4));
      const s = U.spanAt(hull, x);
      if (s) panelLines.push([x, s[0] * 0.8, x, s[1] * 0.8]);
    }
    b.poly(hull, 'hull', { lvl: 2, h: hullH, bevel: hullH * 1.1, lines: panelLines, roof: true });

    // Wings, or their cultural substitute.
    const wc = donor(culture, r);
    const g = {
      L, W, rootX0: -L * 0.32, rootX1: L * (fighter ? 0.1 : -0.02), rootY: W * 0.55,
      span: (fighter ? L * 0.42 : L * 0.2) * wc.span, sweep: wc.sweep * L * 0.4, sweepRaw: wc.sweep,
    };
    const wingKind = wc.wings;
    const wings = [];
    for (const s of [1, -1]) {
      const k = s < 0 && culture.asym > 0.1 ? 1 - culture.asym * 0.45 * r() : 1;
      if (wingKind === 'pods') {
        const py = s * (W + g.span * 0.55), pl = L * (fighter ? 0.55 : 0.45), pw = W * (fighter ? 0.7 : 0.9);
        b.strut(-L * 0.1, s * W * 0.7, -L * 0.1, py, W * 0.35, 'hull2', { lvl: 0, h: hullH * 0.3 });
        const pod = U.chaikin(U.rect(-L * 0.12, py, pl, pw), roundIters(wc));
        b.poly(pod, 'wing', { lvl: 1, h: hullH * 0.8, bevel: pw * 0.35, roof: true });
        b.engine(-L * 0.12 - pl / 2 - 1, py, pw * 0.5);
        b.poly(U.rect(-L * 0.12 - pl / 2, py, pl * 0.12, pw * 0.6), 'engine', { lvl: 0.5, h: hullH * 0.5 });
        wings.push(pod);
        continue;
      }
      for (const pts of wingShape(wingKind, s, k, g)) {
        const w = U.chaikin(pts, wc.round > 0.6 ? 1 : 0);
        b.poly(w, 'wing', { lvl: 1, h: hullH * 0.35, bevel: hullH * 0.4, roof: true });
        wings.push(w);
      }
    }

    // Guns on fighters: barrels forward of the wing roots.
    if (fighter && wingKind !== 'none') {
      for (const s of [1, -1]) {
        const y = s * Math.min(W * 1.05 + g.span * 0.15, W + 3);
        b.strut(g.rootX0 + L * 0.2, y, L * 0.3, y, 1.2, 'hull2', { lvl: 1.5, h: 1 });
      }
    }

    // Engines at the stern.
    const tail = U.spanAt(hull, -L / 2 + L * 0.04) || [-W * 0.6, W * 0.6];
    const n = fighter ? clamp(culture.engines, 1, 2) : clamp(culture.engines + 1, 2, 4);
    const ew = Math.min(W * 0.55, ((tail[1] - tail[0]) * 0.85) / n);
    const nl = L * 0.07;
    for (let i = 0; i < n; i++) {
      const y = n === 1 ? 0 : lerp(tail[0] * 0.6, tail[1] * 0.6, i / (n - 1));
      b.poly(U.rect(-L / 2 - nl * 0.2, y, nl, ew), 'engine', { lvl: 1.8, h: hullH * 0.7 });
      b.engine(-L / 2 - nl * 0.7, y, ew * 0.55);
    }

    // Cargo modules on freighters, shaped by culture.
    if (!fighter) freighterCargo(b, donor(culture, r), r, L, W, hull, hullH);

    // Cockpit or bridge.
    const cc = donor(culture, r);
    const cx = fighter ? L * 0.18 : L * 0.3;
    let glass;
    switch (cc.hull) {
      case 'arc': glass = U.ellipse(cx, 0, L * (fighter ? 0.12 : 0.07), W * 0.38, 0, 14); break;
      case 'block': glass = U.rect(cx + L * 0.12, 0, L * 0.05, W * 0.95); break;
      case 'spindle': glass = U.circle(L * 0.36, 0, W * 0.4, 12); break;
      case 'coral': glass = U.blob(cx, (r() - 0.5) * W * 0.3, L * 0.09, W * 0.3, r, 0.3, 8); break;
      case 'shard': glass = [[cx + L * 0.16, 0], [cx - L * 0.12, W * 0.2], [cx - L * 0.12, -W * 0.2]]; break;
      default: glass = [[cx + L * 0.12, 0], [cx - L * 0.1, W * 0.3], [cx - L * 0.1, -W * 0.3]];
    }
    b.poly(glass, 'glass', { lvl: 4, h: hullH * 0.3, bevel: hullH * 0.3 });

    // Markings: stripes across the hull and an insignia on each wing.
    const stripes = fighter ? Math.min(culture.stripes, 2) : culture.stripes;
    for (let i = 0; i < stripes; i++) {
      const x0 = -L * 0.12 - i * L * 0.09, x1 = x0 + L * 0.045;
      const band = U.clipPoly(U.clipPoly(hull, 1, 0, x0) || [], -1, 0, -x1);
      if (band) b.poly(band, 'accent', { lvl: 3, h: 0.3 });
    }
    if (wings.length >= 2) {
      for (const w of wings.slice(0, 2)) {
        const a = Math.abs(U.area(w));
        if (a < L * L * 0.015) continue;
        const [ix, iy] = U.centroid(w);
        const s = Math.sqrt(a) * 0.18;
        b.poly(insignia(culture.insignia, ix, iy, s), 'accent', { lvl: 3, h: 0.3 });
      }
    }

    // Greebles: small plates, mirrored on symmetric cultures.
    const count = Math.round(culture.greeble * (fighter ? 3 : 10));
    const [bx0, by0, bx1, by1] = U.bbox(hull);
    for (let i = 0, tries = 0; i < count && tries < 60; tries++) {
      const x = lerp(bx0 + L * 0.15, bx1 - L * 0.2, r()), y = lerp(by0, by1, r()) * 0.7;
      const w = L * (0.03 + r() * 0.05), h = W * (0.15 + r() * 0.25);
      const pts = U.rect(x, y, w, h);
      if (!pts.every(([px, py]) => U.inPoly(px, py, hull))) continue;
      i++;
      b.poly(pts, 'hull2', { lvl: 3, h: 0.5 });
      if (culture.asym < 0.2 && Math.abs(y) > h) b.poly(U.rect(x, -y, w, h), 'hull2', { lvl: 3, h: 0.5 });
    }

    if (culture.lineage === 'kitbash') addPatches(b, culture, r, hull, L * 0.12, 2);

    b.bp.glow = true;
    b.bp.label = `${fighter ? 'Fighter' : 'Freighter'} · ${hc.hull} hull, ${wingKind} wings, ${n} engine${n > 1 ? 's' : ''}`;
    return finish(b.bp);
  }

  function insignia(kind, x, y, s) {
    switch (kind) {
      case 'chevron': return [[x + s, y], [x - s * 0.4, y + s], [x - s * 0.9, y + s], [x + s * 0.1, y], [x - s * 0.9, y - s], [x - s * 0.4, y - s]];
      case 'bar': return U.rect(x, y, s * 2, s * 0.6);
      case 'diamond': return [[x + s, y], [x, y + s * 0.7], [x - s, y], [x, y - s * 0.7]];
      case 'ring': return U.circle(x, y, s * 0.8, 10);
      default: return U.circle(x, y, s * 0.6, 8);
    }
  }

  function freighterCargo(b, c, r, L, W, hull, hullH) {
    switch (c.hull) {
      case 'arc':
        for (const s of [1, -1]) {
          const y = s * W * 1.5;
          b.strut(-L * 0.05, s * W * 0.7, -L * 0.05, y, W * 0.3, 'hull2', { lvl: 0, h: hullH * 0.3 });
          b.poly(U.chaikin(U.rect(-L * 0.08, y, L * 0.55, W * 0.85), 2), 'trim', { lvl: 1, h: hullH * 0.9, bevel: W * 0.4, roof: true });
        }
        break;
      case 'block': {
        const cols = 4 + Math.floor(r() * 3), cw = (L * 0.62) / cols;
        const mats = ['accent', 'hull2', 'trim', 'wing', '#8a5a3a', '#4f6a7a'];
        for (let i = 0; i < cols; i++) {
          for (const s of [1, -1]) {
            if (r() < 0.12) continue;
            const x = -L * 0.36 + (i + 0.5) * cw;
            b.poly(U.rect(x, s * W * 0.5, cw * 0.9, W * 0.95), mats[Math.floor(r() * mats.length)], { lvl: 3, h: hullH * 0.5, lines: [[x, s * W * 0.1, x, s * W * 0.9]] });
          }
        }
        break;
      }
      case 'shard':
        for (const s of [1, -1]) {
          for (let i = 0; i < 3; i++) {
            const x = -L * 0.25 + i * L * 0.15, y = s * W * 1.05;
            b.poly([[x + L * 0.08, y], [x, y + s * W * 0.45], [x - L * 0.08, y], [x, y - s * W * 0.35]], 'trim', { lvl: 1.2, h: hullH * 0.5, bevel: W * 0.35, roof: true });
          }
        }
        break;
      case 'spindle':
        for (let i = 0; i < 4; i++) {
          const x = -L * 0.3 + i * L * 0.16;
          b.circle(x, 0, W * 0.95, i % 2 ? 'trim' : 'hull', { lvl: 3, h: W * 0.4, dome: true });
        }
        break;
      case 'coral':
        for (const s of [1, -1]) {
          b.poly(U.blob(-L * 0.12 + r() * L * 0.1, s * W * 0.95, L * 0.2, W * 0.7, r, 0.35, 9), 'hull2', { lvl: 1, h: hullH * 0.7, bevel: W * 0.45, roof: true });
        }
        break;
      default: { // wedge: a gridded cargo bay along the spine
        const bay = U.rect(-L * 0.1, 0, L * 0.45, W * 1.1);
        b.poly(bay, 'hull2', { lvl: 3, h: hullH * 0.25, grid: [4, 2] });
      }
    }
  }

  // Pirate patches: mismatched plates in donor colours, plus scorch.
  function addPatches(b, c, r, inside, size, n) {
    const [x0, y0, x1, y1] = U.bbox(inside);
    const colors = (c.donors || []).map((d) => d.pal.hull).concat(['#6a5f52', '#9a8a70']);
    for (let i = 0, t = 0; i < n && t < 40; t++) {
      const x = lerp(x0, x1, r()), y = lerp(y0, y1, r());
      if (!U.inPoly(x, y, inside)) continue;
      i++;
      b.poly(U.rect(x, y, size * (0.6 + r()), size * (0.5 + r() * 0.6), r() * 0.6 - 0.3), colors[Math.floor(r() * colors.length)], { lvl: 3.5, h: 0.4 });
    }
    const x = lerp(x0, x1, r()), y = lerp(y0, y1, r()) * 0.5;
    b.poly(U.blob(x, y, size, size * 0.8, r, 0.5, 8), 'scorch', { lvl: 9, overlay: true, line: false });
  }

  // ---------- Stations ----------

  function station(culture, seed, size) {
    const major = size === 'major';
    const r = mulberry32(hashInt(seed, major ? 3 : 4, culture.seed));
    const b = builder(major ? 'station-major' : 'station-minor', culture, seed);
    const sc = donor(culture, r);
    const R = (major ? 120 : 70) * (0.9 + r() * 0.2);
    const topo = sc.station;
    const fn = { wheel, disk, truss, lattice, star, cluster }[topo] || wheel;
    fn(b, { ...culture, round: sc.round, arrays: sc.arrays }, r, R, major);
    if (culture.lineage === 'kitbash') {
      const other = donor(culture, r);
      // A module bolted on from another culture, off-centre.
      const a = r() * TAU, d = R * 0.95;
      b.strut(Math.cos(a) * R * 0.4, Math.sin(a) * R * 0.4, Math.cos(a) * d, Math.sin(a) * d, R * 0.06, 'strut', { lvl: 0.5, thin: true });
      const mod = other.round > 0.5 ? U.blob(Math.cos(a) * d, Math.sin(a) * d, R * 0.2, R * 0.15, r, 0.3, 9, a) : U.rect(Math.cos(a) * d, Math.sin(a) * d, R * 0.32, R * 0.2, a);
      b.poly(mod, other.pal.hull, { lvl: 2.5, h: R * 0.08, bevel: R * 0.06, roof: other.round > 0.5 });
      addPatches(b, culture, r, U.circle(0, 0, R * 0.8, 12), R * 0.12, 4);
    }
    b.bp.label = `${major ? 'Major' : 'Minor'} station · ${topo}`;
    return finish(b.bp);
  }

  const navLights = (b, x, y) => {
    b.light(-x, -y, 3.2, '#ff4d4d', { blink: 0 });
    b.light(x, y, 3.2, '#4dff88', { blink: 0 });
  };

  function wheel(b, c, r, R, major) {
    const S = { layer: 'spin' };
    b.bp.layers = ['spin', 'fixed'];
    b.bp.spinRate = 0.15;
    b.ring(0, 0, R * 0.91, R * 0.18, 'hull', { ...S, lvl: 1, h: R * 0.12 });
    if (major) b.ring(0, 0, R * 0.55, R * 0.12, 'hull', { ...S, lvl: 1, h: R * 0.1 });
    const spokes = (major ? 4 : 3) + Math.floor(r() * 3);
    for (let i = 0; i < spokes; i++) {
      const a = (i / spokes) * TAU;
      b.strut(Math.cos(a) * R * 0.28, Math.sin(a) * R * 0.28, Math.cos(a) * R * 0.82, Math.sin(a) * R * 0.82, R * 0.05, 'strut', { ...S, lvl: 0, h: R * 0.04, thin: true });
    }
    const mods = major ? 8 + 2 * Math.floor(r() * 3) : 4 + 2 * Math.floor(r() * 3);
    for (let i = 0; i < mods; i++) {
      const a = (i / mods) * TAU + TAU / (mods * 2);
      b.poly(U.rect(Math.cos(a) * R * 0.91, Math.sin(a) * R * 0.91, R * 0.24, R * 0.16, a), 'trim', { ...S, lvl: 2, h: R * 0.16, bevel: R * 0.03 });
      if (i % 2 === 0) b.poly(U.rect(Math.cos(a) * R * 0.98, Math.sin(a) * R * 0.98, R * 0.06, R * 0.16, a), 'accent', { ...S, lvl: 3, h: R * 0.17 });
      b.light(Math.cos(a) * R * 0.86, Math.sin(a) * R * 0.86, 2.4, c.pal.light, { layer: 'spin' });
    }
    const len = (major ? 3.1 : 2.4) * R;
    const arms = major ? [0, Math.PI / 2] : [Math.PI / 2];
    for (const a of arms) {
      const l = a === Math.PI / 2 ? len : len * 0.8;
      b.poly(U.rect(0, 0, l, R * 0.13, a), 'hull2', { lvl: 4, h: R * 0.1, bevel: R * 0.03 });
      for (const s of [-1, 1]) {
        const ex = Math.cos(a) * s * l / 2, ey = Math.sin(a) * s * l / 2;
        if (c.arrays === 'solar' || c.arrays === 'none') {
          b.poly(U.rect(ex, ey, R * 0.22, R * 1.4, a), 'panel', { lvl: 5, h: R * 0.03, grid: [1, 5] });
        } else {
          for (const f of [-1, 1]) b.poly(U.rect(ex + Math.cos(a + Math.PI / 2) * f * R * 0.3, ey + Math.sin(a + Math.PI / 2) * f * R * 0.3, R * 0.12, R * 0.5, a), 'panel', { lvl: 5, h: R * 0.03, grid: [1, 4] });
        }
      }
    }
    b.circle(0, 0, R * 0.28, 'trim', { lvl: 6, h: R * 0.12, dome: true });
    b.circle(0, 0, R * 0.1, 'accent', { lvl: 7, h: R * 0.05 });
    navLights(b, R * 0.7, len / 2);
  }

  function disk(b, c, r, R, major) {
    const S = { layer: 'spin' };
    b.bp.layers = ['spin', 'fixed'];
    b.bp.spinRate = 0.08;
    const pods = major ? 10 + 2 * Math.floor(r() * 2) : 6 + 2 * Math.floor(r() * 2);
    for (let i = 0; i < pods; i++) {
      const a = (i / pods) * TAU;
      b.poly(U.chaikin(U.rect(Math.cos(a) * R * 0.86, Math.sin(a) * R * 0.86, R * 0.3, R * 0.16, a), 2), i % 3 === 0 ? 'accent' : 'trim', { ...S, lvl: 0, h: R * 0.06, bevel: R * 0.06, roof: true });
      b.light(Math.cos(a) * R * 1.0, Math.sin(a) * R * 1.0, 2.4, c.pal.light, { layer: 'spin', blink: i * 0.7 });
    }
    b.circle(0, 0, R * 0.74, 'hull', { ...S, lvl: 1, h: R * 0.08, bevel: R * 0.07 });
    b.ring(0, 0, R * 0.5, R * 0.04, 'hull2', { ...S, lvl: 2, h: R * 0.12 });
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * TAU;
      b.light(Math.cos(a) * R * 0.62, Math.sin(a) * R * 0.62, 1.8, c.pal.light, { layer: 'spin' });
    }
    if (major) {
      b.ring(0, 0, R * 1.12, R * 0.07, 'hull2', { ...S, lvl: -1, h: R * 0.05 });
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * TAU + 0.5;
        b.strut(Math.cos(a) * R * 0.7, Math.sin(a) * R * 0.7, Math.cos(a) * R * 1.12, Math.sin(a) * R * 1.12, R * 0.05, 'strut', { ...S, lvl: -0.5, thin: true });
      }
    }
    b.ring(0, 0, R * 0.32, R * 0.05, 'accent', { lvl: 5, h: R * 0.14 });
    b.circle(0, 0, R * 0.26, 'glass', { lvl: 6, h: R * 0.1, dome: true });
    if (major) {
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * TAU;
        b.strut(Math.cos(a) * R * 0.3, Math.sin(a) * R * 0.3, Math.cos(a) * R * 0.55, Math.sin(a) * R * 0.55, R * 0.04, 'strut', { lvl: 7, thin: true, h: R * 0.15 });
        b.light(Math.cos(a) * R * 0.55, Math.sin(a) * R * 0.55, 2.6, '#ff4d4d', { blink: i });
      }
    }
  }

  function truss(b, c, r, R, major) {
    b.bp.layers = ['spin', 'fixed'];
    b.bp.spinRate = 0.2;
    // One spin ring at the centre, under the truss.
    b.ring(0, 0, R * 0.42, R * 0.1, 'hull', { layer: 'spin', lvl: 1, h: R * 0.1 });
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * TAU + TAU / 8;
      b.strut(Math.cos(a) * R * 0.12, Math.sin(a) * R * 0.12, Math.cos(a) * R * 0.37, Math.sin(a) * R * 0.37, R * 0.04, 'strut', { layer: 'spin', lvl: 0, thin: true });
    }
    const axes = major ? [0, Math.PI / 2] : [0];
    for (const ax of axes) {
      const Ls = (ax ? 1.8 : major ? 2.8 : 2.1) * R;
      b.poly(U.rect(0, 0, Ls, R * 0.08, ax), 'strut', { lvl: 3, h: R * 0.06 });
      const nodes = ax ? 2 : major ? 3 : 2;
      const kinds = [];
      for (let i = 0; i < nodes; i++) kinds.push(['habitat', 'tank', 'cargo'][Math.floor(r() * 3)]);
      for (const s of [-1, 1]) {
        for (let i = 0; i < nodes; i++) {
          const d = R * 0.62 + (i * (Ls / 2 - R * 0.75)) / Math.max(1, nodes - 1 || 1);
          const [x, y] = U.rot([s * d, 0], ax);
          if (kinds[i] === 'habitat') {
            b.poly(U.chaikin(U.rect(x, y, R * 0.2, R * 0.55, ax), roundIters(c)), 'hull', { lvl: 4, h: R * 0.12, bevel: R * 0.08, roof: true, lines: [[x - R * 0.3 * Math.sin(ax), y, x + R * 0.3 * Math.sin(ax), y]] });
            b.light(...U.add([x, y], U.rot([0, R * 0.2], ax)), 2, c.pal.light);
          } else if (kinds[i] === 'tank') {
            for (const t of [-1, 1]) b.circle(...U.add([x, y], U.rot([0, t * R * 0.13], ax)), R * 0.12, 'trim', { lvl: 4, h: R * 0.1, dome: true });
          } else {
            for (const t of [-1, 1]) b.poly(U.rect(...U.add([x, y], U.rot([0, t * R * 0.12], ax)), R * 0.16, R * 0.2, ax), t > 0 ? 'accent' : 'hull2', { lvl: 4, h: R * 0.08 });
          }
        }
        const [ex, ey] = U.rot([s * Ls / 2, 0], ax);
        if (c.arrays === 'solar') {
          b.poly(U.rect(ex, ey, R * 0.18, R * 0.9, ax), 'panel', { lvl: 5, h: R * 0.02, grid: [1, 6] });
        } else {
          b.poly(U.rect(ex, ey, R * 0.14, R * 0.14, ax), 'hull2', { lvl: 5, h: R * 0.06 });
        }
        b.light(...U.add([ex, ey], U.rot([s * R * 0.12, 0], ax)), 2.6, c.pal.light, { blink: s + ax });
      }
    }
    b.circle(0, 0, R * 0.14, 'trim', { lvl: 6, h: R * 0.1, dome: true });
    b.circle(0, 0, R * 0.06, 'accent', { lvl: 7, h: R * 0.05 });
    navLights(b, R * 0.25, R * 0.2);
  }

  function lattice(b, c, r, R, major) {
    const n = major ? 4 : 3, m = major ? 4 : 2;
    const s = major ? R * 0.6 : R * 0.72;
    const node = (i, j) => [(i - (n - 1) / 2) * s, (j - (m - 1) / 2) * s];
    // Decide the left half and mirror it, so the lattice stays near-symmetric.
    const half = Math.ceil(n / 2);
    const has = [];
    for (let i = 0; i < half; i++) for (let j = 0; j < m; j++) has[i * m + j] = r() < 0.82;
    const present = (i, j) => has[Math.min(i, n - 1 - i) * m + j] !== false;
    const mats = ['hull', 'hull', 'hull2', 'trim'];
    const matOf = [];
    for (let k = 0; k < half * m; k++) matOf.push(mats[Math.floor(r() * mats.length)]);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < m; j++) {
        const [x, y] = node(i, j);
        if (i < n - 1) b.strut(x, y, x + s, y, R * 0.05, 'strut', { lvl: 0, thin: true, h: R * 0.04 });
        if (j < m - 1) b.strut(x, y, x, y + s, R * 0.05, 'strut', { lvl: 0, thin: true, h: R * 0.04 });
        if (!present(i, j)) continue;
        const k = Math.min(i, n - 1 - i) * m + j;
        const sz = s * (0.42 + ((k * 7) % 5) * 0.06);
        b.poly(U.rect(x, y, sz, sz * (j % 2 ? 0.8 : 1)), matOf[k], { lvl: 2, h: R * 0.12, bevel: R * 0.04 });
        if (k % 3 === 0) b.poly(U.rect(x, y - sz * 0.3, sz * 0.9, sz * 0.18), 'accent', { lvl: 3, h: R * 0.13 });
        b.light(x + sz * 0.38, y + sz * 0.38, 2.2, c.pal.light);
      }
    }
    // Radiator fins off the left and right ends.
    for (const sgn of [-1, 1]) {
      for (let j = 0; j < m; j++) {
        const [x, y] = node(sgn < 0 ? 0 : n - 1, j);
        b.poly(U.rect(x + sgn * s * 0.6, y, s * 0.75, s * 0.16), 'panel', { lvl: 1, h: R * 0.02, grid: [5, 1] });
      }
    }
    b.poly(U.rect(0, 0, s * 0.7, s * 0.7, Math.PI / 4), 'trim', { lvl: 4, h: R * 0.16, bevel: R * 0.12, roof: true });
    b.circle(0, 0, s * 0.14, 'accent', { lvl: 5, h: R * 0.18 });
    const [ex, ey] = node(n - 1, m - 1);
    navLights(b, ex + s * 0.5, ey + s * 0.3);
  }

  function star(b, c, r, R, major) {
    const S = { layer: 'spin' };
    b.bp.layers = ['spin', 'fixed'];
    b.bp.spinRate = 0.06;
    const N = 5 + Math.floor(r() * 3) + (major ? 2 : 0);
    const a0 = r() * TAU;
    if (major) {
      for (let i = 0; i < N; i++) {
        const a = a0 + ((i + 0.5) / N) * TAU;
        b.poly(U.sector(0, 0, R * 1.12, R * 0.05, a - 0.18, a + 0.18, 3), 'hull2', { ...S, lvl: -1, h: R * 0.03 });
      }
    }
    for (let i = 0; i < N; i++) {
      const a = a0 + (i / N) * TAU;
      const len = R * (i % 2 && major ? 0.72 : 1.0) * (0.9 + r() * 0.15);
      const dir = [Math.cos(a), Math.sin(a)], nrm = [-Math.sin(a), Math.cos(a)];
      const base = R * 0.24, wdt = R * 0.1;
      const P = (d, o) => [dir[0] * d + nrm[0] * o, dir[1] * d + nrm[1] * o];
      b.poly([P(base, -wdt), P(len, 0), P(base, wdt), P(base * 0.8, 0)], 'hull2', { ...S, lvl: 1, h: R * 0.06, bevel: R * 0.08, roof: true });
      b.poly([P(base * 1.2, -wdt * 0.25), P(len * 0.85, 0), P(base * 1.2, wdt * 0.25)], 'accent', { ...S, lvl: 1.5, h: R * 0.08 });
      b.light(...P(len, 0), 2.4, c.pal.light, { layer: 'spin', blink: i * 1.3 });
      const ca = a + Math.PI / N;
      const cd = R * 0.5, cs = R * 0.1;
      const Q = (d, o) => [Math.cos(ca) * d - Math.sin(ca) * o, Math.sin(ca) * d + Math.cos(ca) * o];
      b.poly([Q(cd + cs * 1.3, 0), Q(cd, cs * 0.6), Q(cd - cs, 0), Q(cd, -cs * 0.6)], 'glass', { ...S, lvl: 0.8, h: R * 0.05, bevel: R * 0.06 });
    }
    b.poly(U.circle(0, 0, R * 0.32, 6, a0), 'hull', { ...S, lvl: 2, h: R * 0.08, bevel: R * 0.12, roof: true });
    b.poly(U.circle(0, 0, R * 0.14, 6, a0 + Math.PI / 6), 'glass', { lvl: 5, h: R * 0.12, bevel: R * 0.08 });
    b.light(0, 0, 3, c.pal.light, { blink: 0.5 });
  }

  function cluster(b, c, r, R, major) {
    b.poly(U.blob(0, 0, R * 0.36, R * 0.32, r, 0.3, 10), 'hull', { lvl: 2, h: R * 0.1, bevel: R * 0.14, roof: true });
    const k = major ? 7 + Math.floor(r() * 3) : 3 + Math.floor(r() * 3);
    const sats = [];
    for (let i = 0; i < k; i++) {
      const a = (i / k) * TAU + (r() - 0.5) * 0.5;
      const d = R * (0.62 + r() * 0.4);
      sats.push({ x: Math.cos(a) * d, y: Math.sin(a) * d, s: R * (0.12 + r() * 0.13), a });
    }
    const tendril = (x0, y0, x1, y1, w0, bend) => {
      const mx = (x0 + x1) / 2 - (y1 - y0) * bend, my = (y0 + y1) / 2 + (x1 - x0) * bend;
      const line = [];
      for (let i = 0; i <= 8; i++) {
        const t = i / 8;
        line.push([lerp(lerp(x0, mx, t), lerp(mx, x1, t), t), lerp(lerp(y0, my, t), lerp(my, y1, t), t)]);
      }
      b.poly(U.strip(line, (t) => w0 * (1 - 0.45 * t)), 'hull2', { lvl: 1, h: R * 0.05, bevel: R * 0.02 });
    };
    for (const s of sats) tendril(0, 0, s.x, s.y, R * 0.1, (r() - 0.5) * 0.5);
    for (let i = 0; i < k; i++) {
      const a = sats[i], q = sats[(i + 1) % k];
      if (r() < 0.4) tendril(a.x, a.y, q.x, q.y, R * 0.05, (r() - 0.5) * 0.4);
    }
    const mats = ['hull', 'trim', 'hull2'];
    for (const s of sats) {
      b.poly(U.blob(s.x, s.y, s.s, s.s * 0.85, r, 0.35, 9, s.a), mats[Math.floor(r() * 3)], { lvl: 2, h: R * 0.08, bevel: s.s * 0.5, roof: true });
      b.circle(s.x, s.y, s.s * 0.28, 'glass', { lvl: 3, h: R * 0.1, dome: true });
      b.light(s.x, s.y, 2, c.pal.light, { blink: s.a * 3 });
      if (major && r() < 0.6) {
        const px = s.x + Math.cos(s.a) * s.s * 1.3, py = s.y + Math.sin(s.a) * s.s * 1.3;
        b.poly(U.blob(px, py, R * 0.07, R * 0.06, r, 0.3, 8), 'accent', { lvl: 1.5, h: R * 0.05, bevel: R * 0.04, roof: true });
      }
    }
    b.circle(0, 0, R * 0.12, 'glass', { lvl: 3, h: R * 0.16, dome: true });
    b.light(0, 0, 3, c.pal.light, { blink: 0.3 });
  }

  // ---------- Gate stations ----------
  // Entry and exit points for interstellar travel. Only major factions (and the legacy culture)
  // have the technology; the culture's lineage decides the form. Every gate has a clear
  // aperture at the origin (the 'field' material) that ships fly into.

  const GATE_FORMS = { wedge: 'ring', arc: 'halo', block: 'frame', shard: 'pylons', spindle: 'spar', coral: 'maw' };
  const canBuildGate = (c) => !!c && (c.kind === 'major' || c.kind === 'legacy');

  function aperture(b, c, pts, R, n) {
    const lines = [];
    for (let i = 0; i < 12; i += 2) {
      const a0 = (i / 12) * TAU, a1 = ((i + 1) / 12) * TAU;
      lines.push([Math.cos(a0) * R * 0.55, Math.sin(a0) * R * 0.55, Math.cos(a1) * R * 0.55, Math.sin(a1) * R * 0.55]);
    }
    b.poly(pts, 'field', { lvl: -2, h: 0.3, lines, lineWidth: 0.5 });
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU;
      b.light(Math.cos(a) * R * 0.97, Math.sin(a) * R * 0.97, 1.8, c.pal.glass, { blink: -a * 2 });
    }
  }

  function gateRing(b, c, r, R) {
    b.bp.layers = ['spin', 'fixed'];
    b.bp.spinRate = 0.25;
    b.ring(0, 0, R * 0.86, R * 0.05, 'hull2', { layer: 'spin', lvl: 0, h: R * 0.06 });
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU;
      b.light(Math.cos(a) * R * 0.86, Math.sin(a) * R * 0.86, 2, c.pal.light, { layer: 'spin' });
    }
    b.ring(0, 0, R, R * 0.16, 'hull', { lvl: 1, h: R * 0.14 });
    const k = 8 + 2 * Math.floor(r() * 3);
    for (let i = 0; i < k; i++) {
      const a = (i / k) * TAU;
      b.poly(U.rect(Math.cos(a) * R, Math.sin(a) * R, R * 0.1, R * 0.26, a), 'trim', { lvl: 2, h: R * 0.18, bevel: R * 0.03 });
      if (i % 2 === 0) b.poly(U.rect(Math.cos(a) * R * 1.1, Math.sin(a) * R * 1.1, R * 0.1, R * 0.05, a), 'accent', { lvl: 3, h: R * 0.19 });
    }
    const anchors = r() < 0.5 ? 3 : 4;
    const a0 = anchors === 4 ? TAU / 8 : -Math.PI / 2;
    for (let i = 0; i < anchors; i++) {
      const a = a0 + (i / anchors) * TAU;
      const P = (d) => [Math.cos(a) * d, Math.sin(a) * d];
      b.strut(...P(R * 1.08), ...P(R * 1.5), R * 0.05, 'strut', { lvl: 0, h: R * 0.04, thin: true });
      b.poly(U.rect(...P(R * 1.56), R * 0.2, R * 0.16, a), 'hull2', { lvl: 2, h: R * 0.1, bevel: R * 0.03 });
      if (c.arrays !== 'radiator') b.poly(U.rect(...P(R * 1.56), R * 0.18, R * 0.9, a), 'panel', { lvl: 1, h: R * 0.02, grid: [1, 5] });
      b.light(...P(R * 1.66), 2.6, c.pal.light, { blink: i });
    }
    aperture(b, c, U.circle(0, 0, R * 0.8, 32), R * 0.8, 16);
    return k + ' clamps, ' + anchors + ' anchors';
  }

  function gateHalo(b, c, r, R) {
    const n = 10 + 2 * Math.floor(r() * 3);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU;
      b.poly(U.chaikin(U.rect(Math.cos(a) * R * 1.12, Math.sin(a) * R * 1.12, R * 0.2, R * 0.22, a), 2), i % 3 === 0 ? 'accent' : 'trim', { lvl: 0, h: R * 0.07, bevel: R * 0.07, roof: true });
    }
    b.ring(0, 0, R, R * 0.24, 'hull', { lvl: 1, h: R * 0.12 });
    b.ring(0, 0, R * 0.86, R * 0.03, 'accent', { lvl: 2, h: R * 0.13 });
    const emitters = 3 + Math.floor(r() * 2);
    for (let i = 0; i < emitters; i++) {
      const a = (i / emitters) * TAU - Math.PI / 2;
      b.circle(Math.cos(a) * R, Math.sin(a) * R, R * 0.09, 'glass', { lvl: 3, h: R * 0.08, dome: true });
    }
    for (let i = 0; i < n; i++) {
      const a = ((i + 0.5) / n) * TAU;
      b.light(Math.cos(a) * R * 1.1, Math.sin(a) * R * 1.1, 2, c.pal.light, { blink: i * 0.6 });
    }
    aperture(b, c, U.circle(0, 0, R * 0.8, 32), R * 0.8, 12);
    return n + ' pods, ' + emitters + ' emitters';
  }

  function gateFrame(b, c, r, R) {
    const sides = r() < 0.55 ? 4 : 6;
    const m = 2 + Math.floor(r() * 2);
    const a0 = sides === 4 ? TAU / 8 : 0;
    const V = Array.from({ length: sides }, (_, i) => { const a = a0 + (i / sides) * TAU; return [Math.cos(a) * R * 1.05, Math.sin(a) * R * 1.05, a]; });
    const mats = ['hull', 'hull', 'hull2', 'trim'];
    const matOf = Array.from({ length: m }, () => mats[Math.floor(r() * mats.length)]);
    for (let i = 0; i < sides; i++) {
      const [x0, y0] = V[i], [x1, y1] = V[(i + 1) % sides];
      const ae = Math.atan2(y1 - y0, x1 - x0), E = Math.hypot(x1 - x0, y1 - y0);
      b.strut(x0, y0, x1, y1, R * 0.06, 'strut', { lvl: 0, h: R * 0.04, thin: true });
      for (let j = 0; j < m; j++) {
        const t = (j + 0.5) / m, x = lerp(x0, x1, t), y = lerp(y0, y1, t);
        const len = (E / m) * 0.62;
        const k = Math.min(j, m - 1 - j);
        b.poly(U.rect(x, y, len, R * 0.2, ae), matOf[k], { lvl: 2, h: R * 0.12, bevel: R * 0.03, lines: [[...U.add([x, y], U.rot([0, -R * 0.08], ae)), ...U.add([x, y], U.rot([0, R * 0.08], ae))]] });
        if ((i + j) % 2 === 0) b.poly(U.rect(...U.add([x, y], U.rot([0, -R * 0.065], ae)), len * 0.8, R * 0.05, ae), 'accent', { lvl: 3, h: R * 0.13 });
      }
    }
    for (const [x, y, a] of V) {
      if (c.arrays === 'radiator') {
        for (const f of [-1, 1]) {
          const fa = a + f * 0.35;
          b.poly(U.rect(x + Math.cos(fa) * R * 0.42, y + Math.sin(fa) * R * 0.42, R * 0.5, R * 0.1, fa), 'panel', { lvl: 1, h: R * 0.02, grid: [4, 1] });
        }
      }
      b.poly(U.rect(x, y, R * 0.3, R * 0.3, a), 'hull2', { lvl: 3, h: R * 0.16, bevel: R * 0.05 });
      b.light(x + Math.cos(a) * R * 0.17, y + Math.sin(a) * R * 0.17, 2.4, c.pal.light, { blink: a * 2 });
    }
    aperture(b, c, V.map(([x, y]) => [x * 0.8, y * 0.8]), R * 0.8 * Math.cos(Math.PI / sides), sides * 3);
    return sides + '-sided, ' + m + ' modules per side';
  }

  function gatePylons(b, c, r, R) {
    b.bp.layers = ['spin', 'fixed'];
    b.bp.spinRate = 0.05;
    const p = r() < 0.55 ? 2 : 3;
    const a0 = p === 2 ? Math.PI / 2 : -Math.PI / 2;
    for (let i = 0; i < p * 3; i++) {
      const a = (i / (p * 3)) * TAU + r() * 0.3, d = R * (1.42 + r() * 0.12), s = R * (0.06 + r() * 0.05);
      const P = (u, v) => [Math.cos(a) * (d + u) - Math.sin(a) * v, Math.sin(a) * (d + u) + Math.cos(a) * v];
      b.poly([P(s, 0), P(0, s * 1.8), P(-s, 0), P(0, -s * 1.8)], 'hull2', { layer: 'spin', lvl: 0, h: R * 0.03, bevel: R * 0.04, roof: true });
    }
    for (let i = 0; i < p; i++) {
      const a = a0 + (i / p) * TAU;
      const L = R * (p === 2 ? 1.7 : 1.25) * (0.92 + r() * 0.14), w = R * 0.34, d = R * 1.02;
      // u runs along the spire (tangent), v points outward from the aperture.
      const P = (u, v) => [Math.cos(a) * (d + v) - Math.sin(a) * u, Math.sin(a) * (d + v) + Math.cos(a) * u];
      b.poly([P(L / 2, 0), P(L * 0.18, w * 0.6), P(-L * 0.3, w * 0.45), P(-L / 2, 0), P(-L * 0.12, -w * 0.28), P(L * 0.22, -w * 0.28)], 'hull2', { lvl: 1, h: R * 0.1, bevel: R * 0.14, roof: true });
      b.poly([P(L * 0.4, w * 0.05), P(-L * 0.38, w * 0.12), P(-L * 0.36, w * 0.02)], 'accent', { lvl: 1.5, h: R * 0.12 });
      b.poly([P(L * 0.12, -w * 0.28), P(0, -w * 0.62), P(-L * 0.12, -w * 0.28), P(0, -w * 0.1)], 'glass', { lvl: 2, h: R * 0.08, bevel: R * 0.06 });
      b.light(...P(L / 2, 0), 2.6, c.pal.light, { blink: i * 1.7 });
      b.light(...P(-L / 2, 0), 2.6, c.pal.light, { blink: i * 1.7 + 1 });
    }
    aperture(b, c, U.circle(0, 0, R * 0.62, 28), R * 0.62, p * 4);
    return p + ' pylons';
  }

  function gateSpar(b, c, r, R) {
    b.bp.layers = ['spin', 'fixed'];
    b.bp.spinRate = 0.12;
    b.ring(0, 0, R, R * 0.12, 'hull', { layer: 'spin', lvl: 1, h: R * 0.1 });
    const mods = 6 + 2 * Math.floor(r() * 2);
    for (let i = 0; i < mods; i++) {
      const a = (i / mods) * TAU + TAU / (mods * 2);
      b.poly(U.chaikin(U.rect(Math.cos(a) * R, Math.sin(a) * R, R * 0.2, R * 0.16, a), roundIters(c)), 'trim', { layer: 'spin', lvl: 2, h: R * 0.14, bevel: R * 0.04, roof: true });
      b.light(Math.cos(a) * R * 0.9, Math.sin(a) * R * 0.9, 2, c.pal.light, { layer: 'spin' });
    }
    const half = R * (1.6 + r() * 0.4), ty = R * 1.22;
    const nodes = 1 + Math.floor(r() * 2);
    const kinds = Array.from({ length: nodes }, () => ['habitat', 'tank', 'cargo'][Math.floor(r() * 3)]);
    for (const sy of [-1, 1]) {
      const y = sy * ty;
      b.poly(U.rect(0, y, half * 2, R * 0.07), 'strut', { lvl: 3, h: R * 0.05 });
      for (const sx of [-0.45, 0.45]) b.strut(sx * R, sy * R * 1.06, sx * R, y, R * 0.04, 'strut', { lvl: 0, h: R * 0.04, thin: true });
      b.poly(U.chaikin(U.rect(0, y, R * 0.36, R * 0.2), roundIters(c)), 'hull', { lvl: 4, h: R * 0.12, bevel: R * 0.06, roof: true });
      for (const sx of [-1, 1]) {
        for (let i = 0; i < nodes; i++) {
          const x = sx * (R * 0.75 + i * R * 0.42);
          if (kinds[i] === 'habitat') b.poly(U.chaikin(U.rect(x, y, R * 0.26, R * 0.36), roundIters(c)), 'hull', { lvl: 4, h: R * 0.1, bevel: R * 0.06, roof: true });
          else if (kinds[i] === 'tank') for (const t of [-1, 1]) b.circle(x, y + t * R * 0.1, R * 0.09, 'trim', { lvl: 4, h: R * 0.08, dome: true });
          else for (const t of [-1, 1]) b.poly(U.rect(x, y + t * R * 0.09, R * 0.18, R * 0.14), t > 0 ? 'accent' : 'hull2', { lvl: 4, h: R * 0.08 });
        }
        if (c.arrays === 'solar') b.poly(U.rect(sx * half, y, R * 0.16, R * 0.75), 'panel', { lvl: 5, h: R * 0.02, grid: [1, 5] });
        b.light(sx * (half + R * 0.1), y, 2.6, c.pal.light, { blink: sx + sy });
      }
    }
    aperture(b, c, U.circle(0, 0, R * 0.84, 32), R * 0.84, 12);
    return nodes + ' module' + (nodes > 1 ? 's' : '') + ' per arm';
  }

  function gateMaw(b, c, r, R) {
    const k = 5 + Math.floor(r() * 3);
    const lobes = [];
    for (let i = 0; i < k; i++) {
      const a = (i / k) * TAU + (r() - 0.5) * 0.35;
      lobes.push({ a, x: Math.cos(a) * R * 1.04, y: Math.sin(a) * R * 1.04, s: R * (0.26 + r() * 0.1) });
    }
    const tendril = (p, q, w0) => {
      const mx = (p.x + q.x) / 2 * 1.18, my = (p.y + q.y) / 2 * 1.18;
      const line = [];
      for (let i = 0; i <= 8; i++) { const t = i / 8; line.push([lerp(lerp(p.x, mx, t), lerp(mx, q.x, t), t), lerp(lerp(p.y, my, t), lerp(my, q.y, t), t)]); }
      b.poly(U.strip(line, (t) => w0 * (1 - 0.4 * Math.sin(t * Math.PI))), 'hull2', { lvl: 0, h: R * 0.05, bevel: R * 0.02 });
    };
    for (let i = 0; i < k; i++) tendril(lobes[i], lobes[(i + 1) % k], R * 0.1);
    const mats = ['hull', 'trim', 'hull2'];
    for (const L of lobes) {
      b.poly(U.blob(L.x, L.y, L.s, L.s * 0.62, r, 0.3, 9, L.a + Math.PI / 2), mats[Math.floor(r() * 3)], { lvl: 2, h: R * 0.1, bevel: L.s * 0.5, roof: true });
      b.circle(L.x - Math.cos(L.a) * L.s * 0.2, L.y - Math.sin(L.a) * L.s * 0.2, L.s * 0.18, 'glass', { lvl: 3, h: R * 0.11, dome: true });
      if (r() < 0.6) b.poly(U.blob(L.x + Math.cos(L.a) * L.s * 0.85, L.y + Math.sin(L.a) * L.s * 0.85, R * 0.07, R * 0.06, r, 0.3, 8), 'accent', { lvl: 1.5, h: R * 0.05, bevel: R * 0.04, roof: true });
      b.light(L.x, L.y, 2, c.pal.light, { blink: L.a * 3 });
    }
    aperture(b, c, U.blob(0, 0, R * 0.74, R * 0.7, r, 0.12, 12), R * 0.72, 10);
    return k + ' lobes';
  }

  function gate(culture, seed) {
    const r = mulberry32(hashInt(seed, 6, culture.seed));
    const b = builder('gate', culture, seed);
    const R = 120 * (0.92 + r() * 0.16);
    const form = culture.gate || GATE_FORMS[culture.lineage] || 'ring';
    const fn = { ring: gateRing, halo: gateHalo, frame: gateFrame, pylons: gatePylons, spar: gateSpar, maw: gateMaw }[form] || gateRing;
    const info = fn(b, culture, r, R);
    b.bp.label = 'Gate · ' + form + ', ' + info;
    return finish(b.bp);
  }

  // ---------- Wrecks ----------

  // Break a blueprint apart: split along cut lines, drift the pieces, tear the cut edges,
  // drop loose parts, kill the lights and scorch the hull.
  function wreck(source, seed) {
    const r = mulberry32(hashInt(seed, 5, source.seed >>> 0));
    const isShip = source.type === 'fighter' || source.type === 'freighter' || source.type === 'player';
    const R = source.bodyRadius;
    const b = builder(isShip ? 'wreck-ship' : 'wreck-station', source.culture, seed);
    b.bp.wrecked = true;

    // Everything becomes plain polygons on one layer; rings lose some sections.
    let parts = [];
    for (const p of source.parts) {
      const base = { mat: p.mat, lvl: p.lvl, h: p.h, bevel: p.bevel, grid: p.grid, lines: p.lines, overlay: p.overlay, line: p.line, roof: p.roof };
      if (p.shape === 'circle') parts.push({ ...base, pts: U.circle(p.cx, p.cy, p.r, 18), dome: p.dome });
      else if (p.shape === 'ring') {
        const n = 14;
        for (let i = 0; i < n; i++) {
          if (r() < 0.28) continue;
          parts.push({ ...base, pts: U.sector(p.cx, p.cy, p.r, p.w, (i / n) * TAU, ((i + 1) / n) * TAU - 0.04, 3) });
        }
      } else parts.push({ ...base, pts: p.pts });
    }
    // Small loose parts are lost or flung outward as debris.
    const small = (p) => Math.abs(U.area(p.pts)) < (R * R) * (isShip ? 0.004 : 0.003);
    const debris = [];
    parts = parts.filter((p) => {
      if (!small(p) || p.mat === 'accent' && isShip) return true;
      const roll = r();
      if (roll < 0.3) return false;
      if (roll < 0.55) { debris.push(p); return false; }
      return true;
    });

    // Cut lines through the middle; ships break across their length.
    const cuts = isShip ? 1 : 1 + (source.type === 'station-major' ? 1 : Math.floor(r() * 2));
    let pieces = [parts];
    for (let k = 0; k < cuts; k++) {
      const a = isShip ? Math.PI / 2 + (r() - 0.5) * 1.1 : r() * Math.PI;
      const nx = Math.cos(a), ny = Math.sin(a);
      const d = (r() - 0.5) * R * (isShip ? 0.5 : 0.4);
      const next = [];
      for (const piece of pieces) {
        const A = [], B = [];
        for (const p of piece) {
          const pa = U.clipPoly(p.pts, nx, ny, d), pb = U.clipPoly(p.pts, -nx, -ny, -d);
          const lines = (s, sx, sy, sd) => (p.lines || []).map((l) => U.clipSeg(l, sx, sy, sd)).filter(Boolean);
          if (pa) A.push({ ...p, pts: tear(pa, nx, ny, d, r, R), lines: lines(p, nx, ny, d) });
          if (pb) B.push({ ...p, pts: tear(pb, nx, ny, d, r, R), lines: lines(p, -nx, -ny, -d) });
        }
        // Drift the two halves apart and give them a twist.
        const gap = R * (0.12 + r() * 0.12), twist = (r() - 0.5) * 0.5;
        const pivot = [nx * d, ny * d];
        const move = (list, s) => list.map((p) => ({
          ...p,
          pts: p.pts.map((q) => U.add(U.add(U.rot([q[0] - pivot[0], q[1] - pivot[1]], s * twist), pivot), [nx * gap * s / 2, ny * gap * s / 2])),
          lines: p.lines.map((l) => {
            const t = (x, y) => U.add(U.add(U.rot([x - pivot[0], y - pivot[1]], s * twist), pivot), [nx * gap * s / 2, ny * gap * s / 2]);
            return [...t(l[0], l[1]), ...t(l[2], l[3])];
          }),
        }));
        if (A.length) next.push(move(A, 1));
        if (B.length) next.push(move(B, -1));
      }
      pieces = next;
    }
    for (const piece of pieces) for (const p of piece) b.poly(p.pts, p.mat, { lvl: p.lvl, h: p.h, bevel: p.bevel, grid: p.grid, lines: p.lines, overlay: p.overlay, line: p.line, roof: p.roof });

    for (const p of debris) {
      const [cx, cy] = U.centroid(p.pts);
      const away = Math.hypot(cx, cy) || 1;
      const push = R * (0.15 + r() * 0.35), tw = r() * TAU;
      const pts = p.pts.map(([x, y]) => U.add(U.rot([x - cx, y - cy], tw), [cx + (cx / away) * push, cy + (cy / away) * push]));
      b.poly(pts, p.mat, { lvl: p.lvl, h: p.h * 0.6 });
    }
    // Shards of hull plating.
    for (let i = 0; i < (isShip ? 4 : 9); i++) {
      const a = r() * TAU, d = R * (0.5 + r() * 0.6), s = R * (isShip ? 0.05 : 0.035) * (0.6 + r());
      const x = Math.cos(a) * d, y = Math.sin(a) * d, t = r() * TAU;
      b.poly([[x + Math.cos(t) * s, y + Math.sin(t) * s], [x + Math.cos(t + 2.3) * s * 0.7, y + Math.sin(t + 2.3) * s * 0.7], [x + Math.cos(t + 4) * s * 0.9, y + Math.sin(t + 4) * s * 0.9]], r() < 0.5 ? 'hull' : 'hull2', { lvl: 0.2, h: 0.6 });
    }
    // Scorch marks over the hull.
    const solid = b.bp.parts.filter((p) => !p.overlay && Math.abs(U.area(p.pts)) > R * R * 0.01);
    for (let i = 0; i < (isShip ? 3 : 6) && solid.length; i++) {
      const p = solid[Math.floor(r() * solid.length)];
      const [cx, cy] = U.centroid(p.pts);
      const s = R * (isShip ? 0.12 : 0.1) * (0.6 + r() * 0.8);
      b.poly(U.blob(cx + (r() - 0.5) * s, cy + (r() - 0.5) * s, s, s * 0.7, r, 0.6, 9, r() * TAU), 'scorch', { lvl: 9, overlay: true, line: false });
    }
    // One light still sputtering.
    const lit = source.lights.filter((l) => l.layer === 'fixed' || l.layer === 'spin');
    if (lit.length && !isShip) {
      const l = lit[Math.floor(r() * lit.length)];
      b.light(l.x, l.y, l.r, l.color, { flicker: true });
    }
    b.bp.label = `${isShip ? 'Ship' : 'Station'} wreck · from ${source.label.split(' · ')[0].toLowerCase()}`;
    return finish(b.bp);
  }

  // Replace edges lying on the cut line with a torn zigzag that bites into the piece.
  function tear(pts, nx, ny, d, r, R) {
    const on = (p) => Math.abs(nx * p[0] + ny * p[1] - d) < 1e-6 * (R + 1);
    const out = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      out.push(a);
      if (!on(a) || !on(b)) continue;
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const steps = Math.min(12, Math.floor(len / (R * 0.06)));
      for (let k = 1; k < steps; k++) {
        const t = k / steps, depth = R * 0.05 * r();
        out.push([lerp(a[0], b[0], t) + nx * depth, lerp(a[1], b[1], t) + ny * depth]);
      }
    }
    return out;
  }

  // ---------- The game's original shapes ----------

  const SHIP_HULL = [[20, 0], [-8, 11], [-4, 4], [-11, 4], [-11, -4], [-4, -4], [-8, -11]];

  function playerShip(culture) {
    const b = builder('player', culture, 1);
    b.poly(SHIP_HULL, 'hull', { lvl: 1, h: 3, bevel: 3.5, roof: true });
    for (const s of [1, -1]) b.poly([[2.5, s * 6.1], [-8, s * 11], [-7, s * 9.2], [1.4, s * 5.1]], 'accent', { lvl: 2, h: 0.4, line: false });
    b.poly(U.rect(-9.7, 0, 2.6, 8), 'engine', { lvl: 2, h: 2.5, line: false });
    b.poly([[9, 0], [1, 2.5], [1, -2.5]], 'glass', { lvl: 3, h: 1, bevel: 1.5, lineWidth: 0.75 });
    b.engine(-11, 0, 3);
    b.bp.glow = true;
    b.bp.line = culture.pal.line;
    b.bp.label = 'Player ship · SHIP_HULL';
    return finish(b.bp);
  }

  function tarsisStation(culture, r = 90) {
    const b = builder('station-major', culture, 2);
    const S = { layer: 'spin' };
    b.bp.layers = ['spin', 'fixed'];
    b.bp.spinRate = 0.15;
    b.ring(0, 0, r * 0.91, r * 0.18, 'hull', { ...S, lvl: 1, h: r * 0.12 });
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * TAU;
      b.strut(Math.cos(a) * r * 0.28, Math.sin(a) * r * 0.28, Math.cos(a) * r * 0.82, Math.sin(a) * r * 0.82, 4, 'strut', { ...S, lvl: 0, thin: true, h: 3 });
    }
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU + TAU / 16;
      b.poly([[r * 0.8, -7], [r * 1.02, -7], [r * 1.02, 7], [r * 0.8, 7]].map((p) => U.rot(p, a)), 'trim', { ...S, lvl: 2, h: r * 0.16, bevel: 2 });
      b.light(Math.cos(a) * r * 0.94, Math.sin(a) * r * 0.94, 1.6, culture.pal.light, { layer: 'spin', line: false });
    }
    b.poly(U.rect(0, 0, 12, r * 3.1), 'hull2', { lvl: 4, h: 6, bevel: 2 });
    for (const sy of [-1, 1]) {
      const py = sy * r * 1.55;
      const lines = [];
      for (let i = -2; i <= 2; i++) lines.push([i * r * 0.28, py - 10, i * r * 0.28, py + 10]);
      b.poly(U.rect(0, py, r * 1.4, 20), 'panel', { lvl: 5, h: 2, lines });
    }
    b.circle(0, 0, r * 0.28, 'trim', { lvl: 6, h: 8, dome: true });
    b.light(-r * 0.7, -r * 1.55, 4, '#ff4d4d', { blink: 0 });
    b.light(r * 0.7, r * 1.55, 4, '#4dff88', { blink: 0 });
    b.bp.line = '#b6ff8a';
    b.bp.label = 'Station · Tarsis Station';
    return finish(b.bp);
  }

  // ---------- Entry points ----------

  const TYPES = ['fighter', 'freighter', 'station-minor', 'station-major', 'wreck-ship', 'wreck-station'];

  function create(type, culture, seed = 1) {
    const s = seed >>> 0;
    switch (type) {
      case 'fighter': return ship(culture, s, 'fighter');
      case 'freighter': return ship(culture, s, 'freighter');
      case 'station-minor': return station(culture, s, 'minor');
      case 'station-major': return station(culture, s, 'major');
      case 'gate':
        if (!canBuildGate(culture)) return null;
        return gate(culture, s);
      case 'wreck-ship': return wreck(ship(culture, s, mulberry32(s)() < 0.5 ? 'fighter' : 'freighter'), s);
      case 'wreck-station': return wreck(station(culture, s, mulberry32(s + 1)() < 0.6 ? 'minor' : 'major'), s);
      default: throw new Error(`Unknown asset type: ${type}`);
    }
  }

  // 'gate' is kept out of TYPES because create() returns null for cultures without gate technology.
  return { TYPES, GATE_FORMS, canBuildGate, create, gate, wreck, playerShip, tarsisStation, SHIP_HULL, builder, finish };
})();

if (typeof module !== 'undefined') module.exports = ArtBlueprints;
