'use strict';

// ---------- Setup ----------

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d', { alpha: false }); // every frame starts with an opaque fill
const { TAU, clamp, lerp } = MathUtil;

// The play area is a galaxy of solar systems in one open space (world/galaxy.js), joined by jump gates:
// world coordinates are units from the first system's star.
// Each frame poses and draws only what lies within NEAR of the camera (flight/scene.js): the screen
// and the minimap's square (RADAR, 6000 each way: 8500 to its corners). Drawing happens relative to
// a nearby grid point to keep precision.
const NEAR = 9000;
const NAV_RANGE = 18000; // off-screen stations and gates this close get an edge marker

const COLORS = Theme.color; // core/theme.js, shared with the map and the CSS

// What the ship can do: its class and fitted equipment (rules/loadout.js, saved with the cargo as
// cargo.loadout) with the hull upgrades researched (rules/research.js) added up: handling, hold, sensor
// ranges, mining speed, combat stats. Kept up to date in place by applyShip().
const SHIP = Loadout.stats(Loadout.starter('courier'));

const ship = {
  x: 0, y: 0,
  vx: 0, vy: 0,
  angle: -Math.PI / 2,
  targetAngle: -Math.PI / 2,
  targetSpeed: 0,
  thrust: 0,
};

// zoom: screen px per world unit, base (by the window's size) × k (eased: wider in the introduction).
const view = { w: 0, h: 0, dpr: 1, zoom: 1, base: 1, k: 1 };
const cam = { x: 0, y: 0 };
const particles = [];
const debris = []; // rock fragments thrown off by mining, in world units
// The squad's ships flying with yours (see Squad below), by member id: { kind: 'wingman', key,
// member, art, name, color, stats, radius, x, y, vx, vy, angle, a, thrust }.
const wings = new Map();
const mining = { target: null, t: 0 }; // the asteroid being mined, and seconds mined so far
// Approach: fly to the selected object and stop beside it (or keep station with a moving ship).
// key: entityKey of the target; e: that entity this frame; stop: distance to stop at; follow: never finishes.
const autopilot = { key: null, e: null, stop: 0, follow: false };
// Combat (combat/combat-core.js; the modes in combat/combat.js and combat/combat-realtime.js): s is the fight in progress
// (null when none) and mode the kind it is (a COMBAT key); ships holds the enemies' poses by key
// (held in rounds, flown in real time); fx the queued and running effects (beams, flashes, numbers, explosions);
// result/resultT keep the outcome on the panel for a moment; grace keeps pirates off after
// fleeing or respawning; wreckT counts down while the destroyed player ship is towed.
// final and lastShips keep the ended fight's state and enemy poses for the panel and late effects;
// wrecked hides the player ship between its explosion and the tow. returning: enemies that
// survived a real-time fight, flying back to their usual paths (by key).
const fight = {
  s: null, mode: 'rounds', ships: new Map(), fx: [], log: [], result: null, resultT: 0, grace: 0, wreckT: 0,
  final: null, lastShips: new Map(), wrecked: false, returning: new Map(), dying: new Set(),
};
// The introduction (see Introduction below): on while the escape pod is being talked in to the
// waystation. run: the script (story/intro.js); station: the waystation's entity; face: its android's
// portrait; flying: the pod is the player's to fly; beam: the tractor beam has it ({ t, in });
// arrive: the pod drifting in at the start, before anyone speaks ({ t, from, to, a0, a1 }).
const intro = { on: false, run: null, station: null, face: null, flying: false, beam: null, arrive: null };
const inFight = () => !!fight.s || fight.wreckT > 0;
const fightMode = () => COMBAT[fight.mode];
const flyingFight = () => !!fight.s && fightMode().flying; // flying is allowed
let simTime = 0; // advances only while flying, so the map pause doesn't make ships jump
let flash = 0; // white-out when the wrecked ship is towed home or jumps through a gate, fading from 1
const toast = { text: '', t: 0 }; // short centre-screen notice, fading out
// Show a notice for t seconds. once: leave the same notice alone while it's still showing, so
// something checked every frame doesn't keep restarting it.
const notify = (text, t = 2, { once = false } = {}) => {
  if (once && toast.text === text && toast.t >= 0.5) return;
  toast.text = text;
  toast.t = t;
};
// What the screen is busy with: 'intro', 'talking', 'docked', 'in-combat', 'settings'. Each sets the
// body class of the same name (index.html hides controls by it); the map can't open during any of
// those in MAP_BLOCKERS. Several can hold at once, so each is switched on and off by name.
const modes = new Set();
const MAP_BLOCKERS = ['intro', 'docked', 'in-combat', 'settings'];
function setMode(name, on) {
  if (on) modes.add(name); else modes.delete(name);
  document.body.classList.toggle(name, on);
  SystemMap.blocked = MAP_BLOCKERS.some((m) => modes.has(m));
}
// Where the ship is (world/galaxy.js regionAt: system, security, nebula, what it's near) and the
// mission's next step (objective()), worked out once a step and read by the HUD, minimap and markers.
const here = { region: null, objective: null };
let lastRegion; // the system, security level and nebula the ship was in last frame, for enter/leave notices
let senseTimer = 0;

const { turnToward } = Flight;

function resize() {
  view.dpr = Display.dpr();
  view.w = window.innerWidth;
  view.h = window.innerHeight;
  canvas.width = Math.round(view.w * view.dpr);
  canvas.height = Math.round(view.h * view.dpr);
  view.base = clamp(Math.min(view.w, view.h) / 800, 0.55, 1.2);
  view.zoom = view.base * view.k;
}
window.addEventListener('resize', () => { resize(); invalidate(); });
resize();

// ---------- Settings: art style, movement and combat (ui/settings.js menu) ----------

// A saved choice among `options` (core/store.js; a URL parameter of the same name overrides the saved
// one); onChange runs after every change.
function setting(key, options, fallback, onChange) {
  const s = { value: Store.choice(key, options, fallback) };
  s.set = (v) => { if (!options.includes(v)) return; s.value = v; Store.set(key, v); if (onChange) onChange(v); };
  s.cycle = () => s.set(options[(options.indexOf(s.value) + 1) % options.length]);
  return s;
}

const ART_STYLES = Art.STYLES.map((s) => s.id);
const artStyle = setting('style', ART_STYLES, 'line');

// Cruise: the ship holds the set speed after you let go (tap to stop).
// Direct: the ship only moves while you drag, with no drift, and stops when you let go.
// Both turn and change speed by the engine's numbers (flight/flight.js).
// Switching stops the ship, so it doesn't carry on under rules it wasn't set with.
const MOVE_MODES = ['cruise', 'direct'];
const moveMode = setting('move', MOVE_MODES, 'cruise', () => { ship.targetSpeed = 0; autopilot.key = null; });

// Combat: automatic rounds with the ships stopped (combat/combat.js), or real-time, flying throughout
// (combat/combat-realtime.js). Each fight keeps the mode it started in; the menu is closed during fights.
const COMBAT = { rounds: Combat.mode, realtime: RealtimeCombat.mode };
const COMBAT_MODES = Object.keys(COMBAT);
const combatMode = setting('combat', COMBAT_MODES, 'rounds');

const ART_HINT = {
  line: 'Neon outlines on the dark.',
  pixel: 'Coarse pixels with dithered shading.',
  flat: 'Solid fills with a simple rim shadow.',
  lowpoly: 'Faceted shapes with flat lighting.',
};
Settings.add({
  id: 'style', label: 'Art style', shortcut: 'V',
  choices: Art.STYLES.map((s) => ({ value: s.id, label: s.label, hint: ART_HINT[s.id] })),
  get: () => artStyle.value, set: (v) => artStyle.set(v),
});
Settings.add({
  id: 'move', label: 'Movement', shortcut: 'C',
  choices: [
    { value: 'cruise', label: 'Cruise', hint: 'Keeps your speed after you let go. Tap empty space to stop.' },
    { value: 'direct', label: 'Direct', hint: 'Moves only while you drag, with no drift. Let go to brake to a stop.' },
  ],
  get: () => moveMode.value, set: (v) => moveMode.set(v),
});
Settings.add({
  id: 'combat', label: 'Combat',
  choices: [
    { value: 'rounds', label: 'Rounds', hint: 'Ships stop and trade fire in automatic rounds. Pick targets and decide when to flee.' },
    { value: 'realtime', label: 'Real-time', hint: 'Keep flying. Your guns fire on their own while the locked target is in range and ahead of you. Outfly pirates to get away.' },
  ],
  get: () => combatMode.value, set: (v) => combatMode.set(v),
});

// The menu pauses flight but keeps drawing it, so a new art style shows behind the panel.
const settingsBtn = document.getElementById('settings-btn');
settingsBtn.addEventListener('click', () => { if (!inFight() && !docked && !intro.on) Settings.open(); });
Settings.onToggle = (open) => {
  setMode('settings', open); // no map on top of the menu
  invalidate(); // a changed setting shows behind the panel
  settingsBtn.setAttribute('aria-expanded', String(open));
  if (open) drag.active = false;
};

// Keyboard shortcuts. An action's key (F to dock, E to mine: see `actions` below) acts on the
// selected object, or else on the nearest one in reach.
window.addEventListener('keydown', (e) => {
  if (SystemMap.isOpen || docked || intro.on) return;
  // With no buttons showing them any more, the V and C shortcuts say what they switched to.
  if (e.key === 'v' || e.key === 'V') { artStyle.cycle(); notify(`Art style: ${Art.STYLES.find((s) => s.id === artStyle.value).label}`); }
  if (e.key === 'c' || e.key === 'C') { moveMode.cycle(); notify(`Movement: ${moveMode.value === 'cruise' ? 'Cruise' : 'Direct'}`); }
  if (e.key === 'Escape') select(null);
  // Several actions can share a key (E mines an asteroid or collects gas): the first that has a
  // target acts.
  for (const a of actions.forKeys(e.key)) {
    const target = actions.target(a, selected && selected.e, frameList);
    if (target) { a.run(target); break; }
  }
});

// How each hull the player can fly is drawn: the Courier is the original ship; the others are
// fixed designs in the same original style.
const HULL_ART = {
  courier: () => ArtBlueprints.playerShip(ArtCulture.legacy),
  hauler: () => ArtBlueprints.create('freighter', ArtCulture.legacy, 7),
  corvette: () => ArtBlueprints.create('fighter', ArtCulture.legacy, 11),
  gunship: () => ArtBlueprints.create('fighter', ArtCulture.legacy, 29),
  pod: () => escapePod(ArtCulture.legacy),
};

// The introduction's escape pod: a blunt capsule with a porthole and one small thruster, in the
// original ship's colours.
function escapePod(culture) {
  const b = ArtBlueprints.builder('pod', culture, 1);
  b.poly([[8, 0], [6, 4.6], [1, 6.4], [-5, 5.6], [-7.5, 3], [-7.5, -3], [-5, -5.6], [1, -6.4], [6, -4.6]], 'hull', { lvl: 1, h: 3, bevel: 3 });
  b.poly([[-1, 6.2], [-4.5, 5.6], [-4.5, -5.6], [-1, -6.2]], 'hull2', { lvl: 2, h: 0.5, line: false });
  b.circle(3, 0, 2.3, 'glass', { lvl: 3, h: 1, lineWidth: 0.75 });
  b.poly(ArtUtil.rect(-8.6, 0, 2, 4), 'engine', { lvl: 2, h: 2, line: false });
  b.light(-4, 5.4, 0.8, culture.pal.light, { blink: 1.2 });
  b.engine(-9.5, 0, 2);
  b.bp.glow = true;
  b.bp.line = culture.pal.line;
  b.bp.label = 'Escape pod';
  return ArtBlueprints.finish(b.bp);
}
ship.art = HULL_ART.courier();

// ---------- World: the galaxy generated by the map ----------

const world = { galaxy: null, cultures: null, scene: null, knowledge: null, travel: null };

// ---------- Cargo hold and credits: items collected or bought, saved per galaxy ----------

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
const cargo = {
  key: '', items: [], components: {}, removed: new Set(), credits: 0, drops: [], hull: 0, home: null,
  loadout: Loadout.starter('courier'), gear: {}, research: new Set(), squad: [], story: new Set(),
  missions: Missions.create(),
};
// Story flags: 'intro', the introduction played (or skipped); 'gates', the jump gates brought
// online (nothing does that yet: until then the first system is all there is).
const STORY = ['intro', 'gates'];
const gatesOnline = () => cargo.story.has('gates');
// The opening missions (story/missions.js), which follow the introduction and pay off the player's
// debt: "Payment in kind", then "The remaining balance". Until the second is handed in, station
// screens offer only Missions (and Squad, once the first has brought a squad member): see The
// opening missions below.
const OPENING = 'repayment', SALVAGE = 'salvage', GATE_JOB = 'gate';
// The waystation's missions, in the order it offers them (the third is optional).
const CHAIN = [OPENING, SALVAGE, GATE_JOB];
const opening = () => cargo.missions.status(SALVAGE) !== 'done';
// Saves from before the second mission count it as done once the first was: their debt was
// settled by the first. Saves carry the version of the mission chain they were made with.
const MISSIONS_VERSION = 2;
const PICKUP_RANGE = 24; // world units beyond the item's own size
// " · rare" after an item's name in notices, for anything better than common.
const rarityNote = (e) => (e.art.rarity > 1 ? ` · ${Goods.RARITY[e.art.rarity].label.toLowerCase()}` : '');

// A floating item from its saved form { key, kind (a rules/goods.js type), seed, x, y }.
function dropEntity(d) {
  const r = mulberry32(d.seed);
  return { ...Entities.item({ key: d.key, kind: d.kind, seed: d.seed, x: d.x, y: d.y, angle: r() * TAU, tumble: (r() - 0.5) * 0.3 }), drop: d };
}

// An item record from a save, brought up to date: saves from before item types stored a category
// ('metal') or only a label, which become that category's commonest type (Goods.resolve).
function upgradeItem(it) {
  const kind = Goods.resolve(it.kind, it.label);
  if (!kind) return null;
  return { kind, label: Goods.type(kind).name, category: 'trade' };
}
const addTo = (counts, kind, n = 1) => { counts[kind] = (counts[kind] || 0) + n; if (counts[kind] <= 0) delete counts[kind]; };
// A saved loadout, if it is one this game knows: a hull for sale, and only known equipment.
function validLoadout(l) {
  if (!l || !Loadout.HULLS[l.hull]?.price || typeof l.fitted !== 'object') return null;
  const fitted = {};
  for (const [slot, id] of Object.entries(l.fitted)) fitted[slot] = id && Loadout.EQUIPMENT[id] && !Loadout.EQUIPMENT[id].npc ? id : null;
  return { hull: l.hull, fitted };
}

// SHIP from the loadout and the hull upgrades researched, and the ship drawn as its hull. When
// more armour raises the maximum, the hull points rise with it (not when a save is loaded).
function applyShip({ loading = false } = {}) {
  const before = SHIP.hull, hullBefore = SHIP.name;
  Object.assign(SHIP, Loadout.stats(cargo.loadout, Research.upgrades(cargo.research)));
  ship.art = (HULL_ART[cargo.loadout.hull] || HULL_ART.courier)();
  if (!loading && SHIP.name === hullBefore && SHIP.hull > before) cargo.hull += SHIP.hull - before;
  cargo.hull = clamp(cargo.hull, 0, SHIP.hull);
}

