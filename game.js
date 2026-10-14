'use strict';

// ---------- Setup ----------

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const TAU = Math.PI * 2;

// Each galaxy map sector is a square play area this many world units across (the galaxy's
// sectorUnits, set in data/galaxy-config.js). World coordinates run across the whole galaxy;
// drawing happens relative to the camera's sector to keep precision.
let SECTOR = 6000;

const COLORS = {
  bg: '#05060a',
  ship: '#7df9ff',
  flame: '#ffb347',
  station: '#b6ff8a',
  planet: '#8ab4ff',
  star: '#ffd27a',
  bounds: '#ff5a6e',
  hud: '#cfd8ff',
  dim: '#6f7a99',
};

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
let simTime = 0; // advances only while flying, so the map pause doesn't make traffic jump
let gateFlash = 0; // white-out after a gate jump, fading from 1
let gateLock = null; // the gate just arrived through, ignored until the ship leaves its aperture
const toast = { text: '', t: 0 }; // short centre-screen notice, fading out
let lastPocket; // key of the pocket the ship was in last frame ('' = none), for enter/leave notices
let senseTimer = 0;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const lerp = (a, b, t) => a + (b - a) * t;

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

// ---------- Settings: art style and movement mode ----------

const params = new URLSearchParams(location.search);
function stored(key, options, fallback) {
  let v = fallback;
  try { if (options.includes(localStorage.getItem(key))) v = localStorage.getItem(key); } catch (e) { /* storage unavailable */ }
  return options.includes(params.get(key)) ? params.get(key) : v;
}
function store(key, v) {
  try { localStorage.setItem(key, v); } catch (e) { /* storage unavailable */ }
}
function toggle(btn, key, options, labels, initial) {
  const s = { value: initial };
  const set = (v) => { s.value = v; btn.textContent = labels[v]; store(key, v); };
  s.cycle = () => set(options[(options.indexOf(s.value) + 1) % options.length]);
  btn.addEventListener('click', s.cycle);
  set(initial);
  return s;
}

const ART_STYLES = Art.STYLES.map((s) => s.id);
const artStyle = toggle(document.getElementById('style-btn'), 'style', ART_STYLES,
  Object.fromEntries(Art.STYLES.map((s) => [s.id, s.label])), stored('style', ART_STYLES, 'line'));

// Cruise: the ship holds the set speed after you let go (tap to stop).
// Direct: the ship only moves while you drag, with no drift, and stops when you let go.
const MOVE_MODES = ['cruise', 'direct'];
const moveMode = toggle(document.getElementById('move-btn'), 'move', MOVE_MODES,
  { cruise: 'Cruise', direct: 'Direct' }, stored('move', MOVE_MODES, 'cruise'));
document.getElementById('move-btn').addEventListener('click', () => { ship.targetSpeed = 0; });

window.addEventListener('keydown', (e) => {
  if (GalaxyMap.isOpen || docked) return;
  if (e.key === 'v' || e.key === 'V') artStyle.cycle();
  if (e.key === 'c' || e.key === 'C') { moveMode.cycle(); ship.targetSpeed = 0; }
  if (e.key === 'f' || e.key === 'F') dockBtn.click();
  if (e.key === 'e' || e.key === 'E') mineBtn.click();
});

ship.art = ArtBlueprints.playerShip(ArtCulture.legacy);

// ---------- World: sectors generated from the galaxy map ----------

const world = { galaxy: null, cultures: null, sectors: null, knowledge: null, travel: null, w: 0, h: 0 };

// ---------- Cargo hold and credits: items collected or bought, saved per galaxy ----------

// items: { kind (art/items.js id), label, category: 'loot' | 'trade' }, one hold unit each.
// mined: keys of asteroids broken up by mining. drops: items they left floating, not yet collected
// (item entities; each keeps its saved form in `drop`).
const cargo = { key: '', items: [], collected: new Set(), credits: 0, mined: new Set(), drops: [] };
const PICKUP_RANGE = 24; // world units beyond the item's own size

// A floating item left by a mined asteroid, from its saved form { key, kind, seed, x, y }.
function dropEntity(d) {
  const art = ArtItems.create(d.kind, d.seed);
  const r = mulberry32(d.seed);
  return {
    kind: 'item', art, key: d.key, label: art.label.split(' · ')[1], category: art.category, itemKind: art.kind,
    angle: r() * TAU, tumble: (r() - 0.5) * 0.3, radius: art.radius, x: d.x, y: d.y, drop: d,
  };
}

