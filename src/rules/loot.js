// Loot: ship equipment that drops from what the player destroys and from missions, rolled the way
// action RPGs and MMOs roll it (art/equipment.js draws each base).
//
// - Bases: seven kinds of gear (BASES), each for one slot: three weapons (laser, missile launcher,
//   plasma cannon), a shield generator, a scanner, an engine and a ship computer. Their stats grow
//   with the item level.
// - Item level (ilvl 1..50): from the level of what dropped it (1 in Wedge space .. 5 the aliens'),
//   ten item levels a level, rolled within them. It sets the base stats, how strong the affixes
//   roll, the Mk the gear counts as (room for mods: rules/mods.js) and its price.
// - Rarity (RARITIES): Common, Uncommon, Rare, Epic, Legendary, by weight. Rarer gear has stronger
//   base stats (a Legendary as strong as a Common some nine item levels up) and more affixes (0..4);
//   a Legendary has a name of its own.
// - Affixes (AFFIXES): prefixes and suffixes, each one stat a share better (a few: flat hull), rolled
//   within a range that widens with the item level. An item never gets the same stat twice, and
//   only affixes for its slot (or for any slot).
// - Drop tables (SOURCES): what drops from what. Each source has a chance to drop anything, how
//   many rolls, a rarity floor (Uncommon at least: Common gear is only sold; a Warden's Rare), and
//   luck (more weight on the rarer tiers).
// - Bad-luck protection: every roll that comes up below Rare adds to a counter (pity); at PITY.rare
//   the next one is at least Rare, at PITY.epic at least Epic. Rare or better resets the Rare
//   counter, Epic or better both.
// - Smart loot: a share of rolls (SMART) picks a base for the player's class (CLASS_BIAS: a Tank
//   finds more shields and engines, a DPS weapons, a Healer computers and shields).
// - Duplicate-proof: a drop's id comes from what dropped it and its roll, so the same kill always
//   gives the same item and a reload can't duplicate it.
//
// An item is saved as its spec { id, base, ilvl, rarity, seed } and remade from it: the seed rolls
// its affixes the same way every time.
//   Loot.roll(rng, o) -> spec       o: { level, luck?, floor?, cap? (the highest rarity: a vendor's stock), cls?, pity?, base?, key? }
//   Loot.drops(source, key, o) -> [spec]   o: { level, seed, cls?, pity?, luck? }: a source's drops
//   Loot.make(spec) -> equipment    { slot, name, line, tier, stats, price, loot: { base, ilvl, rarity,
//                                    affixes: [{ id, name, stat, value }], legendary? } } (as Loadout.EQUIPMENT)
//   Loot.register(spec, EQUIPMENT)  makes it and files it under its id (rules/loadout.js EQUIPMENT)
//   Loot.read(d) -> { [id]: spec }  a saved collection, checked
//   Loot.affixText(a), Loot.rarityOf(id)
// ES module (`Loot`); also runs in Node (the tests).

import { clamp } from '../core/math.js';
import { hashInt, mulberry32, seedToInt } from '../core/rng.js';

