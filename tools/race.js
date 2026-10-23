// Race prototype (tools/race.html; serve the repo, e.g. `npm start`, and open /tools/race.html):
// a loop of open ground carved through a generated surface (ArtSurface), raced in the game's own
// ship: the Courier's art, its engine numbers, and the surface's flight and collisions (Flight,
// Collide, as game/landing.js flies it).
//
// The surface is generated as usual, then its high-ground grid (C) is rewritten along a closed
// centreline: corners within the track's half-width are opened, a band of corners just outside it
// is raised into cliffs (the walls), and the ground beyond is left as generated. Props in tiles the
// walls now cover are dropped; on the track, tall props are thinned to spaced obstacles, and holes
// (craters, vents, lava lakes) stay as slow zones (glowing ones burn). Nothing in src/ changes.
//
// Laps count by checkpoints along the centreline, passed in order.
// Flying is the game's Cruise (game/input.js): drag anywhere to set a heading, the drag's length the
// speed; the ship keeps that course when you let go, and a double-tap stops it. The drag shows as the
// game's ring and line (game/hud.js drawDragIndicator). WASD or arrows fly at full speed while held.
// R to restart, N for a new track.
// Query parameters: ?biome=desert|ice|lava|terran|moon, ?style=line, ?curved, ?seed=, ?laps=,
// ?speed= (× the ship's top speed; the game flies surfaces at 0.5, races at TUNE.speed), ?mode=direct (no drift).

import { Art } from '../src/art/render.js';
import { ArtBlueprints } from '../src/art/blueprints.js';
import { ArtCulture } from '../src/art/culture.js';
import { ArtSurface } from '../src/art/surface.js';
import { SurfaceGlobe } from '../src/art/surface-globe.js';
import { mulberry32 } from '../src/core/rng.js';
import { Collide } from '../src/flight/collide.js';
import { Flight } from '../src/flight/flight.js';
import { Loadout } from '../src/rules/loadout.js';

const q = new URLSearchParams(location.search), T = ArtSurface.T, TAU = Math.PI * 2;
const N = 76; // the surface, tiles a side
const SAMPLES = 720, CHECKS = 16, HW = 1.9 * T; // centreline points; checkpoints; the track's half-width (±25% round the loop)
const SPACING = 7 * T, CLEAR = 6 * T; // between obstacles on the track; none this close to the start
const LAPS = Math.max(1, +q.get('laps') || 3), MODE = q.get('mode') === 'direct' ? 'direct' : 'cruise';
const SLOW = 0.5, BURN = 12; // in a hole: top speed ×; glowing ones: hull a second
const BIOMES = {
  desert: { type: 'desert', label: 'Desert' },
  ice: { type: 'ice', label: 'Ice' },
  lava: { type: 'lava', label: 'Lava' },
  terran: { type: 'terran', label: 'Terran' },
  moon: { type: 'moon-grey', label: 'Moon' },
};

// The ship: the Courier as the game fits and draws it (game/state.js SHIP, game/options.js
// HULL_ART), at the surface's speed and size (game/landing.js SURFACE_SPEED, SURFACE_SCALE;
// flight/entities.js SHIP_SCALE).
const SHIP = Loadout.stats(Loadout.starter('courier'));
// Racing is faster and grippier than the game's surface flight: in Cruise the velocity eases toward
// the heading at the engine's acceleration, so more of it makes turns bite instead of float.
const TUNE = { speed: 0.75, accel: 1.4, turn: 1.25 }; // × the ship's top speed, acceleration, turn rate
const STATS = { ...SHIP, maxSpeed: SHIP.maxSpeed * (+q.get('speed') || TUNE.speed), accel: SHIP.accel * TUNE.accel, turnRate: SHIP.turnRate * TUNE.turn };
// The camera: close in (the ground's speed on screen is what reads as fast), leading the ship by
// `lead` seconds of its velocity, and pushing in a little at top speed rather than drawing back.
const CAM = { zoom: 1.3, lead: 0.6, pull: 0.04, reach: 0.3 };
const SURFACE_SCALE = 0.85, SHIP_SCALE = 1.375, R_SHIP = SHIP.radius * SURFACE_SCALE, HULL = SHIP.hull || 120;
const ART = ArtBlueprints.create('fighter-light', ArtCulture.legacy, 3);

