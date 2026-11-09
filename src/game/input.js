// Touch and mouse input on the flight view: a drag sets the heading and its length the speed (the
// joypad under the finger, game/hud.js drawDragIndicator, in space and on a surface); a tap selects (or, in a fight, targets an enemy), and the selected thing's
// context menu does the rest (Mine is never started by a tap alone); a drop dragged onto the ship
// is picked up; a long press on something does what you'd most likely do there (dock at a
// station), flying there first.
// Part of the flight view; src/main.js starts it.

import { focusOn, foeAt, foeMarkerAt } from './combat.js';
import { actions } from './docking.js';
import { moveMode } from './options.js';
import { act, frameList, hitRadius, pickAt, screenToWorld, select } from './selection.js';
import { GATHER, cargo, collectItems, gatherDrops } from './cargo.js';
import { worldToScreen } from './hud.js';
import { stackOf, underStack } from './draw-world.js';
import { SHIP, autopilot, canvas, fight, flyingFight, inFight, notify, ship, view } from './state.js';
import { landing, onSurface, surfaceAt } from './landing.js';
import { depositAt, dropOnCraft, onCraft, selectOnSurface, surfaceDropAt, surfaceStackOf } from './surface-run.js';
import { warp } from './warp.js';

export const DEADZONE = 8;
// held: seconds the finger has stayed put; long: a long press acted, so letting go does nothing more;
// t0: when it touched down (s); course: the heading and speed set then, for a flick to keep; item:
// a drop the finger is dragging (dropAt), instead of steering.
export const drag = { active: false, id: null, x0: 0, y0: 0, x: 0, y: 0, moved: 0, held: 0, long: false, t0: 0, course: null, item: null };

// Drops: what floats in space (an item or loot: game/cargo.js dropEntity) or lies on a surface
// (game/surface-run.js) can be dragged; let go over the ship, it's picked up; anywhere else, it
// stays where it was let go. Nothing is picked up by flying near it. GRAB: CSS px round a drop's
// icon that a finger takes it from; ONTO: round the ship that counts as onto it.
const GRAB = 8, ONTO = 40;
function dropAt(sx, sy) {
  if (landing.on) return landing.phase === 'surface' ? surfaceDropAt(surfaceAt(sx, sy)) : null;
  let best = null, bd = Infinity;
  for (const e of frameList) {
    if ((e.kind !== 'item' && e.kind !== 'loot') || cargo.removed.has(e.key) || underStack(e)) continue; // a stack: by its top one
    const [x, y] = worldToScreen(e.x, e.y), d = Math.hypot(sx - x, sy - y);
    if (d <= hitRadius(e) * view.zoom + GRAB && d < bd) { best = e; bd = d; }
  }
  return best;
}
// A drop and the rest of its stack (game/draw-world.js stackDrops) move together.
const stackFor = (it) => (landing.on ? surfaceStackOf(it) : stackOf(it));
function moveDrop(it, sx, sy) {
  const [x, y] = landing.on ? surfaceAt(sx, sy) : screenToWorld(sx, sy);
  for (const d of stackFor(it)) {
    Object.assign(d, { x, y });
    if (d.drop) Object.assign(d.drop, { x, y });
  }
}
// Let go: onto the ship, picked up (the hold full, a trade good waits beside it).
function letGo(it, sx, sy) {
  if (landing.on) {
    if (onCraft(...surfaceAt(sx, sy))) for (const d of stackFor(it)) if (!dropOnCraft(d)) break;
    return;
  }
  if (fight.wrecked) return; // a lost ship waiting for its tow picks nothing up
  const [x, y] = worldToScreen(ship.x, ship.y);
  if (Math.hypot(sx - x, sy - y) > SHIP.radius * view.zoom + ONTO) return;
  const stack = stackFor(it);
  moveDrop(it, ...worldToScreen(ship.x, ship.y));
  collectItems(stack);
}
export const LONG_PRESS = 0.5; // seconds

// Each step (game/loop.js react): a finger held still on something for LONG_PRESS does its long
// press action (flight/interactions.js `hold`), approaching first if it's out of reach.
export function tickHold(dt) {
  if (!drag.active || drag.long || drag.item || drag.moved >= DEADZONE || inFight() || warp.on || landing.on) return;
  drag.held += dt;
  if (drag.held < LONG_PRESS) return;
  const hit = pickAt(drag.x0, drag.y0);
  const a = hit && actions.held(hit);
  drag.held = -Infinity; // once per press, whatever it found
  if (!a) return;
  drag.long = true;
  select(hit);
  act(hit, a.id);
}
// The flight hints (the controls, top left) stay hidden unless asked for (Settings' Controls: Show
// hints in flight); then they show until the next touch on space.
export let interacted = true;
export function showHints() { interacted = false; }

// While a finger is down, how much of the screen the panels cover stays as it was when the drag
// began: a fight's panel or a message that pops up mid-drag doesn't reframe the camera or move the
// edge markers under the finger. Once it lets go, things ease to where the panels now are.
// steady(key, value) -> value, or what it was for this key when the drag began.
const held = new Map();
export function steady(key, value) {
  if (!drag.active) return value;
  if (!held.has(key)) held.set(key, value);
  return held.get(key);
}

// Whether a drag flies the ship now: not in a round-based fight (taps still target), nor in a
// gate jump, landing or taking off.
export function steering() {
  if (inFight() && !flyingFight()) return false;
  if (warp.on) return false;
  return !landing.on || landing.phase === 'surface';
}

