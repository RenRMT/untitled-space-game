'use strict';

// Caches of pre-rendered sprites for art/render.js, bounded by memory rather than by count, with a
// build budget per frame that several caches can share.
//
// - Memory: each cache keeps its sprites in least-recently-used order and drops the oldest once
//   their pixels (canvas width × height) pass maxPixels, or their number passes maxEntries. A
//   sprite drawn in the current frame is never dropped, so a frame that needs more than the limit
//   overshoots it for a moment instead of rebuilding the same sprites over and over.
// - Build budget: once the frame has spent `ms` milliseconds building sprites, a missing sprite is
//   replaced by the caller's fallback (usually the sprite last drawn for the same object, in a
//   neighbouring rotation, another scale or the previous art style) and built in a later frame.
//   Without a fallback it is built anyway: something must be drawn. `force` always builds.
// - Frames: budget.next() starts a frame. Until it is first called nothing is over budget, so a
//   page that draws without a frame loop (item icons, the asset gallery) builds what it asks for.
//
//   const budget = SpriteCache.budget({ ms })                 ms may be a getter
//   const cache = SpriteCache.create({ maxPixels, maxEntries, budget })   limits may be getters
//   cache.get(key, make, { fallback, force }) -> sprite   make() returns { canvas, ... }; the
//                                                          sprite gets its `key`
//   cache.has(key), cache.clear(), cache.stats() -> { sprites, pixels, builds, deferred, dropped }
// Works as a classic browser script (global `SpriteCache`) and as a Node module.

const SpriteCache = (() => {
  const clock = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

  function budget(o = {}) {
    let frame = 0, spent = 0;
    const ms = () => (o.ms === undefined ? 4 : o.ms);
    const now = o.now || clock;
    return {
      get frame() { return frame; },
      get spent() { return spent; },
      get over() { return frame > 0 && spent >= ms(); },
      next() { frame++; spent = 0; },
      time(fn) {
        const t0 = now();
        try { return fn(); } finally { spent += now() - t0; }
      },
    };
  }

  function create(o = {}) {
    const shared = o.budget || budget();
    const entries = new Map(); // key -> { sprite, px, frame }, oldest first
    let pixels = 0;
    const counters = { builds: 0, deferred: 0, dropped: 0 };
    const pixelsOf = (s) => (s && s.canvas ? s.canvas.width * s.canvas.height : 0);

    function use(key, e) {
      entries.delete(key);
      e.frame = shared.frame;
      entries.set(key, e);
      return e.sprite;
    }

    function trim(keep) {
      for (const [key, e] of entries) {
        if (pixels <= o.maxPixels && entries.size <= o.maxEntries) break;
        if (key === keep || (shared.frame > 0 && e.frame === shared.frame)) break; // the rest are newer still
        entries.delete(key);
        pixels -= e.px;
        counters.dropped++;
      }
    }

    function get(key, make, { fallback = null, force = false } = {}) {
      const hit = entries.get(key);
      if (hit) return use(key, hit);
      if (!force && fallback !== null && fallback !== undefined && shared.over) {
        const fb = entries.get(fallback);
        if (fb) { counters.deferred++; return use(fallback, fb); }
      }
      const sprite = shared.time(make);
      sprite.key = key;
      counters.builds++;
      const e = { sprite, px: pixelsOf(sprite), frame: shared.frame };
      entries.set(key, e);
      pixels += e.px;
      trim(key);
      return sprite;
    }

    return {
      get,
      has: (key) => entries.has(key),
      clear() { entries.clear(); pixels = 0; },
      stats: () => ({ sprites: entries.size, pixels, ...counters }),
    };
  }

  return { budget, create };
})();

if (typeof module !== 'undefined') module.exports = SpriteCache;
