// Combat in flight: engaging and being ambushed, the fight's events as effects, loot, the combat
// panel, and losing the ship. The rules: combat/combat.js (rounds), combat/combat-realtime.js.
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
import { Loadout } from '../rules/loadout.js';
import { Reputation } from '../rules/reputation.js';
import { Research } from '../rules/research.js';
import { CombatPanel } from '../ui/combat-panel.js';
import { SystemMap } from '../ui/map.js';
import { FactionsMenu } from '../ui/factions.js';
import { Settings } from '../ui/settings.js';
import { Factions } from '../world/factions.js';
import { addTo, cargo, dropEntity, saveCargo } from './cargo.js';
import { actions, docked } from './docking.js';
import { landing } from './landing.js';
import { rx, ry, visible } from './draw-world.js';
import { edgeMarkers, markerAt, worldToScreen } from './hud.js';
import { steady } from './input.js';
import { lab } from './lab.js';
import { burst, stopMining } from './mining.js';
import { combatMode } from './options.js';
import { placeBeside, placeShip, startStation } from './outfitting.js';
import { HOSTILE_COLOR, brackets, fmtDist, frameList, isHostile, select } from './selection.js';
import { allySpecs, orderSquad, syncAllies, wingDisabled } from './squad.js';
import { NEAR, SHIP, TAU, autopilot, ctx, fight, fightMode, inFight, notify, setMode, ship, turnToward, view, whiteOut, wings } from './state.js';
import { simTime } from './update.js';
import { world } from './world.js';

// God mode (?dev, for testing dangerous space): the player's ship and the squad's take no damage.
// Enemies still shoot (and their hits still show), but nothing gets through.
export const godMode = Params.has('dev');

// A fight starts from a hostile ship's Attack button, or when pirates catch the ship within
// their aggro range. Every pirate near the one engaged joins in. The combat panel
// (ui/combat-panel.js) shows the state; tap an enemy, or its row, to target it. The Combat setting
// picks how a fight plays:
// - Rounds: the ships stop where they are and every round their weapons fire on their own. You
//   can focus fire or try to flee.
// - Real time: everyone keeps flying. Your guns fire at the locked target while it's in range and
//   inside their arc (the wedge ahead of the ship); when you stop steering, the ship turns to face
//   its target. Pirates flying into range join in. To flee, outfly them.
// Outcomes:
// - won: destroyed ships stay destroyed and leave loot floating,
// - fled: the pirates leave you alone for a while,
// - lost: the cargo spills where the ship was destroyed, and it's towed back to the last
//   station it docked at (or the capital), with the hull patched up.
// Pirates that survive a real-time fight fly back to their usual paths.
export const FLEE_GRACE = 12; // seconds the pirates leave you alone after you get away
export const RESPAWN_GRACE = 8;
export const SHOT_COLOR = { player: COLORS.cyan, ally: '#5ad8ff', enemy: COLORS.hostile };
Theme.onPalette(() => { SHOT_COLOR.enemy = COLORS.hostile; });
export const LETTERS = 'ABCDEFGHIJKL'; // tell same-role ships apart, on the panel and above the ships

// Where a combatant is: the player ship, a wingman, or an enemy's pose.
export function fighterPos(id) {
  if (id === 'player') return { x: ship.x, y: ship.y, radius: SHIP.radius, player: true };
  return fight.ships.get(id) || wings.get(id) || fight.lastShips.get(id) || null;
}
// How far out a combatant is drawn, for what's drawn round it (brackets, shields, bars): ships are
// drawn larger than their size (flight/entities.js SHIP_SCALE), the player's a quarter larger again
// (game/draw-world.js drawShip).
const shownRadius = (p) => p.radius * Entities.SHIP_SCALE * (p.player ? 1.25 : 1);
// Effects are attached to a combatant (by id, so they follow it) or to a fixed point.
export const fxPos = (v) => (typeof v === 'string' ? fighterPos(v) : v);

