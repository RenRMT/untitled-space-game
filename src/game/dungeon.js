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

import { ArtSurface } from '../art/surface.js';
import { COLORS } from '../core/theme.js';
import { clamp, ctx, notify } from './state.js';
import { world } from './world.js';

// Zantal VI in the default galaxy: the blue giant (its surface otherwise the Terran one, its rules a
// gas giant's), which no other test or mission lands on.
export const DUNGEON = { system: 0, type: 'blue', rooms: 16 };
export function isDungeon(e) {
  if (!e || e.kind !== 'planet') return false;
  const p = world.galaxy.planets.find((q) => q.name === e.key);
  return !!p && p.system === DUNGEON.system && p.type === DUNGEON.type;
}

// No heat, day side, radiation, dust, vents or storm pockets; ordinary gravity; rock to mine.
export const dungeonSite = (site) => ({
  ...site, label: 'Caverns', tag: 'Caverns', hazard: 'No hazards: a labyrinth to explore', dungeon: true,
  heat: 0, day: 0, rad: 0, gravity: 1, fuelBurn: 1, dust: false, vents: false, pockets: false,
  material: 'rock', rich: 1.5, deposits: [['iron', 2], ['rare-earths', 1], ['tungsten', 1]],
});

// The labyrinth fills the middle of the surface, a margin of solid rock round it.
export const dungeonOpts = (size) => {
  const m = Math.round(size * 0.16);
  return { w: size, h: size, dungeon: { area: [m, m, size - m, size - m], rooms: DUNGEON.rooms }, tall: 0.015 };
};

const SIGHT = 7; // tiles round the ship charted as it flies
const WINDOW = 48; // tiles across the minimap, round the ship
const PX = 2; // map pixels per tile
export const dungeonRun = { W: null, seen: null, visited: new Set(), map: null, at: -1 };

export function enterDungeon(W) {
  const [a0, b0, a1, b1] = W.dungeon.area, map = document.createElement('canvas');
  map.width = (a1 - a0) * PX;
  map.height = (b1 - b0) * PX;
  Object.assign(dungeonRun, { W, seen: new Uint8Array(W.w * W.h), visited: new Set(), map, at: -1 });
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
    if (r.role === 'deep') notify('The deepest chamber · empty, for now', 3.5, { tone: 'warn' });
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
  return [[`CHAMBERS ${R.visited.size}/${rooms.length} · ${R.visited.has(deep) ? 'the deepest found' : 'the deepest still ahead'} · Take off (T) to leave`, COLORS.hud]];
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
