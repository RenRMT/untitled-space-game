// The docked screen: the station header, one of the Trade / Ship / Research / Production / Missions
// tabs,
// and the icon tab bar with Launch at the foot. Built from the UI kit (ui/kit.js): the Ship tab is a
// schematic of the ship with a button per equipment slot, each opening a sheet of what can go there
// (with a squad, a switcher above it steps through the members' ships too, outfitted the same way;
// the Production tab steps through a station's orders with the same switcher);
// the Research tab (ui/research-view.js) is a tree of packages drawn the same way, each opening a
// sheet; the Production tab (ui/industry-view.js) draws this station's production orders as lines of
// nodes (inputs, the stage, what it makes), the shared storage as tiles and the production pipeline,
// the stage opening a sheet to pick its product and an input its lineage; the Missions tab is a card per mission, each opening a sheet with the briefing and objectives.
// StationMenu.open({ station: { name, subtitle, color }, market, hold, ship,
//                    outfitting, lab, industry, kit, shipyard, repairs, squad, missions, locks, artStyle, onLaunch })
// artStyle: the art style item icons are drawn in (Art.STYLES; 'line' if not given).
// market: { goods (Economy.market's, at the stockpiles now), good(kind), buy(kind), sell(kind), regard }:
//   buying and selling one unit at today's price, which moves it (game/docking.js marketAt);
//   regard: { owner, tier, shift } how the owner regards the player and what it does to prices.
// hold: { credits, items, capacity, free, count(kind), buy(kind, price, label), sell(kind, price) }.
// ship: Loadout.stats() of the ship as it is (kept up to date as gear changes).
// outfitting: { loadout, upgrades, gear, mods, canMake(id), sellPrice(id), hullPrice(id), tradeIn(), hullBlocked(id),
//               fit(slot, id), unfit(slot), fitMod(slot, id), removeMod(slot, i), sell(id), buyHull(id),
//               member(id) -> { loadout, upgrades, gear, mods, android: true, canMake, fit, unfit, fitMod, removeMod } }:
//               the ship's equipment and mods, spare gear and mods, whether industry can make a
//               piece, the shipyard, and each squad member's ship (game/outfitting.js).
// lab: { state, components, now(), progress(), status(id), enqueue(id), cancel(id), settle({ quiet }) }:
//   research on the real-world clock (rules/research.js, game/lab.js).
// industry: game/industry.js: production orders at stations and the shared storage (rules/industry.js).
// kit: { [ability id]: charges }: consumables for abilities in a fight (rules/abilities.js).
// shipyard: whether this station sells hulls (capital and major stations).
// repairs: { hull, max, price, cost, repair() }: hull damage from combat and fixing it for credits.
// squad: { members, known, limit, runs(id), set(id, i, line), remove(id, i), move(id, from, to), toggle(id, i) }:
//   the squad (rules/squad.js), each member with its program (rules/logic.js), and editing it
//   (game/squad.js programs).
// missions: { list() -> [mission view] }: the missions to show here (story/missions.js, game/missions.js,
//   the galaxy's jobs: game/jobs.js), each
//   { id, title, from, face?(ctx, size), status ('offered' | 'active' | 'ready' | 'done'), here (it's
//   offered, or handed in, at this station), lines: [what the giver says now], objectives: [{ label,
//   count, need, done, open, percent }], provided?, reward (in words), pays? ({ credits, items: [{ kind, n }], also: [text] }:
//   the reward as the card shows it, credits and item icons; also: the rest, the sheet only), note?, handIn? (the station it's handed
//   in at, by name), tracked?, accept?(), complete?(), track?(), abandon?() }.
// locks() -> { tabs: [tab names], reason, launch }: tabs that can't be opened yet and why, and why
//   Launch can't be pressed yet (null when it can). Asked again after every change.
// ES module (`StationMenu`); needs a browser.

import { Format } from '../core/format.js';
import { clamp } from '../core/math.js';
import { Store } from '../core/store.js';
import { ItemIcons } from '../art/icons.js';
import { Abilities } from '../rules/abilities.js';
import { Economy } from '../rules/economy.js';
import { Goods } from '../rules/goods.js';
import { Industry } from '../rules/industry.js';
import { Loadout } from '../rules/loadout.js';
import { Logic } from '../rules/logic.js';
import { Mining } from '../rules/mining.js';
import { Mods } from '../rules/mods.js';
import { Research } from '../rules/research.js';
import { Squad } from '../rules/squad.js';
import { Kit } from './kit.js';
import { Messages } from './messages.js';
import { IndustryView } from './industry-view.js';
import { ResearchView } from './research-view.js';
import { UI } from './ui.js';

