// The background starfield: procedural, in parallax layers, batched by colour. It is also the sky
// of the galaxy round the camera (flight/deep-sites.js, the 'sky' form): inside the core's crowd of
// old stars, a globular cluster or the dwarf galaxy, a far layer fills with stars of their tint and
// the sky glows faintly with them; in the dust lanes and dark clouds the far stars dim.
// Part of the flight view; src/main.js starts it.

import { hashInt, mulberry32 } from '../core/rng.js';
import { DeepSites } from '../flight/deep-sites.js';
import { cam, ctx, lerp, ship, view } from './state.js';
import { world } from './world.js';

export const STAR_LAYERS = [
  { p: 0.04, cell: 200, n: 6, size: [0.5, 1.0], alpha: [0.2, 0.5] },
  { p: 0.12, cell: 220, n: 4, size: [0.7, 1.3], alpha: [0.3, 0.65] },
  { p: 0.3, cell: 260, n: 3, size: [1.0, 1.7], alpha: [0.4, 0.8] },
  { p: 0.65, cell: 320, n: 2, size: [1.3, 2.2], alpha: [0.5, 0.95] },
];
export const STAR_TINTS = ['#ffffff', '#cfe0ff', '#fff1d0', '#ffd9d9'];
// Stars are drawn in batches: one path per tint and brightness level per layer, instead of one
// draw call (plus colour and alpha changes) per star. Brightness is rounded to this many levels.
export const STAR_ALPHA_LEVELS = 8;
export const starBuckets = Array.from({ length: STAR_TINTS.length * STAR_ALPHA_LEVELS }, () => []); // x, y, size triples
export let starCount = 0; // stars drawn last frame, for the performance overlay

// The sky at the camera: k, how crowded (0..1) and in what tint; dust, how dusty (0..1). Looked up
// again once the camera has moved a little.
export const sky = { k: 0, tint: '#ffffff', dust: 0, x: NaN, y: NaN };
let crowds = null, crowdsOf = null;
export function skyAt(x, y) {
  const g = world.galaxy;
  if (!g) return sky;
  if (crowdsOf !== g) { crowdsOf = g; crowds = DeepSites.crowds(g); sky.x = NaN; }
  if (Math.hypot(x - sky.x, y - sky.y) < 400) return sky;
  const c = DeepSites.crowdAt(crowds, x, y);
  sky.k = c.k;
  if (c.tint) sky.tint = c.tint;
  sky.dust = g.space ? g.space.dustAt(x, y) : 0;
  sky.x = x; sky.y = y;
  return sky;
}
// The crowd: a far layer of up to CROWD.n stars a cell, each shown once the crowd passes its own
// threshold (so stars fade in one by one as it thickens, never popping all at once).
export const CROWD = { p: 0.025, cell: 90, n: 9, size: [0.6, 1.5], alpha: [0.25, 0.85], glow: 0.07 };
const crowdBuckets = Array.from({ length: 2 * STAR_ALPHA_LEVELS }, () => []);
function drawCrowd(S, dim) {
  const ox = cam.x * CROWD.p * view.zoom - view.w / 2, oy = cam.y * CROWD.p * view.zoom - view.h / 2;
  for (const b of crowdBuckets) b.length = 0;
  const c0x = Math.floor(ox / CROWD.cell), c1x = Math.floor((ox + view.w) / CROWD.cell);
  const c0y = Math.floor(oy / CROWD.cell), c1y = Math.floor((oy + view.h) / CROWD.cell);
  for (let cy = c0y; cy <= c1y; cy++) {
    for (let cx = c0x; cx <= c1x; cx++) {
      const rnd = mulberry32(hashInt(cx, cy, 0xc40d));
      for (let i = 0; i < CROWD.n; i++) {
        const x = cx * CROWD.cell + rnd() * CROWD.cell - ox, y = cy * CROWD.cell + rnd() * CROWD.cell - oy;
        const s = lerp(CROWD.size[0], CROWD.size[1], rnd()), u = rnd() * 0.95, a = rnd(), white = rnd() < 0.3;
        const fade = Math.min(1, (S.k - u) * 6);
        if (fade <= 0) continue;
        const level = Math.round(a * fade * (STAR_ALPHA_LEVELS - 1));
        crowdBuckets[(white ? STAR_ALPHA_LEVELS : 0) + level].push(x, y, s);
      }
    }
  }
  // The glow of the stars too faint to see one by one.
  ctx.globalAlpha = CROWD.glow * S.k * dim;
  ctx.fillStyle = S.tint;
  ctx.fillRect(0, 0, view.w, view.h);
  for (let bi = 0; bi < crowdBuckets.length; bi++) {
    const b = crowdBuckets[bi];
    if (!b.length) continue;
    ctx.globalAlpha = lerp(CROWD.alpha[0], CROWD.alpha[1], (bi % STAR_ALPHA_LEVELS) / (STAR_ALPHA_LEVELS - 1)) * dim;
    ctx.fillStyle = bi < STAR_ALPHA_LEVELS ? S.tint : '#ffffff';
    ctx.beginPath();
    for (let i = 0; i < b.length; i += 3) ctx.rect(b[i] - b[i + 2] / 2, b[i + 1] - b[i + 2] / 2, b[i + 2], b[i + 2]);
    ctx.fill();
    starCount += b.length / 3;
  }
}

