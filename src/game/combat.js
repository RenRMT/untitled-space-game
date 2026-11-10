// Combat in flight: engaging and being ambushed, the fight's events as effects, loot, the combat panel,
// knocks to the ship (collisions: hurtShip) and losing the ship. The rules: combat/combat.js (turns on
// a timeline, the default) and combat/combat-realtime.js (active, the alternative).
// Part of the flight view; src/main.js starts it.

import { CombatCore } from '../combat/combat-core.js';
import { RealtimeCombat } from '../combat/combat-realtime.js';
import { Feedback } from '../core/feedback.js';
import { Params } from '../core/store.js';
import { mulberry32 } from '../core/rng.js';
import { COLORS, Theme } from '../core/theme.js';
import { Entities } from '../flight/entities.js';
import { Flight } from '../flight/flight.js';
import { Scene } from '../flight/scene.js';
import { Abilities } from '../rules/abilities.js';
import { Classes } from '../rules/classes.js';
import { Loadout } from '../rules/loadout.js';
import { Reputation } from '../rules/reputation.js';
import { Research } from '../rules/research.js';
import { Progress } from '../rules/progress.js';
import { Vendor } from '../rules/vendor.js';
import { CombatPanel } from '../ui/combat-panel.js';
import { SystemMap } from '../ui/map.js';
import { FactionsMenu } from '../ui/factions.js';
import { Settings } from '../ui/settings.js';
import { Factions } from '../world/factions.js';
import { addTo, cargo, dropEntity, lootClasses, lootDropped, pilotLevel, saveCargo } from './cargo.js';
import { actions, docked } from './docking.js';
import { lostOnSurface } from './surface-run.js';
import { landing, surfaceAt } from './landing.js';
import { surfaceWalls } from './surface-squad.js';
import { guardianDown } from './dungeon.js';
import { attackStructure, defenderSpecs, isStructure, orderDefenders, setEngage, structureAggro, structureDestroyed, structureGroup, structurePose, structureSpec, syncStructures } from './structures.js';
import { Loot } from '../rules/loot.js';
import { visible } from './draw-world.js';
import { edgeMarkers, markerAt, worldToScreen } from './hud.js';
import { steady } from './input.js';
import { gainXP } from './progress.js';
import { tip } from './tips.js';
import { eliteDown, orderPatrols, patrolDown, patrolSpecs, raiderDown, trafficShip } from './traffic.js';
import { grantGambit, ownedGambits } from './vendor.js';
import { burst, endExtraction } from './mining.js';
import { combatMode } from './options.js';
import { placeBeside, placeShip, startStation } from './outfitting.js';
import { HOSTILE_COLOR, fmtDist, frameList, isHostile, select } from './selection.js';
import { allySpecs, orderSquad, syncAllies, wingDisabled } from './squad.js';
import { NEAR, PLAYER_DRAW, SHIP, TAU, autopilot, showBanner, ctx, fight, fightMode, inFight, notify, setMode, ship, turnToward, view, whiteOut, wings } from './state.js';
import { simTime } from './update.js';
import { world } from './world.js';

// God mode (?dev, for testing dangerous space): the player's ship and the squad's take no damage.
// Enemies still shoot (and their hits still show), but nothing gets through.
export const godMode = Params.has('dev');

// A fight starts from a hostile ship's Attack button, or when pirates catch the ship within
// their aggro range. Every pirate near the one engaged joins in. The combat panel
// state is drawn round the ships themselves (drawFight, drawFightOverlay): bars, each ship's action
// gauge, the enemies' intents; the combat panel (ui/combat-panel.js) is only the skill bar. Tap an
// enemy, or its edge marker, to target it. The Combat setting picks how a fight plays:
// - Turns (rounds, the default): everyone keeps flying, and each ship acts when its gauge fills:
//   a volley from every weapon in reach. Enemies telegraph their next action and target; take a
//   ship's shields down to knock its gauge back and cancel a heavy shot it is charging. Flee by
//   flying clear.
// - Real time: everyone keeps flying. Your guns fire at the locked target while it's in range and
//   inside their arc (the wedge ahead of the ship); when you stop steering, the ship turns to face
//   its target. Pirates flying into range join in. To flee, outfly them.
// Outcomes:
// - won: destroyed ships stay destroyed and leave loot floating,
// - fled: the pirates leave you alone for a while,
// - lost: the cargo spills where the ship was destroyed, and it's towed back to the last
//   station it docked at (or the capital), with the hull patched up.
// Pirates that survive a real-time fight fly back to their usual paths.
//
// Mining is a timed action of its own (game/mining.js), not a fight; a fight starting ends it.
export const FLEE_GRACE = 12; // seconds the pirates leave you alone after you get away
export const RESPAWN_GRACE = 8;
export const SHOT_COLOR = { player: COLORS.cyan, ally: '#5ad8ff', enemy: COLORS.hostile };
Theme.onPalette(() => { SHOT_COLOR.enemy = COLORS.hostile; });
export const LETTERS = 'ABCDEFGHIJKL'; // tell same-role ships apart, on the panel and above the ships

// The ship as it's flown now: in space, or over a planet's surface (game/landing.js craft, in the
// surface's units: mining a deposit there, game/surface-run.js).
export const pilot = () => (landing.phase === 'surface' ? landing.craft : ship);

// Where a combatant is: the player ship, a wingman, or an enemy's pose.
export function fighterPos(id) {
  if (id === 'player') { const P = pilot(); return { x: P.x, y: P.y, radius: SHIP.radius, player: true }; }
  return fight.ships.get(id) || wings.get(id) || defenderPos(id) || patrolPos(id) || fight.lastShips.get(id) || null;
}
// A station turret fighting on your side (game/structures.js), where it is.
function defenderPos(id) {
  const a = fight.s && (fight.s.allies || []).find((c) => c.id === id && c.defender);
  return a ? { x: a.x, y: a.y, radius: a.radius, structure: true } : null;
}
// A patrol fighting on your side (game/traffic.js), where it is.
function patrolPos(id) {
  const a = fight.s && (fight.s.allies || []).find((c) => c.id === id && c.patrol);
  return a ? { x: a.x, y: a.y, radius: a.radius } : null;
}
const isPatrol = (id) => !!fight.s && (fight.s.allies || []).some((c) => c.id === id && c.patrol);
const isDefender = (id) => !!fight.s && (fight.s.allies || []).some((c) => c.id === id && c.defender);
// How far out a combatant is drawn, for what's drawn round it (brackets, shields, bars): ships are
// drawn larger than their size (flight/entities.js SHIP_SCALE), the player's larger again
// (game/state.js PLAYER_DRAW, game/draw-world.js drawShip); structures at their size.
const shownRadius = (p) => (p.structure ? p.radius : p.radius * Entities.SHIP_SCALE * (p.player ? PLAYER_DRAW : 1));
// Effects are attached to a combatant (by id, so they follow it) or to a fixed point.
export const fxPos = (v) => (typeof v === 'string' ? fighterPos(v) : v);

// An entity's velocity along its usual path, from where it will be a moment later.
export function pathVelocity(e) {
  if (!e.motion) return [0, 0];
  const next = { motion: e.motion };
  Scene.pose(next, simTime + 0.1);
  return [(next.x - e.x) / 0.1, (next.y - e.y) / 0.1];
}

export const shipName = (e, i, n) => ((e.android || e.elite) && e.name ? e.name : `${Entities.ROLE_LABEL[e.role] || 'Ship'}${n > 1 ? ` ${LETTERS[i] || i + 1}` : ''}`);
export const fightLog = (line) => { fight.log = [...fight.log, line].slice(-2); };

// An enemy as the flight view keeps it during a fight: its pose (held facing you, or flown on)
// and what's needed to draw it, loot it and send it home afterwards.
export function heldPose(e, name) {
  const a = fightMode().flying ? e.a : Math.atan2(ship.y - e.y, ship.x - e.x);
  return { x: e.x, y: e.y, a, thrust: 0, role: e.role, tier: e.tier || 1, radius: e.radius, name, motion: e.motion };
}

