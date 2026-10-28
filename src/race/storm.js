// Lightning on the gas giant's track: a strike is called down every few seconds a little ahead of a
// racer (you more often than not), marked on the ground for `warn` s first (a ring closing in), then
// it hits: every ship in the race within `r` loses `damage` hull and `slow` of its speed, its dash's
// burst cut short. A hop doesn't clear it. The biome's numbers are Config.BIOME[id].storm.
//
//   const st = Storm.create(cfg, seed)   cfg: { every: [s, s], warn, r, damage, slow, you (the odds it's
//     called on you), bolt (s it's drawn after) }
//   Storm.step(st, G, Rs, dt)   Rs: the runs in the race, yours first; a strike adds 'strike' to a run's fx
//   st.strikes: [{ x, y, r, t (s of the warning left; < 0: struck, for that long), warn, bolt, seed }]
// ES module (`Storm`); also runs in Node.

import { mulberry32 } from '../core/rng.js';
import { Track } from './track.js';

const Storm = (() => {
  const create = (cfg, seed) => ({ cfg, rng: mulberry32((seed * 2246822519 + 0x57a) >>> 0), wait: cfg.every[1], strikes: [] });

  function step(st, G, Rs, dt) {
    const { cfg, rng } = st, tr = G.tr;
    for (const s of st.strikes) {
      const was = s.t;
      s.t -= dt;
      if (was > 0 && s.t <= 0) for (const R of Rs) {
        const C = R.craft;
        if (R.phase !== 'race' || Math.hypot(C.x - s.x, C.y - s.y) > s.r) continue;
        R.hull -= cfg.damage; C.vx *= 1 - cfg.slow; C.vy *= 1 - cfg.slow;
        R.dash.t = 0; R.dash.v = null;
        R.flash = Math.max(R.flash, 0.3); R.fx.push('strike');
      }
    }
    st.strikes = st.strikes.filter((s) => s.t > -cfg.bolt);
    const racing = Rs.filter((R) => R.phase === 'race');
    if (!racing.length || (st.wait -= dt) > 0) return;
    st.wait = cfg.every[0] + (cfg.every[1] - cfg.every[0]) * rng();
    // Ahead of the one it's called on, where it'll be about when it hits, anywhere across the track.
    const R = rng() < cfg.you && racing[0] === Rs[0] ? Rs[0] : racing[Math.floor(rng() * racing.length)];
    const v = Math.hypot(R.craft.vx, R.craft.vy), p = tr.pts[Track.ahead(tr, R.n, v * cfg.warn * (0.7 + 0.5 * rng()))], off = (2 * rng() - 1) * p.hw * 0.8;
    st.strikes.push({ x: p.x - p.ty * off, y: p.y + p.tx * off, r: cfg.r, t: cfg.warn, warn: cfg.warn, bolt: cfg.bolt, seed: Math.floor(rng() * 1e9) });
  }

  return { create, step };
})();

export { Storm };
