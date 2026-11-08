// The surface run (notes/hazards.md §6): what there is to do and to fear on a planet or moon once
// landed (game/landing.js flies the ship there).
// - Deposits (rules/mining.js deposits): many small nodes on open ground round the landing site,
//   each a unit of one of the body's goods, seeded afresh on every landing; more of them the more
//   dangerous the site (site.rich), gathered near its vents or storm pockets, where they're rich.
//   A tap selects one, and its context menu's Mine (or E) sets the tools on it: the same timed
//   action as an asteroid in space (game/mining.js extract). The tools never pick one on their own.
//   Broken up, a node leaves what it held lying beside it, a unit more on a hot day side
//   (notes/hazards.md phase 4).
// - What lies on the surface (cargo.surfaceDrops): a node's goods, cargo jettisoned and the hold
//   of a ship lost there, drawn as their icons. A tap selects one; dragged onto the ship
//   (game/input.js), it's picked up. Nothing is picked up by flying near it.
// - Hazards (rules/hazards.js surface): the day side sweeping over the ground (heat; the countdown to
//   sunrise and the way to the night on the HUD), hot vents on the lava planet, dust storms on the desert, radiation on the moons, the
//   cold on the ice planet (dashes cost twice the fuel) and the storm pockets of the gas giants. The meters
//   are the ones in space (game/hazards.js); one that fills loses the ship here, and its hold stays
//   on the surface, to come back for.
// - Taking off costs fuel (Hazards.takeoffFuel), by gravity and how full the hold is. Short of it,
//   Take off is refused; Jettison leaves cargo behind until it's enough, and with not even enough for
//   an empty hold, Call a tow gives the ship up.
// - The scan before landing: what a planet's or moon's card says of its surface (siteScan).
// - The test dungeon (game/dungeon.js): one planet's surface a labyrinth of caverns, no hazards.
// Flight time runs on while landed, so the day comes round and the system moves on.
// Part of the flight view; src/main.js starts it.

import { SurfaceGlobe } from '../art/surface-globe.js';
import { ArtSurface } from '../art/surface.js';
import { Feedback } from '../core/feedback.js';
import { hashInt, seedToInt } from '../core/rng.js';
import { Format } from '../core/format.js';
import { COLORS } from '../core/theme.js';
import { ContextCard } from '../ui/context.js';
import { Goods } from '../rules/goods.js';
import { Hazards } from '../rules/hazards.js';
import { Mining } from '../rules/mining.js';
import { addTo, cargo, hold, saveCargo } from './cargo.js';
import { drawFight, drawFightOverlay, endSurfaceFight, hurtShip, tickFight, tickShield } from './combat.js';
import { hazard, hazardsOn, meterWarnings, trackMeters } from './hazards.js';
import { SURFACE_SPEED, landing, landedZoom, takeOff } from './landing.js';
import { REACH, chips, drawRing, endExtraction, extract, mine, mineReach, tickMining } from './mining.js';
import { landSquad, liftSquad, tickSurfaceSquad } from './surface-squad.js';
import { dungeonLines, dungeonRun, dungeonSite, enterDungeon, isDungeon, tickDungeon, tickGuardians } from './dungeon.js';
import { dashSafe } from './dash.js';
import { DROP_PX, STACK_PX, dropColor, drawDrop, stackDrops } from './draw-world.js';
import { SHIP, TAU, clamp, ctx, debris, notify, setMode } from './state.js';
import { simTime, skipTime } from './update.js';
import { world } from './world.js';

// e: the body landed on; W: its surface; site: what it does to a ship (Hazards.surface); field: this
// landing's (its nodes seeded by it); deposits: those not yet worked out, as extraction targets; exp:
// the last step's exposure; burn: storm-pocket
// damage still to take (whole points at a time); said: notices given this landing; vents, pockets: the lava's
// vents and the gas giants' storm pockets ({ x, y, r, seed }: Hazards.eruption, strike); blast: a
// vent's damage still to take; struck: each pocket's last strike (by index) already resolved; bolts:
// lightning just struck ({ x, y, t }), to draw; warn: a burst coming where the ship is ('vent' |
// 'strike' | null).
export const surfaceRun = { e: null, W: null, site: null, field: 0, deposits: [], exp: null, burn: 0, said: new Set(), vents: [], pockets: [], blast: 0, struck: new Map(), bolts: [], warn: null };
const PICKUP = 30; // surface units round the ship that a drop let go over it counts as onto it
const HAZARD_NEAR = [30, 110]; // nodes gather by a vent or storm pocket: in full this far past its rim, none past this
// The next landing's field, for the tests (tests/smoke.js): null picks one at random.
export const nextField = { value: null };

// ---------- The site ----------

// What a body's surface does to a ship (Hazards.surface), a moon's by its planet's type too.
export function bodySite(e) {
  const G = world.galaxy, moon = e.kind === 'moon' && G.moons.find((m) => m.name === e.key);
  const site = Hazards.surface(e.kind, e.body.type, e.body.seed, moon ? G.planets[moon.parent]?.type : undefined);
  // A dungeon: no hazards (game/dungeon.js); and with the hazards off (game/hazards.js), none either.
  return isDungeon(e) ? dungeonSite(site) : hazardsOn ? site : calmSite(site);
}
const goodName = (kind) => Goods.type(kind)?.name || kind;
// A good's colour (rules/goods.js), or as light as `light` at least (to stand out on dark ground).
const goodColor = (kind, light = 0) => { const c = Goods.type(kind)?.color || [0, 0, 0.7]; return `hsl(${c[0]}, ${Math.round(c[1] * 100)}%, ${Math.round(Math.max(light, c[2]) * 100)}%)`; };
const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
// Whether the day side is a danger there: heat by day faster than a ship sheds it.
const hotDay = (site) => site.heat + site.day > Hazards.config.heat.cool;

