// The surface run: what there is to do on a planet's or moon's surface once landed (game/landing.js
// flies the ship there). Every surface is a dungeon (game/dungeon.js: the labyrinth, its guardians
// and its Warden); this is what's common to all of them.
// - Deposits (rules/mining.js deposits): small nodes through the labyrinth, each a unit of one of the
//   body's goods, seeded afresh on every landing. A tap selects one, and its context menu's Mine (or
//   E) sets the tools on it: the same timed action as an asteroid in space (game/mining.js extract).
//   The tools never pick one on their own. Broken up, a node leaves what it held lying beside it.
// - What lies on the surface (cargo.surfaceDrops): a node's goods, loot, and the hold of a ship lost
//   there, drawn as their icons. A tap selects one; dragged onto the ship (game/input.js), it's
//   picked up. Nothing is picked up by flying near it.
// - The scan before landing: what a planet's or moon's card says of its surface (siteScan).
// Flight time runs on while landed, so the system moves on.
// (The landing sites and their hazards, heat, day side, dust, vents, storm pockets and take-off fuel,
// are on the archive: notes/archived-systems.md.)
// Part of the flight view; src/main.js starts it.

import { SurfaceGlobe } from '../art/surface-globe.js';
import { ArtSurface } from '../art/surface.js';
import { Feedback } from '../core/feedback.js';
import { Format } from '../core/format.js';
import { COLORS } from '../core/theme.js';
import { ContextCard } from '../ui/context.js';
import { Goods } from '../rules/goods.js';
import { Hazards } from '../rules/hazards.js';
import { Mining } from '../rules/mining.js';
import { addTo, cargo, hold, saveCargo } from './cargo.js';
import { drawFight, drawFightOverlay, endSurfaceFight, tickFight, tickShield } from './combat.js';
import { landing, landedZoom, takeOff } from './landing.js';
import { REACH, chips, drawRing, endExtraction, extract, mine, mineReach, tickMining } from './mining.js';
import { landSquad, liftSquad, tickSurfaceSquad } from './surface-squad.js';
import { bodyLevel, dungeonLines, dungeonRun, dungeonSite, enterDungeon, tickDungeon, tickGuardians } from './dungeon.js';
import { trackShields } from './screen-fx.js';
import { DROP_PX, STACK_PX, dropColor, drawDrop, stackDrops } from './draw-world.js';
import { menuRadius, selectionMark } from './selection.js';
import { SHIP, TAU, ctx, debris, notify } from './state.js';
import { skipTime } from './update.js';
import { world } from './world.js';

// e: the body landed on; W: its surface; site: what it holds (dungeonSite); field: this landing's (its
// nodes seeded by it); deposits: those not yet worked out, as extraction targets.
export const surfaceRun = { e: null, W: null, site: null, field: 0, deposits: [] };
const PICKUP = 30; // surface units round the ship that a drop let go over it counts as onto it
// The next landing's field, for the tests (tests/smoke.js): null picks one at random.
export const nextField = { value: null };

// ---------- The site ----------

// What a body's surface holds: its deposits (rules/hazards.js surface, by the body's type and, for a
// moon, its planet's), in a dungeon with no hazards (game/dungeon.js).
export function bodySite(e) {
  const G = world.galaxy, moon = e.kind === 'moon' && G.moons.find((m) => m.name === e.key);
  return dungeonSite(Hazards.surface(e.kind, e.body.type, e.body.seed, moon ? G.planets[moon.parent]?.type : undefined));
}
const goodName = (kind) => Goods.type(kind)?.name || kind;
// A good's colour (rules/goods.js), or as light as `light` at least (to stand out on dark ground).
const goodColor = (kind, light = 0) => { const c = Goods.type(kind)?.color || [0, 0, 0.7]; return `hsl(${c[0]}, ${Math.round(c[1] * 100)}%, ${Math.round(Math.max(light, c[2]) * 100)}%)`; };

// The scan before landing: a planet's or moon's card (game/selection.js describe) says what's down
// there.
export function siteScan(e) {
  const site = bodySite(e);
  const goods = [...new Set(site.deposits.map(([k]) => goodName(k)))].join(', ');
  return { tag: `Dungeon L${bodyLevel(e)}`, tone: 'warn', detail: `Guarded labyrinth, a Warden at its heart · Deposits: ${goods}` };
}

// The ship set down on a body's surface W (game/landing.js): a fresh field of nodes all through the
// labyrinth (the landing spot kept clear).
export function enterSurface(e, W) {
  const site = bodySite(e), T = ArtSurface.T, [i0, j0, i1, j1] = W.dungeon.area;
  const field = nextField.value ?? Math.floor(Math.random() * 1e9);
  nextField.value = null;
  const ok = (x, y, r) => ArtSurface.siteDist(W, x, y) < -T && ArtSurface.open(W, x, y, r + 10);
  const found = Mining.deposits(e.body.seed, site, { x0: (i0 + 1) * T, y0: (j0 + 1) * T, x1: (i1 - 1) * T, y1: (j1 - 1) * T, start: W.start, ok, field });
  Object.assign(surfaceRun, {
    e, W, site, field,
    deposits: found.map((d) => ({
      kind: 'deposit', surface: true, key: `${e.key}:deposit:${field}:${d.i}`, i: d.i, x: d.x, y: d.y, radius: d.r, material: d.material, rich: d.rich,
      good: d.kind, name: `${d.rich ? 'Rich ' : ''}${goodName(d.kind)} ${d.material === 'gas' ? 'pocket' : 'node'}`, color: goodColor(d.kind), edge: goodColor(d.kind, 0.78),
    })),
  });
  enterDungeon(W, e, field);
  landSquad(W); // the squad comes down with you (game/surface-squad.js)
}

