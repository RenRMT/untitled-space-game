// The race's track: a closed loop round the middle of a square map, and carving it into a generated
// surface (ArtSurface's grid of high-ground corners, W.C, and its props, W.props).
//
// The loop is a polygon of a few seeded corners round the middle, three or four of them pulled in so
// it bends both ways, squeezed a little across so it runs taller than wide, and fitted clear of the
// map's edge. Each corner becomes a kind of racing corner, picked by how far it turns: a kink, a
// sweeper, a square, a hairpin, a double apex, a decreasing-radius bend or a carousel, sized against
// the craft's turning circle at top speed (rv), so a few need a lift; up to two of the longest
// straights get a chicane or esses. The start line is halfway down the longest straight. Layouts
// whose corners won't fit, or whose stretches come closer than `gap` past each other's edges, are
// thrown away; of the first few that do, the best by score() is kept (falling back, if none, to a
// circle wobbled by a few seeded waves). Each stage draws on its own random stream. The width
// follows the corners (wider in sweepers, narrower in chicanes), eased along, held to `minHw`, and
// under half of each bend's radius (so its inside never folds over itself).

//   const tr = Track.loop(seed, { size, hw, minHw, margin, gap, samples, checks, speed, rv })
//     size: the map's side (world units); hw: the track's half-width on a straight (× WIDTH in
//     corners); minHw: the narrowest half-width; margin: kept clear inside the map's edge; gap: kept
//     between two stretches of track, edge to edge (the wall between them; default hw); speed, rv:
//     the craft's top speed and turning circle there (for sizing corners and scoring)
//   tr: { pts: [{ x, y, hw, tx, ty, k, side }], len, ds, cps, samples, from, corners, score }   (tx, ty: the way round; k:
//     the curvature there, 1 / the bend's radius; side: the way it bends, −1 or +1 (+1: the way the
//     angle grows, clockwise on screen); ds: the length a point; cps: the checkpoints' indices, the
//     first the start line; from: 'corners', or 'blob' when no layout of corners would do; corners:
//     [{ type, side, from, apex, to, r }] each corner and wiggle in order round, its points and its
//     tightest radius; score: how the layout scored)
//   Track.measure(tr, { speed, rv }) -> what a track is like (below; tools/race-tracks.js prints it)
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
  const TRIES = 40, KEEP = 6, CORNERS = [7, 11], ACROSS = 0.85, WIDE = 0.85; // layouts tried; good ones scored, the best kept; corners a layout; squeezed across by; and no wider than this of the room
  const TURN = 2.7, PULLED = [3, 4], NEAR = [0.3, 0.5], OUT = [0.75, 1]; // the sharpest corner (radians); corners pulled in; how far out they and the rest are
  // Each kind of corner (or a wiggle in a straight): the track's width there, × hw.
  const WIDTH = { kink: 1, sweeper: 1.15, square: 1.05, hairpin: 1, 'double-apex': 1.1, decreasing: 1, carousel: 1.15, chicane: 0.9, esses: 0.95 };
  const INSERTS = 2, LEAD = 1, REFIT = 1.05; // wiggles in the longest straights at most; the straight kept either side of one, × the turning circle; the most a layout is scaled up after its corners are rounded
  // A random stream for each stage of a layout (its corners' places, their kinds, the wiggles), so
  // a change to one leaves the others as they were.
  const rng = (seed, t, stage) => mulberry32(seed * 7919 + t * 104729 + stage * 15485863 + 13);
  const pick = (r, ws) => { let x = r() * ws.reduce((s, w) => s + w[1], 0); for (const [k, w] of ws) if ((x -= w) < 0) return k; return ws[ws.length - 1][0]; };
  const arc = (turn, r) => ({ turn, r }), line = (l) => ({ l });

  // Where a run of pieces (arcs { turn, r }, straights { l }) ends, from (0, 0) heading h, × f.
  function reach(pieces, h, f = 1) {
    let x = 0, y = 0;
    for (const p of pieces) {
      if (p.l !== undefined) { x += Math.cos(h) * p.l * f; y += Math.sin(h) * p.l * f; continue; }
      const sd = Math.sign(p.turn), cx = x - Math.sin(h) * p.r * f * sd, cy = y + Math.cos(h) * p.r * f * sd;
      h += p.turn; x = cx + Math.sin(h) * p.r * f * sd; y = cy - Math.cos(h) * p.r * f * sd;
    }
    return [x, y, h];
  }

  // A corner turning `turn` (radians, signed): its kind, picked by how far it turns, and its pieces.
  // Radii are measured against rv, the craft's turning circle at top speed: wider bends are flown
  // flat out, tighter ones (squares, hairpins, the tight end of a decreasing bend) need a lift.
  // rMin: the tightest a radius may be, SAFE of the half-width it will have.
  function corner(turn, r, hw, minHw, rv) {
    const a = Math.abs(turn);
    if (a < 0.1) return { type: null, pieces: [], rMin: 0 };
    const type = a < 0.45 ? 'kink'
      : a < 1.4 ? pick(r, [['sweeper', 0.55], ['square', 0.45]])
        : a < 2.2 ? pick(r, [['square', 0.25], ['double-apex', 0.3], ['decreasing', 0.3], ['carousel', 0.15]])
          : pick(r, [['hairpin', 0.6], ['double-apex', 0.15], ['decreasing', 0.15], ['carousel', 0.1]]);
    const rMin = SAFE * 1.05 * Math.max(hw * WIDTH[type], minHw), at = (lo, hi) => Math.max(rMin, rv * (lo + (hi - lo) * r()));
    let pieces;
    if (type === 'kink') pieces = [arc(turn, at(3, 5))];
    else if (type === 'sweeper') pieces = [arc(turn, at(1.3, 2.8))];
    else if (type === 'square') pieces = [arc(turn, at(0.9, 1.2))];
    else if (type === 'carousel') pieces = [arc(turn, at(1.2, 1.7))];
    else if (type === 'hairpin') pieces = [arc(turn, rMin + (Math.max(rMin, 0.85 * rv) - rMin) * r())];
    else if (type === 'double-apex') { const q = at(0.75, 1.1); pieces = [arc(turn / 2, q), line(q * (0.4 + 0.5 * r())), arc(turn / 2, q)]; }
    else { const q = at(0.75, 1); pieces = [arc(turn * 0.45, q * (1.6 + 0.6 * r())), arc(turn * 0.55, q)]; }
    return { type, pieces, rMin };
  }

  // A wiggle in a straight that leaves it on the same line, heading the same way: turn th one way,
  // a straight s, 2·th back, s, th again. A chicane swings across more than the track is wide (so it
  // can't be flown straight) on tight arcs; esses swing gently on wide ones.
  function wiggle(r, hw, minHw, rv) {
    const type = r() < 0.55 ? 'chicane' : 'esses', sd = r() < 0.5 ? -1 : 1, rMin = SAFE * 1.05 * Math.max(hw * WIDTH[type], minHw);
    const th = type === 'chicane' ? 0.7 + 0.25 * r() : 0.45 + 0.25 * r(), q = Math.max(rMin, rv * (type === 'chicane' ? 0.7 + 0.2 * r() : 1.1 + 0.5 * r()));
    const s = type === 'chicane' ? Math.max(0.3 * hw, (1.6 * hw * WIDTH.chicane - 2 * q * (1 - Math.cos(th))) / Math.sin(th)) : 0;
    return { type, side: sd, rMin, pieces: [arc(sd * th, q), line(s), arc(-2 * sd * th, q), line(s), arc(sd * th, q)], len: 4 * q * Math.sin(th) + 2 * s * Math.cos(th) };
  }

  function loop(seed, o) {
    const { size, hw, minHw = 0, margin = 0, gap = hw, samples: S = 720, checks = 16, rv = 2.7 * hw } = o;
    const cps = Array.from({ length: checks }, (_, k) => Math.round((k * S) / checks)), env = { size, hw, minHw, margin, gap, S, cps, rv };
    let best = null;
    for (let t = 0, kept = 0; t < TRIES && kept < KEEP; t++) {
      const tr = corners(seed, t, env);
      if (!tr) continue;
      kept++;
      tr.score = score(measure(tr, o));
      if (!best || tr.score > best.score) best = tr;
    }
    return best || blob(rng(seed, 0, 0), env);
  }

  // Points scaled about their middle to fill the room inside `lo` of the map's edge: its height
  // first, no wider than WIDE of it, and scaled by no more than `most`. -> the scale
  function fit(P, size, lo, most = Infinity) {
    const xs = P.map((v) => v.x), ys = P.map((v) => v.y), room = size - 2 * lo;
    const bw = Math.max(...xs) - Math.min(...xs), bh = Math.max(...ys) - Math.min(...ys), k = Math.min(room / bh, (WIDE * room) / bw, most);
    const mx = (Math.max(...xs) + Math.min(...xs)) / 2, my = (Math.max(...ys) + Math.min(...ys)) / 2;
    for (const v of P) { v.x = size / 2 + (v.x - mx) * k; v.y = size / 2 + (v.y - my) * k; }
    return k;
  }

  // A layout, or null when it won't do. A polygon of corners round the middle, a few of them pulled
  // in (so the loop bends both ways); each corner a kind (corner()) placed where its way in and out
  // lie along the polygon's edges; a wiggle (wiggle()) in up to INSERTS of the longest straights.
  function corners(seed, t, { size, hw, minHw, margin, gap, S, cps, rv }) {
    const rl = rng(seed, t, 1), rc = rng(seed, t, 2), rx = rng(seed, t, 3);
    const K = CORNERS[0] + Math.floor(rl() * (CORNERS[1] - CORNERS[0] + 1)), rot = rl() * TAU;
    const nIn = PULLED[0] + Math.floor(rl() * (PULLED[1] - PULLED[0] + 1)), pulled = new Set();
    for (let k = 0; k < 20 && pulled.size < nIn; k++) { const i = Math.floor(rl() * K); if (!pulled.has((i + 1) % K) && !pulled.has((i + K - 1) % K)) pulled.add(i); }
    const V = [];
    for (let i = 0; i < K; i++) {
      const th = rot + ((i + 0.6 * (rl() - 0.5)) / K) * TAU, [a, b] = pulled.has(i) ? NEAR : OUT, d = a + (b - a) * rl();
      V.push({ x: Math.cos(th) * d * ACROSS, y: Math.sin(th) * d });
    }
    const lo = margin + 1.25 * Math.max(hw, minHw);
    fit(V, size, lo);
    // Each corner: the way in and out, how far it turns, its kind and pieces, and how far back
    // along the way in it starts (tin) and on along the way out it ends (tout), at scale f.
    const C = V.map((v, i) => {
      const a = V[wrap(i - 1, K)], b = V[(i + 1) % K];
      const ai = Math.atan2(v.y - a.y, v.x - a.x), ao = Math.atan2(b.y - v.y, b.x - v.x), turn = angleDiff(ao, ai);
      return { v, ai, ao, turn, l: Math.hypot(b.x - v.x, b.y - v.y), f: 1, ...corner(turn, rc, hw, minHw, rv) };
    });
    if (C.some((c) => Math.abs(c.turn) > TURN)) return null;
    for (const c of C) {
      if (!c.pieces.length) { c.tin = c.tout = 0; continue; }
      const [dx, dy] = reach(c.pieces, c.ai), det = Math.sin(c.turn);
      c.tin = (dx * Math.sin(c.ao) - dy * Math.cos(c.ao)) / det; c.tout = (Math.cos(c.ai) * dy - Math.sin(c.ai) * dx) / det;
      if (c.tin < 0 || c.tout < 0) return null;
    }
    // Two corners must fit on the edge between them: both shrunk alike when they don't.
    for (let i = 0; i < K; i++) {
      const c = C[i], n = C[(i + 1) % K];
      if (c.tout + n.tin > c.l) { const f = c.l / (c.tout + n.tin); for (const q of [c, n]) { q.f *= f; q.tin *= f; q.tout *= f; } }
    }
    if (C.some((c) => c.pieces.some((p) => p.r && p.r * c.f < c.rMin))) return null;
    // Wiggles in the longest straights, each with LEAD of straight before and after.
    const free = C.map((c, i) => ({ i, l: c.l - c.tout - C[(i + 1) % K].tin })).sort((p, q) => q.l - p.l);
    for (const { i, l } of free.slice(0, INSERTS)) {
      const w = wiggle(rx, hw, minHw, rv);
      if (rx() < 0.75 && l >= w.len + 2 * LEAD * rv) C[i].ins = w;
    }
    // The path: each corner's pieces from where it starts, then the straight to the next (with its
    // wiggle); `marks`: where each corner and wiggle lies along it.
    const segs = [], marks = [];
    let at = 0, x = 0, y = 0, h = 0;
    const lineTo = (x1, y1) => { const len = Math.hypot(x1 - x, y1 - y); if (len > 1e-6) segs.push({ arc: false, x0: x, y0: y, x1, y1, len }); at += len; x = x1; y = y1; };
    const walk = (pieces, f, type, side) => {
      const s0 = at;
      let rMin = Infinity;
      for (const p of pieces) {
        if (p.l !== undefined) { lineTo(x + Math.cos(h) * p.l * f, y + Math.sin(h) * p.l * f); continue; }
        const sd = Math.sign(p.turn), rad = p.r * f, cx = x - Math.sin(h) * rad * sd, cy = y + Math.cos(h) * rad * sd;
        segs.push({ arc: true, cx, cy, rad, a0: Math.atan2(y - cy, x - cx), da: p.turn, len: rad * Math.abs(p.turn) });
        at += rad * Math.abs(p.turn); h += p.turn; x = cx + Math.sin(h) * rad * sd; y = cy - Math.cos(h) * rad * sd; rMin = Math.min(rMin, rad);
      }
      if (type) marks.push({ type, side, s0, s1: at, r: rMin });
    };
    const start = (c) => [c.v.x - Math.cos(c.ai) * c.tin, c.v.y - Math.sin(c.ai) * c.tin];
    [x, y] = start(C[0]);
    C.forEach((c, i) => {
      h = c.ai;
      walk(c.pieces, c.f, c.type, Math.sign(c.turn));
      const [nx, ny] = start(C[(i + 1) % K]);
      if (c.ins) {
        h = c.ao;
        const half = (Math.hypot(nx - x, ny - y) - c.ins.len) / 2;
        lineTo(x + Math.cos(h) * half, y + Math.sin(h) * half);
        walk(c.ins.pieces, 1, c.ins.type, c.ins.side);
      }
      lineTo(nx, ny);
    });
    const len = at;
    // From halfway down the longest straight, S points evenly round.
    let s0 = 0, best = -1;
    for (let s = 0, i = 0; i < segs.length; s += segs[i].len, i++) if (!segs[i].arc && segs[i].len > best) { best = segs[i].len; s0 = s + segs[i].len / 2; }
    const pts = [];
    for (let n = 0, i = 0, s = 0; n < S; n++) {
      const u = (s0 + (n * len) / S) % len;
      if (n && u < (s0 + ((n - 1) * len) / S) % len) { i = 0; s = 0; } // round past the end of the path
      while (u > s + segs[i].len && i < segs.length - 1) { s += segs[i].len; i++; }
      const g = segs[i], f = g.len ? (u - s) / g.len : 0;
      pts.push(g.arc ? { x: g.cx + Math.cos(g.a0 + g.da * f) * g.rad, y: g.cy + Math.sin(g.a0 + g.da * f) * g.rad } : { x: g.x0 + (g.x1 - g.x0) * f, y: g.y0 + (g.y1 - g.y0) * f });
    }
    // The arcs cut the corners in, so fitted to the room again: only ever larger, and only a little,
    // so its bends stay about the sizes picked.
    const k = fit(pts, size, lo, REFIT), idx = (s) => Math.round((wrap(s - s0, len) / len) * S) % S;
    const tr = shape({ pts, samples: S, cps });
    tr.corners = marks.map((m) => ({ type: m.type, side: m.side, from: idx(m.s0), apex: idx((m.s0 + m.s1) / 2), to: idx(m.s1), r: m.r * k }));
    widths(tr, hw, minHw);
    for (let pass = 0, bad; pass < 50 && (bad = tooTight(tr, 10)); pass++) { smooth(pts, 4, bad); shape(tr); }
    return minRadius(tr).r >= SAFE && apart(tr, gap) ? Object.assign(tr, { from: 'corners' }) : null;
  }

  // The half-widths: hw × the kind of corner each point is in (WIDTH; 1 on the straights), eased in
  // and out over WIDE_EASE points either side, and held under 1 / SAFE of each bend's radius (eased
  // too: the least of its neighbours', averaged, never more than it), and at least minHw.
  const WIDE_EASE = 30, LIM_EASE = 12;
  function widths(tr, hw, minHw) {
    const { pts, samples: S } = tr, fac = new Float64Array(S).fill(1);
    for (const c of tr.corners || []) for (let n = c.from; n !== c.to; n = (n + 1) % S) fac[n] = WIDTH[c.type];
    const ease = (v, w) => v.map((_, n) => { let s = 0; for (let m = -w; m <= w; m++) s += v[wrap(n + m, S)]; return s / (2 * w + 1); });
    const lim = pts.map((p) => (p.k > 0 ? 1 / (SAFE * p.k) : Infinity)), least = lim.map((_, n) => { let m = Infinity; for (let d = -LIM_EASE; d <= LIM_EASE; d++) m = Math.min(m, lim[wrap(n + d, S)]); return Math.min(m, 4 * hw); });
    const f = ease(Array.from(fac), WIDE_EASE), l = ease(least, LIM_EASE);
    pts.forEach((p, n) => { p.hw = Math.max(minHw, Math.min(hw * f[n], l[n])); });
  }

  // What a track is like, for scoring layouts and for tools/race-tracks.js. speed (top speed) and rv
  // (its turning circle) as Track.loop's options; lap times only with a speed.
  //   -> { len, lap, bend, oneWay, flips, tight, tightHw, underRv, straight, straightS, straightDeg, hwMin, hwMax, types }
  //   bend: the share of the lap bending; oneWay: the share of the bending that goes the commoner way;
  //   flips: left/right changes; tight: the tightest radius (tightHw: over the half-width there);
  //   underRv: corners tighter than rv; straight: the longest (straightDeg: degrees off vertical);
  //   types: corners (and wiggles) of each kind
  const BENT = 1 / 1500;
  function measure(tr, { speed = 0, rv = 0 } = {}) {
    const { pts, ds, samples: S } = tr, kind = (p) => (p.k > BENT ? p.side : 0);
    const at0 = Math.max(0, pts.findIndex((p, n) => kind(p) !== kind(pts[(n + S - 1) % S]))), runs = [];
    for (let m = 0; m < S; m++) {
      const p = pts[(at0 + m) % S], k = kind(p), last = runs[runs.length - 1];
      if (last && last.k === k) { last.len += ds; last.tx += p.tx; last.ty += p.ty; } else runs.push({ k, len: ds, tx: p.tx, ty: p.ty });
    }
    const bends = runs.filter((r) => r.k), bendLen = bends.reduce((s, r) => s + r.len, 0), one = bends.filter((r) => r.k > 0).reduce((s, r) => s + r.len, 0);
    let flips = 0;
    bends.forEach((r, i) => { if (r.k !== bends[(i + 1) % bends.length].k) flips++; });
    const long = runs.filter((r) => !r.k).reduce((a, r) => (r.len > a.len ? r : a), { len: 0, tx: 0, ty: 1 }), types = {};
    for (const c of tr.corners || []) types[c.type] = (types[c.type] || 0) + 1;
    return {
      len: tr.len, lap: speed ? tr.len / speed : 0, bend: bendLen / tr.len, oneWay: bendLen ? Math.max(one, bendLen - one) / bendLen : 0, flips,
      tight: 1 / Math.max(...pts.map((p) => p.k)), tightHw: minRadius(tr).r, underRv: (tr.corners || []).filter((c) => c.r < rv).length,
      straight: long.len, straightS: speed ? long.len / speed : 0, straightDeg: (Math.atan2(Math.abs(long.tx), Math.abs(long.ty)) * 180) / Math.PI,
      hwMin: Math.min(...pts.map((p) => p.hw)), hwMax: Math.max(...pts.map((p) => p.hw)), types,
    };
  }
  // How good a layout is (more is better): bends both ways, one to three that need a lift, many
  // kinds of corner, a lap of 20–28 s, a long straight that runs up or down the screen (sideways,
  // less of the way ahead is in view).
  function score(m) {
    let s = -10 * Math.max(0, m.oneWay - 0.65) + 0.3 * Math.min(m.flips, 10) + 0.3 * Math.min(Object.keys(m.types).length, 6);
    s += m.underRv >= 1 && m.underRv <= 3 ? 1.5 : m.underRv > 3 ? 0.5 : 0;
    if (m.lap) s -= 0.5 * Math.max(0, 20 - m.lap, m.lap - 28);
    if (m.straightS) s += (m.straightS >= 2 ? 0.5 : 0) - (m.straightS * Math.sin((m.straightDeg * Math.PI) / 180) > 1.5 ? 0.5 : 0);
    return s;
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
  function blob(r, { size, hw, minHw, margin, S, cps }) {
    const c = size / 2, waves = [2, 3, 4, 5].map((k, n) => ({ k, a: [0.15, 0.1, 0.06, 0.035][n] * (0.6 + 0.8 * r()), p: r() * TAU })), ks = [];
    for (let n = 0; n < S; n++) { const th = (n / S) * TAU; ks.push(1 + waves.reduce((s, w) => s + w.a * Math.sin(w.k * th + w.p), 0)); }
    const R0 = (c - 1.25 * hw - margin) / Math.max(...ks);
    const pts = ks.map((k, n) => { const th = (n / S) * TAU; return { x: c + Math.cos(th) * R0 * k * ACROSS, y: c + Math.sin(th) * R0 * k, hw }; });
    const tr = shape({ pts, samples: S, cps });
    for (let pass = 0; pass < 200 && minRadius(tr).r < SAFE; pass++) { smooth(pts, 8); shape(tr); }
    widths(tr, hw, minHw);
    return Object.assign(tr, { corners: [], from: 'blob' });
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

  return { loop, edgeDist, ahead, minRadius, measure, carve };
})();

export { Track };
