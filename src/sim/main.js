// Redshift (sim/index.html; serve the repo, e.g. `npm start`, and open /sim/): outrun a black hole
// one star system at a time (notes/sim.md). This module wires the page: the title screen (story or
// endless), the run's save, the clock (pause, 1×, 2×, 4×) that runs the rules (rules.js) on, the
// header (resources, the horizon meter, the advisor's line), the tab bar, the map (map.js) and the
// sheets (sheets.js), and carries out what their buttons ask.
// Query parameters: ?fresh (forget the run), ?seed= (a new run's seed), ?style=line|lowpoly.
// ES module; needs a browser.

import { Feedback } from '../core/feedback.js';
import { Params } from '../core/store.js';
import { Theme } from '../core/theme.js';
import { Kit } from '../ui/kit.js';
import { UI } from '../ui/ui.js';
import { SimConfig } from './config.js';
import { SimFaces } from './faces.js';
import { SimMap } from './map.js';
import { SimRules } from './rules.js';
import { SimSave } from './save.js';
import { SimSheets } from './sheets.js';

const { h } = UI;
const C = SimConfig;
const $ = (id) => document.getElementById(id);

const meta = SimSave.loadMeta();
if (Params.has('style')) meta.style = Params.get('style') === 'line' ? 'line' : 'lowpoly';
let style = meta.style;
let state = SimSave.loadRun();
const save = SimSave.writer(() => state);
const saveMeta = () => SimSave.writeMeta(meta);
let selected = null, onTitle = true;

const BUZZ = { done: 20, built: 30, bad: [40, 60, 40] };
Feedback.on((ev) => { if (BUZZ[ev]) Feedback.vibrate(BUZZ[ev]); });

function applyStyle() {
  document.documentElement.dataset.ui = style;
  Theme.setStyle(style);
  map?.setStyle(style);
}

const map = SimMap.create($('map'), { style, onPick: (key) => pick(key) });
const sheets = SimSheets.create($('sheets'), { act, onClose: () => { selected = null; map.focus(null); tabs(); } });
applyStyle();
const ctx = () => ({ state, meta, w: state ? SimRules.world(state) : null, style });

function pick(key) {
  if (!state || onTitle) return;
  selected = key;
  map.focus(key);
  sheets.show(key ? { kind: 'body', key } : null, ctx());
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
  if (!state) return;
  if (id === 'system') { selected = null; map.focus(null); sheets.show(null, ctx()); }
  else { selected = null; sheets.show({ kind: id }, ctx()); }
  tabs();
}
function tabs() {
  const v = sheets.view, on = !v || v.kind === 'body' ? 'system' : v.kind;
  for (const t of TABS) {
    const el = tabEls.get(t.id), sel = String(t.id === on);
    if (el.getAttribute('aria-selected') === sel && el.dataset.built) continue;
    el.dataset.built = '1';
    el.setAttribute('aria-selected', sel);
    el.replaceChildren(Kit.icon(t.code, 24, { code: t.code }), h('span', { class: 'lbl' }, t.label));
  }
}

// ---------- The header ----------
const clockEl = $('clock');
const SPEED_LABEL = ['❚❚', '1×', '2×', '4×'];
const speedBtns = C.SPEEDS.map((s, i) => {
  const b = h('button', { type: 'button', 'aria-label': i ? `Speed ${s}` : 'Pause', onclick: () => { if (state) { state.speed = s; save.change(); bar(); } } }, SPEED_LABEL[i]);
  clockEl.append(b);
  return b;
});
$('menu-btn').addEventListener('click', () => { selected = null; sheets.show({ kind: 'menu' }, ctx()); tabs(); });

const RES_ORDER = ['m', 'v', 'cr', 'sci'];
const resEls = {};
for (const id of RES_ORDER) {
  const R = C.RES[id];
  const icon = R.icon ? h('img', { src: '', alt: '', 'aria-hidden': 'true', width: 18, height: 18 }) : Kit.icon('TRD', 18, { code: 'TRD' });
  const v = h('span', { class: 'v' }), d = h('span', { class: 'd' });
  const chip = h('div', { class: 'chip', title: R.name, 'aria-label': R.name }, icon, h('span', { class: 'vals' }, v, d));
  $('res').append(chip);
  resEls[id] = { chip, v, d, icon };
}
async function resIcons() {
  const { ItemIcons } = await import('../art/icons.js');
  for (const id of RES_ORDER) { const R = C.RES[id]; if (R.icon) resEls[id].icon.src = ItemIcons.url(R.icon, style, 18); }
}

