// Dungeons: every planet's and moon's surface is a labyrinth (art/surface.js o.dungeon) cut into
// its ground: chambers cut into solid rock, joined by winding passages, the landing spot in a
// chamber by its south edge and the deepest chamber (role 'deep', the most passages away) held by
// the Warden. There are no hazards down there (dungeonSite); nodes lie about
// the chambers and passages as on any surface, and the landing pad in the first chamber is the way
// out (EXIT: fly off it and back onto it to take off), with no rim to fly past.
// The minimap is the cave as charted round the ship: what's come within SIGHT of it as it flies,
// afresh on each landing; the chambers visited are counted on the HUD.
//
//   isDungeon(e)                whether a body can be landed on (every planet and moon)
//   dungeonSite(site)           a site (rules/hazards.js surface) with its hazards taken off
//   dungeonOpts(size)           the options its surface is generated with (game/landing.js)
//   dungeonRun                  { W, seen (tiles charted), visited (rooms by index), map (canvas) }
//   enterDungeon(W), tickDungeon(C), dungeonLines(), drawDungeonMinimap(box, C, marks)
// Part of the flight view (game/landing.js, game/surface-run.js use it).

import { ArtBlueprints } from '../art/blueprints.js';
import { ArtTurrets } from '../art/turrets.js';
import { Art } from '../art/render.js';
import { ArtSurface } from '../art/surface.js';
import { SurfaceGlobe } from '../art/surface-globe.js';
import { CombatCore } from '../combat/combat-core.js';
import { hashInt, mulberry32 } from '../core/rng.js';
import { COLORS, Theme } from '../core/theme.js';
import { Entities } from '../flight/entities.js';
import { Loadout } from '../rules/loadout.js';
import { Loot } from '../rules/loot.js';
import { Progress } from '../rules/progress.js';
import { Research } from '../rules/research.js';
import { Structures } from '../rules/structures.js';
import { Vendor } from '../rules/vendor.js';
import { cargo, lootClasses, lootNotice, pilotLevel, saveCargo, takeLoot } from './cargo.js';
import { engageOnSurface, tallyKill } from './combat.js';
import { SURFACE_ACCEL, SURFACE_SPEED, takeOff } from './landing.js';
import { artStyle } from './options.js';
import { clamp, ctx, fight, notify } from './state.js';
import { gainXP } from './progress.js';
import { offerReward } from './rewards.js';
import { grantGambit, ownedGambits } from './vendor.js';
import { world } from './world.js';

// Every planet and moon is a dungeon: landing puts the ship in a labyrinth of caverns, guarded,
// with a boss in its deepest chamber. (The landing sites of the old surface run, with their
// hazards, are on the archive: notes/archived-systems.md.)
export const DUNGEON = { rooms: 16 }; // the chambers of a labyrinth with no body to scale it by
export const isDungeon = (e) => !!e && (e.kind === 'planet' || e.kind === 'moon');

// What a labyrinth is called, by the ground it's cut into (art/surface.js types).
const DUNGEON_NAMES = { desert: 'Canyons', terran: 'Ravines', ice: 'Ice caves', lava: 'Lava tubes', gas: 'Storm maze', cavern: 'Caverns' };
export const dungeonName = (W) => DUNGEON_NAMES[W.type] || (W.type.startsWith('moon-') ? 'Crater maze' : 'Labyrinth');

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
  const m = Math.round(size * 0.16), rooms = !e ? DUNGEON.rooms : 9 + bodyLevel(e);
  return { w: size, h: size, dungeon: { area: [m, m, size - m, size - m], rooms }, tall: 0.015 };
};

