// Security: how safe a place in the system is, and what that means for pirates and what they
// leave. The system (world/solar-system.js) gives every point a level from 3 (high: close to a station,
// held firmly) down to 0 (none: the outer system and the depths of the nebulae). This module says
// what each level means, so the danger and the rewards can be tuned in one place:
// - pirates: whether an area has any, how many packs of them, how big each pack is and how well
//   armed (their gear tier, Mk I–IV; rules/loadout.js). Packs keep apart (PACK), so attacking one never
//   draws in another: safe space has a few lone pirates to pick off one at a time, lawless space
//   several larger, better-armed packs,
// - loot: the tier of the components (rules/goods.js) pirates and wrecks leave. Higher-tier components
//   research better equipment (rules/research.js), so the best gear needs the most dangerous space.
//
//   Security.LEVELS[level] -> { level, key, label, color }
//   Security.pirates(level) -> { chance, packs: [min, max], size: [[n, weight]], tier: [[tier, weight]] }
//   Security.PACK             how packs are laid out (world/solar-system.js)
//   Security.pick(rng, [[value, weight]]) -> a value, by weight
//   Security.lootTier(level) -> 1..4, the loot tier of wrecks at that level
//   Security.componentTier(rng, lootTier) -> a component tier (1–5) for something at that loot tier
// ES module (`Security`); also runs in Node (the tests).

const Security = (() => {
  const LEVELS = [
    { level: 0, key: 'none', label: 'None', color: '#ff5a6e' },
    { level: 1, key: 'low', label: 'Low', color: '#ff9d5c' },
    { level: 2, key: 'medium', label: 'Medium', color: '#ffcf5a' },
    { level: 3, key: 'high', label: 'High', color: '#b6ff8a' },
  ];

  // Pirates by level: the chance an area (world/solar-system.js pirates.cell) has any, then how many
  // packs (picked evenly in the range), and per pack its size and gear tier (picked by weight).
  // Medium security is mostly lone Mk I pirates, which the starting ship can take; lawless space
  // mostly packs of three or four.
  // An ambush is one pack, as large as the biggest here or one larger.
  const PIRATES = [
    { chance: 0.7, packs: [2, 4], size: [[1, 1], [2, 2], [3, 2], [4, 1]], tier: [[3, 1], [4, 1]] },
    { chance: 0.65, packs: [2, 4], size: [[1, 2], [2, 2], [3, 1]], tier: [[2, 1], [3, 1]] },
    { chance: 0.6, packs: [2, 4], size: [[1, 3], [2, 1]], tier: [[1, 2], [2, 1]] },
    { chance: 0.3, packs: [1, 2], size: [[1, 1]], tier: [[1, 1]] },
  ];
  // Where packs go (world units): each member circles its pack's centre at a radius in `orbit`;
  // centres stay `spacing` apart, so the nearest members of two packs are always more than
  // CombatCore.config.groupRange apart (1500: who joins a fight), `clear` from stations and the
  // star (docking stays safe), and `margin` inside the system's edge.
  const PACK = { spacing: 3200, orbit: [300, 550], clear: 2000, margin: 800 };

  // Component tiers by loot tier, as [tier, weight]: a pirate's loot tier is its gear tier; a
  // wreck's comes from the level where it lies. Exotic (tier 5) components only come from the most
  // dangerous space.
  const COMPONENT_TIERS = [
    null,
    [[1, 75], [2, 25]],
    [[1, 35], [2, 50], [3, 15]],
    [[2, 30], [3, 50], [4, 20]],
    [[3, 30], [4, 50], [5, 20]],
  ];

  const pirates = (level) => PIRATES[level] || PIRATES[0];
  function pick(rng, table) {
    let x = rng() * table.reduce((n, [, w]) => n + w, 0);
    for (const [v, w] of table) if ((x -= w) < 0) return v;
    return table[table.length - 1][0];
  }
  const lootTier = (level) => 4 - Math.max(0, Math.min(3, level));
  const componentTier = (rng, tier) => pick(rng, COMPONENT_TIERS[Math.max(1, Math.min(4, tier))]);

  return { LEVELS, PIRATES, PACK, COMPONENT_TIERS, pirates, pick, lootTier, componentTier };
})();

export { Security };