// The drag as game/input.js keeps it, and the course it set (the game's ship.targetAngle, targetSpeed).
const DEADZONE = 8, DOUBLE_TAP = 0.4, maxDrag = () => Math.min(innerWidth, innerHeight) * 0.225;
const drag = { active: false, id: null, x0: 0, y0: 0, x: 0, y: 0, moved: 0 };
const S = { biome: BIOMES[q.get('biome')] ? q.get('biome') : 'desert', style: q.get('style') === 'line' ? 'line' : 'lowpoly', curved: q.has('curved'), seed: +q.get('seed') || 1, keys: new Set(), course: { angle: 0, speed: 0 } };
let G = null; // the track and its surface: { W, tr, b, talls, holes, looks: { style: { far, tiles } }, mini }
let R = null; // the run on it
const cv = document.getElementById('view'), ctx = cv.getContext('2d'), hud = document.getElementById('hud'), note = document.getElementById('note');
const coarse = matchMedia('(pointer: coarse)').matches;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// ---------- The track ----------

// A closed loop round the middle of the map: a circle wobbled by a few seeded waves, scaled so its
// widest point stays clear of the map's edge, its width wobbling too. pts: { x, y, hw, tx, ty }
// (tx, ty: the way round); cps: the checkpoints' indices into pts, the first the start line.
function centreline(seed) {
  const r = mulberry32(seed * 7919 + 13), c = (N * T) / 2;
  const waves = [2, 3, 4, 5].map((k, n) => ({ k, a: [0.15, 0.1, 0.06, 0.035][n] * (0.6 + 0.8 * r()), p: r() * TAU }));
  const wk = 2 + Math.floor(r() * 3), wp = r() * TAU, ks = [];
  for (let n = 0; n < SAMPLES; n++) { const th = (n / SAMPLES) * TAU; ks.push(1 + waves.reduce((s, w) => s + w.a * Math.sin(w.k * th + w.p), 0)); }
  const R0 = (c - 1.25 * HW - 5 * T) / Math.max(...ks);
  const pts = ks.map((k, n) => { const th = (n / SAMPLES) * TAU; return { x: c + Math.cos(th) * R0 * k, y: c + Math.sin(th) * R0 * k, hw: HW * (1 + 0.25 * Math.sin(wk * th + wp)) }; });
  let len = 0;
  pts.forEach((p, n) => {
    const a = pts[(n + SAMPLES - 1) % SAMPLES], b = pts[(n + 1) % SAMPLES], l = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    p.tx = (b.x - a.x) / l; p.ty = (b.y - a.y) / l;
    len += Math.hypot(b.x - p.x, b.y - p.y) / 2;
  });
  return { pts, len, cps: Array.from({ length: CHECKS }, (_, k) => Math.round((k * SAMPLES) / CHECKS)) };
}

// How far (x, y) is outside the track's edge (< 0: on it), and the nearest centreline point. With
// a guess `near`, only the points within `span` of it are looked at.
function edgeDist(tr, x, y, near = -1, span = SAMPLES / 2) {
  let best = Infinity, bn = 0;
  const from = near < 0 ? 0 : near - span, to = near < 0 ? SAMPLES : near + span;
  for (let m = from; m < to; m++) {
    const n = ((m % SAMPLES) + SAMPLES) % SAMPLES, a = tr.pts[n], b = tr.pts[(n + 1) % SAMPLES];
    const ex = b.x - a.x, ey = b.y - a.y, l2 = ex * ex + ey * ey;
    const t = l2 ? clamp(((x - a.x) * ex + (y - a.y) * ey) / l2, 0, 1) : 0;
    const d = Math.hypot(x - a.x - ex * t, y - a.y - ey * t) - (a.hw + (b.hw - a.hw) * t);
    if (d < best) { best = d; bn = t < 0.5 ? n : (n + 1) % SAMPLES; }
  }
  return { d: best, n: bn };
}

// Rewrites a generated surface round the track (before anything of it is built: ArtSurface keeps
// its cliff pieces and geometry once made). Cliff edges fall between corners, so corners a little
// past the edge are opened too, to keep the track about its width.
function carve(W, tr, seed) {
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
    if (Math.hypot(p.x - start.x, p.y - start.y) < CLEAR) { delete W.props[key]; continue; }
    if (p.type !== 'tall') continue;
    if (kept.some((o) => Math.hypot(o.x - p.x, o.y - p.y) < SPACING)) delete W.props[key];
    else kept.push(p);
  }
}

