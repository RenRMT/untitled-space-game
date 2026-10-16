'use strict';

// Asteroid mining: which asteroid the ship can mine, how long it takes and what it leaves behind.
// The flight view (game.js) offers Mine for an asteroid; mining runs for `duration` seconds, then
// the asteroid breaks up and may drop one trade good to collect: a metal, mineral or gas, its
// type picked by rarity (rules/goods.js). Drops are seeded by the system and the asteroid, so an
// asteroid always yields the same.
// Gas pockets in nebulae (world/solar-system.js) are collected the same way, taking longer: they always
// yield gas, one to three units by the pocket's size (gasOf).
//   Mining.yieldOf(galaxySeed, asteroid) -> { kind, seed } | null
//   Mining.gasOf(galaxySeed, pocket) -> [{ kind, seed }]
//   Mining.duration(e) -> seconds to mine or collect it with a Mk I computer
// Works as a classic browser script (global `Mining`) and as a Node module.

const Mining = (() => {
  const { hashInt, mulberry32, seedToInt, weightedPick } = typeof require === 'function' ? require('../core/rng.js') : globalThis;
  const G = typeof require === 'function' ? require('./goods.js') : Goods;

  const config = {
    duration: 5, // seconds of mining before the asteroid breaks up
    gasDuration: 8, // seconds of collecting before a gas pocket is used up
    range: 160, // world units beyond the asteroid's radius within which mining can start
    slack: 60, // ... and how much further the ship may drift before mining is interrupted
    maxSpeed: 150, // the ship must be this slow to start (it then stops), as for docking
  };

  // Drop chance and the categories that drop, by asteroid type (world/solar-system.js). Metallic rock gives
  // metals, stony and carbonaceous rock mostly minerals, icy rock the odd pocket of gas.
  const YIELD = {
    metal: { chance: 0.7, items: [['metal', 4], ['mineral', 1]] },
    stony: { chance: 0.55, items: [['mineral', 4], ['metal', 1]] },
    carbon: { chance: 0.45, items: [['mineral', 1]] },
    ice: { chance: 0.25, items: [['gas', 1]] },
  };

  // What a mined asteroid drops: { kind (a rules/goods.js type), seed } or null.
  function yieldOf(galaxySeed, asteroid) {
    const y = YIELD[asteroid.ast.type];
    if (!y) return null;
    const r = mulberry32(hashInt(seedToInt(galaxySeed), seedToInt(asteroid.key), 0x313e));
    if (r() >= y.chance) return null;
    const category = weightedPick(y.items, r());
    return { kind: G.pick(r, category), seed: Math.floor(r() * 4294967295) };
  }

  // What a collected gas pocket leaves: its size sets how much (1–3 units), each a gas picked by
  // rarity, from the pocket's own stream.
  function gasOf(galaxySeed, pocket) {
    const r = mulberry32(hashInt(seedToInt(galaxySeed), seedToInt(pocket.key), 0x6a5));
    const n = 1 + Math.floor((pocket.pocket ? pocket.pocket.r : pocket.r || 60) / 45 + r() * 0.8);
    return Array.from({ length: Math.min(3, n) }, () => ({ kind: G.pick(r, 'gas'), seed: Math.floor(r() * 4294967295) }));
  }
  const duration = (e) => (e.kind === 'gas' ? config.gasDuration : config.duration);

  return { config, YIELD, yieldOf, gasOf, duration };
})();

if (typeof module !== 'undefined') module.exports = Mining;
