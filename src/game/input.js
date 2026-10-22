// Touch and mouse input on the flight view: a drag sets the heading and its length the speed; a
// tap selects (or, in a fight, focuses fire; on a planet's surface, mines the deposit under it); a long press on something does what you'd most
// likely do there (dock at a station, mine an asteroid, collect a gas pocket), flying there first.
// Part of the flight view; src/main.js starts it.

import { endExtraction, extract, extracting, focusOn, foeMarkerAt } from './combat.js';
import { actions } from './docking.js';
import { endArrive } from './intro.js';
import { moveMode } from './options.js';
import { act, pickAt, select } from './selection.js';
import { SHIP, autopilot, canvas, fight, flyingFight, inFight, intro, ship, view } from './state.js';
import { landing, onSurface, surfaceAt } from './landing.js';
import { depositAt, mineDeposit } from './surface-run.js';
import { warp } from './warp.js';

export const DEADZONE = 8;
// held: seconds the finger has stayed put; long: a long press acted, so letting go does nothing more.
export const drag = { active: false, id: null, x0: 0, y0: 0, x: 0, y: 0, moved: 0, held: 0, long: false };
export const LONG_PRESS = 0.5; // seconds

// Each step (game/loop.js react): a finger held still on something for LONG_PRESS does its long
// press action (flight/interactions.js `hold`), approaching first if it's out of reach.
export function tickHold(dt) {
  if (!drag.active || drag.long || drag.moved >= DEADZONE || inFight() || intro.on || warp.on || landing.on) return;
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
export let interacted = false;
// Bring the flight hints back (Settings' Controls): they show until the next touch on space.
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
function emptyTapStops(e) {
  const t = (e.timeStamp || performance.now()) / 1000;
  const double = t - lastEmptyTap <= DOUBLE_TAP;
  lastEmptyTap = double ? -Infinity : t;
  return double;
}
export function endDrag(e) {
  if (!drag.active || e.pointerId !== drag.id) return;
  drag.active = false;
  held.clear();
  if (drag.long) return; // the long press did its action
  const tap = e.type === 'pointerup' && drag.moved < DEADZONE;
  if (warp.on) return; // a gate jump has the controls
  if (landing.on) { // on the surface (game/landing.js): a tap on a deposit mines it; nothing else to select
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
  const marker = tap && fight.s ? foeMarkerAt(e.clientX, e.clientY) : null;
  const hit = tap && !marker ? pickAt(e.clientX, e.clientY) : null;
  // Mining: another rock tapped joins the session; anything else ends it, and is selected.
  if (extracting() && hit && !fight.ships.has(hit.key)) {
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
