// Drawing things in space (relative to `origin`, a grid point near the camera, for precision):
// entities, the ship, particles, drops (as their icons); and where the ship is (here.region).
// Part of the flight view; src/main.js starts it.

import { ItemIcons } from '../art/icons.js';
import { Art } from '../art/render.js';
import { COLORS, Theme } from '../core/theme.js';
import { Entities } from '../flight/entities.js';
import { Goods } from '../rules/goods.js';
import { perfStats } from './loop.js';
import { artStyle } from './options.js';
import { KINDS, selectedKey } from './selection.js';
import { drawDashRing } from './dash.js';
import { industry } from './industry.js';
import { PLAYER_DRAW, SHIP, TAU, cam, ctx, fight, here, particles, ship, view } from './state.js';
import { landingShipScale } from './landing.js';
import { flameThrust } from './screen-fx.js';
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

// A drop (an item or a piece of loot floating in space, goods lying on a surface) is drawn as its
// icon in the menus (art/icons.js), DROP_PX across on the screen whatever the zoom (a little
// smaller than the player's ship at the smallest zoom), on a glow and a ring pulsing outward in the
// amber the minimap uses for items (loot and rarer finds: their rarity's colour), each on its own
// rhythm: easy to see, to tap (it can be selected) and to drag onto the ship (game/input.js), the
// only way it's picked up. Drawn in the current transform, k screen px to a unit of it; `selected`
// steadies and brightens the ring and names it above its icon (`name`); `count`, when more than
// one, is how many lie in its stack (stackDrops), shown on a badge.
export const DROP_PX = 28;
export const ITEM_HALO = { color: COLORS.amber, period: 1.8 };
export function dropPhase(key) {
  let h = 0;
  for (const ch of String(key)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return (h % 1000) / 1000;
}
export const dropIconKind = (e) => (e.kind === 'loot' ? e.spec.base : e.itemKind || e.kind);
export function dropColor(e) {
  if (e.kind === 'loot') return e.color;
  const r = e.art ? e.art.rarity : Goods.type(e.kind)?.rarity;
  return r >= 3 && Goods.RARITY[r] ? Goods.RARITY[r].color : ITEM_HALO.color;
}
export function drawDrop(c, kind, x, y, k, color, t, key, selected = false, { count = 1, name = '' } = {}) {
  const s = DROP_PX, R = s * 0.5 + 4, p = (t / ITEM_HALO.period + dropPhase(key)) % 1;
  c.save();
  c.translate(x, y);
  c.scale(1 / k, 1 / k); // screen px from here
  if (count > 1) { // the stack: two more rings behind, offset
    c.fillStyle = 'rgba(5, 6, 10, 0.55)';
    c.strokeStyle = color;
    c.lineWidth = 1;
    for (const d of [8, 4]) {
      c.globalAlpha = 0.45;
      c.beginPath(); c.arc(d, -d, R, 0, TAU); c.fill(); c.stroke();
    }
    c.globalAlpha = 1;
  }
  c.fillStyle = 'rgba(5, 6, 10, 0.55)';
  c.beginPath(); c.arc(0, 0, R, 0, TAU); c.fill();
  c.strokeStyle = color;
  c.lineWidth = selected ? 2.5 : 1.5;
  c.globalAlpha = selected ? 0.95 : 0.6 + 0.1 * Math.sin((p + 0.25) * TAU);
  c.beginPath(); c.arc(0, 0, R, 0, TAU); c.stroke();
  c.globalAlpha = (1 - p) * 0.5;
  c.beginPath(); c.arc(0, 0, R * (1 + p * 0.6), 0, TAU); c.stroke();
  c.globalAlpha = 1;
  c.drawImage(ItemIcons.image(kind, artStyle.value, s), -s / 2, -s / 2, s, s);
  if (count > 1) { // ×N on a badge at its lower right
    const text = `×${count}`;
    c.font = Theme.font(11);
    const w = Math.max(18, c.measureText(text).width + 8), bx = R * 0.85, by = R * 0.85;
    c.fillStyle = 'rgba(5, 6, 10, 0.85)';
    c.strokeStyle = color;
    c.lineWidth = 1;
    c.beginPath(); c.arc(bx - w / 2 + 8, by, 8, TAU / 4, TAU * 0.75); c.arc(bx + w / 2 - 8, by, 8, -TAU / 4, TAU / 4); c.closePath(); c.fill(); c.stroke();
    c.fillStyle = color;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(text, bx, by + 0.5);
  }
  if (selected && name) { // its name above it (its menu's buttons fan out below)
    c.font = Theme.font(12);
    c.textAlign = 'center';
    c.textBaseline = 'bottom';
    c.lineWidth = 3;
    c.strokeStyle = 'rgba(5, 6, 10, 0.85)';
    c.strokeText(name, 0, -R - 6);
    c.fillStyle = color;
    c.fillText(name, 0, -R - 6);
  }
  c.restore();
}

// Drops of the same thing lying close together on the screen (their icons overlapping) are shown
// as one stack: the first one's icon with a count, tapped, dragged and picked up together.
// list: drops in the order they're drawn; same(a): what makes two the same (null: never stacked,
// as each piece of loot is its own); reach: how close counts, in the units of their x and y.
// Returns a WeakMap from each drop in a stack of two or more to its stack (the lead first).
export function stackDrops(list, same, reach) {
  const stacks = [], of = new WeakMap();
  for (const e of list) {
    const id = same(e);
    if (id == null) continue;
    const st = stacks.find((g) => g.id === id && Math.hypot(g.items[0].x - e.x, g.items[0].y - e.y) <= reach);
    if (st) st.items.push(e);
    else stacks.push({ id, items: [e] });
  }
  for (const g of stacks) if (g.items.length > 1) for (const e of g.items) of.set(e, g.items);
  return of;
}
export const STACK_PX = DROP_PX * 0.75; // icons nearer than this, in screen px, stack
// The stacks floating in space, from the last frame drawn (drawEntities): a drop's stack, or none.
export let spaceStacks = new WeakMap();
export const stackOf = (e) => spaceStacks.get(e) || [e];
// A drop hidden under another at the top of its stack: not drawn or picked on its own.
export const underStack = (e) => { const st = spaceStacks.get(e); return !!st && st[0] !== e; };
const sameInSpace = (e) => (e.kind === 'item' ? `${e.itemKind}|${e.mission || ''}` : null);

export function visible(e) {
  const hw = view.w / 2 / view.zoom, hh = view.h / 2 / view.zoom, r = (e.extent || e.radius || 100) * 1.3; // extent: how far a deep-space site's drawing reaches (a beam, a jet)
  return Math.abs(e.x - cam.x) < hw + r && Math.abs(e.y - cam.y) < hh + r;
}

export function drawEntities(list, t) {
  const style = artStyle.value;
  const shown = list.filter(visible).sort((a, b) => KINDS[a.kind].order - KINDS[b.kind].order);
  perfStats.posed = list.length;
  perfStats.drawn = shown.length;
  const hw = view.w / 2 / view.zoom, hh = view.h / 2 / view.zoom;
  const scene = { t, list, view: [cam.x - hw, cam.y - hh, cam.x + hw, cam.y + hh] };
  spaceStacks = stackDrops(shown.filter((e) => e.kind === 'item'), sameInSpace, STACK_PX / view.zoom);
  for (const e of shown) {
    if (e.kind === 'item' || e.kind === 'loot') {
      if (underStack(e)) continue;
      drawDrop(ctx, dropIconKind(e), rx(e.x), ry(e.y), view.zoom, dropColor(e), t, e.key, selectedKey() === `${e.kind}:${e.key}`, { count: stackOf(e).length, name: e.label || e.name });
    }
    else KINDS[e.kind].draw(ctx, e, style, rx(e.x), ry(e.y), scene);
  }
}

// The ship's design is drawn to fit its hull's size (the Courier's art is a quarter wider than its
// collision radius, and every hull keeps that proportion), drawn larger like every ship
// (flight/entities.js SHIP_SCALE), and the player's larger again (game/state.js PLAYER_DRAW).
export function drawShip(t) {
  if (fight.wrecked) return; // blown up, waiting for the tow
  const k = (SHIP.radius * PLAYER_DRAW * Entities.SHIP_SCALE * warpShipScale() * landingShipScale()) / ship.art.radius;
  if (k <= 0.01) return; // gone into a jump gate's ring, or down to a planet
  ctx.save();
  ctx.translate(rx(ship.x), ry(ship.y));
  if (k !== 1) ctx.scale(k, k);
  Art.drawAsset(ctx, ship.art, artStyle.value, { angle: ship.angle, t, thrust: flameThrust(ship.thrust, t) }); // sputtering on a low tank
  ctx.restore();
  drawDashRing(rx(ship.x), ry(ship.y), SHIP.radius * 1.9, 1.5 / view.zoom); // the dash coming back (game/dash.js)
}

// Haulers on routes and shuttles (game/industry.js haulerSpots): small arrowheads flying between
// stations on the real clock, amber when loaded. Only for show: nothing touches them.
export function drawHaulers() {
  const hw = view.w / 2 / view.zoom + 40, hh = view.h / 2 / view.zoom + 40;
  for (const h of industry.haulerSpots()) {
    if (Math.abs(h.x - cam.x) > hw || Math.abs(h.y - cam.y) > hh) continue;
    ctx.save();
    ctx.translate(rx(h.x), ry(h.y));
    ctx.rotate(h.angle);
    ctx.fillStyle = h.loaded ? COLORS.amber : COLORS.cyan;
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    ctx.moveTo(14, 0); ctx.lineTo(-9, 8); ctx.lineTo(-5, 0); ctx.lineTo(-9, -8);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}

export function drawParticles() {
  ctx.fillStyle = COLORS.flame;
  for (const p of particles) {
    ctx.globalAlpha = (p.life / p.max) * 0.7;
    ctx.fillRect(rx(p.x) - 1.5, ry(p.y) - 1.5, 3, 3);
  }
  ctx.globalAlpha = 1;
}
