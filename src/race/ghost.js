// Your best lap's ghost: where the craft was through the lap, RATE times a second, saved per track
// (biome and seed) and flown back beside you on later laps.
//
//   const rec = Ghost.recorder()     rec.add(t, body) every step (t: the lap's time so far; it keeps
//                                    a sample whenever t passes the next 1 / RATE), rec.lap(time) ->
//                                    a ghost of what was recorded (and starts afresh)
//   Ghost.at(g, t) -> { x, y, angle } | null   where the ghost is t into its lap (null: past its end)
//   Ghost.load(key) -> ghost | null, Ghost.save(key, g)   (in localStorage, through core/store.js)
//   ghost: { v, time, rate, s: [x, y, angle × 100, …] (rounded, to keep it small) }
// ES module (`Ghost`); also runs in Node (the tests).

import { Store } from '../core/store.js';

const Ghost = (() => {
  const RATE = 30, V = 1; // V: the format, and the track generator's: older ghosts don't fit
  const TAU = Math.PI * 2;

  function recorder() {
    let s = [], next = 0;
    return {
      add(t, b) {
        if (t < next) return;
        s.push(Math.round(b.x), Math.round(b.y), Math.round(b.angle * 100));
        next = (s.length / 3) / RATE;
      },
      lap(time) { const g = { v: V, time, rate: RATE, s }; s = []; next = 0; return g; },
    };
  }

  function at(g, t) {
    if (!g) return null;
    const f = t * g.rate, i = Math.floor(f), n = g.s.length / 3;
    if (i < 0 || i >= n - 1) return null;
    const k = f - i, s = g.s, a = i * 3, b = a + 3;
    let da = (s[b + 2] - s[a + 2]) / 100;
    da = ((da + Math.PI) % TAU + TAU) % TAU - Math.PI; // the short way round
    return { x: s[a] + (s[b] - s[a]) * k, y: s[a + 1] + (s[b + 1] - s[a + 1]) * k, angle: s[a + 2] / 100 + da * k };
  }

  function load(key) {
    const g = Store.getJSON('race.ghost.' + key);
    return g && g.v === V && Array.isArray(g.s) && g.s.length >= 6 ? g : null;
  }
  const save = (key, g) => Store.setJSON('race.ghost.' + key, g);

  return { recorder, at, load, save, RATE };
})();

export { Ghost };
