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
// - fuel: what bold moves cost: a dash, taking off from a surface, and map travel, by the distance.
//   Flying about is free. Docking refills it (hydrazine first, then credits).
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
//   config.fuel.dash: what a dash costs (game/dash.js; × the surface's fuelBurn: the cold)
//
// On a surface (game/landing.js, game/surface-run.js) each kind of body has its own hazard, and
// something worth landing for (notes/hazards.md §4, §6):
// - the day side: the surface turns, and for part of each day the landing site is in sunlight, where
//   heat climbs (fast on the lava and desert planets and on the airless moons; harmless on the
//   Terran, ice and gas worlds). The countdown to sunrise is on the HUD;
// - lava: hot vents (the glowing holes) heat the ship over them; desert: dust storms darken the view
//   and push the ship about; moons: steady radiation (more round a giant); ice: the cold makes the
//   dashes cost twice the fuel; gas giants: the storm pockets burn the ship that touches one;
// - taking off costs fuel, by the body's gravity and how full the hold is.
//
//   Hazards.surface(kind, type, seed, parentType?) -> site   kind: 'planet' | 'moon'; a moon's
//     parentType: its planet's type. site: { id, label, tag (the hazard in a word or two), hazard, gravity, heat, day, rad, fuelBurn,
//     dust, vents, pockets, deposits: [[good, weight]], material, rich, seed }   rich: what the site's
//     danger pays (×: how many nodes its field holds, rules/mining.js deposits)
//   Hazards.daylight(site, t) -> { day, in, left }   day: in sunlight; in: seconds to sunrise (0 by
//     day); left: seconds of daylight left
//   Hazards.dust(site, t) -> { wind: [x, y] } | null   a dust storm at t (desert)
//   Hazards.surfaceExposure(site, t, o?) -> { heat, rad, day, dust }   per second; o: { thrust (0..1),
//     vent (0..1: how close over a vent) }
//   Hazards.takeoffFuel(gravity, holdFill) -> fuel   holdFill: 0 (empty) .. 1 (full)
//
// What a ship's utility gear (rules/loadout.js stats: cool, radGuard) does to that, in space and on
// a surface alike:
//   Hazards.shed(stats) -> heat per second the ship sheds (config.heat.cool, more with radiators)
//   Hazards.radTaken(rate, stats) -> the radiation per second that gets through its shielding
// ES module (`Hazards`); also runs in Node (the tests).

import { hashInt, seedToInt } from '../core/rng.js';
import { angleDiff, clamp } from '../core/math.js';

