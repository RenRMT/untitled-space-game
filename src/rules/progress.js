// Progress: a pilot's experience, level and talents (and each squad member's experience and level),
// MMO style. Experience comes from what's destroyed (more for a tougher one, less once it's far
// below your level), contracts by their difficulty, and a dungeon's Warden. Each level makes a ship a
// little sturdier and harder hitting (LEVEL_BONUS); every third level gives a talent point, spent on
// talents (TALENTS: some for every class, some for one), each with a level it opens at. Most are a
// share of a stat; two for each class are perks, which change what one of its skills does
// (`perk`: rules/abilities.js PERKS has their numbers, and reads them from stats.perks). Levels also
// gate gear (gearLevel: what an item asks of whoever fits it) and hulls (HULL_LEVEL), and give
// program memory (lineBonus) on top of the mem.ext gambits.
//
//   Progress.MAX_LEVEL
//   Progress.toNext(level) -> xp           what a level takes to finish
//   Progress.of(xp) -> { level, into, need, max }   (into: xp into the level, need: its size)
//   Progress.killXP(tier, level) -> xp     a ship or turret of that tier (1..5) destroyed
//   Progress.contractXP(difficulty, level, sysLevel) -> xp   ('easy' | 'normal' | 'hard' | 'elite')
//   Progress.wardenXP(sysLevel) -> xp
//   Progress.points(level) -> talent points earned by then
//   Progress.TALENTS[id], Progress.LIST    { id, name, cls (null: any), level (opens at), note, stats?, upgrade?, perk? }
//   Progress.talentsFor(cls) -> [talent]   what a class can take, in order
//   Progress.canTake(id, { level, cls, talents }) -> { ok, why }
//   Progress.read(talents, cls) -> [id]    saved talents, checked (a class changed: theirs dropped)
//   Progress.apply(stats, level, talents) -> stats   Classes.apply's stats, with the level and talents
//   Progress.upgrades(talents) -> { cargo, hull, weapons }   what talents add to every hull (rules/loadout.js)
//   Progress.lineBonus(level) -> program lines on top of the base
//   Progress.gearLevel(item) -> level       (rules/loadout.js EQUIPMENT; loot by its item level)
//   Progress.foeLevel(tier) -> level        what a hostile of that gear tier shows over it
//   Progress.HULL_LEVEL[hull]
//   Progress.RESPEC(level) -> credits       forgetting every talent
// ES module (`Progress`); also runs in Node (the tests).

