// Turn-based combat on a timeline (the default; real time, combat/combat-realtime.js, is the
// alternative in Settings). notes/combat-research.md says why it works this way.
// - Everyone keeps flying: enemies steer as in real time (attack runs, stand-offs, the leash), the
//   player flies freely. Positioning changes the odds; it never stops the guns.
// - Each ship has an action gauge that charges over its turn time (`turn`, a little quicker with a
//   better scanner: initiative). Full, the ship takes its turn: every weapon within reach of its
//   target fires a volley (round(fireRate × turn time) shots). A target out of reach: the gauge
//   holds full and the volley goes the moment it comes in reach.
// - Hit chance: accuracy (computer) − the target's evasion (its engine: half at rest, in full from
//   half its top speed), less toward the end of the weapon's range, more with the target inside the
//   weapon's field of fire ("lined up"), kept within [minHit, maxHit]. Weapons fire all round;
//   facing your target only helps.
// - Enemies telegraph: each picks its next action as its gauge starts (s.enemies[i].intent): a volley
//   or, now and then, a heavy shot that charges longer and hits much harder. The flight view shows
//   every gauge, and a line from each enemy to whom it is after.
// - Breach: a hit that takes a ship's shields down knocks its gauge back, and cancels a heavy shot
//   it was charging. Switching your fire to a ship winding one up is the counter.
// - Damage hits shields first, then the hull; shields recharge after a few seconds without a hit.
// - The player fires at its focus (picked again when it dies: whoever shot last, else the nearest).
//   Retargeting is free and keeps the gauge. The fight you start begins with your gauge half full.
//   Allies (squad members) fire at the enemy their orders name; every enemy at whom it aims
//   (CombatCore.aimAt).
// - Escape: stay clear of every enemy's guns for a few seconds, as in real time.
// - Abilities (rules/abilities.js) land when their activation is done; an EMP freezes a gauge.
// The flight view (game/combat.js) runs it as a combat mode (combat/combat-core.js says what a mode
// offers) and draws it; this module moves the enemies and does the numbers. Deterministic for a
// given rng.
// ES module (`Combat`); also runs in Node (the tests).

import { CombatCore } from './combat-core.js';
import { RealtimeCombat } from './combat-realtime.js';
import { MathUtil } from '../core/math.js';
import { Abilities } from '../rules/abilities.js';

