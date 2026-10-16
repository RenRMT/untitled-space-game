// Cargo hold and credits: items collected or bought, saved per galaxy (with the loadout, research,
// squad and missions), and the ship's stats from its loadout (applyShip).
// Part of the flight view; src/main.js starts it.

import { mulberry32 } from '../core/rng.js';
import { Params, Store } from '../core/store.js';
import { Entities } from '../flight/entities.js';
import { Economy } from '../rules/economy.js';
import { Goods } from '../rules/goods.js';
import { Loadout } from '../rules/loadout.js';
import { Research } from '../rules/research.js';
import { Squad } from '../rules/squad.js';
import { Missions } from '../story/missions.js';
import { Galaxy } from '../world/galaxy.js';
import { HULL_ART } from './options.js';
import { buildWings } from './squad.js';
import { SHIP, TAU, clamp, notify, ship } from './state.js';

// items: trade goods in the hold, { kind (a rules/goods.js type), label, category: 'trade' }, one unit
// each. components: salvaged components by type ({ [kind]: count }), kept apart from the hold:
// they take no room, can't be sold, survive the ship's loss and are used up by research.
// removed: keys of generated things gone from the world for good: items collected, asteroids
// broken up by mining, ships destroyed in combat (keys are unique across kinds). drops: items
// left floating by mining, destroyed ships or the player's own lost cargo, not yet collected
// (item entities; each keeps its saved form in `drop`). hull: the player ship's hull points
// (repaired at stations). home: the last station docked at, where a lost ship is towed.
// loadout: the ship's class and fitted equipment; gear: spare equipment bought or taken out
// ({ [equipment id]: count }); research: the research nodes done (a Set of ids); squad: the
// squad members (rules/squad.js), with their logic modules and hull. story: what has happened so far
// (a Set of STORY flags). missions: the mission log (story/missions.js): what's been accepted, done
// and handed in.
export const cargo = {
  key: '', items: [], components: {}, removed: new Set(), credits: 0, drops: [], hull: 0, home: null,
  loadout: Loadout.starter('courier'), gear: {}, research: new Set(), squad: [], story: new Set(),
  missions: Missions.create(),
};
// Story flags: 'intro', the introduction played (or skipped); 'gates', the jump gates brought
// online (nothing does that yet: until then the first system is all there is).
export const STORY = ['intro', 'gates'];
export const gatesOnline = () => cargo.story.has('gates');
// The opening missions (story/missions.js), which follow the introduction and pay off the player's
// debt: "Payment in kind", then "The remaining balance". Until the second is handed in, station
// screens offer only Missions (and Squad, once the first has brought a squad member): see The
// opening missions below.
export const OPENING = 'repayment', SALVAGE = 'salvage', GATE_JOB = 'gate';
// The waystation's missions, in the order it offers them (the third is optional).
export const CHAIN = [OPENING, SALVAGE, GATE_JOB];
export const opening = () => cargo.missions.status(SALVAGE) !== 'done';
// Saves from before the second mission count it as done once the first was: their debt was
// settled by the first. Saves carry the version of the mission chain they were made with.
export const MISSIONS_VERSION = 2;
export const PICKUP_RANGE = 24; // world units beyond the item's own size
// " · rare" after an item's name in notices, for anything better than common.
export const rarityNote = (e) => (e.art.rarity > 1 ? ` · ${Goods.RARITY[e.art.rarity].label.toLowerCase()}` : '');

// A floating item from its saved form { key, kind (a rules/goods.js type), seed, x, y }.
export function dropEntity(d) {
  const r = mulberry32(d.seed);
  return { ...Entities.item({ key: d.key, kind: d.kind, seed: d.seed, x: d.x, y: d.y, angle: r() * TAU, tumble: (r() - 0.5) * 0.3 }), drop: d };
}