// A ship as a combat mode takes it: its stats and how it is flying right now.
export function enemySpec(e, name) {
  const back = fight.returning.get(e.key); // still flying back from an earlier fight
  const [vx, vy] = back ? [back.vx, back.vy] : pathVelocity(e);
  return { id: e.key, name, stats: foeStats(e), body: { x: e.x, y: e.y, vx, vy, angle: e.a, radius: e.hitRadius || e.radius } };
}
// An enemy's stats: its gear (by role and tier), the aliens' a good deal tougher and harder hitting,
// a dungeon's guardians as they're made (game/dungeon.js: e.stats).
export const ALIEN = { hull: 1.35, shield: 1.25, damage: 1.25 };
// Every hostile ship is sturdier and hits softer than its gear alone says (notes/review.md): an even
// fight lasts long enough for a skill to be used more than once, and for a heavy shot to be seen
// coming and cancelled, and a new pilot has time to see a fight going wrong.
export const FOE = { hull: 1.9, shield: 1.4, damage: 0.6 };
const scaled = (st, k) => ({
  ...st, hull: Math.round(st.hull * k.hull), shield: Math.round(st.shield * k.shield), firepower: st.firepower * k.damage,
  weapons: st.weapons.map((w) => ({ ...w, damage: w.damage * k.damage })),
});
const tuned = new WeakMap(); // stats made elsewhere (an elite's, a guardian's), tuned once
export function foeTuned(st) {
  if (!tuned.has(st)) tuned.set(st, scaled(st, FOE));
  return tuned.get(st);
}
export function foeStats(e) {
  if (e.stats) return foeTuned(e.stats);
  const st = scaled(Loadout.stats(Loadout.npc(e.role, e.tier || 1)), FOE);
  return e.faction === 'alien' ? scaled(st, ALIEN) : st;
}

// The pirates that fight together with this one: it and every pirate within groupRange of it.
// (Not ships destroyed and about to blow up: fight.dying.)
export function packOf(target) {
  return [target, ...frameList.filter((e) => isHostile(e) && e !== target && !cargo.removed.has(e.key) && !fight.dying.has(e.key)
    && Math.hypot(e.x - target.x, e.y - target.y) <= CombatCore.config.groupRange)];
}

// How a fight with this pirate's pack would go, as one word: each side's time to wear the other down
// (shields and hull over firepower that hits, against the other side's evasion), compared. It
// stands in for the gear tier and pack size on the pirate's card, which the player would otherwise
// have to weigh up; those stay in its detail line.
//   threat(target) -> { word: 'Weak' | 'Even' | 'Outmatched', tone, detail }
export const THREAT = { weak: 1.6, even: 0.7 }; // our edge (their time to beat us over ours to beat them)
export function threat(target) {
  const pack = packOf(target);
  const theirs = pack.map((e) => ({ stats: foeStats(e) }));
  const ours = [{ stats: SHIP, hull: cargo.hull }, ...allySpecs()];
  const hp = (side) => side.reduce((t, c) => t + (c.hull ?? c.stats.hull) + (c.stats.shield || 0), 0);
  const avg = (side, k) => side.reduce((t, c) => t + (c.stats[k] || 0), 0) / side.length;
  const dps = (side, other) => side.reduce((t, c) => t + c.stats.firepower * CombatCore.limitHit((c.stats.accuracy || 0) - avg(other, 'evasion')), 0);
  const toBeatThem = hp(theirs) / Math.max(1e-6, dps(ours, theirs));
  const toBeatUs = hp(ours) / Math.max(1e-6, dps(theirs, ours));
  const edge = toBeatUs / toBeatThem;
  const tier = Math.max(...pack.map((e) => e.tier || 1));
  const detail = `${pack.length === 1 ? 'Alone' : `Pack of ${pack.length}`} · ${Loadout.MK[tier]} gear`;
  if (edge >= THREAT.weak) return { word: 'Weak', tone: 'good', detail };
  if (edge >= THREAT.even) return { word: 'Even', tone: 'warn', detail };
  return { word: 'Outmatched', tone: 'hostile', detail };
}

// The player's ship as a fight takes it: its hull and the shields it has now.
function playerSpec() {
  const P = pilot();
  return {
    id: 'player', name: `${SHIP.name} (you)`, stats: SHIP, hull: cargo.hull, shield: shieldNow(), cls: SHIP.cls,
    body: { x: P.x, y: P.y, vx: P.vx, vy: P.vy, angle: P.angle, radius: SHIP.radius },
  };
}

// ---------- Shields and knocks ----------

// The ship's shields outside a fight (a fight keeps its own, on its player): they take knocks before
// the hull, and recharge after SHIELD_DELAY seconds without one, as in a real-time fight.
export const SHIELD_DELAY = RealtimeCombat.config.shieldDelay;
export const guard = { shield: null, quiet: Infinity };
export const shieldNow = () => (fight.s ? fight.s.player.shield : Math.min(SHIP.shield, guard.shield ?? SHIP.shield));
export function tickShield(dt) {
  if (fight.s) { guard.shield = fight.s.player.shield; guard.quiet = fight.s.player.quiet; return; }
  guard.quiet += dt;
  guard.shield = shieldNow();
  if (guard.quiet >= SHIELD_DELAY) guard.shield = Math.min(SHIP.shield, guard.shield + SHIP.shieldRecharge * dt);
}

// The ship takes a knock (a collision, flight/collide.js; a storm pocket on a gas giant): shields
// first, then the hull, shown like a hit in a fight. Returns what it took; a hull knocked to nothing
// loses the ship (wreck; on a surface, lostOnSurface: the hold stays there), and mining stops.
export function hurtShip(amount, at = null) {
  if (amount <= 0 || fight.wrecked || fight.wreckT > 0 || landing.wrecked) return { shieldDamage: 0, hullDamage: 0 };
  const target = fight.s ? fight.s.player : { hull: cargo.hull, shield: shieldNow(), invulnerable: godMode };
  const d = CombatCore.applyDamage(target, Math.round(amount));
  if (fight.s) target.quiet = 0;
  else { guard.shield = target.shield; guard.quiet = 0; cargo.hull = target.hull; }
  if (d.shieldDamage + d.hullDamage <= 0) return d;
  if (d.shieldDamage > 0) fight.fx.push({ type: 'shield', delay: 0, t: 0.3, max: 0.3, at: 'player' });
  const P = pilot();
  if (d.hullDamage > 0) burst(at ? at.x : P.x, at ? at.y : P.y, 6, { speed: [40, 180], life: [0.3, 0.8], size: [1.5, 3.5], colors: [COLORS.flash, COLORS.flame] });
  addDamage('player', d.shieldDamage + d.hullDamage, d.hullDamage > 0);
  Feedback.emit('hit', { hull: d.hullDamage > 0 });
  if (target.hull <= 0 && !fight.s) {
    endExtraction();
    if (landing.on) lostOnSurface('Hull breached'); // game/landing.js takes off, and the ship is lost in orbit
    else wreck();
  }
  return d;
}

// The ship lost outside a fight (a hull knocked to nothing): it spills its hold, and is towed home
// after a moment.
export function wreck(reason = 'Hull breached') {
  playerDestroyed();
  fight.wreckT = 2.6;
  setMode('in-combat', true);
  notify(`${reason} · calling a tow`, 2.6, { tone: 'hostile' });
}

export function engage(target, ambushed = false) {
  if (inFight() || docked || landing.on || !isHostile(target) || fight.dying.has(target.key)) return;
  if (!ambushed && !actions.state('attack', target).ok) return;
  const group = packOf(target);
  const names = group.map((e, i) => shipName(e, i, group.length));
  const rng = mulberry32((Math.random() * 4294967296) >>> 0);
  endExtraction(); // mining stops for a fight
  fight.mode = combatMode.value;
  const m = fightMode();
  fight.s = m.start(rng, playerSpec(), group.map((e, i) => enemySpec(e, names[i])), { target: target.key, ambushed, allies: [...allySpecs(), ...(m.flying ? [...defenderSpecs(target), ...patrolSpecs(target)] : [])] });
  if (godMode) for (const c of [fight.s.player, ...(fight.s.allies || [])]) if (!c.defender) c.invulnerable = true;
  // The ship eases to a stop as a fight starts, so it doesn't cruise on out of it, and turns to face
  // its target while it isn't steered (tickFight): in real time its forward guns need that, in
  // turns it lines them up. You can fly off any time. (In real time an ambush doesn't stop you.)
  if (fight.mode !== 'realtime' || !ambushed) ship.targetSpeed = 0;
  fight.ships = new Map(group.map((e, i) => [e.key, heldPose(e, names[i])]));
  for (const e of group) fight.returning.delete(e.key);
  // Who started it: pirates, a job's crew of some other kind, or (in the second opening
  // mission) a named android.
  const attackers = target.android ? `${target.name} attacks!` : `${target.crew || 'Pirates'} attack!`;
  fight.log = [ambushed ? attackers : `You engage the ${names[0]}.`];
  fight.lowHull = false;
  fight.lockers = new Set(); // enemies locking on the player, to buzz once as each starts
  fight.result = null;
  autopilot.key = null;
  select(null);
  setMode('in-combat', true);
  if (ambushed) notify(attackers, 2, { priority: 2, tone: 'hostile' }); // a fight you start needs no notice: the panel opens
  tip('fight');
}

