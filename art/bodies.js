'use strict';

// Moons and nebulae in the four art styles (line, pixel, flat, low-poly), lit by the shared
// up-left world light (art/render.js). Sprites live in one cache bounded by memory
// (Art.config.maxBodyPixels) and are built from the frame's shared build budget, like the rest of
// the art (sprite-cache.js).
//
// Moon: { type, r, seed }. Tidally locked, so each seed has one static face.
//   ArtBodies.drawMoon(ctx, moon, style, { x, y, texel, force })
// Nebula: { type, seed, x, y, w, h, scale?, blobs? }: a cloud filling the world-space rect
//   (x, y, w, h) with soft, noisy edges. `scale` is the feature size in world units (default 160).
//   blobs: [{ x, y, r }] in world units, optional: the cloud then fills those circles (still
//   inside the rect) instead of the whole rect, so it can follow a shape like a solar system's
//   nebula (solar-system.js). The density field is anchored in world space and drawn in cached
//   chunks, so any size works, and without blobs resizing the rect leaves its interior unchanged.
//   ArtBodies.drawNebula(ctx, nebula, style, { view: [x0, y0, x1, y1], texel, force })
//   ctx must map world units; `view` culls to the visible world rect (without it the whole nebula
//   is drawn). A chunk that isn't built yet is left out while the frame's budget is spent.
// ArtBodies.MOONS, NEBULAE: the types, each with a label and colours; clearCache(), stats().
// Browser only (global `ArtBodies`). Load after art/render.js.

