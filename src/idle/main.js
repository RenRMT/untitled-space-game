// The idle game (idle/index.html; serve the repo, e.g. `npm start`, and open /idle/): a dead system
// whose stations you bring back online one by one, with drills at its asteroid field, planets and
// moons, production at the stations, shuttles between them and markets to sell at, all running on
// the real clock while the page is closed (notes/idle.md is the plan, rules.js the rules).
//
// This module wires the page: loads the save (save.js) and catches up on the time away in slices,
// so a long absence never freezes the page, then says what happened; settles every second; draws
// the system every frame (map.js); opens a sheet for what's tapped (sheets.js) and carries out
// what its buttons ask. Query parameters: ?fresh (a new save), ?seed= (a new save's system).
// ES module; needs a browser.

import { Clock } from '../core/clock.js';
import { Recipes } from '../rules/recipes.js';
import { Config } from './config.js';
import { IdleMap } from './map.js';
import { IdleRules } from './rules.js';
import { IdleSave } from './save.js';
import { IdleSheets } from './sheets.js';

const $ = (id) => document.getElementById(id);
const now = () => Clock.now();
const loaded = IdleSave.load(now());
const { w } = loaded;
let state = loaded.state, selected = null, ready = false;
const save = IdleSave.writer(() => state);

const map = IdleMap.create($('map'), w, { onPick: (key) => pick(key) });
const sheets = IdleSheets.create($('sheet'), w, { act });

function pick(key) {
  selected = key;
  if (!key) sheets.show(null, state, now());
  else sheets.show({ kind: IdleRules.isSite(key) ? 'site' : 'station', key }, state, now());
}

// ---------- Settling ----------

// What a settle's log adds up to, per place and kind: made and delivered.
function tally(acc, log) {
  for (const x of log) {
    const into = x.out ? acc.made : acc.delivered;
    for (const [kind, n] of Object.entries(x.out || x.delivered || {})) {
      const id = `${x.name}|${kind}`;
      into.set(id, (into.get(id) || 0) + n);
    }
  }
}

// What has stopped: stations whose stock is full (sell, or send it on), then orders that can't go on
// (no room for what they make, or an input missing), one line a place.
function stuck() {
  const I = IdleRules.industry, e = IdleRules.env(state), t = now(), out = [];
  for (const st of w.stations) {
    if (IdleRules.online(state, w, st.key) && I.used(state.industry, st.key) >= I.capacity(state.industry, e, t, st.key)) out.push({ key: st.key, name: st.name, why: 'Full: sell' });
  }
  for (const o of state.industry.orders) {
    const s = I.status(state.industry, o);
    if (s.id === 'blocked' || s.id === 'starved') out.push({ key: o.station, name: o.name, why: s.id === 'blocked' ? 'Storage full' : `Needs ${Recipes.item(s.missing)?.name || s.missing}` });
  }
  return out.filter((x, i) => out.findIndex((y) => y.key === x.key) === i);
}

async function catchUp() {
  const from = state.seen, acc = { made: new Map(), delivered: new Map() };
  const load = $('load');
  for (let slice = 0; ; slice++) {
    const r = IdleRules.settle(state, now());
    tally(acc, r.log);
    if (!r.truncated) break;
    load.hidden = false;
    load.textContent = `Catching up… ${slice + 1}`;
    await new Promise((res) => setTimeout(res, 0));
  }
  load.hidden = true;
  const ms = now() - from;
  if (!loaded.fresh && ms > Config.AWAY_SHEET && (acc.made.size || acc.delivered.size)) {
    selected = null;
    sheets.show({ kind: 'away', away: { ms, made: acc.made, delivered: acc.delivered, stuck: stuck() } }, state, now());
  }
  save.change();
}

function tick() {
  if (!ready) return;
  const r = IdleRules.settle(state, now());
  if (r.log.length) { map.made(r.log); save.change(); }
  bar();
  sheets.refresh(state, now());
}

// ---------- The bar ----------

function bar() {
  $('credits').textContent = `${Math.floor(state.credits).toLocaleString('en')} cr`;
  const p = IdleRules.nextProject(state), b = $('restore-btn');
  const ok = !!p && IdleRules.projectStatus(state, w, p.id).id === 'ready';
  const text = p ? p.name : 'All online';
  if (b.textContent !== text) b.innerHTML = `<span>${text}</span>`;
  b.title = p ? (ok ? `Restore the ${p.name}` : `Next to restore: the ${p.name}`) : '';
  b.classList.toggle('ready', ok);
}

// ---------- Actions (the sheets' buttons) ----------

function act(name, a) {
  const t = now();
  IdleRules.settle(state, t); // everything up to now first, so an action lands on the present
  switch (name) {
    case 'close': selected = null; sheets.show(null, state, t); return;
    case 'open': selected = a.key || null; sheets.show(a, state, t); return;
    case 'sell': IdleRules.sell(state, w, a.key, a.kind, a.n, t); break;
    case 'place': IdleRules.place(state, w, a.key, a.recipe, t); break;
    case 'cancel': IdleRules.cancel(state, w, a.id); break;
    case 'shuttle': IdleRules.setShuttle(state, w, a.from, a.to, t); break;
    case 'drill': IdleRules.buyDrill(state, w, a.key, a.good, t); break;
    case 'drill-set': IdleRules.setDrill(state, w, a.id, a.good, t); break;
    case 'restore': if (IdleRules.restore(state, w, a.id, t)) navigator.vibrate?.(30); break;
    default: return;
  }
  save.change();
  bar();
  sheets.refresh(state, t);
}

$('restore-btn').addEventListener('click', () => { selected = null; sheets.show({ kind: 'restore' }, state, now()); });

// ---------- Running ----------

function frame() {
  map.draw(state, now(), selected);
  sheets.progress(now());
  requestAnimationFrame(frame);
}

window.addEventListener('resize', () => map.resize());
document.addEventListener('visibilitychange', () => {
  if (document.hidden) save.now();
  else catchUp();
});
window.addEventListener('pagehide', () => save.now());

bar();
await catchUp();
ready = true;
setInterval(tick, 1000);
requestAnimationFrame(frame);
if (loaded.fresh) pick(w.sites.find((s) => s.kind === 'field')?.key || null);
