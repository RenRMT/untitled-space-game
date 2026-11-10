// Abilities: consumables made by industry (rules/recipes.js) and spent in a fight, one charge a use,
// by the player (the combat panel) or a squad member (a `use` line, rules/logic.js). Each has a
// cooldown per ship, and is used on a friend (yourself, the leader, an ally) or on an enemy:
// - repair nanites: hull back, up to its maximum,
// - shield cell: shields back in full,
// - EMP charge: the target's guns go quiet for a few seconds, and it can't be hit by another for a
//   while after (so a squad can't keep one locked down),
// - jammer pod: the target's accuracy drops for a few seconds.
// (EMP charges and jammer pods are for fights with ships, parked with the pirates.)
// Some are used in the field too, from the HUD's buttons (game/field.js), on the player's own ship
// whenever they'd help, mining or not (`field`); four of them only there (`on: 'self'`):
// - repair nanites and shield cells, as in a fight,
// - coolant flush: sheds heat at once,
// - radiation purge: clears some of the radiation built up,
// - fuel canister: fuel into the tank,
// - seismic charge: a burst of damage to the rock the tools are locked on (rock only, not gas).
// Class skills (rules/classes.js: four for each of Tank, DPS and Healer) are abilities too, with no
// charges (`skill`, its class in `cls`): a ship of that class uses one when it's off cooldown. Each
// has an activation time (`cast`): used, it starts at once and its cooldown runs from then, but its
// effect lands only once the activation is done (`resolve`, each step of a fight); the ship can't
// start another meanwhile. on: 'self' (itself), 'friend' (itself or a squadmate), 'enemy':
// - taunt (Tank): every enemy turns its guns on this ship for a while,
// - fortify (Tank): it takes half damage for a while,
// - bulwark (Tank): its shields back in full,
// - overload (DPS): its guns hit half as hard again for a while,
// - salvo (DPS): a burst of damage on the target, a few seconds' worth of its guns at once,
// - mark (DPS): the target takes more damage from everyone for a while,
// - repair beam (Healer): hull back on a friend,
// - restore (Healer): a friend's shields back in full,
// - nanite field (Healer): hull back on every friend at once.
// The fourth of each class opens at level 10, and gives the class a second job:
// - aegis (Tank): every ship on its side takes less damage for a while,
// - barrage (DPS): a burst of damage on every enemy at once,
// - disrupt (Healer): the target's guns go quiet (as an EMP charge's), and a heavy shot it was
//   charging is cancelled.
// Some talents (rules/progress.js, `perk`) change what a skill does; a ship's are in stats.perks:
// - barbed-taunt (Tank): Taunt also leaves every enemy exposed (more damage from everyone),
// - counter-battery (Tank): while Fortify runs, its guns hit harder,
// - executioner (DPS): Salvo and Barrage hit harder on a ship low on hull,
// - chain-fire (DPS): a kill with Salvo makes it ready again at once,
// - overflow (Healer): what a repair can't mend goes to the ship's shields,
// - battle-medic (Healer): Repair beam also makes its target's guns hit harder for a while.
// Timed effects are statuses on the combatant ({ id, until, ... }): `tick` keeps its stats as its
// base stats with what's still running applied, so both combat modes (combat/combat.js,
// combat/combat-realtime.js) see them without special cases, beyond holding fire while disabled.
// Times are seconds of fight time (s.t in either mode).
//
//   Abilities.ABILITIES[id]   { id, name, code, on: 'friend' | 'enemy', cooldown (s), price, note, ... }
//   Abilities.LIST                         the consumables (not the skills)
//   Abilities.SKILLS                       the class skills; Abilities.skillsOf(cls) -> their ids
//   Abilities.unlocked(id, level) -> bool  a skill's level reached (ABILITIES[id].level: 1, 2, 4 or 10)
//   Abilities.PERKS[id]                    a perk talent's numbers
//   Abilities.ready(user, id, target, now) -> bool   off cooldown, and worth using on that target now
//   Abilities.resolve(s, now) -> [events]  activations that are done land (a fight state s: player,
//                                          allies, enemies): { type: 'ability', from, to, ability,
//                                          amount? }, and a salvo as a { type: 'shot' }
//   Abilities.casting(c) -> { id, to, at, cast } | null   an activation under way
//   Abilities.use(user, id, target, now) -> { type: 'ability', from, to, ability, amount? } | null
//   Abilities.tick(c, now)                 statuses that ran out come off, and the stats follow
//   Abilities.disabled(c, now) -> bool     an EMP holds its fire
//   Abilities.has(c, status, now) -> bool
//   Abilities.FIELD                        the ones used in the field, in the HUD's order
//   Abilities.fieldReady(id, m) -> bool    worth using now; m: the ship's meters { heat, rad, fuel,
//                                          fuelMax, hull, hullMax, shield, shieldMax, rock? } (rock:
//                                          the locked rock { hull, material }, while mining)
//   Abilities.fieldUse(id, m) -> { heat?, rad?, fuel?, hull?, shield?, rockDamage?, amount }   the
//                                          meters' new values (only those it changes), and how much it did
// Field cooldowns are the caller's (seconds of flight time).
// ES module (`Abilities`); also runs in Node (the tests).

