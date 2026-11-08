// Stations and turrets as things to fight (rules/structures.js): attacking them, their defence
// joining a fight, destroying them and their coming back.
// - Every man-made thing can be attacked: a station, any of its turrets, a mission's outpost. A
//   station and its turrets fight as one: attack one and the rest open fire too. Attacking a
//   faction's station is a hostile act: the first time (this session) it asks again, then costs
//   regard with the owner (rules/structures.js REGARD.strike, rippling like any change), and that
//   station's defence stays hostile to you for the rest of the session (provoked).
// - Hostile structures (a faction that counts you Hostile, a station you've provoked, a mission's
//   outposts) open fire on a ship that comes within their guns' reach, like a pirate pack.
// - Friendly defences help: a fight against hostiles near a station whose owner doesn't count you
//   Hostile has its turrets on your side (fixed allies, firing at the nearest enemy in reach).
// - Destroyed: a faction's turret or station is razed until it's rebuilt (REBUILD, real time; a
//   razed station refuses docking and shows as a wreck); a mission's are gone for good
//   (cargo.removed, which its progress reads). Each drops loot (rules/loot.js SOURCES).
// Part of the flight view; src/main.js starts it.
//
//   isRazed(key), razedFor(key) -> text   structureHostile(e)   tickStructures(list)
//   isStructure(e), structureGroup(e), structureSpec(e), structurePose(e), defenderSpecs(at, foes)
//   attackStructure(e), structureDestroyed(e, o), syncStructures(s), orderDefenders(s), structureAggro(list)

import { CombatCore } from '../combat/combat-core.js';
import { Clock } from '../core/clock.js';
import { Loot } from '../rules/loot.js';
import { Reputation } from '../rules/reputation.js';
import { Structures } from '../rules/structures.js';
import { Factions } from '../world/factions.js';
import { cargo, dropEntity, saveCargo } from './cargo.js';
import { docked } from './docking.js';
import { landing } from './landing.js';
import { NEAR, TAU, fight, notify, ship } from './state.js';
import { world } from './world.js';

export const STRUCTURE_KINDS = ['station', 'turret', 'outpost'];
export const isStructure = (e) => !!e && STRUCTURE_KINDS.includes(e.kind);
// Defences on your side come in from this far from the fight (beyond their own guns' reach they'd do nothing).
export const DEFEND_RANGE = 2600;
// A first attack on a friendly station waits for a second press within this many seconds.
export const CONFIRM = 5;

// Stations whose defence you've attacked this session: hostile to you until the game reloads.
export const provoked = new Set();
let armed = { key: null, until: 0 };

// ---------- Razed and rebuilt ----------

export function isRazed(key) {
  const t = cargo.razed[key];
  if (t === undefined) return false;
  if (t > Clock.now()) return true;
  delete cargo.razed[key];
  return false;
}
// How long until a razed one is back: 'rebuilt in 1 h 12 min'.
export function razedFor(key) {
  const s = Math.max(0, (cargo.razed[key] - Clock.now()) / 1000);
  const h = Math.floor(s / 3600), m = Math.ceil((s % 3600) / 60);
  return `rebuilt in ${h ? `${h} h ` : ''}${m} min`;
}

// The station a structure belongs to (itself for a station or an outpost).
const hostOf = (e) => (e.kind === 'turret' ? e.host : e);
const ownerOf = (e) => (e.kind === 'station' ? e.station.owner : e.owner);

// Hostile to the player now: a mission's outpost and its turrets always; a faction's when the
// faction counts you Hostile (rules/reputation.js), or you've attacked that station this session.
export function structureHostile(e) {
  if (!isStructure(e) || e.razed) return false;
  if (e.kind === 'outpost' || e.raider) return true;
  const host = hostOf(e);
  if (host && provoked.has(host.key)) return true;
  const owner = ownerOf(e);
  return !!Factions.get(owner) && Reputation.tier(Reputation.regard(cargo.rep, owner)).id === 'hostile';
}

