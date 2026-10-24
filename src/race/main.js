// The race (race/index.html; serve the repo, e.g. `npm start`, and open /race/): a loop of open
// ground carved through a generated surface (ArtSurface, Track), raced in the game's own ship: the
// Courier's art, its engine numbers, and the surface's flying (Flight). notes/race.md is the plan.
//
// This module wires the page: builds a track, runs it a fixed step at a time (Run) and draws it
// between steps, the ground in chunks (SurfaceGlobe.tiles), every one of them built before the
// countdown (bake) and kept, so none is ever built while flying. Laps count by checkpoints along the
// centreline, passed in order; your best lap's ghost flies beside you. R restarts, N a new track.
// Steering (Input): point (the game's drag) or sides (it flies itself; hold a half to turn); the
// Steer button switches and remembers it.
// Query parameters: ?biome=desert|ice|lava|terran|moon, ?style=line, ?curved, ?seed=, ?laps=,
// ?speed= (× the ship's top speed; the game flies surfaces at 0.5, races at TUNE.speed),
// ?mode=direct (no drift; letting go stops), ?steer=point|sides, ?assist=0 (no steering assist).
// ES module; needs a browser.

import { Art } from '../art/render.js';
import { ArtBlueprints } from '../art/blueprints.js';
import { ArtCulture } from '../art/culture.js';
import { ArtSurface } from '../art/surface.js';
import { SurfaceGlobe } from '../art/surface-globe.js';
import { Store } from '../core/store.js';
import { Loadout } from '../rules/loadout.js';
import { Draw } from './draw.js';
import { Ghost } from './ghost.js';
import { Input } from './input.js';
import { Run } from './run.js';
import { Track } from './track.js';

const q = new URLSearchParams(location.search), T = ArtSurface.T;
const N = 76, SIZE = N * T; // the surface, tiles a side; world units a side
const SAMPLES = 720, CHECKS = 16, HW = 1.9 * T; // centreline points; checkpoints; the track's half-width (±25% round the loop)
const SPACING = 7 * T, CLEAR = 6 * T; // between obstacles on the track; none this close to the start
const LAPS = Math.max(1, +q.get('laps') || 3), MODE = q.get('mode') === 'direct' ? 'direct' : 'cruise';
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
const SPEED = +q.get('speed') || TUNE.speed;
const STATS = { ...SHIP, maxSpeed: SHIP.maxSpeed * SPEED, accel: SHIP.accel * TUNE.accel, turnRate: SHIP.turnRate * TUNE.turn };
// The camera: close in (the ground's speed on screen is what reads as fast), leading the ship by
// `lead` seconds of its speed, `track` of the way along the track rather than its velocity, held
// to `reach` of the screen's shorter side; pushing in a little at top speed (`pull`), and zoomed by
// the bends ahead: `wide` on a straight, `tight` in a bend.
const CAM = { zoom: 1.3, lead: 0.6, pull: 0.04, reach: 0.3, track: 0.6, wide: 0.93, tight: 1.06 };
const SURFACE_SCALE = 0.85, SHIP_SCALE = 1.375, R_SHIP = SHIP.radius * SURFACE_SCALE, HULL = SHIP.hull || 120;
const ART = ArtBlueprints.create('fighter-light', ArtCulture.legacy, 3);
const BODY = { art: ART, k: (SHIP.radius * 1.25 * SHIP_SCALE * SURFACE_SCALE) / ART.radius, r: R_SHIP, z: ArtSurface.FLY };

const coarse = matchMedia('(pointer: coarse)').matches;
const DPR = coarse ? 1.5 : 2; // the canvas's pixel ratio at most
const BAKE = { step: 500, slice: 30 }; // the bake: a rect every step along the track from the start; ms of work between paints
const S = { biome: BIOMES[q.get('biome')] ? q.get('biome') : 'desert', style: q.get('style') === 'line' ? 'line' : 'lowpoly', curved: q.has('curved'), seed: +q.get('seed') || 1 };
Input.mode = ['point', 'sides'].includes(q.get('steer')) ? q.get('steer') : Store.get('race.steer') === 'sides' ? 'sides' : 'point';
Input.stopOnRelease = MODE === 'direct';
let G = null; // the track and its surface: { W, tr, b, seed, hw, talls, holes, looks: { style: { far, tiles } }, mini }
let R = null; // the run on it
let cfg = null; // what the run flies by (Run)
let baking = false; // the ground is being built: the run waits
const cv = document.getElementById('view'), ctx = cv.getContext('2d'), hud = document.getElementById('hud'), note = document.getElementById('note');
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// ---------- The track and the run ----------

