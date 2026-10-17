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
//   nebula (world/solar-system.js). The density field is anchored in world space and drawn in cached
//   chunks, so any size works, and without blobs resizing the rect leaves its interior unchanged.
//   ArtBodies.drawNebula(ctx, nebula, style, { view: [x0, y0, x1, y1], texel, force, layer })
//   ctx must map world units; `view` culls to the visible world rect (without it the whole nebula
//   is drawn). It's drawn in tiles built once in world units and drawn at any zoom (see Tiles
//   below); a tile that isn't built yet is left out while the frame's budget is spent. layer: for
//   a view that moves a little each frame (the flight view), the tiles are drawn into a cached
//   layer and the frame draws that (see Layer below).
// Gas pocket: { type, seed, r }: a knot of dense gas r world units across in a nebula of that type,
//   drawn like a small, bright nebula in the same style (bands, isolines, facets or dither): an
//   outer cloud and a brighter core, turning slowly against each other and breathing.
//   ArtBodies.drawGas(ctx, gas, style, { x, y, t, texel, force })
// ArtBodies.MOONS, NEBULAE: the types, each with a label and colours; clearCache(), stats().
// ES module (`ArtBodies`); needs a browser.

import { smoothstep } from '../core/math.js';
import { Art } from './render.js';
import { SpriteCache } from './sprite-cache.js';
import { ArtUtil } from './util.js';
import { mulberry32 } from '../core/rng.js';

