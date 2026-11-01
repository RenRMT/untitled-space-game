// The idle game's bottom sheets, built from the game's UI kit (ui/kit.js: Kit.sheet, option rows,
// meters, choices; drawn in the Line style by ui/kit-line.css), one at a time:
// - a body's: uncharted, the survey that charts it; charted, its deposits and drills, its stock and
//   shuttle, the stations in orbit round it, and building the next station there,
// - a station's: its stock (sold here, at the market's price), its orders (each with where its inputs
//   come from, and a fix where one is missing; pause, priority, switching recipe) and a new one, its
//   shuttle; at the transport hub, its routes and a new one; at the waystation, today's contracts
//   first, and once researched which goods it auto-sells,
// - Survey: every body in the system, charted or not, and the survey under way,
// - Build: the stations to build, in order, what each costs, and where the next can go,
// - Chain: the production chains (Industry.pipelines), and what would mend them (IdleRules.fixes),
// - Lab: the package building and the queue, then every package by category, to research,
// - the survey's report (what was found), and the summary of time away.
// Each is rebuilt from the state when what it shows changes (compared as markup, so a tap is never
// lost to a refresh); the meters and the time left move every frame on their own (progress()). A
// button names what it does through act(name, args), which the page (main.js) carries out.
//
//   IdleSheets.create(layer, w, { act(name, args), onClose() }) -> sheets
//     sheets.show(view | null, state, now)   view: { kind: 'site' | 'station' | 'survey' | 'build' | 'chain' | 'lab' | 'report' | 'away',
//       key?, ... }; a station's may have switching: an order id (its recipes, to switch that order to)
//       and draft: { from, to, kinds } (a new route at the hub)
//     sheets.refresh(state, now)             rebuild if anything shown changed
//     sheets.progress(now)                   move the meters and the time left
//     sheets.view, sheets.top                what's open; the sheet's top edge on screen (px), or null
// ES module (`IdleSheets`); needs a browser.

import { ItemIcons } from '../art/icons.js';
import { Recipes } from '../rules/recipes.js';
import { Kit } from '../ui/kit.js';
import { UI } from '../ui/ui.js';
import { Config } from './config.js';
import { IdleRules } from './rules.js';

