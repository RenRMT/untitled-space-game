// What a station's outfitter sells (the station screen's Outfitter tab, game/vendor.js):
// - Gambits: the logic packages (rules/research.js, kind 'logic') that squad programs are built from
//   (rules/logic.js), bought outright. Each has a tier; a station sells those up to its system's
//   level (world/galaxy.js: 1 in Wedge space .. 5 the aliens'), so the better ones are found further
//   out. One is bought only once the ones it needs are owned. The rest drop as loot (dungeons, the
//   Warden): gambitDrop.
// - Gear: a few pieces rolled the way loot is (rules/loot.js), at the system's level, Common and
//   Uncommon (Rare at a capital), restocked every day: the same station, the same day, the same stock.
//   Sold at GEAR_MARKUP times the gear's price (it's bought back at half: game/outfitting.js).
// - Consumables: the ones used in a fight or the field (rules/abilities.js), at their price.
// - Mods (rules/mods.js), at capitals and major stations: MOD_PRICE each.
//
//   Vendor.GAMBIT_TIER[id] -> 1..4          Vendor.FREE   gambits every pilot has (game/cargo.js)
//   Vendor.gambitPrice(id) -> credits         Vendor.gambitName(id), Vendor.gambitNote(id)   in plain words
//   Vendor.gambits(level) -> [id]            what a station at that level sells, in the lab's order
//   Vendor.canBuyGambit(id, owned) -> { ok, why }   owned: a Set of ids (FREE included)
//   Vendor.gambitDrop(seed, key, level, owned) -> id | null   a gambit not owned, up to a tier
//                                            above the level (a dungeon's loot)
//   Vendor.day(ms) -> the day number a stock is rolled for (the real clock)
//   Vendor.gear(stationKey, level, day, o) -> [spec]   o: { capital, cls, seed }
//   Vendor.gearPrice(spec) -> credits
//   Vendor.KIT -> [ability id]               the consumables sold
//   Vendor.MOD_PRICE, Vendor.sellsMods(stationType) -> bool
// ES module (`Vendor`); also runs in Node (the tests).

import { hashInt, mulberry32, seedToInt } from '../core/rng.js';
import { Abilities } from './abilities.js';
import { Loot } from './loot.js';
import { Mods } from './mods.js';
import { Research } from './research.js';

const Vendor = (() => {
  // Every pilot has these: a class's starting program uses them (rules/classes.js).
  const FREE = ['tactics.use', 'maint.sense'];
  const GAMBIT_TIER = {
    'core.bool': 1, 'combat.select': 1, 'squad.link': 1, 'mem.ext.1': 1,
    'core.bool.or': 2, 'combat.range': 2, 'combat.threat': 2, 'tactics.count': 2, 'maint.retreat': 2, 'maint.guard': 2,
    'combat.focus': 3, 'tactics.read': 3, 'mem.ext.2': 3,
    'mem.ext.3': 4,
  };
  // What each gambit is called and does, in the game's own words (the lab's package names, such as
  // `core.bool@1.0`, are the idle game's: rules/research.js).
  const GAMBIT_TEXT = {
    'core.bool': ['And · Not', 'two conditions on one line'],
    'core.bool.or': ['Or', 'either condition will do'],
    'mem.ext.1': ['Memory I', 'a 4th program line'],
    'mem.ext.2': ['Memory II', '6 program lines'],
    'mem.ext.3': ['Memory III', '8 program lines'],
    'combat.select': ['Pick a target', 'nearest, weakest or strongest'],
    'combat.range': ['Rangefinder', 'distance, and fighting at gun range'],
    'combat.threat': ['Threat sense', 'whom an enemy is shooting at'],
    'combat.focus': ['Ship types', 'what kind of ship an enemy is'],
    'tactics.count': ['Head count', 'how many are still flying'],
    'tactics.use': ['Use a skill', 'skills and consumables'],
    'tactics.read': ['Read the enemy', 'a heavy shot charging, and statuses'],
    'maint.sense': ['Damage sense', 'hull and shields left'],
    'squad.link': ['Squad link', 'the other squad members'],
    'maint.retreat': ['Retreat', 'fall back and hold fire'],
    'maint.guard': ['Guard', 'stay by a ship and defend it'],
  };
  const gambitName = (id) => GAMBIT_TEXT[id]?.[0] || (Research.PACKAGES[id] ? Research.title(id) : String(id));
  const gambitNote = (id) => GAMBIT_TEXT[id]?.[1] || Research.PACKAGES[id]?.note || '';
  const GAMBIT_PRICE = 2; // × the package's credits in the lab
  const GEAR_COUNT = 6, GEAR_MARKUP = 2;
  const KIT = ['repair-nanites', 'shield-cell', 'emp-charge', 'jammer-pod'];
  const DAY = 24 * 3600 * 1000;
  const MOD_PRICE = 1500;
  const sellsMods = (type) => type === 'capital' || type === 'major';

  const isGambit = (id) => Research.PACKAGES[id]?.kind === 'logic' && !FREE.includes(id);
  const gambitPrice = (id) => GAMBIT_PRICE * (Research.PACKAGES[id].cost.credits || 0);
  const ORDER = Object.keys(Research.PACKAGES).filter(isGambit);
  const gambits = (level) => ORDER.filter((id) => (GAMBIT_TIER[id] || 4) <= level);

  function canBuyGambit(id, owned) {
    if (!isGambit(id)) return { ok: false, why: 'Not for sale' };
    if (owned.has(id)) return { ok: false, why: 'Owned' };
    const need = Research.PACKAGES[id].requires.filter((r) => !owned.has(r));
    if (need.length) return { ok: false, why: `Needs ${need.map(gambitName).join(', ')}` };
    return { ok: true, why: '' };
  }

  // A gambit for a dungeon to drop: one not owned, of a tier up to a step above its level, that the
  // pilot could use (what it needs owned, or dropping with it is fine: it's kept for later).
  function gambitDrop(seed, key, level, owned) {
    const pool = ORDER.filter((id) => !owned.has(id) && (GAMBIT_TIER[id] || 4) <= level + 1);
    if (!pool.length) return null;
    const r = mulberry32(hashInt(seedToInt(String(seed)), seedToInt(String(key)), 0x9a3b));
    return pool[Math.floor(r() * pool.length)];
  }

  const day = (ms) => Math.floor(ms / DAY);
  function gear(stationKey, level, dayN, o = {}) {
    const r = mulberry32(hashInt(seedToInt(String(o.seed ?? 0)), seedToInt(String(stationKey)), dayN | 0));
    const cap = o.capital ? 'rare' : 'uncommon';
    const out = [];
    for (let i = 0; i < GEAR_COUNT; i++) out.push(Loot.roll(r, { level, cap, cls: o.cls, key: `shop:${stationKey}:${dayN}:${i}` }));
    return out;
  }
  const gearPrice = (spec) => GEAR_MARKUP * Loot.make(spec).price;

  for (const id of KIT) if (!Abilities.ABILITIES[id]) throw new Error(`Vendor: no ability ${id}`);
  const MODS = Mods.LIST.map((m) => m.id);
  return { FREE, GAMBIT_TIER, KIT, MOD_PRICE, MODS, sellsMods, gambitPrice, gambits, canBuyGambit, gambitDrop, day, gear, gearPrice, isGambit, gambitName, gambitNote };
})();

export { Vendor };
