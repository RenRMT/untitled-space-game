// The race (race/index.html; serve the repo, e.g. `npm start`, and open /race/): a loop of open
// ground carved through a generated surface (ArtSurface, Track), raced in the game's own ship: the
// Courier in Android colours, its engine numbers, and the surface's flying (Flight), against five
// rivals, one from each other culture (Rival), as good as the track's style (regular, advanced,
// expert). notes/race.md is the plan, notes/race-rivals.md the rivals'.
//
// This module wires the page: builds a track, runs it a fixed step at a time (Run) and draws it
// between steps, the ground in chunks (SurfaceGlobe.tiles), every one of them built before the
// countdown (bake) and kept, so none is ever built while flying. Laps count by checkpoints along the
// centreline, passed in order. It opens on the landing (Menu): resume (on to the planets), a new game,
// the controls, your profile; then a planet, then a level; in the race the Menu button (or Esc) pauses
// it, to restart or go back to the landing. R restarts, N a new track.
// Seeds: yours (the career's, drawn once at a new game: your name, portrait and ship's look); a race's
// track, drawn afresh each time one is picked from the title; the rivals', drawn afresh each start.
// Drawn low-poly, on flat ground. Steering (Input): pad (a stick in a band along the bottom; the
// default on touch screens, the view framed above it, View), point (the game's drag; the default
// with a mouse), or sides (it flies itself; hold a half to turn). Tap to hop, flick to dash.
// Query parameters: ?biome=desert|ice|lava|terran|moon|gas, ?seed= (the track's; random by default), ?laps=,
// ?speed= (× the ship's top speed; the game flies surfaces at 0.5, races at TUNE.speed),
// ?mode=direct (no drift; letting go stops), ?steer=pad|point|sides, ?assist=0 (no steering assist),
// ?ai=regular|advanced|expert|off (the rivals' level, the track's style by default; off: none),
// ?track=regular|advanced|expert; with ?biome= or ?track= the race starts at once, past the title;
// ?fastresearch (the hangar's research 60× faster).
// The career (Career): what you pick up (Pickups) is banked at the finish and spent in the hangar
// (Menu.hangar), whose build tunes your ship; the track, its racing line and the rivals stay stock.
// ES module; needs a browser.

import { Art } from '../art/render.js';
import { ArtBlueprints } from '../art/blueprints.js';
import { ArtCrew } from '../art/crew.js';
import { ArtCulture } from '../art/culture.js';
import { ArtPortraits } from '../art/portraits.js';
import { ArtSurface } from '../art/surface.js';
import { SurfaceGlobe } from '../art/surface-globe.js';
import { Feedback } from '../core/feedback.js';
import { hashInt } from '../core/rng.js';
import { Store } from '../core/store.js';
import { Squad } from '../rules/squad.js';
import { Career } from './career.js';
import { Config } from './config.js';
import { Draw } from './draw.js';
import { Dust } from './dust.js';
import { Input } from './input.js';
import { Line } from './line.js';
import { Menu } from './menu.js';
import { Pickups } from './pickups.js';
import { Rival } from './rival.js';
import { Run } from './run.js';
import { Storm } from './storm.js';
import { Track } from './track.js';
import { View } from './view.js';

const q = new URLSearchParams(location.search), { T, SHIP, R_SHIP, HULL, TUNE } = Config;
if (T !== ArtSurface.T) throw new Error('Config.T is not ArtSurface.T');
const LAPS = Math.max(1, +q.get('laps') || 3), MODE = q.get('mode') === 'direct' ? 'direct' : 'cruise';
// The biomes, each with the planet the title shows for it (Menu: Art's planet types, a moon's).
const BIOMES = {
  terran: { type: 'terran', label: 'Terran', about: 'The standard track: the one to learn on', body: { kind: 'planet', type: 'terran' } },
  desert: { type: 'desert', label: 'Desert', about: 'Loose and fast; long straights, deep sand off them', body: { kind: 'planet', type: 'desert' } },
  ice: { type: 'ice', label: 'Ice', about: 'Little grip, long slides; wide sweeping bends', body: { kind: 'planet', type: 'ice' } },
  lava: { type: 'lava', label: 'Lava', about: 'Grippy, narrow and technical; the walls hurt', body: { kind: 'planet', type: 'lava' } },
  moon: { type: 'moon-grey', label: 'Moon', about: 'Low gravity, long hops; a wide crater-rim loop', body: { kind: 'moon', type: 'grey' } },
  gas: { type: 'gas', label: 'Gas giant', about: 'Floaty; wide open bends, soft storm walls, lightning', body: { kind: 'planet', type: 'gas' } },
};

