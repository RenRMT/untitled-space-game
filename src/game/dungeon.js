// The test dungeon (a trial of a surface to explore rather than a site to mine round): one planet
// in the start system (DUNGEON) whose surface is a labyrinth of caverns (art/surface.js o.dungeon,
// on the 'cavern' ground): chambers cut into solid rock, joined by winding passages, the landing
// spot in a chamber by its south edge and the deepest chamber (role 'deep', the most passages
// away) kept for a boss one day. There are no hazards down there (dungeonSite); nodes lie about
// the chambers and passages as on any surface, and Take off (its button, or T) is the way out,
// with no rim to fly past.
// The minimap is the cave as charted round the ship: what's come within SIGHT of it as it flies,
// afresh on each landing; the chambers visited are counted on the HUD.
//
//   DUNGEON, isDungeon(e)       which planet: the start system's planet of this type
//   dungeonSite(site)           a site (rules/hazards.js surface) with its hazards taken off
//   dungeonOpts(size)           the options its surface is generated with (game/landing.js)
//   dungeonRun                  { W, seen (tiles charted), visited (rooms by index), map (canvas) }
//   enterDungeon(W), tickDungeon(C), dungeonLines(), drawDungeonMinimap(box, C, marks)
// Part of the flight view (game/landing.js, game/surface-run.js use it).

import { ArtBlueprints } from '../art/blueprints.js';
import { Art } from '../art/render.js';
import { ArtSurface } from '../art/surface.js';
import { SurfaceGlobe } from '../art/surface-globe.js';
import { CombatCore } from '../combat/combat-core.js';
import { Params } from '../core/store.js';
import { hashInt, mulberry32 } from '../core/rng.js';
import { COLORS } from '../core/theme.js';
import { Entities } from '../flight/entities.js';
import { Loadout } from '../rules/loadout.js';
import { addTo, cargo, saveCargo } from './cargo.js';
import { engageOnSurface } from './combat.js';
import { artStyle } from './options.js';
import { clamp, ctx, fight, notify } from './state.js';
import { leave } from './surface-run.js';
import { world } from './world.js';

// Every planet and moon is a dungeon now: landing puts the ship in a labyrinth of caverns, guarded,
// with a boss in its deepest chamber. ?sites brings back the landing sites of the surface run
// (game/surface-run.js), with this one planet still a labyrinth, as the test dungeon was.
export const landingSites = Params.has('sites');
// Zantal VI in the default galaxy: the blue giant (its surface otherwise the Terran one, its rules a
// gas giant's), which no other test or mission lands on.
export const DUNGEON = { system: 0, type: 'blue', rooms: 16 };
export function isDungeon(e) {
  if (!e || (e.kind !== 'planet' && e.kind !== 'moon')) return false;
  if (!landingSites) return true;
  if (e.kind !== 'planet') return false;
  const p = world.galaxy.planets.find((q) => q.name === e.key);
  return !!p && p.system === DUNGEON.system && p.type === DUNGEON.type;
}

// No heat, day side, radiation, dust, vents or storm pockets; ordinary gravity; rock to mine.
export const dungeonSite = (site) => ({
  ...site, label: 'Caverns', tag: 'Caverns', hazard: 'No hazards: a labyrinth to explore', dungeon: true,
  heat: 0, day: 0, rad: 0, gravity: 1, fuelBurn: 1, dust: false, vents: false, pockets: false,
  material: 'rock', rich: 1.5, deposits: [['iron', 2], ['rare-earths', 1], ['tungsten', 1]],
});

// The level of a body's dungeon: its system's (world/galaxy.js: 1 in Wedge space .. 5 the aliens').
export function bodyLevel(e) {
  const G = world.galaxy, b = e && (G.planets.find((q) => q.name === e.key) || G.moons.find((m) => m.name === e.key));
  return clamp((b && G.systems[b.system]?.level) || 1, 1, 5);
}
// The labyrinth fills the middle of the surface, a margin of solid rock round it; the harder the
// system, the more chambers (the test dungeon keeps its sixteen).
export const dungeonOpts = (size, e) => {
  const m = Math.round(size * 0.16), rooms = landingSites || !e ? DUNGEON.rooms : 9 + bodyLevel(e);
  return { w: size, h: size, dungeon: { area: [m, m, size - m, size - m], rooms }, tall: 0.015 };
};

