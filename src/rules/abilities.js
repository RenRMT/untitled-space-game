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
// Class skills (rules/classes.js: three for each of Tank, DPS and Healer) are abilities too, with no
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
// Timed effects are statuses on the combatant ({ id, until, ... }): `tick` keeps its stats as its
// base stats with what's still running applied, so both combat modes (combat/combat.js,
// combat/combat-realtime.js) see them without special cases, beyond holding fire while disabled.
// Times are seconds of fight time (s.t in either mode).
//
//   Abilities.ABILITIES[id]   { id, name, code, on: 'friend' | 'enemy', cooldown (s), price, note, ... }
//   Abilities.LIST                         the consumables (not the skills)
//   Abilities.SKILLS                       the class skills; Abilities.skillsOf(cls) -> their ids
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
  };
  for (const [id, a] of Object.entries(ABILITIES)) a.id = id;
  for (const id of ['repair-nanites', 'shield-cell', 'coolant-flush', 'rad-purge', 'fuel-canister', 'seismic-charge']) ABILITIES[id].field = true;
  const ALL = Object.values(ABILITIES);
  const LIST = ALL.filter((a) => !a.skill); // the consumables
  const FIELD = LIST.filter((a) => a.field);
  const SKILLS = ALL.filter((a) => a.skill);
  const skillsOf = (cls) => SKILLS.filter((a) => a.cls === cls).map((a) => a.id);
  const casting = (c) => c?.casting || null;

  const statusOf = (c, id, now) => (c.status || []).find((x) => x.id === id && x.until > now);
  const has = (c, id, now) => !!statusOf(c, id, now);
  const disabled = (c, now) => has(c, 'emp', now);

  // Off cooldown, the target still flying, and the use would do something.
  function ready(user, id, target, now) {
    const a = ABILITIES[id];
    if (!a || !user || !target || user.hull <= 0 || target.hull <= 0) return false;
    if ((user.cooldowns?.[id] ?? -Infinity) > now) return false;
    if (a.skill) {
      if (user.casting) return false; // one activation at a time
      switch (id) {
        case 'taunt': case 'fortify': case 'overload': return !has(user, id, now);
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
  const heal = (t, share) => { const before = t.hull; t.hull = Math.min(t.stats.hull, t.hull + t.stats.hull * share); return t.hull - before; };
  function effect(s, user, id, target, now) {
    const a = ABILITIES[id], ev = (to, extra = {}) => ({ type: 'ability', from: user.id, to: to.id, ability: id, ...extra });
    const timed = (c, extra) => {
      c.status = (c.status || []).filter((x) => x.until > now && x.id !== extra.id);
      c.status.push({ until: now + a.time, ...extra });
      tick(c, now);
    };
    switch (id) {
      case 'taunt': timed(user, { id: 'taunt' }); return [ev(user)];
      case 'fortify': timed(user, { id: 'fortify', taken: a.taken }); return [ev(user)];
      case 'overload': timed(user, { id: 'overload', damage: a.damage }); return [ev(user)];
      case 'mark': timed(target, { id: 'mark', taken: a.taken }); return [ev(target)];
      case 'bulwark': case 'restore': { const amount = target.stats.shield - target.shield; target.shield = target.stats.shield; return [ev(target, { amount })]; }
      case 'repair-beam': return [ev(target, { amount: heal(target, a.hull) })];
      case 'nanite-field': {
        const side = s.enemies.includes(user) ? s.enemies : [s.player, ...(s.allies || [])];
        return side.filter((c) => c.hull > 0).map((c) => ev(c, { amount: heal(c, a.hull) }));
      }
      case 'salvo': {
        const base = user.base || user.stats, mult = (user.stats.firepower || 0) / Math.max(1e-6, base.firepower || 1);
        const amount = Math.round((base.firepower || 0) * a.burst * (mult || 1) * (target.stats.taken ?? 1));
        if (target.invulnerable) return [{ type: 'shot', from: user.id, to: target.id, weapon: -1, shots: 1, hits: 1, damage: 0, shieldDamage: 0, hullDamage: 0, destroyed: false, skill: id }];
        const shieldDamage = Math.min(target.shield, amount), hullDamage = Math.min(target.hull, amount - shieldDamage);
        target.shield -= shieldDamage;
        target.hull -= hullDamage;
        target.quiet = 0;
        return [{ type: 'shot', from: user.id, to: target.id, weapon: -1, shots: 1, hits: 1, damage: amount, shieldDamage, hullDamage, destroyed: target.hull <= 0, skill: id }];
      }
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
    (user.cooldowns ||= {})[id] = now + a.cooldown;
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

  return { ABILITIES, LIST, FIELD, SKILLS, skillsOf, casting, ready, use, resolve, tick, disabled, has, fieldReady, fieldUse };
})();

export { Abilities };
