// Surface prototype (tools/surface.html; serve the repo, e.g. `npm start`, and open /tools/surface.html):
// land on a planet or moon, fly over its surface (ArtSurface) drawn bent over a globe
// (SurfaceGlobe), and take off again.
//
// The landing site is the middle of the generated surface, ringed by a natural rim (cliffs with
// gaps, or open sea); the ground round it is there to see out to the horizon. Flying out past the
// rim, or Take off, climbs back to orbit. Near ground is drawn from detailed chunks built as the
// ship moves; far ground from one low-detail image of the whole surface.
//
// One value, u, runs from 0 (in orbit) to 1 (on the surface); landing and take-off move it, and the
// view follows it: zoom, the ship's altitude, the curvature, how far the ground stays flat, the
// detail's opacity. From orbit the globe is larger (ORBIT_R, at least 4 R) so it shows the whole
// landing site and the land round it; it bends down to the surface's curvature as the ship lands.
// Keys: WASD or arrows to fly, T to take off, L to land; or hold the pointer where to go.
// Query parameters: ?body=moon, ?style=line, ?flat, ?R=, ?bend= (the flat zone), ?site= (tiles a
// side), ?surface (start landed), ?u= (hold a point of the landing), ?x=, ?y=.

import { Art } from '../src/art/render.js';
import { ArtSurface } from '../src/art/surface.js';
import { SurfaceGlobe } from '../src/art/surface-globe.js';

const q = new URLSearchParams(location.search), T = ArtSurface.T;
const SITE = Math.max(16, Math.min(128, +q.get('site') || 48)), FRINGE = Math.ceil(3200 / T), SIZE = SITE + 2 * FRINGE;
const BODIES = {
  planet: { type: 'terran', seed: 3, label: 'Terran planet', air: '#7fb2ea', R: 450, bend: 250 },
  moon: { type: 'moon-grey', seed: 5, label: 'Grey moon', air: null, R: 350, bend: 200 },
};
const ORBIT_R = 1800, ORBIT_Z = 900, LAND_S = 3.8, LIFT_S = 3.2;
const S = { body: 'planet', style: 'lowpoly', curved: true, R: 450, bend: 250, x: 0, y: 0, vx: 0, vy: 0, head: -Math.PI / 2, phase: 'landing', u: 0, hold: null, keys: new Set(), ptr: null };
const cv = document.getElementById('view'), ctx = cv.getContext('2d'), hud = document.getElementById('hud'), note = document.getElementById('note');
const coarse = matchMedia('(pointer: coarse)').matches, bodies = {};
const sstep = (a, b, v) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;

function body() {
  const b = BODIES[S.body];
  if (!bodies[S.body]) bodies[S.body] = { W: ArtSurface.generate(b.type, b.seed, { w: SIZE, h: SIZE, site: [FRINGE, FRINGE, FRINGE + SITE, FRINGE + SITE] }), far: {}, tiles: {} };
  const o = bodies[S.body];
  o.far[S.style] = o.far[S.style] || ArtSurface.farImage(o.W, S.style);
  o.tiles[S.style] = o.tiles[S.style] || SurfaceGlobe.tiles(o.W, S.style, { size: 8, dpr: coarse ? 1 : 1.5, keep: 28 });
  return { ...o, b, bi: ArtSurface.BIOMES[o.W.type], far: o.far[S.style], tiles: o.tiles[S.style] };
}

