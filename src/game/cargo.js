// Cargo hold and credits: items collected or bought, saved per galaxy (with the loadout, spare gear,
// research, industry, squad and missions), and the ship's stats from its loadout (applyShip).
// Part of the flight view; src/main.js starts it.

import { mulberry32 } from '../core/rng.js';
import { Clock } from '../core/clock.js';
import { Save } from '../core/save.js';
import { Params, Store } from '../core/store.js';
import { Entities } from '../flight/entities.js';
import { Economy } from '../rules/economy.js';
import { Abilities } from '../rules/abilities.js';
import { Goods } from '../rules/goods.js';
import { Hazards } from '../rules/hazards.js';
import { Industry } from '../rules/industry.js';
import { Loadout } from '../rules/loadout.js';
import { HullMods } from '../rules/hullmods.js';
import { Logic } from '../rules/logic.js';
import { Mods } from '../rules/mods.js';
import { Recipes } from '../rules/recipes.js';
import { Reputation } from '../rules/reputation.js';
import { Restoration } from '../rules/restoration.js';
import { Research } from '../rules/research.js';
import { Squad } from '../rules/squad.js';
import { Jobs } from '../story/jobs.js';
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
// (repaired at stations). fuel: what's in the tank (rules/hazards.js burns it; refuelled at
// stations); rad: radiation taken in (it builds until a station decontaminates the ship).
// home: the last station docked at, where a lost ship is towed.
// loadout: the ship's class and fitted equipment; gear: spare equipment assembled or taken out (android gear among it, from squad ships)
// ({ [equipment id]: count }); mods: spare mods ({ [mod id]: count }; fitted ones are in the
// loadout, rules/mods.js); kit: consumables for abilities in a fight ({ [ability id]: charges },
// rules/abilities.js), which take no room in the hold; lab: research (rules/research.js: what's done, building and queued,
// blueprints and hull refits among it); industry: each station's stock and the production orders at
// stations (rules/industry.js); loyalty: how far each station trusts the player ({ [station key]: n },
// raised by missions done for it; a station not in it counts Industry.LOYALTY.start); squad: the squad members (rules/squad.js), with their loadouts and programs
// and hull. story: what has happened so far (a Set of STORY flags). missions: the mission log
// (story/missions.js): what's been accepted, done and handed in, the galaxy's jobs among it;
// board: those jobs (story/jobs.js, grown from the galaxy, not saved); track: the job the HUD and
// map follow (an id, or null for the first under way). market: station stockpiles the player's
// trading has moved away from rest (rules/economy.js), drifting back on the real-world clock.
// rep: how each faction regards the player (rules/reputation.js), moved by the jobs handed in.
// surfaceDrops: what lies on each surface to pick up ({ [body key]: [{ key, kind, x, y }] }): what
// deposits left, what was jettisoned and the hold of a ship lost there (game/surface-run.js).
// restored: the restoration projects done ([id], rules/restoration.js): which stations are online.
export const cargo = {
  key: '', items: [], components: {}, removed: new Set(), credits: 0, drops: [], hull: 0, fuel: 0, rad: 0, home: null, surfaceDrops: {},
  loadout: Loadout.starter('courier'), gear: {}, mods: {}, kit: {}, lab: Research.empty(), industry: Industry.empty(), loyalty: {}, squad: [], story: new Set(),
  missions: Missions.create(), board: null, track: null, market: Economy.empty(), rep: Reputation.empty(), restored: [],
};
// Story flags: 'intro', the introduction played (or skipped); 'gates', the jump gates brought
// online by the third opening mission (until then the first system is all there is).
export const STORY = ['intro', 'gates'];
// ?dev (for testing): the jump gates online, every station service open and production orders
// taken everywhere, even in a fresh game, without touching the save (see stationLocks, the jobs
// board and game/industry.js). Combat god mode is the same switch (game/combat.js).
export const devUnlock = Params.has('dev');
// Whether the game plays the opening missions; off while the core gameplay is reworked: none are
// offered, the game starts beside the start station and the jump gates are online from the start
// (they're what the third mission brings online). ?missions plays them anyway.
export const MISSIONS_ENABLED = false;
export const missionsOn = MISSIONS_ENABLED || Params.has('missions');
export const gatesOnline = () => devUnlock || !missionsOn || cargo.story.has('gates');
// The opening missions (story/missions.js), which follow the introduction and pay off the player's
// debt: "Payment in kind", then "The remaining balance". Until the second is handed in, station
// screens offer only Missions (and Squad, once the first has brought a squad member): see The
// opening missions below.
export const OPENING = 'repayment', SALVAGE = 'salvage', GATE_JOB = 'gate';
// The waystation's missions, in the order it offers them (the third is optional).
export const CHAIN = [OPENING, SALVAGE, GATE_JOB];
export const opening = () => cargo.missions.status(SALVAGE) !== 'done';
export const PICKUP_RANGE = 40; // world units beyond the item's own size
// Items closer than this (beyond their own size) are pulled in to the ship, closing on it at
// PULL_SPEED world units a second faster than it flies.
export const PULL_RANGE = 220, PULL_SPEED = 450;
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
// A saved loadout, if it is one this game knows: a hull for sale, and only known equipment and mods
// (mods without room are kept: they wait for gear with room).
export function validLoadout(l) {
  if (!l || !Loadout.HULLS[l.hull]?.price || typeof l.fitted !== 'object') return null;
  const fitted = {}, mods = {};
  for (const [slot, id] of Object.entries(l.fitted)) fitted[slot] = id && Loadout.EQUIPMENT[id] && !Loadout.EQUIPMENT[id].npc ? id : null;
  for (const [slot, list] of Object.entries(l.mods || {})) {
    const ok = Array.isArray(list) && slot in fitted ? list.filter((m) => Mods.MODS[m]) : [];
    if (ok.length) mods[slot] = ok;
  }
  return { hull: l.hull, fitted, mods };
}

