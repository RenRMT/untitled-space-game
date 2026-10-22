// The frame loop: react (what follows from where things are) and render each frame, paused
// behind the settings menu; and the performance overlay (?perf or ?dev, P).
// Part of the flight view; src/main.js starts it.

import { ArtBodies } from '../art/bodies.js';
import { Art } from '../art/render.js';
import { COLORS, Theme } from '../core/theme.js';
import { SystemMap } from '../ui/map.js';
import { Messages } from '../ui/messages.js';
import { FactionsMenu } from '../ui/factions.js';
import { Settings } from '../ui/settings.js';
import { collectItems } from './cargo.js';
import { checkAggro, drawFight, drawFightOverlay, drawFoeMarkers, updateCombatPanel } from './combat.js';
import { docked } from './docking.js';
import { updateFieldBar } from './field.js';
import { drawEntities, drawParticles, drawShip, origin, rx, ry } from './draw-world.js';
import { checkMarker, drawDragIndicator, drawHud, drawLabels, drawMinimap, drawNavMarkers, hudShown } from './hud.js';
import { tickHold } from './input.js';
import { drawTractorBeam } from './intro.js';
import { drawDebris } from './mining.js';
import { drawFlareGlow, drawHazards } from './hazards.js';
import { drawGateWork, objective } from './missions.js';
import { drawSelection, placeMenu, updateSelection } from './selection.js';
import { drawStarfield, starCount } from './starfield.js';
import { cam, ctx, fight, flash, here, intro, ship, view } from './state.js';
import { nearbyEntities, tickTravel } from './travel.js';
import { simTime, update } from './update.js';
import { drawLanding, drawLandingOverlay, landing, onSurface, surfacePerf, tickLanding } from './landing.js';
import { drawWarpOverlay, drawWarpWorld, warp } from './warp.js';
import { world } from './world.js';

// ---------- Main loop ----------

// What follows from where things are after a step (of dt seconds): items pulled in and picked
// up, the selection, a long press, pirates noticing the ship, reaching the player's marker, and the objective
// shown on the map. Not while paused, so nothing is picked up behind the settings menu.
export function react(list, dt = 0) {
  if (!fight.wrecked) collectItems(list, dt); // a lost ship waiting for its tow picks nothing up
  updateSelection(list);
  tickHold(dt);
  checkAggro(list);
  checkMarker();
  const obj = here.objective = objective();
  SystemMap.objective = obj && { x: obj.x, y: obj.y, label: obj.text, station: obj.station ? obj.station.station.id : null };
}

export function render(list = nearbyEntities(simTime)) {
  if (!here.region) here.region = world.galaxy.regionAt(ship.x, ship.y); // drawn before the first step
  Art.beginFrame();
  const t = simTime;
  updateCombatPanel();
  origin.x = Math.round(cam.x / 5000) * 5000;
  origin.y = Math.round(cam.y / 5000) * 5000;

  ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, view.w, view.h);
  drawStarfield();

  ctx.save();
  ctx.translate(view.w / 2, view.h / 2);
  ctx.scale(view.zoom, view.zoom);
  ctx.translate(-rx(cam.x), -ry(cam.y));
  drawHazards(); // radiation belts, and shadows while a flare comes (game/hazards.js)
  drawEntities(list, t);
  drawSelection(t);
  drawFight();
  drawDebris();
  drawGateWork(t);
  drawParticles();
  if (intro.on) drawTractorBeam(t);
  drawWarpWorld();
  drawShip(t);
  ctx.restore();
  drawFlareGlow();
  drawWarpOverlay();
  drawLandingOverlay();
  placeMenu();

  if (flash > 0) {
    ctx.fillStyle = `rgba(210, 240, 255, ${flash * flash * 0.85})`;
    ctx.fillRect(0, 0, view.w, view.h);
  }
  const moving = warp.on || landing.on; // names and markers would hang in a gate jump's streaks, or over the globe
  if (!moving) drawLabels(list);
  drawFightOverlay();
  if (!moving) drawNavMarkers();
  drawFoeMarkers();
  drawDragIndicator();
  if (hudShown()) {
    drawMinimap(list);
    drawHud();
  }
  if (SystemMap.perf) drawPerf();
}

// ---------- Performance overlay (?perf or ?dev, toggled with P) ----------