const Loot = (() => {
  const RARITIES = [
    { id: 'common', name: 'Common', color: '#c8ccd4', weight: 60, affixes: 0, power: 1, price: 1 },
    { id: 'uncommon', name: 'Uncommon', color: '#5fd77a', weight: 27, affixes: 1, power: 1.07, price: 1.3 },
    { id: 'rare', name: 'Rare', color: '#5aa8ff', weight: 10, affixes: 2, power: 1.15, price: 1.8 },
    { id: 'epic', name: 'Epic', color: '#b97aff', weight: 2.6, affixes: 3, power: 1.25, price: 2.6 },
    { id: 'legendary', name: 'Legendary', color: '#ffa53a', weight: 0.4, affixes: 4, power: 1.36, price: 4 },
  ];
  const RANK = Object.fromEntries(RARITIES.map((r, i) => [r.id, i]));
  const MAX_ILVL = 50;

  // grow: how each stat grows per item level above 1 (a share of its ilvl-1 value; lockTime
  // shrinks). The weapons' vs: their factor on rock and gas (rules/loadout.js): combat gear, poor tools.
  const BASES = {
    laser: { slot: 'weapon', name: 'Laser', stats: { damage: 7, fireRate: 4, range: 700, arc: 60, vs: { rock: 0.5, gas: 0.2 } }, grow: { damage: 0.04, range: 0.012 } },
    'missile-launcher': { slot: 'weapon', name: 'Missile launcher', stats: { damage: 26, fireRate: 0.9, range: 1000, arc: 140, vs: { rock: 0.3, gas: 0 } }, grow: { damage: 0.04, range: 0.01 } },
    'plasma-cannon': { slot: 'weapon', name: 'Plasma cannon', stats: { damage: 15, fireRate: 2, range: 480, arc: 45, vs: { rock: 0.8, gas: 0 } }, grow: { damage: 0.04, range: 0.01 } },
    'shield-generator': { slot: 'shield', name: 'Shield generator', stats: { strength: 90, recharge: 7 }, grow: { strength: 0.04, recharge: 0.035 } },
    scanner: { slot: 'scanner', name: 'Scanner', stats: { sensorRange: 3200, pingRange: 7500, lockRange: 1700 }, grow: { sensorRange: 0.025, pingRange: 0.025, lockRange: 0.015 } },
    engine: { slot: 'engine', name: 'Engine', stats: { maxSpeed: 660, accel: 540, turnRate: 3.6, evasion: 0.16 }, grow: { maxSpeed: 0.008, accel: 0.014, turnRate: 0.005, evasion: 0.016 } },
    'ship-computer': { slot: 'computer', name: 'Ship computer', stats: { accuracy: 0.76, lockTime: 0.95, miningRate: 1 }, grow: { accuracy: 0.005, lockTime: -0.012, miningRate: 0.025 } },
  };
  const BASE_IDS = Object.keys(BASES);
  // The stats rarity raises (its power), per slot: what the gear is for.
  // [stat, weight]: the share of the rarity's power that stat gets (accuracy and speed are dear).
  // Only stats that count in a fight: the scanner's reach is its initiative (combat/combat.js period),
  // the computer's accuracy its hit chance. (Lock range and lock time count only in real time or
  // mining, so rarity leaves them be.)
  const PRIMARY = { weapon: [['damage', 1]], shield: [['strength', 1], ['recharge', 1]], scanner: [['sensorRange', 1], ['pingRange', 1]], engine: [['maxSpeed', 0.4], ['accel', 1]], computer: [['accuracy', 0.25]] };
  // How far a stat may go (as rules/loadout.js LIMITS).
  const LIMITS = { accuracy: [0, 0.99], evasion: [0, 0.6], lockTime: [0.2, Infinity], arc: [0, 360] };

  // [id, name, kind, slots ('any': every slot), stat, [lo, hi]]: a share added (lockTime: taken
  // off), or flat (FLAT: hullPlus hull points, initiativePlus initiative, evasionPlus evasion, each
  // added to the ship's: rules/loadout.js stats). The range is at item level 50; lower items roll less.
  // Every affix is on a stat that counts in a fight on the timeline (combat/combat.js).
  const AFFIXES = [
    ['overcharged', 'Overcharged', 'prefix', ['weapon'], 'damage', [0.06, 0.2]],
    ['rapid', 'Rapid', 'prefix', ['weapon'], 'fireRate', [0.05, 0.16]],
    ['longshot', 'Long-range', 'prefix', ['weapon'], 'range', [0.06, 0.18]],
    ['ruin', 'of Ruin', 'suffix', ['weapon'], 'damage', [0.05, 0.16]],
    ['reach', 'of Reach', 'suffix', ['weapon'], 'range', [0.05, 0.15]],
    ['sweep', 'of the Sweep', 'suffix', ['weapon'], 'arc', [0.1, 0.3]],
    ['reinforced', 'Reinforced', 'prefix', ['shield'], 'strength', [0.08, 0.24]],
    ['regenerating', 'Regenerating', 'prefix', ['shield'], 'recharge', [0.08, 0.26]],
    ['bulwark', 'of the Bulwark', 'suffix', ['shield'], 'strength', [0.06, 0.18]],
    ['renewal', 'of Renewal', 'suffix', ['shield'], 'recharge', [0.06, 0.2]],
    ['swift', 'Swift', 'prefix', ['engine'], 'maxSpeed', [0.04, 0.12]],
    ['surging', 'Surging', 'prefix', ['engine'], 'accel', [0.06, 0.18]],
    ['agile', 'Agile', 'prefix', ['engine'], 'turnRate', [0.05, 0.15]],
    ['elusion', 'of Elusion', 'suffix', ['engine'], 'evasion', [0.08, 0.25]],
    ['gale', 'of the Gale', 'suffix', ['engine'], 'accel', [0.05, 0.15]],
    ['keen', 'Keen', 'prefix', ['scanner'], 'sensorRange', [0.08, 0.25]],
    ['echoes', 'of Echoes', 'suffix', ['scanner'], 'pingRange', [0.08, 0.25]],
    ['sight', 'of Sight', 'suffix', ['scanner'], 'sensorRange', [0.06, 0.2]],
    ['precise', 'Precise', 'prefix', ['computer'], 'accuracy', [0.02, 0.07]],
    ['focus', 'of Focus', 'suffix', ['computer'], 'accuracy', [0.02, 0.06]],
    ['overclocked', 'Overclocked', 'prefix', ['computer', 'scanner'], 'initiativePlus', [1500, 6000]],
    ['haste', 'of Haste', 'suffix', ['computer', 'scanner'], 'initiativePlus', [1200, 5000]],
    ['evasion', 'of Evasion', 'suffix', ['computer', 'shield'], 'evasionPlus', [0.015, 0.05]],
    ['armoured', 'Armoured', 'prefix', 'any', 'hullPlus', [8, 45]],
    ['bastion', 'of the Bastion', 'suffix', 'any', 'hullPlus', [6, 36]],
  ].map(([id, name, kind, slots, stat, range]) => ({ id, name, kind, slots, stat, range }));
  const AFFIX = Object.fromEntries(AFFIXES.map((a) => [a.id, a]));
  const FLAT = new Set(['hullPlus', 'initiativePlus', 'evasionPlus']);
  // A Legendary's own name, by base.
  const LEGENDARY = {
    laser: ['Sunspear', 'Halcyon Lance', 'Quiet Meridian'],
    'missile-launcher': ['Starfall Battery', 'Widowmaker', 'Last Argument'],
    'plasma-cannon': ['Furnace Heart', 'Corona Breaker', 'Ember Throne'],
    'shield-generator': ['Aegis of Tarn', 'Unbroken Vow', 'Glasswall'],
    scanner: ['All-Seeing Eye', 'Deep Listener', 'Lantern of Seven'],
    engine: ['Comet Rider', 'Long Night Drive', 'Gale of Ixion'],
    'ship-computer': ['Oracle Core', 'Cold Arithmetic', 'Mind of the Maze'],
  };

  // Credits to buy one, by Mk (rules/loadout.js PRICES), with a share between Mks by item level.
  const PRICES = [250, 250, 800, 2000, 5000, 12000, 20000];
  const tierOf = (ilvl) => clamp(Math.ceil(ilvl / 10), 1, 5);

  // Drop tables: chance (that anything drops), rolls, floor (lowest rarity), luck (the weight of
  // Rare and up multiplied by it). Nothing destroyed drops Common: fewer drops, each worth a look
  // (Commons are the outfitter's).
  const SOURCES = {
    fighter: { chance: 0.1, rolls: 1, floor: 'uncommon', luck: 1 },
    turret: { chance: 0.35, rolls: 1, floor: 'uncommon', luck: 1.3 },
    station: { chance: 1, rolls: 2, floor: 'uncommon', luck: 2 },
    outpost: { chance: 1, rolls: 2, floor: 'uncommon', luck: 1.6 },
    sentinel: { chance: 0.18, rolls: 1, floor: 'uncommon', luck: 1.2 },
    raider: { chance: 0.15, rolls: 1, floor: 'uncommon', luck: 1.1 },
    warden: { chance: 1, rolls: 1, floor: 'rare', luck: 2.5 },
    elite: { chance: 1, rolls: 2, floor: 'rare', luck: 2.2 }, // a named pirate ace (game/traffic.js)
    mission: { chance: 1, rolls: 1, floor: 'uncommon', luck: 1.5 },
  };
  const PITY = { rare: 14, epic: 45 };
  const SMART = 0.4;
  const CLASS_BIAS = {
    tank: ['shield-generator', 'shield-generator', 'engine', 'plasma-cannon'],
    dps: ['laser', 'missile-launcher', 'plasma-cannon', 'ship-computer'],
    healer: ['ship-computer', 'shield-generator', 'scanner', 'laser'],
  };

  const rarityOf = (id) => RARITIES[RANK[id] ?? 0];
  const pick = (r, list) => list[Math.floor(r() * list.length)];

  function rollRarity(r, luck = 1, floor = 'common') {
    const min = RANK[floor] ?? 0;
    const table = RARITIES.map((x, i) => (i < min ? 0 : x.weight * (i >= RANK.rare ? luck : 1)));
    let u = r() * table.reduce((a, b) => a + b, 0);
    for (let i = 0; i < table.length; i++) if ((u -= table[i]) < 0) return RARITIES[i].id;
    return RARITIES[RARITIES.length - 1].id;
  }

  // One item. level: what dropped it (1..5, fractions allowed: a Warden is a level up); pity: a
  // { rare, epic } counter carried between rolls (changed in place); base: a base asked for.
  function roll(r, o = {}) {
    const level = clamp(o.level || 1, 1, 5);
    const ilvl = clamp(Math.round((level - 1) * 10 + 1 + r() * 9), 1, MAX_ILVL);
    let floor = o.floor || 'common';
    const pity = o.pity;
    if (pity) {
      if ((pity.epic || 0) >= PITY.epic && RANK[floor] < RANK.epic) floor = 'epic';
      else if ((pity.rare || 0) >= PITY.rare && RANK[floor] < RANK.rare) floor = 'rare';
    }
    let rarity = rollRarity(r, o.luck || 1, floor);
    if (o.cap && RANK[rarity] > RANK[o.cap]) rarity = o.cap;
    if (pity) {
      const k = RANK[rarity];
      pity.rare = k >= RANK.rare ? 0 : (pity.rare || 0) + 1;
      pity.epic = k >= RANK.epic ? 0 : (pity.epic || 0) + 1;
    }
    const smart = o.cls && CLASS_BIAS[o.cls] && r() < SMART;
    const base = BASES[o.base] ? o.base : smart ? pick(r, CLASS_BIAS[o.cls]) : pick(r, BASE_IDS);
    const seed = Math.floor(r() * 4294967295) >>> 0;
    return { id: `L${(o.key !== undefined ? hashInt(seedToInt(String(o.key)), seed, 0x1007) : seed).toString(36)}${ilvl.toString(36)}`, base, ilvl, rarity, seed };
  }

  // What a source drops: [spec]. key: what dropped it (its drops are the same every time).
  function drops(source, key, o = {}) {
    const S = SOURCES[source] || SOURCES.fighter;
    const r = mulberry32(hashInt(seedToInt(String(o.seed ?? 0)), seedToInt(String(key)), 0xd209));
    if (r() >= S.chance * (o.chance ?? 1)) return [];
    const out = [];
    const rolls = S.rolls + (o.extra || 0);
    for (let i = 0; i < rolls; i++) out.push(roll(r, { level: o.level, luck: S.luck * (o.luck || 1), floor: o.floor || S.floor, cls: o.cls, pity: o.pity, key: `${key}#${i}` }));
    return out;
  }

  // The item a spec makes: base stats at its item level, raised by its rarity, then its affixes.
  function make(spec) {
    const B = BASES[spec.base];
    if (!B) return null;
    const ilvl = clamp(Math.round(spec.ilvl) || 1, 1, MAX_ILVL), R = rarityOf(spec.rarity);
    const r = mulberry32(hashInt(spec.seed >>> 0, ilvl, RANK[R.id] + 7));
    const stats = { ...B.stats };
    if (B.stats.vs) stats.vs = { ...B.stats.vs };
    for (const [k, g] of Object.entries(B.grow)) stats[k] = stats[k] * (1 + g * (ilvl - 1));
    for (const [k, w] of PRIMARY[B.slot]) stats[k] = stats[k] * (1 + (R.power - 1) * w);
    // Affixes: never two on one stat; two prefixes and two suffixes at most, unless the stats left
    // are all of one kind.
    const affixes = [];
    const scale = 0.55 + 0.45 * (ilvl / MAX_ILVL);
    const pool = AFFIXES.filter((a) => a.slots === 'any' || a.slots.includes(B.slot));
    for (let n = 0; n < R.affixes; n++) {
      const kinds = { prefix: affixes.filter((a) => AFFIX[a.id].kind === 'prefix').length, suffix: affixes.filter((a) => AFFIX[a.id].kind === 'suffix').length };
      const fresh = pool.filter((a) => !affixes.some((x) => AFFIX[x.id].stat === a.stat));
      const balanced = fresh.filter((a) => kinds[a.kind] < 2);
      const open = balanced.length ? balanced : fresh; // a third of one kind rather than one affix short
      if (!open.length) break;
      const a = pick(r, open);
      const raw = (a.range[0] + (a.range[1] - a.range[0]) * r()) * scale;
      const value = a.stat === 'hullPlus' || a.stat === 'initiativePlus' ? Math.round(raw) : Math.round(raw * 1000) / 1000;
      affixes.push({ id: a.id, name: a.name, stat: a.stat, value });
    }
    for (const a of affixes) {
      if (FLAT.has(a.stat)) stats[a.stat] = (stats[a.stat] || 0) + a.value;
      else if (a.stat === 'lockTime') stats.lockTime *= 1 - a.value;
      else stats[a.stat] *= 1 + a.value;
    }
    // Tidy numbers, within the limits.
    for (const [k, v] of Object.entries(stats)) {
      if (k === 'vs') continue;
      const [lo, hi] = LIMITS[k] || [0, Infinity];
      const c = clamp(v, lo, hi);
      stats[k] = ['accuracy', 'evasion', 'evasionPlus', 'lockTime'].includes(k) ? Math.round(c * 1000) / 1000 : ['turnRate', 'fireRate', 'miningRate'].includes(k) ? Math.round(c * 100) / 100 : ['damage', 'recharge'].includes(k) ? Math.round(c * 10) / 10 : Math.round(c);
    }
    const prefix = affixes.find((a) => AFFIX[a.id].kind === 'prefix'), suffix = affixes.find((a) => AFFIX[a.id].kind === 'suffix');
    const legendary = R.id === 'legendary' ? LEGENDARY[spec.base][spec.seed % LEGENDARY[spec.base].length] : null;
    const name = legendary ? `${legendary}` : [prefix?.name, B.name, suffix?.name].filter(Boolean).join(' ');
    const tier = tierOf(ilvl);
    const lo = PRICES[tier], hi = PRICES[tier + 1], frac = ((ilvl - 1) % 10) / 10;
    const price = Math.round(((lo + (hi - lo) * frac) * R.price * (B.slot === 'weapon' ? 1.2 : 1)) / 10) * 10;
    return {
      slot: B.slot, name, line: `loot-${spec.base}`, tier, stats, price,
      loot: { base: spec.base, ilvl, rarity: R.id, affixes, ...(legendary ? { legendary: B.name } : {}) },
    };
  }

  function register(spec, EQUIPMENT) {
    if (EQUIPMENT[spec.id]) return EQUIPMENT[spec.id];
    const item = make(spec);
    if (item) EQUIPMENT[spec.id] = item;
    return item;
  }

  const valid = (s) => s && typeof s.id === 'string' && /^L[0-9a-z]+$/.test(s.id) && BASES[s.base] && RANK[s.rarity] !== undefined
    && Number.isFinite(s.ilvl) && Number.isFinite(s.seed);
  function read(d) {
    const out = {};
    if (d && typeof d === 'object') for (const [id, s] of Object.entries(d)) if (valid(s) && s.id === id) out[id] = { id, base: s.base, ilvl: clamp(Math.round(s.ilvl), 1, MAX_ILVL), rarity: s.rarity, seed: s.seed >>> 0 };
    return out;
  }

  const pct = (v) => `${Math.round(v * 100)}%`;
  const STAT_LABEL = {
    damage: 'damage', fireRate: 'fire rate', range: 'range', arc: 'field of fire', strength: 'shield strength', recharge: 'shield recharge',
    maxSpeed: 'top speed', accel: 'acceleration', turnRate: 'turn rate', evasion: 'evasion', sensorRange: 'identify range', pingRange: 'ping range',
    lockRange: 'lock range', accuracy: 'accuracy', lockTime: 'lock time', miningRate: 'mining', hullPlus: 'hull', initiativePlus: 'initiative', evasionPlus: 'evasion',
  };
  const affixText = (a) => (a.stat === 'hullPlus' ? `+${a.value} hull` : a.stat === 'initiativePlus' ? `+${a.value} initiative` : a.stat === 'evasionPlus' ? `+${pct(a.value)} evasion` : a.stat === 'lockTime' ? `−${pct(a.value)} lock time` : `+${pct(a.value)} ${STAT_LABEL[a.stat]}`);

  return { RARITIES, RANK, BASES, BASE_IDS, AFFIXES, SOURCES, PITY, SMART, CLASS_BIAS, MAX_ILVL, rarityOf, rollRarity, roll, drops, make, register, read, affixText, tierOf };
})();

export { Loot };
