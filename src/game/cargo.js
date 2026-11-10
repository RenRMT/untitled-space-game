// Cargo hold and credits: items collected or bought, saved per galaxy (with the loadout, spare gear,
// gambits, squad and missions), and the ship's stats from its loadout (applyShip).
// Part of the flight view; src/main.js starts it.

import { Clock } from '../core/clock.js';
import { Feedback } from '../core/feedback.js';
import { Save } from '../core/save.js';
import { Params, Store } from '../core/store.js';
import { Entities } from '../flight/entities.js';
import { Economy } from '../rules/economy.js';
import { Abilities } from '../rules/abilities.js';
import { Goods } from '../rules/goods.js';
import { Industry } from '../rules/industry.js';
import { Loadout } from '../rules/loadout.js';
import { Loot } from '../rules/loot.js';
import { HullMods } from '../rules/hullmods.js';
import { Logic } from '../rules/logic.js';
import { Mods } from '../rules/mods.js';
import { Recipes } from '../rules/recipes.js';
import { Reputation } from '../rules/reputation.js';
import { Research } from '../rules/research.js';
import { Progress } from '../rules/progress.js';
import { Squad } from '../rules/squad.js';
import { Vendor } from '../rules/vendor.js';
import { Classes } from '../rules/classes.js';
import { Jobs } from '../story/jobs.js';
import { Missions } from '../story/missions.js';
import { Galaxy } from '../world/galaxy.js';
import { HULL_ART } from './options.js';
import { buildWings } from './squad.js';
import { queueFit } from './quickfit.js';
import { upgradeLine } from './upgrades.js';
import { showHints } from './input.js';
import { SHIP, clamp, notify, ship } from './state.js';

