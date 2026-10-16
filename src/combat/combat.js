// Round-based combat, resolved from the ships' stats (rules/loadout.js). No aiming or flying: once a
// fight starts, every `round` seconds each ship's weapons fire on their own.
// - Order: highest initiative (scanner) fires first; the player wins ties, then the allies. A
//   ship destroyed before its turn doesn't fire.
// - Each weapon fires round(fireRate × round) shots. Each hits with chance
//   accuracy (computer) − evasion (target's engine), kept within [minHit, maxHit].
// - Damage hits shields first, then the hull. Shields recharge at the end of every round.
// - The player fires at the focused enemy (and moves on to the next when it dies). Allies (squad
//   members) fire at the enemy their orders name, if any. Every enemy fires at the player, or at
//   the ally it picked (CombatCore.aim) while that one is still flying.
// - Fleeing: from then on the player stops firing, and at the end of each round gets away with a
//   chance set by top speed against the fastest enemy.
// The flight view (game/combat.js) runs it as a combat mode (combat/combat-core.js says what a mode offers) and
// draws it; this module only does the numbers.
// ES module (`Combat`); also runs in Node (the tests).

import { CombatCore } from './combat-core.js';
import { MathUtil } from '../core/math.js';

const Combat = (() => {
  const core = CombatCore;
  const { combatant, applyDamage, limitHit, alive, allies, aim, aimAt } = core;
  const { clamp } = MathUtil;

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
  // allyList: squad members, each with its orders ({ target }: setOrders).
  function create(rng, player, enemies, focus = enemies[0] && enemies[0].id, allyList = []) {
    const s = { rng, player, enemies, allies: allyList, focus, round: 0, fleeing: false, over: null, timer: config.firstRound };
    for (const a of allyList) a.order = a.order || {};
    for (const e of enemies) e.aim = aim(rng, s);
    return s;
  }

  const { setOrders } = core; // combat/combat-core.js

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
    const rank = (c) => (c === s.player ? 0 : s.allies.includes(c) ? 1 : 2); // who wins ties
    const actors = [s.player, ...allies(s), ...alive(s)].sort((a, b) => b.stats.initiative - a.stats.initiative || rank(a) - rank(b));
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
      } else if (s.allies.includes(a)) {
        for (const w of a.stats.weapons) {
          const t = s.enemies.find((e) => e.id === a.order.target && e.hull > 0);
          if (!t) break;
          events.push(volley(s.rng, a, w, t));
        }
      } else {
        for (const w of a.stats.weapons) {
          const t = aimAt(s, a);
          events.push(volley(s.rng, a, w, t));
          if (t === s.player && t.hull <= 0) break;
        }
      }
    }
    for (const c of [s.player, ...s.allies, ...s.enemies]) {
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

  // ---------- As a combat mode (combat/combat-core.js) ----------

  // The panel's lines after a round: your last volley, your allies' (added up), theirs on you
  // added up (or that you're trying to get away), then whether you got away. An ally shot down
  // says so.
  function log(s, events, lines) {
    if (!events.length) return lines;
    const ship = (id) => [...s.enemies, ...s.allies].find((c) => c.id === id);
    const name = (id) => (ship(id) || {}).name || 'the enemy';
    const isAlly = (id) => s.allies.some((a) => a.id === id);
    let you = null;
    const sum = () => ({ shots: 0, hits: 0, damage: 0, n: 0, to: null, from: null, destroyed: false });
    const add = (t, ev) => Object.assign(t, { shots: t.shots + ev.shots, hits: t.hits + ev.hits, damage: t.damage + ev.damage, n: t.n + 1, to: ev.to, from: ev.from, destroyed: t.destroyed || ev.destroyed });
    const squad = sum(), them = sum(), extra = [];
    for (const ev of events) {
      if (ev.type === 'flee') extra.push(ev.ok ? 'You got away.' : 'Couldn\'t get away!');
      else if (ev.from === 'player') you = `You hit ${name(ev.to)} ${ev.hits}/${ev.shots} for ${ev.damage}${ev.destroyed ? ' · destroyed' : ''}`;
      else if (isAlly(ev.from)) add(squad, ev);
      else if (ev.to === 'player') add(them, ev);
      else if (ev.destroyed) extra.push(`${name(ev.to)} is disabled!`);
    }
    const out = [];
    if (you) out.push(you);
    else if (s.round > 0 && !extra.length) out.push('Trying to get away…');
    if (squad.n) out.push(`${name(squad.from)} hit ${name(squad.to)} ${squad.hits}/${squad.shots} for ${squad.damage}${squad.destroyed ? ' · destroyed' : ''}`);
    if (them.n) out.push(`${them.n > 1 ? 'They hit' : 'It hit'} you ${them.hits}/${them.shots} for ${them.damage}`);
    return [...out, ...extra].slice(-3);
  }

  // Ships are held in place; every round's volleys are shown one after another, slowly.
  const mode = {
    id: 'rounds',
    flying: false,
    look: { beam: 0.4, shield: 0.35, after: 0.08, finish: 0.2, sparks: (ev) => 3 + ev.hits, sum: false, arcs: false },
    start: (rng, player, enemies, { target, allies: list = [] }) => create(rng, combatant(player.id, player.name, player.stats, player.hull),
      enemies.map((e) => combatant(e.id, e.name, e.stats, e.hull)), target, list.map((a) => combatant(a.id, a.name, a.stats, a.hull))),
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
    setOrders,
    press(s, id) { if (id === 'flee') s.fleeing = true; },
    lock: () => 1,
    panel: (s) => ({
      title: `Combat · round ${s.round + 1}`, progress: 1 - s.timer / config.round,
      button: { id: 'flee', label: s.fleeing ? 'Fleeing…' : 'Flee', enabled: !s.fleeing },
    }),
    log,
  };

  return { config, combatant, hitChance, shotsPerRound, create, setFocus, setOrders, round, fleeChance, simulate, alive, mode };
})();

export { Combat };