// SHIP from the loadout and what research adds (hull refits), and the ship drawn as its hull. When
// more armour raises the maximum, the hull points rise with it (not when a save is loaded).
export function applyShip({ loading = false } = {}) {
  const before = SHIP.hull, hullBefore = SHIP.name;
  Object.assign(SHIP, Loadout.stats(cargo.loadout, Research.upgrades(cargo.lab.done)));
  ship.art = (HULL_ART[cargo.loadout.hull] || HULL_ART.courier)();
  if (!loading && SHIP.name === hullBefore && SHIP.hull > before) cargo.hull += SHIP.hull - before;
  cargo.hull = clamp(cargo.hull, 0, SHIP.hull);
  cargo.fuel = clamp(cargo.fuel, 0, SHIP.fuel);
}

export function loadCargo(galaxy) {
  cargoSave.flush(); // the old galaxy's cargo first
  cargo.key = `cargo:${Galaxy.saveKey(galaxy)}`;
  cargo.items = [];
  cargo.components = {};
  cargo.removed = new Set();
  cargo.credits = Economy.config.startingCredits;
  cargo.drops = [];
  cargo.home = null;
  cargo.loadout = Loadout.starter('courier');
  cargo.gear = {};
  cargo.mods = {};
  cargo.kit = {};
  cargo.lab = Research.empty();
  cargo.industry = Industry.empty();
  cargo.loyalty = {};
  cargo.restored = [];
  cargo.market = Economy.empty();
  cargo.rep = Reputation.empty();
  cargo.squad = []; // the first member joins at the end of the first mission
  cargo.story = new Set();
  cargo.board = Jobs.board(galaxy);
  cargo.missions = Missions.create(null, cargo.board.byId);
  cargo.track = null;
  cargo.hull = Infinity; // full, once applyShip knows the maximum
  cargo.fuel = Infinity; // the same
  cargo.rad = 0;
  cargo.surfaceDrops = {}; // body key -> [{ key, kind, x, y }]: what's left lying on its surface
  if (Params.has('fresh')) Store.remove(cargo.key);
  const d = Store.getJSON(cargo.key);
  try {
    if (d) readCargo(Save.migrate(d, CARGO_MIGRATIONS), galaxy);
  } catch (e) { /* a damaged save: keep what was read before the error */ }
  // Research that finished while the game was closed (before the ship: refits among it), then what
  // industry made meanwhile (after research: its bonuses count from when they finished).
  // One notice for all of it; the list waits for the next dock.
  news.length = 0;
  for (const id of Research.settle(cargo.lab, Clock.now())) addNews(buildDone(id), 'research');
  const { log } = Industry.settle(cargo.industry, Clock.now(), Industry.env(cargo.lab));
  for (const line of Industry.summary(cargo.industry, log)) addNews(`Made while away · ${line}`, 'industry');
  if (news.length) notify(`${news.length === 1 ? news[0].text : `${news.length} things finished while you were away`} · dock to see`, 4, { tone: 'good' });
  applyShip({ loading: true });
  buildWings(); // the squad's ships, for the members just read
}
// What finished since the player last docked (research, production), shown together on the next
// dock (the station's "Since you last docked" sheet): [{ text, tab }]. Not saved: on load, what
// finished while the game was closed is put here again (loadCargo).
export const news = [];
export function addNews(text, tab) { if (news.length < 30 && !news.some((n) => n.text === text)) news.push({ text, tab }); }