// items: trade goods in the hold, { kind (a rules/goods.js type), label, category: 'trade' }, one unit
// each. components: salvaged components by type ({ [kind]: count }), kept apart from the hold:
// they take no room, can't be sold, survive the ship's loss and are used up by research.
// removed: keys of generated things gone from the world for good: items collected, asteroids
// broken up by mining, ships destroyed in combat (keys are unique across kinds). drops: items
// left floating by mining, destroyed ships or the player's own lost cargo, not yet collected
// (item entities; each keeps its saved form in `drop`). hull: the player ship's hull points
// (repaired at stations).
// home: the last station docked at, where a lost ship is towed.
// loadout: the ship's class and fitted equipment; gear: spare equipment assembled or taken out (android gear among it, from squad ships)
// ({ [equipment id]: count }); mods: spare mods ({ [mod id]: count }; fitted ones are in the
// loadout, rules/mods.js); kit: consumables for abilities in a fight ({ [ability id]: charges },
// rules/abilities.js), which take no room in the hold; gambits: the logic packages owned ([id],
// rules/research.js, bought at an outfitter or found: game/vendor.js); shop: what's been bought from
// today's gear stock at each station ({ day, bought: { [station key]: [i] } }); pilot: the player's
// experience and talents ({ xp, talents: [id] }, rules/progress.js: the level comes from the xp);
// world.surveyed: the deep-space sites whose find has been made ([site id], game/sites.js).
// world: the elites' and raids' timers (game/traffic.js: { elites: { [system]: { n, at } }, raids: { n, next } }) and the
// contracts done today (game/jobs.js: daily: { [job id]: day }); squad: the squad members (rules/squad.js), with their loadouts and programs
// and hull. missions: the mission log
// (story/missions.js): what's been accepted, done and handed in, the galaxy's jobs among it;
// board: those jobs (story/jobs.js, grown from the galaxy, not saved); track: the job the HUD and
// map follow (an id, or null for the first under way). market: station stockpiles the player's
// trading has moved away from rest (rules/economy.js), drifting back on the real-world clock.
// rep: how each faction regards the player (rules/reputation.js), moved by the jobs handed in.
// surfaceDrops: what lies on each surface to pick up ({ [body key]: [{ key, kind | loot, x, y }] }): what
// deposits left, what was jettisoned and the hold of a ship lost there (game/surface-run.js).
// loot: the loot gear owned (rules/loot.js specs by id: fitted, spare or floating), remade into
// Loadout.EQUIPMENT as the save loads; lootPity: the bad-luck counters ({ rare, epic }); rewards:
// gear rewards still to choose ([{ key, from, options: [spec] }]: game/rewards.js).
// razed: stations and turrets destroyed ({ [key]: their system's index + 1 }: game/structures.js).
export const cargo = {
  key: '', items: [], components: {}, removed: new Set(), credits: 0, drops: [], hull: 0, home: null, surfaceDrops: {},
  loadout: Loadout.starter('courier'), gear: {}, mods: {}, kit: {}, gambits: [], shop: null, squad: [], pilot: { xp: 0, talents: [] }, world: { elites: {}, raids: { n: 0, next: 0 }, daily: {}, surveyed: [] },
  missions: Missions.create(), board: null, track: null, market: Economy.empty(), rep: Reputation.empty(),
  cls: Classes.DEFAULT, // the ship's class (rules/classes.js): Tank, DPS or Healer
  loot: {}, lootPity: { rare: 0, epic: 0 }, rewards: [], razed: {},
};
// ?dev (for testing): every station service open, even in a fresh game, without touching the save
// (the jobs board). Combat god mode is the same switch (game/combat.js).
export const BAD = ':bad'; // the key suffix a damaged save is set aside under (loadCargo)
export const PICKUP_RANGE = 40; // world units beyond the item's own size
// A floating item from its saved form { key, kind (a rules/goods.js type), seed, x, y }.
// Drops are held still at the three-quarter turn their icons are drawn at (art/icons.js), so what
// floats is what the menus show; dragged onto the ship, one is picked up (game/input.js).
export const DROP_ANGLE = -0.35;
export function dropEntity(d) {
  if (d.loot) return { ...Entities.lootDrop({ key: d.key, spec: d.loot, x: d.x, y: d.y, angle: DROP_ANGLE, tumble: 0 }), drop: d };
  return { ...Entities.item({ key: d.key, kind: d.kind, seed: d.seed, x: d.x, y: d.y, angle: DROP_ANGLE, tumble: 0 }), drop: d };
}
// Gear left floating round (x, y) (specs: rules/loot.js), keyed by tag, within spread of it: to be
// dragged aboard like any drop, and felt as it drops (lootDropped).
export function scatterLoot(specs, x, y, tag, spread = 60) {
  specs.forEach((spec, i) => {
    const a = (i / Math.max(1, specs.length)) * Math.PI * 2 + Math.random(), r = spread * (0.4 + 0.6 * Math.random());
    cargo.drops.push(dropEntity({ key: `loot:${tag}:${i}`, loot: spec, seed: spec.seed, x: x + Math.cos(a) * r, y: y + Math.sin(a) * r }));
  });
  lootDropped(specs);
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

// SHIP from the loadout, its class, and the pilot's level and talents, and the ship drawn as its hull. When
// more armour raises the maximum, the hull points rise with it (not when a save is loaded).
// The pilot's level (rules/progress.js), from their experience.
export const pilotLevel = () => Progress.of(cargo.pilot.xp).level;
// What improves every hull the player flies (rules/loadout.js upgrades: more hold, armour, a weapon
// slot), on top of its gear: the pilot's talents.
export const shipUpgrades = () => Progress.upgrades(cargo.pilot.talents);
export function applyShip({ loading = false } = {}) {
  const before = SHIP.hull, hullBefore = SHIP.name;
  // Its class (rules/classes.js) on top of its gear.
  Object.assign(SHIP, Progress.apply(Classes.apply(Loadout.stats(cargo.loadout, shipUpgrades()), cargo.cls), pilotLevel(), cargo.pilot.talents));
  ship.art = (HULL_ART[cargo.loadout.hull] || HULL_ART.courier)();
  if (!loading && SHIP.name === hullBefore && SHIP.hull > before) cargo.hull += SHIP.hull - before;
  cargo.hull = clamp(cargo.hull, 0, SHIP.hull);
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
  cargo.cls = Classes.DEFAULT;
  cargo.gear = {};
  cargo.loot = {};
  cargo.lootPity = { rare: 0, epic: 0 };
  cargo.rewards = [];
  cargo.razed = {};
  cargo.mods = {};
  cargo.kit = {};
  cargo.gambits = [];
  cargo.shop = null;
  cargo.pilot = { xp: 0, talents: [] };
  cargo.world = { elites: {}, raids: { n: 0, next: 0 }, daily: {}, surveyed: [] };
  cargo.market = Economy.empty();
  cargo.rep = Reputation.empty();
  cargo.squad = []; // hired at a dock (game/squad.js)
  cargo.board = Jobs.board(galaxy);
  cargo.missions = Missions.create(null, cargo.board.byId);
  cargo.track = null;
  cargo.hull = Infinity; // full, once applyShip knows the maximum
  cargo.surfaceDrops = {}; // body key -> [{ key, kind, x, y }]: what's left lying on its surface
  if (Params.has('fresh')) Store.remove(cargo.key);
  // A damaged save (not JSON, or one that can't be read through): what was read before the error
  // is kept, and the save as it was is set aside under `<key>:bad` before the next write replaces it.
  const raw = Store.get(cargo.key);
  let d = null, damaged = false;
  try { d = raw === null ? null : JSON.parse(raw); } catch (e) { damaged = true; }
  if (d && typeof d !== 'object') { d = null; damaged = true; }
  try {
    if (d) readCargo(Save.migrate(d, CARGO_MIGRATIONS), galaxy);
  } catch (e) { damaged = true; }
  if (damaged) {
    Store.set(`${cargo.key}${BAD}`, raw);
    notify('The saved game was damaged: what could be read was kept', 6, { tone: 'warn' });
  }
  // A new game starts with the story's first chapter taken, from the station it starts beside: its
  // objective is on the HUD from the first frame (notes/review.md).
  if (!d) {
    const first = cargo.board.list.find((J) => J.tier === 'story' && !J.requires);
    if (first && cargo.missions.accept(first.id, galaxy.stations[galaxy.startStation]?.key)) cargo.track = first.id;
    showHints(); // and the controls, until the first touch
  }
  news.length = 0;
  applyShip({ loading: true });
  buildWings(); // the squad's ships, for the members just read
}
// What happened since the player last docked that the station screen should say, shown together on
// the next dock (the station's "Since you last docked" sheet): [{ text, tab }]. Not saved.
export const news = [];
export function addNews(text, tab) { if (news.length < 30 && !news.some((n) => n.text === text)) news.push({ text, tab }); }

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
export const HOME_STOCK = '*home';

// The logic packages known (rules/research.js, owned as gambits) and how many lines of a program run.
// Every game knows the logic for skills, use() and hull % (Vendor.FREE), so a squad member's class
// program (rules/classes.js) runs from the start.
export const logicKnown = () => Research.known([...new Set([...cargo.gambits, ...Vendor.FREE])]);
export const logicLines = () => Squad.lineLimit(Research.lineBonus(cargo.gambits) + Progress.lineBonus(pilotLevel()));

// The parts of a save (in the current form), each checked.
export function readCargo(d, galaxy = null) {
  // Loot gear first: the loadouts (the ship's and the squad's) and the spare gear name it.
  cargo.loot = Loot.read(d.loot);
  for (const spec of Object.values(cargo.loot)) Loot.register(spec, Loadout.EQUIPMENT);
  if (d.lootPity && typeof d.lootPity === 'object') cargo.lootPity = { rare: Math.max(0, d.lootPity.rare | 0), epic: Math.max(0, d.lootPity.epic | 0) };
  cargo.rewards = (Array.isArray(d.rewards) ? d.rewards : []).map((w) => w && typeof w.key === 'string' && Array.isArray(w.options)
    && { key: w.key, from: String(w.from || 'A reward'), options: w.options.map((s) => s && Loot.read({ [s.id]: s })[s.id]).filter(Boolean) })
    .filter((w) => w && w.options.length);
  for (const w of cargo.rewards) for (const spec of w.options) Loot.register(spec, Loadout.EQUIPMENT);
  if (d.razed && typeof d.razed === 'object') for (const [key, t] of Object.entries(d.razed)) if (typeof key === 'string' && Number.isFinite(t)) cargo.razed[key] = t;
  // Before the squad: what its programs may use.
  cargo.gambits = Array.isArray(d.gambits) ? [...new Set(d.gambits.filter((id) => Vendor.isGambit(id)))] : [];
  cargo.pilot = { xp: Math.max(0, Math.floor(d.pilot?.xp) || 0), talents: [] }; // talents once the class is read
  if (d.world && typeof d.world === 'object') {
    for (const [si, e] of Object.entries(d.world.elites || {})) if (e && Number.isFinite(e.n) && Number.isFinite(e.at)) cargo.world.elites[si] = { n: e.n, at: e.at };
    for (const [id, day] of Object.entries(d.world.daily || {})) if (Number.isFinite(day)) cargo.world.daily[id] = day;
    if (Array.isArray(d.world.surveyed)) cargo.world.surveyed = [...new Set(d.world.surveyed.filter((id) => Number.isInteger(id) && id >= 0 && (!galaxy || galaxy.sites?.[id])))];
    if (Number.isFinite(d.world.raids?.n) && Number.isFinite(d.world.raids?.next)) cargo.world.raids = { n: d.world.raids.n, next: d.world.raids.next };
  }
  if (d.shop && Number.isFinite(d.shop.day) && d.shop.bought && typeof d.shop.bought === 'object') {
    cargo.shop = { day: d.shop.day, bought: {} };
    for (const [key, list] of Object.entries(d.shop.bought)) if (Array.isArray(list)) cargo.shop.bought[key] = list.filter(Number.isInteger);
  }
  cargo.market = Economy.prune(Economy.read(d.market), Clock.now());
  cargo.squad = Squad.read(d.squad, logicKnown()) || cargo.squad;
  if (d.missions) cargo.missions = Missions.create(d.missions, cargo.board ? cargo.board.byId : {});
  cargo.rep = Reputation.read(d.rep);
  if (d.repFromJobs && cargo.board) for (const J of cargo.board.list) if (cargo.missions.status(J.id) === 'done') Reputation.earn(cargo.rep, J);
  if (typeof d.track === 'string' && cargo.board && cargo.board.byId[d.track]) cargo.track = d.track;
  cargo.loadout = validLoadout(d.loadout) || cargo.loadout;
  cargo.cls = Classes.valid(d.cls);
  cargo.pilot.talents = Progress.read(d.pilot?.talents, cargo.cls).slice(0, Progress.points(pilotLevel()));
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
    cargo.drops = d.drops.filter((x) => x && (x.loot ? Loot.read({ [x.loot.id]: x.loot })[x.loot.id] : Goods.resolve(x.kind, x.label)))
      .map((x) => dropEntity(x.loot ? { key: x.key, loot: Loot.read({ [x.loot.id]: x.loot })[x.loot.id], seed: x.seed >>> 0, x: x.x, y: x.y }
        : { key: x.key, kind: Goods.resolve(x.kind, x.label), seed: x.seed, x: x.x, y: x.y }));
  }
  if (Number.isFinite(d.hull)) cargo.hull = Math.max(1, d.hull);
  if (d.surfaceDrops && typeof d.surfaceDrops === 'object') {
    for (const [body, list] of Object.entries(d.surfaceDrops)) {
      const ok = (Array.isArray(list) ? list : []).filter((x) => x && typeof x.key === 'string' && Number.isFinite(x.x) && Number.isFinite(x.y))
        .map((x) => {
          if (x.loot) { // gear lying there (game/surface-run.js leaveLoot)
            const spec = x.loot.id && Loot.read({ [x.loot.id]: x.loot })[x.loot.id];
            return spec ? { key: x.key, loot: spec, x: x.x, y: x.y } : null;
          }
          const kind = Goods.resolve(x.kind);
          return kind ? { key: x.key, kind, x: x.x, y: x.y } : null;
        }).filter(Boolean);
      if (ok.length) cargo.surfaceDrops[body] = ok;
    }
  }
  if (d.home && Number.isFinite(d.home.x)) cargo.home = d.home;
}
// Cargo is saved a second after the first change (core/save.js), so a burst of changes (Sell all)
// is one write; and when the page is hidden or closed, or another galaxy loads. Storage
// unavailable: cargo lasts for this session only (core/store.js).
// A write the browser refuses (storage full, or blocked) is said once, so the player can export a copy.
export const saveState = { failed: false };
export const cargoSave = Save.debounced(() => wrote(Store.setJSON(cargo.key, {
  version: CARGO_MIGRATIONS.length,
  items: cargo.items, components: cargo.components, removed: [...cargo.removed], credits: cargo.credits,
  drops: cargo.drops.map((e) => e.drop), hull: cargo.hull, home: cargo.home,
  surfaceDrops: cargo.surfaceDrops,
  cls: cargo.cls, loadout: cargo.loadout, gear: cargo.gear, mods: cargo.mods, kit: cargo.kit, gambits: cargo.gambits, shop: cargo.shop, pilot: cargo.pilot, world: cargo.world, squad: cargo.squad,
  market: cargo.market, rep: cargo.rep, missions: cargo.missions.save(), track: cargo.track,
  loot: ownedLoot(), lootPity: cargo.lootPity, rewards: cargo.rewards, razed: cargo.razed,
})), 1000);
function wrote(ok) {
  if (ok) { saveState.failed = false; return; }
  if (!saveState.failed) notify('Could not save here: export a copy from Settings', 6, { tone: 'warn' });
  saveState.failed = true;
}
// The loot specs still owned: fitted (the ship's or a squad member's), spare, or floating.
export function ownedLoot() {
  const ids = new Set([...Object.keys(cargo.gear), ...Object.values(cargo.loadout.fitted), ...cargo.squad.flatMap((m) => Object.values(m.loadout?.fitted || {}))]);
  const out = {};
  for (const id of ids) if (id && cargo.loot[id]) out[id] = cargo.loot[id];
  return out;
}
// The classes loot is biased toward (rules/loot.js smart loot): the whole party's, yours counting
// twice, so a squad of other classes finds gear for its ships too.
export const lootClasses = () => [cargo.cls, cargo.cls, ...cargo.squad.filter((m) => !m.disabled).map((m) => m.cls)];
// A piece of loot comes aboard: remade into the equipment list, kept with the save, into the spare gear.
export function takeLoot(spec) {
  cargo.loot[spec.id] = spec;
  const item = Loot.register(spec, Loadout.EQUIPMENT);
  addTo(cargo.gear, spec.id);
  return item;
}
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