// The scan before landing: a planet's or moon's card (game/selection.js describe) names the site's
// hazard in a word, and in its detail line the hazard, what's there, when the sun comes up and
// what taking off would cost now.
export function siteScan(e) {
  const site = bodySite(e), d = Hazards.daylight(site, simTime);
  const goods = [...new Set(site.deposits.map(([k]) => goodName(k)))].join(', ');
  const sun = !hotDay(site) ? '' : d.day ? ' · Day side now' : ` · Sunrise in ${mmss(d.in)}`;
  const tone = site.tag === 'Mild' || site.dungeon ? 'good' : site.rad >= 1 || site.heat > Hazards.config.heat.cool ? 'hostile' : 'warn';
  return { tag: site.tag, tone, detail: `${site.hazard} · Deposits: ${goods} · Yield ×${site.rich}${sun} · Take-off ${takeoffNeed(site)} fuel` };
}

const holdFill = () => (SHIP.cargo ? cargo.items.length / SHIP.cargo : 0);
export const takeoffNeed = (site = surfaceRun.site) => (hazardsOn ? Hazards.takeoffFuel(site.gravity, holdFill()) : 0);
// A landing site with its hazards taken off (the hazards switched off: game/hazards.js).
const calmSite = (site) => ({ ...site, heat: 0, day: 0, rad: 0, fuelBurn: 1, dust: false, vents: false, pockets: false });

// How close (x, y) is to the site's hazards, the vents or storm pockets: 1 by one, 0 away from them.
function hazardNear(W, site, x, y) {
  if (!site.vents && !site.pockets) return 0;
  let k = 0;
  for (const p of ArtSurface.propsNear(W, x, y)) {
    if (site.vents ? p.type !== 'hole' || !p.emit : p.type !== 'tall') continue;
    k = Math.max(k, clamp(1 - (Math.hypot(x - p.x, y - p.y) - p.r - HAZARD_NEAR[0]) / (HAZARD_NEAR[1] - HAZARD_NEAR[0]), 0, 1));
  }
  return k;
}

// The ship set down on a body's surface W (game/landing.js): a fresh field of nodes.
export function enterSurface(e, W) {
  // Nodes round the landing site, or all through a labyrinth (the landing spot kept clear).
  const site = bodySite(e), T = ArtSurface.T, [i0, j0, i1, j1] = W.site ? W.site.rect : W.dungeon.area;
  const field = nextField.value ?? Math.floor(Math.random() * 1e9);
  nextField.value = null;
  const ok = (x, y, r) => ArtSurface.siteDist(W, x, y) < -T && ArtSurface.open(W, x, y, r + 10);
  const near = site.vents || site.pockets ? (x, y) => hazardNear(W, site, x, y) : undefined;
  const found = Mining.deposits(e.body.seed, site, { x0: (i0 + 1) * T, y0: (j0 + 1) * T, x1: (i1 - 1) * T, y1: (j1 - 1) * T, start: W.start, ok, near, field });
  // The vents and storm pockets, each with its own rhythm (seeded by the body and where it is); a
  // strike already on as the ship lands doesn't hit it.
  const s0 = seedToInt(e.body.seed), props = site.vents || site.pockets ? ArtSurface.propsAll(W) : [];
  const seeded = (p) => ({ ...p, seed: hashInt(Math.round(p.x), Math.round(p.y), s0) });
  const vents = site.vents ? props.filter((p) => p.type === 'hole' && p.emit).map(seeded) : [];
  const pockets = site.pockets ? props.filter((p) => p.type === 'tall').map(seeded) : [];
  const struck = new Map(pockets.map((p, k) => { const st = Hazards.strike(p, simTime); return [k, st.phase === 'on' ? st.n : st.n - 1]; }));
  Object.assign(surfaceRun, {
    e, W, site, field, exp: null, burn: 0, said: new Set(), vents, pockets, blast: 0, struck, bolts: [], warn: null,
    deposits: found.map((d) => ({
      kind: 'deposit', surface: true, key: `${e.key}:deposit:${field}:${d.i}`, i: d.i, x: d.x, y: d.y, radius: d.r, material: d.material, rich: d.rich,
      good: d.kind, name: `${d.rich ? 'Rich ' : ''}${goodName(d.kind)} ${d.material === 'gas' ? 'pocket' : 'node'}`, color: goodColor(d.kind), edge: goodColor(d.kind, 0.78),
    })),
  });
  if (W.dungeon) enterDungeon(W, e, field); else dungeonRun.W = null;
  landSquad(W); // the squad comes down with you (game/surface-squad.js)
  const rich = surfaceRun.deposits.filter((d) => d.rich).length;
  notify(`${site.label} · ${site.hazard} · ${surfaceRun.deposits.length} nodes${rich ? `, ${rich} rich` : ''} · yield ×${site.rich}`, 3.5, { tone: site.tag === 'Mild' ? 'info' : 'warn' });
}

// Off the surface (taking off): mining stops, and the buttons go.
export function leaveSurface() {
  endExtraction();
  selectOnSurface(null);
  endSurfaceFight(); // taking off from a dungeon's fight leaves its guardians behind
  setMode('short-fuel', false);
  setMode('stranded', false);
  surfaceRun.e = null;
  surfaceRun.exp = null;
  dungeonRun.W = null;
  dungeonRun.guards = [];
  liftSquad();
}

// ---------- Each step on the surface ----------

// The vents close by (lava): 1 right over one, fading out ventReach past its rim.
function ventNear(C) {
  if (!surfaceRun.site.vents) return 0;
  const S = Hazards.config.surface;
  let k = 0;
  for (const p of ArtSurface.propsNear(surfaceRun.W, C.x, C.y)) {
    if (p.type !== 'hole' || !p.emit) continue;
    k = Math.max(k, clamp(1 - (Math.hypot(C.x - p.x, C.y - p.y) - p.r) / S.ventReach, 0, 1));
  }
  return k;
}
// Touching a storm pocket (gas giants): within pocketReach of one.
function inPocket(C) {
  if (!surfaceRun.site.pockets) return false;
  const reach = Hazards.config.surface.pocketReach + SHIP.radius;
  return ArtSurface.propsNear(surfaceRun.W, C.x, C.y).some((p) => p.type === 'tall' && Math.hypot(C.x - p.x, C.y - p.y) < p.r + reach);
}
// Said once a landing.
function once(key, text, tone = 'warn') {
  if (surfaceRun.said.has(key)) return;
  surfaceRun.said.add(key);
  notify(text, 3, { tone });
  Feedback.emit('hazard');
}