// The view for a point u of the landing (0: orbit, 1: on the surface), the screen Wc × Hc.
function viewAt(u, Wc, Hc) {
  const e = u * u * (3 - 2 * u), tilt = ArtSurface.tiltOf(S.style), st = Math.sin(tilt);
  const Ro = S.curved ? Math.max(4 * S.R, ORBIT_R) : 1e9, z0 = S.curved ? Math.min(1, (0.36 * Math.min(Wc, Hc)) / Ro) : 0.3;
  const zoom = Math.exp(lerp(Math.log(z0), 0, e)), R = S.curved ? 1 / lerp(1 / Ro, 1 / S.R, e) : 1e9; // curvature, not radius, blends evenly
  const oyCss = lerp(S.curved ? Hc / 2 - Ro * st * z0 : Hc / 2, Hc * 0.68, e); // from orbit: the globe's middle in the screen's
  const v = SurfaceGlobe.view({ R: Math.round(R), flat: S.curved ? Math.round(lerp(0, S.bend, e)) : 0, fx: S.x, fy: S.y, W: Wc / zoom, H: Hc / zoom, ox: Wc / 2 / zoom, oy: oyCss / zoom, tilt });
  return { v, zoom, e, z: lerp(ORBIT_Z, ArtSurface.FLY, e) };
}
// Detailed chunks over the ground the view shows, out to `ahead` (they fade out beyond 2/3 of it)
// and no wider than a landed view needs, however far out the view is zoomed: past that, the
// low-detail image does.
function detail(tiles, v, budget) {
  const ex = SurfaceGlobe.extent(v), ahead = Math.min(1100, SurfaceGlobe.horizonDist(v) * 0.8);
  const rect = { x0: Math.max(ex.x0, v.fx - 900), x1: Math.min(ex.x1, v.fx + 900), y0: Math.max(ex.y0, v.fy - ahead), y1: Math.min(ex.y1, v.fy + 600), cx: v.fx, cy: v.fy };
  return tiles.layers(rect, budget, [ahead * 0.65, ahead]);
}

function land() {
  const { W, tiles } = body();
  [S.x, S.y] = W.start; S.vx = S.vy = 0; S.head = -Math.PI / 2;
  // Build the chunks the landed view needs now, so they're there when the ground comes close.
  detail(tiles, viewAt(1, innerWidth, innerHeight).v, Infinity);
  S.phase = 'landing'; S.u = 0;
}
function takeOff() { if (S.phase === 'surface' || S.phase === 'landing') S.phase = 'takeoff'; }

// Stars: fixed points on the screen (they're far enough not to move with the camera).
const STARS = Array.from({ length: 220 }, (_, i) => { const h = (n) => { const v = Math.sin(i * 127.1 + n * 311.7) * 43758.5453; return v - Math.floor(v); }; return [h(1), h(2), 0.3 + 0.7 * h(3)]; });

function step(dt) {
  if (S.hold !== null) { S.u = S.hold; return; }
  const { W } = body();
  if (S.phase === 'landing') { S.u = Math.min(1, S.u + dt / LAND_S); if (S.u >= 1) S.phase = 'surface'; }
  else if (S.phase === 'takeoff') { S.u = Math.max(0, S.u - dt / LIFT_S); if (S.u <= 0) S.phase = 'orbit'; }
  if (S.phase === 'orbit') return;
  let ax = 0, ay = 0;
  if (S.phase === 'surface') {
    const K = S.keys;
    if (K.has('ArrowLeft') || K.has('a')) ax--; if (K.has('ArrowRight') || K.has('d')) ax++;
    if (K.has('ArrowUp') || K.has('w')) ay--; if (K.has('ArrowDown') || K.has('s')) ay++;
    if (S.ptr && S.shipAt) { const dx = S.ptr[0] - S.shipAt[0], dy = S.ptr[1] - S.shipAt[1], l = Math.hypot(dx, dy); if (l > 12) { ax = dx / l; ay = dy / l; } }
  }
  const l = Math.hypot(ax, ay) || 1;
  S.vx = (S.vx + (ax / l) * 520 * dt) * Math.exp(-2.2 * dt); S.vy = (S.vy + (ay / l) * 520 * dt) * Math.exp(-2.2 * dt);
  if (Math.hypot(S.vx, S.vy) > 8) S.head = Math.atan2(S.vy, S.vx);
  const free = S.phase !== 'surface'; // climbing or descending: above everything
  if (free || !ArtSurface.blocked(W, S.x + S.vx * dt, S.y, 8)) S.x += S.vx * dt; else S.vx = 0;
  if (free || !ArtSurface.blocked(W, S.x, S.y + S.vy * dt, 8)) S.y += S.vy * dt; else S.vy = 0;
  if (S.phase === 'surface' && ArtSurface.siteDist(W, S.x, S.y) > W.site.leave) takeOff();
}

function path(pts, dy = 0) { ctx.beginPath(); pts.forEach(([x, y], k) => (k ? ctx.lineTo(x, y + dy) : ctx.moveTo(x, y + dy))); }

