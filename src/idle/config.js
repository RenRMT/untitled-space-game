// The idle game's numbers, in one place (notes/idle.md): money, room, how fast drills pull and what
// they cost, surveying, the haulers' speed, the stations there are to build, and the production
// tables it runs on. The game's own tables (rules/recipes.js, rules/industry.js, rules/restoration.js)
// are read, never changed: what differs here is passed to their create().
//
//   Config.START_CREDITS, SITE_STORAGE, STATION_STORAGE, STATION_SLOTS, HAULER_SPEED, AWAY_SHEET (ms)
//   Config.EXTRACT_TIME[rarity] -> s per unit a drill pulls
//   Config.DRILL { base: { field, surface: [by rarity] }, growth, free }   what the next drill costs
//   Config.SURVEY { credits, growth, secs, perUnit, find, findCredits }   what a survey costs and takes,
//     and the odds and size of what it may turn up
//   Config.BERTHS[body kind] -> how many stations can orbit one body of that kind
//   Config.GEAR_SALE                share of an item's price (gear, consumables) a station pays for it
//   Config.SWAP[component] -> good  what the idle game asks for in place of a salvaged component in
//     costs and recipes (only the salvage yard's wreck field turns them out, late, so nothing before
//     it asks for one); Config.swap(counts) -> counts with those swapped
//   Config.SALVAGE_TIME             s per component the wreck field turns out
//   Config.RECIPES                  every one of the game's recipes, salvaged components swapped (but the
//     recycler's own, fed by the wreck field), plus extract.<good> (bay 'extract') and
//     salvage.<component> (bay 'salvage', at the salvage yard: no inputs); those with an unlock need
//     its package researched (Recipes.known)
//   Config.PACKAGES[id], CATEGORIES  the lab (rules/lab.js): the game's blueprints, mods, industry and
//     logistics research (rules/research.js, the same ids, so Recipes.known reads them), components
//     swapped, plus Extraction (ext.drill.*: drills faster) and Trade (trade.*: contract slots and
//     bonus, auto-sell); a category's station is the station type that has to be built before its
//     packages can be researched
//   Config.CONTRACTS { slots, bonus, minutes, size }   contracts: how many are open, what they pay over
//     the item's price, and how many of an item one asks for (by its kind)
//   Config.AUTO_SELL { step, floor }  auto-sell (trade.auto*): every step ms, the waystation sells the
//     goods picked for it while their price is at least floor × their usual price (lower with research)
//   Config.LAB_QUEUE                packages that can wait behind the one building (more with ind.lab.*)
//   Config.ROUTES { routes, haulers } routes the transport hub runs, and haulers on each, before research
//   Config.PROCESS                  the game's processes by station type, plus site: ['extract'] and the
//     salvage yard's wreck field ('salvage')
//   Config.BUILDS                   the stations to build, in order (Restoration.create's list; nothing online at first)
// ES module (`Config`); also runs in Node (the tests).

import { Goods } from '../rules/goods.js';
import { Industry } from '../rules/industry.js';
import { Recipes } from '../rules/recipes.js';
import { Research } from '../rules/research.js';

