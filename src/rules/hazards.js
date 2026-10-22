// Hazards in space: what a place does to a ship, as rates the flight view (game/hazards.js) adds up
// into the ship's meters (notes/hazards.md):
// - heat: the star's, by the square of how close the ship is (the inner planets are hot), and some
//   from hard thrust. A ship sheds heat at its cooling rate, so heat only builds where it comes in
//   faster than that, and falls away elsewhere.
// - radiation: belts round the gas giants (a band with gaps to thread, which their moons sit in)
//   and every moon close up, stronger round a giant. Radiation doesn't fall away: it builds until a
//   station decontaminates the ship. A station's shielding keeps it off its approaches (not a
//   flare's).
// - solar flares: now and then the star flares. A warning comes first; then for a few seconds a
//   wave of heat and radiation reaches everywhere in the system, stronger closer in, except where
//   a planet, a moon or a big asteroid stands between the star and the ship (its shadow).
// - ion storms: now and then a storm runs through each nebula; inside it a wind pushes the ship
//   off course and the sensors go dark.
// - fuel: thrust burns it, and so does map travel, by the distance; hydrazine refills it.
// Everything is seeded and runs on flight time (t, seconds), so the same moment gives the same
// sky: a flare can be waited out, and a test can find one.
//
//   Hazards.config                             every number, by hazard
//   Hazards.flare(seed, t) -> { phase: 'calm' | 'warning' | 'wave', in, left, start }
//     in: seconds until the next wave starts (0 during one); left: seconds of the wave left
//   Hazards.storm(seed, nebula, t) -> { wind: [x, y] } | null    a storm in that nebula at t
//   Hazards.shadowed(place, x, y, blockers?) -> body | null   what shades (x, y) from the star
//     place: a galaxy's (or a system's) { stars, planets, moons }; blockers: more { x, y, r } (asteroids)
//   Hazards.belt(planet, x, y) -> 0..1          how deep in a giant's radiation belt (x, y) is
//   Hazards.beltGaps(planet) -> [[from, to]]    its gaps, as angles (radians, from < to, may pass 2π)
//   Hazards.exposure(place, seed, x, y, t, o?) -> { heat, rad, flare, shadow, storm, star }
//     heat, rad: what comes in, per second; o: { thrust (0..1), blockers, nebula (the one there) };
//     place.stations (if given) shelter their approaches
//   Hazards.travelFuel(distance) -> fuel       map travel's cost
// ES module (`Hazards`); also runs in Node (the tests).

import { hashInt, seedToInt } from '../core/rng.js';
import { angleDiff, clamp } from '../core/math.js';

