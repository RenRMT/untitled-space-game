'use strict';

// The docked screen: station header, Trade / Ship / Research / Squad / Missions tabs and a Launch
// button.
// StationMenu.open({ station: { name, subtitle, color }, market (Economy.market), hold, ship,
//                    outfitting, lab, shipyard, repairs, squad, missions, locks, artStyle, onLaunch })
// artStyle: the art style item icons are drawn in (Art.STYLES; 'line' if not given).
// hold: { credits, items, capacity, free, count(kind), buy(kind, price, label), sell(kind, price) }.
// ship: Loadout.stats() of the ship as it is (kept up to date as gear changes).
// outfitting: { loadout, upgrades, gear, known, sellPrice(id), hullPrice(id), tradeIn(), hullBlocked(id),
//               fit(slot, id, buy?), unfit(slot), sell(id), buyHull(id) }: the ship's equipment,
//               spare gear, buying what research unlocked, and the shipyard (game.js).
// lab: { researched, components, have(kind), status(id), research(id) }: the research tree (rules/research.js).
// shipyard: whether this station sells hulls (capital and major stations).
// repairs: { hull, max, price, cost, repair() }: hull damage from combat and fixing it for credits.
// squad: { members }: the squad (rules/squad.js), each member with its logic modules (rules/logic.js).
// missions: { list() -> [mission view] }: the missions to show here (story/missions.js, game.js), each
//   { id, title, from, face?(ctx, size), status ('offered' | 'active' | 'ready' | 'done'), here (its
//   giver is this station), lines: [what the giver says now], objectives: [{ label, count, need,
//   done, open, percent }], provided?, reward, note?, accept?(), complete?() }.
// locks() -> { tabs: [tab names], reason, launch }: tabs that can't be opened yet and why, and why
//   Launch can't be pressed yet (null when it can). Asked again after every change.
// Browser script (global `StationMenu`).

