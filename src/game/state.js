// The flight view's shared state: the canvas and view, the ship and camera, the fight, the
// introduction's and toast's state, the screen modes (setMode) and where the ship is (here).
// Part of the flight view; src/main.js starts it.

import { Display } from '../core/display.js';
import { MathUtil } from '../core/math.js';
import { Flight } from '../flight/flight.js';
import { Loadout } from '../rules/loadout.js';
import { SystemMap } from '../ui/map.js';
import { invalidate } from './loop.js';
import { COMBAT } from './options.js';

export const canvas = document.getElementById('game');
export const ctx = canvas.getContext('2d', { alpha: false }); // every frame starts with an opaque fill
export const { TAU, clamp, lerp } = MathUtil;

// The play area is a galaxy of solar systems in one open space (world/galaxy.js), joined by jump gates:
// world coordinates are units from the first system's star.
// Each frame poses and draws only what lies within NEAR of the camera (flight/scene.js): the screen
// and the minimap's square (RADAR, 6000 each way: 8500 to its corners). Drawing happens relative to
// a nearby grid point to keep precision.
export const NEAR = 9000;
export const NAV_RANGE = 18000; // off-screen stations and gates this close get an edge marker

// What the ship can do: its class and fitted equipment (rules/loadout.js, saved with the cargo as
// cargo.loadout) with the hull refits researched (rules/research.js) added up: handling, hold, sensor
// ranges, mining speed, combat stats. Kept up to date in place by applyShip().
export const SHIP = Loadout.stats(Loadout.starter('courier'));

export const ship = {
  x: 0, y: 0,
  vx: 0, vy: 0,
  angle: -Math.PI / 2,
  targetAngle: -Math.PI / 2,
  targetSpeed: 0,
  thrust: 0,
};

// zoom: screen px per world unit, base (by the window's size) × k (eased: wider in the introduction).
export const view = { w: 0, h: 0, dpr: 1, zoom: 1, base: 1, k: 1 };
export const cam = { x: 0, y: 0 };
export const particles = [];
export const debris = []; // rock fragments thrown off by mining, in world units
// The squad's ships flying with yours (see Squad below), by member id: { kind: 'wingman', key,
// member, art, name, color, stats, radius, x, y, vx, vy, angle, a, thrust }.
export const wings = new Map();
export const mining = { target: null, t: 0 }; // the asteroid being mined, and seconds mined so far
// Approach: fly to the selected object and stop beside it (or keep station with a moving ship).
// key: entityKey of the target; e: that entity this frame; stop: distance to stop at; follow: never finishes.
export const autopilot = { key: null, e: null, stop: 0, follow: false };
// Combat (combat/combat-core.js; the modes in combat/combat.js and combat/combat-realtime.js): s is the fight in progress
// (null when none) and mode the kind it is (a COMBAT key); ships holds the enemies' poses by key
// (held in rounds, flown in real time); fx the queued and running effects (beams, flashes, numbers, explosions);
// result/resultT keep the outcome on the panel for a moment; grace keeps pirates off after
// fleeing or respawning; wreckT counts down while the destroyed player ship is towed.
// final and lastShips keep the ended fight's state and enemy poses for the panel and late effects;
// wrecked hides the player ship between its explosion and the tow. returning: enemies that
// survived a real-time fight, flying back to their usual paths (by key).
export const fight = {
  s: null, mode: 'rounds', ships: new Map(), fx: [], log: [], result: null, resultT: 0, grace: 0, wreckT: 0,
  final: null, lastShips: new Map(), wrecked: false, returning: new Map(), dying: new Set(),
};
// The introduction (see Introduction below): on while the escape pod is being talked in to the
// waystation. run: the script (story/intro.js); station: the waystation's entity; face: its android's
// portrait; flying: the pod is the player's to fly; beam: the tractor beam has it ({ t, in });
// arrive: the pod drifting in at the start, before anyone speaks ({ t, from, to, a0, a1 }).
export const intro = { on: false, run: null, station: null, face: null, flying: false, beam: null, arrive: null };
export const inFight = () => !!fight.s || fight.wreckT > 0;
export const fightMode = () => COMBAT[fight.mode];
export const flyingFight = () => !!fight.s && fightMode().flying; // flying is allowed
export let flash = 0; // white-out when the wrecked ship is towed home or jumps through a gate, fading from 1
export function whiteOut() { flash = 0.8; }
export function fadeFlash(dt) { flash = Math.max(0, flash - dt * 1.8); }
export const toast = { text: '', t: 0 }; // short centre-screen notice, fading out
// Show a notice for t seconds. once: leave the same notice alone while it's still showing, so
// something checked every frame doesn't keep restarting it.
export const notify = (text, t = 2, { once = false } = {}) => {
  if (once && toast.text === text && toast.t >= 0.5) return;
  toast.text = text;
  toast.t = t;
};
// What the screen is busy with: 'intro', 'talking', 'docked', 'in-combat', 'settings'. Each sets the
// body class of the same name (index.html hides controls by it); the map can't open during any of
// those in MAP_BLOCKERS. Several can hold at once, so each is switched on and off by name.
export const modes = new Set();
export const MAP_BLOCKERS = ['intro', 'docked', 'in-combat', 'settings', 'warping'];
export function setMode(name, on) {
  if (on) modes.add(name); else modes.delete(name);
  document.body.classList.toggle(name, on);
  SystemMap.blocked = MAP_BLOCKERS.some((m) => modes.has(m));
}
// Where the ship is (world/galaxy.js regionAt: system, security, nebula, what it's near) and the
// mission's next step (objective()), worked out once a step and read by the HUD, minimap and markers.
export const here = { region: null, objective: null };

export const { turnToward } = Flight;

export function resize() {
  view.dpr = Display.dpr();
  view.w = window.innerWidth;
  view.h = window.innerHeight;
  canvas.width = Math.round(view.w * view.dpr);
  canvas.height = Math.round(view.h * view.dpr);
  view.base = clamp(Math.min(view.w, view.h) / 800, 0.55, 1.2);
  view.zoom = view.base * view.k;
}

// Wiring, run once every module has loaded (src/main.js).
export function init() {
  window.addEventListener('resize', () => { resize(); invalidate(); });
  resize();
}