function build() {
  const b = BIOMES[S.biome], tr = centreline(S.seed);
  const W = ArtSurface.generate(b.type, S.seed, { w: N, h: N, tall: 0.06 });
  carve(W, tr, S.seed);
  const on = ArtSurface.propsAll(W).filter((p) => edgeDist(tr, p.x, p.y).d < p.r);
  const mini = new Path2D();
  tr.pts.forEach((p, n) => (n ? mini.lineTo(p.x, p.y) : mini.moveTo(p.x, p.y)));
  mini.closePath();
  G = { W, tr, b, talls: on.filter((p) => p.type === 'tall'), holes: on.filter((p) => p.type === 'hole'), looks: {}, mini };
  restart();
}
function looks() {
  return G.looks[S.style] || (G.looks[S.style] = { far: ArtSurface.farImage(G.W, S.style), tiles: SurfaceGlobe.tiles(G.W, S.style, { size: 8, dpr: coarse ? 1 : 1.5, keep: 40 }) });
}

// ---------- The run ----------

function restart() {
  const n = SAMPLES - 8, p = G.tr.pts[n]; // a little behind the start line
  R = {
    phase: 'count', t: 0, total: 0, lapT: 0, laps: [], next: 1, n, hull: HULL, hits: 0, wrong: 0, slow: false, burn: false, flash: 0,
    craft: { x: p.x, y: p.y, vx: 0, vy: 0, angle: Math.atan2(p.ty, p.tx), thrust: 0 }, cam: { lx: 0, ly: 0, zf: 1 },
  };
  S.course = { angle: R.craft.angle, speed: 0 };
  looks().tiles.layers(detailRect(viewNow(innerWidth, innerHeight).v), Infinity); // the start's chunks, now
}

function step(dt) {
  if (!R) return;
  R.t += dt;
  if (R.phase === 'count' && R.t >= 3) { R.phase = 'race'; R.t = 0; }
  const W = G.W, C = R.craft, racing = R.phase === 'race';
  let ax = 0, ay = 0;
  const K = S.keys;
  if (K.has('ArrowLeft') || K.has('a')) ax--; if (K.has('ArrowRight') || K.has('d')) ax++;
  if (K.has('ArrowUp') || K.has('w')) ay--; if (K.has('ArrowDown') || K.has('s')) ay++;
  const stats = R.slow ? { ...STATS, maxSpeed: STATS.maxSpeed * SLOW } : STATS;
  // Keys held fly at full speed; otherwise the course the drag set (a fraction of top speed, so a
  // slow zone scales it too, as game/landing.js does).
  const keyed = ax || ay, angle = keyed ? Math.atan2(ay, ax) : S.course.angle, speed = keyed ? stats.maxSpeed : S.course.speed * stats.maxSpeed;
  const go = racing && speed > 0, x0 = C.x, y0 = C.y;
  Flight.step(C, stats, { targetAngle: go ? angle : C.angle, targetSpeed: go ? speed : 0, mode: MODE }, dt);
  // What blocks it bounces it off, as in game/landing.js fly; a hard hit dents the hull.
  let hit = 0;
  if (ArtSurface.blocked(W, C.x, y0, R_SHIP)) { C.x = x0; hit = Math.max(hit, Collide.bounce(C, -Math.sign(C.vx), 0)); }
  if (ArtSurface.blocked(W, C.x, C.y, R_SHIP)) { C.y = y0; hit = Math.max(hit, Collide.bounce(C, 0, -Math.sign(C.vy))); }
  hit /= STATS.maxSpeed / (SHIP.maxSpeed * 0.5); // as hard as the same share of top speed at the game's surface speed
  if (hit > Collide.config.surfaceSafe * 0.5) { R.hits++; R.flash = Math.min(0.4, hit / 600); }
  R.hull -= Collide.damage(hit, Collide.config.surfaceSafe);
  const inHole = ArtSurface.propsNear(W, C.x, C.y).filter((p) => p.type === 'hole' && Math.hypot(C.x - p.x, C.y - p.y) < p.r);
  R.slow = inHole.length > 0; R.burn = inHole.some((p) => p.emit);
  if (R.burn && racing) R.hull -= BURN * dt;
  R.flash = Math.max(0, R.flash - dt);
  if (R.hull <= 0 && racing) { R.hull = 0; R.phase = 'wreck'; }
  // The camera leads the ship and pushes in a little at speed (CAM).
  const k = 1 - Math.exp(-3 * dt), sp = Math.hypot(C.vx, C.vy) / STATS.maxSpeed;
  R.cam.lx += (C.vx * CAM.lead - R.cam.lx) * k; R.cam.ly += (C.vy * CAM.lead - R.cam.ly) * k; R.cam.zf += (1 + CAM.pull * sp - R.cam.zf) * k;
  if (!racing) return;
  R.total += dt; R.lapT += dt;
  const tr = G.tr, pt = tr.pts[(R.n = edgeDist(tr, C.x, C.y, R.n, 40).n)];
  R.wrong = C.vx * pt.tx + C.vy * pt.ty < -60 ? R.wrong + dt : 0;
  if ((R.n - tr.cps[R.next] + SAMPLES) % SAMPLES < SAMPLES / 8) {
    if (R.next === 0) { R.laps.push(R.lapT); R.lapT = 0; if (R.laps.length >= LAPS) R.phase = 'done'; }
    R.next = (R.next + 1) % CHECKS;
  }
}

