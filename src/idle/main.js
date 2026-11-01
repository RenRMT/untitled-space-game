// The idle game (idle/index.html; serve the repo, e.g. `npm start`, and open /idle/): a system with
// nothing built in it. Its bodies are charted one survey at a time; stations are built in orbit round
// them one after another; drills pull raw goods from them, the stations make things of them,
// shuttles carry them between, and the markets buy, all on the real clock while the page is closed
// (notes/idle.md is the plan, rules.js the rules).
//
// This module wires the page: loads the save (save.js) and catches up on the time away in slices,
// so a long absence never freezes the page, then says what happened; settles every second; draws
// the system every frame (map.js); keeps the header (the next thing to do, the credits) and the tab
// bar (System, Survey, Build, Chain, Lab, Market: the game's UI kit, ui/kit.js) up to date; opens a sheet for
// what's tapped (sheets.js) and carries out what its buttons ask, and leaving for a new system. Query parameters: ?fresh (a new
// save), ?seed= (a new save's system), ?fastresearch (the lab 60 times faster).
// ES module; needs a browser.

import { Clock } from '../core/clock.js';
import { Feedback } from '../core/feedback.js';
import { Params } from '../core/store.js';
import { Theme } from '../core/theme.js';
import { Recipes } from '../rules/recipes.js';
import { Research } from '../rules/research.js';
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
if (Params.has('fastresearch')) Research.config.speed = 60;
if (document.fonts?.load) for (const wt of [400, 700]) document.fonts.load(`${wt} 12px ${Theme.mono}`).catch(() => {});

// Haptics (core/feedback.js): a tap when something finishes (a survey, research, a contract), a
// firmer one when a station is built.
const BUZZ = { done: 20, built: 30 };
Feedback.on((ev) => { if (BUZZ[ev]) Feedback.vibrate(BUZZ[ev]); });

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
  { id: 'chain', label: 'Chain', code: 'RCP' },
  { id: 'lab', label: 'Lab', code: 'LAB' },
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
  else if (id === 'survey' || id === 'build' || id === 'chain' || id === 'lab') { selected = null; sheets.show({ kind: id }, state, t); }
  else if (id === 'market') {
    if (IdleRules.online(state, w, w.waystation.key)) { pick(w.waystation.key); return; }
    selected = null; sheets.show({ kind: 'build' }, state, t);
  }
  tabs();
}
function tabs() {
  const v = sheets.view;
  const on = !v ? 'system' : ['survey', 'build', 'chain', 'lab'].includes(v.kind) ? v.kind : v.kind === 'station' && v.key === w.waystation.key ? 'market' : 'system';
  const nb = IdleRules.nextBuild(state);
  const dots = {
    survey: !state.survey && state.credits >= IdleRules.surveyCost(state) && w.sites.some((s) => IdleRules.surveyable(state, w, s.key)),
    build: !!nb && IdleRules.buildStatus(state, w, nb.id).id === 'ready',
    chain: fixable(),
    lab: researchable(),
    market: deliverable(),
  };
  for (const t of TABS) {
    const el = tabEls.get(t.id), sel = String(t.id === on), dot = !!dots[t.id];
    if (el.getAttribute('aria-selected') === sel && el.dataset.dot === String(dot)) continue;
    el.setAttribute('aria-selected', sel);
    el.dataset.dot = String(dot);
    el.replaceChildren(Kit.icon(t.code, 24, { code: t.code, dot }), h('span', { class: 'lbl' }, t.label));
  }
}

