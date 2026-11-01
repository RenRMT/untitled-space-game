// The idle game (idle/index.html; serve the repo, e.g. `npm start`, and open /idle/): a system with
// nothing built in it. Its bodies are charted one survey at a time; stations are built in orbit round
// them one after another; drills pull raw goods from them, the stations make things of them,
// shuttles carry them between, and the markets buy, all on the real clock while the page is closed
// (notes/idle.md is the plan, rules.js the rules).
//
// This module wires the page: loads the save (save.js) and catches up on the time away in slices,
// so a long absence never freezes the page, then says what happened; settles every second; draws
// the system every frame (map.js); keeps the header (the next thing to do, the credits) and the tab
// bar (System, Survey, Build, Market: the game's UI kit, ui/kit.js) up to date; opens a sheet for
// what's tapped (sheets.js) and carries out what its buttons ask. Query parameters: ?fresh (a new
// save), ?seed= (a new save's system).
// ES module; needs a browser.

import { Clock } from '../core/clock.js';
import { Theme } from '../core/theme.js';
import { Recipes } from '../rules/recipes.js';
import { Kit } from '../ui/kit.js';
import { UI } from '../ui/ui.js';
import { Config } from './config.js';
import { IdleMap } from './map.js';
import { IdleRules } from './rules.js';
import { IdleSave } from './save.js';
import { IdleSheets } from './sheets.js';

const { h } = UI;
const $ = (id) => document.getElementById(id);
const now = () => Clock.now();
Theme.setStyle('line');
if (document.fonts?.load) for (const wt of [400, 700]) document.fonts.load(`${wt} 12px ${Theme.mono}`).catch(() => {});

const loaded = IdleSave.load(now());
const { w } = loaded;
let state = loaded.state, selected = null, ready = false;
const save = IdleSave.writer(() => state);

const map = IdleMap.create($('map'), w, { onPick: (key) => pick(key) });
const sheets = IdleSheets.create($('sheets'), w, { act, onClose: () => { selected = null; tabs(); } });
$('sys-name').textContent = `${w.galaxy.name} System`;

function pick(key) {
  selected = key;
  map.focus(key);
  if (!key) sheets.show(null, state, now());
  else sheets.show({ kind: IdleRules.isSite(key) ? 'site' : 'station', key }, state, now());
  tabs();
}

// ---------- The tab bar ----------

const TABS = [
  { id: 'system', label: 'System', code: 'ORB' },
  { id: 'survey', label: 'Survey', code: 'SCN' },
  { id: 'build', label: 'Build', code: 'IND' },
  { id: 'market', label: 'Market', code: 'TRD' },
];
const tabEls = new Map(TABS.map((t) => {
  const el = h('button', { class: 'ui-tab', type: 'button', role: 'tab', onclick: () => openTab(t.id) });
  $('tabs').append(el);
  return [t.id, el];
}));
function openTab(id) {
  const t = now();
  if (id === 'system') { selected = null; map.focus(null); sheets.show(null, state, t); }
  else if (id === 'survey' || id === 'build') { selected = null; sheets.show({ kind: id }, state, t); }
  else if (id === 'market') {
    if (IdleRules.online(state, w, w.waystation.key)) { pick(w.waystation.key); return; }
    selected = null; sheets.show({ kind: 'build' }, state, t);
  }
  tabs();
}
function tabs() {
  const v = sheets.view;
  const on = !v ? 'system' : v.kind === 'survey' || v.kind === 'build' ? v.kind : v.kind === 'station' && v.key === w.waystation.key ? 'market' : 'system';
  const nb = IdleRules.nextBuild(state);
  const dots = {
    survey: !state.survey && state.credits >= IdleRules.surveyCost(state) && w.sites.some((s) => IdleRules.surveyable(state, w, s.key)),
    build: !!nb && IdleRules.buildStatus(state, w, nb.id).id === 'ready',
  };
  for (const t of TABS) {
    const el = tabEls.get(t.id), sel = String(t.id === on), dot = !!dots[t.id];
    if (el.getAttribute('aria-selected') === sel && el.dataset.dot === String(dot)) continue;
    el.setAttribute('aria-selected', sel);
    el.dataset.dot = String(dot);
    el.replaceChildren(Kit.icon(t.code, 24, { code: t.code, dot }), h('span', { class: 'lbl' }, t.label));
  }
}

// ---------- The header: the credits, and the next thing to do ----------

