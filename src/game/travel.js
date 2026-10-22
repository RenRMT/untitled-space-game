// Map travel in flight: the trip plotted on the map (flight/travel.js) run each frame, arrivals,
// and the entities near the camera that each frame poses (nearbyEntities).
// Part of the flight view; src/main.js starts it.

import { Scene } from '../flight/scene.js';
import { Hazards } from '../rules/hazards.js';
import { SystemMap } from '../ui/map.js';
import { SolarSystem } from '../world/solar-system.js';
import { cargo } from './cargo.js';
import { outOfFuel } from './hazards.js';
import { landing } from './landing.js';
import { missionThings } from './missions.js';
import { dropNearContact, placeBeside, placeShip } from './outfitting.js';
import { NEAR, cam, fight, intro, notify, ship, wings } from './state.js';
import { world } from './world.js';

// Where a destination is in the flight view: the station or planet itself, or else its point.
export function arriveAt(dest) {
  if (dest.kind === 'station') placeBeside(world.scene.stations[dest.id]);
  else if (dest.kind === 'gate') placeBeside(world.scene.gates[dest.id]);
  else if (dest.kind === 'planet') placeBeside(world.scene.entities.find((e) => (e.kind === 'planet' || e.kind === 'moon') && e.name === dest.id));
  else if (dest.kind === 'contact') {
    const c = world.galaxy.contacts.find((x) => x.id === dest.id);
    dropNearContact(c, Math.atan2(c.y - ship.y, c.x - ship.x));
  } else if (dest.kind === 'objective') dropNearContact({ x: dest.x, y: dest.y, r: OBJECTIVE_STOP }, Math.atan2(dest.y - ship.y, dest.x - ship.x));
  else placeShip(dest.x, dest.y, ship.angle);
}
// Map travel to the mission's objective stops this far short of it (plus a contact's margin), out
// of reach of the pirates there.
export const OBJECTIVE_STOP = 900;

// Where a finished trip leaves the ship, and what it says.
export function finishTrip(ev) {
  if (!ev) return;
  const { dest } = ev;
  let text;
  if (ev.type === 'arrive') {
    if (dest.kind === 'contact') dropNearContact(world.galaxy.contacts.find((c) => c.id === dest.id), ev.dir);
    else if (dest.kind === 'objective') dropNearContact({ x: dest.x, y: dest.y, r: OBJECTIVE_STOP }, ev.dir);
    else if (dest.kind === 'point' || dest.kind === 'system') placeShip(ev.pos.x, ev.pos.y, ev.dir);
    else arriveAt(dest);
    text = `Arrived at ${dest.name}`;
  } else if (ev.type === 'interdict' || ev.type === 'investigate') {
    dropNearContact(ev.contact, ev.dir);
    text = ev.type === 'interdict' ? 'Interdicted! Hostile contact' : `Investigating the ${SolarSystem.CONTACT_TYPES[ev.contact.type]?.name || 'signal'}`;
  } else {
    placeShip(ev.pos.x, ev.pos.y, ev.dir);
    text = 'Dropped out of cruise';
  }
  notify(text, 3);
  SystemMap.setPlayer(ship.x, ship.y);
  SystemMap.close();
}

// Advance a trip; runs while the map is open. Closing the map drops out of cruise.
export function tickTravel(dt) {
  if (!world.travel.active) return;
  if (!SystemMap.isOpen) { finishTrip(world.travel.stop()); return; }
  const from = world.travel.pos && { ...world.travel.pos };
  const ev = world.travel.step(dt);
  const p = world.travel.pos;
  // The trip burns fuel by the distance (rules/hazards.js); an empty tank drops out of cruise there.
  if (from && p) cargo.fuel = Math.max(0, cargo.fuel - Hazards.travelFuel(Math.hypot(p.x - from.x, p.y - from.y)));
  if (!ev && outOfFuel()) { finishTrip(world.travel.stop()); notify('Out of fuel · dropped out of cruise', 3, { tone: 'hostile' }); return; }
  if (p) SystemMap.setPlayer(p.x, p.y);
  if (ev && ev.type !== 'prompt') finishTrip(ev);
  else SystemMap.redraw();
}

// An entity posed for time t: a ship in a fight (or flying back from one) where the fight has it.
export function poseAt(e, t) {
  const held = e.kind === 'ship' && (fight.ships.get(e.key) || fight.returning.get(e.key));
  if (held) Object.assign(e, { x: held.x, y: held.y, a: held.a, thrust: held.thrust || 0 }); // fighting, or flying back
  else Scene.pose(e, t);
}

// Everything within NEAR of the camera (flight/scene.js), posed for time t.
export function nearbyEntities(t) {
  const out = [];
  for (const e of world.scene.near(cam.x, cam.y, NEAR)) {
    if (cargo.removed.has(e.key)) continue;
    poseAt(e, t);
    out.push(e);
  }
  // The first mission's field and what's in it (or the android following you home).
  for (const e of missionThings()) {
    if (cargo.removed.has(e.key)) continue;
    poseAt(e, t);
    out.push(e);
  }
  // The squad's ships fly with yours.
  if (!intro.on) for (const w of wings.values()) if (!w.member.disabled) out.push(w);
  // Floating items left by mining, combat or a lost ship live outside the generated scene.
  for (const e of cargo.drops) {
    if (Math.abs(e.x - cam.x) > NEAR || Math.abs(e.y - cam.y) > NEAR) continue;
    Scene.pose(e, t);
    out.push(e);
  }
  return out;
}

// Wiring, run once every module has loaded (src/main.js).
export function init() {
  SystemMap.hooks = {
    travel(dest) {
      if (landing.on) { notify('Take off first', 2.5, { once: true, tone: 'warn' }); return; } // map travel is from space
      if (outOfFuel()) { notify('No fuel for cruise', 2.5, { once: true, tone: 'warn' }); return; }
      world.travel.start({ x: ship.x, y: ship.y }, dest);
      SystemMap.redraw();
    },
    stop: () => finishTrip(world.travel.stop()),
    fast() { world.travel.toggleFast(); SystemMap.redraw(); },
    investigate: () => finishTrip(world.travel.investigate()),
    ignore() { world.travel.ignore(); SystemMap.redraw(); },
  };
}
