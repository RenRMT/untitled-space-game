// The race's numbers that the page (main.js), the tests and tools/race-tracks.js share: the map, the
// track the generator is asked for, the ship as the race flies it, and which of a biome's ground
// kinds the track and its run-off are laid in.
//
//   Config.T, N, SIZE        a tile (ArtSurface.T: main.js checks), tiles a side, world units a side
//   Config.TRACK             the options Track.loop is called with (the regular style)
//   Config.map(style, biome?) -> { N, SIZE, TRACK } for a track style: the advanced and expert styles'
//                            maps are bigger (N_ADV, N_EXP tiles), so their fingers can be thin and long against them;
//                            a biome's track: its width, its mix of corners, sized for its craft's stats
//   Config.BIOME, biome(id)  each biome's character (below): how the craft handles, the track's shape, the run-off and walls,
//                            and its hazards (storm: lightning, Storm)
//   Config.CARVE             the options Track.carve is called with (but kinds: Config.KINDS[biome])
//   Config.KINDS             per biome: { track, off } ground kinds ('a' | 'b' | 'c', ArtSurface)
//   Config.SHIP, STATS, TUNE, SPEED   the Courier as the game fits it; the race's stats (× TUNE, SPEED top speed;
//                            stats(speed, biome): × the biome's too)
//   Config.R_SHIP, HULL      the craft's collision radius on the surface (× GROWN); its hull
//   Config.HULL_SIZE[hull]   × R_SHIP (and the drawing) for a heavier hull
// ES module (`Config`); also runs in Node.

import { Loadout } from '../rules/loadout.js';