// A piece of loot picked up or handed over, said in its rarity's tone, and whom it's an upgrade for
// (game/upgrades.js), if anyone: that's what matters most when it drops.
const RARITY_TONE = { common: 'info', uncommon: 'good', rare: 'good', epic: 'good', legendary: 'good' };
export function lootNotice(item) {
  if (!item) return;
  const R = Loot.rarityOf(item.loot.rarity), up = upgradeLine(item.loot.id);
  const power = item.loot.power ? ` · ${Loot.powerOf(item.loot.power).name}: ${Loot.powerOf(item.loot.power).text}` : '';
  notify(`${R.name} loot: ${item.name} · ilvl ${item.loot.ilvl}${power}${up ? ` · ${up}` : ' · in your spare gear'}`, Loot.RANK[R.id] >= Loot.RANK.epic ? 6 : up || R.id !== 'common' ? 4 : 2.5, { tone: up ? 'good' : RARITY_TONE[R.id] });
  Feedback.emit('loot', { rarity: R.id });
  if (up) queueFit(item.loot.id); // offered to fit there and then, once calm (game/quickfit.js)
}
// Gear dropped where it floats (specs): felt by its best rarity (game/options.js BUZZ), and an Epic
// or Legendary called out at once, before it's picked up: the moment it drops is the one to mark.
export function lootDropped(specs) {
  if (!specs.length) return;
  const R = Loot.RARITIES[Math.max(...specs.map((s) => Loot.RANK[s.rarity]))];
  Feedback.emit('loot', { rarity: R.id });
  if (Loot.RANK[R.id] >= Loot.RANK.epic) notify(`${R.name} drop!`, 3, { tone: 'good' });
}

