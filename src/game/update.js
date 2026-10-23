// The simulation step: flight, particles, every part's tick, sensors and the camera.
// Part of the flight view; src/main.js starts it.

import { Flight } from '../flight/flight.js';
import { CombatPanel } from '../ui/combat-panel.js';
import { Comms } from '../ui/comms.js';
import { SystemMap } from '../ui/map.js';
import { tickFight, tickShield } from './combat.js';
import { tickCollisions } from './collisions.js';
import { dashing, tickDash } from './dash.js';
import { hazard, tickHazards } from './hazards.js';
import { gapTo } from './docking.js';
import { updateRegion } from './draw-world.js';
import { TRACTOR, arriveView, tickArrive, tickBeam, tickIntro } from './intro.js';
import { steady } from './input.js';
import { tickIndustry } from './industry.js';
import { tickLab } from './lab.js';
import { tickMining } from './mining.js';
import { tickMission } from './missions.js';
import { moveMode } from './options.js';
import { sense } from './outfitting.js';
import { tickAutopilot } from './selection.js';
import { tickWings } from './squad.js';
import { landingCamera, tickLanding } from './landing.js';
import { tickWarp, warp, warpZoom } from './warp.js';
import { SHIP, cam, debris, fadeFlash, fight, fightMode, intro, lerp, particles, ship, toast, view } from './state.js';

export let simTime = 0; // advances only while flying, so the map pause doesn't make ships jump
export let senseTimer = 0;
// Flight time moved on at once, for the tests (tests/smoke.js: to a solar flare, rules/hazards.js).
export function skipTime(secs) { simTime += secs; }

export function update(dt) {
  simTime += dt;
  tickDash(dt);
  tickLab();
  tickIndustry();
  tickAutopilot();
  // Turning, speed and drift by the engine's numbers, in the chosen movement mode (flight/flight.js);
  // in the introduction's tractor beam, the beam's pull.
  if (intro.on && !intro.flying) ship.targetSpeed = 0; // the pod waits while the station talks
  if (intro.arrive) tickArrive(dt);
  else if (intro.beam) tickBeam(dt);
  else if (tickWarp(dt)) { /* a gate jump steers the ship (game/warp.js) */ } else if (tickLanding(dt)) { /* so does landing (game/landing.js) */ } else {
    Flight.step(ship, SHIP, { targetAngle: ship.targetAngle, targetSpeed: ship.targetSpeed, mode: moveMode.value, coast: dashing() }, dt);
    if (!intro.on) tickCollisions(); // bouncing off asteroids and stations (game/collisions.js)
  }
  tickHazards(dt); // heat, radiation, flares, storms and fuel (game/hazards.js)
  const hx = Math.cos(ship.angle);
  const hy = Math.sin(ship.angle);

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
  for (const list of [particles, debris]) {
    for (let i = list.length - 1; i >= 0; i--) {
      const p = list[i];
      p.life -= dt;
      if (p.life <= 0) { list.splice(i, 1); continue; }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
  }
  tickMining(dt); // shards crumbling, the tools picking their next rock (game/mining.js)
  tickFight(dt);
  tickShield(dt);
  tickWings(dt);
  tickIntro(dt);
  tickMission(dt);

  fadeFlash(dt);
  toast.t = Math.max(0, toast.t - dt);
  updateRegion();
  // Ship sensors look for contacts around it, a few times a second (not in an ion storm).
  senseTimer -= dt;
  if (senseTimer <= 0 && !hazard.exp?.storm) {
    senseTimer = 0.25;
    sense();
  }

  // Camera leads in the direction of travel. In a fight with ships it frames the ship and its
  // target in the space above the combat panel (held as it was while a drag goes on: steady); in
  // real time it leans only so far, keeping your own ship well on screen when the target is far
  // off. Mining is a fight too (game/combat.js extract), but with no panel and the tools picking
  // their own rocks, so it leads as plain flight does.
  const lead = 0.45;
  const k = 1 - Math.exp(-4 * dt);
  let tx = ship.x + ship.vx * lead, ty = ship.y + ship.vy * lead;
  if (warp.on) { tx = ship.x; ty = ship.y; } // a gate jump's speed would throw the lead far ahead
  const focus = fight.s && !fight.extract && fight.ships.get(fight.s.focus);
  if (focus) {
    const top = CombatPanel.top;
    const covered = steady('fight', top === null ? 0 : Math.max(0, view.h - top));
    let dx = (focus.x - ship.x) / 2, dy = (focus.y - ship.y) / 2;
    if (fightMode().flying) {
      const max = (Math.min(view.w, view.h - covered) * 0.3) / view.zoom, len = Math.hypot(dx, dy);
      if (len > max) { dx *= max / len; dy *= max / len; }
    }
    tx = ship.x + dx;
    ty = ship.y + dy + covered / 2 / view.zoom;
  }
  // The introduction frames the pod and the station together above the comms box, unless the pod
  // has flown off.
  if (intro.on && gapTo(intro.station) < 1500) {
    const top = Comms.top, covered = steady('intro', top === null ? 0 : Math.max(0, view.h - top + 12));
    tx = (ship.x + intro.station.x) / 2;
    ty = (ship.y + intro.station.y) / 2 + covered / 2 / view.zoom;
  }
  cam.x = lerp(cam.x, tx, k);
  cam.y = lerp(cam.y, ty, k);
  // The opening shot pulls back from the pod to frame it with the station (arriveView).
  if (intro.arrive) arriveView();
  // Zoom eases out for the introduction and back after it.
  const zk = intro.on ? TRACTOR.zoom : 1;
  if (intro.arrive) { /* set by arriveView */ } else if (view.k !== zk) {
    view.k = Math.abs(view.k - zk) < 0.002 ? zk : lerp(view.k, zk, 1 - Math.exp(-2.5 * dt));
    view.zoom = view.base * view.k;
  }
  if (!intro.arrive) view.zoom = view.base * view.k * warpZoom(); // a gate jump pulls back and settles
  landingCamera(); // landing closes in on the planet, taking off pulls back from it

  SystemMap.setPlayer(ship.x, ship.y);
}