// Saves from before items recorded their kind: recover it from the label.
const KIND_BY_LABEL = new Map([
  ...ArtItems.LOOT.flatMap((k) => k.variants.map((v) => [v, k.id])),
  ...ArtItems.TRADE.map((k) => [k.form, k.id]),
]);

function loadCargo(galaxy) {
  cargo.key = `cargo:${Galaxy.saveKey(galaxy)}`;
  cargo.items = [];
  cargo.collected = new Set();
  cargo.credits = Economy.config.startingCredits;
  cargo.mined = new Set();
  cargo.drops = [];
  try {
    if (params.has('fresh')) localStorage.removeItem(cargo.key);
    const d = JSON.parse(localStorage.getItem(cargo.key) || 'null');
    if (d) {
      cargo.items = d.items.map((it) => ({ ...it, kind: it.kind || KIND_BY_LABEL.get(it.label) })).filter((it) => it.kind);
      cargo.collected = new Set(d.collected);
      if (Number.isFinite(d.credits)) cargo.credits = d.credits;
      if (Array.isArray(d.mined)) cargo.mined = new Set(d.mined);
      if (Array.isArray(d.drops)) cargo.drops = d.drops.filter((x) => x && Economy.GOODS[x.kind]).map(dropEntity);
    }
  } catch (e) { /* storage unavailable: cargo lasts for this session only */ }
}
function saveCargo() {
  try {
    localStorage.setItem(cargo.key, JSON.stringify({
      items: cargo.items, collected: [...cargo.collected], credits: cargo.credits,
      mined: [...cargo.mined], drops: cargo.drops.map((e) => e.drop),
    }));
  } catch (e) { /* storage unavailable */ }
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

function collectItems(list) {
  for (const e of list) {
    if (e.kind !== 'item' || cargo.collected.has(e.key)) continue;
    if (Math.hypot(ship.x - e.x, ship.y - e.y) > e.radius * 0.7 + PICKUP_RANGE) continue;
    if (hold.free < 1) {
      // Leave it floating; say so once rather than every frame.
      if (toast.text !== 'Cargo hold full' || toast.t < 0.5) { toast.text = 'Cargo hold full'; toast.t = 2.5; }
      continue;
    }
    if (e.drop) cargo.drops.splice(cargo.drops.indexOf(e), 1);
    else cargo.collected.add(e.key);
    cargo.items.push({ kind: e.itemKind, label: e.label, category: e.category });
    toast.text = `Recovered: ${e.label}`;
    toast.t = 2.5;
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
  world.knowledge = Knowledge.create(galaxy, { fresh: params.has('fresh') });
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
// Knowledge saves on a short debounce; write it out when the page is hidden or closed.
window.addEventListener('pagehide', () => world.knowledge.save());
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') world.knowledge.save(); });
GalaxyMap.onJump = (x, y) => moveShipTo(x, y);

// ---------- Docking: stop near a station, dock, trade, launch ----------

const DOCK = { range: 320, maxSpeed: 150 }; // range: world units beyond the station's radius
const dockBtn = document.getElementById('dock-btn');
let docked = null; // { station } while docked; flight is paused and the station menu is open
let dockTarget = null; // nearest station in range this frame
let dockShown = ''; // last button state, so the DOM is only touched on change

// Whether the player may dock at a station. Everyone is welcome for now; faction reputation
// (refusing hostile factions, say) belongs here: return { ok: false, reason: 'Docking refused' }.
function canDock(station) {
  return { ok: true, reason: '' };
}

const MARKET_LABEL = {
  capital: 'Capital station', freeport: 'Freeport', major: 'Station', minor: 'Station',
};
const stationSubtitle = (st) => {
  const type = st.market.kind === 'outpost' ? st.market.type[0].toUpperCase() + st.market.type.slice(1) : MARKET_LABEL[st.market.type];
  const f = st.faction === null || st.faction === undefined ? null : world.galaxy.factions[st.faction];
  return f ? `${type} · ${f.name}` : `${type} · independent`;
};

// Pick the nearest station within docking range and keep the Dock button in step with it.
function updateDockTarget(list) {
  dockTarget = null;
  let best = Infinity;
  for (const e of list) {
    if (e.kind !== 'station') continue;
    const d = Math.hypot(ship.x - e.x, ship.y - e.y) - e.radius;
    if (d <= DOCK.range && d < best) { best = d; dockTarget = e; }
  }
  let state = 'hidden', label = '';
  if (dockTarget) {
    const allowed = canDock(dockTarget);
    const tooFast = Math.hypot(ship.vx, ship.vy) > DOCK.maxSpeed;
    state = !allowed.ok ? 'refused' : tooFast ? 'slow' : 'ready';
    label = !allowed.ok ? allowed.reason : tooFast ? 'Slow down to dock' : `Dock · ${dockTarget.name}`;
  }
  const shown = `${state}|${label}`;
  if (shown === dockShown) return;
  dockShown = shown;
  dockBtn.hidden = state === 'hidden';
  dockBtn.disabled = state !== 'ready';
  dockBtn.textContent = label;
}

function dock(station) {
  stopMining();
  docked = { station };
  ship.vx = ship.vy = 0;
  ship.targetSpeed = 0;
  ship.thrust = 0;
  drag.active = false;
  particles.length = 0;
  GalaxyMap.blocked = true;
  document.body.classList.add('docked');
  StationMenu.open({
    station: { name: station.name, subtitle: stationSubtitle(station), color: station.color },
    market: Economy.market(world.galaxy.seed, station),
    hold,
    ship: SHIP,
    loadout,
    onLaunch: launch,
  });
}

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
  dockShown = '';
  toast.text = `Launched from ${st.name}`;
  toast.t = 2.5;
}

dockBtn.addEventListener('click', () => {
  if (!dockTarget || docked || !canDock(dockTarget).ok || Math.hypot(ship.vx, ship.vy) > DOCK.maxSpeed) return;
  dock(dockTarget);
});

// ---------- Mining: stop by an asteroid, mine it, collect what it leaves behind ----------

const mineBtn = document.getElementById('mine-btn');
const MINE_COLOR = '#ff9d5c';
let mineTarget = null; // nearest minable asteroid in range this frame
let mineShown = ''; // last button state, so the DOM is only touched on change

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
  if (notice) { toast.text = notice; toast.t = 2; }
}

// Keep the Mine button in step with the nearest asteroid, or with the countdown while mining.
function updateMineButton(list) {
  mineTarget = mining.target ? null : Mining.targetIn(list, ship.x, ship.y, cargo.mined);
  let state = 'hidden', label = '';
  if (mining.target) {
    state = 'busy';
    label = `Mining · ${Math.max(1, Math.ceil(mineTime() - mining.t))} sec`;
    mineBtn.style.setProperty('--progress', `${Math.min(100, (mining.t / mineTime()) * 100).toFixed(1)}%`);
  } else if (mineTarget) {
    const tooFast = Math.hypot(ship.vx, ship.vy) > Mining.config.maxSpeed;
    state = tooFast ? 'slow' : 'ready';
    label = tooFast ? 'Slow down to mine' : `Mine · ${(Art.ASTEROIDS[mineTarget.ast.type] || Art.ASTEROIDS.stony).label} asteroid`;
  }
  const shown = `${state}|${label}`;
  if (shown === mineShown) return;
  mineShown = shown;
  mineBtn.hidden = state === 'hidden';
  mineBtn.disabled = state !== 'ready';
  mineBtn.classList.toggle('busy', state === 'busy');
  mineBtn.textContent = label;
}

mineBtn.addEventListener('click', () => {
  if (mining.target || docked || !mineTarget || Math.hypot(ship.vx, ship.vy) > Mining.config.maxSpeed) return;
  mining.target = mineTarget;
  mining.t = 0;
  ship.targetSpeed = 0; // all stop, so the ship stays in range
});

// Rock chips thrown off an asteroid: a few while mining, a burst when it breaks up.
function chips(a, n, speed) {
  const pal = (Art.ASTEROIDS[a.ast.type] || Art.ASTEROIDS.stony).c;
  for (let i = 0; i < n; i++) {
    const ang = Math.random() * TAU, d = a.radius * Math.random() * 0.6, sp = speed * (0.3 + Math.random() * 0.7);
    const life = 0.5 + Math.random() * 0.9;
    debris.push({
      x: a.x + Math.cos(ang) * d, y: a.y + Math.sin(ang) * d, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp,
      life, max: life, size: 1.5 + Math.random() * Math.min(5, a.radius / 8), color: pal[i % pal.length],
    });
  }
}

function finishMining() {
  const a = mining.target;
  stopMining();
  cargo.mined.add(a.key);
  chips(a, 14 + Math.round(a.radius * 0.6), 120 + a.radius * 3);
  const found = Mining.yieldOf(world.galaxy.seed, a);
  if (found) {
    const e = dropEntity({ key: `drop:${a.key}`, kind: found.kind, seed: found.seed, x: a.x, y: a.y });
    cargo.drops.push(e);
    toast.text = `Asteroid broken up · ${e.label} found`;
  } else {
    toast.text = 'Asteroid broken up · nothing of value';
  }
  toast.t = 2.5;
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
  ctx.fillStyle = '#fff1d0';
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
  ctx.font = '13px ui-monospace, Menlo, Consolas, monospace';
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

const CONTACT_NAMES = { derelict: 'derelict', distress: 'distress call', anomaly: 'anomaly', ambush: 'ambush', story: 'signal' };

// Where a finished trip leaves the ship, and what it says.
function finishTrip(ev) {
  if (!ev) return;
  const { dest } = ev;
  const destCell = { x: Math.floor(dest.x), y: Math.floor(dest.y) };
  if (ev.type === 'arrive' && (dest.kind === 'system' || dest.kind === 'outpost')) {
    moveShipTo(destCell.x, destCell.y);
    toast.text = `Arrived at ${dest.name}`;
  } else if (ev.type === 'arrive' && world.galaxy.deepSector(destCell.x, destCell.y)) {
    dropNearContact(destCell, ev.dir);
    toast.text = `Arrived at ${dest.name}`;
  } else if (ev.type === 'interdict' || ev.type === 'investigate') {
    dropNearContact(ev.cell, ev.dir);
    toast.text = ev.type === 'interdict' ? 'Interdicted! Hostile contact' : `Investigating the ${CONTACT_NAMES[ev.contact.type] || 'signal'}`;
  } else {
    placeShip(ev.pos.x * SECTOR, ev.pos.y * SECTOR, ev.dir);
    toast.text = ev.type === 'arrive' ? `Arrived at ${dest.name}` : 'Dropped out of cruise';
  }
  toast.t = 3;
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
        if (e.kind === 'item' && cargo.collected.has(e.key)) continue;
        if (e.kind === 'asteroid' && cargo.mined.has(e.key)) continue;
        Sectors.pose(e, t);
        out.push(e);
      }
    }
  }
  // Items left by mined asteroids live outside the generated sectors.
  for (const e of cargo.drops) {
    const [dx, dy] = sectorOf(e.x, e.y);
    if (Math.abs(dx - cx) > 1 || Math.abs(dy - cy) > 1) continue;
    Sectors.pose(e, t);
    out.push(e);
  }
  return out;
}

