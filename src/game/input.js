// Touch and mouse input on the flight view: a drag sets the heading and its length the speed; a
// quick flick dashes (game/dash.js); a
// tap selects (or, in a fight, focuses fire; on a planet's surface, mines the deposit under it); a long press on something does what you'd most
// likely do there (dock at a station, mine an asteroid, collect a gas pocket), flying there first.
// Part of the flight view; src/main.js starts it.

import { focusOn, foeAt, foeMarkerAt } from './combat.js';
import { endExtraction, extract, mine } from './mining.js';
import { FLICK, canDash, tryDash } from './dash.js';
import { actions } from './docking.js';
import { endArrive } from './intro.js';
import { moveMode } from './options.js';
import { act, frameList, pickAt, screenToWorld, select } from './selection.js';
import { cargo, collectItems } from './cargo.js';
import { worldToScreen } from './hud.js';
import { SHIP, autopilot, canvas, fight, flyingFight, inFight, intro, ship, view } from './state.js';
import { landing, onSurface, surfaceAt } from './landing.js';
import { depositAt, dropOnCraft, mineDeposit, surfaceDropAt } from './surface-run.js';
import { warp } from './warp.js';

export const DEADZONE = 8;
// held: seconds the finger has stayed put; long: a long press acted, so letting go does nothing more;
// t0: when it touched down (s); course: the heading and speed set then, for a flick to keep; item:
// a drop the finger is dragging (dropAt), instead of steering.
export const drag = { active: false, id: null, x0: 0, y0: 0, x: 0, y: 0, moved: 0, held: 0, long: false, t0: 0, course: null, item: null };

// Drops: what floats in space (an item or loot: game/cargo.js dropEntity) or lies on a surface
// (game/surface-run.js) can be dragged; let go over the ship, it's picked up; anywhere else, it
// stays where it was let go. GRAB: CSS px round a drop that a finger takes it from; ONTO: round the
// ship that counts as onto it.
const GRAB = 30, ONTO = 40;
function dropAt(sx, sy) {
  if (landing.on) return landing.phase === 'surface' ? surfaceDropAt(surfaceAt(sx, sy)) : null;
  let best = null, bd = Infinity;
  for (const e of frameList) {
    if ((e.kind !== 'item' && e.kind !== 'loot') || cargo.removed.has(e.key)) continue;
    const [x, y] = worldToScreen(e.x, e.y), d = Math.hypot(sx - x, sy - y);
    if (d <= e.radius * view.zoom + GRAB && d < bd) { best = e; bd = d; }
  }
  return best;
}
function moveDrop(it, sx, sy) {
  const [x, y] = landing.on ? surfaceAt(sx, sy) : screenToWorld(sx, sy);
  Object.assign(it, { x, y });
  if (it.drop) Object.assign(it.drop, { x, y });
}
// Let go: onto the ship, picked up (the hold full, a trade good waits beside it).
function letGo(it, sx, sy) {
  if (landing.on) {
    const [x, y] = surfaceAt(sx, sy), C = landing.craft;
    if (Math.hypot(x - C.x, y - C.y) <= SHIP.radius + ONTO) dropOnCraft(it);
    return;
  }
  const [x, y] = worldToScreen(ship.x, ship.y);
  if (Math.hypot(sx - x, sy - y) > SHIP.radius * view.zoom + ONTO) return;
  moveDrop(it, ...worldToScreen(ship.x, ship.y));
  collectItems([it]);
}
export const LONG_PRESS = 0.5; // seconds

// Each step (game/loop.js react): a finger held still on something for LONG_PRESS does its long
// press action (flight/interactions.js `hold`), approaching first if it's out of reach.
export function tickHold(dt) {
  if (!drag.active || drag.long || drag.item || drag.moved >= DEADZONE || inFight() || intro.on || warp.on || landing.on) return;
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
  // A flick (a short drag let go at once) dashes the way it went, if it can (game/dash.js). Its own
  // steering is undone either way, so the ship keeps the course it had; in Direct mode letting go
  // stops it, as ever.
  const fx = e.clientX - drag.x0, fy = e.clientY - drag.y0;
  if (e.type === 'pointerup' && seconds(e) - drag.t0 <= FLICK.time && Math.hypot(fx, fy) >= FLICK.min && canDash()) {
    tryDash(Math.atan2(fy, fx));
    ship.targetAngle = drag.course.angle;
    ship.targetSpeed = moveMode.value === 'direct' ? 0 : drag.course.speed;
    return;
  }
  const tap = e.type === 'pointerup' && drag.moved < DEADZONE;
  if (warp.on) return; // a gate jump has the controls
  if (landing.on) { // on the surface (game/landing.js): a tap on an enemy targets it, on a deposit mines it
    const foe = tap && landing.phase === 'surface' ? foeAt(e.clientX, e.clientY) : null;
    if (foe) { focusOn(foe); return; }
    const dep = tap && landing.phase === 'surface' ? depositAt(surfaceAt(e.clientX, e.clientY)) : null;
    if (dep) { mineDeposit(dep); return; }
    if (onSurface() && (moveMode.value === 'direct' || (tap && emptyTapStops(e)))) ship.targetSpeed = 0;
    return;
  }
  if (intro.on) { // nothing to select yet: only flying
    if (intro.arrive && tap) endArrive(); // a tap skips the opening drift
    if (intro.flying && (moveMode.value === 'direct' || (tap && emptyTapStops(e)))) ship.targetSpeed = 0;
    return;
  }
  const marker = tap && fight.s ? foeMarkerAt(e.clientX, e.clientY) || foeAt(e.clientX, e.clientY) : null;
  const hit = tap && !marker ? pickAt(e.clientX, e.clientY) : null;
  // Mining: another rock tapped is worked instead; anything else ends it, and is selected.
  if (mine.target && hit && hit !== mine.target) {
    if (hit.kind === 'asteroid' || hit.kind === 'gas') { extract(hit); return; }
    endExtraction();
  }
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
  canvas.addEventListener('pointerdown', (e) => {
    if (drag.active || (e.pointerType === 'mouse' && e.button !== 0)) return;
    canvas.setPointerCapture(e.pointerId);
    held.clear();
    Object.assign(drag, {
      active: true, id: e.pointerId,
      x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, moved: 0, held: 0, long: false,
      t0: seconds(e), course: { angle: ship.targetAngle, speed: ship.targetSpeed },
      item: intro.on || warp.on || (landing.on && landing.phase !== 'surface') ? null : dropAt(e.clientX, e.clientY),
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
    if (inFight() && !flyingFight()) return; // no flying in a round-based fight; taps still focus fire
    if (intro.on && !intro.flying) return; // the pod waits while the station talks, then the beam has it
    if (warp.on) return; // a gate jump has the controls
    if (landing.on && landing.phase !== 'surface') return; // landing or taking off has them
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
