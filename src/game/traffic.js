// The galaxy going about its business round the player, so space feels lived in (notes/roadmap.md):
// - Freighters of each station's owner plying between the stations of the system the ship is in.
// - Patrols: pairs of a faction's fighters, named pilots, circling its stations. A fight with
//   hostiles near one brings it in on your side (as allies: orderPatrols), unless that faction
//   counts you Hostile. One shot down is gone until the traffic is drawn again.
// - Elites: in every system of level 2 and up, one named pirate ace, a tier above the system's
//   pirates and much tougher, with a loot table of its own (rules/loot.js 'elite') and a gambit.
//   Destroyed, another takes its place after ELITE_RESPAWN on the real clock (cargo.world.elites).
// - Raids: now and then (RAID.every on the real clock) a wave of raiders comes for a station in the
//   system the ship is in, announced on the log. Destroy them all for a bounty, experience and gear;
//   left alone, they withdraw after RAID.lasts.
// Built per system as the ship comes into it (and again every hour of the real clock, so what flies
// changes); none of it is saved but the elites' and raids' timers.
//
//   traffic                    { sys, ships: [entity], elite: entity | null, raid: { sys, n, at, station, keys } | null }
//   trafficThings() -> [entity]   what to pose and draw (game/travel.js nearbyEntities)
//   tickTraffic(dt)            each step in open flight (game/update.js)
//   patrolSpecs(at) -> [spec]  patrols near a fight, as allies (game/combat.js engage)
//   orderPatrols(s)            their orders each step: the leader's target, else the nearest enemy
//   trafficShip(id) -> entity | null   a traffic ship by key (fight effects, game/combat.js)
//   patrolDown(id), eliteDown(e, at), raiderDown(key, at)
// Part of the flight view; src/main.js starts it.

import { ArtBlueprints } from '../art/blueprints.js';
import { CombatCore } from '../combat/combat-core.js';
import { Clock } from '../core/clock.js';
import { hashInt, mulberry32, seedToInt } from '../core/rng.js';
import { Entities } from '../flight/entities.js';
import { Loadout } from '../rules/loadout.js';
import { Loot } from '../rules/loot.js';
import { Progress } from '../rules/progress.js';
import { Vendor } from '../rules/vendor.js';
import { Factions } from '../world/factions.js';
import { cargo, lootClasses, pilotLevel, saveCargo, scatterLoot } from './cargo.js';
import { explode } from './combat.js';
import { docked } from './docking.js';
import { landing } from './landing.js';
import { checkMilestones, gainXP, record } from './progress.js';
import { isRazed, structureHostile } from './structures.js';
import { fight, notify, ship } from './state.js';
import { simTime } from './update.js';
import { grantGambit, ownedGambits } from './vendor.js';
import { world } from './world.js';

export const ELITE_RESPAWN = 2 * 3600 * 1000;
export const RAID = { every: 20 * 60 * 1000, lasts: 8 * 60 * 1000, first: 4 * 60 * 1000 };
export const PATROL_RANGE = 4500; // a patrol this close to a fight joins it
const HOUR = 3600 * 1000;
export const ELITE = { hull: 3, shield: 2, damage: 1.5 };

export const traffic = { sys: -1, block: -1, ships: [], elite: null, raid: null };

// Pilots' names: a rank and a short name, from the seed.
const RANKS = ['Lt.', 'Cmdr.', 'Ens.', 'Capt.', 'Sgt.'];
const SYL = ['va', 'ro', 'ke', 'sh', 'ta', 'lin', 'mar', 'dov', 'ri', 'sa', 'en', 'ul', 'quo', 'bel', 'tor', 'na', 'ix', 'yen'];
function pilotName(r) {
  const n = 2 + Math.floor(r() * 2);
  let s = '';
  for (let i = 0; i < n; i++) s += SYL[Math.floor(r() * SYL.length)];
  return s[0].toUpperCase() + s.slice(1);
}
// The elites' epithets.
const EPITHETS = ['the Flayer', 'Blackwake', 'the Knife', 'Ninefingers', 'the Widow', 'Cinderjaw', 'the Quiet', 'Redline', 'the Gaunt', 'Hollowpoint'];

