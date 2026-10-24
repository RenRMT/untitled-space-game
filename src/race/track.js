// The race's track: a closed loop round the middle of a square map, and carving it into a generated
// surface (ArtSurface's grid of high-ground corners, W.C, and its props, W.props).
//
// The loop is a circle wobbled by a few seeded waves, scaled so its widest point stays clear of the
// map's edge, its width wobbling too. It is then smoothed until its tightest bend is wider than the
// track there (so the inside of a bend never folds over itself), and the width is held to `minHw`.
//
//   const tr = Track.loop(seed, { size, hw, minHw, margin, samples, checks })
//     size: the map's side (world units); hw: the track's half-width (±25% round the loop);
//     minHw: the narrowest half-width; margin: kept clear inside the map's edge
//   tr: { pts: [{ x, y, hw, tx, ty, k }], len, ds, cps, samples }   (tx, ty: the way round; k: the
//     curvature there, 1 / the bend's radius; ds: the length a point; cps: the checkpoints' indices,
//     the first the start line)
//   Track.edgeDist(tr, x, y, near?, span?) -> { d, n, nx, ny }   how far (x, y) is outside the track's
//     edge (< 0: on it), the nearest centreline point, and the way out from it (unit); with a guess
//     `near`, only the points within `span` of it are looked at
//   Track.ahead(tr, n, dist) -> n    the centreline point dist further round (back, when < 0)
//   Track.minRadius(tr) -> { r, n }  the tightest bend: its radius over the track's half-width there
//   Track.carve(W, tr, seed, { T, spacing, clear })   rewrites a generated surface round the track
// ES module (`Track`); also runs in Node (the tests).

import { mulberry32 } from '../core/rng.js';