// Places whose goods only go by hand (drill sites and stations with no shuttle or route), the fullest first:
// [{ key, name, share (of the room there) }].
function handHauled() {
  const I = IdleRules.industry, e = IdleRules.env(state), t = now();
  return [...w.sites.filter((s) => state.drills[s.key]), ...w.stations]
    .filter((x) => !I.shuttle(state.industry, x.key) && IdleRules.haulTarget(state, w, x.key) && (IdleRules.isSite(x.key) || I.at(state.industry, x.key).length)
      && !IdleRules.routes(state).some((r) => r.stops[0].station === x.key))
    .map((x) => ({ key: x.key, name: x.name, share: I.used(state.industry, x.key) / Math.max(1, I.capacity(state.industry, e, t, x.key)) }))
    .sort((a, b) => b.share - a.share);
}
// An order whose batch is done (no foreman at its station), if there is one.
const doneBatch = () => state.industry.orders.find((o) => o.left === 0 && !IdleRules.isSite(o.station)) || null;

// Whether the chain has something to mend that a tap would (not a station still to build).
const fixable = () => IdleRules.fixes(state, w).some((f) => f.kind !== 'build');
// Whether a contract can be delivered now.
const deliverable = () => IdleRules.contracts(state).some((c) => IdleRules.canDeliver(state, w, c.id));
// Whether the lab is idle and a package can be paid for now.
const researchable = () => !state.lab.active && Object.keys(Config.PACKAGES).some((id) => IdleRules.researchStatus(state, w, id).ok);

// ---------- The header: the credits, and the next thing to do ----------