// The ship (Config): the Courier as the game fits it, drawn as the game draws it (game/options.js
// HULL_ART) at the surface's size (flight/entities.js SHIP_SCALE).
const SPEED = +q.get('speed') || TUNE.speed;
let STATS = Config.stats(SPEED); // × the biome's (Config.BIOME), set with the track
if (q.has('fastresearch')) Career.lab.config.speed = 60;
let career = Career.load();
// The camera: close in (the ground's speed on screen is what reads as fast), leading the ship by
// `lead` seconds of its speed, `track` of the way along the track rather than its velocity, held
// to `reach` of the screen's shorter side; pushing in a little at top speed (`pull`), and zoomed by
// the bends ahead: `wide` on a straight, `tight` in a bend.
const CAM = { zoom: 1.3, lead: 0.6, pull: 0.04, reach: 0.3, track: 0.6, wide: 0.93, tight: 1.06 };
// Ships are drawn DRAW × as large as they collide (R_SHIP), a heavier hull larger in both (HULL_SIZE).
const DRAW = 1.25 * 1.375, { HULL_SIZE } = Config;
// You fly an Android ship, the hull the hangar's (Career.SHIPS), its look and its culture's (android())
// your seed's; the rivals their own cultures' ships in their colours (Rival.CULTURES), the hull by
// the level (light, fighter, heavy), their looks the start's rival seed's (S.rivals).
const ALIEN = ArtCulture.xeno(1).alien, HUMAN = Object.fromEntries(ArtCulture.HUMAN.map((id, i) => [id, ArtCulture.create(id, 11 + i, Rival.CULTURES[id].color)]));
const CULTURE = { ...HUMAN, drifter: ArtCulture.kitbash(Object.values(HUMAN), 14, Rival.CULTURES.drifter.color), alien: ALIEN };
let xenoKey = null, XENO = null; // your Android culture, for the career's seed
const android = () => (xenoKey === career.seed ? XENO : (xenoKey = career.seed, XENO = ArtCulture.xeno(career.seed).android));
const sized = (art, hull) => ({ art, k: (R_SHIP * DRAW * (HULL_SIZE[hull] || 1)) / art.radius, r: R_SHIP, z: ArtSurface.FLY });
const shipArt = (hull) => ArtBlueprints.create(hull, android(), career.seed);
let ART = null, BODY = null, artKey = ''; // yours: pilot() makes them for the career's seed and hull
function pilot() {
  const key = `${career.ship}.${career.seed}`;
  if (key !== artKey) { artKey = key; ART = shipArt(career.ship); BODY = sized(ART, career.ship); }
}
const cultureSeed = (id, salt) => hashInt(S.rivals, Object.keys(Rival.CULTURES).indexOf(id), salt);
let RIVAL_BODY = {}; // by culture, for this start's rival seed, made when first raced
const rivalBody = (w) => RIVAL_BODY[w.id] ||= sized(ArtBlueprints.create(w.art, CULTURE[w.id], cultureSeed(w.id, 0x5e1f)), w.art);
// The standings' portraits (ArtCrew; yours an android's), drawn once into images and set as CSS
// backgrounds by culture (.rm-face[data-f]).
const faceSheet = document.head.appendChild(document.createElement('style'));
function faceURL(portrait, size = 64) {
  const c = document.createElement('canvas'), g = c.getContext('2d');
  c.width = c.height = size;
  g.fillStyle = '#0b0e14'; g.fillRect(0, 0, size, size);
  g.translate(size / 2, size / 2); g.scale(size / 100, size / 100);
  ArtPortraits.draw(g, portrait, 'lowpoly', { texel: 2 });
  return c.toDataURL();
}
const youFace = () => ArtCrew.create(career.seed, android());
let youURL = null, youKey = 0;
function faces() {
  if (youKey !== career.seed) { youKey = career.seed; youURL = faceURL(youFace()); }
  const rules = [`.rm-face[data-f="you"]{background-image:url(${youURL})}`];
  if (pack) for (const X of pack.racers) rules.push(`.rm-face[data-f="${X.who.id}"]{background-image:url(${faceURL(ArtCrew.create(cultureSeed(X.who.id, 0xface), CULTURE[X.who.id]))})}`);
  faceSheet.textContent = rules.join('\n');
}
// What sells the speed (drawn only, like the dust): the engines' trails (`trail` s of where they were,
// `trailW` wide at the engine, strong from `trailFrom` of top speed up); a boost's punch, the camera
// out by `punch` and streaks in from the edges, over `kick` s; the ship's bank into a turn (`bank` ×
// its turn rate, rad/s, at most `maxBank`); and a shake (`shake`: px at most, by what set it off),
// settling at `settle` a second. A screen asked to keep still (reduced motion) gets no punch or shake.
const FX = { trail: 0.35, trailW: 3, trailFrom: 0.3, punch: 0.1, kick: 0.45, bank: 0.08, maxBank: 0.3, shake: { side: 3, land: 2.5, hit: 7, bump: 2, strike: 8 }, settle: 14 };
const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
let fx = null; // { trails: per engine [{ x, y, z, t, a, c }], kick: s of the punch left, bank, shake: px, sx, sy: px now, flash: R.flash a frame before }

