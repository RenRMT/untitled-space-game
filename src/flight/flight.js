'use strict';

// How a ship flies: turning, speeding up and slowing down by its engine's numbers (rules/loadout.js
// stats: maxSpeed, accel, turnRate). The player's ship and NPC ships in a real-time fight
// (combat/combat-realtime.js) both fly by these rules.
// - Cruise: velocity eases toward heading × set speed at the engine's acceleration, so turning
//   carries some drift.
// - Direct: velocity always points along the heading (no drift); speed still changes at the
//   engine's acceleration.
// Either way the ship turns toward the set heading at its turn rate, and only while the set
// speed is above zero.
//
//   Flight.step(body, stats, { targetAngle, targetSpeed, mode }, dt)
//   body: { x, y, vx, vy, angle, thrust } (thrust 0..1, for the engine flame), updated in place.
// Works as a classic browser script (global `Flight`) and as a Node module.

const Flight = (() => {
  const { TAU, clamp, lerp } = typeof require === 'function' ? require('../core/math.js') : MathUtil;

  // Turn from a toward target by at most maxStep, the short way round.
  function turnToward(a, target, maxStep) {
    const diff = ((target - a + Math.PI) % TAU + TAU) % TAU - Math.PI;
    return a + clamp(diff, -maxStep, maxStep);
  }

  // Change v toward target by at most step.
  const approach = (v, target, step) => (v < target ? Math.min(target, v + step) : Math.max(target, v - step));

  function step(body, stats, control, dt) {
    const { targetAngle, targetSpeed, mode = 'cruise' } = control;
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

  return { step, turnToward };
})();

if (typeof module !== 'undefined') module.exports = Flight;