// A dust storm's wind now ([x, y], surface units a second), which carries the ship along whatever
// its engine does (game/landing.js fly), or null.
export const surfaceWind = () => (surfaceRun.e && surfaceRun.exp?.dust ? surfaceRun.exp.dust.wind : null);

// Where the ship is from the landing spot (surface units): the day and the dust move over the
// ground, so they depend on it (rules/hazards.js daylight, dust).
export const sitePos = () => (surfaceRun.W ? [landing.craft.x - surfaceRun.W.start[0], landing.craft.y - surfaceRun.W.start[1]] : [0, 0]);
// A way as a compass point (north is up the screen).
const COMPASS = ['E', 'NE', 'N', 'NW', 'W', 'SW', 'S', 'SE'];
const compass = ([x, y]) => COMPASS[((Math.round(Math.atan2(-y, x) / (Math.PI / 4)) % 8) + 8) % 8];
const along = (dir, [x, y]) => dir[0] * x + dir[1] * y;
// The dust front coming (or over the ship): { f (Hazards.dustFront), eta (s until its edge gets
// here; 0 inside), clear (s until it has passed) } or null.
function frontHere() {
  const f = Hazards.dustFront(surfaceRun.site, simTime);
  if (!f) return null;
  const q = along(f.dir, sitePos());
  if (q < f.lead - f.width) return null; // passed
  return { f, eta: Math.max(0, (q - f.lead) / f.speed), clear: (q - f.lead + f.width) / f.speed };
}

// The nearest night from the day side: ahead of the sunrise line (flying the way the light moves)
// or back past the sunset line; { way (a compass point), secs (at full surface speed) }.
function nightWay() {
  const s = Hazards.sun(surfaceRun.site, simTime), D = Hazards.config.surface.day, q = along(s.dir, sitePos());
  const band = D.period * D.sweep, m = Math.floor((q - s.set) / band), rise = s.rise + m * band, set = s.set + m * band;
  const v = SHIP.maxSpeed * SURFACE_SPEED, ahead = (rise - q) / Math.max(1, v - D.sweep), back = (q - set) / (v + D.sweep);
  return ahead <= back ? { way: compass(s.dir), secs: ahead } : { way: compass([-s.dir[0], -s.dir[1]]), secs: back };
}

// A step on the surface, after the ship has flown (game/landing.js fly).
export function tickSurface(dt) {
  if (!surfaceRun.e || landing.wrecked) return;
  const C = landing.craft, site = surfaceRun.site, H = Hazards.config;
  skipTime(dt); // flight time runs on: the day comes round, the system moves on
  tickShield(dt);
  for (let i = debris.length - 1; i >= 0; i--) {
    const p = debris[i];
    p.life -= dt;
    if (p.life <= 0) { debris.splice(i, 1); continue; }
    p.x += p.vx * dt;
    p.y += p.vy * dt;
  }
  // The meters: heat (the day side, vents, thrust) and radiation. (Fuel goes on dashes and taking off.)
  const vent = ventNear(C), before = surfaceRun.exp;
  const exp = surfaceRun.exp = Hazards.surfaceExposure(site, simTime, { thrust: C.thrust, vent, at: sitePos() });
  hazard.heat = clamp(hazard.heat + (exp.heat - Hazards.shed(SHIP)) * dt, 0, H.max);
  cargo.rad = Math.min(H.max, cargo.rad + Hazards.radTaken(exp.rad, SHIP) * dt);
  if (!hazardsOn) { hazard.heat = 0; cargo.rad = 0; }
  if (inPocket(C) && !dashSafe()) { // dashing through one does no harm (game/dash.js)
    surfaceRun.burn += H.surface.pocket * dt;
    once('pocket', 'Storm pocket · it burns the hull: keep clear', 'hostile');
    if (surfaceRun.burn >= 1) { const n = Math.floor(surfaceRun.burn); surfaceRun.burn -= n; hurtShip(n); }
    if (!surfaceRun.e) return; // the hull gave out: lost here (lostOnSurface)
  } else surfaceRun.burn = 0;
  if (!tickBursts(C, dt)) return; // the hull gave out: lost here
  // Notices: the sun coming up, a dust storm, a vent.
  const d = exp.day;
  if (hotDay(site)) {
    if (!d.day && d.in <= 30 && (!before || before.day.in > 30)) { notify(`Sunrise in ${Math.ceil(d.in)} s · heat climbs fast by day`, 3.5, { tone: 'warn' }); Feedback.emit('hazard'); }
    if (d.day && before && !before.day.day) { notify(`Sunrise · the day side: take off, or fly ${nightWay().way} to find the night`, 3, { tone: 'hostile' }); Feedback.emit('hazard'); }
  }
  const front = frontHere();
  if (front && front.eta > 0 && front.eta <= 15 && !surfaceRun.said.has(`front:${front.f.n}`)) {
    surfaceRun.said.add(`front:${front.f.n}`);
    notify(`Dust front from the ${compass([-front.f.dir[0], -front.f.dir[1]])} in ${Math.ceil(front.eta)} s · the wind will push the ship`, 3.5, { tone: 'warn' });
    Feedback.emit('hazard');
  }
  if (exp.dust && !before?.dust) { notify('Dust storm · the wind pushes the ship, and you can see less', 3, { tone: 'warn' }); Feedback.emit('hazard'); }
  if (vent > 0.5) once('vent', 'Over a hot vent · it heats the ship');
  trackMeters(dt);
  meterWarnings();
  tickDungeon(C); // charting a labyrinth, and its chambers found
  tickGuardians(C, dt); // its guardians waking as the ship comes near (game/dungeon.js)
  tickSurfaceSquad(dt); // the squad following the ship over the ground (game/surface-squad.js)
  tickMining(dt); // the node the tools were set on, worked (space's update, which ticks it there, doesn't run here)
  tickFight(dt); // a dungeon's fight (and the effects of it)
  // Take off: short of fuel for it, Jettison or Call a tow (their buttons).
  const short = cargo.fuel + 1e-6 < takeoffNeed(), stranded = hazardsOn && cargo.fuel + 1e-6 < Hazards.takeoffFuel(site.gravity, 0);
  setMode('short-fuel', short && !stranded && cargo.items.length > 0);
  setMode('stranded', stranded);
  if (hazard.heat >= H.max) lostOnSurface('Overheated');
  else if (cargo.rad >= H.max) lostOnSurface('Radiation overload');
}