// ---------- Guardians ----------
// The chambers are held by turrets (art/turrets.js, rules/structures.js: a gun or missile turret in
// the hostiles' culture) that never move, and raiders: fighters that circle their chamber and chase
// the ship once roused, kept out of the walls (combat/combat-realtime.js s.blocked); the deepest
// chamber by the Warden, a heavy ship that chases too, with two turrets. They wake when the ship
// comes within SENSE of one (and every guardian within ROUSE of it with it), and are fought as in space
// (the Combat setting's mode) with the squad (game/combat.js engageOnSurface). Their gear goes by the dungeon's level; the
// aliens' are their own. Each landing finds them afresh. Destroyed, they pay their cargo as credits
// (CombatCore.credits) and now and then leave gear (rules/loot.js:
// sentinel, raider and warden drop tables, into the spare gear); the Warden always some, Rare or
// better, and a bounty.
export const GUARD = { sense: 430, rouse: 700, range: 520, bounty: 450, patrol: 0.45, turn: 0.35 };
const BOSS = { hull: 7, shield: 3, damage: 1.5, size: 2 };
const RAIDER = { hull: 1.3, shield: 1.1, damage: 0.9, size: 1 };
const TURRET = { damage: 0.85, size: 2 };
// A ship that flies on the surface: as the player's does there (game/landing.js), its guns as in space.
function surfaceShip(st, k, alien, name) {
  const a = alien ? 1.25 : 1;
  const weapons = st.weapons.map((w) => ({ ...w, damage: Math.round(w.damage * k.damage * a * 10) / 10, }));
  return {
    ...st, name, hull: Math.round(st.hull * k.hull * a), shield: Math.round(st.shield * k.shield * a), weapons,
    firepower: weapons.reduce((n, w) => n + w.damage * w.fireRate, 0), maxSpeed: st.maxSpeed * SURFACE_SPEED, accel: st.accel * SURFACE_ACCEL,
  };
}
export function guardianStats(tier, boss, alien) {
  const st = Loadout.stats(Loadout.npc('fighter', tier));
  if (!boss) return surfaceShip(st, RAIDER, alien, 'Raider');
  const out = surfaceShip(st, BOSS, alien, 'Warden');
  out.weapons = [...out.weapons, { ...out.weapons[0], fireRate: out.weapons[0].fireRate * 0.5, damage: out.weapons[0].damage * 2 }];
  out.firepower = out.weapons.reduce((n, w) => n + w.damage * w.fireRate, 0);
  return out;
}
// A turret underground: its guns reach as far as the caverns let them (a missile turret's further).
export function turretGuardStats(kind, tier, alien) {
  const st = Structures.turretStats(kind, tier), a = alien ? 1.25 : 1;
  const weapons = st.weapons.map((w) => ({ ...w, damage: Math.round(w.damage * TURRET.damage * a * 10) / 10, range: Math.min(w.range, GUARD.range * (kind === 'missile' ? 1.3 : 1)) }));
  return { ...st, hull: Math.round(st.hull * a), shield: Math.round(st.shield * a), weapons, firepower: weapons.reduce((n, w) => n + w.damage * w.fireRate, 0) };
}
// The guardians for this landing: in each chamber a hop or more from the landing spot, most of
// them, one to three (turrets and raiders, more the higher the level); in the deepest the Warden
// and two turrets.
function placeGuardians(W, e, field) {
  const level = bodyLevel(e), G = world.galaxy, b = G.planets.find((q) => q.name === e.key) || G.moons.find((m) => m.name === e.key);
  const alien = (b && G.systems[b.system]?.faction) === 'alien';
  const culture = alien ? world.cultures.alien || world.cultures.pirates : world.cultures.pirates;
  const r = mulberry32(hashInt(field >>> 0, level, 0x6a4d));
  const out = [];
  const add = (room, role, i) => {
    const boss = role === 'warden', tier = clamp(level + (boss ? 1 : 0), 1, 5), seed = (r() * 4294967296) >>> 0;
    const a = r() * Math.PI * 2, d = boss ? 0 : room.r * (role === 'turret' ? 0.35 + r() * 0.3 : GUARD.patrol);
    const key = `${e.key}:guard:${field}:${out.length}`, x = room.x + Math.cos(a) * d, y = room.y + Math.sin(a) * d;
    if (role === 'turret') {
      const kind = Structures.turretKind(r), art = ArtTurrets.create(kind, culture, seed);
      out.push({
        key, role, turretKind: kind, name: `${alien ? 'Alien ' : ''}${kind === 'missile' ? 'missile turret' : 'gun turret'}`.replace(/^./, (c) => c.toUpperCase()),
        tier, art, radius: art.radius * TURRET.size, size: TURRET.size, x, y, angle: r() * Math.PI * 2, stats: turretGuardStats(kind, tier, alien), alive: true, room,
      });
      return;
    }
    const art = ArtBlueprints.create(boss ? 'fighter-heavy' : Entities.fighterClass(tier, seed), culture, seed);
    const size = (boss ? BOSS : RAIDER).size;
    out.push({
      key, role, boss, name: boss ? `${alien ? 'Alien ' : ''}Warden` : `${alien ? 'Alien raider' : 'Raider'}`,
      tier, art, radius: art.radius * size, size, x, y, angle: a + Math.PI / 2, stats: guardianStats(tier, boss, alien), alive: true, room,
      patrol: boss ? null : { cx: room.x, cy: room.y, r: d, a, w: (r() < 0.5 ? -1 : 1) * GUARD.turn },
    });
  };
  for (const room of W.dungeon.rooms) {
    if (room.role === 'start') continue;
    if (room.role === 'deep') { add(room, 'warden', 0); add(room, 'turret', 1); add(room, 'turret', 2); continue; }
    if ((room.hops || 0) < 1 || r() < 0.3) continue;
    const n = 1 + (r() < 0.25 + 0.1 * level ? 1 : 0) + (level >= 3 && r() < 0.3 ? 1 : 0);
    for (let i = 0; i < n; i++) add(room, r() < 0.55 ? 'turret' : 'raider', i);
  }
  return out;
}
const living = () => dungeonRun.guards.filter((g) => g.alive);
// Each step on the surface: raiders not in a fight circle their chambers; guardians the ship comes
// near wake, and those near them with them.
export function tickGuardians(C, dt = 0) {
  if (!dungeonRun.W || !dungeonRun.guards.length) return;
  for (const g of living()) {
    if (!g.patrol || fight.ships.has(g.key)) continue;
    const P = g.patrol;
    P.a += P.w * dt;
    const tx = P.cx + Math.cos(P.a) * P.r, ty = P.cy + Math.sin(P.a) * P.r, d = Math.hypot(tx - g.x, ty - g.y);
    if (d > 30) { // back from a fight: it flies home to its round first
      const step = Math.min(d, g.stats.maxSpeed * 0.7 * dt);
      g.angle = Math.atan2(ty - g.y, tx - g.x);
      g.x += Math.cos(g.angle) * step;
      g.y += Math.sin(g.angle) * step;
    } else {
      g.x = tx;
      g.y = ty;
      g.angle = P.a + Math.sign(P.w) * Math.PI / 2;
    }
  }
  const near = living().filter((g) => Math.hypot(C.x - g.x, C.y - g.y) - g.radius <= GUARD.sense && !fight.ships.has(g.key));
  if (!near.length) return;
  const group = living().filter((g) => !fight.ships.has(g.key) && near.some((n) => Math.hypot(n.x - g.x, n.y - g.y) <= GUARD.rouse));
  engageOnSurface(group);
}
// One destroyed (game/combat.js shipDestroyed): its cargo as credits, gear (its drop table) into
// the spare gear, the Warden's bounty.
const SOURCE = { turret: 'sentinel', raider: 'raider', warden: 'warden' };
export function guardianDown(g) {
  if (!g.alive) return;
  g.alive = false;
  const R = dungeonRun, level = bodyLevel(R.e);
  gainXP(Progress.killXP(clamp(g.tier, 1, 5), pilotLevel()) + (g.boss ? Progress.wardenXP(level) : 0), g.boss ? `the ${g.name}` : '');
  const paid = CombatCore.credits(world.galaxy.seed ^ (R.field >>> 0), g.key, 'fighter', clamp(g.tier, 1, 4))
    + (g.boss ? CombatCore.credits(world.galaxy.seed, `${g.key}:hoard`, 'fighter', 4) : 0);
  cargo.credits += paid;
  // The Warden's gear is one of three to choose (game/rewards.js); a guardian's goes straight aboard.
  const o = { level: clamp(level + (g.boss ? 1 : 0), 1, 5), seed: world.galaxy.seed ^ (R.field >>> 0), cls: lootClasses(), pity: cargo.lootPity };
  const gear = g.boss ? [] : Loot.drops(SOURCE[g.role] || 'sentinel', g.key, o);
  for (const spec of gear) lootNotice(takeLoot(spec));
  if (g.boss) offerReward(`The ${g.name}`, `warden:${g.key}:${R.field >>> 0}`, Loot.offer('warden', g.key, o));
  tallyKill({ credits: g.boss ? 0 : paid, loot: gear }); // said when the fight is won (game/combat.js); the Warden's hoard with its bounty
  if (g.boss) {
    const bounty = GUARD.bounty * level;
    cargo.credits += bounty;
    R.bossDown = true;
    notify(`The ${g.name} is destroyed · ${bounty + paid} credits salvaged from its core and hold`, 4, { tone: 'good' });
    // And a gambit in its core: one not owned yet, up to a tier above the dungeon's level
    // (game/vendor.js; some are found only this way, further out).
    const gambit = Vendor.gambitDrop(world.galaxy.seed ^ (R.field >>> 0), `${g.key}:gambit`, level, ownedGambits());
    if (gambit && grantGambit(gambit)) notify(`Gambit recovered from the ${g.name}: import ${Research.title(gambit)}`, 4, { tone: 'good' });
  }
  saveCargo();
}

