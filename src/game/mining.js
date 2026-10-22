// Mining: the Mine and Siphon actions, which start extraction (game/combat.js extract: a real-time
// fight against the rock), what a rock leaves when it breaks up (rules/mining.js); also the
// particle bursts and debris other parts use.
// Part of the flight view; src/main.js starts it.

import { Art } from '../art/render.js';
import { Feedback } from '../core/feedback.js';
import { COLORS } from '../core/theme.js';
import { Goods } from '../rules/goods.js';
import { Mining } from '../rules/mining.js';
import { Entities } from '../flight/entities.js';
import { cargo, dropEntity, hold, saveCargo } from './cargo.js';
import { endExtraction, extract, extracting, focusOn, joinRock, pilot } from './combat.js';
import { actions } from './docking.js';
import { rx, ry } from './draw-world.js';
import { missionCollected } from './missions.js';
import { frameList } from './selection.js';
import { depositBroken } from './surface-run.js';
import { SHIP, TAU, ctx, debris, fight, notify, ship } from './state.js';
import { world } from './world.js';

//
// Gas pockets in nebulae are worked the same way (Siphon), and leave gas floating to pick up.
// Mining is active (notes/hazards.md phase 4): once a session is under way the tools pick their own
// next rock (autoMine), and a big asteroid breaks into shards to chain through.

export const MINE_COLOR = COLORS.busy;

export const isGas = (e) => e.kind === 'gas';

// A big asteroid's shards (Mining.shards): small asteroids where it broke, quick to mine and not
// saved; they crumble away after SHARD_LIFE seconds (left alone that long).
export const shards = [];
const SHARD_LIFE = 120;
// How far past a tool's range a rock can be and still be picked next (the ship closes on it).
const REACH = 120;
export const mineVerb = (e) => (isGas(e) ? ['Siphon', 'Siphoning'] : ['Mine', 'Mining']);

// Mining ends where the ship is moved by a teleport (game/outfitting.js placeShip). Must not touch
// anything declared below: placeShip runs it while the system first loads.
export function stopMining() {
  if (fight.s && fight.extract) endExtraction();
  shards.length = 0;
}

// While a rock is being worked (game/combat.js extract), its button shows how far along it is.
function miningBusy(a) {
  const c = extracting() && fight.s.enemies.find((e) => e.id === a.key);
  if (!c || c.hull <= 0) return null;
  return { ok: false, busy: true, inRange: true, progress: 1 - c.hull / c.stats.hull, label: `${mineVerb(a)[1]} · ${Math.round(100 * (1 - c.hull / c.stats.hull))}%` };
}

// A burst of debris: n bits flying out from (x, y), or from anywhere within `spread` of it, each
// with a speed, life and size picked in its [min, max] and the colours taken in turn. Rock chips,
// explosions and sparks off a hull.
export function burst(x, y, n, { spread = 0, speed, life, size, colors }) {
  const pick = ([lo, hi]) => lo + Math.random() * (hi - lo);
  for (let i = 0; i < n; i++) {
    const ang = Math.random() * TAU, d = spread * Math.random(), sp = pick(speed), l = pick(life);
    debris.push({
      x: x + Math.cos(ang) * d, y: y + Math.sin(ang) * d, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp,
      life: l, max: l, size: pick(size), color: colors[i % colors.length],
    });
  }
}

// Rock chips thrown off an asteroid (or a deposit on a surface, in its good's colour): a few while
// mining, a burst when it breaks up. From a gas pocket, slow puffs of its gas instead.
export function chips(a, n, speed) {
  if (isGas(a) || a.material === 'gas') {
    burst(a.x, a.y, n, { spread: a.radius * 0.7, speed: [speed * 0.1, speed * 0.4], life: [0.8, 2], size: [2, 2 + Math.min(6, a.radius / 10)], colors: [a.color, COLORS.flash] });
    return;
  }
  const colors = a.surface ? [a.color, COLORS.flash] : (Art.ASTEROIDS[a.ast.type] || Art.ASTEROIDS.stony).c;
  burst(a.x, a.y, n, { spread: a.radius * 0.6, speed: [speed * 0.3, speed], life: [0.5, 1.4], size: [1.5, 1.5 + Math.min(5, a.radius / 8)], colors });
}

// A rock worn down to nothing (game/combat.js shipDestroyed): it breaks up and stays gone, and
// what it held floats free to collect. A deposit on a surface: game/surface-run.js.
export function rockBroken(a) {
  if (a.surface) { depositBroken(a); return; }
  if (a.shard) { shardBroken(a); return; }
  cargo.removed.add(a.key);
  chips(a, 14 + Math.round(a.radius * 0.6), 120 + a.radius * 3);
  if (isGas(a)) { // the pocket used up: its gas floats free, a canister per unit
    const gas = Mining.gasOf(world.galaxy.seed, a);
    gas.forEach((g, i) => {
      const ang = (i / gas.length) * TAU, d = gas.length > 1 ? 40 : 0;
      cargo.drops.push(dropEntity({ key: `drop:${a.key}:${i}`, kind: g.kind, seed: g.seed, x: a.x + Math.cos(ang) * d, y: a.y + Math.sin(ang) * d }));
    });
    const names = [...new Set(gas.map((g) => Goods.type(g.kind).name))].join(', ');
    notify(`Gas pocket used up · ${gas.length} × ${names}`, 2.5);
    Feedback.emit('mined');
    missionCollected('gas');
    saveCargo();
    return;
  }
  missionCollected('mine', a);
  spawnShards(a);
  const found = Mining.yieldOf(world.galaxy.seed, a);
  if (found) {
    const e = dropEntity({ key: `drop:${a.key}`, kind: found.kind, seed: found.seed, x: a.x, y: a.y });
    cargo.drops.push(e);
    notify(`Asteroid broken up · ${e.label} found`, 2.5);
    Feedback.emit('mined');
  } else {
    notify('Asteroid broken up · nothing of value', 2.5);
    Feedback.emit('mined');
  }
  saveCargo();
}