const Abilities = (() => {
  const ABILITIES = {
    'repair-nanites': { name: 'Repair nanites', code: 'REP', on: 'friend', cooldown: 12, price: 700, hull: 0.3, note: 'repairs 30% of a ship\'s hull' },
    'shield-cell': { name: 'Shield cell', code: 'SHC', on: 'friend', cooldown: 10, price: 1210, note: 'restores a ship\'s shields in full' },
    'emp-charge': { name: 'EMP charge', code: 'EMP', on: 'enemy', cooldown: 15, price: 1350, time: 4, immune: 8, note: 'silences a ship\'s guns for 4 s; it shrugs off another for 8 s more' },
    'jammer-pod': { name: 'Jammer pod', code: 'JAM', on: 'enemy', cooldown: 10, price: 400, time: 6, accuracy: -0.25, note: 'cuts a ship\'s accuracy by 25% for 6 s' },
    'coolant-flush': { name: 'Coolant flush', code: 'CLF', on: 'self', cooldown: 8, price: 180, heat: 50, note: 'sheds 50 heat at once' },
    'rad-purge': { name: 'Radiation purge', code: 'PRG', on: 'self', cooldown: 10, price: 350, rad: 35, note: 'clears 35 radiation' },
    'fuel-canister': { name: 'Fuel canister', code: 'CAN', on: 'self', cooldown: 4, price: 300, fuel: 30, note: 'puts 30 fuel in the tank' },
    'seismic-charge': { name: 'Seismic charge', code: 'SEI', on: 'self', cooldown: 5, price: 150, damage: 40, note: 'a 40-point blast on the rock being mined' },
    // Class skills: no price, no charges; cast: seconds to activate.
    taunt: { name: 'Taunt', code: 'TAU', skill: true, cls: 'tank', on: 'self', cast: 0.3, time: 6, cooldown: 16, note: 'every enemy turns its guns on this ship for 6 s' },
    fortify: { name: 'Fortify', code: 'FOR', skill: true, cls: 'tank', on: 'self', cast: 0.5, time: 6, taken: 0.5, cooldown: 20, note: 'takes half damage for 6 s' },
    bulwark: { name: 'Bulwark', code: 'BWK', skill: true, cls: 'tank', on: 'self', cast: 1, cooldown: 24, note: 'shields back in full' },
    overload: { name: 'Overload', code: 'OVL', skill: true, cls: 'dps', on: 'self', cast: 0.5, time: 6, damage: 1.5, cooldown: 18, note: 'guns hit 50% harder for 6 s' },
    salvo: { name: 'Salvo', code: 'SLV', skill: true, cls: 'dps', on: 'enemy', cast: 1, burst: 2.5, cooldown: 10, note: 'a burst of 2.5 s of its guns\' damage, at once' },
    mark: { name: 'Mark target', code: 'MRK', skill: true, cls: 'dps', on: 'enemy', cast: 0.3, time: 8, taken: 1.3, cooldown: 16, note: 'the target takes 30% more damage from everyone for 8 s' },
    'repair-beam': { name: 'Repair beam', code: 'RPB', skill: true, cls: 'healer', on: 'friend', cast: 1.2, hull: 0.35, cooldown: 8, note: 'repairs 35% of a ship\'s hull' },
    restore: { name: 'Restore shields', code: 'RST', skill: true, cls: 'healer', on: 'friend', cast: 0.8, cooldown: 12, note: 'a ship\'s shields back in full' },
    'nanite-field': { name: 'Nanite field', code: 'NAN', skill: true, cls: 'healer', on: 'self', cast: 1.5, hull: 0.2, cooldown: 28, note: 'repairs 20% of the hull of every ship on its side' },
    // The fourth skills (level 10), listed after each class's first three.
    aegis: { name: 'Aegis', code: 'AEG', skill: true, cls: 'tank', on: 'self', cast: 0.8, time: 6, taken: 0.6, cooldown: 30, note: 'every ship on its side takes 40% less damage for 6 s' },
    barrage: { name: 'Barrage', code: 'BRG', skill: true, cls: 'dps', on: 'enemy', cast: 1.2, burst: 1.5, cooldown: 26, note: 'a burst of 1.5 s of its guns\' damage on every enemy at once' },
    disrupt: { name: 'Disrupt', code: 'DSR', skill: true, cls: 'healer', on: 'enemy', cast: 0.5, time: 4, immune: 8, cooldown: 22, note: 'silences a ship\'s guns for 4 s and cancels a heavy shot it was charging; it shrugs off another for 8 s more' },
  };
  // What the perk talents do (rules/progress.js names them and says who can take them).
  const PERKS = {
    'barbed-taunt': { taken: 1.15 }, // every enemy, while the taunt lasts
    'counter-battery': { damage: 1.4 }, // its own guns, while fortified
    executioner: { below: 0.4, damage: 1.5 }, // a burst on a ship under that share of its hull
    'chain-fire': {},
    overflow: {},
    'battle-medic': { damage: 1.2, time: 5 },
  };
  for (const [id, a] of Object.entries(ABILITIES)) a.id = id;
  for (const id of ['repair-nanites', 'shield-cell', 'coolant-flush', 'rad-purge', 'fuel-canister', 'seismic-charge']) ABILITIES[id].field = true;
  const ALL = Object.values(ABILITIES);
  const LIST = ALL.filter((a) => !a.skill); // the consumables
  const FIELD = LIST.filter((a) => a.field);
  const SKILLS = ALL.filter((a) => a.skill);
  const skillsOf = (cls) => SKILLS.filter((a) => a.cls === cls).map((a) => a.id);
  // A class's skills open one at a time: its first from the start, the second at level 2, the third
  // at level 4 and the fourth at level 10 (`level` on each), so a level gives something new to do
  // and a first fight has one button to learn. A ship with no level (stats.level) has them all.
  const SKILL_LEVELS = [1, 2, 4, 10];
  for (const cls of new Set(SKILLS.map((a) => a.cls))) skillsOf(cls).forEach((id, i) => { ABILITIES[id].level = SKILL_LEVELS[i] || 1; });
  const unlocked = (id, level) => !ABILITIES[id]?.level || level === undefined || level === null || level >= ABILITIES[id].level;
  const casting = (c) => c?.casting || null;

  const statusOf = (c, id, now) => (c.status || []).find((x) => x.id === id && x.until > now);
  const has = (c, id, now) => !!statusOf(c, id, now);
  const disabled = (c, now) => has(c, 'emp', now);
  const perk = (c, id) => !!(c.base || c.stats)?.perks?.includes(id);

  // Off cooldown, the target still flying, and the use would do something.
  function ready(user, id, target, now) {
    const a = ABILITIES[id];
    if (!a || !user || !target || user.hull <= 0 || target.hull <= 0) return false;
    if ((user.cooldowns?.[id] ?? -Infinity) > now) return false;
    if (a.skill) {
      if (!unlocked(id, user.stats?.level)) return false;
      if (user.casting) return false; // one activation at a time
      switch (id) {
        case 'taunt': case 'fortify': case 'overload': case 'aegis': return !has(user, id, now);
        case 'barrage': return target !== user;
        case 'disrupt': return target !== user && !has(target, 'emp', now) && !has(target, 'emp-immune', now);
        case 'bulwark': return user.shield < user.stats.shield * 0.6;
        case 'salvo': return target !== user;
        case 'mark': return target !== user && !has(target, 'mark', now);
        case 'repair-beam': return target.hull < target.stats.hull * 0.85;
        case 'restore': return target.shield < target.stats.shield * 0.5;
        case 'nanite-field': return target.hull < target.stats.hull * 0.9;
        default: return false;
      }
    }
    if (id === 'repair-nanites') return target.hull < target.stats.hull;
    if (id === 'shield-cell') return target.shield < target.stats.shield;
    if (id === 'emp-charge') return !has(target, 'emp', now) && !has(target, 'emp-immune', now);
    if (id === 'jammer-pod') return !has(target, 'jam', now);
    return a.on !== 'self'; // field-only ones aren't for fights
  }

  // In the field, on the player's own ship.
  function fieldReady(id, m) {
    switch (id) {
      case 'repair-nanites': return m.hull < m.hullMax;
      case 'shield-cell': return m.shield < m.shieldMax;
      case 'coolant-flush': return m.heat >= 1;
      case 'rad-purge': return m.rad >= 1;
      case 'fuel-canister': return m.fuel < m.fuelMax - 0.5;
      case 'seismic-charge': return !!m.rock && m.rock.hull > 0 && m.rock.material !== 'gas';
      default: return false;
    }
  }
  function fieldUse(id, m) {
    if (!fieldReady(id, m)) return null;
    const a = ABILITIES[id];
    switch (id) {
      case 'repair-nanites': { const hull = Math.min(m.hullMax, m.hull + m.hullMax * a.hull); return { hull, amount: hull - m.hull }; }
      case 'shield-cell': return { shield: m.shieldMax, amount: m.shieldMax - m.shield };
      case 'coolant-flush': { const heat = Math.max(0, m.heat - a.heat); return { heat, amount: m.heat - heat }; }
      case 'rad-purge': { const rad = Math.max(0, m.rad - a.rad); return { rad, amount: m.rad - rad }; }
      case 'fuel-canister': { const fuel = Math.min(m.fuelMax, m.fuel + a.fuel); return { fuel, amount: fuel - m.fuel }; }
      case 'seismic-charge': return { rockDamage: a.damage, amount: a.damage };
      default: return null;
    }
  }

  // The stats with what's running applied: a jam's accuracy, overload's damage (×), fortify's and a
  // mark's share of damage taken (stats.taken, CombatCore.applyDamage).
  function tick(c, now) {
    if (!c.status?.length) return;
    c.base ||= c.stats;
    c.status = c.status.filter((x) => x.until > now);
    const jam = statusOf(c, 'jam', now);
    const dmg = c.status.reduce((k, x) => k * (x.damage || 1), 1), taken = c.status.reduce((k, x) => k * (x.taken || 1), 1);
    if (!jam && dmg === 1 && taken === 1) { c.stats = c.base; return; }
    const B = c.base;
    c.stats = {
      ...B, ...(jam ? { accuracy: Math.max(0, B.accuracy + jam.accuracy) } : {}),
      ...(dmg !== 1 ? { firepower: B.firepower * dmg, weapons: B.weapons.map((w) => ({ ...w, damage: w.damage * dmg })) } : {}),
      ...(taken !== 1 ? { taken: (B.taken ?? 1) * taken } : {}),
    };
  }

  // A skill's effect, once its activation is done: [events].
  // Hull back on t, a share of its maximum: how much it mended. With `spill`, what the hull has no
  // room for goes to its shields.
  const heal = (t, share, spill = false) => {
    const before = t.hull, want = t.stats.hull * share;
    t.hull = Math.min(t.stats.hull, t.hull + want);
    const over = want - (t.hull - before);
    if (spill && over > 0) t.shield = Math.min(t.stats.shield, t.shield + over);
    return t.hull - before;
  };
  // A burst of the user's guns on a target (salvo, barrage): `burst` seconds of their damage at once.
  function strike(user, id, target, burst) {
    const base = user.base || user.stats, mult = (user.stats.firepower || 0) / Math.max(1e-6, base.firepower || 1);
    const E = PERKS.executioner, finish = perk(user, 'executioner') && target.hull < target.stats.hull * E.below ? E.damage : 1;
    const amount = Math.round((base.firepower || 0) * burst * (mult || 1) * finish * (target.stats.taken ?? 1));
    if (target.invulnerable) return { type: 'shot', from: user.id, to: target.id, weapon: -1, shots: 1, hits: 1, damage: 0, shieldDamage: 0, hullDamage: 0, destroyed: false, skill: id };
    const shieldDamage = Math.min(target.shield, amount), hullDamage = Math.min(target.hull, amount - shieldDamage);
    target.shield -= shieldDamage;
    target.hull -= hullDamage;
    target.quiet = 0;
    return { type: 'shot', from: user.id, to: target.id, weapon: -1, shots: 1, hits: 1, damage: amount, shieldDamage, hullDamage, destroyed: target.hull <= 0, skill: id };
  }
  function effect(s, user, id, target, now) {
    const a = ABILITIES[id], ev = (to, extra = {}) => ({ type: 'ability', from: user.id, to: to.id, ability: id, ...extra });
    // A status on c for `secs` (the skill's own time by default; talents lengthen a skill's: rules/progress.js).
    const timed = (c, extra, secs = a.time * (user.stats?.skillTime ?? 1)) => {
      c.status = (c.status || []).filter((x) => x.until > now && x.id !== extra.id);
      c.status.push({ until: now + secs, ...extra });
      tick(c, now);
    };
    const mine = s.enemies.includes(user) ? s.enemies : [s.player, ...(s.allies || [])];
    const theirs = s.enemies.includes(user) ? [s.player, ...(s.allies || [])] : s.enemies;
    const flying = (list) => list.filter((c) => c && c.hull > 0);
    switch (id) {
      case 'taunt':
        timed(user, { id: 'taunt' });
        if (perk(user, 'barbed-taunt')) for (const c of flying(theirs)) timed(c, { id: 'exposed', taken: PERKS['barbed-taunt'].taken });
        return [ev(user)];
      case 'fortify': timed(user, { id: 'fortify', taken: a.taken, ...(perk(user, 'counter-battery') ? { damage: PERKS['counter-battery'].damage } : {}) }); return [ev(user)];
      case 'overload': timed(user, { id: 'overload', damage: a.damage }); return [ev(user)];
      case 'mark': timed(target, { id: 'mark', taken: a.taken }); return [ev(target)];
      case 'aegis': return flying(mine).map((c) => { timed(c, { id: 'aegis', taken: a.taken }); return ev(c); });
      case 'bulwark': case 'restore': { const amount = target.stats.shield - target.shield; target.shield = target.stats.shield; return [ev(target, { amount })]; }
      case 'repair-beam': {
        const amount = heal(target, a.hull * (user.stats?.heal ?? 1), perk(user, 'overflow'));
        if (perk(user, 'battle-medic')) timed(target, { id: 'boost', damage: PERKS['battle-medic'].damage }, PERKS['battle-medic'].time);
        return [ev(target, { amount })];
      }
      case 'nanite-field': return flying(mine).map((c) => ev(c, { amount: heal(c, a.hull * (user.stats?.heal ?? 1), perk(user, 'overflow')) }));
      case 'disrupt':
        target.status = (target.status || []).filter((x) => x.until > now);
        target.status.push({ id: 'emp', until: now + a.time }, { id: 'emp-immune', until: now + a.time + a.immune });
        if (target.intent && target.intent.kind === 'heavy') target.intent = { kind: 'volley' }; // the timeline's telegraph (combat/combat.js)
        tick(target, now);
        return [ev(target)];
      case 'salvo': {
        const shot = strike(user, id, target, a.burst);
        if (shot.destroyed && perk(user, 'chain-fire')) (user.cooldowns ||= {}).salvo = now;
        return [shot];
      }
      case 'barrage': return flying(theirs).map((c) => strike(user, id, c, a.burst));
      default: return [];
    }
  }

  // Each step of a fight: the activations that are done land on their targets (if both still fly).
  function resolve(s, now) {
    const out = [];
    for (const c of [s.player, ...(s.allies || []), ...s.enemies]) {
      const k = c && c.casting;
      if (!k || k.at > now) continue;
      c.casting = null;
      if (c.hull <= 0) continue;
      const t = [s.player, ...(s.allies || []), ...s.enemies].find((x) => x && x.id === k.to);
      if (!t || t.hull <= 0) continue;
      out.push(...effect(s, c, k.id, t, now));
    }
    return out;
  }

  function use(user, id, target, now) {
    if (!ready(user, id, target, now)) return null;
    const a = ABILITIES[id];
    (user.cooldowns ||= {})[id] = now + a.cooldown * (a.skill ? user.stats?.cooldown ?? 1 : 1); // talents shorten a skill's (rules/progress.js)
    if (a.skill) { // activation: the effect lands when it's done (resolve)
      user.casting = { id, to: target.id, at: now + (a.cast || 0), cast: a.cast || 0 };
      return { type: 'cast', from: user.id, to: target.id, ability: id, cast: a.cast || 0 };
    }
    const ev = { type: 'ability', from: user.id, to: target.id, ability: id };
    if (id === 'repair-nanites') {
      const before = target.hull;
      target.hull = Math.min(target.stats.hull, target.hull + target.stats.hull * a.hull);
      ev.amount = target.hull - before;
    } else if (id === 'shield-cell') {
      ev.amount = target.stats.shield - target.shield;
      target.shield = target.stats.shield;
    } else {
      target.status = (target.status || []).filter((x) => x.until > now);
      if (id === 'emp-charge') target.status.push({ id: 'emp', until: now + a.time }, { id: 'emp-immune', until: now + a.time + a.immune });
      else target.status.push({ id: 'jam', until: now + a.time, accuracy: a.accuracy });
      tick(target, now);
    }
    return ev;
  }

  return { ABILITIES, PERKS, LIST, FIELD, SKILLS, SKILL_LEVELS, skillsOf, unlocked, casting, ready, use, resolve, tick, disabled, has, fieldReady, fieldUse };
})();

export { Abilities };
