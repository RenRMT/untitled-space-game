// Landing on a planet or moon, flying round its landing site (art/surface.js) and taking off again.
// The Land action (a planet's or moon's context menu, or L) starts it; on the surface, Take off (its
// button, or T) or flying out past the landing site's rim ends it.
//
// Landing goes through these phases; taking off goes through them backwards (climb, unfade, ascend):
//   descend   in space: the camera closes in on the planet until it's a third of the screen across
//             and the ship dives into it; the surface is built meanwhile (held here until it's ready)
//   fade      the planet's own art fades into its surface drawn as a globe of the same size, the
//             landing site at the top (art/surface-globe.js)
//   approach  the globe: the view zooms in and the ground flattens out (the only curvature there
//             is: the surface itself is flat) while the ship comes down to flight altitude
//   surface   flat ground: fly round the landing site; the minimap shows the planet, the site and
//             where you are on it
// From the descent until the ship is back in space, flight, the map and the context menu are off.
//
//   LANDABLE, landable(e)       the planet and moon types that have a surface, and whether e does
//   land(e), takeOff()
//   landing                     { on, phase, t, u, e, craft }: u runs 0 (orbit) .. 1 (down)
//   tickLanding(dt)             a step: from update() while the view is space (it then steers the
//                               ship and returns true), from the frame loop on the surface
//   landingCamera()             in space: the camera and zoom closing in on the planet, or pulling back
//   onSurface()                 whether the surface is what's drawn (the loop draws it instead of space)
//   drawLanding()               the surface's frame; drawLandingOverlay(): the globe fading in or
//                               out over the planet, in space
//   landingShipScale()          the ship's size in space as it dives in or comes out (0..1)
// Part of the flight view; src/main.js starts it.

import { Art } from '../art/render.js';
import { ArtBodies } from '../art/bodies.js';
import { ArtSurface } from '../art/surface.js';
import { SurfaceGlobe } from '../art/surface-globe.js';
import { Feedback } from '../core/feedback.js';
import { smoothstep } from '../core/math.js';
import { COLORS, Theme } from '../core/theme.js';
import { Entities } from '../flight/entities.js';
import { Flight } from '../flight/flight.js';
import { actions, docked } from './docking.js';
import { drawEventLog, minimapBox } from './hud.js';
import { drag } from './input.js';
import { stopMining } from './mining.js';
import { artStyle, moveMode } from './options.js';
import { placeShip } from './outfitting.js';
import { select } from './selection.js';
import { drawStarfield } from './starfield.js';
import { SHIP, TAU, autopilot, cam, clamp, ctx, inFight, lerp, notify, setMode, ship, view } from './state.js';
import { warp } from './warp.js';
import { world } from './world.js';

// The planet and moon types with a surface to land on (art/surface.js types): one of each for now.
export const LANDABLE = { planet: ['terran'], moon: ['grey'] };
export const landable = (e) => (LANDABLE[e.kind] || []).includes(e.body.type);

// Seconds each phase takes.
const TIME = { descend: 1.8, fade: 0.6, approach: 3.4, climb: 3, unfade: 0.6, ascend: 1.6 };
const SPACE_PHASES = ['descend', 'fade', 'unfade', 'ascend'];
// The surface: a landing site SITE tiles across in the middle, with FRINGE tiles of ground round it
// to see out to the horizon while the globe is in view.
const SITE = 48, FRINGE = Math.ceil(3200 / ArtSurface.T), SIZE = SITE + 2 * FRINGE;
const ORBIT_R = 1800; // the globe's radius as the landing starts (world units): it shows the site and the land round it
const ORBIT_Z = 900; // the ship's altitude then
const DISC = 0.36; // the planet's radius on screen when the globe takes over, a share of the screen's smaller side
// The air's colour, for the haze and the glow at the limb; moons have none.
const AIR = { terran: '#7fb2ea', blue: '#7fa8ea', desert: '#e0b080', ice: '#cfe6f5', lava: '#c0603a', gas: '#e8c890' };
// On the surface the ship flies slower, and is drawn smaller, than in space: the ground is close.
const SURFACE_SPEED = 0.4, SURFACE_SCALE = 0.85;

