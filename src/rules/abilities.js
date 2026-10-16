// Abilities: consumables made by industry (rules/recipes.js) and spent in a fight, one charge a use,
// by the player (the combat panel) or a squad member (a `use` line, rules/logic.js). Each has a
// cooldown per ship, and is used on a friend (yourself, the leader, an ally) or on an enemy:
// - repair nanites: hull back, up to its maximum,
// - shield cell: shields back in full,
// - EMP charge: the target's guns go quiet for a few seconds, and it can't be hit by another for a
//   while after (so a squad can't keep one locked down),
// - jammer pod: the target's accuracy drops for a few seconds.
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
// ES module (`Abilities`); also runs in Node (the tests).

const Abilities = (() => {
  const ABILITIES = {
    'repair-nanites': { name: 'Repair nanites', code: 'REP', on: 'friend', cooldown: 12, price: 700, hull: 0.3, note: 'repairs 30% of a ship\'s hull' },
    'shield-cell': { name: 'Shield cell', code: 'SHC', on: 'friend', cooldown: 10, price: 1210, note: 'restores a ship\'s shields in full' },
    'emp-charge': { name: 'EMP charge', code: 'EMP', on: 'enemy', cooldown: 15, price: 1350, time: 4, immune: 8, note: 'silences a ship\'s guns for 4 s; it shrugs off another for 8 s more' },
    'jammer-pod': { name: 'Jammer pod', code: 'JAM', on: 'enemy', cooldown: 10, price: 400, time: 6, accuracy: -0.25, note: 'cuts a ship\'s accuracy by 25% for 6 s' },
  };
  for (const [id, a] of Object.entries(ABILITIES)) a.id = id;
  const LIST = Object.values(ABILITIES);

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
    return true;
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

  return { ABILITIES, LIST, ready, use, tick, disabled, has };
})();

export { Abilities };
