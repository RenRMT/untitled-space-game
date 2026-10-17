// The frame loop: react (what follows from where things are) and render each frame, paused
// behind the settings menu; and the performance overlay (?perf or ?dev, P).
// Part of the flight view; src/main.js starts it.

import { ArtBodies } from '../art/bodies.js';
import { Art } from '../art/render.js';
import { COLORS, Theme } from '../core/theme.js';
import { SystemMap } from '../ui/map.js';
import { Messages } from '../ui/messages.js';
import { Settings } from '../ui/settings.js';
import { collectItems } from './cargo.js';
import { checkAggro, drawFight, drawFightOverlay, drawFoeMarkers, updateCombatPanel } from './combat.js';
import { docked } from './docking.js';
import { drawEntities, drawParticles, drawShip, origin, rx, ry } from './draw-world.js';
import { checkMarker, drawDragIndicator, drawHud, drawLabels, drawMinimap, drawNavMarkers, hudShown } from './hud.js';
import { tickHold } from './input.js';
import { drawTractorBeam } from './intro.js';
import { drawDebris, drawMining, drawMiningCountdown } from './mining.js';
import { drawGateWork, objective } from './missions.js';
import { drawSelection, placeMenu, updateSelection } from './selection.js';
import { drawStarfield, starCount } from './starfield.js';
import { cam, ctx, fight, flash, here, intro, ship, view } from './state.js';
import { nearbyEntities, tickTravel } from './travel.js';
import { simTime, update } from './update.js';
import { drawWarpOverlay, drawWarpWorld, warp } from './warp.js';
import { world } from './world.js';

// ---------- Main loop ----------

// What follows from where things are after a step (of dt seconds): items pulled in and picked
// up, the selection, a long press, pirates noticing the ship, reaching the player's marker, and the objective
// shown on the map. Not while paused, so nothing is picked up behind the settings menu.
export function react(list, dt = 0) {
  collectItems(list, dt);
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
  drawEntities(list, t);
  drawSelection(t);
  drawFight();
  drawDebris();
  drawMining(t);
  drawGateWork(t);
  drawParticles();
  if (intro.on) drawTractorBeam(t);
  drawWarpWorld();
  drawShip(t);
  ctx.restore();
  drawWarpOverlay();
  placeMenu();

  if (flash > 0) {
    ctx.fillStyle = `rgba(210, 240, 255, ${flash * flash * 0.85})`;
    ctx.fillRect(0, 0, view.w, view.h);
  }
  if (!warp.on) drawLabels(list); // names would hang in the streaks of a gate jump
  drawMiningCountdown();
  drawFightOverlay();
  if (!warp.on) drawNavMarkers();
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
export function drawPerf() {
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
  let sum = 0, worst = 0, gaps = 0;
  for (let i = 0; i < PERF_FRAMES; i++) { sum += perfStats.work[i]; worst = Math.max(worst, perfStats.work[i]); gaps += perfStats.gap[i]; }
  const fps = gaps > 0 ? (1000 * PERF_FRAMES) / gaps : 0;
  const lines = [
    `frame ${(sum / PERF_FRAMES).toFixed(1)} ms avg · ${worst.toFixed(1)} worst · ${Math.round(fps)} fps`,
    `entities ${perfStats.posed} posed · ${perfStats.drawn} drawn · ${starCount} stars`,
    `sprites ${s.sprites} cached · ${Math.round((s.spritePixels * 4) / 1e6)} MB · ${Math.round(perfStats.rates.builds)} built/s · ${Math.round(perfStats.rates.deferred)} waited/s`,
    `asteroids ${s.asteroids} cached · ${Math.round((s.asteroidPixels * 4) / 1e6)} MB · ${Math.round(perfStats.rates.asteroidBuilds)} built/s`,
    `moons and nebulae ${b.sprites} cached · ${Math.round((b.pixels * 4) / 1e6)} MB · ${b.builds} built`,
  ];
  ctx.save();
  ctx.font = Theme.font(11);
  ctx.fillStyle = 'rgba(12, 15, 24, 0.85)';
  ctx.fillRect(8, 92, 360, lines.length * 15 + 8);
  ctx.fillStyle = COLORS.cyan;
  lines.forEach((l, i) => ctx.fillText(l, 14, 108 + i * 15));
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
export function frame(now) {
  const dt = Math.min((now - last) / 1000, 0.05);
  const gap = now - last;
  last = now;
  const t0 = performance.now();
  Messages.tick(dt);
  tickTravel(dt);
  if (!SystemMap.isOpen && !docked) { // the map overlay and docking pause flight
    const paused = Settings.isOpen || resume.on; // the settings menu pauses it too, but keeps it drawn
    if (!paused) {
      update(dt);
      stillDrawn = false;
    }
    if (!stillDrawn) {
      const list = nearbyEntities(simTime);
      if (!paused) react(list, dt);
      render(list);
      stillDrawn = paused;
      recordFrame(performance.now() - t0, gap);
    }
  }
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
