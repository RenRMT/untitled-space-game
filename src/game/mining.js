// Mining: the Mine and Siphon actions, which start extraction (game/combat.js extract: a real-time
// fight against the rock), what a rock leaves when it breaks up (rules/mining.js); also the
// particle bursts and debris other parts use.
// Part of the flight view; src/main.js starts it.

import { Art } from '../art/render.js';
import { Feedback } from '../core/feedback.js';
import { COLORS } from '../core/theme.js';
import { Goods } from '../rules/goods.js';
import { Mining } from '../rules/mining.js';
import { cargo, dropEntity, saveCargo } from './cargo.js';
import { endExtraction, extract, extracting } from './combat.js';
import { actions } from './docking.js';
import { rx, ry } from './draw-world.js';
import { missionCollected } from './missions.js';
import { SHIP, TAU, ctx, debris, fight, notify } from './state.js';
import { world } from './world.js';

//
// Gas pockets in nebulae are worked the same way (Siphon), and leave gas floating to pick up.

export const MINE_COLOR = COLORS.busy;

export const isGas = (e) => e.kind === 'gas';
export const mineVerb = (e) => (isGas(e) ? ['Siphon', 'Siphoning'] : ['Mine', 'Mining']);

// Mining ends where the ship is moved by a teleport (game/outfitting.js placeShip). Must not touch
// anything declared below: placeShip runs it while the system first loads.
export function stopMining() {
  if (fight.s && fight.extract) endExtraction();
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

// Rock chips thrown off an asteroid: a few while mining, a burst when it breaks up. From a gas
// pocket, slow puffs of its gas instead.
export function chips(a, n, speed) {
  if (isGas(a)) {
    burst(a.x, a.y, n, { spread: a.radius * 0.7, speed: [speed * 0.1, speed * 0.4], life: [0.8, 2], size: [2, 2 + Math.min(6, a.radius / 10)], colors: [a.color, COLORS.flash] });
    return;
  }
  const colors = (Art.ASTEROIDS[a.ast.type] || Art.ASTEROIDS.stony).c;
  burst(a.x, a.y, n, { spread: a.radius * 0.6, speed: [speed * 0.3, speed], life: [0.5, 1.4], size: [1.5, 1.5 + Math.min(5, a.radius / 8)], colors });
}

// A rock worn down to nothing (game/combat.js shipDestroyed): it breaks up and stays gone, and
// what it held floats free to collect.
export function rockBroken(a) {
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
