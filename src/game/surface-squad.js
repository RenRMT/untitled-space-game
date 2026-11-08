// The squad on a surface: the wingmen land with the ship and follow it over the ground and through
// a dungeon's caverns, then fight beside it (game/combat.js engageOnSurface: their programs, as in
// space). Out of a fight each follows the ship's own trail (TRAIL: a breadcrumb every few units), so
// they take the passages it took instead of cutting through rock; walls stop them, as they stop
// every ship in a surface fight (surfaceWalls, combat/combat-realtime.js s.blocked). On the surface
// their ships (state.js wings) are in the surface's units; taking off puts them back in formation
// in space (game/squad.js snapWings).
// Part of the flight view (game/surface-run.js, game/landing.js).
//
//   landSquad(W), liftSquad(), tickSurfaceSquad(dt), drawSurfaceSquad(v, zoom, dpr, time), surfaceWalls()

import { Art } from '../art/render.js';
import { ArtSurface } from '../art/surface.js';
import { SurfaceGlobe } from '../art/surface-globe.js';
import { Entities } from '../flight/entities.js';
import { Flight } from '../flight/flight.js';
import { COLORS } from '../core/theme.js';
import { landing } from './landing.js';
import { artStyle } from './options.js';
import { activeSquad, snapWings } from './squad.js';
import { clamp, ctx, fight, wings } from './state.js';

export const TRAIL = { step: 14, gap: 70, max: 400 }; // a crumb every `step` units; each wingman `gap` further back
const SPEED = 0.5, ACCEL = 0.6, SCALE = 0.85; // as the player's ship on a surface (game/landing.js)
const run = { W: null, trail: [] };

// The walls of the surface the ship is on, as a fight takes them: whether a ship of radius r at
// (x, y) would be in rock.
export function surfaceWalls() {
  const W = run.W || null;
  return W ? (x, y, r) => ArtSurface.blocked(W, x, y, r) : null;
}

const members = () => activeSquad().map((m) => wings.get(m.id)).filter(Boolean);

// Set down beside the ship, in a line behind it along its heading.
export function landSquad(W) {
  run.W = W;
  const C = landing.craft;
  run.trail = [{ x: C.x, y: C.y }];
  members().forEach((w, i) => {
    const back = (i + 1) * TRAIL.gap * 0.6;
    let x = C.x - Math.cos(C.angle) * back, y = C.y - Math.sin(C.angle) * back;
    if (ArtSurface.blocked(W, x, y, w.radius * 0.6)) { x = C.x; y = C.y; }
    Object.assign(w, { x, y, vx: 0, vy: 0, angle: C.angle, a: C.angle, thrust: 0 });
  });
}
// Back to space with the ship.
export function liftSquad() {
  run.W = null;
  run.trail = [];
  snapWings();
}

// The point `d` units back along the ship's trail (the oldest crumb past its end).
function along(d) {
  const T = run.trail, C = landing.craft;
  let prev = { x: C.x, y: C.y };
  for (let i = T.length - 1; i >= 0; i--) {
    const p = T[i], seg = Math.hypot(p.x - prev.x, p.y - prev.y);
    if (d <= seg) { const k = seg ? d / seg : 0; return { x: prev.x + (p.x - prev.x) * k, y: prev.y + (p.y - prev.y) * k }; }
    d -= seg;
    prev = p;
  }
  return prev;
}

// Each step on the surface: the trail grows as the ship flies; out of a fight, each wingman flies
// to its place on it, sliding along walls.
export function tickSurfaceSquad(dt) {
  const W = run.W, C = landing.craft;
  if (!W) return;
  const last = run.trail[run.trail.length - 1];
  if (!last || Math.hypot(C.x - last.x, C.y - last.y) >= TRAIL.step) {
    run.trail.push({ x: C.x, y: C.y });
    if (run.trail.length > TRAIL.max) run.trail.shift();
  }
  if (fight.s && !fight.extract) return; // the fight flies them
  const lead = Math.hypot(C.vx, C.vy);
  members().forEach((w, i) => {
    const st = along((i + 1) * TRAIL.gap), d = Math.hypot(st.x - w.x, st.y - w.y);
    if (d > TRAIL.gap * 8) { Object.assign(w, st, { vx: 0, vy: 0 }); return; }
    const stats = { ...w.stats, maxSpeed: w.stats.maxSpeed * SPEED, accel: w.stats.accel * ACCEL };
    const there = d < 12, x0 = w.x, y0 = w.y;
    Flight.step(w, stats, {
      targetAngle: there ? C.angle : Math.atan2(st.y - w.y, st.x - w.x),
      targetSpeed: there ? Math.min(lead, stats.maxSpeed) : Math.min(stats.maxSpeed, lead + d * 1.5), mode: 'cruise',
    }, dt);
    if (ArtSurface.blocked(W, w.x, y0, w.radius * 0.6)) { w.x = x0; w.vx = 0; }
    if (ArtSurface.blocked(W, w.x, w.y, w.radius * 0.6)) { w.y = y0; w.vy = 0; }
    w.a = w.angle;
  });
}

// The wingmen over the ground, at the ship's flying height, with their hull while it's down.
export function drawSurfaceSquad(v, zoom, dpr, time) {
  if (!run.W) return;
  const style = artStyle.value;
  for (const w of members()) {
    const p = SurfaceGlobe.toScreen(v, w.x, w.y, ArtSurface.FLY);
    if (!p) continue;
    const k = (w.radius * Entities.SHIP_SCALE * SCALE) / w.art.radius;
    ctx.save();
    ctx.setTransform(dpr * zoom, 0, 0, dpr * zoom, 0, 0);
    ctx.translate(p[0], p[1]);
    ctx.save();
    ctx.scale(k, k);
    Art.drawAsset(ctx, w.art, style, { angle: w.angle, t: time, thrust: w.thrust || 0 });
    ctx.restore();
    const m = w.member, max = w.stats.hull;
    if (m && m.hullPoints < max) {
      const bw = w.radius * 2.2, y = -w.radius * 1.6 - 6;
      ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
      ctx.fillRect(-bw / 2, y, bw, 4);
      ctx.fillStyle = COLORS.good;
      ctx.fillRect(-bw / 2, y, bw * clamp(m.hullPoints / max, 0, 1), 4);
    }
    ctx.restore();
  }
}
