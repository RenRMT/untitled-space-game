// The 4X game's page (4x/index.html, notes/4x.md): the world (4x/world.js) on the map (4x/view.js),
// the header (where the view is, the zoom bands) and the card for the picked thing with its orders.
// The player doesn't fly anything: they pick a ship and send it to park round a station, planet or
// moon (Move on its card, then the place; or right-click / long-press the place with the ship picked).
// Keys: 1 / 2 / 3 the flight, system and galaxy views, M move, F focus, Esc cancel or drop the pick.
// ?seed= picks the galaxy (the main game's by default, world/system-config.js).

import { Params } from '../core/store.js';
import { SYSTEM_CONFIG } from '../world/system-config.js';
import { MapView } from './view.js';
import { World4X } from './world.js';

const $ = (id) => document.getElementById(id);
const seedParam = Params.get('seed');
const seed = seedParam === null || seedParam === '' ? SYSTEM_CONFIG.seed : /^\d+$/.test(seedParam) ? Number(seedParam) : seedParam;
const world = World4X.create(seed);

let selected = null; // { key } | { system: i } | null
let targeting = null; // the ship being given a Move order, or null
let note = null, noteUntil = 0; // a passing line in the hint (an order refused)

const view = MapView.create($('map'), world, { onPick: pick, onOrder: orderTo });

function pick(it) {
  if (targeting) {
    if (it?.key) orderTo(it);
    else stopTargeting();
    return;
  }
  selected = it;
  if (it && it.system === 0 && view.band === 'galaxy') view.go('system');
  card();
}

function orderTo(it) {
  const ship = targeting || (selected?.key && world.node(selected.key)?.kind === 'ship' ? selected.key : null);
  if (!ship || !it?.key) return;
  const why = world.order(ship, it.key);
  if (why) { say(why); return; }
  stopTargeting();
  selected = { key: ship };
  card();
}

function startTargeting() {
  if (!selected?.key || world.node(selected.key)?.kind !== 'ship') return;
  targeting = selected.key;
  document.body.classList.add('targeting');
  if (view.band === 'galaxy') view.go('system');
  card();
}
function stopTargeting() {
  targeting = null;
  document.body.classList.remove('targeting');
  card();
}
function say(text) { note = text; noteUntil = performance.now() + 2600; }
function focus() { if (selected?.key) view.go('flight', selected.key); }

// ---------- The card ----------

const KIND = { star: 'Star', planet: 'Planet', moon: 'Moon', station: 'Station', ship: 'Ship', graveyard: 'Graveyard' };
const away = (d) => (d >= 1000 ? `${(d / 1000).toFixed(1)}k` : `${Math.round(d)}`);
let shownCard = '';

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
    const target = n.free && world.node(n.target);
    const status = target ? `Under way to ${target.name} · ${away(Math.hypot(target.x - n.x, target.y - n.y))} away` : `In orbit round ${parent.name}`;
    const acts = targeting ? [['Cancel', stopTargeting, 'ghost']] : [['Move', startTargeting, 'primary'], ['Focus', focus, '']];
    return { kind: 'Ship · yours', name: n.name, status, acts };
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
    b.addEventListener('click', fn);
    return b;
  }));
}

// ---------- The header ----------

let shownHead = '';
function head(now) {
  const band = view.band, cam = view.camera;
  const here = world.galaxy.systemAt(cam.x, cam.y);
  const place = band === 'galaxy' ? 'The galaxy' : here ? here.name : 'Deep space';
  const hint = now < noteUntil ? note
    : targeting ? `Pick a station, planet or moon for ${world.node(targeting).name} · Esc cancels`
    : selected?.key && world.node(selected.key)?.kind === 'ship' ? 'Move, or right-click / long-press a place to send it there'
    : 'Tap a ship to pick it · drag to pan · pinch or scroll to zoom';
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

addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement) return;
  const band = { 1: 'flight', 2: 'system', 3: 'galaxy' }[e.key];
  if (band) view.go(band, band === 'flight' && selected?.key ? selected.key : undefined);
  else if (e.key === 'm' || e.key === 'M') startTargeting();
  else if (e.key === 'f' || e.key === 'F') focus();
  else if (e.key === 'Escape') { if (targeting) stopTargeting(); else { selected = null; card(); } }
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
  view.draw(now, { selected: selected?.key || null, targeting: !!targeting });
  requestAnimationFrame(frame);
}
layout();
selected = { key: world.units()[0].key };
card();
requestAnimationFrame(frame);

// For the tests and the console: the world and the view.
export const X = { world, view, pick, orderTo };
