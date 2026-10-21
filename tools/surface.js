// Surface prototype (tools/surface.html; serve the repo, e.g. `npm start`, and open /tools/surface.html):
// fly over a planet or moon surface (ArtSurface) drawn bent over a globe (SurfaceGlobe), with fog,
// a horizon and the atmosphere's limb. The landing site is the middle of the generated surface,
// marked with a dashed line; the fringe around it is there to see out to the horizon. Flying past
// the site's edge climbs back to orbit (here: back to the landing spot).
// Keys: WASD or arrows to fly; or hold the pointer where to go.

import { Art } from '../src/art/render.js';
import { ArtSurface } from '../src/art/surface.js';
import { SurfaceGlobe } from '../src/art/surface-globe.js';

const T = ArtSurface.T, SIZE = 40, FRINGE = 8, SITE = [FRINGE * T, (SIZE - FRINGE) * T];
const BODIES = {
  planet: { type: 'terran', seed: 3, label: 'Terran planet', air: '#7fb2ea', R: 900 },
  moon: { type: 'moon-grey', seed: 5, label: 'Grey moon', air: null, R: 600 },
};
const S = { body: 'planet', style: 'lowpoly', curved: true, R: BODIES.planet.R, x: 0, y: 0, vx: 0, vy: 0, head: -Math.PI / 2, leaving: 0, keys: new Set(), ptr: null };
const cv = document.getElementById('view'), ctx = cv.getContext('2d'), hud = document.getElementById('hud');
const coarse = matchMedia('(pointer: coarse)').matches;
const worlds = {}, images = {};

function surface() {
  const b = BODIES[S.body], key = S.body + '/' + S.style;
  const W = (worlds[S.body] = worlds[S.body] || ArtSurface.generate(b.type, b.seed, { w: SIZE, h: SIZE }));
  images[key] = images[key] || ArtSurface.render(W, S.style, { dpr: coarse ? 1 : 1.5 });
  return { W, img: images[key], b, bi: ArtSurface.BIOMES[W.type] };
}
function land() { const { W } = surface(); [S.x, S.y] = W.start; S.vx = S.vy = 0; S.leaving = 0; }

// Stars: fixed points on the screen (they're far enough not to move with the camera).
const STARS = Array.from({ length: 220 }, (_, i) => { const h = (n) => { const v = Math.sin(i * 127.1 + n * 311.7) * 43758.5453; return v - Math.floor(v); }; return [h(1), h(2), 0.3 + 0.7 * h(3)]; });

function step(dt) {
  let ax = 0, ay = 0;
  const K = S.keys;
  if (K.has('ArrowLeft') || K.has('a')) ax--; if (K.has('ArrowRight') || K.has('d')) ax++;
  if (K.has('ArrowUp') || K.has('w')) ay--; if (K.has('ArrowDown') || K.has('s')) ay++;
  if (S.ptr && S.shipAt) { const dx = S.ptr[0] - S.shipAt[0], dy = S.ptr[1] - S.shipAt[1], l = Math.hypot(dx, dy); if (l > 12) { ax = dx / l; ay = dy / l; } }
  const l = Math.hypot(ax, ay) || 1;
  S.vx = (S.vx + (ax / l) * 520 * dt) * Math.exp(-2.2 * dt); S.vy = (S.vy + (ay / l) * 520 * dt) * Math.exp(-2.2 * dt);
  if (Math.hypot(S.vx, S.vy) > 8) S.head = Math.atan2(S.vy, S.vx);
  const { W } = surface();
  if (!ArtSurface.blocked(W, S.x + S.vx * dt, S.y, 8)) S.x += S.vx * dt; else S.vx = 0;
  if (!ArtSurface.blocked(W, S.x, S.y + S.vy * dt, 8)) S.y += S.vy * dt; else S.vy = 0;
  const out = S.x < SITE[0] || S.x > SITE[1] || S.y < SITE[0] || S.y > SITE[1];
  S.leaving = out ? S.leaving + dt : 0;
  if (S.leaving > 1.4) land();
}

function path(pts, dy = 0) { ctx.beginPath(); pts.forEach(([x, y], k) => (k ? ctx.lineTo(x, y + dy) : ctx.moveTo(x, y + dy))); }

