// Landing on a planet or moon, flying round its landing site (art/surface.js) and taking off again.
// The Land action (a planet's or moon's context menu, or L) starts it; on the surface, Take off (its
// button, or T) or flying out past the landing site's rim ends it.
//
// Landing is one continuous zoom. The camera closes in on the planet's own art, steadily (the zoom
// grows by the same factor each moment, easing in and out at the ends) while the ship dives into
// it; once the planet fills the screen, the art cross-fades into the surface seen from high above,
// and the zoom carries on down to it, the ship coming into view as it nears the ground. Taking off
// is the same zoom backwards, ending beside the planet. On the surface the ground is flat.
// While landing and taking off, flight, the map and the context menu are off (the 'landing' mode); on
// the surface ('landed') the HUD, map, factions and shortcuts are back, but there's nothing to select.
// The zoom runs on the clock, but no further than what it needs of the surface has been built (the
// surface itself before the cross-fade, the chunks round the landing spot before the end): short of
// that it slows to a crawl, building faster meanwhile, so a slow device sees a slower landing, never
// a stall.
//
//   LANDABLE, landable(e)       the planet and moon types that have a surface, and whether e does
//   land(e), takeOff()
//   landing                     { on, phase ('landing' | 'surface' | 'takeoff'), t, e, craft, wrecked }:
//                               t runs 0 (in space) .. 1 (down) along the zoom
//   tickLanding(dt)             a step: from update() while the view is space (it then steers the
//                               ship and returns true), from the frame loop once it's the surface
//   landingCamera()             in space: the camera and zoom closing in on the planet, or pulling back
//   onSurface()                 whether the surface is what's drawn (the loop draws it instead of space)
//   drawLanding()               the surface's frame; drawLandingOverlay(): the surface fading in or
//                               out over the planet, in space
//   landingShipScale()          the ship's size in space as it dives in or comes out (0..1)
//   surfacePerf()               lines about the surface for the performance overlay (game/loop.js)
// Part of the flight view; src/main.js starts it.

import { Art } from '../art/render.js';
import { ArtBodies } from '../art/bodies.js';
import { ArtSurface } from '../art/surface.js';
import { SurfaceGlobe } from '../art/surface-globe.js';
import { Display } from '../core/display.js';
import { Feedback } from '../core/feedback.js';
import { smoothstep } from '../core/math.js';
import { COLORS, Theme } from '../core/theme.js';
import { Collide } from '../flight/collide.js';
import { Entities } from '../flight/entities.js';
import { Flight } from '../flight/flight.js';
import { hurtShip, wreck } from './combat.js';
import { actions, docked } from './docking.js';
import { drawEventLog, drawStatus, minimapBox } from './hud.js';
import { drag } from './input.js';
import { artStyle, moveMode } from './options.js';
import { placeShip } from './outfitting.js';
import { select, selected } from './selection.js';
import { drawStarfield } from './starfield.js';
import { SHIP, TAU, autopilot, cam, clamp, ctx, inFight, lerp, notify, particles, setMode, ship, view } from './state.js';
import { warp } from './warp.js';
import { world } from './world.js';

// The planet and moon types with a surface to land on: all of them. Planets on their SURFACE_OF
// surface (art/surface.js), moons on their type's (moonSurface: 'moon-' and the type).
export const LANDABLE = { planet: Object.keys(ArtSurface.SURFACE_OF), moon: Object.keys(ArtBodies.MOONS) };
export const landable = (e) => (LANDABLE[e.kind] || []).includes(e.body.type);

// The surface: a landing site SITE tiles across in the middle, with FRINGE tiles of ground round it
// to see while the view is still high above.
const SITE = 48, FRINGE = Math.ceil(3200 / ArtSurface.T), SIZE = SITE + 2 * FRINGE;
// On the surface the ship flies slower than in space and is drawn a little smaller, against ground
// seen from closer than space is: the whole view (ship, ground and all) is zoomed in SURFACE_ZOOM
// times, and its chunks are drawn at that resolution (up to 2 device px per world unit; 1.5 on
// touch screens, which keep less in memory).
const SURFACE_SPEED = 0.4, SURFACE_SCALE = 0.85, SURFACE_ZOOM = 1.5;
const surfaceZoom = () => view.base * SURFACE_ZOOM;
// The zoom: in space, until the planet is COVER times as wide as the screen's diagonal; then on the
// surface, from DEPTH times further out than the landed view down to it. Each factor of e (2.7)
// of zoom takes SPEED seconds, plus EASE for easing in and out. The cross-fade spans FADE of the
// zoom's logarithm (a factor of e^FADE) either side of the hand-over.
const COVER = 0.6, DEPTH = 8, SPEED = 0.85, EASE = 0.8, FADE = 0.3;
const ALTITUDE = 420; // the ship's height above the ground as it comes into view (surface units)