// An item record from a save, brought up to date: saves from before item types stored a category
// ('metal') or only a label, which become that category's commonest type (Goods.resolve).
export function upgradeItem(it) {
  const kind = Goods.resolve(it.kind, it.label);
  if (!kind) return null;
  return { kind, label: Goods.type(kind).name, category: 'trade' };
}
export const addTo = (counts, kind, n = 1) => { counts[kind] = (counts[kind] || 0) + n; if (counts[kind] <= 0) delete counts[kind]; };
// A saved loadout, if it is one this game knows: a hull for sale, and only known equipment.
export function validLoadout(l) {
  if (!l || !Loadout.HULLS[l.hull]?.price || typeof l.fitted !== 'object') return null;
  const fitted = {};
  for (const [slot, id] of Object.entries(l.fitted)) fitted[slot] = id && Loadout.EQUIPMENT[id] && !Loadout.EQUIPMENT[id].npc ? id : null;
  return { hull: l.hull, fitted };
}

// SHIP from the loadout and the hull upgrades researched, and the ship drawn as its hull. When
// more armour raises the maximum, the hull points rise with it (not when a save is loaded).
export function applyShip({ loading = false } = {}) {
  const before = SHIP.hull, hullBefore = SHIP.name;
  Object.assign(SHIP, Loadout.stats(cargo.loadout, Research.upgrades(cargo.research)));
  ship.art = (HULL_ART[cargo.loadout.hull] || HULL_ART.courier)();
  if (!loading && SHIP.name === hullBefore && SHIP.hull > before) cargo.hull += SHIP.hull - before;
  cargo.hull = clamp(cargo.hull, 0, SHIP.hull);
}

export function loadCargo(galaxy) {
  if (cargoSave.timer !== null) saveCargoNow(); // the old galaxy's cargo first
  cargo.key = `cargo:${Galaxy.saveKey(galaxy)}`;
  cargo.items = [];
  cargo.components = {};
  cargo.removed = new Set();
  cargo.credits = Economy.config.startingCredits;
  cargo.drops = [];
  cargo.home = null;
  cargo.loadout = Loadout.starter('courier');
  cargo.gear = {};
  cargo.research = new Set();
  cargo.squad = []; // the first member joins at the end of the first mission
  cargo.story = new Set();
  cargo.missions = Missions.create();
  cargo.hull = Infinity; // full, once applyShip knows the maximum
  if (Params.has('fresh')) Store.remove(cargo.key);
  const d = Store.getJSON(cargo.key);
  try {
    if (d) readCargo(d);
  } catch (e) { /* a damaged save: keep what was read before the error */ }
  applyShip({ loading: true });
  buildWings(); // the squad's ships, for the members just read
}
// The parts of a save, each checked. Saves from before components had their own store kept them
// in the hold: they move across. Saves from before missions that had played the introduction
// already have the wingman the first mission brings: for them it's done.
export function readCargo(d) {
  if (Array.isArray(d.research)) cargo.research = new Set(d.research.filter((id) => Research.NODES[id]));
  cargo.squad = Squad.read(d.squad) || cargo.squad;
  if (Array.isArray(d.story)) cargo.story = new Set(d.story.filter((f) => STORY.includes(f)));
  if (d.missions) cargo.missions = Missions.create(d.missions);
  else if (cargo.story.has('intro')) cargo.missions.finish(OPENING);
  if (!(d.missionsVersion >= MISSIONS_VERSION) && cargo.missions.status(OPENING) === 'done') cargo.missions.finish(SALVAGE);
  cargo.loadout = validLoadout(d.loadout) || cargo.loadout;
  if (d.gear && typeof d.gear === 'object') for (const [id, n] of Object.entries(d.gear)) if (Loadout.EQUIPMENT[id] && !Loadout.EQUIPMENT[id].npc && n > 0) addTo(cargo.gear, id, Math.floor(n));
  if (d.components && typeof d.components === 'object') for (const [kind, n] of Object.entries(d.components)) if (Goods.isSalvage(kind) && n > 0) addTo(cargo.components, kind, Math.floor(n));
  if (Array.isArray(d.items)) {
    for (const it of d.items.map(upgradeItem).filter(Boolean)) {
      if (Goods.isSalvage(it.kind)) addTo(cargo.components, it.kind);
      else cargo.items.push(it);
    }
  }
  // Older saves kept collected items, mined asteroids and destroyed ships in three lists.
  cargo.removed = new Set([d.removed, d.collected, d.mined, d.destroyed].filter(Array.isArray).flat());
  if (Number.isFinite(d.credits)) cargo.credits = d.credits;
  if (Array.isArray(d.drops)) {
    cargo.drops = d.drops.filter((x) => x && Goods.resolve(x.kind, x.label))
      .map((x) => dropEntity({ key: x.key, kind: Goods.resolve(x.kind, x.label), seed: x.seed, x: x.x, y: x.y }));
  }
  if (Number.isFinite(d.hull)) cargo.hull = Math.max(1, d.hull);
  if (d.home && Number.isFinite(d.home.x)) cargo.home = d.home;
}
// Cargo is saved CARGO_SAVE_MS after the first change, so a burst of changes (Sell all, hull
// damage in a fight) is one write; and when the page is hidden or closed, or another system
// loads. Storage unavailable: cargo lasts for this session only (core/store.js).
export const CARGO_SAVE_MS = 1000;
export const cargoSave = { timer: null };
export function saveCargo() {
  if (cargoSave.timer === null) cargoSave.timer = setTimeout(saveCargoNow, CARGO_SAVE_MS);
}
export function saveCargoNow() {
  clearTimeout(cargoSave.timer);
  cargoSave.timer = null;
  Store.setJSON(cargo.key, {
    items: cargo.items, components: cargo.components, removed: [...cargo.removed], credits: cargo.credits,
    drops: cargo.drops.map((e) => e.drop), hull: cargo.hull, home: cargo.home,
    loadout: cargo.loadout, gear: cargo.gear, research: [...cargo.research], squad: cargo.squad,
    story: [...cargo.story], missions: cargo.missions.save(), missionsVersion: MISSIONS_VERSION,
  });
}

