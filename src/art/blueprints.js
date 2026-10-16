'use strict';

// Procedural asset blueprints: style-independent 2D part lists that art/render.js draws in any
// of the four art styles. Coordinates are world units, nose toward +x, +y down (canvas space).
//
// A blueprint is { id, type, culture, parts, lights, engines, layers, spinRate, radius, label }.
// Each part is a polygon, circle or ring with a material (a palette key or a literal hex colour),
// a draw level `lvl`, a layer ('fixed' or 'spin') and, for the low-poly style, a height `h` and an
// optional raised top `bevel` (a ridge or apex with `roof: true`, else a chamfer). Optional extras: `lines` (detail segments), `grid` [nx, ny]
// (panel cells), `thin` (a strut drawn as one line in the line style), `dome` (circles),
// `line: false` (part skipped in the line style), `overlay` (scorch marks drawn over what is below).
// Works as a classic browser script (global `ArtBlueprints`) and as a Node module.

const ArtBlueprints = (() => {
  const isNode = typeof require === 'function' && typeof module !== 'undefined';
  const U = isNode ? require('./util.js') : ArtUtil;
  const { mulberry32, hashInt } = isNode ? require('../core/rng.js') : globalThis;
  const { TAU, lerp, clamp } = U;

  // A blueprint's id names what it is built from (type, culture and seed), so building the same
  // asset again (a scene rebuilt from its seed) finds the same cached sprites (art/render.js).
  function builder(type, culture, seed) {
    const bp = {
      id: `${type}:${culture.seed ?? 0}:${seed}`, type, culture, seed, parts: [], lights: [], engines: [],
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
      case 'bio': { // lobed seed pod, jittered and heavily smoothed
        const j = () => 0.85 + r() * 0.3;
        half = [[L / 2, 0], [L * 0.36, W * 0.5 * j()], [L * 0.08, W * 0.9 * j()], [-L * 0.2, W * j()], [-L * 0.4, W * 0.7 * j()], [-L / 2, W * 0.3], [-L / 2, 0]];
        return U.chaikin(U.mirror(half).map(([x, y]) => [x, y < 0 ? y * (1 - c.asym * 0.5 * r()) : y]), 3);
      }
      case 'synth': // stepped, all right angles
        return U.mirror([[L / 2, 0], [L / 2, W * 0.28], [L * 0.22, W * 0.28], [L * 0.22, W * 0.8], [-L * 0.36, W * 0.8], [-L * 0.36, W * 0.5], [-L / 2, W * 0.5], [-L / 2, 0]]);
      case 'block':
        half = [[L / 2, 0], [L / 2, W * 0.45], [L * 0.36, W * 0.85], [L * 0.2, W], [-L / 2, W], [-L / 2, 0]];
        break;
      case 'shard':
        half = [[L / 2, 0], [L * 0.05, W * 0.32], [-L * 0.18, W], [-L * 0.32, W * 0.55], [-L / 2, W * 0.75], [-L / 2, 0]];
        break;
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
      case 'blade':
        return [[[rootX1, y(rootY)], [rootX0 - sweep * 0.9, y(rootY + span * k * 1.15)], [rootX0 + (rootX1 - rootX0) * 0.3, y(rootY)]]];
      case 'fins': {
        const x = -L * 0.36;
        return [
          [[x + L * 0.14, y(W * 0.6)], [x - L * 0.1, y(W + span * 0.5 * k)], [x - L * 0.06, y(W * 0.6)]],
          [[x + L * 0.42, y(W * 0.5)], [x + L * 0.26, y(W + span * 0.25 * k)], [x + L * 0.24, y(W * 0.5)]],
        ];
      }
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
    if (wingKind === 'halo') {
      // A ring around the hull on four struts, touching nothing else.
      const hr = W + g.span * 0.45, hw = Math.max(1.5, W * 0.22), hx = -L * 0.05;
      b.ring(hx, 0, hr, hw, 'wing', { lvl: 1, h: hullH * 0.4 });
      for (let i = 0; i < 4; i++) {
        const a = Math.PI / 4 + (i * Math.PI) / 2;
        b.strut(hx + Math.cos(a) * W * 0.5, Math.sin(a) * W * 0.5, hx + Math.cos(a) * (hr - hw / 2), Math.sin(a) * (hr - hw / 2), Math.max(0.8, W * 0.08), 'strut', { lvl: 0.5, h: hullH * 0.3, thin: true });
      }
      for (const a of [0, Math.PI]) b.poly(U.rect(hx + Math.cos(a) * hr, 0, hw * 0.6, hw * 0.6), 'glass', { lvl: 1.3, h: hullH * 0.45 });
    }
    for (const s of (wingKind === 'halo' ? [] : [1, -1])) {
      const k = s < 0 && culture.asym > 0.1 ? 1 - culture.asym * 0.45 * r() : 1;
      if (wingKind === 'fronds') {
        // Tapering tentacle-like fronds, each tipped with a glowing bud.
        const n = fighter ? 2 : 3;
        for (let i = 0; i < n; i++) {
          const x0 = lerp(g.rootX1, g.rootX0, i / Math.max(1, n - 1)), len = g.span * k * (1 - i * 0.18), ph = r() * TAU;
          const line = Array.from({ length: 9 }, (_, t) => { const u = t / 8; return [x0 - g.sweep * 0.8 * u ** 1.4 + Math.sin(u * 4 + ph) * L * 0.02, s * (W * 0.55 + len * u)]; });
          const w = U.chaikin(U.strip(line, (u) => L * (fighter ? 0.07 : 0.045) * (1 - u * 0.8)), 1);
          b.poly(w, 'wing', { lvl: 1 - i * 0.01, h: hullH * 0.3, bevel: hullH * 0.3, roof: true });
          b.circle(line[8][0], line[8][1], L * 0.018, 'glass', { lvl: 1.2, h: hullH * 0.32, dome: true });
          wings.push(w);
        }
        continue;
      }
      if (wingKind === 'membrane') {
        // A bat-like wing: leading edge to the tip, scalloped trailing edge back to the root, ribs.
        const tipY = g.rootY + g.span * k, tip = [g.rootX0 - g.sweep * 0.5, s * tipY];
        const pts = [[g.rootX1, s * g.rootY], [lerp(g.rootX1, tip[0], 0.55), s * lerp(g.rootY, tipY, 0.85)], tip];
        const ribs = [];
        const sc = 3;
        for (let i = 1; i <= sc; i++) {
          const u = i / sc, um = u - 0.5 / sc;
          pts.push([lerp(tip[0], g.rootX0, um) + L * 0.06, s * lerp(tipY, g.rootY, um)], [lerp(tip[0], g.rootX0, u), s * lerp(tipY, g.rootY, u)]);
          if (i < sc) ribs.push([g.rootX1 - L * 0.04, s * g.rootY, lerp(tip[0], g.rootX0, u), s * lerp(tipY, g.rootY, u)]);
        }
        const w = U.chaikin(pts, 2);
        b.poly(w, 'wing', { lvl: 1, h: hullH * 0.3, bevel: hullH * 0.25, roof: true, lines: [[g.rootX1, s * g.rootY, tip[0], tip[1]], ...ribs] });
        wings.push(w);
        continue;
      }
      if (wingKind === 'vanes') {
        // Parallel blades floating clear of the hull.
        const n = fighter ? 2 : 3, gap = W * 0.35, th = Math.max(1.2, W * 0.16);
        for (let i = 0; i < n; i++) {
          const y = s * (W * 0.8 + gap + i * (th + gap * 0.8)), len = L * (fighter ? 0.5 : 0.4) * (1 - i * 0.18) * wc.span, vx = -L * 0.08 - i * L * 0.04;
          const v = U.rect(vx, y, len, th);
          b.poly(v, 'wing', { lvl: 1, h: hullH * 0.4, bevel: th * 0.3 });
          b.poly(U.rect(vx + len * 0.3, y, len * 0.08, th * 0.5), 'glass', { lvl: 1.3, h: hullH * 0.45 });
          wings.push(v);
        }
        continue;
      }
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
    if (fighter && wingKind !== 'none' && wingKind !== 'halo') {
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
      if (hc.hull === 'bio') b.circle(-L / 2 + nl * 0.15, y, ew * 0.55, 'engine', { lvl: 1.8, h: hullH * 0.6, dome: true });
      else b.poly(U.rect(-L / 2 - nl * 0.2, y, nl, ew), 'engine', { lvl: 1.8, h: hullH * 0.7 });
      b.engine(-L / 2 - nl * 0.7, y, ew * 0.55);
    }

    // Cargo modules on freighters, shaped by culture.
    if (!fighter) freighterCargo(b, donor(culture, r), r, L, W, hull, hullH);

    // Cockpit or bridge.
    const cc = donor(culture, r);
    const cx = fighter ? L * 0.18 : L * 0.3;
    let glass;
    switch (cc.hull) {
      case 'bio': // a cluster of eyes
        for (const i of [-1, 0, 1]) b.circle(cx + L * 0.12 - Math.abs(i) * L * 0.04, i * W * 0.24, L * (i ? 0.02 : 0.028), 'glass', { lvl: 4, h: hullH * 0.3, dome: true });
        glass = null;
        break;
      case 'synth': glass = U.rect(cx + L * 0.14, 0, L * 0.025, W * 0.5); break; // a sensor slit
      case 'block': glass = U.rect(cx + L * 0.12, 0, L * 0.05, W * 0.95); break;
      case 'shard': glass = [[cx + L * 0.16, 0], [cx - L * 0.12, W * 0.2], [cx - L * 0.12, -W * 0.2]]; break;
      default: glass = [[cx + L * 0.12, 0], [cx - L * 0.1, W * 0.3], [cx - L * 0.1, -W * 0.3]];
    }
    if (glass) b.poly(glass, 'glass', { lvl: 4, h: hullH * 0.3, bevel: hullH * 0.3 });

    // Markings: spots (alien), circuit traces (android) or stripes across the hull; an insignia on
    // each wing.
    const stripes = fighter ? Math.min(culture.stripes, 2) : culture.stripes;
    const inHull = (pts) => pts.every(([px, py]) => U.inPoly(px, py, hull));
    if (hc.hull === 'bio') {
      const [sx0, sy0, sx1, sy1] = U.bbox(hull);
      for (let i = 0, t = 0; i < stripes * 2 + 2 && t < 80; t++) {
        const x = lerp(sx0, sx1, r()), y = lerp(sy0, sy1, r()) * 0.8, s = L * (0.014 + r() * 0.022);
        const spot = U.blob(x, y, s, s * 0.8, r, 0.4, 7);
        if (!inHull(spot)) continue;
        i++;
        b.poly(spot, 'accent', { lvl: 3, h: 0.3 });
        if (culture.asym < 0.2 && Math.abs(y) > s * 2) b.poly(spot.map(([px, py]) => [px, -py]), 'accent', { lvl: 3, h: 0.3 });
      }
    } else if (hc.hull === 'synth') {
      for (let i = 0, t = 0; i < stripes + 1 && t < 40; t++) {
        const x = lerp(-L * 0.42, L * 0.05, r()), y0 = W * (0.15 + r() * 0.5), d = L * (0.1 + r() * 0.08);
        const path = [[x, y0], [x + d, y0], [x + d, y0 * 0.25], [x + d * 2, y0 * 0.25]];
        const tr = U.strip(path, L * 0.012);
        if (!inHull(tr)) continue;
        i++;
        for (const m of [1, -1]) {
          b.poly(tr.map(([px, py]) => [px, py * m]), 'accent', { lvl: 3, h: 0.3 });
          b.poly(U.rect(x + d * 2, y0 * 0.25 * m, L * 0.03, L * 0.03), 'glass', { lvl: 3.2, h: 0.35 });
        }
      }
    } else {
      for (let i = 0; i < stripes; i++) {
        const x0 = -L * 0.12 - i * L * 0.09, x1 = x0 + L * 0.045;
        const band = U.clipPoly(U.clipPoly(hull, 1, 0, x0) || [], -1, 0, -x1);
        if (band) b.poly(band, 'accent', { lvl: 3, h: 0.3 });
      }
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
      let x = lerp(bx0 + L * 0.15, bx1 - L * 0.2, r()), y = lerp(by0, by1, r()) * 0.7;
      const w = L * (0.03 + r() * 0.05);
      let h = W * (0.15 + r() * 0.25);
      if (hc.hull === 'synth') { const q = L * 0.035; x = Math.round(x / q) * q; y = Math.round(y / q) * q; h = w; }
      if (hc.hull === 'bio') {
        // Nodules instead of plates.
        const nr = Math.min(w, h) * 0.5;
        if (!U.inPoly(x, y, hull) || !U.inPoly(x + nr, y, hull) || !U.inPoly(x - nr, y, hull)) continue;
        i++;
        b.circle(x, y, nr, 'hull2', { lvl: 3, h: 0.6, dome: true });
        if (culture.asym < 0.2 && Math.abs(y) > nr * 2) b.circle(x, -y, nr, 'hull2', { lvl: 3, h: 0.6, dome: true });
        continue;
      }
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
      case 'square': return U.rect(x, y, s * 1.2, s * 1.2);
      default: return U.circle(x, y, s * 0.6, 8);
    }
  }

  function freighterCargo(b, c, r, L, W, hull, hullH) {
    switch (c.hull) {
      case 'bio': // egg sacs along both flanks
        for (const s of [1, -1]) {
          let x = -L * 0.4;
          for (let i = 0; i < 5; i++) {
            const rr = W * (0.42 - i * 0.04) * (0.85 + r() * 0.3);
            b.circle(x + rr, s * W * 0.78, rr, i % 2 ? 'trim' : 'wing', { lvl: 1.5 + i * 0.01, h: hullH * 0.7, dome: true });
            x += rr * 1.6;
          }
        }
        break;
      case 'synth': { // identical cubes held clear of the hull
        const n = 5, cs = (L * 0.5) / n;
        for (let i = 0; i < n; i++) {
          for (const s of [1, -1]) {
            const x = -L * 0.34 + (i + 0.5) * cs;
            b.poly(U.rect(x, s * W * 1.1, cs * 0.82, cs * 0.82), 'hull2', { lvl: 1.4, h: hullH * 0.6, bevel: cs * 0.1 });
            b.poly(U.rect(x, s * W * 1.1, cs * 0.25, cs * 0.25), 'glass', { lvl: 1.5, h: hullH * 0.62 });
          }
        }
        break;
      }
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
    const fn = { wheel, lattice, star, hive, monolith }[topo] || wheel;
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

  // Alien: a lumpy core in a cluster of cells, wavy tendrils with glowing buds turning slowly.
  function hive(b, c, r, R, major) {
    const S = { layer: 'spin' };
    b.bp.layers = ['spin', 'fixed'];
    b.bp.spinRate = 0.03;
    const T = (major ? 7 : 5) + Math.floor(r() * 3), a0 = r() * TAU;
    for (let i = 0; i < T; i++) {
      const a = a0 + (i / T) * TAU + (r() - 0.5) * 0.3, len = R * (0.85 + r() * 0.3), ph = r() * TAU, curl = (r() - 0.5) * 1.2;
      const line = Array.from({ length: 10 }, (_, k) => {
        const u = k / 9, aa = a + curl * u * u + Math.sin(u * 5 + ph) * 0.06, d = R * 0.3 + (len - R * 0.3) * u;
        return [Math.cos(aa) * d, Math.sin(aa) * d];
      });
      b.poly(U.strip(line, (u) => R * 0.09 * (1 - u * 0.75)), 'hull2', { ...S, lvl: 0, h: R * 0.05, bevel: R * 0.04, roof: true });
      const [tx, ty] = line[9];
      b.circle(tx, ty, R * 0.05, 'glass', { ...S, lvl: 0.5, h: R * 0.06, dome: true });
      b.light(tx, ty, 2.2, c.pal.light, { layer: 'spin', blink: i * 0.9 });
    }
    const N = major ? 9 : 6;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * TAU + r() * 0.4, d = R * (0.38 + r() * 0.16), s = R * (0.16 + r() * 0.08);
      const x = Math.cos(a) * d, y = Math.sin(a) * d;
      b.poly(U.blob(x, y, s, s * 0.85, r, 0.35, 9, a), i % 3 === 0 ? 'trim' : 'wing', { lvl: 1 + i * 0.01, h: R * 0.12, bevel: R * 0.1, roof: true });
      if (i % 2 === 0) b.circle(x, y, s * 0.3, 'accent', { lvl: 1.5 + i * 0.01, h: R * 0.14, dome: true });
    }
    if (major) {
      for (let i = 0; i < 4; i++) {
        const a = a0 + (i + 0.5) * (TAU / 4), d = R * 0.74;
        b.poly(U.blob(Math.cos(a) * d, Math.sin(a) * d, R * 0.14, R * 0.11, r, 0.3, 9, a), 'trim', { lvl: 1.2, h: R * 0.1, bevel: R * 0.08, roof: true });
      }
    }
    b.poly(U.blob(0, 0, R * 0.34, R * 0.3, r, 0.25, 10), 'hull', { lvl: 3, h: R * 0.18, bevel: R * 0.16, roof: true });
    b.circle(0, 0, R * 0.12, 'glass', { lvl: 4, h: R * 0.2, dome: true });
    b.circle(0, 0, R * 0.05, 'dark', { lvl: 5, h: R * 0.21 });
    b.light(0, 0, 3, c.pal.light, { blink: 0.5 });
  }

  // Android: nested square frames around a diamond core, ringed by identical cubes in orbit.
  function monolith(b, c, r, R, major) {
    const S = { layer: 'spin' };
    b.bp.layers = ['spin', 'fixed'];
    b.bp.spinRate = 0.1;
    const N = major ? 12 : 8, ro = R * 0.98, cs = R * (major ? 0.11 : 0.14);
    b.ring(0, 0, ro, R * 0.012, 'strut', { ...S, lvl: 0, h: R * 0.01 });
    for (let i = 0; i < N; i++) {
      const a = (i / N) * TAU, x = Math.cos(a) * ro, y = Math.sin(a) * ro;
      b.poly(U.rect(x, y, cs, cs, a), 'trim', { ...S, lvl: 1, h: R * 0.08, bevel: cs * 0.15 });
      b.poly(U.rect(x, y, cs * 0.3, cs * 0.3, a), 'glass', { ...S, lvl: 1.2, h: R * 0.085 });
    }
    const frames = major ? [0.72, 0.5] : [0.6];
    frames.forEach((f, k) => {
      const s = R * f * 2, t = R * 0.07, rot = k % 2 ? Math.PI / 4 : 0;
      for (const [dx, dy, w, h] of [[0, -s / 2, s + t, t], [0, s / 2, s + t, t], [-s / 2, 0, t, s - t], [s / 2, 0, t, s - t]]) {
        const p = U.rot([dx, dy], rot);
        b.poly(U.rect(p[0], p[1], w, h, rot), 'hull2', { lvl: 1.5 + k, h: R * 0.1, bevel: t * 0.3 });
      }
      for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        const p = U.rot([(sx * s) / 2, (sy * s) / 2], rot);
        b.light(p[0], p[1], 2.2, c.pal.light, { blink: k + (sx + sy) * 0.3 });
      }
    });
    const core = R * (major ? 0.36 : 0.42);
    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI) / 2;
      b.strut(Math.cos(a) * core * 0.6, Math.sin(a) * core * 0.6, Math.cos(a) * R * frames[0], Math.sin(a) * R * frames[0], R * 0.025, 'accent', { lvl: 1.2, h: R * 0.06, thin: true });
    }
    b.poly(U.rect(0, 0, core, core, Math.PI / 4), 'hull', { lvl: 4, h: R * 0.22, bevel: R * 0.16, roof: true, grid: [3, 3] });
    b.poly(U.rect(0, 0, core * 0.32, core * 0.32, Math.PI / 4), 'glass', { lvl: 5, h: R * 0.24 });
  }

  // ---------- Jump gates and wormholes ----------

  // A jump gate: a glowing aperture with broken rings turning in it, inside a frame built in the
  // culture's language. Pirates bolt each frame segment together from a different donor.
  function gate(culture, seed) {
    const r = mulberry32(hashInt(seed, 6, culture.seed));
    const b = builder('gate', culture, seed);
    const S = { layer: 'spin' };
    b.bp.layers = ['spin', 'fixed'];
    b.bp.spinRate = 0.4;
    b.bp.glow = true;
    const R = 110 * (0.92 + r() * 0.16), Ra = R * 0.52, Rf = R * 0.68, fw = R * 0.16;
    const kind = culture.lineage === 'kitbash' ? 'kitbash' : culture.hull;
    // An open aperture: just a thin field rim turning inside the frame, the centre left empty.
    for (let k = 0, n = 10; k < n; k++) {
      const a = (k / n) * TAU;
      b.poly(U.sector(0, 0, Ra * 0.96, Ra * 0.035, a, a + (TAU / n) * 0.6, 4), k % 2 ? 'accent' : 'glass', { ...S, lvl: -1.5, h: 0.8 });
    }
    if (kind === 'synth') b.ring(0, 0, Rf, R * 0.015, 'strut', { lvl: 0, h: R * 0.01 });
    else b.ring(0, 0, Rf, fw * (kind === 'bio' ? 1 : 0.8), kind === 'bio' ? 'hull' : 'hull2', { lvl: 0, h: R * 0.08 });
    const N = { wedge: 8, block: 8, shard: 10, bio: 9, synth: 12 }[kind] || 8;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * TAU, h = kind === 'kitbash' ? donor(culture, r).hull : kind;
      const dir = [Math.cos(a), Math.sin(a)], nrm = [-dir[1], dir[0]];
      const P = (d, o) => [dir[0] * d + nrm[0] * o, dir[1] * d + nrm[1] * o];
      const seg = (TAU * Rf) / N;
      switch (h) {
        case 'block':
          b.poly(U.rect(...P(Rf, 0), fw * 1.5, seg * 0.62, a), i % 2 ? 'hull' : 'trim', { lvl: 1, h: R * 0.14, bevel: R * 0.03, grid: [2, 1] });
          if (i % 2 === 0) b.poly(U.rect(...P(Rf + fw * 1.35, 0), fw * 0.9, seg * 0.3, a), 'panel', { lvl: 0.5, h: R * 0.02, grid: [3, 1] });
          break;
        case 'shard':
          b.poly([P(Rf - fw * 0.5, -seg * 0.18), P(Rf + R * (i % 2 ? 0.32 : 0.48), 0), P(Rf - fw * 0.5, seg * 0.18), P(Rf - fw * 0.9, 0)], 'hull2', { lvl: 1, h: R * 0.08, bevel: R * 0.08, roof: true });
          b.poly([P(Rf, -seg * 0.05), P(Rf + R * (i % 2 ? 0.25 : 0.4), 0), P(Rf, seg * 0.05)], 'accent', { lvl: 1.5, h: R * 0.09 });
          break;
        case 'bio': {
          const [x, y] = P(Rf, 0);
          b.poly(U.blob(x, y, seg * 0.62, fw * 0.9, r, 0.3, 9, a + Math.PI / 2), i % 3 ? 'wing' : 'trim', { lvl: 1 + i * 0.01, h: R * 0.12, bevel: R * 0.1, roof: true });
          if (i % 3 === 0) {
            const ph = r() * TAU, line = Array.from({ length: 8 }, (_, k) => { const u = k / 7; return P(Rf + fw * 0.6 + R * 0.45 * u, Math.sin(u * 4 + ph) * R * 0.05); });
            b.poly(U.strip(line, (u) => R * 0.06 * (1 - u * 0.75)), 'hull2', { lvl: 0.5, h: R * 0.05, bevel: R * 0.04, roof: true });
            b.circle(...line[7], R * 0.035, 'glass', { lvl: 0.6, h: R * 0.06, dome: true });
            b.light(...line[7], 2.2, culture.pal.light, { blink: i * 0.8 });
          } else b.circle(...P(Rf - fw * 0.55, 0), fw * 0.18, 'glass', { lvl: 1.6, h: R * 0.13, dome: true });
          break;
        }
        case 'synth':
          b.poly(U.rect(...P(Rf, 0), fw, fw, a), 'trim', { lvl: 1, h: R * 0.1, bevel: fw * 0.12 });
          b.poly(U.rect(...P(Rf, 0), fw * 0.3, fw * 0.3, a), 'glass', { lvl: 1.2, h: R * 0.105 });
          break;
        default: // wedge clamps
          b.poly([P(Rf - fw * 0.7, -seg * 0.3), P(Rf + fw * 1.1, -seg * 0.16), P(Rf + fw * 1.1, seg * 0.16), P(Rf - fw * 0.7, seg * 0.3)], 'hull', { lvl: 1, h: R * 0.12, bevel: R * 0.04, roof: true });
          b.poly(U.rect(...P(Rf + fw * 0.6, 0), fw * 0.25, seg * 0.3, a), 'accent', { lvl: 1.5, h: R * 0.13 });
      }
      if (i % 2 === 0 && h !== 'bio') b.light(...P(Rf - fw * 0.6, 0), 2.4, culture.pal.light, { blink: i * 0.7 });
    }
    if (kind === 'wedge') {
      for (const s of [-1, 1]) {
        b.strut(0, s * (Rf + fw * 1.1), 0, s * R * 1.12, R * 0.04, 'strut', { lvl: 0.4, h: R * 0.03, thin: true });
        b.poly(U.rect(0, s * R * 1.25, R * 0.7, R * 0.2), 'panel', { lvl: 0.5, h: R * 0.03, grid: [5, 1] });
      }
    }
    if (kind === 'synth') {
      const s = R * 1.02, t = R * 0.05, rot = Math.PI / 4;
      for (const [dx, dy, w, hh] of [[0, -s, s * 2 + t, t], [0, s, s * 2 + t, t], [-s, 0, t, s * 2 - t], [s, 0, t, s * 2 - t]]) {
        const p = U.rot([dx, dy], rot);
        b.poly(U.rect(p[0], p[1], w, hh, rot), 'hull2', { lvl: 0.8, h: R * 0.08, bevel: t * 0.3 });
      }
    }
    if (kind === 'kitbash') addPatches(b, culture, r, U.circle(0, 0, Rf + fw, 12), R * 0.1, 4);
    if (kind !== 'bio' && kind !== 'synth') navLights(b, R * 0.95, 0);
    b.bp.label = `Jump gate · ${kind === 'bio' ? 'alien' : kind === 'synth' ? 'android' : kind}`;
    return finish(b.bp);
  }

  // A wormhole: the natural counterpart of a gate. A small dark core with a faint ragged rim, inside
  // broken, uneven shells of dim gas, as if light were bent around it. No culture.
  const NATURAL = {
    seed: 0, lineage: 'natural', label: 'Natural',
    pal: { hull: '#140c22', hull2: '#22163a', trim: '#6e5aa8', glass: '#cfc2f2', accent: '#3e2c6e', light: '#d8ccff', flame: '#8e78d0', panel: '#1c1430', line: '#a894e0', wing: '#2c1e4c', engine: '#05030a', strut: '#22163a' },
  };
  // A gas pocket (world/solar-system.js): a knot of dense gas in a nebula, to collect. Soft lobes of gas
  // in the nebula's colour around a bright core, with a few wisps curling round it, turning slowly.
  // color: the nebula's line colour; r: its size in world units. No culture: it's natural, tinted
  // per colour (the palette's seed keeps the sprites of different colours apart).
  function gasCulture(color) {
    const c = color, dark = U.mix('#05060a', c, 0.35);
    return {
      seed: parseInt(c.slice(1), 16), lineage: 'natural', label: 'Gas',
      pal: { hull: U.mix('#05060a', c, 0.45), hull2: dark, trim: U.mix(c, '#ffffff', 0.25), glass: U.mix(c, '#ffffff', 0.7), accent: c, light: U.mix(c, '#ffffff', 0.5), flame: c, panel: dark, line: c, wing: U.mix('#05060a', c, 0.6), engine: '#05060a', strut: dark },
    };
  }
  function gasPocket(color, seed, size = 80) {
    const r = mulberry32(hashInt(seed, 8, 88));
    const b = builder('gas-pocket', gasCulture(color), `${seed}:${size}`);
    const S = { layer: 'spin' };
    b.bp.layers = ['spin', 'fixed'];
    b.bp.spinRate = (r() < 0.5 ? -1 : 1) * (0.08 + r() * 0.08);
    b.bp.glow = true;
    const R = size;
    // Lobes: overlapping soft blobs, darker and larger outside, brighter toward the middle.
    for (let i = 0, n = 5 + Math.floor(r() * 3); i < n; i++) {
      const a = (i / n) * TAU + r() * 0.6, d = R * (0.3 + r() * 0.25), s = R * (0.32 + r() * 0.16);
      b.poly(U.blob(Math.cos(a) * d, Math.sin(a) * d, s, s * (0.75 + r() * 0.25), r, 0.45, 8, a), i % 2 ? 'hull' : 'wing', { ...S, lvl: 0 + i * 0.01, h: R * 0.04, bevel: R * 0.05, roof: true });
    }
    b.poly(U.blob(0, 0, R * 0.42, R * 0.36, r, 0.35, 9), 'accent', { ...S, lvl: 1, h: R * 0.1, bevel: R * 0.08, roof: true });
    b.circle(0, 0, R * 0.16, 'glass', { lvl: 2, h: R * 0.16, dome: true });
    // Wisps: thin curls of gas round the edge.
    for (let i = 0, n = 2 + Math.floor(r() * 2); i < n; i++) {
      const a0 = r() * TAU, rad = R * (0.75 + r() * 0.2), len = 0.9 + r() * 0.8, pts = [];
      for (let k = 0; k <= 12; k++) { const a = a0 + (k / 12) * len; const d = rad * (1 - (k / 12) * 0.25); pts.push([Math.cos(a) * d, Math.sin(a) * d]); }
      b.poly(U.strip(pts, (u) => R * 0.07 * Math.sin(Math.PI * Math.min(1, Math.max(0.1, u)))), 'trim', { ...S, lvl: 0.5, h: R * 0.02 });
    }
    b.light(0, 0, R * 0.08, gasCulture(color).pal.light, { blink: 2.4 });
    b.bp.label = 'Gas pocket';
    return finish(b.bp);
  }

  function wormhole(seed) {
    const r = mulberry32(hashInt(seed, 7, 77));
    const b = builder('wormhole', NATURAL, seed);
    const S = { layer: 'spin' };
    b.bp.layers = ['spin', 'fixed'];
    b.bp.spinRate = 0.06;
    b.bp.glow = true;
    const R = 120 * (0.9 + r() * 0.2);
    // A wobbly closed loop, then a random stretch of it as an arc of gas.
    const arc = (rad, wob, from, len, w, mat, lvl, o = {}) => {
      const ph = [r() * TAU, r() * TAU], n = 48, pts = [];
      for (let k = 0; k <= Math.round(n * len); k++) {
        const a = from + (k / n) * TAU;
        const d = rad * (1 + wob * (Math.sin(a * 2 + ph[0]) * 0.6 + Math.sin(a * 3 + ph[1]) * 0.4));
        pts.push([Math.cos(a) * d, Math.sin(a) * d]);
      }
      if (pts.length > 2) b.poly(U.strip(pts, (u) => w * Math.sin(Math.PI * Math.min(1, Math.max(0.08, u)))), mat, { ...S, lvl, h: R * 0.01, ...o });
    };
    const shells = 5 + Math.floor(r() * 3);
    for (let i = 0; i < shells; i++) {
      const u = i / (shells - 1), rad = R * (0.32 + u * 0.66) * (0.95 + r() * 0.1);
      for (let k = 0, n = 1 + Math.floor(r() * 3); k < n; k++) {
        const mat = u < 0.3 && r() < 0.5 ? 'trim' : r() < 0.5 ? 'wing' : 'hull2';
        arc(rad, 0.06 + r() * 0.06, r() * TAU, 0.2 + r() * 0.5, R * (0.025 + (1 - u) * 0.04) * (0.6 + r() * 0.6), mat, i * 0.01, { line: mat === 'trim' || r() < 0.3 });
      }
    }
    for (let i = 0; i < 5; i++) {
      const a = r() * TAU, d = R * (0.4 + r() * 0.5), s = R * 0.008 * (0.6 + r());
      b.circle(Math.cos(a) * d, Math.sin(a) * d, s, r() < 0.6 ? 'trim' : 'glass', { ...S, lvl: 1, h: R * 0.01, line: false });
    }
    arc(R * 0.24, 0.05, r() * TAU, 0.7 + r() * 0.25, R * 0.022, 'glass', 2, { layer: 'fixed' });
    arc(R * 0.25, 0.08, r() * TAU, 0.4, R * 0.04, 'trim', 1.9, { layer: 'fixed', line: false });
    b.poly(U.blob(0, 0, R * 0.22, R * 0.21, r, 0.12, 12), 'engine', { lvl: 3, h: R * 0.01 });
    b.bp.label = `Wormhole · ${shells} shells`;
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

  // ---------- Entry points ----------

  const TYPES = ['fighter', 'freighter', 'station-minor', 'station-major', 'gate', 'wreck-ship', 'wreck-station', 'wormhole'];

  function create(type, culture, seed = 1) {
    const s = seed >>> 0;
    switch (type) {
      case 'fighter': return ship(culture, s, 'fighter');
      case 'freighter': return ship(culture, s, 'freighter');
      case 'station-minor': return station(culture, s, 'minor');
      case 'station-major': return station(culture, s, 'major');
      case 'gate': return gate(culture, s);
      case 'wormhole': return wormhole(s); // culture is ignored
      case 'wreck-ship': return wreck(ship(culture, s, mulberry32(s)() < 0.5 ? 'fighter' : 'freighter'), s);
      case 'wreck-station': return wreck(station(culture, s, mulberry32(s + 1)() < 0.6 ? 'minor' : 'major'), s);
      default: throw new Error(`Unknown asset type: ${type}`);
    }
  }

  return { TYPES, create, wreck, playerShip, SHIP_HULL, builder, finish, NATURAL, gasPocket };
})();

if (typeof module !== 'undefined') module.exports = ArtBlueprints;
