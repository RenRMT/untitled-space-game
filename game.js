'use strict';

// ---------- Setup ----------

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const { TAU, clamp, lerp } = MathUtil;

// Each galaxy map sector is a square play area this many world units across (the galaxy's
// sectorUnits, set in data/galaxy-config.js). World coordinates run across the whole galaxy;
// drawing happens relative to the camera's sector to keep precision.
let SECTOR = 6000;

const COLORS = Theme.color; // theme.js, shared with the map and the CSS

// The ship's class and fitted equipment (loadout.js), and what they add up to: handling, hold,
// sensor ranges, mining speed. Starter gear only for now, so the loadout isn't saved yet.
const loadout = Loadout.starter('courier');
const SHIP = Loadout.stats(loadout);

const ship = {
  x: 0, y: 0,
  vx: 0, vy: 0,
  angle: -Math.PI / 2,
  targetAngle: -Math.PI / 2,
  targetSpeed: 0,
  thrust: 0,
};

const view = { w: 0, h: 0, dpr: 1, zoom: 1 };
const cam = { x: 0, y: 0 };
const particles = [];
const debris = []; // rock fragments thrown off by mining, in world units
const mining = { target: null, t: 0 }; // the asteroid being mined, and seconds mined so far
// Approach: fly to the selected object and stop beside it (or keep station with a moving ship).
// key: entityKey of the target; e: that entity this frame; stop: distance to stop at; follow: never finishes.
const autopilot = { key: null, e: null, stop: 0, follow: false };
// Combat (combat-core.js; the modes in combat.js and combat-realtime.js): s is the fight in progress
// (null when none) and mode the kind it is (a COMBAT key); ships holds the enemies' poses by key
// (held in rounds, flown in real time); fx the queued and running effects (beams, flashes, numbers, explosions);
// result/resultT keep the outcome on the panel for a moment; grace keeps pirates off after
// fleeing or respawning; wreckT counts down while the destroyed player ship is towed.
// final and lastShips keep the ended fight's state and enemy poses for the panel and late effects;
// wrecked hides the player ship between its explosion and the tow. returning: enemies that
// survived a real-time fight, flying back to their usual paths (by key).
const fight = {
  s: null, mode: 'rounds', ships: new Map(), fx: [], log: [], result: null, resultT: 0, grace: 0, wreckT: 0,
  final: null, lastShips: new Map(), wrecked: false, returning: new Map(),
};
const inFight = () => !!fight.s || fight.wreckT > 0;
const fightMode = () => COMBAT[fight.mode];
const flyingFight = () => !!fight.s && fightMode().flying; // flying is allowed
let simTime = 0; // advances only while flying, so the map pause doesn't make traffic jump
let gateFlash = 0; // white-out after a gate jump, fading from 1
let gateLock = null; // the gate just arrived through, ignored until the ship leaves its aperture
const toast = { text: '', t: 0 }; // short centre-screen notice, fading out
// Show a notice for t seconds. once: leave the same notice alone while it's still showing, so
// something checked every frame doesn't keep restarting it.
const notify = (text, t = 2, { once = false } = {}) => {
  if (once && toast.text === text && toast.t >= 0.5) return;
  toast.text = text;
  toast.t = t;
};
let lastPocket; // key of the pocket the ship was in last frame ('' = none), for enter/leave notices
let senseTimer = 0;

const { turnToward } = Flight;

function resize() {
  view.dpr = Math.min(window.devicePixelRatio || 1, 2);
  view.w = window.innerWidth;
  view.h = window.innerHeight;
  canvas.width = Math.round(view.w * view.dpr);
  canvas.height = Math.round(view.h * view.dpr);
  view.zoom = clamp(Math.min(view.w, view.h) / 800, 0.55, 1.2);
}
window.addEventListener('resize', resize);
resize();

// ---------- Settings: art style, movement, combat and map style (settings.js menu) ----------

// A saved choice among `options` (store.js; a URL parameter of the same name overrides the saved
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
// Both turn and change speed by the engine's numbers (flight.js).
// Switching stops the ship, so it doesn't carry on under rules it wasn't set with.
const MOVE_MODES = ['cruise', 'direct'];
const moveMode = setting('move', MOVE_MODES, 'cruise', () => { ship.targetSpeed = 0; autopilot.key = null; });

// Combat: automatic rounds with the ships stopped (combat.js), or real-time, flying throughout
// (combat-realtime.js). Each fight keeps the mode it started in; the menu is closed during fights.
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
Settings.add({
  id: 'start', label: 'Map',
  choices: [
    { value: 'core', label: 'Core start', hint: 'Start at the central capital, with its network of lanes and gates charted.' },
    { value: 'frontier', label: 'Frontier start', hint: 'Start at a lone Waystation by the edge of the map, with nothing else charted.' },
  ],
  note: 'Switching keeps this galaxy and moves you to that start. Each map keeps its own charts and cargo.',
  get: () => GalaxyMap.startStyle, set: (v) => GalaxyMap.setStartStyle(v),
});

// The menu pauses flight but keeps drawing it, so a new art style shows behind the panel.
const settingsBtn = document.getElementById('settings-btn');
settingsBtn.addEventListener('click', () => { if (!inFight() && !docked) Settings.open(); });
Settings.onToggle = (open) => {
  GalaxyMap.blocked = open; // no map on top of the menu
  settingsBtn.setAttribute('aria-expanded', String(open));
  if (open) drag.active = false;
};

// Keyboard shortcuts. An action's key (F to dock, E to mine: see `actions` below) acts on the
// selected object, or else on the nearest one in reach.
window.addEventListener('keydown', (e) => {
  if (GalaxyMap.isOpen || docked) return;
  // With no buttons showing them any more, the V and C shortcuts say what they switched to.
  if (e.key === 'v' || e.key === 'V') { artStyle.cycle(); notify(`Art style: ${Art.STYLES.find((s) => s.id === artStyle.value).label}`); }
  if (e.key === 'c' || e.key === 'C') { moveMode.cycle(); notify(`Movement: ${moveMode.value === 'cruise' ? 'Cruise' : 'Direct'}`); }
  if (e.key === 'Escape') select(null);
  const a = actions.forKey(e.key);
  const target = a && actions.target(a, selected && selected.e, frameList);
  if (target) a.run(target);
});