// Collect all (game/input.js, on a drop's menu): every drop floating within GATHER of the ship comes
// aboard at once, as if each were dragged onto it (gear into the spare gear, goods while the hold has
// room; what doesn't fit waits beside the ship). Not in a fight. Returns how many came aboard.
export const GATHER = 1500; // world units
export function gatherDrops(list) {
  const near = list.filter((e) => (e.kind === 'item' || e.kind === 'loot') && !cargo.removed.has(e.key) && Math.hypot(ship.x - e.x, ship.y - e.y) <= GATHER);
  for (const e of near) {
    Object.assign(e, { x: ship.x, y: ship.y });
    if (e.drop) Object.assign(e.drop, { x: ship.x, y: ship.y });
  }
  return collectItems(near);
}

// Floating items dragged onto the ship (game/input.js) are picked up: trade goods into the hold
// while there's room, components into their own store, which never fills. A trade good that won't
// fit is left where it is. Nothing is picked up by flying near it.
export function collectItems(list) {
  let n = 0;
  for (const e of list) {
    if ((e.kind !== 'item' && e.kind !== 'loot') || cargo.removed.has(e.key)) continue;
    const d = Math.hypot(ship.x - e.x, ship.y - e.y);
    if (d > e.radius * 0.7 + PICKUP_RANGE) continue;
    if (e.kind === 'loot') { // gear: into the spare gear, which takes no hold room
      if (e.drop) cargo.drops.splice(cargo.drops.indexOf(e), 1);
      else cargo.removed.add(e.key);
      const item = takeLoot(e.spec);
      lootNotice(item);
      saveCargo();
      n++;
      continue;
    }
    if (e.mission) { // a mission's cargo: kept apart from the hold, for the mission
      cargo.removed.add(e.key);
      notify(`Recovered: ${e.label}`, 2.5);
      saveCargo();
      n++;
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
    n++;
  }
  return n;
}
