// The squad in flight: android wingmen in formation, given orders in a fight by their logic
// programs (rules/squad.js, rules/logic.js), repaired at a dock.
// Part of the flight view; src/main.js starts it.

import { ArtBlueprints } from '../art/blueprints.js';
import { CombatCore } from '../combat/combat-core.js';
import { Flight } from '../flight/flight.js';
import { Abilities } from '../rules/abilities.js';
import { Logic } from '../rules/logic.js';
import { Squad } from '../rules/squad.js';
import { cargo, logicKnown, logicLines, saveCargo } from './cargo.js';
import { explode, useAbility } from './combat.js';
import { escorts } from './jobs.js';
import { escorting, mission, workSpot } from './missions.js';
import { fight, fightMode, intro, notify, ship, turnToward, wings } from './state.js';
import { world } from './world.js';

//
// Squad members (rules/squad.js) fly in formation behind the ship. In a fight they join it as allies
// (combat/combat-core.js): every frame each one's program (rules/logic.js), run top down, decides
// what it does; the first line that holds gives its orders, and with none it keeps formation. One
// whose hull is shot down is disabled until the ship next docks, which repairs the whole squad.

export const WING_SNAP = 4000; // a wingman this far from its place (after a jump or map travel) is put there
// (Function declarations: buildWings and snapWings run while the galaxy first loads.)
export function activeSquad() { return intro.on ? [] : cargo.squad.filter((m) => !m.disabled); }
export function memberOf(id) { return cargo.squad.find((m) => m.id === id) || null; }

// The wingmen's ships, from the squad: android art (world.android) and their designations.
export function buildWings() {
  wings.clear();
  for (const m of cargo.squad) {
    const art = ArtBlueprints.create(m.hull, world.android, m.seed);
    wings.set(m.id, {
      kind: 'wingman', key: m.id, member: m, art, name: m.name, color: world.android.color, stats: Squad.stats(m),
      radius: art.radius, x: ship.x, y: ship.y, vx: 0, vy: 0, angle: ship.angle, a: ship.angle, thrust: 0,
    });
  }
  snapWings();
}

// The ships flying in formation: the active wingmen, then the android being escorted home in
// the first mission (it isn't in the squad yet, and stays out of fights), then any ship a job
// has you escort (game/jobs.js; out of fights too).
export function formationShips() {
  const list = activeSquad().map((m) => wings.get(m.id)).filter(Boolean);
  if (escorting()) list.push(mission.android);
  list.push(...escorts());
  return list;
}

// Every ship in formation to its place, at rest (after a teleport).
export function snapWings() {
  formationShips().forEach((w, i) => Object.assign(w, Squad.formation(ship, i), { vx: 0, vy: 0, angle: ship.angle, a: ship.angle, thrust: 0 }));
}

// Out of a fight the wingmen fly to their places, arriving at the ship's speed. In a round-based
// fight they're held where they are, turning to face their targets; in real time the fight flies
// them. An escorted ship waits out a fight where it is.
export function tickWings(dt) {
  if (fight.s) {
    if (fightMode().flying) return;
    for (const a of CombatCore.allies(fight.s)) {
      const w = wings.get(a.id), t = fight.ships.get(a.order.target);
      if (w && t) w.a = w.angle = turnToward(w.angle, Math.atan2(t.y - w.y, t.x - w.x), w.stats.turnRate * dt);
    }
    return;
  }
  const lead = Math.hypot(ship.vx, ship.vy);
  formationShips().forEach((w, i) => {
    // At work on the gate blocks (the third mission), it holds its spot by the gate instead.
    const job = workSpot(w);
    const st = job || Squad.formation(ship, i), d = Math.hypot(st.x - w.x, st.y - w.y);
    if (d > WING_SNAP) { Object.assign(w, st, { vx: ship.vx, vy: ship.vy, angle: ship.angle, a: ship.angle }); return; }
    const there = d < 30, speed = job ? 0 : lead;
    Flight.step(w, w.stats, {
      targetAngle: there ? (job ? job.face : ship.angle) : Math.atan2(st.y - w.y, st.x - w.x),
      targetSpeed: there ? speed : Math.min(w.stats.maxSpeed, speed + d * 1.5), mode: 'cruise',
    }, dt);
    w.a = w.angle;
  });
}

// The active wingmen as a combat mode takes allies.
export function allySpecs() {
  return activeSquad().filter((m) => wings.has(m.id)).map((m) => {
    const w = wings.get(m.id);
    return { id: m.id, name: m.name, stats: w.stats, hull: m.hullPoints, body: { x: w.x, y: w.y, vx: w.vx, vy: w.vy, angle: w.angle, radius: w.radius } };
  });
}

