// A planet or moon surface (ArtSurface.render) drawn bent over a globe of radius R around the
// camera, so the ground drops away toward a horizon with space above it. Same camera as the
// surfaces: orthographic, Art.config.tilt from straight down.
//
// Ground distances from the focus (the point under the camera) are arcs on the sphere: dy ahead
// wraps the ground over the top (on screen it is squeezed until it turns over at the horizon,
// R·(π/2 − tilt) ahead), dx sideways wraps it round the sides (R·sin(dx/R) across, dropping by
// R·(1 − cos(dx/R))). The two are applied one after the other, so the cached flat surface is warped
// in two cheap passes: rows (dy) into an offscreen canvas, then columns (dx: each column squeezed,
// shifted down and sheared to join its neighbours). That isn't exactly a sphere, but it stays
// inside the sphere's outline, a circle of radius R, which clips it and is the limb. Fog fades the
// ground with distance the same way: exp(−d²/F²) splits into a row factor and a column factor.
// Ground past the cached surface's edge is filled with `under`.
//
//   const v = SurfaceGlobe.view({ R, fx, fy, W, H, ox, oy })  // focus (fx, fy), world units, at screen (ox, oy); W×H CSS px
//   SurfaceGlobe.draw(ctx, img, v, { dpr, fog, fogDist, under }) // img: ArtSurface.render(); ctx maps CSS px
//   SurfaceGlobe.toScreen(v, x, y, z) -> [X, Y] | null            // null: past the horizon
//   SurfaceGlobe.horizon(v, X) -> Y | null                         // the limb's screen y at screen x
// A very large R draws the surface flat. ES module (`SurfaceGlobe`); needs a browser.

import { Art } from './render.js';

