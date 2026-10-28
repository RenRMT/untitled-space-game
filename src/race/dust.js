// Dust kicked up off the craft's tail: a cloud in the run-off's colour while it's off the track,
// and a lighter trail in the track's colour while it slides on it. Only drawn, never flown: the run
// (Run.step) doesn't see it, so lap times don't depend on it, and it may use Math.random.
//
//   const D = Dust.create()
//   Dust.step(D, craft, { off, slide, speed }, cols, dt)   craft: { x, y, vx, vy, angle }; off: 0..1
//     off the track (Run's R.off, 0 in the air); slide: sliding on the ground; speed: top speed;
//     cols: { off, track } CSS colours
//   D.puffs   [{ x, y, z, r, t, life, a, col }] for Draw.dust
//   Dust.colours(biome, kinds) -> { off, track }   a biome's ground kinds' colours (ArtSurface.BIOMES),
//     lightened: dust is paler than the ground it comes off
//   Dust.MAX, OFF, SLIDE
// ES module (`Dust`); also runs in Node.

import { ArtSurface } from '../art/surface.js';

const Dust = (() => {
  const MAX = 140;
  // rate: puffs a second at top speed; r: a puff's radius (units); life: s; a: its alpha at most
  const OFF = { rate: 70, r: [11, 19], life: [0.8, 1.3], a: 0.7, spread: 45 };
  const SLIDE = { rate: 36, r: [5, 9], life: [0.45, 0.7], a: 0.35, spread: 25 };
  const rnd = (a, b) => a + (b - a) * Math.random();

  const create = () => ({ puffs: [], acc: { off: 0, slide: 0 } });

  function emit(D, c, o, col, n, back) {
    for (let k = 0; k < n; k++) {
      const a = c.angle + Math.PI + rnd(-0.6, 0.6), d = rnd(6, back);
      D.puffs.push({
        x: c.x + Math.cos(a) * d, y: c.y + Math.sin(a) * d, z: rnd(1, 4),
        vx: c.vx * 0.15 + rnd(-o.spread, o.spread), vy: c.vy * 0.15 + rnd(-o.spread, o.spread),
        r: rnd(o.r[0], o.r[1]), t: 0, life: rnd(o.life[0], o.life[1]), a: o.a, col,
      });
    }
  }

  function step(D, c, { off = 0, slide = false, speed = 1 }, cols, dt) {
    const v = Math.hypot(c.vx, c.vy), k = Math.min(1, v / speed);
    for (const [kind, o, on, col] of [['off', OFF, off > 0.3 && v > 60, cols.off], ['slide', SLIDE, slide && off <= 0.3, cols.track]]) {
      if (!on) { D.acc[kind] = 0; continue; }
      D.acc[kind] += o.rate * k * (kind === 'off' ? off : 1) * dt;
      const n = Math.floor(D.acc[kind]);
      D.acc[kind] -= n;
      emit(D, c, o, col, n, 22);
    }
    for (const p of D.puffs) { p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.z += 6 * dt; p.vx *= 1 - 2 * dt; p.vy *= 1 - 2 * dt; }
    D.puffs = D.puffs.filter((p) => p.t < p.life);
    if (D.puffs.length > MAX) D.puffs.splice(0, D.puffs.length - MAX);
  }

  // '#rrggbb' toward white by f.
  const lighten = (hex, f) => {
    const n = parseInt(hex.slice(1), 16), ch = [n >> 16, (n >> 8) & 255, n & 255].map((x) => Math.round(x + (255 - x) * f));
    return `rgb(${ch.join(',')})`;
  };
  function colours(biome, kinds) {
    const B = ArtSurface.BIOMES[ArtSurface.SURFACE_OF[biome] || biome];
    return { off: lighten(B[kinds.off].col, 0.3), track: lighten(B[kinds.track].col, 0.35) };
  }

  return { create, step, colours, MAX, OFF, SLIDE };
})();

export { Dust };