function render() {
  const dpr = Math.min(2, devicePixelRatio || 1), Wc = innerWidth, Hc = innerHeight;
  if (cv.width !== Math.round(Wc * dpr) || cv.height !== Math.round(Hc * dpr)) { cv.width = Math.round(Wc * dpr); cv.height = Math.round(Hc * dpr); }
  const { W, img, b, bi } = surface(), line = S.style === 'line', bg = Art.config.bg;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = bg; ctx.fillRect(0, 0, Wc, Hc);
  for (const [sx, sy, a] of STARS) { ctx.fillStyle = `rgba(230,236,255,${a * 0.8})`; ctx.fillRect(sx * Wc, sy * Hc, a > 0.85 ? 1.6 : 1, a > 0.85 ? 1.6 : 1); }

  const air = !line && b.air, R = S.curved ? S.R : 1e9;
  const v = SurfaceGlobe.view({ R, fx: S.x, fy: S.y, W: Wc, H: Hc, ox: Wc / 2, oy: Hc * 0.64 });
  SurfaceGlobe.draw(ctx, img, v, { dpr, fog: air || bg, fogDist: S.curved ? R * (b.air ? 0.9 : 1.8) : 0, under: air || (line ? bg : bi.a.col) });

  // The limb: a line in the Line style (a dashed atmosphere shell above it on planets); in
  // Low-poly, stepped bands of the air's colour on planets, a faint rim on moons.
  if (S.curved) {
    const pts = [];
    for (let X = -8; X <= Wc + 8; X += 8) { const y = SurfaceGlobe.horizon(v, X); if (y !== null) pts.push([X, y]); }
    if (pts.length > 1) {
      ctx.lineJoin = 'round';
      if (line) {
        path(pts); ctx.strokeStyle = bi.line; ctx.lineWidth = 1.3; ctx.stroke();
        if (b.air) { path(pts, -9); ctx.setLineDash([4, 5]); ctx.strokeStyle = bi.line + '88'; ctx.lineWidth = 1; ctx.stroke(); ctx.setLineDash([]); }
      } else if (air) {
        for (const [w, a] of [[26, 0.1], [14, 0.18], [6, 0.35]]) { path(pts, -w / 2); ctx.strokeStyle = air + Math.round(a * 255).toString(16).padStart(2, '0'); ctx.lineWidth = w; ctx.stroke(); }
        path(pts, -0.5); ctx.strokeStyle = '#dff0ff'; ctx.lineWidth = 1.5; ctx.stroke();
      } else { path(pts, -0.5); ctx.strokeStyle = 'rgba(230,230,225,0.45)'; ctx.lineWidth = 1; ctx.stroke(); }
    }
  }

  // The landing site's edge, on the ground.
  const edge = [], Ls = SITE[1] - SITE[0];
  for (let s = 0; s <= 4 * Ls; s += 24) {
    const e = Math.floor(s / Ls) % 4, u = s % Ls;
    const [x, y] = [[SITE[0] + u, SITE[0]], [SITE[1], SITE[0] + u], [SITE[1] - u, SITE[1]], [SITE[0], SITE[1] - u]][e];
    edge.push(SurfaceGlobe.toScreen(v, x, y, ArtSurface.heightAt(W, x, y)));
  }
  ctx.beginPath(); let pen = false;
  for (const p of edge) { if (!p) { pen = false; continue; } pen ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]); pen = true; }
  ctx.setLineDash([6, 6]); ctx.strokeStyle = line ? bi.line + 'aa' : 'rgba(255,255,255,0.55)'; ctx.lineWidth = 1.2; ctx.stroke(); ctx.setLineDash([]);

  // The ship at flight altitude, its shadow on the ground.
  const [shx, shy] = ArtSurface.shadowShift(ArtSurface.FLY), gx = S.x + shx, gy = S.y + shy;
  const sh = SurfaceGlobe.toScreen(v, gx, gy, ArtSurface.heightAt(W, gx, gy)), p = SurfaceGlobe.toScreen(v, S.x, S.y, ArtSurface.FLY);
  S.shipAt = p;
  const hull = [[13, 0], [-9, -8], [-5, 0], [-9, 8]].map(([a, c]) => [a * Math.cos(S.head) - c * Math.sin(S.head), (a * Math.sin(S.head) + c * Math.cos(S.head)) * v.ct]);
  if (sh) { path(hull.map(([a, c]) => [sh[0] + a, sh[1] + c])); ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fill(); }
  if (p) {
    const pts = hull.map(([a, c]) => [p[0] + a, p[1] + c]);
    if (line) { path(pts); ctx.closePath(); ctx.fillStyle = bg; ctx.fill(); ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.3; ctx.stroke(); }
    else {
      path([pts[0], pts[1], pts[2]]); ctx.fillStyle = '#e8ecf2'; ctx.fill();
      path([pts[0], pts[2], pts[3]]); ctx.fillStyle = '#9aa4b4'; ctx.fill();
    }
  }

  if (S.leaving > 0) {
    const f = Math.min(1, S.leaving / 1.4);
    ctx.fillStyle = `rgba(5,6,10,${f})`; ctx.fillRect(0, 0, Wc, Hc);
    ctx.fillStyle = `rgba(230,236,255,${Math.min(1, f * 3)})`; ctx.font = '600 15px system-ui, sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('Leaving the landing site: climbing to orbit', Wc / 2, Hc * 0.4); ctx.textAlign = 'left';
  }
  hud.textContent = `${b.label} · ${line ? 'Line' : 'Low-poly'} · ${S.curved ? 'R ' + S.R : 'flat'}`;
}

