'use strict';

// The docked screen: station header, Trade / Ship / Missions tabs and a Launch button.
// StationMenu.open({ station: { name, subtitle, color }, market (Economy.market), hold, ship, onLaunch })
// hold: { credits, items, capacity, free, count(kind), buy(kind, price, label), sell(kind, price) }.
// Browser script (global `StationMenu`).

const StationMenu = (() => {
  const root = document.getElementById('station');
  const body = document.getElementById('st-body');
  const tabs = [...root.querySelectorAll('[role="tab"]')];
  const el = (id) => document.getElementById(id);

  const GOOD_NAME = Object.fromEntries(ArtItems.TRADE.map((k) => [k.id, k.form]));
  const SALVAGE_NAME = Object.fromEntries(ArtItems.LOOT.map((k) => [k.id, k.label]));
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

  function renderTrade() {
    const { market, hold } = ctx;
    const full = hold.free < 1;
    const goods = market.goods.map((g) => {
      const n = hold.count(g.kind);
      const name = GOOD_NAME[g.kind];
      const tag = g.produced ? h('span', { class: 'tag made' }, 'made here') : g.consumed ? h('span', { class: 'tag wanted' }, 'in demand') : null;
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
          h('span', { class: 'name' }, name, tag),
          h('span', { class: 'held' }, n ? `${n} in hold` : ''),
          // Against the usual price on the same side of the spread, so an ordinary good sits mid-track.
          gauge(g.buy ?? g.sell, Economy.GOODS[g.kind] * (1 + (g.buy === null ? -1 : 1) * Economy.config.spread))),
        h('div', { class: 'deal' }, buy, sell));
    });

    const salvageHeld = market.salvage.filter((s) => hold.count(s.kind) > 0);
    const sellAll = () => {
      for (const s of market.salvage) while (hold.count(s.kind) > 0) hold.sell(s.kind, s.sell);
      refresh();
    };
    const salvageTotal = salvageHeld.reduce((sum, s) => sum + s.sell * hold.count(s.kind), 0);
    const salvage = salvageHeld.length
      ? salvageHeld.map((s) => {
        const n = hold.count(s.kind);
        return h('li', { class: 'good' },
          h('div', { class: 'what' },
            h('span', { class: 'name' }, SALVAGE_NAME[s.kind]),
            h('span', { class: 'held' }, `${n} in hold`),
            gauge(s.sell, Economy.SALVAGE[s.kind] * (1 - Economy.config.spread))),
          h('div', { class: 'deal' }, h('button', {
            class: 'btn', type: 'button', 'aria-label': `Sell ${SALVAGE_NAME[s.kind]} for ${s.sell} credits`,
            onclick: () => { hold.sell(s.kind, s.sell); refresh(); },
          }, `Sell ${s.sell}`)));
      })
      : [h('li', { class: 'empty' }, 'No salvage aboard. Components recovered from wrecks sell here.')];

    return [
      full ? h('p', { class: 'note' }, 'Your hold is full. Sell cargo to make room.') : null,
      h('section', { 'aria-label': 'Trade goods' },
        h('h2', {}, 'Trade goods'),
        h('ul', { class: 'list' }, goods)),
      h('section', { 'aria-label': 'Salvage' },
        h('h2', {}, 'Salvage',
          salvageHeld.length ? h('button', { class: 'btn small', type: 'button', onclick: sellAll }, `Sell all ${salvageTotal}`) : null),
        h('ul', { class: 'list' }, salvage)),
    ];
  }

  function renderShip() {
    const { ship, hold } = ctx;
    const stat = (label, value) => h('div', { class: 'stat' }, h('dt', {}, label), h('dd', {}, value));
    const groups = new Map();
    for (const it of hold.items) groups.set(it.label, (groups.get(it.label) || 0) + 1);
    return [
      h('section', { 'aria-label': 'Ship' },
        h('h2', {}, ship.name),
        h('dl', { class: 'stats' },
          stat('Top speed', `${ship.maxSpeed}`),
          stat('Acceleration', `${ship.accel}`),
          stat('Turn rate', `${Math.round((ship.turnRate * 180) / Math.PI)}° per second`),
          stat('Cargo hold', `${ship.cargo} units`))),
      h('section', { 'aria-label': 'Loadout' },
        h('h2', {}, 'Loadout'),
        h('dl', { class: 'stats' },
          stat('Hull', 'Standard hull'),
          stat('Drive', 'Standard drive'),
          stat('Cargo bay', `${ship.cargo}-unit bay`))),
      h('section', { 'aria-label': 'Hold' },
        h('h2', {}, `Hold ${hold.items.length}/${hold.capacity}`),
        groups.size
          ? h('ul', { class: 'list compact' }, [...groups].map(([label, n]) => h('li', {}, h('span', {}, label), h('span', { class: 'held' }, `×${n}`))))
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