// The guardians, over the ground where it's charted (drawn as the ship is, with the landed view's transform).
export function drawGuardians(v, zoom, dpr, time) {
  const R = dungeonRun;
  if (!R.W) return;
  drawExit(v, zoom, dpr, time);
  const style = artStyle.value;
  for (const g of R.guards) {
    if (!g.alive || !charted(g.x, g.y)) continue;
    const pose = fight.ships.get(g.key), p = SurfaceGlobe.toScreen(v, pose ? pose.x : g.x, pose ? pose.y : g.y, ArtSurface.FLY);
    if (!p) continue;
    const k = (g.radius * (g.role === 'turret' ? 1 : Entities.SHIP_SCALE)) / g.art.radius;
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
      if (c.stats.shield) { ctx.fillStyle = 'rgba(0, 0, 0, 0.6)'; ctx.fillRect(-w / 2, y - 5, w, 3); ctx.fillStyle = COLORS.cyan; ctx.fillRect(-w / 2, y - 5, w * clamp(c.shield / c.stats.shield, 0, 1), 3); ctx.fillStyle = g.boss ? COLORS.hostile : COLORS.flame; }
      ctx.fillRect(-w / 2, y, w * clamp(c.hull / c.stats.hull, 0, 1), 4);
    }
    ctx.restore();
  }
}

