// The shape of the galaxy: a barred spiral, grown from the seed (notes/galaxy.md). Pure functions,
// no art: world/galaxy.js places the star systems by it, world/deep-space.js its deep-space sites
// and fields, and the galaxy map (ui/map.js) draws it.
// - a bulge round the centre, where the supermassive black hole sits at (0, 0),
// - a bar through the centre, at an angle from the seed,
// - two major arms rising from the bar's ends as logarithmic spirals (all winding the same way,
//   trailing the galaxy's turn), and up to two minor spurs further out,
// - a thin disc under it all, fading out at the rim (radius R), and the halo beyond.
//
//   GalaxyShape.create(seed, params?) -> shape
//     shape.R, shape.bar { angle, half, width }, shape.arms [{ index, major, a0, r0, r1, b, sense, width, strength }]
//     shape.density(x, y) -> 0..~1.5     how crowded with stars a point is (the map's glow)
//     shape.armAt(x, y) -> { arm, d, side, t, k } | null   the nearest arm's spine: d its distance
//       across (world units), side 'inner' (the trailing, dusty edge) or 'outer' (the leading,
//       star-forming edge), t how far along (0 at its root, 1 at its tip), k its strength there (0..1)
//     shape.zoneAt(x, y) -> { zone, arm, side }   zone: core, bar, arm, interarm, rim or halo
//     shape.armPoint(arm, t) -> { x, y }     a point on an arm's spine
//     shape.sample(r) -> { x, y }            a point drawn by density (r: a random stream)
// Positions are world units from the galaxy's centre. ES module (`GalaxyShape`); also runs in Node.

import { hashInt, mulberry32, seedToInt } from '../core/rng.js';

