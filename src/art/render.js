'use strict';

// Draws art/blueprints.js blueprints, planets, stars and asteroids in four styles:
//   line    – the game's original neon line art on the dark background,
//   pixel   – rasterised on a coarse texel grid with Bayer-dithered bevel shading and outlines,
//   flat    – solid fills with one flat rim shadow and highlight per part,
//   lowpoly – parts extruded into faceted meshes with flat per-triangle lighting.
// What each style does is one entry in STYLE_IMPL (near the end), so the public draw functions
// have no per-style branches and a new style is a new entry.
// Static geometry is rendered once into cached sprites (per rotation bucket where lighting
// depends on the angle); engine flames and blinking lights are drawn live on top. Sprites live in
// two caches bounded by memory (art/sprite-cache.js), with a build budget per frame: the flight
// view calls Art.beginFrame() every frame, and while the frame's budget is spent an object keeps
// its last sprite (another rotation, scale or art style) until a later frame builds the new one.
// Browser only (global `Art`).

const Art = (() => {
  const U = ArtUtil;
  const { TAU, clamp, lerp } = U;

  // Mobile browsers kill tabs that hold too much canvas memory (around 64 MB on some), so on touch
  // screens the caches below keep about a third: 12M px, about 48 MB in all. Sprites there are
  // drawn at a lower pixel ratio too (core/display.js), so the same scene needs about half the pixels.
  const MEM = typeof Display !== 'undefined' && Display.touch() ? 0.35 : 1;
  const config = {
    texel: 2, // world units per pixel-art texel
    tilt: 0.62, // low-poly camera tilt (radians from straight down)
    buckets: 64, // rotation buckets for angle-dependent sprites
    bigBuckets: 16, // ... for sprites larger than bigSprite device px
    bigSprite: 256,
    maxSprite: 768, // device px cap for vector sprites
    // Sprite cache limits: pixels (4 bytes each) and count, for ships, stations, gates, planets and
    // stars; asteroids have their own cache, so a busy field doesn't push the rest out.
    maxPixels: 12e6 * MEM, // about 48 MB (desktop)
    maxSprites: 2000,
    maxAsteroidPixels: 16e6 * MEM, // about 64 MB (desktop)
    maxAsteroidSprites: 3000,
    buildBudgetMs: 4, // sprite building per frame before objects make do with their last sprite
    maxBodyPixels: 6e6 * MEM, // moon sprites and nebula tiles (art/bodies.js), about 24 MB (desktop)
    maxBodySprites: 1500,
    bg: '#05060a',
    outline: '#0e1016',
  };
  const norm = (v) => { const l = Math.hypot(...v) || 1; return v.map((a) => a / l); };
  const LIGHT = norm([-0.45, -0.6, 0.66]); // world space: up-left, toward the viewer
  const BAYER = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]].map((r) => r.map((v) => v / 16));
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

  // ---------- Sprite caches ----------

  // Limits are read live from config, so they can be tuned at run time.
  const budget = SpriteCache.budget({ get ms() { return config.buildBudgetMs; } });
  const sprites = SpriteCache.create({ budget, get maxPixels() { return config.maxPixels; }, get maxEntries() { return config.maxSprites; } });
  const asteroidSprites = SpriteCache.create({ budget, get maxPixels() { return config.maxAsteroidPixels; }, get maxEntries() { return config.maxAsteroidSprites; } });
  // A sprite from a cache, remembering it as the object's last one (o[slot] holds its key) so it can
  // stand in while a new one waits for the build budget. Every sprite records its art style.
  // force: build it now, whatever the frame's budget; keep: false builds it now without caching it.
  function cachedFor(cache, o, slot, key, style, make, force, keep = true) {
    if (!keep) return Object.assign(make(), { style, key });
    const spr = cache.get(key, () => Object.assign(make(), { style }), { fallback: o[slot], force });
    if (spr.key === key) o[slot] = key;
    return spr;
  }
  function canvas(w, h) {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.ceil(w));
    c.height = Math.max(1, Math.ceil(h));
    return c;
  }
  // A stable id for a planet, star or asteroid body, from the fields it is drawn from (underscored
  // fields are caches), so a scene rebuilt from its seed finds its sprites again. Blueprints get
  // theirs from art/blueprints.js.
  const idOf = (o) => o._artId || (o._artId = JSON.stringify(o, (k, v) => (k[0] === '_' ? undefined : v)));
  const quant = (ppu) => 2 ** (Math.round(Math.log2(ppu) * 4) / 4);
  const dprOf = () => (typeof Display !== 'undefined' ? Display.dpr() : 1); // core/display.js

  // ---------- Palette ----------

  function palette(bp) {
    if (bp._pal) return bp._pal;
    const p = { ...bp.culture.pal };
    p.wing = p.wing || U.mix(p.hull, p.hull2, 0.3);
    p.engine = p.engine || '#3a414c';
    p.strut = p.strut || U.mix(p.hull2, '#555b66', 0.4);
    p.dark = '#1c2028';
    p.scorch = '#120e0b';
    p.line = bp.line || p.line;
    if (bp.wrecked) {
      for (const k of Object.keys(p)) if (k !== 'scorch' && k !== 'line') p[k] = wreckColor(p[k]);
      p.glass = '#1f2630';
      p.line = U.mix(U.desaturate(p.line, 0.6), config.bg, 0.4);
    }
    bp._pal = p;
    return p;
  }
  const wreckColor = (c) => U.shade(U.desaturate(c, 0.6), 0.62);
  function colorOf(bp, mat) {
    if (mat[0] === '#') return bp.wrecked ? wreckColor(mat) : mat;
    return palette(bp)[mat] || '#ff00ff';
  }
  const layerParts = (bp, layer) => bp.parts.filter((p) => p.layer === layer).sort((a, b) => a.lvl - b.lvl);

  // Panel grids become detail lines (on the 4 corners of a rect part).
  function detailLines(p) {
    const out = p.lines ? p.lines.slice() : [];
    if (p.grid && p.shape === 'poly' && p.pts.length === 4) {
      const [p0, p1, p2, p3] = p.pts, [nx, ny] = p.grid;
      const L = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t)];
      for (let i = 1; i < nx; i++) out.push([...L(p0, p1, i / nx), ...L(p3, p2, i / nx)]);
      for (let j = 1; j < ny; j++) out.push([...L(p0, p3, j / ny), ...L(p1, p2, j / ny)]);
    }
    return out;
  }

  function partPath(p, dx = 0, dy = 0) {
    const path = new Path2D();
    if (p.shape === 'circle') {
      path.arc(p.cx + dx, p.cy + dy, p.r, 0, TAU);
    } else if (p.shape === 'ring') {
      path.arc(p.cx + dx, p.cy + dy, p.r + p.w / 2, 0, TAU);
      path.moveTo(p.cx + dx + p.r - p.w / 2, p.cy + dy);
      path.arc(p.cx + dx, p.cy + dy, p.r - p.w / 2, 0, TAU);
    } else {
      p.pts.forEach(([x, y], i) => (i ? path.lineTo(x + dx, y + dy) : path.moveTo(x + dx, y + dy)));
      path.closePath();
    }
    return path;
  }
  const partSize = (p) => (p.shape === 'ring' ? p.w : p.shape === 'circle' ? p.r * 2 : Math.sqrt(Math.abs(U.area(p.pts))));

  // ---------- Line style ----------

  function renderLine(bp, layer, ang, ppu, half) {
    const S = Math.min(Math.ceil(half * 2 * ppu), config.maxSprite * 2);
    const k = S / (half * 2);
    const cv = canvas(S, S);
    const ctx = cv.getContext('2d');
    const pal = palette(bp);
    const dpr = dprOf();
    const lw = Math.max(1, Math.min(2 * k, 2.6 * dpr)) / k;
    ctx.setTransform(k, 0, 0, k, S / 2, S / 2);
    ctx.rotate(ang);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    for (const p of layerParts(bp, layer)) {
      if (p.line === false || p.overlay) continue;
      ctx.strokeStyle = pal.line;
      if (p.thin) {
        ctx.lineWidth = lw;
        ctx.beginPath();
        ctx.moveTo(p.thin[0], p.thin[1]);
        ctx.lineTo(p.thin[2], p.thin[3]);
        ctx.stroke();
        continue;
      }
      const path = partPath(p);
      const rule = p.shape === 'ring' ? 'evenodd' : 'nonzero';
      ctx.fillStyle = config.bg;
      ctx.fill(path, rule);
      if (p.mat === 'accent') {
        ctx.fillStyle = U.rgba(pal.line, 0.3);
        ctx.fill(path, rule);
      }
      const glow = bp.glow && !bp.wrecked && (p.mat === 'hull' || p.mat === 'wing');
      ctx.shadowColor = pal.line;
      ctx.shadowBlur = glow ? Math.min(10 * dpr, 6 * k) : 0;
      ctx.lineWidth = lw * (p.lineWidth || (p.mat === 'glass' || p.mat === 'accent' ? 0.75 : 1));
      ctx.stroke(path);
      ctx.shadowBlur = 0;
      const lines = detailLines(p);
      if (lines.length) {
        ctx.lineWidth = lw * 0.7;
        ctx.beginPath();
        for (const l of lines) { ctx.moveTo(l[0], l[1]); ctx.lineTo(l[2], l[3]); }
        ctx.stroke();
      }
    }
    return { canvas: cv, half, smooth: true };
  }

  // ---------- Flat style ----------

  function renderFlat(bp, layer, ang, ppu, half) {
    const S = Math.min(Math.ceil(half * 2 * ppu), config.maxSprite);
    const k = S / (half * 2);
    const cv = canvas(S, S);
    const ctx = cv.getContext('2d');
    ctx.setTransform(k, 0, 0, k, S / 2, S / 2);
    ctx.rotate(ang);
    const [lx, ly] = U.rot([LIGHT[0], LIGHT[1]], -ang).map((v) => v / Math.hypot(LIGHT[0], LIGHT[1]));
    const big = new Path2D();
    big.rect(-half * 2, -half * 2, half * 4, half * 4);
    for (const p of layerParts(bp, layer)) {
      const path = partPath(p);
      const rule = p.shape === 'ring' ? 'evenodd' : 'nonzero';
      if (p.overlay) {
        ctx.globalCompositeOperation = 'source-atop';
        ctx.fillStyle = U.rgba(colorOf(bp, p.mat), 0.6);
        ctx.fill(path);
        ctx.globalCompositeOperation = 'source-over';
        continue;
      }
      const base = colorOf(bp, p.mat);
      ctx.fillStyle = base;
      ctx.fill(path, rule);
      // One flat rim shadow away from the light, a thinner highlight toward it.
      const s = clamp(partSize(p) * 0.16, 0.6, bp.bodyRadius * 0.05);
      ctx.save();
      ctx.clip(path, rule);
      for (const [d, col] of [[s, U.shade(base, 0.7)], [-s * 0.5, U.mix(base, '#ffffff', 0.22)]]) {
        const rim = new Path2D(big);
        rim.addPath(partPath(p, lx * d, ly * d));
        ctx.fillStyle = col;
        ctx.fill(rim, 'evenodd');
      }
      if (p.dome || p.mat === 'glass') {
        const [cx, cy] = p.shape === 'poly' ? U.centroid(p.pts) : [p.cx, p.cy];
        const r = partSize(p) * 0.16;
        ctx.fillStyle = U.rgba('#ffffff', bp.wrecked ? 0.08 : 0.35);
        ctx.beginPath();
        ctx.arc(cx + lx * r * 1.6, cy + ly * r * 1.6, r, 0, TAU);
        ctx.fill();
      }
      ctx.restore();
      const lines = detailLines(p);
      if (lines.length) {
        ctx.strokeStyle = p.grid ? U.mix(base, '#ffffff', 0.35) : U.shade(base, 0.62);
        ctx.lineWidth = Math.max(1 / k, Math.min(0.8, partSize(p) * 0.05));
        ctx.beginPath();
        for (const l of lines) { ctx.moveTo(l[0], l[1]); ctx.lineTo(l[2], l[3]); }
        ctx.stroke();
      }
    }
    return { canvas: cv, half, smooth: true };
  }

  // ---------- Pixel style ----------

  function pxBuffer(N) {
    const cv = canvas(N, N);
    const ctx = cv.getContext('2d');
    const img = ctx.createImageData(N, N);
    return {
      cv, ctx, img, N,
      set(x, y, c) {
        if (x < 0 || y < 0 || x >= N || y >= N) return;
        const i = (y * N + x) * 4;
        img.data[i] = c[0]; img.data[i + 1] = c[1]; img.data[i + 2] = c[2]; img.data[i + 3] = 255;
      },
      get(x, y) { const i = (y * N + x) * 4; return [img.data[i], img.data[i + 1], img.data[i + 2]]; },
      has(x, y) { return x >= 0 && y >= 0 && x < N && y < N && img.data[(y * N + x) * 4 + 3] > 0; },
      done() { ctx.putImageData(img, 0, 0); return cv; },
    };
  }
  const ramp = (hex) => [U.shade(hex, 0.5), U.shade(hex, 0.75), hex, U.mix(hex, '#ffffff', 0.3)].map(U.hexToRgb);
  const level = (lit, bay) => clamp(Math.floor(lit * 3 + 0.5 + (bay - 0.5) * 0.6), 0, 3);

  // Screen-space geometry of a part for rasterising.
  function screenGeo(p, ang) {
    if (p.shape === 'poly') {
      const pts = p.pts.map((q) => U.rot(q, ang));
      const sign = U.area(pts) >= 0 ? 1 : -1;
      return { kind: 'poly', pts, sign, bb: U.bbox(pts) };
    }
    const [cx, cy] = U.rot([p.cx, p.cy], ang);
    const R = p.shape === 'ring' ? p.r + p.w / 2 : p.r;
    return { kind: p.shape, cx, cy, r: p.r, w: p.w, bb: [cx - R, cy - R, cx + R, cy + R] };
  }

  function pixelNormal(g, p, x, y, bev) {
    if (g.kind === 'circle') {
      const dx = (x - g.cx) / g.r, dy = (y - g.cy) / g.r, d2 = dx * dx + dy * dy;
      if (d2 > 1) return null;
      if (p.dome) return [dx, dy, Math.sqrt(1 - d2)];
      const d = (1 - Math.sqrt(d2)) * g.r;
      if (d < bev) { const k = 1 - d / bev, l = Math.sqrt(d2) || 1; return norm([(dx / l) * k, (dy / l) * k, 1]); }
      return [0, 0, 1];
    }
    if (g.kind === 'ring') {
      const d = Math.hypot(x - g.cx, y - g.cy), s = (d - g.r) / (g.w / 2);
      if (Math.abs(s) > 1) return null;
      const c = (x - g.cx) / (d || 1), si = (y - g.cy) / (d || 1);
      return [s * c, s * si, Math.sqrt(1 - s * s)];
    }
    if (!U.inPoly(x, y, g.pts)) return null;
    let best = Infinity, n = [0, 0];
    for (let i = 0, j = g.pts.length - 1; i < g.pts.length; j = i++) {
      const [ax, ay] = g.pts[j], [bx, by] = g.pts[i];
      const d = U.distSeg(x, y, ax, ay, bx, by);
      if (d < best) { best = d; const l = Math.hypot(bx - ax, by - ay) || 1; n = [(g.sign * (by - ay)) / l, (-g.sign * (bx - ax)) / l]; }
    }
    if (best < bev) { const k = 1 - best / bev; return norm([n[0] * k, n[1] * k, 1]); }
    return [0, 0, 1];
  }

  function renderPixel(bp, layer, ang, texel) {
    const half = bp.radius + texel * 2;
    const N = Math.ceil((half * 2) / texel);
    const C = N / 2;
    const buf = pxBuffer(N);
    const owner = new Int16Array(N * N).fill(-1);
    const parts = layerParts(bp, layer);
    const solid = parts.filter((p) => !p.overlay);
    const geos = solid.map((p) => screenGeo(p, ang));
    const ramps = solid.map((p) => ramp(colorOf(bp, p.mat)));
    const toPx = (v) => v / texel + C;
    for (let k = solid.length - 1; k >= 0; k--) {
      const p = solid[k], g = geos[k];
      const bev = clamp(partSize(p) * 0.18, texel * 0.9, texel * 2.5);
      const x0 = Math.max(0, Math.floor(toPx(g.bb[0]))), x1 = Math.min(N - 1, Math.ceil(toPx(g.bb[2])));
      const y0 = Math.max(0, Math.floor(toPx(g.bb[1]))), y1 = Math.min(N - 1, Math.ceil(toPx(g.bb[3])));
      for (let py = y0; py <= y1; py++) {
        for (let px = x0; px <= x1; px++) {
          if (owner[py * N + px] >= 0) continue;
          const wx = (px + 0.5 - C) * texel, wy = (py + 0.5 - C) * texel;
          const n = pixelNormal(g, p, wx, wy, bev);
          if (!n) continue;
          owner[py * N + px] = k;
          let lv = level(dot(n, LIGHT), BAYER[py & 3][px & 3]);
          if (p.mat === 'glass' && !bp.wrecked && lv === 2 && n[0] === 0 && (px + py) % 5 === 0) lv = 3;
          buf.set(px, py, ramps[k][lv]);
        }
      }
    }
    // Detail lines and panel grids.
    for (let k = 0; k < solid.length; k++) {
      const lines = detailLines(solid[k]);
      if (!lines.length) continue;
      const col = solid[k].grid ? ramps[k][3] : ramps[k][0];
      for (const l of lines) {
        const [ax, ay] = U.rot([l[0], l[1]], ang), [bx, by] = U.rot([l[2], l[3]], ang);
        const steps = Math.ceil(Math.hypot(bx - ax, by - ay) / texel) + 1;
        for (let i = 0; i <= steps; i++) {
          const px = Math.floor(toPx(lerp(ax, bx, i / steps))), py = Math.floor(toPx(lerp(ay, by, i / steps)));
          if (px >= 0 && py >= 0 && px < N && py < N && owner[py * N + px] === k) buf.set(px, py, col);
        }
      }
    }
    // Dark edge where a lower part meets a higher one.
    const edge = [];
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const o = owner[y * N + x];
        if (o < 0) continue;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const xx = x + dx, yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= N || yy >= N) continue;
          const q = owner[yy * N + xx];
          if (q > o && solid[q].lvl > solid[o].lvl && solid[q].h > 0.5) { edge.push([x, y, o]); break; }
        }
      }
    }
    for (const [x, y, o] of edge) buf.set(x, y, ramps[o][0]);
    // Scorch: dithered darkening over what is already there.
    for (const p of parts.filter((q) => q.overlay)) {
      const g = screenGeo(p, ang);
      for (let y = Math.max(0, Math.floor(toPx(g.bb[1]))); y <= Math.min(N - 1, Math.ceil(toPx(g.bb[3]))); y++) {
        for (let x = Math.max(0, Math.floor(toPx(g.bb[0]))); x <= Math.min(N - 1, Math.ceil(toPx(g.bb[2]))); x++) {
          if (owner[y * N + x] < 0 || BAYER[y & 3][x & 3] > 0.6) continue;
          if (U.inPoly((x + 0.5 - C) * texel, (y + 0.5 - C) * texel, g.pts)) buf.set(x, y, buf.get(x, y).map((v) => v * 0.4));
        }
      }
    }
    // Outer outline.
    const out = U.hexToRgb(config.outline);
    const rim = [];
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        if (!buf.has(x, y) && (buf.has(x + 1, y) || buf.has(x - 1, y) || buf.has(x, y + 1) || buf.has(x, y - 1))) rim.push([x, y]);
      }
    }
    for (const [x, y] of rim) buf.set(x, y, out);
    return { canvas: buf.done(), half: (N * texel) / 2, smooth: false, texel };
  }

  // ---------- Low-poly style ----------

  function inTri(p, a, b, c) {
    const d1 = (p[0] - b[0]) * (a[1] - b[1]) - (a[0] - b[0]) * (p[1] - b[1]);
    const d2 = (p[0] - c[0]) * (b[1] - c[1]) - (b[0] - c[0]) * (p[1] - c[1]);
    const d3 = (p[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (p[1] - a[1]);
    return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
  }
  const cross2 = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  function earclip(pts) {
    const idx = pts.map((_, i) => i);
    const tris = [];
    for (let guard = 0; idx.length > 3 && guard < 500; guard++) {
      let cut = false;
      for (let i = 0; i < idx.length; i++) {
        const a = pts[idx[(i + idx.length - 1) % idx.length]], b = pts[idx[i]], c = pts[idx[(i + 1) % idx.length]];
        if (cross2(a, b, c) <= 1e-9) continue;
        if (idx.some((j) => pts[j] !== a && pts[j] !== b && pts[j] !== c && inTri(pts[j], a, b, c))) continue;
        tris.push([a, b, c]);
        idx.splice(i, 1);
        cut = true;
        break;
      }
      if (!cut) break;
    }
    if (idx.length === 3) tris.push(idx.map((i) => pts[i]));
    return tris;
  }

  // 3D geometry of one part: triangles plus a height function for stacking parts on top.
  function partMesh(bp, p, z0, ppu) {
    const tris = [];
    const col = colorOf(bp, p.mat);
    const emit = p.mat === 'glass' && !bp.wrecked;
    const top = z0 + p.h;
    const T = (a, b, c, hint, color = col) => tris.push({ p: [a, b, c], hint, col: color, emit });
    if (p.shape === 'ring') {
      const Un = clamp(Math.round(p.r * 0.35), 16, 40), V = 6, rz = Math.max(p.h / 2, p.w * 0.4), zc = z0 + rz;
      const P = (i, j) => {
        const u = (i / Un) * TAU, v = (j / V) * TAU;
        const rr = p.r + (p.w / 2) * Math.cos(v);
        return [p.cx + rr * Math.cos(u), p.cy + rr * Math.sin(u), zc + rz * Math.sin(v)];
      };
      for (let i = 0; i < Un; i++) {
        for (let j = 0; j < V; j++) {
          const um = ((i + 0.5) / Un) * TAU, vm = ((j + 0.5) / V) * TAU;
          const hint = [Math.cos(vm) * Math.cos(um), Math.cos(vm) * Math.sin(um), Math.sin(vm)];
          T(P(i, j), P(i + 1, j), P(i + 1, j + 1), hint);
          T(P(i, j), P(i + 1, j + 1), P(i, j + 1), hint);
        }
      }
      return { tris, top: () => zc + rz, contains: (x, y) => Math.abs(Math.hypot(x - p.cx, y - p.cy) - p.r) <= p.w / 2 };
    }
    if (p.shape === 'circle' && p.dome) {
      const n = clamp(Math.round(p.r * 0.6), 10, 20), rings = 3, cap = p.r * 0.55;
      const P = (i, k) => {
        const phi = (k / rings) * (Math.PI / 2), a = (i / n) * TAU, rr = p.r * Math.cos(phi);
        return [p.cx + rr * Math.cos(a), p.cy + rr * Math.sin(a), top + cap * Math.sin(phi)];
      };
      for (let i = 0; i < n; i++) {
        const a = ((i + 0.5) / n) * TAU;
        T([p.cx + Math.cos((i / n) * TAU) * p.r, p.cy + Math.sin((i / n) * TAU) * p.r, z0], [p.cx + Math.cos(((i + 1) / n) * TAU) * p.r, p.cy + Math.sin(((i + 1) / n) * TAU) * p.r, z0], P(i + 1, 0), [Math.cos(a), Math.sin(a), 0]);
        T([p.cx + Math.cos((i / n) * TAU) * p.r, p.cy + Math.sin((i / n) * TAU) * p.r, z0], P(i + 1, 0), P(i, 0), [Math.cos(a), Math.sin(a), 0]);
        for (let k = 0; k < rings; k++) {
          const ph = ((k + 0.5) / rings) * (Math.PI / 2);
          const hint = [Math.cos(a) * Math.cos(ph), Math.sin(a) * Math.cos(ph), Math.sin(ph)];
          if (k === rings - 1) T(P(i, k), P(i + 1, k), [p.cx, p.cy, top + cap], hint);
          else { T(P(i, k), P(i + 1, k), P(i + 1, k + 1), hint); T(P(i, k), P(i + 1, k + 1), P(i, k + 1), hint); }
        }
      }
      return {
        tris,
        top: (x, y) => top + cap * Math.sqrt(Math.max(0, 1 - ((x - p.cx) ** 2 + (y - p.cy) ** 2) / (p.r * p.r))),
        contains: (x, y) => Math.hypot(x - p.cx, y - p.cy) <= p.r,
      };
    }
    // Polygons (circles without a dome become polygons), extruded with one of three tops:
    // a roof (raised ridge or apex: hulls, wings, crystals, pods), a chamfer (inset raised top:
    // boxes and modules) or flat (decals and thin panels).
    let pts = p.shape === 'circle' ? U.circle(p.cx, p.cy, p.r, clamp(Math.round(p.r * ppu * 0.25), 8, 24)) : p.pts;
    if (U.area(pts) < 0) pts = pts.slice().reverse();
    const n = pts.length;
    const c = U.centroid(pts);
    const size = Math.sqrt(Math.abs(U.area(pts)));
    const starShaped = pts.every((a, i) => cross2(c, a, pts[(i + 1) % n]) > 1e-9);
    const tops = []; // top-surface triangles with z, for stacking parts on top
    const topTri = (a, b, cc) => { tops.push([a, b, cc]); T(a, b, cc, [0, 0, 1]); };
    const rim = (q) => [q[0], q[1], top];
    const roof = p.roof ?? p.mat === 'glass';
    let built = false;
    if (roof && starShaped && p.bevel > 0) {
      // A ridge along the long axis of elongated parts, a single apex otherwise.
      const [x0, y0, x1, y1] = U.bbox(pts), ex = x1 - x0, ey = y1 - y0;
      const peak = top + p.bevel;
      let apexes = [[c[0], c[1], peak]];
      if (Math.max(ex, ey) > 1.5 * Math.min(ex, ey)) {
        const ax = ex > ey ? [1, 0] : [0, 1], L = Math.max(ex, ey) * 0.24;
        const r1 = [c[0] + ax[0] * L, c[1] + ax[1] * L, peak], r2 = [c[0] - ax[0] * L, c[1] - ax[1] * L, peak];
        if (U.inPoly(r1[0], r1[1], pts) && U.inPoly(r2[0], r2[1], pts)) apexes = [r1, r2];
      }
      const pick = (a, b) => {
        if (apexes.length === 1) return apexes[0];
        const m = [(a[0] + b[0]) / 2 - c[0], (a[1] + b[1]) / 2 - c[1]];
        const ax = [apexes[0][0] - c[0], apexes[0][1] - c[1]];
        return m[0] * ax[0] + m[1] * ax[1] >= 0 ? apexes[0] : apexes[1];
      };
      const plan = [];
      for (let i = 0; i < n; i++) {
        const a = pts[i], b = pts[(i + 1) % n], ap = pick(a, b);
        plan.push([rim(a), rim(b), ap]);
        const next = pick(b, pts[(i + 2) % n]);
        if (next !== ap) plan.push(cross2(b, next, ap) > 0 ? [rim(b), next, ap] : [rim(b), ap, next]);
      }
      if (plan.every(([a, b, cc]) => cross2(a, b, cc) > 1e-9)) {
        for (const [a, b, cc] of plan) topTri(a, b, cc);
        built = true;
      }
    }
    if (!built && starShaped && p.h >= 0.6 && size > 1) {
      // Chamfer: inset the outline toward the centre and raise it.
      const rise = Math.max(p.bevel * 0.7, Math.min(size * 0.12, p.h * 0.8));
      const f = 0.72;
      const inner = pts.map((q) => [c[0] + (q[0] - c[0]) * f, c[1] + (q[1] - c[1]) * f, top + rise]);
      const mid = [c[0], c[1], top + rise];
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        topTri(rim(pts[i]), rim(pts[j]), inner[j]);
        topTri(rim(pts[i]), inner[j], inner[i]);
        topTri(mid, inner[i], inner[j]);
      }
      built = true;
    }
    if (!built) for (const [a, b, cc] of earclip(pts)) topTri(rim(a), rim(b), rim(cc));
    if (p.h > 0.35) {
      for (let i = 0; i < n; i++) {
        const a = pts[i], b = pts[(i + 1) % n];
        const ex = b[0] - a[0], ey = b[1] - a[1], l = Math.hypot(ex, ey) || 1;
        const hint = [ey / l, -ex / l, 0];
        T([a[0], a[1], z0], [b[0], b[1], z0], [b[0], b[1], top], hint);
        T([a[0], a[1], z0], [b[0], b[1], top], [a[0], a[1], top], hint);
      }
    }
    const topAt = (x, y) => {
      for (const [a, b, cc] of tops) {
        if (!inTri([x, y], a, b, cc)) continue;
        const A = cross2(a, b, cc);
        if (Math.abs(A) < 1e-12) continue;
        const wa = cross2([x, y], b, cc) / A, wb = cross2(a, [x, y], cc) / A;
        return wa * a[2] + wb * b[2] + (1 - wa - wb) * cc[2];
      }
      return top;
    };
    return { tris, top: topAt, contains: (x, y) => U.inPoly(x, y, pts) };
  }

  function buildMesh(bp, layer, ppu) {
    bp._mesh = bp._mesh || {};
    if (bp._mesh[layer]) return bp._mesh[layer];
    const parts = layerParts(bp, layer);
    const done = [];
    const tris = [];
    const surfaceAt = (x, y, below = Infinity) => {
      let z = 0;
      for (const g of done) if (g.lvl < below && g.contains(x, y)) z = Math.max(z, g.top(x, y));
      return z;
    };
    for (const p of parts.filter((q) => !q.overlay)) {
      const [cx, cy] = p.shape === 'poly' ? U.centroid(p.pts) : [p.cx, p.cy];
      const z0 = p.shape === 'ring' ? 0 : surfaceAt(cx, cy, p.lvl) + (p.h < 0.6 ? 0.05 : 0);
      const m = partMesh(bp, p, z0, ppu);
      // Per-face jitter so coplanar facets don't merge into one flat colour.
      for (const t of m.tris) t.jit = 0.94 + 0.12 * (((Math.sin(tris.length * 12.9898 + t.p[0][0] * 78.233) * 43758.5453) % 1 + 1) % 1);
      tris.push(...m.tris);
      done.push({ lvl: p.lvl, top: m.top, contains: m.contains });
      // Detail lines as thin strips draped on the part's top surface.
      const base = colorOf(bp, p.mat);
      const lc = p.grid ? U.mix(base, '#ffffff', 0.3) : U.shade(base, 0.55);
      const w = clamp(partSize(p) * 0.03, 0.25, 0.9);
      for (const l of detailLines(p)) {
        const dx = l[2] - l[0], dy = l[3] - l[1], len = Math.hypot(dx, dy) || 1;
        const nx = (-dy / len) * w / 2, ny = (dx / len) * w / 2;
        const z = (x, y) => m.top(x, y) + 0.08;
        const A = [l[0] + nx, l[1] + ny], B = [l[2] + nx, l[3] + ny], Cc = [l[2] - nx, l[3] - ny], D = [l[0] - nx, l[1] - ny];
        const v = (q) => [q[0], q[1], z(q[0], q[1])];
        tris.push({ p: [v(A), v(B), v(Cc)], hint: [0, 0, 1], col: lc, decal: true }, { p: [v(A), v(Cc), v(D)], hint: [0, 0, 1], col: lc, decal: true });
      }
    }
    const overlays = parts.filter((q) => q.overlay).map((p) => ({ p, z: surfaceAt(...U.centroid(p.pts)) }));
    let maxZ = 0;
    for (const t of tris) for (const v of t.p) maxZ = Math.max(maxZ, v[2]);
    bp._mesh[layer] = { tris, overlays, maxZ, surfaceAt };
    return bp._mesh[layer];
  }

  // Shade and draw triangles. `proj` maps a yawed world point to [sx, sy, depth].
  function drawTris(ctx, tris, yaw, proj, view, lwPx) {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const Y = (v) => [v[0] * c - v[1] * s, v[0] * s + v[1] * c, v[2]];
    const out = [];
    for (const t of tris) {
      const P = t.p.map(Y);
      let n = norm(cross(sub(P[1], P[0]), sub(P[2], P[0])));
      const h = Y(t.hint);
      if (dot(n, h) < 0) n = n.map((v) => -v);
      let vis = dot(n, view);
      if (t.two && vis < 0) { n = n.map((v) => -v); vis = -vis; }
      if (vis <= 0.001) continue;
      const d = Math.max(0, dot(n, LIGHT));
      const k = (t.emit ? 0.85 + 0.25 * d : t.decal ? 0.9 + 0.2 * d : 0.24 + 0.95 * d) * (t.jit || 1);
      const S = P.map(proj);
      out.push({ S, z: (S[0][2] + S[1][2] + S[2][2]) / 3 + (t.decal ? 0.05 : 0) + (t.bias || 0), col: U.shade(t.col, k) });
    }
    out.sort((a, b) => a.z - b.z);
    ctx.lineJoin = 'round';
    ctx.lineWidth = lwPx;
    for (const o of out) {
      ctx.beginPath();
      ctx.moveTo(o.S[0][0], o.S[0][1]);
      ctx.lineTo(o.S[1][0], o.S[1][1]);
      ctx.lineTo(o.S[2][0], o.S[2][1]);
      ctx.closePath();
      ctx.fillStyle = o.col;
      ctx.strokeStyle = o.col;
      ctx.fill();
      ctx.stroke();
    }
  }

  // Orthographic camera tilted toward a viewer at +y: heights rise up the screen, depth shortens y.
  const camera = () => {
    const st = Math.sin(config.tilt), ct = Math.cos(config.tilt);
    return { st, ct, view: [0, st, ct], proj: (v) => [v[0], v[1] * ct - v[2] * st, v[1] * st + v[2] * ct] };
  };

  function renderLow(bp, layer, ang, ppu, half) {
    const mesh = buildMesh(bp, layer, ppu);
    const { st, view, proj } = camera();
    const hh = half + mesh.maxZ * st;
    const S = Math.min(Math.ceil(hh * 2 * ppu), config.maxSprite);
    const k = S / (hh * 2);
    const cv = canvas(S, S);
    const ctx = cv.getContext('2d');
    ctx.setTransform(k, 0, 0, k, S / 2, S / 2);
    drawTris(ctx, mesh.tris, ang, proj, view, 0.7 / k);
    ctx.globalCompositeOperation = 'source-atop';
    for (const { p, z } of mesh.overlays) {
      ctx.beginPath();
      p.pts.forEach((q, i) => { const [x, y] = proj([...U.rot(q, ang), z]); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
      ctx.closePath();
      ctx.fillStyle = U.rgba(colorOf(bp, p.mat), 0.55);
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
    return { canvas: cv, half: hh, smooth: true, rotated: true };
  }

  // ---------- Sprites and live drawing ----------

  function sprite(bp, style, layer, a, ppu, texel, force, keep) {
    const impl = STYLE_IMPL[style];
    const half = bp.radius + impl.pad(ppu);
    const nb = impl.buckets(half * 2 * ppu);
    const bi = nb === 1 ? 0 : ((Math.round((a / TAU) * nb) % nb) + nb) % nb;
    const ang = (bi / nb) * TAU;
    const q = impl.texel ? 0 : quant(ppu);
    const tx = impl.texel ? texel : 0;
    bp._spriteKeys ||= {};
    return cachedFor(sprites, bp._spriteKeys, layer, `${bp.id}|${style}|${layer}|${bi}/${nb}|${q}|${tx}`, style, () => {
      const s = impl.asset(bp, layer, ang, q, half, tx);
      s.angle = ang;
      return s;
    }, force, keep);
  }

  const flicker = (t, seed) => Math.sin(t * 13 + seed) + Math.sin(t * 7.3 + seed * 2) > 0.9;

  // Blinking lights, drawn live over the sprite at (x, y) (already turned and, in a tilted style,
  // lifted onto the hull). on: lit right now; off lights only show in line style, dimmed.
  function drawLights(ctx, bp, impl, layer, a, t, spr, liftZ) {
    for (const l of bp.lights) {
      if (l.layer !== layer) continue;
      const on = l.flicker ? flicker(t, l.x) : l.blink === null || l.blink === undefined ? true : Math.sin(t * 3 + l.blink) > 0.6;
      let [x, y] = U.rot([l.x, l.y], a);
      if (impl.tilted) [x, y] = camera().proj([x, y, liftZ(l.x, l.y) + 0.3]);
      impl.light(ctx, l, x, y, on, spr);
    }
  }
  const fillCircle = (ctx, x, y, r) => { ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill(); };
  function lightLine(ctx, l, x, y, on) {
    if (l.line === false) return; // lights that only make sense filled in
    ctx.fillStyle = on ? l.color : U.shade(l.color, 0.3);
    fillCircle(ctx, x, y, l.r);
  }
  function lightFlat(ctx, l, x, y, on) {
    if (!on) return;
    if (l.blink !== null && l.blink !== undefined) { ctx.fillStyle = U.rgba(l.color, 0.25); fillCircle(ctx, x, y, l.r * 2.2); }
    ctx.fillStyle = l.color;
    fillCircle(ctx, x, y, l.r);
  }
  function lightLow(ctx, l, x, y, on) {
    if (!on) return;
    ctx.fillStyle = l.color;
    ctx.beginPath();
    ctx.moveTo(x, y - l.r); ctx.lineTo(x + l.r, y); ctx.lineTo(x, y + l.r); ctx.lineTo(x - l.r, y);
    ctx.fill();
  }
  // Pixel: one or two texels on the sprite's grid.
  function lightPixel(ctx, l, x, y, on, spr) {
    if (!on) return;
    const tx = spr.texel;
    const sx = Math.floor((x + spr.half) / tx) * tx - spr.half, sy = Math.floor((y + spr.half) / tx) * tx - spr.half;
    const s = l.r > tx * 1.5 ? tx * 2 : tx;
    ctx.fillStyle = l.color;
    ctx.fillRect(sx, sy, s, s);
  }

  // Engine flames, drawn live under the sprite. Each style's flame(ctx, f) gets f: { e (the
  // engine), len, tri(L, W) (a flame triangle, turned), path(pts) (traces points, lifted in a
  // tilted style), flame and core colours, a (the angle), spr }.
  function drawFlames(ctx, bp, impl, layer, a, thrust, t, spr, liftZ) {
    const flame = palette(bp).flame;
    const core = U.mix(flame, '#ffffff', 0.6);
    for (const [i, e] of bp.engines.entries()) {
      if (e.layer !== layer) continue;
      const len = (8 + 24 * thrust) * (0.85 + 0.15 * Math.sin(t * 45 + i * 1.7)) * Math.max(0.6, e.w / 3);
      const tri = (L, W) => [[e.x, e.y - W], [e.x - L, e.y], [e.x, e.y + W]].map((p) => U.rot(p, a));
      const ez = impl.tilted ? liftZ(e.x + 2, e.y) * 0.5 : 0;
      const P = impl.tilted ? camera().proj : (v) => v;
      const path = (pts) => { ctx.beginPath(); pts.forEach(([x, y], k) => { const [px, py] = P([x, y, ez]); k ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }); ctx.closePath(); };
      impl.flame(ctx, { e, len, tri, path, flame, core, a, spr });
    }
  }
  function flameLine(ctx, { e, len, tri, path, flame }) {
    path(tri(len, e.w));
    ctx.fillStyle = U.rgba(flame, 0.25);
    ctx.strokeStyle = flame;
    ctx.lineWidth = 1.5;
    ctx.fill();
    ctx.stroke();
  }
  function flameFlat(ctx, { e, len, tri, path, flame, core }) {
    path(tri(len, e.w)); ctx.fillStyle = flame; ctx.fill();
    path(tri(len * 0.55, e.w * 0.6)); ctx.fillStyle = core; ctx.fill();
  }
  function flameLow(ctx, { e, len, tri, path, flame, core, a }) {
    const [p0, p1, p2] = tri(len, e.w), mid = U.rot([e.x, e.y], a);
    path([p0, p1, mid]); ctx.fillStyle = U.shade(flame, 1.1); ctx.fill();
    path([mid, p1, p2]); ctx.fillStyle = U.shade(flame, 0.8); ctx.fill();
    path(tri(len * 0.5, e.w * 0.55)); ctx.fillStyle = core; ctx.fill();
  }
  // Pixel: fill texels on the sprite's grid.
  function flamePixel(ctx, { e, len, tri, flame, core, a, spr }) {
    const tx = spr.texel, pts = tri(len, e.w * 1.2);
    const [x0, y0, x1, y1] = U.bbox(pts);
    const base = U.rot([e.x, e.y], a);
    const snap = (v) => Math.floor((v + spr.half) / tx);
    for (let gy = snap(y0); gy <= snap(y1); gy++) {
      for (let gx = snap(x0); gx <= snap(x1); gx++) {
        const cx = gx * tx - spr.half + tx / 2, cy = gy * tx - spr.half + tx / 2;
        if (!U.inPoly(cx, cy, pts)) continue;
        const d = Math.hypot(cx - base[0], cy - base[1]) / len;
        const col = d < 0.3 ? core : d < 0.65 ? flame : BAYER[gy & 3][gx & 3] < 0.5 ? U.shade(flame, 0.7) : null;
        if (!col) continue;
        ctx.fillStyle = col;
        ctx.fillRect(gx * tx - spr.half, gy * tx - spr.half, tx, tx);
      }
    }
  }

  // Draw a blueprint. ctx must already map world units; options: x, y, angle, spin, t, thrust,
  // texel (pixel style only), force (build the sprite now, whatever the frame's budget), keep: false
  // (build it now and don't cache it: menu icons, drawn once into an image of their own).
  function drawAsset(ctx, bp, requested, o = {}) {
    const { x = 0, y = 0, angle = 0, spin = 0, t = 0, thrust = 0 } = o;
    const m = ctx.getTransform();
    const ppu = Math.hypot(m.a, m.b);
    const texel = o.texel || config.texel;
    for (const layer of bp.layers) {
      const a = angle + (layer === 'spin' ? spin : 0);
      const spr = sprite(bp, requested, layer, a, ppu, texel, o.force, o.keep !== false);
      const impl = STYLE_IMPL[spr.style]; // a stand-in may be from the previous style: draw it as that
      const drawA = impl.texel ? spr.angle : a; // texels stay on their grid: no turning between buckets
      const liftZ = impl.tilted ? (lx, ly) => buildMesh(bp, layer, ppu).surfaceAt(lx, ly) : null;
      ctx.save();
      ctx.translate(x, y);
      if (thrust > 0.02) drawFlames(ctx, bp, impl, layer, drawA, thrust, t, spr, liftZ);
      ctx.save();
      if (impl.tilted) {
        // Turn the remainder in the un-tilted plane so footprints keep their shape.
        const { ct } = camera();
        ctx.scale(1, ct);
        ctx.rotate(drawA - spr.angle);
        ctx.scale(1, 1 / ct);
      } else ctx.rotate(drawA - spr.angle);
      ctx.imageSmoothingEnabled = spr.smooth;
      ctx.drawImage(spr.canvas, -spr.half, -spr.half, spr.half * 2, spr.half * 2);
      ctx.restore();
      drawLights(ctx, bp, impl, layer, drawA, t, spr, liftZ);
      ctx.restore();
    }
  }

  // ---------- Planets ----------

  const PLANETS = {
    blue: { c: ['#16244d', '#223a78', '#2f56a0', '#3f6db8', '#6f97d8', '#a9c6f2'], line: '#8ab4ff', ring: ['#b9cbef', '#7f93c4'] },
    terran: { c: ['#1d3b6e', '#2f6fa8', '#d9c38a', '#4f8a3c', '#2e5e2e', '#7a6a5a', '#eef2f4'], t: [0.47, 0.52, 0.54, 0.6, 0.66, 0.72], line: '#8ad0ff', ring: ['#e3c99a', '#b8996c'] },
    desert: { c: ['#7a3f22', '#a8582f', '#c9774a', '#e0a06a', '#f0c999'], t: [0.42, 0.48, 0.54, 0.6], line: '#ffc08a', ring: ['#e3c99a', '#b8996c'] },
    ice: { c: ['#2c4f73', '#5d8fbd', '#a7cbe2', '#dcebf4', '#ffffff'], t: [0.44, 0.49, 0.54, 0.6], line: '#cfeaff', ring: ['#dfe9f5', '#9fb3cc'] },
    gas: { c: ['#5a3424', '#9a5a34', '#cf9358', '#ecc994', '#b56b3e'], t: [0.2, 0.4, 0.6, 0.8], line: '#ffcf94', ring: ['#e3c99a', '#b8996c'] },
    lava: { c: ['#ffb03a', '#ff6a1a', '#3b2a26', '#2a201d', '#4a3a34'], t: [0.42, 0.46, 0.55, 0.64], line: '#ff9a5a', ring: ['#b89a8a', '#7a5a4a'] },
  };
  const PLANET_TYPES = Object.keys(PLANETS);

  function hash3(x, y, z, s) {
    let h = (x * 374761393 + y * 668265263 + z * 1274126177 + s * 144269) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }
  function noise3(x, y, z, s) {
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
    const xf = x - xi, yf = y - yi, zf = z - zi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
    const h = (a, b, c) => hash3(xi + a, yi + b, zi + c, s);
    return lerp(lerp(lerp(h(0, 0, 0), h(1, 0, 0), u), lerp(h(0, 1, 0), h(1, 1, 0), u), v),
      lerp(lerp(h(0, 0, 1), h(1, 0, 1), u), lerp(h(0, 1, 1), h(1, 1, 1), u), v), w);
  }
  function fbm(x, y, z, s) {
    let a = 0.5, f = 1, t = 0, n = 0;
    for (let i = 0; i < 4; i++) { t += a * noise3(x * f, y * f, z * f, s + i * 17); n += a; a *= 0.5; f *= 2; }
    return t / n;
  }
  // Surface colour at a unit-sphere point.
  function surface(pl, x, y, z) {
    const P = PLANETS[pl.type], s = (pl.seed || 1) % 9973;
    if (pl.type === 'blue') {
      const v = (Math.sin(y * 9 + fbm(x * 2 + 3, y * 2 + 3, z * 2 + 3, 7) * 5) + 1) / 2;
      return P.c[1 + Math.floor(v * 3.99)];
    }
    let h = fbm(x * 1.8 + 3, y * 1.8 + 3, z * 1.8 + 3, s);
    if (pl.type === 'gas') h = (Math.sin(y * 9 + h * 7) + 1) / 2;
    if (pl.type === 'terran' && Math.abs(y) > 0.84) return '#eef2f4';
    if (pl.type === 'ice' && Math.abs(y) > 0.7) h = Math.max(h, 0.6);
    for (let i = 0; i < P.t.length; i++) if (h < P.t[i]) return P.c[i];
    return P.c[P.c.length - 1];
  }
  const ringAxes = (pl) => [pl.r * 1.9, pl.r * 0.5];

  function planetLine(ctx, pl, lit) {
    const { r } = pl, P = PLANETS[pl.type], tilt = pl.ringTilt ?? -0.35;
    const [A, B] = ringAxes(pl);
    ctx.strokeStyle = P.line;
    ctx.lineWidth = 2;
    if (pl.ring) {
      ctx.globalAlpha = 0.5; ctx.beginPath(); ctx.ellipse(0, 0, A, B, tilt, Math.PI, TAU); ctx.stroke();
      ctx.globalAlpha = 0.3; ctx.beginPath(); ctx.ellipse(0, 0, A * 0.88, B * 0.88, tilt, Math.PI, TAU); ctx.stroke();
      ctx.globalAlpha = 1;
    }
    const body = ctx.createRadialGradient(Math.cos(lit) * r * 0.45, Math.sin(lit) * r * 0.45, r * 0.1, 0, 0, r * 1.05);
    body.addColorStop(0, pl.type === 'blue' ? '#3f6db8' : P.c[1]);
    body.addColorStop(1, '#070b16');
    ctx.fillStyle = body;
    ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.fill(); ctx.stroke();
    ctx.save();
    ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.clip();
    ctx.globalAlpha = 0.35;
    ctx.lineWidth = 1.5;
    for (let i = -3; i <= 3; i++) { ctx.beginPath(); ctx.ellipse(0, i * r * 0.27, r * 1.1, r * 0.12, tilt, 0, Math.PI); ctx.stroke(); }
    ctx.restore();
    if (pl.ring) {
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(0, 0, A, B, tilt, 0, Math.PI); ctx.stroke();
      ctx.globalAlpha = 0.5; ctx.beginPath(); ctx.ellipse(0, 0, A * 0.88, B * 0.88, tilt, 0, Math.PI); ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  function planetFlat(ctx, pl) {
    const { r } = pl, P = PLANETS[pl.type], tilt = pl.ringTilt ?? -0.35;
    const rnd = mulberry(pl.seed || 1);
    const [A, B] = ringAxes(pl);
    const ring = (a0, a1) => {
      ctx.lineWidth = r * 0.14; ctx.strokeStyle = P.ring[0];
      ctx.beginPath(); ctx.ellipse(0, 0, A * 0.95, B * 0.95, tilt, a0, a1); ctx.stroke();
      ctx.lineWidth = r * 0.06; ctx.strokeStyle = P.ring[1];
      ctx.beginPath(); ctx.ellipse(0, 0, A * 0.8, B * 0.8, tilt, a0, a1); ctx.stroke();
    };
    if (pl.ring) ring(Math.PI, TAU);
    ctx.save();
    ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.clip();
    if (pl.type === 'blue' || pl.type === 'gas') {
      ctx.fillStyle = pl.type === 'blue' ? P.c[3] : P.c[2];
      ctx.fillRect(-r, -r, r * 2, r * 2);
      ctx.rotate(tilt);
      for (let i = -3; i <= 3; i++) {
        ctx.beginPath();
        ctx.ellipse(0, i * r * 0.27 + (rnd() - 0.5) * r * 0.05, r * 1.15, r * (0.1 + rnd() * 0.06), 0, 0, Math.PI);
        ctx.fillStyle = pl.type === 'blue' ? (i % 2 ? P.c[2] : P.c[4]) : P.c[[0, 1, 3, 4][(i + 3) % 4]];
        ctx.fill();
      }
      ctx.rotate(-tilt);
    } else {
      const base = { terran: P.c[1], desert: P.c[2], ice: P.c[2], lava: P.c[3] }[pl.type];
      const land = { terran: [P.c[3], P.c[4]], desert: [P.c[3], P.c[1]], ice: [P.c[4], P.c[3]], lava: [P.c[1], P.c[0]] }[pl.type];
      ctx.fillStyle = base;
      ctx.fillRect(-r, -r, r * 2, r * 2);
      for (let i = 0; i < 6; i++) {
        const bx = (rnd() - 0.5) * r * 1.6, by = (rnd() - 0.5) * r * 1.4, br = r * (0.22 + rnd() * 0.3);
        for (const [k, col] of [[1, land[0]], [0.45, land[1]]]) {
          ctx.fillStyle = col;
          ctx.beginPath();
          U.blob(bx, by, br * k, br * k, rnd, 0.5, 9).forEach(([x, y], j) => (j ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
          ctx.fill();
        }
      }
      if (pl.type === 'terran' || pl.type === 'ice') {
        ctx.fillStyle = '#f4f7f9';
        ctx.beginPath(); ctx.ellipse(0, -r, r * 0.6, r * 0.22, 0, 0, TAU); ctx.fill();
        ctx.beginPath(); ctx.ellipse(0, r, r * 0.5, r * 0.18, 0, 0, TAU); ctx.fill();
      }
    }
    const [lx, ly] = [LIGHT[0], LIGHT[1]].map((v) => v / Math.hypot(LIGHT[0], LIGHT[1]));
    ctx.beginPath(); ctx.rect(-r * 2, -r * 2, r * 4, r * 4); ctx.arc(lx * r * 0.34, ly * r * 0.34, r * 1.08, 0, TAU);
    ctx.fillStyle = 'rgba(5, 8, 25, 0.5)';
    ctx.fill('evenodd');
    ctx.beginPath(); ctx.arc(lx * r * 0.45, ly * r * 0.45, r * 0.16, 0, TAU);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
    ctx.fill();
    ctx.restore();
    if (pl.ring) ring(0, Math.PI);
  }

  function planetPixel(pl, texel) {
    const { r } = pl, P = PLANETS[pl.type], tilt = pl.ringTilt ?? -0.35;
    const [A, B] = ringAxes(pl);
    const ext = pl.ring ? A * 1.02 : r;
    const N = Math.ceil((ext * 2) / texel) + 2, C = N / 2;
    const buf = pxBuffer(N);
    const cs = Math.cos(-tilt), sn = Math.sin(-tilt);
    for (let py = 0; py < N; py++) {
      for (let px = 0; px < N; px++) {
        const dx = (px + 0.5 - C) * texel, dy = (py + 0.5 - C) * texel, bay = BAYER[py & 3][px & 3];
        const xr = dx * cs - dy * sn, yr = dx * sn + dy * cs, e = Math.hypot(xr / A, yr / B);
        const ring = pl.ring && ((e > 0.78 && e < 0.89) || (e > 0.92 && e < 1));
        const d2 = (dx * dx + dy * dy) / (r * r);
        let c = null;
        if (ring && yr > 0) c = e < 0.9 ? P.ring[0] : U.shade(P.ring[0], 0.85);
        else if (d2 <= 1) {
          const nx = dx / r, ny = dy / r, nz = Math.sqrt(1 - d2);
          const base = surface(pl, nx, pl.type === 'blue' ? yr / r : ny, nz);
          const lit = nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2];
          const lv = clamp(Math.floor(lit * 2.4 + 0.6 + (bay - 0.5) * 0.7), 0, 2);
          let k = [0.38, 0.68, 1][lv];
          if (pl.type === 'lava' && (base === '#ffb03a' || base === '#ff6a1a')) k = Math.max(k, 0.85);
          c = U.shade(base, k);
          if (lv === 2 && lit > 0.85) c = U.mix(c, '#ffffff', 0.18);
        } else if (ring) c = e < 0.9 ? U.shade(P.ring[1], 0.9) : U.shade(P.ring[1], 0.7);
        if (c) buf.set(px, py, U.hexToRgb(c));
      }
    }
    return { canvas: buf.done(), half: (N * texel) / 2, smooth: false };
  }

  const icoCache = {}; // by subdivision level
  function icosphere(n) {
    if (icoCache[n]) return icoCache[n];
    const t = (1 + Math.sqrt(5)) / 2;
    let v = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]].map(norm);
    let f = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
    for (let s = 0; s < n; s++) {
      const mids = {}, nf = [];
      const mid = (a, b) => {
        const k = a < b ? a + '_' + b : b + '_' + a;
        if (mids[k] === undefined) { v.push(norm([(v[a][0] + v[b][0]) / 2, (v[a][1] + v[b][1]) / 2, (v[a][2] + v[b][2]) / 2])); mids[k] = v.length - 1; }
        return mids[k];
      };
      for (const [a, b, c] of f) { const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a); nf.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]); }
      f = nf;
    }
    icoCache[n] = { n, v, f };
    return icoCache[n];
  }
  // Orthographic tilt for round bodies: rotate about x so the ring plane leans toward the viewer.
  function orbit(v, ax) {
    const c = Math.cos(ax), s = Math.sin(ax);
    return [v[0], v[1] * c - v[2] * s, v[1] * s + v[2] * c];
  }

  function planetLow(ctx, pl) {
    const { r } = pl, P = PLANETS[pl.type], tilt = pl.ringTilt ?? -0.35;
    const { v, f } = icosphere(2);
    const s = (pl.seed || 1) % 9973, sea = P.t ? P.t[1] : 0.5;
    const H = v.map((p) => (pl.type === 'gas' || pl.type === 'blue' ? 0.5 : fbm(p[0] * 1.8 + 3, p[1] * 1.8 + 3, p[2] * 1.8 + 3, s)));
    const V = v.map((p, i) => p.map((a) => a * r * (1 + Math.max(0, H[i] - sea) * 0.4)));
    const tris = f.map(([a, b, c]) => {
      const m = [0, 1, 2].map((i) => (v[a][i] + v[b][i] + v[c][i]) / 3);
      // Surface bands run parallel to the ring plane, so the pole is the model z axis.
      return { p: [V[a], V[b], V[c]], hint: m, col: surface(pl, m[0], m[2], m[1]) };
    });
    if (pl.ring) {
      const n = 40, [A] = ringAxes(pl);
      for (const [r0, r1, cols] of [[A * 0.8, A * 0.88, P.ring], [A * 0.9, A * 1.0, P.ring]]) {
        for (let i = 0; i < n; i++) {
          const a0 = (i / n) * TAU, a1 = ((i + 1) / n) * TAU;
          const Q = (a, rr) => [Math.cos(a) * rr, Math.sin(a) * rr, 0];
          const col = i % 2 ? cols[0] : cols[1];
          tris.push({ p: [Q(a0, r0), Q(a1, r0), Q(a1, r1)], hint: [0, 0, 1], col, two: true }, { p: [Q(a0, r0), Q(a1, r1), Q(a0, r1)], hint: [0, 0, 1], col, two: true });
        }
      }
    }
    // Lean the ring plane: tip about x, then roll by the ring tilt in screen space.
    const lean = 1.31;
    const cr = Math.cos(tilt), sr = Math.sin(tilt);
    const tilted = tris.map((t) => ({ ...t, p: t.p.map((q) => { const o = orbit(q, lean); return [o[0] * cr - o[1] * sr, o[0] * sr + o[1] * cr, o[2]]; }), hint: (() => { const o = orbit(t.hint, lean); return [o[0] * cr - o[1] * sr, o[0] * sr + o[1] * cr, o[2]]; })() }));
    drawTris(ctx, tilted, 0, (q) => [q[0], q[1], q[2]], [0, 0, 1], 0.6 / Math.hypot(ctx.getTransform().a, ctx.getTransform().b));
  }

  function mulberry(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function drawPlanet(ctx, pl, style, o = {}) {
    const { x = 0, y = 0, lightAngle = Math.atan2(LIGHT[1], LIGHT[0]) } = o;
    const m = ctx.getTransform();
    const ppu = quant(Math.hypot(m.a, m.b));
    const texel = o.texel || config.texel;
    const ext = pl.ring ? ringAxes(pl)[0] * 1.08 : pl.r * 1.05;
    const spr = bodySprite(sprites, 'planet', pl, style, Math.round(lightAngle * 8), { ext, cap: config.maxSprite * 2, ppu, texel, o: { lightAngle }, force: o.force });
    blit(ctx, spr, x, y);
  }

  // ---------- Stars ----------

  const STAR_CLASSES = {
    G: ['#fff8e0', '#ffe7a8', '#ffd27a', '#ff9d3a', '#e0702a', '#8f3a1a'],
    K: ['#fff0d6', '#ffc27a', '#ff9a3c', '#e8642a', '#b03a1a', '#6a1e10'],
    M: ['#ffd9c2', '#ff8a5c', '#e8502e', '#b02a1e', '#701812', '#3e0d0a'],
    B: ['#ffffff', '#dff0ff', '#a9d4ff', '#6aa8ff', '#3a6ad9', '#1e3a8a'],
    A: ['#ffffff', '#f4f6ff', '#d8e2ff', '#aabcf0', '#7088c8', '#3a4a80'],
  };

  function starLine(ctx, st, t) {
    const { r } = st, P = STAR_CLASSES[st.cls || 'G'];
    const glow = ctx.createRadialGradient(0, 0, r * 0.6, 0, 0, r * 3.2);
    glow.addColorStop(0, U.rgba(P[2], 0.35));
    glow.addColorStop(1, U.rgba(P[3], 0));
    ctx.fillStyle = glow;
    ctx.beginPath(); ctx.arc(0, 0, r * 3.2, 0, TAU); ctx.fill();
    const core = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
    core.addColorStop(0, P[0]); core.addColorStop(0.7, P[2]); core.addColorStop(1, P[3]);
    ctx.fillStyle = core;
    ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.fill();
    ctx.strokeStyle = P[2];
    ctx.lineWidth = 2;
    ctx.globalAlpha = 0.6;
    ctx.beginPath();
    for (let i = 0; i < 28; i++) {
      const a = (i / 28) * TAU + t * 0.04;
      const outer = r * (1.25 + 0.12 * Math.sin(t * 1.3 + i * 1.7));
      ctx.moveTo(Math.cos(a) * r * 1.1, Math.sin(a) * r * 1.1);
      ctx.lineTo(Math.cos(a) * outer, Math.sin(a) * outer);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  function starPixel(st, texel) {
    const P = STAR_CLASSES[st.cls || 'G'], R = st.r / texel;
    const N = Math.ceil(R * 3.4) + 2, C = N / 2;
    const buf = pxBuffer(N);
    const s = st.seed || 41, sc = 4.2 / R;
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const dx = x + 0.5 - C, dy = y + 0.5 - C, bay = BAYER[y & 3][x & 3];
        const d = Math.hypot(dx, dy) / R;
        const v = d + noise3(x * sc, y * sc, 0, s) * 0.3 - 0.15 + (bay - 0.5) * 0.2;
        const i = v < 0.42 ? 0 : v < 0.68 ? 1 : v < 0.9 ? 2 : v < 1.05 ? 3 : v < 1.28 ? 4 : v < 1.5 && bay < 0.4 ? 5 : -1;
        if (i >= 0) buf.set(x, y, U.hexToRgb(P[i]));
        else if (d < 1.65 && bay < 0.12) buf.set(x, y, U.hexToRgb(P[4]));
      }
    }
    const rays = st.rays || 8;
    for (let i = 0; i < rays; i++) {
      const a = (i / rays) * TAU, long = i % 2 === 0;
      for (let k = R * 1.2; k < R * (long ? 1.65 : 1.45); k += 1) {
        if (k > R * 1.5 && Math.floor(k) % 2) continue;
        buf.set(Math.floor(C + Math.cos(a) * k), Math.floor(C + Math.sin(a) * k), U.hexToRgb(k < R * 1.45 ? P[2] : P[3]));
      }
    }
    return { canvas: buf.done(), half: (N * texel) / 2, smooth: false };
  }

  function starFlat(ctx, st) {
    const { r } = st, P = STAR_CLASSES[st.cls || 'G'], n = (st.rays || 14) * 2;
    for (const [k, a] of [[2.2, 0.06], [1.75, 0.1]]) {
      ctx.fillStyle = U.rgba(P[2], a);
      ctx.beginPath(); ctx.arc(0, 0, r * k, 0, TAU); ctx.fill();
    }
    ctx.beginPath();
    for (let i = 0; i < n * 2; i++) {
      const a = (i / (n * 2)) * TAU, rr = i % 2 ? r * 1.04 : r * (i % 4 ? 1.27 : 1.42);
      ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
    }
    ctx.closePath();
    ctx.fillStyle = P[3];
    ctx.fill();
    const disc = (cx, cy, rr, c) => { ctx.beginPath(); ctx.arc(cx, cy, rr, 0, TAU); ctx.fillStyle = c; ctx.fill(); };
    disc(0, 0, r, P[2]);
    disc(-r * 0.09, -r * 0.09, r * 0.73, P[1]);
    disc(-r * 0.25, -r * 0.25, r * 0.25, P[0]);
  }

  function starLow(ctx, st) {
    const { r } = st, P = STAR_CLASSES[st.cls || 'G'], rnd = mulberry(st.seed || 77);
    ctx.beginPath();
    for (let i = 0; i < 13; i++) { const a = (i / 13) * TAU, rr = r * 1.7 * (0.92 + rnd() * 0.16); ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); }
    ctx.closePath();
    ctx.fillStyle = U.rgba(P[3], 0.14);
    ctx.fill();
    const n = 28;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU, o = r * (1.25 + 0.12 * Math.sin(i * 1.7) + (i % 2 ? 0 : 0.1)), hw = 0.05;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a - hw) * r * 0.98, Math.sin(a - hw) * r * 0.98);
      ctx.lineTo(Math.cos(a) * o, Math.sin(a) * o);
      ctx.lineTo(Math.cos(a + hw) * r * 0.98, Math.sin(a + hw) * r * 0.98);
      ctx.closePath();
      ctx.fillStyle = i % 2 ? P[3] : P[2];
      ctx.fill();
    }
    const { v, f } = icosphere(1);
    const V = v.map((p) => p.map((a) => a * r * (1 + (rnd() - 0.5) * 0.1)));
    const pal = [P[2], P[1], P[3], P[1], P[2]];
    drawTris(ctx, f.map(([a, b, c]) => ({ p: [V[a], V[b], V[c]], hint: norm([0, 1, 2].map((i) => V[a][i] + V[b][i] + V[c][i])), col: pal[Math.floor(rnd() * pal.length)], emit: true })),
      0.4, (q) => [q[0], q[1], q[2]], [0, 0, 1], 0.6 / Math.hypot(ctx.getTransform().a, ctx.getTransform().b));
  }

  // A star turns slowly (texel styles excepted, to stay on their grid).
  function drawStar(ctx, st, style, o = {}) {
    const { x = 0, y = 0, t = 0 } = o;
    const impl = STYLE_IMPL[style];
    if (!impl.star) {
      ctx.save();
      ctx.translate(x, y);
      impl.starLive(ctx, st, t);
      ctx.restore();
      return;
    }
    const m = ctx.getTransform();
    const ppu = quant(Math.hypot(m.a, m.b));
    const texel = o.texel || config.texel;
    const spr = bodySprite(sprites, 'star', st, style, '', { ext: st.r * impl.starExt, cap: config.maxSprite * 2, ppu, texel, o: {}, force: o.force });
    blit(ctx, spr, x, y, STYLE_IMPL[spr.style].texel ? 0 : t * 0.02);
  }

  // ---------- Asteroids ----------
  // A seeded lumpy, cratered icosphere shared by all styles, so silhouettes match. Asteroids tumble
  // about a per-seed axis; `spin` is quantised into rotation buckets and lighting stays world-fixed.
  // Object: { type, r, seed, elong?, lump?, craters? }. r is the bounding radius in world units.

  const ASTEROIDS = {
    stony: { label: 'Stony', c: ['#8a7866', '#665648', '#b29d84'], line: '#e0b98a' },
    carbon: { label: 'Carbonaceous', c: ['#4b4a52', '#38363d', '#6c6a74'], line: '#a9b0c2' },
    metal: { label: 'Metallic', c: ['#8e959e', '#80634f', '#c3cad2'], line: '#cfe0f0', shine: true },
    ice: { label: 'Icy', c: ['#9fc2da', '#7598b6', '#eef7fc'], line: '#bff0ff', shine: true },
  };
  const ASTEROID_BUCKETS = 48; // asteroid sprites live in their own cache (asteroidSprites, above)

  function axisMat([x, y, z], a) {
    const c = Math.cos(a), s = Math.sin(a), t = 1 - c;
    return [t * x * x + c, t * x * y - s * z, t * x * z + s * y, t * x * y + s * z, t * y * y + c, t * y * z - s * x, t * x * z - s * y, t * y * z + s * x, t * z * z + c];
  }
  const mulMat = (A, B) => { const o = []; for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) o.push(A[i * 3] * B[j] + A[i * 3 + 1] * B[3 + j] + A[i * 3 + 2] * B[6 + j]); return o; };
  const apply = (M, v) => [M[0] * v[0] + M[1] * v[1] + M[2] * v[2], M[3] * v[0] + M[4] * v[1] + M[5] * v[2], M[6] * v[0] + M[7] * v[1] + M[8] * v[2]];

  function asteroidShape(ast) {
    if (ast._astS) return ast._astS;
    const seed = (ast.seed || 1) >>> 0, rnd = mulberry(seed * 7 + 3), s = seed % 9973;
    const el = ast.elong ?? 0.12 + rnd() * 0.4;
    const sc = [1 + el, 1 - el * 0.25, 1 - el * 0.4];
    const lump = ast.lump ?? 0.2 + rnd() * 0.16;
    const nC = ast.craters ?? 2 + Math.floor(rnd() * 4);
    const craters = Array.from({ length: nC }, () => ({ d: norm([rnd() - 0.5, rnd() - 0.5, rnd() - 0.5]), a: 0.26 + rnd() * 0.3, depth: 0.09 + rnd() * 0.09 }));
    const off = [rnd() * 50, rnd() * 50, rnd() * 50];
    const disp = (p) => {
      let h = 1 + (fbm(p[0] * 1.5 + off[0], p[1] * 1.5 + off[1], p[2] * 1.5 + off[2], s) - 0.5) * lump * 2.4
        + (noise3(p[0] * 5 + off[1], p[1] * 5 + off[2], p[2] * 5 + off[0], s + 3) - 0.5) * 0.08;
      let cr = 0;
      for (const c of craters) {
        const t = Math.acos(clamp(dot(p, c.d), -1, 1)) / c.a;
        if (t < 1) { h -= c.depth * (1 - t * t); cr = Math.max(cr, 1 - t); }
        else if (t < 1.35) h += c.depth * 0.3 * (1 - (t - 1) / 0.35);
      }
      const pat = clamp((fbm(p[0] * 2.2 + off[2], p[1] * 2.2 + off[0], p[2] * 2.2 + off[1], s + 9) - 0.46) * 4 + 0.5, 0, 1);
      return { q: [p[0] * h * sc[0], p[1] * h * sc[1], p[2] * h * sc[2]], cr: Math.min(1, cr * 1.8), pat };
    };
    // Normalise so the bounding radius is 1.
    const { v } = icosphere(2);
    const R = Math.max(...v.map((p) => Math.hypot(...disp(p).q)));
    for (const c of craters) {
      const q = disp(c.d).q.map((x) => x / R);
      c.pos = q;
      c.n = norm([c.d[0] / sc[0], c.d[1] / sc[1], c.d[2] / sc[2]]);
      c.rad = Math.sin(c.a) * Math.hypot(...q) * 0.92;
    }
    const fr = mulberry(seed * 13 + 5);
    const M0 = axisMat(norm([fr() - 0.5, fr() - 0.5, fr() - 0.5]), fr() * TAU);
    const axis = norm([fr() - 0.5, fr() - 0.5, fr() - 0.5]);
    ast._astS = { disp, R, craters, M0, axis };
    return ast._astS;
  }

  function asteroidModel(ast, sub) {
    ast._astM = ast._astM || {};
    if (ast._astM[sub]) return ast._astM[sub];
    const S = asteroidShape(ast);
    const { v, f } = icosphere(sub);
    const D = v.map(S.disp);
    const V = D.map((d) => d.q.map((x) => x / S.R));
    const N = V.map(() => [0, 0, 0]);
    for (const [a, b, c] of f) {
      const n = cross(sub3(V[b], V[a]), sub3(V[c], V[a]));
      for (const i of [a, b, c]) for (let k = 0; k < 3; k++) N[i][k] += n[k];
    }
    N.forEach((n, i) => { const m = norm(n); N[i] = dot(m, v[i]) < 0 ? m.map((x) => -x) : m; });
    ast._astM[sub] = { V, N, f, cr: D.map((d) => d.cr), pat: D.map((d) => d.pat) };
    return ast._astM[sub];
  }
  const sub3 = sub;
  const astMat = (ast, a) => { const S = asteroidShape(ast); return mulMat(axisMat(S.axis, a), S.M0); };
  const astPal = (ast) => ASTEROIDS[ast.type] || ASTEROIDS.stony;
  const astMatColor = (P, pat, cr) => (cr > 0.5 ? P.c[2] : pat > 0.5 ? P.c[1] : P.c[0]);

  // Star-shaped outline of the projected mesh: furthest edge crossing along 72 rays from the centre.
  function astSilhouette(P2, f, n = 72) {
    const seen = new Set(), E = [];
    for (const [a, b, c] of f) for (const [i, j] of [[a, b], [b, c], [c, a]]) {
      const k = i < j ? i * 4096 + j : j * 4096 + i;
      if (!seen.has(k)) { seen.add(k); E.push([P2[i], P2[j]]); }
    }
    const out = [];
    for (let i = 0; i < n; i++) {
      const t = (i / n) * TAU, dx = Math.cos(t), dy = Math.sin(t);
      let best = 0;
      for (const [A, B] of E) {
        const ex = B[0] - A[0], ey = B[1] - A[1], den = dx * ey - dy * ex;
        if (Math.abs(den) < 1e-12) continue;
        const u = (A[0] * dy - A[1] * dx) / den;
        if (u < 0 || u > 1) continue;
        const d = (A[0] * ey - A[1] * ex) / den;
        if (d > best) best = d;
      }
      out.push([dx * best, dy * best]);
    }
    return out;
  }
  const pathOf = (pts, dx = 0, dy = 0) => { const p = new Path2D(); pts.forEach(([x, y], i) => (i ? p.lineTo(x + dx, y + dy) : p.moveTo(x + dx, y + dy))); p.closePath(); return p; };

  // Visible craters in screen space: centre, radii and major-axis angle of the projected rim.
  function astCraters(ast, M) {
    const out = [];
    for (const c of asteroidShape(ast).craters) {
      const n = apply(M, c.n), p = apply(M, c.pos);
      if (n[2] < 0.18) continue;
      out.push({ x: p[0] * ast.r, y: p[1] * ast.r, rx: c.rad * ast.r, ry: c.rad * ast.r * n[2], rot: Math.atan2(n[1], n[0]) + Math.PI / 2, nz: n[2] });
    }
    return out;
  }

  function asteroidLine(ctx, ast, M, k) {
    const P = astPal(ast), md = asteroidModel(ast, 2), r = ast.r;
    const sil = U.chaikin(astSilhouette(md.V.map((q) => { const w = apply(M, q); return [w[0] * r, w[1] * r]; }), md.f), 1);
    const dpr = dprOf(), lw = Math.max(1, Math.min(2 * k, 2.6 * dpr)) / k;
    const path = pathOf(sil);
    ctx.lineJoin = 'round';
    ctx.fillStyle = config.bg;
    ctx.fill(path);
    ctx.strokeStyle = P.line;
    ctx.lineWidth = lw;
    ctx.stroke(path);
    ctx.save();
    ctx.clip(path);
    ctx.lineWidth = lw * 0.7;
    for (const c of astCraters(ast, M)) {
      ctx.globalAlpha = 0.25 + 0.4 * c.nz;
      ctx.beginPath(); ctx.ellipse(c.x, c.y, c.rx, c.ry, c.rot, 0, TAU); ctx.stroke();
    }
    ctx.restore();
  }

  function asteroidFlat(ctx, ast, M) {
    const P = astPal(ast), md = asteroidModel(ast, 2), r = ast.r;
    const W = md.V.map((q) => apply(M, q).map((x) => x * r));
    const sil = U.chaikin(astSilhouette(W, md.f), 1);
    const path = pathOf(sil);
    const [lx, ly] = [LIGHT[0], LIGHT[1]].map((v) => v / Math.hypot(LIGHT[0], LIGHT[1]));
    ctx.fillStyle = P.c[0];
    ctx.fill(path);
    ctx.save();
    ctx.clip(path);
    // Patches: front faces of the patch material, filled flat.
    ctx.fillStyle = ctx.strokeStyle = P.c[1];
    ctx.lineWidth = r * 0.02;
    ctx.lineJoin = 'round';
    for (const [a, b, c] of md.f) {
      if ((md.pat[a] + md.pat[b] + md.pat[c]) / 3 < 0.5) continue;
      const n = cross(sub(W[b], W[a]), sub(W[c], W[a]));
      const ce = [0, 1, 2].map((i) => W[a][i] + W[b][i] + W[c][i]);
      if (dot(n, ce) < 0 ? n[2] > 0 : n[2] < 0) continue;
      ctx.beginPath(); ctx.moveTo(W[a][0], W[a][1]); ctx.lineTo(W[b][0], W[b][1]); ctx.lineTo(W[c][0], W[c][1]); ctx.closePath();
      ctx.fill(); ctx.stroke();
    }
    // Craters: dark bowl with the far wall lit, leaving a shadow crescent toward the light.
    for (const c of astCraters(ast, M)) {
      const el = new Path2D(); el.ellipse(c.x, c.y, c.rx, c.ry, c.rot, 0, TAU);
      ctx.fillStyle = U.shade(P.c[0], 0.62);
      ctx.fill(el);
      ctx.save();
      ctx.clip(el);
      ctx.beginPath(); ctx.ellipse(c.x - lx * c.rx * 0.32, c.y - ly * c.rx * 0.32, c.rx, c.ry, c.rot, 0, TAU);
      ctx.fillStyle = U.mix(P.c[0], P.c[2], 0.55);
      ctx.fill();
      ctx.restore();
    }
    const big = new Path2D();
    big.rect(-r * 2, -r * 2, r * 4, r * 4);
    const shadow = new Path2D(big); shadow.addPath(pathOf(sil, lx * r * 0.3, ly * r * 0.3));
    ctx.fillStyle = 'rgba(5, 8, 25, 0.48)';
    ctx.fill(shadow, 'evenodd');
    const hi = new Path2D(big); hi.addPath(pathOf(sil, -lx * r * 0.07, -ly * r * 0.07));
    ctx.fillStyle = U.rgba('#ffffff', P.shine ? 0.26 : 0.14);
    ctx.globalCompositeOperation = 'source-atop';
    ctx.fill(hi, 'evenodd');
    ctx.restore();
  }

  function asteroidPixel(ast, M, texel) {
    const P = astPal(ast), md = asteroidModel(ast, 2), r = ast.r;
    const N = Math.ceil((r * 2) / texel) + 4, C = N / 2;
    const buf = pxBuffer(N);
    const zb = new Float32Array(N * N).fill(-Infinity), nb = new Float32Array(N * N * 3), wb = new Float32Array(N * N * 2);
    const W = md.V.map((q) => apply(M, q)), Nn = md.N.map((q) => apply(M, q));
    const S = W.map((q) => [(q[0] * r) / texel + C, (q[1] * r) / texel + C, q[2]]);
    for (const [a, b, c] of md.f) {
      const A = S[a], B = S[b], Cc = S[c];
      const area = cross2(A, B, Cc);
      if (Math.abs(area) < 1e-9) continue;
      const x0 = Math.max(0, Math.floor(Math.min(A[0], B[0], Cc[0]))), x1 = Math.min(N - 1, Math.ceil(Math.max(A[0], B[0], Cc[0])));
      const y0 = Math.max(0, Math.floor(Math.min(A[1], B[1], Cc[1]))), y1 = Math.min(N - 1, Math.ceil(Math.max(A[1], B[1], Cc[1])));
      for (let py = y0; py <= y1; py++) for (let px = x0; px <= x1; px++) {
        const q = [px + 0.5, py + 0.5];
        const wa = cross2(q, B, Cc) / area, wbb = cross2(A, q, Cc) / area, wc = 1 - wa - wbb;
        if (wa < -1e-6 || wbb < -1e-6 || wc < -1e-6) continue;
        const z = wa * A[2] + wbb * B[2] + wc * Cc[2], i = py * N + px;
        if (z <= zb[i]) continue;
        zb[i] = z;
        for (let k = 0; k < 3; k++) nb[i * 3 + k] = wa * Nn[a][k] + wbb * Nn[b][k] + wc * Nn[c][k];
        wb[i * 2] = wa * md.pat[a] + wbb * md.pat[b] + wc * md.pat[c];
        wb[i * 2 + 1] = wa * md.cr[a] + wbb * md.cr[b] + wc * md.cr[c];
      }
    }
    const ramps = P.c.map(ramp);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const i = y * N + x;
      if (zb[i] === -Infinity) continue;
      const n = norm([nb[i * 3], nb[i * 3 + 1], nb[i * 3 + 2]]), bay = BAYER[y & 3][x & 3];
      const lit = dot(n, LIGHT);
      let lv = level(lit, bay);
      if (lv === 3 && !P.shine && lit < 0.93) lv = 2;
      const m = wb[i * 2 + 1] + (bay - 0.5) * 0.5 > 0.5 ? 2 : wb[i * 2] + (bay - 0.5) * 0.4 > 0.5 ? 1 : 0;
      buf.set(x, y, ramps[m][lv]);
    }
    const out = U.hexToRgb(config.outline), rim = [];
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      if (!buf.has(x, y) && (buf.has(x + 1, y) || buf.has(x - 1, y) || buf.has(x, y + 1) || buf.has(x, y - 1))) rim.push([x, y]);
    }
    for (const [x, y] of rim) buf.set(x, y, out);
    return { canvas: buf.done(), half: (N * texel) / 2, smooth: false };
  }

  function asteroidLow(ctx, ast, M) {
    const P = astPal(ast), md = asteroidModel(ast, ast.r >= 28 ? 2 : 1), r = ast.r;
    const W = md.V.map((q) => apply(M, q).map((x) => x * r));
    const tris = md.f.map(([a, b, c], i) => {
      const ce = [0, 1, 2].map((k) => (W[a][k] + W[b][k] + W[c][k]) / 3);
      const col = astMatColor(P, (md.pat[a] + md.pat[b] + md.pat[c]) / 3, (md.cr[a] + md.cr[b] + md.cr[c]) / 3);
      const jit = 0.93 + 0.14 * (((Math.sin(i * 12.9898 + (ast.seed || 1) * 78.233) * 43758.5453) % 1 + 1) % 1);
      return { p: [W[a], W[b], W[c]], hint: ce, col, jit };
    });
    drawTris(ctx, tris, 0, (q) => [q[0], q[1], q[2]], [0, 0, 1], 0.6 / Math.hypot(ctx.getTransform().a, ctx.getTransform().b));
  }

  // Draw an asteroid. ctx must already map world units; options: x, y, spin (tumble angle), texel.
  function drawAsteroid(ctx, ast, style, o = {}) {
    const { x = 0, y = 0, spin = 0 } = o;
    const m = ctx.getTransform();
    const ppu = quant(Math.hypot(m.a, m.b));
    const texel = o.texel || config.texel;
    const nb = ASTEROID_BUCKETS, bi = ((Math.round((spin / TAU) * nb) % nb) + nb) % nb;
    const ext = ast.r * 1.06 + STYLE_IMPL[style].asteroidPad(ppu);
    const spr = bodySprite(asteroidSprites, 'asteroid', ast, style, bi, { ext, cap: config.maxSprite, ppu, texel, o: { angle: (bi / nb) * TAU }, force: o.force });
    blit(ctx, spr, x, y);
  }

  // ---------- Art styles ----------
  //
  // What each style draws, and how:
  //   label                               its name in the settings menu
  //   asset(bp, layer, ang, ppu, half, texel) -> sprite   a blueprint layer turned to ang
  //   planet, star, asteroid              paint a body onto a canvas that maps world units:
  //                                       (ctx, body, o); or, in a texel style, rasterise it on the
  //                                       texel grid: (body, texel, o) -> sprite. o: { lightAngle }
  //                                       for planets, { angle } (the tumble) for asteroids, plus k
  //                                       (px per world unit) when painting
  //   star: null, starLive(ctx, star, t)  the star is drawn live every frame instead
  //   starExt                             a star sprite's half size, in star radii
  //   light(ctx, l, x, y, on, spr), flame(ctx, f)   blinking lights and engine flames, drawn live
  //   buckets(px) -> n                    rotation buckets for a blueprint sprite that many px across
  //                                       (1: one sprite, turned when drawn)
  //   pad(ppu), asteroidPad(ppu)          world units around a blueprint or asteroid (line widths)
  //   texel                               rasterised on a texel grid: sprites keep to it (no turning
  //                                       between buckets) and their keys include the texel size
  //   tilted                              drawn through the low-poly camera: lights and flames sit on
  //                                       the hull, and turning keeps footprints in shape
  const sizedBuckets = (px) => (px <= config.bigSprite ? config.buckets : config.bigBuckets);
  const noPad = () => 0;
  // An asteroid painter from one taking its orientation matrix.
  const tumbled = (paint) => (c, ast, o) => paint(c, ast, astMat(ast, o.angle), o.k);
  const STYLE_IMPL = {
    line: {
      label: 'Line',
      asset: renderLine, buckets: () => 1, pad: (ppu) => 12 / Math.max(ppu, 0.1) + 2,
      planet: (c, pl, o) => planetLine(c, pl, o.lightAngle),
      star: null, starLive: starLine,
      asteroid: tumbled(asteroidLine), asteroidPad: (ppu) => 3 / Math.max(ppu, 0.1),
      light: lightLine, flame: flameLine,
    },
    pixel: {
      label: 'Pixel', texel: true,
      asset: (bp, layer, ang, ppu, half, texel) => renderPixel(bp, layer, ang, texel), buckets: () => config.buckets, pad: () => 2,
      planet: planetPixel, star: starPixel,
      asteroid: (ast, texel, o) => asteroidPixel(ast, astMat(ast, o.angle), texel), asteroidPad: noPad,
      light: lightPixel, flame: flamePixel,
    },
    flat: {
      label: 'Flat',
      asset: renderFlat, buckets: sizedBuckets, pad: () => 2,
      planet: planetFlat, star: starFlat, starExt: 2.25,
      asteroid: tumbled(asteroidFlat), asteroidPad: noPad,
      light: lightFlat, flame: flameFlat,
    },
    lowpoly: {
      label: 'Low-poly', tilted: true,
      asset: renderLow, buckets: sizedBuckets, pad: () => 2,
      planet: planetLow, star: starLow, starExt: 1.8,
      asteroid: tumbled(asteroidLow), asteroidPad: noPad,
      light: lightLow, flame: flameLow,
    },
  };
  const STYLES = Object.entries(STYLE_IMPL).map(([id, s]) => ({ id, label: s.label }));

  // A planet, star or asteroid sprite, from the cache or made by the style: painted onto a canvas
  // reaching ext world units either side of the centre (at most cap px across), or rasterised on
  // its texel grid. part: what else tells this body's sprites apart (light angle, tumble bucket).
  function bodySprite(cache, kind, body, style, part, { ext, cap, ppu, texel, o, force }) {
    const impl = STYLE_IMPL[style];
    const key = `${idOf(body)}|${style}|${ppu}|${impl.texel ? texel : 0}|${part}`;
    return cachedFor(cache, body, '_spriteKey', key, style, () => {
      if (impl.texel) return impl[kind](body, texel, o);
      const S = Math.min(Math.ceil(ext * 2 * ppu), cap);
      const k = S / (ext * 2);
      const cv = canvas(S, S);
      const c = cv.getContext('2d');
      c.setTransform(k, 0, 0, k, S / 2, S / 2);
      impl[kind](c, body, { ...o, k });
      return { canvas: cv, half: ext, smooth: true };
    }, force);
  }
  // Draw a body's sprite centred on (x, y), turned by `turn` if given.
  function blit(ctx, spr, x, y, turn = null) {
    ctx.save();
    if (turn === null) {
      ctx.imageSmoothingEnabled = spr.smooth;
      ctx.drawImage(spr.canvas, x - spr.half, y - spr.half, spr.half * 2, spr.half * 2);
    } else {
      ctx.translate(x, y);
      if (turn) ctx.rotate(turn);
      ctx.imageSmoothingEnabled = spr.smooth;
      ctx.drawImage(spr.canvas, -spr.half, -spr.half, spr.half * 2, spr.half * 2);
    }
    ctx.restore();
  }

  return {
    // Shared with art/bodies.js and art/portraits.js: the world light, dithering, noise, meshes and
    // sprite helpers, and the per-frame build budget (sprite-cache.js) every cache spends from.
    kit: { LIGHT, BAYER, norm, dot, sub, cross, hash3, noise3, fbm, icosphere, ramp, level, quant, dprOf, canvas, idOf, budget },
    STYLES, config, PLANET_TYPES, STAR_CLASSES: Object.keys(STAR_CLASSES),

    ASTEROID_TYPES: Object.keys(ASTEROIDS), ASTEROIDS,
    drawAsset, drawPlanet, drawStar, drawAsteroid,
    // Start a frame: a fresh sprite build budget (see the caches above).
    beginFrame: () => budget.next(),
    clearCache: () => { sprites.clear(); asteroidSprites.clear(); },
    // Sprite cache sizes and build counts, for the performance overlay.
    stats() {
      const s = sprites.stats(), a = asteroidSprites.stats();
      return {
        sprites: s.sprites, spritePixels: s.pixels, builds: s.builds,
        asteroids: a.sprites, asteroidPixels: a.pixels, asteroidBuilds: a.builds,
        deferred: s.deferred + a.deferred, buildMs: budget.spent,
      };
    },
  };
})();