// The landing pad on the ground: a ring and its markings, brighter once flying onto it would take
// off, with what it does over it.
function drawExit(v, zoom, dpr, time) {
  const R = dungeonRun, [x, y] = R.W.start, p = SurfaceGlobe.toScreen(v, x, y, 0);
  if (!p) return;
  const pulse = 0.5 + 0.5 * Math.sin(time * 2.4), r = EXIT.r;
  ctx.save();
  ctx.setTransform(dpr * zoom, 0, 0, dpr * zoom, 0, 0);
  ctx.translate(p[0], p[1]);
  ctx.strokeStyle = COLORS.cyan;
  ctx.fillStyle = COLORS.cyan;
  ctx.globalAlpha = (R.armed ? 0.12 : 0.06) + 0.06 * pulse;
  ctx.beginPath(); ctx.ellipse(0, 0, r, r * v.ct, 0, 0, Math.PI * 2); ctx.fill();
  ctx.globalAlpha = R.armed ? 0.55 + 0.35 * pulse : 0.35;
  ctx.lineWidth = 2 / zoom;
  ctx.setLineDash([10 / zoom, 7 / zoom]);
  ctx.lineDashOffset = -time * 20 / zoom;
  ctx.beginPath(); ctx.ellipse(0, 0, r, r * v.ct, 0, 0, Math.PI * 2); ctx.stroke();
  ctx.setLineDash([]);
  ctx.beginPath(); ctx.ellipse(0, 0, r * 0.55, r * 0.55 * v.ct, 0, 0, Math.PI * 2); ctx.stroke();
  for (let k = 0; k < 4; k++) { // chevrons pointing up: out
    const a = (k / 4) * Math.PI * 2 + Math.PI / 4, cx = Math.cos(a) * r * 0.78, cy = Math.sin(a) * r * 0.78 * v.ct;
    ctx.beginPath(); ctx.moveTo(cx - 5, cy + 3); ctx.lineTo(cx, cy - 3); ctx.lineTo(cx + 5, cy + 3); ctx.stroke();
  }
  ctx.font = `600 ${11 / zoom * 1.4}px ${Theme.mono}`;
  ctx.textAlign = 'center';
  ctx.globalAlpha = R.armed ? 0.95 : 0.6;
  ctx.fillText(R.armed ? 'RETURN TO ORBIT' : 'LANDING PAD', 0, -r * v.ct - 8 / zoom);
  ctx.restore();
}

