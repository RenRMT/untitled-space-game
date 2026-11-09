// What both combat modes share (rounds: combat/combat.js, real time: combat/combat-realtime.js), and the shape
// every mode takes, so the flight view (game/combat.js) runs any of them the same way and a new mode is a
// new module rather than new branches in game/combat.js.
//
// Shared:
//   CombatCore.config                  hit chance limits, and the flight view's ranges: where Attack
//                                      is offered, where pirates attack, who joins a fight
//   CombatCore.combatant(id, name, stats, hull = full) -> { id, name, stats, hull, shield }
//   CombatCore.applyDamage(target, amount) -> { shieldDamage, hullDamage }   shields first; none to a
//                                      target marked `invulnerable` (god mode: ?dev, game/combat.js)
//   CombatCore.limitHit(p)             a hit chance kept within [minHit, maxHit]
//   CombatCore.alive(s)                the enemies still flying
//   CombatCore.allies(s)               the squad members (rules/squad.js) still flying beside the player
//   CombatCore.aim(rng, s) -> id       whom an enemy shoots at: the player, or now and then an ally
//   CombatCore.aimAt(s, e)             that combatant while it flies, else the player
//   CombatCore.intents(s) -> [{ id, target, lock }]   each enemy's target and lock (0..1; 1 in rounds);
//                                      passive targets (rocks) have none
//   CombatCore.loot(galaxySeed, key, role, tier) -> [{ kind, seed }]   what a destroyed ship leaves
//   CombatCore.schematic(galaxySeed, key, role, tier) -> equipment id | null   a schematic recovered
//                                      from a pirate's computer: the gear it unlocks for purchase
//
// A mode (each module's `mode`):
//   id, flying               ships keep flying (both modes now), or are held in place
//   start(rng, player, enemies, { target, ambushed, allies }) -> s
//       player, enemies, allies: { id, name, stats, hull?, body: { x, y, vx, vy, angle, radius } }
//       target: the enemy attacked; ambushed: the pirates attacked first; allies: squad members
//   setOrders(s, id, { target, keep, station })   what an ally does now (game/squad.js
//                                      decides, from its logic program): fire on `target` (an enemy
//                                      id; keep: from as far off as its guns reach, in real time),
//                                      or with none fly to `station` (in real time) and hold fire
//   step(s, dt, pilot) -> events       pilot: the player ship's pose this step
//   setFocus(s, id)                    the player picks a target
//   join?(s, enemy)                    another ship joins the fight under way
//   lock(s) -> 0..1                    how far the lock on the target has come (1: locked)
//   gauge?(s, c) -> { gauge, eta, holding, heavy, target }   in turns: a combatant's action gauge
//   log(s, events, lines) -> lines     the fight log's last lines after these events
//   look                               how its events are shown (game/combat.js): seconds a beam and a
//                                      shield flash last (beam, shield), the wait before hits
//                                      show (after) and before a destroyed ship blows up
//                                      (finish), sparks(ev) per hull hit, whether hits on a ship
//                                      add up into one number (sum), whether the guns' field
//                                      of fire is shown (arcs), and the action gauges (gauges)
// Events: { type: 'shot', from, to, shots, hits, damage, shieldDamage, hullDamage, destroyed,
//   delay?, heavy? } (delay: seconds before it shows), { type: 'target', id }, in turns
//   { type: 'breach', id, cancelled }, and in real time { type: 'locked' | 'lost-lock', id }. s.player, s.enemies, s.allies and s.focus as
//   named; s.over becomes 'won', 'lost' or 'fled' when the fight ends (an ally shot down drops out:
//   only the player's ship decides the outcome).
// ES module (`CombatCore`); also runs in Node (the tests).

import { MathUtil } from '../core/math.js';
import { nextSeed, seeded } from '../core/rng.js';
import { Abilities } from '../rules/abilities.js';
import { Goods } from '../rules/goods.js';
import { Loadout } from '../rules/loadout.js';