// ---------- Guardians ----------
// Sentinels hold the chambers, a Warden the deepest: turrets that never move, waking when the ship
// comes within SENSE of one (and every guardian within ROUSE of it with it), fought in real time
// (game/combat.js engageOnSurface). Their gear goes by the dungeon's level; the aliens' are their
// own. Each landing finds them afresh. Destroyed, they leave loot lying (rules/goods.js goods and
// components, CombatCore.loot) and now and then a piece of gear; the Warden always some gear, of a
// tier above the level, and a bounty.
export const GUARD = { sense: 430, rouse: 700, range: 520, gear: 0.15, bounty: 450 };
const BOSS = { hull: 7, shield: 3, damage: 1.5, size: 2 };
const SENTINEL = { hull: 1.6, shield: 1.2, damage: 0.9, size: 1 };
export function guardianStats(tier, boss, alien) {
  const st = Loadout.stats(Loadout.npc('fighter', tier)), k = boss ? BOSS : SENTINEL, a = alien ? 1.25 : 1;
  const weapons = st.weapons.map((w) => ({ ...w, arc: 360, damage: Math.round(w.damage * k.damage * a * 10) / 10, range: Math.min(w.range, GUARD.range) }));
  const all = boss ? [...weapons, { ...weapons[0], fireRate: weapons[0].fireRate * 0.5, damage: weapons[0].damage * 2 }] : weapons;
  return {
    ...st, name: boss ? 'Warden' : 'Sentinel', hull: Math.round(st.hull * k.hull * a), shield: Math.round(st.shield * k.shield * a),
    weapons: all, firepower: all.reduce((n, w) => n + w.damage * w.fireRate, 0), evasion: 0,
  };
}
// The guardians for this landing: in each chamber a hop or more from the landing spot, most of
// them, one or two; in the deepest the Warden and two sentinels.
function placeGuardians(W, e, field) {
  const level = bodyLevel(e), G = world.galaxy, b = G.planets.find((q) => q.name === e.key) || G.moons.find((m) => m.name === e.key);
  const alien = (b && G.systems[b.system]?.faction) === 'alien';
  const culture = alien ? world.cultures.alien || world.cultures.pirates : world.cultures.pirates;
  const r = mulberry32(hashInt(field >>> 0, level, 0x6a4d));
  const out = [];
  const add = (room, boss, i) => {
    const tier = clamp(level + (boss ? 1 : 0), 1, 5), seed = (r() * 4294967296) >>> 0;
    const art = ArtBlueprints.create(boss ? 'fighter-heavy' : Entities.fighterClass(tier, seed), culture, seed);
    const a = r() * Math.PI * 2, d = boss && !i ? 0 : room.r * (0.35 + r() * 0.3);
    const size = (boss && !i ? BOSS : SENTINEL).size;
    out.push({
      key: `${e.key}:guard:${field}:${out.length}`, name: boss && !i ? `${alien ? 'Alien ' : ''}Warden` : `${alien ? 'Alien sentinel' : 'Sentinel'}`,
      boss: boss && !i, tier, art, radius: art.radius * size, size, x: room.x + Math.cos(a) * d, y: room.y + Math.sin(a) * d,
      angle: r() * Math.PI * 2, stats: guardianStats(tier, boss && !i, alien), alive: true, room: room,
    });
  };
  for (const room of W.dungeon.rooms) {
    if (room.role === 'start') continue;
    if (room.role === 'deep') { for (let i = 0; i < 3; i++) add(room, true, i); continue; }
    if ((room.hops || 0) < 1 || r() < 0.3) continue;
    const n = 1 + (r() < 0.25 + 0.1 * level ? 1 : 0);
    for (let i = 0; i < n; i++) add(room, false, i);
  }
  return out;
}
const living = () => dungeonRun.guards.filter((g) => g.alive);
// Each step on the surface: guardians the ship comes near wake, and those near them with them.
export function tickGuardians(C) {
  if (!dungeonRun.W || !dungeonRun.guards.length) return;
  const near = living().filter((g) => Math.hypot(C.x - g.x, C.y - g.y) - g.radius <= GUARD.sense && !fight.ships.has(g.key));
  if (!near.length) return;
  const group = living().filter((g) => !fight.ships.has(g.key) && near.some((n) => Math.hypot(n.x - g.x, n.y - g.y) <= GUARD.rouse));
  engageOnSurface(group);
}
// One destroyed (game/combat.js shipDestroyed): its loot on the ground, gear into the spare gear,
// the Warden's bounty.
export function guardianDown(g) {
  if (!g.alive) return;
  g.alive = false;
  const R = dungeonRun, level = bodyLevel(R.e);
  const drops = CombatCore.loot(world.galaxy.seed ^ (R.field >>> 0), g.key, 'fighter', clamp(g.tier, 1, 4)).map((d) => d.kind);
  if (g.boss) drops.push(...CombatCore.loot(world.galaxy.seed, `${g.key}:hoard`, 'fighter', 4).map((d) => d.kind));
  if (drops.length) leave(drops, g.x, g.y, `loot:${g.key}`, 30 * g.size);
  const r = mulberry32(hashInt(R.field >>> 0, R.guards.indexOf(g), 0x9ea2));
  if (g.boss || r() < GUARD.gear) {
    const tier = clamp(level + (g.boss ? 1 : 0), 1, 5);
    const ids = Object.keys(Loadout.EQUIPMENT).filter((id) => !Loadout.EQUIPMENT[id].npc && Loadout.EQUIPMENT[id].tier === tier);
    const id = ids[Math.floor(r() * ids.length)];
    if (id) { addTo(cargo.gear, id); notify(`Loot: ${Loadout.EQUIPMENT[id].name} · in your spare gear`, 4, { tone: 'good' }); }
  }
  if (g.boss) {
    const bounty = GUARD.bounty * level;
    cargo.credits += bounty;
    R.bossDown = true;
    notify(`The ${g.name} is destroyed · ${bounty} credits salvaged from its core`, 4, { tone: 'good' });
  }
  saveCargo();
}

