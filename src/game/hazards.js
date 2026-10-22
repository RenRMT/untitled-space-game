// Hazards in flight (rules/hazards.js): the star's heat, radiation from the giants' belts and the
// moons, solar flares and the shadows that shelter from them, ion storms in the nebulae, and fuel.
// Each step adds up what comes in to the ship's meters: heat (sheds on its own), radiation (stays
// until a station decontaminates the ship: docking) and fuel (refuelled at a station). Warnings come
// as notices and vibration as a meter fills; a full one, or an empty tank, disables the ship, which
// is lost and towed home (game/combat.js wreck), its hold left where it was, to go back for.
// Also what's drawn of them: the belts (with their gaps), the shadows while a flare comes, a glow
// over the screen in a flare's wave, and the HUD's warning line.
// Only in open flight: not docked, landing, jumping, in the introduction or wrecked. On a planet's
// surface game/surface-run.js does the same with that surface's hazards.
// Part of the flight view; src/main.js starts it.

import { Feedback } from '../core/feedback.js';
import { COLORS } from '../core/theme.js';
import { Hazards } from '../rules/hazards.js';
import { cargo, saveCargo } from './cargo.js';
import { endExtraction, wreck } from './combat.js';
import { docked } from './docking.js';
import { rx, ry } from './draw-world.js';
import { landing } from './landing.js';
import { frameList } from './selection.js';
import { SHIP, TAU, clamp, ctx, fight, here, intro, notify, ship, view } from './state.js';
import { simTime } from './update.js';
import { warp } from './warp.js';
import { world } from './world.js';

// heat: the ship's heat now (not saved: it sheds); exp: the last step's exposure (rules/hazards.js);
// stranded: seconds drifting with an empty tank; said: the warnings given, so each is said once
// until its meter falls back.
export const hazard = { heat: 0, exp: null, stranded: 0, said: new Set() };
export const STRANDED_TOW = 6; // seconds adrift with no fuel before the tow is called
const WARN = { heat: [60, 85], rad: [50, 75, 90], fuel: [25, 10] }; // % at which each meter warns
const BIG_ROCK = 24; // asteroids at least this big cast a shadow

export const outOfFuel = () => cargo.fuel <= 0;
const active = () => !docked && !intro.on && !landing.on && !warp.on && !fight.wrecked && !(fight.wreckT > 0);

// A warning as a meter passes a step up (said again only once it has fallen below it).
function warn(meter, pct, text, tone = 'warn') {
  for (const step of WARN[meter]) {
    const key = `${meter}:${step}`;
    if (pct >= step && !hazard.said.has(key)) { hazard.said.add(key); notify(text(step), 3, { tone: step === WARN[meter][WARN[meter].length - 1] ? 'hostile' : tone }); Feedback.emit('hazard'); }
    else if (pct < step - 5) hazard.said.delete(key);
  }
}