const Config = (() => {
  const START_CREDITS = 250;
  const SITE_STORAGE = 40; // room at a drill site, before its shuttle takes it away
  const STATION_STORAGE = 100;
  const STATION_SLOTS = 2; // orders at each station
  const HAULER_SPEED = 600; // world units a second (the game's are 300; the idle system is wide)
  const AWAY_SHEET = 60e3; // away longer than this: say what happened

  // Seconds a drill takes per unit, by the good's rarity (rules/goods.js): common goods come fast.
  const EXTRACT_TIME = [0, 10, 20, 40, 60, 90];
  // A drill's price: its site's base × growth^(drills already there); the field's first is free.
  const DRILL = { base: { field: 150, surface: [0, 300, 800, 2000, 4000, 8000] }, growth: 1.15, free: 1 };
  // A survey: credits × growth^(surveys done so far); secs plus perUnit for every world unit between
  // the body and the nearest thing already charted (the outer planets take longest). One survey at a
  // time. `find` of them turn up a derelict worth findCredits × (1 + orbit index / 2), seeded per body.
  const SURVEY = { credits: 60, growth: 1.55, secs: 20, perUnit: 0.012, find: 0.45, findCredits: [120, 400] };
  // Stations a body has room for in orbit (its berths): the field and the planets two, a moon one.
  const BERTHS = { field: 2, planet: 2, moon: 1 };
  const GEAR_SALE = 0.8;

  // Salvaged components, which the idle game can't get yet, and what it asks for instead.
  const SWAP = {
    [Goods.component('hull')]: 'steel-pipe', [Goods.component('weapon')]: 'carbon-fibre',
    [Goods.component('computer')]: 'carbon-fibre', [Goods.component('drive')]: 'hydrazine',
  };
  function swap(counts) {
    const out = {};
    for (const [k, n] of Object.entries(counts)) { const to = SWAP[k] || k; out[to] = (out[to] || 0) + n; }
    return out;
  }

  const RECIPES = {};
  for (const R of Recipes.LIST) RECIPES[R.id] = R.bay === 'recycle' ? R : { ...R, in: swap(R.in) };
  for (const g of Object.values(Goods.TYPES).filter((t) => t.stage === 'raw')) {
    RECIPES[`extract.${g.id}`] = { id: `extract.${g.id}`, bay: 'extract', in: {}, out: { [g.id]: 1 }, time: EXTRACT_TIME[g.rarity] || 30, unlock: null };
  }
  // The wreck field: the salvage yard picks over the system's old wrecks, one kind of component an
  // order (the player picks which), for its recycler.
  const SALVAGE_TIME = 90;
  for (const cat of Goods.categories('salvage')) {
    const id = Goods.component(cat);
    RECIPES[`salvage.${id}`] = { id: `salvage.${id}`, bay: 'salvage', in: {}, out: { [id]: 1 }, time: SALVAGE_TIME, unlock: null };
  }
  const PROCESS = { ...Industry.PROCESS, site: ['extract'], 'salvage yard': [...Industry.PROCESS['salvage yard'], 'salvage'] };

  // The lab: the game's research that means something here (gear blueprints, mods, industry and
  // logistics; not squad logic, hull refits or tuning), paid in credits and goods from the
  // waystation's stock, plus Extraction.
  const KINDS = ['blueprint', 'mods', 'industry'];
  const PACKAGES = {};
  for (const p of Object.values(Research.PACKAGES)) {
    if (!KINDS.includes(p.kind) || p.hidden) continue;
    const { credits = 0, ...goods } = p.cost;
    PACKAGES[p.id] = { ...p, cost: { credits, ...swap(goods) } };
  }
  const M = 60, H = 3600;
  const EXTRACT = [
    ['ext.drill.1', 'Drill heads I', 'Heads I', [], 20 * M, 600, { 'steel-pipe': 4 }],
    ['ext.drill.2', 'Drill heads II', 'Heads II', ['ext.drill.1'], 2 * H, 2500, { 'steel-pipe': 8, 'carbon-fibre': 4 }],
    ['ext.drill.3', 'Drill heads III', 'Heads III', ['ext.drill.2'], 6 * H, 8000, { 'carbon-fibre': 8, electronics: 4 }],
  ];
  for (const [id, name, short, requires, time, credits, goods] of EXTRACT) {
    PACKAGES[id] = { id, kind: 'industry', name, short, cat: 'ext', requires, time, cost: { credits, ...goods }, industry: { drill: 0.25 }, note: '+25% drill speed' };
  }
  // Trade: more and better contracts, and the waystation selling on its own.
  const TRADE = [
    ['trade.auto', 'Auto-sell', 'Auto', [], 30 * M, 1500, { 'steel-pipe': 6 }, { auto: 1 }, 'The waystation sells picked goods down to 75% of their price'],
    ['trade.contracts', 'Contract desk', 'Desk', [], 1 * H, 3000, { 'carbon-fibre': 6 }, { contracts: 1 }, 'A fourth contract'],
    ['trade.bonus.1', 'Brokers I', 'Brokers I', ['trade.contracts'], 3 * H, 6000, { hydrazine: 6 }, { contractBonus: 0.25 }, 'Contracts pay 25% more'],
    ['trade.auto.2', 'Auto-sell II', 'Auto II', ['trade.auto'], 4 * H, 8000, { electronics: 4 }, { autoFloor: 0.25 }, 'Auto-sell down to 50% of the price'],
    ['trade.bonus.2', 'Brokers II', 'Brokers II', ['trade.bonus.1'], 10 * H, 20000, { electronics: 8 }, { contractBonus: 0.25 }, 'Contracts pay 25% more'],
  ];
  for (const [id, name, short, requires, time, credits, goods, industry, note] of TRADE) {
    PACKAGES[id] = { id, kind: 'industry', name, short, cat: 'trade', requires, time, cost: { credits, ...goods }, industry, note };
  }
  const used = new Set(Object.values(PACKAGES).map((p) => p.cat));
  const CATEGORIES = [
    { id: 'ext', group: 'industry', label: 'Extraction', note: 'faster drills', station: 'waystation' },
    { id: 'trade', group: 'industry', label: 'Trade', note: 'contracts and auto-sell', station: 'waystation' },
    ...Research.CATEGORIES.filter((c) => used.has(c.id)),
  ];
  const LAB_QUEUE = 3;
  const ROUTES = { routes: 2, haulers: 1 };
  // Contracts: three open, a new set every day (UTC), each for some of one item, paying its price ×
  // bonus. size[item kind]: how many, at least and at most (gear comes in ones and twos).
  const CONTRACTS = { slots: 3, bonus: 1.6, size: { good: [8, 24], component: [4, 10], gear: [1, 3], mod: [1, 2], consumable: [2, 6] } };
  const AUTO_SELL = { step: 15 * 60e3, floor: 0.75 };

  // The stations, built one after another in orbit round a charted body (the player picks which).
  // Nothing is there at first: the waystation (a market and the bench) is built first and costs
  // nothing; its stock pays for every station after it. Each station but the transport hub sends
  // what it makes to the waystation by shuttle. `type` is the station type (rules/industry.js PROCESS);
  // `code` its icon (ui/glyphs.js). Costed so the ore works comes in the first session and the
  // shipyard in about a week (a first guess, to be measured by a simulation: notes/idle.md, Numbers).
  const BUILDS = [
    {
      id: 'build.waystation', name: 'Waystation', type: 'waystation', shuttle: null, code: 'TRD',
      goods: {}, credits: 0, requires: [],
      note: 'Market and gear bench. Its stock pays for later stations.',
    },
    {
      id: 'build.ore', name: 'Ore works', type: 'mining camp', shuttle: 'mining camp', code: 'ORE',
      goods: {}, credits: 300, requires: ['build.waystation'],
      note: 'Iron → steel pipe, silicates → carbon fibre.',
    },
    {
      id: 'build.volatiles', name: 'Volatiles works', type: 'minor', shuttle: 'minor', code: 'VOL',
      goods: { 'steel-pipe': 6, 'carbon-fibre': 2 }, credits: 1000, requires: ['build.ore'],
      note: 'Deuterium → hydrazine.',
    },
    {
      id: 'build.transport', name: 'Transport hub', type: 'transport hub', shuttle: null, code: 'CRG',
      goods: { 'steel-pipe': 12, 'carbon-fibre': 6, hydrazine: 4 }, credits: 6000, requires: ['build.volatiles'],
      note: 'Runs routes between stations.',
    },
    {
      id: 'build.salvage', name: 'Salvage yard', type: 'salvage yard', shuttle: 'salvage yard', code: 'RCY',
      goods: { 'steel-pipe': 12, hydrazine: 8, 'titanium-ore': 4 }, credits: 15000, requires: ['build.transport'],
      note: 'Salvages components from wrecks and recycles them.',
    },
    {
      id: 'build.fabricator', name: 'Fabricator', type: 'major', shuttle: 'major', code: 'FAB',
      goods: { 'steel-pipe': 12, 'carbon-fibre': 10, hydrazine: 6, 'rare-earths': 4 }, credits: 30000, requires: ['build.salvage'],
      note: 'Makes electronics for Mk II+ gear.',
    },
    {
      id: 'build.shipyard', name: 'Shipyard', type: 'capital', shuttle: 'capital', code: 'SHY',
      goods: { electronics: 10, 'steel-pipe': 16, tungsten: 6, 'titanium-ore': 6 }, credits: 60000, requires: ['build.fabricator'],
      note: 'Assembles Mk II+ gear and mods.',
    },
  ];

  return {
    START_CREDITS, SITE_STORAGE, STATION_STORAGE, STATION_SLOTS, HAULER_SPEED, AWAY_SHEET, EXTRACT_TIME, DRILL, SURVEY, BERTHS, GEAR_SALE,
    SWAP, swap, SALVAGE_TIME, RECIPES, PROCESS, PACKAGES, CATEGORIES, LAB_QUEUE, ROUTES, CONTRACTS, AUTO_SELL, BUILDS,
  };
})();

export { Config };
