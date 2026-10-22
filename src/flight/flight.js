// How a ship flies: turning, speeding up and slowing down by its engine's numbers (rules/loadout.js
// stats: maxSpeed, accel, turnRate). The player's ship and NPC ships in a real-time fight
// (combat/combat-realtime.js) both fly by these rules.
// - Cruise: velocity eases toward heading × set speed at the engine's acceleration, so turning
//   carries some drift.
// - Direct: velocity always points along the heading (no drift); speed still changes at the
//   engine's acceleration.
// Either way the ship turns toward the set heading at its turn rate, and only while the set
// speed is above zero.
// - A dash (the player's flick, game/dash.js): a burst the way it points at DASH.speed × top
//   speed; the ship coasts on it for DASH.time (game/dash.js then gives it back the velocity it
//   had), so it's a sidestep, not a new course.
//
//   Flight.step(body, stats, { targetAngle, targetSpeed, mode, coast }, dt)
//   body: { x, y, vx, vy, angle, thrust } (thrust 0..1, for the engine flame), updated in place.
//   coast: mid-dash, the body only moves (no steering).
//   Flight.dash(body, angle, topSpeed)   starts a dash
//   Flight.DASH                          { speed (× top speed), time (s), cooldown (s) }
// ES module (`Flight`); also runs in Node (the tests).

import { MathUtil } from '../core/math.js';

const Flight = (() => {
  const { clamp, lerp, angleDiff } = MathUtil;

  // Turn from a toward target by at most maxStep, the short way round.
  function turnToward(a, target, maxStep) {
    return a + clamp(angleDiff(target, a), -maxStep, maxStep);
  }

  // Change v toward target by at most by.
  const approach = (v, target, by) => (v < target ? Math.min(target, v + by) : Math.max(target, v - by));

  const DASH = { speed: 2.5, time: 0.12, cooldown: 2 };
  function dash(body, angle, topSpeed) {
    const v = topSpeed * DASH.speed;
    body.vx = Math.cos(angle) * v;
    body.vy = Math.sin(angle) * v;
    body.angle = angle;
    body.thrust = 1;
  }

  function step(body, stats, control, dt) {
    const { targetAngle, targetSpeed, mode = 'cruise', coast = false } = control;
    if (coast) {
      body.x += body.vx * dt;
      body.y += body.vy * dt;
      return;
    }
    const moving = targetSpeed > 0;
    if (moving) body.angle = turnToward(body.angle, targetAngle, stats.turnRate * dt);
    const hx = Math.cos(body.angle), hy = Math.sin(body.angle);
    if (mode === 'direct') {
      // No drift: velocity follows the heading; its size changes at the engine's acceleration.
      let speed = approach(Math.hypot(body.vx, body.vy), targetSpeed, stats.accel * dt);
      if (!moving && speed < 5) speed = 0;
      body.vx = hx * speed;
      body.vy = hy * speed;
      const thrust = moving ? Math.max(0.2, targetSpeed / stats.maxSpeed) : 0;
      body.thrust = lerp(body.thrust || 0, thrust, 1 - Math.exp(-12 * dt));
    } else {
      const dvx = hx * targetSpeed - body.vx, dvy = hy * targetSpeed - body.vy;
      const dv = Math.hypot(dvx, dvy);
      if (dv > 0) {
        const k = Math.min(1, (stats.accel * dt) / dv);
        body.vx += dvx * k;
        body.vy += dvy * k;
      }
      const along = dv > 5 ? (dvx * hx + dvy * hy) / dv : 0;
      const thrust = moving ? Math.max(0.2, along) : 0;
      body.thrust = lerp(body.thrust || 0, thrust, 1 - Math.exp(-10 * dt));
    }
    body.x += body.vx * dt;
    body.y += body.vy * dt;
  }

  return { step, turnToward, dash, DASH };
})();

export { Flight };