// ---------- Drawing ----------

function viewNow(Wc, Hc) {
  const C = R.craft, zoom = clamp(Math.min(Wc, Hc) / 800, 0.55, 1.3) * CAM.zoom * R.cam.zf;
  // The lead, held to CAM.reach of the screen's shorter side, so the ship never runs off its edge.
  const l = Math.hypot(R.cam.lx, R.cam.ly) * zoom, f = Math.min(1, (CAM.reach * Math.min(Wc, Hc)) / (l || 1));
  const v = SurfaceGlobe.view({ R: S.curved ? 600 : 1e9, flat: S.curved ? 300 : 0, fx: C.x + R.cam.lx * f, fy: C.y + R.cam.ly * f, W: Wc / zoom, H: Hc / zoom, ox: Wc / 2 / zoom, oy: (Hc * 0.55) / zoom, tilt: ArtSurface.tiltOf(S.style) });
  return { v, zoom };
}
// The ground to build detailed chunks over (game/landing.js detailRect), and the same a moment
// ahead, built in idle time.
function detailRect(v) {
  const ex = SurfaceGlobe.extent(v);
  return { x0: Math.max(ex.x0, v.fx - 900), x1: Math.min(ex.x1, v.fx + 900), y0: Math.max(ex.y0, v.fy - 1100), y1: Math.min(ex.y1, v.fy + 600), cx: v.fx, cy: v.fy };
}
let idle = null;
function buildAhead(tiles, v) {
  if (idle) return;
  const C = R.craft, r = detailRect(v), dx = C.vx * 1.2, dy = C.vy * 1.2;
  const rect = { x0: r.x0 + dx - 300, x1: r.x1 + dx + 300, y0: r.y0 + dy - 300, y1: r.y1 + dy + 300, cx: C.x + dx, cy: C.y + dy };
  if (window.requestIdleCallback) idle = requestIdleCallback((dl) => { idle = null; tiles.warm(rect, Math.min(4, dl.timeRemaining() - 2)); });
  else tiles.warm(rect, 3);
}

const STARS = Array.from({ length: 220 }, (_, i) => { const h = (n) => { const v = Math.sin(i * 127.1 + n * 311.7) * 43758.5453; return v - Math.floor(v); }; return [h(1), h(2), 0.3 + 0.7 * h(3)]; });
const ground = (v, x, y, z = 0) => SurfaceGlobe.toScreen(v, x, y, ArtSurface.heightAt(G.W, x, y) + z);