const levelOf = (si) => Math.max(1, Math.min(5, world.galaxy.systems[si]?.level || 1));
const stationsOf = (si) => world.scene.stations.filter((st) => st.station.system === si && !isRazed(st.key));
const cultureOf = (st) => st.art.culture;
function npcStats(role, tier, k = null) {
  const st = Loadout.stats(Loadout.npc(role, tier));
  if (!k) return st;
  return { ...st, hull: Math.round(st.hull * k.hull), shield: Math.round(st.shield * k.shield), firepower: st.firepower * k.damage, weapons: st.weapons.map((w) => ({ ...w, damage: w.damage * k.damage })) };
}

// ---------- Building a system's traffic ----------

function build(si, block) {
  const G = world.galaxy, level = levelOf(si);
  const r = mulberry32(hashInt(seedToInt(String(G.seed)), si, block));
  const stations = stationsOf(si).filter((st) => Factions.get(st.station.owner));
  const ships = [];
  // Freighters between pairs of stations.
  if (stations.length > 1) {
    const n = Math.min(4, 1 + Math.floor(r() * stations.length));
    for (let i = 0; i < n; i++) {
      const a = stations[Math.floor(r() * stations.length)];
      let b = stations[Math.floor(r() * stations.length)];
      if (b === a) b = stations[(stations.indexOf(a) + 1) % stations.length];
      const seed = Math.floor(r() * 1e9), owner = Factions.get(a.station.owner);
      const art = ArtBlueprints.create('freighter', cultureOf(a), seed);
      ships.push({
        kind: 'ship', role: 'freighter', key: `traffic:${si}:${block}:f${i}`, art, radius: art.radius, x: a.x, y: a.y, a: 0, thrust: 0.5, tier: level,
        name: `${owner.name} freighter`, note: `${pilotName(r)}'s freighter · ${owner.name} · bound for ${b.name}`, color: owner.color,
        traffic: { type: 'route', from: a.key, to: b.key, phase: r(), dur: 70 + r() * 60, side: (r() - 0.5) * 600 },
      });
    }
  }
  // A patrol (two fighters) round some of the stations: lawful factions only.
  for (const st of stations) {
    const owner = Factions.get(st.station.owner);
    if (!owner.lawful || r() > 0.6) continue;
    const a0 = r() * Math.PI * 2;
    for (let k = 0; k < 2; k++) {
      const seed = Math.floor(r() * 1e9), art = ArtBlueprints.create(Entities.fighterClass(level, seed), cultureOf(st), seed);
      const name = `${RANKS[Math.floor(r() * RANKS.length)]} ${pilotName(r)}`;
      ships.push({
        kind: 'ship', role: 'fighter', key: `traffic:${si}:${block}:p${st.key}:${k}`, art, radius: art.radius, x: st.x, y: st.y, a: 0, thrust: 0.45, tier: level,
        name, note: `${owner.name} patrol · ${name}`, color: owner.color, patrol: { faction: owner.id, station: st.key }, stats: npcStats('fighter', level),
        traffic: { type: 'orbit', at: st.key, r: st.radius + 900 + k * 120, a0: a0 + k * 0.35, w: 0.05 },
      });
    }
  }
  Object.assign(traffic, { sys: si, block, ships });
}

// The system's elite, if one is due: near one of its packs, a tier above them.
function buildElite(si) {
  traffic.elite = null;
  const level = levelOf(si);
  if (level < 2) return;
  const rec = (cargo.world.elites[si] ||= { n: 0, at: 0 });
  if (Clock.now() < rec.at) return;
  const packs = world.galaxy.packs.filter((k) => k.system === si);
  if (!packs.length) return;
  const r = mulberry32(hashInt(seedToInt(String(world.galaxy.seed)), si, 0xe11e + rec.n));
  const k = packs[Math.floor(r() * packs.length)], tier = Math.min(5, (k.tier || level) + 1), seed = Math.floor(r() * 1e9);
  const art = ArtBlueprints.create('fighter-heavy', k.faction === 'alien' ? world.cultures.alien || world.cultures.pirates : world.cultures.pirates, seed);
  const name = `${pilotName(r)} ${EPITHETS[Math.floor(r() * EPITHETS.length)]}`;
  const e = Entities.fighter({ key: `elite:${si}:${rec.n}`, art, x: k.x + 900, y: k.y - 600, orbit: 700, speed: 60, a0: r() * 6.28, tier });
  traffic.elite = Object.assign(e, { name, crew: `Elite · tier ${tier} · a bounty on its head`, elite: true, stats: npcStats('fighter', tier, ELITE), faction: k.faction || 'drifter' });
}