// The notice for a finished package.
export const buildDone = (id) => (Research.PACKAGES[id].kind === 'logic' ? `Build ok · import ${Research.title(id)}` : `Research done · ${Research.title(id)}`);
// How a save from an older version of the game becomes the current form: step i takes a save of
// version i to i + 1 (Save.migrate, core/save.js; saves from before versions are version 0). A
// change to what is saved adds a step here, rather than a special case in readCargo.
export const CARGO_MIGRATIONS = [
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
  // 2. The mission log: a save that had played the introduction already has the wingman the
  //    first mission brings, so that mission is done.
  (d) => {
    if (d.missions || !(Array.isArray(d.story) && d.story.includes('intro'))) return;
    const log = Missions.create();
    log.finish(OPENING);
    d.missions = log.save();
  },
  // 3. The second mission: with the first done, the debt was already settled by it. (Saves of
  //    this form carried missionsVersion: 2.)
  (d) => {
    if (!d.missions || d.missionsVersion >= 2) return;
    const log = Missions.create(d.missions);
    if (log.status(OPENING) !== 'done') return;
    log.finish(SALVAGE);
    d.missions = log.save();
  },
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
];
// The stock a save from before stations kept their own had (migration 20): the waystation's.
export const HOME_STOCK = '*home';

// The logic packages known (rules/research.js) and how many lines of a program run.
export const logicKnown = () => Research.known(cargo.lab.done);
export const logicLines = () => Squad.lineLimit(Research.lineBonus(cargo.lab.done));

// A saved lab, checked: known packages only; one building with a time that makes no sense is dropped.
export function readLab(d) {
  const lab = Research.empty();
  if (!d || typeof d !== 'object') return lab;
  const ok = (id) => typeof id === 'string' && !!Research.PACKAGES[id];
  if (Array.isArray(d.done)) lab.done = [...new Set(d.done.filter(ok))];
  for (const id of lab.done) lab.doneAt[id] = Number.isFinite(d.doneAt?.[id]) ? d.doneAt[id] : 0;
  const a = d.active;
  if (a && ok(a.id) && !lab.done.includes(a.id) && Number.isFinite(a.start) && Number.isFinite(a.end) && a.end >= a.start) lab.active = { id: a.id, start: a.start, end: a.end };
  if (Array.isArray(d.queue)) lab.queue = [...new Set(d.queue.filter((id) => ok(id) && !lab.done.includes(id) && id !== lab.active?.id))].slice(0, Research.queueMax(lab));
  if (!lab.active && lab.queue.length) Research.enqueue(lab, lab.queue.shift(), Clock.now());
  return lab;
}