// A line across the track at centreline point n, from −f to +f of its half-width.
function across(v, n, f, z = 0) {
  const p = G.tr.pts[n];
  return [-1, 1].map((s) => ground(v, p.x - p.ty * p.hw * f * s, p.y + p.tx * p.hw * f * s, z));
}
function drawMarks(v, px, time) {
  // The start line: a chequered strip.
  const p = G.tr.pts[0], segs = 12;
  ctx.lineWidth = 9 * px; ctx.lineCap = 'butt';
  for (let s = 0; s < segs; s++) {
    const f0 = -1 + (2 * s) / segs, f1 = f0 + 2 / segs;
    const a = ground(v, p.x - p.ty * p.hw * f0, p.y + p.tx * p.hw * f0), b = ground(v, p.x - p.ty * p.hw * f1, p.y + p.tx * p.hw * f1);
    if (!a || !b) continue;
    ctx.strokeStyle = s % 2 ? 'rgba(20,22,28,0.85)' : 'rgba(240,244,250,0.9)';
    ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
  }
  // The next checkpoint: a dashed line across and a beacon at each side.
  if (R.phase !== 'race') return;
  const n = G.tr.cps[R.next], pulse = 0.6 + 0.4 * Math.sin(time * 6);
  const [a, b] = across(v, n, 0.95), [a2, b2] = across(v, n, 0.95, 60);
  ctx.strokeStyle = `rgba(125,249,255,${0.5 * pulse})`; ctx.lineWidth = 2 * px; ctx.setLineDash([8 * px, 8 * px]);
  if (a && b) { ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); }
  ctx.setLineDash([]); ctx.lineWidth = 3 * px; ctx.strokeStyle = `rgba(125,249,255,${pulse})`;
  for (const [g, t] of [[a, a2], [b, b2]]) if (g && t) { ctx.beginPath(); ctx.moveTo(g[0], g[1]); ctx.lineTo(t[0], t[1]); ctx.stroke(); }
}

function drawMinimap(Wc) {
  const size = Math.min(170, Wc * 0.32), x0 = Wc - size - 16, y0 = 64, s = size / (N * T), C = R.craft;
  ctx.save();
  ctx.fillStyle = 'rgba(5,6,10,0.7)'; ctx.fillRect(x0, y0, size, size);
  ctx.translate(x0, y0); ctx.scale(s, s);
  ctx.strokeStyle = 'rgba(223,230,242,0.25)'; ctx.lineWidth = 2 * HW; ctx.lineJoin = 'round'; ctx.stroke(G.mini);
  const dot = (x, y, r, col) => { ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x, y, r / s, 0, TAU); ctx.fill(); };
  for (const p of G.holes) dot(p.x, p.y, 1.6, p.emit ? '#ff8a3a' : '#c9a86a');
  for (const p of G.talls) dot(p.x, p.y, 1.8, '#ff5a5a');
  const st = G.tr.pts[0], cp = G.tr.pts[G.tr.cps[R.next]];
  dot(st.x, st.y, 2.5, '#ffffff');
  if (R.phase === 'race') dot(cp.x, cp.y, 3, '#7df9ff');
  ctx.translate(C.x, C.y); ctx.rotate(C.angle); ctx.scale(1 / s, 1 / s);
  ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.moveTo(6, 0); ctx.lineTo(-4, -4); ctx.lineTo(-4, 4); ctx.closePath(); ctx.fill();
  ctx.restore();
}

// The drag: a dashed ring of full-speed reach round where it began, a line to the finger (held to the
// ring) and the speed it sets (game/hud.js drawDragIndicator).
function drawDrag() {
  if (!drag.active) return;
  const md = maxDrag(), dx = drag.x - drag.x0, dy = drag.y - drag.y0, len = Math.hypot(dx, dy), k = len > md ? md / len : 1;
  const ex = drag.x0 + dx * k, ey = drag.y0 + dy * k;
  ctx.save();
  ctx.strokeStyle = '#cfd8ff'; ctx.globalAlpha = 0.5; ctx.lineWidth = 1.5; ctx.setLineDash([4, 6]); // stronger than the game's: it sits on bright ground
  ctx.beginPath(); ctx.arc(drag.x0, drag.y0, md, 0, TAU); ctx.stroke();
  ctx.setLineDash([]);
  ctx.globalAlpha = 0.8; ctx.strokeStyle = '#7df9ff'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(drag.x0, drag.y0); ctx.lineTo(ex, ey); ctx.stroke();
  ctx.beginPath(); ctx.arc(drag.x0, drag.y0, 4, 0, TAU); ctx.arc(ex, ey, 10, 0, TAU); ctx.stroke();
  if (len > DEADZONE) { ctx.fillStyle = '#7df9ff'; ctx.font = "12px 'IBM Plex Mono', ui-monospace, Menlo, Consolas, monospace"; ctx.fillText(`${Math.round(Math.min(len / md, 1) * 100)}%`, ex + 14, ey - 14); }
  ctx.restore();
}

