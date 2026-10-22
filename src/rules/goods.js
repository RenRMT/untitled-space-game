// The item catalogue: every kind of trade good and salvaged component, with its rarity, base price
// and colour. Items are grouped into categories, one type each (the game is pared back to its core
// loop; notes/industry.md has the fuller chain this came from):
// - trade goods (metal, mineral, gas, synthetic, manufactured, liquid, conduit): raw materials
//   mined and collected, and what industry makes of them (rules/recipes.js),
// - salvaged components (hull, weapon, computer, drive): generic, one type per category, used up by
//   research (rules/research.js) and the best gear. They're never traded, so their price is only a
//   guide to what they're worth.
// Each type has a rarity from 1 (common) to 5 (exotic). Rarer types are found less often, sold at
// fewer stations (exotics never) and are worth more. Each type has its own colour, used for its art
// (art/items.js) and on the station screen.
//
// Each trade good also has a stage in the production chain (notes/industry.md): raw (mined or
// collected), refined or part (fabricated); components are salvage.
//
//   Goods.type(id)              -> { id, name, category, rarity, price, stage, color: [h, s, l], shape?, surface? }
//                                  surface: a raw good found only on planets and moons
//   Goods.STAGES                -> the stages in chain order, salvage beside raw
//   Goods.component(cat)        -> the component type id of a salvage category
//   Goods.ofCategory(cat)       -> types of a category, commonest first
//   Goods.categories(group)     -> category ids of 'trade' or 'salvage'
//   Goods.pick(rng, cat, where?) -> a type id of that category, rarer ones less likely; where: a stage, or
//                                  a test of the type, narrows it
//   Goods.resolve(kind, label?) -> the current type id for an item from an older save, or null
// ES module (`Goods`); also runs in Node (the tests).

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

  // Trade goods: [id, name, rarity, price, [hue, saturation, lightness]] per category. (Components
  // are added below.) Iron, silicates and deuterium come from asteroids and gas pockets in space; the
  // rest of the raw goods only from deposits on planets and moons (rules/hazards.js surface). A made good is worth more than what it's made of (rules/recipes.js), so
  // prices rise along the chain.
  const TABLE = {
    metal: [['iron', 'Iron', 1, 35, [212, 0.12, 0.42]], ['titanium-ore', 'Titanium ore', 2, 60, [190, 0.18, 0.66]], ['tungsten', 'Tungsten', 3, 90, [30, 0.3, 0.3]]],
    mineral: [['silicates', 'Silicates', 1, 30, [45, 0.3, 0.7]], ['sulfur', 'Sulfur', 2, 40, [56, 0.85, 0.55]], ['rare-earths', 'Rare earths', 3, 100, [300, 0.35, 0.6]]],
    gas: [['deuterium', 'Deuterium', 1, 50, [28, 0.85, 0.55]]],
    synthetic: [['carbon-fibre', 'Carbon fibre', 2, 110, [220, 0.12, 0.3]]],
    crates: [['electronics', 'Electronics', 2, 225, [160, 0.6, 0.42]]],
    barrels: [['hydrazine', 'Hydrazine', 2, 130, [32, 0.85, 0.52]]],
    tubes: [['steel-pipe', 'Steel pipe', 1, 90, [210, 0.1, 0.55]]],
  };

  // Components: one generic type per salvage category ("Computer components"). shape: the art
  // variant (art/items.js).
  const COMPONENTS = {
    hull: { noun: 'Hull', price: 160, color: [224, 0.24, 0.73], shape: 0 },
    weapon: { noun: 'Weapon', price: 280, color: [19, 0.95, 0.66], shape: 1 },
    computer: { noun: 'Computer', price: 240, color: [211, 0.9, 0.66], shape: 2 },
    drive: { noun: 'Drive', price: 260, color: [139, 0.52, 0.63], shape: 1 },
  };
  for (const [category, c] of Object.entries(COMPONENTS)) TABLE[category] = [[`${category}-components`, `${c.noun} components`, 2, c.price, c.color, c.shape]];

  // Production stages, in chain order (rules/recipes.js makes each from earlier ones).
  const STAGES = ['raw', 'salvage', 'refined', 'part'];
  const STAGE_OF = {
    raw: ['iron', 'silicates', 'deuterium', 'titanium-ore', 'tungsten', 'sulfur', 'rare-earths'],
    refined: ['steel-pipe', 'carbon-fibre', 'hydrazine'],
    part: ['electronics'],
  };
  // Raw goods found only on planets and moons: never stocked at a market or found in a wreck.
  const SURFACE_RAW = ['titanium-ore', 'tungsten', 'sulfur', 'rare-earths'];
  const stageOf = (id, category) => (CATEGORIES[category].group === 'salvage' ? 'salvage'
    : Object.keys(STAGE_OF).find((st) => STAGE_OF[st].includes(id)));

  const TYPES = {};
  const BY_CATEGORY = {};
  for (const [category, rows] of Object.entries(TABLE)) {
    BY_CATEGORY[category] = rows.map(([id, name, rarity, price, color, shape]) => {
      const t = { id, name, category, rarity, price, stage: stageOf(id, category), color, ...(shape !== undefined ? { shape } : {}), ...(SURFACE_RAW.includes(id) ? { surface: true } : {}) };
      TYPES[id] = t;
      return t;
    });
  }

  const type = (id) => TYPES[id] || null;
  const ofCategory = (cat) => BY_CATEGORY[cat] || [];
  const categories = (group) => Object.keys(CATEGORIES).filter((c) => CATEGORIES[c].group === group);
  const isSalvage = (id) => !!TYPES[id] && CATEGORIES[TYPES[id].category].group === 'salvage';
  // The component of a salvage category, e.g. 'computer' -> 'computer-components', or null.
  const component = (category) => (COMPONENTS[category] ? `${category}-components` : null);

  // A type of a category (and of a stage, if given): first its rarity, weighted by how common each
  // level is, then one of the types at that level. Uses two numbers from rng.
  function pick(rng, cat, where) {
    const keep = typeof where === 'function' ? where : (t) => !where || t.stage === where;
    const list = ofCategory(cat).filter(keep);
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
  // Types from before the catalogue was pared back, by category.
  const FORMER = {};
  const OLD = {
    metal: ['copper-ore', 'titanium', 'platinum'], mineral: ['carbon', 'corundum', 'diamond'], gas: ['water-ice', 'helium-3'],
    synthetic: ['aerogel', 'graphene', 'hull-plating', 'focusing-lens', 'metamaterial'],
    crates: ['actuator', 'power-cell', 'sensor-array', 'thruster-nozzle', 'capacitor', 'robotics', 'ai-cores'],
    barrels: ['nanite-suspension'], tubes: ['copper-cable', 'optical-fibre', 'superconductor', 'cooling-loop', 'plasma-conduit'],
  };
  for (const [category, ids] of Object.entries(OLD)) for (const id of ids) FORMER[id] = category;
  for (const category of Object.keys(COMPONENTS)) for (const tier of ['simple', 'standard', 'advanced', 'complex', 'exotic']) FORMER[`${category}-${tier}`] = category;
  // The current type for a stored kind (or label): a type id stays; an old category, or a type
  // from before the catalogue was pared back to one per category (iron for platinum, computer
  // components for 'computer-exotic'), becomes its category's type. Unknown kinds resolve to null
  // (dropped).
  function resolve(kind, label) {
    if (kind && TYPES[kind]) return kind;
    if (kind && FORMER[kind]) return ofCategory(FORMER[kind])[0].id;
    const cat = kind && CATEGORIES[kind] ? kind : LEGACY_LABELS[label];
    return cat && ofCategory(cat).length ? ofCategory(cat)[0].id : null;
  }

  return { RARITY, CATEGORIES, STAGES, SURFACE_RAW, TYPES, type, ofCategory, categories, isSalvage, component, pick, resolve };
})();

export { Goods };