// A station, a turret or an outpost attacked (or opening fire: ambushed): it and the rest of its
// station's defence, and the hostile ships near it, in real time (structures don't fly, but the
// ships round them do). A fight under way: they join it.
export function engageStructures(target, ambushed = false) {
  if (docked || landing.on || fight.dying.has(target.key)) return;
  const group = [...structureGroup(target)];
  if (!group.length) return;
  if (fight.s && fightMode().join) {
    for (const e of group) {
      if (fight.ships.has(e.key)) continue;
      fightMode().join(fight.s, structureSpec(e));
      fight.ships.set(e.key, structurePose(e));
      fightLog(`${structurePose(e).name} opens fire`);
    }
    if (!ambushed) focusOn(target.key);
    return;
  }
  if (inFight()) return;
  const ships = frameList.filter((e) => isHostile(e) && !cargo.removed.has(e.key) && !fight.dying.has(e.key) && Math.hypot(e.x - target.x, e.y - target.y) <= CombatCore.config.groupRange);
  const names = ships.map((e, i) => shipName(e, i, ships.length));
  const rng = mulberry32((Math.random() * 4294967296) >>> 0);
  endExtraction();
  fight.mode = combatMode.value;
  const specs = [...group.map(structureSpec), ...ships.map((e, i) => enemySpec(e, names[i]))];
  fight.s = fightMode().start(rng, playerSpec(), specs, { target: ambushed ? null : target.key, ambushed, allies: allySpecs() });
  if (godMode) for (const c of [fight.s.player, ...(fight.s.allies || [])]) c.invulnerable = true;
  fight.ships = new Map([...group.map((e) => [e.key, structurePose(e)]), ...ships.map((e, i) => [e.key, heldPose(e, names[i])])]);
  for (const e of ships) fight.returning.delete(e.key);
  const host = target.kind === 'turret' ? target.host || target : target;
  const what = ambushed ? `${host.name}'s defences open fire!` : `You attack ${host.name}`;
  fight.log = [what];
  fight.lowHull = false;
  fight.lockers = new Set();
  fight.result = null;
  autopilot.key = null;
  select(null);
  setMode('in-combat', true);
  if (ambushed) notify(what, 2, { priority: 2, tone: 'hostile' });
}

// A dungeon's guardians waking (game/dungeon.js): a fight on the surface (the Combat setting's mode, as in space), with the squad
// (it lands with you: game/surface-squad.js). Turrets hold their place; raiders and the Warden fly,
// and the caverns' walls stop every ship in it. Mining stops for it; guardians woken while one is
// on join it.
const guardianSpec = (g) => ({ id: g.key, name: g.name, stats: g.role === 'turret' ? g.stats : foeTuned(g.stats), fixed: g.role === 'turret', body: { x: g.x, y: g.y, vx: 0, vy: 0, angle: g.angle, radius: g.radius } });
const guardianPose = (g) => ({ x: g.x, y: g.y, a: g.angle, thrust: 0, role: 'fighter', tier: g.tier, radius: g.radius, name: g.name, guardian: g });
export function engageOnSurface(foes) {
  if (!foes.length || landing.phase !== 'surface' || landing.wrecked || fight.wreckT > 0) return;
  if (fight.s) {
    for (const g of foes) {
      if (fight.ships.has(g.key)) continue;
      fightMode().join(fight.s, guardianSpec(g));
      fight.ships.set(g.key, guardianPose(g));
      fightLog(`${g.name} wakes`);
    }
    return;
  }
  endExtraction();
  fight.mode = combatMode.value;
  const rng = mulberry32((Math.random() * 4294967296) >>> 0);
  fight.s = fightMode().start(rng, playerSpec(), foes.map(guardianSpec), { target: null, ambushed: true, allies: allySpecs(), blocked: surfaceWalls() });
  if (godMode) for (const c of [fight.s.player, ...(fight.s.allies || [])]) c.invulnerable = true;
  if (fight.mode !== 'realtime') ship.targetSpeed = 0; // as in space: the ship eases to a stop in a turn-based fight
  fight.ships = new Map(foes.map((g) => [g.key, guardianPose(g)]));
  const boss = foes.find((g) => g.boss), what = boss ? `The ${boss.name} wakes!` : `${foes.length > 1 ? `${foes.length} sentinels wake` : 'A sentinel wakes'}!`;
  fight.log = [what];
  fight.lowHull = false;
  fight.lockers = new Set();
  fight.result = null;
  setMode('in-combat', true);
  notify(what, 2, { tone: 'hostile' });
}
// Taking off in the middle of one: it's over, the guardians left as they were.
export function endSurfaceFight() {
  if (!fight.s) return;
  fight.final = fight.s;
  fight.s = null;
  endFight('fled');
}

// A pirate flying into range joins a fight under way (in modes where ships can join).
export function joinFight(e) {
  const s = fight.s;
  if (s.enemies.length === 1 && !/ [A-Z]$/.test(s.enemies[0].name)) { // the first one gets its letter now
    s.enemies[0].name += ' A';
    const p = fight.ships.get(s.enemies[0].id);
    if (p) p.name = s.enemies[0].name;
  }
  const name = shipName(e, s.enemies.length, 2);
  fightMode().join(s, enemySpec(e, name));
  fight.ships.set(e.key, heldPose(e, name));
  fight.returning.delete(e.key);
  fightLog(`${name} joins the fight`);
}

// Pirates attack a ship that comes too close, unless it just got away from them, or the pirates
// count it Friendly (rules/reputation.js passage): then their packs leave it be, though a job's or
// a mission's pirates still don't. In a fight that others can join (real time), those that come
// close join it.
export const letsPass = (e) => e.pack !== undefined && Reputation.passage(cargo.rep);
export function checkAggro(list) {
  if (docked || Settings.isOpen || FactionsMenu.isOpen) return;
  // Not in high security: hostiles keep out of a fight there (their packs lie outside it, but the
  // stations go round their planets).
  const near = (e) => isHostile(e) && !letsPass(e) && !fight.dying.has(e.key) && Math.hypot(e.x - ship.x, e.y - ship.y) - e.radius <= CombatCore.config.aggroRange
    && (e.pack === undefined || world.galaxy.securityAt(e.x, e.y) < 2);
  if (fight.s && fightMode().join) {
    for (const e of list) if (!fight.ships.has(e.key) && near(e)) joinFight(e);
    structureAggro(list, (e) => engageStructures(e, true));
    return;
  }
  if (inFight() || fight.grace > 0) return;
  for (const e of list) {
    if (near(e)) { engage(e, true); return; }
  }
  structureAggro(list, null);
}

