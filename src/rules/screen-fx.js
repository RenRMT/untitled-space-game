// How damage shows on the screen (game/screen-fx.js): a low hull cracks the corners, a stage more
// at each step down, so it can be told without reading a number.
//
//   ScreenFx.config                          the thresholds (hull shares)
//   ScreenFx.crackStage(hull) -> 0..3        hull: a share; a stage more at each of config.cracks
//   ScreenFx.cracks(seed, stage) -> [{ corner, pts: [[x, y]], w }]   seeded, stable: a stage keeps the
//     cracks of the ones before. corner 0..3 (top left, top right, bottom right, bottom left); points
//     in shares of the screen's shorter side, inward from that corner; w: the stroke's weight
// ES module (`ScreenFx`); also runs in Node (the tests).

import { hashInt } from '../core/rng.js';

const ScreenFx = (() => {
  const config = {
    cracks: [0.5, 0.25, 0.1], // hull shares that each add a stage of cracks
  };

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

  return { config, crackStage, cracks };
})();

export { ScreenFx };