// The bursts (rules/hazards.js pulse): vents erupting near the ship heat it and blast its hull, and
// lightning hits it inside a strike's ring; mid-dash neither does (game/dash.js). Notes what's
// coming where the ship is (surfaceRun.warn). False when the hull gave out.
function tickBursts(C, dt) {
  const H = Hazards.config, E = H.surface.erupt, S = H.surface.strike;
  let erupting = false, warn = null;
  for (const v of surfaceRun.vents) {
    if (Math.hypot(C.x - v.x, C.y - v.y) - v.r > E.reach) continue;
    const ph = Hazards.eruption(v, simTime).phase;
    if (ph === 'on') erupting = true;
    else if (ph === 'warning') warn = 'vent';
  }
  if (erupting && !dashSafe()) {
    hazard.heat = clamp(hazard.heat + E.heat * dt, 0, H.max);
    surfaceRun.blast += E.hull * dt;
    once('erupt', 'A vent erupted · keep clear of the glow, or dash through', 'hostile');
    if (surfaceRun.blast >= 1) { const n = Math.floor(surfaceRun.blast); surfaceRun.blast -= n; hurtShip(n); }
    if (!surfaceRun.e) return false;
  } else if (!erupting) surfaceRun.blast = 0;
  const reach = S.r + SHIP.radius * 0.85;
  for (let k = 0; k < surfaceRun.pockets.length; k++) {
    const p = surfaceRun.pockets[k];
    if (Math.hypot(C.x - p.x, C.y - p.y) > p.r + S.to + reach) continue;
    const st = Hazards.strike(p, simTime), inside = Math.hypot(C.x - st.at[0], C.y - st.at[1]) < reach;
    if (st.phase === 'warning' && inside) warn = 'strike';
    if (st.phase !== 'on' || surfaceRun.struck.get(k) === st.n) continue;
    surfaceRun.struck.set(k, st.n);
    surfaceRun.bolts.push({ x: st.at[0], y: st.at[1], t: BOLT });
    if (inside && !dashSafe()) {
      notify('Lightning strike · hull hit', 2, { tone: 'hostile' });
      hurtShip(S.hull);
      if (!surfaceRun.e) return false;
    }
  }
  for (let i = surfaceRun.bolts.length - 1; i >= 0; i--) if ((surfaceRun.bolts[i].t -= dt) <= 0) surfaceRun.bolts.splice(i, 1);
  if (warn === 'vent') once('vent-warn', 'A vent is about to erupt · the glow comes first: get clear, or dash');
  if (warn === 'strike') once('strike-warn', 'Lightning marks its spot with a ring · get out of it, or dash');
  surfaceRun.warn = warn;
  return true;
}

// What lies on this surface under a point of the ground: the nearest whose icon (DROP_PX across on
// the screen) is under it, give or take a finger's width.
// A stack of the same goods (game/draw-world.js stackDrops) is taken by its top one.
export function surfaceDropAt([x, y]) {
  const list = surfaceRun.e && cargo.surfaceDrops[surfaceRun.e.key];
  if (!list) return null;
  const reach = (DROP_PX / 2 + 8) / landedZoom();
  let best = null, bd = Infinity;
  for (const it of list) {
    if (surfaceStackOf(it)[0] !== it) continue;
    const d = Math.hypot(it.x - x, it.y - y);
    if (d < reach && d < bd) { best = it; bd = d; }
  }
  return best;
}
// The stacks lying here, from the last frame drawn (drawSurfaceRun): a drop's stack, the top one
// first, or just itself.
let surfaceStacks = new WeakMap();
export const surfaceStackOf = (it) => surfaceStacks.get(it) || [it];
// One of them dragged onto the ship (game/input.js; at (x, y) on the ground when let go): picked
// up, trade goods while the hold has room, salvage into its store; anywhere else it stays where it
// was let go.
export const onCraft = (x, y) => Math.hypot(x - landing.craft.x, y - landing.craft.y) <= SHIP.radius + PICKUP + DROP_PX / 2 / landedZoom();
export function dropOnCraft(it) {
  const list = surfaceRun.e && cargo.surfaceDrops[surfaceRun.e.key], i = list ? list.indexOf(it) : -1;
  if (i < 0) return false;
  const component = Goods.isSalvage(it.kind);
  if (!component && cargo.items.length >= SHIP.cargo) { notify('Hold full', 2.5, { tone: 'warn' }); return false; }
  list.splice(i, 1);
  if (component) addTo(cargo.components, it.kind);
  else cargo.items.push({ kind: it.kind, label: goodName(it.kind), category: 'trade' });
  notify(`Recovered: ${goodName(it.kind)}`, 1.5);
  if (surfaceSel.it === it) selectOnSurface(null);
  if (!list.length) delete cargo.surfaceDrops[surfaceRun.e.key];
  saveCargo();
  return true;
}

// ---------- Selection: a tap on a node or on something lying there ----------