// Each frame, for the structures near: whether each is razed (and for how long) and hostile, for
// their cards and drawing (flight/entities.js).
export function tickStructures(list) {
  for (const e of list) {
    if (!isStructure(e)) continue;
    e.razed = e.kind !== 'outpost' && isRazed(e.key) ? razedFor(e.key) : null;
    e.hostile = structureHostile(e);
  }
}

// ---------- In a fight ----------

// A station and its turrets that are still standing (a mission's outpost: its own, by key).
export function structureGroup(e) {
  const host = hostOf(e);
  const standing = (x) => x && !cargo.removed.has(x.key) && !isRazed(x.key) && !fight.dying.has(x.key);
  const list = [host, ...(host?.turrets || [])].filter(standing);
  if (e.kind === 'turret' && !host && standing(e)) list.push(e);
  return list;
}
// How big it is in a fight: a station's core, not its docking arms.
const fightRadius = (e) => (e.kind === 'turret' ? e.radius * 0.8 : e.radius * 0.55);
export function structureStats(e) {
  if (e.stats) return e.stats;
  if (e.kind === 'turret') return Structures.turretStats(e.turretKind, e.tier || 1);
  if (e.kind === 'outpost') return Structures.outpostStats(e.tier || 1);
  return Structures.stationStats(e.tier || 1, e.size === 'capital' ? 'capital' : 'minor');
}
export const structureName = (e) => (e.kind === 'turret' ? `${e.name}${e.host ? ` · ${e.host.name}` : ''}` : e.name);
export const structureSpec = (e) => ({
  id: e.key, name: structureName(e), stats: structureStats(e), fixed: true,
  body: { x: e.x, y: e.y, vx: 0, vy: 0, angle: e.aim || 0, radius: fightRadius(e) },
});
export const structurePose = (e) => ({ x: e.x, y: e.y, a: e.aim || 0, thrust: 0, radius: fightRadius(e), name: structureName(e), structure: e });

// The defences on your side near a fight (anchor: where it is): turrets of stations whose owners
// don't count you Hostile, that you haven't provoked, within DEFEND_RANGE. Their specs, as allies.
export function defenderSpecs(at) {
  if (landing.on) return [];
  const out = [];
  for (const st of world.scene.stations) {
    if (Math.hypot(st.x - at.x, st.y - at.y) > DEFEND_RANGE + 2000 || structureHostile(st) || isRazed(st.key)) continue;
    for (const t of st.turrets) {
      if (isRazed(t.key) || Math.hypot(t.x - at.x, t.y - at.y) > DEFEND_RANGE) continue;
      out.push({ ...structureSpec(t), defender: true });
    }
  }
  return out;
}

// Each step of a fight: structures stay where their orbits have them (a fixed combatant holds its
// `home`), and turrets aim where their guns do.
export function syncStructures(s) {
  const pin = (c, e) => {
    c.home = { x: e.x, y: e.y };
    c.x = e.x; c.y = e.y;
    if (e.kind === 'turret') e.aim = c.angle;
  };
  for (const c of s.enemies) {
    const p = fight.ships.get(c.id);
    if (p && p.structure && c.hull > 0) { pin(c, p.structure); p.x = c.x; p.y = c.y; p.a = c.angle; }
  }
  for (const a of s.allies || []) {
    const e = a.defender && world.scene.get(a.id);
    if (e && a.hull > 0) pin(a, e);
  }
}
// Friendly defences fire at the nearest enemy within their guns' reach.
export function orderDefenders(s) {
  for (const a of s.allies || []) {
    if (!a.defender || a.hull <= 0) continue;
    const reach = Math.max(...a.stats.weapons.map((w) => w.range));
    let best = null, bd = Infinity;
    for (const e of CombatCore.alive(s)) {
      const d = Math.hypot(e.x - a.x, e.y - a.y) - e.radius;
      if (d < bd && d <= reach) { bd = d; best = e; }
    }
    a.order = best ? { target: best.id } : {};
  }
}

// ---------- Attacking ----------

const factionName = (id) => (Factions.get(id) ? Factions.get(id).name.replace(/^The /, '') : 'its owner');