// ---------- Shards ----------

// The shards a broken asteroid leaves, round where it was.
function spawnShards(a) {
  for (const sh of Mining.shards(world.galaxy.seed, a)) {
    const d = a.radius * 0.5 + sh.d;
    const e = Entities.asteroid({ key: `${a.key}:s${sh.i}`, type: a.ast.type, r: sh.r, seed: sh.seed, spin0: sh.a, tumble: (sh.i % 2 ? 0.6 : -0.6), x: a.x + Math.cos(sh.a) * d, y: a.y + Math.sin(sh.a) * d });
    shards.push(Object.assign(e, { shard: true, parent: { key: a.key, ast: a.ast }, i: sh.i, life: SHARD_LIFE }));
  }
}
// A shard broken: gone, and now and then a drop of its asteroid's kind.
function shardBroken(a) {
  const k = shards.indexOf(a);
  if (k >= 0) shards.splice(k, 1);
  chips(a, 8, 100);
  Feedback.emit('mined');
  const found = Mining.shardYield(world.galaxy.seed, a.parent, a.i);
  if (!found) return;
  const e = dropEntity({ key: `drop:${a.key}`, kind: found.kind, seed: found.seed, x: a.x, y: a.y });
  cargo.drops.push(e);
  notify(`Shard broken · ${e.label} found`, 2);
  saveCargo();
}

// ---------- The tools on their own ----------

// The tools that work a rock's material, and how far the furthest of them reaches.
function toolsFor(c) {
  const mat = Mining.material(c);
  return SHIP.weapons.filter((w) => (w.vs ? w.vs[mat] ?? 1 : 1) > 0);
}
const toolRange = (c) => Math.max(0, ...toolsFor(c).map((w) => w.range));
// How good a next target a rock is (lower is better): its distance, doubled when it isn't ahead of a
// tool that works it; Infinity further than `reach` (by default as far as the tools reach, and a little).
function rank(P, c, reach = toolRange(c) + REACH) {
  const tools = toolsFor(c), d = Math.hypot(c.x - P.x, c.y - P.y);
  if (!tools.length || d - c.radius > reach) return Infinity;
  const off = Math.abs(Math.atan2(Math.sin(Math.atan2(c.y - P.y, c.x - P.x) - P.angle), Math.cos(Math.atan2(c.y - P.y, c.x - P.x) - P.angle)));
  const ahead = tools.some((w) => w.arc >= 360 || off <= (w.arc * Math.PI) / 360 + Math.atan2(c.radius, Math.max(d, 1)));
  return ahead ? d : d * 2;
}

// While mining (start: or with no session yet, on a surface), keep the tools busy: when the target is
// gone, or one they picked has fallen out of their range, the best rock in `list` within `reach` is
// next; and one more stays joined, so the session carries on when this one breaks. A target picked
// by hand is kept. Not with the hold full.
export function autoMine(list, start = false, reach = undefined) {
  const s = fight.s;
  if (hold.free < 1 || fight.wreckT > 0 || (s ? !fight.extract : !start)) return;
  const P = pilot();
  const ranked = list.filter((c) => !fight.dying.has(c.key) && !cargo.removed.has(c.key)).map((c) => [c, rank(P, c, reach)]).filter(([, v]) => v < Infinity).sort((a, b) => a[1] - b[1]).map(([c]) => c);
  if (!s) { if (ranked[0]) extract(ranked[0]); return; }
  const live = s.enemies.filter((e) => e.hull > 0), focus = live.find((e) => e.id === s.focus);
  if (!focus || (!s.manual && rank(P, focus, toolRange(focus)) === Infinity)) {
    const next = ranked[0];
    if (next) { joinRock(next); focusOn(next.key, false); }
  }
  if (live.length < 2) {
    const spare = ranked.find((c) => c.key !== s.focus && !fight.ships.has(c.key));
    if (spare) joinRock(spare);
  }
}

// Each step in space: shards crumble away in time (not while being worked), and the tools chain on.
export function tickMining(dt) {
  for (let i = shards.length - 1; i >= 0; i--) {
    const e = shards[i];
    if (fight.ships.has(e.key)) continue;
    e.life -= dt;
    if (e.life <= 0) shards.splice(i, 1);
  }
  if (extracting() && pilot() === ship) autoMine(frameList.filter((e) => e.kind === 'asteroid' || e.kind === 'gas'));
}

export function drawDebris() {
  for (const d of debris) {
    ctx.globalAlpha = Math.min(1, (d.life / d.max) * 1.5);
    ctx.fillStyle = d.color;
    ctx.fillRect(rx(d.x) - d.size / 2, ry(d.y) - d.size / 2, d.size, d.size);
  }
  ctx.globalAlpha = 1;
}

// Wiring, run once every module has loaded (src/main.js). Mine (or Siphon) locks the ship's tools
// on the rock, from as far as a lock reaches; tapping another while working adds it.
export function init() {
  const range = () => Math.max(0, SHIP.lockRange - 200);
  actions.add({ id: 'mine', kind: 'asteroid', verb: 'Mine', key: 'e', range, busy: miningBusy, hold: true, run: extract });
  actions.add({ id: 'collect', kind: 'gas', verb: 'Siphon', key: 'e', range, busy: miningBusy, hold: true, run: extract });
}