// Saved production, checked: known goods in storage; an order whose recipe is gone, or isn't made
// at its station's type, is dropped; a run under way with times that make no sense is forgotten.
// home: the waystation's key, for the stock of a save from before stations kept their own.
export function readIndustry(d, home = null) {
  const out = Industry.empty();
  if (!d || typeof d !== 'object') return out;
  const whole = (n) => Math.max(0, Math.floor(n) || 0);
  for (const [key, counts] of Object.entries(d.stock && typeof d.stock === 'object' ? d.stock : {})) {
    const at = key === HOME_STOCK ? home : key;
    if (!at || !counts || typeof counts !== 'object') continue;
    for (const [kind, n] of Object.entries(counts)) {
      if (!Recipes.item(kind) || whole(n) <= 0) continue;
      const s = out.stock[at] || (out.stock[at] = {});
      s[kind] = (s[kind] || 0) + whole(n);
    }
  }
  const ids = new Set();
  for (const o of Array.isArray(d.orders) ? d.orders : []) {
    if (!o || typeof o.station !== 'string' || !Industry.canMake(o.type, o.recipe) || !Number.isInteger(o.id) || ids.has(o.id)) continue;
    ids.add(o.id);
    const running = Number.isFinite(o.at) && Number.isFinite(o.next) && o.next >= o.at;
    out.orders.push({
      id: o.id, station: o.station, name: String(o.name || o.station), type: o.type, recipe: o.recipe, left: o.left === null ? null : whole(o.left),
      made: whole(o.made), at: running ? o.at : null, next: running ? o.next : null, paused: !!o.paused,
    });
  }
  out.seq = Math.max(whole(d.seq), ...out.orders.map((o) => o.id + 1), 1);
  return out;
}
// The projects a game from before restoration counts as done: every one up to (and with) the last
// that restores a station type it was using (an order there, or loyalty), so nothing it had stops.
export function restoredByUse(galaxy) {
  const used = new Set(cargo.industry.orders.map((o) => o.type));
  for (const st of galaxy.stations) if (Industry.trusted(cargo.loyalty, st.key)) used.add(st.waystation ? 'waystation' : st.market.type);
  const last = Restoration.LIST.reduce((n, p, i) => (p.type && used.has(p.type) ? i : n), -1);
  return Restoration.LIST.slice(0, last + 1).map((p) => p.id);
}
// Saved loyalty, checked: a number per station.
export function readLoyalty(d) {
  const out = {};
  if (d && typeof d === 'object') for (const [key, n] of Object.entries(d)) if (Number.isFinite(n)) out[key] = n;
  return out;
}

