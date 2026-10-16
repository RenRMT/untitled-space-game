// Recipes: what industry makes (rules/industry.js), the production chain of notes/industry.md.
// Raw materials (mined and collected) and salvaged components go into a refinery, which makes
// refined goods and refines them further; a fabricator makes parts from those; an assembler makes
// gear (rules/loadout.js) from parts, the best of it with complex and exotic components only
// pirates in dangerous space carry. Shared goods feed many recipes (copper cable goes into
// electronics, capacitors, power cells and superconductors), so no good is a dead end. A recipe
// makes something worth more than what goes in. Mk I gear and everything below gear is known from
// the start; gear from Mk II up needs its blueprint researched (rules/research.js `bp.<gear id>`).
//
//   Recipes.BAYS[type]              { id, label, code, note }: the kinds of bay, in chain order
//   Recipes.RECIPES[id]             { id, bay, in: { [kind]: n }, out: { [kind]: n }, time (s per run), unlock: research id | null }
//   Recipes.LIST                    every recipe, in display order
//   Recipes.forBay(type) -> [recipe]
//   Recipes.known(done) -> Set      recipe ids known, given the research done (rules/research.js)
//   Recipes.producers(kind), Recipes.consumers(kind) -> [recipe]   the recipes that make / use it
//   Recipes.item(kind) -> { id, name, kind: 'good' | 'component' | 'gear' | 'mod', stage, price, tier?, slot? } | null
//   Recipes.value(counts) -> credits   what a set of things is worth at base prices
//   Recipes.gearRecipe(gear id) -> recipe   the assembler's recipe for a piece of gear
// Kinds are rules/goods.js type ids (trade goods and components) and, made by the assembler,
// rules/loadout.js equipment ids and rules/mods.js mod ids (each mod's kind researched first). ES module (`Recipes`); also runs in Node (the tests).

import { Goods } from './goods.js';
import { Loadout } from './loadout.js';
import { Mods } from './mods.js';