function build() {
  const b = BIOMES[S.biome], tr = Track.loop(S.seed, { size: SIZE, hw: HW, minHw: 6 * R_SHIP, margin: 5 * T, samples: SAMPLES, checks: CHECKS });
  const W = ArtSurface.generate(b.type, S.seed, { w: N, h: N, tall: 0.06 });
  Track.carve(W, tr, S.seed, { T, spacing: SPACING, clear: CLEAR });
  const on = ArtSurface.propsAll(W).filter((p) => Track.edgeDist(tr, p.x, p.y).d < p.r);
  const mini = new Path2D();
  tr.pts.forEach((p, n) => (n ? mini.lineTo(p.x, p.y) : mini.moveTo(p.x, p.y)));
  mini.closePath();
  G = { W, tr, b, seed: S.seed, hw: HW, talls: on.filter((p) => p.type === 'tall'), holes: on.filter((p) => p.type === 'hole'), looks: {}, mini };
  restart();
}
function looks() {
  return G.looks[S.style] || (G.looks[S.style] = { far: ArtSurface.farImage(G.W, S.style), tiles: SurfaceGlobe.tiles(G.W, S.style, { size: 8, dpr: coarse ? 1 : 1.5, keep: Infinity }) });
}
function restart() {
  cfg = { stats: STATS, ship: SHIP, hull: HULL, r: R_SHIP, laps: LAPS, mode: MODE, steer: Input.mode, assist: q.get('assist') !== '0', cam: CAM, ghostKey: `${S.biome}.${S.seed}.${SPEED}` };
  R = Run.create(G, cfg);
  Input.reset(R.craft.angle);
}

// ---------- The view ----------

function viewNow(Wc, Hc, C) {
  const zoom = clamp(Math.min(Wc, Hc) / 800, 0.55, 1.3) * CAM.zoom * R.cam.zf;
  // The lead, held to CAM.reach of the screen's shorter side, so the ship never runs off its edge.
  const l = Math.hypot(R.cam.lx, R.cam.ly) * zoom, f = Math.min(1, (CAM.reach * Math.min(Wc, Hc)) / (l || 1));
  const v = SurfaceGlobe.view({ R: S.curved ? 600 : 1e9, flat: S.curved ? 300 : 0, fx: C.x + R.cam.lx * f, fy: C.y + R.cam.ly * f, W: Wc / zoom, H: Hc / zoom, ox: Wc / 2 / zoom, oy: (Hc * 0.55) / zoom, tilt: ArtSurface.tiltOf(S.style) });
  return { v, zoom };
}
// The ground to build detailed chunks over round (x, y) (game/landing.js detailRect), and the same
// held to what the view can show.
const rectAt = (x, y) => ({ x0: x - 900, x1: x + 900, y0: y - 1100, y1: y + 600, cx: x, cy: y });
function detailRect(v) {
  const ex = SurfaceGlobe.extent(v), r = rectAt(v.fx, v.fy);
  return { x0: Math.max(ex.x0, r.x0), x1: Math.min(ex.x1, r.x1), y0: Math.max(ex.y0, r.y0), y1: Math.min(ex.y1, r.y1), cx: r.cx, cy: r.cy };
}
// The bake: every chunk of the map, built before the countdown and kept (a whole map is about
// 100 chunks, ~80 MB at dpr 1), so the race never builds one: a chunk's build steps run several
// ms each and a phone drops frames on them. The start first, then along the track, then the rest;
// BAKE.slice ms at a time, with a paint between for the progress. Each chunk is drawn once when
// done, so its first frame on screen doesn't pay for the upload to the GPU.
const WHOLE = { x0: 0, x1: SIZE, y0: 0, y1: SIZE, cx: SIZE / 2, cy: SIZE / 2 };
async function bake() {
  const { tiles } = looks(), tr = G.tr, total = () => { const l = tiles.layers(WHOLE, 0); return [l.length, l.length + l.missing]; };
  const rects = [];
  for (let d = 0; d < tr.len; d += BAKE.step) { const p = tr.pts[Track.ahead(tr, 0, d)]; rects.push(rectAt(p.x, p.y)); }
  rects.push(WHOLE);
  baking = true;
  for (const rect of rects) {
    while (tiles.layers(rect, BAKE.slice).missing) {
      const [done, all] = total();
      document.body.dataset.busy = `Building track… ${Math.round((100 * done) / all)}%`;
      await new Promise((r) => setTimeout(r, 0));
    }
  }
  for (const L of tiles.layers(WHOLE, 0)) ctx.drawImage(L.canvas, 0, 0, 1, 1);
  delete document.body.dataset.busy;
  baking = false;
}
// A style's chunks let go, their canvases emptied (a browser may hold a dropped canvas's memory
// until it's collected).
function free(look) {
  if (!look) return;
  for (const L of look.tiles.layers(WHOLE, 0)) L.canvas.width = L.canvas.height = 0;
  look.tiles.clear();
}