// The parts of a save (in the current form), each checked.
export function readCargo(d, galaxy = null) {
  cargo.lab = readLab(d.lab); // before the squad: what its programs may use
  cargo.industry = readIndustry(d.industry, galaxy?.stations[galaxy.waystation]?.key ?? null);
  cargo.loyalty = readLoyalty(d.loyalty);
  cargo.restored = Array.isArray(d.restored) ? [...new Set(d.restored.filter((id) => Restoration.PROJECTS[id]))] : [];
  if (d.restoreFromUse && galaxy) cargo.restored = restoredByUse(galaxy);
  cargo.market = Economy.prune(Economy.read(d.market), Clock.now());
  cargo.squad = Squad.read(d.squad, logicKnown()) || cargo.squad;
  if (Array.isArray(d.story)) cargo.story = new Set(d.story.filter((f) => STORY.includes(f)));
  if (d.missions) cargo.missions = Missions.create(d.missions, cargo.board ? cargo.board.byId : {});
  cargo.rep = Reputation.read(d.rep);
  if (d.repFromJobs && cargo.board) for (const J of cargo.board.list) if (cargo.missions.status(J.id) === 'done') Reputation.earn(cargo.rep, J);
  if (typeof d.track === 'string' && cargo.board && cargo.board.byId[d.track]) cargo.track = d.track;
  cargo.loadout = validLoadout(d.loadout) || cargo.loadout;
  if (d.gear && typeof d.gear === 'object') for (const [id, n] of Object.entries(d.gear)) if (Loadout.EQUIPMENT[id] && n > 0) addTo(cargo.gear, id, Math.floor(n)); // android gear too, for the squad
  if (d.kit && typeof d.kit === 'object') for (const [id, n] of Object.entries(d.kit)) if (Abilities.ABILITIES[id] && n > 0) addTo(cargo.kit, id, Math.floor(n));
  if (d.mods && typeof d.mods === 'object') for (const [id, n] of Object.entries(d.mods)) if (Mods.MODS[id] && n > 0) addTo(cargo.mods, id, Math.floor(n));
  if (d.components && typeof d.components === 'object') {
    for (const [stored, n] of Object.entries(d.components)) {
      const kind = Goods.resolve(stored); // tiered components from before there was one per kind
      if (kind && Goods.isSalvage(kind) && n > 0) addTo(cargo.components, kind, Math.floor(n));
    }
  }
  if (Array.isArray(d.items)) cargo.items = d.items.map(upgradeItem).filter((it) => it && !Goods.isSalvage(it.kind));
  if (Array.isArray(d.removed)) cargo.removed = new Set(d.removed);
  if (Number.isFinite(d.credits)) cargo.credits = d.credits;
  if (Array.isArray(d.drops)) {
    cargo.drops = d.drops.filter((x) => x && Goods.resolve(x.kind, x.label))
      .map((x) => dropEntity({ key: x.key, kind: Goods.resolve(x.kind, x.label), seed: x.seed, x: x.x, y: x.y }));
  }
  if (Number.isFinite(d.hull)) cargo.hull = Math.max(1, d.hull);
  if (Number.isFinite(d.fuel)) cargo.fuel = Math.max(0, d.fuel);
  if (Number.isFinite(d.rad)) cargo.rad = clamp(d.rad, 0, Hazards.config.max - 1);
  if (d.surfaceDrops && typeof d.surfaceDrops === 'object') {
    for (const [body, list] of Object.entries(d.surfaceDrops)) {
      const ok = (Array.isArray(list) ? list : []).filter((x) => x && typeof x.key === 'string' && Number.isFinite(x.x) && Number.isFinite(x.y) && Goods.resolve(x.kind))
        .map((x) => ({ key: x.key, kind: Goods.resolve(x.kind), x: x.x, y: x.y }));
      if (ok.length) cargo.surfaceDrops[body] = ok;
    }
  }
  if (d.home && Number.isFinite(d.home.x)) cargo.home = d.home;
}
// Cargo is saved a second after the first change (core/save.js), so a burst of changes (Sell all)
// is one write; and when the page is hidden or closed, or another galaxy loads. Storage
// unavailable: cargo lasts for this session only (core/store.js).
export const cargoSave = Save.debounced(() => Store.setJSON(cargo.key, {
  version: CARGO_MIGRATIONS.length,
  items: cargo.items, components: cargo.components, removed: [...cargo.removed], credits: cargo.credits,
  drops: cargo.drops.map((e) => e.drop), hull: cargo.hull, fuel: cargo.fuel, rad: cargo.rad, home: cargo.home,
  surfaceDrops: cargo.surfaceDrops,
  loadout: cargo.loadout, gear: cargo.gear, mods: cargo.mods, kit: cargo.kit, lab: cargo.lab, industry: cargo.industry, loyalty: cargo.loyalty, squad: cargo.squad,
  market: cargo.market, rep: cargo.rep, story: [...cargo.story], missions: cargo.missions.save(), track: cargo.track, restored: cargo.restored,
}), 1000);
export const saveCargo = () => cargoSave.change();
export const saveCargoNow = () => cargoSave.now();

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

