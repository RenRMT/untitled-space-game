// The race's track: a closed loop round the middle of a square map, and carving it into a generated
// surface (ArtSurface's grid of high-ground corners, W.C, and its props, W.props).
//
// The loop is a polygon of a few seeded corners round the middle (each its own distance out, so
// some stick out and some cut in), squeezed a little across so it runs taller than wide, and fitted
// clear of the map's edge. Its corners are rounded off as arcs of seeded radii, from hairpins as
// tight as the track allows to sweepers, joined by straights; the start line is halfway down the
// longest straight. A layout whose corners won't fit, or whose stretches come closer than `gap`
// past each other's edges, is thrown away for another (falling back, after enough, to a circle
// wobbled by a few seeded waves). The width wobbles round the loop and is held to `minHw`; a
// bend still tighter than the track is wide there is smoothed (so its inside never folds over
// itself).

//   const tr = Track.loop(seed, { size, hw, minHw, margin, samples, checks })
//     size: the map's side (world units); hw: the track's half-width (±25% round the loop);
//     minHw: the narrowest half-width; margin: kept clear inside the map's edge; gap: kept
//     between two stretches of track, edge to edge (the wall between them; default hw)
//   tr: { pts: [{ x, y, hw, tx, ty, k, side }], len, ds, cps, samples, from }   (tx, ty: the way round; k:
//     the curvature there, 1 / the bend's radius; side: the way it bends, −1 or +1 (+1: the way the
//     angle grows, clockwise on screen); ds: the length a point; cps: the checkpoints' indices, the
//     first the start line; from: 'corners', or 'blob' when no layout of corners would do)
//   Track.edgeDist(tr, x, y, near?, span?) -> { d, n, nx, ny }   how far (x, y) is outside the track's
//     edge (< 0: on it), the nearest centreline point, and the way out from it (unit); with a guess
//     `near`, only the points within `span` of it are looked at
//   Track.ahead(tr, n, dist) -> n    the centreline point dist further round (back, when < 0)
//   Track.minRadius(tr) -> { r, n }  the tightest bend: its radius over the track's half-width there
//   Track.carve(W, tr, seed, { T, runoff, open, outside, kinds })   rewrites a generated surface round the
//     track: the track, its run-off and the walls (outside: 'high' | 'ground'; kinds: { track, off })
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
      const a = pts[wrap(n - BEND, S)], b = pts[(n + BEND) % S], turn = angleDiff(Math.atan2(b.ty, b.tx), Math.atan2(a.ty, a.tx));
      p.k = Math.abs(turn) / ((2 * BEND * len) / S); p.side = turn < 0 ? -1 : 1;
    });
    tr.len = len; tr.ds = len / S;
    return tr;
  }

  function minRadius(tr) {
    let r = Infinity, at = 0;
    tr.pts.forEach((p, n) => { const q = 1 / (p.k * p.hw); if (q < r) { r = q; at = n; } });
    return { r, n: at };
  }

  // A few points' running average round the loop (only at the points `at` picks, when given).
  function smooth(pts, w, at = null) {
    const S = pts.length, xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
    for (let n = 0; n < S; n++) {
      if (at && !at[n]) continue;
      let sx = 0, sy = 0;
      for (let m = -w; m <= w; m++) { sx += xs[wrap(n + m, S)]; sy += ys[wrap(n + m, S)]; }
      pts[n].x = sx / (2 * w + 1); pts[n].y = sy / (2 * w + 1);
    }
  }
  // The bends tighter than SAFE, and `w` points either side of them.
  function tooTight(tr, w) {
    const S = tr.samples, at = new Uint8Array(S);
    let any = false;
    tr.pts.forEach((p, n) => { if (p.k * p.hw > 1 / SAFE) { any = true; for (let m = -w; m <= w; m++) at[wrap(n + m, S)] = 1; } });
    return any && at;
  }

  const SAFE = 2; // the tightest bend's radius, at least this many half-widths (the inside wall stays a wall)
  const TRIES = 60, CORNERS = [8, 13], ACROSS = 0.85, WIDE = 0.85; // layouts tried; corners a layout; squeezed across by; and no wider than this of the room
  const TURN = 2.7, ROUND = [1.15, 4]; // the sharpest corner (radians turned); its arc's radius, × SAFE half-widths (the widest)
  function loop(seed, o) {
    const { size, hw, minHw = 0, margin = 0, gap = hw, samples: S = 720, checks = 16 } = o;
    const r = mulberry32(seed * 7919 + 13), wk = 2 + Math.floor(r() * 3), wp = r() * TAU;
    const width = (th) => Math.max(minHw, hw * (1 + 0.25 * Math.sin(wk * th + wp)));
    const cps = Array.from({ length: checks }, (_, k) => Math.round((k * S) / checks));
    for (let t = 0; t < TRIES; t++) {
      const tr = corners(r, { size, hw, minHw, margin, gap, S, width, cps });
      if (tr) return tr;
    }
    return blob(r, { size, hw, margin, S, width, cps });
  }

  // Points scaled about their middle to fill the room inside `lo` of the map's edge: its height
  // first, no wider than WIDE of it.
  function fit(P, size, lo) {
    const xs = P.map((v) => v.x), ys = P.map((v) => v.y), room = size - 2 * lo;
    const bw = Math.max(...xs) - Math.min(...xs), bh = Math.max(...ys) - Math.min(...ys), k = Math.min(room / bh, (WIDE * room) / bw);
    const mx = (Math.max(...xs) + Math.min(...xs)) / 2, my = (Math.max(...ys) + Math.min(...ys)) / 2;
    for (const v of P) { v.x = size / 2 + (v.x - mx) * k; v.y = size / 2 + (v.y - my) * k; }
  }

  // A layout of corners rounded into arcs, or null when it won't do.
  function corners(r, { size, hw, minHw, margin, gap, S, width, cps }) {
    const K = CORNERS[0] + Math.floor(r() * (CORNERS[1] - CORNERS[0] + 1)), rot = r() * TAU, V = [];
    for (let i = 0; i < K; i++) {
      const th = rot + ((i + 0.7 * (r() - 0.5)) / K) * TAU, d = 0.25 + 0.75 * r();
      V.push({ x: Math.cos(th) * d * ACROSS, y: Math.sin(th) * d });
    }
    const lo = margin + 1.25 * Math.max(hw, minHw);
    fit(V, size, lo);
    // Each corner: the way in and out, how far it turns, its arc's radius and how far back from
    // the corner the arc starts (t); two corners' arcs must fit on the edge between them.
    const rMin = SAFE * ROUND[0] * Math.max(1.25 * hw, minHw);
    const C = V.map((v, i) => {
      const a = V[wrap(i - 1, K)], b = V[(i + 1) % K], l = Math.hypot(b.x - v.x, b.y - v.y);
      const ai = Math.atan2(v.y - a.y, v.x - a.x), ao = Math.atan2(b.y - v.y, b.x - v.x), turn = angleDiff(ao, ai);
      return { v, l, ai, ao, turn, rad: rMin * (1 + (ROUND[1] / ROUND[0] - 1) * r() ** 3) };
    });
    if (C.some((c) => Math.abs(c.turn) > TURN)) return null;
    for (let i = 0; i < K; i++) {
      const c = C[i], n = C[(i + 1) % K], tc = c.rad * Math.tan(Math.abs(c.turn) / 2), tn = n.rad * Math.tan(Math.abs(n.turn) / 2);
      if (tc + tn > c.l) { const f = c.l / (tc + tn); c.rad *= f; n.rad *= f; }
    }
    if (C.some((c) => c.rad < rMin)) return null;
    // The path: each corner's arc, then the straight to the next.
    const segs = [];
    C.forEach((c, i) => {
      const t = c.rad * Math.tan(Math.abs(c.turn) / 2), side = Math.sign(c.turn) || 1;
      const ax = c.v.x - Math.cos(c.ai) * t, ay = c.v.y - Math.sin(c.ai) * t;
      const cx = ax - Math.sin(c.ai) * side * c.rad, cy = ay + Math.cos(c.ai) * side * c.rad;
      segs.push({ arc: true, cx, cy, rad: c.rad, a0: Math.atan2(ay - cy, ax - cx), da: c.turn, len: c.rad * Math.abs(c.turn) });
      const n = C[(i + 1) % K], tn = n.rad * Math.tan(Math.abs(n.turn) / 2);
      const x0 = c.v.x + Math.cos(c.ao) * t, y0 = c.v.y + Math.sin(c.ao) * t, x1 = n.v.x - Math.cos(n.ai) * tn, y1 = n.v.y - Math.sin(n.ai) * tn;
      segs.push({ arc: false, x0, y0, x1, y1, len: Math.hypot(x1 - x0, y1 - y0) });
    });
    const len = segs.reduce((s, g) => s + g.len, 0);
    // From halfway down the longest straight, S points evenly round.
    let s0 = 0, best = -1;
    for (let at = 0, i = 0; i < segs.length; at += segs[i].len, i++) if (!segs[i].arc && segs[i].len > best) { best = segs[i].len; s0 = at + segs[i].len / 2; }
    const pts = [];
    for (let n = 0, i = 0, at = 0; n < S; n++) {
      let s = (s0 + (n * len) / S) % len;
      if (n && s < (s0 + ((n - 1) * len) / S) % len) { i = 0; at = 0; } // round past the end of the path
      while (s > at + segs[i].len && i < segs.length - 1) { at += segs[i].len; i++; }
      const g = segs[i], f = g.len ? (s - at) / g.len : 0;
      const p = g.arc ? { x: g.cx + Math.cos(g.a0 + g.da * f) * g.rad, y: g.cy + Math.sin(g.a0 + g.da * f) * g.rad } : { x: g.x0 + (g.x1 - g.x0) * f, y: g.y0 + (g.y1 - g.y0) * f };
      p.hw = width((n / S) * TAU);
      pts.push(p);
    }
    // The arcs cut the corners in, so fitted to the room again (only ever larger: its bends wider).
    fit(pts, size, lo);
    const tr = shape({ pts, samples: S, cps });
    for (let pass = 0, at; pass < 50 && (at = tooTight(tr, 10)); pass++) { smooth(pts, 4, at); shape(tr); }
    return minRadius(tr).r >= SAFE && apart(tr, gap) ? Object.assign(tr, { from: 'corners' }) : null;
  }

  // No two stretches of the loop (further apart round it than they could be on its bends) closer
  // than their half-widths and `gap`: every 4th point looked at.
  function apart(tr, gap) {
    const { pts, samples: S, ds } = tr, hmax = Math.max(...pts.map((p) => p.hw)), skip = Math.ceil((1.6 * (2 * hmax + gap)) / ds);
    for (let a = 0; a < S; a += 4) for (let b = a + skip; b < S; b += 4) {
      if (S - (b - a) < skip) break;
      const p = pts[a], q = pts[b];
      if (Math.hypot(p.x - q.x, p.y - q.y) < p.hw + q.hw + gap) return false;
    }
    return true;
  }

  // A circle wobbled by a few seeded waves, scaled so its widest point stays clear of the map's
  // edge, then smoothed until its tightest bend is wide enough.
  function blob(r, { size, hw, margin, S, width, cps }) {
    const c = size / 2, waves = [2, 3, 4, 5].map((k, n) => ({ k, a: [0.15, 0.1, 0.06, 0.035][n] * (0.6 + 0.8 * r()), p: r() * TAU })), ks = [];
    for (let n = 0; n < S; n++) { const th = (n / S) * TAU; ks.push(1 + waves.reduce((s, w) => s + w.a * Math.sin(w.k * th + w.p), 0)); }
    const R0 = (c - 1.25 * hw - margin) / Math.max(...ks);
    const pts = ks.map((k, n) => { const th = (n / S) * TAU; return { x: c + Math.cos(th) * R0 * k * ACROSS, y: c + Math.sin(th) * R0 * k, hw: width(th) }; });
    const tr = shape({ pts, samples: S, cps });
    for (let pass = 0; pass < 200 && minRadius(tr).r < SAFE; pass++) { smooth(pts, 8); shape(tr); }
    tr.from = 'blob';
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

  // Three zones, before anything of the surface is built (ArtSurface keeps its cliff pieces and
  // geometry once made): the track; its run-off, `runoff` past the edge; then the wall. Corners out to
  // the run-off's edge and `open` past it are opened (cliff edges fall between corners, so the extra
  // keeps them off the run-off); beyond, with outside 'high', every corner is high ground (the track
  // runs through a canyon), with 'ground' a band of cliffs then the ground as generated. The track's
  // corners take ground kind kinds.track and the run-off's kinds.off (ArtSurface's a, b, c: G, G2), as
  // do all beyond with 'high' (so no other kind, a sea or a lava flow, blends in at the run-off's edge).
  // Nothing is left on the track: props on it and tall props and holes on the run-off are dropped
  // (clutter on the run-off stays, as rough ground), and so is every prop where the walls now are.
  // A kind's G and G2. Corners between two kinds blend both weights, so c (any G) takes the G of the
  // other kind laid beside it: no third kind (a sea, a lava flow) shows between the two.
  const KIND = { a: [1, 0], b: [0, 0], c: [1, 1] };
  function carve(W, tr, seed, { T, runoff, open = 0.4 * T, outside = 'high', kinds = { track: 'b', off: 'c' } }) {
    const { C, G, G2 } = W, edge = runoff + open, band = (i, j) => edge + T * (1 + 0.8 * Math.sin(i * 0.47 + seed) * Math.cos(j * 0.39 - seed * 1.7) + 0.6 * Math.sin((i + j) * 0.23));
    const lay = (i, j, k) => { const o = k === kinds.track ? kinds.off : kinds.track; G[i][j] = k === 'c' && o !== 'c' ? KIND[o][0] : KIND[k][0]; G2[i][j] = KIND[k][1]; };
    for (let i = 0; i <= W.w; i++) for (let j = 0; j <= W.h; j++) {
      const d = edgeDist(tr, i * T, j * T).d;
      if (d < edge) C[i][j] = 0; else if (outside === 'high' || d < band(i, j)) C[i][j] = 1;
      if (d < 0) lay(i, j, kinds.track); else if (d < runoff + T || outside === 'high') lay(i, j, kinds.off);
    }
    // W.props is keyed by ArtSurface's tile key, i × 1000 + j.
    const wall = (i, j) => C[i][j] || C[i + 1][j] || C[i][j + 1] || C[i + 1][j + 1];
    for (const key of Object.keys(W.props)) {
      const p = W.props[key], i = Math.floor(key / 1000), j = key % 1000;
      if (!p) continue;
      if (wall(i, j)) { delete W.props[key]; continue; }
      const d = edgeDist(tr, p.x ?? (i + 0.5) * T, p.y ?? (j + 0.5) * T).d;
      if (p.type === 'small' ? d < 0 : d < runoff + (p.r || 0) + T) delete W.props[key];
    }
  }

  return { loop, edgeDist, ahead, minRadius, carve };
})();

export { Track };