// Show a fight's events as its mode's `look` says (combat/combat-core.js): a beam per shot (a miss streaks
// past), a shield flash, sparks off the hull, damage numbers (one per volley, with misses, or adding
// up on a ship that keeps taking hits) and, when a ship is destroyed, its explosion. Then the
// panel's lines. Effects follow their ship by id; delays stagger a round's volleys.
export function playEvents(s, events) {
  const look = fightMode().look;
  const jitter = () => (Math.random() - 0.5) * 30; // so numbers landing together don't overlap
  for (const ev of events) {
    if (ev.type === 'ability') { skillLanded(s, ev); continue; }
    if (ev.type === 'breach') { // shields down: its gauge knocked back, a heavy shot cancelled
      const mine = ev.id === 'player' || wings.has(ev.id) || isDefender(ev.id);
      fight.fx.push({ type: 'number', delay: 0.2, t: 1.3, max: 1.3, at: ev.id, jx: 0, dy: -18, text: ev.cancelled ? 'CANCELLED' : 'BREACH', color: mine ? COLORS.hostile : ev.cancelled ? COLORS.good : COLORS.cyan, big: ev.cancelled });
      continue;
    }
    if (ev.type === 'power') { // a Legendary's (rules/loot.js POWERS) shown where it worked
      fight.fx.push({ type: 'number', delay: 0.2, t: 1.5, max: 1.5, at: ev.id, jx: 0, dy: -18, text: (Loot.powerOf(ev.power)?.name || ev.power).toUpperCase(), color: Loot.rarityOf('legendary').color, big: true });
      continue;
    }
    if (ev.type !== 'shot') continue;
    const d = ev.delay || 0, hit = d + look.after;
    if (ev.skill) fightLog(`${ev.from === 'player' ? 'You' : (s.allies || []).find((a) => a.id === ev.from)?.name || 'Enemy'}: ${Abilities.ABILITIES[ev.skill].name} · −${ev.damage}`);
    const color = ev.from === 'player' ? SHOT_COLOR.player : wings.has(ev.from) || isDefender(ev.from) ? SHOT_COLOR.ally : SHOT_COLOR.enemy;
    fight.fx.push({ type: 'beam', delay: d, t: look.beam, max: look.beam, from: ev.from, to: ev.to, hits: ev.hits, color, heavy: !!ev.heavy });
    if (ev.shieldDamage > 0) fight.fx.push({ type: 'shield', delay: hit, t: look.shield, max: look.shield, at: ev.to });
    if (ev.hullDamage > 0) fight.fx.push({ type: 'sparks', delay: hit, at: ev.to, n: look.sparks(ev) });
    if (ev.to === 'player' && ev.damage > 0) fight.fx.push({ type: 'call', delay: hit, run: () => Feedback.emit('hit', { hull: ev.hullDamage > 0 }) });
    if (look.sum) { if (ev.damage > 0) addDamage(ev.to, ev.damage, ev.hullDamage > 0); }
    else if (ev.damage > 0) fight.fx.push({ type: 'number', delay: hit, t: 1, max: 1, at: ev.to, jx: jitter(), text: `−${Math.round(ev.damage)}${ev.heavy ? '!' : ''}`, color: ev.hullDamage > 0 ? COLORS.flame : COLORS.cyan, big: ev.heavy });
    else fight.fx.push({ type: 'number', delay: hit, t: 0.8, max: 0.8, at: ev.to, jx: jitter(), text: 'miss', color: COLORS.dim });
    if (ev.destroyed) {
      const defender = isDefender(ev.to) && world.scene.get(ev.to);
      const blowUp = ev.to === 'player' ? (landing.on ? () => lostOnSurface('Shot down in the caverns') : playerDestroyed) : wings.has(ev.to) ? () => wingDisabled(ev.to)
        : defender ? () => { explode(defender.x, defender.y, defender.radius); structureDestroyed(defender, { friendly: true }); }
        : isPatrol(ev.to) ? () => patrolDown(ev.to) : () => shipDestroyed(ev.to);
      // An enemy is done for at once, though it blows up a moment later: until then it must not
      // start or join another fight.
      if (ev.to !== 'player' && !wings.has(ev.to) && !defender) fight.dying.add(ev.to);
      if (d + look.finish > 0) fight.fx.push({ type: 'call', delay: d + look.finish, run: blowUp });
      else blowUp();
    }
  }
  fight.log = fightMode().log(s, events, fight.log);
  // What the player feels: the guns locking on, the shields failing, the hull getting low (once a fight).
  const me = s.player;
  for (const ev of events) {
    if (ev.type === 'locked') Feedback.emit('locked');
    if (ev.type === 'shot' && ev.to === 'player' && ev.shieldDamage > 0 && me.shield <= 0) Feedback.emit('shields-down');
  }
  if (me && !fight.lowHull && me.hull > 0 && me.hull < me.stats.hull / 3) { fight.lowHull = true; Feedback.emit('low-hull'); }
}

// Damage numbers that add up: hits on a ship in quick succession show as one growing number.
export function addDamage(id, amount, hull) {
  const f = fight.fx.find((x) => x.type === 'number' && x.at === id && typeof x.sum === 'number' && x.max - x.t < 0.45);
  if (f) {
    f.sum += amount;
    f.text = `−${Math.round(f.sum)}`;
    if (hull) f.color = COLORS.flame;
  } else {
    fight.fx.push({ type: 'number', delay: 0, t: 1, max: 1, at: id, jx: (Math.random() - 0.5) * 24, sum: amount, text: `−${Math.round(amount)}`, color: hull ? COLORS.flame : COLORS.cyan });
  }
}

// Debris and a flash where a ship blew up.
export function explode(x, y, r) {
  burst(x, y, 26 + r, { speed: [60, 320], life: [0.5, 1.6], size: [1.5, 5], colors: [COLORS.flame, COLORS.hostile, COLORS.hud, COLORS.star] });
  fight.fx.push({ type: 'flash', delay: 0, t: 0.5, max: 0.5, at: { x, y, radius: r } });
}

// An enemy destroyed: gone for good, with its loot floating where it was, its cargo paid as credits
// (and now and then a gambit
// in its computer, owned at once: game/vendor.js). One of the pirates' own (a pack's)
// costs regard with them (rules/reputation.js KILL), which ripples to their friends and enemies.
export function shipDestroyed(key) {
  const p = fight.ships.get(key) || fight.lastShips?.get(key);
  if (p?.guardian) { fight.dying.delete(key); explode(p.x, p.y, p.radius); guardianDown(p.guardian, p); settleTally(); return; } // a dungeon's (game/dungeon.js)
  if (p?.structure) { fight.dying.delete(key); explode(p.x, p.y, p.radius * (p.structure.kind === 'turret' ? 1 : 1.8)); structureDestroyed(p.structure); settleTally(); return; } // a station, turret or outpost (game/structures.js)
  const was = world.scene.get(key), elite = trafficShip(key)?.elite ? trafficShip(key) : null;
  if (!cargo.removed.has(key) && was?.pack !== undefined && was.faction !== 'alien') Reputation.change(cargo.rep, Factions.PIRATES, -Reputation.KILL);
  cargo.removed.add(key);
  fight.dying.delete(key);
  if (!p) { settleTally(); saveCargo(); return; }
  explode(p.x, p.y, p.radius);
  if (elite) eliteDown(elite, p); // a named ace (game/traffic.js): its bounty, loot and gambit
  raiderDown(key, p); // a raid's last: where its gear will float (game/traffic.js)
  gainXP(Progress.killXP(p.tier || 1, pilotLevel())); // experience (game/progress.js), the squad's too
  CombatCore.loot(world.galaxy.seed, key, p.role, p.tier).forEach((d, i) => {
    const a = (i / 3) * TAU + Math.random(), r = 20 + Math.random() * 40;
    cargo.drops.push(dropEntity({ key: `drop:${key}:${i}`, kind: d.kind, seed: d.seed, x: p.x + Math.cos(a) * r, y: p.y + Math.sin(a) * r }));
  });
  // A pirate's cargo, as credits (nothing to drag aboard), said with the rest when the fight is won.
  const paid = CombatCore.credits(world.galaxy.seed, key, p.role, p.tier);
  cargo.credits += paid;
  // Now and then gear (rules/loot.js): a fighter's drop table, at its tier.
  const gear = Loot.drops('fighter', key, { level: p.tier || 1, seed: world.galaxy.seed, cls: lootClasses(), pity: cargo.lootPity });
  gear.forEach((spec, i) => {
    tip('drop');
    cargo.drops.push(dropEntity({ key: `loot:${key}:${i}`, loot: spec, seed: spec.seed, x: p.x + (Math.random() - 0.5) * 60, y: p.y + (Math.random() - 0.5) * 60 }));
  });
  lootDropped(gear);
  tallyKill({ credits: paid, loot: gear });
  // Now and then a gambit in its computer (as often as a schematic used to be found), one not owned
  // yet, of up to a tier above its own.
  const g = CombatCore.schematic(world.galaxy.seed, key, p.role, p.tier) && Vendor.gambitDrop(world.galaxy.seed, key, p.tier || 1, ownedGambits());
  if (g && grantGambit(g)) notify(`Gambit recovered: import ${Research.title(g)} · your squad can use it now`, 4, { tone: 'good' });
  settleTally();
  saveCargo();
}

// The player ship destroyed: the cargo spills, and after a moment it's towed home.
export function playerDestroyed() {
  explode(ship.x, ship.y, SHIP.radius * 2);
  Feedback.emit('destroyed');
  const tag = Date.now().toString(36);
  cargo.items.forEach((it, i) => {
    const a = Math.random() * TAU, r = 30 + Math.random() * 90;
    cargo.drops.push(dropEntity({
      key: `lost:${tag}:${i}`, kind: it.kind, seed: (Math.random() * 4294967296) >>> 0,
      x: ship.x + Math.cos(a) * r, y: ship.y + Math.sin(a) * r,
    }));
  });
  cargo.items = [];
  ship.vx = ship.vy = 0;
  ship.targetSpeed = 0;
  ship.thrust = 0;
  fight.wrecked = true;
  saveCargo();
}