const Config = (() => {
  const T = 64, N = 76, SIZE = N * T; // ArtSurface.T; the surface, tiles a side; world units a side
  const N_ADV = 90, LAP_ADV = [26, 38]; // the advanced style's tiles a side, and the lap its layouts are scored for (s)
  const N_EXP = 90, LAP_EXP = [28, 40]; // the expert style's
  // The ship: the Courier as the game fits and draws it (game/state.js SHIP), at the surface's size
  // (game/landing.js SURFACE_SCALE).
  const SHIP = Loadout.stats(Loadout.starter('courier'));
  // GROWN: the race's ships, drawn and colliding, larger than the game's surface flight has them (the
  // tracks are laid out for the game's: TRACK's minHw).
  const SURFACE_SCALE = 0.85, GROWN = 1.75 / 1.375, R_SHIP = SHIP.radius * SURFACE_SCALE * GROWN, HULL = SHIP.hull || 120;
  // A heavier hull, × the light fighter's size: drawn and colliding (the rivals' by their level's hull too).
  const HULL_SIZE = { 'fighter-light': 1, fighter: 1.08, 'fighter-heavy': 1.16 };
  // Racing is faster and grippier than the game's surface flight: in Cruise the velocity eases toward
  // the heading at the engine's acceleration, so more of it makes turns bite instead of float.
  const TUNE = { speed: 0.75, accel: 1.4, turn: 1.25 }; // × the ship's top speed, acceleration, turn rate
  const stats = (speed = TUNE.speed, id) => {
    const b = biome(id).stats;
    return { ...SHIP, maxSpeed: SHIP.maxSpeed * speed * (b.speed ?? 1), accel: SHIP.accel * TUNE.accel * (b.accel ?? 1), turnRate: SHIP.turnRate * TUNE.turn * (b.turn ?? 1) };
  };
  // The track: its half-width (±25% round the loop, never under minHw), kept clear of the map's edge
  // by margin; the run-off past its edge (slow ground, then the wall); between two stretches, edge to
  // edge, both run-offs and at least a tile of wall (gap).
  // Its corners are sized against the craft's top speed and its turning circle there (rv, v²/a), at
  // the race's own speed (not ?speed=, so a seed's track stays the same).
  // Each biome's character: × today's numbers, a missing one as it is. Terran is the standard, the
  // track to learn on, so it has none.
  // - stats: × the craft's top speed, acceleration, turn rate (speed, accel, turn)
  // - handling: × Handling.config's GRIP, LIFT, BRAKE, and the slide's on, off, grip, scrub
  // - track: × the half-width (hw); mix: × each kind of corner's odds (Track.loop); chicanes: × a wiggle's odds of being one;
  //   ring: the regular layout's polygon (Track.loop's ring: corners, pulled in, how far out, squeezed across);
  //   salt: its own layouts, so a seed isn't the same loop as on another planet of the same width
  // - off: × how much the run-off takes from top speed (speed) and acceleration (grip) (Run's OFF)
  // - wall: × a wall's restitution and friction (Run's WALL), and the hull a hit dents (damage)
  // - hop: × the hop's time in the air and height (Run's HOP)
  // - storm: lightning strikes (Storm.create's cfg), none without
  const BIOME = {
    terran: {},
    // Glare ice: little grip, slides that keep their speed and a weak brake; wide and sweeping, a soft run-off, slippery walls.
    ice: {
      handling: { GRIP: 0.65, BRAKE: 0.6, on: 0.8, off: 0.8, scrub: 0.4 },
      track: { hw: 1.2, mix: { sweeper: 1.6, carousel: 2, hairpin: 0.4, square: 0.6 }, chicanes: 0.5 },
      off: { speed: 0.6 }, wall: { friction: 0.5 },
    },
    // Hardpan in a dune sea: a looser rally feel; a long, stretched speedway of few corners and long
    // straights, deep sand off it, soft dune walls.
    desert: {
      handling: { GRIP: 0.8, on: 0.85 },
      track: { mix: { sweeper: 1.6, carousel: 1.3, hairpin: 0.6 }, chicanes: 0.5, ring: { corners: [5, 7], pulled: [1, 2], out: [0.85, 1], across: 0.6 }, salt: 1 },
      off: { speed: 1.4 }, wall: { damage: 0.6 },
    },
    // An ash road through basalt: grippy and quick; narrow and technical, the run-off rough, the rock hard.
    lava: {
      stats: { speed: 1.05 }, handling: { GRIP: 1.1 },
      track: { hw: 0.85, mix: { square: 1.5, hairpin: 1.5, decreasing: 1.3, sweeper: 0.6, carousel: 0.5 }, chicanes: 1.5 },
      off: { grip: 1.5 }, wall: { damage: 1.5 },
    },
    // Low gravity: slow to pick up, light on the ground, long high hops; a round crater-rim circuit,
    // wide, of many linked flowing bends.
    moon: {
      stats: { accel: 0.85 }, handling: { GRIP: 0.85 },
      track: { hw: 1.1, mix: { carousel: 2, 'double-apex': 1.5, hairpin: 0.7 }, ring: { corners: [11, 14], pulled: [4, 5], near: [0.5, 0.65], out: [0.85, 1], across: 1 }, salt: 2 },
      hop: { time: 1.8, h: 1.5 },
    },
    // A haze lane between storm fronts: floaty; wide open sweepers, walls that are soft but drag.
    gas: {
      stats: { turn: 0.9, accel: 0.9 },
      track: { hw: 1.1, mix: { sweeper: 1.8, carousel: 1.5, hairpin: 0.5 }, chicanes: 0.6, salt: 3 },
      wall: { friction: 1.6, damage: 0.5 },
      storm: { every: [1.6, 3.2], warn: 1.1, r: 70, damage: 14, slow: 0.45, you: 0.5, bolt: 0.35 },
    },
  };
  const biome = (id) => {
    const b = BIOME[id] || {};
    return { id, stats: b.stats || {}, handling: b.handling || {}, track: b.track || {}, off: b.off || {}, wall: b.wall || {}, hop: b.hop || {}, storm: b.storm || null };
  };
  const HW = 1.9 * T, RUNOFF = 1.25 * T, OPEN = 0.4 * T, STATS = stats();
  const TRACK = {
    size: SIZE, hw: HW, minHw: (6 * R_SHIP) / GROWN, margin: 5 * T, gap: 2 * (RUNOFF + OPEN) + T, samples: 720, checks: 16,
    speed: STATS.maxSpeed, rv: STATS.maxSpeed ** 2 / STATS.accel,
  };
  const map = (style = 'regular', id) => {
    const n = { advanced: N_ADV, expert: N_EXP }[style] || N, lap = { advanced: LAP_ADV, expert: LAP_EXP }[style];
    const b = biome(id), t = b.track, st = BIOME[id] && BIOME[id].stats ? stats(TUNE.speed, id) : null;
    return {
      N: n, SIZE: n * T,
      TRACK: {
        ...TRACK, size: n * T, style, ...(lap && { lap }), ...(t.hw && { hw: HW * t.hw }), ...(t.mix && { mix: t.mix }), ...(t.chicanes && { chicanes: t.chicanes }),
        ...(t.ring && { ring: t.ring }), ...(t.salt && { salt: t.salt }),
        ...(st && { speed: st.maxSpeed, rv: st.maxSpeed ** 2 / st.accel }),
      },
    };
  };
  const CARVE = { T, runoff: RUNOFF, open: OPEN, outside: 'high' };
  const KINDS = {
    desert: { track: 'b', off: 'a' }, // hardpan; dune sea (gravel reg is the mesas' colour)
    ice: { track: 'b', off: 'c' }, // glare ice; pressure ridges
    lava: { track: 'c', off: 'a' }, // ash field; basalt plain (b is the lava flow)
    terran: { track: 'a', off: 'c' }, // meadow; woodland (b is the sea)
    moon: { track: 'b', off: 'c' }, // mare; ejecta
    gas: { track: 'b', off: 'a' }, // haze; cloud deck (the walls are storm fronts)
  };
  return { T, N, SIZE, N_ADV, N_EXP, map, BIOME, biome, SHIP, SURFACE_SCALE, R_SHIP, HULL, HULL_SIZE, TUNE, stats, STATS, HW, RUNOFF, TRACK, CARVE, KINDS };
})();

export { Config };