const STARS = Array.from({ length: 220 }, (_, i) => { const h = (n) => { const v = Math.sin(i * 127.1 + n * 311.7) * 43758.5453; return v - Math.floor(v); }; return [h(1), h(2), 0.3 + 0.7 * h(3)]; });
const ground = (v, x, y, z = 0) => SurfaceGlobe.toScreen(v, x, y, ArtSurface.heightAt(G.W, x, y) + z);
const TAU = Math.PI * 2;
// The craft between its last two steps (a of the way from the one before).
function between(a) {
  const C = R.craft, P = R.prev, da = ((C.angle - P.angle + Math.PI) % TAU + TAU) % TAU - Math.PI;
  return { x: P.x + (C.x - P.x) * a, y: P.y + (C.y - P.y) * a, angle: P.angle + da * a, thrust: C.thrust };
}

let hudAt = -1, hudText = '';
function render(time, a) {
  const dpr = Math.min(DPR, devicePixelRatio || 1), Wc = innerWidth, Hc = innerHeight, bg = Art.config.bg;
  if (cv.width !== Math.round(Wc * dpr) || cv.height !== Math.round(Hc * dpr)) { cv.width = Math.round(Wc * dpr); cv.height = Math.round(Hc * dpr); }
  Art.beginFrame();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = bg; ctx.fillRect(0, 0, Wc, Hc);
  if (S.curved) for (const [sx, sy, al] of STARS) { ctx.fillStyle = `rgba(230,236,255,${al * 0.8})`; ctx.fillRect(sx * Wc, sy * Hc, 1, 1); }
  const C = between(a), { far, tiles } = looks(), { v, zoom } = viewNow(Wc, Hc, C), px = 1 / zoom;
  const got = tiles.layers(detailRect(v), 0), layers = [far, ...got];
  ctx.setTransform(dpr * zoom, 0, 0, dpr * zoom, 0, 0);
  if (S.curved) SurfaceGlobe.draw(ctx, layers, v, { dpr: dpr * zoom, fog: bg, fogDist: SurfaceGlobe.horizonDist(v) * 1.3, under: bg });
  else SurfaceGlobe.drawFlat(ctx, layers, v, { dpr: dpr * zoom, under: bg });
  Draw.marks(ctx, v, px, time, G, R, ground);
  const ghost = R.phase === 'race' ? Ghost.at(R.ghost, R.lapT) : null;
  if (ghost) Draw.ship(ctx, v, BODY, { ...ghost, thrust: 0.6 }, { style: S.style, time, alpha: 0.35 });
  Draw.ship(ctx, v, BODY, C, { style: S.style, time, shadow: true, ground });

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (R.flash > 0 || R.burn) { ctx.fillStyle = R.flash > 0 ? `rgba(255,60,40,${R.flash})` : `rgba(255,120,30,${0.12 + 0.06 * Math.sin(time * 20)})`; ctx.fillRect(0, 0, Wc, Hc); }
  Draw.minimap(ctx, Wc, G, R, SIZE, ghost);
  if (Input.mode === 'sides') Draw.sides(ctx, Wc, Hc, Input.held); else Draw.drag(ctx, Input.drag, Input.maxDrag());

  // The HUD's text, ten times a second, and only written when it changed.
  if (time - hudAt > 0.1 || time < hudAt) {
    hudAt = time;
    const html = Draw.hud(G, R, cfg, got.missing);
    if (html !== hudText) hud.innerHTML = hudText = html;
  }
  const { msg, big } = Draw.note(R, cfg);
  if (note.textContent !== msg) note.textContent = msg;
  note.classList.toggle('big', big);
}

