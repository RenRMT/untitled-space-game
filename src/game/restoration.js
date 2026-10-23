// Restoring stations (rules/restoration.js) as the game sees them: whether a station is online
// (its type's project done, or online from the start; everything with ?dev), and restoring one at
// the waystation with goods from the waystation's stock and credits. A restored station trusts the
// player (loyalty 1), so it takes orders at once. game/industry.js restore() settles production
// around a restoration.
// Part of the flight view; src/main.js starts it.

import { Industry } from '../rules/industry.js';
import { Restoration } from '../rules/restoration.js';
import { SystemMap } from '../ui/map.js';
import { cargo, devUnlock, saveCargo } from './cargo.js';
import { notify } from './state.js';
import { world } from './world.js';

const typeOf = (st) => (st.waystation ? 'waystation' : st.market.type);
const stationByKey = (key) => world.galaxy?.stations.find((s) => s.key === key) || null;
const home = () => world.galaxy?.stations[world.galaxy.waystation] || null;

// Every station that is online trusts the player at least enough to take orders.
export function trustOnline() {
  for (const st of world.galaxy?.stations || []) {
    if (restoration.online(st.key) && (cargo.loyalty[st.key] ?? Industry.LOYALTY.start) < Industry.LOYALTY.required) cargo.loyalty[st.key] = Industry.LOYALTY.required;
  }
}

export const restoration = {
  typeOf: (key) => { const st = stationByKey(key); return st ? typeOf(st) : null; },
  online(key) {
    const st = stationByKey(key);
    return !!st && (devUnlock || Restoration.online(typeOf(st), cargo.restored));
  },
  shuttle(key) {
    const st = stationByKey(key);
    return !!st && (devUnlock || Restoration.shuttle(typeOf(st), cargo.restored));
  },
  home: () => home()?.key || null,
  // Each project, in order, with what it restores, where it is and its state ('done' | 'locked' |
  // 'short' | 'ready'), the goods it's short of and whether the credits are.
  projects() {
    const stock = home() ? Industry.stockAt(cargo.industry, home().key) : {};
    return Restoration.LIST.map((p) => {
      const st = (world.galaxy?.stations || []).find((s) => typeOf(s) === (p.type || p.shuttle));
      const s = Restoration.status(p.id, cargo.restored, stock, cargo.credits);
      return { ...p, station: st ? st.name : null, state: s.id, short: s.short, poor: s.credits };
    });
  },
  // Restore: the goods out of the waystation's stock, the credits paid. Docked at the waystation.
  restore(id) {
    const W = home();
    if (!W) return false;
    const r = Restoration.restore(id, cargo.restored, Industry.stockAt(cargo.industry, W.key), cargo.credits);
    if (!r) return false;
    for (const [kind, n] of Object.entries(r.take)) Industry.withdraw(cargo.industry, W.key, kind, n);
    cargo.credits -= r.credits;
    cargo.restored.push(id);
    trustOnline();
    const p = Restoration.PROJECTS[id];
    notify(p.type ? `${p.name} restored · it takes orders now` : `${p.name} ready`, 3.5, { tone: 'good' });
    saveCargo();
    return true;
  },
};

SystemMap.offline = (key) => !restoration.online(key);
