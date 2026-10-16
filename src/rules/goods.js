'use strict';

// The item catalogue: every kind of trade good and salvaged component, with its rarity, base price
// and colour. Items are grouped into categories:
// - trade goods (metals, minerals, gases, synthetics, manufactured goods, liquids, conduits): just
//   the ones research uses (rules/research.js), from iron to plasma conduit,
// - salvaged components (hull, weapon, computer, drive): generic, in five tiers from simple to
//   exotic ("Simple computer components"), used up by research (rules/research.js). They're never
//   traded, so their price is only a guide to what they're worth.
// Each type has a rarity from 1 (common) to 5 (exotic). Rarer types are found less often, sold at
// fewer stations (exotics never) and are worth more. Each type within a category has its own
// colour, used for its art (art/items.js) and on the station screen.
//
//   Goods.type(id)              -> { id, name, category, rarity, price, color: [h, s, l], shape?, tier? }
//   Goods.component(cat, tier)  -> the component type id of a category at a tier (1–5)
//   Goods.ofCategory(cat)       -> types of a category, commonest first
//   Goods.categories(group)     -> category ids of 'trade' or 'salvage'
//   Goods.pick(rng, cat)        -> a type id of that category, rarer ones less likely
//   Goods.resolve(kind, label?) -> the current type id for an item from an older save, or null
// Works as a classic browser script (global `Goods`) and as a Node module.

