// Jumping through a gate (game/docking.js jump()) as a short sequence rather than a cut, to show
// that the gate takes you far, and fast: the ship spools up and dives into the gate's ring while
// the view pulls back, the screen streaks into hyperspace with the destination named and the
// distance covered counting up, a flash hides the swap, and the ship coasts out of the gate at the
// other end and comes to rest. Controls, the map and the context menu are off while it runs.
//
//   startWarp(gate, there, onArrive)   from beside `gate` (an entity) to `there` (its linked gate);
//                                      onArrive() runs once the ship is at rest on the far side
//   warp.on                            whether a jump is under way
//   tickWarp(dt) -> true while it steers the ship (the flight step is skipped)
//   warpZoom(), warpShipScale()        the view's zoom and the ship's size, as factors (the camera
//                                      holds on the ship meanwhile, without its usual lead)
//   drawWarpWorld(), drawWarpOverlay() the gates' glow (world coordinates) and the streaks and
//                                      words (screen)
// Part of the flight view.

import { Format } from '../core/format.js';
import { angleDiff, smoothstep } from '../core/math.js';
import { Theme } from '../core/theme.js';
import { rx, ry } from './draw-world.js';
import { placeShip } from './outfitting.js';
import { TAU, ctx, setMode, ship, view, whiteOut } from './state.js';
import { world } from './world.js';

// Seconds: into the gate (the swap at its end), then out of the far one.
export const WARP = { dive: 0.85, out: 0.85 };
export const warp = { on: false, t: 0, gate: null, there: null, onArrive: null, from: null, dir: 0, angle0: 0, dist: 0, name: '' };

const STREAKS = Array.from({ length: 110 }, (_, i) => {
  const h = (n) => { const x = Math.sin((i + 1) * n) * 43758.5453; return x - Math.floor(x); };
  return { a: h(12.9898) * Math.PI * 2, p: h(78.233), w: 0.6 + h(39.425) * 1.2, len: 0.5 + h(91.17) * 0.7 };
});

export function startWarp(gate, there, onArrive) {
  const dir = Math.atan2(gate.y - ship.y, gate.x - ship.x);
  const system = world.galaxy.systems[there.gate.system];
  Object.assign(warp, {
    on: true, t: 0, gate, there, onArrive, from: { x: ship.x, y: ship.y }, dir, angle0: ship.angle,
    dist: Math.hypot(there.x - gate.x, there.y - gate.y), name: `${system.name} system`,
  });
  setMode('warping', true);
}

// How far through the dive (0..1) and the way out (0..1).
const dive = () => Math.min(1, warp.t / WARP.dive);
const out = () => Math.max(0, (warp.t - WARP.dive) / WARP.out);
// The hyperspace effect's strength: rising through the dive, gone by the end of the way out.
const rush = () => (warp.t < WARP.dive ? smoothstep(0.25, 1, dive()) : 1 - smoothstep(0, 0.8, out()));

export function tickWarp(dt) {
  if (!warp.on) return false;
  const before = warp.t;
  warp.t += dt;
  if (before < WARP.dive) {
    // The dive: turn to the gate and accelerate through its centre (reached at u ≈ 0.8).
    const u = dive(), d0 = Math.hypot(warp.gate.x - warp.from.x, warp.gate.y - warp.from.y);
    const s = d0 * 1.55 * u * u, v = (d0 * 3.1 * u) / WARP.dive;
    ship.x = warp.from.x + Math.cos(warp.dir) * s;
    ship.y = warp.from.y + Math.sin(warp.dir) * s;
    ship.vx = Math.cos(warp.dir) * v;
    ship.vy = Math.sin(warp.dir) * v;
    ship.angle = ship.targetAngle = warp.angle0 + angleDiff(warp.angle0, warp.dir) * smoothstep(0, 0.3, u);
    ship.thrust = 1;
    if (warp.t >= WARP.dive) { // the swap, under the flash
      const a = warp.there.angle + Math.PI; // a gate's angle points out from its star
      placeShip(warp.there.x, warp.there.y, a);
      whiteOut();
    }
    return true;
  }
  // The way out: from the far gate's centre, slowing to rest clear of its ring.
  const u = Math.min(1, out()), a = warp.there.angle + Math.PI, reach = warp.there.radius + 180;
  const s = reach * (1 - (1 - u) ** 3), v = (reach * 3 * (1 - u) ** 2) / WARP.out;
  ship.x = warp.there.x + Math.cos(a) * s;
  ship.y = warp.there.y + Math.sin(a) * s;
  ship.vx = Math.cos(a) * v;
  ship.vy = Math.sin(a) * v;
  ship.thrust = 1 - u;
  if (u >= 1) {
    ship.vx = ship.vy = 0;
    ship.targetSpeed = ship.thrust = 0;
    warp.on = false;
    setMode('warping', false);
    if (warp.onArrive) warp.onArrive();
  }
  return true;
}

