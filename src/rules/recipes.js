// Recipes: what production orders make (rules/industry.js), the production chain of notes/industry.md,
// pared back to one good per category (rules/goods.js). Each station works one process (BAYS,
// notes/hazards.md phase 6): the ore works refines iron and silicates, the volatiles works deuterium,
// the recycler salvaged components; the fabricator makes electronics from refined goods; the
// waystation's bench assembles Mk I gear (rules/loadout.js) and consumables, and the shipyard the rest
// of the gear and the mods, the best of it with salvaged components only pirates carry. Shared goods feed many
// recipes, so no good is a dead end. A recipe makes something worth more than what goes in. Mk I
// gear and everything below gear is known from the start; gear from Mk II up needs its blueprint
// researched (rules/research.js `bp.<gear id>`).
//
//   Recipes.BAYS[process]           { id, label, code, step, note }: the processes, in chain order; each
//                                   station type works one (two at the shipyard: Industry.PROCESS); step:
//                                   'refine' | 'parts' | 'assemble', the pipeline's column
//   Recipes.RECIPES[id]             { id, bay (its process), in: { [kind]: n }, out: { [kind]: n }, time (s per run), unlock: research id | null }
//   Recipes.LIST                    every recipe, in display order
//   Recipes.forBay(process | [process]) -> [recipe]
//   Recipes.known(done) -> Set      recipe ids known, given the research done (rules/research.js)
//   Recipes.producers(kind), Recipes.consumers(kind) -> [recipe]   the recipes that make / use it
//   Recipes.item(kind) -> { id, name, kind: 'good' | 'component' | 'gear' | 'mod' | 'consumable', stage, price, tier?, slot? } | null
//   Recipes.value(counts) -> credits   what a set of things is worth at base prices
//   Recipes.gearRecipe(gear id) -> recipe   the bench's or shipyard's recipe for a piece of gear
// Kinds are rules/goods.js type ids (trade goods and components) and, made by the bench and shipyard,
// rules/loadout.js equipment ids, rules/mods.js mod ids (each mod's kind researched first) and
// rules/abilities.js consumables (known from the start). ES module (`Recipes`); also runs in Node (the tests).

import { Abilities } from './abilities.js';
import { Goods } from './goods.js';
import { Loadout } from './loadout.js';
import { Mods } from './mods.js';