export const landing = {
  on: false, phase: null, t: 0, e: null, path: null, wrecked: false, // wrecked: the hull gave out on the surface
  craft: { x: 0, y: 0, vx: 0, vy: 0, angle: -Math.PI / 2, thrust: 0 }, // the ship on the surface (surface units)
};

// Each surface is made a little at a time, the first time it's needed, and kept, by the body's
// name: { gen (generating it), steps, W (once made), far: { style: builder }, tiles: { style: chunks } }.
const surfaces = new Map();
const GEN_STEPS = 3 * (SIZE + 1) + 1; // about how many next()s generating one takes (ArtSurface.generateSteps)
function entry(e) {
  let s = surfaces.get(e.key);
  if (!s) {
    const type = e.kind === 'moon' ? ArtSurface.moonSurface(e.body.type) : ArtSurface.SURFACE_OF[e.body.type];
    s = { gen: ArtSurface.generateSteps(type, e.body.seed, { w: SIZE, h: SIZE, site: [FRINGE, FRINGE, FRINGE + SITE, FRINGE + SITE] }), steps: 0, W: null, far: {}, tiles: {} };
    surfaces.set(e.key, s);
  }
  return s;
}
// Works on e's surface for about budgetMs: the ground, then the far image in the art style now.
// Returns how far it's got (0..1); 1 once it's ready to land on.
function prepare(e, budgetMs) {
  const s = entry(e), t0 = performance.now();
  while (!s.W && performance.now() - t0 < budgetMs) {
    const r = s.gen.next();
    s.steps++;
    if (r.done) s.W = r.value;
  }
  if (!s.W) return 0.3 * Math.min(1, s.steps / GEN_STEPS);
  const far = (s.far[artStyle.value] ||= ArtSurface.farBuilder(s.W, artStyle.value, { upp: 10 }));
  const left = budgetMs - (performance.now() - t0);
  if (left > 0) far.step(left);
  return 0.3 + 0.7 * far.progress;
}
// The detailed chunks: 4×4 tiles (small, so building one doesn't hold up a frame long).
const tileOpts = () => ({ size: 4, dpr: clamp(view.dpr * surfaceZoom(), 1, Display.touch() ? 1.5 : 2), keep: 96 });
// The surface being landed on (ready by the cross-fade).
function surface() {
  const style = artStyle.value, s = entry(landing.e);
  s.far[style] ||= ArtSurface.farBuilder(s.W, style, { upp: 10 });
  s.tiles[style] ||= SurfaceGlobe.tiles(s.W, style, tileOpts());
  return { W: s.W, far: s.far[style], tiles: s.tiles[style] };
}

// ---------- The zoom ----------

// The zoom's path, in the logarithm of the zoom: from a (space, now) to x (the planet covering the
// screen, the hand-over), on to b (down), the surface's zoom being the space one less `shift`.
// Space and the surface are in different units, so the hand-over is where they meet.
function makePath(e, spaceZoom) {
  const a = Math.log(spaceZoom), x = Math.log((COVER * Math.hypot(view.w, view.h)) / e.body.r);
  const s0 = Math.log(surfaceZoom() / DEPTH), b = x + Math.log(DEPTH);
  return { a, x, b, shift: x - s0, time: SPEED * (b - a) + EASE };
}
// Where the zoom is at t (0..1): eased in and out at the ends, steady between.
const lz = (t) => { const P = landing.path; return lerp(P.a, P.b, t * t * (3 - 2 * t)); };
// The t at which the zoom reaches l (for holding it short of a point).
function tAt(l) {
  let lo = 0, hi = 1;
  for (let i = 0; i < 30; i++) { const m = (lo + hi) / 2; if (lz(m) < l) lo = m; else hi = m; }
  return lo;
}
// The surface's share of the screen at t: 0 in space, 1 once it has faded in.
const fadeAt = (t) => smoothstep(landing.path.x - FADE, landing.path.x + FADE, lz(t));
// How far through the space half (0..1) and the surface half (0..1) the zoom is.
const spaceK = (t) => clamp((lz(t) - landing.path.a) / (landing.path.x - landing.path.a), 0, 1);
const groundK = (t) => clamp((lz(t) - landing.path.x) / (landing.path.b - landing.path.x), 0, 1);
export const onSurface = () => landing.on && (landing.phase === 'surface' || fadeAt(landing.t) >= 1);

