// Mining: stop by an asteroid, mine it, collect what it leaves behind (rules/mining.js); also the
// particle bursts and debris other parts use.
// Part of the flight view; src/main.js starts it.

import { Art } from '../art/render.js';
import { Feedback } from '../core/feedback.js';
import { COLORS, Theme } from '../core/theme.js';
import { Goods } from '../rules/goods.js';
import { Mining } from '../rules/mining.js';
import { cargo, dropEntity, rarityNote, saveCargo } from './cargo.js';
import { actions, docked } from './docking.js';
import { rx, ry } from './draw-world.js';
import { worldToScreen } from './hud.js';
import { missionCollected } from './missions.js';
import { SHIP, TAU, autopilot, ctx, debris, inFight, mining, notify, ship, turnToward, view } from './state.js';
import { world } from './world.js';

//
// Gas pockets in nebulae are collected the same way (Collect): the same countdown, beam and
// range, a little slower, and they leave gas floating to pick up.

export const MINE_COLOR = COLORS.busy;

// Seconds to mine an asteroid or collect a gas pocket: the base time, sped up by the ship computer.
export function mineTime(e = mining.target) {
  return Mining.duration(e || { kind: 'asteroid' }) / (SHIP.miningRate || 1);
}
export const isGas = (e) => e.kind === 'gas';
export const mineVerb = (e) => (isGas(e) ? ['Collect', 'Collecting'] : ['Mine', 'Mining']);

// Called on teleports, docking and when the ship drifts away. Must not touch anything declared
// below: placeShip runs it while the system first loads.
export function stopMining(notice) {
  if (!mining.target) return;
  mining.target = null;
  mining.t = 0;
  if (notice) notify(notice);
}

// While mining, the Mine button counts down on the asteroid being mined (with a progress bar),
// and is busy on any other.
export function miningBusy(a) {
  if (!mining.target) return null;
  if (mining.target.key !== a.key) return { ok: false, label: `${mineVerb(a)[0]} · busy`, inRange: true };
  return {
    ok: false, busy: true, inRange: true, progress: mining.t / mineTime(),
    label: `${mineVerb(a)[1]} · ${Math.max(1, Math.ceil(mineTime() - mining.t))} sec`,
  };
}

export function startMining(a) {
  if (docked || inFight() || !actions.state(isGas(a) ? 'collect' : 'mine', a).ok) return;
  mining.target = a;
  mining.t = 0;
  autopilot.key = null;
  ship.targetSpeed = 0; // all stop, so the ship stays in range
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

export function finishMining() {
  const a = mining.target;
  stopMining();
  cargo.removed.add(a.key);
  chips(a, 14 + Math.round(a.radius * 0.6), 120 + a.radius * 3);
  if (isGas(a)) { // the pocket used up: its gas floats free, a canister per unit
    const gas = Mining.gasOf(world.galaxy.seed, a);
    gas.forEach((g, i) => {
      const ang = (i / gas.length) * TAU, d = gas.length > 1 ? 40 : 0;
      cargo.drops.push(dropEntity({ key: `drop:${a.key}:${i}`, kind: g.kind, seed: g.seed, x: a.x + Math.cos(ang) * d, y: a.y + Math.sin(ang) * d }));
    });
    const names = [...new Set(gas.map((g) => Goods.type(g.kind).name))].join(', ');
    notify(`Gas pocket collected · ${gas.length} × ${names}`, 2.5);
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
    notify(`Asteroid broken up · ${e.label} found${rarityNote(e)}`, 2.5);
    Feedback.emit('mined');
  } else {
    notify('Asteroid broken up · nothing of value', 2.5);
    Feedback.emit('mined');
  }
  saveCargo();
}

// Advance mining; runs with the flight simulation, so the map and docking pause it.
export function tickMining(dt) {
  const a = mining.target;
  if (!a) return;
  if (Math.hypot(ship.x - a.x, ship.y - a.y) - a.radius > Mining.config.range + Mining.config.slack) {
    stopMining(`${mineVerb(a)[1]} interrupted`);
    return;
  }
  // Hold station facing the rock, unless the player is steering.
  if (ship.targetSpeed === 0) ship.angle = turnToward(ship.angle, Math.atan2(a.y - ship.y, a.x - ship.x), SHIP.turnRate * dt);
  mining.t += dt;
  if (Math.random() < dt * 12) chips(a, 1, 60);
  if (mining.t >= mineTime()) finishMining();
}

// The mining beam from the ship to the rock, and a ring filling up around it.
export function drawMining(t) {
  const a = mining.target;
  if (!a) return;
  const p = Math.min(1, mining.t / mineTime());
  const ang = Math.atan2(a.y - ship.y, a.x - ship.x);
  const x0 = rx(ship.x) + Math.cos(ang) * SHIP.radius * 0.7, y0 = ry(ship.y) + Math.sin(ang) * SHIP.radius * 0.7;
  const wob = Math.sin(t * 37) * a.radius * 0.12;
  const x1 = rx(a.x) - Math.cos(ang) * a.radius * 0.5 - Math.sin(ang) * wob;
  const y1 = ry(a.y) - Math.sin(ang) * a.radius * 0.5 + Math.cos(ang) * wob;
  const flicker = 0.75 + 0.25 * Math.sin(t * 53);
  ctx.save();
  ctx.strokeStyle = MINE_COLOR;
  ctx.lineCap = 'round';
  ctx.globalAlpha = 0.25 * flicker;
  ctx.lineWidth = 7 / view.zoom;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
  ctx.globalAlpha = 0.9 * flicker;
  ctx.lineWidth = 2 / view.zoom;
  ctx.stroke();
  ctx.fillStyle = COLORS.flash;
  ctx.beginPath();
  ctx.arc(x1, y1, (3 + 2 * flicker) / view.zoom, 0, TAU);
  ctx.fill();
  // Progress ring.
  const R = a.radius + 16;
  ctx.lineWidth = 2.5 / view.zoom;
  ctx.globalAlpha = 0.2;
  ctx.beginPath();
  ctx.arc(rx(a.x), ry(a.y), R, 0, TAU);
  ctx.stroke();
  ctx.globalAlpha = 0.9;
  ctx.beginPath();
  ctx.arc(rx(a.x), ry(a.y), R, -Math.PI / 2, -Math.PI / 2 + p * TAU);
  ctx.stroke();
  ctx.restore();
}

// Seconds left, in screen space beside the ring.
export function drawMiningCountdown() {
  const a = mining.target;
  if (!a) return;
  const [sx, sy] = worldToScreen(a.x, a.y - a.radius - 16);
  ctx.save();
  ctx.font = Theme.font(13);
  ctx.textAlign = 'center';
  ctx.fillStyle = MINE_COLOR;
  ctx.globalAlpha = 0.95;
  ctx.fillText(`${Math.max(0, mineTime() - mining.t).toFixed(1)}s`, sx, sy - 10);
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

// Wiring, run once every module has loaded (src/main.js).
export function init() {
  actions.add({
    id: 'mine', kind: 'asteroid', verb: 'Mine', key: 'e', range: () => Mining.config.range, maxSpeed: () => Mining.config.maxSpeed,
    busy: miningBusy, hold: true, run: startMining,
  });
  actions.add({
    id: 'collect', kind: 'gas', verb: 'Collect', key: 'e', range: () => Mining.config.range, maxSpeed: () => Mining.config.maxSpeed,
    busy: miningBusy, hold: true, run: startMining,
  });
}
