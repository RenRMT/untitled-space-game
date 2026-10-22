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
// Timed effects are statuses on the combatant ({ id, until, ... }): `tick` keeps its stats as its
// base stats with what's still running applied, so both combat modes (combat/combat.js,
// combat/combat-realtime.js) see them without special cases, beyond holding fire while disabled.
// Times are seconds of fight time (s.t in either mode).
//
//   Abilities.ABILITIES[id]   { id, name, code, on: 'friend' | 'enemy', cooldown (s), price, note, ... }
//   Abilities.LIST
//   Abilities.ready(user, id, target, now) -> bool   off cooldown, and worth using on that target now
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
  };
  for (const [id, a] of Object.entries(ABILITIES)) a.id = id;
  for (const id of ['repair-nanites', 'shield-cell', 'coolant-flush', 'rad-purge', 'fuel-canister', 'seismic-charge']) ABILITIES[id].field = true;
  const LIST = Object.values(ABILITIES);
  const FIELD = LIST.filter((a) => a.field);

  const statusOf = (c, id, now) => (c.status || []).find((x) => x.id === id && x.until > now);
  const has = (c, id, now) => !!statusOf(c, id, now);
  const disabled = (c, now) => has(c, 'emp', now);

  // Off cooldown, the target still flying, and the use would do something.
  function ready(user, id, target, now) {
    const a = ABILITIES[id];
    if (!a || !user || !target || user.hull <= 0 || target.hull <= 0) return false;
    if ((user.cooldowns?.[id] ?? -Infinity) > now) return false;
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

  function tick(c, now) {
    if (!c.status?.length) return;
    c.base ||= c.stats;
    c.status = c.status.filter((x) => x.until > now);
    const jam = statusOf(c, 'jam', now);
    c.stats = jam ? { ...c.base, accuracy: Math.max(0, c.base.accuracy + jam.accuracy) } : c.base;
  }

  function use(user, id, target, now) {
    if (!ready(user, id, target, now)) return null;
    const a = ABILITIES[id];
    (user.cooldowns ||= {})[id] = now + a.cooldown;
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

  return { ABILITIES, LIST, FIELD, ready, use, tick, disabled, has, fieldReady, fieldUse };
})();

export { Abilities };
