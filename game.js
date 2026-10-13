'use strict';

// ---------- Setup ----------

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const TAU = Math.PI * 2;

// Each galaxy map sector is a square play area this many world units across. World coordinates
// run across the whole galaxy; drawing happens relative to the camera's sector to keep precision.
const SECTOR = 6000;

const COLORS = {
  bg: '#05060a',
  ship: '#7df9ff',
  flame: '#ffb347',
  station: '#b6ff8a',
  planet: '#8ab4ff',
  star: '#ffd27a',
  bounds: '#ff5a6e',
  hud: '#cfd8ff',
  dim: '#6f7a99',
};

// Handling stats; later these become per-ship-class values.
const SHIP = { maxSpeed: 650, accel: 520, turnRate: 3.6, radius: 16 };

const ship = {
  x: 0, y: 0,
  vx: 0, vy: 0,
  angle: -Math.PI / 2,
  targetAngle: -Math.PI / 2,
  targetSpeed: 0,
  thrust: 0,
};

const view = { w: 0, h: 0, dpr: 1, zoom: 1 };
const cam = { x: 0, y: 0 };
const particles = [];
let simTime = 0; // advances only while flying, so the map pause doesn't make traffic jump

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const lerp = (a, b, t) => a + (b - a) * t;

function resize() {
  view.dpr = Math.min(window.devicePixelRatio || 1, 2);
  view.w = window.innerWidth;
  view.h = window.innerHeight;
  canvas.width = Math.round(view.w * view.dpr);
  canvas.height = Math.round(view.h * view.dpr);
  view.zoom = clamp(Math.min(view.w, view.h) / 800, 0.55, 1.2);
}
window.addEventListener('resize', resize);
resize();

// ---------- Settings: art style and movement mode ----------

const params = new URLSearchParams(location.search);
function stored(key, options, fallback) {
  let v = fallback;
  try { if (options.includes(localStorage.getItem(key))) v = localStorage.getItem(key); } catch (e) { /* storage unavailable */ }
  return options.includes(params.get(key)) ? params.get(key) : v;
}
function store(key, v) {
  try { localStorage.setItem(key, v); } catch (e) { /* storage unavailable */ }
}
function toggle(btn, key, options, labels, initial) {
  const s = { value: initial };
  const set = (v) => { s.value = v; btn.textContent = labels[v]; store(key, v); };
  s.cycle = () => set(options[(options.indexOf(s.value) + 1) % options.length]);
  btn.addEventListener('click', s.cycle);
  set(initial);
  return s;
}

const ART_STYLES = Art.STYLES.map((s) => s.id);
const artStyle = toggle(document.getElementById('style-btn'), 'style', ART_STYLES,
  Object.fromEntries(Art.STYLES.map((s) => [s.id, s.label])), stored('style', ART_STYLES, 'line'));

// Cruise: the ship holds the set speed after you let go (tap to stop).
// Direct: the ship only moves while you drag, with no drift, and stops when you let go.
const MOVE_MODES = ['cruise', 'direct'];
const moveMode = toggle(document.getElementById('move-btn'), 'move', MOVE_MODES,
  { cruise: 'Cruise', direct: 'Direct' }, stored('move', MOVE_MODES, 'cruise'));
document.getElementById('move-btn').addEventListener('click', () => { ship.targetSpeed = 0; });

window.addEventListener('keydown', (e) => {
  if (GalaxyMap.isOpen) return;
  if (e.key === 'v' || e.key === 'V') artStyle.cycle();
  if (e.key === 'c' || e.key === 'C') { moveMode.cycle(); ship.targetSpeed = 0; }
});

ship.art = ArtBlueprints.playerShip(ArtCulture.legacy);

// ---------- World: sectors generated from the galaxy map ----------

const world = { galaxy: null, cultures: null, sectors: null, w: 0, h: 0 };

function sectorOf(x, y) {
  return [clamp(Math.floor(x / SECTOR), 0, world.galaxy.size - 1), clamp(Math.floor(y / SECTOR), 0, world.galaxy.size - 1)];
}