// The hold as the station menu sees it: buying and selling one unit at a time.
export const hold = {
  get credits() { return cargo.credits; },
  get items() { return cargo.items; },
  get capacity() { return SHIP.cargo; },
  get free() { return SHIP.cargo - cargo.items.length; },
  count: (kind) => cargo.items.reduce((n, it) => n + (it.kind === kind ? 1 : 0), 0),
  buy(kind, price, label) {
    if (hold.free < 1 || cargo.credits < price) return false;
    cargo.credits -= price;
    cargo.items.push({ kind, label, category: 'trade' });
    saveCargo();
    return true;
  },
  sell(kind, price) {
    const i = cargo.items.findIndex((it) => it.kind === kind);
    if (i < 0) return false;
    cargo.items.splice(i, 1);
    cargo.credits += price;
    saveCargo();
    return true;
  },
};

// Hull repairs as the station menu sees them: as many points as the credits cover.
export const REPAIR_PRICE = 2; // credits per hull point
export const repairs = {
  price: REPAIR_PRICE,
  get hull() { return cargo.hull; },
  get max() { return SHIP.hull; },
  get cost() { return Math.ceil(SHIP.hull - cargo.hull) * REPAIR_PRICE; },
  repair() {
    const points = Math.min(Math.ceil(SHIP.hull - cargo.hull), Math.floor(cargo.credits / REPAIR_PRICE));
    if (points <= 0) return false;
    cargo.hull = Math.min(SHIP.hull, cargo.hull + points);
    cargo.credits -= points * REPAIR_PRICE;
    saveCargo();
    return true;
  },
};

// Floating items within reach are picked up: trade goods into the hold while there's room,
// components into their own store, which never fills.
export function collectItems(list) {
  for (const e of list) {
    if (e.kind !== 'item' || cargo.removed.has(e.key)) continue;
    if (Math.hypot(ship.x - e.x, ship.y - e.y) > e.radius * 0.7 + PICKUP_RANGE) continue;
    if (e.mission) { // a mission's cargo: kept apart from the hold, for the mission
      cargo.removed.add(e.key);
      notify(`Recovered: ${e.label}`, 2.5);
      saveCargo();
      continue;
    }
    const component = Goods.isSalvage(e.itemKind);
    if (!component && hold.free < 1) {
      notify('Cargo hold full', 2.5, { once: true }); // and leave it floating
      continue;
    }
    if (e.drop) cargo.drops.splice(cargo.drops.indexOf(e), 1);
    else cargo.removed.add(e.key);
    if (component) addTo(cargo.components, e.itemKind);
    else cargo.items.push({ kind: e.itemKind, label: e.label, category: 'trade' });
    notify(`Recovered: ${e.label}${rarityNote(e)}`, 2.5);
    saveCargo();
  }
}