let last = 0;
function frame(t) {
  const dt = Math.min(0.05, (t - last) / 1000 || 0); last = t;
  step(dt); render();
  requestAnimationFrame(frame);
}

// Controls.
const $ = (id) => document.getElementById(id), radius = $('radius');
function sync() {
  for (const [id, on] of [['planet', S.body === 'planet'], ['moon', S.body === 'moon'], ['line', S.style === 'line'], ['lowpoly', S.style === 'lowpoly'], ['curved', S.curved]]) $(id).setAttribute('aria-pressed', on);
  radius.value = S.R; radius.disabled = !S.curved; $('rval').textContent = S.R;
}
function busy(fn) { document.body.classList.add('busy'); setTimeout(() => { fn(); sync(); document.body.classList.remove('busy'); }, 30); }
$('planet').onclick = () => busy(() => { S.body = 'planet'; S.R = BODIES.planet.R; land(); });
$('moon').onclick = () => busy(() => { S.body = 'moon'; S.R = BODIES.moon.R; land(); });
$('line').onclick = () => busy(() => { S.style = 'line'; surface(); });
$('lowpoly').onclick = () => busy(() => { S.style = 'lowpoly'; surface(); });
$('curved').onclick = () => { S.curved = !S.curved; sync(); };
radius.oninput = () => { S.R = +radius.value; sync(); };
addEventListener('keydown', (e) => { if (e.target.tagName !== 'INPUT') S.keys.add(e.key.length === 1 ? e.key.toLowerCase() : e.key); });
addEventListener('keyup', (e) => S.keys.delete(e.key.length === 1 ? e.key.toLowerCase() : e.key));
cv.addEventListener('pointerdown', (e) => { S.ptr = [e.clientX, e.clientY]; cv.setPointerCapture(e.pointerId); });
cv.addEventListener('pointermove', (e) => { if (S.ptr) S.ptr = [e.clientX, e.clientY]; });
for (const ev of ['pointerup', 'pointercancel']) cv.addEventListener(ev, () => { S.ptr = null; });

// Query parameters for screenshots: ?body=moon&style=line&flat&R=700&x=..&y=..
const q = new URLSearchParams(location.search);
if (q.get('body') in BODIES) { S.body = q.get('body'); S.R = BODIES[S.body].R; }
if (q.get('style') === 'line') S.style = 'line';
if (q.has('flat')) S.curved = false;
if (q.get('R')) S.R = +q.get('R');
busy(() => { land(); if (q.get('x')) S.x = +q.get('x'); if (q.get('y')) S.y = +q.get('y'); requestAnimationFrame(frame); });