// Place the ship in a sector, beside its main station when there is one.
function moveShipTo(sx, sy) {
  const sec = world.sectors.at(sx, sy);
  const stations = sec.entities.filter((e) => e.kind === 'station').sort((a, b) => b.radius - a.radius);
  const s = stations[0];
  ship.x = s ? s.x : (sx + 0.5) * SECTOR;
  ship.y = s ? s.y + s.radius + 220 : (sy + 0.5) * SECTOR;
  ship.vx = ship.vy = 0;
  ship.targetSpeed = 0;
  ship.angle = ship.targetAngle = -Math.PI / 2;
  cam.x = ship.x;
  cam.y = ship.y;
  particles.length = 0;
}

function loadGalaxy(galaxy) {
  world.galaxy = galaxy;
  world.cultures = ArtCulture.forGalaxy(galaxy);
  world.sectors = Sectors.create(galaxy, world.cultures, SECTOR);
  world.w = world.h = galaxy.size * SECTOR;
  Art.clearCache();
  const start = galaxy.systems[galaxy.startSystem];
  moveShipTo(start.x, start.y);
}
loadGalaxy(GalaxyMap.galaxy);
GalaxyMap.onJump = (x, y) => moveShipTo(x, y);

// Entities of the sectors around the camera, posed for time t.
function nearbyEntities(t) {
  const [cx, cy] = sectorOf(cam.x, cam.y);
  const out = [];
  for (let y = cy - 1; y <= cy + 1; y++) {
    for (let x = cx - 1; x <= cx + 1; x++) {
      const sec = world.sectors.at(x, y);
      if (!sec) continue;
      for (const e of sec.entities) { Sectors.pose(e, t); out.push(e); }
    }
  }
  return out;
}

// ---------- Input: drag sets heading, drag length sets speed ----------

const DEADZONE = 8;
const drag = { active: false, id: null, x0: 0, y0: 0, x: 0, y: 0, moved: 0 };
let interacted = false;

// Drag length (CSS px) that maps to full speed.
const maxDrag = () => Math.min(view.w, view.h) * 0.3;

canvas.addEventListener('pointerdown', (e) => {
  if (drag.active || (e.pointerType === 'mouse' && e.button !== 0)) return;
  canvas.setPointerCapture(e.pointerId);
  Object.assign(drag, {
    active: true, id: e.pointerId,
    x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, moved: 0,
  });
  interacted = true;
});

canvas.addEventListener('pointermove', (e) => {
  if (!drag.active || e.pointerId !== drag.id) return;
  drag.x = e.clientX;
  drag.y = e.clientY;
  const dx = drag.x - drag.x0;
  const dy = drag.y - drag.y0;
  const len = Math.hypot(dx, dy);
  drag.moved = Math.max(drag.moved, len);
  if (len > DEADZONE) {
    ship.targetAngle = Math.atan2(dy, dx);
    ship.targetSpeed = Math.min(len / maxDrag(), 1) * SHIP.maxSpeed;
  } else if (drag.moved > DEADZONE) {
    ship.targetSpeed = 0; // dragged back to the anchor: throttle to zero
  }
});

function endDrag(e) {
  if (!drag.active || e.pointerId !== drag.id) return;
  drag.active = false;
  if (moveMode.value === 'direct') ship.targetSpeed = 0; // letting go stops the ship
  else if (e.type === 'pointerup' && drag.moved < DEADZONE) ship.targetSpeed = 0; // tap = all stop
}
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

// ---------- Simulation ----------

function turnToward(a, target, maxStep) {
  const diff = ((target - a + Math.PI) % TAU + TAU) % TAU - Math.PI;
  return a + clamp(diff, -maxStep, maxStep);
}

