// Mining: the Mine and Siphon actions, a timed action on an asteroid, a gas pocket or a deposit on a
// surface, started only from its context menu (select it, then Mine) or E: the ship's tools lock on, and after a while (by how much the rock holds and how hard the
// tools bite: mineTime) it breaks up and leaves what it held (rules/mining.js). Flying out of reach
// pauses it; flying well away, or doing something else, ends it. Also the particle bursts and debris
// other parts use.
// Part of the flight view; src/main.js starts it.

import { Art } from '../art/render.js';
import { Feedback } from '../core/feedback.js';
import { COLORS, Theme } from '../core/theme.js';
import { Goods } from '../rules/goods.js';
import { Mining } from '../rules/mining.js';
import { Entities } from '../flight/entities.js';
import { cargo, dropEntity, saveCargo } from './cargo.js';
import { pilot } from './combat.js';
import { actions, docked } from './docking.js';
import { rx, ry } from './draw-world.js';
import { worldToScreen } from './hud.js';
import { landing } from './landing.js';
import { missionCollected } from './missions.js';
import { depositBroken } from './surface-run.js';
import { SHIP, TAU, ctx, debris, fight, notify, setMode, ship, view } from './state.js';
import { world } from './world.js';

// Gas pockets in nebulae are worked the same way (Siphon), and leave gas floating to pick up. A big
// asteroid breaks into shards, each mined in turn the same way. The tools never pick a rock on
// their own.

export const MINE_COLOR = COLORS.busy;

export const isGas = (e) => e.kind === 'gas';

// A big asteroid's shards (Mining.shards): small asteroids where it broke, quick to mine and not
// saved; they crumble away after SHARD_LIFE seconds (left alone that long).
export const shards = [];
const SHARD_LIFE = 120;
// How far past the tools' reach a rock can be and still be worked (on a surface, Mine is offered
// this far out).
export const REACH = 120;
// The time a rock takes, in seconds, kept within these; how far past its reach the ship can fly
// before the work is dropped.
const TIME = [1, 12], DROP = 400;
export const mineVerb = (e) => (isGas(e) ? ['Siphon', 'Siphoning'] : ['Mine', 'Mining']);

// The work under way: the rock, the seconds put in and needed.
export const mine = { target: null, t: 0, total: 1, chipT: 0 };
export const extracting = () => !!mine.target;
// How fast the tools wear a rock down (points a second: each tool's damage × rate × its factor
// for the material, × the computer's mining rate), and so how long it takes.
export function mineRate(rock) {
  const mat = Mining.material(rock);
  return SHIP.weapons.reduce((sum, w) => sum + w.damage * w.fireRate * (w.vs ? w.vs[mat] ?? 1 : 1), 0) * (SHIP.miningRate || 1);
}
export function mineTime(rock) {
  const r = mineRate(rock);
  return r > 0 ? Math.min(TIME[1], Math.max(TIME[0], Mining.integrity(rock) / r)) : Infinity;
}
// How far from the ship's hull a rock can be worked (surface units on a surface).
export const mineReach = () => Math.max(0, SHIP.lockRange - 200);
const gap = (rock) => { const P = pilot(); return Math.hypot(rock.x - P.x, rock.y - P.y) - rock.radius; };

// Start working a rock (or switch to another): not docked, landing, in a fight, with no tool for it.
export function extract(rock) {
  const onGround = landing.phase === 'surface';
  if (docked || (landing.on && !onGround) || !!rock.surface !== onGround || landing.wrecked) return;
  if (fight.s || fight.wreckT > 0 || cargo.removed.has(rock.key) || mine.target === rock) return;
  const total = mineTime(rock);
  if (!Number.isFinite(total)) { notify(`No tool fitted that can ${mineVerb(rock)[0].toLowerCase()} this`, 2, { tone: 'warn' }); return; }
  Object.assign(mine, { target: rock, t: 0, total, chipT: 0 });
  setMode('mining', true);
}
// The work dropped (flown off, something else tapped, a fight, a teleport): the rock stays as it was.
export function endExtraction() {
  if (!mine.target) return;
  mine.target = null;
  setMode('mining', false);
}

// Mining ends where the ship is moved by a teleport (game/outfitting.js placeShip). Must not touch
// anything declared below: placeShip runs it while the system first loads.
export function stopMining() {
  endExtraction();
  shards.length = 0;
}

