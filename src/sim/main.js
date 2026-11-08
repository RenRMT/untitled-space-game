// Redshift (sim/index.html; serve the repo, e.g. `npm start`, and open /sim/): outrun a black hole
// one star system at a time (notes/sim.md). This module wires the page: the title screen (story or
// endless), the run's save, the clock (pause, 1×, 2×, 4×) that runs the rules (rules.js) and the
// events (events.js) on, the header (resources, the horizon meter, the advisor's line), the tab bar,
// the map (map.js) with build mode's marks and the bubbles over it, the sheets (sheets.js), the full
// screens (screens.js: the jump, a lost system) and the toasts, and carries out what their buttons ask.
// Query parameters: ?fresh (forget the run), ?seed= (a new run's seed), ?style=line|lowpoly.
// ES module; needs a browser.

import { Feedback } from '../core/feedback.js';
import { Params } from '../core/store.js';
import { Theme } from '../core/theme.js';
import { Kit } from '../ui/kit.js';
import { UI } from '../ui/ui.js';
import { SimConfig } from './config.js';
import { SimEvents } from './events.js';
import { SimFaces } from './faces.js';
import { SimMap } from './map.js';
import { SimRules } from './rules.js';
import { SimSave } from './save.js';
import { SimScreens } from './screens.js';
import { SimSheets } from './sheets.js';

const { h } = UI;
const C = SimConfig, R = SimRules;
const $ = (id) => document.getElementById(id);

const meta = SimSave.loadMeta();
if (Params.has('style')) meta.style = Params.get('style') === 'line' ? 'line' : 'lowpoly';
let style = meta.style;
let state = SimSave.loadRun();
const save = SimSave.writer(() => state);
const saveMeta = () => SimSave.writeMeta(meta);
let selected = null, onTitle = true, buildType = null;

const BUZZ = { done: 20, built: 30, bad: [40, 60, 40] };
Feedback.on((ev) => { if (BUZZ[ev]) Feedback.vibrate(BUZZ[ev]); });

const map = SimMap.create($('map'), { style, onPick: (key) => pick(key) });
const sheets = SimSheets.create($('sheets'), { act, onClose: () => { selected = null; map.focus(null); tabs(); } });
const screens = SimScreens.create($('screen'), { act });
function applyStyle() {
  document.documentElement.dataset.ui = style;
  Theme.setStyle(style);
  map.setStyle(style);
}
applyStyle();
const ctx = () => ({ state, meta, w: state ? R.world(state) : null, style, buildType });

function pick(key) {
  if (!state || onTitle) return;
  selected = key;
  map.focus(key);
  sheets.show(key ? { kind: 'body', key } : buildType ? { kind: 'build' } : null, ctx());
  tabs();
}

// ---------- The tab bar ----------
const TABS = [
  { id: 'system', label: 'System', code: 'ORB' },
  { id: 'build', label: 'Build', code: 'IND' },
  { id: 'cultures', label: 'Cultures', code: 'REP' },
  { id: 'gate', label: 'Gate', code: 'jump' },
  { id: 'chart', label: 'Chart', code: 'SYS' },
];
const tabEls = new Map(TABS.map((t) => {
  const el = h('button', { class: 'ui-tab', type: 'button', role: 'tab', onclick: () => openTab(t.id) });
  $('tabs').append(el);
  return [t.id, el];
}));
function openTab(id) {
  if (!state || onTitle) return;
  if (id !== 'build') buildType = null;
  selected = null;
  if (id === 'system') { map.focus(null); sheets.show(null, ctx()); }
  else sheets.show({ kind: id }, ctx());
  tabs();
}
function tabs() {
  if (!state) return;
  const v = sheets.view, on = !v ? 'system' : v.kind === 'body' ? (buildType ? 'build' : 'system') : v.kind;
  const g = R.gateStatus(state, meta);
  const dots = { gate: g.ok || g.done, cultures: Object.values(state.approval).some((a) => a <= C.APPROVAL.low) };
  for (const t of TABS) {
    const el = tabEls.get(t.id), sel = String(t.id === on), dot = !!dots[t.id];
    if (el.getAttribute('aria-selected') === sel && el.dataset.dot === String(dot)) continue;
    el.setAttribute('aria-selected', sel);
    el.dataset.dot = String(dot);
    el.replaceChildren(Kit.icon(t.code, 24, { code: t.code, dot }), h('span', { class: 'lbl' }, t.label));
  }
}