function update(dt) {
  simTime += dt;
  const direct = moveMode.value === 'direct';
  const moving = ship.targetSpeed > 0;
  if (moving) ship.angle = turnToward(ship.angle, ship.targetAngle, SHIP.turnRate * (direct ? 3 : 1) * dt);
  const hx = Math.cos(ship.angle);
  const hy = Math.sin(ship.angle);

  if (direct) {
    // No inertia: velocity always points along the heading and snaps to the set speed.
    let speed = lerp(Math.hypot(ship.vx, ship.vy), ship.targetSpeed, 1 - Math.exp(-12 * dt));
    if (!moving && speed < 5) speed = 0;
    ship.vx = hx * speed;
    ship.vy = hy * speed;
    ship.thrust = lerp(ship.thrust, moving ? Math.max(0.2, ship.targetSpeed / SHIP.maxSpeed) : 0, 1 - Math.exp(-12 * dt));
  } else {
    // Velocity eases toward (heading * set speed), so turning produces some drift.
    const dvx = hx * ship.targetSpeed - ship.vx;
    const dvy = hy * ship.targetSpeed - ship.vy;
    const dv = Math.hypot(dvx, dvy);
    if (dv > 0) {
      const k = Math.min(1, (SHIP.accel * dt) / dv);
      ship.vx += dvx * k;
      ship.vy += dvy * k;
    }
    const along = dv > 5 ? (dvx * hx + dvy * hy) / dv : 0;
    const thrustTarget = moving ? Math.max(0.2, along) : 0;
    ship.thrust = lerp(ship.thrust, thrustTarget, 1 - Math.exp(-10 * dt));
  }

  ship.x += ship.vx * dt;
  ship.y += ship.vy * dt;

  // Galaxy edge: clamp and bounce softly.
  const m = SHIP.radius;
  if (ship.x < m) { ship.x = m; ship.vx = Math.abs(ship.vx) * 0.3; }
  if (ship.x > world.w - m) { ship.x = world.w - m; ship.vx = -Math.abs(ship.vx) * 0.3; }
  if (ship.y < m) { ship.y = m; ship.vy = Math.abs(ship.vy) * 0.3; }
  if (ship.y > world.h - m) { ship.y = world.h - m; ship.vy = -Math.abs(ship.vy) * 0.3; }

  // Engine exhaust particles.
  if (ship.thrust > 0.25 && Math.random() < ship.thrust * 1.5) {
    const spread = (Math.random() - 0.5) * 0.6;
    const back = ship.angle + Math.PI + spread;
    particles.push({
      x: ship.x - hx * 12, y: ship.y - hy * 12,
      vx: ship.vx * 0.5 + Math.cos(back) * 140, vy: ship.vy * 0.5 + Math.sin(back) * 140,
      life: 0.6, max: 0.6,
    });
  }
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.life -= dt;
    if (p.life <= 0) { particles.splice(i, 1); continue; }
    p.x += p.vx * dt;
    p.y += p.vy * dt;
  }

  // Camera leads in the direction of travel.
  const lead = 0.45;
  const k = 1 - Math.exp(-4 * dt);
  cam.x = lerp(cam.x, ship.x + ship.vx * lead, k);
  cam.y = lerp(cam.y, ship.y + ship.vy * lead, k);

  GalaxyMap.setPlayer(ship.x / SECTOR, ship.y / SECTOR);
}

// ---------- Background starfield (procedural, parallax) ----------

const STAR_LAYERS = [
  { p: 0.04, cell: 200, n: 6, size: [0.5, 1.0], alpha: [0.2, 0.5] },
  { p: 0.12, cell: 220, n: 4, size: [0.7, 1.3], alpha: [0.3, 0.65] },
  { p: 0.3, cell: 260, n: 3, size: [1.0, 1.7], alpha: [0.4, 0.8] },
  { p: 0.65, cell: 320, n: 2, size: [1.3, 2.2], alpha: [0.5, 0.95] },
];
const STAR_TINTS = ['#ffffff', '#cfe0ff', '#fff1d0', '#ffd9d9'];

function drawStarfield() {
  for (let li = 0; li < STAR_LAYERS.length; li++) {
    const L = STAR_LAYERS[li];
    const ox = cam.x * L.p * view.zoom - view.w / 2;
    const oy = cam.y * L.p * view.zoom - view.h / 2;
    // Motion streaks scale with speed and layer depth.
    const sx = -ship.vx * L.p * view.zoom * 0.04;
    const sy = -ship.vy * L.p * view.zoom * 0.04;
    const streak = Math.hypot(sx, sy) > 1.5;

    const c0x = Math.floor(ox / L.cell), c1x = Math.floor((ox + view.w) / L.cell);
    const c0y = Math.floor(oy / L.cell), c1y = Math.floor((oy + view.h) / L.cell);
    for (let cy = c0y; cy <= c1y; cy++) {
      for (let cx = c0x; cx <= c1x; cx++) {
        const rnd = mulberry32(hashInt(cx, cy, li));
        for (let i = 0; i < L.n; i++) {
          const x = cx * L.cell + rnd() * L.cell - ox;
          const y = cy * L.cell + rnd() * L.cell - oy;
          const s = lerp(L.size[0], L.size[1], rnd());
          ctx.globalAlpha = lerp(L.alpha[0], L.alpha[1], rnd());
          const tint = STAR_TINTS[(rnd() * STAR_TINTS.length) | 0];
          if (streak) {
            ctx.strokeStyle = tint;
            ctx.lineWidth = s;
            ctx.beginPath();
            ctx.moveTo(x, y);
            ctx.lineTo(x + sx, y + sy);
            ctx.stroke();
          } else {
            ctx.fillStyle = tint;
            ctx.fillRect(x - s / 2, y - s / 2, s, s);
          }
        }
      }
    }
  }
  ctx.globalAlpha = 1;
}