// Drag length (CSS px) that maps to full speed.
export const maxDrag = () => Math.min(view.w, view.h) * 0.3;

// A tap selects what's under it; a tap on empty space clears the selection and any approach, and
// in Cruise mode a second tap there soon after (a double-tap) stops the ship, so one stray tap
// doesn't throw away your speed. In Direct mode letting go always stops the ship (unless it's
// approaching something). In a fight a tap on an enemy (or, in real time, its edge marker)
// targets it; in real time the ship stops as it would outside a fight.
export const DOUBLE_TAP = 0.4; // seconds between the taps of a double-tap
let lastEmptyTap = -Infinity;
const seconds = (e) => (e.timeStamp || performance.now()) / 1000;
function emptyTapStops(e) {
  const t = seconds(e);
  const double = t - lastEmptyTap <= DOUBLE_TAP;
  lastEmptyTap = double ? -Infinity : t;
  return double;
}
export function endDrag(e) {
  if (!drag.active || e.pointerId !== drag.id) return;
  drag.active = false;
  held.clear();
  const item = drag.item;
  drag.item = null;
  if (item && drag.moved >= DEADZONE) { letGo(item, e.clientX, e.clientY); return; } // a drop dragged
  if (drag.long) return; // the long press did its action
  const tap = e.type === 'pointerup' && drag.moved < DEADZONE;
  if (warp.on) return; // a gate jump has the controls
  if (landing.on) { // on the surface (game/landing.js): a tap on an enemy targets it; on a node or a drop selects it
    const foe = tap && landing.phase === 'surface' ? foeAt(e.clientX, e.clientY) : null;
    if (foe) { focusOn(foe); return; }
    const at = tap && landing.phase === 'surface' ? surfaceAt(e.clientX, e.clientY) : null;
    const it = at && (surfaceDropAt(at) || depositAt(at));
    if (it) { selectOnSurface(it); return; }
    if (tap && landing.phase === 'surface') selectOnSurface(null);
    if (onSurface() && (moveMode.value === 'direct' || (tap && emptyTapStops(e)))) ship.targetSpeed = 0;
    return;
  }
  const marker = tap && fight.s ? foeMarkerAt(e.clientX, e.clientY) || foeAt(e.clientX, e.clientY) : null;
  const hit = tap && !marker ? pickAt(e.clientX, e.clientY) : null;
  if (inFight()) {
    const foe = marker || (hit && fight.ships.has(hit.key) ? hit.key : null);
    if (foe) focusOn(foe);
    else if (flyingFight() && (moveMode.value === 'direct' || (tap && emptyTapStops(e)))) ship.targetSpeed = 0;
    return;
  }
  if (hit) select(hit);
  else if (tap) { select(null); autopilot.key = null; }
  if (moveMode.value === 'direct') { if (!autopilot.key) ship.targetSpeed = 0; }
  else if (tap && !hit && emptyTapStops(e)) ship.targetSpeed = 0;
}

// Wiring, run once every module has loaded (src/main.js).
export function init() {
  // Collect all: on any drop's menu, every drop near the ship aboard at once (game/cargo.js
  // gatherDrops); dragging one still works. Not in a fight, nor while a lost ship waits for its tow;
  // a drop out of reach says so (the ship never flies to a drop).
  actions.add({
    id: 'gather', kind: ['item', 'loot'], verb: 'Collect all', key: 'g', range: () => Infinity,
    allowed: (e) => (inFight() || fight.wrecked ? { ok: false, reason: 'Not in a fight' }
      : Math.hypot(e.x - ship.x, e.y - ship.y) > GATHER ? { ok: false, reason: 'Collect all · out of reach' } : { ok: true }),
    run: () => { const n = gatherDrops(frameList); if (n > 1) notify(`Collected ${n}`, 2.5, { tone: 'good' }); select(null); },
  });
  canvas.addEventListener('pointerdown', (e) => {
    if (drag.active || (e.pointerType === 'mouse' && e.button !== 0)) return;
    canvas.setPointerCapture(e.pointerId);
    held.clear();
    Object.assign(drag, {
      active: true, id: e.pointerId,
      x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, moved: 0, held: 0, long: false,
      t0: seconds(e), course: { angle: ship.targetAngle, speed: ship.targetSpeed },
      item: warp.on || (landing.on && landing.phase !== 'surface') ? null : dropAt(e.clientX, e.clientY),
    });
    interacted = true;
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag.active || e.pointerId !== drag.id) return;
    drag.x = e.clientX;
    drag.y = e.clientY;
    const dx = drag.x - drag.x0;
    const dy = drag.y - drag.y0;
    const len = Math.hypot(dx, dy);
    drag.moved = Math.max(drag.moved, len);
    if (drag.item) { if (drag.moved >= DEADZONE) moveDrop(drag.item, drag.x, drag.y); return; } // carrying a drop, not steering
    if (!steering()) return;
    if (len > DEADZONE) {
      autopilot.key = null; // flying by hand ends an approach
      ship.targetAngle = Math.atan2(dy, dx);
      ship.targetSpeed = Math.min(len / maxDrag(), 1) * SHIP.maxSpeed;
    } else if (drag.moved > DEADZONE) {
      ship.targetSpeed = 0; // dragged back to the anchor: throttle to zero
    }
  });
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
}
