// The surface run (notes/hazards.md §6): what there is to do and to fear on a planet or moon once
// landed (game/landing.js flies the ship there).
// - Deposits (rules/mining.js deposits): many small nodes on open ground round the landing site,
//   each a unit of one of the body's goods, seeded afresh on every landing; more of them the more
//   dangerous the site (site.rich), gathered near its vents or storm pockets, where they're rich.
//   The ship's tools pick their own (game/mining.js autoMine) and wear them down by the same rules as
//   an asteroid in space: the same extraction session (game/combat.js extract), flown from the ship
//   over the ground. A tap (or E) picks one by hand. Broken up, a node leaves what it held lying
//   beside it, a unit more on a hot day side (notes/hazards.md phase 4).
// - What lies on the surface (cargo.surfaceDrops): a node's goods, cargo jettisoned and the hold
//   of a ship lost there. Flying near it pulls it in and picks it up.
// - Hazards (rules/hazards.js surface): the day side coming round (heat; the countdown to sunrise is
//   on the HUD), hot vents on the lava planet, dust storms on the desert, radiation on the moons, the
//   cold on the ice planet (fuel burns faster) and the storm pockets of the gas giants. The meters
//   are the ones in space (game/hazards.js); one that fills loses the ship here, and its hold stays
//   on the surface, to come back for.
// - Taking off costs fuel (Hazards.takeoffFuel), by gravity and how full the hold is. Short of it,
//   Take off is refused; Jettison leaves cargo behind until it's enough, and with not even enough for
//   an empty hold, Call a tow gives the ship up.
// - The scan before landing: what a planet's or moon's card says of its surface (siteScan).
// Flight time runs on while landed, so the day comes round and the system moves on.
// Part of the flight view; src/main.js starts it.

import { SurfaceGlobe } from '../art/surface-globe.js';
import { ArtSurface } from '../art/surface.js';
import { Feedback } from '../core/feedback.js';
import { COLORS, Theme } from '../core/theme.js';
import { RealtimeCombat } from '../combat/combat-realtime.js';
import { Goods } from '../rules/goods.js';
import { Hazards } from '../rules/hazards.js';
import { Mining } from '../rules/mining.js';
import { addTo, cargo, hold, saveCargo } from './cargo.js';
import { endExtraction, extract, extracting, focusOn, fxPos, hurtShip, tickFight, tickShield } from './combat.js';
import { hazard, meterWarnings, outOfFuel } from './hazards.js';
import { landing, takeOff } from './landing.js';
import { autoMine, chips } from './mining.js';
import { SHIP, TAU, clamp, ctx, debris, fight, notify, setMode } from './state.js';
import { simTime, skipTime } from './update.js';
import { world } from './world.js';

// e: the body landed on; W: its surface; site: what it does to a ship (Hazards.surface); field: this
// landing's (its nodes seeded by it); deposits: those not yet worked out, as extraction targets; exp:
// the last step's exposure; burn: storm-pocket
// damage still to take (whole points at a time); left: drops not to pick up again until the ship has
// moved off them (just jettisoned); said: notices given this landing.
export const surfaceRun = { e: null, W: null, site: null, field: 0, deposits: [], exp: null, burn: 0, left: new Set(), said: new Set() };
const PICKUP = 30; // surface units between the ship and something lying there to pick it up
const PULL = { range: 120, speed: 260 }; // what lies this close is pulled in, this much faster than the ship flies
const DEPOSIT_RANGE = 260; // E locks the nearest deposit within this of the ship's lock range
const AUTO_REACH = 240; // the tools pick a node on their own this close (fly to the next cluster)
const HAZARD_NEAR = [30, 110]; // nodes gather by a vent or storm pocket: in full this far past its rim, none past this
// The next landing's field, for the tests (tests/smoke.js): null picks one at random.
export const nextField = { value: null };

// ---------- The site ----------

