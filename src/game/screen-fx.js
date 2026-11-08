// Damage on the screen, not only in the gauges (rules/screen-fx.js): each its own look, so a
// glance says what's wrong and how badly without reading a number:
// - a low hull: cracks in the corners, more at each step down (cleared by a repair);
// - the shields breaking: a crackle along the edges for a moment, then a faint flicker now and
//   then while they're down (and a notice and a vibration as they go: trackShields).
// With reduced motion (Settings) nothing flickers or crawls.
//
//   drawHazardScreen(w, h, time)   in screen space, over the world and under the HUD (game/loop.js
//                                  in open flight, game/landing.js on a surface)
//   trackShields()                 each step: notes the moment the shields break
// Part of the flight view.

import { COLORS } from '../core/theme.js';
import { ScreenFx } from '../rules/screen-fx.js';
import { cargo } from './cargo.js';
import { shieldNow } from './combat.js';
import { Feedback } from '../core/feedback.js';
import { reducedMotion } from './options.js';
import { SHIP, ctx, notify } from './state.js';

const CRACKLE = 0.45; // seconds the shields' breaking shows
const FLICKER = { every: 3.2, length: 0.18 }; // the shields down: a faint flicker this often
const fx = { seed: Math.floor(Math.random() * 1e9), stage: 0, lines: [], tiles: null };

const rgba = (hex, a) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
};

// The shields as last seen (0..1 of full), and when they last broke (performance.now, s).
const shields = { was: null, broke: -Infinity };
// Each step, in space or on a surface: the shields breaking (a notice, a vibration, and the crackle).
export function trackShields() {
  const now = shieldNow();
  if (SHIP.shield && shields.was !== null && shields.was >= 1 && now < 0.5) {
    shields.broke = performance.now() / 1000;
    notify('Shields down · the hull takes the next hit', 2.5, { tone: 'warn' });
    Feedback.emit('hazard');
  }
  shields.was = now;
}

export function drawHazardScreen(w, h, time) {
  ctx.save();
  drawCracks(w, h);
  drawShield(w, h, time);
  ctx.restore();
}

// Cracks in the corners, each stage keeping the last's; new ones after a repair.
function drawCracks(w, h) {
  const stage = SHIP.hull ? ScreenFx.crackStage(cargo.hull / SHIP.hull) : 0;
  if (stage !== fx.stage) {
    if (stage === 0) fx.seed = Math.floor(Math.random() * 1e9);
    fx.stage = stage;
    fx.lines = ScreenFx.cracks(fx.seed, stage);
  }
  if (!stage) return;
  const s = Math.min(w, h);
  const at = (corner, [x, y]) => [corner === 1 || corner === 2 ? w - x * s : x * s, corner >= 2 ? h - y * s : y * s];
  ctx.lineJoin = 'miter';
  ctx.lineCap = 'round';
  for (const [color, width, alpha] of [['#000000', 3.6, 0.5], [COLORS.bright, 1.4, 0.8]]) {
    ctx.strokeStyle = color;
    ctx.globalAlpha = alpha;
    for (const c of fx.lines) {
      ctx.lineWidth = width * c.w;
      ctx.beginPath();
      c.pts.forEach((p, i) => { const [x, y] = at(c.corner, p); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
      ctx.stroke();
    }
  }
}

// The shields breaking: a crackle along the edges; then while down, a faint flicker now and then.
function drawShield(w, h, time) {
  if (!SHIP.shield) return;
  const since = performance.now() / 1000 - shields.broke, still = reducedMotion();
  let k = 0;
  if (since < CRACKLE) k = 1 - since / CRACKLE;
  else if (shieldNow() < 0.5 && !still && time % FLICKER.every < FLICKER.length) k = 0.25;
  if (k <= 0) return;
  ctx.strokeStyle = COLORS.cyan;
  ctx.lineWidth = 2;
  ctx.globalAlpha = 0.8 * k;
  const edge = (x0, y0, x1, y1, nx, ny) => {
    const steps = 24;
    ctx.beginPath();
    for (let i = 0; i <= steps; i++) {
      const t = i / steps, j = (still ? 0.5 : Math.random()) * 10 * k;
      const x = x0 + (x1 - x0) * t + nx * j, y = y0 + (y1 - y0) * t + ny * j;
      if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
    }
    ctx.stroke();
  };
  edge(0, 2, w, 2, 0, 1);
  edge(0, h - 2, w, h - 2, 0, -1);
  edge(2, 0, 2, h, 1, 0);
  edge(w - 2, 0, w - 2, h, -1, 0);
  // A wash in from the edges under the crackle.
  const g = ctx.createRadialGradient(w / 2, h / 2, Math.hypot(w, h) * 0.3, w / 2, h / 2, Math.hypot(w, h) / 2);
  g.addColorStop(0, rgba(COLORS.cyan, 0));
  g.addColorStop(1, rgba(COLORS.cyan, 0.35 * k));
  ctx.globalAlpha = 1;
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}
