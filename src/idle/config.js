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
//   Config.RECIPES                  the game's recipes known from the start, plus extract.<good> (bay 'extract')
//   Config.PROCESS                  the game's processes by station type, plus site: ['extract']
//   Config.BUILDS                   the stations to build, in order (Restoration.create's list; nothing online at first)
// ES module (`Config`); also runs in Node (the tests).

import { Goods } from '../rules/goods.js';
import { Industry } from '../rules/industry.js';
import { Recipes } from '../rules/recipes.js';

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

  const RECIPES = {};
  for (const R of Recipes.LIST) if (!R.unlock) RECIPES[R.id] = R;
  for (const g of Object.values(Goods.TYPES).filter((t) => t.stage === 'raw')) {
    RECIPES[`extract.${g.id}`] = { id: `extract.${g.id}`, bay: 'extract', in: {}, out: { [g.id]: 1 }, time: EXTRACT_TIME[g.rarity] || 30, unlock: null };
  }
  const PROCESS = { ...Industry.PROCESS, site: ['extract'] };

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
      note: 'The hub: a market for whatever is brought here, and the bench that assembles gear. Its stock pays for every station after it.',
    },
    {
      id: 'build.ore', name: 'Ore works', type: 'mining camp', shuttle: 'mining camp', code: 'ORE',
      goods: {}, credits: 300, requires: ['build.waystation'],
      note: 'Smelts iron into steel pipe and silicates into carbon fibre. Best built near the drills that feed it.',
    },
    {
      id: 'build.volatiles', name: 'Volatiles works', type: 'minor', shuttle: 'minor', code: 'VOL',
      goods: { 'steel-pipe': 6, 'carbon-fibre': 2 }, credits: 1000, requires: ['build.ore'],
      note: 'Refines deuterium into hydrazine: fuel, and an input of much of the gear. Deuterium comes from the gas giants and the ice.',
    },
    {
      id: 'build.transport', name: 'Transport hub', type: 'transport hub', shuttle: null, code: 'CRG',
      goods: { 'steel-pipe': 12, 'carbon-fibre': 6, hydrazine: 4 }, credits: 6000, requires: ['build.volatiles'],
      note: 'Directs the routes between stations: more haulers, and routes of many stops (soon).',
    },
    {
      id: 'build.salvage', name: 'Salvage yard', type: 'salvage yard', shuttle: 'salvage yard', code: 'RCY',
      goods: { 'steel-pipe': 12, hydrazine: 8, 'titanium-ore': 4 }, credits: 15000, requires: ['build.transport'],
      note: 'Recycles salvaged components into refined goods and electronics.',
    },
    {
      id: 'build.fabricator', name: 'Fabricator', type: 'major', shuttle: 'major', code: 'FAB',
      goods: { 'steel-pipe': 12, 'carbon-fibre': 10, hydrazine: 6, 'rare-earths': 4 }, credits: 30000, requires: ['build.salvage'],
      note: 'Makes electronics, which gear from Mk II up needs.',
    },
    {
      id: 'build.shipyard', name: 'Shipyard', type: 'capital', shuttle: 'capital', code: 'SHY',
      goods: { electronics: 10, 'steel-pipe': 16, tungsten: 6, 'titanium-ore': 6 }, credits: 60000, requires: ['build.fabricator'],
      note: 'Assembles gear from Mk II, and mods.',
    },
  ];

  return { START_CREDITS, SITE_STORAGE, STATION_STORAGE, STATION_SLOTS, HAULER_SPEED, AWAY_SHEET, EXTRACT_TIME, DRILL, SURVEY, BERTHS, GEAR_SALE, RECIPES, PROCESS, BUILDS };
})();

export { Config };
