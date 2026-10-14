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
// The flight view (game.js) runs it as a combat mode (combat-core.js says what a mode offers) and
// draws it; this module only does the numbers.
// Works as a classic browser script (global `Combat`) and as a Node module.

const Combat = (() => {
  const core = typeof require === 'function' ? require('./combat-core.js') : CombatCore;
  const { combatant, applyDamage, limitHit, alive } = core;
  const { clamp } = typeof require === 'function' ? require('./math.js') : MathUtil;

  const config = {
    round: 1.5, // seconds per round
    firstRound: 0.8, // ... and before the first one, which comes quickly
    stagger: 0.14, // seconds between one volley and the next as a round is shown
    fleeBase: 0.6, // chance to get away from an equally fast enemy
    fleePerSpeed: 1 / 800, // + this per unit of top speed over the fastest enemy
    fleeMin: 0.2,
    fleeMax: 0.9,
  };

  const hitChance = (attacker, target) => limitHit(attacker.stats.accuracy - target.stats.evasion);
  const shotsPerRound = (weapon) => Math.max(1, Math.round(weapon.fireRate * config.round));

  // A new fight: the player against one or more enemies, focusing on `focus` (an enemy id).
  // timer: seconds until the next round, as a combat mode runs them.
  function create(rng, player, enemies, focus = enemies[0] && enemies[0].id) {
    return { rng, player, enemies, focus, round: 0, fleeing: false, over: null, timer: config.firstRound };
  }

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
    const { shieldDamage, hullDamage } = applyDamage(target, damage);
    return {
      type: 'shot', from: attacker.id, to: target.id, weapon: weapon.name, shots, hits, damage, shieldDamage, hullDamage,
      destroyed: target.hull <= 0,
    };
  }

  function fleeChance(s) {
    const fastest = Math.max(0, ...alive(s).map((e) => e.stats.maxSpeed));
    return clamp(config.fleeBase + (s.player.stats.maxSpeed - fastest) * config.fleePerSpeed, config.fleeMin, config.fleeMax);
  }

  // Resolve one round. Returns its events: volleys ({ type: 'shot', from, to, shots, hits, damage,
  // destroyed, ... }) and, when the player tried to flee, { type: 'flee', ok }. Sets s.over to
  // 'won', 'lost' or 'fled' when the fight ends.
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
      events.push({ type: 'flee', ok });
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

  // ---------- As a combat mode (combat-core.js) ----------

  // The panel's two lines after a round: your last volley and theirs added up (or that you're
  // trying to get away), then whether you got away.
  function log(s, events, lines) {
    if (!events.length) return lines;
    const name = (id) => (s.enemies.find((e) => e.id === id) || {}).name || 'the enemy';
    let you = null;
    const them = { shots: 0, hits: 0, damage: 0, n: 0 }, extra = [];
    for (const ev of events) {
      if (ev.type === 'flee') extra.push(ev.ok ? 'You got away.' : 'Couldn\'t get away!');
      else if (ev.from === 'player') you = `You hit ${name(ev.to)} ${ev.hits}/${ev.shots} for ${ev.damage}${ev.destroyed ? ' · destroyed' : ''}`;
      else Object.assign(them, { shots: them.shots + ev.shots, hits: them.hits + ev.hits, damage: them.damage + ev.damage, n: them.n + 1 });
    }
    const out = [];
    if (you) out.push(you);
    else if (s.round > 0 && !extra.length) out.push('Trying to get away…');
    if (them.n) out.push(`${them.n > 1 ? 'They hit' : 'It hit'} you ${them.hits}/${them.shots} for ${them.damage}`);
    return [...out, ...extra].slice(-2);
  }

  // Ships are held in place; every round's volleys are shown one after another, slowly.
  const mode = {
    id: 'rounds',
    flying: false,
    look: { beam: 0.4, shield: 0.35, after: 0.08, finish: 0.2, sparks: (ev) => 3 + ev.hits, sum: false, arcs: false },
    start: (rng, player, enemies, { target }) => create(rng, combatant(player.id, player.name, player.stats, player.hull),
      enemies.map((e) => combatant(e.id, e.name, e.stats, e.hull)), target),
    step(s, dt) {
      if (s.over) return [];
      s.timer -= dt;
      if (s.timer > 0) return [];
      s.timer += config.round;
      const events = round(s);
      let i = 0;
      for (const ev of events) if (ev.type === 'shot') ev.delay = config.stagger * i++;
      return events;
    },
    setFocus,
    press(s, id) { if (id === 'flee') s.fleeing = true; },
    lock: () => 1,
    panel: (s) => ({
      title: `Combat · round ${s.round + 1}`, progress: 1 - s.timer / config.round,
      button: { id: 'flee', label: s.fleeing ? 'Fleeing…' : 'Flee', enabled: !s.fleeing },
    }),
    log,
  };

  return { config, combatant, hitChance, shotsPerRound, create, setFocus, round, fleeChance, simulate, alive, mode };
})();

if (typeof module !== 'undefined') module.exports = Combat;