// While a rock is being worked, its button shows how far along it is.
function miningBusy(a) {
  if (mine.target !== a) return null;
  const k = Math.min(1, mine.t / mine.total);
  return { ok: false, busy: true, inRange: true, progress: k, label: `${mineVerb(a)[1]} · ${Math.round(100 * k)}%` };
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

// Each step (in space and on a surface): the work goes on while the rock is within reach, chips
// flying; out of reach it waits, and well out of it it's dropped. Done, the rock breaks up and the
// tools stop. Shards crumble away in time (not while being worked).
export function tickMining(dt) {
  for (let i = shards.length - 1; i >= 0; i--) {
    const e = shards[i];
    if (mine.target === e) continue;
    e.life -= dt;
    if (e.life <= 0) shards.splice(i, 1);
  }
  const t = mine.target;
  if (t) {
    if (fight.s || (landing.on && landing.phase !== 'surface') || !!t.surface !== (landing.phase === 'surface')) { endExtraction(); return; }
    const d = gap(t);
    if (d > mineReach() + DROP) { notify(`${mineVerb(t)[1]} stopped · out of reach`, 1.5, { tone: 'warn' }); endExtraction(); return; }
    if (d <= mineReach() + REACH) {
      mine.t += dt;
      mine.chipT -= dt;
      if (mine.chipT <= 0) { chips(t, 2, 90); mine.chipT = 0.18; }
    }
    if (mine.t >= mine.total) {
      endExtraction();
      rockBroken(t);
    }
  }
}

// The rock being worked: a ring round it filling as the work goes, and the beam from the ship while
// it's in reach (space: world coordinates through rx/ry).
export function drawMining() {
  const t = mine.target;
  if (!t || landing.on) return;
  const k = Math.min(1, mine.t / mine.total), x = rx(t.x), y = ry(t.y), R = t.radius + 10 / view.zoom;
  ctx.save();
  if (gap(t) <= mineReach() + REACH) {
    ctx.strokeStyle = MINE_COLOR;
    ctx.globalAlpha = 0.35 + 0.25 * Math.sin(performance.now() / 70);
    ctx.lineWidth = 2 / view.zoom;
    ctx.beginPath(); ctx.moveTo(rx(ship.x), ry(ship.y)); ctx.lineTo(x, y); ctx.stroke();
  }
  drawRing(x, y, R, k, 3 / view.zoom);
  ctx.restore();
}
// A progress ring at (x, y): a faint track, the share done over it.
export function drawRing(x, y, R, k, width) {
  ctx.lineWidth = width;
  ctx.globalAlpha = 0.25;
  ctx.strokeStyle = COLORS.dim || '#46506a';
  ctx.beginPath(); ctx.arc(x, y, R, 0, TAU); ctx.stroke();
  ctx.globalAlpha = 0.95;
  ctx.strokeStyle = MINE_COLOR;
  ctx.beginPath(); ctx.arc(x, y, R, -Math.PI / 2, -Math.PI / 2 + TAU * k); ctx.stroke();
  ctx.globalAlpha = 1;
}
// Its percentage, over the rock on the screen (space).
export function drawMiningLabel() {
  const t = mine.target;
  if (!t || landing.on) return;
  const [x, y] = worldToScreen(t.x, t.y - t.radius);
  ctx.save();
  ctx.font = Theme.font(12);
  ctx.textAlign = 'center';
  ctx.fillStyle = MINE_COLOR;
  ctx.fillText(`${Math.round(100 * Math.min(1, mine.t / mine.total))}%`, x, y - 16);
  ctx.restore();
}

export function drawDebris() {
  for (const d of debris) {
    ctx.globalAlpha = Math.min(1, (d.life / d.max) * 1.5);
    ctx.fillStyle = d.color;
    ctx.fillRect(rx(d.x) - d.size / 2, ry(d.y) - d.size / 2, d.size, d.size);
  }
  ctx.globalAlpha = 1;
}

// Wiring, run once every module has loaded (src/main.js). Mine (or Siphon) on the selected rock's
// context menu sets the tools on it, from as far as they reach (or flies there first); Mine on
// another while working switches to it.
export function init() {
  actions.add({ id: 'mine', kind: 'asteroid', verb: 'Mine', key: 'e', range: mineReach, busy: miningBusy, run: extract });
  actions.add({ id: 'collect', kind: 'gas', verb: 'Siphon', key: 'e', range: mineReach, busy: miningBusy, run: extract });
}
