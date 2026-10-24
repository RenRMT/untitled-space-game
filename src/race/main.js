// The race (race/index.html; serve the repo, e.g. `npm start`, and open /race/): a loop of open
// ground carved through a generated surface (ArtSurface, Track), raced in the game's own ship: the
// Courier's art, its engine numbers, and the surface's flying (Flight). notes/race.md is the plan.
//
// This module wires the page: builds a track, runs it a fixed step at a time (Run) and draws it
// between steps, the ground in chunks (SurfaceGlobe.tiles), every one of them built before the
// countdown (bake) and kept, so none is ever built while flying. Laps count by checkpoints along the
// centreline, passed in order; your best lap's ghost flies beside you. R restarts, N a new track.
// Drawn low-poly, on flat ground. Steering (Input): point (the game's drag), or ?steer=sides (it
// flies itself; hold a half to turn).
// Query parameters: ?biome=desert|ice|lava|terran|moon, ?seed=, ?laps=,
// ?speed= (× the ship's top speed; the game flies surfaces at 0.5, races at TUNE.speed),
// ?mode=direct (no drift; letting go stops), ?steer=point|sides, ?assist=0 (no steering assist).
// ES module; needs a browser.

import { Art } from '../art/render.js';
import { ArtBlueprints } from '../art/blueprints.js';
import { ArtCulture } from '../art/culture.js';
import { ArtSurface } from '../art/surface.js';
import { SurfaceGlobe } from '../art/surface-globe.js';
import { Config } from './config.js';
import { Draw } from './draw.js';
import { Ghost } from './ghost.js';
import { Input } from './input.js';
import { Run } from './run.js';
import { Track } from './track.js';

const q = new URLSearchParams(location.search), { T, TRACKS, SHIP, R_SHIP, HULL, TUNE } = Config;
if (T !== ArtSurface.T) throw new Error('Config.T is not ArtSurface.T');
const LAPS = Math.max(1, +q.get('laps') || 3), MODE = q.get('mode') === 'direct' ? 'direct' : 'cruise';
const BIOMES = {
  desert: { type: 'desert', label: 'Desert' },
  ice: { type: 'ice', label: 'Ice' },
  lava: { type: 'lava', label: 'Lava' },
  terran: { type: 'terran', label: 'Terran' },
  moon: { type: 'moon-grey', label: 'Moon' },
};

// The ship (Config): the Courier as the game fits it, drawn as the game draws it (game/options.js
// HULL_ART) at the surface's size (flight/entities.js SHIP_SCALE).
const SPEED = +q.get('speed') || TUNE.speed;
const STATS = Config.stats(SPEED);
// The camera: close in (the ground's speed on screen is what reads as fast), leading the ship by
// `lead` seconds of its speed, `track` of the way along the track rather than its velocity, held
// to `reach` of the screen's shorter side; pushing in a little at top speed (`pull`), and zoomed by
// the bends ahead: `wide` on a straight, `tight` in a bend.
const CAM = { zoom: 1.3, lead: 0.6, pull: 0.04, reach: 0.3, track: 0.6, wide: 0.93, tight: 1.06 };
const SHIP_SCALE = 1.375, { SURFACE_SCALE } = Config;
const ART = ArtBlueprints.create('fighter-light', ArtCulture.legacy, 3);
const BODY = { art: ART, k: (SHIP.radius * 1.25 * SHIP_SCALE * SURFACE_SCALE) / ART.radius, r: R_SHIP, z: ArtSurface.FLY };

const coarse = matchMedia('(pointer: coarse)').matches;
// The canvas's pixel ratio at most: below a phone's own (most mobile games draw under native
// resolution), and lowered a step at a time while frames are missed (pace).
const DPRS = coarse ? [1.25, 1] : [2, 1.5, 1.25];
let dprAt = 0;
const BAKE = { step: 500, slice: 30 }; // the bake: a rect every step along the track from the start; ms of work between paints
// track: the layout's style (Track.loop): 'regular', or 'advanced' (irregular, like real circuits)
const STYLES = { regular: 'Regular', advanced: 'Advanced' };
const S = { biome: BIOMES[q.get('biome')] ? q.get('biome') : 'desert', style: 'lowpoly', seed: +q.get('seed') || 1, track: q.get('track') === 'advanced' ? 'advanced' : 'regular' };
Input.mode = q.get('steer') === 'sides' ? 'sides' : 'point';
Input.stopOnRelease = MODE === 'direct';
let G = null; // the track and its surface: { W, tr, b, seed, track (its style's name), size (the map's side), whole (all of it, as a rect), hw, talls, holes, looks: { style: { far, tiles } }, mini }
let R = null; // the run on it
let cfg = null; // what the run flies by (Run)
let baking = false; // the ground is being built: the run waits
const cv = document.getElementById('view'), ctx = cv.getContext('2d'), note = document.getElementById('note');
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// ---------- The track and the run ----------

