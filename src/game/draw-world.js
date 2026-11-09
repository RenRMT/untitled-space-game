// Drawing things in space (relative to `origin`, a grid point near the camera, for precision):
// entities, the ship, particles, drops (as their icons); and where the ship is (here.region).
// Part of the flight view; src/main.js starts it.

import { ItemIcons } from '../art/icons.js';
import { Art } from '../art/render.js';
import { COLORS, Theme } from '../core/theme.js';
import { Entities } from '../flight/entities.js';
import { Goods } from '../rules/goods.js';
import { Loadout } from '../rules/loadout.js';
import { Loot } from '../rules/loot.js';
import { perfStats } from './loop.js';
import { artStyle } from './options.js';
import { KINDS, selectedKey } from './selection.js';
import { PLAYER_DRAW, SHIP, cam, ctx, fight, here, particles, ship, view } from './state.js';
import { landingShipScale } from './landing.js';
import { upgradeLine } from './upgrades.js';
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
// icon in the menus (art/icons.js), DROP_PX across on the screen whatever the zoom (smaller than
// the player's ship at the smallest zoom): easy to see, to tap (it can be selected) and to drag
// onto the ship (game/input.js), the only way it's picked up. Drawn in the current transform, k
// screen px to a unit of it. `selected` names it above its icon (`name`, in its colour: amber, or
// its rarity's for loot and rarer finds); `count`, when more than one, is how many lie in its stack
// (stackDrops): two more icons fanned out behind, and the count on a badge at its top right, as
// the station's inventory counts them (.st-item .n in ui/kit-line.css, ui/kit-lowpoly.css).
export const DROP_PX = 28;
export const ITEM_COLOR = COLORS.amber;
export const dropIconKind = (e) => (e.kind === 'loot' ? e.spec.base : e.itemKind || e.kind);
export function dropColor(e) {
  if (e.kind === 'loot') return e.color;
  const r = e.art ? e.art.rarity : Goods.type(e.kind)?.rarity;
  return r >= 3 && Goods.RARITY[r] ? Goods.RARITY[r].color : ITEM_COLOR;
}
// The count badge in each UI style: line drawing's chalk numbers on the sky in a thin ink frame
// (--line); low-poly's glass numbers sunk in a bay plate (--plate-bay) with its corners cut and the
// glass's line along its foot (--cut-s, --well), as its readouts are.
const BADGE = {
  line: { bg: '#05060a', fg: '#e9eef2', border: '#3f7d82', weight: 400, cut: 0 },
  lowpoly: { bg: '#282c34', fg: '#7df9ff', foot: '#2f5b60', weight: 500, cut: 3 },
};
export function drawDrop(c, kind, x, y, k, color, selected = false, { count = 1, name = '', sub = '' } = {}) {
  const s = DROP_PX, img = ItemIcons.image(kind, artStyle.value, s);
  c.save();
  c.translate(x, y);
  c.scale(1 / k, 1 / k); // screen px from here
  if (count > 1) { // the stack: two more behind it, up and to the right
    c.globalAlpha = 0.35;
    c.drawImage(img, 6 - s / 2, -6 - s / 2, s, s);
    c.globalAlpha = 0.6;
    c.drawImage(img, 3 - s / 2, -3 - s / 2, s, s);
    c.globalAlpha = 1;
  }
  c.drawImage(img, -s / 2, -s / 2, s, s);
  if (count > 1) {
    const B = BADGE[artStyle.value] || BADGE.line, text = `×${count}`;
    c.font = `${B.weight} ${Theme.font(11)}`;
    const w = Math.ceil(c.measureText(text).width) + 6, h = Math.round(14 * Theme.scale), bx = s / 2 + 6 - w, by = -s / 2 - 4;
    const q = B.cut;
    c.fillStyle = B.bg;
    c.beginPath();
    c.moveTo(bx + q, by); c.lineTo(bx + w, by); c.lineTo(bx + w, by + h - q); c.lineTo(bx + w - q, by + h); c.lineTo(bx, by + h); c.lineTo(bx, by + q);
    c.closePath();
    c.fill();
    if (B.border) { c.strokeStyle = B.border; c.lineWidth = 1; c.strokeRect(bx + 0.5, by + 0.5, w - 1, h - 1); }
    if (B.foot) { c.fillStyle = B.foot; c.fillRect(bx, by + h - 1, w - q - 1, 1); }
    c.fillStyle = B.fg;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(text, bx + w / 2, by + h / 2 + 0.5);
  }
  if (selected && name) { // its name above it, clear of its brackets (its menu's buttons fan out below)
    c.font = Theme.font(12);
    c.textAlign = 'center';
    c.textBaseline = 'bottom';
    c.lineWidth = 3;
    c.strokeStyle = 'rgba(5, 6, 10, 0.85)';
    const ny = -s / 2 - 12 - 5; // over the selection's brackets (game/selection.js, 12 px out)
    c.strokeText(name, 0, ny);
    c.fillStyle = color;
    c.fillText(name, 0, ny);
    if (sub) { // a line over it: for loot, whom it's an upgrade for (game/upgrades.js)
      c.strokeText(sub, 0, ny - 15);
      c.fillStyle = COLORS.good;
      c.fillText(sub, 0, ny - 15);
    }
  }
  c.restore();
}

// Drops of the same thing lying close together on the screen (their icons overlapping) are shown
// as one stack: the first one's icon with a count, tapped, dragged and picked up together.
// list: drops in the order they're drawn; same(a): what makes two the same (null: never stacked,
// as each piece of loot is its own); reach: how close counts, in the units of their x and y.
// Returns a WeakMap from each drop in a stack of two or more to its stack (the lead first).
// Whom a floating piece of loot would be an upgrade for (its item made, to compare), or ''.
function dropUpgrade(e) {
  Loot.register(e.spec, Loadout.EQUIPMENT);
  return upgradeLine(e.spec.id);
}

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
      const sel = selectedKey() === `${e.kind}:${e.key}`;
      drawDrop(ctx, dropIconKind(e), rx(e.x), ry(e.y), view.zoom, dropColor(e), sel, { count: stackOf(e).length, name: e.label || e.name, sub: sel && e.kind === 'loot' ? dropUpgrade(e) : '' });
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
  Art.drawAsset(ctx, ship.art, artStyle.value, { angle: ship.angle, t, thrust: ship.thrust });
  ctx.restore();
}

export function drawParticles() {
  ctx.fillStyle = COLORS.flame;
  for (const p of particles) {
    ctx.globalAlpha = (p.life / p.max) * 0.7;
    ctx.fillRect(rx(p.x) - 1.5, ry(p.y) - 1.5, 3, 3);
  }
  ctx.globalAlpha = 1;
}