const Hazards = (() => {
  const config = {
    max: 100, // heat and radiation: the ship is disabled at this
    heat: {
      star: 20, ref: 4000, // heat per second from the star at `ref` from its centre, by (ref / distance)²
      cap: 120, // ... at most (right by the star)
      cool: 6, // what a ship sheds per second (more with radiators, later)
      thrust: 1.5, // per second at full thrust
      flare: 10, // per second in a flare's wave, at flare.ref from the star
    },
    rad: {
      belt: 6, // per second in the thick of a giant's belt
      beltIn: 150, beltOut: 1100, // the belt, from this far outside the planet to this far
      gaps: 2, gap: 0.7, // gaps in it (radians wide), placed by the planet's seed
      moon: 2, giantMoon: 4, // per second right by a moon (a gas giant's: more) ...
      moonReach: 350, // ... fading out this far beyond its surface
      flare: 4, // per second in a flare's wave, at flare.ref from the star
      shelter: 800, // no belt or moon radiation this close to a station
    },
    flare: {
      period: 200, // one flare in each stretch this long ...
      margin: 30, // ... not this close to the stretch's ends
      warn: 15, wave: 8, // seconds of warning, then of the wave
      ref: 10000, min: 0.4, max: 3, // its strength: by ref / distance from the star, kept in [min, max]
    },
    storm: { period: 150, length: 30, wind: 140 }, // ion storms: one per stretch per nebula, this long, pushing this hard (units/s²)
    fuel: { burn: 0.5, travel: 2500 }, // per second at full thrust; map travel: one per this many units
  };
  const GIANTS = ['gas', 'blue'];

  const stretchSeed = (seed, i, salt) => hashInt(i, salt, seedToInt(seed)) / 4294967296;

  // Where flight time t is in the flare cycle.
  function flare(seed, t) {
    const F = config.flare;
    const startOf = (i) => i * F.period + F.margin + stretchSeed(seed, i, 0xf1a) * (F.period - 2 * F.margin - F.wave);
    let i = Math.floor(t / F.period), start = startOf(i);
    if (t >= start + F.wave) start = startOf(++i); // this stretch's is over: the next one
    if (t >= start) return { phase: 'wave', in: 0, left: start + F.wave - t, start };
    return { phase: t >= start - F.warn ? 'warning' : 'calm', in: start - t, left: 0, start };
  }

  // A storm in a nebula at t: its wind (a direction for each storm, at full strength), or null.
  function storm(seed, nebula, t) {
    const S = config.storm, i = Math.floor(t / S.period), salt = 0x5707 + (nebula.id || 0);
    const start = i * S.period + stretchSeed(seed, i, salt) * (S.period - S.length);
    if (t < start || t >= start + S.length) return null;
    const a = stretchSeed(seed, i, salt + 0x100) * Math.PI * 2;
    return { wind: [Math.cos(a) * S.wind, Math.sin(a) * S.wind] };
  }

  // The star the ship sees: the nearest.
  const starOf = (place, x, y) => place.stars.reduce((best, s) => (!best || Math.hypot(s.x - x, s.y - y) < Math.hypot(best.x - x, best.y - y) ? s : best), null);
  // A body's shadow: on the line from the star to (x, y), between them, and within its radius of it.
  function shades(star, x, y, b, r) {
    const lx = x - star.x, ly = y - star.y, L2 = lx * lx + ly * ly;
    if (L2 < 1) return false;
    const u = ((b.x - star.x) * lx + (b.y - star.y) * ly) / L2;
    if (u <= 0 || u >= 1) return false;
    const px = star.x + lx * u - b.x, py = star.y + ly * u - b.y;
    return px * px + py * py < r * r;
  }
  function shadowed(place, x, y, blockers = []) {
    const star = starOf(place, x, y);
    if (!star) return null;
    for (const p of place.planets) if (shades(star, x, y, p, p.r)) return p;
    for (const m of place.moons) if (shades(star, x, y, m, m.r)) return m;
    for (const b of blockers) if (shades(star, x, y, b, b.r)) return b;
    return null;
  }

  // How deep in a giant's belt (x, y) is: 1 in the middle of the band, 0.5 at its edges, 0 outside
  // it or in a gap.
  function belt(p, x, y) {
    if (!GIANTS.includes(p.type)) return 0;
    const R = config.rad, edge = p.body ?? p.r, d = Math.hypot(x - p.x, y - p.y);
    const lo = edge + R.beltIn, hi = edge + R.beltOut;
    if (d < lo || d > hi) return 0;
    const a = Math.atan2(y - p.y, x - p.x);
    for (const [from, to] of beltGaps(p)) if (Math.abs(angleDiff(a, (from + to) / 2)) < (to - from) / 2) return 0;
    return 1 - Math.abs(d - (lo + hi) / 2) / (hi - lo);
  }
  function beltGaps(p) {
    const R = config.rad;
    return Array.from({ length: R.gaps }, (_, k) => {
      const centre = (hashInt(p.seed || 0, k, 0xbe17) / 4294967296) * Math.PI * 2;
      return [centre - R.gap / 2, centre + R.gap / 2];
    });
  }

  function exposure(place, seed, x, y, t, o = {}) {
    const H = config.heat, R = config.rad, F = config.flare;
    const star = starOf(place, x, y);
    const d = star ? Math.max(1, Math.hypot(x - star.x, y - star.y)) : Infinity;
    let heat = Math.min(H.cap, H.star * (H.ref / d) ** 2) + H.thrust * (o.thrust || 0);
    let rad = 0;
    const sheltered = (place.stations || []).some((s) => Math.hypot(x - s.x, y - s.y) < R.shelter);
    for (const p of sheltered ? [] : place.planets) {
      const k = belt(p, x, y);
      if (k) rad += R.belt * k;
    }
    for (const m of sheltered ? [] : place.moons) {
      const out = Math.hypot(x - m.x, y - m.y) - m.r;
      if (out >= R.moonReach) continue;
      const parent = place.planets[m.parent];
      rad += (parent && GIANTS.includes(parent.type) ? R.giantMoon : R.moon) * clamp(1 - out / R.moonReach, 0, 1);
    }
    const f = flare(seed, t);
    const shadow = f.phase === 'calm' ? null : shadowed(place, x, y, o.blockers);
    if (f.phase === 'wave' && !shadow) {
      const k = clamp(F.ref / d, F.min, F.max);
      heat += H.flare * k;
      rad += R.flare * k;
    }
    const st = o.nebula ? storm(seed, o.nebula, t) : null;
    return { heat, rad, flare: f, shadow, storm: st, star: d };
  }

  const travelFuel = (distance) => distance / config.fuel.travel;

  return { config, GIANTS, flare, storm, shadowed, belt, beltGaps, exposure, travelFuel };
})();

export { Hazards };
