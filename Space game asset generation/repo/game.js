'use strict';

// ---------- Setup ----------

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const TAU = Math.PI * 2;

const WORLD = { w: 6000, h: 6000 };

const COLORS = {
  bg: '#05060a',
  ship: '#7df9ff',
  flame: '#ffb347',
  station: '#b6ff8a',
  planet: '#8ab4ff',
  star: '#ffd27a',
  bounds: '#ff5a6e',
  hud: '#cfd8ff',
};

// Handling stats; later these become per-ship-class values.
const SHIP = { maxSpeed: 650, accel: 520, turnRate: 3.6, radius: 16 };

const ship = {
  x: 2600, y: 2820,
  vx: 0, vy: 0,
  angle: -Math.PI / 2,
  targetAngle: -Math.PI / 2,
  targetSpeed: 0,
  thrust: 0,
};

const star = { name: 'Helion', x: 4300, y: 1700, r: 230 };
const planet = { name: 'Calder IV', x: 1500, y: 4300, r: 150 };
const station = { name: 'Tarsis Station', x: 2600, y: 2600, r: 90, spin: 0 };

const view = { w: 0, h: 0, dpr: 1, zoom: 1 };
const cam = { x: ship.x, y: ship.y };
const particles = [];

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
  if (e.type === 'pointerup' && drag.moved < DEADZONE) ship.targetSpeed = 0; // tap = all stop
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
  if (ship.targetSpeed > 0) ship.angle = turnToward(ship.angle, ship.targetAngle, SHIP.turnRate * dt);

  // Velocity eases toward (heading * set speed), so turning produces some drift.
  const hx = Math.cos(ship.angle);
  const hy = Math.sin(ship.angle);
  const dvx = hx * ship.targetSpeed - ship.vx;
  const dvy = hy * ship.targetSpeed - ship.vy;
  const dv = Math.hypot(dvx, dvy);
  if (dv > 0) {
    const k = Math.min(1, (SHIP.accel * dt) / dv);
    ship.vx += dvx * k;
    ship.vy += dvy * k;
  }

  const along = dv > 5 ? (dvx * hx + dvy * hy) / dv : 0;
  const thrustTarget = ship.targetSpeed > 0 ? Math.max(0.2, along) : 0;
  ship.thrust = lerp(ship.thrust, thrustTarget, 1 - Math.exp(-10 * dt));

  ship.x += ship.vx * dt;
  ship.y += ship.vy * dt;

  // Bounding box: clamp and bounce softly.
  const m = SHIP.radius;
  if (ship.x < m) { ship.x = m; ship.vx = Math.abs(ship.vx) * 0.3; }
  if (ship.x > WORLD.w - m) { ship.x = WORLD.w - m; ship.vx = -Math.abs(ship.vx) * 0.3; }
  if (ship.y < m) { ship.y = m; ship.vy = Math.abs(ship.vy) * 0.3; }
  if (ship.y > WORLD.h - m) { ship.y = WORLD.h - m; ship.vy = -Math.abs(ship.vy) * 0.3; }

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

  station.spin += dt * 0.15;

  // Camera leads in the direction of travel.
  const lead = 0.45;
  const k = 1 - Math.exp(-4 * dt);
  cam.x = lerp(cam.x, ship.x + ship.vx * lead, k);
  cam.y = lerp(cam.y, ship.y + ship.vy * lead, k);
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

// ---------- World objects ----------

function drawBounds() {
  ctx.save();
  ctx.beginPath();
  ctx.rect(-1e5, -1e5, 2e5, 2e5);
  ctx.rect(0, 0, WORLD.w, WORLD.h);
  ctx.fillStyle = 'rgba(255, 60, 90, 0.06)';
  ctx.fill('evenodd');

  const edgeDist = Math.min(ship.x, ship.y, WORLD.w - ship.x, WORLD.h - ship.y);
  const warn = clamp(1 - edgeDist / 600, 0, 1);
  ctx.strokeStyle = COLORS.bounds;
  ctx.globalAlpha = 0.35 + 0.65 * warn;
  ctx.lineWidth = 3;
  ctx.setLineDash([30, 20]);
  ctx.strokeRect(0, 0, WORLD.w, WORLD.h);
  ctx.restore();
}