// Refuelling, on docking and again on launch (game/docking.js): hydrazine in the hold goes in first
// (FUEL_PER_HYDRAZINE a unit, while at least half of one fits), then hydrazine in the stock of the
// station docked at (fuelling.at, its key, set by docking), then fuel bought for credits, as much as
// there is room for and the credits cover.
//   fuelling.refuel() -> { hydrazine, credits } (what it took) | null (nothing went in)
export const FUEL_PER_HYDRAZINE = 25;
export const FUEL_PRICE = 6; // credits per unit (hydrazine's price over FUEL_PER_HYDRAZINE, and a little)
export const fuelling = {
  price: FUEL_PRICE,
  at: null,
  get stocked() { return fuelling.at ? Industry.stockAt(cargo.industry, fuelling.at).hydrazine || 0 : 0; },
  get fuel() { return cargo.fuel; },
  get max() { return SHIP.fuel; },
  get room() { return Math.max(0, SHIP.fuel - cargo.fuel); },
  get hydrazine() { return hold.count('hydrazine') + fuelling.stocked; },
  // What filling up would cost in credits, after the hydrazine aboard and in storage.
  get cost() { return Math.ceil(Math.max(0, fuelling.room - fuelling.hydrazine * FUEL_PER_HYDRAZINE)) * FUEL_PRICE; },
  refuel() {
    if (fuelling.room < 0.5) return null;
    let used = 0;
    // A unit of hydrazine while at least half of it fits; credits top up the rest.
    const fits = () => fuelling.room >= FUEL_PER_HYDRAZINE / 2;
    while (fits() && hold.count('hydrazine') > 0) {
      cargo.items.splice(cargo.items.findIndex((it) => it.kind === 'hydrazine'), 1);
      cargo.fuel = Math.min(SHIP.fuel, cargo.fuel + FUEL_PER_HYDRAZINE);
      used++;
    }
    while (fits() && fuelling.stocked > 0) {
      Industry.withdraw(cargo.industry, fuelling.at, 'hydrazine', 1);
      cargo.fuel = Math.min(SHIP.fuel, cargo.fuel + FUEL_PER_HYDRAZINE);
      used++;
    }
    const units = Math.max(0, Math.min(Math.ceil(fuelling.room), Math.floor(cargo.credits / FUEL_PRICE)));
    if (units > 0) {
      cargo.fuel = Math.min(SHIP.fuel, cargo.fuel + units);
      cargo.credits -= units * FUEL_PRICE;
    }
    if (!used && units <= 0) return null;
    saveCargo();
    return { hydrazine: used, credits: units * FUEL_PRICE };
  },
};

// Floating items near the ship are pulled in to it (dt seconds of pull), and those within reach
// are picked up: trade goods into the hold while there's room, components into their own store,
// which never fills. A trade good that won't fit is left where it is.
export function collectItems(list, dt = 0) {
  for (const e of list) {
    if (e.kind !== 'item' || cargo.removed.has(e.key)) continue;
    let d = Math.hypot(ship.x - e.x, ship.y - e.y);
    const fits = e.mission || Goods.isSalvage(e.itemKind) || hold.free >= 1;
    if (fits && dt > 0 && d > 0 && d < e.radius * 0.7 + PULL_RANGE) {
      const step = Math.min(d, (Math.hypot(ship.vx, ship.vy) + PULL_SPEED) * dt);
      e.x += ((ship.x - e.x) / d) * step;
      e.y += ((ship.y - e.y) / d) * step;
      if (e.drop) { e.drop.x = e.x; e.drop.y = e.y; }
      d -= step;
    }
    if (d > e.radius * 0.7 + PICKUP_RANGE) continue;
    if (e.mission) { // a mission's cargo: kept apart from the hold, for the mission
      cargo.removed.add(e.key);
      notify(`Recovered: ${e.label}`, 2.5);
      saveCargo();
      continue;
    }
    const component = Goods.isSalvage(e.itemKind);
    if (!component && hold.free < 1) {
      notify('Hold full', 2.5, { once: true, tone: 'warn' }); // and leave it floating
      continue;
    }
    if (e.drop) cargo.drops.splice(cargo.drops.indexOf(e), 1);
    else cargo.removed.add(e.key);
    if (component) addTo(cargo.components, e.itemKind);
    else cargo.items.push({ kind: e.itemKind, label: e.label, category: 'trade' });
    notify(`Recovered: ${e.label}`, 2.5);
    saveCargo();
  }
}