// ---------- Gates: flying into the aperture jumps to the gate at the other end ----------

const gateKey = (g) => `${g.link}@${Math.floor(g.x / SECTOR)},${Math.floor(g.y / SECTOR)}`;

// Returns true when the ship jumped.
function checkGates(list) {
  for (const g of list) {
    if (g.kind !== 'gate') continue;
    const d = Math.hypot(ship.x - g.x, ship.y - g.y);
    if (gateLock === gateKey(g)) {
      if (d > g.aperture + 80) gateLock = null;
      continue;
    }
    if (d > g.aperture * 0.7) continue;
    const there = world.sectors.at(g.dest.x, g.dest.y).entities.find((e) => e.kind === 'gate' && e.link === g.link);
    if (!there) continue;
    // Keep the offset within the aperture and the velocity, so the ship carries straight through.
    const dx = there.x - g.x, dy = there.y - g.y;
    ship.x += dx; ship.y += dy;
    cam.x += dx; cam.y += dy;
    particles.length = 0;
    gateLock = gateKey(there);
    gateFlash = 1;
    world.knowledge.knowRoute(g.link); // using a gate charts its route, hidden ones included
    return true;
  }
  return false;
}

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
  if (len > DEADZONE) {
    ship.targetAngle = Math.atan2(dy, dx);
    ship.targetSpeed = Math.min(len / maxDrag(), 1) * SHIP.maxSpeed;
  } else if (drag.moved > DEADZONE) {
    ship.targetSpeed = 0; // dragged back to the anchor: throttle to zero
  }
});

