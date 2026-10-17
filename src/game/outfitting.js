// Outfitting as the station menu sees it (your ship and each squad member's), sensors (sense), and placing the ship
// (placeShip, placeBeside: a teleport, a launch, a jump).
// Part of the flight view; src/main.js starts it.

import { Loadout } from '../rules/loadout.js';
import { Mods } from '../rules/mods.js';
import { Recipes } from '../rules/recipes.js';
import { Research } from '../rules/research.js';
import { SolarSystem } from '../world/solar-system.js';
import { addTo, applyShip, cargo, saveCargo } from './cargo.js';
import { stopMining } from './mining.js';
import { memberOf, refreshWing, snapWings } from './squad.js';
import { SHIP, autopilot, cam, debris, notify, particles, ship } from './state.js';
import { world } from './world.js';

// Fitting gear and mods to a loadout, from the spare gear and mods: what was in the slot goes to the
// spare gear; mods go in as far as the gear in their slot has room. on: the ship fitted, { get(), set(loadout),
// upgrades(), takes(id) (whether this ship can take that gear), changed() (after every change) }.
function fitter(on) {
  const slotOf = (slot) => Loadout.slotsOf(on.get().hull, on.upgrades()).find((x) => x.id === slot);
  const put = (patch) => { on.set({ ...on.get(), ...patch }); return on.changed(); };
  return {
    fit(slot, id) {
      const item = Loadout.EQUIPMENT[id], s = slotOf(slot);
      if (!item || !s || item.slot !== s.type || !cargo.gear[id] || !on.takes(id)) return false;
      addTo(cargo.gear, id, -1);
      const old = on.get().fitted[slot];
      if (old) addTo(cargo.gear, old);
      return put({ fitted: { ...on.get().fitted, [slot]: id } });
    },
    unfit(slot) {
      const old = on.get().fitted[slot];
      if (!old) return false;
      addTo(cargo.gear, old);
      return put({ fitted: { ...on.get().fitted, [slot]: null } });
    },
    fitMod(slot, id) {
      const l = on.get(), type = Loadout.EQUIPMENT[l.fitted[slot]]?.slot, list = l.mods?.[slot] || [];
      if (!cargo.mods[id] || !Mods.fits(id, type) || list.length >= Loadout.modRoom(l, slot)) return false;
      addTo(cargo.mods, id, -1);
      return put({ mods: { ...l.mods, [slot]: [...list, id] } });
    },
    removeMod(slot, i) {
      const l = on.get(), list = l.mods?.[slot] || [];
      if (!list[i]) return false;
      addTo(cargo.mods, list[i]);
      const rest = list.filter((m, k) => k !== i);
      const mods = { ...l.mods, [slot]: rest };
      if (!rest.length) delete mods[slot];
      return put({ mods });
    },
  };
}
// Mods without room in a loadout's slots go back to the spare mods: the loadout without them.
function trimmed(loadout) {
  const { loadout: out, left } = Loadout.trimMods(loadout);
  for (const m of left) addTo(cargo.mods, m);
  return out;
}

// Equipment: what's fitted, spare gear (assembled, or taken out) to fit, mods fitted to a slot (as
// many as its gear has room for; the rest go back to the spare mods), selling spare gear for half
// its price, and the shipyard's hulls (the current one traded in for half its price; the gear moves
// across, what doesn't fit goes to the spare gear). Gear isn't sold: industry assembles it.
// Android gear (taken out of a squad ship) fits only squad ships, and isn't sold.
// member(id): the same for a squad member's ship (fit, unfit, fitMod, removeMod; null if no such member).
export const SELL_BACK = 0.5;
const playerFit = fitter({
  get: () => cargo.loadout, set: (l) => { cargo.loadout = l; }, upgrades: () => outfitting.upgrades,
  takes: (id) => !Loadout.EQUIPMENT[id].npc, changed: () => changedShip(),
});
export const outfitting = {
  get loadout() { return cargo.loadout; },
  get upgrades() { return Research.upgrades(cargo.lab.done); },
  get gear() { return cargo.gear; },
  get mods() { return cargo.mods; },
  android: false,
  // Whether industry can make a piece of gear: Mk I always, the rest once its blueprint is researched.
  canMake: (id) => Recipes.known(cargo.lab.done).has(`make.${id}`),
  sellPrice: (id) => Math.round(Loadout.EQUIPMENT[id].price * SELL_BACK),
  tradeIn: () => Math.round(Loadout.HULLS[cargo.loadout.hull].price * SELL_BACK),
  hullPrice: (id) => Math.max(0, Loadout.HULLS[id].price - outfitting.tradeIn()),
  ...playerFit,
  sell(id) {
    if (!cargo.gear[id] || Loadout.EQUIPMENT[id].npc) return false;
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
    const { loadout: next, left, leftMods } = Loadout.refit(cargo.loadout, id, outfitting.upgrades);
    for (const item of left) addTo(cargo.gear, item);
    for (const m of leftMods) addTo(cargo.mods, m);
    cargo.loadout = next;
    applyShip();
    cargo.hull = SHIP.hull; // a new ship, undamaged
    saveCargo();
    return true;
  },
  // A squad member's ship, outfitted the same way (no research upgrades; any gear, android or not).
  member(id) {
    const m = memberOf(id);
    if (!m) return null;
    return {
      get loadout() { return m.loadout; },
      upgrades: {},
      get gear() { return cargo.gear; },
      get mods() { return cargo.mods; },
      android: true,
      canMake: outfitting.canMake,
      ...fitter({
        get: () => m.loadout, set: (l) => { m.loadout = l; }, upgrades: () => ({}), takes: () => true,
        changed: () => { m.loadout = trimmed(m.loadout); refreshWing(m); saveCargo(); return true; },
      }),
    };
  },
};
// The loadout changed: mods without room in their slot go back to the spare mods, and the ship's
// stats follow.
export function changedShip() {
  cargo.loadout = trimmed(cargo.loadout);
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