// What a body's surface does to a ship (Hazards.surface), a moon's by its planet's type too.
export function bodySite(e) {
  const G = world.galaxy, moon = e.kind === 'moon' && G.moons.find((m) => m.name === e.key);
  return Hazards.surface(e.kind, e.body.type, e.body.seed, moon ? G.planets[moon.parent]?.type : undefined);
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
  const tone = site.tag === 'Mild' ? 'good' : site.rad >= 1 || site.heat > Hazards.config.heat.cool ? 'hostile' : 'warn';
  return { tag: site.tag, tone, detail: `${site.hazard} · Deposits: ${goods} · Yield ×${site.rich}${sun} · Take-off ${takeoffNeed(site)} fuel` };
}

const holdFill = () => (SHIP.cargo ? cargo.items.length / SHIP.cargo : 0);
const takeoffNeed = (site = surfaceRun.site) => Hazards.takeoffFuel(site.gravity, holdFill());

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
  const site = bodySite(e), T = ArtSurface.T, [i0, j0, i1, j1] = W.site.rect;
  const field = nextField.value ?? Math.floor(Math.random() * 1e9);
  nextField.value = null;
  const ok = (x, y, r) => ArtSurface.siteDist(W, x, y) < -T && ArtSurface.open(W, x, y, r + 10);
  const near = site.vents || site.pockets ? (x, y) => hazardNear(W, site, x, y) : undefined;
  const found = Mining.deposits(e.body.seed, site, { x0: (i0 + 1) * T, y0: (j0 + 1) * T, x1: (i1 - 1) * T, y1: (j1 - 1) * T, start: W.start, ok, near, field });
  Object.assign(surfaceRun, {
    e, W, site, field, exp: null, burn: 0, left: new Set(), said: new Set(),
    deposits: found.map((d) => ({
      kind: 'deposit', surface: true, key: `${e.key}:deposit:${field}:${d.i}`, i: d.i, x: d.x, y: d.y, radius: d.r, material: d.material, rich: d.rich,
      good: d.kind, name: `${d.rich ? 'Rich ' : ''}${goodName(d.kind)} ${d.material === 'gas' ? 'pocket' : 'node'}`, color: goodColor(d.kind), edge: goodColor(d.kind, 0.78),
    })),
  });
  const rich = surfaceRun.deposits.filter((d) => d.rich).length;
  notify(`${site.label} · ${site.hazard} · ${surfaceRun.deposits.length} nodes${rich ? `, ${rich} rich` : ''} · yield ×${site.rich}`, 3.5, { tone: site.tag === 'Mild' ? 'info' : 'warn' });
}

