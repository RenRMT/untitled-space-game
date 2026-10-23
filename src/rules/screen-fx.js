// How strongly each hazard shows on the screen (game/screen-fx.js, notes/hazards.md): nothing in
// plain flight, then growing from a meter's first warning step to its limit. Each has its own look,
// so they can be told apart without their colour: heat a glow from the edges, radiation grain over
// everything, a low hull cracks in the corners, low fuel an engine that sputters.
//
//   ScreenFx.config                          the thresholds (shares of each meter)
//   ScreenFx.levels({ heat, rad, fuel }) -> { heat, rad, fuel }   each 0..1 (meters as shares 0..1)
//   ScreenFx.crackStage(hull) -> 0..3        hull: a share; a stage more at each of config.cracks
//   ScreenFx.cracks(seed, stage) -> [{ corner, pts: [[x, y]], w }]   seeded, stable: a stage keeps the
//     cracks of the ones before. corner 0..3 (top left, top right, bottom right, bottom left); points
//     in shares of the screen's shorter side, inward from that corner; w: the stroke's weight
//   ScreenFx.sputter(thrust, fuel, t) -> the thrust to draw the flame with (fuel: a share): as is
//     above config.fuel[0], choking out in short seeded gaps below it, more often as it empties
// ES module (`ScreenFx`); also runs in Node (the tests).

import { hashInt } from '../core/rng.js';

const ScreenFx = (() => {
  const config = {
    heat: [0.6, 0.95], // from the first heat warning to nearly overheated
    rad: [0.5, 0.9],
    fuel: [0.25, 0], // falling
    cracks: [0.5, 0.25, 0.1], // hull shares that each add a stage of cracks
    sputter: { slot: 0.09, gap: [0.12, 0.55] }, // seconds a flicker lasts; the chance of a gap, at 25% fuel and empty
  };

  const smoothstep = (a, b, x) => {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };
  const levels = ({ heat = 0, rad = 0, fuel = 1 }) => ({
    heat: smoothstep(config.heat[0], config.heat[1], heat),
    rad: smoothstep(config.rad[0], config.rad[1], rad),
    fuel: smoothstep(config.fuel[0], config.fuel[1], fuel),
  });
  const crackStage = (hull) => config.cracks.filter((s) => hull < s).length;

  const frac = (seed, a, b) => hashInt(seed | 0, a, b) / 4294967296;
  // One crack: a jagged line in from a corner, with a branch or two.
  function crack(seed, n) {
    const r = (k) => frac(seed, n, k);
    const corner = Math.floor(r(1) * 4);
    let a = 0.15 + r(2) * 1.25, x = r(3) * 0.06, y = r(4) * 0.06; // heading in from the corner (0..π/2)
    const pts = [[x, y]], len = 0.14 + r(5) * 0.16, steps = 5 + Math.floor(r(6) * 3);
    const out = [];
    for (let i = 0; i < steps; i++) {
      a += (r(10 + i) - 0.5) * 0.9;
      a = Math.min(1.5, Math.max(0.07, a));
      x += Math.cos(a) * (len / steps);
      y += Math.sin(a) * (len / steps);
      pts.push([x, y]);
      if (i > 0 && i < steps - 1 && r(20 + i) < 0.3) { // a branch off this point
        const b = a + (r(30 + i) < 0.5 ? -1 : 1) * (0.5 + r(40 + i) * 0.5), bl = len * (0.2 + r(50 + i) * 0.25);
        out.push({ corner, pts: [[x, y], [x + Math.cos(b) * bl * 0.5, y + Math.sin(b) * bl * 0.5], [x + Math.cos(b + 0.3) * bl, y + Math.sin(b + 0.3) * bl]], w: 0.6 });
      }
    }
    const inside = (c) => ({ ...c, pts: c.pts.map(([px, py]) => [Math.max(0, px), Math.max(0, py)]) }); // a branch may turn back past the edge
    return [{ corner, pts, w: 1 }, ...out].map(inside);
  }
  function cracks(seed, stage) {
    const out = [];
    for (let s = 1; s <= stage; s++) for (let i = 0; i < s + 1; i++) out.push(...crack(seed, s * 16 + i));
    return out;
  }

  function sputter(thrust, fuel, t, seed = 0) {
    const k = levels({ fuel }).fuel;
    if (thrust <= 0 || k <= 0) return thrust;
    const S = config.sputter, slot = Math.floor(t / S.slot);
    const gap = S.gap[0] + (S.gap[1] - S.gap[0]) * k;
    return frac(seed, slot, 1) < gap ? thrust * 0.1 : thrust * (1 - 0.35 * k * frac(seed, slot, 2));
  }

  return { config, levels, crackStage, cracks, sputter };
})();

export { ScreenFx };