function drawStar(t) {
  const { x, y, r } = star;
  const glow = ctx.createRadialGradient(x, y, r * 0.6, x, y, r * 3.2);
  glow.addColorStop(0, 'rgba(255, 200, 110, 0.35)');
  glow.addColorStop(1, 'rgba(255, 160, 60, 0)');
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(x, y, r * 3.2, 0, TAU);
  ctx.fill();

  const core = ctx.createRadialGradient(x, y, 0, x, y, r);
  core.addColorStop(0, '#fff8e0');
  core.addColorStop(0.7, '#ffd27a');
  core.addColorStop(1, '#ff9d3a');
  ctx.fillStyle = core;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.fill();

  ctx.strokeStyle = COLORS.star;
  ctx.lineWidth = 2;
  ctx.globalAlpha = 0.6;
  ctx.beginPath();
  for (let i = 0; i < 28; i++) {
    const a = (i / 28) * TAU + t * 0.04;
    const outer = r * (1.25 + 0.12 * Math.sin(t * 1.3 + i * 1.7));
    ctx.moveTo(x + Math.cos(a) * r * 1.1, y + Math.sin(a) * r * 1.1);
    ctx.lineTo(x + Math.cos(a) * outer, y + Math.sin(a) * outer);
  }
  ctx.stroke();
  ctx.globalAlpha = 1;
}

function drawPlanet() {
  const { x, y, r } = planet;
  const lit = Math.atan2(star.y - y, star.x - x);
  const ringTilt = -0.35;
  const ringA = r * 1.9, ringB = r * 0.5;

  ctx.strokeStyle = COLORS.planet;
  ctx.lineWidth = 2;

  // Ring, back half (hidden behind the planet body).
  ctx.globalAlpha = 0.5;
  ctx.beginPath();
  ctx.ellipse(x, y, ringA, ringB, ringTilt, Math.PI, TAU);
  ctx.stroke();
  ctx.globalAlpha = 0.3;
  ctx.beginPath();
  ctx.ellipse(x, y, ringA * 0.88, ringB * 0.88, ringTilt, Math.PI, TAU);
  ctx.stroke();
  ctx.globalAlpha = 1;

  const body = ctx.createRadialGradient(
    x + Math.cos(lit) * r * 0.45, y + Math.sin(lit) * r * 0.45, r * 0.1, x, y, r * 1.05);
  body.addColorStop(0, '#3f6db8');
  body.addColorStop(1, '#070b16');
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.fill();
  ctx.stroke();

  // Cloud bands, line art clipped to the disc.
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.clip();
  ctx.globalAlpha = 0.35;
  ctx.lineWidth = 1.5;
  for (let i = -3; i <= 3; i++) {
    ctx.beginPath();
    ctx.ellipse(x, y + i * r * 0.27, r * 1.1, r * 0.12, ringTilt, 0, Math.PI);
    ctx.stroke();
  }
  ctx.restore();

  // Ring, front half.
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.ellipse(x, y, ringA, ringB, ringTilt, 0, Math.PI);
  ctx.stroke();
  ctx.globalAlpha = 0.5;
  ctx.beginPath();
  ctx.ellipse(x, y, ringA * 0.88, ringB * 0.88, ringTilt, 0, Math.PI);
  ctx.stroke();
  ctx.globalAlpha = 1;
}

function drawStation(t) {
  const { x, y, r } = station;
  ctx.save();
  ctx.translate(x, y);
  ctx.strokeStyle = COLORS.station;
  ctx.fillStyle = COLORS.bg;
  ctx.lineWidth = 2;

  // Rotating habitat ring.
  ctx.save();
  ctx.rotate(station.spin);
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, TAU);
  ctx.moveTo(r * 0.82, 0);
  ctx.arc(0, 0, r * 0.82, 0, TAU);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * TAU;
    ctx.moveTo(Math.cos(a) * r * 0.28, Math.sin(a) * r * 0.28);
    ctx.lineTo(Math.cos(a) * r * 0.82, Math.sin(a) * r * 0.82);
  }
  ctx.stroke();
  for (let i = 0; i < 8; i++) {
    ctx.save();
    ctx.rotate((i / 8) * TAU + TAU / 16);
    ctx.fillRect(r * 0.8, -7, r * 0.22, 14);
    ctx.strokeRect(r * 0.8, -7, r * 0.22, 14);
    ctx.restore();
  }
  ctx.restore();

  // Fixed spine with solar panels and docking hub.
  ctx.beginPath();
  ctx.rect(-6, -r * 1.55, 12, r * 3.1);
  ctx.fill();
  ctx.stroke();
  for (const sy of [-1, 1]) {
    const py = sy * r * 1.55;
    ctx.beginPath();
    ctx.rect(-r * 0.7, py - 10, r * 1.4, 20);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    for (let i = -2; i <= 2; i++) {
      ctx.moveTo(i * r * 0.28, py - 10);
      ctx.lineTo(i * r * 0.28, py + 10);
    }
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.28, 0, TAU);
  ctx.fill();
  ctx.stroke();

  // Blinking nav lights.
  const on = Math.sin(t * 3) > 0.6;
  ctx.fillStyle = on ? '#ff4d4d' : '#4d1515';
  ctx.beginPath(); ctx.arc(-r * 0.7, -r * 1.55, 4, 0, TAU); ctx.fill();
  ctx.fillStyle = on ? '#4dff88' : '#154d25';
  ctx.beginPath(); ctx.arc(r * 0.7, r * 1.55, 4, 0, TAU); ctx.fill();
  ctx.restore();
}