// ---------- Landing and taking off ----------

export function land(e) {
  if (landing.on || docked || inFight() || warp.on || !actions.state('land', e).ok) return;
  select(null);
  autopilot.key = null;
  drag.active = false;
  ship.targetSpeed = 0;
  Object.assign(landing, { on: true, phase: 'landing', t: 0, e, clock: undefined, out: null, from: { x: ship.x, y: ship.y, cx: cam.x, cy: cam.y } });
  landing.path = makePath(e, view.zoom);
  pinSprite(e);
  particles.length = 0;
  setMode('landing', true);
  notify(`Landing on ${e.name}`, 2.5);
}

export function takeOff() {
  const L = landing;
  if (L.phase !== 'surface' && L.phase !== 'landing') return;
  // Back out the way it came, to the side of the planet facing its star, at the usual zoom.
  const e = L.e, star = world.galaxy.nearestSystem(e.x, e.y).star, a = Math.atan2(star.y - e.y, star.x - e.x), d = e.body.r * (e.body.ring ? 2.1 : 1.3) + 260;
  L.out = { x: e.x + Math.cos(a) * d, y: e.y + Math.sin(a) * d, a };
  L.from = { x: L.out.x, y: L.out.y, cx: L.out.x, cy: L.out.y };
  // The same path, from the usual zoom, kept at the point it's at now (mid-landing, it turns back).
  const now = lz(L.t);
  L.path = makePath(e, view.base * view.k);
  L.t = clamp(tAt(now), 0, 1);
  pinSprite(e);
  L.phase = 'takeoff';
  setMode('landed', false);
  setMode('landing', true);
  notify(`Taking off from ${L.e.name}`, 2.5);
}

// While a planet or moon with a surface is selected (its menu offering Land), its surface is made
// a little each frame, so most of it is ready by the time the ship lands.
// Once that's done, the chunks round the landing spot too, one at most a frame.
function prefetch() {
  const e = selected && selected.e;
  if (!e || !(e.kind === 'planet' || e.kind === 'moon') || !landable(e) || prepare(e, 3) < 1) return;
  const s = entry(e), style = artStyle.value, [fx, fy] = s.W.start;
  s.tiles[style] ||= SurfaceGlobe.tiles(s.W, style, tileOpts());
  s.tiles[style].layers({ x0: fx - 700, x1: fx + 700, y0: fy - 700, y1: fy + 450, cx: fx, cy: fy }, 3);
}

export function tickLanding(dt) {
  if (!landing.on) { prefetch(); return false; }
  const L = landing, e = L.e, P = L.path;
  // The zoom keeps to its length in real time on a slow device (a choppier landing, not a longer
  // one), though the frame loop steps the game by at most 50 ms.
  const now = performance.now(), real = (now - (L.clock ?? now)) / 1000;
  dt = Math.max(dt, Math.min(0.25, real));
  L.clock = now;
  L.slow = real > 0.022; // the last frame took long: build less of the surface in this one
  if (L.phase === 'surface') { fly(surface().W, dt); return false; }
  if (L.phase === 'landing') {
    // How far the zoom may get with what's built (1: all the way), and the build's time this frame:
    // more once the zoom has caught up with it, as much as the rest of the frame takes (up to 60 ms).
    let gate = 1;
    const more = clamp(real * 1000, 14, 60), close = (g) => L.t > g - 0.08;
    const p = prepare(e, close(L.gate ?? 1) ? more : 8);
    if (p < 1) gate = tAt(lerp(P.a, P.x - FADE, 0.5 + 0.5 * p)); // the surface itself, before it fades in
    else {
      // The chunks round the landing spot, before the last stretch of the zoom (the ship set down
      // there first, so they're the ones looked for).
      if (fadeAt(L.t) <= 0) setDown();
      const c = warmTiles(surface(), close(L.gate ?? 1) ? more : 6);
      if (c.missing) gate = tAt(lerp(P.x, P.b, 0.7 + 0.3 * (c.loaded / c.total)));
    }
    L.gate = gate;
    const rate = gate >= 1 ? 1 : clamp((gate - L.t) / 0.06, 0, 1);
    const t0 = L.t;
    L.t = Math.min(1, L.t + (dt / P.time) * rate);
    // The ship is set down on the surface's landing spot as the surface comes into view.
    if (fadeAt(t0) <= 0 && fadeAt(L.t) > 0) setDown();
    if (L.t >= 1) { L.phase = 'surface'; setMode('landing', false); setMode('landed', true); Feedback.emit('docked'); }
  } else {
    L.t = Math.max(0, L.t - dt / P.time);
    if (fadeAt(L.t) > 0) fly(surface().W, dt, true);
    if (L.t <= 0) { finish(); return true; }
  }
  // In space: the ship dives into the planet (landing) or comes out of it to beside it (taking off).
  if (fadeAt(L.t) < 1) {
    const k = spaceK(L.t), m = smoothstep(0.1, 0.9, k), to = L.phase === 'takeoff' ? L.out : null;
    ship.x = to ? lerp(to.x, e.x, m) : lerp(L.from.x, e.x, m);
    ship.y = to ? lerp(to.y, e.y, m) : lerp(L.from.y, e.y, m);
    ship.angle = ship.targetAngle = to ? to.a : Math.atan2(e.y - L.from.y, e.x - L.from.x);
    ship.vx = ship.vy = 0;
    ship.thrust = 0; // no exhaust: its sparks would be blown up to blocks by the zoom
    return true;
  }
  return false;
}

