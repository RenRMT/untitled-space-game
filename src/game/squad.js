// The squad in flight: android wingmen in formation, given orders in a fight by their logic
// modules (rules/squad.js, rules/logic.js), repaired at a dock.
// Part of the flight view; src/main.js starts it.

import { ArtBlueprints } from '../art/blueprints.js';
import { CombatCore } from '../combat/combat-core.js';
import { Flight } from '../flight/flight.js';
import { Logic } from '../rules/logic.js';
import { Squad } from '../rules/squad.js';
import { cargo, saveCargo } from './cargo.js';
import { explode } from './combat.js';
import { escorting, mission, workSpot } from './missions.js';
import { fight, fightMode, intro, notify, ship, turnToward, wings } from './state.js';
import { world } from './world.js';

//
// Squad members (rules/squad.js) fly in formation behind the ship. In a fight they join it as allies
// (combat/combat-core.js): every frame each one's logic modules (rules/logic.js), checked in slot order, decide
// what it does; the first that applies gives its orders, and with none it keeps formation. One
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
// the first mission (it isn't in the squad yet, and stays out of fights).
export function formationShips() {
  const list = activeSquad().map((m) => wings.get(m.id)).filter(Boolean);
  if (escorting()) list.push(mission.android);
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

// Each ally's orders for this frame, from its logic modules: attack what they name, or keep
// formation.
export function orderSquad(s) {
  const m = fightMode(), enemies = CombatCore.alive(s);
  CombatCore.allies(s).forEach((a, i) => {
    const member = memberOf(a.id);
    if (!member) return;
    const facts = { self: a, leader: s.player, inFight: true, enemies, leaderTarget: s.focus ?? null };
    const { intent } = Logic.decide(Squad.modulesOf(member), facts);
    m.setOrders(s, a.id, intent.type === 'attack' ? { target: intent.target } : { station: Squad.formation(ship, i) });
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
  if (w) explode(w.x, w.y, w.radius);
  notify(`${m.name} disabled · repaired at the next dock`, 3);
  saveCargo();
}

// Docking repairs the squad and brings back the disabled.
export function repairSquad() {
  for (const m of cargo.squad) {
    m.disabled = false;
    m.hullPoints = Squad.stats(m).hull;
  }
}