// The guardians, over the ground where it's charted (drawn as the ship is, with the landed view's transform).
export function drawGuardians(v, zoom, dpr, time) {
  const R = dungeonRun;
  if (!R.W) return;
  const style = artStyle.value;
  for (const g of R.guards) {
    if (!g.alive || !charted(g.x, g.y)) continue;
    const pose = fight.ships.get(g.key), p = SurfaceGlobe.toScreen(v, pose ? pose.x : g.x, pose ? pose.y : g.y, ArtSurface.FLY);
    if (!p) continue;
    const k = (g.radius * Entities.SHIP_SCALE) / g.art.radius;
    ctx.save();
    ctx.setTransform(dpr * zoom, 0, 0, dpr * zoom, 0, 0);
    ctx.translate(p[0], p[1]);
    ctx.save();
    ctx.scale(k, k);
    Art.drawAsset(ctx, g.art, style, { angle: pose ? pose.a : g.angle, t: time });
    ctx.restore();
    // Its hull, once it's in a fight.
    const c = fight.s && fight.s.enemies.find((x) => x.id === g.key);
    if (c && c.hull > 0) {
      const w = g.radius * 2.2, y = -g.radius * 1.6 - 6;
      ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
      ctx.fillRect(-w / 2, y, w, 4);
      ctx.fillStyle = g.boss ? COLORS.hostile : COLORS.flame;
      ctx.fillRect(-w / 2, y, w * clamp(c.hull / c.stats.hull, 0, 1), 4);
    }
    ctx.restore();
  }
}

const SIGHT = 7; // tiles round the ship charted as it flies
const WINDOW = 48; // tiles across the minimap, round the ship
const PX = 2; // map pixels per tile
export const dungeonRun = { W: null, e: null, field: 0, seen: null, visited: new Set(), map: null, at: -1, guards: [], bossDown: false };

export function enterDungeon(W, e = null, field = 0) {
  const [a0, b0, a1, b1] = W.dungeon.area, map = document.createElement('canvas');
  map.width = (a1 - a0) * PX;
  map.height = (b1 - b0) * PX;
  Object.assign(dungeonRun, { W, e, field, seen: new Uint8Array(W.w * W.h), visited: new Set(), map, at: -1, guards: [], bossDown: false });
  // Guardians in every dungeon but the test one (?sites keeps it as it was: empty).
  if (e && !landingSites) dungeonRun.guards = placeGuardians(W, e, field);
}

// Open: a tile with any corner below the cave walls.
const openTile = (C, i, j) => !(C[i][j] && C[i + 1][j] && C[i][j + 1] && C[i + 1][j + 1]);

// Charts what's round the ship, and notes the chambers it comes into.
export function tickDungeon(C) {
  const R = dungeonRun, W = R.W;
  if (!W) return;
  const T = ArtSurface.T, ti = Math.floor(C.x / T), tj = Math.floor(C.y / T), at = tj * W.w + ti;
  if (at !== R.at) {
    R.at = at;
    const [a0, b0] = W.dungeon.area, g = R.map.getContext('2d');
    g.fillStyle = '#6a7fae';
    for (let i = ti - SIGHT; i <= ti + SIGHT; i++) for (let j = tj - SIGHT; j <= tj + SIGHT; j++) {
      if (i < 0 || j < 0 || i >= W.w || j >= W.h || (i - ti) ** 2 + (j - tj) ** 2 > SIGHT * SIGHT || R.seen[j * W.w + i]) continue;
      R.seen[j * W.w + i] = 1;
      if (openTile(W.C, i, j)) g.fillRect((i - a0) * PX, (j - b0) * PX, PX, PX);
    }
  }
  W.dungeon.rooms.forEach((r, k) => {
    if (R.visited.has(k) || Math.hypot(C.x - r.x, C.y - r.y) > r.r) return;
    R.visited.add(k);
    if (r.role === 'deep') notify(R.guards.length ? (R.bossDown ? 'The deepest chamber · its Warden destroyed' : 'The deepest chamber · the Warden waits') : 'The deepest chamber · empty, for now', 3.5, { tone: 'warn' });
    else if (r.role !== 'start') notify(`Chamber ${R.visited.size} of ${W.dungeon.rooms.length} found`, 2);
  });
}