// The tow and the patching up are billed (as far as the credits go): a share of the hull's price,
// more the further out it was lost (its system's level: world/galaxy.js).
export const TOW_SHARE = 0.05;
export function towBill() {
  const sys = world.galaxy.systemAt?.(ship.x, ship.y), level = Math.max(1, sys?.level || 1);
  return Math.min(cargo.credits, Math.round((Loadout.HULLS[cargo.loadout.hull]?.price || 0) * TOW_SHARE * level));
}
export function towHome() {
  const bill = towBill();
  cargo.credits -= bill;
  cargo.hull = SHIP.hull; // patched up enough to fly
  guard.shield = SHIP.shield;
  fight.wrecked = false;
  setMode('in-combat', false);
  const home = cargo.home;
  if (home) placeShip(home.x, home.y + home.radius + 220);
  else placeBeside(startStation());
  SystemMap.setPlayer(ship.x, ship.y);
  fight.grace = RESPAWN_GRACE;
  whiteOut();
  showBanner('SHIP LOST', `Towed to ${home ? home.name : startStation().name}${bill ? ` · −${bill.toLocaleString('en-US')} cr` : ''}`, 'hostile', 4.5);
  notify(`Ship lost · towed to ${home ? home.name : startStation().name}${bill ? ` for ${bill.toLocaleString('en-US')} cr` : ''} · your hold is where you left it`, 4, { priority: 2, tone: 'hostile' });
  saveCargo();
}

// What a fight has brought in so far (fight.tally), said as one line when it's won, once the last
// wreck has blown up (the fight is over before they have: settleTally): a short session ends on what
// it earned. tallyKill: one enemy destroyed, its credits and the loot it left (specs).
export function tallyKill({ credits = 0, loot = [] } = {}) {
  const t = fight.tally || (fight.tally = { kills: 0, credits: 0, loot: {} });
  t.kills++;
  t.credits += credits;
  for (const spec of loot) t.loot[spec.rarity] = (t.loot[spec.rarity] || 0) + 1;
}
function settleTally() {
  if (!fight.tallyDue || fight.dying.size) return;
  notify(tallyLine(fight.tally), 4, { priority: 2, tone: 'good' });
  { const [title, ...rest] = tallyLine(fight.tally).split(' · '); showBanner(title.toUpperCase(), rest.join(' · '), 'good'); }
  fight.tally = null;
  fight.tallyDue = false;
}
export function tallyLine(t) {
  if (!t || !t.kills) return 'Victory';
  const loot = [...Loot.RARITIES].reverse().filter((R) => t.loot[R.id]).map((R) => `${t.loot[R.id]} ${R.name}`);
  return ['Victory', `${t.kills} destroyed`, loot.length ? loot.join(', ') : 'no gear', t.credits ? `+${t.credits} credits` : ''].filter(Boolean).join(' · ');
}

export function endFight(result) {
  // After a fight in which they flew, the survivors fly back to their usual paths (tickReturning).
  if (fightMode().flying && fight.final) {
    for (const e of fight.final.enemies) {
      const p = fight.ships.get(e.id);
      if (e.hull <= 0 || !p || !p.motion) continue;
      fight.returning.set(e.id, { x: e.x, y: e.y, vx: e.vx, vy: e.vy, angle: e.angle, a: e.angle, thrust: e.thrust, stats: e.stats, motion: p.motion, t: 0 });
    }
  }
  fight.lastShips = fight.ships; // effects still to play may need the enemies' positions
  fight.ships = new Map();
  fight.result = result;
  fight.resultT = 4;
  if (result === 'lost' && !landing.on) {
    // Controls and the map stay locked until the wreck is towed home (towHome).
    fight.wreckT = 2.6;
  } else {
    setMode('in-combat', false);
  }
  if (result === 'fled') { fight.grace = FLEE_GRACE; notify('Got away', 2.5, { priority: 2 }); }
  if (result === 'won') { fight.tallyDue = true; Feedback.emit('won'); settleTally(); } else fight.tally = null;
  saveCargo();
}

// Pirates that survived a fight in which they flew fly to where their usual path has got to, then carry on
// along it. Once the player is far away they simply rejoin it.
export function tickReturning(dt) {
  for (const [key, b] of fight.returning) {
    const home = { motion: b.motion };
    Scene.pose(home, simTime);
    const d = Math.hypot(home.x - b.x, home.y - b.y);
    b.t += dt;
    if (d < 40 || b.t > 40 || Math.hypot(b.x - ship.x, b.y - ship.y) > NEAR) { fight.returning.delete(key); continue; }

    const speed = Math.min(b.stats.maxSpeed * 0.8, Math.sqrt(b.stats.accel * d) + 120);
    Flight.step(b, b.stats, { targetAngle: Math.atan2(home.y - b.y, home.x - b.x), targetSpeed: speed, mode: 'cruise' }, dt);
    b.a = b.angle;
  }
}

// Rounds, real-time steps, effects and the result panel; runs with the flight simulation.
export function tickFight(dt) {
  fight.grace = Math.max(0, fight.grace - dt);
  for (let i = fight.fx.length - 1; i >= 0; i--) {
    const f = fight.fx[i];
    if (f.delay > 0) { f.delay -= dt; continue; }
    if (f.type === 'call') { fight.fx.splice(i, 1); f.run(); continue; }
    if (f.type === 'sparks') {
      fight.fx.splice(i, 1);
      const at = fxPos(f.at);
      if (at) burst(at.x, at.y, f.n, { speed: [40, 180], life: [0.3, 0.8], size: [1.5, 3.5], colors: [COLORS.flash, COLORS.flame] });
      continue;
    }
    f.t -= dt;
    if (f.t <= 0) fight.fx.splice(i, 1);
  }
  if (fight.wreckT > 0) {
    fight.wreckT -= dt;
    ship.targetSpeed = 0;
    if (fight.wreckT <= 0) { fight.wreckT = 0; towHome(); }
  }
  if (fight.result && !fight.s) {
    fight.resultT -= dt;
    if (fight.resultT <= 0) fight.result = null;
  }
  tickReturning(dt);
  const s = fight.s;
  if (!s) return;
  const m = fightMode();
  if (!m.flying) ship.targetSpeed = 0; // held in place
  // When it isn't steering, the ship turns to face its target.
  const target = fight.ships.get(s.focus), P = pilot();
  if (target && ship.targetSpeed === 0) P.angle = turnToward(P.angle, Math.atan2(target.y - P.y, target.x - P.x), SHIP.turnRate * dt);
  orderSquad(s);
  orderDefenders(s); // station turrets on your side (game/structures.js)
  orderPatrols(s); // patrols on your side (game/traffic.js)
  syncStructures(s);
  const events = m.step(s, dt, P); // the player's ship has already flown this frame (update; on a surface, game/landing.js fly)
  syncAllies(s);
  if (m.flying) {
    for (const e of s.enemies) {
      const p = fight.ships.get(e.id);
      if (p && e.hull > 0) Object.assign(p, { x: e.x, y: e.y, a: e.angle, thrust: e.thrust });
      if (p?.guardian && e.hull > 0) Object.assign(p.guardian, { x: e.x, y: e.y, angle: e.angle }); // a raider stays where the fight left it
    }
  }
  playEvents(s, events);
  // An enemy starting to lock on you (in turns: to charge a heavy shot at you): felt once as it starts.
  for (const it of CombatCore.intents(s)) {
    const on = it.target === 'player' && (it.gauge !== undefined ? it.kind === 'heavy' : it.lock > 0);
    if (on && !fight.lockers.has(it.id)) { fight.lockers.add(it.id); if (it.lock < 1 || it.kind === 'heavy') Feedback.emit('targeted'); }
    else if (!on) fight.lockers.delete(it.id);
  }
  // Hull damage is saved when the fight ends (endFight) or the page is hidden (saveAll), not on
  // every hit: a save writes the whole cargo.
  cargo.hull = Math.max(0, s.player.hull);
  guard.shield = s.player.shield;
  if (s.over) {
    fight.s = null;
    fight.final = s; // shown on the panel until it closes
    endFight(s.over);
  }
}

