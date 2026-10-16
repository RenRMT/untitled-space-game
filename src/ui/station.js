// The docked screen: the station header, one of the Trade / Ship / Research / Squad / Missions tabs,
// and the icon tab bar with Launch at the foot. Built from the UI kit (ui/kit.js): the Ship tab is a
// schematic of the ship with a button per equipment slot, each opening a sheet of what can go there;
// the Missions tab is a card per mission, each opening a sheet with the briefing and objectives.
// StationMenu.open({ station: { name, subtitle, color }, market (Economy.market), hold, ship,
//                    outfitting, lab, shipyard, repairs, squad, missions, locks, artStyle, onLaunch })
// artStyle: the art style item icons are drawn in (Art.STYLES; 'line' if not given).
// hold: { credits, items, capacity, free, count(kind), buy(kind, price, label), sell(kind, price) }.
// ship: Loadout.stats() of the ship as it is (kept up to date as gear changes).
// outfitting: { loadout, upgrades, gear, known, sellPrice(id), hullPrice(id), tradeIn(), hullBlocked(id),
//               fit(slot, id, buy?), unfit(slot), sell(id), buyHull(id) }: the ship's equipment,
//               spare gear, buying what research unlocked, and the shipyard (game/outfitting.js).
// lab: { researched, components, have(kind), status(id), research(id) }: the research tree (rules/research.js).
// shipyard: whether this station sells hulls (capital and major stations).
// repairs: { hull, max, price, cost, repair() }: hull damage from combat and fixing it for credits.
// squad: { members }: the squad (rules/squad.js), each member with its logic modules (rules/logic.js).
// missions: { list() -> [mission view] }: the missions to show here (story/missions.js, game/missions.js), each
//   { id, title, from, face?(ctx, size), status ('offered' | 'active' | 'ready' | 'done'), here (its
//   giver is this station), lines: [what the giver says now], objectives: [{ label, count, need,
//   done, open, percent }], provided?, reward, note?, accept?(), complete?() }.
// locks() -> { tabs: [tab names], reason, launch }: tabs that can't be opened yet and why, and why
//   Launch can't be pressed yet (null when it can). Asked again after every change.
// ES module (`StationMenu`); needs a browser.

