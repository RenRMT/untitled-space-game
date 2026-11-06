// The 4X game's page (4x/index.html, notes/4x.md): the world (4x/world.js) on the map (4x/view.js),
// the header (where the view is, the way move orders are given, the zoom bands) and the card for the
// picked thing with its orders. The player doesn't fly anything: they pick a ship and send it to park
// round a station, planet or moon, or to hold a point in space. How the order is given is one of the
// prototype schemes in 4x/movement.js (the header's Move button cycles them); in every one a
// right-click or long press on the map sends the picked ship there.
// The header's Build button switches to building: stations are built round planets and moons and
// dismantled, in one of the prototype schemes in 4x/building.js (the scheme button then cycles
// those), with a tray of the kinds of station above the card for the schemes that use one.
// Keys: 1 / 2 / 3 the flight, system and galaxy views, F focus, B build mode, Esc cancel or drop the pick.
// ?seed= picks the galaxy (the main game's by default, world/system-config.js); ?move=button | tap |
// drag | path the move scheme; ?build=menu | ghost | drag opens in build mode with that scheme;
// ?testbed the whole start system with three ships.

import { Params } from '../core/store.js';
import { SYSTEM_CONFIG } from '../world/system-config.js';
import { Building } from './building.js';
import { Movement } from './movement.js';
import { MapView } from './view.js';
import { World4X } from './world.js';

const $ = (id) => document.getElementById(id);
const seedParam = Params.get('seed');
const seed = seedParam === null || seedParam === '' ? SYSTEM_CONFIG.seed : /^\d+$/.test(seedParam) ? Number(seedParam) : seedParam;
const world = World4X.create(seed, { testbed: Params.has('testbed') });

let selected = null; // { key } | { system: i } | null
let note = null, noteUntil = 0; // a passing line in the hint (an order refused)

const selectedShip = () => (selected?.key && world.node(selected.key)?.kind === 'ship' ? selected.key : null);
const ctx = {
  world, selectedShip,
  select(it) { selected = it; card(); },
  send(ship, dest) {
    const why = world.order(ship, dest);
    if (why) { say(why); return false; }
    selected = { key: ship };
    card();
    return true;
  },
  say, focus,
  selected: () => selected,
};
let schemeId = Movement.SCHEMES.some((s) => s.id === Params.get('move')) ? Params.get('move') : 'button';
let scheme = null;
let building = Params.has('build'); // build mode: the map's taps and drags go to the build scheme
let buildId = Building.SCHEMES.some((s) => s.id === Params.get('build')) ? Params.get('build') : 'menu';
let builder = null;

// A drag on the map in build mode: with the planet or moon under the finger, and whether it's over the tray.
const BODIES = ['planet', 'moon'];
function overTray(x, y) {
  const t = $('tray');
  if (t.hidden) return false;
  const b = t.getBoundingClientRect(), m = $('map').getBoundingClientRect();
  return x + m.left >= b.left - 8 && x + m.left <= b.right + 8 && y + m.top >= b.top - 8 && y + m.top <= b.bottom + 8;
}
const buildAt = (at) => ({ ...at, body: view.pickAt(at.x, at.y, BODIES, 40), overTray: overTray(at.x, at.y) });

const view = MapView.create($('map'), world, {
  onPick: pick,
  onOrder: (it, at) => { if (building) return; const ship = selectedShip(); if (ship) ctx.send(ship, it?.key ? it.key : { x: at.world.x, y: at.world.y }); },
  onPress: (it, at) => (building ? builder.press(it, at) : scheme.press(it, at)),
  onDrag: (at) => (building ? (builder.drag(buildAt(at)), true) : scheme.drag(at)),
  onRelease: (at) => (building ? builder.release(buildAt(at)) : scheme.release(at)),
});
ctx.view = view;

function useScheme(id) {
  schemeId = id;
  scheme = Movement.create(id, ctx);
  shownCard = '';
  schemeLabel();
}
function useBuilder(id) {
  buildId = id;
  builder = Building.create(id, ctx);
  shownCard = ''; shownTray = '';
  schemeLabel();
}
function setBuilding(on) {
  building = on;
  if (on) { Params.set('build', buildId); useScheme(schemeId); } else { Params.delete('build'); useBuilder(buildId); }
  $('mode').classList.toggle('on', on);
  $('mode').setAttribute('aria-pressed', String(on));
  schemeLabel();
  shownCard = ''; shownTray = '';
  say(on ? 'Build mode' : 'Move mode');
}
function schemeLabel() {
  // "Move: " / "Build: " is left out on a narrow screen (4x.css), where the Build button says which.
  const [pre, name] = building ? ['Build', Building.SCHEMES.find((s) => s.id === buildId).name] : ['Move', Movement.SCHEMES.find((s) => s.id === schemeId).name];
  const b = document.createElement('span');
  b.className = 'x-pre'; b.textContent = `${pre}: `;
  $('scheme').replaceChildren(b, name);
}