// A fixed step: the run steps as many times as the frame's time holds (at most a tenth of a second
// of them, after a stall), and is drawn the rest of the way to the next.
let last = 0, acc = 0;
function frame(t) {
  if (baking) { last = t; requestAnimationFrame(frame); return; }
  acc += Math.min(0.1, (t - last) / 1000 || 0); last = t;
  cfg.steer = Input.mode;
  const ctl = Input.control();
  while (acc >= Run.STEP) { Run.step(R, G, cfg, ctl); acc -= Run.STEP; }
  render(t / 1000, acc / Run.STEP);
  requestAnimationFrame(frame);
}

// ---------- Controls ----------

const $ = (id) => document.getElementById(id);
for (const id of Object.keys(BIOMES)) { const b = document.createElement('button'); b.id = id; b.textContent = BIOMES[id].label; b.onclick = () => busy(() => { S.biome = id; return newGround(); }); $('biomes').append(b); }
function sync() {
  for (const id of Object.keys(BIOMES)) $(id).setAttribute('aria-pressed', S.biome === id);
  for (const [id, on] of [['line', S.style === 'line'], ['lowpoly', S.style === 'lowpoly'], ['curved', S.curved]]) $(id).setAttribute('aria-pressed', on);
  $('steer').textContent = Input.mode === 'sides' ? 'Steer: sides' : 'Steer: point';
  $('help').innerHTML = Input.mode === 'sides'
    ? 'It flies itself: hold the left or right half to turn · A/D or ←/→ · S or ↓ brakes · R restart · N new track'
    : 'Drag to fly, drag length sets speed · double-tap to stop · WASD / arrows · R restart · N new track';
  $('help').innerHTML += '<br>Walls and rocks bounce you and dent the hull · craters slow you · vents burn';
}
// One at a time: what's asked while the ground is building is ignored.
function busy(fn) {
  if (document.body.classList.contains('busy') && G) return;
  document.body.classList.add('busy');
  setTimeout(async () => { await fn(); sync(); document.body.classList.remove('busy'); }, 30);
}
function newGround() { if (G) for (const k of Object.keys(G.looks)) free(G.looks[k]); build(); return bake(); }
const newTrack = () => busy(() => { S.seed++; return newGround(); });
function setStyle(style) {
  if (S.style === style) return;
  busy(() => { free(G.looks[S.style]); delete G.looks[S.style]; S.style = style; return bake(); });
}
$('line').onclick = () => setStyle('line');
$('lowpoly').onclick = () => setStyle('lowpoly');
$('curved').onclick = () => { S.curved = !S.curved; sync(); };
$('steer').onclick = () => { Input.mode = Input.mode === 'sides' ? 'point' : 'sides'; Store.set('race.steer', Input.mode); Input.reset(R.craft.angle); sync(); };
$('restart').onclick = () => busy(restart);
$('next').onclick = newTrack;
Input.init(cv, {
  tilt: () => ArtSurface.tiltOf(S.style),
  onKey: (k) => { if (k === 'r') busy(restart); else if (k === 'n') newTrack(); else return false; return true; },
});

window.race = { S, Input, get G() { return G; }, get R() { return R; }, get cfg() { return cfg; } }; // to poke at from the console
busy(async () => { await newGround(); requestAnimationFrame(frame); });