export const landing = {
  on: false, phase: null, t: 0, u: 0, e: null, from: null, out: null,
  craft: { x: 0, y: 0, vx: 0, vy: 0, angle: -Math.PI / 2, thrust: 0 }, // the ship on the surface (surface units)
};
export const onSurface = () => landing.on && !SPACE_PHASES.includes(landing.phase);

// Each surface is generated the first time it's needed and kept: { W, far: { style: builder },
// tiles: { style: chunks } }, by the body's name.
const surfaces = new Map();
function surface() {
  const e = landing.e, style = artStyle.value;
  let s = surfaces.get(e.key);
  if (!s) {
    const type = e.kind === 'moon' ? ArtSurface.moonSurface(e.body.type) : e.body.type;
    s = { W: ArtSurface.generate(type, e.body.seed, { w: SIZE, h: SIZE, site: [FRINGE, FRINGE, FRINGE + SITE, FRINGE + SITE] }), far: {}, tiles: {} };
    surfaces.set(e.key, s);
  }
  s.far[style] ||= ArtSurface.farBuilder(s.W, style, { upp: 10 });
  s.tiles[style] ||= SurfaceGlobe.tiles(s.W, style, { size: 8, dpr: clamp(view.dpr * view.base, 1, 1.5), keep: 28 });
  return { W: s.W, far: s.far[style], tiles: s.tiles[style] };
}

// ---------- Landing and taking off ----------

export function land(e) {
  if (landing.on || docked || inFight() || warp.on || !actions.state('land', e).ok) return;
  stopMining();
  select(null);
  autopilot.key = null;
  drag.active = false;
  ship.targetSpeed = 0;
  Object.assign(landing, { on: true, phase: 'descend', t: 0, u: 0, e, from: { x: ship.x, y: ship.y, cx: cam.x, cy: cam.y, zoom: view.zoom } });
  setMode('landing', true);
  notify(`Landing on ${e.name}`, 2.5);
}

export function takeOff() {
  if (landing.phase !== 'surface' && landing.phase !== 'approach') return;
  const L = landing;
  // Mid-approach, turn back from where it's got to.
  L.t = L.phase === 'approach' ? (1 - L.u) * TIME.climb : 0;
  L.phase = 'climb';
  setMode('landed', false);
  notify(`Taking off from ${L.e.name}`, 2.5);
}

const next = (phase) => { landing.phase = phase; landing.t = 0; };