// Off the surface (taking off): mining stops, and the buttons go.
export function leaveSurface() {
  endExtraction();
  selectOnSurface(null);
  endSurfaceFight(); // taking off from a dungeon's fight leaves its guardians behind
  surfaceRun.e = null;
  dungeonRun.W = null;
  dungeonRun.guards = [];
  liftSquad();
}

// ---------- Each step on the surface ----------

// A step on the surface, after the ship has flown (game/landing.js fly).
export function tickSurface(dt) {
  if (!surfaceRun.e || landing.wrecked) return;
  const C = landing.craft;
  skipTime(dt); // flight time runs on: the system moves on
  tickShield(dt);
  trackShields(); // the shields breaking (game/screen-fx.js)
  for (let i = debris.length - 1; i >= 0; i--) {
    const p = debris[i];
    p.life -= dt;
    if (p.life <= 0) { debris.splice(i, 1); continue; }
    p.x += p.vx * dt;
    p.y += p.vy * dt;
  }
  tickDungeon(C); // charting the labyrinth, and its chambers found
  tickGuardians(C, dt); // its guardians waking as the ship comes near (game/dungeon.js)
  tickSurfaceSquad(dt); // the squad following the ship over the ground (game/surface-squad.js)
  tickMining(dt); // the node the tools were set on, worked (space's update, which ticks it there, doesn't run here)
  tickFight(dt); // a dungeon's fight (and the effects of it)
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

// A node worn down to nothing (game/mining.js rockBroken): gone, and what it held thrown out round
// where it was, to be pulled in.
export function depositBroken(dep) {
  if (!surfaceRun.e) return;
  surfaceRun.deposits = surfaceRun.deposits.filter((d) => d !== dep);
  if (surfaceSel.it === dep) selectOnSurface(null);
  chips(dep, 8 + Math.round(dep.radius * 0.6), 100 + dep.radius * 3);
  const got = Mining.depositYield(surfaceRun.e.body.seed, { i: dep.i, kind: dep.good, rich: dep.rich, field: surfaceRun.field });
  leave(got.map((g) => g.kind), dep.x, dep.y, `deposit:${dep.key}`, dep.radius + 16);
  notify(`${dep.name} · ${got.length} × ${goodName(dep.good)}`, 1.5);
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

// ---------- A ship lost down there ----------

// Lost on the surface (the hull gone in a fight): the hold stays here, and the
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

// ---------- Drawing ----------

// On the ground (drawn with the view's transform: v the landed view, units of it): the deposits,
// what lies about and the debris; then in screen px: the tools' field of fire, beams, the lock's
// brackets and damage numbers.
export function drawSurfaceRun(v, zoom, dpr, time) {
  if (!surfaceRun.e) return;
  const at = (x, y, z = 0) => SurfaceGlobe.toScreen(v, x, y, z);
  ctx.save();
  ctx.setTransform(dpr * zoom, 0, 0, dpr * zoom, 0, 0);
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
  // The selection, as in space (game/selection.js): brackets round a node or a drop (a drop: round
  // its icon, DROP_PX across on the screen), its context menu just outside them. In screen px here.
  const sel = surfaceSel.it;
  if (sel && selGone(sel)) selectOnSurface(null);
  else if (sel) {
    const q = scr(sel.x, sel.y), r = isDeposit(sel) ? sel.radius * zoom : DROP_PX / 2;
    if (q) selectionMark(q[0], q[1], r, time, 1);
    ContextCard.show(selCard(sel));
    if (q) ContextCard.place(q[0], q[1], menuRadius(r, 1));
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

// The HUD's lines about the surface: [text, colour].
export function surfaceLines() {
  const site = surfaceRun.site;
  if (!site) return [];
  const out = [];
  if (hold.free < 1) out.push(['HOLD FULL · no mining', COLORS.amber]);
  out.push(...dungeonLines());
  out.push([`${surfaceRun.deposits.length} node${surfaceRun.deposits.length === 1 ? '' : 's'} · hold ${cargo.items.length}/${SHIP.cargo} · yield ×${site.rich}`, COLORS.hud]);
  return out;
}

// For the minimap: the deposits and what lies about, in surface units.
export const surfaceMarks = () => (surfaceRun.e ? [
  ...surfaceRun.deposits.map((d) => ({ x: d.x, y: d.y, color: d.color, r: 2.5 })),
  ...(cargo.surfaceDrops[surfaceRun.e.key] || []).map((it) => ({ x: it.x, y: it.y, color: COLORS.amber, r: 1.8 })),
] : []);

// Wiring, run once every module has loaded (src/main.js).
export function init() {
  window.addEventListener('keydown', (e) => {
    if ((e.key === 'e' || e.key === 'E') && landing.phase === 'surface') mineNearest();
  });
}