ship.art = ArtBlueprints.playerShip(ArtCulture.legacy);

// ---------- World: sectors generated from the galaxy map ----------

const world = { galaxy: null, cultures: null, sectors: null, knowledge: null, travel: null, w: 0, h: 0 };

// ---------- Cargo hold and credits: items collected or bought, saved per galaxy ----------

// items: { kind (art/items.js id), label, category: 'loot' | 'trade' }, one hold unit each.
// removed: keys of generated things gone from the world for good: items collected, asteroids
// broken up by mining, ships destroyed in combat (keys are unique across kinds). drops: items
// left floating by mining, destroyed ships or the player's own lost cargo, not yet collected
// (item entities; each keeps its saved form in `drop`). hull: the player ship's hull points
// (repaired at stations). home: the last station docked at, where a lost ship is towed.
const cargo = { key: '', items: [], removed: new Set(), credits: 0, drops: [], hull: 0, home: null };
const PICKUP_RANGE = 24; // world units beyond the item's own size
// " · rare" after an item's name in notices, for anything better than common.
const rarityNote = (e) => (e.art.rarity > 1 ? ` · ${Goods.RARITY[e.art.rarity].label.toLowerCase()}` : '');

// A floating item from its saved form { key, kind (a goods.js type), seed, x, y }.
function dropEntity(d) {
  const r = mulberry32(d.seed);
  return { ...Entities.item({ key: d.key, kind: d.kind, seed: d.seed, x: d.x, y: d.y, angle: r() * TAU, tumble: (r() - 0.5) * 0.3 }), drop: d };
}

// An item record from a save, brought up to date: saves from before item types stored a category
// ('metal') or only a label, which become that category's commonest type (Goods.resolve).
function upgradeItem(it) {
  const kind = Goods.resolve(it.kind, it.label);
  if (!kind) return null;
  const t = Goods.type(kind);
  return { kind, label: t.name, category: Goods.isSalvage(kind) ? 'loot' : 'trade' };
}