const fmt = (t) => `${Math.floor(t / 60)}:${(t % 60).toFixed(2).padStart(5, '0')}`;
function render(time) {
  const dpr = Math.min(2, devicePixelRatio || 1), Wc = innerWidth, Hc = innerHeight, bg = Art.config.bg;
  if (cv.width !== Math.round(Wc * dpr) || cv.height !== Math.round(Hc * dpr)) { cv.width = Math.round(Wc * dpr); cv.height = Math.round(Hc * dpr); }
  Art.beginFrame();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = bg; ctx.fillRect(0, 0, Wc, Hc);
  if (S.curved) for (const [sx, sy, a] of STARS) { ctx.fillStyle = `rgba(230,236,255,${a * 0.8})`; ctx.fillRect(sx * Wc, sy * Hc, 1, 1); }
  const { far, tiles } = looks(), { v, zoom } = viewNow(Wc, Hc), px = 1 / zoom, C = R.craft;
  const got = tiles.layers(detailRect(v), 4), layers = [far, ...got];
  ctx.setTransform(dpr * zoom, 0, 0, dpr * zoom, 0, 0);
  if (S.curved) SurfaceGlobe.draw(ctx, layers, v, { dpr: dpr * zoom, fog: bg, fogDist: SurfaceGlobe.horizonDist(v) * 1.3, under: bg });
  else SurfaceGlobe.drawFlat(ctx, layers, v, { dpr: dpr * zoom, under: bg });
  drawMarks(v, px, time);

  // The ship at flight height, its shadow below and to the side (as game/landing.js draws it).
  const z = ArtSurface.FLY, [shx, shy] = ArtSurface.shadowShift(z), sh = ground(v, C.x + shx, C.y + shy);
  if (sh) { ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.beginPath(); ctx.ellipse(sh[0], sh[1], R_SHIP * 1.3, R_SHIP * 1.3 * v.ct, 0, 0, TAU); ctx.fill(); }
  const p = SurfaceGlobe.toScreen(v, C.x, C.y, z) || [v.ox + C.x - v.fx, v.oy + (C.y - v.fy) * v.ct - z * v.st], k = (SHIP.radius * 1.25 * SHIP_SCALE * SURFACE_SCALE) / ART.radius;
  ctx.save(); ctx.translate(p[0], p[1]); ctx.scale(k, k);
  Art.drawAsset(ctx, ART, S.style, { angle: C.angle, t: time, thrust: C.thrust });
  ctx.restore();

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (R.flash > 0 || R.burn) { ctx.fillStyle = R.flash > 0 ? `rgba(255,60,40,${R.flash})` : `rgba(255,120,30,${0.12 + 0.06 * Math.sin(time * 20)})`; ctx.fillRect(0, 0, Wc, Hc); }
  drawMinimap(Wc);
  drawDrag();
  if (R.phase === 'race' || R.phase === 'done') buildAhead(tiles, v);

  const best = R.laps.length ? Math.min(...R.laps) : null, lap = Math.min(LAPS, R.laps.length + 1), hullPct = Math.round((100 * R.hull) / HULL);
  hud.innerHTML = `<b>Lap ${lap}/${LAPS}</b> · ${fmt(R.lapT)} · total ${fmt(R.total)}<br>Best ${best === null ? '–' : fmt(best)} · last ${R.laps.length ? fmt(R.laps[R.laps.length - 1]) : '–'}<br>Hull ${hullPct}% · hits ${R.hits}${R.slow ? ` · <span style="color:#ffb03a">${R.burn ? 'burning' : 'slowed'}</span>` : ''}<br><span style="opacity:.6">${G.b.label} · seed ${S.seed} · ${Math.round(G.tr.len)} u a lap · ${G.talls.length} rocks, ${G.holes.length} holes on the track${got.missing ? ` · ${got.missing} chunks building` : ''}</span>`;
  let msg = '', big = false;
  if (R.phase === 'count') { msg = R.t < 2.4 ? String(3 - Math.floor(R.t / 0.8)) : 'GO'; big = true; }
  else if (R.phase === 'race' && R.total < 0.8) { msg = 'GO'; big = true; }
  else if (R.phase === 'race' && R.wrong > 0.8) msg = 'Wrong way';
  else if (R.phase === 'done') msg = `Finished in ${fmt(R.total)}\nBest lap ${fmt(best)} · ${R.hits} hits · hull ${hullPct}%\nR to race again · N for a new track`;
  else if (R.phase === 'wreck') msg = `The hull gave out on lap ${lap}\nR to try again · N for a new track`;
  if (note.textContent !== msg) note.textContent = msg;
  note.classList.toggle('big', big);
}

