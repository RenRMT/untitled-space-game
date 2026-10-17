// Docking (stop near a station, dock, trade, launch) and jump gates (jump to the system at the
// other end), and the action registry every interaction adds to (flight/interactions.js).
// Part of the flight view; src/main.js starts it.

import { Feedback } from '../core/feedback.js';
import { Store } from '../core/store.js';
import { Entities } from '../flight/entities.js';
import { Interactions } from '../flight/interactions.js';
import { Economy } from '../rules/economy.js';
import { SystemMap } from '../ui/map.js';
import { StationMenu } from '../ui/station.js';
import { cargo, gatesOnline, hold, news, opening, repairs, saveCargo } from './cargo.js';
import { drag } from './input.js';
import { stopMining } from './mining.js';
import { missionDocked, missionLaunched, missionViews, stationLocks } from './missions.js';
import { artStyle } from './options.js';
import { lab } from './lab.js';
import { industry } from './industry.js';
import { outfitting, placeShip } from './outfitting.js';
import { select } from './selection.js';
import { programs, repairSquad } from './squad.js';
import { SHIP, autopilot, inFight, notify, particles, setMode, ship } from './state.js';
import { startWarp, warp } from './warp.js';
import { world } from './world.js';

// ---------- Docking: stop near a station, dock, trade, launch ----------

export const DOCK = { range: 320, maxSpeed: 150 }; // range: world units beyond the station's radius
export let docked = null; // { station } while docked; flight is paused and the station menu is open

// Whether the player may dock at a station. Everyone is welcome for now; reputation
// (refusing a wanted pilot, say) belongs here: return { ok: false, reason: 'Docking refused' }.
export function canDock(station) {
  return { ok: true, reason: '' };
}

// Distance from the ship to an object's edge.
export const gapTo = (e) => Math.hypot(ship.x - e.x, ship.y - e.y) - e.radius;
export const shipSpeed = () => Math.hypot(ship.vx, ship.vy);

// What the player can do with things in space (flight/interactions.js): each action is added next to its
// code below. Its state ({ ok, label, inRange }) is what the context menu's button shows; inRange
// is false while the ship has to come closer first.
export const actions = Interactions.create({ gap: gapTo, speed: shipSpeed });

export function dock(station) {
  if (docked || inFight() || !actions.state('dock', station).ok) return;
  Feedback.emit('docked');
  stopMining();
  select(null);
  autopilot.key = null;
  docked = { station };
  // A lost ship is towed back to the last station it docked at.
  cargo.home = { x: station.x, y: station.y, radius: station.radius, name: station.name };
  missionDocked(station);
  repairSquad();
  saveCargo();
  ship.vx = ship.vy = 0;
  ship.targetSpeed = 0;
  ship.thrust = 0;
  drag.active = false;
  particles.length = 0;
  lab.settle();
  industry.here = { key: station.key, name: station.name, type: station.market.type };
  industry.settle();
  setMode('docked', true);
  StationMenu.open({
    station: { name: station.name, subtitle: Entities.stationSubtitle(station), color: station.color },
    market: Economy.market(world.galaxy.seed, station),
    hold,
    ship: SHIP,
    outfitting,
    lab,
    industry,
    get kit() { return cargo.kit; },
    shipyard: station.market.kind === 'system' && ['capital', 'major'].includes(station.market.type),
    repairs,
    squad: programs,
    missions: { list: () => missionViews(station) },
    locks: stationLocks,
    tab: opening() ? 'missions' : null, // the opening missions are all there is to do at first; else the last tab used
    news: opening() ? [] : news.splice(0), // what finished since the last dock, shown once
    artStyle: artStyle.value, // item icons; the style can't change while docked
    onLaunch: launch,
  });
}

// Back to space just outside the station, on the side the ship came in from, at rest.
export function launch() {
  const st = docked.station;
  Store.persist(); // a tap on Launch: a good moment to ask the browser to keep the save
  docked = null;
  industry.here = null;
  StationMenu.close();
  setMode('docked', false);
  const a = Math.atan2(ship.y - st.y, ship.x - st.x);
  const d = st.radius + 180;
  placeShip(st.x + Math.cos(a) * d, st.y + Math.sin(a) * d, a);
  notify(`Launched from ${st.name}`, 2.5);
  Feedback.emit('launched');
  missionLaunched();
}

// ---------- Jump gates: stop by a gate and jump to the system at its other end ----------

export const GATE = { range: 260, maxSpeed: 220 }; // range: world units beyond the gate's radius

// Through the gate: out of the linked gate on its side toward that system's star, at rest, after
// the jump's sequence (game/warp.js).
export function jump(gate) {
  if (docked || inFight() || warp.on || !actions.state('jump', gate).ok) return;
  const there = world.scene.gates[gate.gate.link];
  const system = world.galaxy.systems[there.gate.system];
  select(null);
  startWarp(gate, there, () => {
    notify(`Jumped to the ${system.name} system`, 3);
    SystemMap.setPlayer(ship.x, ship.y);
  });
}

// Wiring, run once every module has loaded (src/main.js).
export function init() {
  actions.add({ id: 'dock', kind: 'station', verb: 'Dock', key: 'f', range: () => DOCK.range, maxSpeed: () => DOCK.maxSpeed, allowed: canDock, hold: true, run: dock });
  actions.add({
    id: 'jump', kind: 'gate', verb: 'Jump', key: 'j', range: () => GATE.range, maxSpeed: () => GATE.maxSpeed, run: jump,
    allowed: () => (gatesOnline() ? { ok: true, reason: '' } : { ok: false, reason: 'Gate offline' }),
  });
}