// Off the surface (taking off): mining stops, and the buttons go.
export function leaveSurface() {
  endExtraction();
  setMode('short-fuel', false);
  setMode('stranded', false);
  surfaceRun.e = null;
  surfaceRun.exp = null;
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
  // The meters: heat (the day side, vents, thrust), radiation, fuel (the cold burns more).
  const vent = ventNear(C), before = surfaceRun.exp;
  const exp = surfaceRun.exp = Hazards.surfaceExposure(site, simTime, { thrust: outOfFuel() ? 0 : C.thrust, vent });
  hazard.heat = clamp(hazard.heat + (exp.heat - H.heat.cool) * dt, 0, H.max);
  cargo.rad = Math.min(H.max, cargo.rad + exp.rad * dt);
  if (!outOfFuel()) cargo.fuel = Math.max(0, cargo.fuel - H.fuel.burn * site.fuelBurn * C.thrust * dt);
  if (inPocket(C)) {
    surfaceRun.burn += H.surface.pocket * dt;
    once('pocket', 'Storm pocket · it burns the hull: keep clear', 'hostile');
    if (surfaceRun.burn >= 1) { const n = Math.floor(surfaceRun.burn); surfaceRun.burn -= n; hurtShip(n); }
    if (!surfaceRun.e) return; // the hull gave out: lost here (lostOnSurface)
  } else surfaceRun.burn = 0;
  // Notices: the sun coming up, a dust storm, a vent.
  const d = exp.day;
  if (hotDay(site)) {
    if (!d.day && d.in <= 30 && (!before || before.day.in > 30)) { notify(`Sunrise in ${Math.ceil(d.in)} s · heat climbs fast by day`, 3.5, { tone: 'warn' }); Feedback.emit('hazard'); }
    if (d.day && before && !before.day.day) { notify('Sunrise · the day side: take off or find the night', 3, { tone: 'hostile' }); Feedback.emit('hazard'); }
  }
  if (exp.dust && !before?.dust) { notify('Dust storm · the wind pushes the ship, and you can see less', 3, { tone: 'warn' }); Feedback.emit('hazard'); }
  if (vent > 0.5) once('vent', 'Over a hot vent · it heats the ship');
  meterWarnings();
  pickUp(C, dt);
  autoMine(surfaceRun.deposits, true, AUTO_REACH); // the tools pick their next node (game/mining.js)
  tickFight(dt); // mining a deposit (and the effects of it)
  // Take off: short of fuel for it, Jettison or Call a tow (their buttons).
  const short = cargo.fuel + 1e-6 < takeoffNeed(), stranded = cargo.fuel + 1e-6 < Hazards.takeoffFuel(site.gravity, 0);
  setMode('short-fuel', short && !stranded && cargo.items.length > 0);
  setMode('stranded', stranded);
  if (hazard.heat >= H.max) lostOnSurface('Overheated');
  else if (cargo.rad >= H.max) lostOnSurface('Radiation overload');
}

// What lies on the surface, pulled in as the ship flies near it and picked up: trade goods while the
// hold has room (salvage into its store), as floating drops in space (game/cargo.js collectItems).
// Just jettisoned, it waits until the ship has moved off it.
function pickUp(C, dt = 0) {
  const list = cargo.surfaceDrops[surfaceRun.e.key];
  if (!list) return;
  let got = false;
  for (let i = list.length - 1; i >= 0; i--) {
    const it = list[i];
    let d = Math.hypot(C.x - it.x, C.y - it.y);
    if (surfaceRun.left.has(it.key)) { if (d > PICKUP * 3) surfaceRun.left.delete(it.key); continue; }
    const component = Goods.isSalvage(it.kind);
    if ((component || hold.free >= 1) && dt > 0 && d > 0 && d < PULL.range) {
      const step = Math.min(d, (Math.hypot(C.vx, C.vy) + PULL.speed) * dt);
      it.x += ((C.x - it.x) / d) * step;
      it.y += ((C.y - it.y) / d) * step;
      d -= step;
    }
    if (d >= PICKUP) continue;
    if (!component && cargo.items.length >= SHIP.cargo) { notify('Hold full', 2.5, { once: true, tone: 'warn' }); continue; }
    list.splice(i, 1);
    if (component) addTo(cargo.components, it.kind);
    else cargo.items.push({ kind: it.kind, label: goodName(it.kind), category: 'trade' });
    notify(`Recovered: ${goodName(it.kind)}`, 1.5);
    got = true;
  }
  if (!got) return;
  if (!list.length) delete cargo.surfaceDrops[surfaceRun.e.key];
  saveCargo();
}