// Whether a point of the surface has been charted.
export const charted = (x, y) => {
  const R = dungeonRun, W = R.W, T = ArtSurface.T, i = Math.floor(x / T), j = Math.floor(y / T);
  return !!W && i >= 0 && j >= 0 && i < W.w && j < W.h && !!R.seen[j * W.w + i];
};

export function dungeonLines() {
  const R = dungeonRun, W = R.W;
  if (!W) return [];
  const rooms = W.dungeon.rooms, deep = rooms.findIndex((r) => r.role === 'deep');
  const lines = [[`CHAMBERS ${R.visited.size}/${rooms.length} · ${R.visited.has(deep) ? 'the deepest found' : 'the deepest still ahead'} · Take off (T) to leave`, COLORS.hud]];
  if (R.guards.length) {
    const left = R.guards.filter((g) => g.alive && !g.boss).length;
    lines.push([`LEVEL ${bodyLevel(R.e)} · ${left} sentinel${left === 1 ? '' : 's'} left · ${R.bossDown ? 'Warden destroyed' : 'the Warden in the deepest chamber'}`, R.bossDown ? COLORS.good : COLORS.amber]);
  }
  return lines;
}

// The minimap: the labyrinth as charted, WINDOW tiles of it round the ship (kept inside its area);
// the deepest chamber once charted, the nodes and what lies about where it's charted, and the ship.
export function drawDungeonMinimap({ x: x0, y: y0, size }, C, marks) {
  const R = dungeonRun, W = R.W;
  if (!W) return;
  const T = ArtSurface.T, [a0, b0, a1, b1] = W.dungeon.area;
  const sw = Math.min(WINDOW, a1 - a0), sh = Math.min(WINDOW, b1 - b0), span = Math.max(sw, sh);
  const wx = clamp(C.x / T - sw / 2, a0, a1 - sw), wy = clamp(C.y / T - sh / 2, b0, b1 - sh);
  const k = (size - 8) / (span * T), ox = x0 + 4, oy = y0 + 4;
  const to = (x, y) => [ox + (x - wx * T) * k, oy + (y - wy * T) * k];
  ctx.save();
  ctx.fillStyle = 'rgba(5, 6, 10, 0.85)';
  ctx.fillRect(x0, y0, size, size);
  ctx.strokeStyle = COLORS.planet;
  ctx.globalAlpha = 0.6;
  ctx.lineWidth = 1;
  ctx.strokeRect(x0 + 0.5, y0 + 0.5, size - 1, size - 1);
  ctx.globalAlpha = 1;
  ctx.beginPath();
  ctx.rect(x0, y0, size, size);
  ctx.clip();
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(R.map, (wx - a0) * PX, (wy - b0) * PX, sw * PX, sh * PX, ox, oy, sw * T * k, sh * T * k);
  ctx.imageSmoothingEnabled = true;
  for (const r of W.dungeon.rooms) {
    if (r.role !== 'deep' || !charted(r.x, r.y)) continue;
    const [px, py] = to(r.x, r.y);
    ctx.strokeStyle = COLORS.hostile;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(px, py, Math.max(4, r.r * k), 0, Math.PI * 2);
    ctx.stroke();
  }
  for (const g of R.guards) {
    if (!g.alive || !charted(g.x, g.y)) continue;
    const [px, py] = to(g.x, g.y);
    ctx.fillStyle = COLORS.hostile;
    ctx.beginPath();
    ctx.arc(px, py, g.boss ? 3.5 : 2, 0, Math.PI * 2);
    ctx.fill();
  }
  for (const m of marks) {
    if (!charted(m.x, m.y)) continue;
    const [px, py] = to(m.x, m.y);
    ctx.fillStyle = m.color;
    ctx.fillRect(px - m.r * 0.6, py - m.r * 0.6, m.r * 1.2, m.r * 1.2);
  }
  const [px, py] = to(C.x, C.y);
  ctx.translate(px, py);
  ctx.rotate(C.angle);
  ctx.fillStyle = COLORS.cyan;
  ctx.strokeStyle = COLORS.bg;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(5, 0);
  ctx.lineTo(-3, 3);
  ctx.lineTo(-3, -3);
  ctx.closePath();
  ctx.stroke();
  ctx.fill();
  ctx.restore();
}
