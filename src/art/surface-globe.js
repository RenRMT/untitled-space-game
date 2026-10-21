// A planet or moon surface (ArtSurface) drawn bent over a globe round the camera, so the ground
// drops away toward a horizon with space above it. Same camera as the surfaces: orthographic,
// Art.config.tilt from straight down.
//
// The bend is a profile: the ground stays flat out to `flat` world units from the focus (the point
// under the camera), then curves more and more until, past 2·flat, it curves like a sphere of
// radius R. Flat near the ship, so the landing site isn't distorted; round far off, so the horizon
// and the limb read as a globe. (flat 0: a sphere.) The profile is turned round the focus, like a
// lathe: every direction bends the same way.
//
// Ground distances from the focus run along the profile: dy ahead is squeezed on screen until the
// ground turns over at the horizon, dx sideways is squeezed and dropped. The two are applied one
// after the other, so the flat images (layers) are warped in two cheap passes: rows (dy) into an
// offscreen canvas, then columns (dx: each column squeezed, shifted down and sheared to join its
// neighbours). That isn't exactly the turned surface, but close; the turned surface's outline clips
// it and is the limb. Fog fades the ground with distance the same way: exp(−d²/F²) splits into a
// row factor and a column factor. Ground no layer covers is filled with `under`.
//
//   const v = SurfaceGlobe.view({ R, flat, fx, fy, W, H, ox, oy })  // focus (fx, fy) at view (ox, oy); W×H view units
//   SurfaceGlobe.draw(ctx, layers, v, { dpr, fog, fogDist, under })
//   SurfaceGlobe.drawFlat(ctx, layers, v, { dpr, under })  // the same unbent (v's R is ignored): far cheaper
//     layers: ArtSurface layers, drawn in order; a layer's fade: [d0, d1] fades it out from d0 to d1 ahead
//   SurfaceGlobe.toScreen(v, x, y, z) -> [X, Y] | null    // a point on the ground (null: hidden)
//   SurfaceGlobe.limb(v) -> [[X, Y], …] | null              // the globe's outline (null: no horizon)
//   SurfaceGlobe.extent(v) -> { x0, y0, x1, y1, ahead }     // the ground the view can show, world units
//   SurfaceGlobe.horizonDist(v)                             // how far ahead the horizon is
//   const tiles = SurfaceGlobe.tiles(W, style, { size, dpr })  // detailed chunks, built as needed
//   tiles.layers(rect, budgetMs) -> layers                  // the chunks over rect, building the missing nearest first
//                                                           // (layers.missing: how many still aren't built)
//   tiles.warm(rect, budgetMs)                              // works on the missing over rect, nearest first
//   tiles.stats() -> { cached, keep, busy, built, ms, steps } // for a performance readout (built, ms, steps: totals so far)
// Chunks are built a step at a time (ArtSurface.renderRegionSteps), one under way at once, for the
// budget given each call: a frame never has to build a whole one (budgetMs Infinity: all, now).
// One view unit is one world unit; draw the view scaled to zoom, with dpr × zoom. ES module; needs a browser.

import { Art } from './render.js';
import { ArtSurface } from './surface.js';