// The Attack button on a station, turret or outpost. A friendly faction's: once to be warned, again
// to open fire (and lose regard with them).
let engageHook = null; // game/combat.js engageStructures (set in its init: the modules import each other)
export function setEngage(fn) { engageHook = fn; }
export function attackStructure(e) {
  if (!isStructure(e) || e.razed || docked || landing.on) return;
  const host = hostOf(e), owner = ownerOf(e);
  if (!structureHostile(e)) {
    const now = Clock.now();
    if (armed.key !== host.key || now > armed.until) {
      armed = { key: host.key, until: now + CONFIRM * 1000 };
      notify(`Attacking ${host.name} turns ${factionName(owner)} against you · Attack again to open fire`, CONFIRM, { tone: 'warn' });
      return;
    }
    armed = { key: null, until: 0 };
    provoked.add(host.key);
    if (Factions.get(owner)) Reputation.change(cargo.rep, owner, -Structures.REGARD.strike);
    saveCargo();
  }
  engageHook?.(e, false);
}

// Hostile structures open fire on a ship within their guns' reach (a fight under way: they join).
export function structureAggro(list, joining) {
  if (docked || landing.on || fight.grace > 0 || fight.wreckT > 0) return;
  for (const e of list) {
    if (!isStructure(e) || !e.hostile || cargo.removed.has(e.key) || fight.dying.has(e.key) || fight.ships.has(e.key)) continue;
    const reach = Math.max(...structureStats(e).weapons.map((w) => w.range)) + 150;
    if (Math.hypot(e.x - ship.x, e.y - ship.y) - fightRadius(e) > reach) continue;
    if (joining) joining(e);
    else { engageHook?.(e, true); return; }
  }
}

// ---------- Destroyed ----------

// A structure destroyed (game/combat.js shipDestroyed, or a defender of yours shot down): razed
// (a faction's) or gone for good (a mission's), its loot floating where it was, and the regard it
// costs with its owner (not for one of your defenders, which the enemy destroyed).
export function structureDestroyed(e, { friendly = false } = {}) {
  const owner = ownerOf(e), faction = !e.raider && e.kind !== 'outpost';
  if (faction) cargo.razed[e.key] = Clock.now() + Structures.REBUILD[e.kind === 'turret' ? 'turret' : 'station'] * 1000;
  else cargo.removed.add(e.key);
  if (friendly) { notify(`${structureName(e)} destroyed`, 2.5, { tone: 'warn' }); saveCargo(); return; }
  if (faction && Factions.get(owner)) Reputation.change(cargo.rep, owner, -Structures.REGARD[e.kind === 'turret' ? 'turret' : 'station']);
  const source = e.kind === 'turret' ? 'turret' : e.kind === 'outpost' ? 'outpost' : 'station';
  const level = e.tier || 1;
  const specs = Loot.drops(source, `${e.key}:${cargo.razed[e.key] || 0}`, { level, seed: world.galaxy.seed, cls: cargo.cls, pity: cargo.lootPity });
  specs.forEach((spec, i) => {
    const a = (i / Math.max(1, specs.length)) * TAU + Math.random(), r = fightRadius(e) + 40 + Math.random() * 60;
    cargo.drops.push(dropEntity({ key: `loot:${e.key}:${Clock.now().toString(36)}:${i}`, loot: spec, seed: spec.seed, x: e.x + Math.cos(a) * r, y: e.y + Math.sin(a) * r }));
  });
  if (e.kind !== 'turret') notify(`${e.name} destroyed${faction ? ` · ${factionName(owner)} will rebuild it` : ''}`, 3.5, { tone: 'good' });
  saveCargo();
}

// Whether a station can be docked at (game/docking.js): not while it's razed.
export const dockBlock = (st) => (isRazed(st.key) ? { ok: false, reason: `Destroyed · ${razedFor(st.key)}` } : null);

// The structures near a point (for tests and the map): those in the scene within range.
export const structuresNear = (x, y, range = NEAR) => world.scene.near(x, y, range).filter((e) => isStructure(e) && Math.hypot(e.x - x, e.y - y) <= range);