function loadCargo(galaxy) {
  if (cargoSave.timer !== null) saveCargoNow(); // the old galaxy's cargo first
  cargo.key = `cargo:${Galaxy.saveKey(galaxy)}`;
  cargo.items = [];
  cargo.removed = new Set();
  cargo.credits = Economy.config.startingCredits;
  cargo.drops = [];
  cargo.hull = SHIP.hull;
  cargo.home = null;
  if (Params.has('fresh')) Store.remove(cargo.key);
  const d = Store.getJSON(cargo.key);
  if (!d) return;
  try {
    cargo.items = d.items.map(upgradeItem).filter(Boolean);
    // Older saves kept collected items, mined asteroids and destroyed ships in three lists.
    cargo.removed = new Set([d.removed, d.collected, d.mined, d.destroyed].filter(Array.isArray).flat());
    if (Number.isFinite(d.credits)) cargo.credits = d.credits;
    if (Array.isArray(d.drops)) {
      cargo.drops = d.drops.filter((x) => x && Goods.resolve(x.kind, x.label))
        .map((x) => dropEntity({ key: x.key, kind: Goods.resolve(x.kind, x.label), seed: x.seed, x: x.x, y: x.y }));
    }
    if (Number.isFinite(d.hull)) cargo.hull = clamp(d.hull, 1, SHIP.hull);
    if (d.home && Number.isFinite(d.home.x)) cargo.home = d.home;
  } catch (e) { /* a damaged save: keep what was read before the error */ }
}
// Cargo is saved CARGO_SAVE_MS after the first change, so a burst of changes (Sell all, hull
// damage in a fight) is one write; and when the page is hidden or closed, or another galaxy
// loads. Storage unavailable: cargo lasts for this session only (store.js).
const CARGO_SAVE_MS = 1000;
const cargoSave = { timer: null };
function saveCargo() {
  if (cargoSave.timer === null) cargoSave.timer = setTimeout(saveCargoNow, CARGO_SAVE_MS);
}
function saveCargoNow() {
  clearTimeout(cargoSave.timer);
  cargoSave.timer = null;
  Store.setJSON(cargo.key, {
    items: cargo.items, removed: [...cargo.removed], credits: cargo.credits,
    drops: cargo.drops.map((e) => e.drop), hull: cargo.hull, home: cargo.home,
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

function collectItems(list) {
  for (const e of list) {
    if (e.kind !== 'item' || cargo.removed.has(e.key)) continue;
    if (Math.hypot(ship.x - e.x, ship.y - e.y) > e.radius * 0.7 + PICKUP_RANGE) continue;
    if (hold.free < 1) {
      notify('Cargo hold full', 2.5, { once: true }); // and leave it floating
      continue;
    }
    if (e.drop) cargo.drops.splice(cargo.drops.indexOf(e), 1);
    else cargo.removed.add(e.key);
    cargo.items.push({ kind: e.itemKind, label: e.label, category: e.category });
    notify(`Recovered: ${e.label}${rarityNote(e)}`, 2.5);
    saveCargo();
  }
}

function sectorOf(x, y) {
  return [clamp(Math.floor(x / SECTOR), 0, world.galaxy.size - 1), clamp(Math.floor(y / SECTOR), 0, world.galaxy.size - 1)];
}

// Put the ship at a world position, at rest.
function placeShip(x, y, angle = -Math.PI / 2) {
  ship.x = clamp(x, SHIP.radius, world.w - SHIP.radius);
  ship.y = clamp(y, SHIP.radius, world.h - SHIP.radius);
  ship.vx = ship.vy = 0;
  ship.targetSpeed = 0;
  ship.angle = ship.targetAngle = angle;
  cam.x = ship.x;
  cam.y = ship.y;
  particles.length = 0;
  debris.length = 0;
  stopMining();
  autopilot.key = null;
  gateLock = null;
  lastPocket = undefined; // no enter/leave notice for a teleport
  world.knowledge.sense(ship.x / SECTOR, ship.y / SECTOR, SHIP.sensorRange, SHIP.pingRange);
}

// Place the ship in a sector, beside its main station when there is one.
function moveShipTo(sx, sy) {
  const sec = world.sectors.at(sx, sy);
  const stations = sec.entities.filter((e) => e.kind === 'station').sort((a, b) => b.radius - a.radius);
  const s = stations[0];
  placeShip(s ? s.x : (sx + 0.5) * SECTOR, s ? s.y + s.radius + 220 : (sy + 0.5) * SECTOR);
}

// Drop the ship short of whatever is in a deep-space sector, facing it.
function dropNearContact(cell, dir) {
  const sec = world.sectors.at(cell.x, cell.y);
  const things = sec.entities.filter((e) => e.kind !== 'gate' && e.kind !== 'station' && e.kind !== 'star');
  for (const e of things) Sectors.pose(e, simTime);
  const cx = things.length ? things.reduce((a, e) => a + e.x, 0) / things.length : (cell.x + 0.5) * SECTOR;
  const cy = things.length ? things.reduce((a, e) => a + e.y, 0) / things.length : (cell.y + 0.5) * SECTOR;
  placeShip(cx - Math.cos(dir) * 1600, cy - Math.sin(dir) * 1600, dir);
}

function loadGalaxy(galaxy) {
  if (world.knowledge) world.knowledge.save(); // keep the old galaxy's charts before switching
  world.galaxy = galaxy;
  SECTOR = galaxy.sectorUnits;
  world.cultures = ArtCulture.forGalaxy(galaxy);
  world.sectors = Sectors.create(galaxy, world.cultures, SECTOR);
  world.w = world.h = galaxy.size * SECTOR;
  // What the player knows (fog of war); ?fresh forgets saved charts.
  world.knowledge = Knowledge.create(galaxy, { fresh: Params.has('fresh') });
  loadCargo(galaxy);
  GalaxyMap.knowledge = world.knowledge;
  world.travel = Travel.create(galaxy, world.knowledge);
  GalaxyMap.trip = world.travel;
  Art.clearCache();
  const start = galaxy.systems[galaxy.startSystem];
  moveShipTo(start.x, start.y);
  GalaxyMap.setPlayer(ship.x / SECTOR, ship.y / SECTOR);
}
loadGalaxy(GalaxyMap.galaxy);
GalaxyMap.onLoad = loadGalaxy; // re-rolled on the map
// Knowledge and cargo save on a short debounce; write them out when the page is hidden or closed.
function saveAll() {
  world.knowledge.save();
  if (cargoSave.timer !== null) saveCargoNow();
}
window.addEventListener('pagehide', saveAll);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') saveAll(); });
GalaxyMap.onJump = (x, y) => moveShipTo(x, y);

// ---------- Docking: stop near a station, dock, trade, launch ----------

const DOCK = { range: 320, maxSpeed: 150 }; // range: world units beyond the station's radius
let docked = null; // { station } while docked; flight is paused and the station menu is open

// Whether the player may dock at a station. Everyone is welcome for now; faction reputation
// (refusing hostile factions, say) belongs here: return { ok: false, reason: 'Docking refused' }.
function canDock(station) {
  return { ok: true, reason: '' };
}

// Distance from the ship to an object's edge.
const gapTo = (e) => Math.hypot(ship.x - e.x, ship.y - e.y) - e.radius;
const shipSpeed = () => Math.hypot(ship.vx, ship.vy);

// What the player can do with things in space (interactions.js): each action is added next to its
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
  saveCargo();
  ship.vx = ship.vy = 0;
  ship.targetSpeed = 0;
  ship.thrust = 0;
  drag.active = false;
  particles.length = 0;
  GalaxyMap.blocked = true;
  document.body.classList.add('docked');
  StationMenu.open({
    station: { name: station.name, subtitle: Entities.stationSubtitle(station, world.galaxy), color: station.color },
    market: Economy.market(world.galaxy.seed, station),
    hold,
    ship: SHIP,
    loadout,
    repairs,
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
  GalaxyMap.blocked = false;
  document.body.classList.remove('docked');
  const a = Math.atan2(ship.y - st.y, ship.x - st.x);
  const d = st.radius + 180;
  placeShip(st.x + Math.cos(a) * d, st.y + Math.sin(a) * d, a);
  notify(`Launched from ${st.name}`, 2.5);
}

// ---------- Mining: stop by an asteroid, mine it, collect what it leaves behind ----------

const MINE_COLOR = COLORS.busy;

// Seconds to mine an asteroid: the base time, sped up by the ship computer.
function mineTime() {
  return Mining.config.duration / (SHIP.miningRate || 1);
}

// Called on teleports, docking and when the ship drifts away. Must not touch anything declared
// below: placeShip runs it while the galaxy first loads.
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
  if (mining.target.key !== a.key) return { ok: false, label: 'Mine · busy', inRange: true };
  return {
    ok: false, busy: true, inRange: true, progress: mining.t / mineTime(),
    label: `Mining · ${Math.max(1, Math.ceil(mineTime() - mining.t))} sec`,
  };
}

function startMining(a) {
  if (docked || inFight() || !actions.state('mine', a).ok) return;
  mining.target = a;
  mining.t = 0;
  autopilot.key = null;
  ship.targetSpeed = 0; // all stop, so the ship stays in range
}

actions.add({
  id: 'mine', kind: 'asteroid', verb: 'Mine', key: 'e', range: () => Mining.config.range, maxSpeed: () => Mining.config.maxSpeed,
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

// Rock chips thrown off an asteroid: a few while mining, a burst when it breaks up.
function chips(a, n, speed) {
  const colors = (Art.ASTEROIDS[a.ast.type] || Art.ASTEROIDS.stony).c;
  burst(a.x, a.y, n, { spread: a.radius * 0.6, speed: [speed * 0.3, speed], life: [0.5, 1.4], size: [1.5, 1.5 + Math.min(5, a.radius / 8)], colors });
}

function finishMining() {
  const a = mining.target;
  stopMining();
  cargo.removed.add(a.key);
  chips(a, 14 + Math.round(a.radius * 0.6), 120 + a.radius * 3);
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
    stopMining('Mining interrupted');
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

// Where a finished trip leaves the ship, and what it says.
function finishTrip(ev) {
  if (!ev) return;
  const { dest } = ev;
  const destCell = { x: Math.floor(dest.x), y: Math.floor(dest.y) };
  let text;
  if (ev.type === 'arrive' && (dest.kind === 'system' || dest.kind === 'outpost')) {
    moveShipTo(destCell.x, destCell.y);
    text = `Arrived at ${dest.name}`;
  } else if (ev.type === 'arrive' && world.galaxy.deepSector(destCell.x, destCell.y)) {
    dropNearContact(destCell, ev.dir);
    text = `Arrived at ${dest.name}`;
  } else if (ev.type === 'interdict' || ev.type === 'investigate') {
    dropNearContact(ev.cell, ev.dir);
    text = ev.type === 'interdict' ? 'Interdicted! Hostile contact' : `Investigating the ${Galaxy.CONTACT_TYPES[ev.contact.type]?.name || 'signal'}`;
  } else {
    placeShip(ev.pos.x * SECTOR, ev.pos.y * SECTOR, ev.dir);
    text = ev.type === 'arrive' ? `Arrived at ${dest.name}` : 'Dropped out of cruise';
  }
  notify(text, 3);
  GalaxyMap.setPlayer(ship.x / SECTOR, ship.y / SECTOR);
  GalaxyMap.close();
}

GalaxyMap.hooks = {
  travel(dest) {
    world.travel.start({ x: ship.x / SECTOR, y: ship.y / SECTOR }, dest);
    GalaxyMap.redraw();
  },
  stop: () => finishTrip(world.travel.stop()),
  fast() { world.travel.toggleFast(); GalaxyMap.redraw(); },
  investigate: () => finishTrip(world.travel.investigate()),
  ignore() { world.travel.ignore(); GalaxyMap.redraw(); },
};

// Advance a trip; runs while the map is open. Closing the map drops out of cruise.
function tickTravel(dt) {
  if (!world.travel.active) return;
  if (!GalaxyMap.isOpen) { finishTrip(world.travel.stop()); return; }
  const ev = world.travel.step(dt);
  const p = world.travel.pos;
  if (p) GalaxyMap.setPlayer(p.x, p.y);
  if (ev && ev.type !== 'prompt') finishTrip(ev);
  else GalaxyMap.redraw();
}

// Entities of the sectors around the camera, posed for time t.
function nearbyEntities(t) {
  const [cx, cy] = sectorOf(cam.x, cam.y);
  const out = [];
  for (let y = cy - 1; y <= cy + 1; y++) {
    for (let x = cx - 1; x <= cx + 1; x++) {
      const sec = world.sectors.at(x, y);
      if (!sec) continue;
      for (const e of sec.entities) {
        if (cargo.removed.has(e.key)) continue;
        const held = e.kind === 'ship' && (fight.ships.get(e.key) || fight.returning.get(e.key));
        if (held) Object.assign(e, { x: held.x, y: held.y, a: held.a, thrust: held.thrust || 0 }); // fighting, or flying back
        else Sectors.pose(e, t);
        out.push(e);
      }
    }
  }
  // Floating items left by mining, combat or a lost ship live outside the generated sectors.
  for (const e of cargo.drops) {
    const [dx, dy] = sectorOf(e.x, e.y);
    if (Math.abs(dx - cx) > 1 || Math.abs(dy - cy) > 1) continue;
    Sectors.pose(e, t);
    out.push(e);
  }
  return out;
}

// nearbyEntities() needs the 3×3 sectors around the camera, so crossing a sector edge would build
// a whole new row of them in one frame (up to 21 ms each). Within PREFETCH_EDGE of an edge, build
// the sectors beyond it ahead of time instead, one per frame.
const PREFETCH_EDGE = 0.25; // of a sector
function prefetchSectors() {
  const [cx, cy] = sectorOf(cam.x, cam.y);
  const fx = cam.x / SECTOR - cx, fy = cam.y / SECTOR - cy; // where in its sector the camera is, 0..1
  const dx = fx < PREFETCH_EDGE ? -1 : fx > 1 - PREFETCH_EDGE ? 1 : 0;
  const dy = fy < PREFETCH_EDGE ? -1 : fy > 1 - PREFETCH_EDGE ? 1 : 0;
  if (!dx && !dy) return;
  const size = world.galaxy.size;
  for (const [nx, ny] of [[cx + dx, cy], [cx, cy + dy], [cx + dx, cy + dy]]) {
    if (nx === cx && ny === cy) continue;
    for (let y = ny - 1; y <= ny + 1; y++) {
      for (let x = nx - 1; x <= nx + 1; x++) {
        if (x < 0 || y < 0 || x >= size || y >= size || world.sectors.has(x, y)) continue;
        world.sectors.at(x, y);
        return;
      }
    }
  }
}

// ---------- Gates: flying into the aperture jumps to the gate at the other end ----------

// The gate at the other end of a gate's route.
const partnerGate = (g) => world.sectors.at(g.dest.x, g.dest.y).entities.find((e) => e.kind === 'gate' && e.link === g.link);

// Returns true when the ship jumped.
function checkGates(list) {
  if (inFight()) { // no jumping out of a fight
    if (toast.t < 0.3 && list.some((g) => g.kind === 'gate' && Math.hypot(ship.x - g.x, ship.y - g.y) <= g.aperture * 0.7)) notify('Gate locked · in combat');
    return false;
  }
  for (const g of list) {
    if (g.kind !== 'gate') continue;
    const d = Math.hypot(ship.x - g.x, ship.y - g.y);
    if (gateLock === g.key) {
      if (d > g.aperture + 80) gateLock = null;
      continue;
    }
    if (d > g.aperture * 0.7) continue;
    const there = partnerGate(g);
    if (!there) continue;
    // Keep the offset within the aperture and the velocity, so the ship carries straight through.
    const dx = there.x - g.x, dy = there.y - g.y;
    ship.x += dx; ship.y += dy;
    cam.x += dx; cam.y += dy;
    particles.length = 0;
    gateLock = there.key;
    gateFlash = 1;
    world.knowledge.knowRoute(g.link); // using a gate charts its route, hidden ones included
    return true;
  }
  return false;
}

// Jumping from the context card: no need to thread the aperture, just be close.
const JUMP = { range: 500 }; // world units beyond the gate's radius

// Come out on the system side of the gate at the other end, heading into the system.
function jumpVia(g) {
  if (inFight() || !actions.state('jump', g).ok) return;
  const there = partnerGate(g);
  if (!there) return;
  const out = there.angle + Math.PI;
  const d = there.aperture + 160;
  placeShip(there.x + Math.cos(out) * d, there.y + Math.sin(out) * d, out);
  gateLock = there.key;
  gateFlash = 1;
  world.knowledge.knowRoute(g.link);
  select(null);
  const sys = world.galaxy.systems.find((s) => s.x === g.dest.x && s.y === g.dest.y);
  notify(sys ? `Jumped to ${sys.name}` : 'Jumped', 2.5);
}

actions.add({ id: 'jump', kind: 'gate', verb: 'Jump', range: () => JUMP.range, run: jumpVia });

// ---------- Selection: tap something for its context card ----------

// Tapping a station, gate, asteroid or ship selects it: a bracket marks it in space and the
// context card (context.js) offers what can be done there. Off-screen gates are selected by
// tapping their marker at the screen edge. A tap on empty space clears the
// selection (and, in Cruise mode, stops the ship as before).
const TAP_SLOP = 26; // CSS px of forgiveness around a tap target
const SELECT_COLOR = COLORS.cyan;
const HOSTILE_COLOR = COLORS.hostile;
let selected = null; // { key, e }: the selected entity, found again by key every frame
let frameList = []; // the entities posed last frame, for hit-testing taps

// What each kind of thing is: draw order, labels, the minimap, the context card (entities.js).
const KINDS = Entities.KINDS;

// A stable identity for anything selectable, or null.
const entityKey = (e) => (KINDS[e.kind].selectable && e.key ? `${e.kind}:${e.key}` : null);

// How far from its centre a tap still hits the object (for stations and gates only their core).
const hitRadius = (e) => e.radius * (KINDS[e.kind].hit || 1);

const screenToWorld = (sx, sy) => [(sx - view.w / 2) / view.zoom + cam.x, (sy - view.h / 2) / view.zoom + cam.y];

// The object under a tap. When several overlap, the one whose centre is relatively closest wins,
// so a ship passing in front of a station gets picked over the station.
function pickAt(sx, sy) {
  const marker = navMarkerAt(sx, sy); // off-screen gates, by their edge marker
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

const isHostile = (e) => Entities.isHostile(e, world.galaxy);
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
  return {
    title: card.title, subtitle: `${card.sub} · ${fmtDist(gapTo(e))}`, color: card.color, tag: card.tag || '', tone: card.tone || '',
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

// ---------- Combat: against hostile ships, in rounds (combat.js) or real time (combat-realtime.js) ----------

// A fight starts from a hostile ship's Attack button, or when pirates catch the ship within
// their aggro range. Every pirate near the one engaged joins in. The combat panel
// (combat-panel.js) shows the state; tap an enemy, or its row, to target it. The Combat setting
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
//   station it docked at (or the start system), with the hull patched up.
// Pirates that survive a real-time fight fly back to their usual paths.
const FLEE_GRACE = 12; // seconds the pirates leave you alone after you get away
const RESPAWN_GRACE = 8;
const SHOT_COLOR = { player: COLORS.cyan, enemy: COLORS.hostile };
const LETTERS = 'ABCDEFGHIJKL'; // tell same-role ships apart, on the panel and above the ships

// Where a combatant is: the player ship, or an enemy's pose.
function fighterPos(id) {
  if (id === 'player') return { x: ship.x, y: ship.y, radius: SHIP.radius };
  return fight.ships.get(id) || fight.lastShips.get(id) || null;
}
// Effects are attached to a combatant (by id, so they follow it) or to a fixed point.
const fxPos = (v) => (typeof v === 'string' ? fighterPos(v) : v);

// An entity's velocity along its usual path, from where it will be a moment later.
function pathVelocity(e) {
  if (!e.motion) return [0, 0];
  const next = { motion: e.motion };
  Sectors.pose(next, simTime + 0.1);
  return [(next.x - e.x) / 0.1, (next.y - e.y) / 0.1];
}

const shipName = (e, i, n) => `${Entities.ROLE_LABEL[e.role] || 'Ship'}${n > 1 ? ` ${LETTERS[i] || i + 1}` : ''}`;
const fightLog = (line) => { fight.log = [...fight.log, line].slice(-2); };

// An enemy as the flight view keeps it during a fight: its pose (held facing you, or flown on)
// and what's needed to draw it, loot it and send it home afterwards.
function heldPose(e, name) {
  const a = fightMode().flying ? e.a : Math.atan2(ship.y - e.y, ship.x - e.x);
  return { x: e.x, y: e.y, a, thrust: 0, role: e.role, radius: e.radius, name, motion: e.motion };
}

// A ship as a combat mode takes it: its stats and how it is flying right now.
function enemySpec(e, name) {
  const back = fight.returning.get(e.key); // still flying back from an earlier fight
  const [vx, vy] = back ? [back.vx, back.vy] : pathVelocity(e);
  return { id: e.key, name, stats: Loadout.stats(Loadout.starter(e.role)), body: { x: e.x, y: e.y, vx, vy, angle: e.a, radius: e.radius } };
}

function engage(target, ambushed = false) {
  if (inFight() || docked || !isHostile(target)) return;
  if (!ambushed && !actions.state('attack', target).ok) return;
  const group = frameList.filter((e) => isHostile(e) && e !== target
    && Math.hypot(e.x - target.x, e.y - target.y) <= CombatCore.config.groupRange);
  group.unshift(target);
  const names = group.map((e, i) => shipName(e, i, group.length));
  const rng = mulberry32((Math.random() * 4294967296) >>> 0);
  fight.mode = combatMode.value;
  const m = fightMode();
  const player = {
    id: 'player', name: `${SHIP.name} (you)`, stats: SHIP, hull: cargo.hull,
    body: { x: ship.x, y: ship.y, vx: ship.vx, vy: ship.vy, angle: ship.angle, radius: SHIP.radius },
  };
  fight.s = m.start(rng, player, group.map((e, i) => enemySpec(e, names[i])), { target: target.key, ambushed });
  if (!m.flying) ship.targetSpeed = 0;
  fight.ships = new Map(group.map((e, i) => [e.key, heldPose(e, names[i])]));
  for (const e of group) fight.returning.delete(e.key);
  fight.log = [ambushed ? 'Pirates attack!' : `You engage the ${names[0]}.`];
  fight.result = null;
  stopMining();
  autopilot.key = null;
  select(null);
  GalaxyMap.blocked = true;
  document.body.classList.add('in-combat');
  notify(ambushed ? 'Pirates attack!' : 'Combat');
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
  const near = (e) => isHostile(e) && Math.hypot(e.x - ship.x, e.y - ship.y) - e.radius <= CombatCore.config.aggroRange;
  if (fight.s && fightMode().join) {
    for (const e of list) if (!fight.ships.has(e.key) && near(e)) joinFight(e);
    return;
  }
  if (inFight() || fight.grace > 0) return;
  for (const e of list) {
    if (near(e)) { engage(e, true); return; }
  }
}

// Show a fight's events as its mode's `look` says (combat-core.js): a beam per shot (a miss streaks
// past), a shield flash, sparks off the hull, damage numbers (one per volley, with misses, or adding
// up on a ship that keeps taking hits) and, when a ship is destroyed, its explosion. Then the
// panel's lines. Effects follow their ship by id; delays stagger a round's volleys.
function playEvents(s, events) {
  const look = fightMode().look;
  const jitter = () => (Math.random() - 0.5) * 30; // so numbers landing together don't overlap
  for (const ev of events) {
    if (ev.type !== 'shot') continue;
    const mine = ev.from === 'player', d = ev.delay || 0, hit = d + look.after;
    fight.fx.push({ type: 'beam', delay: d, t: look.beam, max: look.beam, from: ev.from, to: ev.to, hits: ev.hits, color: mine ? SHOT_COLOR.player : SHOT_COLOR.enemy });
    if (ev.shieldDamage > 0) fight.fx.push({ type: 'shield', delay: hit, t: look.shield, max: look.shield, at: ev.to });
    if (ev.hullDamage > 0) fight.fx.push({ type: 'sparks', delay: hit, at: ev.to, n: look.sparks(ev) });
    if (look.sum) { if (ev.damage > 0) addDamage(ev.to, ev.damage, ev.hullDamage > 0); }
    else if (ev.damage > 0) fight.fx.push({ type: 'number', delay: hit, t: 1, max: 1, at: ev.to, jx: jitter(), text: `−${ev.damage}`, color: ev.hullDamage > 0 ? COLORS.flame : COLORS.cyan });
    else fight.fx.push({ type: 'number', delay: hit, t: 0.8, max: 0.8, at: ev.to, jx: jitter(), text: 'miss', color: COLORS.dim });
    if (ev.destroyed) {
      const blowUp = mine ? () => shipDestroyed(ev.to) : playerDestroyed;
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
  if (!p) { saveCargo(); return; }
  explode(p.x, p.y, p.radius);
  CombatCore.loot(world.galaxy.seed, key, p.role).forEach((d, i) => {
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
  GalaxyMap.blocked = false;
  document.body.classList.remove('in-combat');
  const home = cargo.home;
  if (home) placeShip(home.x, home.y + home.radius + 220);
  else { const s = world.galaxy.systems[world.galaxy.startSystem]; moveShipTo(s.x, s.y); }
  GalaxyMap.setPlayer(ship.x / SECTOR, ship.y / SECTOR);
  fight.grace = RESPAWN_GRACE;
  gateFlash = 0.8;
  notify(`Ship destroyed · towed to ${home ? home.name : 'your home system'}`, 4);
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
    GalaxyMap.blocked = false;
    document.body.classList.remove('in-combat');
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
    Sectors.pose(home, simTime);
    const d = Math.hypot(home.x - b.x, home.y - b.y);
    b.t += dt;
    if (d < 40 || b.t > 40 || Math.hypot(b.x - ship.x, b.y - ship.y) > SECTOR) { fight.returning.delete(key); continue; }
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
  const events = m.step(s, dt, ship); // the player's ship has already flown this frame (update)
  if (m.flying) {
    for (const e of s.enemies) {
      const p = fight.ships.get(e.id);
      if (p && e.hull > 0) Object.assign(p, { x: e.x, y: e.y, a: e.angle, thrust: e.thrust });
    }
  }
  playEvents(s, events);
  // Hull damage is saved as it happens (on saveCargo's debounce), so it survives closing the page.
  const hull = Math.max(0, s.player.hull);
  if (hull !== cargo.hull) { cargo.hull = hull; saveCargo(); }
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
  const rows = [s.player, ...s.enemies].map((c) => ({
    id: c.id, name: c.name, you: c === s.player, hull: c.hull, maxHull: c.stats.hull,
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
    for (const c of [s.player, ...s.enemies]) {
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
      ctx.fillStyle = c === s.player ? COLORS.good : HOSTILE_COLOR;
      ctx.fillRect(x - w / 2, top + 4, w * (c.hull / c.stats.hull), 3);
      if (c !== s.player && s.enemies.length > 1) {
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
  // Turning, speed and drift by the engine's numbers, in the chosen movement mode (flight.js).
  Flight.step(ship, SHIP, { targetAngle: ship.targetAngle, targetSpeed: ship.targetSpeed, mode: moveMode.value }, dt);
  const hx = Math.cos(ship.angle);
  const hy = Math.sin(ship.angle);

  // Galaxy edge: clamp and bounce softly.
  const m = SHIP.radius;
  if (ship.x < m) { ship.x = m; ship.vx = Math.abs(ship.vx) * 0.3; }
  if (ship.x > world.w - m) { ship.x = world.w - m; ship.vx = -Math.abs(ship.vx) * 0.3; }
  if (ship.y < m) { ship.y = m; ship.vy = Math.abs(ship.vy) * 0.3; }
  if (ship.y > world.h - m) { ship.y = world.h - m; ship.vy = -Math.abs(ship.vy) * 0.3; }

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

  gateFlash = Math.max(0, gateFlash - dt * 1.8);
  toast.t = Math.max(0, toast.t - dt);
  updatePocketNotice();
  // Ship sensors chart the sectors around it, a few times a second.
  senseTimer -= dt;
  if (senseTimer <= 0) {
    senseTimer = 0.25;
    world.knowledge.sense(ship.x / SECTOR, ship.y / SECTOR, SHIP.sensorRange, SHIP.pingRange);
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
  cam.x = lerp(cam.x, tx, k);
  cam.y = lerp(cam.y, ty, k);

  GalaxyMap.setPlayer(ship.x / SECTOR, ship.y / SECTOR);
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

// ---------- World objects (drawn relative to `origin`, the camera's sector corner) ----------

const origin = { x: 0, y: 0 };
const rx = (x) => x - origin.x;
const ry = (y) => y - origin.y;

function drawBounds() {
  ctx.save();
  const [x0, y0, x1, y1] = [rx(0), ry(0), rx(world.w), ry(world.h)];
  ctx.beginPath();
  ctx.rect(rx(cam.x) - 1e4, ry(cam.y) - 1e4, 2e4, 2e4);
  ctx.rect(x0, y0, x1 - x0, y1 - y0);
  ctx.fillStyle = 'rgba(255, 60, 90, 0.06)';
  ctx.fill('evenodd');

  const edgeDist = Math.min(ship.x, ship.y, world.w - ship.x, world.h - ship.y);
  const warn = clamp(1 - edgeDist / 600, 0, 1);
  ctx.strokeStyle = COLORS.hostile;
  ctx.globalAlpha = 0.35 + 0.65 * warn;
  ctx.lineWidth = 3;
  ctx.setLineDash([30, 20]);
  ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
  ctx.restore();
}

// The charted pocket around a world position, or null. Pockets are circles, so the ship can be
// outside one while still in the sector of its system.
function pocketAt(x, y) {
  return world.galaxy.pocketAt(x / SECTOR, y / SECTOR);
}

// Zone at the ship: charted inside a pocket, otherwise the sector's claimed / deep / frontier.
function zoneAt(x, y, territory) {
  if (pocketAt(x, y)) return 'pocket';
  if (territory.owner !== null) return 'claimed';
  return world.galaxy.inFrontier(...sectorOf(x, y)) ? 'frontier' : 'deep';
}

function updatePocketNotice() {
  const pk = pocketAt(ship.x, ship.y);
  const key = pk ? `${pk.kind}:${pk.id}` : '';
  if (lastPocket !== undefined && key !== lastPocket) {
    notify(pk ? `Entering ${pk.name} space` : 'Leaving charted space', 2.5);
  }
  lastPocket = key;
}

// Faint dashed rings marking the edges of nearby charted pockets.
function drawPocketEdges() {
  const reach = Math.max(view.w, view.h) / view.zoom;
  ctx.save();
  ctx.lineWidth = 2 / view.zoom;
  ctx.setLineDash([24 / view.zoom, 16 / view.zoom]);
  for (const pk of world.galaxy.pockets) {
    const x = pk.x * SECTOR, y = pk.y * SECTOR, r = pk.r * SECTOR;
    if (Math.abs(Math.hypot(x - cam.x, y - cam.y) - r) > reach) continue;
    ctx.strokeStyle = world.galaxy.factionColor(pk.faction);
    ctx.globalAlpha = 0.28;
    ctx.beginPath();
    ctx.arc(rx(x), ry(y), r, 0, TAU);
    ctx.stroke();
  }
  ctx.restore();
}

// Faint sector borders around the camera.
function drawSectorGrid() {
  const [cx, cy] = sectorOf(cam.x, cam.y);
  ctx.save();
  ctx.strokeStyle = 'rgba(120, 140, 200, 0.14)';
  ctx.lineWidth = 1.5 / view.zoom;
  ctx.setLineDash([12 / view.zoom, 18 / view.zoom]);
  ctx.beginPath();
  for (let i = -1; i <= 2; i++) {
    const x = rx((cx + i) * SECTOR), y = ry((cy + i) * SECTOR);
    ctx.moveTo(x, ry((cy - 1) * SECTOR)); ctx.lineTo(x, ry((cy + 2) * SECTOR));
    ctx.moveTo(rx((cx - 1) * SECTOR), y); ctx.lineTo(rx((cx + 2) * SECTOR), y);
  }
  ctx.stroke();
  ctx.restore();
}

// Pickup highlight: a soft glow, a steady ring and a ring pulsing outward, in the amber the minimap
// uses for items; rare and better finds ring in their rarity's colour instead (goods.js). Each item
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
  const scene = { t, list, sector: SECTOR };
  let halos = false;
  for (const e of shown) {
    // Pickup highlights go above wrecks and asteroids, just under the items themselves.
    if (e.kind === 'item' && !halos) { drawItemHalos(shown, t); halos = true; }
    KINDS[e.kind].draw(ctx, e, style, rx(e.x), ry(e.y), scene);
  }
}

function drawShip(t) {
  if (fight.wrecked) return; // blown up, waiting for the tow
  Art.drawAsset(ctx, ship.art, artStyle.value, { x: rx(ship.x), y: ry(ship.y), angle: ship.angle, t, thrust: ship.thrust });
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
    const ty = clamp(y - Math.sin(a) * 18 + 4, 14, view.h - 8);
    ctx.fillText(m.label, tx, ty);
    hits.push({ ref: m.ref, x, y, box: [tx - 6, ty - 15, tx + tw + 6, ty + 7] });
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

// Off-screen gates within 1.5 sectors get an edge marker with their name and distance; a tap on
// one selects its gate.
let navHits = [];

function drawNavMarkers(list) {
  const gates = [];
  for (const g of list) {
    if (g.kind !== 'gate' || visible(g)) continue;
    const d = Math.hypot(g.x - ship.x, g.y - ship.y);
    if (d > SECTOR * 1.5) continue;
    const ring = selected && selected.key === entityKey(g) ? SELECT_COLOR : null; // the selected gate's marker
    gates.push({ ref: g, x: g.x, y: g.y, color: g.color, ring, label: `${g.name.toUpperCase()} · ${fmtDist(d - g.radius)}` }); // to its edge, as the card shows
  }
  const top = ContextCard.isOpen ? ContextCard.top : null;
  navHits = edgeMarkers(gates, top === null ? 64 : Math.max(64, view.h - top + 16), 0.85);
}

// The gate whose edge marker is under a tap, if any.
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

// The minimap shows the ship's current sector.
function drawMinimap(list) {
  const size = Math.round(clamp(view.w * 0.28, 90, 150));
  const pad = 12;
  const x0 = view.w - size - pad;
  const y0 = pad;
  const s = size / SECTOR;
  const [sx, sy] = sectorOf(ship.x, ship.y);
  const ox = sx * SECTOR, oy = sy * SECTOR;
  const owner = world.galaxy.territoryOf(sx, sy).owner;

  ctx.save();
  ctx.fillStyle = 'rgba(5, 6, 10, 0.75)';
  ctx.fillRect(x0, y0, size, size);
  ctx.strokeStyle = owner === null ? COLORS.dim : world.galaxy.factions[owner].color;
  ctx.globalAlpha = 0.6;
  ctx.lineWidth = 1;
  ctx.strokeRect(x0 + 0.5, y0 + 0.5, size - 1, size - 1);
  ctx.globalAlpha = 1;
  ctx.beginPath();
  ctx.rect(x0, y0, size, size);
  ctx.clip();

  for (const e of list) {
    if (e.x < ox || e.y < oy || e.x >= ox + SECTOR || e.y >= oy + SECTOR) continue;
    const m = KINDS[e.kind].mark(e, world.galaxy); // a dot, or a ring (gates)
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

const ZONE_LABEL = { pocket: 'CHARTED', claimed: 'UNCHARTED · CLAIMED', deep: 'DEEP SPACE', frontier: 'FRONTIER' };

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

  // Where you are: sector, zone, system and owner.
  const [sx, sy] = sectorOf(ship.x, ship.y);
  const sec = world.sectors.at(sx, sy);
  const t = sec.territory;
  const f = world.galaxy.factions;
  const zone = zoneAt(ship.x, ship.y, t);
  const pk = pocketAt(ship.x, ship.y);
  ctx.globalAlpha = 0.85;
  ctx.fillStyle = COLORS.dim;
  ctx.fillText(`SECTOR ${sx},${sy} · ${ZONE_LABEL[zone]}`, pad, pad + 12);
  const owner = t.owner !== null ? `${f[t.owner].name} ${Math.round(t.dominance * 100)}%` : sec.system?.waystation ? 'safe haven' : null;
  const line2 = [
    pk ? pk.name : null,
    zone === 'claimed' && owner ? `claimed by ${owner}` : zone === 'pocket' ? owner : null,
    t.contestedBy !== null ? `contested by ${f[t.contestedBy].name}` : null,
  ].filter(Boolean).join(' · ');
  if (line2) {
    ctx.fillStyle = t.owner !== null ? f[t.owner].color : COLORS.hud;
    ctx.fillText(line2, pad, pad + 28);
  }

  if (!interacted) {
    ctx.fillStyle = COLORS.hud;
    ctx.globalAlpha = 0.6 + 0.3 * Math.sin(performance.now() / 400);
    const direct = moveMode.value === 'direct';
    ctx.fillText(direct ? 'Hold and drag to fly; drag length sets speed' : 'Drag to fly; drag length sets speed', pad, pad + 56);
    ctx.fillText(direct ? 'Let go to stop' : 'Tap empty space to stop', pad, pad + 72);
    ctx.fillText('Tap a station, gate, asteroid or ship for options', pad, pad + 88);
  }
  ctx.restore();
}

// ---------- Main loop ----------

function render() {
  Art.beginFrame();
  const t = simTime;
  let list = nearbyEntities(t);
  if (checkGates(list)) list = nearbyEntities(t);
  collectItems(list);
  updateSelection(list);
  checkAggro(list);
  updateCombatPanel();
  const [cx, cy] = sectorOf(cam.x, cam.y);
  origin.x = cx * SECTOR;
  origin.y = cy * SECTOR;

  ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, view.w, view.h);
  drawStarfield();

  ctx.save();
  ctx.translate(view.w / 2, view.h / 2);
  ctx.scale(view.zoom, view.zoom);
  ctx.translate(-rx(cam.x), -ry(cam.y));
  drawBounds();
  drawSectorGrid();
  drawPocketEdges();
  drawEntities(list, t);
  drawSelection(t);
  drawFight();
  drawDebris();
  drawMining(t);
  drawParticles();
  drawShip(t);
  ctx.restore();

  if (gateFlash > 0) {
    ctx.fillStyle = `rgba(210, 240, 255, ${gateFlash * gateFlash * 0.85})`;
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
  drawNavMarkers(list);
  drawFoeMarkers();
  drawDragIndicator();
  drawMinimap(list);
  drawHud();
  if (GalaxyMap.perf) drawPerf();
  prefetchSectors();
}

// ---------- Performance overlay (?perf or ?dev, toggled with P) ----------

const PERF_FRAMES = 60;
const perfStats = {
  posed: 0, drawn: 0, // entities posed (nearby sectors) and drawn (on screen) last frame
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
  const s = Art.stats();
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
  ];
  ctx.save();
  ctx.font = Theme.font(11);
  ctx.fillStyle = 'rgba(12, 15, 24, 0.85)';
  ctx.fillRect(8, 92, 330, lines.length * 15 + 8);
  ctx.fillStyle = COLORS.cyan;
  lines.forEach((l, i) => ctx.fillText(l, 14, 108 + i * 15));
  ctx.restore();
}

let last = performance.now();
function frame(now) {
  const dt = Math.min((now - last) / 1000, 0.05);
  const gap = now - last;
  last = now;
  const t0 = performance.now();
  tickTravel(dt);
  if (!GalaxyMap.isOpen && !docked) { // the map overlay and docking pause flight
    if (!Settings.isOpen) update(dt); // the settings menu pauses it too, but keeps it drawn
    render();
    recordFrame(performance.now() - t0, gap);
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