const IdleSheets = (() => {
  const { h } = UI;
  const I = IdleRules.industry;
  const nameOf = (kind) => Recipes.item(kind)?.name || kind;
  const counts = (o) => Object.entries(o).map(([k, n]) => `${n} ${nameOf(k)}`).join(' + ');
  const cr = (n) => `${Math.round(n).toLocaleString('en')} cr`;
  const secs = (s) => (s >= 3600 ? `${+(s / 3600).toFixed(1)} h` : s >= 60 ? `${Math.round(s / 60)} min` : `${Math.max(1, Math.round(s))} s`);
  const STATUS = { running: ['Running', 'var(--good)'], starved: ['Waiting for', 'var(--warn)'], blocked: ['Storage full', 'var(--warn)'], paused: ['Paused', 'var(--dim)'], done: ['Done', 'var(--dim)'] };
  const KIND = { field: 'Asteroid field', planet: 'Planet', moon: 'Moon' };
  const PLANET = { lava: 'Lava world', desert: 'Desert world', terran: 'Terran world', ice: 'Ice world', gas: 'Gas giant', blue: 'Ice giant' };
  const MOON = { grey: 'Grey moon', ice: 'Ice moon', rust: 'Rust moon', dark: 'Dark moon', sulfur: 'Sulfur moon' };
  const ORDINAL = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth'];
  const PROCESS_LABEL = { ...Object.fromEntries(Object.values(Recipes.BAYS).map((b) => [b.id, b.label])), extract: 'Drills', salvage: 'Wreck field' };
  // Where an order's input comes from (Industry.lineage's source).
  const SOURCE = { storage: 'in stock', order: 'made here', route: 'en route', away: 'not delivered', raw: 'not drilled', stage: 'no source' };
  const CAT_CODE = { ext: 'MIN', trade: 'TRD', 'ind.speed': 'BAY', 'ind.room': 'WHS', 'ind.recipes': 'RCP', 'ind.lab': 'LAB', log: 'TRD', 'mods.weapons': 'MOD', 'mods.systems': 'MOD' };
  const LAB_STATE = { done: ['Done', 'good'], active: ['Building', 'cyan'], queued: ['Queued', 'cyan'], locked: ['Locked', 'dim'], closed: ['Closed', 'dim'] };
  const buildOfType = (type) => Config.BUILDS.find((b) => b.type === type) || null;

  // An item's icon: a good's own art in the Line style (art/icons.js); gear its slot's line icon, a
  // consumable its own, as the game's station screen shows them. Its name is beside it.
  const SLOT_CODE = { weapon: 'WPN', shield: 'SHD', computer: 'CPU', engine: 'ENG', scanner: 'SCN', utility: 'UTL' };
  function itemIcon(kind, size = 32) {
    const it = Recipes.item(kind);
    if (it && it.kind === 'mod') return Kit.icon('MOD', size, { code: 'MOD' });
    if (it && (it.kind === 'gear' || it.kind === 'consumable')) { const code = it.code || SLOT_CODE[it.slot] || 'PKG'; return Kit.icon(code, size, { code, tier: it.tier }); }
    return h('img', { class: 'icon', src: ItemIcons.url(kind, 'line', size), alt: '', 'aria-hidden': 'true', width: size, height: size, draggable: 'false' });
  }
  // A meter the frame loop fills (progress()): data-from / data-to are the run's times.
  const runMeter = (from, to, color) => {
    const m = Kit.meter(0, { thin: true, color });
    if (from != null && to != null) { m.firstChild.dataset.from = from; m.firstChild.dataset.to = to; }
    return m;
  };
  const left = (to) => h('span', { class: 'num', 'data-left': to });

  function create(layer, w, { act, onClose }) {
    let view = null, sheet = null, last = '', shownId = '', nowAt = 0;
    const go = (name, args = {}) => () => act(name, args);
    const kindLine = (s) => (s.kind === 'planet' ? PLANET[s.body.type] || 'Planet' : s.kind === 'moon' ? MOON[s.body.type] || 'Moon' : KIND[s.kind]);
    const where = (s) => (s.kind === 'moon' ? `round ${w.byKey.get(s.parent).name}` : `the ${ORDINAL[s.ring] || `${s.ring + 1}th`} orbit`);

    // ---------- Pieces ----------

    function stockBlock(state, key, now, sellHere) {
      const stock = I.stockAt(state.industry, key), e = IdleRules.env(state);
      const cap = I.capacity(state.industry, e, now, key), used = I.used(state.industry, key);
      // At the waystation, once researched: auto-sell each good, or not.
      const auto = key === w.waystation.key && IdleRules.canAuto(state);
      const rows = Object.entries(stock).filter(([, n]) => n > 0).sort(([a], [b]) => nameOf(a).localeCompare(nameOf(b))).map(([kind, n]) => {
        const p = sellHere ? IdleRules.priceOf(state, w, key, kind, now) : null;
        const on = state.autoSell.includes(kind);
        const action = p != null ? h('span', { class: 'idle-acts' },
          Kit.button('Sell', go('sell', { key, kind, n: 1 }), { price: p }),
          Kit.button('All', go('sell', { key, kind, n }), { kind: 'ghost' })) : null;
        const extra = auto && p != null ? [Kit.button(on ? 'Auto-sell: on' : 'Auto-sell: off', go('auto', { kind, on: !on }), { kind: on ? 'good' : 'ghost', aria: `Auto-sell ${nameOf(kind)}` })] : undefined;
        return Kit.optionRow({ icon: itemIcon(kind), name: nameOf(kind), tag: on ? 'Auto' : undefined, tagTone: 'good', sub: `${n} here`, action, extra });
      });
      return [
        Kit.head('Stock', h('span', { class: 'aside' }, `${used} / ${cap}`)),
        Kit.meter(used / Math.max(1, cap), { color: used >= cap ? 'var(--warn)' : undefined }),
        rows.length ? rows : h('p', { class: 'ui-empty' }, 'Empty.'),
      ];
    }

    const placeName = (key) => w.byKey.get(key)?.name || key;
    const FIX_VERB = { route: 'Route', shuttle: 'Shuttle', order: 'Order', build: 'Build' };
    function fixText(f) {
      if (f.kind === 'route') return `Route ${nameOf(f.good).toLowerCase()} to ${placeName(f.to)}`;
      if (f.kind === 'shuttle') return `Shuttle ${placeName(f.from)} to ${placeName(f.to)}`;
      if (f.kind === 'order') return `Make ${nameOf(f.good).toLowerCase()} at ${placeName(f.key)}`;
      const b = buildOfType(f.type);
      return b ? `Build the ${b.name.toLowerCase()}` : `Nothing here makes ${nameOf(f.good).toLowerCase()}`;
    }
    const fixButton = (f) => Kit.button(FIX_VERB[f.kind], go('fix', { fix: f }), { kind: f.kind === 'build' ? 'ghost' : 'primary', disabled: f.kind === 'build' && !f.type, title: fixText(f), aria: fixText(f) });
    // The fix for an input of an order at a station, if the chain has one.
    const fixFor = (fixes, key, kind) => fixes.find((f) => f.good === kind && (f.kind === 'route' || f.kind === 'shuttle' ? f.to === key : f.for === key)) || null;

    function orderRow(state, o, extra, fixes = []) {
      const R = Config.RECIPES[o.recipe], st = I.status(state.industry, o), [label, tone] = STATUS[st.id];
      const what = st.missing ? `${label} ${nameOf(st.missing)}` : label;
      const out = Object.keys(R.out)[0], drill = R.bay === 'extract';
      const lines = [];
      if (!drill) {
        // Where each input comes from, and the fix for one that isn't coming.
        for (const x of IdleRules.lineage(state, w, o.id)) {
          const fix = x.source === 'storage' || x.source === 'order' || x.source === 'route' ? null : fixFor(fixes, o.station, x.kind);
          lines.push(h('div', { class: 'idle-in' },
            h('span', { class: 'sub' }, `${nameOf(x.kind)} ${Math.min(x.have, x.need)}/${x.need} · ${fix ? fixText(fix) : SOURCE[x.source]}`),
            fix ? fixButton(fix) : null));
        }
      }
      const mine = state.industry.orders.filter((x) => x.station === o.station), first = mine[0] === o;
      const action = drill ? null : Kit.button('✕', go('cancel', { id: o.id }), { kind: 'ghost', aria: 'Cancel this order', title: 'Cancel' });
      const controls = drill ? null : h('span', { class: 'idle-acts idle-ctl' },
        Kit.button(o.paused ? 'Resume' : 'Pause', go('pause', { id: o.id, paused: !o.paused }), { kind: 'ghost' }),
        Kit.button('Switch', go('view', { switching: o.id }), { kind: 'ghost', aria: 'Switch recipe' }),
        first ? null : Kit.button('▲ First', go('raise', { id: o.id }), { kind: 'ghost', aria: 'Move up: gets inputs first' }));
      return Kit.optionRow({
        icon: itemIcon(out), name: counts(R.out), tag: what, tagTone: tone.replace(/^var\(--|\)$/g, ''),
        sub: `${Object.keys(R.in).length ? `from ${counts(R.in)} · ` : ''}${secs(I.runTime(o, IdleRules.env(state), nowAt) / 1000)} a run · ${o.made} made`,
        extra: [runMeter(o.at, o.next), ...lines, controls, extra || null],
        action,
      });
    }

    function shuttleBlock(state, key) {
      const r = I.shuttle(state.industry, key), to = r ? r.stops[1].station : null;
      const opts = w.stations.filter((s) => s.key !== key && IdleRules.online(state, w, s.key));
      if (!opts.length) return [];
      return [
        Kit.head('Shuttle to', h('span', { class: 'aside' }, r ? `${r.cap} a trip` : 'none')),
        Kit.choices(opts.map((s) => ({ id: s.key, label: s.name, on: s.key === to })), (id) => act('shuttle', { from: key, to: id }), { label: 'Shuttle to' }),
      ];
    }

    // The stations round a body, and the next one to build there if it has room.
    function orbitBlock(state, key) {
      const here = w.stations.filter((st) => IdleRules.hostOf(state, st.key) === key);
      const b = IdleRules.berths(state, w, key), next = IdleRules.nextBuild(state);
      const rows = here.map((st) => Kit.optionRow({
        code: Config.BUILDS.find((x) => x.type === st.type).code, name: st.name, sub: Config.BUILDS.find((x) => x.type === st.type).name,
        action: Kit.button('Open', go('open', { kind: 'station', key: st.key }), { kind: 'ghost' }),
      }));
      const out = [Kit.head('In orbit', h('span', { class: 'aside' }, `${b.used} / ${b.total} berths`)), ...rows];
      if (!rows.length && !(next && b.free)) out.push(h('p', { class: 'ui-empty' }, 'No stations here.'));
      if (next && b.free) {
        const s = IdleRules.buildStatus(state, w, next.id);
        out.push(Kit.optionRow({
          code: next.code, name: `Build the ${next.name.toLowerCase()} here`, current: s.id === 'ready', locked: s.id !== 'ready', lockLabel: null,
          sub: costLine(state, next), action: Kit.button('Build', go('build', { id: next.id, site: key }), { kind: s.id === 'ready' ? 'primary' : '', disabled: s.id !== 'ready', price: next.credits || undefined }),
        }));
      }
      return out;
    }

    function costLine(state, b) {
      const stock = IdleRules.online(state, w, w.waystation.key) ? I.stockAt(state.industry, w.waystation.key) : {};
      const parts = Object.entries(b.goods).map(([k, n]) => `${Math.min(stock[k] || 0, n)}/${n} ${nameOf(k)}`);
      parts.push(b.credits ? cr(b.credits) : 'free');
      return parts.join(' · ');
    }

    // ---------- Sheets ----------

    function site(state, key, now) {
      const s = w.byKey.get(key), charted = IdleRules.charted(state, key);
      if (!charted) {
        const sv = state.survey, mine = sv && sv.key === key, cost = IdleRules.surveyCost(state), time = IdleRules.surveyTime(state, w, key);
        const body = [];
        let foot;
        if (mine) foot = [h('div', { class: 'idle-row' }, h('span', { class: 'ui-label' }, 'Surveying'), left(sv.end)), runMeter(sv.at, sv.end)];
        else if (sv) foot = [h('p', { class: 'ui-note' }, `Surveying ${w.byKey.get(sv.key).name}.`), Kit.button('Survey', go('survey', { key }), { kind: 'primary', lg: true, wide: true, disabled: true })];
        else foot = [Kit.button(`Survey · ${secs(time / 1000)}`, go('survey', { key }), { kind: 'primary', lg: true, wide: true, price: cost, disabled: state.credits < cost })];
        return { title: 'Uncharted', kicker: 'Signal', sub: s.kind === 'moon' ? `A moon of ${w.byKey.get(s.parent).name}` : `${KIND[s.kind]} · ${where(s)}`, code: 'SCN', body, foot };
      }
      const body = [];
      if (state.finds[key]) body.push(Kit.callout(`Derelict salvaged: ${cr(state.finds[key])}`));
      // Deposits: drill for each, at the next drill's price.
      const cost = IdleRules.drillCost(state, s), way = IdleRules.online(state, w, w.waystation.key);
      body.push(Kit.head('Deposits'));
      if (!way) body.push(h('p', { class: 'ui-note' }, 'Build the waystation first.'));
      for (const g of s.goods) {
        body.push(Kit.optionRow({
          icon: itemIcon(g), name: nameOf(g), sub: `${secs(Config.RECIPES[`extract.${g}`].time)} / unit`,
          action: Kit.button(cost ? 'Drill' : 'Drill · free', go('drill', { key, good: g }), { kind: 'primary', price: cost || undefined, disabled: !way || state.credits < cost }),
        }));
      }
      const drills = I.at(state.industry, key);
      if (drills.length) {
        body.push(Kit.head('Drills', h('span', { class: 'aside' }, `${drills.length}`)));
        for (const o of drills) {
          const pick = s.goods.length > 1 ? Kit.choices(s.goods.map((g) => ({ id: g, label: nameOf(g), on: o.recipe === `extract.${g}` })), (g) => act('drill-set', { id: o.id, good: g }), { label: 'Drill for' }) : null;
          body.push(orderRow(state, o, pick));
        }
        body.push(...stockBlock(state, key, now, false));
        body.push(...shuttleBlock(state, key));
      }
      body.push(...orbitBlock(state, key));
      const sub = s.kind === 'moon' ? `Moon of ${w.byKey.get(s.parent).name}` : `${kindLine(s) === KIND.field ? '' : `${KIND[s.kind]} · `}${where(s)}`;
      return { title: s.name, kicker: kindLine(s), sub: sub.charAt(0).toUpperCase() + sub.slice(1), code: s.kind === 'field' ? 'ORE' : 'MIN', body };
    }

    function station(state, key, now) {
      const st = w.byKey.get(key), b = Config.BUILDS.find((x) => x.type === st.type), host = w.byKey.get(IdleRules.hostOf(state, key));
      const procs = I.processes(st.type).map((p) => PROCESS_LABEL[p]).join(', ') || (st.type === 'transport hub' ? 'Routes' : 'Market');
      const body = st === w.waystation ? contractsBlock(state, now) : [];
      body.push(...stockBlock(state, key, now, true));
      const orders = I.at(state.industry, key), slots = IdleRules.env(state).slotsAt(key), fixes = IdleRules.fixes(state, w);
      const switching = orders.find((o) => o.id === view.switching) || null;
      if (I.processes(st.type).length) {
        body.push(Kit.head('Orders', h('span', { class: 'aside' }, `${orders.length} / ${slots}`)));
        for (const o of orders) body.push(orderRow(state, o, null, fixes));
        if (switching || orders.length < slots) {
          body.push(Kit.head(switching ? `Switch: ${counts(Config.RECIPES[switching.recipe].out)} to` : 'New order',
            switching ? Kit.button('Keep it', go('view', { switching: null }), { kind: 'ghost' }) : null));
          for (const R of IdleRules.recipesAt(state, w, key)) {
            if (switching && R.id === switching.recipe) continue;
            const out = Object.keys(R.out)[0], it = Recipes.item(out);
            body.push(Kit.optionRow({
              icon: itemIcon(out), name: counts(R.out), tier: it?.kind === 'gear' ? it.tier : undefined,
              sub: `${Object.keys(R.in).length ? `from ${counts(R.in)} · ` : ''}${secs(R.time)} a run`,
              action: switching ? Kit.button('Switch', go('change', { id: switching.id, recipe: R.id })) : Kit.button('Order', go('place', { key, recipe: R.id })),
            }));
          }
          const later = Object.values(Config.RECIPES).filter((R) => R.unlock && I.canMake(st.type, R.id) && !IdleRules.known(state).has(R.id)).length;
          if (later) body.push(h('p', { class: 'ui-note' }, `${later} more in the lab`));
        }
      }
      if (st.type === 'transport hub') body.push(...routesBlock(state));
      if (st !== w.waystation) body.push(...shuttleBlock(state, key));
      return { title: st.name, kicker: b.name, sub: `${procs} · round ${host ? host.name : '—'}`, code: b.code, body };
    }

    // Today's contracts, delivered from the waystation's stock.
    function contractsBlock(state, now) {
      const list = IdleRules.contracts(state), stock = I.stockAt(state.industry, w.waystation.key);
      const ends = (Math.floor(now / 86400e3) + 1) * 86400e3;
      const out = [Kit.head('Contracts', h('span', { class: 'aside' }, list.length ? left(ends) : ''))];
      if (!list.length) out.push(h('p', { class: 'ui-empty' }, 'None today.'));
      for (const c of list) {
        const it = Recipes.item(c.kind), have = stock[c.kind] || 0, pay = IdleRules.contractPay(state, c);
        out.push(Kit.optionRow({
          icon: itemIcon(c.kind), name: `${c.n} ${nameOf(c.kind)}`, tier: it?.kind === 'gear' ? it.tier : undefined,
          tag: c.done ? 'Delivered' : undefined, tagTone: 'good', locked: c.done, lockLabel: null,
          sub: `${c.from} · ${c.done ? cr(pay) : `${Math.min(have, c.n)}/${c.n} in stock`}`,
          action: c.done ? null : Kit.button('Deliver', go('deliver', { id: c.id }), { kind: 'primary', price: pay, disabled: !IdleRules.canDeliver(state, w, c.id) }),
        }));
      }
      return out;
    }

    // The transport hub's routes, and a new one: from where, to where, carrying what.
    function routesBlock(state) {
      const list = IdleRules.routes(state), limit = IdleRules.routeLimit(state);
      const out = [Kit.head('Routes', h('span', { class: 'aside' }, `${list.length} / ${limit}`))];
      for (const r of list) {
        out.push(Kit.optionRow({
          code: 'TRD', name: r.name, sub: `${IdleRules.carries(r).map(nameOf).join(', ')} · ${r.haulers.length} hauler${r.haulers.length === 1 ? '' : 's'} of ${r.cap}`,
          action: Kit.button('✕', go('route-remove', { id: r.id }), { kind: 'ghost', aria: 'Stop this route', title: 'Stop' }),
        }));
      }
      if (!list.length) out.push(h('p', { class: 'ui-empty' }, 'No routes.'));
      const d = view.draft || {};
      const places = [...w.stations, ...w.sites].filter((x) => IdleRules.online(state, w, x.key) && (x.kind === 'station' || state.drills[x.key]));
      out.push(Kit.head('New route'));
      if (list.length >= limit && !(d.from && d.to && list.some((r) => r.stops[0].station === d.from && r.stops[1].station === d.to))) {
        out.push(h('p', { class: 'ui-note' }, 'Route limit reached.'));
      }
      out.push(h('span', { class: 'ui-label' }, 'From'), Kit.choices(places.map((x) => ({ id: x.key, label: x.name, on: x.key === d.from })), (id) => act('view', { draft: { from: id, to: d.to === id ? null : d.to, kinds: [] } }), { label: 'From' }));
      if (d.from) {
        const made = new Set([...I.at(state.industry, d.from).flatMap((o) => Object.keys(Config.RECIPES[o.recipe].out)), ...Object.keys(I.stockAt(state.industry, d.from))]);
        const kinds = d.kinds || [];
        out.push(h('span', { class: 'ui-label' }, 'To'), Kit.choices(w.stations.filter((x) => x.key !== d.from && IdleRules.online(state, w, x.key)).map((x) => ({ id: x.key, label: x.name, on: x.key === d.to })), (id) => act('view', { draft: { ...d, to: id } }), { label: 'To' }));
        out.push(h('span', { class: 'ui-label' }, 'Carrying'));
        if (made.size) out.push(Kit.choices([...made].map((k) => ({ id: k, label: nameOf(k), on: kinds.includes(k) })), (k) => act('view', { draft: { ...d, kinds: kinds.includes(k) ? kinds.filter((x) => x !== k) : [...kinds, k] } }), { label: 'Carrying' }));
        else out.push(h('p', { class: 'ui-empty' }, 'Nothing there.'));
        out.push(Kit.button('Start route', go('route-add', { from: d.from, to: d.to, kinds }), { kind: 'primary', wide: true, disabled: !d.to || !kinds.length }));
      }
      return out;
    }

    function chain(state) {
      const groups = I.pipelines(state.industry), fixes = IdleRules.fixes(state, w), orders = state.industry.orders;
      const by = (id) => orders.find((o) => o.id === id);
      const body = [];
      if (fixes.length) {
        body.push(Kit.head('Fixes', h('span', { class: 'aside' }, `${fixes.length}`)));
        for (const f of fixes) {
          const why = f.kind === 'route' || f.kind === 'shuttle'
            ? `${nameOf(f.good)} is made at ${placeName(f.from)}, used at ${placeName(f.to)}`
            : `${placeName(f.for)} needs ${nameOf(f.good).toLowerCase()}`;
          body.push(Kit.optionRow({ icon: itemIcon(f.good), name: why, sub: fixText(f), action: fixButton(f) }));
        }
      }
      if (!orders.length) body.push(h('p', { class: 'ui-empty' }, 'No orders.'));
      const linked = groups.filter((g) => !g.standalone), alone = groups.filter((g) => g.standalone);
      linked.forEach((g, i) => {
        body.push(Kit.head(g.end.length ? `Makes ${g.end.map(nameOf).join(', ')}` : `Chain ${i + 1}`, h('span', { class: 'aside' }, `${g.orders.length} orders`)));
        for (const o of g.orders) {
          const R = Config.RECIPES[o.recipe], st = I.status(state.industry, o), [label, tone] = STATUS[st.id];
          const into = g.links.filter((l) => l.to === o.id).map((l) => `${nameOf(l.kind)} from ${by(l.from).name}${l.away ? (l.routed ? ' (carried)' : ' (not carried)') : ''}`);
          body.push(Kit.optionRow({
            icon: itemIcon(Object.keys(R.out)[0]), name: `${counts(R.out)}`, tag: st.missing ? `${label} ${nameOf(st.missing)}` : label, tagTone: tone.replace(/^var\(--|\)$/g, ''),
            sub: `${o.name}${into.length ? ` · ${into.join(' · ')}` : ''}`, extra: [runMeter(o.at, o.next)],
            action: Kit.button('Open', go('open', { key: o.station }), { kind: 'ghost' }),
          }));
        }
      });
      if (alone.length) {
        body.push(Kit.head('Standalone', h('span', { class: 'aside' }, `${alone.length}`)));
        for (const g of alone) {
          const o = g.orders[0], R = Config.RECIPES[o.recipe], st = I.status(state.industry, o), [label, tone] = STATUS[st.id];
          body.push(Kit.optionRow({
            icon: itemIcon(Object.keys(R.out)[0]), name: counts(R.out), tag: st.missing ? `${label} ${nameOf(st.missing)}` : label, tagTone: tone.replace(/^var\(--|\)$/g, ''), sub: o.name,
            action: Kit.button('Open', go('open', { key: o.station }), { kind: 'ghost' }),
          }));
        }
      }
      return { title: 'Chain', kicker: w.galaxy.name, sub: `${orders.length} orders${fixes.length ? ` · ${fixes.length} to fix` : ''}`, code: 'RCP', body, tall: true };
    }

    function labCost(state, st) {
      const parts = st.cost.map((c) => `${Math.min(c.have, c.need)}/${c.need} ${nameOf(c.kind)}`);
      if (st.credits) parts.push(cr(st.credits));
      return parts.join(' · ');
    }
    function catCode(p) {
      if (CAT_CODE[p.cat]) return CAT_CODE[p.cat];
      const it = p.gear && Recipes.item(p.gear);
      return (it && (SLOT_CODE[it.slot] || 'PKG')) || 'PKG';
    }
    function labSheet(state) {
      const L = IdleRules.lab, l = state.lab, P = Config.PACKAGES;
      const body = [];
      body.push(Kit.head('Building', h('span', { class: 'aside' }, `${L.pending(l).length} / ${1 + Config.LAB_QUEUE + IdleRules.bonusAt(state, Infinity, 'queue')}`)));
      if (l.active) {
        const p = P[l.active.id];
        body.push(Kit.optionRow({
          code: catCode(p), name: p.name, tier: p.tier, sub: p.note, extra: [h('div', { class: 'idle-row' }, runMeter(l.active.start, l.active.end), left(l.active.end))],
          action: Kit.button('✕', go('research-cancel', { id: p.id }), { kind: 'ghost', aria: 'Cancel (50% refund)', title: 'Cancel (50% refund)' }),
        }));
      } else body.push(h('p', { class: 'ui-empty' }, 'Idle.'));
      for (const id of l.queue) {
        const p = P[id];
        body.push(Kit.optionRow({ code: catCode(p), name: p.name, tier: p.tier, tag: 'Queued', tagTone: 'cyan', sub: `${secs(L.timeOf(id) / 1000)}`, action: Kit.button('✕', go('research-cancel', { id }), { kind: 'ghost', aria: 'Cancel (full refund)', title: 'Cancel (full refund)' }) }));
      }
      for (const cat of Config.CATEGORIES) {
        const list = Object.values(P).filter((p) => p.cat === cat.id);
        const done = list.filter((p) => l.done.includes(p.id)).length;
        const label = cat.label === 'Mods' ? (cat.id === 'mods.weapons' ? 'Weapon mods' : 'System mods') : cat.label;
        body.push(Kit.head(label, h('span', { class: 'aside' }, `${done} / ${list.length}`)));
        const builder = buildOfType(cat.station);
        if (!state.built.some((id) => Config.BUILDS.find((b) => b.id === id)?.type === cat.station)) {
          body.push(h('p', { class: 'ui-empty' }, `Needs the ${builder ? builder.name.toLowerCase() : cat.station}.`));
          continue;
        }
        for (const p of list) {
          if (l.done.includes(p.id)) continue;
          const st = IdleRules.researchStatus(state, w, p.id);
          if (st.state === 'active' || st.state === 'queued') continue;
          const [tag, tone] = LAB_STATE[st.state] || [null, null];
          const needs = st.needs?.length ? `needs ${st.needs.map((r) => P[[r].flat()[0]]?.name || r).join(', ')} · ` : '';
          body.push(Kit.optionRow({
            code: catCode(p), name: p.name, tier: p.tier, tag, tagTone: tone, locked: st.state === 'locked' || st.state === 'closed', lockLabel: null,
            sub: `${needs}${labCost(state, st)} · ${secs(L.timeOf(p.id) / 1000)}`,
            extra: [h('span', { class: 'sub' }, p.note)],
            action: st.state === 'available' ? Kit.button(l.active ? 'Queue' : 'Research', go('research', { id: p.id }), { kind: st.ok ? 'primary' : '', disabled: !st.ok }) : null,
          }));
        }
      }
      return { title: 'Lab', kicker: w.galaxy.name, sub: `${l.done.length} of ${Object.keys(P).length} researched`, code: 'LAB', body, tall: true };
    }

    function surveyList(state, now) {
      const sv = state.survey, cost = IdleRules.surveyCost(state);
      const body = [];
      if (sv) {
        const s = w.byKey.get(sv.key);
        body.push(Kit.head('Under way'), Kit.optionRow({
          code: 'SCN', name: s.kind === 'moon' ? `A moon of ${w.byKey.get(s.parent).name}` : `Signal on ${where(s)}`, sub: 'Surveying', extra: [runMeter(sv.at, sv.end)],
          action: h('span', { class: 'idle-left' }, left(sv.end)),
        }));
      }
      const order = [...w.sites].sort((a, b) => ((a.ring ?? w.byKey.get(a.parent).ring + 0.5) - (b.ring ?? w.byKey.get(b.parent).ring + 0.5)));
      const open = order.filter((s) => IdleRules.surveyable(state, w, s.key) && (!sv || sv.key !== s.key));
      if (open.length) {
        body.push(Kit.head('Uncharted', h('span', { class: 'aside' }, `${open.length}`)));
        for (const s of open) {
          body.push(Kit.optionRow({
            code: 'SCN', name: s.kind === 'moon' ? `A moon of ${w.byKey.get(s.parent).name}` : `Signal on ${where(s)}`,
            sub: `${secs(IdleRules.surveyTime(state, w, s.key) / 1000)} to survey`,
            action: Kit.button('Survey', go('survey', { key: s.key, open: true }), { price: cost, disabled: !!sv || state.credits < cost }),
          }));
        }
      }
      const done = order.filter((s) => IdleRules.charted(state, s.key));
      body.push(Kit.head('Charted', h('span', { class: 'aside' }, `${done.length} / ${w.sites.length}`)));
      for (const s of done) {
        body.push(Kit.optionRow({
          code: s.kind === 'field' ? 'ORE' : 'MIN', name: s.name, sub: `${kindLine(s)} · ${s.goods.map(nameOf).join(', ')}`,
          action: Kit.button('Open', go('open', { kind: 'site', key: s.key }), { kind: 'ghost' }),
        }));
      }
      return { title: 'Survey', kicker: w.galaxy.name, sub: `${done.length} of ${w.sites.length} bodies charted`, code: 'SCN', body, tall: true };
    }

    function buildList(state) {
      const next = IdleRules.nextBuild(state);
      const body = [];
      for (const b of Config.BUILDS) {
        const s = IdleRules.buildStatus(state, w, b.id), st = IdleRules.stationOf(w, b.id);
        if (s.id === 'done') {
          const host = w.byKey.get(IdleRules.hostOf(state, st.key));
          body.push(Kit.optionRow({ code: b.code, name: b.name, tag: 'Built', tagTone: 'good', sub: `${st.name} · round ${host?.name || '—'}`, action: Kit.button('Open', go('open', { kind: 'station', key: st.key }), { kind: 'ghost' }) }));
          continue;
        }
        const isNext = b === next;
        body.push(Kit.optionRow({
          code: b.code, name: b.name, tag: isNext ? (s.id === 'ready' ? 'Ready' : 'Short') : 'Later', tagTone: isNext ? (s.id === 'ready' ? 'good' : 'warn') : null,
          sub: costLine(state, b), locked: !isNext, lockLabel: null, current: isNext && s.id === 'ready',
        }));
        if (isNext) {
          const hosts = w.sites.filter((x) => IdleRules.charted(state, x.key) && IdleRules.berths(state, w, x.key).free);
          body.push(h('p', { class: 'ui-note' }, b.note));
          body.push(Kit.head('Build at'));
          if (!hosts.length) body.push(h('p', { class: 'ui-empty' }, 'No free berths. Survey another body.'));
          for (const x of hosts) {
            const bb = IdleRules.berths(state, w, x.key);
            body.push(Kit.optionRow({
              code: x.kind === 'field' ? 'ORE' : 'MIN', name: x.name, sub: `${kindLine(x)} · ${x.goods.map(nameOf).join(', ')} · ${bb.free} free`,
              action: Kit.button('Build', go('build', { id: b.id, site: x.key }), { kind: s.id === 'ready' ? 'primary' : '', disabled: s.id !== 'ready' }),
            }));
          }
        }
      }
      const built = state.built.length;
      return { title: 'Build', kicker: w.galaxy.name, sub: `${built} of ${Config.BUILDS.length} stations built`, code: 'IND', body, tall: true };
    }

    function report(v) {
      const s = w.byKey.get(v.key);
      const body = [
        Kit.head('Deposits'),
        ...s.goods.map((g) => Kit.optionRow({ icon: itemIcon(g), name: nameOf(g), sub: `${secs(Config.RECIPES[`extract.${g}`].time)} / unit` })),
      ];
      if (v.find) body.push(Kit.callout(`Derelict salvaged: ${cr(v.find)}`, 'var(--good)'));
      if (s.kind === 'planet' && s.body.moons.length) body.push(h('p', { class: 'ui-note' }, `${s.body.moons.length === 1 ? '1 moon' : `${s.body.moons.length} moons`} to survey.`));
      return { title: s.name, kicker: 'Survey complete', kickerColor: 'var(--good)', sub: `${kindLine(s)} · ${where(s)}`, code: 'SCN', body, foot: [Kit.button('Open', go('open', { kind: 'site', key: v.key }), { kind: 'primary', lg: true, wide: true })] };
    }

    function away(a) {
      const lines = (m) => [...m.entries()].map(([id, n]) => { const [name, kind] = id.split('|'); return Kit.optionRow({ icon: itemIcon(kind), name: `${n} ${nameOf(kind)}`, sub: name }); });
      const body = [
        Kit.head('Made'), ...(a.made.size ? lines(a.made) : [h('p', { class: 'ui-empty' }, 'Nothing.')]),
        Kit.head('Delivered'), ...(a.delivered.size ? lines(a.delivered) : [h('p', { class: 'ui-empty' }, 'Nothing.')]),
      ];
      const sold = Object.entries(a.sold || {});
      if (sold.length) body.push(Kit.head('Auto-sold', h('span', { class: 'aside' }, cr(sold.reduce((n, [, x]) => n + x.credits, 0)))), ...sold.map(([kind, x]) => Kit.optionRow({ icon: itemIcon(kind), name: `${x.n} ${nameOf(kind)}`, sub: cr(x.credits) })));
      if (a.researched?.length) body.push(Kit.head('Researched'), ...a.researched.map((id) => { const p = Config.PACKAGES[id]; return Kit.optionRow({ code: catCode(p), name: p.name, tier: p.tier, sub: p.note }); }));
      if (a.charted.length) body.push(Kit.head('Charted'), ...a.charted.map((c) => Kit.optionRow({ code: 'SCN', name: w.byKey.get(c.key).name, sub: c.find ? `found ${cr(c.find)}` : kindLine(w.byKey.get(c.key)), action: Kit.button('Open', go('open', { kind: 'site', key: c.key }), { kind: 'ghost' }) })));
      if (a.stuck.length) body.push(Kit.head('Stopped'), ...a.stuck.map((x) => Kit.optionRow({ code: 'LCK', name: x.name, tag: x.why, tagTone: 'warn', action: Kit.button('Open', go('open', { kind: IdleRules.isSite(x.key) ? 'site' : 'station', key: x.key }), { kind: 'ghost' }) })));
      return { title: 'While you were away', sub: secs(a.ms / 1000), code: 'QUE', body, foot: [Kit.button('Continue', go('close'), { kind: 'primary', lg: true, wide: true })] };
    }

    // ---------- Showing ----------

    function build(state, now) {
      nowAt = now;
      if (!view) return null;
      if (view.kind === 'site') return site(state, view.key, now);
      if (view.kind === 'station') return station(state, view.key, now);
      if (view.kind === 'survey') return surveyList(state, now);
      if (view.kind === 'build') return buildList(state, now);
      if (view.kind === 'chain') return chain(state, now);
      if (view.kind === 'lab') return labSheet(state, now);
      if (view.kind === 'report') return report(view);
      if (view.kind === 'away') return away(view.away);
      return null;
    }
    const markup = (o) => [o.title, o.sub, o.kicker, ...[o.body, o.foot].flat(Infinity).filter(Boolean).map((n) => n.outerHTML)].join('|');
    function refresh(state, now) {
      const o = build(state, now);
      if (!o) { if (sheet) { const s = sheet; sheet = null; s.close(true); } last = ''; return; }
      const m = markup(o);
      if (sheet && sheet.isOpen && m === last) { progress(now); return; }
      last = m;
      const opts = { ...o, host: layer, onClose: () => { sheet = null; view = null; last = ''; onClose(); } };
      // The same view again: new contents, kept where it was scrolled to; another view: a new sheet.
      const id = `${view.kind}|${view.key || ''}`;
      if (sheet && sheet.isOpen && id === shownId) sheet.update(opts);
      else sheet = Kit.sheet(opts);
      shownId = id;
      progress(now);
    }
    function progress(now) {
      if (!sheet) return;
      for (const el of layer.querySelectorAll('[data-to]')) {
        const a = +el.dataset.from, b = +el.dataset.to;
        el.style.setProperty('--pct', `${Math.min(100, Math.max(0, ((now - a) / Math.max(1, b - a)) * 100))}%`);
      }
      for (const el of layer.querySelectorAll('[data-left]')) {
        const text = `${secs(Math.max(0, (+el.dataset.left - now) / 1000))} left`;
        if (el.textContent !== text) el.textContent = text;
      }
    }
    function show(v, state, now) {
      view = v;
      last = '';
      if (sheet && sheet.isOpen && !v) { const s = sheet; sheet = null; s.close(true); }
      refresh(state, now);
    }

    return {
      show, refresh, progress,
      get view() { return view; },
      get top() { const p = layer.querySelector('.ui-sheet'); return p ? p.getBoundingClientRect().top : null; },
    };
  }

  return { create };
})();

export { IdleSheets };