// An ability (rules/abilities.js) used in the fight under way: a charge from the kit, by the player or
// a squad member, on a combatant (by id), if it's ready. Shown over the target and in the panel's log.
export function useAbility(s, user, id, targetId) {
  const a = Abilities.ABILITIES[id];
  if (!s || s.over || !a) return false;
  // A class skill: the user's class has it (no charges); a consumable: a charge from the kit.
  if (a.skill ? !Classes.skills(user.cls || (user === s.player ? SHIP.cls : null)).includes(id) : (cargo.kit[id] || 0) < 1) return false;
  const target = [s.player, ...(s.allies || []), ...s.enemies].find((c) => c.id === targetId);
  const ev = Abilities.use(user, id, target, s.t);
  if (!ev) return false;
  const who = user === s.player ? 'You' : user.name, on = target === user ? '' : ` on ${target === s.player ? 'you' : target.name}`;
  if (a.skill) {
    if (ev.cast > 0) fight.fx.push({ type: 'number', delay: 0, t: Math.max(0.6, ev.cast), max: Math.max(0.6, ev.cast), at: user.id, jx: 0, text: `${a.name}…`, color: COLORS.cyan });
    if (user === s.player) fightLog(`${a.name}${ev.cast > 0 ? ` · activating ${ev.cast} s` : ''}`);
    Feedback.emit('skill');
    return true;
  }
  addTo(cargo.kit, id, -1);
  saveCargo();
  const friend = a.on === 'friend';
  fight.fx.push({ type: 'number', delay: 0, t: 1.4, max: 1.4, at: target.id, jx: 0, text: ev.amount ? `+${Math.round(ev.amount)}` : a.name, color: friend ? COLORS.good : COLORS.flame });
  fightLog(`${who} used ${a.name}${on}`);
  return true;
}
// A skill landing (rules/abilities.js resolve): what it did, over its target, and a line.
function skillLanded(s, ev) {
  const a = Abilities.ABILITIES[ev.ability];
  if (!a) return;
  const name = (id) => (id === 'player' ? 'you' : ([...(s.allies || []), ...s.enemies].find((c) => c.id === id) || {}).name || '');
  const friendly = a.on !== 'enemy';
  fight.fx.push({ type: 'number', delay: 0, t: 1.4, max: 1.4, at: ev.to, jx: (Math.random() - 0.5) * 20, text: ev.amount ? `+${Math.round(ev.amount)}` : a.name, color: friendly ? COLORS.good : COLORS.flame });
  if (ev.amount !== undefined && ev.ability === 'nanite-field' && ev.to !== ev.from) return; // one line for the whole field
  const who = ev.from === 'player' ? 'You' : name(ev.from), on = ev.to === ev.from ? '' : ` on ${name(ev.to)}`;
  fightLog(`${who}: ${a.name}${on}`);
}

// The player's ability buttons: what each would be used on (yourself, or the enemy you're targeting).
// A Healer's friendly skills go to whoever on your side is worst off (by hull, then shields).
function playerTarget(s, id) {
  const a = Abilities.ABILITIES[id];
  if (a.on === 'self') return s.player.id;
  if (a.on === 'enemy') return s.focus;
  if (!a.skill) return s.player.id;
  const side = [s.player, ...CombatCore.allies(s)], key = id === 'restore' ? (c) => c.shield / Math.max(1, c.stats.shield) : (c) => c.hull / Math.max(1, c.stats.hull);
  return side.reduce((b, c) => (key(c) < key(b) ? c : b)).id;
}
// The player's buttons: the class's three skills (keys 1–3), each with its cooldown, then the kit's
// consumables.
// The party's frames on the combat bar: your ship, then the squad (not the patrols and turrets
// that joined in: they're drawn where they fight).
export function partyFrames(s) {
  const frame = (c, you) => ({
    id: c.id, code: you ? 'YOU' : Classes.CLASSES[Classes.valid(c.cls)].code, you,
    hull: c.hull / Math.max(1, c.stats.hull), shield: c.stats.shield ? c.shield / c.stats.shield : 0,
    text: you ? `${Math.max(0, Math.ceil(c.hull))}${c.stats.shield ? ` · ${Math.max(0, Math.ceil(c.shield))}` : ''}` : '',
  });
  return [frame(s.player, true), ...(s.allies || []).filter((a) => !a.defender && !a.patrol).map((a) => frame(a, false))];
}
export function skillButtons(s) {
  return Classes.skills(SHIP.cls).map((id, i) => {
    const a = Abilities.ABILITIES[id], t = [s.player, ...(s.allies || []), ...s.enemies].find((c) => c.id === playerTarget(s, id));
    const cd = Math.max(0, (s.player.cooldowns?.[id] ?? -Infinity) - s.t), busy = s.player.casting?.id === id;
    return {
      id: `ability:${id}`, code: a.code, label: `${a.name} (${i + 1})`, skill: true, key: String(i + 1),
      badge: busy ? '…' : cd > 0 ? `${Math.ceil(cd)}s` : a.short || a.name.split(' ')[0], cooling: cd > 0 ? cd / a.cooldown : 0, busy,
      enabled: !!t && Abilities.ready(s.player, id, t, s.t),
    };
  });
}
export function abilityButtons(s) {
  return [...skillButtons(s), ...Abilities.LIST.filter((a) => cargo.kit[a.id] > 0).map((a) => {
    const t = [s.player, ...s.enemies].find((c) => c.id === playerTarget(s, a.id));
    return { id: `ability:${a.id}`, code: a.code, label: a.name, count: cargo.kit[a.id], enabled: !!t && Abilities.ready(s.player, a.id, t, s.t) };
  })];
}
// A skill by its key (1–3), in a fight with ships.
export function useSkillKey(n) {
  const s = fight.s, id = s && Classes.skills(SHIP.cls)[n];
  if (!id) return false;
  return useAbility(s, s.player, id, playerTarget(s, id));
}

// Target an enemy (a tap on it, its marker or its row).
export function focusOn(id, manual = true) {
  const s = fight.s;
  if (!s) return;
  fightMode().setFocus(s, id, manual);
}

// The combat bar: the skills and the kit while the fight runs (the outcome is a notice: endFight).
export function updateCombatPanel() {
  if (!fight.s || fight.wrecked) { CombatPanel.hide(); return; }
  CombatPanel.show({ abilities: abilityButtons(fight.s), party: partyFrames(fight.s) });
}

// Where a fight is drawn, in screen px: in space the world through the camera (worldToScreen,
// view.zoom px a unit); on a surface its ground (game/surface-run.js passes its own). The same
// drawing serves both, so a fight looks and reads the same wherever it is.
export const SPACE_VIEW = { at: (x, y) => worldToScreen(x, y), k: () => view.zoom };
// Brackets round a point (screen px): closing in as `open` goes to 0.
function bracketsAt(x, y, R0, open = 0) {
  const R = (R0 + 12) * (1 + open * 0.9), len = Math.min(R * 0.45, 18);
  ctx.beginPath();
  for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    ctx.moveTo(x + sx * R, y + sy * (R - len));
    ctx.lineTo(x + sx * R, y + sy * R);
    ctx.lineTo(x + sx * (R - len), y + sy * R);
  }
  ctx.stroke();
}

// Active (real time): the guns' field of fire ahead of the ship, out to their range; brighter while
// the locked target is inside it. And a faint red line from every enemy that has you in its sights.
function drawFieldOfFire(s, V) {
  const w = SHIP.weapons[0];
  if (!w || fight.wrecked) return;
  const k = V.k(), P = pilot(), me = V.at(P.x, P.y);
  if (!me) return;
  const t = s.enemies.find((e) => e.id === s.focus && e.hull > 0);
  const live = t && s.locked && RealtimeCombat.canFire(s.player, w, t);
  const half = w.arc >= 360 ? Math.PI : (w.arc * Math.PI) / 360;
  const [x, y] = me, R = (w.range + SHIP.radius) * k, angle = s.player.angle ?? P.angle;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.arc(x, y, R, angle - half, angle + half);
  ctx.closePath();
  if (live) {
    ctx.fillStyle = SHOT_COLOR.player;
    ctx.globalAlpha = 0.045;
    ctx.fill();
  }
  ctx.strokeStyle = SHOT_COLOR.player;
  ctx.globalAlpha = live ? 0.32 : 0.16;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([8, 10]);
  ctx.stroke();
  // An enemy locking on: an arc round your ship on its side, growing as the lock comes on.
  ctx.setLineDash([]);
  ctx.strokeStyle = HOSTILE_COLOR;
  ctx.lineWidth = 2.5;
  for (const it of CombatCore.intents(s)) {
    if (it.target !== 'player' || it.lock <= 0 || it.lock >= 1) continue;
    const e = s.enemies.find((c) => c.id === it.id);
    if (!e) continue;
    const a = Math.atan2(e.y - P.y, e.x - P.x), spread = (Math.PI / 4) * it.lock;
    ctx.globalAlpha = 0.35 + 0.4 * it.lock;
    ctx.beginPath();
    ctx.arc(x, y, SHIP.radius * k + 18, a - spread, a + spread);
    ctx.stroke();
  }
  ctx.lineWidth = 1.5;
  ctx.setLineDash([8, 10]);
  ctx.globalAlpha = 0.3;
  for (const e of CombatCore.alive(s)) {
    if (CombatCore.aimAt(s, e) !== s.player) continue; // after a wingman
    if (e.lockT < e.stats.lockTime || !e.stats.weapons.some((ew) => RealtimeCombat.canFire(e, ew, s.player))) continue;
    const q = V.at(e.x, e.y);
    if (!q) continue;
    ctx.beginPath();
    ctx.moveTo(q[0], q[1]);
    ctx.lineTo(x, y);
    ctx.stroke();
  }
  ctx.setLineDash([]);
}