const GalaxyShape = (() => {
  const TAU = Math.PI * 2;
  const DEFAULTS = {
    radius: 1600000, // the disc's edge (R); the halo reaches past it
    bar: { half: [0.24, 0.3], width: 0.065 }, // half its length and its half-width, in R
    bulge: 0.11, // the bulge's radius, in R
    core: 0.13, // the core zone, in R
    // Arms: the pitch (degrees) of the log spirals; each arm's half-width at its root and tip (in R).
    arms: { pitch: [11, 15], width: [0.055, 0.085], reach: 0.97 },
    spurs: { count: [0, 2], from: [0.42, 0.6], length: [0.25, 0.4], strength: 0.6 },
    rim: 0.88, // past this share of R the disc is the rim; past 1.02, the halo
    halo: 1.02,
  };

  function merge(base, over) {
    if (!over) return base;
    const out = { ...base };
    for (const [k, v] of Object.entries(over)) {
      const b = base[k];
      out[k] = v && typeof v === 'object' && !Array.isArray(v) && b && typeof b === 'object' && !Array.isArray(b) ? merge(b, v) : v;
    }
    return out;
  }
  const wrap = (a) => { a %= TAU; return a > Math.PI ? a - TAU : a < -Math.PI ? a + TAU : a; };

  function create(seed, params) {
    const P = merge(DEFAULTS, params);
    const R = P.radius;
    const r = mulberry32(hashInt(seedToInt(seed), 0, 0x5ba1));
    const between = ([lo, hi]) => lo + r() * (hi - lo);

    const sense = r() < 0.5 ? 1 : -1; // which way the arms wind outward
    const bar = { angle: r() * TAU, half: between(P.bar.half) * R, width: P.bar.width * R };
    const b = Math.tan((between(P.arms.pitch) * Math.PI) / 180);
    const arms = [];
    // An arm: a log spiral r = r0 · e^(b·sense·(θ - a0)), from r0 out to r1.
    const addArm = (a0, r0, r1, major, strength) => {
      arms.push({ index: arms.length, major, a0, r0, r1, b, sense, width: P.arms.width.map((w) => w * R), strength });
    };
    addArm(bar.angle, bar.half, R * P.arms.reach, true, 1);
    addArm(bar.angle + Math.PI, bar.half, R * P.arms.reach, true, 1);
    for (let n = P.spurs.count[0] + Math.floor(r() * (P.spurs.count[1] - P.spurs.count[0] + 1)), i = 0; i < n; i++) {
      // A spur branches off a major arm part-way out and runs a while beside it.
      const host = arms[i % 2], from = between(P.spurs.from) * R;
      const at = host.a0 + host.sense * Math.log(from / host.r0) / b;
      addArm(at + host.sense * (0.5 + r() * 0.4), from, Math.min(R * P.arms.reach, from * (1 + between(P.spurs.length) * 2.2)), false, P.spurs.strength);
    }

    // The arm's spine at parameter t (0..1): its radius grows exponentially along it.
    const spanOf = (arm) => Math.log(arm.r1 / arm.r0) / arm.b; // in radians of turn
    function armPoint(arm, t) {
      const th = arm.a0 + arm.sense * spanOf(arm) * t;
      const rr = arm.r0 * Math.exp(arm.b * spanOf(arm) * t);
      return { x: Math.cos(th) * rr, y: Math.sin(th) * rr };
    }
    // Where along the ray at (rr, phi) the arm crosses, nearest to rr: its radius, or null.
    function crossing(arm, rr, phi) {
      const span = spanOf(arm);
      const base = wrap(arm.sense * (phi - arm.a0)); // the turn past the root, -π..π
      let best = null;
      for (let k = -1; k <= 3; k++) {
        const turn = base + k * TAU;
        if (turn < 0 || turn > span * 1.15) continue; // a little past the tip, where it fades out
        const rk = arm.r0 * Math.exp(arm.b * turn);
        if (best === null || Math.abs(rk - rr) < Math.abs(best.r - rr)) best = { r: rk, t: turn / span };
      }
      return best;
    }
    const cosPitch = 1 / Math.sqrt(1 + b * b);
    function armAt(x, y) {
      const rr = Math.hypot(x, y), phi = Math.atan2(y, x);
      let best = null;
      for (const arm of arms) {
        const c = crossing(arm, rr, phi);
        if (!c) continue;
        const d = Math.abs(rr - c.r) * cosPitch;
        const w = arm.width[0] + (arm.width[1] - arm.width[0]) * c.t;
        // Fading in from the root and out toward the tip.
        const k = arm.strength * Math.min(1, c.t * 6 + 0.35) * Math.max(0, Math.min(1, (1.15 - c.t) * 3.5));
        const score = d / w;
        if (!best || score < best.score) best = { arm, d, w, side: rr < c.r ? 'inner' : 'outer', t: c.t, k, score };
      }
      return best;
    }

    const bulgeR = P.bulge * R, discR = 0.34 * R;
    const fade = (rr) => {
      const u = (rr - 0.9 * R) / (0.15 * R);
      return u <= 0 ? 1 : u >= 1 ? 0 : 1 - u * u * (3 - 2 * u);
    };
    const barFrame = (x, y) => {
      const c = Math.cos(-bar.angle), s = Math.sin(-bar.angle);
      return { u: x * c - y * s, v: x * s + y * c };
    };
    function density(x, y) {
      const rr = Math.hypot(x, y);
      let v = 1.3 * Math.exp(-((rr / bulgeR) ** 2));
      const { u, v: w } = barFrame(x, y);
      v += 0.75 * Math.exp(-((u / bar.half) ** 4) - (w / bar.width) ** 2);
      v += 0.22 * Math.exp(-rr / discR) * fade(rr);
      const a = armAt(x, y);
      if (a) v += 0.85 * a.k * Math.exp(-((a.d / a.w) ** 2)) * fade(rr);
      return v;
    }

    function zoneAt(x, y) {
      const rr = Math.hypot(x, y);
      if (rr < P.core * R) return { zone: 'core', arm: null, side: null };
      const { u, v } = barFrame(x, y);
      if (Math.abs(u) < bar.half * 1.02 && Math.abs(v) < bar.width * 1.4) return { zone: 'bar', arm: null, side: null };
      if (rr > P.halo * R) return { zone: 'halo', arm: null, side: null };
      const a = armAt(x, y);
      if (a && a.d < a.w * 1.05 && a.k > 0.3) return { zone: 'arm', arm: a.arm.index, side: a.side };
      if (rr > P.rim * R) return { zone: 'rim', arm: null, side: null };
      return { zone: 'interarm', arm: null, side: null };
    }

    // A point drawn by density, inside `limit` of R (rejection sampling).
    const PEAK = 2.2;
    function sample(rnd, limit = 1.05) {
      for (let i = 0; i < 4000; i++) {
        const a = rnd() * TAU, rr = Math.sqrt(rnd()) * R * limit;
        const x = Math.cos(a) * rr, y = Math.sin(a) * rr;
        if (rnd() * PEAK < density(x, y)) return { x, y };
      }
      return { x: 0, y: 0 };
    }

    return { R, params: P, bar, arms, sense, density, armAt, zoneAt, armPoint, sample, spanOf };
  }

  return { create, params: DEFAULTS };
})();

export { GalaxyShape };