function bar() {
  if (!state) return;
  const w = SimRules.world(state);
  $('sys-name').textContent = `${w.name} System`;
  $('sys-sub').textContent = state.mode === 'story' ? `Story · system ${state.depth + 1}` : `Endless · ${state.escaped} escaped`;
  speedBtns.forEach((b, i) => b.setAttribute('aria-pressed', String(state.speed === C.SPEEDS[i])));
  for (const id of RES_ORDER) {
    const n = Math.floor(state.res?.[id] ?? 0), e = resEls[id];
    if (e.v.textContent !== String(n)) e.v.textContent = String(n);
  }
  const p = state.pull, lvl = p >= 90 ? 3 : p >= 75 ? 2 : p >= 50 ? 1 : 0;
  $('h-fill').style.width = `${p.toFixed(1)}%`;
  $('h-pct').textContent = `${p.toFixed(1)}%`;
  $('horizon').dataset.level = lvl;
  $('horizon').setAttribute('aria-valuenow', p.toFixed(0));
  const left = Math.max(0, Math.ceil((100 - p) * w.life / 100));
  $('h-note').textContent = lvl ? `time ×${C.dilation(p).toFixed(2)} · ${left} cycles left` : `${left} cycles left`;
  $('h-gate').textContent = '';
}

// The advisor: an android, saying what to do next.
let advisor = null;
function advise(text, open) {
  if (!advisor || advisor.seed !== state.seed) {
    advisor = SimFaces.person('android', state.seed);
  }
  $('adv-face').src = SimFaces.face(advisor, style, 64);
  $('adv-text').textContent = text;
  $('advisor').onclick = open || null;
  $('advisor').hidden = !text;
}

// ---------- The title ----------
function title() {
  onTitle = true;
  sheets.show(null, ctx());
  const scr = $('screen');
  const hole = SimFaces.site({ kind: 'smbh', seed: 7, r: 40, jet: -1.4, jetWidth: 0.16 }, style, 220);
  const modes = h('div', { class: 'sim-modes' },
    state ? h('button', { class: 'sim-mode', type: 'button', onclick: () => resume() },
      h('img', { src: SimFaces.star(SimRules.world(state).star, style, 112), alt: '' }),
      h('span', {}, h('b', {}, 'Continue'), h('small', {}, `${SimRules.world(state).name} · ${state.mode === 'story' ? 'Story' : 'Endless'} · horizon ${Math.round(state.pull)}%`))) : null,
    h('button', { class: 'sim-mode', type: 'button', onclick: () => start('story') },
      h('img', { src: SimFaces.face(SimFaces.person('android', 7), style, 112), alt: '' }),
      h('span', {}, h('b', {}, 'Story'), h('small', {}, 'Seven systems. Meet the cultures one by one.'))),
    h('button', { class: 'sim-mode', type: 'button', onclick: () => start('endless') },
      h('img', { src: SimFaces.star({ cls: 'M', r: 200, seed: 3 }, style, 112), alt: '' }),
      h('span', {}, h('b', {}, 'Endless'), h('small', {}, meta.best ? `Everything at once. Best: ${meta.best} systems.` : 'Everything at once, for as long as you last.'))));
  scr.replaceChildren(h('div', { class: 'inner' },
    h('img', { class: 'sim-hero', src: hole, alt: '' }),
    h('h1', { class: 'sim-title' }, 'Red', h('span', {}, 'shift')),
    h('p', { class: 'sim-tag' }, 'The hole is eating the galaxy. Build, jump, stay ahead of it.'),
    modes));
  scr.hidden = false;
}
function start(mode) {
  const seed = +Params.get('seed') || undefined;
  state = SimRules.newRun(mode, meta, seed);
  meta.runs++;
  saveMeta();
  save.change();
  resume();
}
function resume() {
  onTitle = false;
  $('screen').hidden = true;
  map.setSystem(SimRules.world(state));
  selected = null;
  bar(); tabs();
  advise('Tap a body to see what it holds.', null);
}

// ---------- Actions ----------
function act(name, a = {}) {
  switch (name) {
    case 'style': style = meta.style = a.style; saveMeta(); applyStyle(); resIcons(); break;
    case 'title': save.now(); title(); return;
    default: break;
  }
  save.change();
  bar();
  sheets.refresh(ctx());
}

// ---------- Running ----------
let lastT = performance.now();
function frame() {
  const now = performance.now(), dt = Math.min(0.25, (now - lastT) / 1000);
  lastT = now;
  if (state && !onTitle) {
    const events = SimRules.tick(state, meta, (dt * 1000 * state.speed) / C.CYCLE_MS);
    if (events.length) { save.change(); for (const e of events) onEvent(e); }
    bar();
    const H = window.innerHeight, navTop = $('nav').getBoundingClientRect().top, top = sheets.top;
    document.documentElement.style.setProperty('--nav-h', `${Math.round(H - navTop)}px`);
    map.inset($('bar').getBoundingClientRect().bottom, H - (top ?? navTop));
    map.draw({ time: state.time, pull: state.pull, stations: {}, gate: null, selected });
  }
  requestAnimationFrame(frame);
}
function onEvent(e) {
  if (e.kind === 'lost') { Feedback.emit('bad'); state.speed = 0; }
}

window.addEventListener('resize', () => map.resize());
document.addEventListener('visibilitychange', () => { if (document.hidden) save.now(); });
window.addEventListener('pagehide', () => save.now());
if (document.fonts?.load) for (const wt of [400, 700]) document.fonts.load(`${wt} 12px ${Theme.mono}`).catch(() => {});

// For the tests and the console: the page's parts by name.
window.SIM = { map, sheets, get state() { return state; }, meta, act, pick, openTab };

resIcons();
title();
requestAnimationFrame(frame);