import { Format } from '../core/format.js';
import { clamp } from '../core/math.js';
import { ItemIcons } from '../art/icons.js';
import { Economy } from '../rules/economy.js';
import { Goods } from '../rules/goods.js';
import { Loadout } from '../rules/loadout.js';
import { Logic } from '../rules/logic.js';
import { Mining } from '../rules/mining.js';
import { Research } from '../rules/research.js';
import { Squad } from '../rules/squad.js';
import { Kit } from './kit.js';
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
  let openSlot = null; // the loadout slot whose sheet is open, if any
  let openMission = null; // the mission whose sheet is open, if any
  let sheet = null; // the open sheet (Kit.sheet)
  let openOption = null, openStat = null, openHold = null, openNode = null, openHull = null; // expanded rows, chips, tiles
  let briefAll = false; // the mission sheet shows every line of the message, not just the first
  let doneOpen = false; // completed missions unfolded

  const { h } = UI; // ui/ui.js

  // ---------- The tab bar ----------
  const TABS = {
    trade: { code: 'TRD', label: 'Trade' }, ship: { code: 'SHP', label: 'Ship' }, research: { code: 'RSC', label: 'Research' },
    squad: { code: 'SQD', label: 'Squad' }, missions: { code: 'MSN', label: 'Missions' },
  };
  const missionDot = h('span', { class: 'dot', hidden: true }); // something new or to hand in
  for (const t of tabs) {
    const { code, label } = TABS[t.dataset.tab];
    const icon = Kit.icon(`tab-${t.dataset.tab}`, 24, { code });
    if (t.dataset.tab === 'missions') icon.append(missionDot);
    t.replaceChildren(icon, h('span', { class: 'lbl' }, label));
    t.setAttribute('aria-label', label);
  }

  function renderHeader() {
    el('st-name').textContent = ctx.station.name;
    el('st-sub').textContent = ctx.station.subtitle;
    el('st-credits').textContent = ctx.hold.credits.toLocaleString('en-US');
    root.style.setProperty('--culture', ctx.station.color);
  }

  // A screen's title line: the title, then a count or note on the right.
  const titleRow = (title, aside) => h('div', { class: 'st-title' }, h('h1', { class: 'ui-title' }, title), aside ? h('span', { class: 'aside num' }, aside) : null);
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
  const rarityTag = (t) => (t.rarity > 1 ? Goods.RARITY[t.rarity].label : '');

  // ---------- Trade ----------

  // Where a price sits between cheap and dear, as a marker on a slim track.
  function gauge(price, base) {
    const k = clamp((price / base - GAUGE[0]) / (GAUGE[1] - GAUGE[0]), 0, 1);
    const tone = price / base < 0.88 ? 'cheap' : price / base > 1.12 ? 'dear' : '';
    const word = tone === 'cheap' ? 'Cheap here' : tone === 'dear' ? 'Dear here' : 'Usual price';
    return h('span', { class: 'st-gauge', role: 'img', 'aria-label': word, title: word },
      h('span', { class: `mark ${tone}`, style: { left: `${k * 100}%` } }));
  }

  // A trade good: its icon and name, how many you hold, where the price sits, Buy (if stocked here) and Sell.
  function goodRow(g, full) {
    const { hold } = ctx;
    const t = Goods.type(g.kind), name = t.name;
    const n = hold.count(g.kind);
    const buy = g.buy === null
      ? h('span', { class: 'lock' }, 'Not sold')
      : Kit.button('Buy', act(() => hold.buy(g.kind, g.buy, name)), {
        price: g.buy, disabled: full || hold.credits < g.buy, aria: `Buy ${name} for ${g.buy} credits`,
      });
    const sell = Kit.button('Sell', act(() => hold.sell(g.kind, g.sell)), {
      kind: 'ghost', price: g.sell, disabled: n < 1, aria: `Sell ${name} for ${g.sell} credits`,
    });
    return Kit.optionRow({
      icon: h('span', { class: 'st-item' }, itemIcon(g.kind, 40), n ? h('span', { class: 'n num' }, `×${n}`) : null),
      name, tag: rarityTag(t), tagTone: `t${t.rarity}`,
      // Against the usual price on the same side of the spread, so an ordinary price sits mid-track.
      extra: gauge(g.buy ?? g.sell, Economy.basePrice(g.kind) * (1 + (g.buy === null ? -1 : 1) * Economy.config.spread)),
      action: h('span', { class: 'st-deal' }, buy, sell),
    });
  }

  // Trade: the hold, what this station stocks by category, and anything else you're carrying, with
  // what it fetches here. (Components aren't traded: they go to research.)
  function renderTrade() {
    const { market, hold } = ctx;
    const full = hold.free < 1;
    const groups = [];
    for (const category of Goods.categories('trade')) {
      const stocked = market.goods.filter((g) => g.category === category && g.buy !== null);
      if (!stocked.length) continue;
      const { produced, consumed } = stocked[0];
      groups.push(section(Goods.CATEGORIES[category].label,
        Kit.head(Goods.CATEGORIES[category].label, produced ? Kit.tag('Made here', 'var(--good)') : consumed ? Kit.tag('In demand', 'var(--warn)') : null),
        h('div', { class: 'ui-list' }, stocked.map((g) => goodRow(g, full)))));
    }
    const carried = market.goods.filter((g) => g.buy === null && hold.count(g.kind) > 0);
    return [
      titleRow('Trade', `${hold.items.length}/${hold.capacity} hold`),
      h('div', { class: 'st-holdbar' }, Kit.icon('hold', 24, { code: 'HLD' }), Kit.meter(hold.items.length / hold.capacity, { color: full ? 'var(--warn)' : null })),
      full ? Kit.callout('Your hold is full. Sell cargo to make room.', 'var(--warn)') : null,
      groups.length ? groups : h('p', { class: 'ui-empty' }, 'Nothing for sale here.'),
      carried.length ? section('Also in your hold', Kit.head('Also in your hold', h('span', { class: 'aside' }, 'not sold here')),
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

  // The sheet for one slot: what's fitted (Remove), then spare gear (Fit), researched gear (Buy) and
  // the next of each line still to research, each with its stat changes against what's fitted.
  function slotSheet(id) {
    const { outfitting: o, hold } = ctx;
    const s = Loadout.slots(o.loadout, o.upgrades).find((x) => x.id === id);
    if (!s) return null;
    const cur = s.item;
    const ids = Object.keys(Loadout.EQUIPMENT).filter((e) => Loadout.EQUIPMENT[e].slot === s.type && !Loadout.EQUIPMENT[e].npc && e !== cur?.id);
    const rank = (e) => (o.gear[e] ? 0 : o.known.has(e) ? 1 : 2);
    // Of the gear still to research, only the next Mk of each line.
    const next = new Set();
    for (const e of ids) {
      const item = Loadout.EQUIPMENT[e];
      if (rank(e) === 2 && ![...next].some((n) => Loadout.EQUIPMENT[n].line === item.line)) next.add(e);
    }
    const options = ids.filter((e) => rank(e) < 2 || next.has(e))
      .sort((a, b) => rank(a) - rank(b) || Loadout.EQUIPMENT[a].tier - Loadout.EQUIPMENT[b].tier)
      .map((e) => {
        const item = { id: e, ...Loadout.EQUIPMENT[e] };
        const kind = ['fit', 'buy', 'locked'][rank(e)];
        const short = hold.credits < item.price;
        const fitted = () => {
          closeSheet();
          refresh();
          Kit.toast(`${item.name} fitted to ${s.label}`);
        };
        return Kit.optionRow({
          code: SLOT_CODE[s.type], name: lineName(item), tier: item.tier, rows: Kit.compare(cur, item, METRICS[s.type]),
          tag: kind === 'fit' ? `Spare ×${o.gear[e]}` : kind === 'locked' ? 'Research' : '', tagTone: kind === 'fit' ? 'good' : null,
          locked: kind === 'locked',
          note: kind === 'fit' ? `Spare gear aboard. Fitting it ${cur ? 'moves the current one to spare gear' : 'fills this slot'}.`
            : kind === 'buy' ? [Loadout.STARTER_GEAR.includes(e) ? 'Sold at every station.' : 'Unlocked by research.', short ? `You need ${(item.price - hold.credits).toLocaleString('en-US')} cr more.` : '', cur ? 'The current one goes to spare gear.' : ''].filter(Boolean).join(' ')
              : `Research ${item.name} to buy it.`,
          open: openOption === e, onToggle: () => { openOption = openOption === e ? null : e; refresh(); },
          action: kind === 'fit' ? Kit.button('Fit', act(() => o.fit(s.id, e), fitted), { kind: 'primary', aria: `Fit ${item.name}` })
            : kind === 'buy' ? Kit.button('Buy', act(() => o.fit(s.id, e, true), fitted), { price: item.price, disabled: short, aria: `Buy and fit ${item.name} for ${item.price} credits` })
              : null,
        });
      });
    return {
      title: s.label, code: SLOT_CODE[s.type], sub: `${SLOT_KIND[s.type]} · ${options.length} option${options.length === 1 ? '' : 's'}`,
      body: [
        h('span', { class: 'ui-label' }, 'Fitted'),
        cur ? Kit.optionRow({
          code: SLOT_CODE[s.type], name: lineName(cur), tier: cur.tier, vals: valuesOf(cur), current: true,
          action: Kit.button('Remove', act(() => o.unfit(s.id), () => Kit.toast(`${cur.name} moved to spare gear`)), { kind: 'ghost', aria: `Remove ${cur.name}` }),
        }) : h('p', { class: 'ui-empty' }, s.type === 'weapon' ? 'Open hardpoint' : 'Nothing fitted'),
        h('span', { class: 'ui-label' }, 'Options'),
        options.length ? options : h('p', { class: 'ui-note' }, 'Research unlocks more equipment for this slot.'),
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
        ? Kit.button(affordable < repairs.cost ? 'Repair part' : 'Repair', act(() => repairs.repair(), () => Kit.toast('Hull repaired')), {
          kind: 'warn', price: affordable, disabled: affordable <= 0, aria: `Repair the hull for ${affordable} credits`,
        })
        : h('span', { class: 'ui-tag', style: { '--tone': 'var(--good)' } }, 'Intact'));
  }

  // Spare gear: bought or taken out, kept aboard (it takes no hold space); sold back for half.
  function renderGear() {
    const { outfitting: o } = ctx;
    const ids = Object.keys(o.gear);
    if (!ids.length) return null;
    return section('Spare gear', Kit.head('Spare gear', h('span', { class: 'aside' }, 'sells for half')),
      h('div', { class: 'ui-list' }, ids.map((id) => {
        const item = { id, ...Loadout.EQUIPMENT[id] };
        return Kit.optionRow({
          code: SLOT_CODE[item.slot], name: lineName(item), tier: item.tier, tag: o.gear[id] > 1 ? `×${o.gear[id]}` : '', vals: valuesOf(item),
          action: Kit.button('Sell', act(() => o.sell(id), () => Kit.toast(`${item.name} sold`)), { kind: 'ghost', price: o.sellPrice(id), aria: `Sell ${item.name} for ${o.sellPrice(id)} credits` }),
        });
      })));
  }

  // The shipyard (capital and major stations): other hulls, against the one you fly, with it traded in.
  const HULL_METRICS = [
    { code: 'WPN', label: 'Weapon slots', get: (s) => s.weaponSlots, fmt: String, fmtDiff: String },
    { code: 'HUL', label: 'Hull', get: (s) => s.hull, fmt: String, fmtDiff: String },
    { code: 'CRG', label: 'Cargo', get: (s) => s.cargo, fmt: String, fmtDiff: String },
    { code: 'HND', label: 'Handling', get: (s) => s.handling, fmt: (v) => `×${v}`, fmtDiff: (v) => `${r2(v)}` },
  ];
  function renderShipyard() {
    const { outfitting: o } = ctx;
    if (!ctx.shipyard) return h('p', { class: 'ui-note st-foot-note' }, 'Capital and major stations sell new hulls.');
    const current = o.loadout.hull;
    const statsOf = (id) => ({ ...Loadout.stats({ hull: id, fitted: {} }, o.upgrades), handling: Loadout.HULLS[id].handling });
    const mine = statsOf(current);
    return section('Shipyard', Kit.head('Shipyard', h('span', { class: 'aside' }, `trade-in ${o.tradeIn().toLocaleString('en-US')} cr`)),
      h('div', { class: 'ui-list' }, Loadout.FOR_SALE.map((id) => {
        const hull = Loadout.HULLS[id];
        const blocked = id === current ? null : o.hullBlocked(id);
        return Kit.optionRow({
          code: 'HUL', name: hull.name, tag: id === current ? 'Flying' : '', tagTone: 'good', current: id === current,
          rows: id === current ? null : Kit.compare(mine, statsOf(id), HULL_METRICS),
          vals: id === current ? HULL_METRICS.map((m) => [m.code, m.fmt(m.get(mine))]) : null,
          note: [hull.note, blocked].filter(Boolean).join(' · '),
          open: openHull === id, onToggle: id === current ? null : () => { openHull = openHull === id ? null : id; refresh(); },
          action: id === current ? null : Kit.button('Buy', act(() => o.buyHull(id), () => Kit.toast(`Now flying a ${hull.name}`)), {
            price: o.hullPrice(id), disabled: !!blocked, title: blocked || undefined, aria: `Buy a ${hull.name}`,
          }),
        });
      })));
  }

  function renderShip() {
    const { ship, hold, outfitting: o } = ctx;
    const slots = Loadout.slots(o.loadout, o.upgrades);
    const fromItem = (type) => { const s = slots.find((x) => x.type === type && x.item); return s ? `From ${s.item.name}` : 'Nothing fitted'; };
    const stats = [
      { id: 'spd', code: 'SPD', label: 'Speed', value: `${ship.maxSpeed}`, detail: `Top speed when cruising; it gets there at ${Math.round(ship.accel)} acceleration.`, from: fromItem('engine') },
      { id: 'trn', code: 'TRN', label: 'Turn', value: `${deg(ship.turnRate)}°/s`, detail: `Degrees per second the ship can turn (the ${ship.name} handles ×${Loadout.HULLS[o.loadout.hull].handling}).`, from: fromItem('engine') },
      { id: 'eva', code: 'EVA', label: 'Evasion', value: pct(ship.evasion), detail: 'Chance to avoid incoming fire.', from: fromItem('engine') },
      { id: 'shd', code: 'SHD', label: 'Shield', value: `${ship.shield}`, detail: ship.shield ? `${ship.shield} strength, recharging ${ship.shieldRecharge} per second.` : 'No shield fitted.', from: fromItem('shield') },
      { id: 'dps', code: 'DPS', label: 'Firepower', value: `${r2(ship.firepower)}/s`, detail: `${r2(ship.firepower)} damage per second from ${ship.weaponsFitted} of ${ship.weaponSlots} weapons.`, from: ship.weapons.map((w) => w.name).join(' + ') || 'No weapons fitted' },
      { id: 'aim', code: 'AIM', label: 'Accuracy', value: pct(ship.accuracy), detail: `Hit chance, weighed against the target's evasion. Locks on in ${r2(ship.lockTime)} s.`, from: fromItem('computer') },
      { id: 'sns', code: 'SNS', label: 'Sensors', value: Format.dist(ship.sensorRange), detail: `Identifies at ${Format.dist(ship.sensorRange)} · pings at ${Format.dist(ship.pingRange)} · locks at ${Format.dist(ship.lockRange)}.`, from: fromItem('scanner') },
      { id: 'min', code: 'MIN', label: 'Mining', value: ship.miningRate ? `${(Mining.config.duration / ship.miningRate).toFixed(1)} s` : '—', detail: ship.miningRate ? 'Seconds to mine an asteroid.' : 'No ship computer: no mining.', from: fromItem('computer') },
      { id: 'crg', code: 'CRG', label: 'Cargo', value: `${ship.cargo}`, detail: 'Hold capacity in units.', from: `From the ${ship.name} hull` },
    ];
    const groups = new Map(); // item type -> count
    for (const it of hold.items) groups.set(it.kind, (groups.get(it.kind) || 0) + 1);
    const items = [...groups].map(([kind, n]) => {
      const t = Goods.type(kind);
      return { id: kind, icon: itemIcon(kind, 32), name: t.name, count: n, tier: t.rarity, rarity: Goods.RARITY[t.rarity].label };
    });
    return [
      section('Ship', titleRow(ship.name, `${slots.filter((s) => s.item).length}/${slots.length} slots fitted`), ctx.repairs ? hullRow() : null),
      schematic(slots),
      section('Performance', Kit.head('Performance'), Kit.statChips(stats, openStat, (id) => { openStat = id; refresh(); })),
      section('Hold', Kit.head('Hold', Kit.meter(hold.items.length / hold.capacity, { thin: true }), h('span', { class: 'aside num' }, `${hold.items.length}/${hold.capacity}`)),
        items.length ? Kit.itemTiles(items, openHold, (id) => { openHold = id; refresh(); })
          : h('p', { class: 'ui-empty' }, 'Empty. Buy goods at Trade or pick up cargo in space.')),
      renderGear(),
      renderShipyard(),
    ];
  }

  // ---------- Research ----------

  const NODE_CODE = { weapons: 'WPN', shields: 'SHD', computers: 'CPU', engines: 'ENG', scanners: 'SCN', hull: 'HUL' };
  const ROMAN = [null, 'I', 'II', 'III', 'IV', 'V'];

  // Research: the components in store, then the tree by group (rules/research.js). Each node shows
  // its cost (with how much of each you have) and Research; tap it for what it gives.
  function renderResearch() {
    const { lab } = ctx;
    const grid = h('table', { class: 'st-components' },
      h('thead', {}, h('tr', {}, h('th', {}, ''), [1, 2, 3, 4, 5].map((t) => h('th', { scope: 'col', title: Goods.TIERS[t], style: { color: Kit.TIER[t] } }, ROMAN[t])))),
      h('tbody', {}, Goods.categories('salvage').map((cat) => h('tr', {},
        h('th', { scope: 'row' }, Goods.CATEGORIES[cat].label.replace(' components', '')),
        [1, 2, 3, 4, 5].map((tier) => {
          const n = lab.components[Goods.component(cat, tier)] || 0;
          return h('td', { class: n ? 'has num' : 'num', style: n ? { color: Kit.TIER[tier] } : undefined }, n ? String(n) : '·');
        })))));
    const nameOf = (id) => Research.NODES[id].name;
    const node = (n) => {
      const st = lab.status(n.id);
      const item = n.equipment ? { id: n.equipment, ...Loadout.EQUIPMENT[n.equipment] } : null;
      const prevId = item ? `${item.line}-${item.tier - 1}` : null;
      const prev = prevId && Loadout.EQUIPMENT[prevId] ? { id: prevId, ...Loadout.EQUIPMENT[prevId] } : null;
      const done = st.state === 'done';
      const costs = done ? null : h('span', { class: 'st-costs' }, st.cost.map((c) => h('span', {
        class: `cost num${c.have < c.need ? ' short' : ''}`, title: Goods.type(c.kind).name,
      }, itemIcon(c.kind, 18), `${c.have}/${c.need}`)));
      return Kit.optionRow({
        code: NODE_CODE[n.group], name: item ? lineName(item) : n.name.replace(/ Mk [IV]+$/, ''), tier: / Mk [IV]+$/.test(n.name) ? n.tier : null,
        tag: done ? 'Researched' : '', tagTone: 'good',
        rows: item && prev ? Kit.compare(prev, item, METRICS[item.slot]) : null,
        extra: costs,
        note: [done && item ? `${n.note}. Buy it in the Ship tab.` : n.note, st.state === 'locked' ? `Needs ${st.needs.map(nameOf).join(', ')}` : ''].filter(Boolean).join(' · '),
        open: openNode === n.id, onToggle: () => { openNode = openNode === n.id ? null : n.id; refresh(); },
        locked: st.state === 'locked', lockLabel: 'Locked',
        action: st.state === 'available' ? Kit.button('Research', act(() => lab.research(n.id), () => Kit.toast(`${n.name} researched`)), {
          kind: st.ok ? 'primary' : '', disabled: !st.ok, aria: `Research ${n.name}`,
        }) : null,
      });
    };
    return [
      titleRow('Research', `${lab.researched.size}/${Object.keys(Research.NODES).length} done`),
      section('Components', Kit.head('Components', h('span', { class: 'aside' }, 'from pirates and wrecks')), grid),
      ...Research.LINES.map((line) => section(line.label,
        Kit.head(line.label, h('span', { class: 'aside num' }, `${line.nodes.filter((n) => lab.researched.has(n.id)).length}/${line.nodes.length}`)),
        h('div', { class: 'ui-list' }, line.nodes.map(node)))),
    ];
  }

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

  // A mission's card: who gives it, its title and state, the objective to do now, a segment per
  // objective, and what it pays. Tap for the whole mission.
  function missionCard(m) {
    const S = STATUS[m.status];
    const goal = m.status === 'active' ? m.objectives.find((o) => o.open && !o.done) : null;
    const hint = goal ? null : m.status === 'ready' ? (m.here ? 'All objectives met. Hand it in here.' : `Hand it in at ${m.from}.`)
      : m.status === 'offered' ? `${m.objectives.length} objective${m.objectives.length === 1 ? '' : 's'} · tap to read the briefing` : null;
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
      h('span', { class: 'foot' }, Kit.icon('reward', 14, { code: '' }), h('span', {}, m.reward))),
    h('span', { class: 'go', 'aria-hidden': 'true' }, '›'));
  }
  const doneCard = (m) => h('button', { class: 'ui-card compact', type: 'button', 'aria-haspopup': 'dialog', 'aria-label': `${m.title}, completed`, onclick: () => showMission(m.id) },
    Kit.check('done'),
    h('span', { class: 'main' }, h('span', { class: 'title' }, m.title), h('span', { class: 'foot' }, h('span', {}, m.reward))),
    h('span', { class: 'go', 'aria-hidden': 'true' }, '›'));

  // The sheet for one mission: what the giver says (the first line, the rest on request), the
  // objectives as a checklist, what it provides and pays, and Accept or Complete at the foot.
  function missionSheet(id) {
    const m = missions().find((x) => x.id === id);
    if (!m) return null;
    const S = STATUS[m.status];
    const lines = m.lines;
    const shown = briefAll ? lines : lines.slice(0, 1);
    const goals = m.status === 'done' ? [] : m.objectives;
    const accept = m.status === 'offered' && m.here && m.accept;
    const complete = m.status === 'ready' && m.here && m.complete;
    return {
      title: m.title, kicker: S.badge, kickerColor: S.color, tall: true,
      body: [
        lines.length ? Kit.quote({
          from: m.from, kind: LINES_KIND[m.status], face: m.face ? portrait(m.face, 56) : null, color: 'var(--culture)', lines: shown,
          more: lines.length > 1 ? h('button', { class: 'ui-link', type: 'button', 'aria-expanded': String(briefAll), onclick: () => { briefAll = !briefAll; refresh(); } },
            briefAll ? 'Show less ▴' : `Read all ${lines.length} lines ▾`) : null,
        }) : null,
        goals.length ? [h('span', { class: 'ui-label' }, 'Objectives'), h('div', { class: 'ui-goals' }, goals.map((o) => {
          const state = o.done ? 'done' : o.open ? 'open' : 'later';
          return h('div', { class: `ui-goal ${state}` }, Kit.check(state),
            h('span', { class: 'main' }, h('span', { class: 'txt' }, o.label),
              o.need > 1 && o.open && !o.done ? Kit.meter(o.count / o.need, { thin: true }) : null),
            h('span', { class: 'num' }, goalCount(o)));
        }))] : null,
        h('div', { class: 'ui-list st-gap' },
          m.provided ? Kit.infoTile({ code: 'PRV', label: 'Provided', text: m.provided }) : null,
          Kit.infoTile({ code: 'RWD', label: m.status === 'done' ? 'Paid' : 'Reward', text: m.reward, tone: 'var(--new)' })),
        m.note && m.status === 'done' ? Kit.callout(m.note) : m.note && m.status === 'offered' ? h('p', { class: 'ui-note' }, m.note) : null,
      ],
      foot: [
        accept ? Kit.button('Accept mission', act(() => { briefAll = false; m.accept(); }, () => Kit.toast(`${m.title} accepted. It's marked on your map.`)), { kind: 'primary', lg: true, wide: true }) : null,
        complete ? Kit.button('Complete mission', act(() => { briefAll = false; m.complete(); }, () => Kit.toast(`${m.title} complete`)), { kind: 'good', lg: true, wide: true }) : null,
        m.status === 'ready' && !complete ? h('p', { class: 'ui-note' }, `Hand it in at ${m.from}.`) : null,
        m.status === 'active' ? h('p', { class: 'ui-note' }, m.note ? `Launch to continue. ${m.note}` : 'Launch to continue.') : null,
      ],
    };
  }

  // Missions: hand-ins first, then those in progress, then new offers; the completed folded away.
  function renderMissions() {
    const list = missions();
    const { reason } = locks();
    const current = list.filter((m) => m.status !== 'done').sort((a, b) => ORDER[a.status] - ORDER[b.status]);
    const done = list.filter((m) => m.status === 'done');
    return [
      titleRow('Missions', `${current.length} open`),
      reason ? Kit.callout(reason, 'var(--warn)') : null,
      list.length ? null : h('p', { class: 'ui-empty' }, 'No missions posted here.'),
      h('div', { class: 'ui-list' }, current.map(missionCard),
        done.length ? [Kit.disclosure({ label: `Completed · ${done.length}`, open: doneOpen, onToggle: () => { doneOpen = !doneOpen; refresh(); } }),
          doneOpen ? done.map(doneCard) : null] : null),
    ];
  }

  // ---------- Squad ----------

  // The squad: each member, its hull, and its logic modules in the order they're checked.
  function renderSquad() {
    const members = ctx.squad ? ctx.squad.members : [];
    return [
      titleRow('Squad', `${members.length} member${members.length === 1 ? '' : 's'}`),
      members.length ? h('p', { class: 'ui-note' }, 'Each member runs its first logic module whose condition holds, top down. If none does, it keeps formation with you.') : null,
      members.length ? members.map((m) => {
        const st = Squad.stats(m), n = Squad.modulesOf(m).length;
        const k = m.disabled ? 0 : m.hullPoints / st.hull;
        return section(m.name,
          h('div', { class: 'st-member' }, Kit.icon('android', 40, { code: 'AND', tier: m.tier }),
            h('span', { class: 'main' },
              h('span', { class: 'line' }, h('span', { class: 'name' }, m.name), Kit.mk(m.tier)),
              h('span', { class: 'sub' }, `Android ${Loadout.HULLS[m.hull].name.toLowerCase()} · ${Loadout.MK[m.tier]} gear`)),
            m.disabled ? Kit.tag('Disabled', 'var(--hostile)') : null),
          h('div', { class: 'st-hull' }, Kit.icon('hull', 24, { code: 'HUL' }),
            h('div', { class: 'gauge' },
              h('div', { class: 'top' }, h('span', { class: 'ui-label' }, 'Hull'), h('span', { class: 'num' }, m.disabled ? 'disabled' : `${Math.ceil(m.hullPoints)}/${st.hull}`)),
              Kit.meter(k, { color: k < 0.35 ? 'var(--hostile)' : k < 1 ? 'var(--warn)' : 'var(--good)' }))),
          Kit.head('Logic', h('span', { class: 'aside' }, `${n} of ${Squad.SLOTS} logic slots in use`)),
          h('div', { class: 'ui-list' }, m.modules.map((id, i) => Kit.optionRow({
            code: `L${i + 1}`, name: id ? Logic.label(id) : 'Empty', sub: id ? Logic.rule(id) : 'No module installed', locked: !id, lockLabel: null,
          }))));
      }) : h('p', { class: 'ui-empty' }, 'No squad members yet.'),
    ];
  }

  // ---------- Sheets ----------

  function sheetOptions() {
    return openSlot ? slotSheet(openSlot) : openMission ? missionSheet(openMission) : null;
  }
  function openSheet() {
    const o = sheetOptions();
    if (!o) { closeSheet(); return; }
    sheet = Kit.sheet({ ...o, host: layer, onClose: () => { sheet = null; openSlot = openMission = null; refresh(); } });
  }
  function closeSheet() {
    openSlot = openMission = null;
    if (sheet) { const s = sheet; sheet = null; s.close(true); }
  }
  function showSlot(id) { closeSheet(); openSlot = id; openOption = null; refresh(); openSheet(); }
  function showMission(id) { closeSheet(); openMission = id; briefAll = false; refresh(); openSheet(); }

  // ---------- Refresh ----------

  // What can't be used yet (see open()); nothing is locked unless the flight view says so.
  const locks = () => (ctx && ctx.locks ? ctx.locks() : { tabs: [], reason: '', launch: null });
  const isLocked = (name) => locks().tabs.includes(name);
  const tabNames = () => (tabs.length ? tabs.map((t) => t.dataset.tab) : Object.keys(RENDER));
  const firstOpen = () => tabNames().find((name) => !isLocked(name)) || 'trade';

  const RENDER = { trade: () => renderTrade(), ship: () => renderShip(), research: () => renderResearch(), squad: () => renderSquad(), missions: () => renderMissions() };
  function refresh() {
    if (!ctx) return;
    const lock = locks();
    if (lock.tabs.includes(tab)) tab = firstOpen();
    renderHeader();
    for (const t of tabs) {
      const on = t.dataset.tab === tab, locked = lock.tabs.includes(t.dataset.tab);
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
      t.disabled = locked;
      t.title = locked ? lock.reason : TABS[t.dataset.tab].label;
    }
    missionDot.hidden = !missions().some((m) => m.here && (m.status === 'offered' || m.status === 'ready'));
    const launch = el('st-launch');
    launch.disabled = !!lock.launch;
    launch.title = lock.launch || '';
    const note = el('st-note');
    note.textContent = lock.launch || '';
    note.hidden = !lock.launch;
    const scroll = body.scrollTop;
    body.replaceChildren(...RENDER[tab]().flat(Infinity).filter(Boolean)); // optional parts are null when absent
    body.scrollTop = scroll;
    if (sheet) {
      const o = sheetOptions();
      if (o) sheet.update(o);
      else closeSheet();
    }
  }

  function pick(name) {
    if (isLocked(name)) return;
    closeSheet();
    tab = name;
    openStat = openHold = openNode = openHull = null;
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
        if (!isLocked(tabs[i].dataset.tab)) break;
      }
      pick(tabs[i].dataset.tab);
      tabs[i].focus();
    });
  }
  el('st-launch').addEventListener('click', () => ctx && !locks().launch && ctx.onLaunch());

  return {
    // options.tab: the tab to open on (Trade if not given, or the first that isn't locked).
    open(options) {
      ctx = options;
      tab = options.tab || 'trade';
      closeSheet();
      openStat = openHold = openNode = openHull = null;
      doneOpen = false;
      root.hidden = false;
      body.scrollTop = 0;
      refresh();
      ((locks().launch && tabs.find((t) => t.dataset.tab === tab)) || el('st-launch')).focus({ preventScroll: true });
    },
    close() {
      closeSheet();
      ctx = null;
      root.hidden = true;
      body.replaceChildren();
    },
    get isOpen() { return !!ctx; },
    // Switch to a tab ('trade' | 'ship' | 'research' | 'squad' | 'missions') while open, unless
    // it's locked.
    showTab: pick,
    get tab() { return tab; },
    refresh,
    // Open or close the sheet for a loadout slot on the Ship tab.
    toggleSlot(id) { if (openSlot === id) { closeSheet(); refresh(); } else showSlot(id); },
    // Open the sheet for a mission on the Missions tab; closeSheet() closes whichever is open.
    showMission(id) { showMission(id); },
    closeSheet() { closeSheet(); refresh(); },
  };
})();

export { StationMenu };