// What to do next, in a few words, and what tapping it opens.
function hint() {
  const field = w.sites.find((s) => s.kind === 'field');
  const nb = IdleRules.nextBuild(state), way = IdleRules.online(state, w, w.waystation.key);
  if (!way) return { text: `Build the waystation round ${field.name}`, open: () => pick(field.key) };
  if (!Object.keys(state.drills).length) return { text: `Put a drill on ${field.name}`, open: () => pick(field.key) };
  const unshuttled = handHauled();
  const fill = unshuttled.find((x) => x.share >= 0.5 && IdleRules.canHaul(state, w, x.key));
  if (fill && fill.share >= 1) return { text: `${fill.name} is full: send a hauler`, open: () => pick(fill.key) };
  if (unshuttled.length && state.credits >= IdleRules.shuttleCost(state)) return { text: `Automate hauling from ${unshuttled[0].name}`, open: () => pick(unshuttled[0].key) };
  if (fill) return { text: `Haul from ${fill.name}`, open: () => pick(fill.key) };
  if (nb && IdleRules.buildStatus(state, w, nb.id).id === 'ready') return { text: `Build the ${nb.name.toLowerCase()}`, open: () => openTab('build') };
  const batch = doneBatch();
  if (batch) return { text: `Run again at ${batch.name}`, open: () => pick(batch.station) };
  if (fixable()) return { text: 'Fix the chain', open: () => openTab('chain') };
  if (deliverable()) return { text: 'Deliver a contract', open: () => openTab('market') };
  if (researchable()) return { text: 'Lab idle', open: () => openTab('lab') };
  const fm = state.built.find((id) => IdleRules.foremanStatus(state, w, id).ok);
  if (fm) { const st = IdleRules.stationOf(w, fm); return { text: `Hire a foreman at ${st.name}`, open: () => pick(st.key) }; }
  if (state.survey) return { text: 'Surveying…', open: () => openTab('survey') };
  if (w.sites.some((s) => IdleRules.surveyable(state, w, s.key)) && state.credits >= IdleRules.surveyCost(state)) return { text: 'Survey a signal', open: () => openTab('survey') };
  if (nb) {
    const s = IdleRules.buildStatus(state, w, nb.id);
    const short = s.short.map((x) => Recipes.item(x.kind)?.name || x.kind);
    if (s.credits) short.push('credits');
    return { text: `${nb.name}: needs ${short.join(', ')}`, open: () => openTab('build') };
  }
  return { text: 'Leave for a new system', open: () => openTab('build') };
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
  // Full, with nothing to carry it off but a hauler sent by hand: buying the shuttle keeps it going.
  const cost = IdleRules.shuttleCost(state);
  for (const x of handHauled()) {
    if (x.share >= 1) out.push({ key: x.key, name: x.name, why: 'Full', note: 'Nothing carries it off while you\'re away', fix: { act: 'buy-shuttle', args: { key: x.key }, label: 'Automate', price: cost } });
  }
  // A batch done, with no foreman to start the next.
  for (const o of state.industry.orders) {
    const b = w.byKey.get(o.station)?.build;
    if (o.left === 0 && b && !out.some((x) => x.key === o.station)) {
      const f = IdleRules.foremanStatus(state, w, b);
      out.push({ key: o.station, name: o.name, why: 'Batch done', note: `${Object.keys(Config.RECIPES[o.recipe].out).map((k) => Recipes.item(k)?.name || k).join(', ')}: a foreman keeps it going`, fix: f.ok ? { act: 'foreman', args: { id: b }, label: 'Hire foreman', price: f.credits } : { act: 'rerun', args: { id: o.id }, label: 'Run again' } });
    }
  }
  for (const st of w.stations) {
    if (IdleRules.online(state, w, st.key) && I.used(state.industry, st.key) >= I.capacity(state.industry, e, t, st.key)) out.push({ key: st.key, name: st.name, why: 'Stock full' });
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
  Feedback.emit('done');
  if (sheets.view?.kind === 'away') return;
  const c = list[list.length - 1];
  selected = c.key;
  map.focus(c.key);
  sheets.show({ kind: 'report', key: c.key, find: c.find }, state, now());
}

async function catchUp() {
  const from = state.seen, acc = { made: new Map(), delivered: new Map(), charted: [], researched: [], sold: {}, contracts: [] };
  const load = $('load');
  for (let slice = 0; ; slice++) {
    const r = IdleRules.settle(state, w, now());
    tally(acc, r.log);
    acc.charted.push(...r.charted);
    acc.researched.push(...r.researched);
    acc.contracts.push(...r.delivered);
    for (const [kind, x] of Object.entries(r.sold)) { const y = acc.sold[kind] || (acc.sold[kind] = { n: 0, credits: 0 }); y.n += x.n; y.credits += x.credits; }
    if (!r.truncated) break;
    load.hidden = false;
    load.textContent = `Catching up… ${slice + 1}`;
    await new Promise((res) => setTimeout(res, 0));
  }
  load.hidden = true;
  const ms = now() - from;
  const st = stuck();
  if (!loaded.fresh && ms > Config.AWAY_SHEET && (acc.made.size || acc.delivered.size || acc.charted.length || acc.researched.length || Object.keys(acc.sold).length || acc.contracts.length || st.length)) {
    selected = null;
    sheets.show({ kind: 'away', away: { ms, made: acc.made, delivered: acc.delivered, charted: acc.charted, researched: acc.researched, sold: acc.sold, contracts: acc.contracts, stuck: st } }, state, now());
  } else charted(acc.charted);
  save.change();
}

function tick() {
  if (!ready) return;
  const r = IdleRules.settle(state, w, now());
  if (r.log.length || r.charted.length || r.researched.length || Object.keys(r.sold).length || r.delivered.length) { map.made(r.log); save.change(); }
  if (r.researched.length || r.delivered.length || r.log.some((x) => x.haul)) Feedback.emit('done');
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
    case 'view': if (sheets.view) sheets.show({ ...sheets.view, ...a }, state, t); return;
    case 'pause': IdleRules.pause(state, w, a.id, a.paused, t); break;
    case 'raise': IdleRules.raise(state, w, a.id, t); break;
    case 'change': if (IdleRules.change(state, w, a.id, a.recipe, t)) sheets.show({ ...sheets.view, switching: null }, state, t); break;
    case 'research': IdleRules.research(state, w, a.id, t); break;
    case 'research-cancel': IdleRules.cancelResearch(state, w, a.id, t); break;
    case 'route-add':
      if (IdleRules.addRoute(state, w, a.from, a.to, a.kinds, t)) sheets.show({ ...sheets.view, draft: null }, state, t);
      break;
    case 'route-remove': IdleRules.removeRoute(state, w, a.id); break;
    case 'fix': {
      const f = a.fix;
      if (f.kind === 'route') IdleRules.addRoute(state, w, f.from, f.to, [f.good], t);
      else if (f.kind === 'shuttle') {
        // A link with no shuttle yet buys one; one that has a shuttle points it there.
        if (IdleRules.industry.shuttle(state.industry, f.from)) IdleRules.setShuttle(state, w, f.from, f.to, t);
        else if (IdleRules.buyShuttle(state, w, f.from, t, f.to)) Feedback.emit('done');
      }
      else if (f.kind === 'order') IdleRules.place(state, w, f.key, f.recipe, t);
      else { openTab('build'); return; }
      break;
    }
    case 'sell': IdleRules.sell(state, w, a.key, a.kind, a.n, t); break;
    case 'deliver': if (IdleRules.deliver(state, w, a.id, t)) Feedback.emit('done'); break;
    case 'auto': IdleRules.setAuto(state, a.kind, a.on); break;
    case 'place': IdleRules.place(state, w, a.key, a.recipe, t); break;
    case 'cancel': IdleRules.cancel(state, w, a.id); break;
    case 'shuttle': if (IdleRules.industry.shuttle(state.industry, a.from)) IdleRules.setShuttle(state, w, a.from, a.to, t); break;
    case 'haul': IdleRules.sendHaul(state, w, a.key, t); break;
    case 'buy-shuttle': if (IdleRules.buyShuttle(state, w, a.key, t)) Feedback.emit('done'); break;
    case 'rerun': IdleRules.rerun(state, w, a.id, t); break;
    case 'foreman': if (IdleRules.hireForeman(state, w, a.id, t)) Feedback.emit('done'); break;
    case 'keep': IdleRules.setKeep(state, a.id, a.on); break;
    case 'auto-survey': IdleRules.setAutoSurvey(state, a.on); break;
    case 'drill': IdleRules.buyDrill(state, w, a.key, a.good, t); break;
    case 'drill-set': IdleRules.setDrill(state, w, a.id, a.good, t); break;
    case 'survey':
      if (IdleRules.survey(state, w, a.key, t) && a.open) { selected = a.key; map.focus(a.key); sheets.show({ kind: 'site', key: a.key }, state, t); }
      break;
    case 'jump': jump(t); return;
    case 'build':
      if (IdleRules.build(state, w, a.id, a.site, t)) {
        Feedback.emit('built');
        buildScene(a.id);
      }
      break;
    default: return;
  }
  save.change();
  bar();
  sheets.refresh(state, t);
}

// ---------- A new system ----------

// Leaving for a new system (prestige): the new state is written at once and the page loads again on
// it, without ?fresh or ?seed= (which would throw it away).
function jump(t) {
  const r = IdleRules.jump(state, w, t);
  if (!r) return;
  ready = false;
  state = r.state;
  IdleSave.write(state);
  Feedback.emit('built');
  location.replace(location.pathname);
}

// ---------- The build scene ----------

// A station just built: the sheet makes way, the map plays its scene (map.built) under a card that
// names it, and then its sheet opens. A tap on the map or the card ends it early.
function buildScene(id) {
  const st = IdleRules.stationOf(w, id), b = Config.BUILDS.find((x) => x.id === id), card = $('scene');
  selected = st.key;
  sheets.show(null, state, now());
  tabs();
  card.replaceChildren(h('div', { class: 'k' }, 'Station online'), h('div', { class: 'n' }, st.name), h('div', { class: 's' }, `${b.name} · ${b.note}`));
  card.hidden = false;
  card.onclick = () => map.skip();
  map.built(st.key, () => {
    card.hidden = true;
    if (selected === st.key) pick(st.key);
  });
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
if (loaded.fresh || !state.built.length) pick(w.sites.find((s) => s.kind === 'field')?.key || null);
