// Drawing things in space (relative to `origin`, a grid point near the camera, for precision):
// entities, the ship, particles, item halos; and where the ship is (here.region).
// Part of the flight view; src/main.js starts it.

import { Art } from '../art/render.js';
import { COLORS } from '../core/theme.js';
import { Entities } from '../flight/entities.js';
import { Goods } from '../rules/goods.js';
import { perfStats } from './loop.js';
import { artStyle } from './options.js';
import { KINDS } from './selection.js';
import { drawDashRing } from './dash.js';
import { SHIP, TAU, cam, clamp, ctx, fight, here, particles, ship, view } from './state.js';
import { landingShipScale } from './landing.js';
import { warpShipScale } from './warp.js';
import { world } from './world.js';

export const origin = { x: 0, y: 0 };
export const rx = (x) => x - origin.x;
export const ry = (y) => y - origin.y;

// Keeps here.region (the system, security level and nebula the ship is in) up to date for the HUD
// and minimap, which show it, so crossing into another one gets no notice of its own. Entering a
// system for the first time charts it (rules/knowledge.js), so it shows on the galaxy map.
export function updateRegion() {
  const r = here.region = world.galaxy.regionAt(ship.x, ship.y);
  if (r.system) world.knowledge.visit(r.system.index);
}

// Pickup highlight: a soft glow, a steady ring and a ring pulsing outward, in the amber the minimap
// uses for items; rare and better finds ring in their rarity's colour instead (rules/goods.js). Each item
// pulses on its own rhythm, and the effect brightens as the ship nears.
export const ITEM_HALO = { color: COLORS.amber, period: 1.8, near: 900 };
export function itemPhase(e) {
  if (e.haloPhase === undefined) {
    let h = 0;
    for (const ch of e.key) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    e.haloPhase = (h % 1000) / 1000;
  }
  return e.haloPhase;
}

export let haloGlow = null; // one radial gradient of radius 1, scaled to each item
export function drawItemHalos(list, t) {
  if (!haloGlow) {
    haloGlow = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    haloGlow.addColorStop(0, 'rgba(255, 207, 90, 0.55)');
    haloGlow.addColorStop(0.55, 'rgba(255, 207, 90, 0.32)');
    haloGlow.addColorStop(1, 'rgba(255, 207, 90, 0)');
  }
  ctx.save();
  for (const e of list) {
    if (e.kind !== 'item') continue;
    ctx.strokeStyle = e.art.rarity >= 3 ? Goods.RARITY[e.art.rarity].color : ITEM_HALO.color;
    const x = rx(e.x), y = ry(e.y);
    const R = e.radius * 0.8 + 14;
    const near = clamp(1 - Math.hypot(ship.x - e.x, ship.y - e.y) / ITEM_HALO.near, 0, 1);
    const p = (t / ITEM_HALO.period + itemPhase(e)) % 1;
    // Soft glow, fading out past the ring.
    ctx.globalAlpha = 0.55 + 0.45 * near;
    ctx.fillStyle = haloGlow;
    ctx.translate(x, y);
    ctx.scale(R * 1.5, R * 1.5);
    ctx.beginPath();
    ctx.arc(0, 0, 1, 0, TAU);
    ctx.fill();
    ctx.scale(1 / (R * 1.5), 1 / (R * 1.5));
    ctx.translate(-x, -y);
    // Steady ring, breathing slightly.
    ctx.lineWidth = 1.5 / view.zoom;
    ctx.globalAlpha = 0.35 + 0.35 * near + 0.1 * Math.sin((p + 0.25) * TAU);
    ctx.beginPath();
    ctx.arc(x, y, R, 0, TAU);
    ctx.stroke();
    // Pulse: expands and fades.
    ctx.globalAlpha = (1 - p) * (0.45 + 0.35 * near);
    ctx.beginPath();
    ctx.arc(x, y, R * (1 + p * 1.1), 0, TAU);
    ctx.stroke();
  }
  ctx.restore();
}

export function visible(e) {
  const hw = view.w / 2 / view.zoom, hh = view.h / 2 / view.zoom, r = (e.radius || 100) * 1.3;
  return Math.abs(e.x - cam.x) < hw + r && Math.abs(e.y - cam.y) < hh + r;
}

export function drawEntities(list, t) {
  const style = artStyle.value;
  const shown = list.filter(visible).sort((a, b) => KINDS[a.kind].order - KINDS[b.kind].order);
  perfStats.posed = list.length;
  perfStats.drawn = shown.length;
  const hw = view.w / 2 / view.zoom, hh = view.h / 2 / view.zoom;
  const scene = { t, list, view: [cam.x - hw, cam.y - hh, cam.x + hw, cam.y + hh] };
  let halos = false;
  for (const e of shown) {
    // Pickup highlights go above wrecks and asteroids, just under the items themselves.
    if (e.kind === 'item' && !halos) { drawItemHalos(shown, t); halos = true; }
    KINDS[e.kind].draw(ctx, e, style, rx(e.x), ry(e.y), scene);
  }
}

// The ship's design is drawn to fit its hull's size (the Courier's art is a quarter wider than its
// collision radius, and every hull keeps that proportion), drawn larger like every ship
// (flight/entities.js SHIP_SCALE).
export function drawShip(t) {
  if (fight.wrecked) return; // blown up, waiting for the tow
  const k = (SHIP.radius * 1.25 * Entities.SHIP_SCALE * warpShipScale() * landingShipScale()) / ship.art.radius;
  if (k <= 0.01) return; // gone into a jump gate's ring, or down to a planet
  ctx.save();
  ctx.translate(rx(ship.x), ry(ship.y));
  if (k !== 1) ctx.scale(k, k);
  Art.drawAsset(ctx, ship.art, artStyle.value, { angle: ship.angle, t, thrust: ship.thrust });
  ctx.restore();
  drawDashRing(rx(ship.x), ry(ship.y), SHIP.radius * 1.9, 1.5 / view.zoom); // the dash coming back (game/dash.js)
}

export function drawParticles() {
  ctx.fillStyle = COLORS.flame;
  for (const p of particles) {
    ctx.globalAlpha = (p.life / p.max) * 0.7;
    ctx.fillRect(rx(p.x) - 1.5, ry(p.y) - 1.5, 3, 3);
  }
  ctx.globalAlpha = 1;
}
