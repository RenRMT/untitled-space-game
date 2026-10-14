'use strict';

// The docked screen: station header, Trade / Ship / Missions tabs and a Launch button.
// StationMenu.open({ station: { name, subtitle, color }, market (Economy.market), hold, ship, loadout, onLaunch })
// hold: { credits, items, capacity, free, count(kind), buy(kind, price, label), sell(kind, price) }.
// ship: Loadout.stats(loadout); loadout: the ship's class and fitted equipment (loadout.js).
// repairs: { hull, max, price, cost, repair() }: hull damage from combat and fixing it for credits.
// Browser script (global `StationMenu`).

const StationMenu = (() => {
  const root = document.getElementById('station');
  const body = document.getElementById('st-body');
  const tabs = [...root.querySelectorAll('[role="tab"]')];
  const el = (id) => document.getElementById(id);

  // The price gauge spans this range of the base price (see economy.js factors and jitter).
  const GAUGE = [0.55, 1.6];

  let ctx = null; // the open() options while docked
  let tab = 'trade';

  // Small DOM helper: h('div', { class: 'row' }, child, 'text', ...). Text is always set as text.
  function h(tag, attrs = {}, ...children) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v === false || v === null || v === undefined) continue;
      if (k === 'class') n.className = v;
      else if (k === 'style') Object.assign(n.style, v);
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? '' : v);
    }
    for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) n.append(c.nodeType ? c : String(c));
    return n;
  }
  const credits = (n) => `${n.toLocaleString('en-US')} cr`;

  function renderHeader() {
    el('st-name').textContent = ctx.station.name;
    el('st-sub').textContent = ctx.station.subtitle;
    el('st-credits').textContent = credits(ctx.hold.credits);
    root.style.setProperty('--faction', ctx.station.color);
    el('st-hold').textContent = `Hold ${ctx.hold.items.length}/${ctx.hold.capacity}`;
  }

  // Where a price sits between cheap and dear, as a marker on a slim track.
  function gauge(price, base) {
    const k = Math.max(0, Math.min(1, (price / base - GAUGE[0]) / (GAUGE[1] - GAUGE[0])));
    const tone = price / base < 0.88 ? 'cheap' : price / base > 1.12 ? 'dear' : '';
    return h('span', { class: 'gauge', 'aria-hidden': 'true' }, h('span', { class: `mark ${tone}`, style: { left: `${k * 100}%` } }));
  }

  // An item type's colour swatch, name and rarity (goods.js), for list rows.
  function itemName(kind) {
    const t = Goods.type(kind);
    const [hue, sat, light] = t.color;
    return [
      h('span', { class: 'swatch', 'aria-hidden': 'true', style: { background: `hsl(${hue} ${sat * 100}% ${light * 100}%)` } }),
      t.name,
      t.rarity > 1 ? h('span', { class: `rarity r${t.rarity}` }, Goods.RARITY[t.rarity].label) : null,
    ];
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
      h('div', { class: 'what' },
        h('span', { class: 'name' }, itemName(g.kind)),
        h('span', { class: 'held' }, n ? `${n} in hold` : ''),
        // Against the usual price on the same side of the spread, so an ordinary price sits mid-track.
        gauge(g.buy ?? g.sell, Economy.basePrice(g.kind) * (1 + (g.buy === null ? -1 : 1) * Economy.config.spread))),
      h('div', { class: 'deal' }, buy, sell));
  }

  // Trade: what this station stocks, by category; anything else you're carrying, with what it
  // fetches here; and salvage.
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

    const salvageHeld = market.salvage.filter((s) => hold.count(s.kind) > 0);
    const sellAll = () => {
      for (const s of market.salvage) while (hold.count(s.kind) > 0) hold.sell(s.kind, s.sell);
      refresh();
    };
    const salvageTotal = salvageHeld.reduce((sum, s) => sum + s.sell * hold.count(s.kind), 0);
    const salvage = salvageHeld.length
      ? salvageHeld.map((s) => {
        const n = hold.count(s.kind);
        const name = Goods.type(s.kind).name;
        return h('li', { class: 'good' },
          h('div', { class: 'what' },
            h('span', { class: 'name' }, itemName(s.kind)),
            h('span', { class: 'held' }, `${n} in hold`),
            gauge(s.sell, Economy.basePrice(s.kind) * (1 - Economy.config.spread))),
          h('div', { class: 'deal' }, h('button', {
            class: 'btn', type: 'button', 'aria-label': `Sell ${name} for ${s.sell} credits`,
            onclick: () => { hold.sell(s.kind, s.sell); refresh(); },
          }, `Sell ${s.sell}`)));
      })
      : [h('li', { class: 'empty' }, 'No salvage aboard. Components recovered from wrecks sell here.')];

    return [
      full ? h('p', { class: 'note' }, 'Your hold is full. Sell cargo to make room.') : null,
      h('section', { 'aria-label': 'For sale here' },
        h('h2', {}, 'For sale here'),
        groups.length ? groups : h('p', { class: 'empty' }, 'Nothing for sale here.')),
      carried.length ? h('section', { 'aria-label': 'Also in your hold' },
        h('h2', {}, 'Also in your hold', h('span', { class: 'count' }, 'not sold here')),
        h('ul', { class: 'list' }, carried.map((g) => goodRow(g, full)))) : null,
      h('section', { 'aria-label': 'Salvage' },
        h('h2', {}, 'Salvage',
          salvageHeld.length ? h('button', { class: 'btn small', type: 'button', onclick: sellAll }, `Sell all ${salvageTotal}`) : null),
        h('ul', { class: 'list' }, salvage)),
    ];
  }

  // One equipment slot: what kind it is, what's fitted and what that does.
  function slotRow(s) {
    return h('li', { class: s.item ? 'slot' : 'slot empty' },
      h('span', { class: 'type' }, s.label),
      h('span', { class: 'item' },
        h('span', { class: 'name' }, s.item ? s.item.name : 'Empty'),
        h('span', { class: 'detail' }, s.item ? Loadout.summary(s.item) : s.type === 'weapon' ? 'Open hardpoint' : 'Nothing fitted')));
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
    const { ship, hold, loadout } = ctx;
    const stat = (label, value) => h('div', { class: 'stat' }, h('dt', {}, label), h('dd', {}, value));
    const slots = Loadout.slots(loadout);
    const sectors = (n) => `${n} sector${n === 1 ? '' : 's'}`;
    const groups = new Map(); // item type -> count
    for (const it of hold.items) groups.set(it.kind, (groups.get(it.kind) || 0) + 1);
    return [
      ctx.repairs ? renderHull() : null,
      h('section', { 'aria-label': 'Loadout' },
        h('h2', {}, ship.name, h('span', { class: 'count' }, `${slots.filter((s) => s.item).length}/${slots.length} slots fitted`)),
        h('ul', { class: 'slots' }, slots.map(slotRow))),
      h('section', { 'aria-label': 'Performance' },
        h('h2', {}, 'Performance'),
        h('dl', { class: 'stats' },
          stat('Top speed', `${ship.maxSpeed}`),
          stat('Acceleration', `${ship.accel}`),
          stat('Turn rate', `${Math.round((ship.turnRate * 180) / Math.PI)}° per second`),
          stat('Sensors', `${sectors(ship.sensorRange)} · pings ${sectors(ship.pingRange)}`),
          stat('Mining', ship.miningRate ? `${(Mining.config.duration / ship.miningRate).toFixed(1)} s per asteroid` : 'No ship computer'),
          stat('Shield', ship.shield ? `${ship.shield} · ${ship.shieldRecharge}/s recharge` : 'None'),
          stat('Firepower', `${ship.firepower} damage/s · ${ship.weaponsFitted} of ${ship.weaponSlots} weapons`),
          stat('Targeting', `${Math.round(ship.accuracy * 100)}% accuracy · ${Math.round(ship.evasion * 100)}% evasion`),
          stat('Cargo hold', `${ship.cargo} units`))),
      h('section', { 'aria-label': 'Hold' },
        h('h2', {}, `Hold ${hold.items.length}/${hold.capacity}`),
        groups.size
          ? h('ul', { class: 'list compact' }, [...groups].map(([kind, n]) => h('li', {}, h('span', { class: 'name' }, itemName(kind)), h('span', { class: 'held' }, `×${n}`))))
          : h('p', { class: 'empty' }, 'Your hold is empty. Buy goods here or pick up cargo floating in space.')),
    ];
  }

  function renderMissions() {
    return [h('section', { 'aria-label': 'Missions' },
      h('h2', {}, 'Missions'),
      h('p', { class: 'empty' }, 'No contracts posted here yet.'))];
  }

  function refresh() {
    if (!ctx) return;
    renderHeader();
    for (const t of tabs) {
      const on = t.dataset.tab === tab;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
    }
    const scroll = body.scrollTop;
    const parts = tab === 'trade' ? renderTrade() : tab === 'ship' ? renderShip() : renderMissions();
    body.replaceChildren(...parts.filter(Boolean)); // optional parts are null when absent
    body.scrollTop = scroll;
  }

  for (const t of tabs) {
    t.addEventListener('click', () => { tab = t.dataset.tab; body.scrollTop = 0; refresh(); });
    // Arrow keys move between tabs.
    t.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      const i = (tabs.indexOf(t) + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length;
      tab = tabs[i].dataset.tab;
      refresh();
      tabs[i].focus();
    });
  }
  el('st-launch').addEventListener('click', () => ctx && ctx.onLaunch());

  return {
    open(options) {
      ctx = options;
      tab = 'trade';
      root.hidden = false;
      body.scrollTop = 0;
      refresh();
      el('st-launch').focus({ preventScroll: true });
    },
    close() {
      ctx = null;
      root.hidden = true;
      body.replaceChildren();
    },
    get isOpen() { return !!ctx; },
  };
})();
