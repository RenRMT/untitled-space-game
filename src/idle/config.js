// The idle game's numbers, in one place (notes/idle.md): money, room, how fast drills pull and what
// they cost, the haulers' speed, the restoration chain, and the production tables it runs on. The
// game's own tables (rules/recipes.js, rules/industry.js, rules/restoration.js) are read, never
// changed: what differs here is passed to their create().
//
//   Config.START_CREDITS, SITE_STORAGE, STATION_STORAGE, STATION_SLOTS, HAULER_SPEED, AWAY_SHEET (ms)
//   Config.EXTRACT_TIME[rarity] -> s per unit a drill pulls
//   Config.DRILL { base: { field, surface: [by rarity] }, growth, free }   what the next drill costs
//   Config.GEAR_SALE                share of an item's price (gear, consumables) a station pays for it
//   Config.RECIPES                  the game's recipes known from the start, plus extract.<good> (bay 'extract')
//   Config.PROCESS                  the game's processes by station type, plus site: ['extract']
//   Config.ONLINE, Config.PROJECTS  the restoration chain (Restoration.create's list and online)
// ES module (`Config`); also runs in Node (the tests).

import { Goods } from '../rules/goods.js';
import { Industry } from '../rules/industry.js';
import { Recipes } from '../rules/recipes.js';

const Config = (() => {
  const START_CREDITS = 200;
  const SITE_STORAGE = 40; // room at a drill site, before its shuttle takes it away
  const STATION_STORAGE = 100;
  const STATION_SLOTS = 2; // orders at each online station
  const HAULER_SPEED = 600; // world units a second (the game's are 300; the idle system is wide)
  const AWAY_SHEET = 60e3; // away longer than this: say what happened

  // Seconds a drill takes per unit, by the good's rarity (rules/goods.js): common goods come fast.
  const EXTRACT_TIME = [0, 10, 20, 40, 60, 90];
  // A drill's price: its site's base × growth^(drills already there); the field's first is free.
  const DRILL = { base: { field: 150, surface: [0, 300, 800, 2000, 4000, 8000] }, growth: 1.15, free: 1 };
  const GEAR_SALE = 0.8;

  const RECIPES = {};
  for (const R of Recipes.LIST) if (!R.unlock) RECIPES[R.id] = R;
  for (const g of Object.values(Goods.TYPES).filter((t) => t.stage === 'raw')) {
    RECIPES[`extract.${g.id}`] = { id: `extract.${g.id}`, bay: 'extract', in: {}, out: { [g.id]: 1 }, time: EXTRACT_TIME[g.rarity] || 30, unlock: null };
  }
  const PROCESS = { ...Industry.PROCESS, site: ['extract'] };

  // The restoration chain. The waystation (the bench, a market) and the mining camp (the ore works)
  // are online from the start, the camp shuttling its steel pipe and carbon fibre to the waystation,
  // whose stock pays for each project. Each project brings a station online with a shuttle to the
  // waystation. Costed so the first comes in the first session, the shipyard in about a week (a first
  // guess, to be measured by a simulation: notes/idle.md, Numbers).
  const ONLINE = ['waystation', 'mining camp'];
  const PROJECTS = [
    {
      id: 'restore.volatiles', name: 'Volatiles works', type: 'minor', shuttle: 'minor',
      goods: { 'steel-pipe': 6, 'carbon-fibre': 2 }, credits: 1000, requires: [],
      note: 'Refines deuterium into hydrazine: fuel, and an input of much of the gear.',
    },
    {
      id: 'restore.transport', name: 'Transport hub', type: 'transport hub', shuttle: null,
      goods: { 'steel-pipe': 12, 'carbon-fibre': 6, hydrazine: 4 }, credits: 6000, requires: ['restore.volatiles'],
      note: 'Directs the routes between stations: more haulers, and routes of many stops (soon).',
    },
    {
      id: 'restore.salvage', name: 'Salvage yard', type: 'salvage yard', shuttle: 'salvage yard',
      goods: { 'steel-pipe': 12, hydrazine: 8, 'titanium-ore': 4 }, credits: 15000, requires: ['restore.transport'],
      note: 'Recycles salvaged components into refined goods and electronics.',
    },
    {
      id: 'restore.fabricator', name: 'Fabricator', type: 'major', shuttle: 'major',
      goods: { 'steel-pipe': 12, 'carbon-fibre': 10, hydrazine: 6, 'rare-earths': 4 }, credits: 30000, requires: ['restore.salvage'],
      note: 'Makes electronics, which gear from Mk II up needs.',
    },
    {
      id: 'restore.shipyard', name: 'Shipyard', type: 'capital', shuttle: 'capital',
      goods: { electronics: 10, 'steel-pipe': 16, tungsten: 6, 'titanium-ore': 6 }, credits: 60000, requires: ['restore.fabricator'],
      note: 'Assembles gear from Mk II, and mods.',
    },
  ];

  return { START_CREDITS, SITE_STORAGE, STATION_STORAGE, STATION_SLOTS, HAULER_SPEED, AWAY_SHEET, EXTRACT_TIME, DRILL, GEAR_SALE, RECIPES, PROCESS, ONLINE, PROJECTS };
})();

export { Config };
