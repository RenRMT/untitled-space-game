'use strict';

// Real-time combat: the alternative to round-based combat (combat/combat.js), chosen in Settings.
// Everyone keeps flying. Weapons fire on their own at a locked target whenever it is in range and
// in the weapon's arc (rules/loadout.js), so the player's skill is positioning.
// - Locking: a ship locks onto its target after its computer's lockTime, while the target is
//   within its scanner's lockRange. The player locks the attacked ship, or the nearest enemy
//   (whoever shot last, first); a tap picks another, which starts a new lock.
// - Shots hit instantly, with a chance: accuracy (computer) − evasion (target's engine, in full
//   from half its top speed, none at rest), less for a target moving across the line of fire and
//   toward the end of the weapon's range, kept within [minHit, maxHit]. Dodging is about speed and
//   angle, not reflexes.
// - Damage hits shields first, then the hull. Shields recharge only after a few seconds without
//   being hit.
// - Enemies steer: fighters make attack runs with their forward guns (close in, overshoot, swing
//   round); ships with turrets keep their distance and circle. Pirates chase only so far from
//   where the fight started. Each goes after the player, or the ally it picked (CombatCore.aim).
// - Allies (squad members) fly the same way at the enemy their orders name, locking on and firing
//   by the same rules; with no target they hold their place in formation (setOrders).
// - Escape: stay clear of every enemy's guns for a few seconds.
// The flight view (game.js) runs it as a combat mode (combat/combat-core.js says what a mode offers): it
// flies the player's ship, passes its pose in every step, and draws the shots; this module moves
// the enemies and does the numbers. Deterministic for a given rng.
// Works as a classic browser script (global `RealtimeCombat`) and as a Node module.

