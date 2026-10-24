// The race's controls, in one of three ways to steer (notes/race-research.md, Part C):
// - pad: a stick in a band along the bottom of the screen, under the thumb holding the phone
//   (the default on touch screens). Its base stays fixed on its home ring; a touch anywhere in the
//   band steers from there: its angle the heading, its reach the speed (as point), anywhere past the
//   rim full speed; brought back into its middle once out, it brakes. Letting go keeps the course.
// - point: the game's Cruise (game/input.js): drag anywhere to set a heading (its screen height
//   stretched back out of the view's tilt, so it points where it looks), the drag's length the
//   speed; letting go keeps the course. WASD or arrows fly that way at full speed while held.
// - sides: it flies itself at full speed; hold the left half of the screen to turn left, the right
//   half to turn right (both, or neither: straight on). A or ←, D or →: the same; S or ↓ brakes.
// Pad and point read two quick gestures from any finger, as events for the run (Run.step):
// - a tap (short and still): a hop (Space);
// - a flick (a short drag let go at once, as game/dash.js FLICK): a dash the way it went, read
//   against the craft's way by the run: forward a boost, sideways a sidestep, back an airbrake
//   (Shift: forward; Q, E: sideways). The flick's own steering is undone, so the course is kept.
// X brakes in every mode, as S or ↓ does in sides.
//
//   Input.init(canvas, { tilt: () => radians, inset: () => px, onKey: (key) => handled })
//     inset: the screen's safe area at the bottom (the home bar), kept clear of the band
//   Input.mode = 'pad' | 'point' | 'sides'
//   Input.stopOnRelease   point, pad: letting go stops (the game's Direct) instead of keeping the course
//   Input.control() -> { keyed, angle, speed, turn, brake, events }   what the controls ask for now
//     pad, point: angle (absolute) and speed (0..1); keyed: keys held (full speed their way)
//     sides: turn (−1 left, 0, +1 right)
//     events: [{ type: 'tap' } | { type: 'flick', angle } | { type: 'flick', rel }] since the run
//       last emptied it (angle: absolute, screen and world alike; rel: from the craft's way; neither: forward)
//   Input.reset(angle)    a fresh course, stopped, pointing that way
//   Input.drag            point: the drag under way, to draw: { active, x0, y0, x, y } (screen px)
//   Input.pad             pad: { active, bx, by (its base, at home), x, y (the thumb), brake } (screen px)
//   Input.home()          pad: the band and the stick's place when no thumb is on it: { x, y, y0, y1 }
//   Input.held            sides: { left, right } held, to draw
//   Input.maxDrag()       the drag that sets full speed (screen px); the stick's radius
//   Input.PAD             { band (the band's share of a portrait screen; landscape: wide), wide, inner (the brake zone, of the radius) }
//   Input.gesture({ dt, dist, moved }) -> 'tap' | 'flick' | null   a touch let go: dt s held,
//     dist px from where it began, moved px at the furthest
// ES module (`Input`); init needs a browser.