export function drawStarfield() {
  starCount = 0;
  const S = skyAt(cam.x, cam.y);
  // Dust hides the far stars more than the near ones.
  const dimOf = (p) => 1 - 0.6 * S.dust * (1 - p);
  if (S.k > 0.01) drawCrowd(S, dimOf(0));
  for (let li = 0; li < STAR_LAYERS.length; li++) {
    const L = STAR_LAYERS[li], dim = dimOf(L.p);
    const ox = cam.x * L.p * view.zoom - view.w / 2;
    const oy = cam.y * L.p * view.zoom - view.h / 2;
    // Motion streaks scale with speed and layer depth.
    const sx = -ship.vx * L.p * view.zoom * 0.04;
    const sy = -ship.vy * L.p * view.zoom * 0.04;
    const streakLen = Math.hypot(sx, sy);
    const streak = streakLen > 1.5;

    for (const b of starBuckets) b.length = 0;
    const c0x = Math.floor(ox / L.cell), c1x = Math.floor((ox + view.w) / L.cell);
    const c0y = Math.floor(oy / L.cell), c1y = Math.floor((oy + view.h) / L.cell);
    for (let cy = c0y; cy <= c1y; cy++) {
      for (let cx = c0x; cx <= c1x; cx++) {
        const rnd = mulberry32(hashInt(cx, cy, li));
        for (let i = 0; i < L.n; i++) {
          // Same random draws, in the same order, as each star has always used.
          const x = cx * L.cell + rnd() * L.cell - ox;
          const y = cy * L.cell + rnd() * L.cell - oy;
          const s = lerp(L.size[0], L.size[1], rnd());
          const level = Math.round(rnd() * (STAR_ALPHA_LEVELS - 1));
          const tint = (rnd() * STAR_TINTS.length) | 0;
          starBuckets[tint * STAR_ALPHA_LEVELS + level].push(x, y, s);
        }
      }
    }

    // A streak is a line of width s; as a filled quad it can share a path with the others.
    const nx = streak ? -sy / streakLen / 2 : 0, ny = streak ? sx / streakLen / 2 : 0;
    for (let bi = 0; bi < starBuckets.length; bi++) {
      const b = starBuckets[bi];
      if (!b.length) continue;
      ctx.globalAlpha = lerp(L.alpha[0], L.alpha[1], (bi % STAR_ALPHA_LEVELS) / (STAR_ALPHA_LEVELS - 1)) * dim;
      ctx.fillStyle = STAR_TINTS[(bi / STAR_ALPHA_LEVELS) | 0];
      ctx.beginPath();
      for (let i = 0; i < b.length; i += 3) {
        const x = b[i], y = b[i + 1], s = b[i + 2];
        if (streak) {
          const px = nx * s, py = ny * s;
          ctx.moveTo(x + px, y + py);
          ctx.lineTo(x + sx + px, y + sy + py);
          ctx.lineTo(x + sx - px, y + sy - py);
          ctx.lineTo(x - px, y - py);
          ctx.closePath();
        } else {
          ctx.rect(x - s / 2, y - s / 2, s, s);
        }
      }
      ctx.fill();
      starCount += b.length / 3;
    }
  }
  ctx.globalAlpha = 1;
}