export const PERF_FRAMES = 60;
export const perfStats = {
  posed: 0, drawn: 0, // entities posed (near the camera) and drawn (on screen) last frame
  work: new Float32Array(PERF_FRAMES), gap: new Float32Array(PERF_FRAMES), i: 0, // ms per frame
  rates: { builds: 0, asteroidBuilds: 0, deferred: 0 }, prev: null, prevT: 0, // sprite builds per second
};
export function recordFrame(workMs, gapMs) {
  if (perfStats.onFrame) perfStats.onFrame(workMs, gapMs); // tests/perf.js listens
  perfStats.work[perfStats.i] = workMs;
  perfStats.gap[perfStats.i] = gapMs;
  perfStats.i = (perfStats.i + 1) % PERF_FRAMES;
}
// surface: lines about the surface (game/landing.js) instead of space's entities and asteroids.
// Below the lines, a graph of the last PERF_FRAMES frames: the time between frames (the bar) and
// the time the frame's work took (its brighter base), with lines at 60 and 30 fps: a stutter is a
// tall bar.
export function drawPerf(surface = null) {
  const now = performance.now();
  const s = Art.stats(), b = ArtBodies.stats();

  if (!perfStats.prev || now - perfStats.prevT >= 1000) {
    if (perfStats.prev) {
      const secs = (now - perfStats.prevT) / 1000;
      perfStats.rates = {
        builds: (s.builds - perfStats.prev.builds) / secs, asteroidBuilds: (s.asteroidBuilds - perfStats.prev.asteroidBuilds) / secs,
        deferred: (s.deferred - perfStats.prev.deferred) / secs,
      };
    }
    perfStats.prev = s;
    perfStats.prevT = now;
  }
  let sum = 0, worst = 0, gaps = 0, worstGap = 0;
  for (let i = 0; i < PERF_FRAMES; i++) { sum += perfStats.work[i]; worst = Math.max(worst, perfStats.work[i]); gaps += perfStats.gap[i]; worstGap = Math.max(worstGap, perfStats.gap[i]); }
  const fps = gaps > 0 ? (1000 * PERF_FRAMES) / gaps : 0;
  const lines = [
    `frame ${(sum / PERF_FRAMES).toFixed(1)} ms avg · ${worst.toFixed(1)} worst · ${Math.round(fps)} fps · longest gap ${worstGap.toFixed(0)} ms`,
    ...(surface || [
      `entities ${perfStats.posed} posed · ${perfStats.drawn} drawn · ${starCount} stars`,
      `asteroids ${s.asteroids} cached · ${Math.round((s.asteroidPixels * 4) / 1e6)} MB · ${Math.round(perfStats.rates.asteroidBuilds)} built/s`,
      `moons and nebulae ${b.sprites} cached · ${Math.round((b.pixels * 4) / 1e6)} MB · ${b.builds} built`,
    ]),
    `sprites ${s.sprites} cached · ${Math.round((s.spritePixels * 4) / 1e6)} MB · ${Math.round(perfStats.rates.builds)} built/s · ${Math.round(perfStats.rates.deferred)} waited/s`,
  ];
  const x0 = 8, y0 = 92, w = Math.min(450, view.w - 16), gh = 44, ty = y0 + lines.length * 15 + 12;
  ctx.save();
  ctx.font = Theme.font(11);
  ctx.fillStyle = 'rgba(12, 15, 24, 0.85)';
  ctx.fillRect(x0, y0, w, lines.length * 15 + gh + 20);
  ctx.fillStyle = COLORS.cyan;
  lines.forEach((l, i) => ctx.fillText(l, x0 + 6, y0 + 16 + i * 15));
  // The graph, oldest frame on the left; 50 ms fills its height.
  const bw = (w - 12) / PERF_FRAMES, hy = (ms) => ty + gh - Math.min(gh, (ms / 50) * gh);
  for (let n = 0; n < PERF_FRAMES; n++) {
    const i = (perfStats.i + n) % PERF_FRAMES, g = perfStats.gap[i], wk = perfStats.work[i], x = x0 + 6 + n * bw;
    ctx.fillStyle = g > 34 ? COLORS.hostile : g > 18 ? COLORS.amber : COLORS.cyan;
    ctx.globalAlpha = 0.45;
    ctx.fillRect(x, hy(g), bw - 1, ty + gh - hy(g));
    ctx.globalAlpha = 0.95;
    ctx.fillRect(x, hy(wk), bw - 1, ty + gh - hy(wk));
  }
  ctx.globalAlpha = 0.5;
  ctx.fillStyle = COLORS.hud;
  for (const ms of [16.7, 33.3]) ctx.fillRect(x0 + 6, Math.round(hy(ms)), w - 12, 1);
  ctx.restore();
}

// While paused (the settings menu), the frame is drawn once and then left as it is until
// something changes it (invalidate: a setting, a resize).
export let stillDrawn = false;
export function invalidate() { stillDrawn = false; }

// Coming back to a fight: if the page was hidden mid-fight (a call, another app), flight stays
// paused behind a "tap to resume" screen, so the player isn't dropped straight back under fire.
export const resume = { el: null, on: false };
export function pauseForResume() {
  resume.el ||= document.getElementById('resume');
  resume.on = true;
  resume.el.hidden = false;
  invalidate();
}
function resumePlay() {
  resume.on = false;
  resume.el.hidden = true;
  last = performance.now();
}

export let last = performance.now();
let logShown = -1; // the event log's version last drawn: a paused frame redraws when it changes
export function frame(now) {
  const dt = Math.min((now - last) / 1000, 0.05);
  const gap = now - last;
  last = now;
  const t0 = performance.now();
  Messages.tick(dt);
  tickTravel(dt);
  if (onSurface()) { // on a planet's surface (game/landing.js) space is left as it was
    if (!SystemMap.isOpen) { // the map covers it, and pauses it
      if (!(Settings.isOpen || FactionsMenu.isOpen)) tickLanding(dt);
      drawLanding(simTime);
      recordFrame(performance.now() - t0, gap);
      if (SystemMap.perf) drawPerf(surfacePerf());
    }
  } else if (!SystemMap.isOpen && !docked) { // the map overlay and docking pause flight
    const paused = Settings.isOpen || FactionsMenu.isOpen || resume.on; // the menus pause it too, but keep it drawn
    if (!paused) {
      update(dt);
      stillDrawn = false;
    }
    if (Messages.version !== logShown) { logShown = Messages.version; stillDrawn = false; }
    if (!stillDrawn) {
      const list = nearbyEntities(simTime);
      if (!paused) react(list, dt);
      render(list);
      stillDrawn = paused;
      recordFrame(performance.now() - t0, gap);
    }
  }
  updateFieldBar(); // the consumables on the HUD (game/field.js)
  requestAnimationFrame(frame);
}

// Wiring, run once every module has loaded (src/main.js).
export function init() {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && fight.s) pauseForResume();
  });
  const el = document.getElementById('resume');
  el.addEventListener('click', resumePlay);
}