const coarse = matchMedia('(pointer: coarse)').matches;
// The canvas's pixel ratio at most: below a phone's own (most mobile games draw under native
// resolution), and lowered a step at a time while frames are missed (pace).
const DPRS = coarse ? [1.25, 1] : [2, 1.5, 1.25];
let dprAt = 0;
const BAKE = { step: 500, slice: 30 }; // the bake: a rect every step along the track from the start; ms of work between paints
// track: the layout's style (Track.loop): 'regular', 'advanced' (irregular, like real circuits) or
// 'expert' (folded in on itself, sharp corners, few long straights)
const STYLES = { regular: 'Regular', advanced: 'Advanced', expert: 'Expert' };
const ABOUT = { regular: 'Flowing bends to learn the planet on; the rivals in light fighters', advanced: 'Irregular, like a real circuit; the rivals in fighters', expert: 'Folded in on itself: sharp corners, few straights; the rivals in heavy fighters' };
const S = { biome: BIOMES[q.get('biome')] ? q.get('biome') : 'terran', style: 'lowpoly', seed: +q.get('seed') || Career.roll(), rivals: 1, track: STYLES[q.get('track')] ? q.get('track') : 'regular', ai: q.get('ai') === 'off' || Rival.LEVELS[q.get('ai')] ? q.get('ai') : null };
const level = () => (S.ai === 'off' ? null : S.ai || S.track); // the rivals' level: ?ai=, else the track's style
const STEERS = ['pad', 'point', 'sides'], steerSaved = Store.get('race.steer', null); // the controls' choice, kept
Input.mode = STEERS.includes(q.get('steer')) ? q.get('steer') : STEERS.includes(steerSaved) ? steerSaved : coarse ? 'pad' : 'point';
Input.stopOnRelease = MODE === 'direct';
let G = null; // the track and its surface: { W, tr, b, seed, track (its style's name), size (the map's side), whole (all of it, as a rect), hw, talls, holes, looks: { style: { far, tiles } }, mini }
let R = null; // the run on it
let pack = null; // the rivals' runs (Rival.pack), or null with ?ai=off
let storm = null; // the biome's lightning (Storm), or null
let dust = Dust.create(), dustCols = null; // the dust off the craft (drawn only), and its colours on this ground
let cfg = null; // what the run flies by (Run)
let baking = false; // the ground is being built: the run waits
let paused = true; // a menu is up (Menu): the run waits, still drawn
const cv = document.getElementById('view'), ctx = cv.getContext('2d'), note = document.getElementById('note');
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// ---------- The track and the run ----------