const Combat = (() => {
  const core = CombatCore;
  const RT = RealtimeCombat;
  const { applyDamage, limitHit, alive, allies, aimAt } = core;
  const { clamp, angleDiff, dist } = MathUtil;

  const config = {
    turn: 1.5, // seconds a turn takes to charge, at an even initiative ...
    tempo: 0.15, // ... up to this share quicker (or slower) with a better (or worse) scanner
    baseInitiative: 4000, // the initiative that charges in exactly `turn` ...
    spanInitiative: 6000, // ... and this much more (or less) for the full `tempo`
    firstStrike: 0.5, // the player's gauge as a fight it started begins
    heavyChance: 0.3, // an enemy's next action is a heavy shot with this chance ...
    heavyCharge: 1.8, // ... charging this many times as long ...
    heavyDamage: 2, // ... and hitting this many times as hard (a little more damage over time, unless cancelled)
    breach: 0.35, // the gauge a ship loses when its shields go down
    lined: 0.1, // hit chance gained with the target inside the weapon's field of fire
    restEvasion: 0.5, // the share of its engine's evasion a ship keeps at rest (all of it from half top speed)
    rangePenalty: 0.2, // hit chance lost at a weapon's full range (less closer in, by distance²)
    stagger: 0.1, // seconds between one weapon's volley and the next, as shown
  };

  // A ship's turn time, by its initiative.
  const period = (c) => config.turn * (1 - config.tempo * clamp(((c.stats.initiative || 0) - config.baseInitiative) / config.spanInitiative, -1, 1));
  // How long its current gauge takes to fill: a heavy shot longer.
  const charge = (c) => period(c) * (c.intent && c.intent.kind === 'heavy' ? config.heavyCharge : 1);
  // Shots in a turn's volley: fireRate × turn time, the fraction rounded up by chance, so the
  // average is exact.
  const shotsPerTurn = (c, w, rng = () => 0.5) => { const x = w.fireRate * period(c); return Math.max(1, Math.floor(x) + (rng() < x % 1 ? 1 : 0)); };

  // Tools that do nothing to ships (a gas siphon: rules/loadout.js vs) sit out a fight.
  const armed = (c, t) => c.stats.weapons.filter((w) => RT.factor(w, t) > 0);
  const inReach = (c, w, t) => dist(c, t) - t.radius <= w.range;
  // Whether a weapon has the target inside its field of fire (its size counts).
  function lined(c, w, t) {
    if (w.arc >= 360) return false; // all round: no bonus for facing
    const d = Math.max(1, dist(c, t)), off = Math.abs(angleDiff(Math.atan2(t.y - c.y, t.x - c.x), c.angle));
    return off <= (w.arc * Math.PI) / 360 + Math.atan2(t.radius, d);
  }

  // A ship's evasion: part of it at rest, all of it from half its top speed.
  const evasion = (t) => t.stats.evasion * (config.restEvasion + (1 - config.restEvasion) * Math.min(1, Math.hypot(t.vx || 0, t.vy || 0) / (0.5 * t.stats.maxSpeed || 1)));

  function hitChance(c, w, t) {
    const d = Math.max(0, dist(c, t) - t.radius);
    return limitHit(c.stats.accuracy - evasion(t) - config.rangePenalty * Math.min(1, d / w.range) ** 2 + (lined(c, w, t) ? config.lined : 0));
  }

  // An enemy picks its next action as its gauge starts over.
  function plan(s, e) {
    e.intent = { kind: s.rng() < config.heavyChance ? 'heavy' : 'volley' };
  }

  const byId = (s, id) => s.enemies.find((e) => e.id === id && e.hull > 0) || null;
  const fromSpec = (c) => RT.ship(c.id, c.name, c.stats, c.body, c.hull, c);

  // A new fight. o.focus: the enemy the player attacked (none: an ambush, the nearest is picked and
  // the player's gauge starts empty). o.anchor: where it started; o.allies, o.blocked as in real time.
  function create(rng, player, enemies, o = {}) {
    const s = RT.create(rng, player, enemies, o);
    s.first = o.focus !== undefined && o.focus !== null;
    player.gauge = s.first ? config.firstStrike : 0;
    for (const a of s.allies) a.gauge = s.first ? config.firstStrike * rng() : 0;
    for (const e of enemies) { e.gauge = rng() * 0.3; plan(s, e); }
    return s;
  }

  // Another ship joins the fight under way.
  function join(s, e) {
    RT.join(s, e);
    e.gauge = 0;
    plan(s, e);
  }

  // The player picks a target: no lock to wait for, the gauge carries on.
  function setFocus(s, id, manual = true) {
    if (!byId(s, id) || s.focus === id) return false;
    s.focus = id;
    s.manual = manual;
    return true;
  }

  // The player's target, picked again when it's gone: whoever shot last, else the nearest.
  function updateFocus(s, events) {
    if (byId(s, s.focus)) return;
    const live = alive(s).filter((e) => !e.passive);
    if (!live.length) return;
    const p = s.player, last = byId(s, s.lastAttacker);
    const pick = last || live.slice().sort((a, b) => dist(p, a) - dist(p, b))[0];
    if (setFocus(s, pick.id, false)) events.push({ type: 'target', id: pick.id, auto: true });
  }

  // A hit that takes the shields down: the gauge knocked back, a heavy shot cancelled.
  function breach(s, t, events) {
    t.gauge = Math.max(0, (t.gauge || 0) - config.breach);
    const cancelled = !!(t.intent && t.intent.kind === 'heavy');
    if (cancelled) t.intent = { kind: 'volley' };
    events.push({ type: 'breach', id: t.id, cancelled });
  }

  // A ship's turn: each weapon that reaches the target fires its volley. Returns the shot events.
  function volley(s, c, t, events) {
    const heavy = !!(c.intent && c.intent.kind === 'heavy');
    let i = 0;
    for (const w of armed(c, t)) {
      if (t.hull <= 0 || !inReach(c, w, t)) continue;
      const shots = shotsPerTurn(c, w, s.rng), p = hitChance(c, w, t);
      let hits = 0;
      for (let k = 0; k < shots; k++) if (s.rng() < p) hits++;
      const amount = Math.round(hits * w.damage * RT.factor(w, t) * (c.stats.classDamage ?? 1) * (heavy ? config.heavyDamage : 1) * 10) / 10;
      const up = t.shield > 0;
      const d = applyDamage(t, amount);
      if (amount > 0) t.quiet = 0;
      events.push({ type: 'shot', from: c.id, to: t.id, weapon: i, shots, hits, damage: amount, ...d, destroyed: t.hull <= 0, heavy, delay: config.stagger * i });
      i++;
      if (up && t.shield <= 0 && t.hull > 0 && t.stats.shield > 0) breach(s, t, events);
    }
    return i > 0;
  }

  // Whom a ship's turn goes at: the player's focus, an ally's ordered target, an enemy's aim.
  function targetOf(s, c) {
    if (c === s.player) return byId(s, s.focus);
    if (s.allies.includes(c)) return byId(s, c.order && c.order.target);
    return aimAt(s, c);
  }
  const canAct = (c, t) => !!t && t.hull > 0 && armed(c, t).some((w) => inReach(c, w, t));

  // Advance the fight by dt seconds. pilot: the player ship's pose this step { x, y, vx, vy, angle }.
  // Returns its events: shots { type: 'shot', from, to, weapon, shots, hits, damage, shieldDamage,
  // hullDamage, destroyed, heavy, delay }, { type: 'breach', id, cancelled }, { type: 'target', id,
  // auto }, abilities that land. Sets s.over to 'won', 'lost' or 'fled' when the fight ends.
  function step(s, dt, pilot) {
    if (s.over) return [];
    const events = [], p = s.player;
    if (pilot) Object.assign(p, { x: pilot.x, y: pilot.y, vx: pilot.vx, vy: pilot.vy, angle: pilot.angle });
    s.t += dt;
    for (const c of [p, ...allies(s), ...alive(s)]) Abilities.tick(c, s.t);
    events.push(...Abilities.resolve(s, s.t));
    RT.move(s, dt);
    updateFocus(s, events);
    for (const c of [p, ...allies(s), ...alive(s)]) {
      if (c.passive || c.hull <= 0 || p.hull <= 0) continue;
      if (Abilities.disabled(c, s.t)) continue; // an EMP: the gauge holds where it is
      c.gauge = Math.min(1, (c.gauge || 0) + dt / charge(c));
      if (c.gauge < 1) continue;
      const t = targetOf(s, c);
      if (!canAct(c, t)) continue; // holding fire, ready, until it reaches
      volley(s, c, t, events);
      c.gauge = 0;
      if (s.enemies.includes(c)) { plan(s, c); if (t === p) s.lastAttacker = c.id; }
    }
    for (const c of [p, ...allies(s), ...alive(s)]) {
      c.quiet += dt;
      if (c.quiet >= RT.config.shieldDelay) c.shield = Math.min(c.stats.shield, c.shield + c.stats.shieldRecharge * dt);
    }
    if (p.hull <= 0) s.over = 'lost';
    else if (!alive(s).length) s.over = 'won';
    else {
      const clear = alive(s).every((e) => dist(e, p) - p.radius > Math.max(RT.reach(e), RT.config.escapeMin) + RT.config.escapeMargin);
      s.away = clear ? s.away + dt : 0;
      if (s.away >= RT.config.escapeTime) s.over = 'fled';
    }
    return events;
  }

  // Run a fight to its end, for tests and balancing: pilot(s, dt) flies the player's ship
  // (s.player) before each step (none: it sits where it is, facing its target). Returns the final state.
  function simulate(rng, player, enemies, pilot = null, o = {}) {
    const dt = o.dt || 1 / 30, maxTime = o.maxTime || 180;
    const s = create(rng, player, enemies, { focus: enemies[0] && enemies[0].id, ...o });
    while (!s.over && s.t < maxTime) {
      if (pilot) pilot(s, dt);
      else { const t = byId(s, s.focus); if (t) s.player.angle = Math.atan2(t.y - s.player.y, t.x - s.player.x); }
      step(s, dt);
    }
    return s;
  }

  // ---------- As a combat mode (combat/combat-core.js) ----------

  // The last lines: kills, breaches, an ally shot down (kept for the log; the flight view shows
  // most of it round the ships).
  function log(s, events, lines) {
    const name = (id) => (id === 'player' ? 'You' : ([...s.enemies, ...s.allies].find((c) => c.id === id) || {}).name || 'the enemy');
    const out = [...lines];
    for (const ev of events) {
      if (ev.type === 'breach' && ev.cancelled) out.push(`${name(ev.id)}'s heavy shot cancelled`);
      else if (ev.type === 'shot' && ev.destroyed) out.push(s.allies.some((a) => a.id === ev.to) ? `${name(ev.to)} is disabled!` : `${name(ev.to)} destroyed`);
    }
    return out.slice(-2);
  }

  // Everyone keeps flying; a turn's volleys are shown one weapon after another, each with its number.
  const mode = {
    id: 'rounds',
    flying: true,
    look: { beam: 0.3, shield: 0.3, after: 0.06, finish: 0.15, sparks: (ev) => 2 + ev.hits, sum: false, arcs: false, gauges: true },
    start: (rng, player, enemies, { target, ambushed, allies: list = [], blocked = null, anchor = null }) => create(rng, fromSpec(player), enemies.map(fromSpec),
      { focus: ambushed ? null : target, allies: list.map(fromSpec), blocked, ...(anchor ? { anchor } : {}) }),
    step,
    setFocus: (s, id) => setFocus(s, id),
    setOrders: core.setOrders,
    join: (s, e) => join(s, fromSpec(e)),
    lock: () => 1,
    // Each combatant's gauge (0..1), how long until it acts, and whether it is holding (full, out of reach).
    gauge(s, c) {
      const t = targetOf(s, c), g = c.gauge || 0;
      return { gauge: g, eta: (1 - g) * charge(c), holding: g >= 1 && !canAct(c, t), heavy: !!(c.intent && c.intent.kind === 'heavy'), target: t ? t.id : null };
    },
    log,
  };

  return { config, period, charge, shotsPerTurn, hitChance, create, join, setFocus, step, simulate, alive, mode };
})();

export { Combat };