// Leave things lying on this surface, scattered round (x, y): [kind], keyed by tag.
function leave(kinds, x, y, tag, spread = 30) {
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
// Lock the tools on a deposit: a new session, or another deposit joins the one under way.
export function mineDeposit(d) {
  if (!d || landing.phase !== 'surface' || landing.wrecked) return;
  if (extracting() && fight.ships.has(d.key)) { focusOn(d.key); return; }
  extract(d);
}
// E: the nearest deposit within reach of a lock.
export function mineNearest() {
  const C = landing.craft, reach = Math.max(0, SHIP.lockRange - DEPOSIT_RANGE);
  const d = surfaceRun.deposits.filter((x) => !fight.ships.has(x.key)).sort((a, b) => Math.hypot(a.x - C.x, a.y - C.y) - Math.hypot(b.x - C.x, b.y - C.y))[0];
  if (d && Math.hypot(d.x - C.x, d.y - C.y) - d.radius <= reach) mineDeposit(d);
  else if (!d || !extracting()) notify(d ? 'No node in range · fly closer' : 'No nodes left here', 2, { tone: 'warn' });
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
  for (const d of leave(out, C.x - Math.cos(C.angle) * 30, C.y - Math.sin(C.angle) * 30, `jettison:${Date.now().toString(36)}`, 24)) surfaceRun.left.add(d.key);
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
  for (const d of surfaceRun.deposits) {
    const p = at(d.x, d.y);
    if (p) drawDeposit(d, p, v.ct, time);
  }
  for (const it of cargo.surfaceDrops[surfaceRun.e.key] || []) {
    const p = at(it.x, it.y);
    if (!p) continue;
    const pulse = 0.5 + 0.5 * Math.sin(time * 3 + it.x);
    ctx.globalAlpha = 0.25 + 0.2 * pulse;
    ctx.fillStyle = COLORS.amber;
    ctx.beginPath();
    ctx.ellipse(p[0], p[1], 14, 14 * v.ct, 0, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = goodColor(it.kind);
    ctx.strokeStyle = COLORS.bg;
    ctx.lineWidth = 1;
    ctx.fillRect(p[0] - 4, p[1] - 4, 8, 8);
    ctx.strokeRect(p[0] - 4, p[1] - 4, 8, 8);
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
  drawFireField(scr);
  ctx.lineCap = 'round';
  for (const f of fight.fx) {
    if (f.delay > 0 || f.t === undefined || f.type !== 'beam') continue;
    const from = fxPos(f.from), to = fxPos(f.to);
    const a = from && scr(from.x, from.y, ArtSurface.FLY), b = to && scr(to.x, to.y, 2);
    if (!a || !b) continue;
    const k = f.t / f.max;
    ctx.strokeStyle = f.color;
    ctx.globalAlpha = k * (f.hits > 0 ? 0.3 : 0.12);
    ctx.lineWidth = 6;
    ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
    ctx.globalAlpha = k * (f.hits > 0 ? 0.95 : 0.35);
    ctx.lineWidth = 1.6;
    ctx.stroke();
  }
  // The lock: brackets closing in on the target as it comes on, its integrity under it.
  const s = fight.s, target = s && s.enemies.find((c) => c.id === s.focus && c.hull > 0), dep = target && surfaceRun.deposits.find((d) => d.key === target.id);
  const p = dep && scr(dep.x, dep.y);
  if (p) {
    const lock = s.locked ? 1 : Math.min(1, s.lockT / RealtimeCombat.lockTime(s)), R = (dep.radius * zoom + 10) * (1 + (1 - lock) * 0.9), arm = Math.min(R * 0.45, 14);
    ctx.strokeStyle = COLORS.hostile;
    ctx.globalAlpha = 0.5 + 0.35 * lock;
    ctx.lineWidth = 2;
    if (lock < 1) ctx.setLineDash([5, 4]);
    ctx.beginPath();
    for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      ctx.moveTo(p[0] + sx * R, p[1] + sy * (R - arm));
      ctx.lineTo(p[0] + sx * R, p[1] + sy * R);
      ctx.lineTo(p[0] + sx * (R - arm), p[1] + sy * R);
    }
    ctx.stroke();
    ctx.setLineDash([]);
    const w = 40, top = p[1] - R - 10;
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = 'rgba(38, 48, 74, 0.9)';
    ctx.fillRect(p[0] - w / 2, top, w, 3);
    ctx.fillStyle = COLORS.hostile;
    ctx.fillRect(p[0] - w / 2, top, w * (target.hull / target.stats.hull), 3);
  }
  ctx.font = Theme.font(12);
  ctx.textAlign = 'center';
  for (const f of fight.fx) {
    if (f.type !== 'number' || f.delay > 0) continue;
    const pos = fxPos(f.at), q = pos && scr(pos.x, pos.y, pos.player ? ArtSurface.FLY : 0);
    if (!q) continue;
    const k = f.t / f.max;
    ctx.globalAlpha = Math.min(1, k * 1.6);
    ctx.fillStyle = f.color;
    ctx.fillText(f.text, q[0] + 14 + (f.jx || 0), q[1] - 26 - (1 - k) * 26);
  }
  ctx.restore();
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

// The tool that works the target's material: its field of fire ahead of the ship, at flight height,
// brighter while the locked deposit is inside it.
function drawFireField(scr) {
  const s = fight.s;
  if (!s || !fight.extract) return;
  const t = s.enemies.find((c) => c.id === s.focus && c.hull > 0);
  const w = SHIP.weapons.find((x) => !x.vs || (x.vs[t?.material || 'rock'] ?? 1) > 0);
  if (!w) return;
  const C = landing.craft, half = w.arc >= 360 ? Math.PI : (w.arc * Math.PI) / 360, R = w.range + SHIP.radius, pts = [scr(C.x, C.y, ArtSurface.FLY)];
  for (let k = 0; k <= 24; k++) { const a = C.angle - half + (2 * half * k) / 24; pts.push(scr(C.x + Math.cos(a) * R, C.y + Math.sin(a) * R, ArtSurface.FLY)); }
  if (pts.some((q) => !q)) return;
  const dx = t ? t.x - C.x : 0, dy = t ? t.y - C.y : 0, d = Math.hypot(dx, dy);
  const live = t && s.locked && d - t.radius <= w.range && (w.arc >= 360 || Math.abs(Math.atan2(Math.sin(Math.atan2(dy, dx) - C.angle), Math.cos(Math.atan2(dy, dx) - C.angle))) <= half + Math.atan2(t.radius, Math.max(d, 1)));
  ctx.beginPath();
  pts.forEach((q, k) => (k ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1])));
  ctx.closePath();
  if (live) { ctx.fillStyle = COLORS.cyan; ctx.globalAlpha = 0.05; ctx.fill(); }
  ctx.strokeStyle = COLORS.cyan;
  ctx.globalAlpha = live ? 0.32 : 0.16;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([8, 10]);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;
}

// Over the whole surface view (screen px): a dust storm's murk, streaked the way the wind blows; and
// the day side's glare, where the day is hot.
export function drawSurfaceWeather(w, h, time) {
  const exp = surfaceRun.exp;
  if (!exp) return;
  ctx.save();
  if (exp.day.day && hotDay(surfaceRun.site)) {
    ctx.fillStyle = COLORS.flame;
    ctx.globalAlpha = 0.08 + 0.02 * Math.sin(time * 2);
    ctx.fillRect(0, 0, w, h);
  }
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
    ctx.strokeStyle = '#e2aa72';
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
    if (d.day) out.push([`DAY SIDE · HEAT CLIMBING · YIELD +1 · night in ${mmss(d.left)}`, COLORS.hostile]);
    else out.push([`SUNRISE IN ${mmss(d.in)}`, d.in <= 30 ? COLORS.amber : COLORS.hud]);
  }
  if (exp.dust) out.push(['DUST STORM · pushed off course', COLORS.amber]);
  const need = takeoffNeed();
  if (cargo.fuel + 1e-6 < need) out.push([`NOT ENOUGH FUEL TO TAKE OFF · ${need} needed`, COLORS.hostile]);
  if (hold.free < 1) out.push(['HOLD FULL · the tools stop', COLORS.amber]);
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