const SurfaceGlobe = (() => {
  const hex = (c) => [1, 3, 5].map((k) => parseInt(c.slice(k, k + 2), 16));
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const bufs = new WeakMap(); // ctx -> the two offscreen canvases

  function view(o) {
    const t = Art.config.tilt, R = o.R;
    // dyH: ground distance ahead to the horizon; dyM: where the rows stop running down the screen.
    return { ...o, st: Math.sin(t), ct: Math.cos(t), dyH: R * (t - Math.PI / 2), dyM: R * (t + Math.PI / 2) };
  }
  const drop = (R, d) => 2 * R * Math.sin(d / (2 * R)) ** 2; // R·(1 − cos(d/R)), exact for huge R
  const rowY = (v, d) => v.R * Math.sin(d / v.R) * v.ct + drop(v.R, d) * v.st; // ground dy ahead -> screen y
  const shift = (v, d) => drop(v.R, d) * v.st; // ... and the drop for ground dx sideways
  const arc = (v, x) => v.R * Math.asin(clamp(x / v.R, -1, 1)); // screen x from the focus -> ground dx
  // The ground distance ahead whose row lands at screen y (relative to the focus), within [lo, hi].
  function rowAt(v, y, lo, hi) {
    if (rowY(v, lo) >= y) return lo;
    if (rowY(v, hi) <= y) return hi;
    for (let n = 0; n < 64; n++) { const m = (lo + hi) / 2; if (rowY(v, m) < y) lo = m; else hi = m; }
    return lo;
  }
  const inDisc = (v, X, Y) => (X - v.ox) ** 2 + (Y - v.oy - v.R * v.st) ** 2 < v.R * v.R;

  function toScreen(v, x, y, z = 0) {
    const dx = x - v.fx, dy = (y * v.ct - z * v.st) / v.ct - v.fy;
    if (dy < v.dyH || dy > v.dyM || Math.abs(dx) >= (Math.PI / 2) * v.R) return null;
    const X = v.ox + v.R * Math.sin(dx / v.R), Y = v.oy + rowY(v, dy) + shift(v, dx);
    return inDisc(v, X, Y) ? [X, Y] : null;
  }
  function horizon(v, X) {
    const x = X - v.ox;
    return Math.abs(x) >= v.R ? null : v.oy + v.R * v.st - Math.sqrt(v.R * v.R - x * x);
  }

  // drawImage with the source rectangle clipped to the image, the destination clipped to match.
  function blit(ctx, src, sx, sy, sw, sh, dx, dy, dw, dh) {
    const kx = dw / sw, ky = dh / sh, iw = src.width, ih = src.height;
    if (sx < 0) { dx -= sx * kx; dw += sx * kx; sw += sx; sx = 0; }
    if (sy < 0) { dy -= sy * ky; dh += sy * ky; sh += sy; sy = 0; }
    if (sx + sw > iw) { const c = sx + sw - iw; sw -= c; dw -= c * kx; }
    if (sy + sh > ih) { const c = sy + sh - ih; sh -= c; dh -= c * ky; }
    if (sw > 0 && sh > 0) ctx.drawImage(src, sx, sy, sw, sh, dx, dy, dw, dh);
  }
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

  function draw(ctx, img, v, o = {}) {
    const { W, H, ox, oy, R, ct, fx, fy } = v, dpr = o.dpr || 1, sd = img.canvas.width / img.w;
    const fog = o.fog && hex(o.fog), F = o.fogDist || Infinity;
    if (!bufs.has(ctx)) bufs.set(ctx, [document.createElement('canvas'), document.createElement('canvas')]);
    const [A, B] = bufs.get(ctx);
    // Pass 1, rows: ground dy -> screen y, into A, which is wide enough for every dx on screen.
    const halfA = R * Math.asin(Math.min(1, Math.max(ox, W - ox) / R)) + 2, aw = 2 * halfA;
    const a = buffer(A, Math.ceil(aw * dpr), Math.ceil(H * dpr)); a.setTransform(dpr, 0, 0, dpr, 0, 0);
    // Rows this far above the screen can still be shifted onto it; 40 below for tall things.
    const dTop = rowAt(v, -oy - shift(v, halfA), v.dyH, 0), dBot = Math.min(v.dyM, rowAt(v, H - oy, 0, v.dyM) + 40);
    const yTop = oy + rowY(v, dTop), step = o.step || 8;
    a.fillStyle = o.under || Art.config.bg; a.fillRect(0, yTop, aw, H - yTop);
    for (let d = dTop; d < dBot; d += step) {
      const d1 = Math.min(d + step, dBot), Y0 = oy + rowY(v, d), Y1 = oy + rowY(v, d1);
      const sy0 = ((fy + d) * ct + img.pad) * sd, sy1 = ((fy + d1) * ct + img.pad) * sd;
      blit(a, img.canvas, (fx - halfA) * sd, sy0, aw * sd, sy1 - sy0, 0, Y0, aw, Y1 - Y0 + 0.75);
    }
    if (fog && F < Infinity) fogFill(a, a.createLinearGradient(0, yTop, 0, H), 24, (u) => { const d = dTop + (dBot - dTop) * u; return [(oy + rowY(v, d) - yTop) / (H - yTop), d]; }, fog, F, [0, yTop, aw, H - yTop]);
    // Pass 2, columns: screen x -> ground dx, each column shifted down by k·dx², into B.
    const b = buffer(B, Math.ceil(W * dpr), Math.ceil(H * dpr)), cw = 8, lim = R * 0.9999;
    for (let X = 0; X < W; X += cw) {
      const x0 = clamp(X - ox, -lim, lim), x1 = clamp(Math.min(X + cw, W) - ox, -lim, lim), w = x1 - x0;
      if (w <= 0) continue;
      const d0 = arc(v, x0), d1 = arc(v, x1), s0 = shift(v, d0), s1 = shift(v, d1);
      b.setTransform(dpr, (dpr * (s1 - s0)) / w, 0, dpr, dpr * (ox + x0), dpr * s0);
      b.drawImage(A, (halfA + d0) * dpr, 0, (d1 - d0) * dpr, H * dpr, 0, 0, w + 0.6, H);
    }
    b.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (fog && F < Infinity) {
      const x0 = Math.max(0, ox - lim), x1 = Math.min(W, ox + lim);
      fogFill(b, b.createLinearGradient(x0, 0, x1, 0), 32, (u) => [u, arc(v, x0 + (x1 - x0) * u - ox)], fog, F, [0, 0, W, H]);
    }
    ctx.save();
    if (R < 1e6) { ctx.beginPath(); ctx.arc(ox, oy + R * v.st, R, 0, Math.PI * 2); ctx.clip(); }
    ctx.drawImage(B, 0, 0, W, H);
    ctx.restore();
  }

  return { view, draw, toScreen, horizon };
})();

export { SurfaceGlobe };