function pick(it, at) {
  if (building ? builder.pick(it, at) : scheme.pick(it, at)) { card(); return; }
  selected = it;
  if (it && it.system === 0 && view.band === 'galaxy') view.go('system');
  card();
}

function say(text) { note = text; noteUntil = performance.now() + 2600; }
function focus() { if (selected?.key) view.go('flight', selected.key); }

// ---------- The card ----------

const KIND = { star: 'Star', planet: 'Planet', moon: 'Moon', station: 'Station', ship: 'Ship', graveyard: 'Graveyard' };
const STATION = World4X.STATIONS;
const away = (d) => (d >= 1000 ? `${(d / 1000).toFixed(1)}k` : `${Math.round(d)}`);
let shownCard = '';

function shipStatus(n) {
  if (n.hold) return 'Holding at a point in space';
  if (!n.free) return `In orbit round ${world.node(n.parent).name}`;
  const end = n.route[n.route.length - 1], p = world.stopAt(end);
  const where = end.key ? world.node(end.key).name : 'a point in space';
  return `Under way to ${where}${n.route.length > 1 ? ` · ${n.route.length} stops` : ''} · ${away(Math.hypot(p.x - n.x, p.y - n.y))} away`;
}

function cardText() {
  if (selected?.key && !world.node(selected.key)) selected = null; // dismantled
  if (building) {
    const c = builder.card(selected?.key ? world.node(selected.key) : null);
    if (c) return c;
  }
  if (!selected) return null;
  if (selected.system !== undefined) {
    const s = world.systems[selected.system];
    return { kind: `System · ${s.star.cls} star`, name: s.name, status: s.charted ? 'Your home system' : 'Uncharted: none of your units have been there', acts: [] };
  }
  const n = world.node(selected.key);
  if (!n) return null;
  const parent = n.parent && world.node(n.parent);
  if (n.kind === 'ship') {
    const c = building ? { acts: [['Focus', focus, '']] } : scheme.card(n);
    return { kind: 'Ship · yours', name: n.name, status: c.status || shipStatus(n), acts: c.acts };
  }
  const what = n.kind === 'star' ? `class ${n.cls}` : n.kind === 'planet' || n.kind === 'moon' ? n.type : n.kind === 'graveyard' ? n.point
    : n.kind === 'station' && n.owner === 'player' ? `yours · ${STATION[n.type].name}` : '';
  const status = n.kind === 'star' ? `The heart of ${world.start.name}` : `In orbit round ${parent.name}`;
  return { kind: `${KIND[n.kind]}${what ? ` · ${what}` : ''}`, name: n.name, status, acts: [['Focus', focus, '']] };
}

function card() {
  const c = cardText(), el = $('card');
  const id = JSON.stringify(c && { ...c, acts: c.acts.map((a) => a[0]) });
  if (id === shownCard) return;
  shownCard = id;
  el.hidden = !c;
  if (!c) return;
  $('card-kind').textContent = c.kind;
  $('card-name').textContent = c.name;
  $('card-status').textContent = c.status;
  $('card-acts').replaceChildren(...c.acts.map(([label, fn, tone = '']) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = `ui-btn ${tone}`.trim(); b.textContent = label;
    b.addEventListener('click', () => { fn(); shownCard = ''; card(); });
    return b;
  }));
}

// ---------- The header ----------

let shownHead = '';
function head(now) {
  const band = view.band, cam = view.camera;
  const here = world.galaxy.systemAt(cam.x, cam.y);
  const place = band === 'galaxy' ? 'The galaxy' : here ? here.name : 'Deep space';
  const hint = now < noteUntil ? note : building ? builder.hint() : selectedShip() ? scheme.hint(world.node(selectedShip())) : 'Tap a ship to pick it · drag to pan · pinch or scroll to zoom';
  const id = `${place}|${hint}|${band}`;
  if (id === shownHead) return;
  shownHead = id;
  $('place').textContent = place;
  $('hint').textContent = hint;
  for (const b of $('zoom').querySelectorAll('button')) b.classList.toggle('on', b.dataset.band === band);
}