const StationMenu = (() => {
  const root = document.getElementById('station');
  const body = document.getElementById('st-body');
  const tabs = [...root.querySelectorAll('[role="tab"]')];
  const el = (id) => document.getElementById(id);

  // The price gauge spans this range of the base price (see rules/economy.js factors and jitter).
  const GAUGE = [0.55, 1.6];

  let ctx = null; // the open() options while docked
  let tab = 'trade';
  let openSlot = null; // the loadout slot whose choices are showing, if any

  const { h } = UI; // ui/ui.js
  const credits = (n) => `${n.toLocaleString('en-US')} cr`;

  function renderHeader() {
    el('st-name').textContent = ctx.station.name;
    el('st-sub').textContent = ctx.station.subtitle;
    el('st-credits').textContent = credits(ctx.hold.credits);
    root.style.setProperty('--culture', ctx.station.color);
    el('st-hold').textContent = `Hold ${ctx.hold.items.length}/${ctx.hold.capacity}`;
  }

  // Where a price sits between cheap and dear, as a marker on a slim track.
  function gauge(price, base) {
    const k = Math.max(0, Math.min(1, (price / base - GAUGE[0]) / (GAUGE[1] - GAUGE[0])));
    const tone = price / base < 0.88 ? 'cheap' : price / base > 1.12 ? 'dear' : '';
    return h('span', { class: 'gauge', 'aria-hidden': 'true' }, h('span', { class: `mark ${tone}`, style: { left: `${k * 100}%` } }));
  }

  // An item type's icon: its own art in the current style (art/icons.js). The name is beside it,
  // so the icon is decoration to screen readers.
  function itemIcon(kind, size) {
    return h('img', {
      class: 'icon', src: ItemIcons.url(kind, ctx.artStyle, size), alt: '', 'aria-hidden': 'true',
      width: size, height: size, draggable: 'false',
    });
  }

  // An item type's name and rarity (rules/goods.js), for list rows.
  function itemName(kind) {
    const t = Goods.type(kind);
    return [t.name, t.rarity > 1 ? h('span', { class: `rarity r${t.rarity}` }, Goods.RARITY[t.rarity].label) : null];
  }

  // A trade good: name, how many you hold, where the price sits, Buy (if stocked here) and Sell.
  function goodRow(g, full) {
    const { hold } = ctx;
    const name = Goods.type(g.kind).name;
    const n = hold.count(g.kind);
    const buy = g.buy === null
      ? h('span', { class: 'na' }, 'not sold')
      : h('button', {
        class: 'btn', type: 'button', disabled: full || hold.credits < g.buy,
        'aria-label': `Buy ${name} for ${g.buy} credits`,
        onclick: () => { hold.buy(g.kind, g.buy, name); refresh(); },
      }, `Buy ${g.buy}`);
    const sell = h('button', {
      class: 'btn', type: 'button', disabled: n < 1,
      'aria-label': `Sell ${name} for ${g.sell} credits`,
      onclick: () => { hold.sell(g.kind, g.sell); refresh(); },
    }, `Sell ${g.sell}`);
    return h('li', { class: 'good' },
      h('div', { class: 'what with-icon' },
        itemIcon(g.kind, 32),
        h('span', { class: 'name' }, itemName(g.kind)),
        h('span', { class: 'held' }, n ? `${n} in hold` : ''),
        // Against the usual price on the same side of the spread, so an ordinary price sits mid-track.
        gauge(g.buy ?? g.sell, Economy.basePrice(g.kind) * (1 + (g.buy === null ? -1 : 1) * Economy.config.spread))),
      h('div', { class: 'deal' }, buy, sell));
  }

  // Trade: what this station stocks, by category, and anything else you're carrying, with what it
  // fetches here. (Components aren't traded: they go to research.)
  function renderTrade() {
    const { market, hold } = ctx;
    const full = hold.free < 1;
    const groups = [];
    for (const category of Goods.categories('trade')) {
      const stocked = market.goods.filter((g) => g.category === category && g.buy !== null);
      if (!stocked.length) continue;
      const { produced, consumed } = stocked[0];
      groups.push(h('h3', { class: 'cat' }, Goods.CATEGORIES[category].label,
        produced ? h('span', { class: 'tag made' }, 'made here') : consumed ? h('span', { class: 'tag wanted' }, 'in demand') : null));
      groups.push(h('ul', { class: 'list' }, stocked.map((g) => goodRow(g, full))));
    }
    const carried = market.goods.filter((g) => g.buy === null && hold.count(g.kind) > 0);

    return [
      full ? h('p', { class: 'note' }, 'Your hold is full. Sell cargo to make room.') : null,
      h('section', { 'aria-label': 'For sale here' },
        h('h2', {}, 'For sale here'),
        groups.length ? groups : h('p', { class: 'empty' }, 'Nothing for sale here.')),
      carried.length ? h('section', { 'aria-label': 'Also in your hold' },
        h('h2', {}, 'Also in your hold', h('span', { class: 'count' }, 'not sold here')),
        h('ul', { class: 'list' }, carried.map((g) => goodRow(g, full)))) : null,
    ];
  }

  // A row in a list of choices: name and detail on the left, an action (or a note) on the right.
  function choice(name, detail, action) {
    return h('li', { class: 'choice' },
      h('span', { class: 'what' }, h('span', { class: 'name' }, name), h('span', { class: 'detail' }, detail)),
      action);
  }
  const button = (label, onclick, { disabled = false, aria } = {}) =>
    h('button', { class: 'btn small', type: 'button', disabled, 'aria-label': aria, onclick: () => { onclick(); refresh(); } }, label);

  // One equipment slot: what kind it is, what's fitted and what that does; Change opens the
  // choices for it: take it out, fit spare gear, or buy and fit anything research has unlocked.
  function slotRow(s) {
    const { outfitting: o, hold } = ctx;
    const open = openSlot === s.id;
    const row = h('li', { class: s.item ? 'slot' : 'slot empty' },
      h('span', { class: 'type' }, s.label),
      h('span', { class: 'item' },
        h('span', { class: 'name' }, s.item ? s.item.name : 'Empty'),
        h('span', { class: 'detail' }, s.item ? Loadout.summary(s.item) : s.type === 'weapon' ? 'Open hardpoint' : 'Nothing fitted')),
      h('button', {
        class: 'btn small', type: 'button', 'aria-expanded': String(open), 'aria-label': `Change ${s.label}`,
        onclick: () => { openSlot = open ? null : s.id; refresh(); },
      }, open ? 'Done' : 'Change'));
    if (!open) return row;
    const options = [];
    if (s.item) options.push(choice('Take it out', 'Kept as spare gear', button('Remove', () => o.unfit(s.id))));
    const ofType = Object.keys(Loadout.EQUIPMENT).filter((id) => Loadout.EQUIPMENT[id].slot === s.type && !Loadout.EQUIPMENT[id].npc);
    for (const id of ofType) {
      const item = Loadout.EQUIPMENT[id];
      if (o.gear[id]) options.push(choice(`${item.name} · spare ×${o.gear[id]}`, Loadout.summary(item), button('Fit', () => o.fit(s.id, id))));
      else if (o.known.has(id) && id !== s.item?.id) {
        options.push(choice(item.name, Loadout.summary(item), button(`Buy ${item.price}`, () => o.fit(s.id, id, true),
          { disabled: hold.credits < item.price, aria: `Buy and fit ${item.name} for ${item.price} credits` })));
      }
    }
    if (options.length === (s.item ? 1 : 0)) options.push(h('li', { class: 'empty' }, 'Research unlocks more equipment for this slot.'));
    return [row, h('li', { class: 'slot-options' }, h('ul', { class: 'choices' }, options))];
  }

  // Spare gear: bought or taken out, kept aboard (it takes no hold space); sold back for half.
  function renderGear() {
    const { outfitting: o } = ctx;
    const ids = Object.keys(o.gear);
    if (!ids.length) return null;
    return h('section', { 'aria-label': 'Spare gear' },
      h('h2', {}, 'Spare gear', h('span', { class: 'count' }, 'sells for half')),
      h('ul', { class: 'choices' }, ids.map((id) => {
        const item = Loadout.EQUIPMENT[id];
        return choice(`${item.name}${o.gear[id] > 1 ? ` ×${o.gear[id]}` : ''}`, Loadout.summary(item),
          button(`Sell ${o.sellPrice(id)}`, () => o.sell(id), { aria: `Sell ${item.name} for ${o.sellPrice(id)} credits` }));
      })));
  }

  // The shipyard (capital and major stations): other hulls, with the current one traded in.
  function renderShipyard() {
    const { outfitting: o } = ctx;
    if (!ctx.shipyard) {
      return h('section', { 'aria-label': 'Shipyard' }, h('h2', {}, 'Shipyard'),
        h('p', { class: 'empty' }, 'Capital and major stations sell new hulls.'));
    }
    const current = o.loadout.hull;
    return h('section', { 'aria-label': 'Shipyard' },
      h('h2', {}, 'Shipyard', h('span', { class: 'count' }, `your ${Loadout.HULLS[current].name} trades in for ${o.tradeIn().toLocaleString('en-US')} cr`)),
      h('ul', { class: 'choices' }, Loadout.FOR_SALE.map((id) => {
        const hull = Loadout.HULLS[id];
        const stats = Loadout.stats({ hull: id, fitted: {} }, o.upgrades);
        const detail = `${stats.weaponSlots} weapon${stats.weaponSlots > 1 ? 's' : ''} · ${stats.hull} hull · ${stats.cargo} cargo · handling ×${hull.handling} — ${hull.note}`;
        const blocked = o.hullBlocked(id);
        const action = id === current ? h('span', { class: 'held' }, 'Flying it')
          : button(`Buy ${o.hullPrice(id).toLocaleString('en-US')}`, () => o.buyHull(id), { disabled: !!blocked, aria: `Buy a ${hull.name}` });
        return choice(hull.name, blocked && id !== current ? `${detail} · ${blocked}` : detail, action);
      })));
  }

  // Hull damage from combat, and repairing it for credits (as much as the credits cover).
  function renderHull() {
    const { repairs, hold } = ctx;
    const damaged = repairs.hull < repairs.max;
    const affordable = Math.min(repairs.cost, Math.floor(hold.credits / repairs.price) * repairs.price);
    const pct = Math.max(0, Math.min(100, (repairs.hull / repairs.max) * 100));
    return h('section', { 'aria-label': 'Hull' },
      h('h2', {}, 'Hull', h('span', { class: 'count' }, `${Math.ceil(repairs.hull)}/${repairs.max}`)),
      h('div', { class: `hull-row${damaged ? ' damaged' : ''}` },
        h('span', { class: 'hull-gauge', 'aria-hidden': 'true' }, h('span', { style: { width: `${pct}%` } })),
        damaged
          ? h('button', {
            class: 'btn', type: 'button', disabled: affordable <= 0,
            'aria-label': `Repair the hull for ${affordable} credits`,
            onclick: () => { repairs.repair(); refresh(); },
          }, affordable < repairs.cost ? `Repair part · ${affordable} cr` : `Repair · ${repairs.cost} cr`)
          : h('span', { class: 'held' }, 'No damage')));
  }

  function renderShip() {
    const { ship, hold, outfitting } = ctx;
    const stat = (label, value) => h('div', { class: 'stat' }, h('dt', {}, label), h('dd', {}, value));
    const slots = Loadout.slots(outfitting.loadout, outfitting.upgrades);
    const k = (units) => `${(units / 1000).toFixed(1)}k`;
    const groups = new Map(); // item type -> count
    for (const it of hold.items) groups.set(it.kind, (groups.get(it.kind) || 0) + 1);
    return [
      ctx.repairs ? renderHull() : null,
      h('section', { 'aria-label': 'Loadout' },
        h('h2', {}, ship.name, h('span', { class: 'count' }, `${slots.filter((s) => s.item).length}/${slots.length} slots fitted`)),
        h('ul', { class: 'slots' }, slots.flatMap(slotRow))),
      renderGear(),
      renderShipyard(),
      h('section', { 'aria-label': 'Performance' },
        h('h2', {}, 'Performance'),
        h('dl', { class: 'stats' },
          stat('Top speed', `${ship.maxSpeed}`),
          stat('Acceleration', `${ship.accel}`),
          stat('Turn rate', `${Math.round((ship.turnRate * 180) / Math.PI)}° per second`),
          stat('Sensors', `identify at ${k(ship.sensorRange)} · ping at ${k(ship.pingRange)}`),
          stat('Mining', ship.miningRate ? `${(Mining.config.duration / ship.miningRate).toFixed(1)} s per asteroid` : 'No ship computer'),
          stat('Shield', ship.shield ? `${ship.shield} · ${ship.shieldRecharge}/s recharge` : 'None'),
          stat('Firepower', `${ship.firepower} damage/s · ${ship.weaponsFitted} of ${ship.weaponSlots} weapons`),
          stat('Targeting', `${Math.round(ship.accuracy * 100)}% accuracy · ${Math.round(ship.evasion * 100)}% evasion`),
          stat('Cargo hold', `${ship.cargo} units`))),
      h('section', { 'aria-label': 'Hold' },
        h('h2', {}, `Hold ${hold.items.length}/${hold.capacity}`),
        groups.size
          ? h('ul', { class: 'list compact' }, [...groups].map(([kind, n]) => h('li', {},
            h('span', { class: 'name' }, itemIcon(kind, 24), h('span', {}, itemName(kind))),
            h('span', { class: 'held' }, `×${n}`))))
          : h('p', { class: 'empty' }, 'Your hold is empty. Buy goods here or pick up cargo floating in space.')),
    ];
  }

  // Research: the components in store, then the tree by group (rules/research.js). Each node shows what
  // it gives, what it costs (with how much of each you have) and whether it can be done now.
  function renderResearch() {
    const { lab } = ctx;
    const cats = Goods.categories('salvage');
    const grid = h('table', { class: 'components' },
      h('thead', {}, h('tr', {}, h('th', {}, ''), Goods.TIERS.slice(1).map((t) => h('th', { scope: 'col' }, t)))),
      h('tbody', {}, cats.map((cat) => h('tr', {},
        h('th', { scope: 'row' }, Goods.CATEGORIES[cat].label.replace(' components', '')),
        [1, 2, 3, 4, 5].map((tier) => {
          const n = lab.components[Goods.component(cat, tier)] || 0;
          return h('td', { class: n ? `has r${tier}` : '' }, n ? String(n) : '·');
        })))));
    const nameOf = (id) => Research.NODES[id].name;
    const node = (n) => {
      const st = lab.status(n.id);
      if (st.state === 'done') {
        return h('li', { class: 'node done' }, h('span', { class: 'what' }, h('span', { class: 'name' }, n.name),
          h('span', { class: 'detail' }, n.equipment ? 'Researched · buy it in the Ship tab' : `Researched · ${n.note}`)));
      }
      const costs = h('span', { class: 'costs' }, st.cost.map((c) => h('span', { class: `cost${c.have < c.need ? ' short' : ''}`, title: Goods.type(c.kind).name },
        itemIcon(c.kind, 18), `${c.have}/${c.need}`)));
      const action = st.state === 'locked'
        ? h('span', { class: 'held' }, `Needs ${st.needs.map(nameOf).join(', ')}`)
        : button('Research', () => lab.research(n.id), { disabled: !st.ok, aria: `Research ${n.name}` });
      return h('li', { class: `node ${st.state}` },
        h('span', { class: 'what' }, h('span', { class: 'name' }, n.name), h('span', { class: 'detail' }, n.note), costs),
        action);
    };
    return [
      h('section', { 'aria-label': 'Components' },
        h('h2', {}, 'Components', h('span', { class: 'count' }, 'salvaged from pirates and wrecks')),
        grid),
      ...Research.LINES.map((line) => h('section', { 'aria-label': line.label },
        h('h2', {}, line.label, h('span', { class: 'count' }, `${line.nodes.filter((n) => lab.researched.has(n.id)).length}/${line.nodes.length}`)),
        h('ul', { class: 'choices tree' }, line.nodes.map(node)))),
    ];
  }

  // A portrait (a face(ctx, size) drawer) in a canvas, sharp at the screen's pixel density.
  function portrait(face, size) {
    const c = h('canvas', { class: 'ms-face', 'aria-hidden': 'true', style: { width: `${size}px`, height: `${size}px` } });
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    c.width = Math.round(size * dpr);
    c.height = Math.round(size * dpr);
    const g = c.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    face(g, size);
    return c;
  }
  // A line with its **bold** runs (Intro.runs).
  const said = (text) => h('p', {}, Intro.runs(text).map((r) => (r.bold ? h('strong', {}, r.text) : r.text)));

  // Missions: each one shown here, with what its giver says (briefing, or the debrief once it's
  // done), its objectives ticked off as they're met, what it pays, and Accept or Complete.
  const MISSION_STATE = { offered: 'Offered', active: 'In progress', ready: 'Ready to hand in', done: 'Completed' };
  function missionCard(m) {
    const goals = m.status === 'done' ? [] : m.objectives.map((o) => h('li', { class: o.done ? 'done' : o.open ? 'open' : 'later' },
      h('span', { class: 'name' }, o.label),
      o.percent ? h('span', { class: 'held' }, `${o.count}%`) : o.need > 1 ? h('span', { class: 'held' }, `${o.count}/${o.need}`) : null));
    let action = null;
    if (m.status === 'offered' && m.here && m.accept) action = h('button', { class: 'btn ms-act', type: 'button', onclick: () => { m.accept(); refresh(); } }, 'Accept');
    else if (m.status === 'ready' && m.here && m.complete) action = h('button', { class: 'btn ms-act', type: 'button', onclick: () => { m.complete(); refresh(); } }, 'Complete mission');
    else if (m.status === 'ready') action = h('p', { class: 'note' }, `Hand it in at ${m.from}.`);
    return h('section', { class: `mission ${m.status}`, 'aria-label': m.title },
      h('h2', {}, m.title, h('span', { class: 'count' }, MISSION_STATE[m.status])),
      m.lines.length ? h('div', { class: 'ms-comms' },
        m.face ? portrait(m.face, 56) : null,
        h('div', { class: 'ms-lines' }, h('span', { class: 'ms-from' }, m.from), m.lines.map(said))) : null,
      goals.length ? [h('h3', { class: 'cat' }, 'Objectives'), h('ul', { class: 'ms-goals' }, goals)] : null,
      m.provided && m.status !== 'done' ? [h('h3', { class: 'cat' }, 'Provided'), h('p', { class: 'ms-detail' }, m.provided)] : null,
      h('h3', { class: 'cat' }, m.status === 'done' ? 'Paid' : 'Reward'), h('p', { class: 'ms-detail' }, m.reward),
      m.note ? h('p', { class: 'ms-note' }, m.note) : null,
      action);
  }
  function renderMissions() {
    const list = ctx.missions ? ctx.missions.list() : [];
    const { reason } = locks();
    return [
      reason ? h('p', { class: 'lead' }, reason) : null,
      ...(list.length ? list.map(missionCard) : [h('p', { class: 'empty' }, 'No missions posted here.')]),
    ];
  }

  // The squad: each member, its state, and its logic modules in the order they're checked.
  function renderSquad() {
    const members = ctx.squad ? ctx.squad.members : [];
    if (!members.length) return [h('p', { class: 'empty' }, 'No squad members yet.')];
    return [
      h('p', { class: 'lead' }, 'Squad members check their logic modules from the top down and carry out the first one whose condition holds. If none does, they keep formation with you.'),
      ...members.map((m) => {
        const st = Squad.stats(m), n = Squad.modulesOf(m).length;
        const state = m.disabled ? 'disabled' : `${Math.ceil(m.hullPoints)}/${st.hull} hull`;
        return h('section', { 'aria-label': m.name },
          h('h2', {}, m.name, h('span', { class: 'count' }, `android ${Loadout.HULLS[m.hull].name.toLowerCase()} · ${Loadout.MK[m.tier]} gear · ${state}`)),
          h('ul', { class: 'slots' }, m.modules.map((id, i) => h('li', { class: id ? 'slot' : 'slot empty' },
            h('span', { class: 'type' }, `Logic ${i + 1}`),
            h('span', { class: 'item' },
              h('span', { class: 'name' }, id ? Logic.label(id) : 'Empty'),
              h('span', { class: 'detail' }, id ? Logic.rule(id) : 'No module installed')),
            h('span', {})))),
          h('p', { class: 'empty' }, `${n} of ${Squad.SLOTS} logic slots in use.`));
      }),
    ];
  }

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
      t.title = locked ? lock.reason : '';
    }
    const launch = el('st-launch');
    launch.disabled = !!lock.launch;
    launch.title = lock.launch || '';
    if (lock.launch) el('st-hold').textContent = lock.launch;
    const scroll = body.scrollTop;
    body.replaceChildren(...RENDER[tab]().flat().filter(Boolean)); // optional parts are null when absent
    body.scrollTop = scroll;
  }

  for (const t of tabs) {
    t.addEventListener('click', () => { if (isLocked(t.dataset.tab)) return; tab = t.dataset.tab; body.scrollTop = 0; refresh(); });
    // Arrow keys move between the tabs that can be opened.
    t.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      let i = tabs.indexOf(t);
      for (let k = 0; k < tabs.length; k++) {
        i = (i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length;
        if (!isLocked(tabs[i].dataset.tab)) break;
      }
      tab = tabs[i].dataset.tab;
      refresh();
      tabs[i].focus();
    });
  }
  el('st-launch').addEventListener('click', () => ctx && !locks().launch && ctx.onLaunch());

  return {
    // options.tab: the tab to open on (Trade if not given, or the first that isn't locked).
    open(options) {
      ctx = options;
      tab = options.tab || 'trade';
      openSlot = null;
      root.hidden = false;
      body.scrollTop = 0;
      refresh();
      ((locks().launch && tabs.find((t) => t.dataset.tab === tab)) || el('st-launch')).focus({ preventScroll: true });
    },
    close() {
      ctx = null;
      root.hidden = true;
      body.replaceChildren();
    },
    get isOpen() { return !!ctx; },
    // Switch to a tab ('trade' | 'ship' | 'research' | 'squad' | 'missions') while open, unless
    // it's locked.
    showTab(name) { if (isLocked(name)) return; tab = name; openSlot = null; body.scrollTop = 0; refresh(); },
    get tab() { return tab; },
    refresh,
    // Show or hide the choices for a loadout slot on the Ship tab.
    toggleSlot(id) { openSlot = openSlot === id ? null : id; refresh(); },
  };
})();
