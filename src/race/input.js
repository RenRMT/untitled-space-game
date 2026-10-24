// The race's controls, in one of two ways to steer:
// - point: the game's Cruise (game/input.js): drag anywhere to set a heading (its screen height
//   stretched back out of the view's tilt, so it points where it looks), the drag's length the
//   speed; letting go keeps the course, and a double-tap stops. WASD or arrows fly that way at full
//   speed while held.
// - sides: it flies itself at full speed; hold the left half of the screen to turn left, the right
//   half to turn right (both, or neither: straight on). A or ←, D or →: the same; S or ↓ brakes.
//
//   Input.init(canvas, { tilt: () => radians, onKey: (key) => handled })
//   Input.mode = 'point' | 'sides'
//   Input.stopOnRelease   point: letting go stops (the game's Direct) instead of keeping the course
//   Input.control() -> { keyed, angle, speed, turn, brake }   what the controls ask for now
//     point: angle (absolute) and speed (0..1); keyed: keys held (full speed their way)
//     sides: turn (−1 left, 0, +1 right), brake
//   Input.reset(angle)    a fresh course, stopped, pointing that way
//   Input.drag            the drag under way, to draw: { active, x0, y0, x, y } (screen px)
//   Input.held            sides: { left, right } held, to draw
//   Input.maxDrag()       the drag that sets full speed (screen px)
// ES module (`Input`); needs a browser.

const Input = (() => {
  const DEADZONE = 8, DOUBLE_TAP = 0.4, maxDrag = () => Math.min(innerWidth, innerHeight) * 0.225;
  const drag = { active: false, id: null, x0: 0, y0: 0, x: 0, y: 0, moved: 0 };
  const keys = new Set(), sides = new Map(), held = { left: false, right: false };
  let course = { angle: 0, speed: 0 }, lastTap = -Infinity, tilt = () => 0;
  const api = { mode: 'point', stopOnRelease: false, drag, held, maxDrag, init, control, reset };

  const has = (...ks) => ks.some((k) => keys.has(k));
  function control() {
    let ax = 0, ay = 0;
    if (has('ArrowLeft', 'a')) ax--; if (has('ArrowRight', 'd')) ax++;
    if (has('ArrowUp', 'w')) ay--; if (has('ArrowDown', 's')) ay++;
    if (api.mode === 'sides') {
      held.left = [...sides.values()].includes(-1); held.right = [...sides.values()].includes(1);
      return { turn: ax || (held.right ? 1 : 0) - (held.left ? 1 : 0), brake: ay > 0 };
    }
    const keyed = !!(ax || ay);
    return { keyed, angle: keyed ? Math.atan2(ay, ax) : course.angle, speed: keyed ? 1 : course.speed };
  }
  function reset(angle) { course = { angle, speed: 0 }; drag.active = false; sides.clear(); }

  function init(cv, o) {
    tilt = o.tilt;
    addEventListener('keydown', (e) => {
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      if (!o.onKey(k)) keys.add(k);
      if (k.startsWith('Arrow')) e.preventDefault();
    });
    addEventListener('keyup', (e) => keys.delete(e.key.length === 1 ? e.key.toLowerCase() : e.key));
    addEventListener('blur', () => { keys.clear(); sides.clear(); });
    cv.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (api.mode === 'sides') { cv.setPointerCapture(e.pointerId); sides.set(e.pointerId, e.clientX < innerWidth / 2 ? -1 : 1); return; }
      if (drag.active) return;
      cv.setPointerCapture(e.pointerId);
      Object.assign(drag, { active: true, id: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, moved: 0 });
    });
    cv.addEventListener('pointermove', (e) => {
      if (sides.has(e.pointerId)) { sides.set(e.pointerId, e.clientX < innerWidth / 2 ? -1 : 1); return; }
      if (!drag.active || e.pointerId !== drag.id) return;
      drag.x = e.clientX; drag.y = e.clientY;
      const dx = drag.x - drag.x0, dy = drag.y - drag.y0, len = Math.hypot(dx, dy);
      drag.moved = Math.max(drag.moved, len);
      // Dragging back to where it began throttles to zero.
      if (len > DEADZONE) course = { angle: Math.atan2(dy / Math.cos(tilt()), dx), speed: Math.min(len / maxDrag(), 1) };
      else if (drag.moved > DEADZONE) course.speed = 0;
    });
    // In Cruise a double-tap stops, so one stray tap doesn't throw away your speed.
    function end(e) {
      sides.delete(e.pointerId);
      if (!drag.active || e.pointerId !== drag.id) return;
      drag.active = false;
      if (api.stopOnRelease) { course.speed = 0; return; }
      if (e.type !== 'pointerup' || drag.moved >= DEADZONE) return;
      const t = e.timeStamp / 1000, double = t - lastTap <= DOUBLE_TAP;
      lastTap = double ? -Infinity : t;
      if (double) course.speed = 0;
    }
    cv.addEventListener('pointerup', end);
    cv.addEventListener('pointercancel', end);
    cv.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  return api;
})();

export { Input };