// ---------- The header ----------
const SPEED_LABEL = ['❚❚', '1×', '2×', '4×'];
const speedBtns = C.SPEEDS.map((s, i) => {
  const b = h('button', { type: 'button', 'aria-label': i ? `Speed ${s}` : 'Pause', onclick: () => { if (state && state.status === 'play') { state.speed = s; save.change(); bar(); } } }, SPEED_LABEL[i]);
  $('clock').append(b);
  return b;
});
$('menu-btn').addEventListener('click', () => { if (!state) return; selected = null; sheets.show({ kind: 'menu' }, ctx()); tabs(); });

const RES_ORDER = ['m', 'v', 'cr', 'sci'];
const resEls = {};
for (const id of RES_ORDER) {
  const v = h('span', { class: 'v' }), d = h('span', { class: 'd' }), slot = h('span', { class: 'ic' });
  const chip = h('div', { class: 'chip', title: C.RES[id].name, 'aria-label': C.RES[id].name }, slot, h('span', { class: 'vals' }, v, d));
  $('res').append(chip);
  resEls[id] = { chip, v, d, slot };
}
function resIcons() { for (const id of RES_ORDER) resEls[id].slot.replaceChildren(SimSheets.resIcon(id, style, 18)); }

function bar() {
  if (!state) return;
  const w = R.world(state), r = state.rates, d = R.dilation(state);
  $('sys-name').textContent = `${w.name} System`;
  $('sys-sub').textContent = `${state.mode === 'story' ? `Story · system ${state.depth + 1}` : `Endless · ${state.escaped} escaped`}${w.hazard ? ` · ${C.HAZARDS[w.hazard].name}` : ''}`;
  speedBtns.forEach((b, i) => b.setAttribute('aria-pressed', String(state.speed === C.SPEEDS[i])));
  const g = R.gateStatus(state, meta), need = g.cost || {};
  for (const id of RES_ORDER) {
    const n = Math.floor(state.res[id] ?? 0), e = resEls[id], rate = (r?.[id] || 0) * d;
    const txt = String(n), dt = `${rate >= 0 ? '+' : '−'}${Math.abs(rate).toFixed(1)}`;
    if (e.v.textContent !== txt) e.v.textContent = txt;
    if (e.d.textContent !== dt) { e.d.textContent = dt; e.d.className = `d ${rate > 0.05 ? 'up' : rate < -0.05 ? 'down' : ''}`; }
    e.chip.classList.toggle('short', need[id] > n);
  }
  const p = state.pull, lvl = p >= 90 ? 3 : p >= 75 ? 2 : p >= 50 ? 1 : 0;
  $('h-fill').style.width = `${p.toFixed(1)}%`;
  $('h-pct').textContent = `${p.toFixed(1)}%`;
  $('horizon').dataset.level = lvl;
  $('horizon').setAttribute('aria-valuenow', p.toFixed(0));
  const left = Math.max(0, Math.ceil((100 - p) * w.life / 100));
  $('h-note').textContent = lvl ? `time ×${d.toFixed(2)} · ${left} left` : `${left} cycles`;
  $('h-gate').textContent = g.done ? `gate ✓ · charge ${Math.round(g.charge * 100)}%` : g.building ? `gate: ${g.next.name} ${Math.round(g.f * 100)}%` : `gate ${g.stage}/${g.of}`;
}