// ---------- World objects (drawn relative to `origin`, the camera's sector corner) ----------

const origin = { x: 0, y: 0 };
const rx = (x) => x - origin.x;
const ry = (y) => y - origin.y;

function drawBounds() {
  ctx.save();
  const [x0, y0, x1, y1] = [rx(0), ry(0), rx(world.w), ry(world.h)];
  ctx.beginPath();
  ctx.rect(rx(cam.x) - 1e4, ry(cam.y) - 1e4, 2e4, 2e4);
  ctx.rect(x0, y0, x1 - x0, y1 - y0);
  ctx.fillStyle = 'rgba(255, 60, 90, 0.06)';
  ctx.fill('evenodd');

  const edgeDist = Math.min(ship.x, ship.y, world.w - ship.x, world.h - ship.y);
  const warn = clamp(1 - edgeDist / 600, 0, 1);
  ctx.strokeStyle = COLORS.bounds;
  ctx.globalAlpha = 0.35 + 0.65 * warn;
  ctx.lineWidth = 3;
  ctx.setLineDash([30, 20]);
  ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
  ctx.restore();
}

// Faint sector borders around the camera.
function drawSectorGrid() {
  const [cx, cy] = sectorOf(cam.x, cam.y);
  ctx.save();
  ctx.strokeStyle = 'rgba(120, 140, 200, 0.14)';
  ctx.lineWidth = 1.5 / view.zoom;
  ctx.setLineDash([12 / view.zoom, 18 / view.zoom]);
  ctx.beginPath();
  for (let i = -1; i <= 2; i++) {
    const x = rx((cx + i) * SECTOR), y = ry((cy + i) * SECTOR);
    ctx.moveTo(x, ry((cy - 1) * SECTOR)); ctx.lineTo(x, ry((cy + 2) * SECTOR));
    ctx.moveTo(rx((cx - 1) * SECTOR), y); ctx.lineTo(rx((cx + 2) * SECTOR), y);
  }
  ctx.stroke();
  ctx.restore();
}

const DRAW_ORDER = { star: 0, planet: 1, station: 2, wreck: 3, ship: 4 };

function visible(e) {
  const hw = view.w / 2 / view.zoom, hh = view.h / 2 / view.zoom, r = (e.radius || 100) * 1.3;
  return Math.abs(e.x - cam.x) < hw + r && Math.abs(e.y - cam.y) < hh + r;
}

function drawEntities(list, t) {
  const style = artStyle.value;
  const shown = list.filter(visible).sort((a, b) => DRAW_ORDER[a.kind] - DRAW_ORDER[b.kind]);
  for (const e of shown) {
    const x = rx(e.x), y = ry(e.y);
    if (e.kind === 'star') Art.drawStar(ctx, e.body, style, { x, y, t });
    else if (e.kind === 'planet') {
      const star = list.find((s) => s.kind === 'star' && Math.abs(s.x - e.x) < SECTOR && Math.abs(s.y - e.y) < SECTOR);
      Art.drawPlanet(ctx, e.body, style, { x, y, lightAngle: star ? Math.atan2(star.y - e.y, star.x - e.x) : -2.2 });
    } else if (e.kind === 'station') Art.drawAsset(ctx, e.art, style, { x, y, spin: e.spin + t * e.art.spinRate, t });
    else Art.drawAsset(ctx, e.art, style, { x, y, angle: e.a, t, thrust: e.thrust || 0 });
  }
}

function drawShip(t) {
  Art.drawAsset(ctx, ship.art, artStyle.value, { x: rx(ship.x), y: ry(ship.y), angle: ship.angle, t, thrust: ship.thrust });
}

function drawParticles() {
  ctx.fillStyle = COLORS.flame;
  for (const p of particles) {
    ctx.globalAlpha = (p.life / p.max) * 0.7;
    ctx.fillRect(rx(p.x) - 1.5, ry(p.y) - 1.5, 3, 3);
  }
  ctx.globalAlpha = 1;
}