export function tickLanding(dt) {
  if (!landing.on) return false;
  const L = landing, s = surface(), e = L.e;
  L.t += dt;
  const k = Math.min(1, L.t / TIME[L.phase] || 0);
  switch (L.phase) {
    case 'descend': {
      // Into the planet, the ship shrinking as it goes; the surface built a little each frame.
      const ready = s.far.step(8);
      const m = smoothstep(0.2, 1, k);
      ship.x = lerp(L.from.x, e.x, m);
      ship.y = lerp(L.from.y, e.y, m);
      ship.angle = ship.targetAngle = Math.atan2(e.y - L.from.y, e.x - L.from.x);
      ship.vx = ship.vy = 0;
      ship.thrust = 1 - k;
      if (ready) warmTiles(s, 6);
      if (k >= 1 && ready) {
        const [x, y] = s.W.start;
        Object.assign(L.craft, { x, y, vx: 0, vy: 0, angle: -Math.PI / 2, thrust: 0 });
        next('fade');
      }
      return true;
    }
    case 'fade':
      warmTiles(s, 6);
      if (k >= 1) next('approach');
      return true;
    case 'approach':
      L.u = k;
      if (k >= 1) { next('surface'); L.u = 1; setMode('landed', true); Feedback.emit('docked'); }
      return false;
    case 'surface':
      fly(s.W, dt);
      return false;
    case 'climb':
      L.u = 1 - k;
      fly(s.W, dt, true);
      if (k >= 1) { L.u = 0; next('unfade'); }
      return false;
    case 'unfade':
      if (k >= 1) {
        // Back in space beside the planet, on the side facing its star, coming out of it.
        const star = world.galaxy.nearestSystem(e.x, e.y).star, a = Math.atan2(star.y - e.y, star.x - e.x), d = e.body.r * (e.body.ring ? 2.1 : 1.3) + 260;
        L.out = { x: e.x + Math.cos(a) * d, y: e.y + Math.sin(a) * d, a, zoom: view.base * view.k };
        next('ascend');
      }
      ship.x = e.x; ship.y = e.y; ship.vx = ship.vy = 0;
      return true;
    case 'ascend': {
      const m = smoothstep(0, 0.8, k);
      ship.x = lerp(e.x, L.out.x, m);
      ship.y = lerp(e.y, L.out.y, m);
      ship.angle = ship.targetAngle = L.out.a;
      ship.thrust = 1 - k;
      if (k >= 1) finish();
      return true;
    }
  }
  return false;
}

function finish() {
  const { out, e } = landing;
  Object.assign(landing, { on: false, phase: null, e: null });
  setMode('landing', false);
  setMode('landed', false);
  placeShip(out.x, out.y, out.a);
  notify(`Back in orbit round ${e.name}`, 2.5);
  Feedback.emit('launched');
}

// The surface's chunks round the landing spot, built ahead of the approach.
function warmTiles(s, budgetMs) {
  detail(s.tiles, viewAt(1).v, budgetMs);
}

// Flying on the surface: the drag sets heading and speed as in space (game/input.js), slower; cliffs,
// storm fronts and tall rocks stop the ship. Out past the rim, it takes off. climbing: lifting off,
// the ship keeps drifting the way it was going, above everything.
function fly(W, dt, climbing = false) {
  const C = landing.craft, stats = { ...SHIP, maxSpeed: SHIP.maxSpeed * SURFACE_SPEED, accel: SHIP.accel * 0.6 };
  const set = climbing ? 0 : (ship.targetSpeed / (SHIP.maxSpeed || 1)) * stats.maxSpeed;
  const x0 = C.x, y0 = C.y, r = SHIP.radius * SURFACE_SCALE;
  Flight.step(C, stats, { targetAngle: ship.targetAngle, targetSpeed: set, mode: moveMode.value }, dt);
  if (climbing) return;
  if (ArtSurface.blocked(W, C.x, y0, r)) { C.x = x0; C.vx = 0; }
  if (ArtSurface.blocked(W, C.x, C.y, r)) { C.y = y0; C.vy = 0; }
  if (ArtSurface.siteDist(W, C.x, C.y) > W.site.leave) takeOff();
}

// ---------- The camera in space ----------

// The zoom that makes the planet DISC of the screen across (CSS px per world unit).
const planetZoom = (e) => (DISC * Math.min(view.w, view.h)) / e.body.r;

// Closing in on the planet as the ship dives (descend), held on it while the globe fades in and out,
// pulling back to the ship beside it (ascend).
export function landingCamera() {
  if (!landing.on || onSurface()) return;
  const L = landing, e = L.e, k = Math.min(1, L.t / TIME[L.phase]);
  const m = L.phase === 'descend' ? smoothstep(0, 1, k) : L.phase === 'ascend' ? 1 - smoothstep(0, 1, k) : 1;
  const a = L.phase === 'ascend' ? { cx: L.out.x, cy: L.out.y, zoom: L.out.zoom } : L.from;
  cam.x = lerp(a.cx, e.x, m);
  cam.y = lerp(a.cy, e.y, m);
  view.zoom = Math.exp(lerp(Math.log(a.zoom), Math.log(planetZoom(e)), m));
}

