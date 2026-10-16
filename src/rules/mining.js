// Asteroid mining: which asteroid the ship can mine, how long it takes and what it leaves behind.
// The flight view (game/mining.js) offers Mine for an asteroid; mining runs for `duration` seconds, then
// the asteroid breaks up and may drop one raw material to collect: a metal, mineral or gas, its
// type picked by rarity (rules/goods.js), or a particular one (carbon from carbonaceous rock, water
// ice from icy rock). Drops are seeded by the system and the asteroid, so an asteroid always yields the same.
// Gas pockets in nebulae (world/solar-system.js) are collected the same way, taking longer: they always
// yield the rarer gases, one to three units by the pocket's size (gasOf).
//   Mining.yieldOf(galaxySeed, asteroid) -> { kind, seed } | null
//   Mining.gasOf(galaxySeed, pocket) -> [{ kind, seed }]
//   Mining.duration(e) -> seconds to mine or collect it with a Mk I computer
// ES module (`Mining`); also runs in Node (the tests).

import { nextSeed, seeded, weightedPick } from '../core/rng.js';
import { Goods } from './goods.js';

const Mining = (() => {
  const G = Goods;

  const config = {
    duration: 5, // seconds of mining before the asteroid breaks up
    gasDuration: 8, // seconds of collecting before a gas pocket is used up
    range: 160, // world units beyond the asteroid's radius within which mining can start
    slack: 60, // ... and how much further the ship may drift before mining is interrupted
    maxSpeed: 150, // the ship must be this slow to start (it then stops), as for docking
  };

  // Drop chance and what drops, by asteroid type (world/solar-system.js): a category (a raw type of
  // it, by rarity) or a type. Metallic rock gives metals, stony rock minerals, carbonaceous rock
  // carbon, icy rock water ice and the odd pocket of gas.
  const YIELD = {
    metal: { chance: 0.7, items: [['metal', 4], ['mineral', 1]] },
    stony: { chance: 0.55, items: [['mineral', 4], ['metal', 1]] },
    carbon: { chance: 0.45, items: [['carbon', 3], ['mineral', 1]] },
    ice: { chance: 0.45, items: [['water-ice', 3], ['gas', 1]] },
  };

  // What a mined asteroid drops: { kind (a rules/goods.js type), seed } or null.
  function yieldOf(galaxySeed, asteroid) {
    const y = YIELD[asteroid.ast.type];
    if (!y) return null;
    const r = seeded(galaxySeed, asteroid.key, 0x313e);
    if (r() >= y.chance) return null;
    const what = weightedPick(y.items, r());
    return { kind: G.type(what) ? what : G.pick(r, what, 'raw'), seed: nextSeed(r) };
  }

  // What a collected gas pocket leaves: its size sets how much (1–3 units), each a gas picked by
  // rarity, from the pocket's own stream.
  function gasOf(galaxySeed, pocket) {
    const r = seeded(galaxySeed, pocket.key, 0x6a5);
    const n = 1 + Math.floor((pocket.pocket ? pocket.pocket.r : pocket.r || 60) / 45 + r() * 0.8);
    const rare = (t) => t.stage === 'raw' && t.rarity > 1;
    return Array.from({ length: Math.min(3, n) }, () => ({ kind: G.pick(r, 'gas', rare), seed: nextSeed(r) }));
  }
  const duration = (e) => (e.kind === 'gas' ? config.gasDuration : config.duration);

  return { config, YIELD, yieldOf, gasOf, duration };
})();

export { Mining };