// The ship at rest on the surface's landing spot.
function setDown() { const [x, y] = surface().W.start; Object.assign(landing.craft, { x, y, vx: 0, vy: 0, angle: -Math.PI / 2, thrust: 0 }); }

// The planet's sprite is drawn at one resolution for the whole zoom (its sharpest, as it fills the
// screen), so it's made once rather than again at every step of the zoom.
function pinSprite(e) { e.ppu = 2 ** Math.ceil(Math.log2(Math.exp(landing.path.x) * view.dpr)); }

function finish() {
  const { out, e, wrecked } = landing;
  e.ppu = undefined;
  Object.assign(landing, { on: false, phase: null, e: null, wrecked: false });
  setMode('landing', false);
  setMode('landed', false);
  placeShip(out.x, out.y, out.a);
  if (wrecked) { wreck(); return; } // the hull gave out on the surface: lost here, the hold spilled beside the planet
  notify(`Back in orbit round ${e.name}`, 2.5);
  Feedback.emit('launched');
}

// The chunks round the landing spot, built ahead of the end of the zoom: { loaded, missing, total }.
function warmTiles(s, budgetMs) {
  const got = detail(s.tiles, viewAt(1).v, budgetMs);
  return { loaded: got.length, missing: got.missing, total: got.length + got.missing };
}

// Flying on the surface: the drag sets heading and speed as in space (game/input.js), slower; cliffs,
// storm fronts and tall rocks stop the ship, bouncing it back, and a hard hit knocks its shields and
// hull (flight/collide.js, game/combat.js hurtShip). Out past the rim, it takes off; so does a ship
// whose hull gives out (landing.wrecked), to be lost in orbit. climbing: lifting off, the ship keeps
// drifting the way it was going, above everything.
function fly(W, dt, climbing = false) {
  const C = landing.craft, stats = { ...SHIP, maxSpeed: SHIP.maxSpeed * SURFACE_SPEED, accel: SHIP.accel * 0.6 };
  const set = climbing ? 0 : (ship.targetSpeed / (SHIP.maxSpeed || 1)) * stats.maxSpeed;
  const x0 = C.x, y0 = C.y, r = SHIP.radius * SURFACE_SCALE;
  Flight.step(C, stats, { targetAngle: ship.targetAngle, targetSpeed: set, mode: moveMode.value }, dt);
  if (climbing) return;
  let hit = 0;
  if (ArtSurface.blocked(W, C.x, y0, r)) { C.x = x0; hit = Math.max(hit, Collide.bounce(C, -Math.sign(C.vx), 0)); }
  if (ArtSurface.blocked(W, C.x, C.y, r)) { C.y = y0; hit = Math.max(hit, Collide.bounce(C, 0, -Math.sign(C.vy))); }
  const knock = Collide.damage(hit, Collide.config.surfaceSafe);
  if (knock > 0) {
    const d = hurtShip(knock);
    if (d.hullDamage > 0) notify(`Hit the ground · hull −${Math.round(d.hullDamage)}`, 2, { tone: 'warn' });
  } else if (hit > Collide.config.surfaceSafe * 0.5) Feedback.emit('bump');
  if (landing.wrecked || ArtSurface.siteDist(W, C.x, C.y) > W.site.leave) takeOff();
}

// ---------- The camera in space ----------