// ---------- The advisor ----------
let advisor = null;
function advise() {
  if (!state) return;
  if (!advisor || advisor.seed !== state.seed) advisor = SimFaces.person('android', state.seed);
  const [text, open] = hint();
  const src = SimFaces.face(advisor, style, 64);
  if ($('adv-face').src !== src) $('adv-face').src = src;
  if ($('adv-text').textContent !== text) $('adv-text').textContent = text;
  $('advisor').onclick = open || null;
}
// What to do next, in a line, and what tapping it opens.
function hint() {
  const w = R.world(state), types = Object.values(state.stations).map((s) => s.type), g = R.gateStatus(state, meta);
  const best = (type) => w.bodies.filter((b) => b.kind !== 'gate' && !state.stations[b.key] && (!C.STATIONS[type].per || b[C.STATIONS[type].per] >= 2))[0];
  if (state.status === 'lost') return ['The horizon has us.', null];
  if (state.offers.length) return ['Someone is waiting on an answer.', () => openOffer(state.offers[0].id)];
  if (!types.includes('mine')) { const b = best('mine'); return [`Build a mining rig${b ? ` at ${b.name}` : ''}: minerals first.`, () => { buildType = 'mine'; openTab('build'); }]; }
  if (!types.includes('siphon')) { const b = best('siphon'); return [`Now a gas siphon${b ? ` at ${b.name}` : ''} for volatiles.`, () => { buildType = 'siphon'; openTab('build'); }]; }
  if (R.has(state, 'block') && !types.includes('hub')) return ['A trade hub would turn minerals and volatiles into credits.', () => { buildType = 'hub'; openTab('build'); }];
  if (g.ok) return [`We can afford the gate's ${g.next.name.toLowerCase()}. Build it.`, () => openTab('gate')];
  for (const [c, a] of Object.entries(state.approval)) if (a <= C.APPROVAL.low + 5) return [`The ${C.CULTURES[c].name} are unhappy. See what they want.`, () => openTab('cultures')];
  if (g.done) {
    if (state.pull >= 85) return ['Jump. Now. While we still can.', () => openTab('gate')];
    return [`The gate is ready. Every cycle we hold, it throws us further. ${Math.round(g.charge * 100)}% charge.`, () => openTab('gate')];
  }
  if (g.building) return [`The gate's ${g.next.name.toLowerCase()} is going up. ${R.dilation(state) < 1 ? 'Time is slowing.' : ''}`, () => openTab('gate')];
  const short = R.short(state, g.cost).map((r) => C.RES[r].name.toLowerCase());
  if (short.length) return [`The gate's ${g.next.name.toLowerCase()} needs ${short.join(' and ')}. More rigs, or ships for them?`, () => openTab('build')];
  return ['Tap a body to see what it holds.', null];
}

// ---------- Bubbles and toasts ----------
// Offers (requests, revolts, visitors: events.js) float over the bodies they're about, as the
// asker's face; a tap opens them.
const bubbleEls = new Map();
function bubbles() {
  const seen = new Set();
  for (const o of state.offers) {
    seen.add(o.id);
    let el = bubbleEls.get(o.id);
    if (!el) {
      el = h('button', { class: 'sim-bubble', type: 'button', 'aria-label': `${o.who.name}: ${o.title}`, style: { '--tone': C.CULTURES[o.who.culture].color }, onclick: () => openOffer(o.id) },
        SimFaces.img(o.who, style, 38, ''), h('span', { class: 'mark' }, o.mark || '!'));
      $('bubbles').append(el);
      bubbleEls.set(o.id, el);
    }
    const p = map.screenOf(o.key || R.world(state).gate);
    el.hidden = !p;
    if (p) { el.style.left = `${p.x}px`; el.style.top = `${p.y - p.r - 4}px`; }
  }
  for (const [id, el] of bubbleEls) if (!seen.has(id)) { el.remove(); bubbleEls.delete(id); }
}
function openOffer(id) {
  const o = state.offers.find((x) => x.id === id);
  selected = o?.key || null;
  if (o?.key) map.focus(o.key);
  sheets.show({ kind: 'offer', id }, ctx());
  tabs();
}

let toastTimer = 0;
function toast(kicker, text, { who = null, tone = null, ms = 3200 } = {}) {
  const el = $('toast');
  el.style.setProperty('--tone', tone || 'var(--cyan)');
  el.replaceChildren(who ? SimFaces.img(who, style, 36, '') : null, h('div', {}, h('div', { class: 'k' }, kicker), h('div', { class: 't' }, text)));
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, ms);
}
$('toast').addEventListener('click', () => { $('toast').hidden = true; });

// ---------- The title and the full screens ----------
function title() {
  onTitle = true;
  buildType = null;
  sheets.show(null, ctx());
  for (const el of bubbleEls.values()) el.remove();
  bubbleEls.clear();
  screens.title(state, meta, style);
}
function start(mode) {
  const seed = +Params.get('seed') || undefined;
  state = R.newRun(mode, meta, seed);
  meta.runs = (meta.runs || 0) + 1;
  saveMeta();
  save.change();
  resume();
}
function resume() {
  onTitle = false;
  screens.hide();
  map.setSystem(R.world(state));
  selected = null; buildType = null;
  bar(); tabs(); advise();
  if (state.status === 'lost') screens.lost(state, meta, style);
}