const Goods = (() => {
  // Rarity levels. weight: how often each level turns up when something is found.
  const RARITY = [
    null,
    { level: 1, key: 'common', label: 'Common', color: '#aab3cc', weight: 55 },
    { level: 2, key: 'uncommon', label: 'Uncommon', color: '#6fd08c', weight: 28 },
    { level: 3, key: 'rare', label: 'Rare', color: '#5aa9ff', weight: 12 },
    { level: 4, key: 'very-rare', label: 'Very rare', color: '#c77dff', weight: 4 },
    { level: 5, key: 'exotic', label: 'Exotic', color: '#ff8f5a', weight: 1 },
  ];

  // Categories. shape: the art each category is drawn as (art/items.js). The trade category ids
  // are the item kinds from before types existed, which older saves still use.
  const CATEGORIES = {
    metal: { group: 'trade', label: 'Metals' },
    mineral: { group: 'trade', label: 'Minerals' },
    gas: { group: 'trade', label: 'Gases' },
    synthetic: { group: 'trade', label: 'Synthetics' },
    crates: { group: 'trade', label: 'Manufactured goods' },
    barrels: { group: 'trade', label: 'Liquids' },
    tubes: { group: 'trade', label: 'Conduits & cables' },
    hull: { group: 'salvage', label: 'Hull components' },
    weapon: { group: 'salvage', label: 'Weapon components' },
    computer: { group: 'salvage', label: 'Computer components' },
    drive: { group: 'salvage', label: 'Drive components' },
  };

  // Trade goods: [id, name, rarity, price, [hue, saturation, lightness]] per category, commonest
  // first. (Components are added below.)
  const TABLE = {
    metal: [
      ['iron', 'Iron', 1, 35, [212, 0.12, 0.42]],
      ['titanium', 'Titanium', 2, 110, [255, 0.25, 0.6]],
      ['platinum', 'Platinum', 4, 600, [175, 0.45, 0.72]],
    ],
    mineral: [
      ['corundum', 'Corundum', 3, 220, [222, 0.75, 0.52]],
      ['diamond', 'Diamond', 4, 550, [195, 0.7, 0.86]],
    ],
    gas: [
      ['deuterium', 'Deuterium', 3, 170, [28, 0.85, 0.55]],
      ['helium-3', 'Helium-3', 4, 420, [55, 0.95, 0.6]],
    ],
    synthetic: [
      ['carbon-fibre', 'Carbon fibre', 2, 140, [220, 0.12, 0.3]],
      ['aerogel', 'Aerogel', 3, 300, [195, 0.75, 0.84]],
      ['graphene', 'Graphene', 3, 330, [160, 0.25, 0.42]],
      ['metamaterial', 'Metamaterial', 4, 750, [140, 0.75, 0.5]],
    ],
    crates: [
      ['electronics', 'Electronics', 2, 110, [160, 0.6, 0.42]],
      ['robotics', 'Robotics', 3, 280, [45, 0.9, 0.55]],
      ['ai-cores', 'AI cores', 4, 800, [190, 0.85, 0.55]],
    ],
    barrels: [
      ['hydrazine', 'Hydrazine', 2, 70, [32, 0.85, 0.52]],
      ['nanite-suspension', 'Nanite suspension', 4, 520, [200, 0.1, 0.78]],
    ],
    tubes: [
      ['steel-pipe', 'Steel pipe', 1, 50, [210, 0.1, 0.55]],
      ['copper-cable', 'Copper cable', 2, 110, [18, 0.65, 0.45]],
      ['optical-fibre', 'Optical fibre', 2, 135, [185, 0.85, 0.62]],
      ['superconductor', 'Superconductor cable', 3, 320, [230, 0.75, 0.62]],
      ['plasma-conduit', 'Plasma conduit', 4, 700, [330, 0.8, 0.6]],
    ],
  };

  // Components are generic and tiered ("Simple computer components" ... "Exotic computer
  // components"): one type per tier, the tier being its rarity. They're research materials, so
  // each has a `tier`, and Goods.component(category, tier) finds one. Every
  // category uses the same colour per tier (the rarity colours), so a tier reads the same
  // everywhere. shapes: the art variant (art/items.js) per tier, from plainer to more intricate.
  const TIERS = [null, 'Simple', 'Standard', 'Advanced', 'Complex', 'Exotic'];
  const TIER_COLORS = [null, [224, 0.24, 0.73], [139, 0.52, 0.63], [211, 0.9, 0.66], [276, 0.85, 0.72], [19, 0.95, 0.66]];
  const COMPONENTS = {
    hull: { noun: 'hull', prices: [80, 160, 340, 700, 1600], shapes: [0, 1, 2, 0, 2] },
    weapon: { noun: 'weapon', prices: [140, 280, 560, 1100, 2400], shapes: [0, 1, 2, 0, 2] },
    computer: { noun: 'computer', prices: [120, 240, 500, 1000, 2200], shapes: [0, 2, 1, 0, 1] },
    drive: { noun: 'drive', prices: [130, 260, 540, 1100, 2400], shapes: [0, 0, 1, 1, 2] },
  };
  for (const [category, c] of Object.entries(COMPONENTS)) {
    TABLE[category] = [1, 2, 3, 4, 5].map((tier) => [
      `${category}-${TIERS[tier].toLowerCase()}`, `${TIERS[tier]} ${c.noun} components`, tier, c.prices[tier - 1], TIER_COLORS[tier], c.shapes[tier - 1],
    ]);
  }

  const TYPES = {};
  const BY_CATEGORY = {};
  for (const [category, rows] of Object.entries(TABLE)) {
    BY_CATEGORY[category] = rows.map(([id, name, rarity, price, color, shape]) => {
      const t = { id, name, category, rarity, price, color, ...(shape !== undefined ? { shape, tier: rarity } : {}) };
      TYPES[id] = t;
      return t;
    });
  }

  const type = (id) => TYPES[id] || null;
  const ofCategory = (cat) => BY_CATEGORY[cat] || [];
  const categories = (group) => Object.keys(CATEGORIES).filter((c) => CATEGORIES[c].group === group);
  const isSalvage = (id) => !!TYPES[id] && CATEGORIES[TYPES[id].category].group === 'salvage';
  // The component of a category at a tier (1 simple ... 5 exotic), e.g. ('computer', 4) ->
  // 'computer-complex', or null.
  const component = (category, tier) => (COMPONENTS[category] && TIERS[tier] ? `${category}-${TIERS[tier].toLowerCase()}` : null);

  // A type of a category: first its rarity, weighted by how common each level is, then one of the
  // types at that level. Uses two numbers from rng.
  function pick(rng, cat) {
    const list = ofCategory(cat);
    const levels = [...new Set(list.map((t) => t.rarity))];
    const total = levels.reduce((n, l) => n + RARITY[l].weight, 0);
    let x = rng() * total, level = levels[levels.length - 1];
    for (const l of levels) if ((x -= RARITY[l].weight) < 0) { level = l; break; }
    const at = list.filter((t) => t.rarity === level);
    return at[Math.floor(rng() * at.length)].id;
  }

  // Older saves stored the category as the kind ('metal'), or only a label from the art.
  const LEGACY_LABELS = {
    Ingots: 'metal', 'Ore crystals': 'mineral', 'Gas canister': 'gas', 'Composite tiles': 'synthetic',
    'Cargo crates': 'crates', Barrels: 'barrels', 'Tube bundle': 'tubes',
    'Armour plate': 'hull', 'Hull rib': 'hull', 'Bulkhead hatch': 'hull', 'Railgun barrel': 'weapon', 'Missile rack': 'weapon',
    'Beam emitter': 'weapon', 'Logic board': 'computer', 'Processing core': 'computer', 'Memory rack': 'computer',
    'Thruster nozzle': 'drive', 'Reactor core': 'drive', 'Warp coil': 'drive',
  };
  // The current type for a stored kind (or label): a type id stays; an old category becomes its
  // commonest type. Types and categories no longer in the catalogue resolve to null (dropped).
  function resolve(kind, label) {
    if (kind && TYPES[kind]) return kind;
    const cat = kind && CATEGORIES[kind] ? kind : LEGACY_LABELS[label];
    return cat && ofCategory(cat).length ? ofCategory(cat)[0].id : null;
  }

  return { RARITY, CATEGORIES, TIERS, TYPES, type, ofCategory, categories, isSalvage, component, pick, resolve };
})();

if (typeof module !== 'undefined') module.exports = Goods;
