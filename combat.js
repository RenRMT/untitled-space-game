'use strict';

// Round-based combat, resolved from the ships' stats (loadout.js). No aiming or flying: once a
// fight starts, every `round` seconds each ship's weapons fire on their own.
// - Order: highest initiative (scanner) fires first; the player wins ties. A ship destroyed
//   before its turn doesn't fire.
// - Each weapon fires round(fireRate × round) shots. Each hits with chance
//   accuracy (computer) − evasion (target's engine), kept within [minHit, maxHit].
// - Damage hits shields first, then the hull. Shields recharge at the end of every round.
// - The player fires at the focused enemy (and moves on to the next when it dies); every enemy
//   fires at the player.
// - Fleeing: from then on the player stops firing, and at the end of each round gets away with a
//   chance set by top speed against the fastest enemy.
// The flight view (game.js) runs the rounds and draws them; this module only does the numbers.
// Works as a classic browser script (global `Combat`) and as a Node module.

const Combat = (() => {
  const { hashInt, mulberry32, seedToInt, weightedPick } = typeof require === 'function' ? require('./rng.js') : globalThis;

  const config = {
    round: 1.5, // seconds per round
    minHit: 0.1, // hit chance never drops below this ...
    maxHit: 0.95, // ... or rises above this
    fleeBase: 0.6, // chance to get away from an equally fast enemy
    fleePerSpeed: 1 / 800, // + this per unit of top speed over the fastest enemy
    fleeMin: 0.2,
    fleeMax: 0.9,
    engageRange: 900, // world units from the target's edge within which Attack is offered
    aggroRange: 600, // pirates attack a ship this close
    groupRange: 1500, // pirates this close to the one engaged join the fight
  };

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  // A ship in a fight. stats: Loadout.stats(); hull: current hull points (defaults to full).
  function combatant(id, name, stats, hull = stats.hull) {
    return { id, name, stats, hull: clamp(hull, 0, stats.hull), shield: stats.shield };
  }

  const hitChance = (attacker, target) => clamp(attacker.stats.accuracy - target.stats.evasion, config.minHit, config.maxHit);
  const shotsPerRound = (weapon) => Math.max(1, Math.round(weapon.fireRate * config.round));

  // A new fight: the player against one or more enemies, focusing on `focus` (an enemy id).
  function create(rng, player, enemies, focus = enemies[0] && enemies[0].id) {
    return { rng, player, enemies, focus, round: 0, fleeing: false, over: null };
  }

  const alive = (s) => s.enemies.filter((e) => e.hull > 0);

  function setFocus(s, id) {
    if (s.enemies.some((e) => e.id === id && e.hull > 0)) s.focus = id;
  }

  // One weapon firing at a target: rolls each shot and applies the damage.
  function volley(rng, attacker, weapon, target) {
    const shots = shotsPerRound(weapon);
    const p = hitChance(attacker, target);
    let hits = 0;
    for (let i = 0; i < shots; i++) if (rng() < p) hits++;
    const damage = hits * weapon.damage;
    const shieldDamage = Math.min(target.shield, damage);
    target.shield -= shieldDamage;
    const hullDamage = Math.min(target.hull, damage - shieldDamage);
    target.hull -= hullDamage;
    return {
      from: attacker.id, to: target.id, weapon: weapon.name, shots, hits, damage, shieldDamage, hullDamage,
      destroyed: target.hull <= 0,
    };
  }

  function fleeChance(s) {
    const fastest = Math.max(0, ...alive(s).map((e) => e.stats.maxSpeed));
    return clamp(config.fleeBase + (s.player.stats.maxSpeed - fastest) * config.fleePerSpeed, config.fleeMin, config.fleeMax);
  }

  // Resolve one round. Returns its events: volleys ({ from, to, hits, damage, destroyed, ... })
  // and, when the player tried to flee, { flee: true | false }. Sets s.over to 'won', 'lost' or
  // 'fled' when the fight ends.
  function round(s) {
    if (s.over) return [];
    s.round++;
    const events = [];
    const actors = [s.player, ...alive(s)].sort((a, b) => b.stats.initiative - a.stats.initiative || (a === s.player ? -1 : b === s.player ? 1 : 0));
    for (const a of actors) {
      if (a.hull <= 0 || s.player.hull <= 0) continue;
      if (a === s.player) {
        if (s.fleeing) continue;
        for (const w of a.stats.weapons) {
          if (!alive(s).some((e) => e.id === s.focus)) setFocus(s, alive(s)[0] && alive(s)[0].id);
          const t = s.enemies.find((e) => e.id === s.focus && e.hull > 0);
          if (!t) break;
          events.push(volley(s.rng, a, w, t));
        }
      } else {
        for (const w of a.stats.weapons) events.push(volley(s.rng, a, w, s.player));
      }
    }
    for (const c of [s.player, ...s.enemies]) {
      if (c.hull > 0) c.shield = Math.min(c.stats.shield, c.shield + c.stats.shieldRecharge * config.round);
    }
    if (!alive(s).some((e) => e.id === s.focus) && alive(s).length) s.focus = alive(s)[0].id;
    if (s.player.hull <= 0) s.over = 'lost';
    else if (!alive(s).length) s.over = 'won';
    else if (s.fleeing) { // keeps trying every round until it works
      const ok = s.rng() < fleeChance(s);
      events.push({ flee: ok });
      if (ok) s.over = 'fled';
    }
    return events;
  }

  // Fight to the end without fleeing (for tests and balancing). Returns the final state.
  function simulate(rng, player, enemies, maxRounds = 500) {
    const s = create(rng, player, enemies);
    while (!s.over && s.round < maxRounds) round(s);
    return s;
  }

  // What a destroyed ship leaves floating: [{ kind, seed }] (art/items.js kinds). Fighters may
  // drop a salvaged component; freighters spill trade goods. Seeded by the galaxy and the ship.
  const SALVAGE = [['hull', 3], ['weapon', 2], ['drive', 2], ['computer', 1]];
  const GOODS = ['metal', 'mineral', 'gas', 'synthetic', 'crates', 'barrels', 'tubes', 'fabrics', 'perishables'];
  function loot(galaxySeed, key, role) {
    const r = mulberry32(hashInt(seedToInt(galaxySeed), seedToInt(key), 0x1007));
    const seed = () => Math.floor(r() * 4294967295);
    const out = [];
    if (role === 'freighter') {
      const n = 1 + Math.floor(r() * 2);
      for (let i = 0; i < n; i++) out.push({ kind: GOODS[Math.floor(r() * GOODS.length)], seed: seed() });
      if (r() < 0.3) out.push({ kind: weightedPick(SALVAGE, r()), seed: seed() });
    } else if (r() < 0.6) {
      out.push({ kind: weightedPick(SALVAGE, r()), seed: seed() });
    }
    return out;
  }

  return { config, combatant, hitChance, shotsPerRound, create, setFocus, round, fleeChance, simulate, loot, alive };
})();

if (typeof module !== 'undefined') module.exports = Combat;