// The view pulls back as the ship gathers speed, and arrives a little close, settling.
export const warpZoom = () => (!warp.on ? 1 : warp.t < WARP.dive ? 1 - 0.18 * smoothstep(0, 1, dive()) : 1 + 0.15 * (1 - smoothstep(0, 1, out())));
// The ship shrinks into the gate's ring, and grows out of the far one.
export const warpShipScale = () => (!warp.on ? 1 : warp.t < WARP.dive ? 1 - smoothstep(0.7, 1, dive()) : smoothstep(0, 0.3, out()));

// The gates' apertures light up: the near one through the dive, the far one as the ship leaves it.
export function drawWarpWorld() {
  if (!warp.on) return;
  const [g, k] = warp.t < WARP.dive ? [warp.gate, smoothstep(0, 0.8, dive())] : [warp.there, 1 - smoothstep(0, 1, out())];
  const x = rx(g.x), y = ry(g.y), r = g.radius * 0.55;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const grad = ctx.createRadialGradient(x, y, 0, x, y, r * (1 + 0.4 * k));
  grad.addColorStop(0, `rgba(220, 250, 255, ${0.9 * k})`);
  grad.addColorStop(0.5, `rgba(125, 249, 255, ${0.45 * k})`);
  grad.addColorStop(1, 'rgba(125, 249, 255, 0)');
  ctx.fillStyle = grad;
  ctx.beginPath(); ctx.arc(x, y, r * (1 + 0.4 * k), 0, TAU); ctx.fill();
  ctx.restore();
}

// Streaks rushing out from just ahead of the ship, a tint, and the destination with the distance
// counting up; in screen pixels.
export function drawWarpOverlay() {
  if (!warp.on) return;
  const k = rush(), W = view.w, H = view.h;
  const heading = warp.t < WARP.dive ? warp.dir : warp.there.angle + Math.PI;
  const cx = W / 2 + Math.cos(heading) * Math.min(W, H) * 0.12, cy = H / 2 + Math.sin(heading) * Math.min(W, H) * 0.12;
  const R = Math.hypot(W, H) * 0.6;
  ctx.save();
  ctx.fillStyle = `rgba(20, 60, 90, ${0.35 * k})`;
  ctx.fillRect(0, 0, W, H);
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';
  const speed = 1.2 + 2.6 * k;
  for (const s of STREAKS) {
    const f = (s.p + warp.t * speed * s.w) % 1, d = f * f * R, len = d * s.len * (0.15 + 0.6 * k);
    if (d < 12) continue;
    const ca = Math.cos(s.a), sa = Math.sin(s.a);
    ctx.strokeStyle = `rgba(200, 245, 255, ${Math.min(1, k * (0.25 + f) * 0.9)})`;
    ctx.lineWidth = 1 + f * 2;
    ctx.beginPath();
    ctx.moveTo(cx + ca * d, cy + sa * d);
    ctx.lineTo(cx + ca * (d + len), cy + sa * (d + len));
    ctx.stroke();
  }
  ctx.restore();
  // The words, below the middle (clear of the gate the ship dives into): where to, and how far,
  // counting up through the jump.
  const show = Math.min(smoothstep(0.15, 0.4, dive()), 1 - smoothstep(0.4, 0.9, out()));
  if (show <= 0) return;
  const covered = warp.dist * smoothstep(0.2, 1, Math.min(1, warp.t / (WARP.dive + WARP.out * 0.4)));
  ctx.save();
  ctx.globalAlpha = show;
  ctx.textAlign = 'center';
  ctx.fillStyle = Theme.color.dim;
  ctx.font = Theme.font(12);
  ctx.fillText('JUMPING TO', W / 2, H * 0.7 - 26);
  ctx.fillStyle = Theme.color.cyan;
  ctx.font = Theme.font(22);
  ctx.fillText(warp.name.toUpperCase(), W / 2, H * 0.7);
  ctx.fillStyle = Theme.color.hud;
  ctx.font = Theme.font(14);
  ctx.fillText(Format.dist(covered), W / 2, H * 0.7 + 24);
  ctx.restore();
}
