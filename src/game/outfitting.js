// Outfitting and research as the station menu sees them, sensors (sense), and placing the ship
// (placeShip, placeBeside: a teleport, a launch, a jump).
// Part of the flight view; src/main.js starts it.

import { Goods } from '../rules/goods.js';
import { Loadout } from '../rules/loadout.js';
import { Research } from '../rules/research.js';
import { SolarSystem } from '../world/solar-system.js';
import { addTo, applyShip, cargo, hold, saveCargo } from './cargo.js';
import { forgetRegion } from './draw-world.js';
import { stopMining } from './mining.js';
import { snapWings } from './squad.js';
import { SHIP, autopilot, cam, debris, notify, particles, ship } from './state.js';
import { world } from './world.js';

// Equipment: what's fitted, spare gear (bought or taken out), buying what research has unlocked,
// selling spare gear for half its price, and the shipyard's hulls (the current one traded in for
// half its price; the gear moves across, what doesn't fit goes to the spare gear).
export const SELL_BACK = 0.5;
export const outfitting = {
  get loadout() { return cargo.loadout; },
  get upgrades() { return Research.upgrades(cargo.research); },
  get gear() { return cargo.gear; },
  get known() { return Research.known(cargo.research); },
  sellPrice: (id) => Math.round(Loadout.EQUIPMENT[id].price * SELL_BACK),
  tradeIn: () => Math.round(Loadout.HULLS[cargo.loadout.hull].price * SELL_BACK),
  hullPrice: (id) => Math.max(0, Loadout.HULLS[id].price - outfitting.tradeIn()),
  // Fit spare gear (or, with buy, a new one) in a slot; what was there goes to the spare gear.
  fit(slot, id, buy = false) {
    const item = Loadout.EQUIPMENT[id];
    const s = Loadout.slotsOf(cargo.loadout.hull, outfitting.upgrades).find((x) => x.id === slot);
    if (!item || !s || item.slot !== s.type) return false;
    if (buy ? !outfitting.known.has(id) || cargo.credits < item.price : !cargo.gear[id]) return false;
    if (buy) cargo.credits -= item.price;
    else addTo(cargo.gear, id, -1);
    const old = cargo.loadout.fitted[slot];
    if (old) addTo(cargo.gear, old);
    cargo.loadout = { ...cargo.loadout, fitted: { ...cargo.loadout.fitted, [slot]: id } };
    return changedShip();
  },
  unfit(slot) {
    const old = cargo.loadout.fitted[slot];
    if (!old) return false;
    addTo(cargo.gear, old);
    cargo.loadout = { ...cargo.loadout, fitted: { ...cargo.loadout.fitted, [slot]: null } };
    return changedShip();
  },
  sell(id) {
    if (!cargo.gear[id]) return false;
    addTo(cargo.gear, id, -1);
    cargo.credits += outfitting.sellPrice(id);
    saveCargo();
    return true;
  },
  // Why a hull can't be bought right now, or null: the price, or a hold too full for it.
  hullBlocked(id) {
    if (id === cargo.loadout.hull) return 'Flying it';
    if (cargo.credits < outfitting.hullPrice(id)) return 'Not enough credits';
    const room = Loadout.stats({ hull: id, fitted: {} }, outfitting.upgrades).cargo;
    return cargo.items.length > room ? `Hold too full · ${room} units` : null;
  },
  buyHull(id) {
    if (!Loadout.HULLS[id]?.price || outfitting.hullBlocked(id)) return false;
    cargo.credits -= outfitting.hullPrice(id);
    const { loadout: next, left } = Loadout.refit(cargo.loadout, id, outfitting.upgrades);
    for (const item of left) addTo(cargo.gear, item);
    cargo.loadout = next;
    applyShip();
    cargo.hull = SHIP.hull; // a new ship, undamaged
    saveCargo();
    return true;
  },
};
// Research: components and trade goods in, unlocks out (rules/research.js).
export const lab = {
  get researched() { return cargo.research; },
  get components() { return cargo.components; },
  have: (kind) => (Goods.isSalvage(kind) ? cargo.components[kind] || 0 : hold.count(kind)),
  status: (id) => Research.status(id, cargo.research, lab.have),
  research(id) {
    const st = lab.status(id);
    if (!st.ok) return false;
    for (const { kind, need } of st.cost) {
      if (Goods.isSalvage(kind)) addTo(cargo.components, kind, -need);
      else for (let i = 0; i < need; i++) cargo.items.splice(cargo.items.findIndex((it) => it.kind === kind), 1);
    }
    cargo.research = new Set([...cargo.research, id]);
    return changedShip(); // a hull upgrade changes the ship at once
  },
};
export function changedShip() {
  applyShip();
  saveCargo();
  return true;
}

// The ship's sensors (rules/knowledge.js), at half range inside a nebula. A contact identified for the
// first time is announced. placeShip runs it while the galaxy first loads.
export const NEBULA_SENSORS = 0.5;
export function sense() {
  const k = world.galaxy.nebulaAt(ship.x, ship.y) ? NEBULA_SENSORS : 1;
  const found = world.knowledge.sense(ship.x, ship.y, SHIP.sensorRange * k, SHIP.pingRange * k);
  for (const c of found) notify(`Sensors: ${SolarSystem.CONTACT_TYPES[c.type].prompt} identified`, 3);
}

// Put the ship at a world position, at rest.
export function placeShip(x, y, angle = -Math.PI / 2) {
  ship.x = x;
  ship.y = y;
  ship.vx = ship.vy = 0;
  ship.targetSpeed = 0;
  ship.angle = ship.targetAngle = angle;
  cam.x = ship.x;
  cam.y = ship.y;
  particles.length = 0;
  debris.length = 0;
  stopMining();
  autopilot.key = null;
  forgetRegion(); // no enter/leave notice for a teleport
  sense();
  snapWings();
}

// Place the ship beside something in space, on its side facing its system's star. Beside a
// station that orbits a planet, it waits off to one side between the two, so both are in view.
export function placeBeside(e) {
  const star = world.galaxy.nearestSystem(e.x, e.y).star;
  const a = Math.atan2(star.y - e.y, star.x - e.x);
  const p = e.station && world.galaxy.planets[e.station.planet];
  if (p) {
    const mx = (e.x + p.x) / 2, my = (e.y + p.y) / 2, out = Math.atan2(e.y - p.y, e.x - p.x);
    const side = [out + Math.PI / 2, out - Math.PI / 2].sort((u, v) => Math.cos(u - a) - Math.cos(v - a)).pop();
    const off = e.radius * 0.5 + 120; // close enough to dock straight away
    placeShip(mx + Math.cos(side) * off, my + Math.sin(side) * off, Math.atan2(e.y - my, e.x - mx));
    return;
  }
  const d = e.kind === 'planet' || e.kind === 'moon' ? e.body.r * (e.body.ring ? 2.1 : 1.3) + 260 : e.radius + 220;
  placeShip(e.x + Math.cos(a) * d, e.y + Math.sin(a) * d, a + Math.PI);
}
export const startStation = () => world.scene.stations[world.galaxy.startStation];

// Drop the ship short of a contact, facing it.
export function dropNearContact(c, dir) {
  placeShip(c.x - Math.cos(dir) * (c.r + 1300), c.y - Math.sin(dir) * (c.r + 1300), dir);
}

// An ambush whose pirates have all been destroyed no longer stops map travel.
export function ambushCleared(c) {
  const pack = world.galaxy.packs[c.pack];
  return !!pack && pack.ships.every((s) => cargo.removed.has(s.key));
}