let last = 0;
function frame(t) {
  const dt = Math.min(0.05, (t - last) / 1000 || 0); last = t;
  step(dt); render(t / 1000);
  requestAnimationFrame(frame);
}

// ---------- Controls ----------

const $ = (id) => document.getElementById(id);
for (const id of Object.keys(BIOMES)) { const b = document.createElement('button'); b.id = id; b.textContent = BIOMES[id].label; b.onclick = () => busy(() => { S.biome = id; build(); }); $('biomes').append(b); }
function sync() {
  for (const id of Object.keys(BIOMES)) $(id).setAttribute('aria-pressed', S.biome === id);
  for (const [id, on] of [['line', S.style === 'line'], ['lowpoly', S.style === 'lowpoly'], ['curved', S.curved]]) $(id).setAttribute('aria-pressed', on);
}
function busy(fn) { document.body.classList.add('busy'); setTimeout(() => { fn(); sync(); document.body.classList.remove('busy'); }, 30); }
const newTrack = () => busy(() => { S.seed++; build(); });
$('line').onclick = () => busy(() => { S.style = 'line'; looks(); });
$('lowpoly').onclick = () => busy(() => { S.style = 'lowpoly'; looks(); });
$('curved').onclick = () => { S.curved = !S.curved; sync(); };
$('restart').onclick = () => busy(restart);
$('next').onclick = newTrack;
addEventListener('keydown', (e) => {
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (k === 'r') busy(restart); else if (k === 'n') newTrack(); else S.keys.add(k);
  if (k.startsWith('Arrow')) e.preventDefault();
});
addEventListener('keyup', (e) => S.keys.delete(e.key.length === 1 ? e.key.toLowerCase() : e.key));
addEventListener('blur', () => S.keys.clear());
// The game's drag (game/input.js): the heading is the drag's way (its screen height stretched back
// out of the view's tilt, so it points where it looks), the speed its length over maxDrag; dragging
// back to where it began throttles to zero. Letting go keeps the course (Cruise), or stops (Direct);
// in Cruise a double-tap stops, so one stray tap doesn't throw away your speed.
let lastTap = -Infinity;
cv.addEventListener('pointerdown', (e) => {
  if (drag.active || (e.pointerType === 'mouse' && e.button !== 0)) return;
  cv.setPointerCapture(e.pointerId);
  Object.assign(drag, { active: true, id: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, moved: 0 });
});
cv.addEventListener('pointermove', (e) => {
  if (!drag.active || e.pointerId !== drag.id) return;
  drag.x = e.clientX; drag.y = e.clientY;
  const dx = drag.x - drag.x0, dy = drag.y - drag.y0, len = Math.hypot(dx, dy);
  drag.moved = Math.max(drag.moved, len);
  if (len > DEADZONE) S.course = { angle: Math.atan2(dy / Math.cos(ArtSurface.tiltOf(S.style)), dx), speed: Math.min(len / maxDrag(), 1) };
  else if (drag.moved > DEADZONE) S.course.speed = 0;
});
function endDrag(e) {
  if (!drag.active || e.pointerId !== drag.id) return;
  drag.active = false;
  if (MODE === 'direct') { S.course.speed = 0; return; }
  if (e.type !== 'pointerup' || drag.moved >= DEADZONE) return;
  const t = e.timeStamp / 1000, double = t - lastTap <= DOUBLE_TAP;
  lastTap = double ? -Infinity : t;
  if (double) S.course.speed = 0;
}
cv.addEventListener('pointerup', endDrag);
cv.addEventListener('pointercancel', endDrag);
cv.addEventListener('contextmenu', (e) => e.preventDefault());

window.race = { S, drag, get G() { return G; }, get R() { return R; } }; // to poke at from the console
busy(() => { build(); requestAnimationFrame(frame); });