function render() {
  const dpr = Math.min(2, devicePixelRatio || 1), Wc = innerWidth, Hc = innerHeight;
  if (cv.width !== Math.round(Wc * dpr) || cv.height !== Math.round(Hc * dpr)) { cv.width = Math.round(Wc * dpr); cv.height = Math.round(Hc * dpr); }
  const { W, b, bi, far, tiles } = body(), line = S.style === 'line', bg = Art.config.bg;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = bg; ctx.fillRect(0, 0, Wc, Hc);
  for (const [sx, sy, a] of STARS) { ctx.fillStyle = `rgba(230,236,255,${a * 0.8})`; ctx.fillRect(sx * Wc, sy * Hc, a > 0.85 ? 1.6 : 1, a > 0.85 ? 1.6 : 1); }

  const { v, zoom, z } = viewAt(S.u, Wc, Hc), air = !line && b.air, px = 1 / zoom; // px: one CSS pixel in view units
  const layers = [far];
  const dA = sstep(0.35, 0.75, S.u);
  if (dA > 0) for (const L of detail(tiles, v, S.phase === 'orbit' ? 0 : 8)) { L.alpha = dA; layers.push(L); }
  ctx.setTransform(dpr * zoom, 0, 0, dpr * zoom, 0, 0);
  const hz = SurfaceGlobe.horizonDist(v);
  SurfaceGlobe.draw(ctx, layers, v, { dpr: dpr * zoom, fog: air || bg, fogDist: S.curved ? hz * (b.air ? 0.85 : 1.3) : 0, under: air || bg });

  // The limb: a line in the Line style (a dashed atmosphere shell above it on planets); in
  // Low-poly, stepped bands of the air's colour on planets, a faint rim on moons.
  const pts = SurfaceGlobe.limb(v);
  if (pts && pts.length > 1) {
    ctx.lineJoin = 'round';
    if (line) {
      path(pts); ctx.strokeStyle = bi.line; ctx.lineWidth = 1.3 * px; ctx.stroke();
      if (b.air) { path(pts, -9 * px); ctx.setLineDash([4 * px, 5 * px]); ctx.strokeStyle = bi.line + '88'; ctx.lineWidth = px; ctx.stroke(); ctx.setLineDash([]); }
    } else if (air) {
      for (const [w, a] of [[26, 0.1], [14, 0.18], [6, 0.35]]) { path(pts, (-w / 2) * px); ctx.strokeStyle = air + Math.round(a * 255).toString(16).padStart(2, '0'); ctx.lineWidth = w * px; ctx.stroke(); }
      path(pts, -0.5 * px); ctx.strokeStyle = '#dff0ff'; ctx.lineWidth = 1.5 * px; ctx.stroke();
    } else { path(pts, -0.5 * px); ctx.strokeStyle = 'rgba(230,230,225,0.45)'; ctx.lineWidth = px; ctx.stroke(); }
  }

  // The ship over the focus, at altitude z; its shadow on the ground.
  const p = [v.ox, v.oy - z * v.st];
  S.shipAt = [p[0] * zoom, p[1] * zoom];
  if (S.phase !== 'orbit') {
    const [shx, shy] = ArtSurface.shadowShift(z), gx = S.x + shx, gy = S.y + shy;
    const sh = SurfaceGlobe.toScreen(v, gx, gy, ArtSurface.heightAt(W, gx, gy)), ss = px * lerp(1, 0.6, 1 - zoom);
    const hull = [[13, 0], [-9, -8], [-5, 0], [-9, 8]].map(([a, c]) => [(a * Math.cos(S.head) - c * Math.sin(S.head)) * ss, (a * Math.sin(S.head) + c * Math.cos(S.head)) * v.ct * ss]);
    const sa = 0.35 * (1 - sstep(60, 400, z));
    if (sh && sa > 0.01) { path(hull.map(([a, c]) => [sh[0] + a, sh[1] + c])); ctx.fillStyle = `rgba(0,0,0,${sa})`; ctx.fill(); }
    const sp = hull.map(([a, c]) => [p[0] + a, p[1] + c]);
    if (line) { path(sp); ctx.closePath(); ctx.fillStyle = bg; ctx.fill(); ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.3 * px; ctx.stroke(); }
    else { path([sp[0], sp[1], sp[2]]); ctx.fillStyle = '#e8ecf2'; ctx.fill(); path([sp[0], sp[2], sp[3]]); ctx.fillStyle = '#9aa4b4'; ctx.fill(); }
  }

  const d = ArtSurface.siteDist(W, S.x, S.y);
  note.textContent = S.phase === 'orbit' ? `In orbit over the ${b.label.toLowerCase()}` : S.phase === 'landing' ? 'Descending to the landing site' : S.phase === 'takeoff' ? 'Climbing to orbit' : d > W.site.leave - 2 * T ? 'Past the rim: fly on to climb to orbit' : '';
  hud.textContent = `${b.label} · ${line ? 'Line' : 'Low-poly'} · ${S.curved ? `R ${S.R}, flat ${S.bend}` : 'flat'} · site ${SITE}×${SITE} · chunks ${tiles.size()}`;
}

