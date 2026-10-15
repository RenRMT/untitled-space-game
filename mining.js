'use strict';

// Asteroid mining: which asteroid the ship can mine, how long it takes and what it leaves behind.
// The flight view (game.js) offers Mine for an asteroid; mining runs for `duration` seconds, then
// the asteroid breaks up and may drop one trade good to collect: a metal, mineral or gas, its
// type picked by rarity (goods.js). Drops are seeded by the system and the asteroid, so an
// asteroid always yields the same.
// Works as a classic browser script (global `Mining`) and as a Node module.

const Mining = (() => {
  const { hashInt, mulberry32, seedToInt, weightedPick } = typeof require === 'function' ? require('./rng.js') : globalThis;
  const G = typeof require === 'function' ? require('./goods.js') : Goods;

  const config = {
    duration: 5, // seconds of mining before the asteroid breaks up
    range: 160, // world units beyond the asteroid's radius within which mining can start
    slack: 60, // ... and how much further the ship may drift before mining is interrupted
    maxSpeed: 150, // the ship must be this slow to start (it then stops), as for docking
  };

  // Drop chance and the categories that drop, by asteroid type (solar-system.js). Metallic rock gives
  // metals, stony and carbonaceous rock mostly minerals, icy rock the odd pocket of gas.
  const YIELD = {
    metal: { chance: 0.7, items: [['metal', 4], ['mineral', 1]] },
    stony: { chance: 0.55, items: [['mineral', 4], ['metal', 1]] },
    carbon: { chance: 0.45, items: [['mineral', 1]] },
    ice: { chance: 0.25, items: [['gas', 1]] },
  };

  // What a mined asteroid drops: { kind (a goods.js type), seed } or null.
  function yieldOf(galaxySeed, asteroid) {
    const y = YIELD[asteroid.ast.type];
    if (!y) return null;
    const r = mulberry32(hashInt(seedToInt(galaxySeed), seedToInt(asteroid.key), 0x313e));
    if (r() >= y.chance) return null;
    const category = weightedPick(y.items, r());
    return { kind: G.pick(r, category), seed: Math.floor(r() * 4294967295) };
  }

  return { config, YIELD, yieldOf };
})();

if (typeof module !== 'undefined') module.exports = Mining;