// Closing in on the planet (landing), or pulling back from it to the ship beside it (taking off):
// the zoom along the path; the camera onto the planet over the first half of the way in.
export function landingCamera() {
  if (!landing.on || landing.phase === 'surface') return; // (the frame the surface fills the screen is still drawn from space)
  const L = landing, e = L.e, m = smoothstep(0, 0.5, spaceK(L.t));
  cam.x = lerp(L.from.cx, e.x, m);
  cam.y = lerp(L.from.cy, e.y, m);
  view.zoom = Math.exp(lz(L.t));
}

// The ship keeps its size on screen as the camera zooms in (it's further from the camera than the
// planet's face), then shrinks away into the planet.
export function landingShipScale() {
  if (!landing.on) return 1;
  const t = landing.t;
  return Math.exp(landing.path.a - lz(t)) * (1 - smoothstep(0.6, 0.95, spaceK(t)));
}

// ---------- Drawing the surface ----------

// The surface's view at t: its zoom along the path; the landing spot where the planet's middle was
// (the screen's) as it fades in, coming to rest a little below the middle (to see more ahead).
function viewAt(t) {
  const L = landing, zoom = Math.exp(lz(t) - L.path.shift), k = smoothstep(0, 1, groundK(t)), W = view.w, H = view.h;
  const v = SurfaceGlobe.view({ R: 1e9, fx: L.craft.x, fy: L.craft.y, W: W / zoom, H: H / zoom, ox: W / 2 / zoom, oy: lerp(H / 2, H * 0.6, k) / zoom, tilt: ArtSurface.tiltOf(artStyle.value) });
  return { v, zoom, k };
}

// Detailed chunks over the ground the view shows, no wider or further than the landed view needs
// however far out the view is zoomed: the low-detail image does the rest.
function detailRect(v) {
  const ex = SurfaceGlobe.extent(v);
  return { x0: Math.max(ex.x0, v.fx - 900), x1: Math.min(ex.x1, v.fx + 900), y0: Math.max(ex.y0, v.fy - 1100), y1: Math.min(ex.y1, v.fy + 600), cx: v.fx, cy: v.fy };
}
const detail = (tiles, v, budgetMs) => tiles.layers(detailRect(v), budgetMs);

// Flying on the surface, the chunks the ship is heading for (the view a moment ahead, and a ring
// round it) are built ahead of need, so they're rarely missing as they come into view: a step at a
// time (art/surface-globe.js tiles), in the time each frame leaves over (requestIdleCallback, at most
// 4 ms; without it, as in iOS Safari, 3 ms after the frame, or 1 after a slow one), so the work is
// spread thin.
const LEAD = 1.2, RING = 300; // seconds ahead, world units round the view
let idle = null;
function aheadRect() {
  const C = landing.craft, r = detailRect(viewAt(1).v), dx = C.vx * LEAD, dy = C.vy * LEAD;
  return { x0: r.x0 + dx - RING, x1: r.x1 + dx + RING, y0: r.y0 + dy - RING, y1: r.y1 + dy + RING, cx: C.x + dx, cy: C.y + dy };
}
function buildAhead() {
  if (landing.phase !== 'surface' || idle) return;
  const tiles = surface().tiles;
  if (window.requestIdleCallback) idle = requestIdleCallback((dl) => { idle = null; if (landing.phase === 'surface') tiles.warm(aheadRect(), Math.min(4, dl.timeRemaining() - 2)); }); // idle time can run to 50 ms: the next frame mustn't wait on it
  else tiles.warm(aheadRect(), landing.slow ? 1 : 3);
}

// The ground at t, drawn at alpha over whatever is there: the low-detail image, then the chunks
// fading in over the last part of the zoom.
function drawGround(t, alpha) {
  const s = surface(), { v, zoom, k } = viewAt(t);
  // After a change of art style, that style's far image is built a little each frame (the chunks
  // cover the screen meanwhile).
  if (!s.far.layer) s.far.step(6);
  const layers = s.far.layer ? [s.far.layer] : [];
  const dA = smoothstep(0.45, 0.8, k);
  // Chunks are built here (a few ms of one a frame) only on the surface; on the way down tickLanding builds them.
  if (dA > 0) {
    // In the frame itself, only while some in view are missing (building ahead sees to the rest).
    const got = detail(s.tiles, v, landing.phase === 'surface' && perf.missing ? (landing.slow ? 1 : 2) : 0);
    perf.missing = got.missing;
    for (const L of got) { L.alpha = dA; layers.push(L); }
  }
  ctx.save();
  ctx.setTransform(view.dpr * zoom, 0, 0, view.dpr * zoom, 0, 0);
  ctx.globalAlpha = alpha;
  SurfaceGlobe.drawFlat(ctx, layers, v, { dpr: view.dpr * zoom, under: COLORS.bg });
  ctx.restore();
  return { v, zoom, k };
}