// Turn-based: round every ship in the fight, its action gauge filling (yours cyan, your squad's
// light blue, theirs red); full and out of reach, a dashed ring: holding fire. From each enemy, a
// line to whom it is after, firming up as its turn nears; a heavy shot charging is orange, thicker,
// and pulses as it comes due. Hit its shields down to cancel it.
const HEAVY_COLOR = '#ffa040';
function drawGauges(s, V) {
  const m = fightMode(), k = V.k();
  const ring = (c, color) => {
    const p = fighterPos(c.id), q = p && V.at(p.x, p.y);
    if (!q) return null;
    const g = m.gauge(s, c), R = shownRadius(p) * k + 9, [x, y] = q;
    const col = g.heavy ? HEAVY_COLOR : color;
    ctx.strokeStyle = col;
    ctx.lineWidth = g.heavy ? 3 : 2;
    ctx.globalAlpha = 0.18;
    ctx.beginPath(); ctx.arc(x, y, R, 0, TAU); ctx.stroke();
    ctx.globalAlpha = g.holding ? 0.5 : 0.85;
    if (g.holding) ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.arc(x, y, R, -Math.PI / 2, -Math.PI / 2 + TAU * Math.min(1, g.gauge)); ctx.stroke();
    ctx.setLineDash([]);
    return { q, g };
  };
  const pulse = 0.5 + 0.5 * Math.sin(simTime * 14);
  for (const c of [s.player, ...CombatCore.allies(s)]) ring(c, c === s.player ? SHOT_COLOR.player : SHOT_COLOR.ally);
  for (const e of CombatCore.alive(s)) {
    if (e.passive) continue;
    const r = ring(e, HOSTILE_COLOR);
    if (!r || !r.g.target) continue;
    const to = fighterPos(r.g.target), tq = to && V.at(to.x, to.y);
    if (!tq) continue;
    // The intent line: faint while the gauge is low, firmer as the turn nears; a heavy one always shows.
    const near = Math.max(0, (r.g.gauge - 0.4) / 0.6);
    if (!r.g.heavy && near <= 0) continue;
    ctx.strokeStyle = r.g.heavy ? HEAVY_COLOR : HOSTILE_COLOR;
    ctx.lineWidth = r.g.heavy ? 2.5 : 1.5;
    ctx.globalAlpha = r.g.heavy ? 0.3 + 0.5 * Math.max(near, r.g.gauge > 0.75 ? pulse : 0) : 0.12 + 0.4 * near;
    ctx.setLineDash([10, 8]);
    ctx.lineDashOffset = -simTime * 60;
    ctx.beginPath(); ctx.moveTo(r.q[0], r.q[1]); ctx.lineTo(tq[0], tq[1]); ctx.stroke();
    ctx.setLineDash([]);
    ctx.lineDashOffset = 0;
  }
}

// Breaking away (either mode): a cyan ring round your ship closing as you get clear.
function drawEscape(s, V) {
  const k = Math.min(1, (s.away || 0) / RealtimeCombat.config.escapeTime), P = pilot(), q = V.at(P.x, P.y);
  if (k <= 0 || fight.wrecked || !q) return;
  const R = SHIP.radius * 2.6 * V.k() + 16;
  ctx.strokeStyle = SHOT_COLOR.player;
  ctx.lineWidth = 2.5;
  ctx.globalAlpha = 0.8;
  ctx.beginPath(); ctx.arc(q[0], q[1], R, -Math.PI / 2, -Math.PI / 2 + TAU * k); ctx.stroke();
}

// Beams, shield flashes and explosion flashes; brackets on the target (closing in as the lock comes
// on, in real time). In screen px, through V (SPACE_VIEW, or a surface's).
export function drawFight(V = SPACE_VIEW) {
  const s = fight.s;
  if (V === SPACE_VIEW && landing.on) return; // the surface draws its own (game/surface-run.js)
  const k = V.k();
  ctx.save();
  if (s && fightMode().look.arcs) drawFieldOfFire(s, V);
  if (s && fightMode().look.gauges) drawGauges(s, V);
  if (s) drawEscape(s, V);
  if (s) {
    const f = fighterPos(s.focus), q = f && s.enemies.some((c) => c.id === s.focus && c.hull > 0) && V.at(f.x, f.y);
    if (q) {
      const lock = fightMode().lock(s);
      ctx.strokeStyle = HOSTILE_COLOR;
      ctx.globalAlpha = 0.5 + 0.35 * lock;
      ctx.lineWidth = 2;
      if (lock < 1) ctx.setLineDash([5, 4]);
      bracketsAt(q[0], q[1], shownRadius(f) * k, 1 - lock);
      ctx.setLineDash([]);
    }
  }
  ctx.lineCap = 'round';
  for (const f of fight.fx) {
    if (f.delay > 0 || f.t === undefined) continue;
    const t = f.t / f.max;
    if (f.type === 'beam') {
      // A hit lands on the target; a miss streaks past it.
      const from = fxPos(f.from), to = fxPos(f.to), a = from && V.at(from.x, from.y), b = to && V.at(to.x, to.y);
      if (!a || !b) continue;
      const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
      const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const len = f.hits > 0 ? d - to.radius * k * 0.4 : d + 120 * k;
      const off = f.hits > 0 ? 0 : 0.06;
      const x0 = a[0] + Math.cos(ang) * shownRadius(from) * k, y0 = a[1] + Math.sin(ang) * shownRadius(from) * k;
      const x1 = a[0] + Math.cos(ang + off) * len, y1 = a[1] + Math.sin(ang + off) * len;
      ctx.strokeStyle = f.color;
      ctx.globalAlpha = t * (f.hits > 0 ? 0.3 : 0.12);
      ctx.lineWidth = f.heavy ? 12 : 6;
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
      ctx.globalAlpha = t * (f.hits > 0 ? 0.95 : 0.35);
      ctx.lineWidth = f.heavy ? 3 : 1.6;
      ctx.stroke();
    } else if (f.type === 'shield') {
      const at = fxPos(f.at), q = at && V.at(at.x, at.y);
      if (!q) continue;
      ctx.strokeStyle = COLORS.cyan;
      ctx.globalAlpha = t * 0.8;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(q[0], q[1], (shownRadius(at) + 10 + (1 - t) * 8) * k, 0, TAU);
      ctx.stroke();
    } else if (f.type === 'flash') {
      const q = V.at(f.at.x, f.at.y);
      if (!q) continue;
      ctx.fillStyle = COLORS.flash;
      ctx.globalAlpha = t * 0.6;
      ctx.beginPath();
      ctx.arc(q[0], q[1], f.at.radius * k * (1.5 + (1 - t) * 2.5), 0, TAU);
      ctx.fill();
    }
  }
  ctx.restore();
}

