// Research as the station menu sees it (rules/research.js): queueing a package (paying for
// it up front), cancelling one (a refund), and packages finishing on the real-world clock, checked
// on load, on docking, every second on the Research tab and every few seconds in flight.
// Part of the flight view; src/main.js starts it.

import { Clock } from '../core/clock.js';
import { Params } from '../core/store.js';
import { Goods } from '../rules/goods.js';
import { Research } from '../rules/research.js';
import { addNews, addTo, applyShip, buildDone, cargo, hold, saveCargo } from './cargo.js';
import { notify } from './state.js';

const FLIGHT_CHECK = 5000; // ms between checks in flight
let lastCheck = 0;

const label = (id) => Research.title(id);

function refund(out) {
  for (const { id, refund: k } of out) {
    for (const [kind, n] of Object.entries(Research.PACKAGES[id].cost)) {
      const back = Math.floor(n * k);
      if (kind === 'credits') cargo.credits += back;
      else if (Goods.isSalvage(kind)) addTo(cargo.components, kind, back);
      else for (let i = 0; i < back && hold.free > 0; i++) cargo.items.push({ kind, label: Goods.type(kind).name, category: 'trade' });
    }
  }
}

export const lab = {
  get state() { return cargo.lab; },
  get components() { return cargo.components; },
  now: () => Clock.now(),
  have: (kind) => (Goods.isSalvage(kind) ? cargo.components[kind] || 0 : hold.count(kind)),
  status: (id) => Research.status(id, cargo.lab, cargo.credits, lab.have),
  progress: () => Research.progress(cargo.lab, Clock.now()),
  // Pay and queue (or start) a package.
  enqueue(id) {
    const st = lab.status(id);
    if (!st.ok || !Research.enqueue(cargo.lab, id, Clock.now())) return false;
    cargo.credits -= st.credits;
    for (const { kind, need } of st.cost) {
      if (Goods.isSalvage(kind)) addTo(cargo.components, kind, -need);
      else for (let i = 0; i < need; i++) cargo.items.splice(cargo.items.findIndex((it) => it.kind === kind), 1);
    }
    saveCargo();
    return true;
  },
  // Cancel a package (and whatever was queued needing it): all back for one still waiting, half for
  // the one building. Goods come back as far as the hold has room.
  cancel(id) {
    lab.settle();
    const out = Research.cancel(cargo.lab, id, Clock.now());
    refund(out);
    if (out.length) saveCargo();
    return out.map((x) => x.id);
  },
  // A package done at once (a schematic's blueprint), with what was paid for it back if it was queued.
  grant(id) {
    lab.settle();
    if (cargo.lab.done.includes(id)) return false;
    refund(Research.grant(cargo.lab, id, Clock.now()));
    saveCargo();
    return true;
  },
  // Packages finished by now: into what's known, each announced; refits apply to the ship at once.
  settle({ quiet = false } = {}) {
    const done = Research.settle(cargo.lab, Clock.now());
    if (!done.length) return done;
    if (!quiet) for (const id of done) { notify(buildDone(id), 3.5); addNews(buildDone(id), 'research'); }
    if (done.some((id) => Research.PACKAGES[id].kind !== 'logic')) applyShip();
    saveCargo();
    return done;
  },
  label,
};

// In flight, every few seconds of real time.
export function tickLab() {
  const now = Clock.now();
  if (now - lastCheck < FLIGHT_CHECK) return;
  lastCheck = now;
  lab.settle();
}

export function init() {
  if (Params.has('fastresearch')) Research.config.speed = 60;
}
