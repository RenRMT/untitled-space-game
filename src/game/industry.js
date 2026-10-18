// Production as the station menu sees it (rules/industry.js): placing production orders at the
// station docked at, pausing, cancelling and reordering them from anywhere, moving goods between the
// hold and the one shared storage, and orders working on the real-world clock, settled on load, on
// docking, every second on the station screen and every few seconds in flight. Every change
// settles first, then changes, then lets orders start, so what's made never depends on when it was
// looked at.
// Part of the flight view; src/main.js starts it.

import { Clock } from '../core/clock.js';
import { Abilities } from '../rules/abilities.js';
import { Goods } from '../rules/goods.js';
import { Industry } from '../rules/industry.js';
import { Loadout } from '../rules/loadout.js';
import { Mods } from '../rules/mods.js';
import { Recipes } from '../rules/recipes.js';
import { SystemMap } from '../ui/map.js';
import { addNews, addTo, cargo, devUnlock, hold, saveCargo } from './cargo.js';
import { notify } from './state.js';
import { world } from './world.js';

const FLIGHT_CHECK = 5000; // ms between checks in flight
let lastCheck = 0;

// The scene's station with this key, or null.
const stationOf = (key) => world.scene?.stations.find((s) => s.key === key) || null;

export const industry = {
  get state() { return cargo.industry; },
  here: null, // the station docked at: { key, name, type }, or null in flight
  now: () => Clock.now(),
  env: () => Industry.env(cargo.lab),
  known: () => Recipes.known(cargo.lab.done),
  slots: () => Industry.slots(industry.env()),
  // The stage the station docked at works (Recipes.BAYS id), whether it takes orders, and its orders.
  stage: () => (industry.here ? Industry.STAGE[industry.here.type] || null : null),
  trusted: () => !!industry.here && (devUnlock || Industry.trusted(cargo.loyalty, industry.here.key)),
  orders: () => (industry.here ? Industry.at(cargo.industry, industry.here.key) : []),
  // The name of the system a station is in ('' if it isn't in the scene).
  system(key) {
    const st = stationOf(key);
    return st ? world.galaxy.systems[st.station.system]?.name || '' : '';
  },
  // Runs finished by now, each station's output announced together.
  settle({ quiet = false } = {}) {
    const { log } = Industry.settle(cargo.industry, Clock.now(), industry.env());
    if (!log.length) return log;
    if (!quiet) for (const line of Industry.summary(cargo.industry, log)) { notify(`Made · ${line}`, 3.5); addNews(`Made · ${line}`, 'industry'); }
    saveCargo();
    return log;
  },
  change(fn) {
    industry.settle();
    const ok = fn(cargo.industry, industry.env(), Clock.now());
    Industry.kick(cargo.industry, industry.env(), Clock.now());
    saveCargo();
    return ok !== false && ok !== null && ok !== 0;
  },
  // A production order here: set up only while docked at its station.
  place: (recipe, count) => !!industry.here && industry.change((s, e, now) => Industry.place(s, industry.here, recipe, count, e, now, devUnlock ? null : cargo.loyalty)),
  edit(id, recipe, count) {
    if (!industry.orders().some((o) => o.id === id)) return false;
    return industry.change((s, e, now) => Industry.change(s, id, recipe, count, e, now));
  },
  // From any station.
  pause: (id, paused = true) => industry.change((s, e, now) => Industry.pause(s, id, paused, e, now)),
  cancel: (id) => industry.change((s) => Industry.cancel(s, id)),
  move: (i, j) => industry.change((s) => Industry.move(s, i, j)),
  // A map marker on an order's station, for the flight view to point the way.
  mark(key) {
    const st = stationOf(key);
    if (!st) return false;
    SystemMap.marker = { x: st.x, y: st.y, name: st.name };
    return true;
  },
  // Goods from the hold (trade goods) or the components store into storage, as many as fit.
  deposit(kind, n = Infinity) {
    return industry.change((s, e, now) => {
      const salvage = Goods.isSalvage(kind);
      const have = salvage ? cargo.components[kind] || 0 : hold.count(kind);
      const k = Industry.deposit(s, kind, Math.min(n, have), e, now);
      if (salvage) addTo(cargo.components, kind, -k);
      else for (let i = 0; i < k; i++) cargo.items.splice(cargo.items.findIndex((it) => it.kind === kind), 1);
      return k > 0;
    });
  },
  // From storage into the hold (as far as it has room), or the components, spare gear, spare mods
  // or the kit, which take no room.
  withdraw(kind, n = Infinity) {
    return industry.change((s) => {
      const apart = Goods.isSalvage(kind) || !!Loadout.EQUIPMENT[kind] || !!Mods.MODS[kind] || !!Abilities.ABILITIES[kind];
      const k = Industry.withdraw(s, kind, apart ? n : Math.min(n, hold.free));
      if (Loadout.EQUIPMENT[kind]) addTo(cargo.gear, kind, k);
      else if (Mods.MODS[kind]) addTo(cargo.mods, kind, k);
      else if (Abilities.ABILITIES[kind]) addTo(cargo.kit, kind, k);
      else if (apart) addTo(cargo.components, kind, k);
      else for (let i = 0; i < k; i++) cargo.items.push({ kind, label: Goods.type(kind).name, category: 'trade' });
      return k > 0;
    });
  },
};

// In flight, every few seconds of real time.
export function tickIndustry() {
  const now = Clock.now();
  if (now - lastCheck < FLIGHT_CHECK) return;
  lastCheck = now;
  industry.settle();
}