// What's selected (a deposit or a drop): its context menu (ui/context.js) round it, as in space.
// A deposit's offers Mine (busy, a ring filling, while it's worked); a drop's has no buttons, it's
// dragged onto the ship.
export const surfaceSel = { it: null };
export function selectOnSurface(x) {
  surfaceSel.it = x || null;
  if (!x) ContextCard.hide();
}
const isDeposit = (x) => !!x && x.kind === 'deposit';
// The gap from the ship's hull to a node's edge, and whether the tools reach it.
const gapTo = (d) => Math.hypot(d.x - landing.craft.x, d.y - landing.craft.y) - d.radius;
export const inMineReach = (d) => gapTo(d) <= mineReach() + REACH;
export function mineState(d) {
  if (mine.target === d) {
    const k = Math.min(1, mine.t / mine.total);
    return { id: 'mine', label: `Mining · ${Math.round(100 * k)}%`, enabled: false, busy: true, progress: k };
  }
  if (hold.free < 1) return { id: 'mine', label: 'Mine · hold full', enabled: false };
  if (!inMineReach(d)) return { id: 'mine', label: 'Mine · too far, fly closer', enabled: false };
  return { id: 'mine', label: 'Mine', enabled: true };
}
function selCard(x) {
  const n = isDeposit(x) ? 1 : surfaceStackOf(x).length; // a stack: how many
  if (!isDeposit(x)) return { title: n > 1 ? `${goodName(x.kind)} ×${n}` : goodName(x.kind), subtitle: 'Drag it onto the ship to pick it up', color: COLORS.amber, actions: [] };
  return { title: x.name, subtitle: `${goodName(x.good)} · ${Format.dist(Math.max(0, gapTo(x)))}`, tag: x.rich ? 'Rich' : '', color: x.color, actions: [mineState(x)] };
}
// Still there? (A node worked out, a drop picked up: the selection goes.)
function selGone(x) {
  if (isDeposit(x)) return !surfaceRun.deposits.includes(x);
  return !(cargo.surfaceDrops[surfaceRun.e.key] || []).includes(x);
}
// A context menu button pressed while on the surface (game/selection.js): true if it was ours.
export function surfaceAction(id) {
  if (landing.phase !== 'surface' || !surfaceSel.it) return false;
  if (id === 'mine' && isDeposit(surfaceSel.it)) mineDeposit(surfaceSel.it);
  return true;
}

// Leave things lying on this surface, scattered round (x, y): [kind], keyed by tag.
export function leave(kinds, x, y, tag, spread = 30) {
  const list = (cargo.surfaceDrops[surfaceRun.e.key] ||= []);
  kinds.forEach((kind, n) => {
    const a = (n / Math.max(1, kinds.length)) * TAU + Math.random() * 0.5, r = kinds.length > 1 ? spread * (0.5 + Math.random() * 0.5) : 0;
    list.push({ key: `${tag}:${n}`, kind, x: Math.round(x + Math.cos(a) * r), y: Math.round(y + Math.sin(a) * r) });
  });
  return list.slice(-kinds.length);
}

// ---------- Deposits ----------

// Whether the ship is out on a hot day side now (a node broken there gives a unit more).
const exposed = () => !!(surfaceRun.exp?.day.day && hotDay(surfaceRun.site));

// A node worn down to nothing (game/mining.js rockBroken): gone, and what it held thrown out round
// where it was, to be pulled in.
export function depositBroken(dep) {
  if (!surfaceRun.e) return;
  surfaceRun.deposits = surfaceRun.deposits.filter((d) => d !== dep);
  if (surfaceSel.it === dep) selectOnSurface(null);
  chips(dep, 8 + Math.round(dep.radius * 0.6), 100 + dep.radius * 3);
  const got = Mining.depositYield(surfaceRun.e.body.seed, { i: dep.i, kind: dep.good, rich: dep.rich, field: surfaceRun.field }, { exposed: exposed() });
  leave(got.map((g) => g.kind), dep.x, dep.y, `deposit:${dep.key}`, dep.radius + 16);
  notify(`${dep.name} · ${got.length} × ${goodName(dep.good)}${exposed() ? ' (day side +1)' : ''}`, 1.5);
  Feedback.emit('mined');
  saveCargo();
}

// The deposit under a point of the screen (CSS px), if any: the nearest within its size and a
// finger's width.
export function depositAt(at) {
  let best = null, bd = Infinity;
  for (const d of surfaceRun.deposits) {
    const g = Math.hypot(at[0] - d.x, at[1] - d.y);
    if (g < d.radius + 40 && g < bd) { best = d; bd = g; }
  }
  return best;
}
// Set the tools on a deposit (or switch to it): the Mine button, or E. Only within reach.
export function mineDeposit(d) {
  if (!d || landing.phase !== 'surface' || landing.wrecked || mine.target === d) return;
  const st = mineState(d);
  if (!st.enabled) { notify(st.label, 2, { tone: 'warn' }); return; }
  extract(d);
}
// E: the selected node, or else the nearest within reach.
export function mineNearest() {
  if (isDeposit(surfaceSel.it)) { mineDeposit(surfaceSel.it); return; }
  const d = surfaceRun.deposits.filter((x) => x !== mine.target).sort((a, b) => gapTo(a) - gapTo(b))[0];
  if (d && inMineReach(d)) { selectOnSurface(d); mineDeposit(d); }
  else if (!d || !mine.target) notify(d ? 'No node in range · fly closer' : 'No nodes left here', 2, { tone: 'warn' });
}

// ---------- Taking off, jettisoning, a tow ----------

// The fuel to take off, taken: false (and why, as a notice) without enough.
export function payTakeoff() {
  const need = takeoffNeed();
  if (cargo.fuel + 1e-6 < need) {
    const what = cargo.items.length && cargo.fuel + 1e-6 >= Hazards.takeoffFuel(surfaceRun.site.gravity, 0) ? 'jettison cargo to lighten the ship' : 'call a tow';
    notify(`Not enough fuel to take off · ${need} needed, ${Math.floor(cargo.fuel * 10) / 10} aboard · ${what}`, 3.5, { tone: 'hostile' });
    Feedback.emit('hazard');
    return false;
  }
  cargo.fuel = Math.max(0, cargo.fuel - need);
  saveCargo();
  return true;
}