const RealtimeCombat = (() => {
  const isNode = typeof require === 'function';
  const F = isNode ? require('../flight/flight.js') : Flight;
  const core = isNode ? require('./combat-core.js') : CombatCore;
  const { combatant, applyDamage, limitHit, alive, allies, aim, aimAt } = core;

  const config = {
    motionPenalty: 0.3, // hit chance lost per `motionSpeed` of target speed across the line of fire
    motionSpeed: 600,
    rangePenalty: 0.2, // hit chance lost at a weapon's full range (less closer in, by distance²)
    shieldDelay: 3, // seconds without being hit before shields recharge
    escapeTime: 3, // seconds clear of every enemy's guns to get away ...
    escapeMargin: 250, // ... clear by this much beyond their range (or beyond escapeMin, if longer)
    escapeMin: 600,
    leash: 2400, // pirates stop chasing a ship this far from where the fight started
    chaseSpeed: 0.85, // share of top speed for pursuers well out of gun range
    hold: 0.5, // fighters brake to arrive at this share of their gun range ...
    creep: 0.12, // ... then edge in at this share of top speed, guns on target ...
    breakOff: 120, // ... until this close (between hulls), when they break off ...
    extendTime: [0.5, 0.9], // ... and veer away for this long before turning for another run
    spacing: 120, // enemies keep about this far apart
  };

  const { TAU, clamp, lerp } = typeof require === 'function' ? require('../core/math.js') : MathUtil;
  const angleDiff = (a, b) => ((a - b + Math.PI) % TAU + TAU) % TAU - Math.PI;
  const dist = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);

  // A ship in a fight. stats: Loadout.stats(); body: { x, y, vx, vy, angle, radius } (radius
  // defaults to the hull's); hull: current hull points (defaults to full).
  function ship(id, name, stats, body = {}, hull = stats.hull) {
    return {
      ...combatant(id, name, stats, hull),
      x: body.x || 0, y: body.y || 0, vx: body.vx || 0, vy: body.vy || 0, angle: body.angle || 0, thrust: 0,
      radius: body.radius || stats.radius,
      cool: stats.weapons.map(() => 0), // seconds until each weapon can fire again
      quiet: Infinity, // seconds since last hit (shields recharge after shieldDelay)
      lockT: 0, // enemies and allies: seconds locking onto their target
      lockOn: null, // allies: the target that lock is on
      ai: { mode: 'attack', t: 0, heading: 0, side: 1 },
    };
  }

  const byId = (s, id) => s.enemies.find((e) => e.id === id && e.hull > 0) || null;
  const reach = (c) => Math.max(0, ...c.stats.weapons.map((w) => w.range));

  // A new fight. focus: the enemy the player attacked (null for an ambush: the nearest is picked).
  // anchor: where the fight started (defaults to the enemies' centre); pirates chase only so far.
  // allies: squad members, flying beside the player (ship()s), with orders from setOrders.
  function create(rng, player, enemies, o = {}) {
    const anchor = o.anchor || {
      x: enemies.reduce((a, e) => a + e.x, 0) / enemies.length,
      y: enemies.reduce((a, e) => a + e.y, 0) / enemies.length,
    };
    for (const e of enemies) e.ai.side = rng() < 0.5 ? -1 : 1;
    const s = {
      rng, t: 0, player, enemies, anchor,
      focus: o.focus ?? null, manual: o.focus !== undefined && o.focus !== null, // player's target, and whether it was picked
      lockT: 0, locked: false, // the player's lock on its target
      lastAttacker: null, away: 0, over: null, allies: o.allies || [],
    };
    for (const a of s.allies) a.order = a.order || {};
    for (const e of enemies) e.aim = aim(rng, s);
    return s;
  }

  // What an ally does now: fire on `target` (an enemy id), or with none hold `station` ({ x, y }).
  function setOrders(s, id, order) {
    const a = s.allies.find((x) => x.id === id);
    if (a) a.order = order || {};
  }

  // Another ship joins the fight (a pirate flying into range).
  function join(s, e) {
    e.ai.side = s.rng() < 0.5 ? -1 : 1;
    e.aim = aim(s.rng, s);
    s.enemies.push(e);
  }

  // The player picks a target: the lock starts over.
  function setFocus(s, id, manual = true) {
    if (!byId(s, id) || s.focus === id) return false;
    s.focus = id;
    s.lockT = 0;
    s.locked = false;
    s.manual = manual;
    return true;
  }

  // Whether a weapon can fire at a target: within range of its edge, and inside the arc (a
  // target's own size counts, so a big ship near the arc's edge can still be hit).
  function canFire(a, w, t) {
    const dx = t.x - a.x, dy = t.y - a.y, d = Math.hypot(dx, dy);
    if (d - t.radius > w.range) return false;
    if (w.arc >= 360) return true;
    const off = Math.abs(angleDiff(Math.atan2(dy, dx), a.angle));
    return off <= (w.arc * Math.PI) / 360 + Math.atan2(t.radius, Math.max(d, 1));
  }

  // A ship's engine evasion counts in full from half its top speed, and not at all at rest.
  const evasion = (t) => t.stats.evasion * Math.min(1, Math.hypot(t.vx, t.vy) / (0.5 * t.stats.maxSpeed || 1));

  function hitChance(a, w, t) {
    const dx = t.x - a.x, dy = t.y - a.y, d = Math.max(1, Math.hypot(dx, dy));
    const rvx = t.vx - a.vx, rvy = t.vy - a.vy;
    const across = Math.abs(rvx * dy - rvy * dx) / d; // target speed across the line of fire
    const p = a.stats.accuracy - evasion(t)
      - (config.motionPenalty * across) / config.motionSpeed
      - config.rangePenalty * Math.min(1, Math.max(0, d - t.radius) / w.range) ** 2;
    return limitHit(p);
  }

  function damage(t, amount) {
    const d = applyDamage(t, amount);
    if (amount > 0) t.quiet = 0; // a miss doesn't hold up shield recharge
    return d;
  }

  // Every ready weapon that can reach the target fires once per 1/fireRate seconds.
  function fire(s, a, t, dt, events) {
    a.stats.weapons.forEach((w, i) => {
      a.cool[i] -= dt;
      if (a.cool[i] > 0) return;
      if (t.hull <= 0 || a.hull <= 0 || !canFire(a, w, t)) { a.cool[i] = 0; return; }
      while (a.cool[i] <= 0 && t.hull > 0) {
        const hit = s.rng() < hitChance(a, w, t);
        const dmg = hit ? w.damage : 0;
        const d = damage(t, dmg);
        events.push({ type: 'shot', from: a.id, to: t.id, weapon: i, shots: 1, hits: hit ? 1 : 0, damage: dmg, ...d, destroyed: t.hull <= 0 });
        a.cool[i] += 1 / w.fireRate;
      }
    });
  }

  // The player's target: kept while alive; picked automatically when there is none, or when the
  // automatic pick is out of lock range and another enemy is in range. Whoever shot last comes first.
  function updateFocus(s, events) {
    const p = s.player;
    const lockable = (e) => dist(p, e) - e.radius <= p.stats.lockRange;
    const current = byId(s, s.focus);
    if (current && (s.manual || lockable(current))) return;
    const live = alive(s);
    if (!live.length) return;
    const last = byId(s, s.lastAttacker);
    const nearest = live.slice().sort((a, b) => dist(p, a) - dist(p, b))[0];
    const pick = last && lockable(last) ? last : nearest;
    if (current && !lockable(pick)) return; // nothing better in range
    if (setFocus(s, pick.id, false)) events.push({ type: 'target', id: pick.id, auto: true });
  }

  function updateLocks(s, dt, events) {
    const p = s.player;
    const t = byId(s, s.focus);
    if (t && dist(p, t) - t.radius <= p.stats.lockRange) {
      s.lockT += dt;
      if (!s.locked && s.lockT >= p.stats.lockTime) { s.locked = true; events.push({ type: 'locked', id: t.id }); }
    } else {
      if (s.locked && t) events.push({ type: 'lost-lock', id: t.id });
      s.lockT = 0;
      s.locked = false;
    }
    for (const e of alive(s)) {
      const t = aimAt(s, e);
      e.lockT = dist(e, t) - t.radius <= e.stats.lockRange ? e.lockT + dt : 0;
    }
    for (const a of allies(s)) {
      const t = byId(s, a.order.target);
      if (!t || a.lockOn !== t.id) { a.lockOn = t ? t.id : null; a.lockT = 0; }
      if (t && dist(a, t) - t.radius <= a.stats.lockRange) a.lockT += dt;
      else a.lockT = 0;
    }
  }

  // ---------- Steering ----------

  // Fighters: run in on their target (leading it a little), brake inside gun range and edge closer
  // with guns on target, break off when close and veer away before turning for another run.
  function attackRun(s, e, p, d, range, dt) {
    const ai = e.ai, top = e.stats.maxSpeed;
    if (ai.mode === 'extend') {
      ai.t -= dt;
      if (ai.t <= 0 || d > range * 0.9) ai.mode = 'attack';
      else return { angle: ai.heading, speed: top };
    }
    if (d - e.radius - p.radius < config.breakOff) {
      ai.mode = 'extend';
      ai.t = lerp(config.extendTime[0], config.extendTime[1], s.rng());
      ai.side = s.rng() < 0.5 ? -1 : 1;
      ai.heading = Math.atan2(e.y - p.y, e.x - p.x) + ai.side * (0.9 + s.rng() * 0.5); // away, off to one side
      return { angle: ai.heading, speed: top };
    }
    const lead = Math.min(0.6, d / 1400);
    const angle = Math.atan2(p.y + p.vy * lead - e.y, p.x + p.vx * lead - e.x);
    const brake = Math.sqrt(2 * e.stats.accel * 0.6 * Math.max(0, d - range * config.hold));
    const speed = d > range + 300 ? top * config.chaseSpeed : clamp(brake, top * config.creep, top);
    return { angle, speed };
  }

  // Turrets: hold off at about two-thirds of gun range from their target, circling.
  function standOff(s, e, p, d, range) {
    const top = e.stats.maxSpeed, toward = Math.atan2(p.y - e.y, p.x - e.x);
    if (d > range * 0.85) return { angle: toward, speed: d > range + 300 ? top * config.chaseSpeed : top };
    if (d < range * 0.4) return { angle: toward + Math.PI, speed: top };
    return { angle: toward + (e.ai.side * Math.PI) / 2, speed: top * 0.4 };
  }

  // Push a wanted velocity away from the others on the same side, then fly it, turning before
  // speeding off.
  function fly(e, c, side, dt) {
    let vx = Math.cos(c.angle) * c.speed, vy = Math.sin(c.angle) * c.speed;
    for (const o of side) {
      if (o === e || o.hull <= 0) continue;
      const dx = e.x - o.x, dy = e.y - o.y, dd = Math.hypot(dx, dy);
      if (dd >= config.spacing || dd < 1e-6) continue;
      const push = ((config.spacing - dd) / config.spacing) * e.stats.maxSpeed * 0.8;
      vx += (dx / dd) * push;
      vy += (dy / dd) * push;
    }
    const want = Math.atan2(vy, vx);
    const speed = Math.min(e.stats.maxSpeed, Math.hypot(vx, vy)) * clamp(Math.cos(angleDiff(want, e.angle)), 0.15, 1);
    F.step(e, e.stats, { targetAngle: speed > 0 ? want : e.angle, targetSpeed: speed, mode: 'cruise' }, dt);
  }

  // An attack run or a stand-off, by the ship's guns.
  const engageWith = (s, e, t, dt) => (e.stats.weapons.some((w) => w.arc >= 360) ? standOff(s, e, t, dist(e, t), reach(e)) : attackRun(s, e, t, dist(e, t), reach(e), dt));

  function steer(s, e, dt) {
    const p = s.player;
    let c;
    if (dist(p, s.anchor) > config.leash) {
      // Given up the chase: back to where it started.
      const back = dist(e, s.anchor);
      c = { angle: Math.atan2(s.anchor.y - e.y, s.anchor.x - e.x), speed: back > 150 ? e.stats.maxSpeed * config.chaseSpeed : 0 };
      e.ai.mode = 'attack';
    } else c = engageWith(s, e, aimAt(s, e), dt);
    fly(e, c, s.enemies, dt);
  }

  // An ally: after its target if it has one, else back to its station, arriving at the leader's
  // speed so it keeps formation.
  function steerAlly(s, a, dt) {
    const t = byId(s, a.order.target), st = a.order.station;
    let c;
    if (t) c = engageWith(s, a, t, dt);
    else if (st) {
      const d = dist(a, st), lead = Math.hypot(s.player.vx, s.player.vy);
      c = d < 30 ? { angle: s.player.angle, speed: lead } : { angle: Math.atan2(st.y - a.y, st.x - a.x), speed: Math.min(a.stats.maxSpeed, lead + d * 1.5) };
    } else c = { angle: a.angle, speed: 0 };
    fly(a, c, s.allies, dt);
  }

  // ---------- One step ----------

  // Advance the fight by dt seconds. pilot: the player ship's pose this step { x, y, vx, vy, angle }.
  // Returns its events: shots { type: 'shot', from, to, weapon, shots: 1, hits: 0 | 1, damage,
  // shieldDamage, hullDamage, destroyed }, { type: 'target', id, auto }, { type: 'locked', id }, { type:
  // 'lost-lock', id }. Sets s.over to 'won', 'lost' or 'fled' when the fight ends.
  function step(s, dt, pilot) {
    if (s.over) return [];
    const events = [];
    const p = s.player;
    if (pilot) Object.assign(p, { x: pilot.x, y: pilot.y, vx: pilot.vx, vy: pilot.vy, angle: pilot.angle });
    s.t += dt;
    for (const e of alive(s)) steer(s, e, dt);
    for (const a of allies(s)) steerAlly(s, a, dt);
    updateFocus(s, events);
    updateLocks(s, dt, events);
    const target = byId(s, s.focus);
    if (target && s.locked) fire(s, p, target, dt, events);
    else p.cool.forEach((c, i) => { p.cool[i] = Math.max(0, c - dt); });
    for (const a of allies(s)) {
      const t = byId(s, a.order.target);
      if (t && a.lockT >= a.stats.lockTime) fire(s, a, t, dt, events);
      else a.cool.forEach((c, i) => { a.cool[i] = Math.max(0, c - dt); });
    }
    for (const e of alive(s)) {
      if (e.lockT < e.stats.lockTime) continue;
      const t = aimAt(s, e);
      const before = events.length;
      fire(s, e, t, dt, events);
      if (t === p && events.length > before) s.lastAttacker = e.id;
      if (p.hull <= 0) break;
    }
    for (const c of [p, ...allies(s), ...alive(s)]) {
      c.quiet += dt;
      if (c.quiet >= config.shieldDelay) c.shield = Math.min(c.stats.shield, c.shield + c.stats.shieldRecharge * dt);
    }
    if (p.hull <= 0) s.over = 'lost';
    else if (!alive(s).length) s.over = 'won';
    else {
      const clear = alive(s).every((e) => dist(e, p) - p.radius > Math.max(reach(e), config.escapeMin) + config.escapeMargin);
      s.away = clear ? s.away + dt : 0;
      if (s.away >= config.escapeTime) s.over = 'fled';
    }
    return events;
  }

  // Run a fight to its end, for tests and balancing: pilot(s, dt) flies the player's ship
  // (s.player) before each step. Returns the final state.
  function simulate(rng, player, enemies, pilot, o = {}) {
    const dt = o.dt || 1 / 30, maxTime = o.maxTime || 180;
    const s = create(rng, player, enemies, o);
    while (!s.over && s.t < maxTime) {
      if (pilot) pilot(s, dt);
      step(s, dt);
    }
    return s;
  }

  // ---------- As a combat mode (combat/combat-core.js) ----------

  const fromSpec = (c) => ship(c.id, c.name, c.stats, c.body, c.hull);
  const lockOf = (s) => (s.locked ? 1 : Math.min(1, s.lockT / s.player.stats.lockTime));

  // The panel's last two lines: what the guns are locking onto, shields going down, kills, and an
  // ally shot down.
  function log(s, events, lines) {
    const name = (id) => ([...s.enemies, ...s.allies].find((c) => c.id === id) || {}).name || 'the enemy';
    const isAlly = (id) => s.allies.some((a) => a.id === id);
    const out = [...lines];
    for (const ev of events) {
      if (ev.type === 'target') out.push(`Targeting ${name(ev.id)}`);
      else if (ev.type === 'locked') out.push(`Locked on ${name(ev.id)}`);
      else if (ev.type === 'lost-lock') out.push(`Lost lock on ${name(ev.id)}: out of range`);
      else if (ev.type === 'shot') {
        if (ev.to === 'player' && ev.shieldDamage > 0 && s.player.shield <= 0) out.push('Your shields are down!');
        if (ev.destroyed && isAlly(ev.to)) out.push(`${name(ev.to)} is disabled!`);
        else if (ev.destroyed && ev.from === 'player') out.push(`${name(ev.to)} destroyed`);
        else if (ev.destroyed && isAlly(ev.from)) out.push(`${name(ev.from)} destroyed ${name(ev.to)}`);
      }
    }
    return out.slice(-2);
  }

  // Everyone keeps flying; shots are quick beams, and hits on a ship add up into one number. The
  // panel's title says what the guns are doing; its bar fills as the lock comes on, or as you get
  // clear when breaking away.
  const mode = {
    id: 'realtime',
    flying: true,
    look: { beam: 0.14, shield: 0.3, after: 0, finish: 0, sparks: () => 2, sum: true, arcs: true },
    start: (rng, player, enemies, { target, ambushed, allies: list = [] }) => create(rng, fromSpec(player), enemies.map(fromSpec), { focus: ambushed ? null : target, allies: list.map(fromSpec) }),
    step,
    setFocus: (s, id) => setFocus(s, id),
    setOrders,
    join: (s, e) => join(s, fromSpec(e)),
    lock: lockOf,
    panel(s) {
      const t = byId(s, s.focus), away = s.away > 0;
      return {
        title: away ? 'Breaking away' : !t ? 'Combat' : s.locked ? `Locked on ${t.name}` : `Locking on ${t.name}`,
        button: null, bar: away ? 'escape' : 'lock',
        progress: away ? s.away / config.escapeTime : t ? lockOf(s) : 0,
      };
    },
    log,
  };

  return { config, ship, create, join, setFocus, setOrders, canFire, hitChance, step, simulate, alive, reach, mode };
})();

if (typeof module !== 'undefined') module.exports = RealtimeCombat;
