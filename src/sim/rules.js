// Redshift's rules (notes/sim.md): a run's state and everything that changes it, cycle by cycle.
// Plain data in, plain data out, so the page (main.js), the tests (tests/sim.js) and the scripted
// player (tools/sim-play.js) share them.
//
// Two clocks run in a system: `cycle`, the cycles elapsed (what the horizon fills by), and `time`,
// the system's own time, which the hole dilates (what production, building and the map's orbits
// run on). Past half the meter, time runs slower than the cycles; at 100% it stops, and the system
// is lost.
//
//   SimRules.newRun(mode, meta, seed?) -> state    mode: 'story' | 'endless'; the first system entered
//   SimRules.world(state) -> system                the current system (SimWorld.generate, cached)
//   SimRules.tick(state, meta, cycles) -> events   run the clock on (fractions allowed); events: [{ kind, ... }]
//   SimRules.dilation(state) -> 0..1               how fast the system's time runs now
// ES module (`SimRules`); also runs in Node (the tests).

import { SimConfig } from './config.js';
import { SimWorld } from './world.js';

const SimRules = (() => {
  const C = SimConfig;
  const VERSION = 1;

  // ---------- The world ----------
  let cached = null;
  function world(state) {
    const t = state.terms;
    const key = JSON.stringify(t);
    if (!cached || cached.key !== key) cached = { key, w: SimWorld.generate(t.seed, t) };
    return cached.w;
  }

  // ---------- A run ----------
  function newRun(mode, meta, seed = 1 + Math.floor(Math.random() * 1e9)) {
    const state = {
      version: VERSION, mode, chapter: 0, depth: 0, escaped: 0, seed,
      terms: null, cycle: 0, time: 0, pull: 0, speed: 1, status: 'play',
      past: [], insightRun: 0,
    };
    enter(state, meta, { seed, depth: 0, distance: 'mid', rich: null, hazard: null, cultures: ['android'] });
    return state;
  }

  // Arrive in a system: everything built is left behind.
  function enter(state, meta, terms) {
    state.terms = { ...terms };
    const w = world(state);
    state.cycle = 0; state.time = 0; state.pull = w.pull0; state.status = 'play';
  }

  const dilation = (state) => C.dilation(state.pull);

  function tick(state, meta, cycles) {
    const events = [];
    if (state.status !== 'play' || cycles <= 0) return events;
    const w = world(state);
    // In steps of at most one cycle, so a long frame lands the same as many short ones.
    let left = cycles;
    while (left > 1e-9 && state.status === 'play') {
      const dt = Math.min(1, left);
      left -= dt;
      const before = Math.floor(state.cycle);
      state.cycle += dt;
      state.pull = Math.min(100, state.pull + (100 / w.life) * dt);
      state.time += dt * dilation(state);
      if (Math.floor(state.cycle) !== before) events.push(...cycleEnd(state, meta, w));
      if (state.pull >= 100) { state.status = 'lost'; events.push({ kind: 'lost' }); }
    }
    return events;
  }

  // What happens once a whole cycle: nothing yet.
  function cycleEnd() { return []; }

  return { VERSION, newRun, enter, world, tick, dilation };
})();

export { SimRules };