// Jettison: the cheapest cargo first, until what's left can take off (or all of it); left lying
// here as a cache to come back for.
export function jettison() {
  if (!surfaceRun.e || !cargo.items.length) return;
  const C = landing.craft, out = [];
  const order = cargo.items.map((it, i) => [i, Goods.type(it.kind)?.price || 0]).sort((a, b) => a[1] - b[1]).map(([i]) => cargo.items[i]);
  for (const it of order) {
    if (cargo.fuel + 1e-6 >= takeoffNeed()) break;
    cargo.items.splice(cargo.items.indexOf(it), 1);
    out.push(it.kind);
  }
  if (!out.length) return;
  leave(out, C.x - Math.cos(C.angle) * 30, C.y - Math.sin(C.angle) * 30, `jettison:${Date.now().toString(36)}`, 24);
  notify(`Jettisoned ${out.length} × cargo · it waits here for you`, 3);
  saveCargo();
}

// Lost on the surface (a meter full, the hull gone, a tow called): the hold stays here, and the
// ship climbs out to be towed home (game/landing.js finish, game/combat.js wreck).
export function lostOnSurface(reason) {
  if (!surfaceRun.e || landing.wrecked) return;
  endExtraction();
  const C = landing.craft;
  if (cargo.items.length) leave(cargo.items.map((it) => it.kind), C.x, C.y, `lost:${Date.now().toString(36)}`, 40);
  cargo.items = [];
  saveCargo();
  landing.wrecked = reason;
  takeOff();
}
export const callTow = () => lostOnSurface('Stranded');

// ---------- Drawing ----------

// On the ground (drawn with the view's transform: v the landed view, units of it): the deposits,
// what lies about and the debris; then in screen px: the tools' field of fire, beams, the lock's
// brackets and damage numbers. Over it all: the dust of a storm, and the day side's glare.
export function drawSurfaceRun(v, zoom, dpr, time) {
  if (!surfaceRun.e) return;
  const at = (x, y, z = 0) => SurfaceGlobe.toScreen(v, x, y, z);
  ctx.save();
  ctx.setTransform(dpr * zoom, 0, 0, dpr * zoom, 0, 0);
  drawMovingWeather(at);
  drawBursts(at, v.ct, time);
  for (const d of surfaceRun.deposits) {
    const p = at(d.x, d.y);
    if (p) drawDeposit(d, p, v.ct, time);
  }
  const drops = cargo.surfaceDrops[surfaceRun.e.key] || [];
  surfaceStacks = stackDrops(drops, (it) => it.kind, STACK_PX / zoom); // the same goods lying together: one stack
  for (const it of drops) { // as their icons (game/draw-world.js)
    const st = surfaceStackOf(it);
    if (st[0] !== it) continue; // under the top of its stack
    const p = at(it.x, it.y);
    if (p) drawDrop(ctx, it.kind, p[0], p[1], zoom, dropColor(it), surfaceSel.it === it, { count: st.length, name: goodName(it.kind) });
  }
  for (const b of debris) {
    const p = at(b.x, b.y, 4);
    if (!p) continue;
    ctx.globalAlpha = Math.min(1, (b.life / b.max) * 1.5);
    ctx.fillStyle = b.color;
    ctx.fillRect(p[0] - b.size / 2, p[1] - b.size / 2, b.size, b.size);
  }
  ctx.restore();
  // In screen px.
  const scr = (x, y, z = 0) => { const p = at(x, y, z); return p && [p[0] * zoom, p[1] * zoom]; };
  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  // The deposit being worked: a ring round it filling as the work goes, and the beam from the ship.
  const dep = mine.target && mine.target.surface ? mine.target : null, p = dep && scr(dep.x, dep.y);
  if (p) {
    const C = landing.craft, q = scr(C.x, C.y, ArtSurface.FLY);
    if (q && Math.hypot(dep.x - C.x, dep.y - C.y) - dep.radius <= mineReach() + 120) {
      ctx.strokeStyle = COLORS.busy;
      ctx.globalAlpha = 0.35 + 0.25 * Math.sin(performance.now() / 70);
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(q[0], q[1]); ctx.lineTo(p[0], p[1]); ctx.stroke();
    }
    drawRing(p[0], p[1], dep.radius * zoom + 10, Math.min(1, mine.t / mine.total), 3);
  }
  // The selection: a node or a drop ringed, its context menu round it.
  const sel = surfaceSel.it;
  if (sel && selGone(sel)) selectOnSurface(null);
  else if (sel) {
    const q = scr(sel.x, sel.y), r = isDeposit(sel) ? sel.radius * zoom + 16 : DROP_PX / 2 + 6;
    if (q) { // (a drop too: it has no ring of its own)
      ctx.strokeStyle = COLORS.cyan;
      ctx.globalAlpha = 0.7 + 0.25 * Math.sin(time * 4);
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 5]);
      ctx.beginPath(); ctx.arc(q[0], q[1], r, 0, TAU); ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }
    ContextCard.show(selCard(sel));
    if (q) ContextCard.place(q[0], q[1], r);
  }
  ctx.restore();
}

// A fight down here is drawn as one in space is (game/combat.js): gauges, intents, the target,
// beams and numbers; over the ships (game/landing.js draws it after them).
export function drawSurfaceFight(v, zoom, dpr) {
  const V = { at: (x, y) => { const p = SurfaceGlobe.toScreen(v, x, y, ArtSurface.FLY); return p && [p[0] * zoom, p[1] * zoom]; }, k: () => zoom };
  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  drawFight(V);
  drawFightOverlay(V);
  ctx.restore();
}