// ---------- Actions ----------
function act(name, a = {}) {
  const t0 = state;
  switch (name) {
    case 'start': start(a.mode); return;
    case 'continue': resume(); return;
    case 'style': style = meta.style = a.style; saveMeta(); applyStyle(); resIcons(); if (onTitle) screens.title(state, meta, style); break;
    case 'title': save.now(); title(); return;
    case 'buildmode': buildType = a.type; break;
    case 'open': pick(a.key); return;
    case 'offer': openOffer(a.id); return;
    case 'build':
      if (R.build(state, meta, a.key, a.type)) { Feedback.emit('done'); map.pulse(a.key); buildType = null; selected = a.key; map.focus(a.key); sheets.show({ kind: 'body', key: a.key }, ctx()); }
      break;
    case 'upgrade': if (R.upgrade(state, meta, a.key)) { Feedback.emit('built'); map.pulse(a.key); } break;
    case 'ship': if (R.addShip(state, meta, a.key)) { Feedback.emit('done'); map.pulse(a.key); } break;
    case 'slot': R.addSlot(state, meta, a.key); break;
    case 'demolish': R.demolish(state, meta, a.key); break;
    case 'gate': if (R.buildGate(state, meta)) { Feedback.emit('built'); map.pulse(R.world(state).gate); } break;
    case 'jumpscreen': state.speed = 0; sheets.show(null, ctx()); screens.jump(state, meta, style); return;
    case 'jumpback': screens.hide(); return;
    case 'jump': {
      const r = R.jump(state, meta, a.i);
      if (!r) return;
      saveMeta(); save.now();
      Feedback.emit('built');
      map.setSystem(R.world(state));
      screens.arrived(state, meta, style, r);
      return;
    }
    case 'arrive': state.speed = 1; resume(); return;
    case 'retry': R.retry(state, meta); save.now(); resume(); return;
    case 'endrun': { const r = R.endRun(state, meta); saveMeta(); state = null; SimSave.writeRun(null); screens.over(r, meta, style); return; }
    case 'answer': {
      const r = SimEvents.answer(state, meta, a.id, a.answer);
      if (r) { if (r.text) toast(r.kicker || 'Done', r.text, { who: r.who, tone: r.tone }); if (r.key) map.pulse(r.key, r.tone); saveMeta(); }
      sheets.show(null, ctx());
      break;
    }
    case 'archive': if (R.buyArchive(meta, a.id)) { Feedback.emit('built'); saveMeta(); } if (onTitle || screens.open) screens.refresh(state, meta, style); break;
    case 'chart': screens.past(state, a.i, style, map); return;
    default: break;
  }
  if (t0 && state) save.change();
  bar(); tabs(); advise();
  sheets.refresh(ctx());
}

// ---------- Events ----------
function onEvent(e) {
  const w = R.world(state), body = (k) => w.bodies.find((b) => b.key === k);
  switch (e.kind) {
    case 'built': map.pulse(e.key); toast('Online', `${C.STATIONS[e.type].name} at ${body(e.key).name}`, { who: SimFaces.person(state.stations[e.key].culture, state.stations[e.key].seed), tone: C.CULTURES[state.stations[e.key].culture].color }); Feedback.emit('done'); break;
    case 'gate': map.pulse(w.gate); toast(e.done ? 'Gate complete' : 'Gate', e.done ? 'The gate is ready. It will overcharge while we hold.' : `${C.GATE[e.stage - 1].name} complete.`, { who: advisor }); Feedback.emit('built'); break;
    case 'salvage': toast('Salvage', `The derelict at ${body(e.key).name} gave up ${Object.entries(e.got).map(([r, n]) => `${n} ${C.RES[r].name.toLowerCase()}`).join(' and ')}.`, { tone: 'var(--new)' }); break;
    case 'insight': toast('Ruins', `The ruins at ${body(e.key).name}: +${e.n} Insight at the jump.`, { tone: 'var(--new)' }); break;
    case 'mood': toast(C.CULTURES[e.culture].name, e.low ? 'are discontent: their stations slow.' : 'are devoted: their stations work harder.', { who: SimFaces.person(e.culture, state.terms.seed + e.culture.length * 101), tone: C.CULTURES[e.culture].color }); break;
    case 'lost': Feedback.emit('bad'); sheets.show(null, ctx()); screens.lost(state, meta, style); break;
    case 'toast': toast(e.kicker, e.text, { who: e.who, tone: e.tone }); if (e.key) map.pulse(e.key, e.tone); if (e.bad) Feedback.emit('bad'); break;
    default: break;
  }
}