// An entity's velocity along its usual path, from where it will be a moment later.
export function pathVelocity(e) {
  if (!e.motion) return [0, 0];
  const next = { motion: e.motion };
  Scene.pose(next, simTime + 0.1);
  return [(next.x - e.x) / 0.1, (next.y - e.y) / 0.1];
}

export const shipName = (e, i, n) => (e.android && e.name ? e.name : `${Entities.ROLE_LABEL[e.role] || 'Ship'}${n > 1 ? ` ${LETTERS[i] || i + 1}` : ''}`);
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
  return { id: e.key, name, stats: Loadout.stats(Loadout.npc(e.role, e.tier || 1)), body: { x: e.x, y: e.y, vx, vy, angle: e.a, radius: e.hitRadius || e.radius } };
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
  const theirs = pack.map((e) => ({ stats: Loadout.stats(Loadout.npc(e.role, e.tier || 1)) }));
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

export function engage(target, ambushed = false) {
  if (inFight() || docked || landing.on || !isHostile(target) || fight.dying.has(target.key)) return;
  if (!ambushed && !actions.state('attack', target).ok) return;
  const group = packOf(target);
  const names = group.map((e, i) => shipName(e, i, group.length));
  const rng = mulberry32((Math.random() * 4294967296) >>> 0);
  fight.mode = combatMode.value;
  const m = fightMode();
  const player = {
    id: 'player', name: `${SHIP.name} (you)`, stats: SHIP, hull: cargo.hull,
    body: { x: ship.x, y: ship.y, vx: ship.vx, vy: ship.vy, angle: ship.angle, radius: SHIP.radius },
  };
  fight.s = m.start(rng, player, group.map((e, i) => enemySpec(e, names[i])), { target: target.key, ambushed, allies: allySpecs() });
  if (godMode) for (const c of [fight.s.player, ...(fight.s.allies || [])]) c.invulnerable = true;
  if (!m.flying) ship.targetSpeed = 0;
  fight.ships = new Map(group.map((e, i) => [e.key, heldPose(e, names[i])]));
  for (const e of group) fight.returning.delete(e.key);
  // Who started it: pirates, a job's crew of some other kind, or (in the second opening
  // mission) a named android.
  const attackers = target.android ? `${target.name} attacks!` : `${target.crew || 'Pirates'} attack!`;
  fight.log = [ambushed ? attackers : `You engage the ${names[0]}.`];
  fight.lowHull = false;
  fight.lockers = new Set(); // enemies locking on the player, to buzz once as each starts
  fight.result = null;
  stopMining();
  autopilot.key = null;
  select(null);
  setMode('in-combat', true);
  if (ambushed) notify(attackers, 2, { priority: 2, tone: 'hostile' }); // a fight you start needs no notice: the panel opens
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
  const near = (e) => isHostile(e) && !letsPass(e) && !fight.dying.has(e.key) && Math.hypot(e.x - ship.x, e.y - ship.y) - e.radius <= CombatCore.config.aggroRange;
  if (fight.s && fightMode().join) {
    for (const e of list) if (!fight.ships.has(e.key) && near(e)) joinFight(e);
    return;
  }
  if (inFight() || fight.grace > 0) return;
  for (const e of list) {
    if (near(e)) { engage(e, true); return; }
  }
}