export function landingShipScale() {
  if (!landing.on) return 1;
  const k = Math.min(1, landing.t / TIME[landing.phase]);
  if (landing.phase === 'descend') return 1 - smoothstep(0.5, 1, k);
  if (landing.phase === 'ascend') return smoothstep(0, 0.4, k);
  return 0;
}

// ---------- Drawing the surface ----------

// The surface's view at a point u of the landing (0: the globe as big as the planet was, 1: down).
function viewAt(u) {
  const e = u * u * (3 - 2 * u), st = Math.sin(Art.config.tilt), W = view.w, H = view.h;
  const z0 = (DISC * Math.min(W, H)) / ORBIT_R, zoom = Math.exp(lerp(Math.log(z0), Math.log(view.base), e));
  // Curvature: the globe's, tightening as the view closes in (so the horizon stays in sight), then
  // easing out to none by the time the ship is down.
  const k = lerp(1 / ORBIT_R, 1 / 450, smoothstep(0, 0.6, u)) * (1 - smoothstep(0.55, 1, u));
  const R = k > 1e-6 ? Math.round(1 / k) : 1e9;
  // From orbit, the globe's middle where the planet was (the screen's); down, the ship a little
  // below the middle, to see more ahead.
  const oy = lerp(H / 2 - ORBIT_R * st * z0, H * 0.6, e);
  const C = landing.craft;
  const v = SurfaceGlobe.view({ R, flat: Math.round(lerp(0, 250, e)), fx: C.x, fy: C.y, W: W / zoom, H: H / zoom, ox: W / 2 / zoom, oy: oy / zoom });
  return { v, zoom, z: lerp(ORBIT_Z, ArtSurface.FLY, e), flat: R >= 1e9 };
}

// Detailed chunks over the ground the view shows, out to `ahead` (fading out beyond 2/3 of it), no
// wider than the landed view needs however far out the view is zoomed: the low-detail image does the rest.
function detail(tiles, v, budgetMs) {
  const ex = SurfaceGlobe.extent(v), ahead = Math.min(1100, SurfaceGlobe.horizonDist(v) * 0.8);
  const rect = { x0: Math.max(ex.x0, v.fx - 900), x1: Math.min(ex.x1, v.fx + 900), y0: Math.max(ex.y0, v.fy - ahead), y1: Math.min(ex.y1, v.fy + 600), cx: v.fx, cy: v.fy };
  return tiles.layers(rect, budgetMs, [ahead * 0.65, ahead]);
}

// The ground (and, while curved, the limb), drawn at alpha over whatever is there (screen px).
function drawGround(u, alpha) {
  const s = surface(), style = artStyle.value, line = style === 'line', e = landing.e;
  const { v, zoom, flat } = viewAt(u), bg = COLORS.bg, air = e.kind === 'planet' && !line ? AIR[e.body.type] : null, px = 1 / zoom;
  const layers = [s.far.layer];
  const dA = smoothstep(0.35, 0.75, u);
  if (dA > 0) for (const L of detail(s.tiles, v, landing.phase === 'surface' ? 8 : 5)) { L.alpha = dA; layers.push(L); }
  ctx.save();
  ctx.setTransform(view.dpr * zoom, 0, 0, view.dpr * zoom, 0, 0);
  ctx.globalAlpha = alpha;
  if (flat) SurfaceGlobe.drawFlat(ctx, layers, v, { dpr: view.dpr * zoom, under: bg });
  else {
    const hz = SurfaceGlobe.horizonDist(v);
    SurfaceGlobe.draw(ctx, layers, v, { dpr: view.dpr * zoom, fog: air || bg, fogDist: hz * (air ? 0.85 : 1.3), under: air || bg });
    // The limb: a line (Line); stepped bands of the air's colour on planets, a faint rim on moons (Low-poly).
    const pts = SurfaceGlobe.limb(v);
    if (pts && pts.length > 1) {
      const path = (dy) => { ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y + dy) : ctx.moveTo(x, y + dy))); };
      const ink = ArtSurface.BIOMES[s.W.type].line;
      ctx.lineJoin = 'round';
      if (line) { path(0); ctx.strokeStyle = ink; ctx.lineWidth = 1.3 * px; ctx.stroke(); }
      else if (air) {
        for (const [w, a] of [[26, 0.1], [14, 0.18], [6, 0.35]]) { path((-w / 2) * px); ctx.strokeStyle = air + Math.round(a * 255).toString(16).padStart(2, '0'); ctx.lineWidth = w * px; ctx.stroke(); }
        path(-0.5 * px); ctx.strokeStyle = '#dff0ff'; ctx.lineWidth = 1.5 * px; ctx.stroke();
      } else { path(-0.5 * px); ctx.strokeStyle = 'rgba(230,230,225,0.45)'; ctx.lineWidth = px; ctx.stroke(); }
    }
  }
  ctx.restore();
  return { v, zoom };
}