const SurfaceGlobe = (() => {
  const hex = (c) => [1, 3, 5].map((k) => parseInt(c.slice(k, k + 2), 16));
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const sstep = (a, b, v) => { if (b <= a) return v >= a ? 1 : 0; const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const CAP = 4e4; // the profile's longest reach (a flat view reaches no further)

  // The profile, as a table every ds: heading φ (how far the ground has turned), h (out from the
  // focus) and z (down from it). Lookups past the table's end carry on in a straight line.
  const profiles = new Map();
  function profile(R, flat) {
    const key = R + '/' + flat;
    if (profiles.has(key)) return profiles.get(key);
    const tilt = Art.config.tilt, end = Math.PI / 2 + tilt + 0.02, ds = clamp((2 * flat + R * end) / 3000, 1, 16);
    const kap = (s) => sstep(flat, 2 * flat, s) / R, phi = [0], h = [0], z = [0];
    for (let s = 0, p = 0, x = 0, y = 0; p < end && s < CAP; s += ds) {
      const dp = kap(s + ds / 2) * ds, pm = p + dp / 2; // midpoint rule
      x += Math.cos(pm) * ds; y += Math.sin(pm) * ds; p += dp;
      phi.push(p); h.push(x); z.push(y);
    }
    const n = phi.length, at = (arr, s) => { const f = s / ds, i = Math.floor(f); if (i >= n - 1) return arr[n - 1] + (arr[n - 1] - arr[n - 2]) * (f - n + 1); return arr[i] + (arr[i + 1] - arr[i]) * (f - i); };
    const sAt = (target) => { if (phi[n - 1] < target) return Infinity; let lo = 0, hi = n - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (phi[m] < target) lo = m; else hi = m; } return (lo + (target - phi[lo]) / (phi[hi] - phi[lo] || 1)) * ds; };
    const P = { R, flat, ds, kap, H: (s) => at(h, s), Z: (s) => at(z, s), PHI: (s) => at(phi, s), sH: sAt(Math.PI / 2 - tilt), sQ: sAt(Math.PI / 2), sB: sAt(Math.PI / 2 + tilt) };
    P.hMax = P.sQ < Infinity ? P.H(P.sQ) : Infinity;
    // The arc out to where the ground is x across (x below hMax).
    P.arc = (x) => { let lo = 0, hi = Math.min(P.sQ, CAP); if (P.H(hi) <= x) return hi; for (let k = 0; k < 40; k++) { const m = (lo + hi) / 2; if (P.H(m) < x) lo = m; else hi = m; } return (lo + hi) / 2; };
    profiles.set(key, P);
    if (profiles.size > 12) profiles.delete(profiles.keys().next().value);
    return P;
  }

  function view(o) {
    const t = Art.config.tilt, v = { ...o, st: Math.sin(t), ct: Math.cos(t), P: profile(o.R, o.flat || 0) };
    v.sH = Math.min(v.P.sH, CAP); v.sB = Math.min(v.P.sB, CAP);
    return v;
  }
  const rowY = (v, d) => Math.sign(d) * v.P.H(Math.abs(d)) * v.ct + v.P.Z(Math.abs(d)) * v.st; // ground dy -> view y
  const shift = (v, d) => v.P.Z(Math.abs(d)) * v.st; // ... and the drop for ground dx sideways
  const colX = (v, d) => Math.sign(d) * v.P.H(Math.abs(d)); // ground dx -> view x
  const arc = (v, x) => Math.sign(x) * v.P.arc(Math.abs(x)); // view x -> ground dx
  // The ground distance ahead whose row lands at view y (relative to the focus), within [lo, hi].
  function rowAt(v, y, lo, hi) {
    if (rowY(v, lo) >= y) return lo;
    if (rowY(v, hi) <= y) return hi;
    for (let n = 0; n < 60; n++) { const m = (lo + hi) / 2; if (rowY(v, m) < y) lo = m; else hi = m; }
    return lo;
  }
  const halfA = (v) => { const hw = Math.max(v.ox, v.W - v.ox) + 8; return Math.abs(arc(v, Math.min(hw, v.P.hMax * 0.9999))) + 2; };
  function rows(v) {
    if (!v.rows) {
      const ha = halfA(v), top = rowAt(v, -v.oy - shift(v, ha), -v.sH, 0), bot = Math.min(v.sB, rowAt(v, v.H - v.oy, 0, v.sB) + 40);
      v.rows = { ha, top, bot };
    }
    return v.rows;
  }
  function extent(v) {
    const { ha, top, bot } = rows(v);
    return { x0: v.fx - ha, x1: v.fx + ha, y0: v.fy + top, y1: v.fy + bot, ahead: -top };
  }
  const horizonDist = (v) => v.sH;

  // The outline: where the turned surface's normal is square to the view. On the right half, for
  // each heading φ past the horizon's, the direction round the focus α with sin α = −cot(tilt)/tan φ.
  // Its top is lowered to the warped ground's top where that's lower, so there's no gap under it.
  function outline(v) {
    if (v.out !== undefined) return v.out;
    const P = v.P;
    if (P.sH === Infinity) return (v.out = null);
    const right = [];
    for (let s = P.sH; s <= Math.min(P.sB, CAP); s += P.ds) {
      const p = P.PHI(s), sa = clamp(-v.ct / (v.st * Math.tan(p)), -1, 1), h = P.H(s);
      right.push([h * Math.sqrt(1 - sa * sa), h * sa * v.ct + P.Z(s) * v.st]);
    }
    if (P.sB === Infinity) right.push([right[right.length - 1][0], 1e5]);
    let m = 0;
    for (let k = 1; k < right.length; k++) if (right[k][0] > right[m][0]) m = k;
    const upper = right.slice(0, m + 1), lower = right.slice(m + 1), maxX = right[m][0], sepTop = rowY(v, -v.sH);
    const silTop = (x) => { for (let k = 1; k < upper.length; k++) if (upper[k][0] >= x) { const a = upper[k - 1], b = upper[k], t = (x - a[0]) / (b[0] - a[0] || 1); return a[1] + (b[1] - a[1]) * t; } return upper[upper.length - 1][1]; };
    const hw = Math.max(v.ox, v.W - v.ox) + 8, xr = Math.min(maxX, hw), top = [];
    for (let x = -xr; x <= xr + 0.01; x += 4) {
      const ax = Math.abs(x), sy = ax < P.hMax ? sepTop + shift(v, arc(v, ax)) : -Infinity;
      top.push([v.ox + x, v.oy + Math.max(silTop(ax), sy)]);
    }
    let poly;
    if (maxX > hw) poly = top.concat([[v.ox + hw, 1e5], [v.ox - hw, 1e5]]);
    else poly = top.concat(lower.map(([x, y]) => [v.ox + x, v.oy + y]), lower.slice().reverse().map(([x, y]) => [v.ox - x, v.oy + y]));
    return (v.out = { top, poly, full: maxX <= hw });
  }
  const limb = (v) => { const o = outline(v); return o && (o.full ? o.poly.filter((p) => p[1] < 1e4) : o.top); };
  function topAt(v, X) {
    const o = outline(v); if (!o) return -Infinity;
    const t = o.top, f = (X - t[0][0]) / 4, i = Math.floor(f);
    if (i < 0 || i >= t.length - 1) return Infinity;
    return t[i][1] + (t[i + 1][1] - t[i][1]) * (f - i);
  }

  function toScreen(v, x, y, z = 0) {
    const dx = x - v.fx, dy = (y * v.ct - z * v.st) / v.ct - v.fy;
    if (dy < -v.sH || dy > v.sB || Math.abs(dx) >= v.P.sQ) return null;
    const X = v.ox + colX(v, dx), Y = v.oy + rowY(v, dy) + shift(v, dx);
    return Y >= topAt(v, X) - 0.5 ? [X, Y] : null;
  }

  // drawImage with the source rectangle clipped to the image, the destination clipped to match.
  function blit(ctx, src, sx, sy, sw, sh, dx, dy, dw, dh) {
    const kx = dw / sw, ky = dh / sh, iw = src.width, ih = src.height;
    if (sx < 0) { dx -= sx * kx; dw += sx * kx; sw += sx; sx = 0; }
    if (sy < 0) { dy -= sy * ky; dh += sy * ky; sh += sy; sy = 0; }
    if (sx + sw > iw) { const c = sx + sw - iw; sw -= c; dw -= c * kx; }
    if (sy + sh > ih) { const c = sy + sh - ih; sh -= c; dh -= c * ky; }
    if (sw > 0.01 && sh > 0.01) ctx.drawImage(src, sx, sy, sw, sh, dx, dy, dw, dh);
  }
  const bufs = new WeakMap(); // ctx -> the two offscreen canvases
  function buffer(cv, w, h) {
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; } // resizing clears
    const c = cv.getContext('2d'); c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, w, h);
    return c;
  }
  // A fog gradient over the pixels already drawn: n stops of alpha 1 − exp(−(d/F)²).
  function fogFill(c, grad, n, at, fog, F, rect) {
    for (let m = 0; m <= n; m++) { const [off, d] = at(m / n), a = 1 - Math.exp(-((d / F) ** 2)); grad.addColorStop(clamp(off, 0, 1), `rgba(${fog[0]},${fog[1]},${fog[2]},${a})`); }
    c.globalCompositeOperation = 'source-atop'; c.fillStyle = grad; c.fillRect(...rect); c.globalCompositeOperation = 'source-over';
  }

  function draw(ctx, layers, v, o = {}) {
    const { W, H, ox, oy, ct, fx, fy, P } = v, dpr = o.dpr || 1;
    const fog = o.fog && hex(o.fog), F = o.fogDist || Infinity;
    if (!bufs.has(ctx)) bufs.set(ctx, [document.createElement('canvas'), document.createElement('canvas')]);
    const [A, B] = bufs.get(ctx), { ha, top, bot } = rows(v), aw = 2 * ha;
    // Pass 1, rows: ground dy -> view y, into A, wide enough for every dx on screen. Strips are as
    // tall as keeps the bend between their ends under a third of a pixel.
    const a = buffer(A, Math.ceil(aw * dpr), Math.ceil(H * dpr)); a.setTransform(dpr, 0, 0, dpr, 0, 0);
    const yTop = oy + rowY(v, top);
    a.fillStyle = o.under || Art.config.bg; a.fillRect(0, yTop, aw, H - yTop);
    for (let d = top; d < bot;) {
      const k = P.kap(Math.abs(d)), step = clamp(Math.sqrt(0.7 / (k * dpr + 1e-9)), 2, 64), d1 = Math.min(d + step, bot);
      const Y0 = oy + rowY(v, d), Y1 = oy + rowY(v, d1), p0 = (fy + d) * ct, p1 = (fy + d1) * ct, dm = Math.abs((d + d1) / 2);
      for (const L of layers) {
        if (p1 < L.y0 || (L.h !== undefined && p0 > L.y0 + L.h)) continue;
        const al = L.fade ? 1 - sstep(L.fade[0], L.fade[1], dm) : 1;
        if (al <= 0.01) continue;
        a.globalAlpha = al * (L.alpha ?? 1);
        blit(a, L.canvas, (fx - ha - L.x0) * L.sx, (p0 - L.y0) * L.sy, aw * L.sx, (p1 - p0) * L.sy, 0, Y0, aw, Y1 - Y0 + 1.2 / dpr);
      }
      d = d1;
    }
    a.globalAlpha = 1;
    if (fog && F < Infinity) fogFill(a, a.createLinearGradient(0, yTop, 0, H), 32, (u) => { const d = top + (bot - top) * u; return [(oy + rowY(v, d) - yTop) / (H - yTop), d]; }, fog, F, [0, yTop, aw, H - yTop]);
    // Pass 2, columns (12 device px wide): view x -> ground dx, each column shifted down by its drop,
    // into B. Strips and columns overlap their neighbours by a device pixel, so no seams show.
    const b = buffer(B, Math.ceil(W * dpr), Math.ceil(H * dpr)), cw = 12 / dpr, lim = Math.min(P.hMax * 0.9999, 1e7);
    for (let X = 0; X < W; X += cw) {
      const x0 = clamp(X - ox, -lim, lim), x1 = clamp(Math.min(X + cw, W) - ox, -lim, lim), w = x1 - x0;
      if (w <= 0) continue;
      const d0 = arc(v, x0), d1 = arc(v, x1), s0 = shift(v, d0), s1 = shift(v, d1);
      b.setTransform(dpr, (dpr * (s1 - s0)) / w, 0, dpr, dpr * (ox + x0), dpr * s0);
      blit(b, A, (ha + d0) * dpr, 0, (d1 - d0) * dpr, H * dpr, 0, 0, w + 1.2 / dpr, H);
    }
    b.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (fog && F < Infinity) {
      const x0 = Math.max(0, ox - lim), x1 = Math.min(W, ox + lim);
      fogFill(b, b.createLinearGradient(x0, 0, x1, 0), 32, (u) => [u, arc(v, x0 + (x1 - x0) * u - ox)], fog, F, [0, 0, W, H]);
    }
    const out = outline(v);
    ctx.save();
    if (out) { ctx.beginPath(); out.poly.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); ctx.clip(); }
    ctx.drawImage(B, 0, 0, W, H);
    ctx.restore();
  }

  // Flat: each layer drawn straight where it lies, the focus at (ox, oy). Edges land on whole device
  // pixels (dpr: device px per view unit), so neighbouring chunks meet without a seam.
  function drawFlat(ctx, layers, v, o = {}) {
    const k = o.dpr || 1, snap = (u) => Math.round(u * k) / k;
    ctx.fillStyle = o.under || Art.config.bg; ctx.fillRect(0, 0, v.W, v.H);
    for (const L of layers) {
      const x0 = snap(v.ox + L.x0 - v.fx), y0 = snap(v.oy + L.y0 - v.fy * v.ct);
      const x1 = snap(v.ox + L.x0 - v.fx + L.canvas.width / L.sx), y1 = snap(v.oy + L.y0 - v.fy * v.ct + L.canvas.height / L.sy);
      ctx.globalAlpha = L.alpha ?? 1;
      ctx.drawImage(L.canvas, x0, y0, x1 - x0, y1 - y0);
    }
    ctx.globalAlpha = 1;
  }

  // Detailed chunks of a surface, size × size tiles, built when first asked for and dropped when
  // they haven't been used for a while (keep: how many stay).
  function tiles(W, style, o = {}) {
    const size = o.size || 8, dpr = o.dpr || 1, keep = o.keep || 40, T = ArtSurface.T, ct = Math.cos(Art.config.tilt);
    const map = new Map();
    let frame = 0;
    const key = (ci, cj) => ci * 4096 + cj;
    // The chunks over rect, nearest (rect.cx, rect.cy) first: [ci, cj] each.
    function wanted(rect) {
      const ci0 = Math.max(0, Math.floor(rect.x0 / T / size)), ci1 = Math.min(Math.ceil(W.w / size) - 1, Math.floor(rect.x1 / T / size));
      // Chunks are bands in projected y; rect's ground rows, less a margin for tall things below.
      const cj0 = Math.max(0, Math.floor(rect.y0 / T / size)), cj1 = Math.min(Math.ceil(W.h / size) - 1, Math.floor((rect.y1 + 80 / ct) / T / size));
      const want = [];
      for (let cj = cj0; cj <= cj1; cj++) for (let ci = ci0; ci <= ci1; ci++) want.push([ci, cj, Math.hypot((ci + 0.5) * size * T - rect.cx, (cj + 0.5) * size * T - rect.cy)]);
      return want.sort((p, q) => p[2] - q[2]);
    }
    const region = (ci, cj) => ({ i0: ci * size, j0: cj * size, i1: Math.min(W.w, (ci + 1) * size), j1: Math.min(W.h, (cj + 1) * size), dpr });
    // The chunk being built a step at a time ({ k, gen }), at most one: no frame builds a whole one.
    let job = null;
    const counts = { built: 0, ms: 0, steps: 0 }; // for the performance overlay: chunks finished, time spent and steps taken, so far
    // Works on the chunk under way (or else starts the first of `want` that's missing) for about
    // budgetMs, a step of a few milliseconds at a time; a finished one is kept.
    function pump(want, budgetMs) {
      const t0 = performance.now();
      while (performance.now() - t0 < budgetMs) {
        if (!job) {
          const next = want.find(([ci, cj]) => !map.has(key(ci, cj)));
          if (!next) break;
          job = { k: key(next[0], next[1]), gen: ArtSurface.renderRegionSteps(W, style, region(next[0], next[1])) };
        }
        const r = job.gen.next();
        counts.steps++;
        if (r.done) { r.value.used = frame; map.set(job.k, r.value); job = null; counts.built++; }
      }
      counts.ms += performance.now() - t0;
    }
    function evict() {
      if (map.size > keep) [...map.entries()].sort((p, q) => p[1].used - q[1].used).slice(0, map.size - keep).forEach(([k]) => map.delete(k));
    }
    function layers(rect, budgetMs = 6, fade) {
      frame++;
      const want = wanted(rect), out = [];
      if (budgetMs === Infinity) { // all of them, now
        const t0 = performance.now();
        for (const [ci, cj] of want) if (!map.has(key(ci, cj))) { map.set(key(ci, cj), ArtSurface.renderRegion(W, style, region(ci, cj))); counts.built++; }
        counts.ms += performance.now() - t0;
      } else if (budgetMs > 0) pump(want, budgetMs);
      for (const [ci, cj] of want) {
        const c = map.get(key(ci, cj));
        if (c) { c.used = frame; if (fade) c.fade = fade; out.push(c); }
      }
      out.missing = want.length - out.length;
      evict();
      return out;
    }
    // Works on the missing chunks over rect, nearest first, for about budgetMs; those over it are
    // kept as if just used.
    function warm(rect, budgetMs) {
      const want = wanted(rect);
      if (budgetMs > 0) pump(want, budgetMs);
      for (const [ci, cj] of want) { const c = map.get(key(ci, cj)); if (c) c.used = frame; }
      evict();
    }
    const stats = () => ({ cached: map.size, keep, busy: !!job, ...counts });
    return { layers, warm, stats, size: () => map.size, clear: () => map.clear() };
  }

  return { view, draw, drawFlat, toScreen, limb, extent, horizonDist, tiles };
})();

export { SurfaceGlobe };