const ArtBodies = (() => {
  const U = ArtUtil;
  const { TAU, clamp, lerp } = U;
  const { LIGHT, BAYER, norm, dot, sub, cross, hash3, noise3, fbm, icosphere, ramp, level, quant, dprOf, canvas, idOf, budget } = Art.kit;
  const conf = () => Art.config;
  const L2 = [LIGHT[0], LIGHT[1]].map((v) => v / Math.hypot(LIGHT[0], LIGHT[1]));
  const smooth = smoothstep;
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

  // ---------- Tiles ----------
  // A nebula is drawn from tiles of TILE × TILE lattice cells, built once in world units and drawn
  // at any zoom, so zooming never rebuilds them. A tile holds a raster of the bands (RES_WU world
  // units per pixel, or the texel in pixel art), drawn without smoothing, and for the line style
  // the isolines, for low-poly the facets, as vector paths. A tile is built from the density on
  // its lattice points, not by sampling the noise per pixel, so it takes a millisecond or two;
  // the tiles just outside the view are built ahead while the frame has budget left. (Nebulae
  // used to be chunks rasterised per pixel at the screen's scale: slow to build, rebuilt at every
  // zoom step, and in low-poly so padded that the cache couldn't hold them.)
  const TILE = 8; // lattice cells per tile side
  const RES_WU = 3; // world units per raster pixel (pixel art: its texel)

  // Density and hue on the tile's lattice points, with a ring of one more cell all round.
  function tileField(neb, G, ti, tj) {
    const n = TILE + 3, i0 = ti * TILE - 1, j0 = tj * TILE - 1, d = new Float32Array(n * n), m = new Float32Array(n * n);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const [a, b] = nebSample(neb, G, (i0 + i) * G.g, (j0 + j) * G.g);
      d[j * n + i] = a;
      m[j * n + i] = b;
    }
    return { n, i0, j0, d, m };
  }

  // The bands as a raster, one pixel of padding all round so smoothing doesn't seam between tiles.
  // colour(lv, hue) -> [r, g, b, a], or null to leave it clear.
  // px: world units per pixel; dither: pixel art's ordered dither on the bands.
  function tileRaster(F, G, px, colour, dither = false) {
    const res = G.g / px, N = Math.max(1, Math.round(TILE * res)) + 2, cv = canvas(N, N), c = cv.getContext('2d'), img = c.createImageData(N, N), D = img.data;
    const r = (N - 2) / TILE; // pixels per cell, exactly
    for (let py = 0; py < N; py++) {
      const fy = (py - 1 + 0.5) / r + 1, j = Math.floor(fy), ty = fy - j;
      for (let qx = 0; qx < N; qx++) {
        const fx = (qx - 1 + 0.5) / r + 1, i = Math.floor(fx), tx = fx - i, k = j * F.n + i;
        const d = lerp(lerp(F.d[k], F.d[k + 1], tx), lerp(F.d[k + F.n], F.d[k + F.n + 1], tx), ty);
        const lv = band(dither ? d + (BAYER[py & 3][qx & 3] - 0.5) * 0.1 : d);
        if (lv < 0) continue;
        const m = lerp(lerp(F.m[k], F.m[k + 1], tx), lerp(F.m[k + F.n], F.m[k + F.n + 1], tx), ty);
        const col = colour(lv, Math.min(3, Math.floor(m * 4)));
        const o = (py * N + qx) * 4;
        D[o] = col[0]; D[o + 1] = col[1]; D[o + 2] = col[2]; D[o + 3] = col[3];
      }
    }
    c.putImageData(img, 0, 0);
    return cv;
  }

  // Flat: the bands in the type's colours.
  function tileFlat(neb, G, T, ti, tj) {
    const F = tileField(neb, G, ti, tj), A = ALPHA[T.dark ? 'dark' : 'normal'];
    const tab = nebTable(T).map((r, lv) => r.map((h) => [...U.hexToRgb(h), Math.round(A[lv] * 255)]));
    return { canvas: tileRaster(F, G, RES_WU, (lv, q) => tab[lv][q]) };
  }

  // Pixel: the same bands at the art's texel size, dithered.
  function tilePixel(neb, G, T, ti, tj, texel) {
    const F = tileField(neb, G, ti, tj), A = ALPHA[T.dark ? 'dark' : 'normal'];
    const tab = nebTable(T).map((r, lv) => r.map((h) => [...U.hexToRgb(h), Math.round(A[lv] * 255)]));
    return { canvas: tileRaster(F, G, texel, (lv, q) => tab[lv][q], true) };
  }

  // Line: a faint fill in the line colour, and the band edges as isolines (marching squares on the
  // lattice), each tile tracing only its own cells.
  function tileLine(neb, G, T, ti, tj) {
    const F = tileField(neb, G, ti, tj), lc = U.hexToRgb(T.line);
    const fill = [0.04, 0.07, 0.1, 0.14].map((a) => [...lc, Math.round(a * 255)]);
    const g = G.g, paths = LEVELS.map((L) => {
      const p = new Path2D();
      for (let jj = 1; jj <= TILE; jj++) for (let ii = 1; ii <= TILE; ii++) {
        const k = jj * F.n + ii, a = F.d[k], b = F.d[k + 1], cc = F.d[k + F.n + 1], d = F.d[k + F.n];
        if ((a >= L) === (b >= L) && (b >= L) === (cc >= L) && (cc >= L) === (d >= L)) continue;
        const x = (F.i0 + ii) * g, y = (F.j0 + jj) * g;
        const at = (va, vb, ax, ay, bx, by) => { if ((va >= L) === (vb >= L)) return null; const t = (L - va) / (vb - va); return [lerp(ax, bx, t), lerp(ay, by, t)]; };
        const e = [at(a, b, x, y, x + g, y), at(b, cc, x + g, y, x + g, y + g), at(d, cc, x, y + g, x + g, y + g), at(a, d, x, y, x, y + g)];
        const seg = (u, v) => { p.moveTo(u[0], u[1]); p.lineTo(v[0], v[1]); };
        const pts = e.filter(Boolean);
        if (pts.length === 2) seg(pts[0], pts[1]);
        else if (pts.length === 4) {
          if (((a + b + cc + d) / 4 >= L) === (a >= L)) { seg(e[0], e[1]); seg(e[2], e[3]); } else { seg(e[0], e[3]); seg(e[1], e[2]); }
        }
      }
      return p;
    });
    return { canvas: tileRaster(F, G, RES_WU, (lv) => fill[lv]), paths, colors: LEVELS.map((_, li) => U.mix(conf().bg, T.line, [0.3, 0.5, 0.75, 1][li])) };
  }

  // Low-poly: a jittered world lattice; density is height. Each cell belongs to the tile holding
  // its origin. Facets are opaque, pre-mixed with the background by their band opacity, their
  // shading in steps so that facets of one colour share a path (a few dozen fills per tile).
  function tileLow(neb, G, T, ti, tj) {
    const L = G.s / 5, S = G.S, x0 = ti * TILE * G.g, y0 = tj * TILE * G.g, W = TILE * G.g;
    const tab = nebTable(T), A = ALPHA[T.dark ? 'dark' : 'normal'], bg = conf().bg, verts = new Map(), groups = new Map();
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
    const ia = Math.ceil(x0 / L), ib = Math.ceil((x0 + W) / L), ja = Math.ceil(y0 / L), jb = Math.ceil((y0 + W) / L);
    for (let j = ja; j < jb; j++) for (let i = ia; i < ib; i++) {
      const v00 = vert(i, j), v10 = vert(i + 1, j), v01 = vert(i, j + 1), v11 = vert(i + 1, j + 1);
      const tris = hash3(i, j, 3, S + 11) < 0.5 ? [[v00, v10, v11], [v00, v11, v01]] : [[v00, v10, v01], [v10, v11, v01]];
      for (const [a, b, q] of tris) {
        const lv = band((a[3] + b[3] + q[3]) / 3);
        if (lv < 0) continue;
        let n = norm(cross(sub(b, a), sub(q, a)));
        if (n[2] < 0) n = n.map((x) => -x);
        const m = (a[4] + b[4] + q[4]) / 3, jit = 0.95 + 0.1 * hash3(i, j, lv + 5, S);
        const lit = Math.round(((0.35 + 0.85 * Math.max(0, dot(n, LIGHT))) * jit) / 0.04) * 0.04;
        const col = U.shade(U.mix(bg, tab[lv][Math.min(3, Math.floor(m * 4))], A[lv]), lit);
        let p = groups.get(col);
        if (!p) groups.set(col, (p = new Path2D()));
        p.moveTo(a[0], a[1]); p.lineTo(b[0], b[1]); p.lineTo(q[0], q[1]); p.closePath();
      }
    }
    return { facets: [...groups], px: 20000 };
  }

  // The tiles in view are drawn raster by raster, then their vector parts all at once: the line
  // style's isolines as one path per density band, low-poly's facets as one path per colour, so a
  // draw strokes 4 paths (line) or a few dozen (low-poly), however many tiles it covers.
  function drawRaster(ctx, t, x0, y0, W) {
    const N = t.canvas.width;
    ctx.drawImage(t.canvas, 1, 1, N - 2, N - 2, x0, y0, W, W);
  }
  function mergeVectors(tiles) {
    const first = tiles[0];
    if (first.paths) {
      const paths = first.paths.map(() => new Path2D());
      for (const t of tiles) t.paths.forEach((p, li) => paths[li].addPath(p));
      return { paths, colors: first.colors };
    }
    if (first.facets) {
      const groups = new Map();
      for (const t of tiles) for (const [col, p] of t.facets) {
        let g = groups.get(col);
        if (!g) groups.set(col, (g = new Path2D()));
        g.addPath(p);
      }
      return { facets: [...groups] };
    }
    return {};
  }
  function drawVectors(ctx, v, ppu) {
    if (v.facets) {
      ctx.lineWidth = 0.75 / ppu;
      ctx.lineJoin = 'round';
      for (const [col, p] of v.facets) { ctx.fillStyle = ctx.strokeStyle = col; ctx.fill(p); ctx.stroke(p); }
    }
    if (v.paths) {
      const lw = Math.max(1, Math.min(1.5 * ppu, 2 * dprOf())) / ppu;
      ctx.lineCap = ctx.lineJoin = 'round';
      v.paths.forEach((p, li) => { ctx.strokeStyle = v.colors[li]; ctx.lineWidth = lw * [0.6, 0.75, 0.9, 1][li]; ctx.stroke(p); });
    }
  }

  const TILE_MAKERS = { line: tileLine, flat: tileFlat, lowpoly: tileLow };

  // The cache key prefix for a cloud's tiles in one style, kept on the cloud (its shape's id is long).
  function tileBase(neb, G, style, texel) {
    const k = `${G.key}|${style}|${style === 'pixel' ? texel : 0}`;
    const keys = neb._tileBase || (neb._tileBase = new Map());
    let base = keys.get(k);
    if (!base) {
      const shape = neb.blobs ? idOf(neb) : `${neb.x},${neb.y},${neb.w},${neb.h}`;
      keys.set(k, (base = `nebtile|${G.key}|${neb.type}|${style}|${style === 'pixel' ? texel : 0}|${shape}`));
    }
    return base;
  }

  const tileInside = (neb, W, ti, tj) => (ti + 1) * W > neb.x && ti * W < neb.x + neb.w && (tj + 1) * W > neb.y && tj * W < neb.y + neb.h;
  // Low-poly facets reach past their tile's right and bottom edges (a cell belongs to the tile
  // holding its origin), so the tiles left of and above a rect draw into it too.
  const overhang = (style) => (style === 'lowpoly' ? 1 : 0);
  // The tiles covering the world rect v (clipped to the cloud), drawn into ctx (which maps world
  // units). Those left out while the frame's budget is spent go in `missing` (a Map, if given),
  // by key: { build, ti, tj } for a later frame.
  function drawTiles(ctx, neb, style, v, force, missing) {
    const T = NEBULAE[neb.type] || NEBULAE.emission, G = nebGrid(neb);
    const mt = ctx.getTransform(), ppu = Math.hypot(mt.a, mt.b), texel = v.texel || conf().texel;
    const vx0 = Math.max(v[0], neb.x), vy0 = Math.max(v[1], neb.y), vx1 = Math.min(v[2], neb.x + neb.w), vy1 = Math.min(v[3], neb.y + neb.h);
    if (vx0 >= vx1 || vy0 >= vy1) return;
    ctx.save();
    const make = style === 'pixel' ? (...a) => tilePixel(...a, texel) : TILE_MAKERS[style] || tileFlat, W = TILE * G.g;
    const base = tileBase(neb, G, style, texel);
    const over = overhang(style);
    const ti0 = Math.floor(vx0 / W) - over, ti1 = Math.floor((vx1 - 1e-6) / W), tj0 = Math.floor(vy0 / W) - over, tj1 = Math.floor((vy1 - 1e-6) / W);
    const tiles = [];
    ctx.imageSmoothingEnabled = false;
    for (let tj = tj0; tj <= tj1; tj++) for (let ti = ti0; ti <= ti1; ti++) {
      if (!tileInside(neb, W, ti, tj)) continue;
      const key = `${base}|${ti},${tj}`, build = () => make(neb, G, T, ti, tj);
      if (!force && budget.over && !cache.has(key)) { if (missing) missing.set(key, { build, ti, tj }); continue; } // built in a later frame
      const t = cache.get(key, build, { force: true });
      if (t.canvas) drawRaster(ctx, t, ti * W, tj * W, W);
      if (t.paths || t.facets) tiles.push(t);
    }
    if (tiles.length) drawVectors(ctx, mergeVectors(tiles), ppu);
    ctx.restore();
  }
  // Build ahead: the ring of tiles just outside the world rect v, while the frame has budget to spare.
  function buildAhead(neb, style, v, texel) {
    const T = NEBULAE[neb.type] || NEBULAE.emission, G = nebGrid(neb), W = TILE * G.g;
    const make = style === 'pixel' ? (...a) => tilePixel(...a, texel) : TILE_MAKERS[style] || tileFlat;
    const base = tileBase(neb, G, style, texel);
    const ti0 = Math.floor(v[0] / W) - 1, ti1 = Math.floor(v[2] / W) + 1, tj0 = Math.floor(v[1] / W) - 1, tj1 = Math.floor(v[3] / W) + 1;
    for (let tj = tj0; tj <= tj1 && !budget.over; tj++) for (let ti = ti0; ti <= ti1 && !budget.over; ti++) {
      if (ti > ti0 && ti < ti1 && tj > tj0 && tj < tj1) continue; // only the ring
      const key = `${base}|${ti},${tj}`;
      if (tileInside(neb, W, ti, tj) && !cache.has(key)) cache.get(key, () => make(neb, G, T, ti, tj), { force: true });
    }
  }

  // ---------- Layer ----------
  // In flight the view moves a little each frame, and drawing every tile in it each frame (and
  // stroking the line style's isolines, filling low-poly's facets) costs far more than the cloud,
  // which barely changes on screen, is worth. So with `layer`, the tiles are drawn into a canvas at
  // the screen's scale covering the view and a margin round it, and a frame only copies the part
  // in view. The canvas wraps round (a world point's pixel is its position modulo the canvas
  // size), so when the view leaves it, it moves to centre on the view by drawing just the strips
  // newly uncovered over the ones left behind; nothing already drawn is copied. Tiles it lacked
  // (waiting for the build budget) are built in the frames after, each drawing its part of the
  // layer as it arrives; while it lacks none, the tiles just outside it are built ahead. It's
  // drawn afresh when the scale, style, texel or view size changes. One layer per cloud, for the last two clouds drawn;
  // positions in its own pixels (world units × its scale), whole ones, so drawing it never
  // resamples between its pieces. (Drawing the tiles every frame cost a nebula filling the screen
  // a third to half of the frame rate on a phone.)
  const LAYER_MARGIN = 0.25; // of the view's size, each side
  const LAYER_MAX_PX = 6e6; // the layer's pixels at most (a finer screen draws it a little coarser)
  let layerGen = 0; // bumped by clearCache, so no layer outlives the tiles it was drawn from
  const layered = []; // the clouds holding a layer, the most recently made last
  const mod = (a, n) => ((a % n) + n) % n;
  // The pieces of the layer-pixel rect [X0, X1) × [Y0, Y1) (no larger than the canvas) where it
  // wraps: fn(canvas x, canvas y, width, height, X, Y) for each.
  function wrapped(L, X0, Y0, X1, Y1, fn) {
    for (let X = X0; X < X1;) {
      const cx = mod(X, L.w), pw = Math.min(X1 - X, L.w - cx);
      for (let Y = Y0; Y < Y1;) {
        const cy = mod(Y, L.h), ph = Math.min(Y1 - Y, L.h - cy);
        fn(cx, cy, pw, ph, X, Y);
        Y += ph;
      }
      X += pw;
    }
  }
  // Draw the tiles in a layer-pixel rect over what the layer held there.
  function fillLayer(L, neb, X0, Y0, X1, Y1) {
    if (X1 <= X0 || Y1 <= Y0) return;
    const c = L.canvas.getContext('2d'), s = L.s;
    wrapped(L, X0, Y0, X1, Y1, (cx, cy, pw, ph, X, Y) => {
      c.save();
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.clearRect(cx, cy, pw, ph);
      c.beginPath();
      c.rect(cx, cy, pw, ph);
      c.clip();
      c.setTransform(s, 0, 0, s, cx - X, cy - Y);
      drawTiles(c, neb, L.style, Object.assign([X / s, Y / s, (X + pw) / s, (Y + ph) / s], { texel: L.texel }), false, L.missing);
      c.restore();
    });
  }
  function drawLayered(ctx, neb, style, view, texel) {
    const mt = ctx.getTransform(), ppu = Math.hypot(mt.a, mt.b);
    const seen = [Math.max(view[0], neb.x), Math.max(view[1], neb.y), Math.min(view[2], neb.x + neb.w), Math.min(view[3], neb.y + neb.h)];
    if (seen[0] >= seen[2] || seen[1] >= seen[3]) return;
    const vw = view[2] - view[0], vh = view[3] - view[1], mx = vw * LAYER_MARGIN, my = vh * LAYER_MARGIN;
    let L = neb._layer;
    if (!L || L.gen !== layerGen || L.ppu !== ppu || L.style !== style || L.texel !== texel || Math.abs(L.vw - vw) > 1 || Math.abs(L.vh - vh) > 1) { // (the view's size, give or take rounding)
      const s = Math.min(ppu, Math.sqrt(LAYER_MAX_PX / ((vw + 2 * mx) * (vh + 2 * my)))); // layer px per world unit
      const w = Math.ceil((vw + 2 * mx) * s), h = Math.ceil((vh + 2 * my) * s);
      const cv = L && L.canvas.width === w && L.canvas.height === h ? L.canvas : canvas(w, h);
      L = neb._layer = { gen: layerGen, ppu, style, texel, vw, vh, s, w, h, canvas: cv, X: 0, Y: 0, missing: new Map(), fresh: true };
      if (layered.includes(neb)) layered.splice(layered.indexOf(neb), 1);
      layered.push(neb);
      while (layered.length > 2) delete layered.shift()._layer;
    }
    const s = L.s;
    // Where the layer should be: centred on the view, in its pixels.
    const X = Math.round((view[0] - mx) * s), Y = Math.round((view[1] - my) * s);
    const covers = !L.fresh && view[0] * s >= L.X && view[1] * s >= L.Y && view[2] * s <= L.X + L.w && view[3] * s <= L.Y + L.h;
    if (L.fresh || !covers) {
      const dx = X - L.X, dy = Y - L.Y;
      if (L.fresh || Math.abs(dx) >= L.w || Math.abs(dy) >= L.h) {
        L.missing.clear();
        fillLayer(L, neb, X, Y, X + L.w, Y + L.h);
      } else {
        // The columns newly uncovered, full height, then the rows newly uncovered between them.
        if (dx > 0) fillLayer(L, neb, L.X + L.w, Y, X + L.w, Y + L.h);
        else fillLayer(L, neb, X, Y, L.X, Y + L.h);
        const cx0 = Math.max(X, L.X), cx1 = Math.min(X, L.X) + L.w;
        if (dy > 0) fillLayer(L, neb, cx0, L.Y + L.h, cx1, Y + L.h);
        else fillLayer(L, neb, cx0, Y, cx1, L.Y);
      }
      L.X = X;
      L.Y = Y;
      L.fresh = false;
    }
    // Build what it lacks, each drawing its part of the layer (with what overhangs from it).
    const W = TILE * nebGrid(neb).g, over = overhang(style);
    for (const [key, m] of L.missing) {
      if (budget.over) break;
      L.missing.delete(key);
      if (!cache.has(key)) cache.get(key, m.build, { force: true });
      fillLayer(L, neb, Math.max(L.X, Math.floor(m.ti * W * s)), Math.max(L.Y, Math.floor(m.tj * W * s)),
        Math.min(L.X + L.w, Math.ceil((m.ti + 1 + over) * W * s)), Math.min(L.Y + L.h, Math.ceil((m.tj + 1 + over) * W * s)));
    }
    if (!L.missing.size) buildAhead(neb, style, [L.X / s, L.Y / s, (L.X + L.w) / s, (L.Y + L.h) / s], texel);
    // Only the part in view.
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    const X0 = Math.max(L.X, Math.floor(seen[0] * s)), Y0 = Math.max(L.Y, Math.floor(seen[1] * s));
    const X1 = Math.min(L.X + L.w, Math.ceil(seen[2] * s)), Y1 = Math.min(L.Y + L.h, Math.ceil(seen[3] * s));
    wrapped(L, X0, Y0, X1, Y1, (cx, cy, pw, ph, px, py) => ctx.drawImage(L.canvas, cx, cy, pw, ph, px / s, py / s, pw / s, ph / s));
    ctx.restore();
  }

  function drawNebula(ctx, neb, style, o = {}) {
    const texel = o.texel || conf().texel;
    if (o.layer && o.view && !o.force) { drawLayered(ctx, neb, style, o.view, texel); return; }
    const v = Object.assign([...(o.view || [neb.x, neb.y, neb.x + neb.w, neb.y + neb.h])], { texel });
    drawTiles(ctx, neb, style, v, o.force);
    if (!o.force) buildAhead(neb, style, v, texel);
  }

  // ---------- Gas pockets ----------
  // A pocket's density is a few soft puffs, broken up by noise, sampled on a lattice over the
  // sprite and banded like a nebula's, but brighter: an outer layer reaching the middle bands and
  // a core reaching the top one. Each layer is a sprite of its own, so they can turn apart.
  const GAS_EXT = 1.25; // the sprite's half-width, in pocket radii
  const GAS_N = 36; // lattice cells across the sprite
  function gasField(gas, layer) {
    const r = mulberry32((gas.seed || 1) + (layer === 'core' ? 7919 : 0)), S = (gas.seed || 1) % 9973 + (layer === 'core' ? 31 : 0);
    const puffs = layer === 'core'
      ? [[0, 0, 0.3, 0.9], ...Array.from({ length: 4 }, () => { const a = r() * TAU, d = 0.12 + r() * 0.2; return [Math.cos(a) * d, Math.sin(a) * d, 0.14 + r() * 0.1, 0.45 + r() * 0.3]; })]
      : Array.from({ length: 6 + Math.floor(r() * 3) }, (_, i) => i).map((i, _, all) => {
        const a = (i / all.length) * TAU + r() * 0.8, d = 0.2 + r() * 0.35;
        return [Math.cos(a) * d, Math.sin(a) * d, 0.3 + r() * 0.22, 0.45 + r() * 0.2];
      });
    const n = GAS_N + 1, d = new Float32Array(n * n), m = new Float32Array(n * n);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const x0 = (i / GAS_N * 2 - 1) * GAS_EXT, y0 = (j / GAS_N * 2 - 1) * GAS_EXT; // in pocket radii
      // Domain-warped, so the puffs curl and fray instead of staying round.
      const x = x0 + (fbm(x0 * 1.3 + 1.7, y0 * 1.3 + 5.1, 1.5, S + 1) - 0.5) * 0.7, y = y0 + (fbm(x0 * 1.3 + 8.3, y0 * 1.3 + 2.9, 2.5, S + 2) - 0.5) * 0.7;
      let v = 0;
      for (const [px, py, pr, pa] of puffs) v += pa * Math.exp(-((x - px) ** 2 + (y - py) ** 2) / (pr * pr));
      const w = fbm(x * 2.4 + 4.1, y * 2.4 + 2.3, 0.5, S);
      v *= 0.35 + 1.3 * w;
      d[j * n + i] = clamp(v * (layer === 'core' ? 0.95 : 0.62), 0, 1) * smooth(0, 1, (GAS_EXT - Math.hypot(x0, y0)) * 3);
      m[j * n + i] = fbm(x * 0.9 + 9, y * 0.9 + 9, 3.5, S + 5);
    }
    return { n, d, m };
  }
  // The field at (fx, fy) in lattice cells, bilinear.
  function gasAt(F, A, fx, fy) {
    const i = Math.min(F.n - 2, Math.max(0, Math.floor(fx))), j = Math.min(F.n - 2, Math.max(0, Math.floor(fy))), tx = fx - i, ty = fy - j, k = j * F.n + i;
    return lerp(lerp(A[k], A[k + 1], tx), lerp(A[k + F.n], A[k + F.n + 1], tx), ty);
  }
  // The bands as a raster N px across (pixel art: dithered); colour(lv, hue) -> [r, g, b, a].
  function gasRaster(F, N, colour, dither) {
    const cv = canvas(N, N), c = cv.getContext('2d'), img = c.createImageData(N, N), D = img.data;
    for (let py = 0; py < N; py++) for (let qx = 0; qx < N; qx++) {
      const fx = ((qx + 0.5) / N) * GAS_N, fy = ((py + 0.5) / N) * GAS_N, dd = gasAt(F, F.d, fx, fy);
      const lv = band(dither ? dd + (BAYER[py & 3][qx & 3] - 0.5) * 0.12 : dd);
      if (lv < 0) continue;
      const col = colour(lv, Math.min(3, Math.floor(gasAt(F, F.m, fx, fy) * 4))), o = (py * N + qx) * 4;
      D[o] = col[0]; D[o + 1] = col[1]; D[o + 2] = col[2]; D[o + 3] = col[3];
    }
    c.putImageData(img, 0, 0);
    return cv;
  }
  // Flat and pixel: the bands in the type's colours, a little denser than a nebula's.
  function gasBands(F, T, N, dither) {
    const A = ALPHA[T.dark ? 'dark' : 'normal'], tab = nebTable(T).map((row, lv) => row.map((hx) => [...U.hexToRgb(hx), Math.round(Math.min(1, A[lv] * 1.15) * 255)]));
    return gasRaster(F, N, (lv, q) => tab[lv][q], dither);
  }
  // Line: a faint fill and the band edges as isolines, on a canvas N px across.
  function gasLine(F, T, N) {
    const lc = U.hexToRgb(T.line), fill = [0.05, 0.09, 0.13, 0.18].map((al) => [...lc, Math.round(al * 255)]);
    const cv = gasRaster(F, N, (lv) => fill[lv], false), c = cv.getContext('2d');
    const g = N / GAS_N;
    c.lineCap = c.lineJoin = 'round';
    LEVELS.forEach((L, li) => {
      c.beginPath();
      for (let jj = 0; jj < GAS_N; jj++) for (let ii = 0; ii < GAS_N; ii++) {
        const k = jj * F.n + ii, a = F.d[k], b = F.d[k + 1], cc = F.d[k + F.n + 1], d = F.d[k + F.n];
        const x = ii * g, y = jj * g;
        const at = (va, vb, ax, ay, bx, by) => { if ((va >= L) === (vb >= L)) return null; const t = (L - va) / (vb - va); return [lerp(ax, bx, t), lerp(ay, by, t)]; };
        const e = [at(a, b, x, y, x + g, y), at(b, cc, x + g, y, x + g, y + g), at(d, cc, x, y + g, x + g, y + g), at(a, d, x, y, x, y + g)].filter(Boolean);
        if (e.length >= 2) { c.moveTo(e[0][0], e[0][1]); c.lineTo(e[1][0], e[1][1]); }
        if (e.length === 4) { c.moveTo(e[2][0], e[2][1]); c.lineTo(e[3][0], e[3][1]); }
      }
      c.strokeStyle = U.mix(conf().bg, T.line, [0.35, 0.55, 0.8, 1][li]);
      c.lineWidth = Math.max(1, N / 220) * [0.7, 0.8, 0.9, 1][li];
      c.stroke();
    });
    return cv;
  }
  // Low-poly: a jittered lattice of translucent facets, one path per colour so they don't seam.
  function gasLow(F, T, N, seed) {
    const cv = canvas(N, N), c = cv.getContext('2d'), M = 12, cell = N / M, A = ALPHA[T.dark ? 'dark' : 'normal'], tab = nebTable(T);
    const V = [];
    for (let j = 0; j <= M; j++) for (let i = 0; i <= M; i++) {
      const edge = i === 0 || j === 0 || i === M || j === M;
      const x = (i + (edge ? 0 : (hash3(i, j, 1, seed) - 0.5) * 0.7)) * cell, y = (j + (edge ? 0 : (hash3(i, j, 2, seed) - 0.5) * 0.7)) * cell;
      V.push([x, y, gasAt(F, F.d, (x / N) * GAS_N, (y / N) * GAS_N), gasAt(F, F.m, (x / N) * GAS_N, (y / N) * GAS_N)]);
    }
    const groups = new Map();
    for (let j = 0; j < M; j++) for (let i = 0; i < M; i++) {
      const v00 = V[j * (M + 1) + i], v10 = V[j * (M + 1) + i + 1], v01 = V[(j + 1) * (M + 1) + i], v11 = V[(j + 1) * (M + 1) + i + 1];
      const tris = hash3(i, j, 3, seed) < 0.5 ? [[v00, v10, v11], [v00, v11, v01]] : [[v00, v10, v01], [v10, v11, v01]];
      for (const [a, b, q] of tris) {
        const lv = band((a[2] + b[2] + q[2]) / 3);
        if (lv < 0) continue;
        const lit = 0.85 + 0.3 * hash3(i, j, a === v00 ? 4 : 5, seed);
        const col = U.shade(tab[lv][Math.min(3, Math.floor(((a[3] + b[3] + q[3]) / 3) * 4))], Math.round(lit / 0.05) * 0.05);
        const key = `${col}|${lv}`;
        let p = groups.get(key);
        if (!p) groups.set(key, (p = { col, lv, path: new Path2D() }));
        p.path.moveTo(a[0], a[1]); p.path.lineTo(b[0], b[1]); p.path.lineTo(q[0], q[1]); p.path.closePath();
      }
    }
    for (const { col, lv, path } of [...groups.values()].sort((x, y) => x.lv - y.lv)) {
      c.globalAlpha = Math.min(1, A[lv] * 1.15);
      c.fillStyle = col;
      c.fill(path);
    }
    return cv;
  }

  function drawGas(ctx, gas, style, o = {}) {
    const { x = 0, y = 0, t = 0 } = o, mt = ctx.getTransform(), ppu = quant(Math.hypot(mt.a, mt.b)), texel = o.texel || conf().texel;
    const T = NEBULAE[gas.type] || NEBULAE.emission, ext = gas.r * GAS_EXT, pixel = style === 'pixel';
    const rr = mulberry32(gas.seed || 1), dir = rr() < 0.5 ? -1 : 1, w = 0.05 + rr() * 0.05, ph = rr() * TAU;
    ctx.save();
    for (const layer of ['outer', 'core']) {
      const key = `gas|${gas.type}|${gas.seed}|${gas.r}|${layer}|${style}|${pixel ? texel : ppu}`;
      const slot = layer === 'core' ? '_gasCore' : '_gasOuter';
      const spr = cache.get(key, () => {
        const F = gasField(gas, layer);
        const N = pixel ? Math.max(8, Math.round((ext * 2) / texel)) : Math.min(Math.ceil(ext * 2 * ppu), conf().maxSprite);
        const cv = pixel || style === 'flat' ? gasBands(F, T, N, pixel) : style === 'line' ? gasLine(F, T, N) : gasLow(F, T, N, (gas.seed || 1) % 9973);
        return { canvas: cv, half: ext, smooth: !pixel };
      }, { fallback: gas[slot], force: o.force });
      if (spr.key === key) gas[slot] = key;
      ctx.save();
      ctx.translate(x, y);
      if (!pixel) { // turning and breathing; pixel art keeps to its grid
        const k = 1 + (layer === 'core' ? 0.05 : 0.03) * Math.sin(t * (layer === 'core' ? 1.1 : 0.7) + ph);
        ctx.rotate(ph + dir * t * w * (layer === 'core' ? -1.7 : 1));
        ctx.scale(k, k);
      }
      ctx.imageSmoothingEnabled = spr.smooth;
      ctx.drawImage(spr.canvas, -spr.half, -spr.half, spr.half * 2, spr.half * 2);
      ctx.restore();
    }
    ctx.restore();
  }

  return {
    MOONS, MOON_TYPES: Object.keys(MOONS), NEBULAE, NEBULA_TYPES: Object.keys(NEBULAE),
    drawMoon, drawNebula, drawGas,
    clearCache: () => { cache.clear(); layerGen++; },
    stats: () => cache.stats(),
  };
})();

export { ArtBodies };