// In space: the globe fading in over the planet (fade) or out of it (unfade).
export function drawLandingOverlay() {
  if (!landing.on || (landing.phase !== 'fade' && landing.phase !== 'unfade')) return;
  const k = Math.min(1, landing.t / TIME[landing.phase]);
  drawGround(0, landing.phase === 'fade' ? k : 1 - k);
}

// The surface's frame: stars, the ground, the ship and its shadow, the minimap and the HUD.
export function drawLanding(t) {
  const L = landing, s = surface(), C = L.craft, style = artStyle.value;
  Art.beginFrame(); // the sprite caches' build budget for this frame, as in space
  ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, view.w, view.h);
  drawStarfield();
  const { v, zoom } = drawGround(L.u, 1), e = L.u * L.u * (3 - 2 * L.u), z = lerp(ORBIT_Z, ArtSurface.FLY, e);
  // The ship over the point it's above, at its altitude; its shadow on the ground below and to the
  // side, fading as it climbs. It comes into view as the approach begins.
  const st = Math.sin(Art.config.tilt), [shx, shy] = ArtSurface.shadowShift(z), gx = C.x + shx, gy = C.y + shy;
  const sh = SurfaceGlobe.toScreen(v, gx, gy, ArtSurface.heightAt(s.W, gx, gy)), k = (SHIP.radius * 1.25 * Entities.SHIP_SCALE * SURFACE_SCALE) / ship.art.radius;
  ctx.save();
  ctx.setTransform(view.dpr * zoom, 0, 0, view.dpr * zoom, 0, 0);
  ctx.globalAlpha = smoothstep(0, 0.12, L.u);
  const sa = 0.35 * (1 - smoothstep(60, 400, z));
  if (sh && sa > 0.01) {
    ctx.fillStyle = `rgba(0, 0, 0, ${sa})`;
    ctx.beginPath();
    ctx.ellipse(sh[0], sh[1], SHIP.radius * SURFACE_SCALE * 1.3, SHIP.radius * SURFACE_SCALE * 1.3 * v.ct, 0, 0, TAU);
    ctx.fill();
  }
  ctx.translate(v.ox, v.oy - z * st);
  ctx.scale(k, k);
  Art.drawAsset(ctx, ship.art, style, { angle: C.angle, t, thrust: C.thrust });
  ctx.restore();
  drawSurfaceMinimap();
  drawSurfaceHud();
}

