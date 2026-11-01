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
//   Config.GEAR_MARKET { soft, halfLife }   that price halves for every `soft` of it sold there lately;
//     what was sold counts for half every halfLife ms
//   Config.TRADE_MARKET { soft[rarity], halfLife }   the same for trade goods, over the market's price
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
//     swapped, plus Extraction (ext.drill.*: drills faster; ext.probes: surveys on their own),
//     Haulage (ext.haulage, in the transport hub's logistics: free shuttles) and Trade (trade.*: contract slots and bonus, auto-sell, the
//     contract clerk); a category's station is the station type that has to be built before its
//     packages can be researched
//   Config.CONTRACTS { slots, bonus, perStation, top, size }   contracts: how many are open, what they
//     pay over the item's price, how both grow with the stations built, the share of slots for the
//     dearest items, and how many of an item one asks for (by its kind)
//   Config.STEP                     ms between the clock's steps, where what runs on its own (auto-sell,
//     the contract clerk, the probe network) acts; fixed to the clock, so time away comes out the same
//   Config.AUTO_SELL { step, floor }  auto-sell (trade.auto*): every step ms, the waystation sells the
//     goods picked for it while their price is at least floor × their usual price (lower with research)
//   Config.HAUL { cap }             a hauler sent by hand: how much it takes in one trip
//   Config.SHUTTLE { base, growth }  what a shuttle (a link carried on its own) costs: base × growth^(shuttles
//     already running); free with Haulage research (ext.haulage), which also gives new links theirs
//   Config.FOREMAN { batch, minRuns, cost[build id] }   without a foreman, an order runs a batch (about
//     `batch` ms of work, at least minRuns) and waits to be run again; a foreman (bought per station,
//     credits and goods from the waystation) keeps its orders going
//   Config.RESEARCH { time, credits, blueprintTier[Mk] }   how much longer and dearer the game's packages
//     are here (blueprints longer again by Mk); blueprints are researched at the shipyard
//   Config.LAB_QUEUE                packages that can wait behind the one building (more with ind.lab.*)
//   Config.ROUTES { routes, haulers } routes the transport hub runs, and haulers on each, before research
//   Config.PROCESS                  the game's processes by station type, plus site: ['extract'] and the
//     salvage yard's wreck field ('salvage')
//   Config.BUILDS                   the stations to build, in order (Restoration.create's list; nothing online at first)
//   Config.LEGACY { per, speed, pay }   new systems (prestige): leaving a system with every station built
//     earns floor(sqrt(credits earned there / per)) legacy points; each point kept adds `speed` to every
//     order's and drill's speed and `pay` to what markets and contracts pay, in every system after
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
  const GEAR_MARKET = { soft: 6, halfLife: 4 * 3600e3 };
  // Trade goods too: on top of the market's own price, what a station pays halves for every soft[rarity]
  // sold there lately (counting half every halfLife), so selling by the thousand stops paying.
  const TRADE_MARKET = { soft: [0, 400, 240, 120, 60, 30], halfLife: 4 * 3600e3 };

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
  // The game's packages take RESEARCH.time times as long here, and RESEARCH.credits times the
  // credits: an idle system's markets pay far more over a week than a pilot earns.
  const KINDS = ['blueprint', 'mods', 'industry'];
  // Blueprints take blueprintTier[Mk] times longer again, so the higher Mks come over the weeks
  // after the shipyard rather than all at once.
  const RESEARCH = { time: 4, credits: 25, blueprintTier: [1, 1, 1, 2, 3, 3] };
  const PACKAGES = {};
  for (const p of Object.values(Research.PACKAGES)) {
    if (!KINDS.includes(p.kind) || p.hidden) continue;
    const { credits = 0, ...goods } = p.cost;
    const tier = p.kind === 'blueprint' ? RESEARCH.blueprintTier[p.tier] || 1 : 1;
    PACKAGES[p.id] = { ...p, time: p.time * RESEARCH.time * tier, cost: { credits: credits * RESEARCH.credits, ...swap(goods) } };
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
  // Automation: surveys started on their own (at the waystation), and shuttles for every link (at
  // the transport hub, with its route planning).
  const AUTOMATE = [
    ['ext.probes', 'ext', 'Probe network', 'Probes', ['ext.drill.1'], 2 * H, 3000, { 'steel-pipe': 10, 'carbon-fibre': 6 }, { probes: 1 }, 'Surveys the nearest signal on its own'],
    ['ext.haulage', 'log', 'Haulage contracts', 'Haulage', ['log.routes.1'], 12 * H, 40000, { 'steel-pipe': 20, hydrazine: 10 }, { haulage: 1 }, 'Shuttles cost nothing, and new stations and drill sites get theirs'],
  ];
  for (const [id, cat, name, short, requires, time, credits, goods, industry, note] of AUTOMATE) {
    PACKAGES[id] = { id, kind: 'industry', name, short, cat, requires, time, cost: { credits, ...goods }, industry, note };
  }
  // Trade: more and better contracts, and the waystation selling on its own.
  const TRADE = [
    ['trade.auto', 'Auto-sell', 'Auto', [], 30 * M, 1500, { 'steel-pipe': 6 }, { auto: 1 }, 'The waystation sells picked goods down to 75% of their price'],
    ['trade.contracts', 'Contract desk', 'Desk', [], 1 * H, 3000, { 'carbon-fibre': 6 }, { contracts: 1 }, 'A fourth contract'],
    ['trade.clerk', 'Contract clerk', 'Clerk', ['trade.contracts'], 2 * H, 5000, { 'carbon-fibre': 8 }, { clerk: 1 }, 'Delivers contracts on its own, keeping what the next station needs'],
    ['trade.bonus.1', 'Brokers I', 'Brokers I', ['trade.contracts'], 3 * H, 6000, { hydrazine: 6 }, { contractBonus: 0.25 }, 'Contracts pay 25% more'],
    ['trade.auto.2', 'Auto-sell II', 'Auto II', ['trade.auto'], 4 * H, 8000, { electronics: 4 }, { autoFloor: 0.25 }, 'Auto-sell down to 50% of the price'],
    ['trade.bonus.2', 'Brokers II', 'Brokers II', ['trade.bonus.1'], 10 * H, 20000, { electronics: 8 }, { contractBonus: 0.25 }, 'Contracts pay 25% more'],
  ];
  for (const [id, name, short, requires, time, credits, goods, industry, note] of TRADE) {
    PACKAGES[id] = { id, kind: 'industry', name, short, cat: 'trade', requires, time, cost: { credits, ...goods }, industry, note };
  }
  const used = new Set(Object.values(PACKAGES).map((p) => p.cat));
  const CATEGORIES = [
    { id: 'ext', group: 'industry', label: 'Extraction', note: 'faster drills and the probe network', station: 'waystation' },
    { id: 'trade', group: 'industry', label: 'Trade', note: 'contracts, the clerk and auto-sell', station: 'waystation' },
    // Gear is assembled at the shipyard, so its blueprints are drawn up there: none before it's built.
    ...Research.CATEGORIES.filter((c) => used.has(c.id)).map((c) => (c.id.startsWith('bp.') ? { ...c, station: 'capital' } : c)),
  ];
  const LAB_QUEUE = 3;
  const ROUTES = { routes: 2, haulers: 1 };
  // Contracts: three open, a new set every day (UTC), each for some of one item, paying its price ×
  // bonus. size[item kind]: how many, at least and at most (gear comes in ones and twos).
  // perStation: the bonus and the size grow by this share for every station built past the ore works,
  // so contracts keep up with what the system makes; top: share of the slots that ask for one of the
  // dearest third of what's on offer.
  const CONTRACTS = { slots: 3, bonus: 1.6, perStation: 0.5, top: 0.5, size: { good: [8, 24], component: [4, 10], gear: [1, 3], mod: [1, 2], consumable: [2, 6] } };
  const STEP = 15 * 60e3;
  const AUTO_SELL = { step: STEP, floor: 0.75 };
  // Manual, then automated (notes/idle.md): hauling by hand, then a shuttle a link; orders in
  // batches, then a foreman a station.
  const HAUL = { cap: 40 };
  const SHUTTLE = { base: 300, growth: 1.4 };
  const FOREMAN = {
    batch: 3600e3, minRuns: 3,
    cost: {
      'build.waystation': { credits: 1500 },
      'build.ore': { credits: 1000 },
      'build.volatiles': { credits: 4000, 'steel-pipe': 10 },
      'build.transport': { credits: 8000, 'steel-pipe': 15, hydrazine: 10 },
      'build.salvage': { credits: 15000, 'carbon-fibre': 15, hydrazine: 15 },
      'build.fabricator': { credits: 30000, 'steel-pipe': 20, hydrazine: 20 },
      'build.shipyard': { credits: 45000, electronics: 15, 'carbon-fibre': 20 },
    },
  };

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
      goods: { 'steel-pipe': 20, 'carbon-fibre': 10 }, credits: 5000, requires: ['build.ore'],
      note: 'Deuterium → hydrazine.',
    },
    {
      id: 'build.transport', name: 'Transport hub', type: 'transport hub', shuttle: null, code: 'CRG',
      goods: { 'steel-pipe': 30, 'carbon-fibre': 15, hydrazine: 15 }, credits: 60000, requires: ['build.volatiles'],
      note: 'Runs routes between stations.',
    },
    {
      id: 'build.salvage', name: 'Salvage yard', type: 'salvage yard', shuttle: 'salvage yard', code: 'RCY',
      goods: { 'steel-pipe': 30, hydrazine: 25, 'titanium-ore': 20 }, credits: 150000, requires: ['build.transport'],
      note: 'Salvages components from wrecks and recycles them.',
    },
    {
      id: 'build.fabricator', name: 'Fabricator', type: 'major', shuttle: 'major', code: 'FAB',
      goods: { 'steel-pipe': 25, 'carbon-fibre': 25, hydrazine: 20, 'rare-earths': 20 }, credits: 350000, requires: ['build.salvage'],
      note: 'Makes electronics for Mk II+ gear.',
    },
    {
      id: 'build.shipyard', name: 'Shipyard', type: 'capital', shuttle: 'capital', code: 'SHY',
      goods: { electronics: 30, 'steel-pipe': 25, tungsten: 20, 'titanium-ore': 20 }, credits: 450000, requires: ['build.fabricator'],
      note: 'Assembles Mk II+ gear and mods.',
    },
  ];

  // New systems: what leaving one with every station built earns, and what that's worth in the next.
  // The square root makes a long stay pay less and less, so moving on beats sitting on the credits.
  const LEGACY = { per: 1e4, speed: 0.02, pay: 0.02 };

  return {
    STEP, HAUL, SHUTTLE, FOREMAN, LEGACY, START_CREDITS, SITE_STORAGE, STATION_STORAGE, STATION_SLOTS, HAULER_SPEED, AWAY_SHEET, EXTRACT_TIME, DRILL, SURVEY, BERTHS, GEAR_SALE, GEAR_MARKET, TRADE_MARKET,
    SWAP, swap, SALVAGE_TIME, RECIPES, PROCESS, RESEARCH, PACKAGES, CATEGORIES, LAB_QUEUE, ROUTES, CONTRACTS, AUTO_SELL, BUILDS,
  };
})();

export { Config };