const Progress = (() => {
  const MAX_LEVEL = 30;
  const toNext = (level) => Math.round(60 * level ** 1.5 / 10) * 10;
  function of(xp) {
    let level = 1, left = Math.max(0, Math.floor(xp || 0));
    while (level < MAX_LEVEL && left >= toNext(level)) { left -= toNext(level); level++; }
    return { level, into: level >= MAX_LEVEL ? 0 : left, need: level >= MAX_LEVEL ? 0 : toNext(level), max: level >= MAX_LEVEL };
  }

  // A tier's "home" level: the levels a pilot fights it at (tier 1 at 1–6, tier 2 at 7–12, ...).
  const home = (tier) => tier * 6 - 2;
  // Less for one far below you (none past a point), a little more for one above.
  const scale = (tier, level) => Math.max(0, Math.min(1.3, 1 - (level - home(tier)) * 0.09));
  const killXP = (tier, level) => Math.round(14 * Math.max(1, tier) ** 1.7 * scale(Math.max(1, tier), level));
  const DIFFICULTY = { easy: 1, normal: 1.5, hard: 2.2, elite: 3.2 };
  const contractXP = (difficulty, level, sysLevel = 1) => Math.round(90 * (DIFFICULTY[difficulty] || 1) * sysLevel ** 1.4 * Math.max(0.25, scale(sysLevel, level)));
  const wardenXP = (sysLevel) => Math.round(300 * sysLevel ** 1.5);

  const points = (level) => Math.floor(level / 3);
  const LEVEL_BONUS = { hull: 0.02, shield: 0.02, firepower: 0.015 }; // a share per level above 1

  // Talents. stats: shares added to the ship's (hull, shield, firepower, accuracy, evasion and
  // shieldRecharge as shares; accuracy and evasion as points), or cooldown (skills come back that
  // much sooner), heal (repairs mend that much more), skillTime (timed skills last that much
  // longer). upgrade: what every hull gets (cargo, hull as shares; weapons as hardpoints).
  const T = (o) => o;
  const TALENTS = {
    // Every class.
    'reinforced-frame': T({ name: 'Reinforced frame', level: 3, stats: { hull: 0.08 }, note: '+8% hull' }),
    'cargo-racks': T({ name: 'Cargo racks', level: 3, upgrade: { cargo: 0.25 }, note: '+25% hold, on every hull' }),
    'gunnery-drills': T({ name: 'Gunnery drills', level: 6, stats: { accuracy: 0.04 }, note: '+4% accuracy' }),
    'evasive-flying': T({ name: 'Evasive flying', level: 9, stats: { evasion: 0.03 }, note: '+3% evasion' }),
    'armour-plating': T({ name: 'Armour plating', level: 12, upgrade: { hull: 0.15 }, note: '+15% hull, on every hull' }),
    'quick-hands': T({ name: 'Quick hands', level: 15, stats: { cooldown: 0.1 }, note: 'skills come back 10% sooner' }),
    'hardpoint-retrofit': T({ name: 'Hardpoint retrofit', level: 21, upgrade: { weapons: 1 }, note: 'an extra weapon mount, on every hull' }),
    // Tank.
    'bulkheads': T({ name: 'Bulkheads', cls: 'tank', level: 3, stats: { hull: 0.12 }, note: '+12% hull' }),
    'long-taunt': T({ name: 'Long taunt', cls: 'tank', level: 9, stats: { skillTime: 0.4 }, note: 'Taunt, Fortify and Overload last 40% longer' }),
    'shield-capacitors': T({ name: 'Shield capacitors', cls: 'tank', level: 15, stats: { shield: 0.15, shieldRecharge: 0.2 }, note: '+15% shields, +20% recharge' }),
    'barbed-taunt': T({ name: 'Barbed taunt', cls: 'tank', level: 6, perk: true, note: 'Taunt also exposes every enemy: they take 15% more damage while it lasts' }),
    'counter-battery': T({ name: 'Counter-battery', cls: 'tank', level: 12, perk: true, note: 'while Fortify runs, your guns hit 40% harder' }),
    // DPS.
    'hot-loads': T({ name: 'Hot loads', cls: 'dps', level: 3, stats: { firepower: 0.08 }, note: '+8% damage' }),
    'target-painter': T({ name: 'Target painter', cls: 'dps', level: 9, stats: { accuracy: 0.05, skillTime: 0.3 }, note: '+5% accuracy; Mark and Overload last 30% longer' }),
    'overclock': T({ name: 'Overclock', cls: 'dps', level: 15, stats: { firepower: 0.12, cooldown: 0.1 }, note: '+12% damage; skills back 10% sooner' }),
    'executioner': T({ name: 'Executioner', cls: 'dps', level: 6, perk: true, note: 'Salvo and Barrage hit 50% harder on a ship below 40% hull' }),
    'chain-fire': T({ name: 'Chain fire', cls: 'dps', level: 12, perk: true, note: 'a kill with Salvo makes it ready again at once' }),
    // Healer.
    'field-medic': T({ name: 'Field medic', cls: 'healer', level: 3, stats: { heal: 0.2 }, note: 'repairs mend 20% more' }),
    'triage': T({ name: 'Triage', cls: 'healer', level: 9, stats: { cooldown: 0.15 }, note: 'skills come back 15% sooner' }),
    'overflow': T({ name: 'Overflow', cls: 'healer', level: 6, perk: true, note: 'what a repair can\'t mend goes to the ship\'s shields' }),
    'battle-medic': T({ name: 'Battle medic', cls: 'healer', level: 12, perk: true, note: 'Repair beam also makes its target\'s guns hit 20% harder for 5 s' }),
    'nanite-swarm': T({ name: 'Nanite swarm', cls: 'healer', level: 15, stats: { heal: 0.25, shield: 0.1 }, note: 'repairs mend 25% more; +10% shields' }),
  };
  for (const [id, t] of Object.entries(TALENTS)) Object.assign(t, { id, cls: t.cls || null });
  const LIST = Object.values(TALENTS);
  const talentsFor = (cls) => LIST.filter((t) => !t.cls || t.cls === cls).sort((a, b) => a.level - b.level);

  function canTake(id, { level, cls, talents }) {
    const t = TALENTS[id];
    if (!t || (t.cls && t.cls !== cls)) return { ok: false, why: 'Not for this class' };
    if (talents.includes(id)) return { ok: false, why: 'Taken' };
    if (level < t.level) return { ok: false, why: `Opens at level ${t.level}` };
    if (talents.length >= points(level)) return { ok: false, why: 'No talent points left' };
    return { ok: true, why: '' };
  }
  const read = (talents, cls) => (Array.isArray(talents) ? [...new Set(talents)].filter((id) => TALENTS[id] && (!TALENTS[id].cls || TALENTS[id].cls === cls)) : []);

  const sum = (talents, key) => talents.reduce((n, id) => n + (TALENTS[id]?.stats?.[key] || 0), 0);
  function apply(stats, level, talents = []) {
    const up = Math.max(0, Math.min(MAX_LEVEL, level) - 1), share = (k) => 1 + up * (LEVEL_BONUS[k] || 0) + sum(talents, k);
    return {
      ...stats, level,
      hull: Math.round(stats.hull * share('hull')), shield: Math.round(stats.shield * share('shield')),
      firepower: stats.firepower * share('firepower'), classDamage: (stats.classDamage ?? 1) * share('firepower'),
      shieldRecharge: (stats.shieldRecharge || 0) * (1 + sum(talents, 'shieldRecharge')),
      accuracy: (stats.accuracy || 0) + sum(talents, 'accuracy'), evasion: (stats.evasion || 0) + sum(talents, 'evasion'),
      cooldown: Math.max(0.5, 1 - sum(talents, 'cooldown')), heal: 1 + sum(talents, 'heal'), skillTime: 1 + sum(talents, 'skillTime'),
      perks: talents.filter((id) => TALENTS[id]?.perk),
    };
  }
  function upgrades(talents = []) {
    const out = { cargo: 0, hull: 0, weapons: 0 };
    for (const id of talents) for (const k of Object.keys(out)) out[k] += TALENTS[id]?.upgrade?.[k] || 0;
    return out;
  }
  const lineBonus = (level) => (level >= 20 ? 2 : level >= 10 ? 1 : 0);

  // Gear: loot by its item level (ilvl 1–10 at level 1, then two item levels a level), the Mk lines
  // by their Mk (a tier's home level, less a bit).
  function gearLevel(item) {
    if (!item || item.npc) return 1;
    if (item.loot) return Math.max(1, Math.min(MAX_LEVEL, Math.ceil((item.loot.ilvl - 10) / 2) + 1));
    return Math.max(1, (item.tier - 1) * 6 - 1);
  }
  // The level a hostile of a gear tier shows: the first level its gear could be fitted at, about.
  const foeLevel = (tier) => (Math.max(1, tier) - 1) * 6 + 1;
  const HULL_LEVEL = { courier: 1, hauler: 3, corvette: 8, gunship: 16 };
  const RESPEC = (level) => 200 * level;

  return { MAX_LEVEL, LEVEL_BONUS, TALENTS, LIST, HULL_LEVEL, toNext, of, killXP, contractXP, wardenXP, points, talentsFor, canTake, read, apply, upgrades, lineBonus, gearLevel, foeLevel, RESPEC };
})();

export { Progress };