// The minimap on the surface: the planet (or moon) as it's drawn in space, the landing site as a
// rectangle on it, and the ship's place and heading in the site.
function drawSurfaceMinimap() {
  const L = landing, e = L.e, W = surface().W, { x: x0, y: y0, size } = minimapBox();
  const cx = x0 + size / 2, cy = y0 + size / 2, R = size * 0.42, k = R / e.body.r;
  ctx.save();
  ctx.fillStyle = 'rgba(5, 6, 10, 0.75)';
  ctx.fillRect(x0, y0, size, size);
  ctx.strokeStyle = COLORS.planet;
  ctx.globalAlpha = 0.6;
  ctx.lineWidth = 1;
  ctx.strokeRect(x0 + 0.5, y0 + 0.5, size - 1, size - 1);
  ctx.globalAlpha = 1;
  ctx.beginPath();
  ctx.rect(x0, y0, size, size);
  ctx.clip();
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(k, k);
  if (e.kind === 'moon') ArtBodies.drawMoon(ctx, e.body, artStyle.value, { x: 0, y: 0 });
  else Art.drawPlanet(ctx, e.body, artStyle.value, { x: 0, y: 0, lightAngle: e.lightAngle ?? -2.2 });
  ctx.restore();
  // The site: its square on the near face, about two fifths of the way across.
  const [i0, j0, i1] = W.site.rect, T = ArtSurface.T, side = R * 0.8;
  const rx0 = cx - side / 2, ry0 = cy - side / 2, f = side / ((i1 - i0) * T);
  ctx.strokeStyle = COLORS.amber;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([4, 3]);
  ctx.strokeRect(rx0, ry0, side, side);
  ctx.setLineDash([]);
  // Where the ship is in it (past the edge, out on the rim, it shows outside the square).
  const C = L.craft, px = clamp(rx0 + (C.x - i0 * T) * f, x0 + 4, x0 + size - 4), py = clamp(ry0 + (C.y - j0 * T) * f, y0 + 4, y0 + size - 4);
  ctx.translate(px, py);
  ctx.rotate(C.angle);
  ctx.fillStyle = COLORS.cyan;
  ctx.strokeStyle = COLORS.bg;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(5, 0);
  ctx.lineTo(-3, 3);
  ctx.lineTo(-3, -3);
  ctx.closePath();
  ctx.stroke();
  ctx.fill();
  ctx.restore();
}

// Top left: where the ship is (and, near the rim, that flying on leaves), then the event log.
function drawSurfaceHud() {
  const L = landing, W = surface().W, I = view.inset, pad = 12, left = pad + I.l, lh = Math.round(19 * Theme.scale);
  const box = minimapBox(), room = box.x - 12 - left;
  const lines = [[`${L.e.name.toUpperCase()} · LANDING SITE`, COLORS.planet]];
  if (L.phase === 'surface' && ArtSurface.siteDist(W, L.craft.x, L.craft.y) > W.site.leave - 2 * ArtSurface.T) lines.push(['Past the rim: fly on to take off', COLORS.amber]);
  ctx.save();
  ctx.font = Theme.font(14);
  let y = pad + I.t + lh - 4;
  const w = Math.min(room, Math.max(...lines.map(([t]) => ctx.measureText(t).width)));
  ctx.globalAlpha = 0.55;
  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(left - 6, pad + I.t - 4, w + 12, lines.length * lh + 8);
  ctx.globalAlpha = 0.95;
  for (const [text, color] of lines) { ctx.fillStyle = color; ctx.fillText(text, left, y); y += lh; }
  ctx.restore();
  drawEventLog(left, y + 6, room);
}

// Wiring, run once every module has loaded (src/main.js).
export function init() {
  // Land on a planet or moon with a surface: from close by, slowly, like docking.
  actions.add({
    id: 'land', kind: ['planet', 'moon'], verb: 'Land', key: 'l', when: landable,
    range: 500, maxSpeed: 200,
    run: land,
  });
  document.getElementById('takeoff-btn').addEventListener('click', takeOff);
  window.addEventListener('keydown', (e) => {
    if ((e.key === 't' || e.key === 'T') && landing.phase === 'surface') takeOff();
  });
}