const Recipes = (() => {
  const BAYS = {
    refinery: { id: 'refinery', label: 'Refinery', code: 'REF', note: 'raw materials and salvage into refined goods' },
    fabricator: { id: 'fabricator', label: 'Fabricator', code: 'FAB', note: 'refined goods into parts' },
    assembler: { id: 'assembler', label: 'Assembler', code: 'ASM', note: 'parts into ship gear, by blueprint' },
  };
  const c = (category, tier) => Goods.component(category, tier);

  // [bay, seconds per run, { in }, { out }]: the output's first kind names the recipe.
  const TABLE = [
    // Refining raw materials.
    ['refinery', 20, { iron: 2 }, { 'steel-pipe': 1 }],
    ['refinery', 20, { 'copper-ore': 2 }, { 'copper-cable': 1 }],
    ['refinery', 20, { carbon: 3 }, { 'carbon-fibre': 1 }],
    ['refinery', 20, { 'water-ice': 2 }, { hydrazine: 1 }],
    ['refinery', 25, { silicates: 2 }, { 'optical-fibre': 1 }],
    // Refining further.
    ['refinery', 40, { silicates: 2, deuterium: 1 }, { aerogel: 1 }],
    ['refinery', 40, { carbon: 3, corundum: 1 }, { graphene: 1 }],
    ['refinery', 40, { 'copper-cable': 2, deuterium: 1 }, { superconductor: 1 }],
    ['refinery', 60, { graphene: 1, platinum: 1 }, { metamaterial: 1 }],
    // Recycling salvage: simple and standard components into refined goods, advanced ones into parts.
    ['refinery', 15, { [c('hull', 1)]: 1 }, { 'steel-pipe': 2 }],
    ['refinery', 15, { [c('weapon', 1)]: 1 }, { 'copper-cable': 1, 'steel-pipe': 1 }],
    ['refinery', 15, { [c('computer', 1)]: 1 }, { 'copper-cable': 1, silicates: 2 }],
    ['refinery', 15, { [c('drive', 1)]: 1 }, { 'steel-pipe': 1, hydrazine: 1 }],
    ['refinery', 20, { [c('hull', 2)]: 1 }, { 'steel-pipe': 2, titanium: 1 }],
    ['refinery', 20, { [c('weapon', 2)]: 1 }, { 'copper-cable': 2, 'optical-fibre': 1 }],
    ['refinery', 20, { [c('computer', 2)]: 1 }, { electronics: 1, 'copper-cable': 1 }],
    ['refinery', 20, { [c('drive', 2)]: 1 }, { hydrazine: 2, titanium: 1, 'steel-pipe': 1 }],
    ['refinery', 30, { [c('hull', 3)]: 1 }, { 'hull-plating': 1, 'steel-pipe': 1 }],
    ['refinery', 30, { [c('weapon', 3)]: 1 }, { 'focusing-lens': 1, capacitor: 1 }],
    ['refinery', 30, { [c('computer', 3)]: 1 }, { 'sensor-array': 1, graphene: 1 }],
    ['refinery', 30, { [c('drive', 3)]: 1 }, { 'thruster-nozzle': 1, 'power-cell': 1 }],
    // Parts.
    ['fabricator', 30, { 'copper-cable': 1, silicates: 1 }, { electronics: 1 }],
    ['fabricator', 30, { 'steel-pipe': 1, electronics: 1 }, { actuator: 1 }],
    ['fabricator', 30, { hydrazine: 1, 'copper-cable': 1, titanium: 1 }, { 'power-cell': 1 }],
    ['fabricator', 30, { 'optical-fibre': 1, electronics: 1 }, { 'sensor-array': 1 }],
    ['fabricator', 30, { titanium: 2, 'carbon-fibre': 1 }, { 'thruster-nozzle': 1 }],
    ['fabricator', 30, { 'copper-cable': 1, graphene: 1 }, { capacitor: 1 }],
    ['fabricator', 30, { 'steel-pipe': 2, titanium: 1 }, { 'hull-plating': 1 }],
    ['fabricator', 30, { corundum: 1, 'optical-fibre': 1 }, { 'focusing-lens': 1 }],
    ['fabricator', 45, { superconductor: 1, 'helium-3': 1 }, { 'cooling-loop': 1 }],
    ['fabricator', 45, { actuator: 1, electronics: 1 }, { robotics: 1 }],
    ['fabricator', 60, { superconductor: 1, deuterium: 1, platinum: 1 }, { 'plasma-conduit': 1 }],
    ['fabricator', 60, { robotics: 1, aerogel: 1, 'water-ice': 1 }, { 'nanite-suspension': 1 }],
    ['fabricator', 90, { robotics: 1, metamaterial: 1, diamond: 1 }, { 'ai-cores': 1 }],
  ];

  const RECIPES = {};
  for (const [bay, time, input, out] of TABLE) {
    const first = Object.keys(input)[0], made = Object.keys(out)[0];
    // Recycling is named for what goes in; everything else for what comes out.
    const id = Goods.isSalvage(first) ? `recycle.${first}` : `make.${made}`;
    RECIPES[id] = { id, bay, in: input, out, time, unlock: null };
  }

  // Gear, per line, Mk I to Mk V (from the line's first Mk): what goes into each. Mk I takes refined
  // goods; Mk II and up parts; Mk IV two complex components of the gear's kind of salvage, Mk V an
  // exotic one too. The gear is worth more than its inputs (rules/loadout.js prices).
  const SALVAGE = { weapon: 'weapon', shield: 'hull', computer: 'computer', engine: 'drive', scanner: 'computer' };
  const GEAR = {
    'pulse-laser': [
      { 'copper-cable': 1, 'optical-fibre': 1 },
      { 'focusing-lens': 1, 'copper-cable': 2 },
      { 'focusing-lens': 1, capacitor: 1, 'power-cell': 1 },
      { 'focusing-lens': 2, capacitor: 1, 'power-cell': 1 },
      { 'focusing-lens': 2, capacitor: 2, 'plasma-conduit': 1 },
    ],
    'heavy-cannon': [null,
      { 'hull-plating': 1, actuator: 1 },
      { 'hull-plating': 2, actuator: 1, capacitor: 1 },
      { 'hull-plating': 2, actuator: 2, capacitor: 1 },
      { 'hull-plating': 3, robotics: 1, capacitor: 2 },
    ],
    'beam-turret': [null, null,
      { 'focusing-lens': 1, 'cooling-loop': 1, superconductor: 1 },
      { 'focusing-lens': 2, 'cooling-loop': 1, superconductor: 1 },
      { 'focusing-lens': 2, 'cooling-loop': 2, 'plasma-conduit': 1 },
    ],
    deflector: [
      { 'copper-cable': 1, hydrazine: 1 },
      { capacitor: 1, hydrazine: 1 },
      { capacitor: 1, 'power-cell': 1, graphene: 1 },
      { capacitor: 2, 'power-cell': 1, metamaterial: 1 },
      { capacitor: 2, 'power-cell': 1, 'nanite-suspension': 1, metamaterial: 1 },
    ],
    'flight-computer': [
      { electronics: 1 },
      { electronics: 2, 'optical-fibre': 1 },
      { electronics: 2, robotics: 1, 'optical-fibre': 1 },
      { electronics: 2, robotics: 2, 'sensor-array': 1 },
      { electronics: 2, robotics: 1, 'ai-cores': 1 },
    ],
    'courier-drive': [
      { 'steel-pipe': 1, hydrazine: 1 },
      { 'thruster-nozzle': 1, hydrazine: 1 },
      { 'thruster-nozzle': 2, 'power-cell': 1 },
      { 'thruster-nozzle': 2, 'power-cell': 2 },
      { 'thruster-nozzle': 3, 'plasma-conduit': 1 },
    ],
    'survey-scanner': [
      { 'optical-fibre': 1 },
      { 'sensor-array': 1, 'copper-cable': 1 },
      { 'sensor-array': 2, aerogel: 1, electronics: 1 },
      { 'sensor-array': 2, aerogel: 2, electronics: 1 },
      { 'sensor-array': 3, aerogel: 2, 'ai-cores': 1 },
    ],
  };
  const GEAR_TIME = [0, 120, 300, 900, 2700, 7200];
  for (const [line, tiers] of Object.entries(GEAR)) {
    const cat = SALVAGE[Loadout.LINES[line].slot];
    tiers.forEach((parts, i) => {
      if (!parts) return;
      const tier = i + 1, gear = `${line}-${tier}`;
      const input = { ...parts };
      if (tier >= 4) input[c(cat, 4)] = 2;
      if (tier === 5) input[c(cat, 5)] = 1;
      RECIPES[`make.${gear}`] = { id: `make.${gear}`, bay: 'assembler', in: input, out: { [gear]: 1 }, time: GEAR_TIME[tier], unlock: tier > 1 ? `bp.${gear}` : null };
    });
  }
  // Mods, at the assembler, once their kind is researched (rules/research.js `mods.<slot>`). A mod is
  // worth a little more than what goes into it.
  const MOD_PARTS = {
    'mod.extended-barrel': { 'focusing-lens': 1, 'steel-pipe': 2 },
    'mod.overcharger': { capacitor: 1, 'copper-cable': 2 },
    'mod.rapid-cycler': { actuator: 1, capacitor: 1 },
    'mod.gimbal-mount': { actuator: 2, 'hull-plating': 1 },
    'mod.hardened-emitter': { 'hull-plating': 2, capacitor: 1 },
    'mod.fast-cycler': { 'power-cell': 2, superconductor: 1 },
    'mod.targeting-suite': { 'sensor-array': 1, electronics: 2 },
    'mod.ore-analyser': { 'sensor-array': 1, aerogel: 1 },
    'mod.lock-accelerator': { electronics: 2, 'optical-fibre': 2 },
    'mod.afterburner': { 'thruster-nozzle': 1, hydrazine: 3 },
    'mod.vector-thrusters': { 'thruster-nozzle': 1, actuator: 1 },
    'mod.evasion-routine': { electronics: 1, actuator: 1, 'thruster-nozzle': 1 },
    'mod.long-array': { 'sensor-array': 1, 'optical-fibre': 2 },
    'mod.lock-array': { 'sensor-array': 1, electronics: 1 },
  };
  const MOD_PRICE = {};
  for (const m of Mods.LIST) {
    RECIPES[`make.${m.id}`] = { id: `make.${m.id}`, bay: 'assembler', in: MOD_PARTS[m.id], out: { [m.id]: 1 }, time: 600, unlock: `mods.${m.slot}` };
    MOD_PRICE[m.id] = Math.round(Object.entries(MOD_PARTS[m.id]).reduce((sum, [kind, count]) => sum + Goods.type(kind).price * count, 0) * 1.3 / 10) * 10;
  }
  // Alternative recipes, unlocked by industry research (rules/research.js `ind.alt.*`).
  RECIPES['alt.power-cell'] = { id: 'alt.power-cell', bay: 'fabricator', in: { 'water-ice': 2, 'copper-cable': 1, titanium: 1 }, out: { 'power-cell': 1 }, time: 40, unlock: 'ind.alt.power-cell' };
  RECIPES['alt.graphene'] = { id: 'alt.graphene', bay: 'refinery', in: { carbon: 4, 'water-ice': 1 }, out: { graphene: 1 }, time: 60, unlock: 'ind.alt.graphene' };
  const LIST = Object.values(RECIPES);

  const forBay = (type) => LIST.filter((r) => r.bay === type);
  const known = (done = []) => new Set(LIST.filter((r) => !r.unlock || done.includes(r.unlock)).map((r) => r.id));
  const producers = (kind) => LIST.filter((r) => kind in r.out);
  const consumers = (kind) => LIST.filter((r) => kind in r.in);
  function item(kind) {
    const t = Goods.type(kind);
    if (t) return { id: kind, name: t.name, kind: Goods.isSalvage(kind) ? 'component' : 'good', stage: t.stage, price: t.price, tier: t.tier };
    const e = Loadout.EQUIPMENT[kind];
    if (e) return e.npc ? null : { id: kind, name: e.name, kind: 'gear', stage: 'item', price: e.price, tier: e.tier, slot: e.slot };
    const m = Mods.MODS[kind];
    return m ? { id: kind, name: m.name, kind: 'mod', stage: 'item', price: MOD_PRICE[kind], slot: m.slot } : null;
  }
  const value = (counts) => Object.entries(counts).reduce((n, [kind, k]) => n + (item(kind)?.price || 0) * k, 0);
  const gearRecipe = (gear) => RECIPES[`make.${gear}`] || null;

  return { BAYS, SALVAGE, RECIPES, LIST, forBay, known, producers, consumers, item, value, gearRecipe };
})();

export { Recipes };
