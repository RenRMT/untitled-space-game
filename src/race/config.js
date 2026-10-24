// The race's numbers that the page (main.js), the tests and tools/race-tracks.js share: the map, the
// track the generator is asked for, the ship as the race flies it, and which of a biome's ground
// kinds the track and its run-off are laid in.
//
//   Config.T, N, SIZE        a tile (ArtSurface.T: main.js checks), tiles a side, world units a side
//   Config.TRACK             the options Track.loop is called with (the regular style)
//   Config.map(style)        -> { N, SIZE, TRACK } for a track style: the advanced and expert styles'
//                            maps are bigger (N_ADV, N_EXP tiles), so their fingers can be thin and long against them
//   Config.CARVE             the options Track.carve is called with (but kinds: Config.KINDS[biome])
//   Config.KINDS             per biome: { track, off } ground kinds ('a' | 'b' | 'c', ArtSurface)
//   Config.SHIP, STATS, TUNE, SPEED   the Courier as the game fits it; the race's stats (× TUNE, SPEED top speed)
//   Config.R_SHIP, HULL      the craft's collision radius on the surface; its hull
//   Config.TRACKS            the tracks' and the handling's version: a seed's ghost is kept only for the track and handling it was flown with
// ES module (`Config`); also runs in Node.

import { Loadout } from '../rules/loadout.js';

const Config = (() => {
  const T = 64, N = 76, SIZE = N * T; // ArtSurface.T; the surface, tiles a side; world units a side
  const N_ADV = 90, LAP_ADV = [26, 38]; // the advanced style's tiles a side, and the lap its layouts are scored for (s)
  const N_EXP = 90, LAP_EXP = [28, 40]; // the expert style's
  const TRACKS = 5; // 5: grip, slide and brake (Handling)
  // The ship: the Courier as the game fits and draws it (game/state.js SHIP), at the surface's size
  // (game/landing.js SURFACE_SCALE).
  const SHIP = Loadout.stats(Loadout.starter('courier'));
  const SURFACE_SCALE = 0.85, R_SHIP = SHIP.radius * SURFACE_SCALE, HULL = SHIP.hull || 120;
  // Racing is faster and grippier than the game's surface flight: in Cruise the velocity eases toward
  // the heading at the engine's acceleration, so more of it makes turns bite instead of float.
  const TUNE = { speed: 0.75, accel: 1.4, turn: 1.25 }; // × the ship's top speed, acceleration, turn rate
  const stats = (speed = TUNE.speed) => ({ ...SHIP, maxSpeed: SHIP.maxSpeed * speed, accel: SHIP.accel * TUNE.accel, turnRate: SHIP.turnRate * TUNE.turn });
  // The track: its half-width (±25% round the loop, never under minHw), kept clear of the map's edge
  // by margin; the run-off past its edge (slow ground, then the wall); between two stretches, edge to
  // edge, both run-offs and at least a tile of wall (gap).
  // Its corners are sized against the craft's top speed and its turning circle there (rv, v²/a), at
  // the race's own speed (not ?speed=, so a seed's track stays the same).
  const HW = 1.9 * T, RUNOFF = 1.25 * T, OPEN = 0.4 * T, STATS = stats();
  const TRACK = {
    size: SIZE, hw: HW, minHw: 6 * R_SHIP, margin: 5 * T, gap: 2 * (RUNOFF + OPEN) + T, samples: 720, checks: 16,
    speed: STATS.maxSpeed, rv: STATS.maxSpeed ** 2 / STATS.accel,
  };
  const map = (style = 'regular') => {
    const n = { advanced: N_ADV, expert: N_EXP }[style] || N, lap = { advanced: LAP_ADV, expert: LAP_EXP }[style];
    return { N: n, SIZE: n * T, TRACK: { ...TRACK, size: n * T, style, ...(lap && { lap }) } };
  };
  const CARVE = { T, runoff: RUNOFF, open: OPEN, outside: 'high' };
  const KINDS = {
    desert: { track: 'b', off: 'a' }, // hardpan; dune sea (gravel reg is the mesas' colour)
    ice: { track: 'b', off: 'c' }, // glare ice; pressure ridges
    lava: { track: 'c', off: 'a' }, // ash field; basalt plain (b is the lava flow)
    terran: { track: 'a', off: 'c' }, // meadow; woodland (b is the sea)
    moon: { track: 'b', off: 'c' }, // mare; ejecta
  };
  return { T, N, SIZE, N_ADV, N_EXP, map, TRACKS, SHIP, SURFACE_SCALE, R_SHIP, HULL, TUNE, stats, STATS, HW, RUNOFF, TRACK, CARVE, KINDS };
})();

export { Config };