// Where a combatant is: its own position in real time; in a round-based fight, where its ship is
// held (the player's ship, a wingman, an enemy).
function posOf(c) {
  if (Number.isFinite(c.x)) return c;
  if (c.id === 'player') return ship;
  return wings.get(c.id) || fight.ships.get(c.id) || ship;
}
const distance = (a, b) => { const p = posOf(a), q = posOf(b); return Math.hypot(p.x - q.x, p.y - q.y); };

// What an ally knows when it decides (rules/logic.js ctx).
export function logicContext(s, a) {
  return {
    self: a, leader: s.player, enemies: CombatCore.alive(s), allies: CombatCore.allies(s).filter((x) => x !== a),
    leaderTarget: s.focus ?? null, dist: distance, targetOf: (e) => CombatCore.aimAt(s, e).id,
    // A `use` line runs when there's a charge in the kit, the ability is off cooldown for this ship
    // and would help, and its target is on the right side (rules/abilities.js).
    ready: (skill, t) => {
      const ab = Abilities.ABILITIES[skill], foe = s.enemies.includes(t);
      return !!ab && (cargo.kit[skill] || 0) > 0 && foe === (ab.on === 'enemy') && Abilities.ready(a, skill, t, s.t);
    },
  };
}

// What an intent (rules/logic.js) means as orders for a combat mode (combat/combat-core.js setOrders):
// - attack: fire on the target (keep: from as far as the guns reach),
// - guard: fire on whoever is shooting at the ward (the nearest such to it), else stay beside it,
// - retreat: fall back to the leader's far side from the enemies (with no target, holding fire),
// - follow: keep formation (a use line is done at once, in orderSquad, and leaves the orders as they were).
export const GUARD_OFFSET = 110, RETREAT_OFFSET = 140;
export function ordersFor(s, a, intent, i) {
  const formation = Squad.formation(ship, i);
  if (intent.type === 'attack') return { target: intent.target, keep: !!intent.keep };
  if (intent.type === 'guard') {
    const ward = [s.player, ...CombatCore.allies(s)].find((c) => c.id === intent.ward);
    if (!ward) return { station: formation };
    const attackers = CombatCore.alive(s).filter((e) => CombatCore.aimAt(s, e).id === ward.id);
    if (attackers.length) return { target: attackers.reduce((b, e) => (distance(e, ward) < distance(b, ward) ? e : b)).id };
    if (ward === s.player) return { station: formation };
    const w = posOf(ward), back = (w.angle ?? 0) + Math.PI;
    return { station: { x: w.x + Math.cos(back) * GUARD_OFFSET, y: w.y + Math.sin(back) * GUARD_OFFSET } };
  }
  if (intent.type === 'retreat') {
    const enemies = CombatCore.alive(s).map(posOf), p = posOf(s.player);
    if (!enemies.length) return { station: formation };
    const cx = enemies.reduce((n, e) => n + e.x, 0) / enemies.length, cy = enemies.reduce((n, e) => n + e.y, 0) / enemies.length;
    const away = Math.atan2(p.y - cy, p.x - cx);
    return { station: { x: p.x + Math.cos(away) * RETREAT_OFFSET, y: p.y + Math.sin(away) * RETREAT_OFFSET } };
  }
  return { station: formation };
}

// How often each line of each member's program took over in the last fight ({ [member id]: [count
// per line] }); not saved, and cleared when a program changes (the lines move).
export const lineRuns = new Map();
let runsOf = null; // the fight lineRuns counts
// The last fight, step by step, per member: each time its program switched to another line, when
// (seconds into the fight), which line and what it did, on whom, and its hull then; and the moment
// it was disabled. The Squad tab lists it so a program can be debugged; not saved, cleared with
// lineRuns. { [member id]: [{ t, line, text, target, hull, disabled? }] }
export const timelines = new Map();
export const TIMELINE_MAX = 40;
function logStep(id, entry) {
  const list = timelines.get(id) || [];
  if (list.length < TIMELINE_MAX) list.push(entry);
  timelines.set(id, list);
}
export const LINE_LABEL = 1.8; // seconds a line's label shows over a wingman when it takes over