const Hazards = (() => {
  const config = {
    max: 100, // heat and radiation: the ship is disabled at this
    heat: {
      star: 20, ref: 4000, // heat per second from the star at `ref` from its centre, by (ref / distance)²
      cap: 120, // ... at most (right by the star)
      cool: 6, // what a ship sheds per second (more with radiators: shed)
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
    fuel: { travel: 2500, dash: 2 }, // map travel: one per this many units; a dash (× a surface's fuelBurn)
    surface: {
      day: { period: 240, length: 80 }, // a day on every surface: this long, this much of it in sunlight
      vent: 30, ventReach: 40, // heat per second right over a vent, fading out this far past its rim
      dust: { period: 100, length: 25, wind: 60 }, // dust storms on the desert: the ship drifts with the wind at this (surface units/s)
      pocket: 12, pocketReach: 12, // hull per second touching a gas giant's storm pocket (within this of it)
      takeoff: { base: 3, hold: 7 }, // fuel to take off: (base + hold × how full the hold is) × gravity
    },
  };
  // The bodies' surfaces: heat (per second, always) and day (more in sunlight), radiation, gravity,
  // fuel a dash costs (×), the deposits there, by weight, and how rich the ground is for its
  // danger (rich ×: the mild Terran planet 1, the lava planet 2). A ship sheds heat.cool a second,
  // so heat below that never builds. Moons by their type; a giant's moons are twice as radioactive.
  const body = (o) => ({ heat: 0, day: 0, rad: 0, gravity: 1, fuelBurn: 1, dust: false, vents: false, pockets: false, material: 'rock', rich: 1, ...o });
  const SURFACES = {
    lava: body({ label: 'Lava planet', tag: 'Heat', hazard: 'Heat, worst by day; hot vents', heat: 7, day: 14, gravity: 0.9, vents: true, rich: 2, deposits: [['tungsten', 3], ['iron', 1]] }),
    desert: body({ label: 'Desert planet', tag: 'Dust storms', hazard: 'Dust storms; hot by day', heat: 3, day: 12, gravity: 0.8, dust: true, rich: 1.5, deposits: [['rare-earths', 3], ['silicates', 1]] }),
    terran: body({ label: 'Terran planet', tag: 'Mild', hazard: 'Mild', day: 4, deposits: [['iron', 1], ['silicates', 1]] }),
    ice: body({ label: 'Ice planet', tag: 'Cold', hazard: 'Cold: dashes cost twice the fuel', day: 3, gravity: 0.7, fuelBurn: 2, rich: 1.25, deposits: [['deuterium', 1]] }),
    gas: body({ label: 'Gas giant', tag: 'Storm pockets', hazard: 'Storm pockets burn the hull', day: 5, gravity: 1.6, pockets: true, material: 'gas', rich: 1.5, deposits: [['deuterium', 1]] }),
    moon: body({ label: 'Moon', tag: 'Radiation', hazard: 'Radiation; hot by day', day: 10, rad: 0.8, gravity: 0.3, rich: 1.5 }),
  };
  const MOON_DEPOSITS = {
    grey: [['titanium-ore', 1]], rust: [['titanium-ore', 2], ['iron', 1]], dark: [['silicates', 1]],
    sulfur: [['sulfur', 1]], ice: [['deuterium', 1]],
  };
  const PLANET_SURFACE = { lava: 'lava', desert: 'desert', terran: 'terran', blue: 'gas', gas: 'gas', ice: 'ice' };
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

  // ---------- Surfaces ----------

  function surface(kind, type, seed, parentType) {
    if (kind === 'moon') {
      const giant = GIANTS.includes(parentType), base = SURFACES.moon;
      return { ...base, id: `moon-${type}`, seed, rad: base.rad * (giant ? 2 : 1), rich: giant ? 2 : base.rich, hazard: giant ? 'Strong radiation (a giant\'s moon); hot by day' : base.hazard, deposits: MOON_DEPOSITS[type] || [['silicates', 1]] };
    }
    const id = PLANET_SURFACE[type] || 'terran';
    return { ...SURFACES[id], id, seed };
  }
  // Each body's day starts at its own moment (by its seed); sunlight comes in the last `length` of it.
  function daylight(site, t) {
    const D = config.surface.day, at = ((t + (hashInt(seedToInt(site.seed), 0xda7) / 4294967296) * D.period) % D.period + D.period) % D.period;
    const dawn = D.period - D.length;
    return at >= dawn ? { day: true, in: 0, left: D.period - at } : { day: false, in: dawn - at, left: 0 };
  }
  // A dust storm, as an ion storm in a nebula (storm), on the desert only.
  function dust(site, t) {
    if (!site.dust) return null;
    const S2 = config.surface.dust, i = Math.floor(t / S2.period), salt = 0xd057;
    const start = i * S2.period + stretchSeed(site.seed, i, salt) * (S2.period - S2.length);
    if (t < start || t >= start + S2.length) return null;
    const a = stretchSeed(site.seed, i, salt + 0x100) * Math.PI * 2;
    return { wind: [Math.cos(a) * S2.wind, Math.sin(a) * S2.wind] };
  }
  function surfaceExposure(site, t, o = {}) {
    const d = daylight(site, t);
    const heat = site.heat + (d.day ? site.day : 0) + config.heat.thrust * (o.thrust || 0) + config.surface.vent * (o.vent || 0);
    return { heat, rad: site.rad, day: d, dust: dust(site, t) };
  }
  const takeoffFuel = (gravity, holdFill) => {
    const T = config.surface.takeoff;
    return Math.round((T.base + T.hold * clamp(holdFill, 0, 1)) * gravity * 10) / 10;
  };

  const shed = (stats = {}) => config.heat.cool + (stats.cool || 0);
  const radTaken = (rate, stats = {}) => rate * (1 - clamp(stats.radGuard || 0, 0, 1));

  return { shed, radTaken, config, GIANTS, SURFACES, flare, storm, shadowed, belt, beltGaps, exposure, travelFuel, surface, daylight, dust, surfaceExposure, takeoffFuel };
})();

export { Hazards };