// What to do next, in a few words, and what tapping it opens.
function hint() {
  const field = w.sites.find((s) => s.kind === 'field');
  const nb = IdleRules.nextBuild(state), way = IdleRules.online(state, w, w.waystation.key);
  if (!way) return { text: `Build the waystation round ${field.name}`, open: () => pick(field.key) };
  if (!Object.keys(state.drills).length) return { text: `Put a drill on ${field.name}`, open: () => pick(field.key) };
  if (nb && IdleRules.buildStatus(state, w, nb.id).id === 'ready') return { text: `Build the ${nb.name.toLowerCase()}`, open: () => openTab('build') };
  if (state.survey) return { text: `Surveying ${state.survey.key === selected ? 'this signal' : 'a signal'}`, open: () => openTab('survey') };
  if (w.sites.some((s) => IdleRules.surveyable(state, w, s.key)) && state.credits >= IdleRules.surveyCost(state)) return { text: 'Survey a signal', open: () => openTab('survey') };
  if (nb) {
    const s = IdleRules.buildStatus(state, w, nb.id);
    const short = s.short.map((x) => Recipes.item(x.kind)?.name || x.kind);
    if (s.credits) short.push('credits');
    return { text: `${nb.name}: needs ${short.join(', ')}`, open: () => openTab('build') };
  }
  return { text: 'Every station built', open: () => openTab('build') };
}
let hintOpen = null;
$('hint').addEventListener('click', () => hintOpen?.());
function bar() {
  const text = `${Math.floor(state.credits).toLocaleString('en')}`;
  if ($('credits').textContent !== text) $('credits').textContent = text;
  const hh = hint();
  if ($('hint').textContent !== hh.text) $('hint').textContent = hh.text;
  hintOpen = hh.open;
  tabs();
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

// A survey finished: its report, unless the summary of time away is showing.
function charted(list) {
  if (!list.length) return;
  navigator.vibrate?.(20);
  if (sheets.view?.kind === 'away') return;
  const c = list[list.length - 1];
  selected = c.key;
  map.focus(c.key);
  sheets.show({ kind: 'report', key: c.key, find: c.find }, state, now());
}

async function catchUp() {
  const from = state.seen, acc = { made: new Map(), delivered: new Map(), charted: [] };
  const load = $('load');
  for (let slice = 0; ; slice++) {
    const r = IdleRules.settle(state, w, now());
    tally(acc, r.log);
    acc.charted.push(...r.charted);
    if (!r.truncated) break;
    load.hidden = false;
    load.textContent = `Catching up… ${slice + 1}`;
    await new Promise((res) => setTimeout(res, 0));
  }
  load.hidden = true;
  const ms = now() - from;
  if (!loaded.fresh && ms > Config.AWAY_SHEET && (acc.made.size || acc.delivered.size || acc.charted.length)) {
    selected = null;
    sheets.show({ kind: 'away', away: { ms, made: acc.made, delivered: acc.delivered, charted: acc.charted, stuck: stuck() } }, state, now());
  } else charted(acc.charted);
  save.change();
}

function tick() {
  if (!ready) return;
  const r = IdleRules.settle(state, w, now());
  if (r.log.length || r.charted.length) { map.made(r.log); save.change(); }
  charted(r.charted);
  bar();
  sheets.refresh(state, now());
}

// ---------- Actions (the sheets' buttons) ----------

function act(name, a) {
  const t = now();
  const r = IdleRules.settle(state, w, t); // everything up to now first, so an action lands on the present
  if (r.charted.length) charted(r.charted);
  switch (name) {
    case 'close': selected = null; sheets.show(null, state, t); tabs(); return;
    case 'open': pick(a.key || null); return;
    case 'sell': IdleRules.sell(state, w, a.key, a.kind, a.n, t); break;
    case 'place': IdleRules.place(state, w, a.key, a.recipe, t); break;
    case 'cancel': IdleRules.cancel(state, w, a.id); break;
    case 'shuttle': IdleRules.setShuttle(state, w, a.from, a.to, t); break;
    case 'drill': IdleRules.buyDrill(state, w, a.key, a.good, t); break;
    case 'drill-set': IdleRules.setDrill(state, w, a.id, a.good, t); break;
    case 'survey':
      if (IdleRules.survey(state, w, a.key, t) && a.open) { selected = a.key; map.focus(a.key); sheets.show({ kind: 'site', key: a.key }, state, t); }
      break;
    case 'build':
      if (IdleRules.build(state, w, a.id, a.site, t)) {
        navigator.vibrate?.(30);
        pick(IdleRules.stationOf(w, a.id).key);
      }
      break;
    default: return;
  }
  save.change();
  bar();
  sheets.refresh(state, t);
}

// ---------- Running ----------

function frame() {
  const H = window.innerHeight, navTop = $('nav').getBoundingClientRect().top, top = sheets.top;
  document.documentElement.style.setProperty('--nav-h', `${Math.round(H - navTop)}px`);
  map.inset($('bar').getBoundingClientRect().bottom - 8, H - (top ?? navTop));
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
