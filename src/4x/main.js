// The 4X game's page (4x/index.html, notes/4x.md): the world (4x/world.js) on the map (4x/view.js),
// the header (where the view is, the way move orders are given, the zoom bands) and the card for the
// picked thing with its orders. The player doesn't fly anything: they pick a ship and send it to park
// round a station, planet or moon, or to hold a point in space. How the order is given is one of the
// prototype schemes in 4x/movement.js (the header's Move button cycles them); in every one a
// right-click or long press on the map sends the picked ship there.
// Keys: 1 / 2 / 3 the flight, system and galaxy views, F focus, Esc cancel or drop the pick.
// ?seed= picks the galaxy (the main game's by default, world/system-config.js); ?move=button | tap |
// drag | path the scheme; ?testbed the whole start system with three ships.

import { Params } from '../core/store.js';
import { SYSTEM_CONFIG } from '../world/system-config.js';
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
};
let schemeId = Movement.SCHEMES.some((s) => s.id === Params.get('move')) ? Params.get('move') : 'button';
let scheme = null;

const view = MapView.create($('map'), world, {
  onPick: pick,
  onOrder: (it, at) => { const ship = selectedShip(); if (ship) ctx.send(ship, it?.key ? it.key : { x: at.world.x, y: at.world.y }); },
  onPress: (it, at) => scheme.press(it, at),
  onDrag: (at) => scheme.drag(at),
  onRelease: (at) => scheme.release(at),
});
ctx.view = view;

function useScheme(id) {
  schemeId = id;
  scheme = Movement.create(id, ctx);
  $('scheme').textContent = `Move: ${Movement.SCHEMES.find((s) => s.id === id).name}`;
  shownCard = '';
}

function pick(it, at) {
  if (scheme.pick(it, at)) { card(); return; }
  selected = it;
  if (it && it.system === 0 && view.band === 'galaxy') view.go('system');
  card();
}

function say(text) { note = text; noteUntil = performance.now() + 2600; }
function focus() { if (selected?.key) view.go('flight', selected.key); }

// ---------- The card ----------

const KIND = { star: 'Star', planet: 'Planet', moon: 'Moon', station: 'Station', ship: 'Ship', graveyard: 'Graveyard' };
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
  if (!selected) return null;
  if (selected.system !== undefined) {
    const s = world.systems[selected.system];
    return { kind: `System · ${s.star.cls} star`, name: s.name, status: s.charted ? 'Your home system' : 'Uncharted: none of your units have been there', acts: [] };
  }
  const n = world.node(selected.key);
  if (!n) return null;
  const parent = n.parent && world.node(n.parent);
  if (n.kind === 'ship') {
    const c = scheme.card(n);
    return { kind: 'Ship · yours', name: n.name, status: c.status || shipStatus(n), acts: c.acts };
  }
  const what = n.kind === 'star' ? `class ${n.cls}` : n.kind === 'planet' || n.kind === 'moon' ? n.type : n.kind === 'graveyard' ? n.point : '';
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
  $('card-acts').replaceChildren(...c.acts.map(([label, fn, tone]) => {
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
  const hint = now < noteUntil ? note : selectedShip() ? scheme.hint(world.node(selectedShip())) : 'Tap a ship to pick it · drag to pan · pinch or scroll to zoom';
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
  const list = Movement.SCHEMES, next = list[(list.findIndex((s) => s.id === schemeId) + 1) % list.length].id;
  useScheme(next);
  Params.set('move', next);
  say(`Move orders: ${list.find((s) => s.id === next).name}`);
});

addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement) return;
  const band = { 1: 'flight', 2: 'system', 3: 'galaxy' }[e.key];
  if (band) view.go(band, band === 'flight' && selected?.key ? selected.key : undefined);
  else if (e.key === 'f' || e.key === 'F') focus();
  else if (e.key === 'Escape') { if (!scheme.escape()) selected = null; shownCard = ''; card(); }
});

function layout() {
  view.resize();
  const bar = $('bar').getBoundingClientRect(), c = $('card');
  view.inset(bar.bottom, c.hidden ? 0 : innerHeight - c.getBoundingClientRect().top);
}
addEventListener('resize', layout);

// ---------- The frame ----------

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  world.step(dt);
  card();
  head(now);
  const c = $('card');
  view.inset($('bar').getBoundingClientRect().bottom, c.hidden ? 0 : innerHeight - c.getBoundingClientRect().top + 8);
  view.draw(now, { selected: selected?.key || null, targeting: scheme.aiming, rings: scheme.rings, preview: scheme.preview(now) });
  requestAnimationFrame(frame);
}
useScheme(schemeId);
layout();
selected = { key: world.units()[0].key };
card();
requestAnimationFrame(frame);

// For the tests and the console: the world, the view and the scheme in use.
export const X = { world, view, pick, get scheme() { return scheme; }, get schemeId() { return schemeId; }, useScheme };
