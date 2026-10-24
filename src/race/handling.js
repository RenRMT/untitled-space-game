// The race's handling: how the craft grips, slides and brakes. It's the game's Cruise
// (flight/flight.js: the nose turns toward the heading at the turn rate, the velocity follows it at
// the engine's numbers), but with the change in velocity split in two, along the velocity and
// across it, so that steering alone doesn't slow the craft and a tight corner needs a lift:
// - along: the speed asked for, whichever way the nose points: speeding up at the acceleration (and
//   slowing so when over top speed, after a boost); slowing at LIFT of it when less is asked for
//   (lifting is a weak brake), at BRAKE of it braking;
// - across: the grip, GRIP of the acceleration, so the tightest circle at top speed is about
//   v² / (GRIP × accel), and a corner tighter than that is taken slower or not at all.
// The slide: the slip is the angle between the nose and the velocity. Past SLIDE.on the craft slides
// (the grip down to SLIDE.grip of it, the speed scrubbed by SLIDE.scrub × the acceleration × the
// slip's sine) until the slip is back under SLIDE.off: a change the player can learn and use.
// Slower than LOW it flies as Cruise does (the velocity has no way to be along or across).
//
//   Handling.step(body, stats, { targetAngle, targetSpeed, brake, coast }, state, dt, conf?) -> state
//   body: { x, y, vx, vy, angle, thrust }, changed in place (as Flight.step)
//   stats: { maxSpeed, accel, turnRate }; brake: held; coast: mid-dash, the body only moves
//   state: { slip (rad), sliding }, kept by the caller from step to step
//   Handling.config   { GRIP, LIFT, BRAKE, LOW, SLIDE: { on, off, grip, scrub } }   (conf: config by default)
//   Handling.tune(k) -> conf   config × a biome's handling (Config.BIOME: GRIP, LIFT, BRAKE, on, off, grip, scrub)
// ES module (`Handling`); also runs in Node (the tests).

import { MathUtil } from '../core/math.js';
import { Flight } from '../flight/flight.js';

const Handling = (() => {
  const { clamp, lerp, angleDiff } = MathUtil;
  const config = { GRIP: 0.85, LIFT: 0.35, BRAKE: 2.5, LOW: 40, SLIDE: { on: 0.42, off: 0.22, grip: 0.8, scrub: 0.3 } };

  function tune(k = {}) {
    const S = config.SLIDE, m = (v, f) => v * (f ?? 1);
    return { ...config, GRIP: m(config.GRIP, k.GRIP), LIFT: m(config.LIFT, k.LIFT), BRAKE: m(config.BRAKE, k.BRAKE), SLIDE: { on: m(S.on, k.on), off: m(S.off, k.off), grip: m(S.grip, k.grip), scrub: m(S.scrub, k.scrub) } };
  }

  function step(body, stats, control, state, dt, conf = config) {
    const { targetAngle, targetSpeed, brake = false, coast = false } = control, { GRIP, LIFT, BRAKE, LOW, SLIDE } = conf;
    if (coast) {
      body.x += body.vx * dt; body.y += body.vy * dt;
      state.slip = 0; state.sliding = false;
      return state;
    }
    const moving = targetSpeed > 0, a = stats.accel;
    if (moving) body.angle = Flight.turnToward(body.angle, targetAngle, stats.turnRate * dt);
    const hx = Math.cos(body.angle), hy = Math.sin(body.angle);
    const v = Math.hypot(body.vx, body.vy);
    state.slip = v > LOW && moving ? Math.abs(angleDiff(body.angle, Math.atan2(body.vy, body.vx))) : 0;
    state.sliding = state.sliding ? state.slip > SLIDE.off : state.slip > SLIDE.on;
    let push = 0;
    if (v <= LOW) {
      const dvx = hx * targetSpeed - body.vx, dvy = hy * targetSpeed - body.vy, dv = Math.hypot(dvx, dvy);
      if (dv > 0) { const k = Math.min(1, (a * dt) / dv); body.vx += dvx * k; body.vy += dvy * k; }
      push = dv > 5 ? (dvx * hx + dvy * hy) / dv : 0;
    } else {
      const ux = body.vx / v, uy = body.vy / v;
      // The engine holds the speed asked for whichever way the nose points; the grip swings the
      // velocity round toward the nose (all the way across it once the nose is past square).
      const c = hx * ux + hy * uy, sn = -hx * uy + hy * ux;
      const along = targetSpeed - v, across = (c > 0 ? sn : Math.sign(sn) || 1) * v;
      const byAlong = (along > 0 || v > stats.maxSpeed ? 1 : brake ? BRAKE : LIFT) * a * dt, byAcross = GRIP * (state.sliding ? SLIDE.grip : 1) * a * dt;
      const dl = clamp(along, -byAlong, byAlong), ds = clamp(across, -byAcross, byAcross);
      body.vx += ux * dl - uy * ds; body.vy += uy * dl + ux * ds;
      if (state.sliding) {
        const nv = Math.hypot(body.vx, body.vy), k = Math.max(0, 1 - (SLIDE.scrub * a * Math.sin(state.slip) * dt) / nv);
        body.vx *= k; body.vy *= k;
      }
      push = along > 5 ? 1 : 0.4;
    }
    const thrust = moving ? Math.max(0.2, push) : 0;
    body.thrust = lerp(body.thrust || 0, thrust, 1 - Math.exp(-10 * dt));
    body.x += body.vx * dt; body.y += body.vy * dt;
    return state;
  }

  return { step, tune, config };
})();

export { Handling };