function endDrag(e) {
  if (!drag.active || e.pointerId !== drag.id) return;
  drag.active = false;
  if (moveMode.value === 'direct') ship.targetSpeed = 0; // letting go stops the ship
  else if (e.type === 'pointerup' && drag.moved < DEADZONE) ship.targetSpeed = 0; // tap = all stop
}
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

// ---------- Simulation ----------

function turnToward(a, target, maxStep) {
  const diff = ((target - a + Math.PI) % TAU + TAU) % TAU - Math.PI;
  return a + clamp(diff, -maxStep, maxStep);
}

function update(dt) {
  simTime += dt;
  const direct = moveMode.value === 'direct';
  const moving = ship.targetSpeed > 0;
  if (moving) ship.angle = turnToward(ship.angle, ship.targetAngle, SHIP.turnRate * (direct ? 3 : 1) * dt);
  const hx = Math.cos(ship.angle);
  const hy = Math.sin(ship.angle);

  if (direct) {
    // No inertia: velocity always points along the heading and snaps to the set speed.
    let speed = lerp(Math.hypot(ship.vx, ship.vy), ship.targetSpeed, 1 - Math.exp(-12 * dt));
    if (!moving && speed < 5) speed = 0;
    ship.vx = hx * speed;
    ship.vy = hy * speed;
    ship.thrust = lerp(ship.thrust, moving ? Math.max(0.2, ship.targetSpeed / SHIP.maxSpeed) : 0, 1 - Math.exp(-12 * dt));
  } else {
    // Velocity eases toward (heading * set speed), so turning produces some drift.
    const dvx = hx * ship.targetSpeed - ship.vx;
    const dvy = hy * ship.targetSpeed - ship.vy;
    const dv = Math.hypot(dvx, dvy);
    if (dv > 0) {
      const k = Math.min(1, (SHIP.accel * dt) / dv);
      ship.vx += dvx * k;
      ship.vy += dvy * k;
    }
    const along = dv > 5 ? (dvx * hx + dvy * hy) / dv : 0;
    const thrustTarget = moving ? Math.max(0.2, along) : 0;
    ship.thrust = lerp(ship.thrust, thrustTarget, 1 - Math.exp(-10 * dt));
  }

  ship.x += ship.vx * dt;
  ship.y += ship.vy * dt;

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

  gateFlash = Math.max(0, gateFlash - dt * 1.8);
  toast.t = Math.max(0, toast.t - dt);
  updatePocketNotice();
  // Ship sensors chart the sectors around it, a few times a second.
  senseTimer -= dt;
  if (senseTimer <= 0) {
    senseTimer = 0.25;
    world.knowledge.sense(ship.x / SECTOR, ship.y / SECTOR, SHIP.sensorRange, SHIP.pingRange);
  }

  // Camera leads in the direction of travel.
  const lead = 0.45;
  const k = 1 - Math.exp(-4 * dt);
  cam.x = lerp(cam.x, ship.x + ship.vx * lead, k);
  cam.y = lerp(cam.y, ship.y + ship.vy * lead, k);

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
  ctx.strokeStyle = COLORS.bounds;
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
    toast.text = pk ? `Entering ${pk.name} space` : 'Leaving charted space';
    toast.t = 2.5;
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
    ctx.strokeStyle = pk.faction === null ? '#9aa4b8' : world.galaxy.factions[pk.faction].color;
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

const DRAW_ORDER = { star: 0, planet: 1, asteroid: 1.5, gate: 2, station: 2, wreck: 3, item: 3.5, ship: 4 };

// Pickup highlight: a soft glow, a steady ring and a ring pulsing outward, in the amber the minimap
// uses for items. Each item pulses on its own rhythm, and the effect brightens as the ship nears.
const ITEM_HALO = { color: '#ffcf5a', period: 1.8, near: 900 };
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
  ctx.strokeStyle = ITEM_HALO.color;
  for (const e of list) {
    if (e.kind !== 'item') continue;
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
  const shown = list.filter(visible).sort((a, b) => DRAW_ORDER[a.kind] - DRAW_ORDER[b.kind]);
  perfStats.posed = list.length;
  perfStats.drawn = shown.length;
  let halos = false;
  for (const e of shown) {
    // Pickup highlights go above wrecks and asteroids, just under the items themselves.
    if (e.kind === 'item' && !halos) { drawItemHalos(shown, t); halos = true; }
    const x = rx(e.x), y = ry(e.y);
    if (e.kind === 'star') Art.drawStar(ctx, e.body, style, { x, y, t });
    else if (e.kind === 'planet') {
      const star = list.find((s) => s.kind === 'star' && Math.abs(s.x - e.x) < SECTOR && Math.abs(s.y - e.y) < SECTOR);
      Art.drawPlanet(ctx, e.body, style, { x, y, lightAngle: star ? Math.atan2(star.y - e.y, star.x - e.x) : -2.2 });
    } else if (e.kind === 'station') Art.drawAsset(ctx, e.art, style, { x, y, spin: e.spin + t * e.art.spinRate, t });
    else if (e.kind === 'gate') Art.drawAsset(ctx, e.art, style, { x, y, angle: e.angle, spin: e.spin + t * e.art.spinRate, t });
    else if (e.kind === 'asteroid') Art.drawAsteroid(ctx, e.ast, style, { x, y, spin: e.spin0 + t * e.tumble });
    else Art.drawAsset(ctx, e.art, style, { x, y, angle: e.a, t, thrust: e.thrust || 0 });
  }
}

function drawShip(t) {
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

function labelOf(e) {
  if (!e.name) return null;
  if (e.kind === 'star') return [COLORS.star, e.body.r * 1.5];
  if (e.kind === 'planet') return [COLORS.planet, e.body.r * 1.3];
  if (e.kind === 'station' || e.kind === 'gate') return [e.color, e.radius * 1.05];
  return ['#9aa4b8', e.radius + 20];
}

function drawLabels(list) {
  ctx.font = '12px ui-monospace, Menlo, Consolas, monospace';
  ctx.textAlign = 'center';
  ctx.globalAlpha = 0.75;
  for (const e of list) {
    const l = labelOf(e);
    if (!l || !visible(e)) continue;
    const [sx, sy] = worldToScreen(e.x, e.y + l[1]);
    ctx.fillStyle = l[0];
    ctx.fillText(e.name.toUpperCase(), sx, sy + 14);
  }
  ctx.globalAlpha = 1;
  ctx.textAlign = 'left';
}

// Off-screen gates within 1.5 sectors get a marker at the screen edge pointing their way, with name and distance.
function drawNavMarkers(list) {
  // Margins keep markers clear of the HUD text (top left), the speed bar (bottom) and the buttons.
  const inset = { l: 26, r: 26, t: 70, b: 64 };
  const cx = view.w / 2, cy = view.h / 2;
  ctx.save();
  ctx.font = '11px ui-monospace, Menlo, Consolas, monospace';
  for (const g of list) {
    if (g.kind !== 'gate' || visible(g)) continue;
    const d = Math.hypot(g.x - ship.x, g.y - ship.y);
    if (d > SECTOR * 1.5) continue;
    const [gx, gy] = worldToScreen(g.x, g.y);
    const dx = gx - cx, dy = gy - cy;
    // Where the line from the screen centre to the gate leaves the inset screen rectangle.
    const k = Math.min((dx > 0 ? cx - inset.r : cx - inset.l) / Math.abs(dx || 1e-6), (dy > 0 ? cy - inset.b : cy - inset.t) / Math.abs(dy || 1e-6));
    const x = cx + dx * k, y = cy + dy * k, a = Math.atan2(dy, dx);
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = g.color;
    ctx.translate(x, y);
    ctx.rotate(a);
    ctx.beginPath();
    ctx.moveTo(10, 0);
    ctx.lineTo(-4, 7);
    ctx.lineTo(-4, -7);
    ctx.closePath();
    ctx.fill();
    ctx.rotate(-a);
    ctx.translate(-x, -y);
    const text = `${g.name.toUpperCase()} · ${(d / 1000).toFixed(1)}k`;
    const tw = ctx.measureText(text).width;
    ctx.textAlign = 'left';
    // Text sits inward from the arrow, so it never covers it.
    const tx = clamp(x - Math.cos(a) * (tw / 2 + 16) - tw / 2, 8, view.w - tw - 8);
    const ty = clamp(y - Math.sin(a) * 18 + 4, 14, view.h - 8);
    ctx.fillText(text, tx, ty);
  }
  ctx.restore();
}

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
  ctx.strokeStyle = COLORS.ship;
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
    ctx.fillStyle = COLORS.ship;
    ctx.font = '12px ui-monospace, Menlo, Consolas, monospace';
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
    if (e.kind === 'asteroid') continue;
    const mx = x0 + (e.x - ox) * s, my = y0 + (e.y - oy) * s;
    if (e.kind === 'gate') {
      // Gates stand out as rings in their builder's colour.
      ctx.strokeStyle = e.color;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(mx, my, 4, 0, TAU);
      ctx.stroke();
      continue;
    }
    const [color, rad] = e.kind === 'star' ? [COLORS.star, 4]
      : e.kind === 'planet' ? [COLORS.planet, 3]
        : e.kind === 'station' ? [e.color, 2.5]
          : e.kind === 'wreck' ? ['#6f7a99', 1.5]
            : e.kind === 'item' ? ['#ffcf5a', 1.2]
            : [e.faction === null || e.faction === undefined ? '#9aa4b8' : world.galaxy.factions[e.faction].color, 1.2];
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(mx, my, rad, 0, TAU);
    ctx.fill();
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
  ctx.fillStyle = COLORS.ship;
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
  ctx.font = '12px ui-monospace, Menlo, Consolas, monospace';
  ctx.fillStyle = COLORS.hud;
  ctx.globalAlpha = 0.85;
  ctx.fillText(`SPD ${String(Math.round(speed)).padStart(3, ' ')}`, pad, y - 12);
  if (cargo.items.length) ctx.fillText(`CARGO ${cargo.items.length}/${SHIP.cargo}`, pad + 84, y - 12);

  // Actual speed (filled) vs set throttle (marker).
  ctx.globalAlpha = 0.25;
  ctx.fillRect(pad, y, barW, 6);
  ctx.globalAlpha = 0.9;
  ctx.fillStyle = COLORS.ship;
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
  const owner = t.owner !== null ? `${f[t.owner].name} ${Math.round(t.dominance * 100)}%` : sec.system?.freeport ? 'Freeport' : null;
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
    ctx.fillText(direct ? 'Let go to stop' : 'Tap to stop', pad, pad + 72);
  }
  ctx.restore();
}