function loadCargo(galaxy) {
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
function readCargo(d) {
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
const CARGO_SAVE_MS = 1000;
const cargoSave = { timer: null };
function saveCargo() {
  if (cargoSave.timer === null) cargoSave.timer = setTimeout(saveCargoNow, CARGO_SAVE_MS);
}
function saveCargoNow() {
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
const hold = {
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
const REPAIR_PRICE = 2; // credits per hull point
const repairs = {
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
function collectItems(list) {
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

// ---------- Outfitting and research, as the station menu sees them ----------

// Equipment: what's fitted, spare gear (bought or taken out), buying what research has unlocked,
// selling spare gear for half its price, and the shipyard's hulls (the current one traded in for
// half its price; the gear moves across, what doesn't fit goes to the spare gear).
const SELL_BACK = 0.5;
const outfitting = {
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
const lab = {
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
function changedShip() {
  applyShip();
  saveCargo();
  return true;
}

// The ship's sensors (rules/knowledge.js), at half range inside a nebula. A contact identified for the
// first time is announced. placeShip runs it while the galaxy first loads.
const NEBULA_SENSORS = 0.5;
function sense() {
  const k = world.galaxy.nebulaAt(ship.x, ship.y) ? NEBULA_SENSORS : 1;
  const found = world.knowledge.sense(ship.x, ship.y, SHIP.sensorRange * k, SHIP.pingRange * k);
  for (const c of found) notify(`Sensors: ${SolarSystem.CONTACT_TYPES[c.type].prompt} identified`, 3);
}

// Put the ship at a world position, at rest.
function placeShip(x, y, angle = -Math.PI / 2) {
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
  lastRegion = undefined; // no enter/leave notice for a teleport
  sense();
  snapWings();
}

// Place the ship beside something in space, on its side facing its system's star. Beside a
// station that orbits a planet, it waits off to one side between the two, so both are in view.
function placeBeside(e) {
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
const startStation = () => world.scene.stations[world.galaxy.startStation];

// Drop the ship short of a contact, facing it.
function dropNearContact(c, dir) {
  placeShip(c.x - Math.cos(dir) * (c.r + 1300), c.y - Math.sin(dir) * (c.r + 1300), dir);
}

// An ambush whose pirates have all been destroyed no longer stops map travel.
function ambushCleared(c) {
  const pack = world.galaxy.packs[c.pack];
  return !!pack && pack.ships.every((s) => cargo.removed.has(s.key));
}

// ---------- Introduction: the escape pod, talked in to the waystation ----------
//
// A new game opens on an escape pod near the waystation (world/galaxy.js), with the station's android
// on the comms (ui/comms.js) running the script in story/intro.js: its answers set the art style and the
// movement mode (the combat mode comes with the first mission's launch). Mid-way the pod is the player's to fly, until it's in reach of the station's
// tractor beam, which brings it in to dock as the station finishes talking. Then the player has
// the usual ship again. ?skipintro (or the Skip button) goes straight to the docked station.
// It opens on the pod drifting in toward the station (a tap skips that), before anyone speaks.
// While it runs there is no map, no settings, no HUD, no selecting things, no squad and no pirates.

// The pod: slow and gentle, so the first flight is short and easy to steer.
const POD = { name: 'Escape pod', radius: 15, maxSpeed: 170, accel: 120, turnRate: 2.4, cargo: 0 };
// start: how far from the station's edge the pod drifts; range: where the tractor beam takes it
// (from the station's edge); hold: where the beam holds it, docked; speed: how fast it pulls.
// zoom: the view is this much wider throughout, so the station and the pod are both on screen.
const TRACTOR = { start: 560, range: 260, hold: 90, speed: 150, zoom: 0.65 };
// The opening shot: the pod drifts in this far toward its starting spot over this many seconds,
// slowing as it comes, before the station first speaks. A tap cuts it short. The view starts close
// on the pod (zoom: view.k), holds there for the first `hold` of the time, then pulls back to the
// introduction's wide view, bringing the station in.
const ARRIVE = { dist: 700, time: 5, zoom: 3, hold: 0.2 };
const INTRO_FROM = Intro.STATION;
const APPROACH_HINT = {
  cruise: 'Drag anywhere to set a heading: the further you drag, the faster you go. The pod keeps drifting when you let go; tap empty space to stop.',
  direct: 'Drag anywhere to steer: the further you drag, the faster you go. Let go and the pod stops.',
};

function introDue() {
  return !cargo.story.has('intro') && world.galaxy.waystation >= 0 && !Params.has('skipintro');
}

// A portrait (art/portraits.js) in an art style (the current one by default), filling a square:
// a face(ctx, size) drawer for the comms box and the station screen.
function faceOf(portrait, style) {
  return (c, size) => {
    c.fillStyle = COLORS.bg;
    c.fillRect(0, 0, size, size);
    c.translate(size / 2, size / 2);
    c.scale(size / 100, size / 100);
    ArtPortraits.draw(c, portrait, style || artStyle.value, { texel: 2 });
  };
}
// The station android's portrait.
const introFace = (style) => faceOf(intro.face, style);
const waystation = () => world.scene.stations[world.galaxy.waystation] || null;

function startIntro() {
  const st = waystation();
  Object.assign(intro, { on: true, station: st, flying: false, beam: null });
  intro.face = world.wayFace;
  intro.run = Intro.create(introAnswer);
  Object.assign(SHIP, POD);
  ship.art = HULL_ART.pod();
  // It ends up adrift below the station (on screen: above the comms box), turned a little away
  // from it; first it drifts in from further out, nose first, coming to rest there.
  const a = Math.PI / 2 - 0.25, d = st.radius + TRACTOR.start;
  const to = { x: st.x + Math.cos(a) * d, y: st.y + Math.sin(a) * d };
  const from = { x: st.x + Math.cos(a) * (d + ARRIVE.dist), y: st.y + Math.sin(a) * (d + ARRIVE.dist) };
  intro.arrive = { t: 0, from, to, a0: a + Math.PI, a1: a + Math.PI + 0.9 };
  placeShip(from.x, from.y, intro.arrive.a0); // the camera on the pod
  view.k = ARRIVE.zoom;
  view.zoom = view.base * view.k;
  fight.grace = Infinity;
  setMode('intro', true);
  Comms.onSkip = skipIntro;
  Comms.hide(); // nothing is said until the pod has drifted in
}

// The opening drift: in along a straight line, slowing to a stop (ease-out), and turning a little
// away from the station as it settles. Then the station speaks.
function tickArrive(dt) {
  const A = intro.arrive;
  A.t = Math.min(ARRIVE.time, A.t + dt);
  const u = A.t / ARRIVE.time, k = 1 - (1 - u) ** 2, speed = (2 * (1 - u) * ARRIVE.dist) / ARRIVE.time;
  const dir = Math.atan2(A.to.y - A.from.y, A.to.x - A.from.x);
  ship.x = lerp(A.from.x, A.to.x, k);
  ship.y = lerp(A.from.y, A.to.y, k);
  ship.vx = Math.cos(dir) * speed;
  ship.vy = Math.sin(dir) * speed;
  ship.angle = ship.targetAngle = A.a0 + (A.a1 - A.a0) * (u * u * (3 - 2 * u));
  ship.thrust = 0;
  if (u >= 1) endArrive();
}
// The opening shot's camera: close on the pod, then (after the hold) pulling back and over to the
// point between the pod and the station, zooming out to the introduction's view as it goes.
function arriveView() {
  const u = intro.arrive.t / ARRIVE.time, st = intro.station;
  const v = clamp((u - ARRIVE.hold) / (1 - ARRIVE.hold), 0, 1), w = v * v * (3 - 2 * v);
  view.k = Math.exp(lerp(Math.log(ARRIVE.zoom), Math.log(TRACTOR.zoom), w));
  view.zoom = view.base * view.k;
  cam.x = lerp(ship.x, (ship.x + st.x) / 2, w);
  cam.y = lerp(ship.y, (ship.y + st.y) / 2, w);
}
function endArrive() {
  const A = intro.arrive;
  intro.arrive = null;
  placeShip(A.to.x, A.to.y, A.a1);
  showIntroStep();
}

function introAnswer(setting, value) {
  if (setting === 'style') artStyle.set(value);
  else if (setting === 'move') moveMode.set(value);
}

// The comms box for the script's current step: a line or a question, the flying hint, or
// nothing while the beam brings the pod in.
function showIntroStep() {
  const step = intro.run.step;
  if (!step || step.wait === 'docked') { Comms.hide(); return; }
  if (step.wait === 'approach') {
    intro.flying = true;
    Comms.hint({ from: 'Pod controls', text: APPROACH_HINT[moveMode.value] });
    return;
  }
  Comms.show({
    from: INTRO_FROM, text: step.say, face: intro.run.portrait ? introFace() : null,
    choices: step.ask ? step.options.map((o) => ({ label: o.label, face: step.portraits ? introFace(o.value) : null })) : null,
    onNext: () => { intro.run.next(); showIntroStep(); },
    onChoose: (i) => { intro.run.choose(i); showIntroStep(); },
  });
}

// Each frame: into the beam's reach, the beam takes over; once it has the pod in and the station
// has had its say, the pod docks.
function tickIntro(dt) {
  if (!intro.on) return;
  const st = intro.station;
  if (intro.flying && gapTo(st) <= TRACTOR.range) {
    intro.flying = false;
    intro.beam = { t: 0, in: false };
    ship.targetSpeed = 0;
    intro.run.signal('approach');
    showIntroStep();
  }
  if (intro.beam && intro.beam.in && intro.run.step && intro.run.step.wait === 'docked') {
    intro.run.signal('docked');
    endIntro({ played: true });
    dock(st);
  }
}

// The beam pulls the pod to its berth beside the station and turns it to face in; the pod's own
// engine is off.
function tickBeam(dt) {
  const st = intro.station, b = intro.beam;
  b.t += dt;
  const a = Math.atan2(ship.y - st.y, ship.x - st.x), hold = st.radius + TRACTOR.hold;
  const tx = st.x + Math.cos(a) * hold, ty = st.y + Math.sin(a) * hold;
  const d = Math.hypot(tx - ship.x, ty - ship.y);
  const speed = Math.min(TRACTOR.speed * Math.min(1, b.t / 1.5), d * 2 + 20);
  if (d > 1) {
    ship.vx = ((tx - ship.x) / d) * speed;
    ship.vy = ((ty - ship.y) / d) * speed;
  } else ship.vx = ship.vy = 0;
  ship.x += ship.vx * dt;
  ship.y += ship.vy * dt;
  ship.angle = ship.targetAngle = turnToward(ship.angle, a + Math.PI, 1.2 * dt);
  ship.thrust = 0;
  b.in = d < 10;
}

// The beam: a pale cone from the station to the pod, with bands of light running down it.
function drawTractorBeam(t) {
  const b = intro.beam;
  if (!b) return;
  const st = intro.station, color = st.color;
  const x0 = rx(st.x), y0 = ry(st.y), x1 = rx(ship.x), y1 = ry(ship.y);
  const a = Math.atan2(y1 - y0, x1 - x0), len = Math.hypot(x1 - x0, y1 - y0);
  const fade = Math.min(1, b.t / 0.6);
  ctx.save();
  ctx.translate(x0, y0);
  ctx.rotate(a);
  ctx.globalAlpha = 0.2 * fade;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(st.radius * 0.6, -st.radius * 0.35);
  ctx.lineTo(len + 16, -15);
  ctx.lineTo(len + 16, 15);
  ctx.lineTo(st.radius * 0.6, st.radius * 0.35);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  for (let k = 0; k < 4; k++) {
    const u = ((t * 0.5 + k / 4) % 1), x = lerp(len + 16, st.radius * 0.6, u), w = lerp(15, st.radius * 0.35, u);
    ctx.globalAlpha = 0.5 * fade * Math.sin(u * Math.PI);
    ctx.beginPath();
    ctx.moveTo(x, -w);
    ctx.lineTo(x, w);
    ctx.stroke();
  }
  ctx.restore();
}

// Out of the introduction: the usual ship (and squad, and pirates) back. played: it ran to the
// end (or was skipped), so it won't run again in this galaxy.
function endIntro({ played }) {
  Object.assign(intro, { on: false, run: null, flying: false, beam: null, arrive: null });
  Comms.onSkip = null;
  Comms.hide();
  setMode('intro', false);
  fight.grace = 0;
  applyShip();
  cargo.hull = SHIP.hull;
  if (played) {
    cargo.story.add('intro');
    saveCargo();
  }
}

// Skip: straight to docked at the waystation, with the settings as they are.
function skipIntro() {
  const st = intro.station;
  endIntro({ played: true });
  placeBeside(st);
  dock(st);
}

// ---------- The opening missions: payment in kind, then the remaining balance ----------
//
// After the introduction the player is docked at the waystation with an escape pod and a debt.
// Until the first mission (story/missions.js) is handed in, every station screen offers only the
// Missions tab, and Launch waits for the mission to be accepted. Accepting provides a Courier with
// two salvaged pulse lasers. In a small asteroid field near the waystation (Missions.site) two
// pirates circle a captured android ship, with the coolant regulator it was sent for drifting
// beside it. Once the pirates are gone the android calls on the comms and follows the player home
// like a wingman; docking with it at the waystation and handing the mission in there settles the
// debt, and the android joins the squad. Progress is read every frame from what has happened
// (destroyed pirates and the collected regulator are in cargo.removed), so a save can't fall out
// of step with it. ?skipintro skips the missions as well: done, with the android in the squad.
//
// The second mission (Missions.salvageSite) is offered on handing in the first: mine three
// asteroids (the first mission's field has plenty) and collect three gas pockets in the nebula
// nearest the waystation, counted as they're done (missionCollected). After the third pocket the
// squad member picks up an android signal deeper in the nebula; there a hostile android fighter
// attacks. Destroyed, it leaves an AI logic module; the squad member is puzzled and asks to bring
// it home. Docking at the waystation with it makes the mission ready; handing it in settles the
// debt and opens the station screens.

// site: Missions.site(); rocks, pirates, android, cargo: its things in space; face: the android's
// portrait; vars: the names its lines use; hailT: seconds the android has waited to call; told:
// the waystation has said where to go (this session).
// salvage: Missions.salvageSite(), with hostile and module: its things in space; callT: seconds
// the squad member has waited to call; told: the mission ids the waystation has seen off.
const mission = {
  site: null, rocks: [], pirates: [], android: null, cargo: null, face: null, vars: {}, hailT: 0, told: new Set(),
  salvage: null, hostile: null, module: null, callT: 0,
  gate: null, waves: [], work: 0, said: new Set(), waveT: 0,
};
// A conversation on the comms box: lines from someone, one after another, then `then`. A line may
// be a question (story/missions.js) whose answer sets a setting.
const talk = { lines: null, i: 0, from: '', face: null, then: null };
const MISSION_LOCKED = ['trade', 'ship', 'research', 'squad'];
const SIGNAL_REACHED = 2200; // the android signal counts as investigated this close
const HAIL = { range: 4000, wait: 1.2 }; // the android calls within this range, this long after the fight
const FIELD_REACHED = 1500; // the field counts as reached this far beyond its spread

function buildMission() {
  const site = Missions.site(world.galaxy);
  Object.assign(mission, {
    site, rocks: [], pirates: [], android: null, cargo: null, face: null, vars: {}, hailT: 0, told: new Set(), salvage: null, hostile: null, module: null, callT: 0,
    gate: null, waves: [], work: 0, said: new Set(), waveT: 0,
  });
  if (!site) return;
  mission.rocks = site.rocks.map((a) => ({ kind: 'asteroid', ast: { type: a.type, r: a.r, seed: a.seed }, key: a.key, spin0: a.spin0, tumble: a.tumble, radius: a.r, x: a.x, y: a.y }));
  mission.pirates = site.pirates.map((p) => {
    const art = ArtBlueprints.create('fighter', world.cultures.pirates, p.seed);
    return {
      kind: 'ship', role: 'fighter', pirate: true, key: p.key, art, radius: art.radius, x: site.x, y: site.y, tier: site.tier,
      motion: { type: 'orbit', cx: site.x, cy: site.y, r: p.orbit, w: p.speed / p.orbit, a0: p.a0 },
    };
  });
  const a = site.android, art = ArtBlueprints.create('fighter', world.android, a.seed), name = Squad.designation(a.seed);
  mission.android = {
    kind: 'ship', android: true, key: a.key, art, name, note: '', color: world.android.color, stats: Squad.stats(Squad.member(a.seed)),
    radius: art.radius, x: site.x, y: site.y, vx: 0, vy: 0, angle: a.angle, a: a.angle, thrust: 0,
  };
  const c = site.cargo;
  mission.cargo = { ...Entities.item({ key: c.key, kind: c.kind, seed: c.seed, angle: a.angle, tumble: 0.2, x: c.x, y: c.y }), label: 'Coolant regulator', mission: OPENING };
  mission.face = ArtAndroids.create(a.seed, world.android);
  mission.vars = { ship: name, station: world.galaxy.stations[world.galaxy.waystation].name };
  buildSalvage();
  buildGate();
}

// The third mission's pirates, in their waves, circling where they arrive until the fight.
function buildGate() {
  const G = Missions.gateSite(world.galaxy);
  mission.gate = G;
  if (!G) return;
  mission.waves = G.waves.map((wave) => wave.map((p) => {
    const art = ArtBlueprints.create('fighter', world.cultures.pirates, p.seed);
    return {
      kind: 'ship', role: 'fighter', pirate: true, key: p.key, art, radius: art.radius, x: p.cx, y: p.cy, tier: G.tier,
      motion: { type: 'orbit', cx: p.cx, cy: p.cy, r: p.orbit, w: p.speed / p.orbit, a0: p.a0 },
    };
  }));
  mission.vars.next = world.galaxy.systems[world.galaxy.gates[G.gate].to].name;
}

// The second mission's hostile android (a pirate, as far as fights go, in android colours) and
// the AI logic module it leaves.
function buildSalvage() {
  const S = Missions.salvageSite(world.galaxy, mission.site);
  mission.salvage = S;
  if (!S) return;
  const h = S.hostile, art = ArtBlueprints.create('fighter', world.android, h.seed), name = Squad.designation(h.seed);
  mission.hostile = {
    kind: 'ship', role: 'fighter', pirate: true, android: true, key: h.key, art, name, color: world.android.color,
    radius: art.radius, x: S.x, y: S.y, tier: S.tier,
    motion: { type: 'orbit', cx: S.x, cy: S.y, r: h.orbit, w: h.speed / h.orbit, a0: h.a0 },
  };
  const m = S.module;
  mission.module = { ...Entities.item({ key: m.key, kind: m.kind, seed: m.seed, angle: 0, tumble: 0.25, x: m.x, y: m.y }), label: 'AI logic module', mission: SALVAGE };
  Object.assign(mission.vars, { nebula: world.galaxy.nebulae[S.nebula].name, hostile: name });
}

const fillIn = (text) => Missions.fill(text, mission.vars);
const missionActive = () => !!mission.site && cargo.missions.status(OPENING) === 'active';
const objectiveDone = (o) => cargo.missions.done(OPENING, o);
const salvageActive = () => !!mission.salvage && cargo.missions.status(SALVAGE) === 'active';
const salvageDone = (o) => cargo.missions.done(SALVAGE, o);
const gateActive = () => !!mission.gate && cargo.missions.status(GATE_JOB) === 'active';
const gateDone = (o) => cargo.missions.done(GATE_JOB, o);
// The gate mission's waves that have arrived: the first once the work is under way, the second
// once the first is gone and its fight is over (and a moment has passed).
function wavesIn() {
  if (!gateActive() || !gateDone('ambush')) return [];
  const gone = (wave) => wave.every((e) => cargo.removed.has(e.key));
  return mission.waves.filter((wave, i) => i === 0 || (gone(mission.waves[i - 1]) && (mission.waveT >= GATE_WORK.pause || mission.waves[i].some((e) => fight.ships.has(e.key)))));
}
// The squad member is at the gate working on its blocks: there, the work under way, the ship
// close by, nothing else going on.
function gateWorking() {
  const m = firstMember(), G = mission.gate;
  return gateActive() && gateDone('reach') && !gateDone('work') && !!m && !m.disabled && !inFight()
    && Math.hypot(ship.x - G.x, ship.y - G.y) < Missions.GATE.range;
}
// The squad member the first mission brought (its portrait and name are mission.face and .vars.ship).
const firstMember = () => (mission.site ? cargo.squad.find((m) => m.seed === mission.site.android.seed) : null);
// The android follows the ship home once it has called, until it docks with it.
const escorting = () => missionActive() && objectiveDone('hail') && !objectiveDone('escort');

// What's in space for the opening missions now, near the camera: the first mission's field
// always; while the first is under way its pirates, the regulator and the android (until it
// docks); while the second is, once the signal is found, the hostile android, then its module.
function missionThings() {
  const site = mission.site;
  if (!site) return [];
  const near = Math.hypot(site.x - cam.x, site.y - cam.y) < NEAR + site.spread;
  const out = near ? [...mission.rocks] : [];
  if (missionActive()) {
    if (near) out.push(...mission.pirates, mission.cargo);
    if (!objectiveDone('escort') && (near || escorting())) out.push(mission.android);
  }
  // The hostile android once the signal is found, then the module it leaves.
  const S = mission.salvage;
  if (S && salvageActive() && salvageDone('signal') && Math.hypot(S.x - cam.x, S.y - cam.y) < NEAR + 1000) {
    out.push(mission.hostile);
    if (cargo.removed.has(S.hostile.key)) out.push(mission.module);
  }
  // The pirates at the gate, once their wave has come.
  if (gateActive()) out.push(...wavesIn().flat());
  return out;
}

// Lines on the comms box while flight goes on: each waits for a tap, then the next.
function say(lines, { from, face = null, then = null }) {
  Object.assign(talk, { lines, i: 0, from, face, then });
  setMode('talking', true);
  showTalk();
}
function showTalk() {
  if (!talk.lines) return;
  if (talk.i >= talk.lines.length) { endTalk(); return; }
  const line = talk.lines[talk.i];
  if (typeof line === 'string') {
    Comms.show({ from: talk.from, text: line, face: talk.face, onNext: () => { talk.i++; showTalk(); } });
    return;
  }
  Comms.show({
    from: talk.from, text: line.text, face: talk.face, choices: line.options.map((o) => ({ label: o.label })),
    onChoose: (k) => {
      const o = line.options[k];
      if (line.ask === 'combat') combatMode.set(o.value);
      talk.lines = [...talk.lines.slice(0, talk.i + 1), ...(o.reply ? [o.reply] : []), ...talk.lines.slice(talk.i + 1)];
      talk.i++;
      showTalk();
    },
  });
}
// The conversation over (or cut short by docking): its `then` still happens, unless it's
// dropped (another galaxy loading).
function endTalk(keep = true) {
  if (!talk.lines) return;
  const then = keep ? talk.then : null;
  Object.assign(talk, { lines: null, i: 0, then: null });
  setMode('talking', false);
  Comms.hide();
  if (then) then();
}

// The objectives, from what has happened; the android calls once the pirates are gone and the
// fight is over.
function tickMission(dt) {
  tickSalvage(dt);
  tickGate(dt);
  if (!missionActive() || intro.on) return;
  const log = cargo.missions, site = mission.site, w = mission.android;
  let changed = false;
  if (!objectiveDone('field') && Math.hypot(ship.x - site.x, ship.y - site.y) < site.spread + FIELD_REACHED) {
    changed = log.set(OPENING, 'field', 1);
    notify(`${mission.vars.ship} found · pirates guarding it`, 3);
  }
  changed = log.set(OPENING, 'pirates', site.pirates.filter((p) => cargo.removed.has(p.key)).length) || changed;
  if (cargo.removed.has(site.cargo.key)) changed = log.set(OPENING, 'regulator', 1) || changed;
  const calm = !inFight() && !fight.result && !talk.lines && !Comms.isOpen && !docked;
  if (objectiveDone('pirates') && !objectiveDone('hail') && calm && Math.hypot(ship.x - w.x, ship.y - w.y) < HAIL.range) {
    mission.hailT += dt;
    if (mission.hailT >= HAIL.wait) hail();
  } else mission.hailT = 0;
  w.note = escorting() ? 'Android · following you home' : objectiveDone('pirates') ? 'Android · free' : 'Android · held by pirates';
  if (changed) saveCargo();
}

function hail() {
  mission.hailT = 0;
  const lines = Missions.lines(Missions.LIST[OPENING].hail, cargo.missions, OPENING).map(fillIn);
  say(lines, {
    from: mission.vars.ship, face: faceOf(mission.face),
    then: () => { if (cargo.missions.set(OPENING, 'hail', 1)) { snapEscortIfFar(); saveCargo(); } },
  });
}
// The second mission's objectives, from what has happened: the signal reached, the hostile
// android destroyed, its module collected (mining and gas are counted as they happen:
// missionCollected). The squad member calls about the signal after the third pocket, and again
// once the hostile android is gone, each time when nothing else is going on.
function tickSalvage(dt) {
  if (!salvageActive() || intro.on) return;
  const log = cargo.missions, S = mission.salvage;
  let changed = false;
  const calm = !inFight() && !fight.result && !talk.lines && !Comms.isOpen && !docked;
  const call = (o, lines) => {
    if (!calm || !log.open(SALVAGE, o) || salvageDone(o)) return false;
    mission.callT += dt;
    if (mission.callT < HAIL.wait) return true;
    mission.callT = 0;
    say(Missions.lines(lines, log, SALVAGE).map(fillIn), {
      from: mission.vars.ship, face: firstMember() ? faceOf(mission.face) : null,
      then: () => { if (log.set(SALVAGE, o, 1)) saveCargo(); },
    });
    return true;
  };
  const def = Missions.LIST[SALVAGE];
  if (!call('signal', def.signal) && !call('puzzle', def.puzzle)) mission.callT = 0;
  if (salvageDone('signal') && !salvageDone('investigate') && Math.hypot(ship.x - S.x, ship.y - S.y) < SIGNAL_REACHED) {
    changed = log.set(SALVAGE, 'investigate', 1);
    notify(`Android vessel ${mission.vars.hostile} · weapons hot`, 3);
  }
  if (cargo.removed.has(S.hostile.key)) changed = log.set(SALVAGE, 'hostile', 1) || changed;
  if (cargo.removed.has(S.module.key)) changed = log.set(SALVAGE, 'module', 1) || changed;
  if (changed) saveCargo();
}

// The third mission: reaching the gate, the squad member's work on the blocks (paused while
// fighting or with the ship too far off), the pirates (the first when the work is a third done,
// the next two when that fight is over), and the squad member's report once both are through.
// The work is saved in whole percent (mission.work keeps the fraction this session).
const GATE_WORK = { seconds: 30, reach: 1600, pause: 2.5 };
function tickGate(dt) {
  if (!gateActive() || intro.on) return;
  const log = cargo.missions, G = mission.gate, m = firstMember();
  let changed = false;
  const calm = !inFight() && !fight.result && !talk.lines && !Comms.isOpen && !docked;
  const tell = (key, lines, then) => {
    if (!calm || mission.said.has(key)) return;
    mission.said.add(key);
    say(Missions.lines(lines, log, GATE_JOB).map(fillIn), { from: mission.vars.ship, face: m ? faceOf(mission.face) : null, then });
  };
  if (!gateDone('reach') && Math.hypot(ship.x - G.x, ship.y - G.y) < GATE_WORK.reach) {
    changed = log.set(GATE_JOB, 'reach', 1);
    mission.work = log.count(GATE_JOB, 'work');
  }
  if (gateDone('reach') && !gateDone('work')) tell('arrive', Missions.LIST[GATE_JOB].arrive);
  if (gateWorking() && !talk.lines) {
    mission.work = Math.max(mission.work, log.count(GATE_JOB, 'work')) + (dt * 100) / GATE_WORK.seconds;
    // Each wave stops the work until it's dealt with.
    const cap = gateDone('ambush') && !gateDone('pirates') ? 99 : 100;
    mission.work = Math.min(cap, mission.work);
    // Progress is kept every percent but saved every tenth: it's redone from the last save at worst.
    const saved = log.count(GATE_JOB, 'work');
    if (log.set(GATE_JOB, 'work', Math.floor(mission.work)) && Math.floor(mission.work / 10) !== Math.floor(saved / 10)) changed = true;
    if (!gateDone('ambush') && mission.work >= Missions.GATE.workAt) {
      changed = log.set(GATE_JOB, 'ambush', 1) || changed;
      notify('Contacts incoming · pirates', 2.5);
    }
  } else if (gateActive() && gateDone('reach') && !gateDone('work') && m && m.disabled) {
    notify(`${m.name} disabled · it needs repairs at a station`, 2.5, { once: true });
  }
  // The pirates: counted as they go; the next wave after a pause; each fight started as it comes.
  const waves = mission.waves.flat();
  changed = log.set(GATE_JOB, 'pirates', waves.filter((e) => cargo.removed.has(e.key)).length) || changed;
  mission.waveT = mission.waves[0].every((e) => cargo.removed.has(e.key)) && !inFight() && !fight.result ? mission.waveT + dt : mission.waveT;
  const due = wavesIn().flat().find((e) => !cargo.removed.has(e.key));
  if (due && !inFight() && fight.grace <= 0 && !docked) {
    const e = frameList.find((x) => x.key === due.key);
    if (e) engage(e, true);
  }
  if (gateDone('work') && gateDone('pirates') && !gateDone('unlocked')) {
    tell('unlocked', Missions.LIST[GATE_JOB].unlocked, () => { if (log.set(GATE_JOB, 'unlocked', 1)) saveCargo(); });
  }
  if (changed) saveCargo();
}

// The squad member's place while it works: beside the gate, facing it.
function workSpot(w) {
  if (!gateWorking() || !w.member || w.member !== firstMember()) return null;
  const G = mission.gate;
  return { x: G.work.x, y: G.work.y, face: Math.atan2(G.y - G.work.y, G.x - G.work.x) };
}

// Its cutting beam on the gate while it works: the mining beam's look, in the android colour.
function drawGateWork(t) {
  const w = firstMember() && wings.get(firstMember().id);
  if (!w || !workSpot(w) || Math.hypot(w.x - mission.gate.work.x, w.y - mission.gate.work.y) > 60) return;
  const G = mission.gate, gate = world.scene.gates[G.gate], ang = Math.atan2(G.y - w.y, G.x - w.x);
  const x0 = rx(w.x) + Math.cos(ang) * w.radius * 0.7, y0 = ry(w.y) + Math.sin(ang) * w.radius * 0.7;
  const reach = Math.hypot(G.x - w.x, G.y - w.y) - gate.radius * 0.35, wob = Math.sin(t * 2.3) * gate.radius * 0.25;
  const x1 = rx(w.x) + Math.cos(ang) * reach - Math.sin(ang) * wob, y1 = ry(w.y) + Math.sin(ang) * reach + Math.cos(ang) * wob;
  const flicker = 0.75 + 0.25 * Math.sin(t * 53);
  ctx.save();
  ctx.strokeStyle = w.color;
  ctx.lineCap = 'round';
  ctx.globalAlpha = 0.25 * flicker;
  ctx.lineWidth = 7 / view.zoom;
  ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
  ctx.globalAlpha = 0.9 * flicker;
  ctx.lineWidth = 2 / view.zoom;
  ctx.stroke();
  ctx.fillStyle = COLORS.flash;
  ctx.beginPath(); ctx.arc(x1, y1, (3 + 2 * flicker) / view.zoom, 0, TAU); ctx.fill();
  ctx.restore();
  if (Math.random() < 0.3) burst(G.x - Math.cos(ang) * gate.radius * 0.35 + Math.cos(ang + Math.PI / 2) * wob, G.y - Math.sin(ang) * gate.radius * 0.35 + Math.sin(ang + Math.PI / 2) * wob, 1, { speed: [30, 90], life: [0.3, 0.7], size: [1.5, 2.5], colors: [COLORS.flash, w.color] });
}

// An asteroid mined or a gas pocket collected: counted toward the second mission.
function missionCollected(kind) {
  if (!salvageActive()) return;
  const o = kind === 'gas' ? 'gas' : 'mine';
  if (cargo.missions.set(SALVAGE, o, cargo.missions.count(SALVAGE, o) + 1)) saveCargo();
}

// Starting to follow from wherever it is (only a teleport snaps it into place: snapWings).
function snapEscortIfFar() {
  const w = mission.android, st = Squad.formation(ship, activeSquad().length);
  if (Math.hypot(st.x - w.x, st.y - w.y) > WING_SNAP) Object.assign(w, st, { vx: 0, vy: 0, angle: ship.angle, a: ship.angle });
}

// Docking with the android at the waystation brings it home; with the AI logic module, it brings
// the second mission home (with what the squad member had to say taken as said).
function missionDocked(station) {
  if (talk.lines) endTalk();
  if (escorting() && station.station.waystation && cargo.missions.set(OPENING, 'escort', 1)) saveCargo();
  if (salvageActive() && station.station.waystation && salvageDone('module')) {
    cargo.missions.set(SALVAGE, 'puzzle', 1);
    cargo.missions.set(SALVAGE, 'return', 1);
    saveCargo();
  }
  if (gateActive() && station.station.waystation && gateDone('work') && gateDone('pirates')) {
    cargo.missions.set(GATE_JOB, 'unlocked', 1);
    cargo.missions.set(GATE_JOB, 'return', 1);
    saveCargo();
  }
}

// On the first launch with an opening mission under way, the waystation sees the player off:
// for the first, where to go and calibrating the ship's combat systems (the player picks the
// combat mode); for the others, where to go.
function missionLaunched() {
  const id = missionActive() && !objectiveDone('field') ? OPENING
    : salvageActive() && !cargo.missions.count(SALVAGE, 'mine') && !cargo.missions.count(SALVAGE, 'gas') ? SALVAGE
      : gateActive() && !gateDone('reach') ? GATE_JOB : null;
  if (!id || mission.told.has(id)) return;
  mission.told.add(id);
  const lines = Missions.lines(Missions.LIST[id].launch, cargo.missions, id)
    .map((l) => (typeof l === 'string' ? fillIn(l) : l));
  say(lines, { from: mission.vars.station, face: faceOf(world.wayFace) });
}

// The station screen's view of the missions (ui/station.js). At the waystation: each mission in
// the chain once the one before it is done, until the next is accepted (so a debrief leads to
// the next offer), and the last once done. Elsewhere: whichever is under way.
const MISSION_NOTE = {
  repayment: { active: 'The asteroid field is marked on your map.' },
  salvage: { active: 'The asteroid field and the {nebula} are marked on your map.' },
  gate: { active: 'The jump gate is marked on your map.', offered: 'Optional. Your account is settled either way.' },
};
const inChain = () => CHAIN.filter((id) => (id === OPENING ? mission.site : id === SALVAGE ? mission.salvage : mission.gate));
function missionViews(station) {
  if (!mission.site) return [];
  const log = cargo.missions, here = !!station.station.waystation, chain = inChain();
  const ids = chain.filter((id, i) => {
    const status = log.status(id), next = chain[i + 1];
    if (!here) return status === 'active' || status === 'ready';
    if (i > 0 && log.status(chain[i - 1]) !== 'done') return false;
    return status !== 'done' || !next || log.status(next) === 'offered';
  });
  return ids.map((id) => {
    const def = Missions.LIST[id], status = log.status(id);
    const said = !here ? [] : status === 'done' ? def.debrief : status === 'ready' ? def.report : def.briefing;
    const note = !here ? null : status === 'done' ? def.joined : (MISSION_NOTE[id] || {})[status];
    return {
      id, title: def.title, from: mission.vars.station, face: here ? faceOf(world.wayFace) : null, status, here,
      lines: Missions.lines(said, log, id).map(fillIn),
      objectives: log.objectives(id).map((o) => ({ ...o, label: fillIn(o.label) })),
      provided: status !== 'done' ? def.provided : null,
      reward: fillIn(def.reward),
      note: note ? fillIn(note) : null,
      accept: () => acceptMission(id), complete: () => completeMission(id),
    };
  });
}

// Accepting: for the first mission, the waystation provides the ship.
function acceptMission(id = OPENING) {
  if (!cargo.missions.accept(id)) return;
  const gives = Missions.LIST[id].provides;
  if (gives && gives.loadout) {
    cargo.loadout = validLoadout(gives.loadout) || cargo.loadout;
    applyShip();
    cargo.hull = SHIP.hull;
  }
  saveCargo();
}
// Handing in: the first brings the android into the squad; the second settles the debt (the AI
// logic module stays with the station; it was never in the hold); the third installs the squad
// member's first combat logic module and brings the gates online.
const FIRST_MODULE = 'assist-leader';
function completeMission(id = OPENING) {
  if (!cargo.missions.complete(id)) return;
  if (id === OPENING) joinAndroid();
  if (id === GATE_JOB) {
    const m = firstMember();
    if (m && !m.modules.includes(FIRST_MODULE)) Squad.install(m, FIRST_MODULE, Math.max(0, m.modules.indexOf(null)));
    cargo.story.add('gates');
    showGates();
  }
  saveCargo();
}
function joinAndroid() {
  const seed = mission.site.android.seed;
  // It joins with empty logic slots: its first modules are for a later mission.
  if (!cargo.squad.some((m) => m.seed === seed)) cargo.squad.push(Squad.member(seed));
  buildWings();
}
// ?skipintro: the introduction and the opening missions as if played.
function skipOpening() {
  cargo.story.add('intro');
  cargo.missions.finish(OPENING);
  cargo.missions.finish(SALVAGE);
  if (mission.site) joinAndroid();
  saveCargo();
}

// What the station screen can't do yet: until the debt is settled only Missions, and Squad
// once the first mission has brought a squad member; no Launch while the next opening mission
// waits to be accepted.
function stationLocks() {
  if (!opening()) return { tabs: [], reason: '', launch: null };
  const first = cargo.missions.status(OPENING) !== 'done', next = first ? OPENING : SALVAGE;
  return {
    tabs: first ? MISSION_LOCKED : MISSION_LOCKED.filter((t) => t !== 'squad'),
    reason: fillIn('Station services are suspended until your account with {station} is settled.'),
    launch: cargo.missions.status(next) === 'offered' ? 'Accept the mission to launch' : null,
  };
}

// Where the mission goes next, for the HUD, an edge marker and the map: { text, x, y, station }
// (station: the scene's station when it's the waystation), or null.
// The second mission's gas objective points at the nearest pocket of its nebula still to collect,
// of those well away from the pirates while any are left.
function objective() {
  if (!mission.site || intro.on) return null;
  const W = waystation(), id = inChain().find((x) => ['active', 'ready'].includes(cargo.missions.status(x)));
  if (!id) return null;
  const status = cargo.missions.status(id);
  if (status === 'ready') return { text: `Report to ${W.name}`, x: W.x, y: W.y, station: W };
  if (status !== 'active') return null;
  const o = cargo.missions.current(id);
  if (!o) return null;
  const text = `${fillIn(o.label)}${o.percent ? ` · ${o.count}%` : o.need > 1 ? ` · ${o.count}/${o.need}` : ''}`;
  if (o.id === 'escort' || o.id === 'return') return { text, x: W.x, y: W.y, station: W };
  if (id === GATE_JOB) return { text, x: mission.gate.x, y: mission.gate.y, station: null };
  if (o.id === 'gas') {
    const left = (keys) => keys.map((k) => world.scene.get(k)).filter((e) => e && !cargo.removed.has(e.key));
    const pool = left(mission.salvage.safe).length ? left(mission.salvage.safe) : left(mission.salvage.pockets);
    const q = pool.sort((a, b) => Math.hypot(a.x - ship.x, a.y - ship.y) - Math.hypot(b.x - ship.x, b.y - ship.y))[0];
    const n = world.galaxy.nebulae[mission.salvage.nebula];
    return q ? { text, x: q.x, y: q.y, station: null } : { text, x: n.x, y: n.y, station: null };
  }
  if (id === SALVAGE && o.id !== 'mine') return { text, x: mission.salvage.x, y: mission.salvage.y, station: null };
  return { text, x: mission.site.x, y: mission.site.y, station: null };
}

// Jump gates offline (gatesOnline): they keep their destination to themselves, and the map
// doesn't show the systems beyond them.
function showGates() {
  for (const g of world.scene.gates) {
    g.offline = !gatesOnline();
    g.name = g.offline ? 'Jump gate' : g.gate.name;
  }
  SystemMap.access = { system: (s) => gatesOnline() || world.knowledge.visited(s.index), gate: () => gatesOnline() };
}

function loadGalaxy(galaxy) {
  if (world.knowledge) world.knowledge.save(); // keep the old galaxy's charts before switching
  world.galaxy = galaxy;
  world.cultures = ArtCulture.forGalaxy(galaxy);
  world.scene = Scene.create(galaxy, world.cultures);
  // What the player knows (fog of war); ?fresh forgets saved charts.
  world.knowledge = Knowledge.create(galaxy, { fresh: Params.has('fresh') });
  world.android = ArtCulture.xeno(galaxy.seed).android; // what squad members are built in
  const way = galaxy.stations[galaxy.waystation];
  world.wayFace = way ? ArtAndroids.create(way.seed, world.cultures.of(way.culture)) : null; // its android
  endTalk(false);
  buildMission();
  loadCargo(galaxy);
  SystemMap.knowledge = world.knowledge;
  world.travel = Travel.create(galaxy, world.knowledge, { pingRange: () => SHIP.pingRange, cleared: ambushCleared });
  SystemMap.trip = world.travel;
  Art.clearCache();
  ArtBodies.clearCache();
  if (intro.on) endIntro({ played: false }); // a new galaxy mid-introduction: start over
  if (!mission.site) cargo.missions.finish(OPENING); // no waystation: no opening missions
  if (!mission.salvage) cargo.missions.finish(SALVAGE); // (or no nebula for the second)
  if (!mission.gate) cargo.missions.finish(GATE_JOB); // (or no gate for the third)
  else if (Params.has('skipintro') && opening()) skipOpening();
  showGates();
  if (introDue()) startIntro();
  else if (opening()) placeBeside(waystation()); // the opening missions start and end there
  else placeBeside(startStation());
  SystemMap.setPlayer(ship.x, ship.y);
}
loadGalaxy(SystemMap.galaxy);
SystemMap.onLoad = loadGalaxy; // re-rolled on the map
// Knowledge and cargo save on a short debounce; write them out when the page is hidden or closed.
// Everything, now: when the page is hidden or closed (a fight's hull damage isn't saved until then
// or the fight's end).
function saveAll() {
  world.knowledge.save();
  saveCargoNow();
}
window.addEventListener('pagehide', saveAll);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') saveAll(); });
SystemMap.onJump = (dest) => arriveAt(dest);

// ---------- Docking: stop near a station, dock, trade, launch ----------

const DOCK = { range: 320, maxSpeed: 150 }; // range: world units beyond the station's radius
let docked = null; // { station } while docked; flight is paused and the station menu is open

// Whether the player may dock at a station. Everyone is welcome for now; reputation
// (refusing a wanted pilot, say) belongs here: return { ok: false, reason: 'Docking refused' }.
function canDock(station) {
  return { ok: true, reason: '' };
}

// Distance from the ship to an object's edge.
const gapTo = (e) => Math.hypot(ship.x - e.x, ship.y - e.y) - e.radius;
const shipSpeed = () => Math.hypot(ship.vx, ship.vy);

// What the player can do with things in space (flight/interactions.js): each action is added next to its
// code below. Its state ({ ok, label, inRange }) is what the context card's button shows; inRange
// is false while the ship has to come closer first.
const actions = Interactions.create({ gap: gapTo, speed: shipSpeed });

function dock(station) {
  if (docked || inFight() || !actions.state('dock', station).ok) return;
  stopMining();
  select(null);
  autopilot.key = null;
  docked = { station };
  // A lost ship is towed back to the last station it docked at.
  cargo.home = { x: station.x, y: station.y, radius: station.radius, name: station.name };
  missionDocked(station);
  repairSquad();
  saveCargo();
  ship.vx = ship.vy = 0;
  ship.targetSpeed = 0;
  ship.thrust = 0;
  drag.active = false;
  particles.length = 0;
  setMode('docked', true);
  StationMenu.open({
    station: { name: station.name, subtitle: Entities.stationSubtitle(station), color: station.color },
    market: Economy.market(world.galaxy.seed, station),
    hold,
    ship: SHIP,
    outfitting,
    lab,
    shipyard: station.market.kind === 'system' && ['capital', 'major'].includes(station.market.type),
    repairs,
    squad: { members: cargo.squad },
    missions: { list: () => missionViews(station) },
    locks: stationLocks,
    tab: opening() ? 'missions' : 'trade', // the opening missions are all there is to do at first
    artStyle: artStyle.value, // item icons; the style can't change while docked
    onLaunch: launch,
  });
}

actions.add({ id: 'dock', kind: 'station', verb: 'Dock', key: 'f', range: () => DOCK.range, maxSpeed: () => DOCK.maxSpeed, allowed: canDock, run: dock });

// Back to space just outside the station, on the side the ship came in from, at rest.
function launch() {
  const st = docked.station;
  docked = null;
  StationMenu.close();
  setMode('docked', false);
  const a = Math.atan2(ship.y - st.y, ship.x - st.x);
  const d = st.radius + 180;
  placeShip(st.x + Math.cos(a) * d, st.y + Math.sin(a) * d, a);
  notify(`Launched from ${st.name}`, 2.5);
  missionLaunched();
}

// ---------- Jump gates: stop by a gate and jump to the system at its other end ----------

const GATE = { range: 260, maxSpeed: 220 }; // range: world units beyond the gate's radius

// Through the gate: out of the linked gate on its side toward that system's star, at rest.
function jump(gate) {
  if (docked || inFight() || !actions.state('jump', gate).ok) return;
  const there = world.scene.gates[gate.gate.link];
  const system = world.galaxy.systems[there.gate.system];
  const a = there.angle + Math.PI; // a gate's angle points out from its star
  select(null);
  placeShip(there.x + Math.cos(a) * (there.radius + 180), there.y + Math.sin(a) * (there.radius + 180), a);
  flash = 0.8;
  notify(`Jumped to the ${system.name} system`, 3);
  SystemMap.setPlayer(ship.x, ship.y);
}

actions.add({
  id: 'jump', kind: 'gate', verb: 'Jump', key: 'j', range: () => GATE.range, maxSpeed: () => GATE.maxSpeed, run: jump,
  allowed: () => (gatesOnline() ? { ok: true, reason: '' } : { ok: false, reason: 'Gate offline' }),
});

// ---------- Squad: android wingmen in formation, run by their logic modules ----------
//
// Squad members (rules/squad.js) fly in formation behind the ship. In a fight they join it as allies
// (combat/combat-core.js): every frame each one's logic modules (rules/logic.js), checked in slot order, decide
// what it does; the first that applies gives its orders, and with none it keeps formation. One
// whose hull is shot down is disabled until the ship next docks, which repairs the whole squad.

const WING_SNAP = 4000; // a wingman this far from its place (after a jump or map travel) is put there
// (Function declarations: buildWings and snapWings run while the galaxy first loads.)
function activeSquad() { return intro.on ? [] : cargo.squad.filter((m) => !m.disabled); }
function memberOf(id) { return cargo.squad.find((m) => m.id === id) || null; }

// The wingmen's ships, from the squad: android art (world.android) and their designations.
function buildWings() {
  wings.clear();
  for (const m of cargo.squad) {
    const art = ArtBlueprints.create(m.hull, world.android, m.seed);
    wings.set(m.id, {
      kind: 'wingman', key: m.id, member: m, art, name: m.name, color: world.android.color, stats: Squad.stats(m),
      radius: art.radius, x: ship.x, y: ship.y, vx: 0, vy: 0, angle: ship.angle, a: ship.angle, thrust: 0,
    });
  }
  snapWings();
}

// The ships flying in formation: the active wingmen, then the android being escorted home in
// the first mission (it isn't in the squad yet, and stays out of fights).
function formationShips() {
  const list = activeSquad().map((m) => wings.get(m.id)).filter(Boolean);
  if (escorting()) list.push(mission.android);
  return list;
}

// Every ship in formation to its place, at rest (after a teleport).
function snapWings() {
  formationShips().forEach((w, i) => Object.assign(w, Squad.formation(ship, i), { vx: 0, vy: 0, angle: ship.angle, a: ship.angle, thrust: 0 }));
}

// Out of a fight the wingmen fly to their places, arriving at the ship's speed. In a round-based
// fight they're held where they are, turning to face their targets; in real time the fight flies
// them. An escorted ship waits out a fight where it is.
function tickWings(dt) {
  if (fight.s) {
    if (fightMode().flying) return;
    for (const a of CombatCore.allies(fight.s)) {
      const w = wings.get(a.id), t = fight.ships.get(a.order.target);
      if (w && t) w.a = w.angle = turnToward(w.angle, Math.atan2(t.y - w.y, t.x - w.x), w.stats.turnRate * dt);
    }
    return;
  }
  const lead = Math.hypot(ship.vx, ship.vy);
  formationShips().forEach((w, i) => {
    // At work on the gate blocks (the third mission), it holds its spot by the gate instead.
    const job = workSpot(w);
    const st = job || Squad.formation(ship, i), d = Math.hypot(st.x - w.x, st.y - w.y);
    if (d > WING_SNAP) { Object.assign(w, st, { vx: ship.vx, vy: ship.vy, angle: ship.angle, a: ship.angle }); return; }
    const there = d < 30, speed = job ? 0 : lead;
    Flight.step(w, w.stats, {
      targetAngle: there ? (job ? job.face : ship.angle) : Math.atan2(st.y - w.y, st.x - w.x),
      targetSpeed: there ? speed : Math.min(w.stats.maxSpeed, speed + d * 1.5), mode: 'cruise',
    }, dt);
    w.a = w.angle;
  });
}

// The active wingmen as a combat mode takes allies.
function allySpecs() {
  return activeSquad().filter((m) => wings.has(m.id)).map((m) => {
    const w = wings.get(m.id);
    return { id: m.id, name: m.name, stats: w.stats, hull: m.hullPoints, body: { x: w.x, y: w.y, vx: w.vx, vy: w.vy, angle: w.angle, radius: w.radius } };
  });
}

// Each ally's orders for this frame, from its logic modules: attack what they name, or keep
// formation.
function orderSquad(s) {
  const m = fightMode(), enemies = CombatCore.alive(s);
  CombatCore.allies(s).forEach((a, i) => {
    const member = memberOf(a.id);
    if (!member) return;
    const ctx = { self: a, leader: s.player, inFight: true, enemies, leaderTarget: s.focus ?? null };
    const { intent } = Logic.decide(Squad.modulesOf(member), ctx);
    m.setOrders(s, a.id, intent.type === 'attack' ? { target: intent.target } : { station: Squad.formation(ship, i) });
  });
}

// After a fight's step: the allies' hull into their members (saved when the fight ends, like the
// player's) and, in real time, where they flew.
function syncAllies(s) {
  for (const a of s.allies) {
    const member = memberOf(a.id), w = wings.get(a.id);
    if (!member) continue;
    member.hullPoints = Math.max(0, a.hull);
    if (fightMode().flying && w && a.hull > 0) Object.assign(w, { x: a.x, y: a.y, vx: a.vx, vy: a.vy, angle: a.angle, a: a.angle, thrust: a.thrust });
  }
}

// A wingman shot down: out of the fight, back with the squad once the ship docks.
function wingDisabled(id) {
  const m = memberOf(id), w = wings.get(id);
  if (!m || m.disabled) return;
  m.disabled = true;
  m.hullPoints = 0;
  if (w) explode(w.x, w.y, w.radius);
  notify(`${m.name} disabled · repaired at the next dock`, 3);
  saveCargo();
}

// Docking repairs the squad and brings back the disabled.
function repairSquad() {
  for (const m of cargo.squad) {
    m.disabled = false;
    m.hullPoints = Squad.stats(m).hull;
  }
}

// ---------- Mining: stop by an asteroid, mine it, collect what it leaves behind ----------
//
// Gas pockets in nebulae are collected the same way (Collect): the same countdown, beam and
// range, a little slower, and they leave gas floating to pick up.

const MINE_COLOR = COLORS.busy;

// Seconds to mine an asteroid or collect a gas pocket: the base time, sped up by the ship computer.
function mineTime(e = mining.target) {
  return Mining.duration(e || { kind: 'asteroid' }) / (SHIP.miningRate || 1);
}
const isGas = (e) => e.kind === 'gas';
const mineVerb = (e) => (isGas(e) ? ['Collect', 'Collecting'] : ['Mine', 'Mining']);

// Called on teleports, docking and when the ship drifts away. Must not touch anything declared
// below: placeShip runs it while the system first loads.
function stopMining(notice) {
  if (!mining.target) return;
  mining.target = null;
  mining.t = 0;
  if (notice) notify(notice);
}

// While mining, the Mine button counts down on the asteroid being mined (with a progress bar),
// and is busy on any other.
function miningBusy(a) {
  if (!mining.target) return null;
  if (mining.target.key !== a.key) return { ok: false, label: `${mineVerb(a)[0]} · busy`, inRange: true };
  return {
    ok: false, busy: true, inRange: true, progress: mining.t / mineTime(),
    label: `${mineVerb(a)[1]} · ${Math.max(1, Math.ceil(mineTime() - mining.t))} sec`,
  };
}

function startMining(a) {
  if (docked || inFight() || !actions.state(isGas(a) ? 'collect' : 'mine', a).ok) return;
  mining.target = a;
  mining.t = 0;
  autopilot.key = null;
  ship.targetSpeed = 0; // all stop, so the ship stays in range
}

actions.add({
  id: 'mine', kind: 'asteroid', verb: 'Mine', key: 'e', range: () => Mining.config.range, maxSpeed: () => Mining.config.maxSpeed,
  busy: miningBusy, run: startMining,
});
actions.add({
  id: 'collect', kind: 'gas', verb: 'Collect', key: 'e', range: () => Mining.config.range, maxSpeed: () => Mining.config.maxSpeed,
  busy: miningBusy, run: startMining,
});

// A burst of debris: n bits flying out from (x, y), or from anywhere within `spread` of it, each
// with a speed, life and size picked in its [min, max] and the colours taken in turn. Rock chips,
// explosions and sparks off a hull.
function burst(x, y, n, { spread = 0, speed, life, size, colors }) {
  const pick = ([lo, hi]) => lo + Math.random() * (hi - lo);
  for (let i = 0; i < n; i++) {
    const ang = Math.random() * TAU, d = spread * Math.random(), sp = pick(speed), l = pick(life);
    debris.push({
      x: x + Math.cos(ang) * d, y: y + Math.sin(ang) * d, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp,
      life: l, max: l, size: pick(size), color: colors[i % colors.length],
    });
  }
}

// Rock chips thrown off an asteroid: a few while mining, a burst when it breaks up. From a gas
// pocket, slow puffs of its gas instead.
function chips(a, n, speed) {
  if (isGas(a)) {
    burst(a.x, a.y, n, { spread: a.radius * 0.7, speed: [speed * 0.1, speed * 0.4], life: [0.8, 2], size: [2, 2 + Math.min(6, a.radius / 10)], colors: [a.color, COLORS.flash] });
    return;
  }
  const colors = (Art.ASTEROIDS[a.ast.type] || Art.ASTEROIDS.stony).c;
  burst(a.x, a.y, n, { spread: a.radius * 0.6, speed: [speed * 0.3, speed], life: [0.5, 1.4], size: [1.5, 1.5 + Math.min(5, a.radius / 8)], colors });
}

function finishMining() {
  const a = mining.target;
  stopMining();
  cargo.removed.add(a.key);
  chips(a, 14 + Math.round(a.radius * 0.6), 120 + a.radius * 3);
  if (isGas(a)) { // the pocket used up: its gas floats free, a canister per unit
    const gas = Mining.gasOf(world.galaxy.seed, a);
    gas.forEach((g, i) => {
      const ang = (i / gas.length) * TAU, d = gas.length > 1 ? 40 : 0;
      cargo.drops.push(dropEntity({ key: `drop:${a.key}:${i}`, kind: g.kind, seed: g.seed, x: a.x + Math.cos(ang) * d, y: a.y + Math.sin(ang) * d }));
    });
    const names = [...new Set(gas.map((g) => Goods.type(g.kind).name))].join(', ');
    notify(`Gas pocket collected · ${gas.length} × ${names}`, 2.5);
    missionCollected('gas');
    saveCargo();
    return;
  }
  missionCollected('mine');
  const found = Mining.yieldOf(world.galaxy.seed, a);
  if (found) {
    const e = dropEntity({ key: `drop:${a.key}`, kind: found.kind, seed: found.seed, x: a.x, y: a.y });
    cargo.drops.push(e);
    notify(`Asteroid broken up · ${e.label} found${rarityNote(e)}`, 2.5);
  } else {
    notify('Asteroid broken up · nothing of value', 2.5);
  }
  saveCargo();
}

// Advance mining; runs with the flight simulation, so the map and docking pause it.
function tickMining(dt) {
  const a = mining.target;
  if (!a) return;
  if (Math.hypot(ship.x - a.x, ship.y - a.y) - a.radius > Mining.config.range + Mining.config.slack) {
    stopMining(`${mineVerb(a)[1]} interrupted`);
    return;
  }
  // Hold station facing the rock, unless the player is steering.
  if (ship.targetSpeed === 0) ship.angle = turnToward(ship.angle, Math.atan2(a.y - ship.y, a.x - ship.x), SHIP.turnRate * dt);
  mining.t += dt;
  if (Math.random() < dt * 12) chips(a, 1, 60);
  if (mining.t >= mineTime()) finishMining();
}

// The mining beam from the ship to the rock, and a ring filling up around it.
function drawMining(t) {
  const a = mining.target;
  if (!a) return;
  const p = Math.min(1, mining.t / mineTime());
  const ang = Math.atan2(a.y - ship.y, a.x - ship.x);
  const x0 = rx(ship.x) + Math.cos(ang) * SHIP.radius * 0.7, y0 = ry(ship.y) + Math.sin(ang) * SHIP.radius * 0.7;
  const wob = Math.sin(t * 37) * a.radius * 0.12;
  const x1 = rx(a.x) - Math.cos(ang) * a.radius * 0.5 - Math.sin(ang) * wob;
  const y1 = ry(a.y) - Math.sin(ang) * a.radius * 0.5 + Math.cos(ang) * wob;
  const flicker = 0.75 + 0.25 * Math.sin(t * 53);
  ctx.save();
  ctx.strokeStyle = MINE_COLOR;
  ctx.lineCap = 'round';
  ctx.globalAlpha = 0.25 * flicker;
  ctx.lineWidth = 7 / view.zoom;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
  ctx.globalAlpha = 0.9 * flicker;
  ctx.lineWidth = 2 / view.zoom;
  ctx.stroke();
  ctx.fillStyle = COLORS.flash;
  ctx.beginPath();
  ctx.arc(x1, y1, (3 + 2 * flicker) / view.zoom, 0, TAU);
  ctx.fill();
  // Progress ring.
  const R = a.radius + 16;
  ctx.lineWidth = 2.5 / view.zoom;
  ctx.globalAlpha = 0.2;
  ctx.beginPath();
  ctx.arc(rx(a.x), ry(a.y), R, 0, TAU);
  ctx.stroke();
  ctx.globalAlpha = 0.9;
  ctx.beginPath();
  ctx.arc(rx(a.x), ry(a.y), R, -Math.PI / 2, -Math.PI / 2 + p * TAU);
  ctx.stroke();
  ctx.restore();
}

// Seconds left, in screen space beside the ring.
function drawMiningCountdown() {
  const a = mining.target;
  if (!a) return;
  const [sx, sy] = worldToScreen(a.x, a.y - a.radius - 16);
  ctx.save();
  ctx.font = Theme.font(13);
  ctx.textAlign = 'center';
  ctx.fillStyle = MINE_COLOR;
  ctx.globalAlpha = 0.95;
  ctx.fillText(`${Math.max(0, mineTime() - mining.t).toFixed(1)}s`, sx, sy - 10);
  ctx.restore();
}

function drawDebris() {
  for (const d of debris) {
    ctx.globalAlpha = Math.min(1, (d.life / d.max) * 1.5);
    ctx.fillStyle = d.color;
    ctx.fillRect(rx(d.x) - d.size / 2, ry(d.y) - d.size / 2, d.size, d.size);
  }
  ctx.globalAlpha = 1;
}

// ---------- Map travel: plot a course on the map, cruise there, maybe get interrupted ----------

// Where a destination is in the flight view: the station or planet itself, or else its point.
function arriveAt(dest) {
  if (dest.kind === 'station') placeBeside(world.scene.stations[dest.id]);
  else if (dest.kind === 'gate') placeBeside(world.scene.gates[dest.id]);
  else if (dest.kind === 'planet') placeBeside(world.scene.entities.find((e) => (e.kind === 'planet' || e.kind === 'moon') && e.name === dest.id));
  else if (dest.kind === 'contact') {
    const c = world.galaxy.contacts.find((x) => x.id === dest.id);
    dropNearContact(c, Math.atan2(c.y - ship.y, c.x - ship.x));
  } else if (dest.kind === 'objective') dropNearContact({ x: dest.x, y: dest.y, r: OBJECTIVE_STOP }, Math.atan2(dest.y - ship.y, dest.x - ship.x));
  else placeShip(dest.x, dest.y, ship.angle);
}
// Map travel to the mission's objective stops this far short of it (plus a contact's margin), out
// of reach of the pirates there.
const OBJECTIVE_STOP = 900;

// Where a finished trip leaves the ship, and what it says.
function finishTrip(ev) {
  if (!ev) return;
  const { dest } = ev;
  let text;
  if (ev.type === 'arrive') {
    if (dest.kind === 'contact') dropNearContact(world.galaxy.contacts.find((c) => c.id === dest.id), ev.dir);
    else if (dest.kind === 'objective') dropNearContact({ x: dest.x, y: dest.y, r: OBJECTIVE_STOP }, ev.dir);
    else if (dest.kind === 'point') placeShip(ev.pos.x, ev.pos.y, ev.dir);
    else arriveAt(dest);
    text = `Arrived at ${dest.name}`;
  } else if (ev.type === 'interdict' || ev.type === 'investigate') {
    dropNearContact(ev.contact, ev.dir);
    text = ev.type === 'interdict' ? 'Interdicted! Hostile contact' : `Investigating the ${SolarSystem.CONTACT_TYPES[ev.contact.type]?.name || 'signal'}`;
  } else {
    placeShip(ev.pos.x, ev.pos.y, ev.dir);
    text = 'Dropped out of cruise';
  }
  notify(text, 3);
  SystemMap.setPlayer(ship.x, ship.y);
  SystemMap.close();
}

SystemMap.hooks = {
  travel(dest) {
    world.travel.start({ x: ship.x, y: ship.y }, dest);
    SystemMap.redraw();
  },
  stop: () => finishTrip(world.travel.stop()),
  fast() { world.travel.toggleFast(); SystemMap.redraw(); },
  investigate: () => finishTrip(world.travel.investigate()),
  ignore() { world.travel.ignore(); SystemMap.redraw(); },
};

// Advance a trip; runs while the map is open. Closing the map drops out of cruise.
function tickTravel(dt) {
  if (!world.travel.active) return;
  if (!SystemMap.isOpen) { finishTrip(world.travel.stop()); return; }
  const ev = world.travel.step(dt);
  const p = world.travel.pos;
  if (p) SystemMap.setPlayer(p.x, p.y);
  if (ev && ev.type !== 'prompt') finishTrip(ev);
  else SystemMap.redraw();
}

// An entity posed for time t: a ship in a fight (or flying back from one) where the fight has it.
function poseAt(e, t) {
  const held = e.kind === 'ship' && (fight.ships.get(e.key) || fight.returning.get(e.key));
  if (held) Object.assign(e, { x: held.x, y: held.y, a: held.a, thrust: held.thrust || 0 }); // fighting, or flying back
  else Scene.pose(e, t);
}

// Everything within NEAR of the camera (flight/scene.js), posed for time t.
function nearbyEntities(t) {
  const out = [];
  for (const e of world.scene.near(cam.x, cam.y, NEAR)) {
    if (cargo.removed.has(e.key)) continue;
    poseAt(e, t);
    out.push(e);
  }
  // The first mission's field and what's in it (or the android following you home).
  for (const e of missionThings()) {
    if (cargo.removed.has(e.key)) continue;
    poseAt(e, t);
    out.push(e);
  }
  // The squad's ships fly with yours.
  if (!intro.on) for (const w of wings.values()) if (!w.member.disabled) out.push(w);
  // Floating items left by mining, combat or a lost ship live outside the generated scene.
  for (const e of cargo.drops) {
    if (Math.abs(e.x - cam.x) > NEAR || Math.abs(e.y - cam.y) > NEAR) continue;
    Scene.pose(e, t);
    out.push(e);
  }
  return out;
}

// ---------- Selection: tap something for its context card ----------

// Tapping a station, asteroid or ship selects it: a bracket marks it in space and the
// context card (ui/context.js) offers what can be done there. Off-screen stations are selected by
// tapping their marker at the screen edge. A tap on empty space clears the
// selection (and, in Cruise mode, stops the ship as before).
const TAP_SLOP = 26; // CSS px of forgiveness around a tap target
const SELECT_COLOR = COLORS.cyan;
const HOSTILE_COLOR = COLORS.hostile;
let selected = null; // { key, e }: the selected entity, found again by key every frame
let frameList = []; // the entities posed last frame, for hit-testing taps

// What each kind of thing is: draw order, labels, the minimap, the context card (flight/entities.js).
const KINDS = Entities.KINDS;

// A stable identity for anything selectable, or null.
const entityKey = (e) => (KINDS[e.kind].selectable && e.key ? `${e.kind}:${e.key}` : null);

// How far from its centre a tap still hits the object (for stations only their core).
const hitRadius = (e) => e.radius * (KINDS[e.kind].hit || 1);

const screenToWorld = (sx, sy) => [(sx - view.w / 2) / view.zoom + cam.x, (sy - view.h / 2) / view.zoom + cam.y];

// The object under a tap. When several overlap, the one whose centre is relatively closest wins,
// so a ship passing in front of a station gets picked over the station.
function pickAt(sx, sy) {
  const marker = navMarkerAt(sx, sy); // off-screen stations, by their edge marker
  if (marker) return marker;
  const [wx, wy] = screenToWorld(sx, sy);
  const slop = TAP_SLOP / view.zoom;
  let best = null, bestScore = Infinity;
  for (const e of frameList) {
    if (!entityKey(e)) continue;
    const reach = hitRadius(e) + slop;
    const score = Math.hypot(wx - e.x, wy - e.y) / reach;
    if (score <= 1 && score < bestScore) { best = e; bestScore = score; }
  }
  return best;
}

function select(e) {
  selected = e ? { key: entityKey(e), e } : null;
  if (!selected) ContextCard.hide();
}
ContextCard.onClose = () => select(null);

const isHostile = (e) => Entities.isHostile(e);
const fmtDist = (d) => `${(Math.max(0, d) / 1000).toFixed(1)}k`;

// An action's button on the context card, from its state.
function primary(id, state) {
  return { id, label: state.label, enabled: state.ok, busy: !!state.busy, progress: state.progress };
}

// Approach: offered while the object is out of reach, and as Cancel while flying there.
function approachActions(e, inRange) {
  if (autopilot.key === entityKey(e)) return [{ id: 'cancel-approach', label: 'Cancel approach', enabled: true }];
  return inRange ? [] : [{ id: 'approach', label: 'Approach', enabled: true }];
}

// What the context card shows for the selected object: what it is (its kind's card) and what can
// be done with it (its actions), plus Approach while it's out of reach. Anything without an
// action (a friendly ship) can always be approached, and ships are followed.
function describe(e) {
  const card = KINDS[e.kind].card(e, world.galaxy);
  const states = actions.of(e).map((a) => [a, actions.state(a, e)]);
  const inRange = states.length > 0 && states.every(([, s]) => s.inRange);
  // A pirate's card says how many would fight with it, so a pack can be told from a lone ship.
  const n = isHostile(e) ? packOf(e).length : 0;
  const pack = n ? ` · ${n === 1 ? 'alone' : `pack of ${n}`}` : '';
  return {
    title: card.title, subtitle: `${card.sub}${pack} · ${fmtDist(gapTo(e))}`, color: card.color, tag: card.tag || '', tone: card.tone || '',
    actions: [...states.map(([a, s]) => primary(a.id, s)), ...approachActions(e, inRange)],
  };
}

ContextCard.onAction = (id) => {
  const e = selected && selected.e;
  if (!e) return;
  if (id === 'approach') approach(e);
  else if (id === 'cancel-approach') { autopilot.key = null; ship.targetSpeed = 0; }
  else if (actions.get(id)) actions.get(id).run(e);
};

// Find the selected and approached objects among this frame's entities, and refresh the card.
// Something that's gone (mined, out of range) drops its selection.
function updateSelection(list) {
  frameList = list;
  if (autopilot.key) {
    autopilot.e = list.find((x) => entityKey(x) === autopilot.key) || null;
    if (!autopilot.e) autopilot.key = null;
  }
  if (!selected) return;
  selected.e = list.find((x) => entityKey(x) === selected.key) || null;
  if (!selected.e) { select(null); return; }
  ContextCard.show(describe(selected.e));
}

// ---------- Approach: fly to an object and stop beside it ----------

// Stop halfway into the reach of the object's action; things that move (ships) are followed at
// their kind's distance.
function approach(e) {
  if (inFight()) return;
  const follow = KINDS[e.kind].follow, a = actions.of(e)[0];
  const reach = follow || (a ? actions.range(a) : 600);
  Object.assign(autopilot, { key: entityKey(e), e, stop: e.radius + reach * 0.5, follow: !!follow });
  stopMining();
}

// Steer toward the target, braking so the ship comes to rest at the stop distance. Any drag
// takes the controls back. Moving targets (ships) are followed until cancelled.
function tickAutopilot() {
  const t = autopilot.e;
  if (!autopilot.key || !t || drag.active) return;
  const dx = t.x - ship.x, dy = t.y - ship.y;
  const left = Math.hypot(dx, dy) - autopilot.stop;
  if (left <= 8) {
    ship.targetSpeed = 0;
    if (!autopilot.follow) autopilot.key = null;
    return;
  }
  ship.targetAngle = Math.atan2(dy, dx);
  const facing = Math.cos(ship.targetAngle - ship.angle);
  const braking = Math.sqrt(2 * SHIP.accel * 0.7 * left);
  ship.targetSpeed = Math.max(40, Math.min(SHIP.maxSpeed, braking)) * (facing > 0.8 ? 1 : 0.35);
}

// Corner brackets around the selected object, and a dashed line to the approach target.
function drawSelection(t) {
  ctx.save();
  if (autopilot.key && autopilot.e) {
    ctx.strokeStyle = SELECT_COLOR;
    ctx.globalAlpha = 0.3;
    ctx.lineWidth = 1.5 / view.zoom;
    ctx.setLineDash([10 / view.zoom, 10 / view.zoom]);
    ctx.beginPath();
    ctx.moveTo(rx(ship.x), ry(ship.y));
    ctx.lineTo(rx(autopilot.e.x), ry(autopilot.e.y));
    ctx.stroke();
    ctx.setLineDash([]);
  }
  const e = selected && selected.e;
  if (e) {
    ctx.strokeStyle = isHostile(e) ? HOSTILE_COLOR : SELECT_COLOR;
    ctx.globalAlpha = 0.7 + 0.25 * Math.sin(t * 4);
    ctx.lineWidth = 2 / view.zoom;
    brackets(rx(e.x), ry(e.y), hitRadius(e), { arm: 22 });
  }
  ctx.restore();
}

// Corner brackets around something `radius` across (selection, a ship in a fight), with arms up
// to `arm` screen px; `open` (0..1) pushes them out (a lock coming on).
function brackets(x, y, radius, { open = 0, arm = 18 } = {}) {
  const R = (radius + 12 / view.zoom) * (1 + open * 0.9), len = Math.min(R * 0.45, arm / view.zoom);
  ctx.beginPath();
  for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    ctx.moveTo(x + sx * R, y + sy * (R - len));
    ctx.lineTo(x + sx * R, y + sy * R);
    ctx.lineTo(x + sx * (R - len), y + sy * R);
  }
  ctx.stroke();
}

// ---------- Combat: against hostile ships, in rounds (combat/combat.js) or real time (combat/combat-realtime.js) ----------

// A fight starts from a hostile ship's Attack button, or when pirates catch the ship within
// their aggro range. Every pirate near the one engaged joins in. The combat panel
// (ui/combat-panel.js) shows the state; tap an enemy, or its row, to target it. The Combat setting
// picks how a fight plays:
// - Rounds: the ships stop where they are and every round their weapons fire on their own. You
//   can focus fire or try to flee.
// - Real time: everyone keeps flying. Your guns fire at the locked target while it's in range and
//   inside their arc (the wedge ahead of the ship); when you stop steering, the ship turns to face
//   its target. Pirates flying into range join in. To flee, outfly them.
// Outcomes:
// - won: destroyed ships stay destroyed and leave loot floating,
// - fled: the pirates leave you alone for a while,
// - lost: the cargo spills where the ship was destroyed, and it's towed back to the last
//   station it docked at (or the capital), with the hull patched up.
// Pirates that survive a real-time fight fly back to their usual paths.
const FLEE_GRACE = 12; // seconds the pirates leave you alone after you get away
const RESPAWN_GRACE = 8;
const SHOT_COLOR = { player: COLORS.cyan, ally: '#5ad8ff', enemy: COLORS.hostile };
const LETTERS = 'ABCDEFGHIJKL'; // tell same-role ships apart, on the panel and above the ships

// Where a combatant is: the player ship, a wingman, or an enemy's pose.
function fighterPos(id) {
  if (id === 'player') return { x: ship.x, y: ship.y, radius: SHIP.radius };
  return fight.ships.get(id) || wings.get(id) || fight.lastShips.get(id) || null;
}
// Effects are attached to a combatant (by id, so they follow it) or to a fixed point.
const fxPos = (v) => (typeof v === 'string' ? fighterPos(v) : v);

// An entity's velocity along its usual path, from where it will be a moment later.
function pathVelocity(e) {
  if (!e.motion) return [0, 0];
  const next = { motion: e.motion };
  Scene.pose(next, simTime + 0.1);
  return [(next.x - e.x) / 0.1, (next.y - e.y) / 0.1];
}

const shipName = (e, i, n) => (e.android && e.name ? e.name : `${Entities.ROLE_LABEL[e.role] || 'Ship'}${n > 1 ? ` ${LETTERS[i] || i + 1}` : ''}`);
const fightLog = (line) => { fight.log = [...fight.log, line].slice(-2); };

// An enemy as the flight view keeps it during a fight: its pose (held facing you, or flown on)
// and what's needed to draw it, loot it and send it home afterwards.
function heldPose(e, name) {
  const a = fightMode().flying ? e.a : Math.atan2(ship.y - e.y, ship.x - e.x);
  return { x: e.x, y: e.y, a, thrust: 0, role: e.role, tier: e.tier || 1, radius: e.radius, name, motion: e.motion };
}

// A ship as a combat mode takes it: its stats and how it is flying right now.
function enemySpec(e, name) {
  const back = fight.returning.get(e.key); // still flying back from an earlier fight
  const [vx, vy] = back ? [back.vx, back.vy] : pathVelocity(e);
  return { id: e.key, name, stats: Loadout.stats(Loadout.npc(e.role, e.tier || 1)), body: { x: e.x, y: e.y, vx, vy, angle: e.a, radius: e.radius } };
}

// The pirates that fight together with this one: it and every pirate within groupRange of it.
// (Not ships destroyed and about to blow up: fight.dying.)
function packOf(target) {
  return [target, ...frameList.filter((e) => isHostile(e) && e !== target && !cargo.removed.has(e.key) && !fight.dying.has(e.key)
    && Math.hypot(e.x - target.x, e.y - target.y) <= CombatCore.config.groupRange)];
}

function engage(target, ambushed = false) {
  if (inFight() || docked || !isHostile(target) || fight.dying.has(target.key)) return;
  if (!ambushed && !actions.state('attack', target).ok) return;
  const group = packOf(target);
  const names = group.map((e, i) => shipName(e, i, group.length));
  const rng = mulberry32((Math.random() * 4294967296) >>> 0);
  fight.mode = combatMode.value;
  const m = fightMode();
  const player = {
    id: 'player', name: `${SHIP.name} (you)`, stats: SHIP, hull: cargo.hull,
    body: { x: ship.x, y: ship.y, vx: ship.vx, vy: ship.vy, angle: ship.angle, radius: SHIP.radius },
  };
  fight.s = m.start(rng, player, group.map((e, i) => enemySpec(e, names[i])), { target: target.key, ambushed, allies: allySpecs() });
  if (!m.flying) ship.targetSpeed = 0;
  fight.ships = new Map(group.map((e, i) => [e.key, heldPose(e, names[i])]));
  for (const e of group) fight.returning.delete(e.key);
  // Who started it: pirates, or (in the second opening mission) a named android.
  const attackers = target.android ? `${target.name} attacks!` : 'Pirates attack!';
  fight.log = [ambushed ? attackers : `You engage the ${names[0]}.`];
  fight.result = null;
  stopMining();
  autopilot.key = null;
  select(null);
  setMode('in-combat', true);
  notify(ambushed ? attackers : 'Combat');
}

// Hostile ships can be attacked; any ship can be approached (and followed).
actions.add({ id: 'attack', kind: 'ship', verb: 'Attack', when: (e) => isHostile(e), range: () => CombatCore.config.engageRange, run: (e) => engage(e) });

// A pirate flying into range joins a fight under way (in modes where ships can join).
function joinFight(e) {
  const s = fight.s;
  if (s.enemies.length === 1 && !/ [A-Z]$/.test(s.enemies[0].name)) { // the first one gets its letter now
    s.enemies[0].name += ' A';
    const p = fight.ships.get(s.enemies[0].id);
    if (p) p.name = s.enemies[0].name;
  }
  const name = shipName(e, s.enemies.length, 2);
  fightMode().join(s, enemySpec(e, name));
  fight.ships.set(e.key, heldPose(e, name));
  fight.returning.delete(e.key);
  fightLog(`${name} joins the fight`);
}

// Pirates attack a ship that comes too close, unless it just got away from them. In a fight that
// others can join (real time), those that come close join it.
function checkAggro(list) {
  if (docked || Settings.isOpen) return;
  const near = (e) => isHostile(e) && !fight.dying.has(e.key) && Math.hypot(e.x - ship.x, e.y - ship.y) - e.radius <= CombatCore.config.aggroRange;
  if (fight.s && fightMode().join) {
    for (const e of list) if (!fight.ships.has(e.key) && near(e)) joinFight(e);
    return;
  }
  if (inFight() || fight.grace > 0) return;
  for (const e of list) {
    if (near(e)) { engage(e, true); return; }
  }
}

// Show a fight's events as its mode's `look` says (combat/combat-core.js): a beam per shot (a miss streaks
// past), a shield flash, sparks off the hull, damage numbers (one per volley, with misses, or adding
// up on a ship that keeps taking hits) and, when a ship is destroyed, its explosion. Then the
// panel's lines. Effects follow their ship by id; delays stagger a round's volleys.
function playEvents(s, events) {
  const look = fightMode().look;
  const jitter = () => (Math.random() - 0.5) * 30; // so numbers landing together don't overlap
  for (const ev of events) {
    if (ev.type !== 'shot') continue;
    const d = ev.delay || 0, hit = d + look.after;
    const color = ev.from === 'player' ? SHOT_COLOR.player : wings.has(ev.from) ? SHOT_COLOR.ally : SHOT_COLOR.enemy;
    fight.fx.push({ type: 'beam', delay: d, t: look.beam, max: look.beam, from: ev.from, to: ev.to, hits: ev.hits, color });
    if (ev.shieldDamage > 0) fight.fx.push({ type: 'shield', delay: hit, t: look.shield, max: look.shield, at: ev.to });
    if (ev.hullDamage > 0) fight.fx.push({ type: 'sparks', delay: hit, at: ev.to, n: look.sparks(ev) });
    if (look.sum) { if (ev.damage > 0) addDamage(ev.to, ev.damage, ev.hullDamage > 0); }
    else if (ev.damage > 0) fight.fx.push({ type: 'number', delay: hit, t: 1, max: 1, at: ev.to, jx: jitter(), text: `−${ev.damage}`, color: ev.hullDamage > 0 ? COLORS.flame : COLORS.cyan });
    else fight.fx.push({ type: 'number', delay: hit, t: 0.8, max: 0.8, at: ev.to, jx: jitter(), text: 'miss', color: COLORS.dim });
    if (ev.destroyed) {
      const blowUp = ev.to === 'player' ? playerDestroyed : wings.has(ev.to) ? () => wingDisabled(ev.to) : () => shipDestroyed(ev.to);
      // An enemy is done for at once, though it blows up a moment later: until then it must not
      // start or join another fight.
      if (ev.to !== 'player' && !wings.has(ev.to)) fight.dying.add(ev.to);
      if (d + look.finish > 0) fight.fx.push({ type: 'call', delay: d + look.finish, run: blowUp });
      else blowUp();
    }
  }
  fight.log = fightMode().log(s, events, fight.log);
}

// Damage numbers that add up: hits on a ship in quick succession show as one growing number.
function addDamage(id, amount, hull) {
  const f = fight.fx.find((x) => x.type === 'number' && x.at === id && x.max - x.t < 0.45);
  if (f) {
    f.sum += amount;
    f.text = `−${f.sum}`;
    if (hull) f.color = COLORS.flame;
  } else {
    fight.fx.push({ type: 'number', delay: 0, t: 1, max: 1, at: id, jx: (Math.random() - 0.5) * 24, sum: amount, text: `−${amount}`, color: hull ? COLORS.flame : COLORS.cyan });
  }
}

// Debris and a flash where a ship blew up.
function explode(x, y, r) {
  burst(x, y, 26 + r, { speed: [60, 320], life: [0.5, 1.6], size: [1.5, 5], colors: [COLORS.flame, COLORS.hostile, COLORS.hud, COLORS.star] });
  fight.fx.push({ type: 'flash', delay: 0, t: 0.5, max: 0.5, at: { x, y, radius: r } });
}

// An enemy destroyed: gone for good, with its loot floating where it was.
function shipDestroyed(key) {
  const p = fight.ships.get(key) || fight.lastShips?.get(key);
  cargo.removed.add(key);
  fight.dying.delete(key);
  if (!p) { saveCargo(); return; }
  explode(p.x, p.y, p.radius);
  CombatCore.loot(world.galaxy.seed, key, p.role, p.tier).forEach((d, i) => {
    const a = (i / 3) * TAU + Math.random(), r = 20 + Math.random() * 40;
    cargo.drops.push(dropEntity({ key: `drop:${key}:${i}`, kind: d.kind, seed: d.seed, x: p.x + Math.cos(a) * r, y: p.y + Math.sin(a) * r }));
  });
  saveCargo();
}

// The player ship destroyed: the cargo spills, and after a moment it's towed home.
function playerDestroyed() {
  explode(ship.x, ship.y, SHIP.radius * 2);
  const tag = Date.now().toString(36);
  cargo.items.forEach((it, i) => {
    const a = Math.random() * TAU, r = 30 + Math.random() * 90;
    cargo.drops.push(dropEntity({
      key: `lost:${tag}:${i}`, kind: it.kind, seed: (Math.random() * 4294967296) >>> 0,
      x: ship.x + Math.cos(a) * r, y: ship.y + Math.sin(a) * r,
    }));
  });
  cargo.items = [];
  ship.vx = ship.vy = 0;
  ship.targetSpeed = 0;
  ship.thrust = 0;
  fight.wrecked = true;
  saveCargo();
}

function towHome() {
  cargo.hull = SHIP.hull; // patched up enough to fly
  fight.wrecked = false;
  setMode('in-combat', false);
  const home = cargo.home;
  if (home) placeShip(home.x, home.y + home.radius + 220);
  else placeBeside(startStation());
  SystemMap.setPlayer(ship.x, ship.y);
  fight.grace = RESPAWN_GRACE;
  flash = 0.8;
  notify(`Ship destroyed · towed to ${home ? home.name : startStation().name}`, 4);
  saveCargo();
}

function endFight(result) {
  // After a fight in which they flew, the survivors fly back to their usual paths (tickReturning).
  if (fightMode().flying && fight.final) {
    for (const e of fight.final.enemies) {
      const p = fight.ships.get(e.id);
      if (e.hull <= 0 || !p || !p.motion) continue;
      fight.returning.set(e.id, { x: e.x, y: e.y, vx: e.vx, vy: e.vy, angle: e.angle, a: e.angle, thrust: e.thrust, stats: e.stats, motion: p.motion, t: 0 });
    }
  }
  fight.lastShips = fight.ships; // effects still to play may need the enemies' positions
  fight.ships = new Map();
  fight.result = result;
  fight.resultT = 4;
  if (result === 'lost') {
    // Controls and the map stay locked until the wreck is towed home (towHome).
    fight.wreckT = 2.6;
  } else {
    setMode('in-combat', false);
  }
  if (result === 'fled') { fight.grace = FLEE_GRACE; notify('Got away', 2.5); }
  else if (result === 'won') notify('Victory', 2.5);
  saveCargo();
}

// Pirates that survived a fight in which they flew fly to where their usual path has got to, then carry on
// along it. Once the player is far away they simply rejoin it.
function tickReturning(dt) {
  for (const [key, b] of fight.returning) {
    const home = { motion: b.motion };
    Scene.pose(home, simTime);
    const d = Math.hypot(home.x - b.x, home.y - b.y);
    b.t += dt;
    if (d < 40 || b.t > 40 || Math.hypot(b.x - ship.x, b.y - ship.y) > NEAR) { fight.returning.delete(key); continue; }

    const speed = Math.min(b.stats.maxSpeed * 0.8, Math.sqrt(b.stats.accel * d) + 120);
    Flight.step(b, b.stats, { targetAngle: Math.atan2(home.y - b.y, home.x - b.x), targetSpeed: speed, mode: 'cruise' }, dt);
    b.a = b.angle;
  }
}

// Rounds, real-time steps, effects and the result panel; runs with the flight simulation.
function tickFight(dt) {
  fight.grace = Math.max(0, fight.grace - dt);
  for (let i = fight.fx.length - 1; i >= 0; i--) {
    const f = fight.fx[i];
    if (f.delay > 0) { f.delay -= dt; continue; }
    if (f.type === 'call') { fight.fx.splice(i, 1); f.run(); continue; }
    if (f.type === 'sparks') {
      fight.fx.splice(i, 1);
      const at = fxPos(f.at);
      if (at) burst(at.x, at.y, f.n, { speed: [40, 180], life: [0.3, 0.8], size: [1.5, 3.5], colors: [COLORS.flash, COLORS.flame] });
      continue;
    }
    f.t -= dt;
    if (f.t <= 0) fight.fx.splice(i, 1);
  }
  if (fight.wreckT > 0) {
    fight.wreckT -= dt;
    ship.targetSpeed = 0;
    if (fight.wreckT <= 0) { fight.wreckT = 0; towHome(); }
  }
  if (fight.result && !fight.s) {
    fight.resultT -= dt;
    if (fight.resultT <= 0) { fight.result = null; CombatPanel.hide(); }
  }
  tickReturning(dt);
  const s = fight.s;
  if (!s) return;
  const m = fightMode();
  if (!m.flying) ship.targetSpeed = 0; // held in place
  // When it isn't steering, the ship turns to face its target.
  const target = fight.ships.get(s.focus);
  if (target && ship.targetSpeed === 0) ship.angle = turnToward(ship.angle, Math.atan2(target.y - ship.y, target.x - ship.x), SHIP.turnRate * dt);
  orderSquad(s);
  const events = m.step(s, dt, ship); // the player's ship has already flown this frame (update)
  syncAllies(s);
  if (m.flying) {
    for (const e of s.enemies) {
      const p = fight.ships.get(e.id);
      if (p && e.hull > 0) Object.assign(p, { x: e.x, y: e.y, a: e.angle, thrust: e.thrust });
    }
  }
  playEvents(s, events);
  // Hull damage is saved when the fight ends (endFight) or the page is hidden (saveAll), not on
  // every hit: a save writes the whole cargo.
  cargo.hull = Math.max(0, s.player.hull);
  if (s.over) {
    fight.s = null;
    fight.final = s; // shown on the panel until it closes
    endFight(s.over);
  }
}

// Target an enemy (a tap on it, its marker or its row).
function focusOn(id) {
  const s = fight.s;
  if (!s) return;
  fightMode().setFocus(s, id);
}

const OUTCOME_TITLE = { won: 'Victory', fled: 'Escaped', lost: 'Ship destroyed' };

// The panel: live during the fight, then the outcome for a few seconds.
function updateCombatPanel() {
  const s = fight.s || (fight.result ? fight.final : null);
  if (!s) return;
  const over = !fight.s;
  const allies = s.allies || [];
  const rows = [s.player, ...allies, ...s.enemies].map((c) => ({
    id: c.id, name: c.name, you: c === s.player, ally: allies.includes(c), hull: c.hull, maxHull: c.stats.hull,
    shield: c.shield, maxShield: c.stats.shield, focus: !over && c.id === s.focus,
  }));
  const live = over ? { title: OUTCOME_TITLE[fight.result], button: { id: 'close', label: 'Close', enabled: true }, progress: 0 } : fightMode().panel(s);
  CombatPanel.show({ ...live, tone: over ? fight.result : '', rows, log: fight.log });
}

CombatPanel.onFocus = focusOn;
CombatPanel.onButton = (id) => {
  if (fight.s && fightMode().press) fightMode().press(fight.s, id); // Flee
  if (id === 'close') { fight.result = null; CombatPanel.hide(); }
};

// Real time: the guns' field of fire ahead of the ship, out to their range; brighter while the
// locked target is inside it. And a faint red line from every enemy that has you in its sights.
function drawFieldOfFire(s) {
  const w = SHIP.weapons[0];
  if (!w || fight.wrecked) return;
  const t = s.enemies.find((e) => e.id === s.focus && e.hull > 0);
  const live = t && s.locked && RealtimeCombat.canFire(s.player, w, t);
  const half = w.arc >= 360 ? Math.PI : (w.arc * Math.PI) / 360;
  const x = rx(ship.x), y = ry(ship.y), R = w.range + SHIP.radius;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.arc(x, y, R, ship.angle - half, ship.angle + half);
  ctx.closePath();
  if (live) {
    ctx.fillStyle = SHOT_COLOR.player;
    ctx.globalAlpha = 0.045;
    ctx.fill();
  }
  ctx.strokeStyle = SHOT_COLOR.player;
  ctx.globalAlpha = live ? 0.32 : 0.16;
  ctx.lineWidth = 1.5 / view.zoom;
  ctx.setLineDash([8 / view.zoom, 10 / view.zoom]);
  ctx.stroke();
  ctx.strokeStyle = HOSTILE_COLOR;
  ctx.globalAlpha = 0.3;
  for (const e of CombatCore.alive(s)) {
    if (CombatCore.aimAt(s, e) !== s.player) continue; // after a wingman
    if (e.lockT < e.stats.lockTime || !e.stats.weapons.some((ew) => RealtimeCombat.canFire(e, ew, s.player))) continue;
    ctx.beginPath();
    ctx.moveTo(rx(e.x), ry(e.y));
    ctx.lineTo(x, y);
    ctx.stroke();
  }
  ctx.setLineDash([]);
}

// Beams, shield flashes and explosion flashes, in world space; brackets on the target (closing
// in as the lock comes on, in real time).
function drawFight() {
  const s = fight.s;
  ctx.save();
  if (s && fightMode().look.arcs) drawFieldOfFire(s);
  if (s) {
    const f = fight.ships.get(s.focus);
    if (f) {
      const lock = fightMode().lock(s);
      ctx.strokeStyle = HOSTILE_COLOR;
      ctx.globalAlpha = 0.5 + 0.35 * lock;
      ctx.lineWidth = 2 / view.zoom;
      if (lock < 1) ctx.setLineDash([5 / view.zoom, 4 / view.zoom]);
      brackets(rx(f.x), ry(f.y), f.radius, { open: 1 - lock });
      ctx.setLineDash([]);
    }
  }
  ctx.lineCap = 'round';
  for (const f of fight.fx) {
    if (f.delay > 0 || f.t === undefined) continue;
    const k = f.t / f.max;
    if (f.type === 'beam') {
      // A hit lands on the target; a miss streaks past it.
      const from = fxPos(f.from), to = fxPos(f.to);
      if (!from || !to) continue;
      const ang = Math.atan2(to.y - from.y, to.x - from.x);
      const d = Math.hypot(to.x - from.x, to.y - from.y);
      const len = f.hits > 0 ? d - to.radius * 0.4 : d + 120;
      const off = f.hits > 0 ? 0 : 0.06;
      const x0 = rx(from.x) + Math.cos(ang) * from.radius, y0 = ry(from.y) + Math.sin(ang) * from.radius;
      const x1 = rx(from.x) + Math.cos(ang + off) * len, y1 = ry(from.y) + Math.sin(ang + off) * len;
      ctx.strokeStyle = f.color;
      ctx.globalAlpha = k * (f.hits > 0 ? 0.3 : 0.12);
      ctx.lineWidth = 6 / view.zoom;
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
      ctx.globalAlpha = k * (f.hits > 0 ? 0.95 : 0.35);
      ctx.lineWidth = 1.6 / view.zoom;
      ctx.stroke();
    } else if (f.type === 'shield') {
      const at = fxPos(f.at);
      if (!at) continue;
      ctx.strokeStyle = COLORS.cyan;
      ctx.globalAlpha = k * 0.8;
      ctx.lineWidth = 2 / view.zoom;
      ctx.beginPath();
      ctx.arc(rx(at.x), ry(at.y), at.radius + 10 + (1 - k) * 8, 0, TAU);
      ctx.stroke();
    } else if (f.type === 'flash') {
      ctx.fillStyle = COLORS.flash;
      ctx.globalAlpha = k * 0.6;
      ctx.beginPath();
      ctx.arc(rx(f.at.x), ry(f.at.y), f.at.radius * (1.5 + (1 - k) * 2.5), 0, TAU);
      ctx.fill();
    }
  }
  ctx.restore();
}

// In screen space: damage numbers rising off the ships, and small hull/shield bars and letters
// above every ship in the fight.
function drawFightOverlay() {
  const s = fight.s;
  ctx.save();
  ctx.font = Theme.font(12);
  ctx.textAlign = 'center';
  if (s) {
    for (const c of [s.player, ...(s.allies || []), ...s.enemies]) {
      if (c.hull <= 0) continue;
      const p = fighterPos(c.id);
      if (!p) continue;
      const [x, y] = worldToScreen(p.x, p.y - p.radius);
      const w = 34, top = y - 18;
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = 'rgba(38, 48, 74, 0.9)';
      ctx.fillRect(x - w / 2, top, w, 3);
      ctx.fillRect(x - w / 2, top + 4, w, 3);
      ctx.fillStyle = COLORS.cyan;
      ctx.fillRect(x - w / 2, top, w * (c.stats.shield ? c.shield / c.stats.shield : 0), 3);
      ctx.fillStyle = s.enemies.includes(c) ? HOSTILE_COLOR : COLORS.good;
      ctx.fillRect(x - w / 2, top + 4, w * (c.hull / c.stats.hull), 3);
      if (s.enemies.includes(c) && s.enemies.length > 1) {
        ctx.fillStyle = c.id === s.focus ? COLORS.bright : COLORS.neutral;
        ctx.fillText(c.name.split(' ').pop(), x, top - 4);
      }
    }
  }
  for (const f of fight.fx) {
    if (f.type !== 'number' || f.delay > 0) continue;
    const at = fxPos(f.at);
    if (!at) continue;
    const k = f.t / f.max;
    const [x, y] = worldToScreen(at.x, at.y);
    ctx.globalAlpha = Math.min(1, k * 1.6);
    ctx.fillStyle = f.color;
    ctx.fillText(f.text, x + 14 + (f.jx || 0), y - 26 - (1 - k) * 26);
  }
  ctx.restore();
}

// In a fight, enemies off screen get a red marker at the screen edge pointing their way, with
// their letter and distance (edgeMarkers); a tap on one targets it.
let foeHits = [];

function drawFoeMarkers() {
  foeHits = [];
  const s = fight.s;
  if (!s) return;
  const foes = [];
  for (const e of CombatCore.alive(s)) {
    const p = fight.ships.get(e.id);
    if (!p || visible(p)) continue;
    const label = `${s.enemies.length > 1 ? `${e.name.split(' ').pop()} · ` : ''}${fmtDist(Math.hypot(p.x - ship.x, p.y - ship.y) - p.radius)}`;
    foes.push({ ref: e.id, x: p.x, y: p.y, color: HOSTILE_COLOR, ring: e.id === s.focus ? HOSTILE_COLOR : null, label });
  }
  const top = CombatPanel.top;
  foeHits = edgeMarkers(foes, top === null ? 64 : Math.max(64, view.h - top + 18), 0.9);
}

// The enemy whose edge marker is under a tap, if any.
function foeMarkerAt(sx, sy) { return markerAt(foeHits, sx, sy); }

// ---------- Input: drag sets heading, drag length sets speed ----------

const DEADZONE = 8;
const drag = { active: false, id: null, x0: 0, y0: 0, x: 0, y: 0, moved: 0 };
let interacted = false;

// Drag length (CSS px) that maps to full speed.
const maxDrag = () => Math.min(view.w, view.h) * 0.3;

canvas.addEventListener('pointerdown', (e) => {
  if (drag.active || (e.pointerType === 'mouse' && e.button !== 0)) return;
  canvas.setPointerCapture(e.pointerId);
  Object.assign(drag, {
    active: true, id: e.pointerId,
    x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, moved: 0,
  });
  interacted = true;
});

canvas.addEventListener('pointermove', (e) => {
  if (!drag.active || e.pointerId !== drag.id) return;
  drag.x = e.clientX;
  drag.y = e.clientY;
  const dx = drag.x - drag.x0;
  const dy = drag.y - drag.y0;
  const len = Math.hypot(dx, dy);
  drag.moved = Math.max(drag.moved, len);
  if (inFight() && !flyingFight()) return; // no flying in a round-based fight; taps still focus fire
  if (intro.on && !intro.flying) return; // the pod waits while the station talks, then the beam has it
  if (len > DEADZONE) {
    autopilot.key = null; // flying by hand ends an approach
    ship.targetAngle = Math.atan2(dy, dx);
    ship.targetSpeed = Math.min(len / maxDrag(), 1) * SHIP.maxSpeed;
  } else if (drag.moved > DEADZONE) {
    ship.targetSpeed = 0; // dragged back to the anchor: throttle to zero
  }
});

// A tap selects what's under it; a tap on empty space clears the selection and any approach,
// and in Cruise mode stops the ship. In Direct mode letting go always stops the ship (unless it's
// approaching something). In a fight a tap on an enemy (or, in real time, its edge marker)
// targets it; in real time the ship stops as it would outside a fight.
function endDrag(e) {
  if (!drag.active || e.pointerId !== drag.id) return;
  drag.active = false;
  const tap = e.type === 'pointerup' && drag.moved < DEADZONE;
  if (intro.on) { // nothing to select yet: only flying
    if (intro.arrive && tap) endArrive(); // a tap skips the opening drift
    if (intro.flying && (moveMode.value === 'direct' || tap)) ship.targetSpeed = 0;
    return;
  }
  const marker = tap && fight.s ? foeMarkerAt(e.clientX, e.clientY) : null;
  const hit = tap && !marker ? pickAt(e.clientX, e.clientY) : null;
  if (inFight()) {
    const foe = marker || (hit && fight.ships.has(hit.key) ? hit.key : null);
    if (foe) focusOn(foe);
    else if (flyingFight() && (moveMode.value === 'direct' || tap)) ship.targetSpeed = 0;
    return;
  }
  if (hit) select(hit);
  else if (tap) { select(null); autopilot.key = null; }
  if (moveMode.value === 'direct') { if (!autopilot.key) ship.targetSpeed = 0; }
  else if (tap && !hit) ship.targetSpeed = 0;
}
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

// ---------- Simulation ----------

function update(dt) {
  simTime += dt;
  tickAutopilot();
  // Turning, speed and drift by the engine's numbers, in the chosen movement mode (flight/flight.js);
  // in the introduction's tractor beam, the beam's pull.
  if (intro.on && !intro.flying) ship.targetSpeed = 0; // the pod waits while the station talks
  if (intro.arrive) tickArrive(dt);
  else if (intro.beam) tickBeam(dt);
  else Flight.step(ship, SHIP, { targetAngle: ship.targetAngle, targetSpeed: ship.targetSpeed, mode: moveMode.value }, dt);
  const hx = Math.cos(ship.angle);
  const hy = Math.sin(ship.angle);

  // Engine exhaust particles.
  if (ship.thrust > 0.25 && Math.random() < ship.thrust * 1.5) {
    const spread = (Math.random() - 0.5) * 0.6;
    const back = ship.angle + Math.PI + spread;
    particles.push({
      x: ship.x - hx * 12, y: ship.y - hy * 12,
      vx: ship.vx * 0.5 + Math.cos(back) * 140, vy: ship.vy * 0.5 + Math.sin(back) * 140,
      life: 0.6, max: 0.6,
    });
  }
  for (const list of [particles, debris]) {
    for (let i = list.length - 1; i >= 0; i--) {
      const p = list[i];
      p.life -= dt;
      if (p.life <= 0) { list.splice(i, 1); continue; }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
  }
  tickMining(dt);
  tickFight(dt);
  tickWings(dt);
  tickIntro(dt);
  tickMission(dt);

  flash = Math.max(0, flash - dt * 1.8);
  toast.t = Math.max(0, toast.t - dt);
  updateRegionNotice();
  // Ship sensors look for contacts around it, a few times a second.
  senseTimer -= dt;
  if (senseTimer <= 0) {
    senseTimer = 0.25;
    sense();
  }

  // Camera leads in the direction of travel. In a fight it frames the ship and its target in
  // the space above the combat panel; in real time it leans only so far, keeping your own ship
  // well on screen when the target is far off.
  const lead = 0.45;
  const k = 1 - Math.exp(-4 * dt);
  let tx = ship.x + ship.vx * lead, ty = ship.y + ship.vy * lead;
  const focus = fight.s && fight.ships.get(fight.s.focus);
  if (focus) {
    const top = CombatPanel.top;
    const covered = top === null ? 0 : Math.max(0, view.h - top);
    let dx = (focus.x - ship.x) / 2, dy = (focus.y - ship.y) / 2;
    if (fightMode().flying) {
      const max = (Math.min(view.w, view.h - covered) * 0.3) / view.zoom, len = Math.hypot(dx, dy);
      if (len > max) { dx *= max / len; dy *= max / len; }
    }
    tx = ship.x + dx;
    ty = ship.y + dy + covered / 2 / view.zoom;
  }
  // The introduction frames the pod and the station together above the comms box, unless the pod
  // has flown off.
  if (intro.on && gapTo(intro.station) < 1500) {
    const top = Comms.top, covered = top === null ? 0 : Math.max(0, view.h - top + 12);
    tx = (ship.x + intro.station.x) / 2;
    ty = (ship.y + intro.station.y) / 2 + covered / 2 / view.zoom;
  }
  cam.x = lerp(cam.x, tx, k);
  cam.y = lerp(cam.y, ty, k);
  // The opening shot pulls back from the pod to frame it with the station (arriveView).
  if (intro.arrive) arriveView();
  // Zoom eases out for the introduction and back after it.
  const zk = intro.on ? TRACTOR.zoom : 1;
  if (intro.arrive) { /* set by arriveView */ } else if (view.k !== zk) {
    view.k = Math.abs(view.k - zk) < 0.002 ? zk : lerp(view.k, zk, 1 - Math.exp(-2.5 * dt));
    view.zoom = view.base * view.k;
  }

  SystemMap.setPlayer(ship.x, ship.y);
}

// ---------- Background starfield (procedural, parallax) ----------

const STAR_LAYERS = [
  { p: 0.04, cell: 200, n: 6, size: [0.5, 1.0], alpha: [0.2, 0.5] },
  { p: 0.12, cell: 220, n: 4, size: [0.7, 1.3], alpha: [0.3, 0.65] },
  { p: 0.3, cell: 260, n: 3, size: [1.0, 1.7], alpha: [0.4, 0.8] },
  { p: 0.65, cell: 320, n: 2, size: [1.3, 2.2], alpha: [0.5, 0.95] },
];
const STAR_TINTS = ['#ffffff', '#cfe0ff', '#fff1d0', '#ffd9d9'];
// Stars are drawn in batches: one path per tint and brightness level per layer, instead of one
// draw call (plus colour and alpha changes) per star. Brightness is rounded to this many levels.
const STAR_ALPHA_LEVELS = 8;
const starBuckets = Array.from({ length: STAR_TINTS.length * STAR_ALPHA_LEVELS }, () => []); // x, y, size triples
let starCount = 0; // stars drawn last frame, for the performance overlay

function drawStarfield() {
  starCount = 0;
  for (let li = 0; li < STAR_LAYERS.length; li++) {
    const L = STAR_LAYERS[li];
    const ox = cam.x * L.p * view.zoom - view.w / 2;
    const oy = cam.y * L.p * view.zoom - view.h / 2;
    // Motion streaks scale with speed and layer depth.
    const sx = -ship.vx * L.p * view.zoom * 0.04;
    const sy = -ship.vy * L.p * view.zoom * 0.04;
    const streakLen = Math.hypot(sx, sy);
    const streak = streakLen > 1.5;

    for (const b of starBuckets) b.length = 0;
    const c0x = Math.floor(ox / L.cell), c1x = Math.floor((ox + view.w) / L.cell);
    const c0y = Math.floor(oy / L.cell), c1y = Math.floor((oy + view.h) / L.cell);
    for (let cy = c0y; cy <= c1y; cy++) {
      for (let cx = c0x; cx <= c1x; cx++) {
        const rnd = mulberry32(hashInt(cx, cy, li));
        for (let i = 0; i < L.n; i++) {
          // Same random draws, in the same order, as each star has always used.
          const x = cx * L.cell + rnd() * L.cell - ox;
          const y = cy * L.cell + rnd() * L.cell - oy;
          const s = lerp(L.size[0], L.size[1], rnd());
          const level = Math.round(rnd() * (STAR_ALPHA_LEVELS - 1));
          const tint = (rnd() * STAR_TINTS.length) | 0;
          starBuckets[tint * STAR_ALPHA_LEVELS + level].push(x, y, s);
        }
      }
    }

    // A streak is a line of width s; as a filled quad it can share a path with the others.
    const nx = streak ? -sy / streakLen / 2 : 0, ny = streak ? sx / streakLen / 2 : 0;
    for (let bi = 0; bi < starBuckets.length; bi++) {
      const b = starBuckets[bi];
      if (!b.length) continue;
      ctx.globalAlpha = lerp(L.alpha[0], L.alpha[1], (bi % STAR_ALPHA_LEVELS) / (STAR_ALPHA_LEVELS - 1));
      ctx.fillStyle = STAR_TINTS[(bi / STAR_ALPHA_LEVELS) | 0];
      ctx.beginPath();
      for (let i = 0; i < b.length; i += 3) {
        const x = b[i], y = b[i + 1], s = b[i + 2];
        if (streak) {
          const px = nx * s, py = ny * s;
          ctx.moveTo(x + px, y + py);
          ctx.lineTo(x + sx + px, y + sy + py);
          ctx.lineTo(x + sx - px, y + sy - py);
          ctx.lineTo(x - px, y - py);
          ctx.closePath();
        } else {
          ctx.rect(x - s / 2, y - s / 2, s, s);
        }
      }
      ctx.fill();
      starCount += b.length / 3;
    }
  }
  ctx.globalAlpha = 1;
}

// ---------- World objects (drawn relative to `origin`, a grid point near the camera) ----------

const origin = { x: 0, y: 0 };
const rx = (x) => x - origin.x;
const ry = (y) => y - origin.y;

const securityLabel = (level) => Security.LEVELS[level].label.toLowerCase();

// A notice when the ship crosses into another system or out into deep space, into another
// security level, or into or out of a nebula. Entering a system for the first time charts it
// (rules/knowledge.js), so it shows on the galaxy map.
// Also keeps here.region up to date for the HUD and minimap.
function updateRegionNotice() {
  const r = here.region = world.galaxy.regionAt(ship.x, ship.y);
  const { security: level, nebula, system } = r;
  const now = { level, nebula, system };
  const was = lastRegion;
  lastRegion = now;
  if (system) world.knowledge.visit(system.index);
  if (!was) return;
  if (system !== was.system) notify(system ? `Entering the ${system.name} system` : `Leaving the ${was.system.name} system · deep space`, 3);
  else if (nebula !== was.nebula) notify(nebula ? `Entering the ${nebula.name} · sensors dampened` : `Leaving the ${was.nebula.name}`, 3);
  else if (level !== was.level) notify(`Entering ${securityLabel(level)}-security space`, 2.5);
}

// Pickup highlight: a soft glow, a steady ring and a ring pulsing outward, in the amber the minimap
// uses for items; rare and better finds ring in their rarity's colour instead (rules/goods.js). Each item
// pulses on its own rhythm, and the effect brightens as the ship nears.
const ITEM_HALO = { color: COLORS.amber, period: 1.8, near: 900 };
function itemPhase(e) {
  if (e.haloPhase === undefined) {
    let h = 0;
    for (const ch of e.key) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    e.haloPhase = (h % 1000) / 1000;
  }
  return e.haloPhase;
}

let haloGlow = null; // one radial gradient of radius 1, scaled to each item
function drawItemHalos(list, t) {
  if (!haloGlow) {
    haloGlow = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    haloGlow.addColorStop(0, 'rgba(255, 207, 90, 0.55)');
    haloGlow.addColorStop(0.55, 'rgba(255, 207, 90, 0.32)');
    haloGlow.addColorStop(1, 'rgba(255, 207, 90, 0)');
  }
  ctx.save();
  for (const e of list) {
    if (e.kind !== 'item') continue;
    ctx.strokeStyle = e.art.rarity >= 3 ? Goods.RARITY[e.art.rarity].color : ITEM_HALO.color;
    const x = rx(e.x), y = ry(e.y);
    const R = e.radius * 0.8 + 14;
    const near = clamp(1 - Math.hypot(ship.x - e.x, ship.y - e.y) / ITEM_HALO.near, 0, 1);
    const p = (t / ITEM_HALO.period + itemPhase(e)) % 1;
    // Soft glow, fading out past the ring.
    ctx.globalAlpha = 0.55 + 0.45 * near;
    ctx.fillStyle = haloGlow;
    ctx.translate(x, y);
    ctx.scale(R * 1.5, R * 1.5);
    ctx.beginPath();
    ctx.arc(0, 0, 1, 0, TAU);
    ctx.fill();
    ctx.scale(1 / (R * 1.5), 1 / (R * 1.5));
    ctx.translate(-x, -y);
    // Steady ring, breathing slightly.
    ctx.lineWidth = 1.5 / view.zoom;
    ctx.globalAlpha = 0.35 + 0.35 * near + 0.1 * Math.sin((p + 0.25) * TAU);
    ctx.beginPath();
    ctx.arc(x, y, R, 0, TAU);
    ctx.stroke();
    // Pulse: expands and fades.
    ctx.globalAlpha = (1 - p) * (0.45 + 0.35 * near);
    ctx.beginPath();
    ctx.arc(x, y, R * (1 + p * 1.1), 0, TAU);
    ctx.stroke();
  }
  ctx.restore();
}

function visible(e) {
  const hw = view.w / 2 / view.zoom, hh = view.h / 2 / view.zoom, r = (e.radius || 100) * 1.3;
  return Math.abs(e.x - cam.x) < hw + r && Math.abs(e.y - cam.y) < hh + r;
}

function drawEntities(list, t) {
  const style = artStyle.value;
  const shown = list.filter(visible).sort((a, b) => KINDS[a.kind].order - KINDS[b.kind].order);
  perfStats.posed = list.length;
  perfStats.drawn = shown.length;
  const hw = view.w / 2 / view.zoom, hh = view.h / 2 / view.zoom;
  const scene = { t, list, view: [cam.x - hw, cam.y - hh, cam.x + hw, cam.y + hh] };
  let halos = false;
  for (const e of shown) {
    // Pickup highlights go above wrecks and asteroids, just under the items themselves.
    if (e.kind === 'item' && !halos) { drawItemHalos(shown, t); halos = true; }
    KINDS[e.kind].draw(ctx, e, style, rx(e.x), ry(e.y), scene);
  }
}

// The ship's design is drawn to fit its hull's size (the Courier's art is a quarter wider than its
// collision radius, and every hull keeps that proportion).
function drawShip(t) {
  if (fight.wrecked) return; // blown up, waiting for the tow
  const k = (SHIP.radius * 1.25) / ship.art.radius;
  ctx.save();
  ctx.translate(rx(ship.x), ry(ship.y));
  if (k !== 1) ctx.scale(k, k);
  Art.drawAsset(ctx, ship.art, artStyle.value, { angle: ship.angle, t, thrust: ship.thrust });
  ctx.restore();
}

function drawParticles() {
  ctx.fillStyle = COLORS.flame;
  for (const p of particles) {
    ctx.globalAlpha = (p.life / p.max) * 0.7;
    ctx.fillRect(rx(p.x) - 1.5, ry(p.y) - 1.5, 3, 3);
  }
  ctx.globalAlpha = 1;
}

// ---------- Screen-space overlays ----------

const worldToScreen = (x, y) => [
  (x - cam.x) * view.zoom + view.w / 2,
  (y - cam.y) * view.zoom + view.h / 2,
];

function drawLabels(list) {
  ctx.font = Theme.font(12);
  ctx.textAlign = 'center';
  ctx.globalAlpha = 0.75;
  for (const e of list) {
    if (!e.name || !visible(e)) continue;
    const l = KINDS[e.kind].label(e);
    if (!l) continue;
    const [sx, sy] = worldToScreen(e.x, e.y + l[1]);
    ctx.fillStyle = l[0];
    ctx.fillText(e.name.toUpperCase(), sx, sy + 14);
  }
  ctx.globalAlpha = 1;
  ctx.textAlign = 'left';
}

// Markers at the screen edge for things off screen, pointing their way: an arrow in the item's
// colour, a ring round it when `ring` (a colour) is set, and its label set inward from the arrow
// so it never covers it. items: [{ ref, x, y (world), color, ring, label }]. bottom: how far up
// from the bottom edge to stay (the speed bar, or the panel when one is open); the other margins
// keep clear of the HUD text and the buttons. Returns where each was drawn, for markerAt().
function edgeMarkers(items, bottom, alpha) {
  const inset = { l: 26, r: 26, t: 70, b: bottom };
  const cx = view.w / 2, cy = view.h / 2;
  const hits = [];
  ctx.save();
  ctx.font = Theme.font(11);
  ctx.textAlign = 'left';
  ctx.globalAlpha = alpha;
  for (const m of items) {
    const [px, py] = worldToScreen(m.x, m.y);
    const dx = px - cx, dy = py - cy;
    // Where the line from the screen centre to it leaves the inset screen rectangle.
    const k = Math.min((dx > 0 ? cx - inset.r : cx - inset.l) / Math.abs(dx || 1e-6), (dy > 0 ? cy - inset.b : cy - inset.t) / Math.abs(dy || 1e-6));
    const x = cx + dx * k, y = cy + dy * k, a = Math.atan2(dy, dx);
    ctx.fillStyle = m.color;
    ctx.translate(x, y);
    ctx.rotate(a);
    ctx.beginPath();
    ctx.moveTo(10, 0);
    ctx.lineTo(-4, 7);
    ctx.lineTo(-4, -7);
    ctx.closePath();
    ctx.fill();
    if (m.ring) {
      ctx.strokeStyle = m.ring;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(2, 0, 14, 0, TAU);
      ctx.stroke();
    }
    ctx.rotate(-a);
    ctx.translate(-x, -y);
    const tw = ctx.measureText(m.label).width;
    const tx = clamp(x - Math.cos(a) * (tw / 2 + 16) - tw / 2, 8, view.w - tw - 8);
    // A label that would overlap one already drawn (two things in about the same direction)
    // moves a line further in from the edge.
    const overlaps = (t) => hits.some((h) => tx < h.text[2] && tx + tw > h.text[0] && t - 11 < h.text[3] && t + 3 > h.text[1]);
    let ty = clamp(y - Math.sin(a) * 18 + 4, 14, view.h - 8);
    for (let i = 0; i < hits.length && overlaps(ty); i++) ty += y < cy ? 15 : -15;
    ctx.fillText(m.label, tx, ty);
    hits.push({ ref: m.ref, x, y, box: [tx - 6, ty - 15, tx + tw + 6, ty + 7], text: [tx, ty - 11, tx + tw, ty + 3] });
  }
  ctx.restore();
  return hits;
}

// What an edge marker (its arrow or its label) under a tap stands for, if any.
function markerAt(hits, sx, sy) {
  for (const m of hits) {
    const [x0, y0, x1, y1] = m.box;
    if (Math.hypot(sx - m.x, sy - m.y) < TAP_SLOP + 8 || (sx >= x0 && sx <= x1 && sy >= y0 && sy <= y1)) return m.ref;
  }
  return null;
}

// Off-screen stations and gates within NAV_RANGE get an edge marker with their name and distance; a tap on
// one selects its station.
let navHits = [];

// The mission's objective gets one too, at any distance: the station's own marker ringed in amber
// when it's a station, else an amber one of its own.
// Stations and gates are few, so they come from the scene's own lists rather than the frame's
// (which reaches only NEAR).
function drawNavMarkers() {
  const stations = [];
  const obj = here.objective;
  const mark = (st) => {
    if (visible(st)) return;
    const d = Math.hypot(st.x - ship.x, st.y - ship.y);
    if (d > NAV_RANGE) return;
    // The selected station's marker, or the objective's.
    const ring = selected && selected.key === entityKey(st) ? SELECT_COLOR : obj && obj.station === st ? COLORS.amber : null;
    stations.push({ ref: st, x: st.x, y: st.y, color: st.color, ring, label: `${st.name.toUpperCase()} · ${fmtDist(d - st.radius)}` }); // to its edge, as the card shows
  };
  world.scene.stations.forEach(mark);
  world.scene.gates.forEach(mark);
  const R = obj && (obj.station ? obj.station.radius : mission.site.spread);
  if (obj && !visible({ x: obj.x, y: obj.y, radius: R }) && !stations.some((m) => m.ref === obj.station)) {
    const label = `${obj.station ? obj.station.name.toUpperCase() : 'OBJECTIVE'} · ${fmtDist(Math.hypot(obj.x - ship.x, obj.y - ship.y) - (obj.station ? R : 0))}`;
    stations.push({ ref: obj.station, x: obj.x, y: obj.y, color: COLORS.amber, ring: COLORS.amber, label });
  }
  const top = ContextCard.isOpen ? ContextCard.top : null;
  navHits = edgeMarkers(stations, top === null ? 64 : Math.max(64, view.h - top + 16), 0.85);
}

// The station whose edge marker is under a tap, if any.
function navMarkerAt(sx, sy) { return markerAt(navHits, sx, sy); }

function drawDragIndicator() {
  if (!drag.active) return;
  const md = maxDrag();
  const dx = drag.x - drag.x0;
  const dy = drag.y - drag.y0;
  const len = Math.hypot(dx, dy);
  const k = len > md ? md / len : 1;
  const ex = drag.x0 + dx * k;
  const ey = drag.y0 + dy * k;

  ctx.save();
  ctx.strokeStyle = COLORS.hud;
  ctx.globalAlpha = 0.25;
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 6]);
  ctx.beginPath();
  ctx.arc(drag.x0, drag.y0, md, 0, TAU);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.globalAlpha = 0.8;
  ctx.strokeStyle = COLORS.cyan;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(drag.x0, drag.y0);
  ctx.lineTo(ex, ey);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(drag.x0, drag.y0, 4, 0, TAU);
  ctx.arc(ex, ey, 10, 0, TAU);
  ctx.stroke();

  if (len > DEADZONE) {
    ctx.fillStyle = COLORS.cyan;
    ctx.font = Theme.font(12);
    ctx.fillText(`${Math.round(Math.min(len / md, 1) * 100)}%`, ex + 14, ey - 14);
  }
  ctx.restore();
}

// The minimap: a radar of the space around the ship, RADAR world units each way, framed in the
// colour of the security there. Hidden wrecks show once the sensors have found them.
const RADAR = 6000;
function drawMinimap(list) {
  const size = Math.round(clamp(view.w * 0.28, 90, 150));
  const pad = 12;
  const x0 = view.w - size - pad;
  const y0 = pad;
  const s = size / (RADAR * 2);
  const ox = ship.x - RADAR, oy = ship.y - RADAR;
  const security = Security.LEVELS[here.region.security];
  const hidden = (e) => e.kind === 'wreck' && e.contact && world.knowledge.contactState(e.contact) !== 'known';

  ctx.save();
  ctx.fillStyle = 'rgba(5, 6, 10, 0.75)';
  ctx.fillRect(x0, y0, size, size);
  ctx.strokeStyle = security.color;
  ctx.globalAlpha = 0.6;
  ctx.lineWidth = 1;
  ctx.strokeRect(x0 + 0.5, y0 + 0.5, size - 1, size - 1);
  ctx.globalAlpha = 1;
  ctx.beginPath();
  ctx.rect(x0, y0, size, size);
  ctx.clip();

  // Orbits crossing the radar, faintly: the planets' around the nearest system's star.
  ctx.strokeStyle = COLORS.planet;
  ctx.globalAlpha = 0.18;
  ctx.lineWidth = 1;
  const sys = world.galaxy.nearestSystem(ship.x, ship.y);
  const cx = x0 + (sys.star.x - ox) * s, cy = y0 + (sys.star.y - oy) * s;
  for (const p of sys.planets) { ctx.beginPath(); ctx.arc(cx, cy, p.orbit * s, 0, TAU); ctx.stroke(); }
  ctx.globalAlpha = 1;

  for (const e of list) {
    if (Math.abs(e.x - ship.x) > RADAR + e.radius || Math.abs(e.y - ship.y) > RADAR + e.radius || hidden(e)) continue;
    const m = KINDS[e.kind].mark(e, world.galaxy); // a dot, or a ring
    if (!m) continue;
    ctx.beginPath();
    ctx.arc(x0 + (e.x - ox) * s, y0 + (e.y - oy) * s, m.r, 0, TAU);
    if (m.ring) {
      ctx.strokeStyle = m.color;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    } else {
      ctx.fillStyle = m.color;
      ctx.fill();
    }
  }

  // Camera viewport.
  const vw = (view.w / view.zoom) * s;
  const vh = (view.h / view.zoom) * s;
  ctx.strokeStyle = COLORS.hud;
  ctx.globalAlpha = 0.3;
  ctx.strokeRect(x0 + (cam.x - ox) * s - vw / 2, y0 + (cam.y - oy) * s - vh / 2, vw, vh);
  ctx.globalAlpha = 1;

  ctx.translate(x0 + (ship.x - ox) * s, y0 + (ship.y - oy) * s);
  ctx.rotate(ship.angle);
  ctx.fillStyle = COLORS.cyan;
  ctx.beginPath();
  ctx.moveTo(5, 0);
  ctx.lineTo(-3, 3);
  ctx.lineTo(-3, -3);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}


// No HUD (minimap, speed, location, edge markers) in the introduction: it appears once the player
// first launches.
const hudShown = () => !intro.on;

function drawHud() {
  const speed = Math.hypot(ship.vx, ship.vy);
  const pad = 12;
  const barW = Math.min(160, view.w * 0.4);
  const y = view.h - pad - 8;

  ctx.save();
  ctx.font = Theme.font(12);
  ctx.fillStyle = COLORS.hud;
  ctx.globalAlpha = 0.85;
  ctx.fillText(`SPD ${String(Math.round(speed)).padStart(3, ' ')}`, pad, y - 12);
  if (cargo.items.length) ctx.fillText(`CARGO ${cargo.items.length}/${SHIP.cargo}`, pad + 84, y - 12);
  if (cargo.hull < SHIP.hull) { // damage shows until it's repaired at a station
    ctx.fillStyle = cargo.hull < SHIP.hull * 0.35 ? COLORS.hostile : COLORS.flame;
    ctx.fillText(`HULL ${Math.ceil(cargo.hull)}/${SHIP.hull}`, pad + 180, y - 12);
    ctx.fillStyle = COLORS.hud;
  }

  // Actual speed (filled) vs set throttle (marker).
  ctx.globalAlpha = 0.25;
  ctx.fillRect(pad, y, barW, 6);
  ctx.globalAlpha = 0.9;
  ctx.fillStyle = COLORS.cyan;
  ctx.fillRect(pad, y, barW * (speed / SHIP.maxSpeed), 6);
  ctx.fillStyle = COLORS.flame;
  ctx.fillRect(pad + barW * (ship.targetSpeed / SHIP.maxSpeed) - 1, y - 3, 2, 12);

  // Where you are: the system, the security here, and the nebula you're in or what you're near.
  const r = here.region;
  ctx.globalAlpha = 0.85;
  ctx.fillStyle = COLORS.dim;
  const head = `${r.system ? `${r.system.name.toUpperCase()} SYSTEM` : 'DEEP SPACE'} · `;
  ctx.fillText(head, pad, pad + 12);
  const security = Security.LEVELS[r.security]; // how dangerous it is here (world/security.js)
  ctx.fillStyle = security.color;
  ctx.fillText(`SECURITY ${security.label.toUpperCase()}`, pad + ctx.measureText(head).width, pad + 12);
  if (r.nebula) {
    ctx.fillStyle = r.nebula.color;
    ctx.fillText(`${r.nebula.name} · sensors dampened`, pad, pad + 28);
  } else if (r.near) {
    ctx.fillStyle = COLORS.neutral;
    ctx.fillText(`Near ${r.near.name}`, pad, pad + 28);
  }
  // The mission's next step.
  const obj = here.objective;
  if (obj) {
    ctx.fillStyle = COLORS.amber;
    ctx.fillText(`◇ ${obj.text}`, pad, pad + 46);
  }

  if (!interacted && !intro.on) { // the introduction has its own hint
    const y0 = pad + (obj ? 74 : 56);
    ctx.fillStyle = COLORS.hud;
    ctx.globalAlpha = 0.6 + 0.3 * Math.sin(performance.now() / 400);
    const direct = moveMode.value === 'direct';
    ctx.fillText(direct ? 'Hold and drag to fly; drag length sets speed' : 'Drag to fly; drag length sets speed', pad, y0);
    ctx.fillText(direct ? 'Let go to stop' : 'Tap empty space to stop', pad, y0 + 16);
    ctx.fillText('Tap a station, asteroid or ship for options', pad, y0 + 32);
  }
  ctx.restore();
}

// ---------- Main loop ----------

// What follows from where things are after a step: pickups, the selection, pirates noticing the
// ship, and the objective shown on the map. Not while paused, so nothing is picked up behind the
// settings menu.
function react(list) {
  collectItems(list);
  updateSelection(list);
  checkAggro(list);
  const obj = here.objective = objective();
  SystemMap.objective = obj && { x: obj.x, y: obj.y, label: obj.text, station: obj.station ? obj.station.station.id : null };
}

function render(list = nearbyEntities(simTime)) {
  if (!here.region) here.region = world.galaxy.regionAt(ship.x, ship.y); // drawn before the first step
  Art.beginFrame();
  const t = simTime;
  updateCombatPanel();
  origin.x = Math.round(cam.x / 5000) * 5000;
  origin.y = Math.round(cam.y / 5000) * 5000;

  ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, view.w, view.h);
  drawStarfield();

  ctx.save();
  ctx.translate(view.w / 2, view.h / 2);
  ctx.scale(view.zoom, view.zoom);
  ctx.translate(-rx(cam.x), -ry(cam.y));
  drawEntities(list, t);
  drawSelection(t);
  drawFight();
  drawDebris();
  drawMining(t);
  drawGateWork(t);
  drawParticles();
  if (intro.on) drawTractorBeam(t);
  drawShip(t);
  ctx.restore();

  if (flash > 0) {
    ctx.fillStyle = `rgba(210, 240, 255, ${flash * flash * 0.85})`;
    ctx.fillRect(0, 0, view.w, view.h);
  }
  drawLabels(list);
  drawMiningCountdown();
  drawFightOverlay();
  if (toast.t > 0) {
    ctx.save();
    ctx.globalAlpha = Math.min(1, toast.t / 0.6) * 0.9;
    ctx.fillStyle = COLORS.hud;
    ctx.font = Theme.font(14);
    ctx.textAlign = 'center';
    ctx.fillText(toast.text.toUpperCase(), view.w / 2, view.h * 0.22);
    ctx.restore();
  }
  if (hudShown()) drawNavMarkers();
  else navHits = [];
  drawFoeMarkers();
  drawDragIndicator();
  if (hudShown()) {
    drawMinimap(list);
    drawHud();
  }
  if (SystemMap.perf) drawPerf();
}

// ---------- Performance overlay (?perf or ?dev, toggled with P) ----------

const PERF_FRAMES = 60;
const perfStats = {
  posed: 0, drawn: 0, // entities posed (near the camera) and drawn (on screen) last frame
  work: new Float32Array(PERF_FRAMES), gap: new Float32Array(PERF_FRAMES), i: 0, // ms per frame
  rates: { builds: 0, asteroidBuilds: 0, deferred: 0 }, prev: null, prevT: 0, // sprite builds per second
};
function recordFrame(workMs, gapMs) {
  perfStats.work[perfStats.i] = workMs;
  perfStats.gap[perfStats.i] = gapMs;
  perfStats.i = (perfStats.i + 1) % PERF_FRAMES;
}
function drawPerf() {
  const now = performance.now();
  const s = Art.stats(), b = ArtBodies.stats();

  if (!perfStats.prev || now - perfStats.prevT >= 1000) {
    if (perfStats.prev) {
      const secs = (now - perfStats.prevT) / 1000;
      perfStats.rates = {
        builds: (s.builds - perfStats.prev.builds) / secs, asteroidBuilds: (s.asteroidBuilds - perfStats.prev.asteroidBuilds) / secs,
        deferred: (s.deferred - perfStats.prev.deferred) / secs,
      };
    }
    perfStats.prev = s;
    perfStats.prevT = now;
  }
  let sum = 0, worst = 0, gaps = 0;
  for (let i = 0; i < PERF_FRAMES; i++) { sum += perfStats.work[i]; worst = Math.max(worst, perfStats.work[i]); gaps += perfStats.gap[i]; }
  const fps = gaps > 0 ? (1000 * PERF_FRAMES) / gaps : 0;
  const lines = [
    `frame ${(sum / PERF_FRAMES).toFixed(1)} ms avg · ${worst.toFixed(1)} worst · ${Math.round(fps)} fps`,
    `entities ${perfStats.posed} posed · ${perfStats.drawn} drawn · ${starCount} stars`,
    `sprites ${s.sprites} cached · ${Math.round((s.spritePixels * 4) / 1e6)} MB · ${Math.round(perfStats.rates.builds)} built/s · ${Math.round(perfStats.rates.deferred)} waited/s`,
    `asteroids ${s.asteroids} cached · ${Math.round((s.asteroidPixels * 4) / 1e6)} MB · ${Math.round(perfStats.rates.asteroidBuilds)} built/s`,
    `moons and nebulae ${b.sprites} cached · ${Math.round((b.pixels * 4) / 1e6)} MB · ${b.builds} built`,
  ];
  ctx.save();
  ctx.font = Theme.font(11);
  ctx.fillStyle = 'rgba(12, 15, 24, 0.85)';
  ctx.fillRect(8, 92, 360, lines.length * 15 + 8);
  ctx.fillStyle = COLORS.cyan;
  lines.forEach((l, i) => ctx.fillText(l, 14, 108 + i * 15));
  ctx.restore();
}

// While paused (the settings menu), the frame is drawn once and then left as it is until
// something changes it (invalidate: a setting, a resize).
let stillDrawn = false;
function invalidate() { stillDrawn = false; }

let last = performance.now();
function frame(now) {
  const dt = Math.min((now - last) / 1000, 0.05);
  const gap = now - last;
  last = now;
  const t0 = performance.now();
  tickTravel(dt);
  if (!SystemMap.isOpen && !docked) { // the map overlay and docking pause flight
    const paused = Settings.isOpen; // the settings menu pauses it too, but keeps it drawn
    if (!paused) {
      update(dt);
      stillDrawn = false;
    }
    if (!stillDrawn) {
      const list = nearbyEntities(simTime);
      if (!paused) react(list);
      render(list);
      stillDrawn = paused;
      recordFrame(performance.now() - t0, gap);
    }
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