// Show a fight's events as its mode's `look` says (combat/combat-core.js): a beam per shot (a miss streaks
// past), a shield flash, sparks off the hull, damage numbers (one per volley, with misses, or adding
// up on a ship that keeps taking hits) and, when a ship is destroyed, its explosion. Then the
// panel's lines. Effects follow their ship by id; delays stagger a round's volleys.
export function playEvents(s, events) {
  const look = fightMode().look;
  const jitter = () => (Math.random() - 0.5) * 30; // so numbers landing together don't overlap
  for (const ev of events) {
    if (ev.type !== 'shot') continue;
    const d = ev.delay || 0, hit = d + look.after;
    const color = ev.from === 'player' ? SHOT_COLOR.player : wings.has(ev.from) ? SHOT_COLOR.ally : SHOT_COLOR.enemy;
    fight.fx.push({ type: 'beam', delay: d, t: look.beam, max: look.beam, from: ev.from, to: ev.to, hits: ev.hits, color });
    if (ev.shieldDamage > 0) fight.fx.push({ type: 'shield', delay: hit, t: look.shield, max: look.shield, at: ev.to });
    if (ev.hullDamage > 0) fight.fx.push({ type: 'sparks', delay: hit, at: ev.to, n: look.sparks(ev) });
    if (ev.to === 'player' && ev.damage > 0) fight.fx.push({ type: 'call', delay: hit, run: () => Feedback.emit('hit', { hull: ev.hullDamage > 0 }) });
    if (look.sum) { if (ev.damage > 0) addDamage(ev.to, ev.damage, ev.hullDamage > 0); }
    else if (ev.damage > 0) fight.fx.push({ type: 'number', delay: hit, t: 1, max: 1, at: ev.to, jx: jitter(), text: `−${ev.damage}`, color: ev.hullDamage > 0 ? COLORS.flame : COLORS.cyan });
    else fight.fx.push({ type: 'number', delay: hit, t: 0.8, max: 0.8, at: ev.to, jx: jitter(), text: 'miss', color: COLORS.dim });
    if (ev.destroyed) {
      const blowUp = ev.to === 'player' ? playerDestroyed : wings.has(ev.to) ? () => wingDisabled(ev.to) : () => shipDestroyed(ev.to);
      // An enemy is done for at once, though it blows up a moment later: until then it must not
      // start or join another fight.
      if (ev.to !== 'player' && !wings.has(ev.to)) fight.dying.add(ev.to);
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
  const f = fight.fx.find((x) => x.type === 'number' && x.at === id && x.max - x.t < 0.45);
  if (f) {
    f.sum += amount;
    f.text = `−${f.sum}`;
    if (hull) f.color = COLORS.flame;
  } else {
    fight.fx.push({ type: 'number', delay: 0, t: 1, max: 1, at: id, jx: (Math.random() - 0.5) * 24, sum: amount, text: `−${amount}`, color: hull ? COLORS.flame : COLORS.cyan });
  }
}

// Debris and a flash where a ship blew up.
export function explode(x, y, r) {
  burst(x, y, 26 + r, { speed: [60, 320], life: [0.5, 1.6], size: [1.5, 5], colors: [COLORS.flame, COLORS.hostile, COLORS.hud, COLORS.star] });
  fight.fx.push({ type: 'flash', delay: 0, t: 0.5, max: 0.5, at: { x, y, radius: r } });
}

// An enemy destroyed: gone for good, with its loot floating where it was (and now and then a
// schematic: the blueprint for that gear, researched at once). One of the pirates' own (a pack's)
// costs regard with them (rules/reputation.js KILL), which ripples to their friends and enemies.
export function shipDestroyed(key) {
  const p = fight.ships.get(key) || fight.lastShips?.get(key);
  if (!cargo.removed.has(key) && world.scene.get(key)?.pack !== undefined) Reputation.change(cargo.rep, Factions.PIRATES, -Reputation.KILL);
  cargo.removed.add(key);
  fight.dying.delete(key);
  if (!p) { saveCargo(); return; }
  explode(p.x, p.y, p.radius);
  CombatCore.loot(world.galaxy.seed, key, p.role, p.tier).forEach((d, i) => {
    const a = (i / 3) * TAU + Math.random(), r = 20 + Math.random() * 40;
    cargo.drops.push(dropEntity({ key: `drop:${key}:${i}`, kind: d.kind, seed: d.seed, x: p.x + Math.cos(a) * r, y: p.y + Math.sin(a) * r }));
  });
  // A schematic in its computer: the blueprint for that gear, so an assembler can make it.
  const id = CombatCore.schematic(world.galaxy.seed, key, p.role, p.tier);
  const bp = id && Research.blueprintFor(id);
  if (bp && lab.grant(bp)) notify(`Blueprint recovered: ${Loadout.EQUIPMENT[id].name} · assemble it at a shipyard (Production tab)`, 4);
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

export function towHome() {
  cargo.hull = SHIP.hull; // patched up enough to fly
  fight.wrecked = false;
  setMode('in-combat', false);
  const home = cargo.home;
  if (home) placeShip(home.x, home.y + home.radius + 220);
  else placeBeside(startStation());
  SystemMap.setPlayer(ship.x, ship.y);
  fight.grace = RESPAWN_GRACE;
  whiteOut();
  notify(`Ship destroyed · towed to ${home ? home.name : startStation().name}`, 4, { priority: 2, tone: 'hostile' });
  saveCargo();
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
  if (result === 'lost') {
    // Controls and the map stay locked until the wreck is towed home (towHome).
    fight.wreckT = 2.6;
  } else {
    setMode('in-combat', false);
  }
  if (result === 'fled') { fight.grace = FLEE_GRACE; notify('Got away', 2.5, { priority: 2 }); }
  else if (result === 'won') { notify('Victory', 2.5, { priority: 2, tone: 'good' }); Feedback.emit('won'); }
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
    if (fight.resultT <= 0) { fight.result = null; CombatPanel.hide(); }
  }
  tickReturning(dt);
  const s = fight.s;
  if (!s) return;
  const m = fightMode();
  if (!m.flying) ship.targetSpeed = 0; // held in place
  // When it isn't steering, the ship turns to face its target.
  const target = fight.ships.get(s.focus);
  if (target && ship.targetSpeed === 0) ship.angle = turnToward(ship.angle, Math.atan2(target.y - ship.y, target.x - ship.x), SHIP.turnRate * dt);
  orderSquad(s);
  const events = m.step(s, dt, ship); // the player's ship has already flown this frame (update)
  syncAllies(s);
  if (m.flying) {
    for (const e of s.enemies) {
      const p = fight.ships.get(e.id);
      if (p && e.hull > 0) Object.assign(p, { x: e.x, y: e.y, a: e.angle, thrust: e.thrust });
    }
  }
  playEvents(s, events);
  // An enemy starting to lock on you: felt once as it starts.
  for (const it of CombatCore.intents(s)) {
    const on = it.target === 'player' && it.lock > 0;
    if (on && !fight.lockers.has(it.id)) { fight.lockers.add(it.id); if (it.lock < 1) Feedback.emit('targeted'); }
    else if (!on) fight.lockers.delete(it.id);
  }
  // Hull damage is saved when the fight ends (endFight) or the page is hidden (saveAll), not on
  // every hit: a save writes the whole cargo.
  cargo.hull = Math.max(0, s.player.hull);
  if (s.over) {
    fight.s = null;
    fight.final = s; // shown on the panel until it closes
    endFight(s.over);
  }
}

// An ability (rules/abilities.js) used in the fight under way: a charge from the kit, by the player or
// a squad member, on a combatant (by id), if it's ready. Shown over the target and in the panel's log.
export function useAbility(s, user, id, targetId) {
  if (!s || s.over || (cargo.kit[id] || 0) < 1) return false;
  const target = [s.player, ...(s.allies || []), ...s.enemies].find((c) => c.id === targetId);
  const ev = Abilities.use(user, id, target, s.t);
  if (!ev) return false;
  addTo(cargo.kit, id, -1);
  saveCargo();
  const a = Abilities.ABILITIES[id], friend = a.on === 'friend';
  fight.fx.push({ type: 'number', delay: 0, t: 1.4, max: 1.4, at: target.id, jx: 0, text: ev.amount ? `+${Math.round(ev.amount)}` : a.name, color: friend ? COLORS.good : COLORS.flame });
  const who = user === s.player ? 'You' : user.name, on = target === user ? '' : ` on ${target === s.player ? 'you' : target.name}`;
  fightLog(`${who} used ${a.name}${on}`);
  return true;
}
// The player's ability buttons: what each would be used on (yourself, or the enemy you're targeting).
const playerTarget = (s, id) => (Abilities.ABILITIES[id].on === 'friend' ? s.player.id : s.focus);
export function abilityButtons(s) {
  return Abilities.LIST.filter((a) => cargo.kit[a.id] > 0).map((a) => {
    const t = [s.player, ...s.enemies].find((c) => c.id === playerTarget(s, a.id));
    return { id: `ability:${a.id}`, code: a.code, label: a.name, count: cargo.kit[a.id], enabled: Abilities.ready(s.player, a.id, t, s.t) };
  });
}

// Target an enemy (a tap on it, its marker or its row).
export function focusOn(id) {
  const s = fight.s;
  if (!s) return;
  fightMode().setFocus(s, id);
}

export const OUTCOME_TITLE = { won: 'Victory', fled: 'Escaped', lost: 'Ship destroyed' };

// The panel: live during the fight, then the outcome for a few seconds.
export function updateCombatPanel() {
  const s = fight.s || (fight.result ? fight.final : null);
  if (!s) return;
  const over = !fight.s;
  const allies = s.allies || [];
  // Whom each enemy is after, and whether it has locked on yet: shown on its row.
  const aims = new Map(over ? [] : CombatCore.intents(s).map((it) => [it.id, it]));
  const nameOf = (id) => (id === 'player' ? 'you' : (allies.find((a) => a.id === id) || {}).name || '');
  const rows = [s.player, ...allies, ...s.enemies].map((c) => {
    const it = aims.get(c.id);
    return {
      id: c.id, name: c.name, you: c === s.player, ally: allies.includes(c), hull: c.hull, maxHull: c.stats.hull,
      shield: c.shield, maxShield: c.stats.shield, focus: !over && c.id === s.focus,
      run: !over && allies.includes(c) && c.hull > 0 && c.line !== undefined ? (c.line >= 0 ? `L${c.line + 1}` : 'else') : null,
      aim: it && c.hull > 0 ? { at: nameOf(it.target), you: it.target === 'player', locked: it.lock >= 1 } : null,
    };
  });
  const live = over ? { title: OUTCOME_TITLE[fight.result], button: { id: 'close', label: 'Close', enabled: true }, progress: 0 } : fightMode().panel(s);
  CombatPanel.show({ ...live, tone: over ? fight.result : '', rows, log: fight.log.slice(-1), abilities: over ? [] : abilityButtons(s) });
}

// Real time: the guns' field of fire ahead of the ship, out to their range; brighter while the
// locked target is inside it. And a faint red line from every enemy that has you in its sights.
export function drawFieldOfFire(s) {
  const w = SHIP.weapons[0];
  if (!w || fight.wrecked) return;
  const t = s.enemies.find((e) => e.id === s.focus && e.hull > 0);
  const live = t && s.locked && RealtimeCombat.canFire(s.player, w, t);
  const half = w.arc >= 360 ? Math.PI : (w.arc * Math.PI) / 360;
  const x = rx(ship.x), y = ry(ship.y), R = w.range + SHIP.radius;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.arc(x, y, R, ship.angle - half, ship.angle + half);
  ctx.closePath();
  if (live) {
    ctx.fillStyle = SHOT_COLOR.player;
    ctx.globalAlpha = 0.045;
    ctx.fill();
  }
  ctx.strokeStyle = SHOT_COLOR.player;
  ctx.globalAlpha = live ? 0.32 : 0.16;
  ctx.lineWidth = 1.5 / view.zoom;
  ctx.setLineDash([8 / view.zoom, 10 / view.zoom]);
  ctx.stroke();
  // An enemy locking on: an arc round your ship on its side, growing as the lock comes on.
  ctx.setLineDash([]);
  ctx.strokeStyle = HOSTILE_COLOR;
  ctx.lineWidth = 2.5 / view.zoom;
  for (const it of CombatCore.intents(s)) {
    if (it.target !== 'player' || it.lock <= 0 || it.lock >= 1) continue;
    const e = s.enemies.find((c) => c.id === it.id);
    if (!e) continue;
    const a = Math.atan2(e.y - ship.y, e.x - ship.x), spread = (Math.PI / 4) * it.lock;
    ctx.globalAlpha = 0.35 + 0.4 * it.lock;
    ctx.beginPath();
    ctx.arc(x, y, SHIP.radius + 18 / view.zoom, a - spread, a + spread);
    ctx.stroke();
  }
  ctx.lineWidth = 1.5 / view.zoom;
  ctx.setLineDash([8 / view.zoom, 10 / view.zoom]);
  ctx.globalAlpha = 0.3;
  for (const e of CombatCore.alive(s)) {
    if (CombatCore.aimAt(s, e) !== s.player) continue; // after a wingman
    if (e.lockT < e.stats.lockTime || !e.stats.weapons.some((ew) => RealtimeCombat.canFire(e, ew, s.player))) continue;
    ctx.beginPath();
    ctx.moveTo(rx(e.x), ry(e.y));
    ctx.lineTo(x, y);
    ctx.stroke();
  }
  ctx.setLineDash([]);
}

// Beams, shield flashes and explosion flashes, in world space; brackets on the target (closing
// in as the lock comes on, in real time).
export function drawFight() {
  const s = fight.s;
  ctx.save();
  if (s && fightMode().look.arcs) drawFieldOfFire(s);
  if (s) {
    const f = fight.ships.get(s.focus);
    if (f) {
      const lock = fightMode().lock(s);
      ctx.strokeStyle = HOSTILE_COLOR;
      ctx.globalAlpha = 0.5 + 0.35 * lock;
      ctx.lineWidth = 2 / view.zoom;
      if (lock < 1) ctx.setLineDash([5 / view.zoom, 4 / view.zoom]);
      brackets(rx(f.x), ry(f.y), shownRadius(f), { open: 1 - lock });
      ctx.setLineDash([]);
    }
  }
  ctx.lineCap = 'round';
  for (const f of fight.fx) {
    if (f.delay > 0 || f.t === undefined) continue;
    const k = f.t / f.max;
    if (f.type === 'beam') {
      // A hit lands on the target; a miss streaks past it.
      const from = fxPos(f.from), to = fxPos(f.to);
      if (!from || !to) continue;
      const ang = Math.atan2(to.y - from.y, to.x - from.x);
      const d = Math.hypot(to.x - from.x, to.y - from.y);
      const len = f.hits > 0 ? d - to.radius * 0.4 : d + 120;
      const off = f.hits > 0 ? 0 : 0.06;
      const x0 = rx(from.x) + Math.cos(ang) * shownRadius(from), y0 = ry(from.y) + Math.sin(ang) * shownRadius(from);
      const x1 = rx(from.x) + Math.cos(ang + off) * len, y1 = ry(from.y) + Math.sin(ang + off) * len;
      ctx.strokeStyle = f.color;
      ctx.globalAlpha = k * (f.hits > 0 ? 0.3 : 0.12);
      ctx.lineWidth = 6 / view.zoom;
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
      ctx.globalAlpha = k * (f.hits > 0 ? 0.95 : 0.35);
      ctx.lineWidth = 1.6 / view.zoom;
      ctx.stroke();
    } else if (f.type === 'shield') {
      const at = fxPos(f.at);
      if (!at) continue;
      ctx.strokeStyle = COLORS.cyan;
      ctx.globalAlpha = k * 0.8;
      ctx.lineWidth = 2 / view.zoom;
      ctx.beginPath();
      ctx.arc(rx(at.x), ry(at.y), shownRadius(at) + 10 + (1 - k) * 8, 0, TAU);
      ctx.stroke();
    } else if (f.type === 'flash') {
      ctx.fillStyle = COLORS.flash;
      ctx.globalAlpha = k * 0.6;
      ctx.beginPath();
      ctx.arc(rx(f.at.x), ry(f.at.y), f.at.radius * (1.5 + (1 - k) * 2.5), 0, TAU);
      ctx.fill();
    }
  }
  ctx.restore();
}

// In screen space: damage numbers rising off the ships, and small hull/shield bars and letters
// above every ship in the fight.
export function drawFightOverlay() {
  const s = fight.s;
  ctx.save();
  ctx.font = Theme.font(12);
  ctx.textAlign = 'center';
  if (s) {
    for (const c of [s.player, ...(s.allies || []), ...s.enemies]) {
      if (c.hull <= 0) continue;
      const p = fighterPos(c.id);
      if (!p) continue;
      const [x, y] = worldToScreen(p.x, p.y - shownRadius(p));
      const w = 34, top = y - 18;
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = 'rgba(38, 48, 74, 0.9)';
      ctx.fillRect(x - w / 2, top, w, 3);
      ctx.fillRect(x - w / 2, top + 4, w, 3);
      ctx.fillStyle = COLORS.cyan;
      ctx.fillRect(x - w / 2, top, w * (c.stats.shield ? c.shield / c.stats.shield : 0), 3);
      ctx.fillStyle = s.enemies.includes(c) ? HOSTILE_COLOR : COLORS.good;
      ctx.fillRect(x - w / 2, top + 4, w * (c.hull / c.stats.hull), 3);
      if (s.enemies.includes(c) && s.enemies.length > 1) {
        ctx.fillStyle = c.id === s.focus ? COLORS.bright : COLORS.neutral;
        ctx.fillText(c.name.split(' ').pop(), x, top - 4);
      }
    }
  }
  for (const f of fight.fx) {
    if (f.type !== 'number' || f.delay > 0) continue;
    const at = fxPos(f.at);
    if (!at) continue;
    const k = f.t / f.max;
    const [x, y] = worldToScreen(at.x, at.y);
    ctx.globalAlpha = Math.min(1, k * 1.6);
    ctx.fillStyle = f.color;
    ctx.fillText(f.text, x + 14 + (f.jx || 0), y - 26 - (1 - k) * 26);
  }
  // A wingman's program line taking over (game/squad.js orderSquad), as code above its bars.
  ctx.font = Theme.font(11);
  for (const f of fight.fx) {
    if (f.type !== 'code') continue;
    const at = fxPos(f.at);
    if (!at) continue;
    const [x, y] = worldToScreen(at.x, at.y - shownRadius(at));
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

export function drawFoeMarkers() {
  foeHits = [];
  const s = fight.s;
  if (!s) return;
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

// Wiring, run once every module has loaded (src/main.js).
export function init() {
  // Hostile ships can be attacked; any ship can be approached (and followed).
  actions.add({ id: 'attack', kind: 'ship', verb: 'Attack', when: (e) => isHostile(e), range: () => CombatCore.config.engageRange, run: (e) => engage(e) });
  CombatPanel.onFocus = focusOn;
  CombatPanel.onButton = (id) => {
    if (fight.s && id.startsWith('ability:')) { const a = id.slice(8); useAbility(fight.s, fight.s.player, a, playerTarget(fight.s, a)); return; }
    if (fight.s && fightMode().press) fightMode().press(fight.s, id); // Flee
    if (id === 'close') { fight.result = null; CombatPanel.hide(); }
  };
}
