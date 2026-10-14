'use strict';

// The item catalogue: every kind of trade good and salvaged component, with its rarity, base price
// and colour. Items are grouped into categories:
// - trade goods (metals, minerals, gases, synthetics, manufactured goods, liquids, conduits,
//   fabrics, food): mostly real materials and wares, with science-fiction ones at the rare end,
// - salvaged components (hull, weapon, computer, drive): generic, in five tiers from simple to
//   exotic ("Simple computer components"), used up by research (research.js). They're never
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
    fabrics: { group: 'trade', label: 'Fabrics' },
    perishables: { group: 'trade', label: 'Food' },
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
      ['aluminium', 'Aluminium', 1, 45, [205, 0.1, 0.7]],
      ['copper', 'Copper', 2, 80, [20, 0.7, 0.5]],
      ['titanium', 'Titanium', 2, 110, [255, 0.25, 0.6]],
      ['silver', 'Silver', 3, 200, [190, 0.15, 0.9]],
      ['gold', 'Gold', 3, 280, [45, 0.85, 0.55]],
      ['platinum', 'Platinum', 4, 600, [175, 0.45, 0.72]],
      ['neutronium', 'Neutronium', 5, 1500, [280, 0.75, 0.55]],
    ],
    mineral: [
      ['quartz', 'Quartz', 1, 25, [38, 0.3, 0.68]],
      ['hematite', 'Hematite', 1, 35, [355, 0.5, 0.38]],
      ['malachite', 'Malachite', 2, 70, [150, 0.6, 0.4]],
      ['fluorite', 'Fluorite', 2, 80, [275, 0.55, 0.62]],
      ['beryl', 'Beryl', 3, 180, [172, 0.55, 0.62]],
      ['corundum', 'Corundum', 3, 220, [222, 0.75, 0.52]],
      ['diamond', 'Diamond', 4, 550, [195, 0.7, 0.86]],
      ['void-crystal', 'Void crystal', 5, 1400, [310, 0.7, 0.42]],
    ],
    gas: [
      ['hydrogen', 'Hydrogen', 1, 18, [200, 0.65, 0.72]],
      ['nitrogen', 'Nitrogen', 1, 22, [230, 0.2, 0.55]],
      ['ammonia', 'Ammonia', 2, 45, [80, 0.55, 0.55]],
      ['argon', 'Argon', 2, 55, [300, 0.45, 0.68]],
      ['xenon', 'Xenon', 3, 140, [215, 0.85, 0.58]],
      ['deuterium', 'Deuterium', 3, 170, [28, 0.85, 0.55]],
      ['helium-3', 'Helium-3', 4, 420, [55, 0.95, 0.6]],
      ['antihydrogen', 'Antihydrogen', 5, 1600, [330, 0.9, 0.62]],
    ],
    synthetic: [
      ['polymer-sheet', 'Polymer sheet', 1, 60, [200, 0.3, 0.62]],
      ['fibreglass', 'Fibreglass', 1, 70, [60, 0.3, 0.72]],
      ['carbon-fibre', 'Carbon fibre', 2, 140, [220, 0.12, 0.3]],
      ['aramid', 'Aramid weave', 2, 160, [45, 0.8, 0.52]],
      ['aerogel', 'Aerogel', 3, 300, [195, 0.75, 0.84]],
      ['graphene', 'Graphene', 3, 330, [160, 0.25, 0.42]],
      ['metamaterial', 'Metamaterial', 4, 750, [140, 0.75, 0.5]],
      ['programmable-matter', 'Programmable matter', 5, 1800, [285, 0.8, 0.62]],
    ],
    crates: [
      ['tools', 'Tools', 1, 45, [28, 0.45, 0.48]],
      ['spare-parts', 'Spare parts', 1, 55, [210, 0.22, 0.5]],
      ['electronics', 'Electronics', 2, 110, [160, 0.6, 0.42]],
      ['medical-supplies', 'Medical supplies', 2, 125, [0, 0.75, 0.6]],
      ['robotics', 'Robotics', 3, 280, [45, 0.9, 0.55]],
      ['luxury-goods', 'Luxury goods', 3, 320, [300, 0.5, 0.55]],
      ['ai-cores', 'AI cores', 4, 800, [190, 0.85, 0.55]],
      ['precursor-relics', 'Precursor relics', 5, 2200, [130, 0.9, 0.6]],
    ],
    barrels: [
      ['water', 'Water', 1, 18, [205, 0.75, 0.55]],
      ['coolant', 'Coolant', 1, 32, [170, 0.6, 0.48]],
      ['sulphuric-acid', 'Sulphuric acid', 2, 60, [68, 0.75, 0.5]],
      ['hydrazine', 'Hydrazine', 2, 70, [32, 0.85, 0.52]],
      ['heavy-water', 'Heavy water', 3, 180, [235, 0.6, 0.45]],
      ['ferrofluid', 'Ferrofluid', 3, 210, [270, 0.25, 0.28]],
      ['nanite-suspension', 'Nanite suspension', 4, 520, [200, 0.1, 0.78]],
      ['quantum-fluid', 'Quantum fluid', 5, 1400, [320, 0.85, 0.6]],
    ],
    tubes: [
      ['plastic-conduit', 'Plastic conduit', 1, 45, [30, 0.65, 0.58]],
      ['steel-pipe', 'Steel pipe', 1, 50, [210, 0.1, 0.55]],
      ['copper-cable', 'Copper cable', 2, 110, [18, 0.65, 0.45]],
      ['optical-fibre', 'Optical fibre', 2, 135, [185, 0.85, 0.62]],
      ['superconductor', 'Superconductor cable', 3, 320, [230, 0.75, 0.62]],
      ['plasma-conduit', 'Plasma conduit', 4, 700, [330, 0.8, 0.6]],
      ['tachyon-conduit', 'Tachyon conduit', 5, 1600, [100, 0.9, 0.58]],
    ],
    fabrics: [
      ['cotton', 'Cotton', 1, 35, [45, 0.2, 0.86]],
      ['nylon', 'Nylon', 1, 40, [210, 0.55, 0.6]],
      ['wool', 'Wool', 2, 80, [28, 0.35, 0.58]],
      ['silk', 'Silk', 2, 130, [340, 0.5, 0.7]],
      ['spider-silk', 'Spider silk', 3, 300, [255, 0.4, 0.78]],
      ['smart-fabric', 'Smart fabric', 4, 650, [165, 0.8, 0.5]],
      ['nanoweave', 'Nanoweave', 5, 1500, [285, 0.8, 0.6]],
    ],
    perishables: [
      ['algae-paste', 'Algae paste', 1, 15, [120, 0.5, 0.38]],
      ['grain', 'Grain', 1, 18, [45, 0.65, 0.55]],
      ['fresh-fruit', 'Fresh fruit', 2, 50, [8, 0.75, 0.55]],
      ['coffee', 'Coffee', 2, 65, [25, 0.55, 0.3]],
      ['spices', 'Spices', 3, 160, [35, 0.9, 0.5]],
      ['saffron', 'Saffron', 4, 450, [350, 0.8, 0.45]],
      ['xenoflora', 'Xenoflora', 5, 1200, [170, 0.9, 0.55]],
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
    'Cargo crates': 'crates', Barrels: 'barrels', 'Tube bundle': 'tubes', 'Fabric bolts': 'fabrics', 'Produce crate': 'perishables',
    'Armour plate': 'hull', 'Hull rib': 'hull', 'Bulkhead hatch': 'hull', 'Railgun barrel': 'weapon', 'Missile rack': 'weapon',
    'Beam emitter': 'weapon', 'Logic board': 'computer', 'Processing core': 'computer', 'Memory rack': 'computer',
    'Thruster nozzle': 'drive', 'Reactor core': 'drive', 'Warp coil': 'drive',
  };
  // The current type for a stored kind (or label): a type id stays; an old category becomes its
  // commonest type.
  function resolve(kind, label) {
    if (kind && TYPES[kind]) return kind;
    const cat = kind && CATEGORIES[kind] ? kind : LEGACY_LABELS[label];
    return cat ? ofCategory(cat)[0].id : null;
  }

  return { RARITY, CATEGORIES, TIERS, TYPES, type, ofCategory, categories, isSalvage, component, pick, resolve };
})();

if (typeof module !== 'undefined') module.exports = Goods;
