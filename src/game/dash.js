// The dash (flight/flight.js dash): a flick on the flight view (game/input.js), or Space, throws
// the ship a short way at DASH.speed × its top speed, to slip past a vent, a storm pocket or a rock.
// It costs fuel (Hazards.config.fuel.dash; more in the cold of the ice planet), comes back after
// DASH.cooldown, and for its burst and a moment after, a collision or a storm pocket does no harm.
// In open flight (a mining session too) and on a surface; not docked, landing, jumping, in the
// introduction, wrecked or in a fight with ships.
// Part of the flight view; src/main.js starts it.

import { Feedback } from '../core/feedback.js';
import { COLORS } from '../core/theme.js';
import { Flight } from '../flight/flight.js';
import { Hazards } from '../rules/hazards.js';
import { SystemMap } from '../ui/map.js';
import { cargo } from './cargo.js';
import { docked } from './docking.js';
import { outOfFuel } from './hazards.js';
import { SURFACE_SPEED, landing } from './landing.js';
import { surfaceRun } from './surface-run.js';
import { SHIP, TAU, autopilot, ctx, fight, intro, notify, ship } from './state.js';
import { warp } from './warp.js';

// t: seconds of the burst left; cool: seconds until the next.
export const dashState = { t: 0, cool: 0 };
export const DASH_SAFE = 0.15; // seconds after the burst that a hit still does no harm
// A flick: a drag let go within `time` seconds of touching down, at least `min` CSS px long.
export const FLICK = { time: 0.2, min: 28 };

export const dashing = () => dashState.t > 0;
export const dashSafe = () => dashState.t > -DASH_SAFE;
const surfaceDash = () => landing.on && landing.phase === 'surface';

// Where the ship can dash now (the fuel aside).
export function canDash() {
  if (docked || intro.on || warp.on || SystemMap.isOpen || fight.wrecked || fight.wreckT > 0) return false;
  if (fight.s && !fight.extract) return false; // a fight with ships flies by its own rules
  if (landing.on) return surfaceDash() && !landing.wrecked;
  return true;
}
// What a dash costs here: the cold of the ice planet doubles it.
export const dashFuel = () => Hazards.config.fuel.dash * (surfaceDash() && surfaceRun.site ? surfaceRun.site.fuelBurn : 1);

// Dash toward angle (radians, screen and world alike): whether it went.
export function tryDash(angle) {
  if (!canDash() || dashState.cool > 0 || outOfFuel()) return false;
  const cost = dashFuel();
  if (cargo.fuel < cost) { notify('Too little fuel to dash', 1.5, { tone: 'warn' }); return false; }
  cargo.fuel -= cost;
  const surf = surfaceDash();
  Flight.dash(surf ? landing.craft : ship, angle, SHIP.maxSpeed * (surf ? SURFACE_SPEED : 1));
  dashState.t = Flight.DASH.time;
  dashState.cool = Flight.DASH.cooldown;
  autopilot.key = null; // a dash ends an approach
  Feedback.emit('dash');
  return true;
}

export function tickDash(dt) {
  dashState.t = Math.max(-1, dashState.t - dt);
  dashState.cool = Math.max(0, dashState.cool - dt);
}

// The cooldown, as a ring round the ship filling back up (in the ship's own frame: x, y its centre,
// r the ring's radius, w its line width, all in the frame's units).
export function drawDashRing(x, y, r, w) {
  if (dashState.cool <= 0 || !canDash()) return;
  const k = 1 - dashState.cool / Flight.DASH.cooldown;
  ctx.save();
  ctx.strokeStyle = COLORS.hud;
  ctx.lineWidth = w;
  ctx.globalAlpha = 0.18;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.stroke();
  ctx.globalAlpha = 0.6;
  ctx.beginPath();
  ctx.arc(x, y, r, -Math.PI / 2, -Math.PI / 2 + k * TAU);
  ctx.stroke();
  ctx.restore();
}

// Wiring, run once every module has loaded (src/main.js): Space dashes the way the ship points.
export function init() {
  window.addEventListener('keydown', (e) => {
    if (e.key !== ' ' || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    const body = surfaceDash() ? landing.craft : ship;
    if (tryDash(body.angle)) e.preventDefault?.();
  });
}