// ---------- Screen-space overlays ----------

const worldToScreen = (x, y) => [
  (x - cam.x) * view.zoom + view.w / 2,
  (y - cam.y) * view.zoom + view.h / 2,
];

function labelOf(e) {
  if (!e.name) return null;
  if (e.kind === 'star') return [COLORS.star, e.body.r * 1.5];
  if (e.kind === 'planet') return [COLORS.planet, e.body.r * 1.3];
  if (e.kind === 'station') return [e.color, e.radius * 1.05];
  return ['#9aa4b8', e.radius + 20];
}

function drawLabels(list) {
  ctx.font = '12px ui-monospace, Menlo, Consolas, monospace';
  ctx.textAlign = 'center';
  ctx.globalAlpha = 0.75;
  for (const e of list) {
    const l = labelOf(e);
    if (!l || !visible(e)) continue;
    const [sx, sy] = worldToScreen(e.x, e.y + l[1]);
    ctx.fillStyle = l[0];
    ctx.fillText(e.name.toUpperCase(), sx, sy + 14);
  }
  ctx.globalAlpha = 1;
  ctx.textAlign = 'left';
}

function drawDragIndicator() {
  if (!drag.active) return;
  const md = maxDrag();
  const dx = drag.x - drag.x0;
  const dy = drag.y - drag.y0;
  const len = Math.hypot(dx, dy);
  const k = len > md ? md / len : 1;
  const ex = drag.x0 + dx * k;
  const ey = drag.y0 + dy * k;

  ctx.save();
  ctx.strokeStyle = COLORS.hud;
  ctx.globalAlpha = 0.25;
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 6]);
  ctx.beginPath();
  ctx.arc(drag.x0, drag.y0, md, 0, TAU);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.globalAlpha = 0.8;
  ctx.strokeStyle = COLORS.ship;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(drag.x0, drag.y0);
  ctx.lineTo(ex, ey);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(drag.x0, drag.y0, 4, 0, TAU);
  ctx.arc(ex, ey, 10, 0, TAU);
  ctx.stroke();

  if (len > DEADZONE) {
    ctx.fillStyle = COLORS.ship;
    ctx.font = '12px ui-monospace, Menlo, Consolas, monospace';
    ctx.fillText(`${Math.round(Math.min(len / md, 1) * 100)}%`, ex + 14, ey - 14);
  }
  ctx.restore();
}

// The minimap shows the ship's current sector.
function drawMinimap(list) {
  const size = Math.round(clamp(view.w * 0.28, 90, 150));
  const pad = 12;
  const x0 = view.w - size - pad;
  const y0 = pad;
  const s = size / SECTOR;
  const [sx, sy] = sectorOf(ship.x, ship.y);
  const ox = sx * SECTOR, oy = sy * SECTOR;
  const owner = world.galaxy.territoryOf(sx, sy).owner;

  ctx.save();
  ctx.fillStyle = 'rgba(5, 6, 10, 0.75)';
  ctx.fillRect(x0, y0, size, size);
  ctx.strokeStyle = owner === null ? COLORS.dim : world.galaxy.factions[owner].color;
  ctx.globalAlpha = 0.6;
  ctx.lineWidth = 1;
  ctx.strokeRect(x0 + 0.5, y0 + 0.5, size - 1, size - 1);
  ctx.globalAlpha = 1;
  ctx.beginPath();
  ctx.rect(x0, y0, size, size);
  ctx.clip();

  for (const e of list) {
    if (e.x < ox || e.y < oy || e.x >= ox + SECTOR || e.y >= oy + SECTOR) continue;
    const [color, rad] = e.kind === 'star' ? [COLORS.star, 4]
      : e.kind === 'planet' ? [COLORS.planet, 3]
        : e.kind === 'station' ? [e.color, 2.5]
          : e.kind === 'wreck' ? ['#6f7a99', 1.5]
            : [e.faction === null || e.faction === undefined ? '#9aa4b8' : world.galaxy.factions[e.faction].color, 1.2];
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x0 + (e.x - ox) * s, y0 + (e.y - oy) * s, rad, 0, TAU);
    ctx.fill();
  }

  // Camera viewport.
  const vw = (view.w / view.zoom) * s;
  const vh = (view.h / view.zoom) * s;
  ctx.strokeStyle = COLORS.hud;
  ctx.globalAlpha = 0.3;
  ctx.strokeRect(x0 + (cam.x - ox) * s - vw / 2, y0 + (cam.y - oy) * s - vh / 2, vw, vh);
  ctx.globalAlpha = 1;

  ctx.translate(x0 + (ship.x - ox) * s, y0 + (ship.y - oy) * s);
  ctx.rotate(ship.angle);
  ctx.fillStyle = COLORS.ship;
  ctx.beginPath();
  ctx.moveTo(5, 0);
  ctx.lineTo(-3, 3);
  ctx.lineTo(-3, -3);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

