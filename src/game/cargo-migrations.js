// Saves from older versions of the game brought up to date, a step a version (core/save.js
// migrate): most are about systems the game no longer has (research, industry, hazards), kept so
// a game begun then still opens. game/cargo.js reads the result.
// Part of the flight view (no init: nothing to wire).

import { Goods } from '../rules/goods.js';
import { HullMods } from '../rules/hullmods.js';
import { Industry } from '../rules/industry.js';
import { Loadout } from '../rules/loadout.js';
import { Logic } from '../rules/logic.js';
import { Loot } from '../rules/loot.js';
import { Progress } from '../rules/progress.js';
import { Recipes } from '../rules/recipes.js';
import { Research } from '../rules/research.js';
import { Squad } from '../rules/squad.js';
import { addTo, upgradeItem } from './cargo.js';

// How a save from an older version of the game becomes the current form: step i takes a save of
// version i to i + 1 (Save.migrate, core/save.js; saves from before versions are version 0). A
// change to what is saved adds a step here, rather than a special case in readCargo.
const CARGO_MIGRATIONS = [
  // 1. Things gone from the world in one list (it was three: collected, mined, destroyed), and
  //    salvaged components in their own store (they were kept in the hold).
  (d) => {
    d.removed = [d.removed, d.collected, d.mined, d.destroyed].filter(Array.isArray).flat();
    if (!Array.isArray(d.items)) return;
    const items = d.items.map(upgradeItem).filter(Boolean);
    d.components = { ...(d.components || {}) };
    for (const it of items) if (Goods.isSalvage(it.kind)) addTo(d.components, it.kind);
    d.items = items.filter((it) => !Goods.isSalvage(it.kind));
  },
  // 2, 3. (The opening missions' log, since removed: nothing to do.)
  () => {},
  () => {},
  // 4. Research no longer unlocks equipment or hull upgrades: equipment researched becomes a
  //    schematic (sold to you at every station, as before), hull upgrades become hull refits.
  (d) => {
    if (!Array.isArray(d.research)) return;
    d.schematics = d.research.filter((id) => Loadout.EQUIPMENT[id] && !Loadout.EQUIPMENT[id].npc);
    d.hullMods = d.research.filter((id) => HullMods.NODES[id]);
    delete d.research;
  },
  // 5. Squad members run programs of logic lines, not modules in slots: the one module there
  //    was (assist-leader) becomes its line.
  (d) => {
    if (!Array.isArray(d.squad)) return;
    const LINES = { 'assist-leader': 'assist.leader' };
    for (const m of d.squad) {
      if (!m || !Array.isArray(m.modules)) continue;
      m.program = m.modules.filter((id) => LINES[id]).map((id) => Logic.copy(Logic.PRESETS[LINES[id]]));
      delete m.modules;
    }
  },
  // 6. Logic research: nothing done yet.
  (d) => {
    if (!d.lab) d.lab = Research.empty();
  },
  // 7. Hull refits are researched: those fitted are done, as of the start of time.
  (d) => {
    d.lab = d.lab || Research.empty();
    d.lab.done = Array.isArray(d.lab.done) ? d.lab.done : [];
    d.lab.doneAt = d.lab.doneAt || {};
    for (const id of Array.isArray(d.hullMods) ? d.hullMods : []) {
      const n = `hull.${id}`;
      if (Research.PACKAGES[n] && !d.lab.done.includes(n)) { d.lab.done.push(n); d.lab.doneAt[n] = 0; }
    }
    delete d.hullMods;
  },
  // 8. Industry: nothing leased yet.
  (d) => {
    if (!d.industry) d.industry = Industry.empty();
  },
  // 9. Gear isn't sold any more but assembled by blueprint: schematics recovered, and gear owned
  //    (fitted or spare), become their blueprints, researched as of the start of time.
  (d) => {
    d.lab = d.lab || Research.empty();
    d.lab.done = Array.isArray(d.lab.done) ? d.lab.done : [];
    d.lab.doneAt = d.lab.doneAt || {};
    const owned = [...(Array.isArray(d.schematics) ? d.schematics : []), ...Object.values(d.loadout?.fitted || {}), ...Object.keys(d.gear || {})];
    for (const id of owned) {
      const bp = typeof id === 'string' && Research.blueprintFor(id);
      if (bp && !d.lab.done.includes(bp)) { d.lab.done.push(bp); d.lab.doneAt[bp] = 0; }
    }
    if (Array.isArray(d.lab.queue)) d.lab.queue = d.lab.queue.filter((id) => !d.lab.done.includes(id));
    if (d.lab.active && d.lab.done.includes(d.lab.active.id)) d.lab.active = null;
    delete d.schematics;
  },
  // 10. Mods: none yet (spare ones; fitted ones are in the loadout).
  (d) => {
    if (!d.mods) d.mods = {};
  },
  // 11. Abilities: an empty kit.
  (d) => {
    if (!d.kit) d.kit = {};
  },
  // 12. Production orders and one shared storage, in place of bays leased at stations: every
  //     warehouse goes into the storage (with the inputs of runs under way), every lease is refunded,
  //     and each station's first bay with a job becomes its order where the station does that stage.
  (d) => {
    const LEASE = { refinery: 1500, fabricator: 3000, assembler: 5000 };
    const sites = d.industry?.sites && typeof d.industry.sites === 'object' ? d.industry.sites : {};
    const out = { storage: {}, orders: [], seq: 1 }; // (one storage, until migration 20)
    for (const [key, s] of Object.entries(sites)) {
      if (!s || typeof s !== 'object') continue;
      for (const [kind, n] of Object.entries(s.storage || {})) if (n > 0) addTo(out.storage, kind, n);
      let first = true;
      for (const b of Array.isArray(s.bays) ? s.bays : []) {
        if (!b) continue;
        if (Number.isFinite(d.credits) && LEASE[b.type]) d.credits += LEASE[b.type];
        const R = b.job && Recipes.RECIPES[b.job.recipe];
        if (!R) continue;
        if (b.job.next != null) for (const [kind, n] of Object.entries(R.in)) addTo(out.storage, kind, n);
        if (!first || !Industry.canMake(s.type, R.id)) continue;
        first = false;
        const left = b.job.left === null ? null : Math.max(0, Math.floor(b.job.left) || 0) + (b.job.next != null ? 1 : 0);
        out.orders.push({ id: out.seq++, station: key, name: String(s.name || key), type: String(s.type), recipe: R.id, left, made: Math.max(0, Math.floor(b.job.made) || 0), at: null, next: null, paused: false });
      }
    }
    d.industry = out;
    d.loyalty = {};
  },
  // 13. Squad members fit gear like the ship does, from their own loadout: each starts with the
  //     gear the player starts with, in place of its android gear at a Mk.
  (d) => {
    if (!Array.isArray(d.squad)) return;
    for (const m of d.squad) {
      if (!m || typeof m !== 'object' || m.loadout || !Loadout.HULLS[m.hull]?.npc) continue;
      m.loadout = Squad.starter(m.hull);
      delete m.tier;
    }
  },
  // 14. Markets with stockpiles: every station at rest.
  (d) => {
    if (!d.market) d.market = {};
  },
  // 15. Reputation with the factions: earned again from the jobs already handed in (readCargo,
  //     once the mission log is read).
  (d) => {
    if (!d.rep) d.repFromJobs = true;
  },
  // 16. Hazards (rules/hazards.js): a full tank, and no radiation taken in.
  (d) => {
    if (!Number.isFinite(d.fuel)) d.fuel = null; // full (readCargo)
    if (!Number.isFinite(d.rad)) d.rad = 0;
  },
  // 17. The surface run (game/surface-run.js): no deposits mined yet, nothing left on a surface.
  (d) => {
    if (!d.mined || typeof d.mined !== 'object' || Array.isArray(d.mined)) d.mined = {};
    if (!d.surfaceDrops || typeof d.surfaceDrops !== 'object') d.surfaceDrops = {};
  },
  // 18. Active mining (game/surface-run.js): every landing seeds a fresh field, so nothing is kept of
  // the deposits worked out on each body.
  (d) => {
    delete d.mined;
  },
  // 19. Stations per process (notes/hazards.md phase 6): an order whose station no longer makes its
  //     recipe is cancelled, the inputs of its run under way back in storage.
  (d) => {
    const s = d.industry;
    if (!s || !Array.isArray(s.orders)) return;
    if (!s.storage || typeof s.storage !== 'object') s.storage = {};
    s.orders = s.orders.filter((o) => {
      if (o && Recipes.RECIPES[o.recipe] && Industry.canMake(o.type, o.recipe)) return true;
      if (o?.next != null && Recipes.RECIPES[o.recipe]) for (const [kind, n] of Object.entries(Recipes.RECIPES[o.recipe].in)) addTo(s.storage, kind, n);
      return false;
    });
  },
  // 20. A stock at each station in place of one shared storage: what was stored goes to the
  //     waystation's (HOME_STOCK, which readIndustry puts under the waystation's key).
  (d) => {
    const s = d.industry;
    if (!s || typeof s !== 'object') return;
    s.stock = s.storage && typeof s.storage === 'object' ? { [HOME_STOCK]: s.storage } : {};
    delete s.storage;
  },
  // 21. Stations restored (rules/restoration.js): a game under way has every project done up to
  //     the last station it was already using (orders there, or trusted): readCargo, with the galaxy.
  (d) => {
    if (!Array.isArray(d.restored)) d.restoreFromUse = true;
  },
  // 22. No lab or industry in the game any more (notes/roadmap.md): the logic packages researched
  //     become gambits owned; the rest of the lab, the stocks and orders, loyalty and restoration go.
  (d) => {
    const done = Array.isArray(d.lab?.done) ? d.lab.done : [];
    d.gambits = done.filter((id) => Research.PACKAGES[id]?.kind === 'logic');
    for (const k of ['lab', 'industry', 'loyalty', 'restored', 'restoreFromUse']) delete d[k];
  },
  // 23. Levels (rules/progress.js): a game under way starts at the level its best fitted gear asks
  //     for, so nothing it wears is locked away; each squad member likewise by its own gear.
  (d) => {
    const fromGear = (l) => {
      const ids = Object.values(l?.fitted || {}).filter(Boolean);
      const level = Math.max(1, ...ids.map((id) => Progress.gearLevel(Loadout.EQUIPMENT[id] || (d.loot?.[id] ? Loot.make(d.loot[id]) : null))));
      let xp = 0;
      for (let k = 1; k < level; k++) xp += Progress.toNext(k);
      return xp;
    };
    d.pilot = { xp: fromGear(d.loadout), talents: [] };
    for (const m of Array.isArray(d.squad) ? d.squad : []) if (m && typeof m === 'object') m.xp = fromGear(m.loadout);
  },
];
// The stock a save from before stations kept their own had (migration 20): the waystation's.
const HOME_STOCK = '*home';

export { CARGO_MIGRATIONS, HOME_STOCK };