// The day and the dust as they move over the ground near the ship: the lit band (on a world whose
// day is hot), its sunrise line bright; the dust front's band, its leading edge marked.
const WEATHER_VIEW = 3000; // drawn this far round the ship
function drawMovingWeather(at) {
  const site = surfaceRun.site, [sx, sy] = surfaceRun.W.start, P = sitePos();
  // The band from q0 to q1 along dir (from the landing spot), as wide as the view, and its edge at q1.
  const band = (dir, q0, q1, fill, edge, w = 2.5) => {
    const qs = along(dir, P), a = Math.max(q0, qs - WEATHER_VIEW), b = Math.min(q1, qs + WEATHER_VIEW);
    if (a >= b) return;
    const n = [-dir[1], dir[0]], pn = along(n, P);
    const pt = (q, s) => at(sx + dir[0] * q + n[0] * (pn + s), sy + dir[1] * q + n[1] * (pn + s));
    const c = [pt(a, -WEATHER_VIEW), pt(b, -WEATHER_VIEW), pt(b, WEATHER_VIEW), pt(a, WEATHER_VIEW)];
    if (c.some((p) => !p)) return;
    ctx.beginPath();
    c.forEach((p, k) => (k ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
    ctx.closePath();
    ctx.fillStyle = fill[0]; ctx.globalAlpha = fill[1]; ctx.fill();
    if (b === q1) {
      ctx.beginPath(); ctx.moveTo(c[1][0], c[1][1]); ctx.lineTo(c[2][0], c[2][1]);
      ctx.strokeStyle = edge; ctx.globalAlpha = 0.8; ctx.lineWidth = w; ctx.stroke();
    }
  };
  if (hotDay(site)) {
    const s = Hazards.sun(site, simTime), D = Hazards.config.surface.day, rep = D.period * D.sweep;
    for (let m = -1; m <= 1; m++) band(s.dir, s.set + m * rep, s.rise + m * rep, [COLORS.flame, 0.12], COLORS.amber);
  }
  const f = Hazards.dustFront(site, simTime);
  if (f) band(f.dir, f.lead - f.width, f.lead, [DUST, 0.7], DUST_EDGE, 4);
  ctx.globalAlpha = 1;
}
const DUST = '#26170b', DUST_EDGE = '#e2aa72';

// The bursts on the ground near the ship: each vent's reach, faint while calm, glowing brighter as
// it's about to erupt and ablaze while it does; each strike's ring, a second ring closing in on it as
// the bolt comes; and the bolts just struck, from the sky to the ground.
const BURST_VIEW = 1100; // drawn this close to the ship
const BOLT = 0.6; // seconds a bolt is drawn
function drawBursts(at, ct, time) {
  const C = landing.craft, E = Hazards.config.surface.erupt, S = Hazards.config.surface.strike;
  const ring = (p, R, stroke, fill, alpha, w = 1.5) => {
    ctx.beginPath();
    ctx.ellipse(p[0], p[1], R, R * ct, 0, 0, TAU);
    if (fill) { ctx.fillStyle = fill; ctx.globalAlpha = alpha * 0.45; ctx.fill(); }
    ctx.strokeStyle = stroke; ctx.globalAlpha = alpha; ctx.lineWidth = w; ctx.stroke();
  };
  for (const v of surfaceRun.vents) {
    if (Math.hypot(v.x - C.x, v.y - C.y) > BURST_VIEW) continue;
    const p = at(v.x, v.y), ph = Hazards.eruption(v, simTime);
    if (!p) continue;
    const R = v.r + E.reach;
    if (ph.phase === 'on') { ring(p, R, COLORS.flash, COLORS.flame, 0.85 + 0.15 * Math.sin(time * 30), 3); continue; }
    if (ph.phase === 'calm') { ctx.setLineDash([6, 8]); ring(p, R, COLORS.amber, null, 0.12); ctx.setLineDash([]); continue; }
    const k = 1 - ph.in / E.warn; // warning: the reach lit, a ring closing in on the vent as it comes
    ring(p, R, COLORS.amber, null, 0.45 + 0.3 * Math.sin(time * 18), 2);
    ring(p, v.r + E.reach * (1 - k), COLORS.flame, null, 0.8, 2);
  }
  for (const pk of surfaceRun.pockets) {
    if (Math.hypot(pk.x - C.x, pk.y - C.y) > BURST_VIEW) continue;
    const st = Hazards.strike(pk, simTime);
    if (st.phase !== 'warning') continue;
    const p = at(st.at[0], st.at[1]), k = 1 - st.in / S.warn;
    if (!p) continue;
    ring(p, S.r, COLORS.hostile, COLORS.hostile, 0.35 + 0.4 * k, 2);
    ring(p, S.r * (1 - k) + 2, COLORS.flash, null, 0.6);
  }
  for (const b of surfaceRun.bolts) {
    const p = at(b.x, b.y);
    if (!p) continue;
    const k = b.t / BOLT;
    ring(p, S.r, COLORS.flash, COLORS.flash, 0.7 * k, 2);
    ctx.strokeStyle = COLORS.flash;
    ctx.globalAlpha = k;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(p[0], p[1]);
    for (let s = 1; s <= 6; s++) ctx.lineTo(p[0] + Math.sin(b.x + s * 2.3) * 14, p[1] - s * 45);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

// A deposit: a cluster of crystals (or, siphoned from a gas giant's cloud deck, a swirl) in its
// good's colour, edged light, on a dark patch of ground ringed in the light colour, glinting.
function drawDeposit(d, [x, y], ct, time) {
  const r = d.radius, glint = 0.5 + 0.5 * Math.sin(time * 2 + d.i * 1.7);
  if (d.rich) { // a rich node: a pulsing halo in the warning colour
    ctx.fillStyle = COLORS.amber;
    ctx.globalAlpha = 0.12 + 0.12 * Math.sin(time * 4 + d.i);
    ctx.beginPath();
    ctx.ellipse(x, y, r * 2, r * 2 * ct, 0, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  ctx.fillStyle = 'rgba(0, 0, 0, 0.32)';
  ctx.beginPath();
  ctx.ellipse(x, y, r * 1.15, r * 1.15 * ct, 0, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = d.edge;
  ctx.lineWidth = 1.5;
  ctx.globalAlpha = 0.45 + 0.3 * glint;
  ctx.setLineDash([4, 3]);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;
  ctx.strokeStyle = d.color;
  ctx.fillStyle = d.color;
  if (d.material === 'gas') {
    ctx.lineWidth = 2;
    for (let k = 0; k < 3; k++) {
      ctx.globalAlpha = 0.35 + 0.2 * k;
      ctx.beginPath();
      ctx.ellipse(x, y, r * (0.4 + 0.25 * k), r * (0.4 + 0.25 * k) * ct, time * (0.6 + k * 0.3), 0, TAU * 0.7);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    return;
  }
  ctx.lineWidth = 1;
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * TAU + d.i, ox = Math.cos(a) * r * 0.45, oy = Math.sin(a) * r * 0.45 * ct, h = r * (0.7 + 0.25 * ((k * 7 + d.i) % 3)), w = r * 0.22;
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    ctx.moveTo(x + ox - w, y + oy);
    ctx.lineTo(x + ox - w * 0.4, y + oy - h * 0.8);
    ctx.lineTo(x + ox + w * 0.2, y + oy - h);
    ctx.lineTo(x + ox + w, y + oy);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 0.9;
    ctx.strokeStyle = d.edge;
    ctx.stroke();
  }
  ctx.globalAlpha = 0.3 + 0.5 * glint;
  ctx.fillStyle = COLORS.flash;
  ctx.fillRect(x - 1.5, y - r * 0.8 - 1.5, 3, 3);
  ctx.globalAlpha = 1;
}

// Over the whole surface view (screen px), inside a dust storm: its murk, streaked the way the wind
// blows. (The day's light and the front coming are drawn on the ground: drawMovingWeather.)
export function drawSurfaceWeather(w, h, time) {
  const exp = surfaceRun.exp;
  if (!exp) return;
  ctx.save();
  if (exp.dust) {
    // Thin round the ship (a little below the middle of the screen), thick further out.
    const cx = w / 2, cy = h * 0.6, near = Math.min(w, h) * 0.18, far = Math.max(w, h) * 0.6;
    const murk = ctx.createRadialGradient(cx, cy, near, cx, cy, far);
    murk.addColorStop(0, 'rgba(90, 58, 30, 0.2)');
    murk.addColorStop(0.45, 'rgba(70, 45, 24, 0.72)');
    murk.addColorStop(1, 'rgba(45, 28, 15, 0.95)');
    ctx.fillStyle = murk;
    ctx.globalAlpha = 1;
    ctx.fillRect(0, 0, w, h);
    const [wx, wy] = exp.dust.wind, a = Math.atan2(wy, wx), len = 60;
    ctx.strokeStyle = DUST_EDGE;
    ctx.globalAlpha = 0.35;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let k = 0; k < 40; k++) {
      const u = ((k * 0.618 + time * 0.9) % 1) * (w + 2 * len) - len, vv = ((k * 0.377) % 1) * h;
      ctx.moveTo(u, vv);
      ctx.lineTo(u + Math.cos(a) * len, vv + Math.sin(a) * len);
    }
    ctx.stroke();
  }
  ctx.restore();
}

// The HUD's lines about the surface: [text, colour].
export function surfaceLines() {
  const exp = surfaceRun.exp, site = surfaceRun.site;
  if (!exp || !site) return [];
  const out = [], d = exp.day;
  if (hotDay(site)) {
    const s = Hazards.sun(site, simTime);
    if (d.day) { const n = nightWay(); out.push([`DAY SIDE · HEAT CLIMBING · YIELD +1 · night ${Math.ceil(n.secs)} s to the ${n.way}`, COLORS.hostile]); }
    else out.push([`SUNRISE IN ${mmss(d.in)} · from the ${compass([-s.dir[0], -s.dir[1]])}`, d.in <= 30 ? COLORS.amber : COLORS.hud]);
  }
  const front = frontHere();
  if (exp.dust) out.push([`DUST STORM · pushed off course · clear in ${Math.ceil(front ? front.clear : 0)} s`, COLORS.amber]);
  else if (front && front.eta <= 20) out.push([`DUST FRONT IN ${Math.ceil(front.eta)} s · from the ${compass([-front.f.dir[0], -front.f.dir[1]])}`, COLORS.amber]);
  if (surfaceRun.warn === 'vent') out.push(['VENT ABOUT TO ERUPT · get clear or dash', COLORS.hostile]);
  if (surfaceRun.warn === 'strike') out.push(['LIGHTNING ABOUT TO STRIKE HERE · move or dash', COLORS.hostile]);
  const need = takeoffNeed();
  if (cargo.fuel + 1e-6 < need) out.push([`NOT ENOUGH FUEL TO TAKE OFF · ${need} needed`, COLORS.hostile]);
  if (hold.free < 1) out.push(['HOLD FULL · no mining', COLORS.amber]);
  if (site.dungeon) out.push(...dungeonLines());
  out.push([`${surfaceRun.deposits.length} node${surfaceRun.deposits.length === 1 ? '' : 's'} · hold ${cargo.items.length}/${SHIP.cargo} · yield ×${site.rich} · take-off ${need} fuel`, COLORS.hud]);
  return out;
}

// For the minimap: the deposits and what lies about, in surface units.
export const surfaceMarks = () => (surfaceRun.e ? [
  ...surfaceRun.deposits.map((d) => ({ x: d.x, y: d.y, color: d.color, r: 2.5 })),
  ...(cargo.surfaceDrops[surfaceRun.e.key] || []).map((it) => ({ x: it.x, y: it.y, color: COLORS.amber, r: 1.8 })),
] : []);

// Wiring, run once every module has loaded (src/main.js).
export function init() {
  document.getElementById('jettison-btn').addEventListener('click', jettison);
  document.getElementById('tow-btn').addEventListener('click', callTow);
  window.addEventListener('keydown', (e) => {
    if ((e.key === 'e' || e.key === 'E') && landing.phase === 'surface') mineNearest();
  });
}