export function tickHazards(dt) {
  if (!active()) { hazard.exp = null; return; }
  const G = world.galaxy, H = Hazards.config;
  const blockers = frameList.filter((e) => e.kind === 'asteroid' && e.radius >= BIG_ROCK).map((e) => ({ x: e.x, y: e.y, r: e.radius }));
  const before = hazard.exp;
  const exp = hazard.exp = Hazards.exposure(G, G.seed, ship.x, ship.y, simTime, { thrust: outOfFuel() ? 0 : ship.thrust, blockers, nebula: here.region?.nebula });
  hazard.heat = clamp(hazard.heat + (exp.heat - H.heat.cool) * dt, 0, H.max);
  cargo.rad = Math.min(H.max, cargo.rad + exp.rad * dt);
  if (!outOfFuel()) cargo.fuel = Math.max(0, cargo.fuel - H.fuel.burn * ship.thrust * dt);
  // An ion storm pushes the ship about.
  if (exp.storm) { ship.vx += exp.storm.wind[0] * dt; ship.vy += exp.storm.wind[1] * dt; }

  // The flare coming, and its wave.
  const f = exp.flare, was = before?.flare.phase;
  if (f.phase === 'warning' && was === 'calm') { notify(`Solar flare in ${Math.ceil(f.in)} s · get into a planet's shadow`, 4, { tone: 'warn' }); Feedback.emit('hazard'); }
  if (f.phase === 'wave' && was === 'warning') { notify(exp.shadow ? `Solar flare · sheltered by ${exp.shadow.name || 'a rock'}` : 'Solar flare · exposed!', 3, { tone: exp.shadow ? 'info' : 'hostile' }); Feedback.emit('hazard'); }
  if (exp.storm && !before?.storm) notify('Ion storm · sensors dark, the ship is pushed off course', 3, { tone: 'warn' });

  meterWarnings();

  if (hazard.heat >= H.max) disable('Overheated');
  else if (cargo.rad >= H.max) disable('Radiation overload');
  else if (outOfFuel()) {
    if (hazard.stranded === 0) notify(`Out of fuel · drifting, calling a tow in ${STRANDED_TOW} s`, STRANDED_TOW, { tone: 'hostile' });
    hazard.stranded += dt;
    if (hazard.stranded >= STRANDED_TOW) disable('Out of fuel');
  } else hazard.stranded = 0;
}

// Warnings as the meters fill (and fuel as it falls); also on a surface (game/surface-run.js).
export function meterWarnings() {
  const H = Hazards.config;
  warn('heat', (100 * hazard.heat) / H.max, (p) => `Heat ${p}% · ${p >= 85 ? (landing.on ? 'take off, or out of the sun!' : 'get away from the star!') : 'move out of the heat'}`);
  warn('rad', (100 * cargo.rad) / H.max, (p) => `Radiation ${p}% · ${p >= 90 ? 'dock to decontaminate now!' : 'it stays until you dock'}`);
  const fuelPct = SHIP.fuel ? (100 * cargo.fuel) / SHIP.fuel : 0;
  for (const step of WARN.fuel) { // fuel warns as it falls
    const key = `fuel:${step}`;
    if (fuelPct <= step && !hazard.said.has(key)) { hazard.said.add(key); notify(`Fuel ${step}% · refuel at a station`, 3, { tone: step <= 10 ? 'hostile' : 'warn' }); Feedback.emit('hazard'); }
    else if (fuelPct > step + 5) hazard.said.delete(key);
  }
}

// A meter full, or the tank empty: the ship is lost (in a fight with ships, that fight decides).
function disable(reason) {
  if (fight.s && !fight.extract) return;
  endExtraction();
  wreck(reason);
}

// The tow home, or docking: heat gone; docking also decontaminates (towHome and dock call these).
export function cooled() { hazard.heat = 0; hazard.stranded = 0; hazard.said.clear(); }
export function decontaminate() {
  const had = cargo.rad >= 1;
  cargo.rad = 0;
  cooled();
  saveCargo();
  return had;
}
// Towed home: cooled and decontaminated, with enough fuel to reach a pump.
export function rescued() {
  decontaminate();
  cargo.fuel = Math.max(cargo.fuel, SHIP.fuel * 0.25);
}

// ---------- Drawing ----------