const SIGHT = 7; // tiles round the ship charted as it flies
const WINDOW = 48; // tiles across the minimap, round the ship
const PX = 2; // map pixels per tile
export const dungeonRun = { W: null, e: null, field: 0, seen: null, visited: new Set(), map: null, at: -1, guards: [], bossDown: false, armed: false };
// The way out: the landing pad where the ship set down (W.start), EXIT.r across. Once the ship has
// flown EXIT.arm past its edge, flying back onto it takes off.
export const EXIT = { r: 60, arm: 80 };

export function enterDungeon(W, e = null, field = 0) {
  const [a0, b0, a1, b1] = W.dungeon.area, map = document.createElement('canvas');
  map.width = (a1 - a0) * PX;
  map.height = (b1 - b0) * PX;
  Object.assign(dungeonRun, { W, e, field, seen: new Uint8Array(W.w * W.h), visited: new Set(), map, at: -1, guards: [], bossDown: false, armed: false });
  if (e) dungeonRun.guards = placeGuardians(W, e, field);
}

// Open: a tile with any corner below the cave walls.
const openTile = (C, i, j) => !(C[i][j] && C[i + 1][j] && C[i][j + 1] && C[i + 1][j + 1]);

// Charts what's round the ship, and notes the chambers it comes into; back on the pad, takes off.
export function tickDungeon(C) {
  const R = dungeonRun, W = R.W;
  if (!W) return;
  const pad = Math.hypot(C.x - W.start[0], C.y - W.start[1]);
  if (!R.armed && pad > EXIT.r + EXIT.arm) R.armed = true;
  else if (R.armed && pad < EXIT.r) { R.armed = false; takeOff(); return; }
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
  const lines = [[`CHAMBERS ${R.visited.size}/${rooms.length} · ${R.visited.has(deep) ? 'the deepest found' : 'the deepest still ahead'} · back to the pad to leave`, COLORS.hud]];
  if (R.guards.length) {
    const left = R.guards.filter((g) => g.alive && !g.boss).length;
    lines.push([`LEVEL ${bodyLevel(R.e)} · ${left} guardian${left === 1 ? '' : 's'} left · ${R.bossDown ? 'Warden destroyed' : 'the Warden in the deepest chamber'}`, R.bossDown ? COLORS.good : COLORS.amber]);
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