for (const b of $('zoom').querySelectorAll('button')) {
  b.addEventListener('click', () => view.go(b.dataset.band, b.dataset.band === 'flight' && selected?.key ? selected.key : undefined));
}
$('scheme').addEventListener('click', () => {
  if (building) {
    const list = Building.SCHEMES, next = list[(list.findIndex((s) => s.id === buildId) + 1) % list.length].id;
    useBuilder(next);
    Params.set('build', next);
    say(`Building: ${list.find((s) => s.id === next).name}`);
    return;
  }
  const list = Movement.SCHEMES, next = list[(list.findIndex((s) => s.id === schemeId) + 1) % list.length].id;
  useScheme(next);
  Params.set('move', next);
  say(`Move orders: ${list.find((s) => s.id === next).name}`);
});
$('mode').addEventListener('click', () => setBuilding(!building));

// ---------- The tray (build mode) ----------
// The kinds of station, for the build schemes that use one: a tap picks one, a press may start a
// drag out of the tray onto the map (followed here, as the map didn't see the press).

let shownTray = '', trayDrag = null;
function tray() {
  const items = building ? builder.tray : null, el = $('tray');
  const id = JSON.stringify(items);
  if (id === shownTray) return;
  shownTray = id;
  el.hidden = !items;
  if (!items) return;
  el.replaceChildren(...items.map((it) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `x-tray-item${it.on ? ' on' : ''}${it.bin ? ' bin' : ''}`;
    b.dataset.id = it.id;
    b.innerHTML = `<span class="x-tray-icon ${it.bin ? 'bin' : STATION[it.id]?.size || ''}" aria-hidden="true"></span><span></span>`;
    b.lastChild.textContent = it.label;
    b.addEventListener('click', () => { builder.trayTap(it.id); shownCard = ''; shownTray = ''; });
    b.addEventListener('pointerdown', (e) => {
      if (!builder.trayDown(it.id)) return;
      e.preventDefault();
      trayDrag = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false };
    });
    return b;
  }));
}
const mapAt = (e) => {
  const m = $('map').getBoundingClientRect(), x = e.clientX - m.left, y = e.clientY - m.top;
  return buildAt({ x, y, world: view.toWorld(x, y) });
};
addEventListener('pointermove', (e) => {
  if (!trayDrag || e.pointerId !== trayDrag.id) return;
  if (Math.hypot(e.clientX - trayDrag.x, e.clientY - trayDrag.y) > 10) trayDrag.moved = true;
  builder.drag(mapAt(e));
});
const trayUp = (e, cancel) => {
  if (!trayDrag || e.pointerId !== trayDrag.id) return;
  const moved = trayDrag.moved;
  trayDrag = null;
  builder.release({ ...mapAt(e), moved, cancel: cancel || !moved });
  shownCard = '';
};
addEventListener('pointerup', (e) => trayUp(e, false));
addEventListener('pointercancel', (e) => trayUp(e, true));

addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement) return;
  const band = { 1: 'flight', 2: 'system', 3: 'galaxy' }[e.key];
  if (band) view.go(band, band === 'flight' && selected?.key ? selected.key : undefined);
  else if (e.key === 'f' || e.key === 'F') focus();
  else if (e.key === 'b' || e.key === 'B') setBuilding(!building);
  else if (e.key === 'Escape') { if (!(building ? builder.escape() : scheme.escape())) selected = null; shownCard = ''; card(); }
});

// Screen px the card and the tray cover at the bottom.
function coveredBelow() {
  const tops = ['card', 'tray'].map($).filter((el) => !el.hidden).map((el) => el.getBoundingClientRect().top);
  return tops.length ? innerHeight - Math.min(...tops) : 0;
}

function layout() {
  view.resize();
  view.inset($('bar').getBoundingClientRect().bottom, coveredBelow());
}
addEventListener('resize', layout);

// ---------- The frame ----------

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  world.step(dt);
  card();
  tray();
  head(now);
  view.inset($('bar').getBoundingClientRect().bottom, coveredBelow() + 8);
  if (building) view.draw(now, { selected: selected?.key || null, build: builder.overlay(now) });
  else view.draw(now, { selected: selected?.key || null, targeting: scheme.aiming, rings: scheme.rings, preview: scheme.preview(now) });
  requestAnimationFrame(frame);
}
useScheme(schemeId);
useBuilder(buildId);
if (building) setBuilding(true);
layout();
selected = { key: world.units()[0].key };
card();
requestAnimationFrame(frame);

// For the tests and the console: the world, the view and the scheme in use.
export const X = {
  world, view, pick, useScheme, useBuilder, setBuilding,
  get scheme() { return scheme; }, get schemeId() { return schemeId; },
  get builder() { return builder; }, get buildId() { return buildId; }, get building() { return building; },
};