function build() {
  const b = BIOMES[S.biome], { N, SIZE, TRACK } = Config.map(S.track, S.biome), tr = Track.loop(S.seed, TRACK);
  STATS = Config.stats(SPEED, S.biome);
  const W = ArtSurface.generate(b.type, S.seed, { w: N, h: N, tall: 0.06 });
  Track.carve(W, tr, S.seed, { ...Config.CARVE, outside: q.get('outside') || Config.CARVE.outside, kinds: Config.KINDS[S.biome] });
  const on = ArtSurface.propsAll(W).filter((p) => Track.edgeDist(tr, p.x, p.y).d < p.r);
  const mini = new Path2D();
  tr.pts.forEach((p, n) => (n ? mini.lineTo(p.x, p.y) : mini.moveTo(p.x, p.y)));
  mini.closePath();
  G = { W, tr, b, seed: S.seed, track: STYLES[S.track], line: null, pickups: null, size: SIZE, whole: { x0: 0, x1: SIZE, y0: 0, y1: SIZE, cx: SIZE / 2, cy: SIZE / 2 }, hw: Config.HW, talls: on.filter((p) => p.type === 'tall'), holes: on.filter((p) => p.type === 'hole'), looks: {}, mini };
  G.lines = Draw.lines(G);
  // The racing line (Line) on this track and biome's handling, stock, worked out once: the rivals fly
  // it, the chips lie along it.
  G.line = Line.build(G.tr, { stats: STATS, handling: Run.tune(Config.biome(S.biome)).handling, r: R_SHIP });
  G.pickups = Pickups.place(G.tr, G.line, S.seed, S.biome);
  restart();
}
function looks() {
  return G.looks[S.style] || (G.looks[S.style] = { far: ArtSurface.farImage(G.W, S.style), tiles: SurfaceGlobe.tiles(G.W, S.style, { size: 8, dpr: coarse ? 1 : 1.5, keep: Infinity }) });
}
function restart() {
  const bio = Config.biome(S.biome);
  Career.lab.settle(career.lab, Date.now());
  pilot();
  S.rivals = Career.roll(); RIVAL_BODY = {};
  const done = career.lab.done, tune = done.length || career.ship !== Career.STOCK ? Career.tune(done, career.ship) : null;
  const stock = { stats: STATS, ship: SHIP, hull: HULL, r: R_SHIP, laps: LAPS, mode: MODE, steer: Input.mode, assist: q.get('assist') !== '0', cam: CAM, biome: bio };
  // Yours: the hangar's build on top, and the pickups.
  cfg = {
    ...stock, r: R_SHIP * HULL_SIZE[career.ship], stats: tune ? Career.stats(STATS, tune) : STATS, hull: HULL * (tune ? tune.hull : 1), career: tune, pickups: G.pickups };
  const lv = level();
  R = Run.create(G, lv ? { ...cfg, grid: Rival.grid(Rival.PLAYER, G.tr.pts[0].hw) } : cfg);
  pack = lv ? Rival.pack(G, stock, G.line, lv, S.rivals, (c) => Run.create(G, c)) : null;
  storm = bio.storm ? Storm.create(bio.storm, S.rivals) : null;
  faces();
  Input.reset(R.craft.angle);
  dust = Dust.create(); dustCols = Dust.colours(G.b.type, Config.KINDS[S.biome]);
  fx = { trails: ART.engines.map(() => []), kick: 0, bank: 0, shake: 0, sx: 0, sy: 0, flash: 0 };
}

// ---------- The view ----------

