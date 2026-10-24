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
//
// The advanced style (style: 'advanced') lays the polygon out the way real circuits are instead of
// round the middle: a base shape (long, block, wedge or L) with a few edges reworked into fingers
// that run out and back, bays that fold in, shallow steps, a technical sector of square corners and
// kinked straights (skeleton()); the rest is as above, scored also for how far it folds in on
// itself. When none will do it falls back to the regular style.
//
// The expert style (style: 'expert') goes further: the polygon is the outline of a branchy clump of
// cells on an uneven grid (grid()), so it folds in on itself everywhere, fingers out and back and
// bays in, its corners nudged off square. They are kept tight (square, hairpin, decreasing, sized
// down to the tightest the width allows), all but the longest straight broken by chicanes, and the
// layouts scored for one or two long straights, none too long. It falls back to the advanced style.

//   const tr = Track.loop(seed, { size, hw, minHw, margin, gap, samples, checks, speed, rv, style })
//     size: the map's side (world units); hw: the track's half-width on a straight (× WIDTH in
//     corners); minHw: the narrowest half-width; margin: kept clear inside the map's edge; gap: kept
//     between two stretches of track, edge to edge (the wall between them; default hw); speed, rv:
//     the craft's top speed and turning circle there (for sizing corners and scoring); style:
//     'regular' (the default), 'advanced' or 'expert'; lap: the lap a layout is scored for, [shortest,
//     longest] s at top speed (default 20–28 s regular, 22–32 s advanced, 28–40 s expert)
//   tr: { pts: [{ x, y, hw, tx, ty, k, side }], len, ds, cps, samples, from, corners, score }   (tx, ty: the way round; k:
//     the curvature there, 1 / the bend's radius; side: the way it bends, −1 or +1 (+1: the way the
//     angle grows, clockwise on screen); ds: the length a point; cps: the checkpoints' indices, the
//     first the start line; from: 'corners', 'skeleton' (advanced), 'grid' (expert), or 'blob' when no layout would do; corners:
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
  const LAP = [20, 28]; // the lap a layout is scored for (s at top speed), unless asked for another
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

  // The kinds a corner may be, by how far it turns: under 1.4 rad, under 2.2, more.
  const KINDS = [
    [['sweeper', 0.55], ['square', 0.45]],
    [['square', 0.25], ['double-apex', 0.3], ['decreasing', 0.3], ['carousel', 0.15]],
    [['hairpin', 0.6], ['double-apex', 0.15], ['decreasing', 0.15], ['carousel', 0.1]],
  ];
  // A corner turning `turn` (radians, signed): its kind, picked by how far it turns, and its pieces.
  // Radii are measured against rv, the craft's turning circle at top speed: wider bends are flown
  // flat out, tighter ones (squares, hairpins, the tight end of a decreasing bend) need a lift.
  // rMin: the tightest a radius may be, SAFE of the half-width it will have. ws: the kinds to pick
  // from (KINDS, ADV.KINDS, EXP.KINDS); sharp: the slow corners' radii × this (the expert style's
  // are tighter); tight: a square whatever the roll (a fingertip's or a technical sector's).
  function corner(turn, r, hw, minHw, rv, ws = KINDS, tight = false, sharp = 1) {
    const a = Math.abs(turn);
    if (a < 0.1) return { type: null, pieces: [], rMin: 0 };
    const type = a < 0.45 ? 'kink' : tight && a < 2.2 ? 'square' : pick(r, a < 1.4 ? ws[0] : a < 2.2 ? ws[1] : ws[2]);
    const rMin = SAFE * 1.05 * Math.max(hw * WIDTH[type], minHw), at = (lo, hi, k = sharp) => Math.max(rMin, rv * k * (lo + (hi - lo) * r()));
    let pieces;
    if (type === 'kink') pieces = [arc(turn, at(3, 5, 1))];
    else if (type === 'sweeper') pieces = [arc(turn, at(1.3, 2.8, 1))];
    else if (type === 'square') pieces = [arc(turn, at(0.9, 1.2))];
    else if (type === 'carousel') pieces = [arc(turn, at(1.2, 1.7, 1))];
    else if (type === 'hairpin') pieces = [arc(turn, rMin + (Math.max(rMin, 0.85 * rv * sharp) - rMin) * r())];
    else if (type === 'double-apex') { const q = at(0.75, 1.1); pieces = [arc(turn / 2, q), line(q * (0.4 + 0.5 * r())), arc(turn / 2, q)]; }
    else { const q = at(0.75, 1); pieces = [arc(turn * 0.45, q * (1.6 + 0.6 * r())), arc(turn * 0.55, q)]; }
    return { type, pieces, rMin };
  }

  // A wiggle in a straight that leaves it on the same line, heading the same way: turn th one way,
  // a straight s, 2·th back, s, th again. A chicane swings across more than the track is wide (so it
  // can't be flown straight) on tight arcs; esses swing gently on wide ones. chicanes: the odds of a chicane.
  function wiggle(r, hw, minHw, rv, chicanes = 0.55) {
    const type = r() < chicanes ? 'chicane' : 'esses', sd = r() < 0.5 ? -1 : 1, rMin = SAFE * 1.05 * Math.max(hw * WIDTH[type], minHw);
    const th = type === 'chicane' ? 0.7 + 0.25 * r() : 0.45 + 0.25 * r(), q = Math.max(rMin, rv * (type === 'chicane' ? 0.7 + 0.2 * r() : 1.1 + 0.5 * r()));
    const s = type === 'chicane' ? Math.max(0.3 * hw, (1.6 * hw * WIDTH.chicane - 2 * q * (1 - Math.cos(th))) / Math.sin(th)) : 0;
    return { type, side: sd, rMin, pieces: [arc(sd * th, q), line(s), arc(-2 * sd * th, q), line(s), arc(sd * th, q)], len: 4 * q * Math.sin(th) + 2 * s * Math.cos(th) };
  }

  function loop(seed, o) {
    const { size, hw, minHw = 0, margin = 0, gap = hw, samples: S = 720, checks = 16, rv = 2.7 * hw, style = 'regular' } = o;
    const st = STYLE[style] || STYLE.regular, lap = o.lap || st.lap, cps = Array.from({ length: checks }, (_, k) => Math.round((k * S) / checks)), env = { size, hw, minHw, margin, gap, S, cps, rv, st };
    let best = null;
    for (let t = 0, kept = 0; t < st.tries && kept < st.keep; t++) {
      const V = st.lay(seed, t, env), tr = V && corners(V, seed, t, env);
      if (!tr) continue;
      kept++;
      tr.score = score(measure(tr, o), style, lap);
      if (!best || tr.score > best.score) best = tr;
    }
    if (st.fall) return best ? Object.assign(best, { from: st.from }) : loop(seed, { ...o, style: st.fall });
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

  // The regular style's polygon: corners round the middle, a few of them pulled in (so the loop
  // bends both ways), fitted to the map.
  function ring(seed, t, { size, hw, minHw, margin }) {
    const rl = rng(seed, t, 1);
    const K = CORNERS[0] + Math.floor(rl() * (CORNERS[1] - CORNERS[0] + 1)), rot = rl() * TAU;
    const nIn = PULLED[0] + Math.floor(rl() * (PULLED[1] - PULLED[0] + 1)), pulled = new Set();
    for (let k = 0; k < 20 && pulled.size < nIn; k++) { const i = Math.floor(rl() * K); if (!pulled.has((i + 1) % K) && !pulled.has((i + K - 1) % K)) pulled.add(i); }
    const V = [];
    for (let i = 0; i < K; i++) {
      const th = rot + ((i + 0.6 * (rl() - 0.5)) / K) * TAU, [a, b] = pulled.has(i) ? NEAR : OUT, d = a + (b - a) * rl();
      V.push({ x: Math.cos(th) * d * ACROSS, y: Math.sin(th) * d });
    }
    fit(V, size, margin + 1.25 * Math.max(hw, minHw));
    return V;
  }

  // The advanced style: an irregular polygon, the way real circuits are laid out rather than a ring
  // round the middle. A base shape (a long box, a block, a wedge or an L) in a portrait box of
  // height 1, mirrored at random, then a few edges reworked: a finger (the track runs out and back,
  // a hairpin at its tip), a bay (the outline folds in), a plateau (a shallow step out or in), a
  // technical sector (a zig-zag of short corners) or kinks (a straight bent a little). Thrown away
  // when it crosses itself or two stretches far apart round it come closer than the track needs
  // (sep: two half-widths and the gap, as apart() will want), before its corners are worked out.
  const ADV = {
    OPS: [4, 6], FINGERS: 3, LAP: [22, 32],
    SHAPES: [['long', 0.3], ['block', 0.3], ['wedge', 0.2], ['L', 0.2]],
    EDITS: [['finger', 0.35], ['bay', 0.2], ['plateau', 0.15], ['tech', 0.15], ['kinks', 0.15]],
    KINDS: [ // as KINDS, leaning to the slower, trickier corners
      [['sweeper', 0.45], ['square', 0.55]],
      [['square', 0.2], ['double-apex', 0.3], ['decreasing', 0.35], ['carousel', 0.15]],
      [['hairpin', 0.55], ['double-apex', 0.2], ['decreasing', 0.2], ['carousel', 0.05]],
    ],
  };
  function skeleton(seed, t, { size, hw, minHw, margin, gap }) {
    const r = rng(seed, t, 4), lo = margin + 1.25 * Math.max(hw, minHw), room = size - 2 * lo;
    const sep = (2 * Math.max(hw * WIDTH.sweeper, minHw) + gap) / room, span = (a, b) => a + (b - a) * r();
    const w = WIDE * span(0.75, 1), base = pick(r, ADV.SHAPES);
    let V;
    if (base === 'long') { const a = w * span(0.45, 0.7); V = [[0, 0], [a, 0], [a, 1], [0, 1]]; }
    else if (base === 'block') V = [[w * span(0, 0.3), 0], [w * span(0.7, 1), 0], [w, 1], [0, 1]];
    else if (base === 'wedge') V = [[0, 0], [w * span(0.3, 0.5), 0], [w, span(0.75, 1)], [w * span(0, 0.2), 1]];
    else { const h = span(0.35, 0.6), x = w * span(0.4, 0.6); V = [[0, 0], [w, 0], [w, h], [x, h], [x, 1], [0, 1]]; }
    // Shrunk about the box's middle (leaving room for fingers out), mirrored and jittered.
    const fx = r() < 0.5, fy = r() < 0.5, sc = span(0.65, 0.8);
    V = V.map(([x, y]) => ({ x: WIDE / 2 + ((fx ? w - x : x) - w / 2) * sc + (r() - 0.5) * 0.05, y: 0.5 + ((fy ? 1 - y : y) - 0.5) * sc + (r() - 0.5) * 0.05 }));
    // out: the side of an edge outside the polygon (by the way round it goes).
    const out = areaOf(V) > 0 ? 1 : -1;
    const inBox = (p) => p.x > -0.02 && p.x < WIDE + 0.02 && p.y > -0.02 && p.y < 1.02;
    let fingers = 0, tech = 0;
    const ops = ADV.OPS[0] + Math.floor(r() * (ADV.OPS[1] - ADV.OPS[0] + 1));
    for (let k = 0, tries = 0; k < ops && tries < 20; tries++) {
      let edit = pick(r, ADV.EDITS);
      if ((edit === 'finger' && fingers >= ADV.FINGERS) || (edit === 'tech' && tech >= 1)) edit = 'kinks';
      // An edge to rework, the longer the likelier, long enough for the edit.
      const need = { finger: 1.5 * sep + 0.3, bay: 0.5, plateau: 0.45, tech: 3.2 * sep + 0.3, kinks: 0.35 }[edit];
      const ls = V.map((v, i) => { const q = V[(i + 1) % V.length], l = Math.hypot(q.x - v.x, q.y - v.y); return l >= need ? l * l : 0; });
      if (!ls.some((l) => l)) continue;
      let x = r() * ls.reduce((s, l) => s + l, 0), i = 0;
      while ((x -= ls[i]) >= 0) i++;
      const A = V[i], B = V[(i + 1) % V.length], L = Math.hypot(B.x - A.x, B.y - A.y), dx = (B.x - A.x) / L, dy = (B.y - A.y) / L;
      const nx = dy * out, ny = -dx * out, at = (s, o) => ({ x: A.x + dx * s + nx * o, y: A.y + dy * s + ny * o });
      let add;
      if (edit === 'finger' || edit === 'bay' || edit === 'plateau') {
        // A notch: down the side s1–s2 to depth (outward > 0), across, and back up.
        const dir = edit === 'bay' ? -1 : edit === 'finger' ? (r() < 0.6 ? 1 : -1) : r() < 0.5 ? 1 : -1;
        const wd = edit === 'finger' ? sep * span(1.2, 1.45) : Math.min(L - 0.2, span(0.25, 0.45));
        const s1 = span(0.12, L - wd - 0.12), s2 = s1 + wd, slant = edit === 'finger' ? (r() - 0.5) * 0.06 : wd * span(0.1, 0.3);
        let depth = edit === 'finger' ? span(0.2, 0.5) : edit === 'bay' ? span(0.12, 0.25) : span(0.05, 0.1);
        add = () => [at(s1, 0), at(s1 + slant, dir * depth), at(s2 - (edit === 'finger' ? -slant : slant), dir * depth), at(s2, 0)];
        while (dir > 0 && !add().every(inBox) && depth > 0.1) depth *= 0.85;
        if (dir > 0 && !add().every(inBox)) continue;
        if (edit === 'finger') { fingers++; const f = add; add = () => f().map((p, m) => (m === 1 || m === 2 ? { ...p, tight: true } : p)); }
      } else if (edit === 'tech') {
        // A square wave across the edge: up a, along b, across 2a, along b, back: six square corners.
        const a = sep * span(0.6, 0.85), b = sep * span(1.1, 1.6), s0 = span(0.12, L - 2 * b - 0.12), sd = r() < 0.5 ? -1 : 1;
        add = () => [[s0, 0], [s0, a], [s0 + b, a], [s0 + b, -a], [s0 + 2 * b, -a], [s0 + 2 * b, 0]].map(([u, o]) => ({ ...at(u, sd * o), tight: true }));
        if (!add().every(inBox)) continue;
        tech++;
      } else {
        const n = 1 + Math.floor(r() * 2);
        add = () => Array.from({ length: n }, (_, m) => at((L * (m + 1)) / (n + 1), (r() < 0.5 ? -1 : 1) * span(0.015, 0.035)));
      }
      V.splice(i + 1, 0, ...add());
      k++;
    }
    if (!simple(V)) return null;
    fit(V, size, lo);
    return clear(V, sep * room) ? V : null;
  }

  // Whether a polygon's edges cross (other than neighbours meeting at their corner).
  const cross = (a, b, c, d) => {
    const o = (p, q, s) => Math.sign((q.x - p.x) * (s.y - p.y) - (q.y - p.y) * (s.x - p.x));
    return o(a, b, c) !== o(a, b, d) && o(c, d, a) !== o(c, d, b);
  };
  function simple(V) {
    const K = V.length;
    for (let i = 0; i < K; i++) for (let j = i + 2; j < K; j++) {
      if (i === 0 && j === K - 1) continue;
      if (cross(V[i], V[(i + 1) % K], V[j], V[(j + 1) % K])) return false;
    }
    return true;
  }
  // No two edges further apart round the polygon than 1.6 sep (as apart() skips) closer than sep.
  const segDist = (a, b, c, d) => Math.min(ptSeg(a, c, d), ptSeg(b, c, d), ptSeg(c, a, b), ptSeg(d, a, b));
  const ptSeg = (p, a, b) => { const ex = b.x - a.x, ey = b.y - a.y, l2 = ex * ex + ey * ey, u = l2 ? clamp(((p.x - a.x) * ex + (p.y - a.y) * ey) / l2, 0, 1) : 0; return Math.hypot(p.x - a.x - ex * u, p.y - a.y - ey * u); };
  function clear(V, sep) {
    const K = V.length, l = V.map((v, i) => Math.hypot(V[(i + 1) % K].x - v.x, V[(i + 1) % K].y - v.y)), per = l.reduce((s, x) => s + x, 0);
    for (let i = 0; i < K; i++) for (let j = i + 2, between = l[i + 1]; j < K; between += l[j], j++) {
      if (Math.min(between, per - between - l[i] - l[j]) < 1.6 * sep) continue;
      if (segDist(V[i], V[(i + 1) % K], V[j], V[(j + 1) % K]) < sep) return false;
    }
    return true;
  }

  // The expert style: the outline of a branchy clump of cells on an uneven grid (a polyomino grown a
  // cell at a time, a cell likelier the fewer filled ones it touches, so it grows arms rather than a
  // lump). Its outline is all folds: an arm a cell wide is a finger the track runs out along and back
  // (two square corners a cell apart: a hairpin), the gap between two arms a bay it runs into and
  // out of, and two stretches side by side are a whole cell apart (cells at least about sep, so few
  // layouts are thrown away for coming too close). A cell that would touch the clump only at a corner
  // (the outline would pinch) or close a hole in it is never added. Each corner is then nudged a
  // little (so they turn about 70–110°, not all 90°), and most are kept square.
  const EXP = {
    LAP: [28, 40], COLS: [4, 6], ROWS: [5, 7], CELL: [1, 1.7], CELLS: [11, 17], JITTER: 0.24, TIGHT: 0.65,
    GROW: [0, 1, 0.05, 0.01, 0], ARM: 2.5, // a cell's weight by how many filled cells it touches; × ARM when it runs an arm on straight
    KINDS: [ // as KINDS, slow corners almost only
      [['sweeper', 0.2], ['square', 0.8]],
      [['square', 0.45], ['double-apex', 0.2], ['decreasing', 0.35]],
      [['hairpin', 0.75], ['double-apex', 0.1], ['decreasing', 0.15]],
    ],
  };
  const N4 = [[1, 0], [0, 1], [-1, 0], [0, -1]], DIAG = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
  function grid(seed, t, { size, hw, minHw, margin, gap }) {
    const r = rng(seed, t, 5), lo = margin + 1.25 * Math.max(hw, minHw), room = size - 2 * lo;
    const sep = (2 * Math.max(hw * WIDTH.sweeper, minHw) + gap) / room, span = (a, b) => a + (b - a) * r(), int = ([a, b]) => a + Math.floor(r() * (b - a + 1));
    const nc = int(EXP.COLS), nr = int(EXP.ROWS), X = [0], Y = [0];
    for (let i = 0; i < nc; i++) X.push(X[i] + span(...EXP.CELL));
    for (let j = 0; j < nr; j++) Y.push(Y[j] + span(...EXP.CELL));
    // on: 1 a cell of the clump, 2 one never to be added (it would close a hole).
    const on = Array.from({ length: nc }, () => new Uint8Array(nr)), has = (i, j) => i >= 0 && j >= 0 && i < nc && j < nr && on[i][j] === 1;
    const touches = (i, j) => N4.filter(([di, dj]) => has(i + di, j + dj)).length;
    const arm = (i, j) => N4.some(([di, dj]) => has(i + di, j + dj) && has(i + 2 * di, j + 2 * dj));
    const pinch = (i, j) => DIAG.some(([di, dj]) => has(i + di, j + dj) && !has(i + di, j) && !has(i, j + dj));
    const holed = () => {
      const seen = Array.from({ length: nc + 2 }, () => new Uint8Array(nr + 2)), q = [[0, 0]];
      seen[0][0] = 1;
      while (q.length) {
        const [i, j] = q.pop();
        for (const [di, dj] of N4) { const a = i + di, b = j + dj; if (a >= 0 && b >= 0 && a < nc + 2 && b < nr + 2 && !seen[a][b] && !has(a - 1, b - 1)) { seen[a][b] = 1; q.push([a, b]); } }
      }
      return on.some((col, i) => col.some((c, j) => c !== 1 && !seen[i + 1][j + 1]));
    };
    on[Math.floor(r() * nc)][Math.floor(r() * nr)] = 1;
    let cells = 1;
    for (let want = int(EXP.CELLS), tries = 0; cells < want && tries < 4 * want; tries++) {
      const ws = [];
      for (let i = 0; i < nc; i++) for (let j = 0; j < nr; j++) if (!on[i][j] && touches(i, j) && !pinch(i, j)) ws.push([[i, j], EXP.GROW[touches(i, j)] * (arm(i, j) ? EXP.ARM : 1)]);
      if (!ws.length) break;
      const [i, j] = pick(r, ws);
      on[i][j] = 1;
      if (holed()) on[i][j] = 2; else cells++;
    }
    if (cells < EXP.CELLS[0] - 2) return null;
    // The outline, clockwise on screen: each cell's sides that face no cell, as grid points (i, j).
    const next = new Map(), key = (i, j) => i * 1000 + j;
    for (let i = 0; i < nc; i++) for (let j = 0; j < nr; j++) {
      if (!has(i, j)) continue;
      if (!has(i, j - 1)) next.set(key(i, j), [i + 1, j]);
      if (!has(i + 1, j)) next.set(key(i + 1, j), [i + 1, j + 1]);
      if (!has(i, j + 1)) next.set(key(i + 1, j + 1), [i, j + 1]);
      if (!has(i - 1, j)) next.set(key(i, j + 1), [i, j]);
    }
    const [k0] = next.keys(), path = [[Math.floor(k0 / 1000), k0 % 1000]];
    for (let p = next.get(k0); key(...p) !== k0 && path.length <= next.size; p = next.get(key(...p))) path.push(p);
    if (path.length !== next.size) return null;
    // Its corners (where it turns), scaled to the portrait box, nudged.
    let V = path.filter((p, n) => {
      const a = path[wrap(n - 1, path.length)], b = path[(n + 1) % path.length];
      return (p[0] - a[0]) * (b[1] - p[1]) - (p[1] - a[1]) * (b[0] - p[0]) !== 0;
    }).map(([i, j]) => ({ x: X[i], y: Y[j] }));
    const xs = V.map((v) => v.x), ys = V.map((v) => v.y), k = Math.min(1 / (Math.max(...ys) - Math.min(...ys)), WIDE / (Math.max(...xs) - Math.min(...xs)));
    const nudge = EXP.JITTER * EXP.CELL[0] * k;
    V = V.map((v) => ({ x: v.x * k + (r() - 0.5) * 2 * nudge, y: v.y * k + (r() - 0.5) * 2 * nudge, tight: r() < EXP.TIGHT }));
    if (!simple(V)) return null;
    fit(V, size, lo);
    return clear(V, sep * room) ? V : null;
  }

  // Each style: how its polygon is laid out, layouts tried and kept, its lap, the kinds its corners
  // are picked from, wiggles at most (past the `spare` longest straights; chicanes: the odds of one
  // being a chicane), the slow corners' radii (×), what it's called when built (from) and the style
  // it falls back to when no layout will do.
  const STYLE = {
    regular: { lay: (...a) => ring(...a), tries: TRIES, keep: KEEP, lap: LAP, kinds: KINDS, inserts: INSERTS, sharp: 1 },
    advanced: { lay: (...a) => skeleton(...a), tries: 160, keep: 12, lap: ADV.LAP, kinds: ADV.KINDS, inserts: 3, sharp: 1, from: 'skeleton', fall: 'regular' },
    expert: { lay: (...a) => grid(...a), tries: 200, keep: 24, lap: EXP.LAP, kinds: EXP.KINDS, inserts: 4, spare: 1, chicanes: 0.85, sharp: 0.7, from: 'grid', fall: 'advanced' },
  };
  // A layout from its polygon V (fitted to the map), or null when it won't do: each corner a kind
  // (corner()) placed where its way in and out lie along the polygon's edges; a wiggle (wiggle()) in
  // up to INSERTS of the longest straights.
  function corners(V, seed, t, { size, hw, minHw, margin, gap, S, cps, rv, st }) {
    const rc = rng(seed, t, 2), rx = rng(seed, t, 3), K = V.length, lo = margin + 1.25 * Math.max(hw, minHw);
    // Each corner: the way in and out, how far it turns, its kind and pieces, and how far back
    // along the way in it starts (tin) and on along the way out it ends (tout), at scale f.
    const C = V.map((v, i) => {
      const a = V[wrap(i - 1, K)], b = V[(i + 1) % K];
      const ai = Math.atan2(v.y - a.y, v.x - a.x), ao = Math.atan2(b.y - v.y, b.x - v.x), turn = angleDiff(ao, ai);
      return { v, ai, ao, turn, l: Math.hypot(b.x - v.x, b.y - v.y), f: 1, ...corner(turn, rc, hw, minHw, rv, st.kinds, v.tight, st.sharp) };
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
    // Wiggles in the longest straights (past the `spare` longest, left as they are), each with LEAD
    // of straight before and after.
    const free = C.map((c, i) => ({ i, l: c.l - c.tout - C[(i + 1) % K].tin })).sort((p, q) => q.l - p.l);
    for (const { i, l } of free.slice(st.spare || 0, (st.spare || 0) + st.inserts)) {
      const w = wiggle(rx, hw, minHw, rv, st.chicanes);
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
  //   -> { len, lap, bend, oneWay, flips, tight, tightHw, underRv, straight, straightS, straightDeg, longs, hwMin, hwMax, fill, rvar, types }
  //   bend: the share of the lap bending; oneWay: the share of the bending that goes the commoner way;
  //   flips: left/right changes; tight: the tightest radius (tightHw: over the half-width there);
  //   underRv: corners tighter than rv; straight: the longest (straightDeg: degrees off vertical);
  //   longs: straights of LONG s or more at top speed (0 without a speed);
  //   fill: the area inside the loop over its convex hull's (1: no bay or finger anywhere); rvar: the
  //   widest corner's radius over the tightest's; types: corners (and wiggles) of each kind
  const BENT = 1 / 1500, LONG = 1.5;
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
    const rs = (tr.corners || []).map((c) => c.r), rvar = rs.length ? Math.max(...rs) / Math.min(...rs) : 1;
    return {
      len: tr.len, lap: speed ? tr.len / speed : 0, bend: bendLen / tr.len, oneWay: bendLen ? Math.max(one, bendLen - one) / bendLen : 0, flips,
      tight: 1 / Math.max(...pts.map((p) => p.k)), tightHw: minRadius(tr).r, underRv: (tr.corners || []).filter((c) => c.r < rv).length,
      straight: long.len, straightS: speed ? long.len / speed : 0, straightDeg: (Math.atan2(Math.abs(long.tx), Math.abs(long.ty)) * 180) / Math.PI,
      longs: speed ? runs.filter((r) => !r.k && r.len >= LONG * speed).length : 0,
      hwMin: Math.min(...pts.map((p) => p.hw)), hwMax: Math.max(...pts.map((p) => p.hw)), fill: Math.abs(areaOf(pts)) / areaOf(hull(pts)), rvar, types,
    };
  }
  const areaOf = (P) => P.reduce((s, p, i) => { const q = P[(i + 1) % P.length]; return s + (p.x * q.y - q.x * p.y) / 2; }, 0);
  // The convex hull (Andrew's monotone chain), anticlockwise (its area > 0).
  function hull(P) {
    const ps = [...P].sort((a, b) => a.x - b.x || a.y - b.y), turn = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
    const half = (qs) => { const h = []; for (const p of qs) { while (h.length >= 2 && turn(h[h.length - 2], h[h.length - 1], p) <= 0) h.pop(); h.push(p); } h.pop(); return h; };
    return [...half(ps), ...half(ps.reverse())];
  }
  // How good a layout is (more is better): bends both ways, one to three that need a lift, many
  // kinds of corner, a lap of 20–28 s, a long straight that runs up or down the screen (sideways,
  // less of the way ahead is in view). Advanced layouts also for folding in on themselves (fill),
  // more changes of hand, and slow corners beside fast ones (rvar); expert ones for folding in
  // further still, many corners that need a lift, and one or two long straights, no more, none too long.
  // style: the layout's; lap: [shortest, longest].
  function score(m, style = 'regular', lap = LAP) {
    const exp = style === 'expert', adv = style === 'advanced';
    let s = -10 * Math.max(0, m.oneWay - 0.65) + 0.3 * Math.min(m.flips, exp ? 18 : adv ? 14 : 10) + 0.3 * Math.min(Object.keys(m.types).length, 6);
    if (exp) s += (m.underRv >= 3 ? 1.5 : 0) + 4 * clamp((0.78 - m.fill) / 0.28, 0, 1) + (m.rvar >= 4 ? 0.5 : 0) + (m.longs >= 1 && m.longs <= 2 ? 1 : 0) - 0.75 * Math.max(0, m.longs - 2) - 0.75 * Math.max(0, m.straightS - 4) - 0.5 * Math.max(0, m.straightS * Math.sin((m.straightDeg * Math.PI) / 180) - 1.5);
    else s += m.underRv >= 1 && m.underRv <= 3 ? 1.5 : m.underRv > 3 ? 0.5 : 0;
    if (adv) s += 3 * clamp((0.88 - m.fill) / 0.25, 0, 1) + (m.rvar >= 4 ? 0.5 : 0);
    if (m.lap) s -= 0.5 * Math.max(0, lap[0] - m.lap, m.lap - lap[1]);
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