function build() {
  const b = BIOMES[S.biome], { N, SIZE, TRACK } = Config.map(S.track), tr = Track.loop(S.seed, TRACK);
  const W = ArtSurface.generate(b.type, S.seed, { w: N, h: N, tall: 0.06 });
  Track.carve(W, tr, S.seed, { ...Config.CARVE, outside: q.get('outside') || Config.CARVE.outside, kinds: Config.KINDS[S.biome] });
  const on = ArtSurface.propsAll(W).filter((p) => Track.edgeDist(tr, p.x, p.y).d < p.r);
  const mini = new Path2D();
  tr.pts.forEach((p, n) => (n ? mini.lineTo(p.x, p.y) : mini.moveTo(p.x, p.y)));
  mini.closePath();
  G = { W, tr, b, seed: S.seed, track: STYLES[S.track], size: SIZE, whole: { x0: 0, x1: SIZE, y0: 0, y1: SIZE, cx: SIZE / 2, cy: SIZE / 2 }, hw: Config.HW, talls: on.filter((p) => p.type === 'tall'), holes: on.filter((p) => p.type === 'hole'), looks: {}, mini };
  G.lines = Draw.lines(G);
  restart();
}
function looks() {
  return G.looks[S.style] || (G.looks[S.style] = { far: ArtSurface.farImage(G.W, S.style), tiles: SurfaceGlobe.tiles(G.W, S.style, { size: 8, dpr: coarse ? 1 : 1.5, keep: Infinity }) });
}
function restart() {
  cfg = { stats: STATS, ship: SHIP, hull: HULL, r: R_SHIP, laps: LAPS, mode: MODE, steer: Input.mode, assist: q.get('assist') !== '0', cam: CAM, ghostKey: `${TRACKS}.${S.biome}.${S.seed}.${SPEED}${S.track === 'regular' ? '' : `.${S.track}`}` };
  R = Run.create(G, cfg);
  Input.reset(R.craft.angle);
}

// ---------- The view ----------