// In world space, under everything: each giant's radiation belt near the camera (its band, with the
// gaps left clear), and while a flare comes, the shadows behind the planets, moons and big rocks.
export function drawHazards() {
  const G = world.galaxy, R = Hazards.config.rad, reach = Math.max(view.w, view.h) / view.zoom;
  ctx.save();
  for (const p of G.planets) {
    if (!Hazards.GIANTS.includes(p.type) || Math.hypot(p.x - ship.x, p.y - ship.y) > reach + p.body + R.beltOut) continue;
    const edge = p.body, mid = edge + (R.beltIn + R.beltOut) / 2, width = R.beltOut - R.beltIn;
    // The band, drawn as one arc from the end of each gap to the start of the next.
    const gaps = Hazards.beltGaps(p).map(([a, b]) => [((a % TAU) + TAU) % TAU, ((a % TAU) + TAU) % TAU + (b - a)]).sort((u, v) => u[0] - v[0]);
    ctx.strokeStyle = COLORS.hostile;
    ctx.globalAlpha = 0.07;
    ctx.lineWidth = width;
    gaps.forEach(([, end], i) => {
      const next = gaps[(i + 1) % gaps.length][0] + (i + 1 === gaps.length ? TAU : 0);
      if (next <= end) return; // gaps that overlap
      ctx.beginPath();
      ctx.arc(rx(p.x), ry(p.y), mid, end, next);
      ctx.stroke();
    });
    ctx.globalAlpha = 0.25;
    ctx.lineWidth = 1.5 / view.zoom;
    ctx.setLineDash([10 / view.zoom, 12 / view.zoom]);
    for (const r of [edge + R.beltIn, edge + R.beltOut]) { ctx.beginPath(); ctx.arc(rx(p.x), ry(p.y), r, 0, TAU); ctx.stroke(); }
    ctx.setLineDash([]);
  }
  const f = hazard.exp?.flare;
  if (f && f.phase !== 'calm') {
    const star = G.stars.reduce((b, s) => (!b || Math.hypot(s.x - ship.x, s.y - ship.y) < Math.hypot(b.x - ship.x, b.y - ship.y) ? s : b), null);
    const casters = [...G.planets, ...G.moons, ...frameList.filter((e) => e.kind === 'asteroid' && e.radius >= BIG_ROCK).map((e) => ({ x: e.x, y: e.y, r: e.radius }))];
    ctx.fillStyle = COLORS.bg;
    ctx.globalAlpha = f.phase === 'wave' ? 0.45 : 0.3;
    for (const b of casters) {
      if (Math.hypot(b.x - ship.x, b.y - ship.y) > reach * 1.5) continue;
      const a = Math.atan2(b.y - star.y, b.x - star.x), nx = -Math.sin(a), ny = Math.cos(a), len = reach * 2;
      ctx.beginPath();
      ctx.moveTo(rx(b.x + nx * b.r), ry(b.y + ny * b.r));
      ctx.lineTo(rx(b.x + nx * b.r + Math.cos(a) * len), ry(b.y + ny * b.r + Math.sin(a) * len));
      ctx.lineTo(rx(b.x - nx * b.r + Math.cos(a) * len), ry(b.y - ny * b.r + Math.sin(a) * len));
      ctx.lineTo(rx(b.x - nx * b.r), ry(b.y - ny * b.r));
      ctx.closePath();
      ctx.fill();
    }
  }
  ctx.restore();
}

// In screen space: a glow over everything in a flare's wave, when nothing shades the ship.
export function drawFlareGlow() {
  const e = hazard.exp;
  if (!e || e.flare.phase !== 'wave' || e.shadow) return;
  ctx.save();
  ctx.fillStyle = COLORS.flame;
  ctx.globalAlpha = 0.1 + 0.04 * Math.sin(performance.now() / 120);
  ctx.fillRect(0, 0, view.w, view.h);
  ctx.restore();
}

// The HUD's line about what's coming or happening: [text, colour] or null.
export function hazardLine() {
  const e = hazard.exp;
  if (!e) return null;
  const f = e.flare;
  if (f.phase === 'warning') return [`SOLAR FLARE IN ${Math.ceil(f.in)} s · ${e.shadow ? 'in shadow' : 'find a shadow'}`, e.shadow ? COLORS.hud : COLORS.amber];
  if (f.phase === 'wave') return [`SOLAR FLARE · ${e.shadow ? 'sheltered' : 'EXPOSED'} · ${Math.ceil(f.left)} s`, e.shadow ? COLORS.hud : COLORS.hostile];
  if (e.storm) return ['ION STORM · sensors dark', COLORS.amber];
  if (outOfFuel()) return [`OUT OF FUEL · tow in ${Math.max(0, Math.ceil(STRANDED_TOW - hazard.stranded))} s`, COLORS.hostile];
  return null;
}