// ---------- Each step ----------

const byKey = (key) => world.scene.byKey.get(key) || null; // a station, by its key (every frame, for every ship: the scene's index, not a search)
function place(e, t) {
  const fought = fight.s && (fight.s.allies || []).find((c) => c.id === e.key);
  if (fought && Number.isFinite(fought.x)) { Object.assign(e, { x: fought.x, y: fought.y, a: fought.angle, thrust: fought.thrust || 0.5 }); return; }
  const T = e.traffic;
  if (T.type === 'orbit') {
    const st = byKey(T.at);
    if (!st) return;
    const a = T.a0 + t * T.w;
    e.x = st.x + Math.cos(a) * T.r; e.y = st.y + Math.sin(a) * T.r; e.a = a + Math.PI / 2;
    return;
  }
  const A = byKey(T.from), B = byKey(T.to);
  if (!A || !B) return;
  const u = ((t / T.dur + T.phase) % 2 + 2) % 2, back = u > 1, k = back ? 2 - u : u; // there and back again
  const s = k * k * (3 - 2 * k), dx = B.x - A.x, dy = B.y - A.y, len = Math.hypot(dx, dy) || 1;
  const bow = Math.sin(k * Math.PI) * T.side; // a curve, not a straight line through the planets
  e.x = A.x + dx * s - (dy / len) * bow;
  e.y = A.y + dy * s + (dx / len) * bow;
  e.a = Math.atan2(dy, dx) + (back ? Math.PI : 0);
  e.thrust = 0.35 + 0.4 * Math.sin(k * Math.PI);
}

export function tickTraffic() {
  if (!world.galaxy || docked || landing.on) return;
  const sys = world.galaxy.systemAt?.(ship.x, ship.y), si = sys ? sys.index : -1, block = Math.floor(Clock.now() / HOUR);
  if (si !== traffic.sys || (block !== traffic.block && !fight.s)) {
    if (si < 0) Object.assign(traffic, { sys: -1, block, ships: [], elite: null });
    else { build(si, block); buildElite(si); }
  }
  if (!traffic.elite && si >= 0 && (cargo.world.elites[si]?.at || 0) <= Clock.now() && levelOf(si) >= 2 && !fight.s) buildElite(si);
  for (const e of traffic.ships) place(e, simTime);
  tickRaid(si);
}

// ---------- Raids ----------

function tickRaid(si) {
  const R = cargo.world.raids, now = Clock.now();
  if (!R.next) R.next = now + RAID.first;
  const raid = traffic.raid;
  if (raid) {
    const left = raid.keys.filter((k) => !cargo.removed.has(k));
    if (!left.length) { raidWon(raid); return; }
    if (now > raid.at + RAID.lasts && !fight.s) {
      notify(`The raiders at ${raid.station.name} withdrew`, 3, { tone: 'warn' });
      traffic.raid = null;
    }
    return;
  }
  if (now < R.next || si < 0 || fight.s) return;
  R.next = now + RAID.every;
  const stations = stationsOf(si).filter((st) => Factions.get(st.station.owner)?.lawful);
  if (!stations.length) return;
  const r = mulberry32(hashInt(seedToInt(String(world.galaxy.seed)), si, ++R.n));
  const st = stations[Math.floor(r() * stations.length)], level = levelOf(si), n = 2 + Math.min(3, level);
  const a = r() * Math.PI * 2, cx = st.x + Math.cos(a) * (st.radius + 1800), cy = st.y + Math.sin(a) * (st.radius + 1800);
  const ships = [];
  for (let i = 0; i < n; i++) {
    const seed = Math.floor(r() * 1e9), art = ArtBlueprints.create(Entities.fighterClass(level, seed), world.cultures.pirates, seed);
    ships.push({ ...Entities.fighter({ key: `raid:${si}:${R.n}:${i}`, art, x: cx, y: cy, orbit: 260 + r() * 220, speed: 90 + r() * 40, a0: r() * 6.28, tier: level }), crew: `Raiders · attacking ${st.name}`, raid: true });
  }
  traffic.raid = { sys: si, n: R.n, at: now, station: st, ships, keys: ships.map((e) => e.key), level };
  notify(`Raiders are attacking ${st.name} · destroy them for a bounty`, 5, { tone: 'hostile' });
  saveCargo();
}
function raidWon(raid) {
  traffic.raid = null;
  record('raids');
  const bounty = 300 * raid.level * raid.keys.length;
  cargo.credits += bounty;
  notify(`${raid.station.name} is safe · ${bounty.toLocaleString('en-US')} cr bounty`, 4, { tone: 'good' });
  gainXP(Progress.contractXP('hard', pilotLevel(), raid.level), 'the raid beaten off');
  // Its gear floats where the last raider went down (raiderDown), or by the station.
  const at = raid.wreck || raid.station;
  scatterLoot(Loot.drops('mission', `raid:${raid.sys}:${raid.n}`, { level: raid.level, floor: 'uncommon', seed: world.galaxy.seed, cls: lootClasses(), pity: cargo.lootPity }), at.x, at.y, `raid:${raid.sys}:${raid.n}`);
  saveCargo();
}