// ---------- Main loop ----------

function render() {
  const t = simTime;
  let list = nearbyEntities(t);
  if (checkGates(list)) list = nearbyEntities(t);
  collectItems(list);
  updateDockTarget(list);
  updateMineButton(list);
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
  if (toast.t > 0) {
    ctx.save();
    ctx.globalAlpha = Math.min(1, toast.t / 0.6) * 0.9;
    ctx.fillStyle = COLORS.hud;
    ctx.font = '14px ui-monospace, Menlo, Consolas, monospace';
    ctx.textAlign = 'center';
    ctx.fillText(toast.text.toUpperCase(), view.w / 2, view.h * 0.22);
    ctx.restore();
  }
  drawNavMarkers(list);
  drawDragIndicator();
  drawMinimap(list);
  drawHud();
  if (GalaxyMap.perf) drawPerf();
}

// ---------- Performance overlay (?perf or ?dev, toggled with P) ----------

const PERF_FRAMES = 60;
const perfStats = {
  posed: 0, drawn: 0, // entities posed (nearby sectors) and drawn (on screen) last frame
  work: new Float32Array(PERF_FRAMES), gap: new Float32Array(PERF_FRAMES), i: 0, // ms per frame
  rates: { builds: 0, asteroidBuilds: 0 }, prev: null, prevT: 0, // sprite builds per second
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
      perfStats.rates = { builds: (s.builds - perfStats.prev.builds) / secs, asteroidBuilds: (s.asteroidBuilds - perfStats.prev.asteroidBuilds) / secs };
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
    `sprites ${s.sprites} cached · ${Math.round(perfStats.rates.builds)} built/s`,
    `asteroids ${s.asteroids} cached · ${Math.round((s.asteroidPixels * 4) / 1e6)} MB · ${Math.round(perfStats.rates.asteroidBuilds)} built/s`,
  ];
  ctx.save();
  ctx.font = '11px ui-monospace, Menlo, Consolas, monospace';
  ctx.fillStyle = 'rgba(12, 15, 24, 0.85)';
  ctx.fillRect(8, 92, 330, lines.length * 15 + 8);
  ctx.fillStyle = COLORS.ship;
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
    update(dt);
    render();
    recordFrame(performance.now() - t0, gap);
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