const Recipes = (() => {
  const BAYS = {
    ore: { id: 'ore', label: 'Ore works', code: 'ORE', step: 'refine', note: 'iron and silicates into steel pipe and carbon fibre' },
    volatiles: { id: 'volatiles', label: 'Volatiles works', code: 'VOL', step: 'refine', note: 'deuterium into hydrazine' },
    recycle: { id: 'recycle', label: 'Recycler', code: 'RCY', step: 'refine', note: 'salvaged components into refined goods' },
    parts: { id: 'parts', label: 'Fabricator', code: 'FAB', step: 'parts', note: 'refined goods into electronics' },
    bench: { id: 'bench', label: 'Bench', code: 'BEN', step: 'assemble', note: 'Mk I gear and consumables' },
    shipyard: { id: 'shipyard', label: 'Shipyard', code: 'SHY', step: 'assemble', note: 'gear from Mk II and mods' },
  };
  const c = (category) => Goods.component(category);

  // [process, seconds per run, { in }, { out }]: the output's first kind names the recipe.
  const TABLE = [
    // Refining raw materials.
    ['ore', 20, { iron: 2 }, { 'steel-pipe': 1 }],
    ['ore', 20, { silicates: 3 }, { 'carbon-fibre': 1 }],
    ['volatiles', 20, { deuterium: 2 }, { hydrazine: 1 }],
    // Recycling salvage into refined goods.
    ['recycle', 20, { [c('hull')]: 1 }, { 'steel-pipe': 2 }],
    ['recycle', 20, { [c('weapon')]: 1 }, { 'steel-pipe': 2, 'carbon-fibre': 2 }],
    ['recycle', 20, { [c('computer')]: 1 }, { electronics: 1, 'steel-pipe': 1 }],
    ['recycle', 20, { [c('drive')]: 1 }, { hydrazine: 2, iron: 1 }],
    // Parts.
    ['parts', 30, { 'steel-pipe': 1, 'carbon-fibre': 1 }, { electronics: 1 }],
  ];

  const RECIPES = {};
  for (const [bay, time, input, out] of TABLE) {
    const first = Object.keys(input)[0], made = Object.keys(out)[0];
    // Recycling is named for what goes in; everything else for what comes out.
    const id = Goods.isSalvage(first) ? `recycle.${first}` : `make.${made}`;
    RECIPES[id] = { id, bay, in: input, out, time, unlock: null };
  }

  // Gear, per line, Mk I to Mk V (from the line's first Mk): what goes into each. Mk I takes refined
  // goods, Mk II and up electronics too; Mk IV and V take salvaged components of the gear's kind
  // (SALVAGE_COUNT). From Mk III, some take raw goods found only on planets and moons: tungsten for
  // the drill and radiation shielding, titanium for shields and radiators, rare earths for scanners
  // (and sulfur goes into charges). The gear is worth more than its inputs (rules/loadout.js prices).
  const SALVAGE = { weapon: 'weapon', shield: 'hull', computer: 'computer', engine: 'drive', scanner: 'computer', utility: 'hull' };
  const SALVAGE_COUNT = [0, 0, 0, 0, 8, 13];
  const GEAR = {
    'pulse-laser': [
      { 'steel-pipe': 2 },
      { 'carbon-fibre': 2, 'steel-pipe': 2 },
      { 'carbon-fibre': 2, electronics: 2 },
      { 'carbon-fibre': 4, electronics: 2 },
      { 'carbon-fibre': 4, electronics: 2, 'steel-pipe': 4 },
    ],
    'heavy-cannon': [null,
      { 'carbon-fibre': 2, electronics: 1 },
      { 'carbon-fibre': 4, electronics: 2, tungsten: 2 },
      { 'carbon-fibre': 4, electronics: 3, tungsten: 3 },
      { 'carbon-fibre': 6, electronics: 4, tungsten: 4 },
    ],
    'beam-turret': [
      { 'steel-pipe': 2 },
      { 'carbon-fibre': 1, 'steel-pipe': 3 },
      { 'carbon-fibre': 2, 'steel-pipe': 5 },
      { 'carbon-fibre': 4, 'steel-pipe': 5 },
      { 'carbon-fibre': 4, 'steel-pipe': 10 },
    ],
    deflector: [
      { 'steel-pipe': 1, hydrazine: 1 },
      { electronics: 1, hydrazine: 1 },
      { electronics: 2, 'carbon-fibre': 2, 'titanium-ore': 2 },
      { electronics: 3, 'carbon-fibre': 3, 'titanium-ore': 3 },
      { electronics: 3, hydrazine: 3, 'carbon-fibre': 3, 'titanium-ore': 4 },
    ],
    'flight-computer': [
      { electronics: 1 },
      { electronics: 2, 'steel-pipe': 1 },
      { electronics: 4, 'steel-pipe': 1 },
      { electronics: 7 },
      { electronics: 7 },
    ],
    'courier-drive': [
      { 'steel-pipe': 1, hydrazine: 1 },
      { electronics: 1, hydrazine: 1 },
      { electronics: 3 },
      { electronics: 4 },
      { electronics: 3, 'steel-pipe': 4 },
    ],
    'survey-scanner': [
      { 'steel-pipe': 1 },
      { electronics: 1, 'steel-pipe': 1 },
      { electronics: 3, 'carbon-fibre': 2, 'rare-earths': 1 },
      { electronics: 3, 'carbon-fibre': 4, 'rare-earths': 2 },
      { electronics: 6, 'carbon-fibre': 4, 'rare-earths': 3 },
    ],
    radiator: [
      { 'steel-pipe': 2 },
      { 'steel-pipe': 2, 'carbon-fibre': 1 },
      { 'carbon-fibre': 2, electronics: 1, 'titanium-ore': 2 },
      { 'carbon-fibre': 3, electronics: 2, 'titanium-ore': 3 },
      { 'carbon-fibre': 4, electronics: 3, 'titanium-ore': 4 },
    ],
    'rad-shielding': [
      { 'steel-pipe': 1, 'carbon-fibre': 1 },
      { 'steel-pipe': 2, 'carbon-fibre': 1 },
      { 'carbon-fibre': 2, electronics: 1, tungsten: 2 },
      { 'carbon-fibre': 3, electronics: 2, tungsten: 3 },
      { 'carbon-fibre': 4, electronics: 3, tungsten: 4 },
    ],
    'aux-tank': [
      { 'steel-pipe': 2 },
      { 'steel-pipe': 2, 'carbon-fibre': 1 },
      { 'steel-pipe': 3, 'carbon-fibre': 2, electronics: 1 },
      { 'carbon-fibre': 4, electronics: 1 },
      { 'carbon-fibre': 5, electronics: 2 },
    ],
    'cargo-pod': [
      { 'steel-pipe': 2 },
      { 'steel-pipe': 3, 'carbon-fibre': 1 },
      { 'steel-pipe': 3, 'carbon-fibre': 2, electronics: 1 },
      { 'carbon-fibre': 4, electronics: 1 },
      { 'carbon-fibre': 5, electronics: 2 },
    ],
  };
  const GEAR_TIME = [0, 120, 300, 900, 2700, 7200];
  for (const [line, tiers] of Object.entries(GEAR)) {
    const cat = SALVAGE[Loadout.LINES[line].slot];
    tiers.forEach((parts, i) => {
      if (!parts) return;
      const tier = i + 1, gear = `${line}-${tier}`;
      const input = { ...parts };
      if (SALVAGE_COUNT[tier]) input[c(cat)] = SALVAGE_COUNT[tier];
      RECIPES[`make.${gear}`] = { id: `make.${gear}`, bay: tier > 1 ? 'shipyard' : 'bench', in: input, out: { [gear]: 1 }, time: GEAR_TIME[tier], unlock: tier > 1 ? `bp.${gear}` : null };
    });
  }
  // Mods, at the shipyard, once their kind is researched (rules/research.js `mods.<slot>`). A mod is
  // worth a little more than what goes into it.
  const MOD_PARTS = {
    'mod.extended-barrel': { 'carbon-fibre': 2, 'steel-pipe': 2 },
    'mod.overcharger': { electronics: 1, 'steel-pipe': 2 },
    'mod.rapid-cycler': { electronics: 2 },
    'mod.gimbal-mount': { electronics: 2, 'carbon-fibre': 2 },
    'mod.hardened-emitter': { 'carbon-fibre': 4, electronics: 1 },
    'mod.fast-cycler': { electronics: 2, 'steel-pipe': 2 },
    'mod.targeting-suite': { electronics: 3 },
    'mod.ore-analyser': { electronics: 1, 'carbon-fibre': 2 },
    'mod.lock-accelerator': { electronics: 2, 'steel-pipe': 2 },
    'mod.afterburner': { electronics: 1, hydrazine: 3 },
    'mod.vector-thrusters': { electronics: 2, hydrazine: 1 },
    'mod.evasion-routine': { electronics: 3, hydrazine: 1 },
    'mod.long-array': { electronics: 1, 'steel-pipe': 2 },
    'mod.lock-array': { electronics: 2, 'carbon-fibre': 1 },
  };
  const MOD_PRICE = {};
  for (const m of Mods.LIST) {
    RECIPES[`make.${m.id}`] = { id: `make.${m.id}`, bay: 'shipyard', in: MOD_PARTS[m.id], out: { [m.id]: 1 }, time: 600, unlock: `mods.${m.slot}` };
    MOD_PRICE[m.id] = Math.round(Object.entries(MOD_PARTS[m.id]).reduce((sum, [kind, count]) => sum + Goods.type(kind).price * count, 0) * 1.3 / 10) * 10;
  }
  // Consumables for abilities (rules/abilities.js), at the bench: [id, { in }, how many a run makes].
  const CONSUMABLES = [
    ['repair-nanites', { hydrazine: 3 }, 2],
    ['shield-cell', { electronics: 2 }, 1],
    ['emp-charge', { electronics: 1, 'steel-pipe': 1, sulfur: 2 }, 1],
    ['jammer-pod', { electronics: 2, 'carbon-fibre': 1 }, 2],
    ['coolant-flush', { deuterium: 2, 'steel-pipe': 1 }, 2],
    ['rad-purge', { 'carbon-fibre': 1, hydrazine: 1 }, 1],
    ['fuel-canister', { hydrazine: 1, 'steel-pipe': 1 }, 1],
    ['seismic-charge', { sulfur: 2, 'steel-pipe': 1 }, 2],
  ];
  for (const [id, input, n] of CONSUMABLES) RECIPES[`make.${id}`] = { id: `make.${id}`, bay: 'bench', in: input, out: { [id]: n }, time: 300, unlock: null };
  // An alternative recipe, unlocked by industry research (rules/research.js `ind.alt.*`).
  RECIPES['alt.electronics'] = { id: 'alt.electronics', bay: 'parts', in: { silicates: 3, 'steel-pipe': 1 }, out: { electronics: 1 }, time: 40, unlock: 'ind.alt.electronics' };
  const LIST = Object.values(RECIPES);

  const forBay = (types) => LIST.filter((r) => [].concat(types).includes(r.bay));
  const known = (done = []) => new Set(LIST.filter((r) => !r.unlock || done.includes(r.unlock)).map((r) => r.id));
  const producers = (kind) => LIST.filter((r) => kind in r.out);
  const consumers = (kind) => LIST.filter((r) => kind in r.in);
  function item(kind) {
    const t = Goods.type(kind);
    if (t) return { id: kind, name: t.name, kind: Goods.isSalvage(kind) ? 'component' : 'good', stage: t.stage, price: t.price, tier: t.tier };
    const e = Loadout.EQUIPMENT[kind];
    if (e) return e.npc ? null : { id: kind, name: e.name, kind: 'gear', stage: 'item', price: e.price, tier: e.tier, slot: e.slot };
    const m = Mods.MODS[kind];
    if (m) return { id: kind, name: m.name, kind: 'mod', stage: 'item', price: MOD_PRICE[kind], slot: m.slot };
    const a = Abilities.ABILITIES[kind];
    return a ? { id: kind, name: a.name, kind: 'consumable', stage: 'item', price: a.price, code: a.code } : null;
  }
  const value = (counts) => Object.entries(counts).reduce((n, [kind, k]) => n + (item(kind)?.price || 0) * k, 0);
  const gearRecipe = (gear) => RECIPES[`make.${gear}`] || null;

  return { BAYS, SALVAGE, RECIPES, LIST, forBay, known, producers, consumers, item, value, gearRecipe };
})();

export { Recipes };