const ArtBodies = (() => {
  const U = ArtUtil;
  const { TAU, clamp, lerp } = U;
  const { LIGHT, BAYER, norm, dot, sub, cross, hash3, noise3, fbm, icosphere, ramp, level, quant, dprOf, canvas, idOf, budget } = Art.kit;
  const conf = () => Art.config;
  const L2 = [LIGHT[0], LIGHT[1]].map((v) => v / Math.hypot(LIGHT[0], LIGHT[1]));
  const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const pathOf = (pts, dx = 0, dy = 0) => { const p = new Path2D(); pts.forEach(([x, y], i) => (i ? p.lineTo(x + dx, y + dy) : p.moveTo(x + dx, y + dy))); p.closePath(); return p; };
  const cache = SpriteCache.create({ budget, get maxPixels() { return conf().maxBodyPixels; }, get maxEntries() { return conf().maxBodySprites; } });

  function outlineRim(img, N, D) {
    const out = U.hexToRgb(conf().outline), has = (x, y) => x >= 0 && y >= 0 && x < N && y < N && D[(y * N + x) * 4 + 3] > 0, rim = [];
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (!has(x, y) && (has(x + 1, y) || has(x - 1, y) || has(x, y + 1) || has(x, y - 1))) rim.push(y * N + x);
    for (const i of rim) { D[i * 4] = out[0]; D[i * 4 + 1] = out[1]; D[i * 4 + 2] = out[2]; D[i * 4 + 3] = 255; }
  }

  // ---------- Moons ----------
  // Surface features are spherical caps (centre d, angular radius a, wobbly edge) shared by all
  // styles: maria (dark plains), craters (bowls with bright ejecta), volcanic vents, and cracks
  // (great-circle polylines).

  const MOONS = {
    grey: { label: 'Grey regolith', c: ['#8e8a84', '#5d5a57', '#c4bfb6'], line: '#d9d4ca', craters: [14, 22], maria: [2, 4] },
    ice: { label: 'Icy', c: ['#bcd3e2', '#86a9c2', '#f1f8fc'], line: '#c8eeff', craters: [3, 7], maria: [0, 2], cracks: [4, 7], crack: '#a8745a', shine: true },
    sulfur: { label: 'Volcanic', c: ['#d6bf55', '#8a5a24', '#f3e8a2'], line: '#ffe06a', craters: [0, 2], maria: [4, 7], vents: [2, 4], hot: '#ff7a2a' },
    rust: { label: 'Rust', c: ['#a35a3b', '#6b3828', '#d39270'], line: '#ff9f7a', craters: [8, 14], maria: [1, 3] },
    dark: { label: 'Carbon', c: ['#57545c', '#3a3840', '#86838e'], line: '#b8bacb', craters: [10, 18], maria: [0, 2] },
  };

  function cap(rnd, a, wob) {
    const d = norm([rnd() * 2 - 1, rnd() * 2 - 1, 0.15 + rnd() * 0.95]);
    const e1 = norm(cross(Math.abs(d[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0], d)), e2 = cross(d, e1);
    const H = [2, 3, 4, 5].map((f) => [f, (wob * (0.4 + rnd() * 0.6) * 2) / f, rnd() * TAU]);
    return { d, e1, e2, a, H };
  }
  const capK = (c, phi) => { let k = 1; for (const [f, amp, ph] of c.H) k += amp * Math.sin(f * phi + ph); return Math.max(0.4, k); };
  function capT(c, p) {
    const cd = clamp(dot(p, c.d), -1, 1);
    if (cd < Math.cos(Math.min(c.a * 2.4, 3))) return 9;
    return Math.acos(cd) / (c.a * capK(c, Math.atan2(dot(p, c.e2), dot(p, c.e1))));
  }
  function capPt(c, phi, f) {
    const ang = c.a * capK(c, phi) * f, s = Math.sin(ang), co = Math.cos(ang), cp = Math.cos(phi), sp = Math.sin(phi);
    return [0, 1, 2].map((i) => c.d[i] * co + (c.e1[i] * cp + c.e2[i] * sp) * s);
  }
  // Projected cap outline in world units; hidden points are pushed onto the limb.
  function capOutline(c, f, r, n = 40) {
    return Array.from({ length: n }, (_, i) => {
      const p = capPt(c, (i / n) * TAU, f);
      if (p[2] >= 0) return [p[0] * r, p[1] * r];
      const l = Math.hypot(p[0], p[1]) || 1;
      return [(p[0] / l) * r, (p[1] / l) * r];
    });
  }

  function moonShape(m) {
    if (m._ms) return m._ms;
    const T = MOONS[m.type] || MOONS.grey, rnd = mulberry32((m.seed || 1) * 7 + 11);
    const n = (r) => (r ? r[0] + Math.floor(rnd() * (r[1] - r[0] + 1)) : 0);
    const maria = Array.from({ length: n(T.maria) }, () => cap(rnd, 0.28 + rnd() * 0.42, 0.22));
    const craters = Array.from({ length: n(T.craters) }, () => {
      const c = cap(rnd, 0.06 + rnd() ** 2 * 0.32, 0.04);
      c.depth = 0.05 + rnd() * 0.05;
      c.halo = c.a > 0.1 ? (c.a > 0.17 && rnd() < 0.5 ? 1.7 : 1.28) : 0;
      return c;
    }).sort((a, b) => b.a - a.a);
    const vents = Array.from({ length: n(T.vents) }, () => cap(rnd, 0.045 + rnd() * 0.04, 0.15));
    const cracks = Array.from({ length: n(T.cracks) }, () => {
      const d = norm([rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 1.2]);
      const e = norm(cross(d, norm([rnd() - 0.5, rnd() - 0.5, rnd() - 0.5]))), q = cross(d, e);
      const len = 0.6 + rnd() * 1.3, wob = rnd() * 0.12, ph = rnd() * TAU;
      return Array.from({ length: 18 }, (_, i) => {
        const t = (i / 17 - 0.5) * len, w = Math.sin(t * 5 + ph) * wob;
        return norm([0, 1, 2].map((k) => d[k] * Math.cos(t) + e[k] * Math.sin(t) + q[k] * w));
      });
    });
    const cols = [T.c[0], T.c[1], T.c[2], T.crack || U.shade(T.c[1], 0.7), T.hot || T.c[2], U.shade(T.c[1], 0.75)];
    m._ms = { T, maria, craters, vents, cracks, cols };
    return m._ms;
  }
  function crackDist(P, p) {
    let best = 9;
    for (let i = 1; i < P.length; i++) {
      const ab = sub(P[i], P[i - 1]), ap = sub(p, P[i - 1]), t = clamp(dot(ap, ab) / dot(ab, ab), 0, 1);
      best = Math.min(best, Math.hypot(ap[0] - ab[0] * t, ap[1] - ab[1] * t, ap[2] - ab[2] * t));
    }
    return best;
  }
  function moonHeight(S, p) {
    let h = 0;
    for (const c of S.craters) {
      const t = capT(c, p);
      if (t < 1) h -= c.depth * (1 - t * t);
      else if (t < 1.35) h += c.depth * 0.3 * (1 - (t - 1) / 0.35);
    }
    return h;
  }
  // Material: 0 base, 1 mare, 2 ejecta, 3 crack, 4 vent, 5 vent halo.
  function moonMat(S, p, jit = 0) {
    for (const v of S.vents) { const t = capT(v, p); if (t < 1) return 4; if (t < 1.9 + jit) return 5; }
    for (const c of S.cracks) if (crackDist(c, p) < 0.014) return 3;
    for (const c of S.craters) { if (!c.halo) continue; const t = capT(c, p); if (t >= 0.95 && t < c.halo + jit) return 2; }
    for (const mm of S.maria) if (capT(mm, p) < 1 + jit) return 1;
    return 0;
  }
  function moonNormal(S, p) {
    const l = Math.hypot(p[2], p[0]), t1 = l < 1e-4 ? [1, 0, 0] : [p[2] / l, 0, -p[0] / l], t2 = cross(p, t1), e = 0.008;
    const H = (v, k) => moonHeight(S, [p[0] + v[0] * k, p[1] + v[1] * k, p[2] + v[2] * k]);
    const g1 = (H(t1, e) - H(t1, -e)) / (2 * e), g2 = (H(t2, e) - H(t2, -e)) / (2 * e);
    return norm([0, 1, 2].map((i) => p[i] - g1 * t1[i] - g2 * t2[i]));
  }
  const visibleCraters = (S) => S.craters.filter((c) => c.d[2] > 0.12);

  function moonLine(ctx, m, k) {
    const S = moonShape(m), T = S.T, r = m.r, dpr = dprOf(), lw = Math.max(1, Math.min(2 * k, 2.6 * dpr)) / k;
    const body = new Path2D(); body.arc(0, 0, r, 0, TAU);
    ctx.lineJoin = ctx.lineCap = 'round';
    ctx.fillStyle = conf().bg; ctx.fill(body);
    ctx.strokeStyle = ctx.fillStyle = ctx.shadowColor = T.line;
    ctx.lineWidth = lw; ctx.stroke(body);
    ctx.save();
    ctx.clip(body);
    ctx.globalAlpha = 0.1;
    for (const mm of S.maria) ctx.fill(pathOf(capOutline(mm, 1, r)));
    ctx.lineWidth = lw * 0.6;
    for (const c of S.cracks) {
      ctx.globalAlpha = 0.55;
      ctx.beginPath();
      let pen = false;
      for (const p of c) { if (p[2] < 0) { pen = false; continue; } pen ? ctx.lineTo(p[0] * r, p[1] * r) : ctx.moveTo(p[0] * r, p[1] * r); pen = true; }
      ctx.stroke();
    }
    ctx.lineWidth = lw * 0.7;
    for (const c of visibleCraters(S)) { ctx.globalAlpha = 0.25 + 0.45 * c.d[2]; ctx.stroke(pathOf(capOutline(c, 0.95, r, 28))); }
    ctx.globalAlpha = 1;
    ctx.fillStyle = ctx.shadowColor = T.hot || T.line;
    ctx.shadowBlur = Math.min(8 * dpr, 5 * k);
    for (const v of S.vents) if (v.d[2] > 0.1) ctx.fill(pathOf(capOutline(v, 1, r, 16)));
    ctx.restore();
  }

  function moonFlat(ctx, m) {
    const S = moonShape(m), T = S.T, r = m.r, C = S.cols;
    const body = new Path2D(); body.arc(0, 0, r, 0, TAU);
    ctx.fillStyle = C[0]; ctx.fill(body);
    ctx.save();
    ctx.clip(body);
    ctx.fillStyle = C[1];
    for (const mm of S.maria) ctx.fill(pathOf(capOutline(mm, 1, r)));
    ctx.fillStyle = U.mix(C[0], C[2], 0.7);
    for (const c of S.craters) if (c.halo && c.d[2] > 0.05) ctx.fill(pathOf(capOutline(c, c.halo, r, 32)));
    ctx.strokeStyle = C[3]; ctx.lineWidth = r * 0.028; ctx.lineJoin = ctx.lineCap = 'round';
    for (const c of S.cracks) {
      ctx.beginPath();
      let pen = false;
      for (const p of c) { if (p[2] < 0) { pen = false; continue; } pen ? ctx.lineTo(p[0] * r, p[1] * r) : ctx.moveTo(p[0] * r, p[1] * r); pen = true; }
      ctx.stroke();
    }
    for (const c of visibleCraters(S)) {
      const base = C[moonMat(S, c.d) === 1 ? 1 : 0], bowl = pathOf(capOutline(c, 0.95, r, 28)), rx = Math.sin(c.a) * r;
      ctx.fillStyle = U.shade(base, 0.62); ctx.fill(bowl);
      ctx.save(); ctx.clip(bowl);
      ctx.fillStyle = U.mix(base, C[2], 0.5);
      ctx.fill(pathOf(capOutline(c, 0.95, r, 28), -L2[0] * rx * 0.34, -L2[1] * rx * 0.34));
      ctx.restore();
    }
    for (const v of S.vents) {
      if (v.d[2] < 0.05) continue;
      ctx.fillStyle = C[5]; ctx.fill(pathOf(capOutline(v, 1.9, r, 20)));
      ctx.fillStyle = C[4]; ctx.fill(pathOf(capOutline(v, 1, r, 16)));
    }
    const big = new Path2D(); big.rect(-r * 2, -r * 2, r * 4, r * 4);
    const shadow = new Path2D(big); shadow.arc(L2[0] * r * 0.34, L2[1] * r * 0.34, r * 1.08, 0, TAU);
    ctx.fillStyle = 'rgba(5, 8, 25, 0.5)'; ctx.fill(shadow, 'evenodd');
    const hi = new Path2D(big); hi.arc(-L2[0] * r * 0.07, -L2[1] * r * 0.07, r, 0, TAU);
    ctx.fillStyle = U.rgba('#ffffff', T.shine ? 0.24 : 0.12); ctx.fill(hi, 'evenodd');
    ctx.restore();
  }

  function moonPixel(m, texel) {
    const S = moonShape(m), T = S.T, r = m.r, N = Math.ceil((r * 2) / texel) + 4, C = N / 2;
    const cv = canvas(N, N), ctx = cv.getContext('2d'), img = ctx.createImageData(N, N), D = img.data;
    const ramps = S.cols.map(ramp);
    for (let py = 0; py < N; py++) for (let px = 0; px < N; px++) {
      const dx = ((px + 0.5 - C) * texel) / r, dy = ((py + 0.5 - C) * texel) / r, d2 = dx * dx + dy * dy;
      if (d2 > 1) continue;
      const p = [dx, dy, Math.sqrt(1 - d2)], bay = BAYER[py & 3][px & 3];
      const lit = dot(moonNormal(S, p), LIGHT), mat = moonMat(S, p, (bay - 0.5) * 0.12);
      let lv = level(lit, bay);
      if (lv === 3 && !T.shine && lit < 0.93) lv = 2;
      if (mat === 4) lv = 3;
      const c = ramps[mat][lv], i = (py * N + px) * 4;
      D[i] = c[0]; D[i + 1] = c[1]; D[i + 2] = c[2]; D[i + 3] = 255;
    }
    outlineRim(img, N, D);
    ctx.putImageData(img, 0, 0);
    return { canvas: cv, half: (N * texel) / 2, smooth: false };
  }

  function moonLow(ctx, m) {
    const S = moonShape(m), r = m.r, { v, f } = icosphere(r >= 16 ? 3 : 2);
    const V = v.map((p) => p.map((a) => a * r * (1 + moonHeight(S, p) * 0.9)));
    const tris = [];
    f.forEach(([a, b, c], i) => {
      const ce = [0, 1, 2].map((k) => (V[a][k] + V[b][k] + V[c][k]) / 3);
      let n = norm(cross(sub(V[b], V[a]), sub(V[c], V[a])));
      if (dot(n, ce) < 0) n = n.map((x) => -x);
      if (n[2] <= 0) return;
      const mat = moonMat(S, norm(ce));
      const jit = 0.94 + 0.12 * (((Math.sin(i * 12.9898 + (m.seed || 1) * 78.233) * 43758.5453) % 1 + 1) % 1);
      let k = (0.24 + 0.95 * Math.max(0, dot(n, LIGHT))) * jit;
      if (mat === 4) k = Math.max(k, 1);
      tris.push({ p: [V[a], V[b], V[c]], z: ce[2], col: U.shade(S.cols[mat], k) });
    });
    tris.sort((a, b) => a.z - b.z);
    const t = ctx.getTransform();
    ctx.lineWidth = 0.6 / Math.hypot(t.a, t.b);
    ctx.lineJoin = 'round';
    for (const { p, col } of tris) {
      ctx.beginPath(); ctx.moveTo(p[0][0], p[0][1]); ctx.lineTo(p[1][0], p[1][1]); ctx.lineTo(p[2][0], p[2][1]); ctx.closePath();
      ctx.fillStyle = ctx.strokeStyle = col; ctx.fill(); ctx.stroke();
    }
  }

  // The moon's sprite for this style and scale, keyed by what it is drawn from (so a moon rebuilt
  // from its seed finds it again); while the budget is spent, the last one drawn stands in.
  function drawMoon(ctx, m, style, o = {}) {
    const { x = 0, y = 0 } = o, mt = ctx.getTransform(), ppu = quant(Math.hypot(mt.a, mt.b)), texel = o.texel || conf().texel;
    const key = `moon|${idOf(m)}|${style}|${ppu}|${style === 'pixel' ? texel : 0}`;
    const spr = cache.get(key, () => {
      if (style === 'pixel') return moonPixel(m, texel);
      const ext = m.r * 1.06 + (style === 'line' ? 3 / Math.max(ppu, 0.1) : 0);
      const Sz = Math.min(Math.ceil(ext * 2 * ppu), conf().maxSprite), k = Sz / (ext * 2);
      const cv = canvas(Sz, Sz), c = cv.getContext('2d');
      c.setTransform(k, 0, 0, k, Sz / 2, Sz / 2);
      if (style === 'line') moonLine(c, m, k); else if (style === 'flat') moonFlat(c, m); else moonLow(c, m);
      return { canvas: cv, half: ext, smooth: true };
    }, { fallback: m._moonKey, force: o.force });
    if (spr.key === key) m._moonKey = key;
    ctx.save();
    ctx.imageSmoothingEnabled = spr.smooth;
    ctx.drawImage(spr.canvas, x - spr.half, y - spr.half, spr.half * 2, spr.half * 2);
    ctx.restore();
  }

  // ---------- Nebulae ----------
  // Density comes from domain-warped fbm sampled on a world-anchored lattice (bilinear between
  // samples), multiplied by a noisy falloff toward the rect's edges (or the blobs' edges). Four
  // density bands set colour and opacity; a second noise field shifts colour toward the type's
  // alternate hue.

  const NEBULAE = {
    emission: { label: 'Emission', c: ['#3a1240', '#8a2a6a', '#e0507a', '#ffc4cc'], alt: '#c23a3a', line: '#ff6ab0' },
    reflection: { label: 'Reflection', c: ['#101c48', '#24508e', '#5aa0e0', '#d8f0ff'], alt: '#6a4ab0', line: '#7ab8ff' },
    ion: { label: 'Ionised', c: ['#0a2a30', '#11706a', '#3ad0a8', '#d8fff0'], alt: '#2a6aa0', line: '#5affd0' },
    ember: { label: 'Ember', c: ['#3a1a0e', '#8a3a14', '#e88a2a', '#fff0b0'], alt: '#a02a2a', line: '#ffaa4a' },
    dust: { label: 'Dark dust', c: ['#0c0a0a', '#1e1915', '#3a2e26', '#6e5644'], alt: '#2e2236', line: '#a08870', dark: true },
  };
  const LEVELS = [0.1, 0.28, 0.5, 0.74];
  const ALPHA = { normal: [0.22, 0.42, 0.66, 0.9], dark: [0.6, 0.8, 0.92, 0.96] };

  function nebGrid(neb) {
    const s = neb.scale || 160, key = s + '|' + (neb.seed || 1);
    if (!neb._ng || neb._ng.key !== key) neb._ng = { key, s, g: s / 24, S: (neb.seed || 1) % 9973, map: new Map() };
    return neb._ng;
  }
  function gridAt(G, i, j) {
    const k = i * 1048576 + j;
    let v = G.map.get(k);
    if (!v) {
      const u = (i * G.g) / G.s, w = (j * G.g) / G.s, S = G.S;
      const wx = fbm(u * 0.7 + 5.2, w * 0.7 + 1.3, 0.5, S + 1) - 0.5, wy = fbm(u * 0.7 + 8.1, w * 0.7 + 2.7, 1.5, S + 2) - 0.5;
      const n = fbm(u + wx * 1.8, w + wy * 1.8, 2.5, S) + (noise3(u * 4 + wx, w * 4 + wy, 4.5, S + 7) - 0.5) * 0.08;
      v = [n, fbm(u * 0.5 + 20, w * 0.5 + 20, 3.5, S + 5)];
      if (G.map.size > 250000) G.map.clear();
      G.map.set(k, v);
    }
    return v;
  }
  const nebMargin = (neb, G) => Math.min(Math.min(neb.w, neb.h) * 0.35, G.s * 1.4);
  // How far inside the cloud's edge a point is: the rect's, and with blobs the deepest blob's.
  function edgeDist(neb, x, y) {
    const e = Math.min(x - neb.x, neb.x + neb.w - x, y - neb.y, neb.y + neb.h - y);
    if (!neb.blobs) return e;
    let b = -Infinity;
    for (const c of neb.blobs) b = Math.max(b, c.r - Math.hypot(x - c.x, y - c.y));
    return Math.min(e, b);
  }
  // [density 0..1, hue mix 0..1] at a world point.
  function nebSample(neb, G, x, y) {
    const fx = x / G.g, fy = y / G.g, i = Math.floor(fx), j = Math.floor(fy), tx = fx - i, ty = fy - j;
    const a = gridAt(G, i, j), b = gridAt(G, i + 1, j), c = gridAt(G, i, j + 1), d = gridAt(G, i + 1, j + 1);
    const n = lerp(lerp(a[0], b[0], tx), lerp(c[0], d[0], tx), ty), m = lerp(lerp(a[1], b[1], tx), lerp(c[1], d[1], tx), ty);
    const e = edgeDist(neb, x, y) / nebMargin(neb, G);
    return [clamp((n - 0.36) * 2.6, 0, 1) * smooth(0, 1, e + (n - 0.5) * 1.2), clamp((m - 0.5) * 3 + 0.5, 0, 1)];
  }
  const band = (d) => (d < LEVELS[0] ? -1 : d < LEVELS[1] ? 0 : d < LEVELS[2] ? 1 : d < LEVELS[3] ? 2 : 3);
  function nebTable(T) {
    return T._tab || (T._tab = T.c.map((c) => [0, 1, 2, 3].map((q) => U.mix(c, T.alt, (q / 3) * 0.55))));
  }

  // Raster bands (flat and pixel): one sample per output pixel, exactly the chunk's area.
  function nebRaster(neb, G, T, x0, y0, CH, px, pixel) {
    const N = Math.max(1, Math.round(CH / px)), cv = canvas(N, N), ctx = cv.getContext('2d'), img = ctx.createImageData(N, N), D = img.data;
    const tab = nebTable(T).map((r) => r.map(U.hexToRgb)), A = ALPHA[T.dark ? 'dark' : 'normal'];
    for (let py = 0; py < N; py++) for (let qx = 0; qx < N; qx++) {
      const [d, m] = nebSample(neb, G, x0 + (qx + 0.5) * px, y0 + (py + 0.5) * px);
      const lv = band(pixel ? d + (BAYER[py & 3][qx & 3] - 0.5) * 0.1 : d);
      if (lv < 0) continue;
      const c = tab[lv][Math.min(3, Math.floor(m * 4))], i = (py * N + qx) * 4;
      D[i] = c[0]; D[i + 1] = c[1]; D[i + 2] = c[2]; D[i + 3] = Math.round(A[lv] * 255);
    }
    ctx.putImageData(img, 0, 0);
    return { canvas: cv, x: x0, y: y0, w: CH, h: CH };
  }

  // Line: faint band fill inside the chunk, plus opaque marching-squares isolines on the global
  // lattice drawn into a padded canvas (neighbouring chunks overlap identically, so no seams).
  function nebLine(neb, G, T, x0, y0, CH, ppu) {
    const P = Math.ceil(4 * ppu), inner = Math.max(1, Math.ceil(CH * ppu)), Sp = inner + P * 2, k = inner / CH, pad = P / k;
    const cv = canvas(Sp, Sp), c = cv.getContext('2d'), img = c.createImageData(Sp, Sp), D = img.data, lc = U.hexToRgb(T.line);
    const FA = [0.04, 0.07, 0.1, 0.14];
    for (let py = P; py < P + inner; py++) for (let qx = P; qx < P + inner; qx++) {
      const lv = band(nebSample(neb, G, x0 + (qx - P + 0.5) / k, y0 + (py - P + 0.5) / k)[0]);
      if (lv < 0) continue;
      const i = (py * Sp + qx) * 4;
      D[i] = lc[0]; D[i + 1] = lc[1]; D[i + 2] = lc[2]; D[i + 3] = Math.round(FA[lv] * 255);
    }
    c.putImageData(img, 0, 0);
    const g = G.g, i0 = Math.floor(x0 / g) - 1, j0 = Math.floor(y0 / g) - 1, nx = Math.ceil((x0 + CH) / g) + 2 - i0, ny = Math.ceil((y0 + CH) / g) + 2 - j0;
    const V = new Float32Array(nx * ny);
    for (let jj = 0; jj < ny; jj++) for (let ii = 0; ii < nx; ii++) V[jj * nx + ii] = nebSample(neb, G, (i0 + ii) * g, (j0 + jj) * g)[0];
    c.setTransform(k, 0, 0, k, (pad - x0) * k, (pad - y0) * k);
    c.lineCap = c.lineJoin = 'round';
    const lw = Math.max(1, Math.min(1.5 * k, 2 * dprOf())) / k;
    LEVELS.forEach((L, li) => {
      c.strokeStyle = U.mix(conf().bg, T.line, [0.3, 0.5, 0.75, 1][li]);
      c.lineWidth = lw * [0.6, 0.75, 0.9, 1][li];
      c.beginPath();
      for (let jj = 0; jj < ny - 1; jj++) for (let ii = 0; ii < nx - 1; ii++) {
        const a = V[jj * nx + ii], b = V[jj * nx + ii + 1], cc = V[(jj + 1) * nx + ii + 1], d = V[(jj + 1) * nx + ii];
        if ((a >= L) === (b >= L) && (b >= L) === (cc >= L) && (cc >= L) === (d >= L)) continue;
        const x = (i0 + ii) * g, y = (j0 + jj) * g;
        const at = (va, vb, ax, ay, bx, by) => { if ((va >= L) === (vb >= L)) return null; const t = (L - va) / (vb - va); return [lerp(ax, bx, t), lerp(ay, by, t)]; };
        const e = [at(a, b, x, y, x + g, y), at(b, cc, x + g, y, x + g, y + g), at(d, cc, x, y + g, x + g, y + g), at(a, d, x, y, x, y + g)];
        const seg = (p, q) => { c.moveTo(p[0], p[1]); c.lineTo(q[0], q[1]); };
        const pts = e.filter(Boolean);
        if (pts.length === 2) seg(pts[0], pts[1]);
        else if (pts.length === 4) {
          if (((a + b + cc + d) / 4 >= L) === (a >= L)) { seg(e[0], e[1]); seg(e[2], e[3]); } else { seg(e[0], e[3]); seg(e[1], e[2]); }
        }
      }
      c.stroke();
    });
    return { canvas: cv, x: x0 - pad, y: y0 - pad, w: CH + pad * 2, h: CH + pad * 2 };
  }

  // Low-poly: a jittered world lattice; density is height. Each cell belongs to the chunk holding
  // its origin. Facets are opaque, pre-mixed with the background by their band opacity.
  function nebLow(neb, G, T, x0, y0, CH, ppu) {
    const L = G.s / 5, S = G.S, P = Math.ceil(L * 1.5 * ppu), inner = Math.max(1, Math.ceil(CH * ppu)), Sp = inner + P * 2, k = inner / CH, pad = P / k;
    const cv = canvas(Sp, Sp), c = cv.getContext('2d');
    c.setTransform(k, 0, 0, k, (pad - x0) * k, (pad - y0) * k);
    c.lineWidth = 0.6 / k;
    c.lineJoin = 'round';
    const tab = nebTable(T), A = ALPHA[T.dark ? 'dark' : 'normal'], bg = conf().bg, verts = new Map();
    const vert = (i, j) => {
      const key = i * 1048576 + j;
      let v = verts.get(key);
      if (!v) {
        const x = (i + (hash3(i, j, 1, S + 11) - 0.5) * 0.7) * L, y = (j + (hash3(i, j, 2, S + 11) - 0.5) * 0.7) * L;
        const [d, m] = nebSample(neb, G, x, y);
        v = [x, y, d * L * 1.4, d, m];
        verts.set(key, v);
      }
      return v;
    };
    const ia = Math.ceil(x0 / L), ib = Math.ceil((x0 + CH) / L), ja = Math.ceil(y0 / L), jb = Math.ceil((y0 + CH) / L);
    for (let j = ja; j < jb; j++) for (let i = ia; i < ib; i++) {
      const v00 = vert(i, j), v10 = vert(i + 1, j), v01 = vert(i, j + 1), v11 = vert(i + 1, j + 1);
      const tris = hash3(i, j, 3, S + 11) < 0.5 ? [[v00, v10, v11], [v00, v11, v01]] : [[v00, v10, v01], [v10, v11, v01]];
      for (const [a, b, q] of tris) {
        const d = (a[3] + b[3] + q[3]) / 3, lv = band(d);
        if (lv < 0) continue;
        let n = norm(cross(sub(b, a), sub(q, a)));
        if (n[2] < 0) n = n.map((x) => -x);
        const m = (a[4] + b[4] + q[4]) / 3, jit = 0.95 + 0.1 * hash3(i, j, lv + 5, S);
        const col = U.shade(U.mix(bg, tab[lv][Math.min(3, Math.floor(m * 4))], A[lv]), (0.35 + 0.85 * Math.max(0, dot(n, LIGHT))) * jit);
        c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); c.lineTo(q[0], q[1]); c.closePath();
        c.fillStyle = c.strokeStyle = col; c.fill(); c.stroke();
      }
    }
    return { canvas: cv, x: x0 - pad, y: y0 - pad, w: CH + pad * 2, h: CH + pad * 2 };
  }

  function drawNebula(ctx, neb, style, o = {}) {
    const T = NEBULAE[neb.type] || NEBULAE.emission, G = nebGrid(neb);
    const mt = ctx.getTransform(), ppu = quant(Math.hypot(mt.a, mt.b)), texel = o.texel || conf().texel;
    const CH = style === 'pixel' ? texel * Math.max(8, Math.round(128 / texel)) : 128;
    const v = o.view || [neb.x, neb.y, neb.x + neb.w, neb.y + neb.h];
    const vx0 = Math.max(v[0], neb.x), vy0 = Math.max(v[1], neb.y), vx1 = Math.min(v[2], neb.x + neb.w), vy1 = Math.min(v[3], neb.y + neb.h);
    if (vx0 >= vx1 || vy0 >= vy1) return;
    // Chunks well inside the rect don't depend on its edges, so they survive resizes. With blobs
    // every chunk depends on the shape, so all are keyed by it.
    const inset = nebMargin(neb, G) * 1.7 + G.s * 0.4;
    const shape = neb.blobs ? idOf(neb) : `${neb.x},${neb.y},${neb.w},${neb.h}`;
    const base = `nebula|${G.key}|${neb.type}|${style}|${ppu}|${style === 'pixel' ? texel : 0}`;
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    for (let cj = Math.floor(vy0 / CH); cj * CH < vy1; cj++) for (let ci = Math.floor(vx0 / CH); ci * CH < vx1; ci++) {
      const x0 = ci * CH, y0 = cj * CH;
      const interior = !neb.blobs && x0 - inset > neb.x && y0 - inset > neb.y && x0 + CH + inset < neb.x + neb.w && y0 + CH + inset < neb.y + neb.h;
      const key = `${base}|${interior ? 'in' : shape}|${ci},${cj}`;
      if (!o.force && budget.over && !cache.has(key)) continue; // built in a later frame
      const spr = cache.get(key, () => (style === 'pixel' ? nebRaster(neb, G, T, x0, y0, CH, texel, true)
        : style === 'flat' ? nebRaster(neb, G, T, x0, y0, CH, 1 / ppu, false)
          : style === 'line' ? nebLine(neb, G, T, x0, y0, CH, ppu) : nebLow(neb, G, T, x0, y0, CH, ppu)), { force: true });
      ctx.drawImage(spr.canvas, spr.x, spr.y, spr.w, spr.h);
    }
    ctx.restore();
  }

  return {
    MOONS, MOON_TYPES: Object.keys(MOONS), NEBULAE, NEBULA_TYPES: Object.keys(NEBULAE),
    drawMoon, drawNebula,
    clearCache: () => cache.clear(),
    stats: () => cache.stats(),
  };
})();