const SHIP_HULL = [[20, 0], [-8, 11], [-4, 4], [-11, 4], [-11, -4], [-4, -4], [-8, -11]];

function drawShip(t) {
  ctx.save();
  ctx.translate(ship.x, ship.y);
  ctx.rotate(ship.angle);
  ctx.lineJoin = 'round';

  if (ship.thrust > 0.02) {
    const len = (8 + 24 * ship.thrust) * (0.85 + 0.15 * Math.sin(t * 45));
    ctx.strokeStyle = COLORS.flame;
    ctx.fillStyle = 'rgba(255, 179, 71, 0.25)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(-11, -3);
    ctx.lineTo(-11 - len, 0);
    ctx.lineTo(-11, 3);
    ctx.fill();
    ctx.stroke();
  }

  ctx.shadowColor = COLORS.ship;
  ctx.shadowBlur = 10;
  ctx.strokeStyle = COLORS.ship;
  ctx.fillStyle = COLORS.bg;
  ctx.lineWidth = 2;
  ctx.beginPath();
  SHIP_HULL.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.shadowBlur = 0;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(9, 0);
  ctx.lineTo(1, 2.5);
  ctx.lineTo(1, -2.5);
  ctx.closePath();
  ctx.stroke();
  ctx.restore();
}

function drawParticles() {
  ctx.fillStyle = COLORS.flame;
  for (const p of particles) {
    ctx.globalAlpha = (p.life / p.max) * 0.7;
    ctx.fillRect(p.x - 1.5, p.y - 1.5, 3, 3);
  }
  ctx.globalAlpha = 1;
}

// ---------- Screen-space overlays ----------

const worldToScreen = (x, y) => [
  (x - cam.x) * view.zoom + view.w / 2,
  (y - cam.y) * view.zoom + view.h / 2,
];

function drawLabels() {
  ctx.font = '12px ui-monospace, Menlo, Consolas, monospace';
  ctx.textAlign = 'center';
  ctx.globalAlpha = 0.7;
  for (const [body, color, offset] of [
    [star, COLORS.star, star.r * 1.5],
    [planet, COLORS.planet, planet.r * 1.3],
    [station, COLORS.station, station.r * 1.8],
  ]) {
    const [sx, sy] = worldToScreen(body.x, body.y + offset);
    ctx.fillStyle = color;
    ctx.fillText(body.name.toUpperCase(), sx, sy + 14);
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

function drawMinimap() {
  const size = Math.round(clamp(view.w * 0.28, 90, 150));
  const pad = 12;
  const x0 = view.w - size - pad;
  const y0 = pad;
  const s = size / WORLD.w;

  ctx.save();
  ctx.fillStyle = 'rgba(5, 6, 10, 0.75)';
  ctx.fillRect(x0, y0, size, size);
  ctx.strokeStyle = COLORS.bounds;
  ctx.globalAlpha = 0.6;
  ctx.lineWidth = 1;
  ctx.strokeRect(x0 + 0.5, y0 + 0.5, size - 1, size - 1);
  ctx.globalAlpha = 1;

  const dot = (b, color, rad) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x0 + b.x * s, y0 + b.y * s, rad, 0, TAU);
    ctx.fill();
  };
  dot(star, COLORS.star, 4);
  dot(planet, COLORS.planet, 3);
  dot(station, COLORS.station, 2.5);

  // Camera viewport.
  const vw = (view.w / view.zoom) * s;
  const vh = (view.h / view.zoom) * s;
  ctx.strokeStyle = COLORS.hud;
  ctx.globalAlpha = 0.3;
  ctx.strokeRect(x0 + cam.x * s - vw / 2, y0 + cam.y * s - vh / 2, vw, vh);
  ctx.globalAlpha = 1;

  ctx.translate(x0 + ship.x * s, y0 + ship.y * s);
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

  if (!interacted) {
    ctx.fillStyle = COLORS.hud;
    ctx.globalAlpha = 0.6 + 0.3 * Math.sin(performance.now() / 400);
    ctx.fillText('Drag to fly; drag length sets speed', pad, pad + 12);
    ctx.fillText('Tap to stop', pad, pad + 28);
  }
  ctx.restore();
}

// ---------- Main loop ----------

function render(t) {
  ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, view.w, view.h);
  drawStarfield();

  ctx.save();
  ctx.translate(view.w / 2, view.h / 2);
  ctx.scale(view.zoom, view.zoom);
  ctx.translate(-cam.x, -cam.y);
  drawBounds();
  drawStar(t);
  drawPlanet();
  drawStation(t);
  drawParticles();
  drawShip(t);
  ctx.restore();

  drawLabels();
  drawDragIndicator();
  drawMinimap();
  drawHud();
}

let last = performance.now();
function frame(now) {
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  if (!GalaxyMap.isOpen) { // the map overlay pauses flight
    update(dt);
    render(now / 1000);
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
