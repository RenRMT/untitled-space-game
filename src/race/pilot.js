// A scripted pilot for the race: it aims at a point on the centreline a little ahead (further the
// faster it goes, so it cuts the bends a little), and, braking, brakes for the bends ahead it can't
// take at its speed (their radius, plus a share of the half-width the line gains, against the grip).
// For the tests and tools/race-tracks.js (does a track need the brake?), and a start for rivals.
//
//   Pilot.fly(G, R, cfg, { brake }) -> control   the controls for the run's next step (Input.control()'s shape)
//   Pilot.lap(seed, opts, { brake, laps, biome }) -> { laps, hits, off, braking, brakes, hull }   flies a track on flat
//     ground with a wall where the run-off ends: lap times (s), hard hits, s off the track, s braking and
//     its braking zones, over the laps after the first; hull: what the hits dented (biome: Config.BIOME's id,
//     its craft and handling; opts should be Config.map(style, biome).TRACK)
//   Pilot.LINE   the share of the half-width the line adds to a bend's radius
// ES module (`Pilot`); also runs in Node.

import { Config } from './config.js';
import { Run } from './run.js';
import { Track } from './track.js';

const Pilot = (() => {
  const AIM = { near: 60, lead: 0.3 }, LINE = 0.5, ZONE = 0.5; // ZONE: s without braking that part two braking zones

  function fly(G, R, cfg, { brake = true } = {}, ctl = { angle: 0, speed: 1, brake: false, events: [] }) {
    const tr = G.tr, C = R.craft, v = Math.hypot(C.vx, C.vy), p = tr.pts[Track.ahead(tr, R.n, AIM.near + v * AIM.lead)];
    ctl.angle = Math.atan2(p.y - C.y, p.x - C.x); ctl.speed = 1; ctl.brake = false;
    if (!brake) return ctl;
    const a = cfg.stats.accel, H = R.tune.handling, dec = H.BRAKE * a, grip = H.GRIP * a;
    for (let d = 0; d < (v * v) / (2 * dec) + 80; d += 8) {
      const q = tr.pts[Track.ahead(tr, R.n, d)], vmax = Math.sqrt(grip * (1 / Math.max(q.k, 1e-5) + LINE * q.hw));
      if (v > vmax && (v * v - vmax * vmax) / (2 * dec) >= d - 20) { ctl.brake = true; break; }
    }
    return ctl;
  }

  function lap(seed, opts, { brake = true, laps = 2, biome } = {}) {
    const N = Math.round(opts.size / Config.T), tr = Track.loop(seed, opts), grid = (v) => Array.from({ length: N + 1 }, () => new Array(N + 1).fill(v));
    const G = { W: { w: N, h: N, C: grid(0), G: grid(0.5), G2: grid(0.5), props: {} }, tr }, FAR = Config.RUNOFF + Config.CARVE.open;
    const cfg = { stats: biome ? Config.stats(Config.TUNE.speed, biome) : Config.STATS, ship: Config.SHIP, hull: 1e6, biome: biome && Config.biome(biome), r: Config.R_SHIP, laps, mode: 'cruise', steer: 'pad', assist: true, cam: { lead: 0.6, pull: 0, track: 0.6, wide: 1, tight: 1 }, ghostKey: null };
    const R = Run.create(G, cfg), ctl = { angle: 0, speed: 1, brake: false, events: [] };
    R.world.blocked = (x, y, r) => Track.edgeDist(tr, x, y, R.n, 40).d + r > FAR;
    R.world.rocks = R.world.holes = () => [];
    const out = { laps: [], hits: 0, off: 0, braking: 0, brakes: 0 };
    let last = -Infinity;
    for (let t = 0; t < 60 * laps && R.phase !== 'done'; t += Run.STEP) {
      fly(G, R, cfg, { brake }, ctl);
      const hits = R.hits;
      Run.step(R, G, cfg, ctl);
      if (R.phase !== 'race' && R.phase !== 'done') continue;
      if (!R.laps.length) continue; // the first lap starts from a standstill
      if (R.hits > hits) out.hits++;
      if (R.off > 0.5) out.off += Run.STEP;
      if (ctl.brake) { out.braking += Run.STEP; if (t - last > ZONE) out.brakes++; last = t; }
    }
    out.laps = R.laps.slice(1); out.hull = 1e6 - R.hull;
    return out;
  }

  return { fly, lap, LINE };
})();

export { Pilot };