// ---------- Running ----------
let lastT = performance.now(), slow = 0;
function frame() {
  const now = performance.now(), dt = Math.min(0.25, (now - lastT) / 1000);
  lastT = now;
  if (state && !onTitle) {
    if (!screens.open) {
      const events = R.tick(state, meta, (dt * 1000 * state.speed) / C.CYCLE_MS);
      events.push(...SimEvents.tick(state, meta, events));
      if (events.length) { save.change(); for (const e of events) onEvent(e); }
    }
    if (!state) { requestAnimationFrame(frame); return; }
    slow += dt;
    if (slow > 0.25) { slow = 0; bar(); tabs(); advise(); sheets.refresh(ctx()); }
    const H = window.innerHeight, navTop = $('nav').getBoundingClientRect().top, top = sheets.top;
    document.documentElement.style.setProperty('--nav-h', `${Math.round(H - navTop)}px`);
    map.inset($('bar').getBoundingClientRect().bottom, H - (top ?? navTop));
    map.draw(view());
    bubbles();
  } else if (screens.past) screens.drawPast(map);
  requestAnimationFrame(frame);
}

// What the map draws: the stations as it needs them, build mode's marks.
let marks = {}, marksAt = 0;
function view() {
  const stations = {};
  for (const [k, st] of Object.entries(state.stations)) stations[k] = { ...st, building: st.left > 0 ? 1 - st.left / st.total : null, dark: state.effects.storm > 0 };
  if (buildType && performance.now() - marksAt > 400) {
    marksAt = performance.now();
    marks = {};
    const w = R.world(state);
    for (const b of w.bodies) {
      if (b.kind === 'gate' || state.stations[b.key]) continue;
      const r = R.canBuild(state, meta, b.key, buildType), S = C.STATIONS[buildType];
      if (S.per && !b[S.per]) continue;
      const [res, n] = Object.entries(r.preview.out)[0] || ['sec', r.preview.sec];
      marks[b.key] = { n, text: `+${n.toFixed(1)} ${res === 'sec' ? 'sec' : C.RES[res].short}`, tone: r.ok ? (b.trait || n >= 1 ? 'good' : 'warn') : 'dim' };
    }
    // Only the best few say what they'd make, so the labels don't pile up.
    const top = Object.values(marks).sort((a, b) => b.n - a.n).slice(0, 4);
    for (const m of Object.values(marks)) if (!top.includes(m)) m.text = '';
  } else if (!buildType) {
    // Out of build mode: the bodies requests ask for, ringed in the asker's colour.
    marks = {};
    for (const q of state.requests) if (q.ask === 'place' && state.stations[q.key]?.type !== q.type) marks[q.key] = { text: C.STATIONS[q.type].name, color: C.CULTURES[q.culture].color };
  }
  const g = state.gate;
  return {
    time: state.time, pull: state.pull, stations, gate: { stage: g.stage, building: g.left > 0 ? { stage: g.stage, f: 1 - g.left / g.total } : null, charge: g.charge },
    selected, marks, hazard: state.terms.hazard, storm: state.effects.storm > 0, wormholes: state.offers.filter((o) => o.kind === 'alien').map((o) => o.key),
  };
}

window.addEventListener('resize', () => map.resize());
document.addEventListener('visibilitychange', () => { if (document.hidden && state) save.now(); });
window.addEventListener('pagehide', () => { if (state) save.now(); });
if (document.fonts?.load) for (const wt of [400, 700]) document.fonts.load(`${wt} 12px ${Theme.mono}`).catch(() => {});

// For the tests and the console: the page's parts by name.
window.SIM = { map, sheets, screens, get state() { return state; }, meta, act, pick, openTab, R };

resIcons();
title();
requestAnimationFrame(frame);