let last = 0;
function frame(t) {
  const dt = Math.min(0.05, (t - last) / 1000 || 0); last = t;
  step(dt); render(); sync(true);
  requestAnimationFrame(frame);
}

// Controls.
const $ = (id) => document.getElementById(id);
function sync(light) {
  const fly = $('fly'), lbl = S.phase === 'orbit' || S.phase === 'takeoff' ? 'Land' : 'Take off';
  if (fly.textContent !== lbl) fly.textContent = lbl;
  if (light) return;
  for (const [id, on] of [['planet', S.body === 'planet'], ['moon', S.body === 'moon'], ['line', S.style === 'line'], ['lowpoly', S.style === 'lowpoly'], ['curved', S.curved]]) $(id).setAttribute('aria-pressed', on);
  $('radius').value = S.R; $('bend').value = S.bend; $('radius').disabled = $('bend').disabled = !S.curved;
  $('rval').textContent = S.R; $('bval').textContent = S.bend;
}
function busy(fn) { document.body.classList.add('busy'); setTimeout(() => { fn(); sync(); document.body.classList.remove('busy'); }, 30); }
function pick(id) { const b = BODIES[id]; S.body = id; S.R = b.R; S.bend = b.bend; land(); }
$('planet').onclick = () => busy(() => pick('planet'));
$('moon').onclick = () => busy(() => pick('moon'));
$('line').onclick = () => busy(() => { S.style = 'line'; body(); });
$('lowpoly').onclick = () => busy(() => { S.style = 'lowpoly'; body(); });
$('curved').onclick = () => { S.curved = !S.curved; sync(); };
$('radius').oninput = () => { S.R = +$('radius').value; sync(); };
$('bend').oninput = () => { S.bend = +$('bend').value; sync(); };
function landNow() { if (S.phase === 'orbit') busy(land); else if (S.phase === 'takeoff') S.phase = 'landing'; } // mid-climb: turn back
$('fly').onclick = () => (S.phase === 'orbit' || S.phase === 'takeoff' ? landNow() : takeOff());
addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (k === 't') takeOff(); else if (k === 'l') landNow(); else S.keys.add(k);
});
addEventListener('keyup', (e) => S.keys.delete(e.key.length === 1 ? e.key.toLowerCase() : e.key));
cv.addEventListener('pointerdown', (e) => { S.ptr = [e.clientX, e.clientY]; cv.setPointerCapture(e.pointerId); });
cv.addEventListener('pointermove', (e) => { if (S.ptr) S.ptr = [e.clientX, e.clientY]; });
for (const ev of ['pointerup', 'pointercancel']) cv.addEventListener(ev, () => { S.ptr = null; });

if (q.get('body') in BODIES) S.body = q.get('body');
if (q.get('style') === 'line') S.style = 'line';
busy(() => {
  pick(S.body);
  if (q.has('flat')) S.curved = false;
  if (q.get('R')) S.R = +q.get('R');
  if (q.get('bend')) S.bend = +q.get('bend');
  if (q.get('x')) S.x = +q.get('x');
  if (q.get('y')) S.y = +q.get('y');
  if (q.has('surface')) { S.phase = 'surface'; S.u = 1; }
  if (q.get('u')) S.hold = +q.get('u');
  requestAnimationFrame(frame);
});