const Input = (() => {
  const DEADZONE = 8, maxDrag = () => Math.min(innerWidth, innerHeight) * 0.225;
  const TAP = { time: 0.25 }, FLICK = { time: 0.2, min: 28 }; // game/dash.js FLICK
  const PAD = { band: 0.28, wide: 0.4, inner: 0.25 };
  const drag = { active: false, id: null, x0: 0, y0: 0, x: 0, y: 0, moved: 0, t0: 0, course: null };
  const pad = { active: false, id: null, bx: 0, by: 0, x: 0, y: 0, x0: 0, y0: 0, moved: 0, t0: 0, course: null, out: false, brake: false };
  const keys = new Set(), sides = new Map(), held = { left: false, right: false }, touches = new Map(), events = [];
  let course = { angle: 0, speed: 0 }, tilt = () => 0, inset = () => 0;
  const api = { mode: 'point', stopOnRelease: false, drag, pad, held, maxDrag, home, init, control, reset, gesture, PAD };

  function gesture({ dt, dist, moved }) {
    if (dt <= TAP.time && moved < DEADZONE) return 'tap';
    if (dt <= FLICK.time && dist >= FLICK.min) return 'flick';
    return null;
  }
  function home() {
    const H = innerHeight, y1 = H - inset(), y0 = y1 - H * (H > innerWidth ? PAD.band : PAD.wide);
    return { x: innerWidth / 2, y: (y0 + y1) / 2, y0, y1 };
  }

  const has = (...ks) => ks.some((k) => keys.has(k));
  function control() {
    let ax = 0, ay = 0;
    if (has('ArrowLeft', 'a')) ax--; if (has('ArrowRight', 'd')) ax++;
    if (has('ArrowUp', 'w')) ay--; if (has('ArrowDown', 's')) ay++;
    if (api.mode === 'sides') {
      held.left = [...sides.values()].includes(-1); held.right = [...sides.values()].includes(1);
      return { turn: ax || (held.right ? 1 : 0) - (held.left ? 1 : 0), brake: ay > 0 || has('x'), events };
    }
    const keyed = !!(ax || ay);
    return { keyed, angle: keyed ? Math.atan2(ay, ax) : course.angle, speed: keyed ? 1 : course.speed, brake: (pad.active && pad.brake) || has('x'), events };
  }
  function reset(angle) {
    course = { angle, speed: 0 }; drag.active = pad.active = pad.brake = false;
    sides.clear(); touches.clear(); events.length = 0;
  }
  // A heading from a screen offset, its height stretched back out of the view's tilt.
  const heading = (dx, dy) => Math.atan2(dy / Math.cos(tilt()), dx);
  // The thumb on the pad at (x, y), from its fixed base: past the rim, full speed that way.
  function padAt(x, y) {
    const md = maxDrag(), dx = x - pad.bx, dy = y - pad.by, len = Math.hypot(dx, dy);
    if (len >= md * PAD.inner) pad.out = true;
    // Back in the middle, once it's been out: a brake, the course kept.
    pad.brake = pad.out && len < md * PAD.inner;
    if (!pad.brake && len > DEADZONE) course = { angle: heading(dx, dy), speed: Math.min(len / md, 1) };
  }

  function init(cv, o) {
    tilt = o.tilt; inset = o.inset || inset;
    addEventListener('keydown', (e) => {
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      if (e.repeat && (k === ' ' || k === 'Shift' || k === 'q' || k === 'e')) return;
      if (k === ' ') { events.push({ type: 'tap' }); e.preventDefault(); return; }
      if (k === 'Shift') { events.push({ type: 'flick' }); return; }
      if (k === 'q' || k === 'e') { events.push({ type: 'flick', rel: (k === 'q' ? -1 : 1) * Math.PI / 2 }); return; }
      if (!o.onKey(k)) keys.add(k);
      if (k.startsWith('Arrow')) e.preventDefault();
    });
    addEventListener('keyup', (e) => keys.delete(e.key.length === 1 ? e.key.toLowerCase() : e.key));
    addEventListener('blur', () => { keys.clear(); sides.clear(); });
    cv.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      cv.setPointerCapture(e.pointerId);
      const x = e.clientX, y = e.clientY, t = e.timeStamp / 1000;
      if (api.mode === 'sides') { sides.set(e.pointerId, x < innerWidth / 2 ? -1 : 1); return; }
      if (api.mode === 'pad' && !pad.active && y >= home().y0) {
        const h = home();
        Object.assign(pad, { active: true, id: e.pointerId, bx: h.x, by: h.y, x, y, x0: x, y0: y, moved: 0, t0: t, course: { ...course }, out: false, brake: false });
        padAt(x, y);
        return;
      }
      if (api.mode === 'point' && !drag.active) {
        Object.assign(drag, { active: true, id: e.pointerId, x0: x, y0: y, x, y, moved: 0, t0: t, course: { ...course } });
        return;
      }
      touches.set(e.pointerId, { x0: x, y0: y, t0: t, moved: 0 }); // only a tap or a flick
    });
    cv.addEventListener('pointermove', (e) => {
      const x = e.clientX, y = e.clientY, id = e.pointerId;
      if (sides.has(id)) { sides.set(id, x < innerWidth / 2 ? -1 : 1); return; }
      const g = touches.get(id);
      if (g) { g.moved = Math.max(g.moved, Math.hypot(x - g.x0, y - g.y0)); return; }
      const md = maxDrag();
      if (pad.active && id === pad.id) {
        pad.x = x; pad.y = y; pad.moved = Math.max(pad.moved, Math.hypot(x - pad.x0, y - pad.y0));
        padAt(x, y);
        return;
      }
      if (!drag.active || id !== drag.id) return;
      drag.x = x; drag.y = y;
      const dx = x - drag.x0, dy = y - drag.y0, len = Math.hypot(dx, dy);
      drag.moved = Math.max(drag.moved, len);
      // Dragging back to where it began throttles to zero.
      if (len > DEADZONE) course = { angle: heading(dx, dy), speed: Math.min(len / md, 1) };
      else if (drag.moved > DEADZONE) course.speed = 0;
    });
    // A touch let go: a tap hops, a flick dashes (its steering undone); else the course is kept.
    function end(e) {
      const id = e.pointerId, x = e.clientX, y = e.clientY;
      sides.delete(id);
      let g = touches.get(id), steering = false;
      if (g) touches.delete(id);
      else if (pad.active && id === pad.id) { g = pad; pad.active = pad.brake = false; steering = true; }
      else if (drag.active && id === drag.id) { g = drag; drag.active = false; steering = true; }
      else return;
      const kind = e.type === 'pointerup' ? gesture({ dt: e.timeStamp / 1000 - g.t0, dist: Math.hypot(x - g.x0, y - g.y0), moved: g.moved }) : null;
      if (steering && kind) course = g.course;
      if (kind === 'tap') events.push({ type: 'tap' });
      else if (kind === 'flick') events.push({ type: 'flick', angle: heading(x - g.x0, y - g.y0) });
      if (steering && api.stopOnRelease) course.speed = 0;
    }
    cv.addEventListener('pointerup', end);
    cv.addEventListener('pointercancel', end);
    cv.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  return api;
})();

export { Input };