// Damage numbers rising off the ships, and small hull/shield bars and letters above every ship in
// the fight (screen px, through V).
export function drawFightOverlay(V = SPACE_VIEW) {
  const s = fight.s;
  if (V === SPACE_VIEW && landing.on) return;
  const k = V.k();
  const above = (p) => { const q = V.at(p.x, p.y); return q && [q[0], q[1] - shownRadius(p) * k]; };
  ctx.save();
  ctx.font = Theme.font(12);
  ctx.textAlign = 'center';
  if (s) {
    for (const c of [s.player, ...(s.allies || []), ...s.enemies]) {
      if (c.hull <= 0) continue;
      const p = fighterPos(c.id), q = p && above(p);
      if (!q) continue;
      const [x, y] = q;
      const w = 34, top = y - 18;
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = 'rgba(38, 48, 74, 0.9)';
      ctx.fillRect(x - w / 2, top, w, 3);
      ctx.fillRect(x - w / 2, top + 4, w, 3);
      ctx.fillStyle = COLORS.cyan;
      ctx.fillRect(x - w / 2, top, w * (c.stats.shield ? c.shield / c.stats.shield : 0), 3);
      ctx.fillStyle = s.enemies.includes(c) ? HOSTILE_COLOR : COLORS.good;
      ctx.fillRect(x - w / 2, top + 4, w * (c.hull / c.stats.hull), 3);
      // Its letter (several enemies), and in turns what it's charging: a heavy shot and whom at.
      const g = fightMode().gauge && s.enemies.includes(c) ? fightMode().gauge(s, c) : null;
      const letter = s.enemies.includes(c) && s.enemies.length > 1 ? c.name.split(' ').pop() : '';
      if (g && g.heavy) {
        const at = g.target === 'player' ? 'you' : (s.allies || []).find((a) => a.id === g.target)?.name || '';
        ctx.fillStyle = HEAVY_COLOR;
        ctx.fillText(`${letter ? `${letter} · ` : ''}HEAVY → ${at} ${g.eta.toFixed(1)}s`, x, top - 4);
      } else if (letter) {
        ctx.fillStyle = c.id === s.focus ? COLORS.bright : COLORS.neutral;
        ctx.fillText(letter, x, top - 4);
      }
    }
    // Breaking away: how long until you're clear.
    const P = pilot(), q = V.at(P.x, P.y);
    if (s.away > 0 && !fight.wrecked && q) {
      ctx.fillStyle = SHOT_COLOR.player;
      ctx.fillText(`Breaking away ${Math.max(0, RealtimeCombat.config.escapeTime - s.away).toFixed(1)}s`, q[0], q[1] + SHIP.radius * 2.6 * k + 30);
    }
  }
  for (const f of fight.fx) {
    if (f.type !== 'number' || f.delay > 0) continue;
    const at = fxPos(f.at), q = at && V.at(at.x, at.y);
    if (!q) continue;
    const t = f.t / f.max;
    ctx.globalAlpha = Math.min(1, t * 1.6);
    ctx.fillStyle = f.color;
    if (f.big) ctx.font = Theme.font(14);
    ctx.fillText(f.text, q[0] + 14 + (f.jx || 0), q[1] - 26 + (f.dy || 0) - (1 - t) * 26);
    if (f.big) ctx.font = Theme.font(12);
  }
  // A wingman's program line taking over (game/squad.js orderSquad), as code above its bars.
  ctx.font = Theme.font(11);
  for (const f of fight.fx) {
    if (f.type !== 'code') continue;
    const at = fxPos(f.at), q = at && above(at);
    if (!q) continue;
    const [x, y] = q;
    const w = ctx.measureText(f.text).width + 10, top = y - 42;
    ctx.globalAlpha = Math.min(1, (f.t / f.max) * 3);
    ctx.fillStyle = 'rgba(11, 14, 23, 0.85)';
    ctx.fillRect(x - w / 2, top - 11, w, 15);
    ctx.fillStyle = f.idle ? COLORS.dim : COLORS.good;
    ctx.fillText(f.text, x, top);
  }
  ctx.restore();
}

// In a fight, enemies off screen get a red marker at the screen edge pointing their way, with
// their letter and distance (edgeMarkers); a tap on one targets it.
export let foeHits = [];

// Before a fight: over every hostile ship on screen, its level in the colour of how a fight with
// its pack would go (threat: good, amber, hostile), so a pack too strong is seen before it is met
// (notes/review.md). An elite's has a bar over it. Worked out afresh a few times a second.
const marks = { at: -1, list: [] };
export function drawThreatMarks() {
  if (fight.s || landing.on || docked) return;
  const now = performance.now();
  if (now - marks.at > 400) {
    marks.at = now;
    marks.list = frameList.filter((e) => isHostile(e) && e.kind === 'ship' && !cargo.removed.has(e.key) && !fight.dying.has(e.key))
      .map((e) => ({ e, tone: threat(e).tone, level: Progress.foeLevel(e.tier || 1) }));
  }
  if (!marks.list.length) return;
  const tones = { good: COLORS.good, warn: COLORS.amber, hostile: COLORS.hostile };
  ctx.save();
  ctx.font = Theme.font(14);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.shadowColor = 'rgba(0, 0, 0, 0.9)';
  ctx.shadowBlur = 3;
  for (const m of marks.list) {
    if (!visible(m.e)) continue;
    const [sx, sy] = worldToScreen(m.e.x, m.e.y), y = sy - (m.e.hitRadius || m.e.radius || 20) * view.zoom - 10;
    ctx.fillStyle = tones[m.tone] || COLORS.hud;
    ctx.globalAlpha = 1;
    ctx.fillText(`${m.level}`, sx, y);
    const w = ctx.measureText(`${m.level}`).width / 2 + 4;
    ctx.beginPath(); // a chevron either side of the number
    ctx.moveTo(sx - w, y - 10); ctx.lineTo(sx - w - 5, y - 5); ctx.lineTo(sx - w, y);
    ctx.moveTo(sx + w, y - 10); ctx.lineTo(sx + w + 5, y - 5); ctx.lineTo(sx + w, y);
    if (m.e.elite) { ctx.moveTo(sx - w, y - 15); ctx.lineTo(sx + w, y - 15); }
    ctx.strokeStyle = ctx.fillStyle; ctx.lineWidth = 1.5; ctx.stroke();
  }
  ctx.restore();
}

export function drawFoeMarkers() {
  foeHits = [];
  const s = fight.s;
  if (!s || landing.on) return;
  const foes = [];
  for (const e of CombatCore.alive(s)) {
    const p = fight.ships.get(e.id);
    if (!p || visible(p)) continue;
    const label = `${s.enemies.length > 1 ? `${e.name.split(' ').pop()} · ` : ''}${fmtDist(Math.hypot(p.x - ship.x, p.y - ship.y) - p.radius)}`;
    foes.push({ ref: e.id, x: p.x, y: p.y, color: HOSTILE_COLOR, ring: e.id === s.focus ? HOSTILE_COLOR : null, label });
  }
  const top = CombatPanel.top;
  foeHits = edgeMarkers(foes, steady('foes', top === null ? 64 : Math.max(64, view.h - top + 18)), 0.9);
}

// The enemy whose edge marker is under a tap, if any.
export function foeMarkerAt(sx, sy) { return markerAt(foeHits, sx, sy); }
// The enemy under a point of the screen (CSS px) in a fight, in space or on a surface: the nearest
// within its drawn size and a finger's width (TAP px). Its id, or null.
const TAP = 30;
export function foeAt(sx, sy) {
  const s = fight.s;
  if (!s) return null;
  const ground = landing.phase === 'surface' ? surfaceAt(sx, sy) : null;
  let best = null, bd = Infinity;
  for (const c of s.enemies) {
    if (c.hull <= 0) continue;
    const p = fighterPos(c.id);
    if (!p) continue;
    let d, reach;
    if (ground) { d = Math.hypot(ground[0] - p.x, ground[1] - p.y); reach = p.radius + TAP; } else {
      const [x, y] = worldToScreen(p.x, p.y);
      d = Math.hypot(sx - x, sy - y); reach = shownRadius(p) * view.zoom + TAP;
    }
    if (d <= reach && d / reach < bd) { best = c.id; bd = d / reach; }
  }
  return best;
}

// Wiring, run once every module has loaded (src/main.js).
export function init() {
  // Hostile ships can be attacked; any ship can be approached (and followed).
  actions.add({ id: 'attack', kind: 'ship', verb: 'Attack', when: (e) => isHostile(e), range: () => CombatCore.config.engageRange, run: (e) => engage(e) });
  // Every man-made thing can be attacked (game/structures.js): a station, its turrets, an outpost.
  actions.add({ id: 'attack-structure', kind: ['station', 'turret', 'outpost'], verb: 'Attack', when: (e) => isStructure(e) && !e.razed, range: () => CombatCore.config.engageRange, run: (e) => attackStructure(e) });
  setEngage(engageStructures);
  CombatPanel.onButton = (id) => {
    if (fight.s && id.startsWith('ability:')) { const a = id.slice(8); useAbility(fight.s, fight.s.player, a, playerTarget(fight.s, a)); }
  };
  // Keys 1–3: the class's skills, in a fight with ships (the field bar has them otherwise).
  window.addEventListener('keydown', (e) => {
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || !/^[1-3]$/.test(e.key) || !fight.s) return;
    useSkillKey(Number(e.key) - 1);
  });
}
