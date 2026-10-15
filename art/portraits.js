'use strict';

// Portrait renderer: draws a seeded head-and-shoulders bust built from domed parts plus flat
// feature marks in all four styles, so silhouettes match across styles. Light is the shared world
// light (up-left, art/render.js). Units: the bust fills a 100×100 frame centred on 0,0, y down.
// Busts come from art/androids.js (ArtAndroids.create); `kit` holds the part builders it uses.
//
//   ArtPortraits.draw(ctx, portrait, style, { texel })   the frame centred on the current origin,
//                                                        in world units (scale the ctx so 100
//                                                        units = your tile size)
//   ArtPortraits.kit: { part, ell, stroke, mulberry }    for bust generators
// Browser only (global `ArtPortraits`). Load after art/render.js.

const ArtPortraits = (() => {
  const U = ArtUtil;
  const { TAU, clamp, lerp } = U;
  const { LIGHT, BAYER, norm, dot, sub, cross } = Art.kit;
  const L2 = [LIGHT[0], LIGHT[1]].map((v) => v / Math.hypot(LIGHT[0], LIGHT[1]));
  const RAYS = 96, HALF = 50;
  const conf = () => Art.config;
  const dprOf = Art.kit.dprOf;
  const mulberry = mulberry32; // rng.js

  // A domed part: superellipse (with jaw taper) optionally cut by `keep`, outlined by RAYS rays
  // from the anchor (ox, oy). Height is a dome over that outline; normals come from its gradient.
  function part(mat, o) {
    const p = { kind: 'part', mat, cx: o.cx, cy: o.cy, rx: o.rx, ry: o.ry, n: o.n ?? 2, taper: o.taper ?? 1, prof: o.prof ?? 2, lineArc: o.lineArc };
    p.depth = o.depth ?? Math.min(o.rx, o.ry) * 0.8;
    const ox = (p.ox = o.ox ?? o.cx), oy = (p.oy = o.oy ?? o.cy);
    const inside = (x, y) => {
      const dx = x - p.cx, dy = y - p.cy, rx = p.rx * lerp(1, p.taper, clamp(dy / p.ry, 0, 1));
      if (Math.abs(dx / rx) ** p.n + Math.abs(dy / p.ry) ** p.n > 1) return false;
      return !o.keep || o.keep(x, y);
    };
    const maxR = Math.hypot(Math.abs(ox - p.cx) + p.rx, Math.abs(oy - p.cy) + p.ry) * 1.05, steps = 48;
    const R = new Float32Array(RAYS);
    for (let i = 0; i < RAYS; i++) {
      const t = (i / RAYS) * TAU, dx = Math.cos(t), dy = Math.sin(t);
      let lo = 0;
      for (let s = 1; s <= steps; s++) { const r = (maxR * s) / steps; if (inside(ox + dx * r, oy + dy * r)) lo = r; }
      let hi = lo + maxR / steps;
      for (let k = 0; k < 12; k++) { const m = (lo + hi) / 2; if (inside(ox + dx * m, oy + dy * m)) lo = m; else hi = m; }
      R[i] = lo;
    }
    p.Rang = (t) => { let a = (t / TAU) * RAYS; a = ((a % RAYS) + RAYS) % RAYS; const i = Math.floor(a); return lerp(R[i], R[(i + 1) % RAYS], a - i); };
    p.pts = Array.from(R, (r, i) => [ox + Math.cos((i / RAYS) * TAU) * r, oy + Math.sin((i / RAYS) * TAU) * r]);
    p.q = (x, y) => Math.hypot(x - ox, y - oy) / (p.Rang(Math.atan2(y - oy, x - ox)) || 1e-6);
    p.h = (x, y) => p.depth * Math.sqrt(1 - Math.min(p.q(x, y), 0.995) ** p.prof);
    p.normal = (x, y) => {
      const e = 0.35;
      return norm([-(p.h(x + e, y) - p.h(x - e, y)) / (2 * e), -(p.h(x, y + e) - p.h(x, y - e)) / (2 * e), 1]);
    };
    return p;
  }
  // Marks: flat features painted over the parts beneath them. `line`: how Line style draws it
  // ('stroke' | 'fill' | 'skip'); `px: false` hides it in Pixel style; `glow` for lit gear.
  const ell = (mat, cx, cy, rx, ry, o = {}) => ({ kind: 'ell', mat, cx, cy, rx, ry, line: 'stroke', ...o });
  const stroke = (mat, pts, w, o = {}) => ({ kind: 'line', mat, pts, w, line: 'stroke', ...o });

  // ---------- Helpers ----------

  const pathOf = (pts, dx = 0, dy = 0) => { const p = new Path2D(); pts.forEach(([x, y], i) => (i ? p.lineTo(x + dx, y + dy) : p.moveTo(x + dx, y + dy))); p.closePath(); return p; };
  const ellPath = (m, sides) => {
    const p = new Path2D();
    if (!sides) { p.ellipse(m.cx, m.cy, m.rx, m.ry, 0, 0, TAU); return p; }
    for (let i = 0; i < sides; i++) { const t = (i / sides) * TAU + 0.3; p[i ? 'lineTo' : 'moveTo'](m.cx + Math.cos(t) * m.rx, m.cy + Math.sin(t) * m.ry); }
    p.closePath();
    return p;
  };
  const linePath = (m) => { const p = new Path2D(); m.pts.forEach(([x, y], i) => (i ? p.lineTo(x, y) : p.moveTo(x, y))); return p; };
  function hitMark(m, x, y, minR) {
    if (m.kind === 'ell') { const rx = Math.max(m.rx, minR), ry = Math.max(m.ry, minR); return ((x - m.cx) / rx) ** 2 + ((y - m.cy) / ry) ** 2 <= 1; }
    const w = Math.max(m.w / 2, minR);
    for (let i = 1; i < m.pts.length; i++) if (U.distSeg(x, y, ...m.pts[i - 1], ...m.pts[i]) <= w) return true;
    return false;
  }

  // ---------- Line ----------

  function drawLine(ctx, P, k) {
    const C = conf(), dpr = dprOf(), lw = Math.max(1, Math.min(2 * k, 2.6 * dpr)) / k, blur = Math.min(8 * dpr, 5 * k);
    ctx.lineJoin = ctx.lineCap = 'round';
    for (const it of P.items) {
      if (it.line === 'skip') continue;
      const col = it.glow ? P.pal.glow : P.pal.line;
      ctx.strokeStyle = col;
      ctx.shadowColor = col;
      ctx.shadowBlur = 0;
      ctx.lineWidth = lw;
      if (it.kind === 'part') {
        if (it.lineArc) {
          const a = Math.floor(it.lineArc[0] * RAYS), b = Math.ceil(it.lineArc[1] * RAYS);
          ctx.beginPath();
          for (let i = a; i <= b; i++) { const [x, y] = it.pts[i % RAYS]; i === a ? ctx.moveTo(x, y) : ctx.lineTo(x, y); }
          ctx.lineWidth = lw * 0.8;
          ctx.stroke();
          continue;
        }
        const path = pathOf(it.pts);
        ctx.fillStyle = C.bg;
        ctx.fill(path);
        ctx.stroke(path);
      } else if (it.kind === 'ell') {
        const path = ellPath(it);
        if (it.glow) ctx.shadowBlur = blur;
        if (it.line === 'fill') { ctx.fillStyle = col; ctx.fill(path); } else { ctx.fillStyle = C.bg; ctx.fill(path); ctx.stroke(path); }
      } else {
        if (it.glow) ctx.shadowBlur = blur;
        ctx.lineWidth = clamp(it.w * 0.6, lw, lw * 2.2);
        ctx.stroke(linePath(it));
      }
    }
    ctx.shadowBlur = 0;
  }

  // ---------- Flat ----------

  function drawFlat(ctx, P) {
    const big = new Path2D();
    big.rect(-HALF * 2, -HALF * 2, HALF * 4, HALF * 4);
    ctx.lineJoin = ctx.lineCap = 'round';
    for (const it of P.items) {
      const base = P.pal[it.mat];
      if (it.kind === 'part') {
        const path = pathOf(it.pts);
        ctx.fillStyle = base;
        ctx.fill(path);
        const s = clamp(Math.min(it.rx, it.ry) * 0.14, 0.6, 3.2);
        ctx.save();
        ctx.clip(path);
        for (const [d, col] of [[s, U.shade(base, 0.7)], [-s * 0.5, U.mix(base, '#ffffff', 0.22)]]) {
          const rim = new Path2D(big);
          rim.addPath(pathOf(it.pts, L2[0] * d, L2[1] * d));
          ctx.fillStyle = col;
          ctx.fill(rim, 'evenodd');
        }
        ctx.restore();
      } else if (it.kind === 'ell') {
        ctx.fillStyle = base;
        ctx.fill(ellPath(it));
      } else {
        ctx.strokeStyle = base;
        ctx.lineWidth = it.w;
        ctx.stroke(linePath(it));
      }
    }
  }

  // ---------- Low-poly ----------

  function lowTris(it, seed) {
    const rnd = mulberry(seed), rings = [0.45, 0.75, 0.92, 1];
    const per = it.pts.reduce((a, p, i) => a + Math.hypot(p[0] - it.pts[(i + 1) % RAYS][0], p[1] - it.pts[(i + 1) % RAYS][1]), 0);
    const seg = clamp(Math.round(per / 6.5), 8, 22);
    const V = (x, y) => [x, y, it.h(x, y)];
    const ringPts = rings.map((f, ri) => Array.from({ length: seg }, (_, j) => {
      const t = ((j + (ri % 2) * 0.5 + (f < 1 ? (rnd() - 0.5) * 0.35 : 0)) / seg) * TAU;
      const rr = it.Rang(t) * (f < 1 ? f * (1 + (rnd() - 0.5) * 0.08) : 0.999);
      return V(it.ox + Math.cos(t) * rr, it.oy + Math.sin(t) * rr);
    }));
    const c = V(it.ox, it.oy), tris = [];
    for (let j = 0; j < seg; j++) tris.push([c, ringPts[0][j], ringPts[0][(j + 1) % seg]]);
    for (let i = 0; i < rings.length - 1; i++) {
      const A = ringPts[i], B = ringPts[i + 1], off = i % 2 === 0;
      for (let j = 0; j < seg; j++) {
        const j1 = (j + 1) % seg;
        if (off) { tris.push([A[j], B[j], A[j1]]); tris.push([A[j1], B[j], B[j1]]); }
        else { tris.push([A[j], B[j], B[j1]]); tris.push([A[j], B[j1], A[j1]]); }
      }
    }
    return tris;
  }

  function drawLow(ctx, P, k) {
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    let n = 0;
    for (const it of P.items) {
      const base = P.pal[it.mat];
      n++;
      if (it.kind === 'part') {
        ctx.lineWidth = 0.6 / k;
        for (const [a, b, c] of lowTris(it, P.seed * 31 + n)) {
          let nn = norm(cross(sub(b, a), sub(c, a)));
          if (nn[2] < 0) nn = nn.map((v) => -v);
          const jit = 0.95 + 0.1 * (((Math.sin((a[0] + b[1] + c[0]) * 12.9898 + P.seed * 78.233) * 43758.5453) % 1 + 1) % 1);
          const col = U.shade(base, (0.24 + 0.95 * Math.max(0, dot(nn, LIGHT))) * jit);
          ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.lineTo(c[0], c[1]); ctx.closePath();
          ctx.fillStyle = ctx.strokeStyle = col;
          ctx.fill(); ctx.stroke();
        }
      } else if (it.kind === 'ell') {
        ctx.fillStyle = U.shade(base, 0.92);
        ctx.fill(ellPath(it, it.rx < 1.5 ? 5 : 7));
      } else {
        ctx.lineJoin = 'bevel';
        ctx.lineCap = 'butt';
        ctx.strokeStyle = U.shade(base, 0.92);
        ctx.lineWidth = it.w;
        ctx.stroke(linePath(it));
        ctx.lineJoin = ctx.lineCap = 'round';
      }
    }
  }

  // ---------- Pixel ----------

  const rampOf = Art.kit.ramp;
  const SHINY = { metal: 1, glass: 1, accent: 1, eye: 1, shell: 1, visor: 1, lamp: 1 };

  function pixel(P, texel) {
    const N = Math.ceil((HALF * 2) / texel);
    let items = P.items;
    const cv = Art.kit.canvas(N, N);
    const ctx = cv.getContext('2d'), img = ctx.createImageData(N, N), D = img.data;
    const ramps = {}, R = (m) => ramps[m] || (ramps[m] = rampOf(P.pal[m]));
    // Snap feature ellipses to texel centres so mirrored eyes rasterise identically.
    const snap = (v) => (Math.round((v + HALF) / texel - 0.5) + 0.5) * texel - HALF;
    items = items.map((it) => (it.kind === 'ell' ? { ...it, cx: snap(it.cx), cy: snap(it.cy) } : it));
    const owner = new Int16Array(N * N).fill(-1), marked = new Uint8Array(N * N);
    const set = (i, c) => { D[i * 4] = c[0]; D[i * 4 + 1] = c[1]; D[i * 4 + 2] = c[2]; D[i * 4 + 3] = 255; };
    for (let py = 0; py < N; py++) for (let px = 0; px < N; px++) {
      const x = -HALF + (px + 0.5) * texel, y = -HALF + (py + 0.5) * texel, i = py * N + px;
      let mk = null, pi = -1;
      for (let j = items.length - 1; j >= 0; j--) {
        const it = items[j];
        if (it.kind === 'part') { if (it.q(x, y) <= 1) { pi = j; break; } }
        else if (!mk && it.px !== false && hitMark(it, x, y, texel * 0.55)) mk = it;
      }
      if (pi < 0) continue;
      const pt = items[pi], lit = dot(pt.normal(x, y), LIGHT), bay = BAYER[py & 3][px & 3];
      let lv = clamp(Math.floor(lit * 3.2 + 0.4 + (bay - 0.5) * 0.3), 0, 3);
      if (mk) {
        marked[i] = 1;
        set(i, R(mk.pxMat || mk.mat)[mk.glow ? 3 : lv >= 2 ? 2 : 1]);
        continue;
      }
      if (lv === 3 && !SHINY[pt.mat] && lit < 0.93) lv = 2;
      owner[i] = pi;
      set(i, R(pt.mat)[lv]);
    }
    // Inner outlines: the edge of a part over a different material behind it takes its darkest shade.
    const inner = [];
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const i = y * N + x, o = owner[i];
      if (o < 0 || marked[i]) continue;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const X = x + dx, Y = y + dy;
        if (X < 0 || Y < 0 || X >= N || Y >= N) continue;
        const q = owner[Y * N + X];
        if (q >= 0 && q < o && items[q].mat !== items[o].mat) { inner.push([i, R(items[o].mat)[0]]); break; }
      }
    }
    for (const [i, c] of inner) set(i, c);
    const out = U.hexToRgb(conf().outline), has = (x, y) => x >= 0 && y >= 0 && x < N && y < N && D[(y * N + x) * 4 + 3] > 0, rim = [];
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (!has(x, y) && (has(x + 1, y) || has(x - 1, y) || has(x, y + 1) || has(x, y - 1))) rim.push(y * N + x);
    for (const i of rim) set(i, out);
    ctx.putImageData(img, 0, 0);
    return { canvas: cv, size: N * texel };
  }

  function draw(ctx, P, style, o = {}) {
    const texel = o.texel || 2, m = ctx.getTransform(), k = Math.hypot(m.a, m.b);
    ctx.save();
    ctx.beginPath();
    ctx.rect(-HALF, -HALF, HALF * 2, HALF * 2);
    ctx.clip();
    if (style === 'pixel') {
      P._px = P._px || {};
      const spr = P._px[texel] || (P._px[texel] = pixel(P, texel));
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(spr.canvas, -HALF, -HALF, spr.size, spr.size);
    } else if (style === 'line') drawLine(ctx, P, k);
    else if (style === 'flat') drawFlat(ctx, P);
    else drawLow(ctx, P, k);
    ctx.restore();
  }

  return { draw, kit: { part, ell, stroke, mulberry } };
})();
