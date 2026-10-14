'use strict';

// Sector security: how safe a sector is, and what that means for pirates and what they leave.
// The galaxy (galaxy.js) gives every sector a level from 3 (high: the charted pockets around
// settlements, held firmly) down to 0 (none: the frontier). This module says what each level
// means, so the danger and the rewards can be tuned in one place:
// - pirates: how often a band of them lurks in a sector, how many, and how well armed (their gear
//   tier, Mk I–IV; loadout.js),
// - loot: the tier of the components (goods.js) pirates and wrecks leave. Higher-tier components
//   research better equipment (research.js), so the best gear needs the most dangerous space.
//
//   Security.LEVELS[level] -> { level, key, label, color }
//   Security.pirates(level) -> { chance, size: [min, max], tier: [min, max] }
//   Security.lootTier(level) -> 1..4, the loot tier of wrecks in a sector of that level
//   Security.componentTier(rng, lootTier) -> a component tier (1–5) for something at that loot tier
// Works as a classic browser script (global `Security`) and as a Node module.

const Security = (() => {
  const LEVELS = [
    { level: 0, key: 'none', label: 'None', color: '#ff5a6e' },
    { level: 1, key: 'low', label: 'Low', color: '#ff9d5c' },
    { level: 2, key: 'medium', label: 'Medium', color: '#ffcf5a' },
    { level: 3, key: 'high', label: 'High', color: '#b6ff8a' },
  ];

  // Pirate bands by level: the chance a sector has one, its size and its gear tier (both picked
  // evenly within the range). Deep-space ambushes are a band one ship larger.
  const PIRATES = [
    { chance: 0.45, size: [3, 6], tier: [3, 4] },
    { chance: 0.35, size: [2, 4], tier: [2, 3] },
    { chance: 0.18, size: [1, 3], tier: [1, 2] },
    { chance: 0.04, size: [1, 2], tier: [1, 1] },
  ];

  // Component tiers by loot tier, as [tier, weight]: a pirate's loot tier is its gear tier; a
  // wreck's comes from its sector's level. Exotic (tier 5) components only come from the most
  // dangerous space.
  const COMPONENT_TIERS = [
    null,
    [[1, 75], [2, 25]],
    [[1, 35], [2, 50], [3, 15]],
    [[2, 30], [3, 50], [4, 20]],
    [[3, 30], [4, 50], [5, 20]],
  ];

  const pirates = (level) => PIRATES[level] || PIRATES[0];
  const lootTier = (level) => 4 - Math.max(0, Math.min(3, level));
  function componentTier(rng, tier) {
    const table = COMPONENT_TIERS[Math.max(1, Math.min(4, tier))];
    let x = rng() * table.reduce((n, [, w]) => n + w, 0);
    for (const [t, w] of table) if ((x -= w) < 0) return t;
    return table[table.length - 1][0];
  }

  return { LEVELS, PIRATES, COMPONENT_TIERS, pirates, lootTier, componentTier };
})();

if (typeof module !== 'undefined') module.exports = Security;