const Track = (() => {
  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const wrap = (n, m) => ((n % m) + m) % m;
  const angleDiff = (a, b) => ((a - b + Math.PI) % TAU + TAU) % TAU - Math.PI;

  // The way round and the curvature at every point, and the loop's length.
  const BEND = 4; // points either side a curvature is measured over
  function shape(tr) {
    const { pts, samples: S } = tr;
    let len = 0;
    pts.forEach((p, n) => {
      const a = pts[wrap(n - 1, S)], b = pts[(n + 1) % S], l = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      p.tx = (b.x - a.x) / l; p.ty = (b.y - a.y) / l;
      len += Math.hypot(b.x - p.x, b.y - p.y);
    });
    pts.forEach((p, n) => {
      const a = pts[wrap(n - BEND, S)], b = pts[(n + BEND) % S];
      p.k = Math.abs(angleDiff(Math.atan2(b.ty, b.tx), Math.atan2(a.ty, a.tx))) / ((2 * BEND * len) / S);
    });
    tr.len = len; tr.ds = len / S;
    return tr;
  }

  function minRadius(tr) {
    let r = Infinity, at = 0;
    tr.pts.forEach((p, n) => { const q = 1 / (p.k * p.hw); if (q < r) { r = q; at = n; } });
    return { r, n: at };
  }

  // A few points' running average round the loop.
  function smooth(pts, w) {
    const S = pts.length, xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
    for (let n = 0; n < S; n++) {
      let sx = 0, sy = 0;
      for (let m = -w; m <= w; m++) { sx += xs[wrap(n + m, S)]; sy += ys[wrap(n + m, S)]; }
      pts[n].x = sx / (2 * w + 1); pts[n].y = sy / (2 * w + 1);
    }
  }

  const SAFE = 2; // the tightest bend's radius, at least this many half-widths (the inside wall stays a wall)
  function loop(seed, o) {
    const { size, hw, minHw = 0, margin = 0, samples: S = 720, checks = 16 } = o;
    const r = mulberry32(seed * 7919 + 13), c = size / 2;
    const waves = [2, 3, 4, 5].map((k, n) => ({ k, a: [0.15, 0.1, 0.06, 0.035][n] * (0.6 + 0.8 * r()), p: r() * TAU }));
    const wk = 2 + Math.floor(r() * 3), wp = r() * TAU, ks = [];
    for (let n = 0; n < S; n++) { const th = (n / S) * TAU; ks.push(1 + waves.reduce((s, w) => s + w.a * Math.sin(w.k * th + w.p), 0)); }
    const R0 = (c - 1.25 * hw - margin) / Math.max(...ks);
    const pts = ks.map((k, n) => {
      const th = (n / S) * TAU;
      return { x: c + Math.cos(th) * R0 * k, y: c + Math.sin(th) * R0 * k, hw: Math.max(minHw, hw * (1 + 0.25 * Math.sin(wk * th + wp))) };
    });
    const tr = shape({ pts, samples: S, cps: Array.from({ length: checks }, (_, k) => Math.round((k * S) / checks)) });
    for (let pass = 0; pass < 200 && minRadius(tr).r < SAFE; pass++) { smooth(pts, 8); shape(tr); }
    return tr;
  }

  function edgeDist(tr, x, y, near = -1, span = tr.samples / 2) {
    const S = tr.samples;
    let best = Infinity, bn = 0, qx = 0, qy = 0;
    const from = near < 0 ? 0 : near - span, to = near < 0 ? S : near + span;
    for (let m = from; m < to; m++) {
      const n = wrap(m, S), a = tr.pts[n], b = tr.pts[(n + 1) % S];
      const ex = b.x - a.x, ey = b.y - a.y, l2 = ex * ex + ey * ey;
      const t = l2 ? clamp(((x - a.x) * ex + (y - a.y) * ey) / l2, 0, 1) : 0;
      const px = a.x + ex * t, py = a.y + ey * t;
      const d = Math.hypot(x - px, y - py) - (a.hw + (b.hw - a.hw) * t);
      if (d < best) { best = d; bn = t < 0.5 ? n : (n + 1) % S; qx = px; qy = py; }
    }
    const l = Math.hypot(x - qx, y - qy), p = tr.pts[bn];
    return l > 1e-6 ? { d: best, n: bn, nx: (x - qx) / l, ny: (y - qy) / l } : { d: best, n: bn, nx: -p.ty, ny: p.tx };
  }

  const ahead = (tr, n, dist) => wrap(n + Math.round(dist / tr.ds), tr.samples);

  // Corners within the track's half-width are opened, a band of corners just outside it is raised
  // into cliffs (the walls), and the ground beyond is left as generated (before anything of the
  // surface is built: ArtSurface keeps its cliff pieces and geometry once made). Cliff edges fall
  // between corners, so corners a little past the edge are opened too, to keep the track about its
  // width. Props in tiles the walls now cover are dropped; on the track, tall props are thinned to
  // spaced obstacles (`spacing` apart, none within `clear` of the start), and holes stay.
  function carve(W, tr, seed, { T, spacing, clear }) {
    const C = W.C, band = (i, j) => T * (1.4 + 0.8 * Math.sin(i * 0.47 + seed) * Math.cos(j * 0.39 - seed * 1.7) + 0.6 * Math.sin((i + j) * 0.23));
    for (let i = 0; i <= W.w; i++) for (let j = 0; j <= W.h; j++) {
      const d = edgeDist(tr, i * T, j * T).d;
      if (d < 0.4 * T) C[i][j] = 0; else if (d < band(i, j)) C[i][j] = 1;
    }
    // W.props is keyed by ArtSurface's tile key, i × 1000 + j.
    const wall = (i, j) => C[i][j] || C[i + 1][j] || C[i][j + 1] || C[i + 1][j + 1], start = tr.pts[0], kept = [];
    for (const key of Object.keys(W.props)) {
      const p = W.props[key], i = Math.floor(key / 1000), j = key % 1000;
      if (!p) continue;
      if (wall(i, j)) { delete W.props[key]; continue; }
      if (p.type === 'small' || edgeDist(tr, p.x, p.y).d > 0) continue; // clutter, or off the track: scenery
      if (Math.hypot(p.x - start.x, p.y - start.y) < clear) { delete W.props[key]; continue; }
      if (p.type !== 'tall') continue;
      if (kept.some((q) => Math.hypot(q.x - p.x, q.y - p.y) < spacing)) delete W.props[key];
      else kept.push(p);
    }
  }

  return { loop, edgeDist, ahead, minRadius, carve };
})();

export { Track };