const StationMenu = (() => {
  const root = document.getElementById('station');
  const body = document.getElementById('st-body');
  const layer = document.getElementById('st-layer'); // where sheets go (Kit.sheet)
  const tabs = [...root.querySelectorAll('[role="tab"]')];
  const el = (id) => document.getElementById(id);

  // The price gauge spans this range of the base price (see rules/economy.js factors and jitter).
  const GAUGE = [0.55, 1.6];

  let ctx = null; // the open() options while docked
  let tab = 'trade';
  let viewing = null; // the squad member the Ship tab shows (its id), or null: your own ship
  let openSlot = null; // the loadout slot whose sheet is open, if any
  let openMission = null; // the mission whose sheet is open, if any
  let openLine = null; // the program line whose sheet is open: { id (member), i, draft }
  let openNode = null; // the research package whose sheet is open, if any
  let openOrder = null; // the production order sheet open (ui/industry-view.js sheet(open))
  let openYard = false; // the shipyard's sheet is open
  let openNews = null; // what finished since the last dock ([{ text, tab }]), its sheet open
  let sheet = null; // the open sheet (Kit.sheet)
  let openOption = null, openStat = null, openHull = null, openKit = null; // expanded rows, chips, tiles
  let doneOpen = false; // completed missions unfolded

  const { h } = UI; // ui/ui.js

  // ---------- The tab bar ----------
  // Five tabs, each named under its icon (Production goes by Industry there: it fits). The squad lives on the Ship tab: it steps through your
  // ship and each wingman's, and a wingman's page carries its program under its loadout (named
  // Ships once there is a squad). showTab('squad') opens it on a wingman.
  const TABS = {
    trade: { code: 'TRD', label: 'Trade' }, ship: { code: 'SHP', label: 'Ship' }, research: { code: 'RSC', label: 'Research' },
    industry: { code: 'IND', label: 'Industry' }, missions: { code: 'MSN', label: 'Missions' },
  };
  // A dot on a tab with something waiting: a mission to hand in or a story mission offered; research
  // finished since the Research tab was last open; a production order done or stuck.
  const tabDots = {};
  for (const t of tabs) {
    const { code, label } = TABS[t.dataset.tab];
    const icon = Kit.icon(`tab-${t.dataset.tab}`, 28, { code });
    tabDots[t.dataset.tab] = icon.appendChild(h('span', { class: 'dot', hidden: true }));
    t.replaceChildren(icon, h('span', { class: 'lbl' }, label));
    t.setAttribute('aria-label', label);
  }
  let researchSeen = Store.getJSON('researchSeen', 0) || 0; // how many packages were done when Research was last open
  function researchWaiting() {
    const lab = ctx.lab && ctx.lab.state;
    if (lab && Array.isArray(lab.done) && lab.done.length < researchSeen) researchSeen = lab.done.length; // another galaxy's save
    return !!(lab && Array.isArray(lab.done) && lab.done.length > researchSeen);
  }
  function ordersWaiting() {
    const ind = ctx.industry;
    return !!(ind && ind.state && ind.state.orders.some((o) => ['done', 'blocked'].includes(Industry.status(ind.state, o).id)));
  }

  function renderHeader() {
    el('st-name').textContent = ctx.station.name;
    el('st-sub').textContent = ctx.station.subtitle;
    el('st-credits').textContent = ctx.hold.credits.toLocaleString('en-US');
    root.style.setProperty('--culture', ctx.station.color);
  }

  // A tab's first line: its count or note (what the tab's name above it used to sit beside; the
  // tab bar already names the tab), and an ⓘ once the tab's explanations have folded away.
  // Renders call lead(text); refresh() puts the line on top.
  let leadText = '';
  const lead = (text) => { leadText = text || ''; };
  // A ship's name line (the Ship tab): its name, then a count or note.
  const titleRow = (title, aside) => h('div', { class: 'st-title' }, h('h2', { class: 'ui-title' }, title), aside ? h('span', { class: 'aside num' }, aside) : null);
  // Explanations ("Production orders make goods...") show on the first EXPLAIN_VISITS docks a tab is
  // seen at; after that they fold behind the tab's ⓘ, which shows them all again.
  const EXPLAIN_VISITS = 3;
  const explained = Store.getJSON('explained', {}) || {};
  const seenThisDock = new Set();
  let infoOpen = false, folded = false;
  function explain(key, text) {
    if (!seenThisDock.has(key)) {
      seenThisDock.add(key);
      explained[key] = (explained[key] || 0) + 1;
      Store.setJSON('explained', explained);
    }
    if (explained[key] <= EXPLAIN_VISITS || infoOpen) return h('p', { class: 'ui-note' }, text);
    folded = true;
    return null;
  }
  // A section folded away under a heading that says what's in it ("Spare gear · 3"); open ones stay
  // open while docked here and at the next station.
  const unfolded = new Set();
  function fold(key, label, content) {
    const open = unfolded.has(key);
    return [Kit.disclosure({ label, open, onToggle: () => { if (open) unfolded.delete(key); else unfolded.add(key); refresh(); } }), open ? content : null];
  }
  function leadLine() {
    if (!leadText && !folded && !infoOpen) return null;
    const info = folded || infoOpen ? h('button', {
      class: 'ui-iconbtn st-info', type: 'button', 'aria-expanded': String(infoOpen), 'aria-label': infoOpen ? 'Hide the explanations' : 'Explain this screen',
      title: infoOpen ? 'Hide the explanations' : 'Explain this screen', onclick: () => { infoOpen = !infoOpen; refresh(); },
    }, 'ⓘ') : null;
    return h('div', { class: 'st-lead' }, h('span', { class: 'num' }, leadText), info);
  }
  const section = (label, ...children) => h('section', { class: 'st-sec', 'aria-label': label }, children);
  // A button that does something, then shows the result.
  const act = (fn, after) => () => { fn(); refresh(); if (after) after(); };

  // An item type's icon: its own art in the current style (art/icons.js). The name is beside it,
  // so the icon is decoration to screen readers.
  function itemIcon(kind, size) {
    return h('img', {
      class: 'icon', src: ItemIcons.url(kind, ctx.artStyle, size), alt: '', 'aria-hidden': 'true',
      width: size, height: size, draggable: 'false',
    });
  }

  // ---------- Trade ----------

  // Where a price sits between cheap and dear, as a marker on a slim track.
  function gauge(price, base) {
    const k = clamp((price / base - GAUGE[0]) / (GAUGE[1] - GAUGE[0]), 0, 1);
    const tone = price / base < 0.88 ? 'cheap' : price / base > 1.12 ? 'dear' : '';
    const word = tone === 'cheap' ? 'Cheap here' : tone === 'dear' ? 'Dear here' : 'Usual price';
    return h('span', { class: 'st-gauge', role: 'img', 'aria-label': word, title: word },
      h('span', { class: `mark ${tone}`, style: { left: `${k * 100}%` } }));
  }

  // A trade good: its icon and name, how many you hold, how many the station has left, where the
  // price sits, Buy (if stocked here) and Sell. Each unit moves the price (rules/economy.js).
  function goodRow(g, full) {
    const { hold, market } = ctx;
    const name = Goods.type(g.kind).name;
    const n = hold.count(g.kind);
    // Hold Buy or Sell down to keep buying or selling, one a moment (Kit.button repeat), each at
    // the price after the last.
    const buyOne = () => {
      const ok = market.buy(g.kind);
      refresh();
      const now = market.good(g.kind);
      return ok && hold.free > 0 && now.left > 0 && hold.credits >= now.buy;
    };
    const sellOne = () => { const ok = market.sell(g.kind); refresh(); return ok && hold.count(g.kind) > 0; };
    const buy = g.buy === null
      ? h('span', { class: 'lock' }, 'Not sold')
      : g.left < 1
        ? h('span', { class: 'lock' }, 'Sold out')
        : Kit.button('Buy', buyOne, {
          price: g.buy, disabled: full || hold.credits < g.buy, aria: `Buy ${name} for ${g.buy} credits (hold to buy more)`, repeat: true,
        });
    const sell = Kit.button('Sell', sellOne, {
      kind: 'ghost', price: g.sell, disabled: n < 1, aria: `Sell ${name} for ${g.sell} credits (hold to sell more)`, repeat: true,
    });
    return Kit.optionRow({
      icon: h('span', { class: 'st-item' }, itemIcon(g.kind, 40), n ? h('span', { class: 'n num' }, `×${n}`) : null),
      name,
      sub: g.buy !== null && g.left > 0 ? `${g.left} in stock` : null,
      // Against the usual price on the same side of the spread, so an ordinary price sits mid-track.
      extra: gauge(g.buy ?? g.sell, Economy.basePrice(g.kind) * (1 + (g.buy === null ? -1 : 1) * Economy.config.spread)),
      action: h('span', { class: 'st-deal' }, buy, sell),
    });
  }

  // What the owner's regard does to prices here (rules/reputation.js), when it does anything.
  function regardLine(r) {
    if (!r || !r.shift) return null;
    const pct = `${Math.round(Math.abs(r.shift) * 100)}%`;
    return r.shift < 0
      ? Kit.callout(`${r.owner} · ${r.tier}: ${pct} better prices here, buying and selling.`, 'var(--good)')
      : Kit.callout(`${r.owner} · ${r.tier}: ${pct} worse prices here, buying and selling.`, 'var(--warn)');
  }

  // How many of the hold's goods the shared storage can take now (game/industry.js deposit), and
  // why none if it can't: the Industry tab still locked, or storage full.
  function storeRoom() {
    const ind = ctx.industry;
    if (!ind || !ind.state || isLocked('industry')) return { free: 0, why: 'Storage opens with the Industry tab' };
    const free = Industry.free(ind.state, ind.env(), ind.now());
    return { free, why: free < 1 ? 'Storage is full' : '' };
  }

  // Trade: the hold, with Sell all and Store all (always there, greyed out when there's nothing for
  // them to do); what this station sells, by name; and what else you're carrying that it doesn't
  // sell, with what it fetches here. (Components aren't traded: they go to refits and research.)
  function renderTrade() {
    const { market, hold } = ctx;
    const full = hold.free < 1;
    const byName = (a, b) => Goods.type(a.kind).name.localeCompare(Goods.type(b.kind).name);
    const goods = market.goods;
    const stocked = goods.filter((g) => g.buy !== null).sort(byName);
    const carried = goods.filter((g) => g.buy === null && hold.count(g.kind) > 0).sort(byName);
    // Sell all: everything in the hold this station buys, in one go, a unit at a time (so each at
    // the price the last left).
    const sellable = goods.filter((g) => g.sell !== null && hold.count(g.kind) > 0);
    const sellAll = () => {
      for (const g of sellable) while (hold.count(g.kind) > 0 && market.sell(g.kind));
      refresh();
    };
    // Store all: the whole hold into the shared storage (the Industry tab's), as much as fits.
    const room = storeRoom();
    const kinds = [...new Set(hold.items.map((it) => it.kind))];
    const storeAll = () => {
      for (const k of kinds) ctx.industry.deposit(k);
      refresh();
    };
    const empty = hold.items.length < 1;
    lead('');
    return [
      explain('trade', 'Hold Buy or Sell down to buy or sell more than one. Prices follow supply: selling a lot drives the price down, buying a lot drives it up, and stations recover over time.'),
      h('div', { class: 'st-holdbar' }, Kit.icon('hold', 24, { code: 'HLD' }), Kit.meter(hold.items.length / hold.capacity, { color: full ? 'var(--warn)' : null }),
        h('span', { class: 'num st-holdn' }, `${hold.items.length}/${hold.capacity}`),
        h('span', { class: 'st-acts' },
          Kit.button('Store all', storeAll, {
            kind: 'ghost', disabled: empty || room.free < 1,
            title: empty ? 'Nothing in the hold' : room.why || 'Move everything in the hold into storage',
            aria: 'Move everything in the hold into storage',
          }),
          Kit.button('Sell all', sellAll, {
            kind: 'ghost', disabled: !sellable.length,
            title: empty ? 'Nothing in the hold' : sellable.length ? 'Sell everything in the hold that this station buys' : 'This station buys nothing in your hold',
            aria: 'Sell everything in the hold that this station buys',
          }))),
      full ? Kit.callout('Your hold is full. Sell or store goods to make room.', 'var(--warn)') : null,
      regardLine(market.regard),
      section('Sold here', Kit.head('Sold here'),
        stocked.length ? h('div', { class: 'ui-list' }, stocked.map((g) => goodRow(g, full))) : h('p', { class: 'ui-empty' }, 'Nothing for sale here.')),
      carried.length ? section('Not sold here', Kit.head('Not sold here', h('span', { class: 'aside' }, 'in your hold')),
        h('div', { class: 'ui-list' }, carried.map((g) => goodRow(g, full)))) : null,
    ];
  }

  // ---------- Ship ----------

  const SLOT_CODE = { weapon: 'WPN', shield: 'SHD', computer: 'CPU', engine: 'ENG', scanner: 'SCN' };
  const SLOT_KIND = { ...Loadout.SLOT_TYPES, weapon: 'Weapon hardpoint' };
  const SHORT = { computer: 'Computer' }; // slot labels on the schematic
  const lineName = (item) => Loadout.LINES[item.line].name; // the name without its Mk
  const deg = (r) => Math.round((r * 180) / Math.PI);
  const r2 = (v) => Math.round(v * 100) / 100;
  const pct = (v) => `${Math.round(v * 100)}%`;
  const k1 = (v) => `${(v / 1000).toFixed(1)}k`;
  // What the slot sheet compares, per slot type (Loadout.summary has the same stats as text).
  const METRICS = {
    weapon: [
      { code: 'DPS', label: 'Firepower', get: (i) => i.stats.damage * i.stats.fireRate, fmt: (v) => `${r2(v)}/s`, fmtDiff: (v) => `${r2(v)}` },
      { code: 'RNG', label: 'Range', get: (i) => i.stats.range, fmt: String, fmtDiff: String },
      { code: 'ARC', label: 'Firing arc', get: (i) => i.stats.arc, fmt: (v) => `${v}°`, fmtDiff: (v) => `${v}°` },
    ],
    shield: [
      { code: 'STR', label: 'Strength', get: (i) => i.stats.strength, fmt: String, fmtDiff: String },
      { code: 'RCH', label: 'Recharge', get: (i) => i.stats.recharge, fmt: (v) => `${v}/s`, fmtDiff: String },
    ],
    computer: [
      { code: 'AIM', label: 'Accuracy', get: (i) => i.stats.accuracy, fmt: pct, fmtDiff: pct },
      { code: 'LCK', label: 'Lock time', get: (i) => i.stats.lockTime, fmt: (v) => `${r2(v)} s`, fmtDiff: (v) => `${r2(v)}s`, dir: -1, none: Loadout.stats({ hull: 'courier', fitted: {} }).lockTime },
      { code: 'MIN', label: 'Mining', get: (i) => i.stats.miningRate, fmt: (v) => `×${r2(v)}`, fmtDiff: (v) => `${r2(v)}` },
    ],
    engine: [
      { code: 'SPD', label: 'Top speed', get: (i) => i.stats.maxSpeed, fmt: String, fmtDiff: String },
      { code: 'ACC', label: 'Acceleration', get: (i) => i.stats.accel, fmt: String, fmtDiff: String },
      { code: 'TRN', label: 'Turn rate', get: (i) => i.stats.turnRate, fmt: (v) => `${deg(v)}°/s`, fmtDiff: (v) => `${deg(v)}°` },
      { code: 'EVA', label: 'Evasion', get: (i) => i.stats.evasion, fmt: pct, fmtDiff: pct },
    ],
    scanner: [
      { code: 'IDN', label: 'Identify', get: (i) => i.stats.sensorRange, fmt: k1, fmtDiff: k1 },
      { code: 'PNG', label: 'Ping', get: (i) => i.stats.pingRange, fmt: k1, fmtDiff: k1 },
      { code: 'LCK', label: 'Lock range', get: (i) => i.stats.lockRange, fmt: k1, fmtDiff: k1, none: Loadout.stats({ hull: 'courier', fitted: {} }).lockRange },
    ],
  };
  const valuesOf = (item) => METRICS[item.slot].map((m) => [m.code, m.fmt(m.get(item))]);

  // Where the slot buttons sit on the 358 × 330 schematic (left, top), and where each one's leader
  // line meets the outline. Hulls with three or four hardpoints put the shield and computer in the
  // bottom corners.
  const NODE = { w: 76, h: 84 };
  function layout(slots) {
    const many = slots.filter((s) => s.type === 'weapon').length > 2;
    return many
      ? { scanner: [141, 0], 'weapon-1': [6, 0], 'weapon-2': [276, 0], 'weapon-3': [6, 123], 'weapon-4': [276, 123], shield: [6, 246], computer: [276, 246], engine: [141, 246] }
      : { scanner: [141, 0], 'weapon-1': [6, 60], 'weapon-2': [276, 60], shield: [6, 186], computer: [276, 186], engine: [141, 246] };
  }
  const ANCHOR = {
    scanner: [179, 100], 'weapon-1': [160, 150], 'weapon-2': [198, 150], 'weapon-3': [128, 198], 'weapon-4': [230, 198],
    shield: [142, 210], computer: [216, 210], engine: [179, 226],
  };
  // The generic outline every hull is drawn as for now; per-hull art can replace it (Loadout.HULLS ids).
  const OUTLINE = '179,96 196,140 236,196 236,212 204,206 196,226 162,226 154,206 122,212 122,196 162,140';
  function schematic(slots) {
    const pos = layout(slots);
    const lines = [], dots = [];
    for (const s of slots) {
      const [x, y] = pos[s.id] || [0, 0], [ax, ay] = ANCHOR[s.id] || [179, 160];
      const from = x < 100 ? [x + NODE.w, y + NODE.h / 2] : x > 200 ? [x, y + NODE.h / 2] : [x + NODE.w / 2, y < 100 ? y + NODE.h : y];
      lines.push(`<line x1="${from[0]}" y1="${from[1]}" x2="${ax}" y2="${ay}"/>`);
      dots.push(`<circle cx="${ax}" cy="${ay}" r="2.5"/>`);
    }
    const art = h('div', { class: 'st-outline', 'aria-hidden': 'true' });
    art.innerHTML = '<svg viewBox="0 0 358 330">'
      + `<g stroke="#26304a" stroke-dasharray="3 3" fill="none">${lines.join('')}</g><g fill="#3a4566">${dots.join('')}</g>`
      + `<polygon points="${OUTLINE}" fill="rgba(125,249,255,0.04)" stroke="#7df9ff" stroke-opacity="0.55" stroke-width="1.25" stroke-linejoin="round"/>`
      + '<line x1="179" y1="120" x2="179" y2="206" stroke="#7df9ff" stroke-opacity="0.2"/></svg>';
    return h('section', { class: 'ui-schematic', 'aria-label': 'Loadout' }, art, slots.map((s) => {
      const [x, y] = pos[s.id] || [0, 0];
      const label = s.type === 'weapon' ? s.label : SHORT[s.type] || s.label;
      return Kit.slotNode({ x, y, label, code: SLOT_CODE[s.type], item: s.item, open: openSlot === s.id, onclick: () => showSlot(s.id) });
    }));
  }

  // A slot's mods: fitted ones (Remove), then spare ones that fit this kind of gear (Fit), each with
  // what it changes on the gear fitted, as far as there's room (rules/mods.js).
  function modSection(s) {
    const o = outfit(), cur = s.item;
    if (!cur) return null;
    const room = Mods.SLOTS[cur.tier], list = o.loadout.mods?.[s.id] || [];
    const asItem = (mods) => ({ stats: Loadout.tuned(cur.stats, Loadout.bonusFor(cur, o.upgrades, mods)) });
    const now = asItem(list);
    const fitted = list.map((m, i) => Kit.optionRow({
      code: 'MOD', name: Mods.MODS[m].name, sub: Mods.MODS[m].note, current: true,
      rows: Kit.compare(asItem(list.filter((x, k) => k !== i)), now, METRICS[s.type]).filter((r) => r.diff),
      action: Kit.button('Remove', act(() => o.removeMod(s.id, i)), { kind: 'ghost', aria: `Remove ${Mods.MODS[m].name}` }),
    }));
    const spare = Object.keys(o.mods).filter((m) => Mods.fits(m, s.type)).map((m) => Kit.optionRow({
      code: 'MOD', name: Mods.MODS[m].name, tag: `Spare ×${o.mods[m]}`, tagTone: 'good', sub: Mods.MODS[m].note,
      rows: Kit.compare(asItem([]), asItem([m]), METRICS[s.type]).filter((r) => r.diff), // what it does on its own
      action: Kit.button('Fit', act(() => o.fitMod(s.id, m)), {
        kind: 'primary', disabled: list.length >= room, title: list.length >= room ? 'No room for another mod' : undefined, aria: `Fit ${Mods.MODS[m].name}`,
      }),
    }));
    return [
      h('span', { class: 'ui-label' }, `Mods · ${list.length}/${room}`),
      room ? null : h('p', { class: 'ui-note' }, 'Mk I gear has no room for mods: Mk II and III have one, Mk IV and V two.'),
      fitted, spare,
      room && !fitted.length && !spare.length ? h('p', { class: 'ui-note' }, 'No spare mods for this gear: assemble them at an assembler once researched.') : null,
    ];
  }

  // The outfitting of the ship the Ship tab shows: yours, or a squad member's (game/outfitting.js).
  const outfit = () => (viewedMember() && ctx.outfitting.member?.(viewing)) || ctx.outfitting;

  // Whether a piece of gear is waiting in storage (game/industry.js), for the slot sheet.
  const inStore = (id) => !!ctx.industry?.state.storage[id];

  // The sheet for one slot: what's fitted (Remove), then spare gear (Fit), and the next Mk of each
  // line for this slot: assembled by industry, once its blueprint is researched. Each with its stat
  // changes against what's fitted. On a squad member's ship, spare android gear is among the
  // options too (it fits squad ships only, and isn't made).
  function slotSheet(id) {
    const m = viewedMember(), o = outfit();
    const s = Loadout.slots(o.loadout, o.upgrades).find((x) => x.id === id);
    if (!s) return null;
    const cur = s.item;
    const npc = (e) => !!Loadout.EQUIPMENT[e].npc;
    const ids = Object.keys(Loadout.EQUIPMENT).filter((e) => Loadout.EQUIPMENT[e].slot === s.type && e !== cur?.id && (!npc(e) || (o.android && o.gear[e])));
    // Of each line (that industry makes), the Mk after the best you have (fitted or spare).
    const next = new Set();
    for (const line of new Set(ids.filter((e) => !npc(e)).map((e) => Loadout.EQUIPMENT[e].line))) {
      const best = Math.max(0, ...[cur?.id, ...Object.keys(o.gear)].filter((e) => e && Loadout.EQUIPMENT[e].line === line).map((e) => Loadout.EQUIPMENT[e].tier));
      const n = ids.filter((e) => Loadout.EQUIPMENT[e].line === line && Loadout.EQUIPMENT[e].tier > best && !o.gear[e]).sort((x, y) => Loadout.EQUIPMENT[x].tier - Loadout.EQUIPMENT[y].tier)[0];
      if (n) next.add(n);
    }
    const rank = (e) => (o.gear[e] ? 0 : o.canMake(e) ? 1 : 2);
    const options = ids.filter((e) => o.gear[e] || next.has(e))
      .sort((a, b) => rank(a) - rank(b) || Loadout.EQUIPMENT[a].tier - Loadout.EQUIPMENT[b].tier)
      .map((e) => {
        const item = { id: e, ...Loadout.EQUIPMENT[e] };
        const kind = ['fit', 'make', 'locked'][rank(e)];
        const stored = inStore(e);
        const fitted = () => {
          closeSheet();
          refresh();
        };
        return Kit.optionRow({
          code: SLOT_CODE[s.type], name: lineName(item), tier: item.tier, rows: Kit.compare(cur, item, METRICS[s.type]),
          tag: kind === 'fit' ? `Spare ×${o.gear[e]}` : stored ? 'In storage' : kind === 'make' ? 'Can be made' : 'Blueprint needed',
          tagTone: kind === 'fit' ? 'good' : kind === 'make' || stored ? 'cyan' : null,
          locked: kind === 'locked',
          note: kind === 'fit' ? `${npc(e) ? 'Android gear, for squad ships.' : 'Spare gear aboard.'} Fitting it ${cur ? 'moves the current one to spare gear' : 'fills this slot'}.`
            : [stored ? 'Made, and waiting in storage: take it out from the Production tab at any station.' : '',
              kind === 'make' ? 'Assembled by a production order at a shipyard (Production tab), from parts.' : 'Research its blueprint first (Research tab), or recover a schematic from pirates.'].filter(Boolean).join(' '),
          open: openOption === e, onToggle: () => { openOption = openOption === e ? null : e; refresh(); },
          action: kind === 'fit' ? Kit.button('Fit', act(() => o.fit(s.id, e), fitted), { kind: 'primary', aria: `Fit ${item.name}` }) : null,
          lockLabel: null,
        });
      });
    return {
      title: s.label, code: SLOT_CODE[s.type], sub: `${m ? `${m.name} · ` : ''}${SLOT_KIND[s.type]} · ${options.length} option${options.length === 1 ? '' : 's'}`,
      body: [
        h('span', { class: 'ui-label' }, 'Fitted'),
        cur ? Kit.optionRow({
          code: SLOT_CODE[s.type], name: lineName(cur), tier: cur.tier, vals: valuesOf(cur), current: true,
          action: Kit.button('Remove', act(() => o.unfit(s.id)), { kind: 'ghost', aria: `Remove ${cur.name}` }),
        }) : h('p', { class: 'ui-empty' }, s.type === 'weapon' ? 'Open hardpoint' : 'Nothing fitted'),
        modSection(s),
        h('span', { class: 'ui-label' }, 'Options'),
        options.length ? options : h('p', { class: 'ui-note' }, 'Better gear for this slot is assembled at an assembler, by blueprint.'),
      ],
    };
  }

  // Hull damage from combat, and repairing it for credits (as much as the credits cover).
  function hullRow() {
    const { repairs, hold } = ctx;
    const k = clamp(repairs.hull / repairs.max, 0, 1);
    const damaged = repairs.hull < repairs.max;
    const affordable = Math.min(repairs.cost, Math.floor(hold.credits / repairs.price) * repairs.price);
    return h('div', { class: 'st-hull' },
      Kit.icon('hull', 24, { code: 'HUL' }),
      h('div', { class: 'gauge' },
        h('div', { class: 'top' }, h('span', { class: 'ui-label' }, 'Hull'), h('span', { class: 'num' }, `${Math.ceil(repairs.hull)}/${repairs.max}`)),
        Kit.meter(k, { color: k < 0.35 ? 'var(--hostile)' : damaged ? 'var(--warn)' : 'var(--good)' })),
      damaged
        ? Kit.button(affordable < repairs.cost ? 'Repair part' : 'Repair', act(() => repairs.repair()), {
          kind: 'warn', price: affordable, disabled: affordable <= 0, aria: `Repair the hull for ${affordable} credits`,
        })
        : h('span', { class: 'ui-tag', style: { '--tone': 'var(--good)' } }, 'Intact'));
  }

  // The kit: consumables for abilities in a fight (rules/abilities.js), made by industry.
  function renderKit() {
    const kit = ctx.kit || {};
    const items = Abilities.LIST.filter((a) => kit[a.id] > 0).map((a) => ({ id: a.id, icon: Kit.icon(a.code, 32, { code: a.code }), name: a.name, count: kit[a.id], units: a.note }));
    return section('Kit', Kit.head('Kit', h('span', { class: 'aside' }, 'used in a fight')),
      items.length ? Kit.itemTiles(items, openKit, (id) => { openKit = id; refresh(); })
        : h('p', { class: 'ui-empty' }, 'Empty. Repair nanites, shield cells, EMP charges and jammer pods are made at an assembler.'));
  }

  // Spare gear: assembled or taken out, kept aboard (it takes no hold space); sold for half. Android
  // gear (from squad ships) fits squad ships only, and isn't sold.
  function renderGear() {
    const { outfitting: o } = ctx;
    const ids = Object.keys(o.gear);
    if (!ids.length) return null;
    const n = ids.reduce((t, id) => t + o.gear[id], 0);
    return section('Spare gear', fold('spare-gear', `Spare gear · ${n} · sells for half`,
      h('div', { class: 'ui-list' }, ids.map((id) => {
        const item = { id, ...Loadout.EQUIPMENT[id] };
        return Kit.optionRow({
          code: SLOT_CODE[item.slot], name: lineName(item), tier: item.tier, vals: valuesOf(item),
          tag: [item.npc ? 'Android' : '', o.gear[id] > 1 ? `×${o.gear[id]}` : ''].filter(Boolean).join(' '), tagTone: item.npc ? 'cyan' : null,
          action: item.npc ? h('span', { class: 'lock' }, 'Squad only') : Kit.button('Sell', act(() => o.sell(id)), { kind: 'ghost', price: o.sellPrice(id), aria: `Sell ${item.name} for ${o.sellPrice(id)} credits` }),
        });
      }))));
  }

  // The shipyard (capital and major stations): other hulls, against the one you fly, with it traded in.
  const HULL_METRICS = [
    { code: 'WPN', label: 'Weapon slots', get: (s) => s.weaponSlots, fmt: String, fmtDiff: String },
    { code: 'HUL', label: 'Hull', get: (s) => s.hull, fmt: String, fmtDiff: String },
    { code: 'CRG', label: 'Hold', get: (s) => s.cargo, fmt: String, fmtDiff: String },
    { code: 'HND', label: 'Handling', get: (s) => s.handling, fmt: (v) => `×${v}`, fmtDiff: (v) => `${r2(v)}` },
  ];
  // The shipyard (where there is one) is a row that opens a sheet of hulls; elsewhere, a line saying
  // where to find one.
  function shipyardRow() {
    if (!ctx.shipyard) return h('p', { class: 'ui-note st-foot-note' }, 'Capital and major stations sell new hulls.');
    const n = Loadout.FOR_SALE.filter((id) => id !== ctx.outfitting.loadout.hull).length;
    return h('button', { class: 'ui-card compact', type: 'button', 'aria-haspopup': 'dialog', onclick: () => showYard() },
      h('span', { class: 'main' }, h('span', { class: 'title' }, 'Shipyard'), h('span', { class: 'foot' }, `${n} hull${n === 1 ? '' : 's'} for sale · trade-in ${ctx.outfitting.tradeIn().toLocaleString('en-US')} cr`)),
      h('span', { class: 'go', 'aria-hidden': 'true' }, '›'));
  }
  function yardSheet() {
    const o = ctx.outfitting;
    return { title: 'Shipyard', sub: `Your ${Loadout.HULLS[o.loadout.hull].name} is traded in for ${o.tradeIn().toLocaleString('en-US')} cr`, code: 'HUL', body: renderShipyard() };
  }
  function renderShipyard() {
    const { outfitting: o } = ctx;
    const current = o.loadout.hull;
    const statsOf = (id) => ({ ...Loadout.stats({ hull: id, fitted: {} }, o.upgrades), handling: Loadout.HULLS[id].handling });
    const mine = statsOf(current);
    return section('Shipyard',
      h('div', { class: 'ui-list' }, Loadout.FOR_SALE.map((id) => {
        const hull = Loadout.HULLS[id];
        const blocked = id === current ? null : o.hullBlocked(id);
        return Kit.optionRow({
          code: 'HUL', name: hull.name, tag: id === current ? 'Flying' : '', tagTone: 'good', current: id === current,
          rows: id === current ? null : Kit.compare(mine, statsOf(id), HULL_METRICS),
          vals: id === current ? HULL_METRICS.map((m) => [m.code, m.fmt(m.get(mine))]) : null,
          note: [hull.note, blocked].filter(Boolean).join(' · '),
          open: openHull === id, onToggle: id === current ? null : () => { openHull = openHull === id ? null : id; refresh(); },
          action: id === current ? null : Kit.button('Buy', act(() => o.buyHull(id)), {
            price: o.hullPrice(id), disabled: !!blocked, title: blocked || undefined, aria: `Buy a ${hull.name}`,
          }),
        });
      })));
  }

  // A ship's performance: Firepower, Shield and Speed as chips, the rest under "All stats".
  const HEADLINE = ['dps', 'shd', 'spd'];
  function performance(stats) {
    const head = HEADLINE.map((id) => stats.find((s) => s.id === id)).filter(Boolean);
    const rest = stats.filter((s) => !HEADLINE.includes(s.id));
    const onToggle = (id) => { openStat = id; refresh(); };
    return section('Performance', Kit.head('Performance'), Kit.statChips(head, openStat, onToggle),
      fold('all-stats', `All stats · ${rest.length} more`, Kit.statChips(rest, openStat, onToggle)));
  }

  // The performance chips for a ship's stats (Loadout.stats) and its slots.
  function perfStats(ship, slots, hullId) {
    const fromItem = (type) => { const s = slots.find((x) => x.type === type && x.item); return s ? `From ${s.item.name}` : 'Nothing fitted'; };
    const computer = slots.some((x) => x.type === 'computer' && x.item);
    return [
      { id: 'spd', code: 'SPD', label: 'Speed', value: `${ship.maxSpeed}`, detail: `Top speed when cruising; it gets there at ${Math.round(ship.accel)} acceleration.`, from: fromItem('engine') },
      { id: 'trn', code: 'TRN', label: 'Turn', value: `${deg(ship.turnRate)}°/s`, detail: `Degrees per second the ship can turn (the ${ship.name} handles ×${Loadout.HULLS[hullId].handling}).`, from: fromItem('engine') },
      { id: 'eva', code: 'EVA', label: 'Evasion', value: pct(ship.evasion), detail: 'Chance to avoid incoming fire.', from: fromItem('engine') },
      { id: 'shd', code: 'SHD', label: 'Shield', value: `${ship.shield}`, detail: ship.shield ? `${ship.shield} strength, recharging ${ship.shieldRecharge} per second.` : 'No shield fitted.', from: fromItem('shield') },
      { id: 'dps', code: 'DPS', label: 'Firepower', value: `${r2(ship.firepower)}/s`, detail: `${r2(ship.firepower)} damage per second from ${ship.weaponsFitted} of ${ship.weaponSlots} weapons.`, from: ship.weapons.map((w) => w.name).join(' + ') || 'No weapons fitted' },
      { id: 'aim', code: 'AIM', label: 'Accuracy', value: pct(ship.accuracy), detail: `Hit chance, weighed against the target's evasion. Locks on in ${r2(ship.lockTime)} s.`, from: fromItem('computer') },
      { id: 'sns', code: 'SNS', label: 'Sensors', value: Format.dist(ship.sensorRange), detail: `Identifies at ${Format.dist(ship.sensorRange)} · pings at ${Format.dist(ship.pingRange)} · locks at ${Format.dist(ship.lockRange)}.`, from: fromItem('scanner') },
      { id: 'min', code: 'MIN', label: 'Mining', value: ship.miningRate ? `${(Mining.config.duration / ship.miningRate).toFixed(1)} s` : '—', detail: ship.miningRate ? 'Seconds to mine an asteroid.' : computer ? 'Its computer has no mining routines.' : 'No ship computer: no mining.', from: fromItem('computer') },
      { id: 'crg', code: 'CRG', label: 'Hold', value: `${ship.cargo}`, detail: ship.cargo ? 'Hold capacity in units.' : 'No hold.', from: `From the ${ship.name} hull` },
    ];
  }

  // ---------- Ship: which ship it shows ----------

  // The ships the Ship tab can show: yours (null), then each squad member's (by id). Either part can
  // be locked on its own (early on the squad opens before the rest of the station: locks()).
  const squadMembers = () => (ctx && ctx.squad ? ctx.squad.members : []);
  const shipViews = () => [...(isLocked('ship') ? [] : [null]), ...(isLocked('squad') ? [] : squadMembers().map((m) => m.id))];
  const shipTabOpen = () => shipViews().length > 0;
  // The squad member shown, or null for your own ship (also when the one shown has left the squad);
  // the first wingman when your own ship can't be shown.
  function viewedMember() {
    const views = shipViews();
    if (!views.includes(viewing)) viewing = views.includes(null) ? null : views[0] ?? null;
    if (viewing === null) return null;
    return squadMembers().find((x) => x.id === viewing) || null;
  }
  function showShip(id) {
    const next = shipViews().includes(id) ? id : null;
    if (next === viewing) return;
    closeSheet();
    viewing = next;
    openStat = openHull = openKit = openOption = null;
    body.scrollTop = 0;
    refresh();
  }
  // Step through the ships: +1 the next, -1 the one before, round and round.
  function stepShip(dir) {
    const views = shipViews(), i = views.indexOf(viewedMember() ? viewing : null);
    showShip(views[(i + dir + views.length) % views.length]);
  }

  // A switcher: ‹ the one shown and where it is among them, a dot each › . The Ship tab steps
  // through your ship and the squad's with it; the Production tab through a station's orders.
  // names: what each is called; at: the one shown; step(+1 | -1): show the next or the one before.
  function switcher({ label, names, at, step }) {
    const n = names.length;
    const arrow = (dir, glyph) => h('button', {
      class: 'st-switch-btn', type: 'button', onclick: () => step(dir),
      'aria-label': `Show ${names[(at + dir + n) % n]}`,
    }, glyph);
    return h('nav', { class: 'st-switch', 'aria-label': label },
      arrow(-1, '‹'),
      h('span', { class: 'mid' },
        h('span', { class: 'who', 'aria-live': 'polite' }, names[at], h('span', { class: 'num' }, ` ${at + 1}/${n}`)),
        h('span', { class: 'dots', 'aria-hidden': 'true' }, names.map((_, i) => h('span', { class: 'dot', 'aria-current': i === at ? 'true' : undefined })))),
      arrow(1, '›'));
  }
  // The switcher above the Ship tab (only with a squad).
  function shipSwitcher() {
    const views = shipViews();
    if (views.length < 2) return null;
    const m = viewedMember(), at = views.indexOf(m ? m.id : null);
    const nameOf = (id) => (id === null ? 'Your ship' : squadMembers().find((x) => x.id === id).name);
    return switcher({ label: 'Ships', names: views.map(nameOf), at, step: stepShip });
  }

  // The Ship tab for a squad member: its hull, its loadout (each slot opening a sheet to fit gear
  // from the spare gear, as on your ship), what it can do, then its program (instructions, tried
  // out, its last fight) and the spare gear. Its loadout is only shown once the rest of the
  // station is open (early on, only the program can be changed).
  function renderMemberShip(m) {
    const slots = Loadout.slots(m.loadout), st = Squad.stats(m);
    const k = m.disabled ? 0 : m.hullPoints / st.hull;
    const canOutfit = !isLocked('ship');
    return [
      shipSwitcher(),
      section(m.name, titleRow(m.name, `${st.name} · ${slots.filter((s) => s.item).length}/${slots.length} fitted`),
        h('div', { class: 'st-hull' }, Kit.icon('hull', 24, { code: 'HUL' }),
          h('div', { class: 'gauge' },
            h('div', { class: 'top' }, h('span', { class: 'ui-label' }, 'Hull'), h('span', { class: 'num' }, m.disabled ? 'disabled' : `${Math.ceil(m.hullPoints)}/${st.hull}`)),
            Kit.meter(k, { color: k < 0.35 ? 'var(--hostile)' : k < 1 ? 'var(--warn)' : 'var(--good)' })),
          m.disabled ? Kit.tag('Disabled', 'var(--hostile)') : k < 1 ? Kit.tag('Damaged', 'var(--warn)') : Kit.tag('Intact', 'var(--good)'))),
      canOutfit ? schematic(slots) : null,
      canOutfit ? performance(perfStats(st, slots, m.hull)) : null,
      section('Program',
        explain('squad', 'Your wingmen check their instructions from the top and follow the first one that applies; if none does, they keep formation with you. Tap an instruction to change it. In combat they show the instruction they are running as code. Androids are repaired at every dock.'),
        programBlock(m), testBench(m), fightLog(m)),
      canOutfit ? renderGear() : null,
    ];
  }

  function renderShip() {
    const member = viewedMember();
    if (member) return renderMemberShip(member);
    const { ship, outfitting: o } = ctx;
    const slots = Loadout.slots(o.loadout, o.upgrades);
    const stats = perfStats(ship, slots, o.loadout.hull);
    // The hold isn't shown here: it's on Trade, where it's bought and sold.
    return [
      shipSwitcher(),
      section('Ship', titleRow(ship.name, `${slots.filter((s) => s.item).length}/${slots.length} slots fitted`), ctx.repairs ? hullRow() : null),
      schematic(slots),
      performance(stats),
      renderKit(),
      renderGear(),
      shipyardRow(),
    ];
  }

  // ---------- Components and costs ----------

  const ROMAN = [null, 'I', 'II', 'III', 'IV', 'V'];

  // The salvaged components in store, by kind and tier.
  function componentsGrid(components) {
    return h('table', { class: 'st-components' },
      h('thead', {}, h('tr', {}, h('th', {}, ''), [1, 2, 3, 4, 5].map((t) => h('th', { scope: 'col', title: Goods.TIERS[t], style: { color: Kit.TIER[t] } }, ROMAN[t])))),
      h('tbody', {}, Goods.categories('salvage').map((cat) => h('tr', {},
        h('th', { scope: 'row' }, Goods.CATEGORIES[cat].label.replace(' components', '')),
        [1, 2, 3, 4, 5].map((tier) => {
          const n = components[Goods.component(cat, tier)] || 0;
          return h('td', { class: n ? 'has num' : 'num', style: n ? { color: Kit.TIER[tier] } : undefined }, n ? String(n) : '·');
        })))));
  }
  // What something costs in components (and credits), with how much of each you have.
  const costChips = (cost, credits, ...more) => h('span', { class: 'st-costs' },
    credits ? h('span', { class: `cost num${ctx.hold.credits < credits ? ' short' : ''}`, title: 'Credits' }, `${credits.toLocaleString('en-US')} cr`) : null,
    cost.map((c) => h('span', { class: `cost num${c.have < c.need ? ' short' : ''}`, title: Goods.type(c.kind).name }, itemIcon(c.kind, 18), `${c.have}/${c.need}`)), more);

  // ---------- Research ----------

  const research = ResearchView.create({
    ctx: () => ctx, refresh: () => refresh(), show: (id) => showNode(id), act, costChips, componentsGrid, section, lead, explain, fold,
    openId: () => openNode,
  });

  // ---------- Production ----------

  const industryView = IndustryView.create({
    ctx: () => ctx, refresh: () => refresh(), act, section, lead, explain, fold, itemIcon, switcher, showTab: (name) => pick(name),
    showOrder: (o) => showOrder(o), setOrder: (o) => { Object.assign(openOrder, o); refresh(); }, closeSheet: () => { closeSheet(); refresh(); },
  });

  // ---------- Missions ----------

  const STATUS = {
    offered: { badge: 'New', color: 'var(--new)' },
    active: { badge: 'In progress', color: 'var(--cyan)' },
    ready: { badge: 'Hand in', color: 'var(--good)' },
    done: { badge: 'Completed', color: 'var(--dim)' },
  };
  const LINES_KIND = { offered: 'Briefing', active: 'Briefing', ready: 'Report', done: 'Debrief' };
  const ORDER = { ready: 0, active: 1, offered: 2, done: 3 };
  const missions = () => (ctx && ctx.missions ? ctx.missions.list() : []);
  const goalCount = (o) => (o.percent ? `${o.count}%` : o.need > 1 ? `${o.count}/${o.need}` : '');

  // A portrait (a face(ctx, size) drawer) in a canvas, sharp at the screen's pixel density.
  function portrait(face, size) {
    const c = h('canvas', { class: 'ui-face', 'aria-hidden': 'true', style: { width: `${size}px`, height: `${size}px` } });
    UI.paint(c, face, size);
    return c;
  }
  const face = (m, size) => (m.face ? portrait(m.face, size) : Kit.icon('face', size, { code: 'FACE' }));

  // What a mission pays, compactly: the credits diamond and amount, then each item's icon (×n for
  // more than one). Missions without such a reward (the story's) say it in words.
  function payLine(m) {
    if (!m.pays) return h('span', { class: 'txt' }, m.reward);
    const { credits, items } = m.pays;
    return h('span', { class: 'st-pays', 'aria-label': m.reward },
      credits ? Kit.credits(credits) : null,
      items.map(({ kind, n }) => h('span', { class: 'st-pay', title: Goods.type(kind).name }, itemIcon(kind, 18), n > 1 ? h('span', { class: 'num' }, `×${n}`) : null)));
  }

  // A mission's card: who gives it, its title and state, the objective to do now, a segment per
  // objective, and what it pays. Tap for the whole mission.
  function missionCard(m) {
    const S = STATUS[m.status];
    const goal = m.status === 'active' ? m.objectives.find((o) => o.open && !o.done) : null;
    const hint = goal ? null : m.status === 'ready' ? (m.here ? 'All objectives met. Hand it in here.' : `Hand it in at ${m.handIn || m.from}.`) : null;
    return h('button', {
      class: 'ui-card', type: 'button', style: { '--accent': S.color }, 'aria-haspopup': 'dialog', 'aria-label': `${m.title}, ${S.badge}`,
      onclick: () => showMission(m.id),
    },
    face(m, 44),
    h('span', { class: 'main' },
      h('span', { class: 'top' }, h('span', { class: 'title' }, m.title), Kit.tag(S.badge, S.color)),
      goal ? h('span', { class: 'goal' }, Kit.check('open', true), h('span', { class: 'txt' }, goal.label), h('span', { class: 'num' }, goalCount(goal))) : null,
      hint ? h('span', { class: 'hint', style: m.status === 'ready' ? { '--tone': 'var(--good)' } : undefined }, hint) : null,
      m.status === 'offered' ? null : Kit.segments(m.objectives.map((o) => (o.done ? 'done' : o.open ? 'open' : ''))),
      h('span', { class: 'foot' }, payLine(m))),
    h('span', { class: 'go', 'aria-hidden': 'true' }, '›'));
  }
  const doneCard = (m) => h('button', { class: 'ui-card compact', type: 'button', 'aria-haspopup': 'dialog', 'aria-label': `${m.title}, completed`, onclick: () => showMission(m.id) },
    Kit.check('done'),
    h('span', { class: 'main' }, h('span', { class: 'title' }, m.title), h('span', { class: 'foot' }, payLine(m))),
    h('span', { class: 'go', 'aria-hidden': 'true' }, '›'));

  // The sheet for one mission: what the giver says, in full and straight on the sheet (who says it
  // above it), the objectives as a checklist, what it provides and pays, and Accept or Complete at
  // the foot.
  function missionSheet(id) {
    const m = missions().find((x) => x.id === id);
    if (!m) return null;
    const S = STATUS[m.status];
    const lines = m.lines;
    const goals = m.status === 'done' ? [] : m.objectives;
    const accept = m.status === 'offered' && m.here && m.accept;
    const complete = m.status === 'ready' && m.here && m.complete;
    return {
      title: m.title, kicker: S.badge, kickerColor: S.color, tall: true,
      body: [
        lines.length ? h('div', { class: 'st-brief' },
          h('div', { class: 'from' }, face(m, 32), h('span', { class: 'ui-label' }, `${m.from} · ${LINES_KIND[m.status]}`)),
          lines.map((text) => h('p', {}, UI.rich(text)))) : null,
        goals.length ? [h('span', { class: 'ui-label' }, 'Objectives'), h('div', { class: 'ui-goals' }, goals.map((o) => {
          const state = o.done ? 'done' : o.open ? 'open' : 'later';
          return h('div', { class: `ui-goal ${state}` }, Kit.check(state),
            h('span', { class: 'main' }, h('span', { class: 'txt' }, o.label),
              o.need > 1 && o.open && !o.done ? Kit.meter(o.count / o.need, { thin: true }) : null),
            h('span', { class: 'num' }, goalCount(o)));
        }))] : null,
        h('div', { class: 'ui-list st-gap' },
          m.provided ? Kit.infoTile({ code: 'PRV', label: 'Provided', text: m.provided }) : null,
          Kit.infoTile({ code: 'RWD', label: m.status === 'done' ? 'Paid' : 'Reward', text: m.pays ? [payLine(m), m.pays.also?.length ? h('span', { class: 'st-also' }, m.pays.also.join(' · ')) : null] : m.reward, tone: 'var(--new)' })),
        m.note && m.status === 'done' ? Kit.callout(m.note) : m.note && m.status === 'offered' ? h('p', { class: 'ui-note' }, m.note) : null,
      ],
      foot: [
        accept ? Kit.button('Accept mission', act(() => m.accept()), { kind: 'primary', lg: true, wide: true }) : null,
        complete ? Kit.button('Complete mission', act(() => m.complete()), { kind: 'good', lg: true, wide: true }) : null,
        m.status === 'ready' && !complete ? h('p', { class: 'ui-note' }, `Hand it in at ${m.handIn || m.from}.`) : null,
        m.status === 'active' ? h('p', { class: 'ui-note' }, m.note ? `Launch to continue. ${m.note}` : 'Launch to continue.') : null,
        m.track || m.abandon ? h('div', { class: 'st-acts' },
          m.track ? Kit.button(m.tracked ? 'Tracked on map' : 'Track on map', act(() => m.track()), { kind: 'ghost', disabled: m.tracked }) : null,
          m.abandon ? Kit.button('Abandon', act(() => { m.abandon(); closeSheet(); }), { kind: 'ghost', aria: `Abandon ${m.title}` }) : null) : null,
      ],
    };
  }

  // Missions: hand-ins first, then those in progress, then new offers; the completed folded away.
  function renderMissions() {
    const list = missions();
    const { reason } = locks();
    const current = list.filter((m) => m.status !== 'done').sort((a, b) => ORDER[a.status] - ORDER[b.status]);
    const done = list.filter((m) => m.status === 'done');
    lead('');
    return [
      reason ? Kit.callout(reason, 'var(--warn)') : null,
      list.length ? null : h('p', { class: 'ui-empty' }, 'No missions posted here.'),
      h('div', { class: 'ui-list' }, current.map(missionCard),
        done.length ? [Kit.disclosure({ label: `Completed · ${done.length}`, open: doneOpen, onToggle: () => { doneOpen = !doneOpen; refresh(); } }),
          doneOpen ? done.map(doneCard) : null] : null),
    ];
  }

  // ---------- Squad ----------

  const ELSE = [{ kw: 'ELSE', not: false, chips: [{ kind: 'act', text: 'Follow leader' }] }];
  // Why an instruction can't be saved, in plain words (Logic.check's reasons).
  function plainError(e) {
    if (!e) return null;
    const pkg = e.match(/needs import (\S+)/);
    if (pkg) return `Needs research: ${pkg[1]}`;
    const aim = e.match(/can't take (\w+)/);
    if (aim) return `That action can't be aimed at ${Logic.SUBJECTS[aim[1]]?.say || aim[1]}`;
    if (/isn't a thing/.test(e)) return "That condition doesn't apply to it";
    if (/nothing to pick/.test(e)) return 'There is only one to pick';
    if (/needs and \/ or/.test(e)) return 'Join conditions with AND or OR';
    return e[0].toUpperCase() + e.slice(1);
  }

  // Why an instruction won't run, if it won't: past what memory runs, after one that always
  // applies, or about squad members when there are none to be about.
  function idleWhy(m, i) {
    const { limit, members } = ctx.squad, line = m.program[i];
    if (line.err) return null;
    if (i >= limit) return 'Not run: out of memory (research mem.ext)';
    const first = m.program.slice(0, i).findIndex(Logic.alwaysRuns);
    if (first >= 0) return `Never runs: instruction ${first + 1} always applies first`;
    if (line.subject === 'ally' && members.length < 2) return 'Never true yet: no other squad member';
    return null;
  }
  // A member's program as instruction cards (tap one to edit it), what it does when none applies,
  // and a card to add one. Cards that won't run are greyed, with why; after a fight, how often
  // each was used.
  function programBlock(m) {
    const { limit } = ctx.squad, runs = ctx.squad.runs ? ctx.squad.runs(m.id) : [];
    const cards = m.program.map((line, i) => {
      const why = idleWhy(m, i);
      return Kit.instruction({
        n: i + 1, rows: Logic.rows(line), off: !line.on, dim: !!why, err: plainError(line.err), active: !!runs[i] && !why,
        note: why || (runs[i] ? `Used ${runs[i]}× last fight` : !line.on ? 'Switched off' : null),
        onclick: () => showLine(m.id, i), aria: `Instruction ${i + 1}: ${Logic.say(line)}${line.on ? '' : ' (off)'} Edit`,
      });
    });
    const add = m.program.length < Squad.MAX_LINES
      ? Kit.instruction({ kind: 'add', rows: [{ kw: '+', not: false, chips: [{ kind: 'subj', text: 'Add instruction' }] }], onclick: () => showLine(m.id, m.program.length), aria: 'Add an instruction' }) : null;
    return [
      Kit.head('Instructions', h('span', { class: 'aside num' }, `${Math.min(m.program.length, limit)}/${limit} run`)),
      h('div', { class: 'ui-instrs', role: 'list', 'aria-label': `${m.name}'s instructions` }, cards, add, Kit.instruction({ kind: 'else', rows: ELSE, aria: 'Otherwise: follow the leader' })),
    ];
  }

  // A member's last fight, step by step (game/squad.js timelines): when its program switched line,
  // what that line did and to whom, and its hull then; the moment it was disabled stands out. A
  // step opens its instruction for editing. Folded, its heading counting the steps.
  const clock = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
  function fightLog(m) {
    const steps = ctx.squad.timeline ? ctx.squad.timeline(m.id) : [];
    if (!steps.length) return null;
    const down = steps.some((x) => x.disabled);
    const rows = steps.map((x) => {
      const what = [h('span', { class: 'num t' }, clock(x.t)),
        h('span', { class: 'what' }, x.line >= 0 ? `${x.line + 1}. ${x.text}` : x.text, x.target ? h('span', { class: 'on' }, ` → ${x.target}`) : null),
        h('span', { class: 'num hull' }, x.disabled ? '' : `${Math.round(x.hull * 100)}%`)];
      return x.line >= 0 && x.line < m.program.length
        ? h('button', { class: 'st-step', type: 'button', role: 'listitem', onclick: () => showLine(m.id, x.line), 'aria-label': `${clock(x.t)}: instruction ${x.line + 1}, ${x.text}${x.target ? `, on ${x.target}` : ''}, hull ${Math.round(x.hull * 100)}%. Edit` }, what)
        : h('div', { class: `st-step${x.disabled ? ' bad' : ''}`, role: 'listitem' }, what);
    });
    return fold(`timeline-${m.id}`, `Last fight · ${steps.length} step${steps.length === 1 ? '' : 's'}${down ? ' · disabled' : ''}`, [
      explain('timeline', 'Each time the program switched to another instruction: when, what it did and the hull then. Tap one to edit it.'),
      h('div', { class: 'st-steps', role: 'list', 'aria-label': `${m.name}'s last fight` }, rows)]);
  }

  // Trying the program out (game/squad.js TEST_FIGHTS): each fight on paper and what the member
  // would do in it, the instruction a tap away. Folded under the program.
  const ACT_WORD = { attack: 'Attacks', guard: 'Guards', retreat: 'Retreats', use: 'Uses its kit on', follow: 'Follows the leader' };
  function testBench(m) {
    if (!ctx.squad.test || !m.program.length) return null;
    const rows = ctx.squad.test(m.id).map((r) => {
      const what = r.line >= 0 ? `${r.line + 1}. ${ACT_WORD[r.act] || r.act}${r.on && r.act !== 'retreat' ? ` ${r.on}` : ''}` : 'No instruction applies: follows the leader';
      const parts = [h('span', { class: 'name' }, r.name), h('span', { class: `res${r.line < 0 ? ' idle' : ''}` }, what)];
      return r.line >= 0
        ? h('button', { class: 'st-test', type: 'button', role: 'listitem', onclick: () => showLine(m.id, r.line), 'aria-label': `${r.name}: ${what}. Edit instruction ${r.line + 1}` }, parts)
        : h('div', { class: 'st-test', role: 'listitem' }, parts);
    });
    return fold(`test-${m.id}`, 'Try it out', [
      explain('test', 'Fights set up on paper, and what this wingman would do in each with its program as it is.'),
      h('div', { class: 'st-steps', role: 'list', 'aria-label': `${m.name}'s program, tried out` }, rows)]);
  }

  // The sheet for one instruction: the card as it will read, then a row of choices for each part
  // of it (who, which one, each condition, then what). Blocks not yet researched are dashed.
  // Changes go to a draft; Save puts it in the program if it checks.
  const ABOUT = ['self', 'leader', 'fight'];
  const propsFor = (about) => Object.values(Logic.PROPS).filter((p) => p.of.includes(about));
  function defaultValue(p) { return p.values ? p.values[Math.floor((p.values.length - 1) / 2)] : null; }
  function setProp(c, p) { c.prop = p.id; c.rel = p.rels[0] || null; c.value = defaultValue(p); }
  // A new condition: about the subject if anything known can be said of it, else self, the leader, the fight.
  function newClause(line, known) {
    for (const about of [line.subject, ...ABOUT]) {
      const p = propsFor(about).find((x) => Logic.knows(known, x.pkg));
      if (!p) continue;
      const c = Logic.clause({ join: line.when.length ? 'and' : null, of: about === line.subject ? null : about });
      setProp(c, p);
      return c;
    }
    return null;
  }
  // The abilities a line can use on its subject: on enemies, or on friends (self, the leader, an ally).
  const abilitiesFor = (subject) => Abilities.LIST.filter((a) => (a.on === 'enemy') === (subject === 'enemy'));
  // After the subject changes: a pick and an action it can take (and, for use, an ability that fits).
  function fitDraft(d, known) {
    if (!Logic.SUBJECTS[d.subject].many) d.pick = 'any';
    const cur = Logic.ACTIONS[d.act];
    if (cur.on && !cur.on.includes(d.subject)) d.act = Object.values(Logic.ACTIONS).find((a) => (!a.on || a.on.includes(d.subject)) && a.id !== 'use' && Logic.knows(known, a.pkg)).id;
    if (d.act !== 'use') d.skill = null;
    else if (!abilitiesFor(d.subject).some((a) => a.id === d.skill)) d.skill = abilitiesFor(d.subject)[0].id;
  }

  function lineSheet() {
    const sq = ctx.squad, { id, i, draft: d } = openLine;
    const m = sq && sq.members.find((x) => x.id === id);
    if (!m) return null;
    const known = sq.known, isNew = i >= m.program.length;
    const has = (b) => Logic.knows(known, b.pkg);
    const item = (b, label = b.say || b.id, on = false) => ({ id: b.id, label, on, locked: !has(b), title: has(b) ? undefined : `Needs research: ${b.pkg}` });
    const edit = (fn) => (v) => { fn(v); fitDraft(d, known); refresh(); };
    const check = Logic.check(d, known);
    const field = (label, ...parts) => h('div', { class: 'st-field' }, h('span', { class: 'ui-label' }, label), parts);

    const clauses = d.when.map((c, j) => {
      const about = c.of || d.subject;
      const p = Logic.PROPS[c.prop];
      const aboutItems = [{ id: '', label: Logic.SUBJECTS[d.subject].say, on: !c.of }, ...ABOUT.filter((a) => a !== d.subject).map((a) => ({
        id: a, label: a === 'fight' ? 'Fight' : Logic.SUBJECTS[a].say, on: c.of === a, locked: !propsFor(a).some(has), title: propsFor(a).some(has) ? undefined : 'Nothing known about it yet (Research)',
      }))];
      return h('div', { class: 'st-clause' },
        h('div', { class: 'st-clause-head' }, h('span', { class: 'ui-label' }, `Condition ${j + 1}`),
          h('button', { class: 'ui-link', type: 'button', onclick: () => { d.when.splice(j, 1); if (d.when[0]) d.when[0].join = null; refresh(); } }, 'Remove')),
        j ? Kit.choices([item(Logic.KEYWORDS.and, 'AND', c.join === 'and'), item(Logic.KEYWORDS.or, 'OR', c.join === 'or')], edit((v) => { c.join = v; }), { label: 'Joined by' }) : null,
        Kit.choices([item(Logic.KEYWORDS.not, 'NOT', c.not)], edit(() => { c.not = !c.not; }), { label: 'Negate' }),
        Kit.choices(aboutItems, edit((v) => {
          c.of = v || null;
          const now = c.of || d.subject;
          if (!Logic.PROPS[c.prop]?.of.includes(now)) { const q = propsFor(now).find(has); if (q) setProp(c, q); }
        }), { label: 'About' }),
        Kit.choices(propsFor(about).map((q) => item(q, q.say, q.id === c.prop)), edit((v) => setProp(c, Logic.PROPS[v])), { label: 'Property' }),
        p && p.rels.length ? Kit.choices(p.rels.map((r) => ({ id: r, label: Logic.sayRel(r), on: c.rel === r })), edit((v) => { c.rel = v; }), { label: 'Operator' }) : null,
        p && p.values ? Kit.choices(p.values.map((v) => ({ id: String(v), label: Logic.sayValue(p, v), on: c.value === v })),
          edit((v) => { c.value = p.values.find((x) => String(x) === v); }), { label: 'Value' }) : null);
    });
    const canAdd = d.when.length < Logic.MAX_CLAUSES && (!d.when.length || has(Logic.KEYWORDS.and)) && newClause(d, known);
    const actions = Object.values(Logic.ACTIONS).filter((a) => (!a.on || a.on.includes(d.subject)) && (a.id !== 'use' || has(a)));
    const subj = Logic.SUBJECTS[d.subject];

    const tools = isNew ? null : h('div', { class: 'st-line-tools' },
      Kit.button('↑', act(() => sq.move(id, i, i - 1), closeSheet), { kind: 'ghost', disabled: i === 0, aria: 'Move the instruction up' }),
      Kit.button('↓', act(() => sq.move(id, i, i + 1), closeSheet), { kind: 'ghost', disabled: i >= m.program.length - 1, aria: 'Move the instruction down' }),
      Kit.button(m.program[i].on ? 'Off' : 'On', act(() => sq.toggle(id, i), closeSheet), { kind: 'ghost', disabled: !!m.program[i].err, aria: m.program[i].on ? 'Switch the instruction off' : 'Switch the instruction on' }),
      Kit.button('Copy', act(() => sq.set(id, m.program.length, m.program[i]), closeSheet), { kind: 'ghost', disabled: m.program.length >= Squad.MAX_LINES || !!m.program[i].err, aria: 'Copy the instruction to the end' }),
      Kit.button('Delete', act(() => sq.remove(id, i), () => closeSheet()), { kind: 'warn', aria: 'Delete the instruction' }));

    return {
      title: isNew ? 'New instruction' : `Instruction ${i + 1}`, sub: m.name, code: 'LGC', tall: true,
      body: [
        h('div', { class: 'ui-instrs' }, Kit.instruction({ n: i + 1, rows: Logic.rows(d), err: check.ok ? null : plainError(check.errors[0]), aria: Logic.say(d) })),
        field('Who', Kit.choices(Object.values(Logic.SUBJECTS).map((b) => item(b, b.say, d.subject === b.id)), edit((v) => { d.subject = v; }), { label: 'Who' })),
        subj.many ? field('Which one', Kit.choices(Object.values(Logic.PICKS).map((b) => item(b, b.say, d.pick === b.id)), edit((v) => { d.pick = v; }), { label: 'Which one' })) : null,
        clauses,
        canAdd ? Kit.button('+ Condition', () => { d.when.push(newClause(d, known)); refresh(); }, { kind: 'ghost', wide: true })
          : d.when.length && !has(Logic.KEYWORDS.and) ? h('p', { class: 'ui-note' }, 'More conditions need AND (research core.bool).') : null,
        field('Then', Kit.choices(actions.map((a) => item(a, a.say, d.act === a.id)), edit((v) => { d.act = v; }), { label: 'Then' }),
          h('p', { class: 'ui-note' }, Logic.ACTIONS[d.act].note)),
        d.act === 'use' ? field('Kit', Kit.choices(abilitiesFor(d.subject).map((a) => ({ id: a.id, label: a.name, on: d.skill === a.id })), edit((v) => { d.skill = v; }), { label: 'Kit' }),
          h('p', { class: 'ui-note' }, `${Abilities.ABILITIES[d.skill]?.note || ''}. A charge from the kit each time; skipped when none are left, it's cooling down, or it wouldn't help.`)) : null,
      ],
      foot: [
        Kit.button(isNew ? 'Add instruction' : 'Save instruction', act(() => sq.set(id, i, { ...d, on: isNew ? true : d.on }), () => closeSheet()), {
          kind: 'primary', lg: true, wide: true, disabled: !check.ok,
        }),
        tools,
      ],
    };
  }

  // ---------- Sheets ----------

  function sheetOptions() {
    return openSlot ? slotSheet(openSlot) : openMission ? missionSheet(openMission) : openLine ? lineSheet() : openNode ? research.sheet(openNode)
      : openOrder ? industryView.sheet(openOrder) : openYard && ctx.shipyard ? yardSheet() : openNews ? newsSheet() : null;
  }
  function openSheet() {
    const o = sheetOptions();
    if (!o) { closeSheet(); return; }
    sheet = Kit.sheet({ ...o, host: layer, onClose: () => { sheet = null; openSlot = openMission = openLine = openNode = openOrder = openNews = null; openYard = false; refresh(); } });
  }
  function closeSheet() {
    openSlot = openMission = openLine = openNode = openOrder = openNews = null;
    openYard = false;
    if (sheet) { const s = sheet; sheet = null; s.close(true); }
  }
  function showSlot(id) { closeSheet(); openSlot = id; openOption = null; refresh(); openSheet(); }
  function showMission(id) { closeSheet(); openMission = id; refresh(); openSheet(); }
  function showNode(id) { closeSheet(); openNode = id; refresh(); openSheet(); }
  function showOrder(open) { closeSheet(); openOrder = { ...open }; refresh(); openSheet(); }
  // Since you last docked: research done and goods made, in one sheet on docking, each a way to
  // the screen it concerns.
  function newsSheet() {
    const go = (name) => () => { closeSheet(); pick(name); };
    return {
      title: 'Since you last docked', sub: `${openNews.length} finished`, code: 'IND',
      body: h('div', { class: 'ui-list' }, openNews.map((n) => h('button', { class: 'ui-card compact', type: 'button', onclick: go(n.tab) },
        h('span', { class: 'main' }, h('span', { class: 'title' }, n.text)),
        h('span', { class: 'go', 'aria-hidden': 'true' }, '›')))),
      foot: Kit.button('Done', () => closeSheet(), { wide: true, kind: 'ghost' }),
    };
  }
  function showYard() { closeSheet(); openYard = true; openHull = null; refresh(); openSheet(); }
  function showLine(id, i) {
    const m = ctx.squad && ctx.squad.members.find((x) => x.id === id);
    if (!m) return;
    closeSheet();
    const draft = i < m.program.length ? Logic.copy(m.program[i]) : Logic.blank();
    if (draft.err) { delete draft.err; draft.on = true; }
    openLine = { id, i, draft };
    refresh();
    openSheet();
  }

  // ---------- Refresh ----------

  // What can't be used yet (see open()); nothing is locked unless the flight view says so.
  const locks = () => (ctx && ctx.locks ? ctx.locks() : { tabs: [], reason: '', launch: null });
  const isLocked = (name) => locks().tabs.includes(name);
  const tabNames = () => (tabs.length ? tabs.map((t) => t.dataset.tab) : Object.keys(RENDER));
  const tabOpen = (name) => (name === 'ship' ? shipTabOpen() : !isLocked(name));
  const firstOpen = () => tabNames().find(tabOpen) || 'trade';

  const RENDER = { trade: () => renderTrade(), ship: () => renderShip(), research: () => research.render(), industry: () => industryView.render(), missions: () => renderMissions() };
  function refresh() {
    if (!ctx) return;
    const lock = locks();
    if (!tabOpen(tab)) tab = firstOpen();
    renderHeader();
    if (tab === 'research' && ctx.lab && ctx.lab.state && Array.isArray(ctx.lab.state.done) && ctx.lab.state.done.length !== researchSeen) {
      researchSeen = ctx.lab.state.done.length;
      Store.setJSON('researchSeen', researchSeen);
    }
    for (const t of tabs) {
      const name = t.dataset.tab;
      const on = name === tab, locked = !tabOpen(name);
      const label = name === 'ship' && squadMembers().length ? 'Ships' : TABS[name].label;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
      t.disabled = locked;
      t.title = locked ? lock.reason : label;
      t.setAttribute('aria-label', label);
      const lbl = t.querySelector('.lbl');
      if (lbl && lbl.textContent !== label) lbl.textContent = label;
    }
    // Something to hand in here, or a story mission offered (every station always has jobs posted).
    if (tabDots.missions) tabDots.missions.hidden = !missions().some((m) => m.here && (m.status === 'ready' || (m.status === 'offered' && !m.tier)));
    if (tabDots.research) tabDots.research.hidden = !researchWaiting();
    if (tabDots.industry) tabDots.industry.hidden = !ordersWaiting();
    const launch = el('st-launch');
    launch.disabled = !!lock.launch;
    launch.title = lock.launch || '';
    const note = el('st-note');
    note.textContent = lock.launch || '';
    note.hidden = !lock.launch;
    const scroll = body.scrollTop;
    leadText = '';
    folded = false;
    const content = RENDER[tab]().flat(Infinity).filter(Boolean); // optional parts are null when absent
    body.replaceChildren(...[leadLine(), ...content].filter(Boolean));
    body.scrollTop = scroll;
    if (sheet) {
      const o = sheetOptions();
      if (o) sheet.update(o);
      else closeSheet();
    }
  }

  // The station reopens on the tab last used (saved), unless the flight view asks for another.
  let lastTab = Store.get('stationTab', 'trade');
  // 'squad' is the Ship tab on a wingman.
  function pick(name) {
    const wingman = name === 'squad';
    if (wingman) name = 'ship';
    if (!tabOpen(name)) return;
    closeSheet();
    tab = name;
    if (wingman && !viewedMember() && squadMembers().length && !isLocked('squad')) viewing = squadMembers()[0].id;
    lastTab = name;
    Store.set('stationTab', name);
    infoOpen = false;
    openStat = openHull = openKit = null;
    research.reset();
    industryView.reset();
    body.scrollTop = 0;
    refresh();
  }
  for (const t of tabs) {
    t.addEventListener('click', () => pick(t.dataset.tab));
    // Arrow keys move between the tabs that can be opened.
    t.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      let i = tabs.indexOf(t);
      for (let k = 0; k < tabs.length; k++) {
        i = (i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length;
        if (!tabs[i].disabled) break;
      }
      pick(tabs[i].dataset.tab);
      tabs[i].focus();
    });
  }
  el('st-launch').addEventListener('click', () => ctx && !locks().launch && ctx.onLaunch());

  // Every second while docked: research that finished and what industry made (logged, and the
  // screen drawn again, since what's known or stored changed), else the meters' numbers.
  let ticker = null;
  function tick() {
    if (!ctx || !ctx.lab) return;
    const done = ctx.lab.settle({ quiet: true });
    const made = ctx.industry ? ctx.industry.settle({ quiet: true }) : [];
    if (done.length || made.length) refresh();
    if (done.length) {
      const logic = done.every((id) => Research.PACKAGES[id].kind === 'logic');
      Messages.push(`${logic ? 'Build ok · import' : 'Research done ·'} ${done.map(Research.title).join(', ')}`, { tone: 'good' });
    } else if (made.length) Messages.push(`Made · ${Industry.summary(ctx.industry.state, made).join(' · ')}`, { tone: 'good' });
    else if (tab === 'research') research.tick();
    else if (tab === 'industry') industryView.tick();
  }

  return {
    // options.tab: the tab to open on (if not given, the last one used; the first that isn't
    // locked if that one is).
    open(options) {
      ctx = options;
      tab = options.tab || lastTab || 'trade';
      if (tab === 'squad') tab = 'ship';
      seenThisDock.clear();
      infoOpen = false;
      viewing = null;
      closeSheet();
      openStat = openHull = openKit = null;
      research.reset();
      doneOpen = false;
      root.hidden = false;
      body.scrollTop = 0;
      refresh();
      ((locks().launch && tabs.find((t) => t.dataset.tab === tab)) || el('st-launch')).focus({ preventScroll: true });
      if (options.news && options.news.length && !isLocked(tab)) { openNews = options.news; openSheet(); }
      clearInterval(ticker);
      ticker = setInterval(tick, 1000);
      ticker.unref?.(); // (in Node, the tests: don't keep the process alive)
    },
    close() {
      clearInterval(ticker);
      ticker = null;
      research.reset();
      closeSheet();
      ctx = null;
      root.hidden = true;
      body.replaceChildren();
    },
    get isOpen() { return !!ctx; },
    // Switch to a tab ('trade' | 'ship' | 'research' | 'industry' | 'missions') while open, unless
    // it's locked; 'squad' is the Ship tab on a wingman.
    showTab: pick,
    get tab() { return tab; },
    refresh,
    tick, // what the once-a-second timer does (the tests call it)
    // Which ship the Ship tab shows: null for yours, else a squad member's id. showShip(id) shows
    // one (an id not in the squad: yours); stepShip(+1 | -1) steps to the next or the one before.
    showShip,
    stepShip,
    get viewing() { return viewedMember() ? viewing : null; },
    // Open or close the sheet for a loadout slot on the Ship tab (of the ship shown).
    toggleSlot(id) { if (openSlot === id) { closeSheet(); refresh(); } else showSlot(id); },
    // Open the sheet for a mission on the Missions tab; closeSheet() closes whichever is open.
    showMission(id) { showMission(id); },
    // Open the sheet for line i of a squad member's program (i = its length: a new line).
    showLine(id, i) { showLine(id, i); },
    // Open the sheet for a research package on the Research tab.
    showNode(id) { showNode(id); },
    // Open a production order's sheet (ui/industry-view.js sheet(open)).
    showOrder(open) { showOrder(open); },
    closeSheet() { closeSheet(); refresh(); },
  };
})();

export { StationMenu };