// Each ally's orders for this frame, from its program: the line that ran (a.line, -1 for none)
// and what it says to do, else keep formation. When the line changes, it shows over the
// wingman as code ('L2 › attack(weakest(enemy))') and counts as a run.
export function orderSquad(s) {
  if (runsOf !== s) { runsOf = s; lineRuns.clear(); timelines.clear(); }
  const nameOf = (id) => (id === 'player' ? 'you' : ([...s.enemies, ...(s.allies || [])].find((c) => c.id === id) || {}).name || '');
  const m = fightMode(), limit = logicLines();
  CombatCore.allies(s).forEach((a, i) => {
    const member = memberOf(a.id);
    if (!member) return;
    const { line, intent } = Logic.decide(member.program, logicContext(s, a), limit);
    if (line !== a.line) {
      if (line >= 0) {
        const runs = lineRuns.get(member.id) || [];
        runs[line] = (runs[line] || 0) + 1;
        lineRuns.set(member.id, runs);
      }
      const old = fight.fx.findIndex((f) => f.type === 'code' && f.at === a.id);
      if (old >= 0) fight.fx.splice(old, 1);
      const text = line >= 0 ? `L${line + 1} › ${Logic.actionText(member.program[line])}` : 'else › follow(leader)';
      fight.fx.push({ type: 'code', delay: 0, t: LINE_LABEL, max: LINE_LABEL, at: a.id, text, idle: line < 0 });
      logStep(member.id, {
        t: s.t || 0, line, text: line >= 0 ? Logic.say(member.program[line]) : 'None applied: followed the leader',
        target: typeof intent.target === 'string' ? nameOf(intent.target) : '', hull: a.hull / a.stats.hull,
      });
    }
    a.line = line;
    if (intent.type === 'use') { useAbility(s, a, intent.skill, intent.target); return; }
    m.setOrders(s, a.id, ordersFor(s, a, intent, i));
  });
}

// After a fight's step: the allies' hull into their members (saved when the fight ends, like the
// player's) and, in real time, where they flew.
export function syncAllies(s) {
  for (const a of s.allies) {
    const member = memberOf(a.id), w = wings.get(a.id);
    if (!member) continue;
    member.hullPoints = Math.max(0, a.hull);
    if (fightMode().flying && w && a.hull > 0) Object.assign(w, { x: a.x, y: a.y, vx: a.vx, vy: a.vy, angle: a.angle, a: a.angle, thrust: a.thrust });
  }
}

// A wingman shot down: out of the fight, back with the squad once the ship docks.
export function wingDisabled(id) {
  const m = memberOf(id), w = wings.get(id);
  if (!m || m.disabled) return;
  m.disabled = true;
  m.hullPoints = 0;
  logStep(m.id, { t: (fight.s && fight.s.t) || 0, line: -1, text: 'Disabled', target: '', hull: 0, disabled: true });
  if (w) explode(w.x, w.y, w.radius);
  notify(`${m.name} disabled · repaired at the next dock`, 3, { priority: 2, tone: 'warn' });
  saveCargo();
}

// A member's gear changed (game/outfitting.js): its wingman flies and fights with the new stats,
// its hull points kept within its maximum.
export function refreshWing(m) {
  const st = Squad.stats(m), w = wings.get(m.id);
  if (w) w.stats = st;
  m.hullPoints = Math.min(m.hullPoints, st.hull);
}

// Docking repairs the squad and brings back the disabled.
export function repairSquad() {
  for (const m of cargo.squad) {
    m.disabled = false;
    m.hullPoints = Squad.stats(m).hull;
  }
}

// Squad programs as the station menu sees them: the members, what research has unlocked, how
// many lines run, and editing a member's lines (only lines that check go in).
export const programs = {
  get members() { return cargo.squad; },
  get known() { return logicKnown(); },
  get limit() { return logicLines(); },
  // How often each line took over in the last fight: [count per line] (empty if none).
  runs: (id) => lineRuns.get(id) || [],
  // The last fight, step by step (timelines above): [] if it hasn't fought since the program changed.
  timeline: (id) => timelines.get(id) || [],
  set(id, i, line) {
    const m = memberOf(id);
    if (!m || !Logic.check(line, logicKnown()).ok || !Squad.setLine(m, i, Logic.copy(line))) return false;
    return edited(id, true);
  },
  remove(id, i) { return edited(id, Squad.removeLine(memberOf(id) || { program: [] }, i) !== null); },
  move(id, from, to) { return edited(id, Squad.moveLine(memberOf(id) || { program: [] }, from, to)); },
  toggle(id, i) { return edited(id, Squad.toggleLine(memberOf(id) || { program: [] }, i)); },
};
function edited(id, ok) {
  if (!ok) return false;
  lineRuns.delete(id);
  timelines.delete(id);
  saveCargo();
  return true;
}
