'use strict';

// What both combat modes share (rounds: combat.js, real time: combat-realtime.js), and the shape
// every mode takes, so the flight view (game.js) runs any of them the same way and a new mode is a
// new module rather than new branches in game.js.
//
// Shared:
//   CombatCore.config                  hit chance limits, and the flight view's ranges: where Attack
//                                      is offered, where pirates attack, who joins a fight
//   CombatCore.combatant(id, name, stats, hull = full) -> { id, name, stats, hull, shield }
//   CombatCore.applyDamage(target, amount) -> { shieldDamage, hullDamage }   shields first
//   CombatCore.limitHit(p)             a hit chance kept within [minHit, maxHit]
//   CombatCore.alive(s)                the enemies still flying
//   CombatCore.allies(s)               the squad members (squad.js) still flying beside the player
//   CombatCore.aim(rng, s) -> id       whom an enemy shoots at: the player, or now and then an ally
//   CombatCore.aimAt(s, e)             that combatant while it flies, else the player
//   CombatCore.loot(galaxySeed, key, role, tier) -> [{ kind, seed }]   what a destroyed ship leaves
//
// A mode (each module's `mode`):
//   id, flying               ships keep flying (real time), or are held in place (rounds)
//   start(rng, player, enemies, { target, ambushed, allies }) -> s
//       player, enemies, allies: { id, name, stats, hull?, body: { x, y, vx, vy, angle, radius } }
//       target: the enemy attacked; ambushed: the pirates attacked first; allies: squad members
//   setOrders(s, id, { target, station })   what an ally does now (game.js decides, from its
//                                      logic modules): fire on `target` (an enemy id), or with
//                                      none hold `station` (its place in formation, in real time)
//   step(s, dt, pilot) -> events       pilot: the player ship's pose this step
//   setFocus(s, id)                    the player picks a target
//   press?(s, id)                      a combat panel button (Flee)
//   join?(s, enemy)                    another ship joins the fight under way
//   lock(s) -> 0..1                    how far the lock on the target has come (1: locked)
//   panel(s) -> { title, button, bar?, progress }   the combat panel while the fight runs
//   log(s, events, lines) -> lines     the panel's last lines after these events
//   look                               how its events are shown (game.js): seconds a beam and a
//                                      shield flash last (beam, shield), the wait before hits
//                                      show (after) and before a destroyed ship blows up
//                                      (finish), sparks(ev) per hull hit, whether hits on a ship
//                                      add up into one number (sum), and whether the guns' field
//                                      of fire is shown (arcs)
// Events: { type: 'shot', from, to, shots, hits, damage, shieldDamage, hullDamage, destroyed,
//   delay? } (delay: seconds before it shows), { type: 'flee', ok }, and in real time
//   { type: 'target' | 'locked' | 'lost-lock', id }. s.player, s.enemies, s.allies and s.focus as
//   named; s.over becomes 'won', 'lost' or 'fled' when the fight ends (an ally shot down drops out:
//   only the player's ship decides the outcome).
// Works as a classic browser script (global `CombatCore`) and as a Node module.

const CombatCore = (() => {
  const isNode = typeof require === 'function';
  const { hashInt, mulberry32, seedToInt, weightedPick } = isNode ? require('./rng.js') : globalThis;
  const G = isNode ? require('./goods.js') : Goods;
  const Sec = isNode ? require('./security.js') : Security;
  const { clamp } = isNode ? require('./math.js') : MathUtil;

  const config = {
    minHit: 0.1, // a hit chance never drops below this ...
    maxHit: 0.95, // ... or rises above this
    engageRange: 900, // world units from the target's edge within which Attack is offered
    aggroRange: 600, // pirates attack a ship this close
    groupRange: 1500, // pirates this close to the one engaged join the fight
  };

  // A ship in a fight. stats: Loadout.stats(); hull: current hull points (defaults to full).
  const combatant = (id, name, stats, hull = stats.hull) => ({ id, name, stats, hull: clamp(hull, 0, stats.hull), shield: stats.shield });

  // Damage hits the shields first, then the hull.
  function applyDamage(t, amount) {
    const shieldDamage = Math.min(t.shield, amount);
    t.shield -= shieldDamage;
    const hullDamage = Math.min(t.hull, amount - shieldDamage);
    t.hull -= hullDamage;
    return { shieldDamage, hullDamage };
  }

  const limitHit = (p) => clamp(p, config.minHit, config.maxHit);
  const alive = (s) => s.enemies.filter((e) => e.hull > 0);
  const allies = (s) => (s.allies || []).filter((a) => a.hull > 0);

  // An enemy picks whom it shoots at when the fight starts or it joins: one of the allies with a
  // chance that grows with their number (one ally: a third), else the player.
  function aim(rng, s) {
    const list = allies(s);
    if (!list.length || rng() >= list.length / (list.length + 2)) return 'player';
    return list[Math.floor(rng() * list.length)].id;
  }
  const aimAt = (s, e) => (e.aim !== 'player' && allies(s).find((a) => a.id === e.aim)) || s.player;

  // What a destroyed ship leaves floating: [{ kind, seed }] (goods.js types). Seeded by the system
  // and the ship.
  // - Fighters (pirates) usually drop a salvaged component, sometimes two, at a tier set by their
  //   own gear tier (security.js: better-armed pirates in more dangerous space carry better
  //   components), and often some of the cargo they took: trade goods, rarer ones from tier 3 up.
  // - Freighters spill trade goods, and now and then a component.
  // Computer components research both computers and scanners (research.js), so they turn up as
  // often as hull and weapon components.
  const SALVAGE = [['hull', 3], ['weapon', 3], ['drive', 2], ['computer', 3]];
  const GOODS = G.categories('trade');
  const chance = { component: 0.85, second: 0.35, cargo: 0.45 };
  function loot(galaxySeed, key, role, tier = 1) {
    const r = mulberry32(hashInt(seedToInt(galaxySeed), seedToInt(key), 0x1007));
    const seed = () => Math.floor(r() * 4294967295);
    const out = [];
    const component = () => ({ kind: G.component(weightedPick(SALVAGE, r()), Sec.componentTier(r, tier)), seed: seed() });
    // A trade good; well-armed pirates keep the better of two.
    const good = () => {
      const pick = () => G.pick(r, GOODS[Math.floor(r() * GOODS.length)]);
      let kind = pick();
      if (tier >= 3) { const other = pick(); if (G.type(other).price > G.type(kind).price) kind = other; }
      return { kind, seed: seed() };
    };
    if (role === 'freighter') {
      const n = 1 + Math.floor(r() * 2);
      for (let i = 0; i < n; i++) out.push(good());
      if (r() < 0.3) out.push(component());
      return out;
    }
    if (r() < chance.component) {
      out.push(component());
      if (r() < chance.second) out.push(component());
    }
    if (r() < chance.cargo) for (let i = 0, n = 1 + Math.floor(r() * 2); i < n; i++) out.push(good());
    return out;
  }

  return { config, combatant, applyDamage, limitHit, alive, allies, aim, aimAt, loot };
})();

if (typeof module !== 'undefined') module.exports = CombatCore;
