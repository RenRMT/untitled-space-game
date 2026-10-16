// Industry as the station menu sees it (rules/industry.js): leasing bays at the station docked at,
// setting their jobs, moving goods between the hold and the station's warehouse, and bays working
// on the real-world clock, settled on load, on docking, every second on the station screen and
// every few seconds in flight. Every change settles first, then changes, then lets idle bays start,
// so what's made never depends on when it was looked at.
// Part of the flight view; src/main.js starts it.

import { Clock } from '../core/clock.js';
import { Goods } from '../rules/goods.js';
import { Industry } from '../rules/industry.js';
import { Loadout } from '../rules/loadout.js';
import { Mods } from '../rules/mods.js';
import { Recipes } from '../rules/recipes.js';
import { addTo, cargo, hold, saveCargo } from './cargo.js';
import { notify } from './state.js';

const FLIGHT_CHECK = 5000; // ms between checks in flight
let lastCheck = 0;

export const industry = {
  get state() { return cargo.industry; },
  here: null, // the station docked at: { key, name, type }, or null in flight
  now: () => Clock.now(),
  env: () => Industry.env(cargo.lab),
  // The site at the station docked at (or another, by key), or null where nothing is leased.
  site: (key = industry.here?.key) => (key && cargo.industry.sites[key]) || null,
  get sites() { return Object.entries(cargo.industry.sites).map(([key, s]) => ({ key, ...s })); },
  known: () => Recipes.known(cargo.lab.done),
  maxBays: () => Industry.maxBays(industry.env()),
  // Runs finished by now, each station's output announced together.
  settle({ quiet = false } = {}) {
    const { log } = Industry.settle(cargo.industry, Clock.now(), industry.env());
    if (!log.length) return log;
    if (!quiet) for (const line of Industry.summary(cargo.industry, log)) notify(`Made · ${line}`, 3.5);
    saveCargo();
    return log;
  },
  // Lease a bay here: paid once.
  lease(type) {
    const here = industry.here, price = Industry.LEASE[type];
    if (!here || price === undefined || cargo.credits < price) return false;
    industry.settle();
    const s = Industry.site(cargo.industry, here.key, here);
    if (s.bays.length >= industry.maxBays()) return false;
    cargo.credits -= price;
    Industry.lease(s, type);
    saveCargo();
    return true;
  },
  change(fn) {
    const s = industry.site();
    if (!s) return false;
    industry.settle();
    const ok = fn(s, industry.env(), Clock.now());
    Industry.kick(s, industry.env(), Clock.now());
    saveCargo();
    return ok !== false;
  },
  setJob: (i, recipe, count) => industry.change((s, e, now) => Industry.setJob(s, i, recipe, count, e, now)),
  clearJob: (i) => industry.change((s) => Industry.clearJob(s, i)),
  move: (i, j) => industry.change((s) => Industry.move(s, i, j)),
  // Goods from the hold (trade goods) or the components store into the warehouse here, as many as fit.
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
  // From the warehouse here into the hold (as far as it has room), or the components, spare gear or
  // spare mods, which take no room.
  withdraw(kind, n = Infinity) {
    return industry.change((s) => {
      const apart = Goods.isSalvage(kind) || !!Loadout.EQUIPMENT[kind] || !!Mods.MODS[kind];
      const k = Industry.withdraw(s, kind, apart ? n : Math.min(n, hold.free));
      if (Loadout.EQUIPMENT[kind]) addTo(cargo.gear, kind, k);
      else if (Mods.MODS[kind]) addTo(cargo.mods, kind, k);
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
