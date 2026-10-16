// Touch and mouse input on the flight view: a drag sets the heading and its length the speed; a
// tap selects (or, in a fight, focuses fire).
// Part of the flight view; src/main.js starts it.

import { focusOn, foeMarkerAt } from './combat.js';
import { endArrive } from './intro.js';
import { moveMode } from './options.js';
import { pickAt, select } from './selection.js';
import { SHIP, autopilot, canvas, fight, flyingFight, inFight, intro, ship, view } from './state.js';

export const DEADZONE = 8;
export const drag = { active: false, id: null, x0: 0, y0: 0, x: 0, y: 0, moved: 0 };
export let interacted = false;

// Drag length (CSS px) that maps to full speed.
export const maxDrag = () => Math.min(view.w, view.h) * 0.3;

// A tap selects what's under it; a tap on empty space clears the selection and any approach,
// and in Cruise mode stops the ship. In Direct mode letting go always stops the ship (unless it's
// approaching something). In a fight a tap on an enemy (or, in real time, its edge marker)
// targets it; in real time the ship stops as it would outside a fight.
export function endDrag(e) {
  if (!drag.active || e.pointerId !== drag.id) return;
  drag.active = false;
  const tap = e.type === 'pointerup' && drag.moved < DEADZONE;
  if (intro.on) { // nothing to select yet: only flying
    if (intro.arrive && tap) endArrive(); // a tap skips the opening drift
    if (intro.flying && (moveMode.value === 'direct' || tap)) ship.targetSpeed = 0;
    return;
  }
  const marker = tap && fight.s ? foeMarkerAt(e.clientX, e.clientY) : null;
  const hit = tap && !marker ? pickAt(e.clientX, e.clientY) : null;
  if (inFight()) {
    const foe = marker || (hit && fight.ships.has(hit.key) ? hit.key : null);
    if (foe) focusOn(foe);
    else if (flyingFight() && (moveMode.value === 'direct' || tap)) ship.targetSpeed = 0;
    return;
  }
  if (hit) select(hit);
  else if (tap) { select(null); autopilot.key = null; }
  if (moveMode.value === 'direct') { if (!autopilot.key) ship.targetSpeed = 0; }
  else if (tap && !hit) ship.targetSpeed = 0;
}

// Wiring, run once every module has loaded (src/main.js).
export function init() {
  canvas.addEventListener('pointerdown', (e) => {
    if (drag.active || (e.pointerType === 'mouse' && e.button !== 0)) return;
    canvas.setPointerCapture(e.pointerId);
    Object.assign(drag, {
      active: true, id: e.pointerId,
      x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, moved: 0,
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