// ---------- In a fight ----------

// What there is to draw and fight: the traffic, the elite and a raid's ships still flying.
export function trafficThings() {
  const out = traffic.ships.slice();
  if (traffic.elite && !cargo.removed.has(traffic.elite.key)) out.push(traffic.elite);
  if (traffic.raid) for (const e of traffic.raid.ships) if (!cargo.removed.has(e.key)) out.push(e);
  return out;
}
export const trafficShip = (id) => trafficThings().find((e) => e.key === id) || null;

// Patrols near a fight (at: where it is) whose faction doesn't count you Hostile, as allies.
export function patrolSpecs(at) {
  if (landing.on) return [];
  return traffic.ships.filter((e) => e.patrol && Math.hypot(e.x - at.x, e.y - at.y) <= PATROL_RANGE && !structureHostile(byKey(e.patrol.station) || { owner: e.patrol.faction }))
    .map((e) => ({ id: e.key, name: e.name, stats: e.stats, patrol: true, body: { x: e.x, y: e.y, vx: 0, vy: 0, angle: e.a, radius: e.radius } }));
}
// A patrol fights the leader's target, or else the nearest enemy.
export function orderPatrols(s) {
  for (const a of s.allies || []) {
    if (!a.patrol || a.hull <= 0) continue;
    const alive = CombatCore.alive(s);
    const focus = alive.find((e) => e.id === s.focus);
    let best = focus || null, bd = Infinity;
    if (!best) for (const e of alive) { const d = Math.hypot(e.x - a.x, e.y - a.y); if (d < bd) { bd = d; best = e; } }
    a.order = best ? { target: best.id } : {};
  }
}
export function patrolDown(id) {
  const i = traffic.ships.findIndex((e) => e.key === id);
  if (i < 0) return;
  const e = traffic.ships[i];
  explode(e.x, e.y, e.radius);
  notify(`${e.name} is down`, 2.5, { tone: 'warn' });
  traffic.ships.splice(i, 1);
}

// A raider destroyed (game/combat.js shipDestroyed, at its wreck { x, y }): where the raid's gear
// will float if it was the last.
export function raiderDown(key, at) {
  if (traffic.raid?.keys.includes(key)) traffic.raid.wreck = { x: at.x, y: at.y };
}

// An elite destroyed (at its wreck { x, y }): its own loot floating there, a gambit, a bounty, and
// another one due after a while.
export function eliteDown(e, at = e) {
  const si = traffic.sys, rec = (cargo.world.elites[si] ||= { n: 0, at: 0 });
  rec.n++;
  rec.at = Clock.now() + ELITE_RESPAWN;
  traffic.elite = null;
  const bounty = 1500 * levelOf(si);
  cargo.credits += bounty;
  notify(`${e.name} destroyed · ${bounty.toLocaleString('en-US')} cr bounty`, 4, { tone: 'good' });
  gainXP(Progress.wardenXP(levelOf(si)) / 2, '');
  scatterLoot(Loot.drops('elite', e.key, { level: e.tier, seed: world.galaxy.seed, cls: lootClasses(), pity: cargo.lootPity }), at.x, at.y, `elite:${e.key}`);
  const g = Vendor.gambitDrop(world.galaxy.seed, `${e.key}:gambit`, levelOf(si), ownedGambits());
  if (g && grantGambit(g)) notify(`Gambit recovered from ${e.name}: ${Vendor.gambitName(g)}`, 4, { tone: 'good' });
  checkMilestones(); // the elites' (rules/log.js)
  saveCargo();
}