const CombatCore = (() => {
  const G = Goods;
  const { clamp } = MathUtil;

  const config = {
    minHit: 0.1, // a hit chance never drops below this ...
    maxHit: 0.95, // ... or rises above this
    engageRange: 900, // world units from the target's edge within which Attack is offered
    aggroRange: 600, // pirates attack a ship this close
    groupRange: 1500, // pirates this close to the one engaged join the fight
  };

  // A ship in a fight. stats: Loadout.stats(); hull: current hull points (defaults to full).
  const combatant = (id, name, stats, hull = stats.hull) => ({ id, name, stats, hull: clamp(hull, 0, stats.hull), shield: stats.shield });

  // Damage hits the shields first, then the hull. An invulnerable ship (god mode) takes none.
  // stats.taken: the share of it that gets through (fortify, a mark: rules/abilities.js).
  function applyDamage(t, amount) {
    if (t.invulnerable) return { shieldDamage: 0, hullDamage: 0 };
    if (t.stats && t.stats.taken !== undefined && t.stats.taken !== 1) amount = Math.round(amount * t.stats.taken * 10) / 10;
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
  // A Tank on your side (rules/classes.js: cls 'tank') draws fire: half the enemies go for it.
  function aim(rng, s) {
    const list = allies(s);
    const tanks = [s.player, ...list].filter((c) => c.cls === 'tank');
    if (tanks.length && rng() < 0.5) return tanks[Math.floor(rng() * tanks.length)].id;
    if (!list.length || rng() >= list.length / (list.length + 2)) return 'player';
    return list[Math.floor(rng() * list.length)].id;
  }
  // Whom it shoots at: a ship taunting it (rules/abilities.js taunt) first, else the one it picked.
  function aimAt(s, e) {
    if (!e.passive) {
      const taunting = [s.player, ...allies(s)].find((c) => c.hull > 0 && Abilities.has(c, 'taunt', s.t));
      if (taunting) return taunting;
    }
    return (e.aim !== 'player' && allies(s).find((a) => a.id === e.aim)) || s.player;
  }
  // What each enemy is about to do, for the flight view to telegraph: whom it aims at, how far its
  // lock has come (real time), and in turns its gauge (0..1) and next action ('volley' | 'heavy').
  const intents = (s) => alive(s).filter((e) => !e.passive).map((e) => ({
    id: e.id, target: aimAt(s, e).id,
    lock: e.gauge !== undefined ? 1 : e.lockT === undefined ? 1 : Math.min(1, e.lockT / Math.max(1e-6, e.stats.lockTime)),
    ...(e.gauge !== undefined ? { gauge: e.gauge, kind: e.intent ? e.intent.kind : 'volley' } : {}),
  }));

  // What a destroyed ship leaves floating: [{ kind, seed }] (rules/goods.js types). Seeded by the system
  // and the ship.
  // - Fighters (pirates) often drop some of the cargo they took: trade goods, the better of two from
  //   tier 3 up.
  // - Freighters spill trade goods.
  // Salvaged components no longer drop in the main game: nothing there uses them since research
  // and industry moved to the idle game.
  const GOODS = G.categories('trade');
  const chance = { cargo: 0.45 };
  function loot(galaxySeed, key, role, tier = 1) {
    const r = seeded(galaxySeed, key, 0x1007);
    const seed = () => nextSeed(r);
    const out = [];
    // A trade good; well-armed pirates keep the better of two.
    const good = () => {
      const pick = () => G.pick(r, GOODS[Math.floor(r() * GOODS.length)], (t) => !t.surface);
      let kind = pick();
      if (tier >= 3) { const other = pick(); if (G.type(other).price > G.type(kind).price) kind = other; }
      return { kind, seed: seed() };
    };
    if (role === 'freighter') {
      const n = 1 + Math.floor(r() * 2);
      for (let i = 0; i < n; i++) out.push(good());
      return out;
    }
    if (r() < chance.cargo) for (let i = 0, n = 1 + Math.floor(r() * 2); i < n; i++) out.push(good());
    return out;
  }

  // Now and then a pirate's computer holds a schematic: a piece of player equipment (rules/loadout.js)
  // of its own tier (or, a quarter of the time, one better), which every station then sells to you.
  // Pirates of tier 2 up only; the only way to Mk V gear.
  const SCHEMATIC = [0, 0, 0.08, 0.12, 0.16];
  function schematic(galaxySeed, key, role, tier = 1) {
    if (role === 'freighter' || !(SCHEMATIC[tier] > 0)) return null;
    const r = seeded(galaxySeed, key, 0x5c4e);
    if (r() >= SCHEMATIC[tier]) return null;
    const t = Math.min(5, tier + (r() < 0.25 ? 1 : 0));
    const ids = Object.keys(Loadout.EQUIPMENT).filter((id) => !Loadout.EQUIPMENT[id].npc && Loadout.EQUIPMENT[id].tier === t);
    return ids.length ? ids[Math.floor(r() * ids.length)] : null;
  }

  // What an ally does now, in either mode ({ target, keep } or { station }: the modes' setOrders).
  function setOrders(s, id, order) {
    const a = s.allies.find((x) => x.id === id);
    if (a) a.order = order || {};
  }

  return { config, combatant, applyDamage, limitHit, alive, allies, aim, aimAt, intents, loot, schematic, setOrders };
})();

export { CombatCore };
