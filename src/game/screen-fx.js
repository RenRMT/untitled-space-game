// Hazards on the screen, not only in the gauges (rules/screen-fx.js, notes/hazards.md): each one
// its own look, growing from its first warning step to the limit, so a glance says what's wrong
// and how badly without reading a number:
// - heat: a warm glow creeping in from the edges, breathing;
// - radiation: grain over everything, with lines of static as it nears the limit;
// - a low hull: cracks in the corners, more at each step down (cleared by a repair);
// - the shields breaking: a crackle along the edges for a moment, then a faint flicker now and
//   then while they're down;
// - low fuel shows on the ship instead: the flame sputters (flameThrust, game/draw-world.js and the
//   surface's craft in game/landing.js).
// With reduced motion (Settings) nothing breathes, flickers or crawls: the grain and glow hold still.
//
//   drawHazardScreen(w, h, time)   in screen space, over the world and under the HUD (game/loop.js
//                                  in open flight, game/landing.js on a surface)
//   flameThrust(thrust, time)      the thrust to draw the engine's flame with
// Part of the flight view.

import { COLORS } from '../core/theme.js';
import { Hazards } from '../rules/hazards.js';
import { ScreenFx } from '../rules/screen-fx.js';
import { cargo } from './cargo.js';
import { shieldNow } from './combat.js';
import { hazard } from './hazards.js';
import { reducedMotion } from './options.js';
import { SHIP, ctx } from './state.js';

const CRACKLE = 0.45; // seconds the shields' breaking shows
const FLICKER = { every: 3.2, length: 0.18 }; // the shields down: a faint flicker this often
const fx = { seed: Math.floor(Math.random() * 1e9), stage: 0, lines: [], tiles: null };

const rgba = (hex, a) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
};

export const flameThrust = (thrust, time) => (SHIP.fuel ? ScreenFx.sputter(thrust, cargo.fuel / SHIP.fuel, time, fx.seed) : thrust);

export function drawHazardScreen(w, h, time) {
  const H = Hazards.config.max;
  const L = ScreenFx.levels({ heat: hazard.heat / H, rad: cargo.rad / H });
  ctx.save();
  if (L.heat > 0) drawHeat(w, h, L.heat, time);
  if (L.rad > 0) drawGrain(w, h, L.rad);
  drawCracks(w, h);
  drawShield(w, h, time);
  ctx.restore();
}

// A glow from the edges, amber turning red, deeper as it climbs.
function drawHeat(w, h, k, time) {
  const breathe = reducedMotion() ? 1 : 0.85 + 0.15 * Math.sin(time * (2 + 3 * k));
  const cx = w / 2, cy = h / 2, far = Math.hypot(cx, cy), near = far * (0.75 - 0.35 * k);
  const g = ctx.createRadialGradient(cx, cy, near, cx, cy, far);
  const edge = k > 0.6 ? COLORS.hostile : COLORS.flame;
  g.addColorStop(0, rgba(edge, 0));
  g.addColorStop(0.6, rgba(COLORS.flame, 0.22 * k * breathe));
  g.addColorStop(1, rgba(edge, 0.6 * k * breathe));
  ctx.globalAlpha = 1;
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

// Grain: a few noise tiles made once, laid over the screen at a new offset each frame.
function noiseTiles() {
  if (fx.tiles) return fx.tiles;
  fx.tiles = [0, 1, 2].map(() => {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d'), img = g.createImageData(128, 128);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = Math.random() < 0.5 ? 255 : 0;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = Math.random() < 0.35 ? 90 + Math.random() * 120 : 0;
    }
    g.putImageData(img, 0, 0);
    return ctx.createPattern(c, 'repeat');
  });
  return fx.tiles;
}
function drawGrain(w, h, k) {
  const still = reducedMotion(), tiles = noiseTiles();
  const tile = still ? tiles[0] : tiles[Math.floor(Math.random() * tiles.length)];
  const ox = still ? 0 : Math.floor(Math.random() * 128), oy = still ? 0 : Math.floor(Math.random() * 128);
  ctx.save();
  ctx.translate(-ox, -oy);
  ctx.globalAlpha = 0.05 + 0.2 * k;
  ctx.fillStyle = tile;
  ctx.fillRect(0, 0, w + 128, h + 128);
  ctx.restore();
  if (still || k < 0.5) return;
  // Lines of static as it nears the limit.
  ctx.fillStyle = COLORS.hud;
  const n = Math.floor((k - 0.5) * 8 * Math.random());
  for (let i = 0; i < n; i++) {
    ctx.globalAlpha = 0.06 + 0.12 * Math.random();
    ctx.fillRect(0, Math.random() * h, w, 1 + Math.random() * 2);
  }
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
  const since = performance.now() / 1000 - hazard.broke, still = reducedMotion();
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