// In space: the surface fading in over the planet as it fills the screen (or out of it); all of it
// on the frame it has just finished fading in, which is still drawn from space.
export function drawLandingOverlay() {
  if (!landing.on || landing.phase === 'surface') return;
  const a = fadeAt(landing.t);
  if (a > 0) drawGround(landing.t, a);
}

// The surface's frame: the ground, the ship and its shadow, the minimap and the HUD.
export function drawLanding(time) {
  const L = landing, s = surface(), C = L.craft, style = artStyle.value;
  Art.beginFrame(); // the sprite caches' build budget for this frame, as in space
  ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, view.w, view.h);
  drawStarfield();
  const { v, zoom, k: g } = drawGround(L.phase === 'surface' ? 1 : L.t, 1);
  // The ship over the point it's above, coming down from ALTITUDE over the last stretch of the zoom
  // (fading in as it does); its shadow on the ground below and to the side, darker as it nears.
  // (Straight down, as in Line, the height shows only in how far off the shadow falls.)
  const q = smoothstep(0.55, 1, g), z = lerp(ALTITUDE, ArtSurface.FLY, q), st = v.st;
  const [shx, shy] = ArtSurface.shadowShift(z), gx = C.x + shx, gy = C.y + shy;
  const sh = SurfaceGlobe.toScreen(v, gx, gy, ArtSurface.heightAt(s.W, gx, gy)), k = (SHIP.radius * 1.25 * Entities.SHIP_SCALE * SURFACE_SCALE) / ship.art.radius;
  ctx.save();
  ctx.setTransform(view.dpr * zoom, 0, 0, view.dpr * zoom, 0, 0);
  ctx.globalAlpha = smoothstep(0.4, 0.6, g);
  const sa = 0.35 * (1 - smoothstep(60, ALTITUDE, z));
  if (sh && sa > 0.01) {
    ctx.fillStyle = `rgba(0, 0, 0, ${sa})`;
    ctx.beginPath();
    ctx.ellipse(sh[0], sh[1], SHIP.radius * SURFACE_SCALE * 1.3, SHIP.radius * SURFACE_SCALE * 1.3 * v.ct, 0, 0, TAU);
    ctx.fill();
  }
  ctx.translate(v.ox, v.oy - z * st);
  ctx.scale(k, k);
  Art.drawAsset(ctx, ship.art, style, { angle: C.angle, t: time, thrust: C.thrust });
  ctx.restore();
  drawSurfaceMinimap();
  drawSurfaceHud();
  buildAhead();
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
  // The speed bar, hold and hull, as in space; the speed a share of the surface's top speed.
  const C = L.craft;
  drawStatus(Math.hypot(C.vx, C.vy) / (SHIP.maxSpeed * SURFACE_SPEED || 1), ship.targetSpeed / (SHIP.maxSpeed || 1));
}

// For the performance overlay: the chunks (how many are kept, built a second, the time spent on
// them in the last frame and how many steps that took, how many in view are missing) and the far
// image; the slowest single step of building a chunk lately, and what it was (its name in
// art/surface.js). A stutter as a chunk is built shows as ms this frame jumping.
const perf = { missing: 0, last: null, rate: 0, at: 0, built0: 0 };
export function surfacePerf() {
  const s = surface(), c = s.tiles.stats(), now = performance.now(), last = perf.last || c;
  if (now - perf.at >= 1000) { perf.rate = ((c.built - perf.built0) * 1000) / Math.max(1, now - perf.at || 1000); perf.built0 = c.built; perf.at = now; }
  perf.last = c;
  return [
    `surface chunks ${c.cached}/${c.keep} kept · ${perf.rate.toFixed(1)} built/s · ${perf.missing} missing in view${c.busy ? ' · one under way' : ''}`,
    `chunk work ${(c.ms - last.ms).toFixed(1)} ms in ${c.steps - last.steps} steps last frame · far image ${s.far.layer ? 'ready' : `${Math.round(s.far.progress * 100)}%`}`,
    `slowest chunk step (2 s) ${c.slowest.ms.toFixed(1)} ms: ${c.slowest.label || '-'}`,
  ];
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