const ZONE_LABEL = { known: 'KNOWN SPACE', deep: 'DEEP SPACE', frontier: 'FRONTIER' };

function drawHud() {
  const speed = Math.hypot(ship.vx, ship.vy);
  const pad = 12;
  const barW = Math.min(160, view.w * 0.4);
  const y = view.h - pad - 8;

  ctx.save();
  ctx.font = '12px ui-monospace, Menlo, Consolas, monospace';
  ctx.fillStyle = COLORS.hud;
  ctx.globalAlpha = 0.85;
  ctx.fillText(`SPD ${String(Math.round(speed)).padStart(3, ' ')}`, pad, y - 12);

  // Actual speed (filled) vs set throttle (marker).
  ctx.globalAlpha = 0.25;
  ctx.fillRect(pad, y, barW, 6);
  ctx.globalAlpha = 0.9;
  ctx.fillStyle = COLORS.ship;
  ctx.fillRect(pad, y, barW * (speed / SHIP.maxSpeed), 6);
  ctx.fillStyle = COLORS.flame;
  ctx.fillRect(pad + barW * (ship.targetSpeed / SHIP.maxSpeed) - 1, y - 3, 2, 12);

  // Where you are: sector, zone, system and owner.
  const [sx, sy] = sectorOf(ship.x, ship.y);
  const sec = world.sectors.at(sx, sy);
  const t = sec.territory;
  const f = world.galaxy.factions;
  ctx.globalAlpha = 0.85;
  ctx.fillStyle = COLORS.dim;
  ctx.fillText(`SECTOR ${sx},${sy} · ${ZONE_LABEL[t.zone]}`, pad, pad + 12);
  const place = sec.system ? sec.system.name : sec.outpost ? sec.outpost.name : null;
  const owner = t.owner !== null ? `${f[t.owner].name} ${Math.round(t.dominance * 100)}%` : sec.system?.freeport ? 'Freeport' : null;
  const line2 = [place, owner, t.contestedBy !== null ? `contested by ${f[t.contestedBy].name}` : null].filter(Boolean).join(' · ');
  if (line2) {
    ctx.fillStyle = t.owner !== null ? f[t.owner].color : COLORS.hud;
    ctx.fillText(line2, pad, pad + 28);
  }

  if (!interacted) {
    ctx.fillStyle = COLORS.hud;
    ctx.globalAlpha = 0.6 + 0.3 * Math.sin(performance.now() / 400);
    const direct = moveMode.value === 'direct';
    ctx.fillText(direct ? 'Hold and drag to fly; drag length sets speed' : 'Drag to fly; drag length sets speed', pad, pad + 56);
    ctx.fillText(direct ? 'Let go to stop' : 'Tap to stop', pad, pad + 72);
  }
  ctx.restore();
}

// ---------- Main loop ----------

function render() {
  const t = simTime;
  if (GalaxyMap.galaxy !== world.galaxy) loadGalaxy(GalaxyMap.galaxy); // re-rolled on the map
  const list = nearbyEntities(t);
  const [cx, cy] = sectorOf(cam.x, cam.y);
  origin.x = cx * SECTOR;
  origin.y = cy * SECTOR;

  ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, view.w, view.h);
  drawStarfield();

  ctx.save();
  ctx.translate(view.w / 2, view.h / 2);
  ctx.scale(view.zoom, view.zoom);
  ctx.translate(-rx(cam.x), -ry(cam.y));
  drawBounds();
  drawSectorGrid();
  drawEntities(list, t);
  drawParticles();
  drawShip(t);
  ctx.restore();

  drawLabels(list);
  drawDragIndicator();
  drawMinimap(list);
  drawHud();
}

let last = performance.now();
function frame(now) {
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  if (!GalaxyMap.isOpen) { // the map overlay pauses flight
    update(dt);
    render();
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