// The camera, like the craft, between its last two steps (a of the way from the one before).
const cam = { lx: 0, ly: 0, zf: 1 };
function viewNow(Wc, Hc, C, a) {
  const P = R.pcam, Q = R.cam;
  cam.lx = P.lx + (Q.lx - P.lx) * a; cam.ly = P.ly + (Q.ly - P.ly) * a; cam.zf = P.zf + (Q.zf - P.zf) * a;
  const zoom = clamp(Math.min(Wc, Hc) / 800, 0.55, 1.3) * CAM.zoom * cam.zf;
  // The lead, held to CAM.reach of the screen's shorter side, so the ship never runs off its edge.
  const l = Math.hypot(cam.lx, cam.ly) * zoom, f = Math.min(1, (CAM.reach * Math.min(Wc, Hc)) / (l || 1));
  const v = SurfaceGlobe.view({ R: 1e9, flat: 0, fx: C.x + cam.lx * f, fy: C.y + cam.ly * f, W: Wc / zoom, H: Hc / zoom, ox: Wc / 2 / zoom, oy: (Hc * 0.55) / zoom, tilt: ArtSurface.tiltOf(S.style) });
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
async function bake() {
  const { tiles } = looks(), { tr, whole: WHOLE } = G, total = () => { const l = tiles.layers(WHOLE, 0); return [l.length, l.length + l.missing]; };
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
// A track's chunks let go, their canvases emptied (a browser may hold a dropped canvas's memory
// until it's collected).
function free(look) {
  if (!look) return;
  for (const L of look.tiles.layers(G.whole, 0)) L.canvas.width = L.canvas.height = 0;
  look.tiles.clear();
}

const ground = (v, x, y, z = 0) => SurfaceGlobe.toScreen(v, x, y, ArtSurface.heightAt(G.W, x, y) + z);
const TAU = Math.PI * 2;
// The craft between its last two steps (a of the way from the one before).
const drawn = { x: 0, y: 0, angle: 0, thrust: 0 };
function between(a) {
  const C = R.craft, P = R.prev, da = ((C.angle - P.angle + Math.PI) % TAU + TAU) % TAU - Math.PI;
  drawn.x = P.x + (C.x - P.x) * a; drawn.y = P.y + (C.y - P.y) * a; drawn.angle = P.angle + da * a; drawn.thrust = C.thrust;
  return drawn;
}

// Frames missed: a frame over 1.5× the usual one missed the display's refresh. When more than a
// tenth of 2 s of frames miss, the canvas drops to the next pixel ratio (and stays there: up and
// down again would show). A display held to 30 a second (a phone saving power) misses none.
const PACE = { span: 2000, missed: 0.1 }, pace = { at: 0, n: 0, ts: [] };
function paceFrame(t, dt) {
  if (dt > 250) return; // a hidden tab, a bake
  pace.ts.push(dt);
  if (t - pace.at < PACE.span) return;
  const s = [...pace.ts].sort((x, y) => x - y), usual = s[s.length >> 1], missed = s.filter((x) => x > usual * 1.5).length;
  if (missed > s.length * PACE.missed && dprAt < DPRS.length - 1) dprAt++;
  pace.at = t; pace.ts.length = 0;
}

const hudLap = document.getElementById('hud-lap'), hudTime = document.getElementById('hud-time'), hudRest = document.getElementById('hud-rest');
let hudAt = -1, hudText = '';
function render(time, a) {
  const dpr = Math.min(DPRS[dprAt], devicePixelRatio || 1), Wc = innerWidth, Hc = innerHeight, bg = Art.config.bg;
  if (cv.width !== Math.round(Wc * dpr) || cv.height !== Math.round(Hc * dpr)) { cv.width = Math.round(Wc * dpr); cv.height = Math.round(Hc * dpr); }
  Art.beginFrame();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = bg; ctx.fillRect(0, 0, Wc, Hc);
  const C = between(a), { far, tiles } = looks(), { v, zoom } = viewNow(Wc, Hc, C, a), px = 1 / zoom;
  const got = tiles.layers(detailRect(v), 0), layers = [far, ...got];
  ctx.setTransform(dpr * zoom, 0, 0, dpr * zoom, 0, 0);
  SurfaceGlobe.drawFlat(ctx, layers, v, { dpr: dpr * zoom, under: bg });
  Draw.marks(ctx, v, px, time, G, R, ground);
  const ghost = R.phase === 'race' ? Ghost.at(R.ghost, R.lapT) : null;
  if (ghost) Draw.ship(ctx, v, BODY, { ...ghost, thrust: 0.6 }, { style: S.style, time, alpha: 0.35 });
  Draw.ship(ctx, v, BODY, C, { style: S.style, time, shadow: true, ground });

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (R.flash > 0 || R.burn) { ctx.fillStyle = R.flash > 0 ? `rgba(255,60,40,${R.flash})` : `rgba(255,120,30,${0.12 + 0.06 * Math.sin(time * 20)})`; ctx.fillRect(0, 0, Wc, Hc); }
  Draw.minimap(ctx, Wc, G, R, G.size, ghost);
  if (Input.mode === 'sides') Draw.sides(ctx, Wc, Hc, Input.held); else Draw.drag(ctx, Input.drag, Input.maxDrag());

  // The HUD's text, ten times a second: the times as text, the rest only written when it changed.
  if (time - hudAt > 0.1 || time < hudAt) {
    hudAt = time;
    const h = Draw.hud(G, R, cfg, got.missing);
    if (hudLap.textContent !== h.lap) hudLap.textContent = h.lap;
    hudTime.textContent = h.time;
    if (h.rest !== hudText) hudRest.innerHTML = hudText = h.rest;
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
  if (last) paceFrame(t, t - last);
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
for (const id of Object.keys(STYLES)) { const b = document.createElement('button'); b.id = `track-${id}`; b.textContent = STYLES[id]; b.onclick = () => busy(() => { S.track = id; return newGround(); }); $('tracks').append(b); }
function sync() {
  for (const id of Object.keys(BIOMES)) $(id).setAttribute('aria-pressed', S.biome === id);
  for (const id of Object.keys(STYLES)) $(`track-${id}`).setAttribute('aria-pressed', S.track === id);
  $('help').innerHTML = Input.mode === 'sides'
    ? 'It flies itself: hold the left or right half to turn · A/D or ←/→ · S or ↓ brakes · R restart · N new track'
    : 'Drag to fly, drag length sets speed · double-tap to stop · WASD / arrows · R restart · N new track';
  $('help').innerHTML += '<br>Walls bounce you and dent the hull · off the track slows you';
}
// One at a time: what's asked while the ground is building is ignored.
function busy(fn) {
  if (document.body.classList.contains('busy') && G) return;
  document.body.classList.add('busy');
  setTimeout(async () => { await fn(); sync(); document.body.classList.remove('busy'); }, 30);
}
function newGround() { if (G) for (const k of Object.keys(G.looks)) free(G.looks[k]); build(); return bake(); }
const newTrack = () => busy(() => { S.seed++; return newGround(); });
$('restart').onclick = () => busy(restart);
$('next').onclick = newTrack;
Input.init(cv, {
  tilt: () => ArtSurface.tiltOf(S.style),
  onKey: (k) => { if (k === 'r') busy(restart); else if (k === 'n') newTrack(); else return false; return true; },
});

window.race = { S, Input, get G() { return G; }, get R() { return R; }, get cfg() { return cfg; } }; // to poke at from the console
busy(async () => { await newGround(); requestAnimationFrame(frame); });