// The camera, like the craft, between its last two steps (a of the way from the one before).
const cam = { lx: 0, ly: 0, zf: 1 };
function viewNow(Wc, Hc, C, a) {
  const P = R.pcam, Q = R.cam;
  cam.lx = P.lx + (Q.lx - P.lx) * a; cam.ly = P.ly + (Q.ly - P.ly) * a; cam.zf = P.zf + (Q.zf - P.zf) * a;
  const zoom = clamp(Math.min(Wc, Hc) / 800, 0.55, 1.3) * CAM.zoom * cam.zf * (1 - FX.punch * punch()), tilt = ArtSurface.tiltOf(S.style);
  // The lead, held so the ship stays in sight (View): on a portrait screen steered by the pad, above
  // the stick's band; else within CAM.reach of the screen's shorter side.
  const band = Input.mode === 'pad' && Hc > Wc ? 1 - Input.home().y0 / Hc : 0;
  const f = View.frame({ W: Wc, H: Hc, lx: cam.lx, ly: cam.ly, zoom, ct: Math.cos(tilt), band, reach: CAM.reach });
  const ct = Math.cos(tilt), v = SurfaceGlobe.view({ R: 1e9, flat: 0, fx: C.x + f.lx + fx.sx / zoom, fy: C.y + f.ly + fx.sy / (zoom * ct), W: Wc / zoom, H: Hc / zoom, ox: Wc / 2 / zoom, oy: f.oy / zoom, tilt });
  return { v, zoom };
}
// The boost's punch now (0 .. 1): straight up, then easing back over the rest of FX.kick.
function punch() {
  const p = fx.kick / FX.kick;
  return calm ? 0 : Math.min(1, (1 - p) / 0.15) * p;
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
// A run's craft between its last two steps (a of the way from the one before).
const drawn = { x: 0, y: 0, angle: 0, thrust: 0, air: 0 }, other = { ...drawn };
function between(a, Q = R, to = drawn) {
  const C = Q.craft, P = Q.prev, da = ((C.angle - P.angle + Math.PI) % TAU + TAU) % TAU - Math.PI;
  to.x = P.x + (C.x - P.x) * a; to.y = P.y + (C.y - P.y) * a; to.angle = P.angle + da * a; to.thrust = C.thrust;
  to.air = Q.pair + (Q.air - Q.pair) * a;
  return to;
}
// The rivals, those near enough to be on screen (within `far` of you).
function rivals(v, a, C, time, far) {
  if (!pack) return;
  for (const X of pack.racers) {
    const B = between(a, X.R, other);
    if (Math.abs(B.x - C.x) > far || Math.abs(B.y - C.y) > far) continue;
    Draw.ship(ctx, v, rivalBody(X.who), B, { style: S.style, time, shadow: true, ground });
  }
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

const hudLap = document.getElementById('hud-lap'), hudTime = document.getElementById('hud-time'), hudTotal = document.getElementById('hud-total'), hudRest = document.getElementById('hud-rest'), hudOrder = document.getElementById('hud-order');
let hudAt = -1, hudText = '', hudPos = '', pos = null; // pos: the standings (Rival.standings), with the HUD's text
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
  Draw.marks(ctx, v, px, time, G, R);
  Draw.pickups(ctx, v, px, time, G.pickups, R.got, ground, S.style);
  Draw.dust(ctx, v, px, dust.puffs, ground);
  if (storm) Draw.storm(ctx, v, px, time, storm.strikes, ground);
  rivals(v, a, C, time, (Math.max(Wc, Hc) / zoom) * 1.2);
  // A hop lifts the ship (its shadow falls further off) and draws it a little larger.
  const body = C.air ? { ...BODY, z: BODY.z + C.air, k: BODY.k * (1 + C.air / 160) } : BODY;
  trailAt(C, body, time);
  Draw.trail(ctx, v, fx.trails, time, FX.trail, FX.trailW);
  Draw.sparks(ctx, v, px, C, body.z, R.drift, time, ground);
  Draw.ship(ctx, v, body, C, { style: S.style, time, shadow: true, ground, bank: fx.bank });
  const at = SurfaceGlobe.toScreen(v, C.x, C.y, body.z);

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (at) Draw.streaks(ctx, Wc, Hc, at[0] * zoom, at[1] * zoom, punch(), time);
  if (R.flash > 0 || R.burn) { ctx.fillStyle = R.flash > 0 ? `rgba(255,60,40,${R.flash})` : `rgba(255,120,30,${0.12 + 0.06 * Math.sin(time * 20)})`; ctx.fillRect(0, 0, Wc, Hc); }
  Draw.minimap(ctx, Wc, G, R, G.size, pack ? pack.racers.map((X) => ({ x: X.R.craft.x, y: X.R.craft.y, color: X.who.color })) : []);
  if (Input.mode === 'sides') Draw.sides(ctx, Wc, Hc, Input.held);
  else if (Input.mode === 'pad') Draw.pad(ctx, Input.pad, Input.home(), Input.maxDrag(), Input.PAD.inner, R.dash, R.tune.dash, R.drift, R.tune.drift);
  else Draw.drag(ctx, Input.drag, Input.maxDrag());

  // The HUD's text, ten times a second: the times as text, the rest only written when it changed.
  if (time - hudAt > 0.1 || time < hudAt) {
    hudAt = time;
    pos = pack ? Rival.standings(pack, G, R) : null;
    const h = Draw.hud(G, R, cfg, got.missing, pos);
    if (hudLap.textContent !== h.lap) hudLap.textContent = h.lap;
    hudTime.textContent = h.time; hudTotal.textContent = h.total;
    if (h.rest !== hudText) hudRest.innerHTML = hudText = h.rest;
    if (h.order !== hudPos) hudOrder.innerHTML = hudPos = h.order;
  }
  const { msg, big } = Draw.note(R, cfg, pos);
  if (note.textContent !== msg) note.textContent = msg;
  note.classList.toggle('big', big);
}

// The engines where the ship is drawn now, added to their trails: strong with speed, coloured by a
// boost or the drift's level; the old let go.
function trailAt(C, body, time) {
  const c = Math.cos(C.angle), s = Math.sin(C.angle), sp = Math.hypot(R.craft.vx, R.craft.vy) / cfg.stats.maxSpeed;
  const a = clamp((sp - FX.trailFrom) / (1 - FX.trailFrom), 0, 1);
  const boost = (R.dash.t > 0 && R.dash.kind === 'boost') || R.drift.boost > 0, col = boost ? 3 : R.drift.on ? R.drift.level : 0;
  ART.engines.forEach((e, i) => {
    const pts = fx.trails[i], x = e.x * body.k, y = e.y * body.k;
    while (pts.length && (time - pts[0].t > FX.trail || pts[0].t > time)) pts.shift();
    pts.push({ x: C.x + x * c - y * s, y: C.y + x * s + y * c, z: body.z, t: time, a, c: col });
  });
}
// What the run's events look like: a boost's punch, a shake; and the bank, the shake's offset now.
function juice(dt, time) {
  for (const k of R.fx) {
    if (k === 'boost' || k === 'driftBoost') fx.kick = FX.kick;
    if (FX.shake[k]) fx.shake = Math.max(fx.shake, FX.shake[k]);
  }
  if (R.flash > fx.flash + 0.01) fx.shake = Math.max(fx.shake, (FX.shake.hit * R.flash) / 0.4); // a hit (Run's flash, up to 0.4)
  fx.flash = R.flash;
  fx.kick = Math.max(0, fx.kick - dt);
  fx.shake = calm ? 0 : fx.shake * Math.exp(-FX.settle * dt);
  fx.sx = fx.shake * Math.sin(time * 53); fx.sy = fx.shake * Math.sin(time * 61 + 1);
  const C = R.craft, w = (((C.angle - R.prev.angle + Math.PI) % TAU + TAU) % TAU - Math.PI) / Run.STEP;
  fx.bank += (clamp(w * FX.bank, -FX.maxBank, FX.maxBank) - fx.bank) * (1 - Math.exp(-10 * dt));
}

// A fixed step: the run steps as many times as the frame's time holds (at most a tenth of a second
// of them, after a stall), and is drawn the rest of the way to the next.
let last = 0, acc = 0;
// What the run's events feel like (Feedback.vibrate: Android browsers; nothing on iPhones).
const BUZZ = { strike: [30, 40, 20], chip: 4, crate: [10, 30, 18], boost: 22, side: 14, airbrake: [12, 30, 12], hop: 8, land: 16, charge: [6, 50, 6], slide: 6, drift1: [8, 40, 8], drift2: [8, 30, 8, 30, 8], driftBoost: 26, bump: 10 };
function frame(t) {
  // Nothing to run yet, the ground building, or the title over it all: nothing to step or draw.
  if (!G || baking || Menu.covers()) { last = t; requestAnimationFrame(frame); return; }
  if (last) paceFrame(t, t - last);
  const dtFrame = (t - last) / 1000 || 0;
  acc += Math.min(0.1, dtFrame); last = t;
  cfg.steer = Input.mode;
  const ctl = Input.control();
  if (paused) { acc = 0; ctl.events.length = 0; }
  while (acc >= Run.STEP) {
    Run.step(R, G, cfg, ctl);
    if (pack) Rival.step(pack, G, R);
    if (storm) Storm.step(storm, G, pack ? [R, ...pack.racers.map((X) => X.R)] : [R], Run.STEP);
    acc -= Run.STEP;
  }
  // The finish (or the wreck): the haul brought home, once.
  if (!R.banked && (R.phase === 'done' || R.phase === 'wreck')) {
    R.banked = Career.bank(career, R.haul, { place: pack ? Rival.standings(pack, G, R).place : null, wreck: R.phase === 'wreck', level: S.track });
    Career.save(career);
  }
  if (dustCols && !paused) Dust.step(dust, R.craft, { off: R.air ? 0 : R.off, slide: R.grip.sliding && !R.air, speed: cfg.stats.maxSpeed }, dustCols, Math.min(0.1, dtFrame));
  for (const k of R.fx) Feedback.vibrate(BUZZ[k]);
  juice(paused ? 0 : Math.min(0.1, dtFrame), t / 1000);
  R.fx.length = 0;
  render(t / 1000, acc / Run.STEP);
  requestAnimationFrame(frame);
}

// ---------- Controls ----------

const $ = (id) => document.getElementById(id);
// The landing (Menu): Resume (the career on to the title, to pick a planet; a race left paused there
// is dropped for it), New game (a career afresh: a new pilot), the controls and your profile.
const live = () => !!(G && R && (R.phase === 'count' || R.phase === 'race'));
function toLanding() {
  paused = true;
  $('hud').hidden = true; note.textContent = '';
  Menu.landing({
    canResume: live() || Career.saved(), progress: Career.saved(),
    onResume: () => { Menu.close(); toTitle(); },
    onNew: () => {
      career = Career.empty(); Career.save(career);
      if (G) for (const k of Object.keys(G.looks)) free(G.looks[k]);
      G = R = pack = storm = null;
      Menu.close(); toTitle();
    },
    onControls: () => Menu.controls({
      mode: Input.mode, coarse,
      onMode: (m) => { Input.mode = m; Store.set('race.steer', m); },
      onBack: toLanding,
    }),
    onProfile: () => Menu.profile({
      name: Squad.designation(career.seed), seed: career.seed, portrait: youFace(),
      ship: { art: shipArt(career.ship), name: Career.SHIPS[career.ship].name },
      onBack: toLanding,
    }),
  });
}
// The title (Menu): a planet, then a level; the race on them, on a track of a new seed (?seed=: that one).
const FIXED = q.has('seed');
function toTitle() {
  paused = true;
  $('hud').hidden = true; note.textContent = '';
  Menu.title({
    planets: Object.entries(BIOMES).map(([id, b]) => ({ id, label: b.label, about: b.about, body: b.body })),
    levels: Object.entries(STYLES).map(([id, label]) => ({ id, label, about: ABOUT[id] })),
    biome: S.biome, level: S.track,
    onHangar: () => hangar(toTitle),
    onBack: () => { Menu.close(); toLanding(); },
    onPick: (biome, track) => {
      Menu.close();
      const same = FIXED && G && S.biome === biome && S.track === track;
      if (!FIXED) S.seed = Career.roll();
      S.biome = biome; S.track = track;
      busy(() => { if (same) restart(); else return newGround(); }, play);
    },
  });
}
function play() { paused = false; $('hud').hidden = false; }
// The hangar (Menu.hangar): the career's research and hulls, saved on every change; back to `then`.
function hangar(then) {
  paused = true;
  Menu.hangar({ career, now: () => Date.now(), shipArt, onChange: () => Career.save(career), onBack: () => { Menu.close(); then(); } });
}
function menu() {
  if (Menu.up || !G) return;
  paused = true;
  const over = R.phase === 'done' || R.phase === 'wreck';
  Menu.pause({ planet: BIOMES[S.biome].label, seed: S.seed, onResume: () => (paused = false), onRestart: () => busy(restart, play), onMain: toLanding, onHangar: () => hangar(over ? () => busy(restart, play) : menu), over });
}
// One at a time: what's asked while the ground is building is ignored.
function busy(fn, then) {
  if (document.body.classList.contains('busy')) return;
  document.body.classList.add('busy');
  setTimeout(async () => { await fn(); document.body.classList.remove('busy'); then?.(); }, 30);
}
function newGround() { if (G) for (const k of Object.keys(G.looks)) free(G.looks[k]); build(); return bake(); }
const newTrack = () => busy(() => { S.seed = Career.roll(); return newGround(); });
$('menu-btn').onclick = menu;
// The screen's safe area at the bottom (a phone's home bar), which the stick's band keeps clear of.
const safe = Object.assign(document.createElement('div'), { style: 'position:fixed;left:0;bottom:0;width:0;height:env(safe-area-inset-bottom,0px);visibility:hidden;pointer-events:none' });
document.body.append(safe);
Input.init(cv, {
  tilt: () => ArtSurface.tiltOf(S.style),
  inset: () => safe.offsetHeight,
  onKey: (k) => {
    if (Menu.up) return Menu.key(k) || k.length === 1 || k.startsWith('Arrow'); // nothing reaches the run under a menu
    if (k === 'r') busy(restart); else if (k === 'n') newTrack(); else if (k === 'Escape') menu(); else return false;
    return true;
  },
});

window.race = { S, Input, get career() { return career; }, get G() { return G; }, get R() { return R; }, get cfg() { return cfg; }, get pack() { return pack; }, get storm() { return storm; } }; // to poke at from the console
requestAnimationFrame(frame);
if (q.has('biome') || q.has('track')) busy(newGround, play); else toLanding();
