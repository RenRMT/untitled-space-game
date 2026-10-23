// The station screen's Production tab (ui/station.js), drawn as a production line: the process this
// station works (Ore works, Volatiles works, Recycler, Fabricator, Bench or Shipyard) and its orders, one at a time (with more than one,
// the Ship tab's switcher steps through them and a free order), each a status line and a flow
// of nodes (its inputs, wired by whether the station's stock has them, into the stage, then what it
// makes); this station's stock and the hold as tiles, a tile opening its detail (what uses it, Take
// or Store); and the production pipeline: every order in the galaxy, linked by what one makes and
// another uses, in three columns (refining, parts, assembly), with the gaps no order fills.
// The stage node opens the order's sheet: what to make, how many runs. An input node opens its
// lineage: what it is made from, and whether to make it here.
//
//   IndustryView.create(env) -> { render(), sheet(open), tick(), reset() }
//     env: { ctx() (the station's open() options; ctx.industry: game/industry.js), refresh(), act(fn, after),
//            section(label, ...children), lead(text), explain(key, text), fold(key, label, content),
//            itemIcon(kind, size), switcher({ label, names, at, step }) (the Ship tab's), showTab(name),
//            showOrder(open), setOrder(changes), closeSheet() }
//     sheet(open): the options for a Kit.sheet, open being
//       { mode: 'new' | 'edit', id?, recipe, count (null: while inputs last) }: an order here, to place or change
//       { mode: 'view', id }: an order anywhere, to pause, cancel, reorder or mark on the map
//       { mode: 'input', id, kind, need }: an input of an order here, and its lineage
// ES module (`IndustryView`); needs a browser.

import { Goods } from '../rules/goods.js';
import { Industry } from '../rules/industry.js';
import { Recipes } from '../rules/recipes.js';
import { Kit } from './kit.js';
import { UI } from './ui.js';

const IndustryView = {
  create(env) {
    const { h } = UI;
    const STATUS = {
      running: { word: 'Running', tone: 'var(--cyan)' },
      starved: { word: 'Starved', tone: 'var(--warn)' },
      blocked: { word: 'Blocked', tone: 'var(--hostile)' },
      done: { word: 'Done', tone: 'var(--good)' },
      paused: { word: 'Paused', tone: 'var(--dim)' },
      idle: { word: 'Idle', tone: 'var(--dim)' },
    };
    const COUNTS = [1, 5, 20, 100, null]; // runs to choose from; null: as long as inputs last
    const COLUMNS = ['refine', 'parts', 'assemble']; // by Recipes.BAYS step
    const COLUMN_LABEL = { refine: 'Refining', parts: 'Parts', assemble: 'Assembly' };
    const column = (bay) => Math.max(0, COLUMNS.indexOf(Recipes.BAYS[bay]?.step));
    const ROW = 84; // px per row of the pipeline's columns
    // The edge colour of a tile in storage: how far along the chain it is.
    const STAGE_TONE = { raw: 'var(--dim)', salvage: 'var(--t5)', refined: 'var(--t2)', advanced: 'var(--t2)', part: 'var(--t3)', item: 'var(--t4)' };
    // An input's wire into the stage: in stock here, made by another order here, made at another
    // station (to be carried here), missing.
    const WIRE = { ok: '1.5px solid rgba(182, 255, 138, 0.55)', flow: '1.5px solid rgba(125, 249, 255, 0.6)', away: '1.5px dashed rgba(125, 249, 255, 0.6)', miss: '1.5px dashed var(--warn)' };
    const MARK_TONE = { ok: 'var(--good)', flow: 'var(--cyan)', away: 'var(--cyan)', miss: 'var(--warn)' };
    let live = []; // running orders' meters and notes (see tick)
    let openStored = null; // the stored good whose tile is open
    let openAboard = null; // the good aboard whose tile is open
    const FREE = 'free';
    let viewing = null; // the order shown (orderViews), with more than one here

    const ind = () => env.ctx().industry;
    const state = () => ind().state;
    const stockOf = (key) => Industry.stockAt(state(), key);
    const name = (kind) => Recipes.item(kind).name;
    const SLOT_CODE = { weapon: 'WPN', shield: 'SHD', computer: 'CPU', engine: 'ENG', scanner: 'SCN' };
    // A thing's icon: a good's art, or for gear its slot's code.
    const iconOf = (kind, size) => {
      const it = Recipes.item(kind);
      if (it.kind === 'mod') return Kit.icon('MOD', size, { code: 'MOD' });
      if (it.kind === 'consumable') return Kit.icon(it.code, size, { code: it.code });
      return it.kind === 'gear' ? Kit.icon(SLOT_CODE[it.slot], size, { code: SLOT_CODE[it.slot], tier: it.tier }) : env.itemIcon(kind, size);
    };
    const list = (counts) => Object.entries(counts).map(([k, n]) => (n > 1 ? `${n} ${name(k)}` : name(k))).join(' + ');
    const recipeText = (R) => `${list(R.in)} → ${list(R.out)}`;
    const recipeName = (R) => Object.keys(R.out).map(name).join(' + ');
    const find = (id) => state().orders.find((o) => o.id === id) || null;
    const where = (o) => { const sys = ind().system(o.station); return sys ? `${o.name} · ${sys}` : o.name; };
    function duration(ms) {
      const sec = Math.max(0, Math.ceil(ms / 1000));
      if (sec < 60) return `${sec}s`;
      const m = Math.ceil(sec / 60), hrs = Math.floor(m / 60);
      return hrs ? `${hrs}h${m % 60 ? ` ${m % 60}m` : ''}` : `${m}m`;
    }
    const progress = (o, now) => Math.max(0, Math.min(1, (now - o.at) / Math.max(1, o.next - o.at)));
    // Runs the order was set for (null: while inputs last); the run under way is counted in.
    const runsOf = (o) => (o.left === null ? null : o.made + o.left + (o.next != null ? 1 : 0));
    const made = (o) => (o.left === null ? `${o.made} made · while inputs last` : `${o.made} of ${runsOf(o)} made`);
    function statusLine(o) {
      const st = Industry.status(state(), o);
      const text = {
        running: o.paused ? 'pausing after this run' : made(o),
        starved: st.missing ? `no ${name(st.missing)} in stock here` : '',
        blocked: 'the stock here is full',
        done: made(o),
        paused: made(o),
      }[st.id];
      return { st, S: STATUS[st.id], text };
    }
    // The change sheet for an order: its recipe, and its runs as first set (a count picked from COUNTS).
    const editing = (o) => ({ mode: 'edit', id: o.id, recipe: o.recipe, count: o.left === null ? null : COUNTS.find((n) => n !== null && n >= runsOf(o)) || 100 });
    const stationsFor = (bay) => `an order at ${Industry.STATIONS[bay]}`;
    const makers = (kind, but) => state().orders.filter((x) => x !== but && kind in Recipes.RECIPES[x.recipe].out);
    // An input as the flow shows it: ✓ in stock at the order's station, ⟳ made by another order
    // there, ⇢ made at another station (to be carried), ✗ missing.
    function supply(kind, need, o) {
      const have = stockOf(o.station)[kind] || 0, by = makers(kind, o);
      const cls = have >= need ? 'ok' : by.some((m) => m.station === o.station) ? 'flow' : by.length ? 'away' : 'miss';
      return { have, by, cls, mark: cls === 'ok' ? `✓ ${have}` : `${{ flow: '⟳', away: '⇢', miss: '✗' }[cls]} ${have}/${need}` };
    }

    // ---------- The production line ----------

    // The wires from a row of n nodes into one point (or, flipped, out of one point into n), as
    // absolutely placed segments, in % of the width so they follow the nodes at any width. Each
    // node's wire runs down from its centre, across, and into the stage beside the others.
    function wires(n, styles, { out = false, labels } = {}) {
      const segs = [];
      const at = (x, y, w, ht, stroke, edge) => segs.push(h('i', { style: { left: x, top: `${y}px`, width: w, height: `${ht}px`, [edge]: stroke } }));
      for (let i = 0; i < n; i++) {
        const stroke = styles[i], cx = (i + 0.5) / n * 100, off = n === 1 ? 0 : (i - (n - 1) / 2) * 24;
        const tx = `calc(50% + ${off}px)`, top = out ? 20 : 0, low = out ? 0 : 20;
        if (n === 1 || (Math.abs(cx - 50) < 0.01 && off === 0)) { at('50%', 0, '0', 40, stroke, 'borderLeft'); }
        else {
          at(`${cx}%`, top, '0', 20, stroke, 'borderLeft');
          at(tx, low, '0', 20, stroke, 'borderLeft');
          at(cx < 50 ? `${cx}%` : tx, 20, cx < 50 ? `calc(50% + ${off}px - ${cx}%)` : `calc(${cx}% - 50% - ${off}px)`, 0, stroke, 'borderTop');
        }
        if (labels?.[i]) segs.push(h('span', { class: 'q num', style: { left: `calc(${cx}% + 6px)`, color: labels[i].tone } }, labels[i].text));
      }
      return h('div', { class: `pr-wires${out ? ' out' : ''}`, 'aria-hidden': 'true' }, segs);
    }

    // One order as a line: inputs → the stage → what it makes. here: an order at this station (its
    // nodes open sheets); elsewhere it is only drawn.
    function line(o, here) {
      const R = Recipes.RECIPES[o.recipe], B = Recipes.BAYS[R.bay], { st, S } = statusLine(o), now = ind().now();
      const ins = Object.entries(R.in), outs = Object.entries(R.out), many = ins.length > 3;
      const sup = ins.map(([k, n]) => ({ kind: k, need: n, ...supply(k, n, o) }));
      // Input nodes, three to a row; more than three share one wire, each node saying how many it needs.
      const width = [0, 132, 128, 108][Math.min(3, ins.length)];
      const inNode = (x) => {
        const label = `${name(x.kind)}: ${x.have} in stock, needs ${x.need}${x.by.length ? `, made at ${x.by.map((m) => m.name).join(', ')}` : ''}`;
        const inner = [many && x.need > 1 ? h('span', { class: 'qn num' }, `×${x.need}`) : null, iconOf(x.kind, 32), h('span', { class: 'nm' }, name(x.kind)),
          h('span', { class: 'have num', style: { color: MARK_TONE[x.cls] } }, x.mark)];
        const attrs = { class: `pr-node in ${x.cls}`, 'aria-label': label, title: label };
        return here ? h('button', { ...attrs, type: 'button', onclick: () => env.showOrder({ mode: 'input', id: o.id, kind: x.kind, need: x.need }) }, inner) : h('div', attrs, inner);
      };
      const worst = ['miss', 'away', 'flow'].find((c) => sup.some((x) => x.cls === c)) || 'ok';
      // The stage: its run count, a note, and a meter for the order as a whole.
      const runs = runsOf(o), p = st.id === 'running' ? progress(o, now) : 0;
      const whole = st.id === 'done' ? 1 : runs === null ? p : (o.made + p) / Math.max(1, runs);
      const note = {
        running: () => `${Math.round(p * 100)}% · ${duration(o.next - now)} left`,
        starved: () => (st.missing ? `${name(st.missing)} missing` : 'Inputs missing'),
        blocked: () => 'No room in the stock',
        done: () => 'Order complete',
        paused: () => 'Paused',
      }[st.id]();
      const bar = h('span', { class: 'bar' }, h('span', { style: { width: `${whole * 100}%`, background: S.tone } }));
      const noteEl = h('span', { class: 'note' }, note);
      if (st.id === 'running') live.push({ id: o.id, bar: bar.firstChild, note: noteEl });
      const stageInner = [
        h('span', { class: 'top' }, Kit.icon(B.code, 22, { code: B.code }), h('span', { class: 'lbl' }, B.label),
          h('span', { class: 'runs num' }, runs === null ? `${o.made} · ∞` : `${o.made}/${runs}`)),
        noteEl, bar,
      ];
      const stage = here
        ? h('button', { class: 'pr-stage', type: 'button', onclick: () => env.showOrder(editing(o)), 'aria-label': `${B.label} order: ${recipeName(R)}, ${S.word}. Change it` }, stageInner)
        : h('div', { class: 'pr-stage' }, stageInner);
      // What it makes, and how many of it are in the station's stock.
      const outTone = st.id === 'done' ? 'var(--good)' : st.id === 'running' ? 'var(--cyan)' : 'var(--line-strong)';
      const outLine = `1.5px ${st.id === 'starved' || st.id === 'blocked' ? 'dashed' : 'solid'} ${outTone}`;
      const outNode = ([k, n]) => {
        const inner = [iconOf(k, 36), h('span', { class: 'nm' }, n > 1 ? `${n} ${name(k)}` : name(k)), h('span', { class: 'have num' }, `${stockOf(o.station)[k] || 0} in stock`)];
        const attrs = { class: 'pr-node out', style: { '--edge': outTone }, 'aria-label': `Makes ${n > 1 ? `${n} ` : ''}${name(k)} a run: ${stockOf(o.station)[k] || 0} in stock` };
        return here ? h('button', { ...attrs, type: 'button', onclick: () => env.showOrder(editing(o)) }, inner) : h('div', attrs, inner);
      };
      return h('div', { class: `pr-line ${st.id}`, role: 'group', 'aria-label': `Production line: ${list(R.in)} into ${list(R.out)}` },
        h('div', { class: `pr-ins${many ? ' many' : ''}`, style: { '--n': Math.min(3, ins.length), '--w': `${width}px` } }, sup.map(inNode)),
        many ? wires(1, [WIRE[worst]])
          : wires(ins.length, sup.map((x) => WIRE[x.cls]), { labels: sup.map((x) => ({ text: `×${x.need}`, tone: MARK_TONE[x.cls] })) }),
        stage,
        wires(outs.length, outs.map(() => outLine), { out: true }),
        h('div', { class: 'pr-outs', style: { '--n': outs.length, '--edge': outTone } }, outs.map(outNode)));
    }

    // The status line above a line: its status, what it means, and Change.
    function status(o) {
      const { S, text } = statusLine(o), R = Recipes.RECIPES[o.recipe];
      return h('div', { class: 'pr-status' }, Kit.tag(S.word, S.tone), h('span', { class: 'txt' }, text),
        Kit.button('Change', () => env.showOrder(editing(o)), { kind: 'ghost', aria: `Change the order for ${recipeName(R)}` }));
    }

    function ordersHere() {
      const here = ind().here, B = Recipes.BAYS[ind().bays()[0]];
      if (!ind().online()) {
        return env.section('Orders here', h('div', { class: 'pr-board' }, h('div', { class: 'pr-empty locked' }, Kit.icon(B?.code || 'IND', 28, { code: B?.code || 'IND' }),
          h('span', { class: 'go' }, 'Offline'), h('span', {}, `Restore ${here.name} at the waystation`))));
      }
      if (!B) return env.section('Orders here', h('p', { class: 'ui-empty' }, 'This station takes no production orders.'));
      const orders = ind().orders(), max = ind().slots();
      const title = h('div', { class: 'pr-title' }, h('h2', { class: 'ui-title' }, B.label),
        h('span', { class: 'aside num' }, ind().trusted() ? `${orders.length}/${max} orders` : 'Locked'));
      const explain = env.explain('production', 'Production orders make goods from this station\'s stock in real time, even while you\'re away. Each station works one process of the chain and keeps its own stock: what one order makes goes to the next by your hold.');
      if (!ind().trusted()) {
        return env.section('Orders here', title, explain,
          h('div', { class: 'pr-board' }, h('div', { class: 'pr-empty locked' }, Kit.icon(B.code, 28, { code: B.code }),
            h('span', { class: 'go' }, 'Orders locked'), h('span', {}, `Complete a mission for ${here.name} first`))));
      }
      // One order at a time, as the Ship tab shows one ship: with more than one order here (or one
      // and room for another), the switcher above steps through them, a free order last.
      const views = orderViews(), at = views.indexOf(viewedOrder());
      const o = find(views[at]);
      const fresh = () => env.showOrder({ mode: 'new', recipe: null, count: 1 });
      const nameOf = (id) => (id === FREE ? 'New order' : recipeName(Recipes.RECIPES[find(id).recipe]));
      const free = Math.max(0, max - orders.length);
      return [
        views.length > 1 ? env.switcher({ label: 'Orders', names: views.map(nameOf), at, step: (dir) => showOrderAt(views[(at + dir + views.length) % views.length]) }) : null,
        env.section('Orders here', title, explain,
          o ? h('div', { class: 'pr-order' }, status(o), h('div', { class: 'pr-board' }, line(o, true))) : [
            h('div', { class: 'pr-status' }, Kit.tag(STATUS.idle.word, STATUS.idle.tone),
              h('span', { class: 'txt' }, orders.length ? `${free} order${free === 1 ? '' : 's'} free here` : 'No order placed'),
              Kit.button('New order', fresh, { kind: 'ghost', aria: 'Place a new order' })),
            h('div', { class: 'pr-board' }, h('button', { class: 'pr-empty', type: 'button', onclick: fresh },
              Kit.icon(B.code, 28, { code: B.code }), h('span', { class: 'go' }, '+ New order'), h('span', {}, orders.length ? 'A free order' : `${B.label} is idle`))),
          ]),
      ];
    }

    // Which order the Production tab shows: an order here (its id), or FREE (room for a new one).
    // Each order here, then FREE while there is room; the one shown falls back to the first when
    // its order is gone.
    function orderViews() {
      const orders = ind().orders();
      return [...orders.map((o) => o.id), ...(orders.length < ind().slots() ? [FREE] : [])];
    }
    function viewedOrder() {
      const views = orderViews();
      if (!views.includes(viewing)) viewing = views[0] ?? FREE;
      return viewing;
    }
    function showOrderAt(id) {
      if (id === viewing) return;
      viewing = id;
      env.refresh();
    }
    // After placing an order, show it.
    function showNewest() {
      const orders = ind().orders();
      if (orders.length) viewing = orders[orders.length - 1].id;
    }

    // ---------- Storage and hold ----------

    const tagOf = (kind) => { const t = Recipes.item(kind); return { gear: 'gear', mod: 'mod', consumable: 'kit' }[t.kind] || t.stage; };
    const toneOf = (kind) => STAGE_TONE[Recipes.item(kind).stage] || 'var(--line-strong)';
    // What uses a good: the recipes that take it, by the stage that makes each.
    function usedIn(kind) {
      const by = new Map();
      for (const R of Recipes.consumers(kind)) {
        if (!by.has(R.bay)) by.set(R.bay, []);
        by.get(R.bay).push(recipeName(R));
      }
      return by.size ? `Used in ${[...by].map(([bay, names]) => `${[...new Set(names)].join(', ')} · ${Recipes.BAYS[bay].label}`).join('; ')}`
        : 'No recipe uses it: it\'s an end product';
    }
    // Goods as tiles; the one open shows its name, stage, a line about it and one action.
    function tiles(counts, openId, onToggle, detail) {
      const kinds = Object.keys(counts);
      const open = kinds.includes(openId) ? openId : null;
      return [
        h('div', { class: 'pr-tiles' }, kinds.map((k) => h('button', {
          class: 'ui-tile pr-tile', type: 'button', 'aria-expanded': String(k === open), 'aria-label': `${name(k)}, ${counts[k]}`, title: name(k),
          style: { '--tier': toneOf(k) }, onclick: () => onToggle(k === open ? null : k),
        }, iconOf(k, 32), h('span', { class: 'n' }, `×${counts[k]}`)))),
        open ? h('div', { class: 'pr-detail', 'aria-live': 'polite' },
          h('span', { class: 'main' },
            h('span', { class: 'line' }, h('span', { class: 'nm' }, name(open)), Kit.tag(tagOf(open), toneOf(open))),
            h('span', { class: 'sub' }, detail(open).text)),
          detail(open).action) : null,
      ];
    }
    // This station's stock.
    function storage() {
      const s = state(), e = ind().env(), now = ind().now(), key = ind().here.key, stock = stockOf(key);
      const cap = Industry.capacity(s, e, now), used = Industry.used(s, key), held = Industry.reserved(s, key);
      const order = (k) => [...Goods.STAGES, 'item'].indexOf(Recipes.item(k).stage);
      const kinds = Object.keys(stock).filter((k) => stock[k] > 0).sort((a, b) => order(a) - order(b));
      const counts = Object.fromEntries(kinds.map((k) => [k, stock[k]]));
      return env.section('Stock here',
        Kit.head('Stock here', Kit.meter((used + held) / cap, { thin: true }), h('span', { class: 'aside num' }, `${used + held}/${cap}`)),
        kinds.length ? tiles(counts, openStored, (k) => { openStored = k; env.refresh(); }, (k) => ({
          text: `${stock[k]} in stock · ${usedIn(k)}`,
          action: Kit.button('Take', env.act(() => ind().withdraw(k)), {
            disabled: Recipes.item(k).kind === 'good' && env.ctx().hold.free < 1, aria: `Take ${name(k)} out of the stock`,
            title: Recipes.item(k).kind === 'good' && env.ctx().hold.free < 1 ? 'Your hold is full' : undefined,
          }),
        })) : h('p', { class: 'ui-empty' }, 'Empty. Store goods from your hold below.'),
        env.explain('storage', 'Each station keeps its own stock: what an order makes here stays here until you take it away in your hold.'),
        held ? h('p', { class: 'ui-note' }, `${held} kept free for runs under way.`) : null);
    }
    function aboard() {
      const { hold } = env.ctx(), counts = {};
      for (const it of hold.items) counts[it.kind] = (counts[it.kind] || 0) + 1;
      const comps = env.ctx().lab.components;
      for (const k of Object.keys(comps)) if (comps[k] > 0 && Recipes.consumers(k).length) counts[k] = comps[k];
      const free = ind().free();
      const kinds = Object.keys(counts);
      return env.section('Aboard',
        Kit.head('Aboard', kinds.length ? Kit.button('Store all', env.act(() => { for (const k of kinds) ind().deposit(k); }), { kind: 'ghost', disabled: free < 1 }) : null),
        kinds.length ? tiles(counts, openAboard, (k) => { openAboard = k; env.refresh(); }, (k) => ({
          text: `${counts[k]} aboard · ${usedIn(k)}`,
          action: Kit.button('Store', env.act(() => ind().deposit(k)), { disabled: free < 1, aria: `Store ${name(k)}`, title: free < 1 ? 'The stock here is full' : undefined }),
        })) : h('p', { class: 'ui-empty' }, 'Nothing aboard to store. Mine, salvage or buy goods.'));
    }

    // ---------- The production pipeline ----------

    // One node: the station and system, the recipe and its status, and its place in line for inputs.
    function node(o, feeds) {
      const R = Recipes.RECIPES[o.recipe], B = Recipes.BAYS[R.bay], { S } = statusLine(o);
      const i = state().orders.indexOf(o), n = state().orders.length;
      return h('div', { class: 'pr-pnode', style: { '--tone': S.tone } },
        h('button', { class: 'main', type: 'button', onclick: () => env.showOrder({ mode: 'view', id: o.id }), 'aria-label': `${recipeName(R)} at ${o.name}: ${S.word}` },
          h('span', { class: 'where' }, Kit.icon(B.code, 14, { code: B.code }), h('span', {}, where(o))),
          h('span', { class: 'what' }, `${Object.keys(R.in).map(name).join(' + ')} → ${recipeName(R)}`),
          h('span', { class: 'st' }, S.word)),
        h('span', { class: 'prio' },
          h('span', { class: 'num' }, `#${i + 1}`),
          i > 0 ? h('button', { type: 'button', class: 'ar', onclick: env.act(() => ind().move(i, i - 1)), 'aria-label': `Move ${recipeName(R)} up: it goes first for inputs` }, '↑') : null,
          i < n - 1 ? h('button', { type: 'button', class: 'ar', onclick: env.act(() => ind().move(i, i + 1)), 'aria-label': `Move ${recipeName(R)} down` }, '↓') : null),
        feeds.length ? h('span', { class: 'pr-feeds' }, feeds.map((f) => h('span', {}, f))) : null);
    }
    const gapNode = (g) => h('div', { class: 'pr-pnode gap' },
      h('span', { class: 'main' },
        h('span', { class: 'where' }, `No order makes ${name(g.kind)}`),
        h('span', { class: 'what' }, g.stage ? `Needs ${stationsFor(g.stage)}` : 'Buy it, or find it'),
        h('span', { class: 'pr-feeds' }, h('span', {}, `→ needed by ${g.to.map((id) => find(id)?.name).join(', ')}`))));

    function graph(g) {
      const cols = COLUMNS.map(() => []);
      for (const o of g.orders) cols[column(Recipes.RECIPES[o.recipe].bay)].push({ id: o.id, o });
      const gaps = new Map();
      for (const x of g.gaps) {
        if (!gaps.has(x.kind)) gaps.set(x.kind, { kind: x.kind, stage: x.stage, to: [] });
        gaps.get(x.kind).to.push(x.order);
      }
      for (const x of gaps.values()) cols[column(x.stage)].push({ id: `gap:${x.kind}`, gap: x });
      const at = new Map();
      cols.forEach((c, ci) => c.forEach((x, ri) => at.set(x.id, { c: ci, r: ri })));
      const rows = Math.max(...cols.map((c) => c.length));
      const links = [...g.links.map((l) => ({ ...l, dim: !stockOf(find(l.from).station)[l.kind] && !stockOf(find(l.to).station)[l.kind] })),
        ...[...gaps.values()].flatMap((x) => x.to.map((to) => ({ from: `gap:${x.kind}`, to, kind: x.kind, gap: true })))];
      // The lines: x in hundredths of a column (cells keep 4% clear each side), y in px.
      const path = (l) => {
        const a = at.get(l.from), b = at.get(l.to), y1 = a.r * ROW + ROW / 2, y2 = b.r * ROW + ROW / 2;
        if (a.c === b.c) { const x = a.c * 100 + 96; return `M${x} ${y1}C${x + 4} ${y1} ${x + 4} ${y2} ${x} ${y2}`; }
        const [x1, x2] = b.c > a.c ? [a.c * 100 + 96, b.c * 100 + 4] : [a.c * 100 + 4, b.c * 100 + 96], m = (x1 + x2) / 2;
        return `M${x1} ${y1}C${m} ${y1} ${m} ${y2} ${x2} ${y2}`;
      };
      const art = h('div', { class: 'pr-lines', 'aria-hidden': 'true' });
      art.innerHTML = `<svg viewBox="0 0 300 ${rows * ROW}" preserveAspectRatio="none" width="100%" height="${rows * ROW}">${
        links.map((l) => `<path class="${l.gap ? 'gap' : [l.dim && 'dim', l.away && 'away'].filter(Boolean).join(' ')}" d="${path(l)}" vector-effect="non-scaling-stroke"/>`).join('')}</svg>`;
      const feeds = (o) => g.links.filter((l) => l.from === o.id).map((l) => `→ ${name(l.kind)} ${l.away ? 'carried to' : 'feeds'} ${find(l.to)?.name}`);
      const end = g.end.length ? g.end.map(name).join(' + ') : 'A loop';
      return h('div', { class: 'pr-pipe', role: 'group', 'aria-label': `Pipeline: ${end}` },
        h('span', { class: 'pr-end' }, `→ ${end}`),
        h('div', { class: 'pr-cols', 'aria-hidden': 'true' }, COLUMNS.map((c) => h('span', {}, COLUMN_LABEL[c]))),
        h('div', { class: 'pr-graph', style: { '--rows': rows, '--row': `${ROW}px` } }, art,
          cols.flatMap((c, ci) => c.map((x, ri) => h('div', { class: 'pr-cell', style: { gridColumn: `${ci + 1}`, gridRow: `${ri + 1}` } },
            x.o ? node(x.o, feeds(x.o)) : gapNode(x.gap))))));
    }
    function pipeline() {
      const groups = Industry.pipelines(state());
      const chains = groups.filter((g) => !g.standalone), lone = groups.filter((g) => g.standalone);
      // Every order in the galaxy: folded, its heading saying how many and any gap no order fills.
      if (!groups.length) return null;
      const gaps = groups.reduce((t, g) => t + g.gaps.length, 0);
      const n = state().orders.length;
      return env.section('Production pipeline', env.fold('pipeline', `Production pipeline · ${n} order${n === 1 ? '' : 's'}${gaps ? ` · ${gaps} gap${gaps === 1 ? '' : 's'}` : ''}`, [
        env.explain('pipeline', 'Every order you have placed, linked by what one makes and the next uses; a dotted link crosses between stations, so the good has to be carried. The first in line (#1) at a station gets inputs first.'),
        chains.map(graph),
        lone.length ? [h('span', { class: 'ui-label' }, 'Standalone'), h('div', { class: 'pr-lone' }, lone.map((g) => {
          const gapNotes = g.gaps.map((x) => h('span', { class: 'pr-gap' }, `No order makes ${name(x.kind)}${x.stage ? `: needs ${stationsFor(x.stage)}` : ''}`));
          return h('div', { class: 'pr-lone-row' }, node(g.orders[0], []), gapNotes);
        }))] : null]));
    }

    // ---------- Restoration (at the waystation) ----------

    // The projects in order: what each restores and costs, the next one with Restore. Its goods come
    // from the stock here.
    const PROJECT_TONE = { done: 'var(--good)', ready: 'var(--cyan)', short: 'var(--warn)', locked: 'var(--dim)' };
    const PROJECT_WORD = { done: 'Done', ready: 'Ready', short: 'Short', locked: 'Later' };
    let openProject = null;
    function restoration() {
      const projects = ind().projects(), done = projects.filter((p) => p.state === 'done').length;
      const cost = (p) => [...Object.entries(p.goods).map(([k, n]) => {
        const have = Math.min(n, ind().stock()[k] || 0);
        return p.state === 'done' ? `${n} ${name(k)}` : `${have}/${n} ${name(k)}`;
      }), `${p.credits} cr`].join(' · ');
      return env.section('Restoration',
        Kit.head('Restoration', h('span', { class: 'aside num' }, `${done}/${projects.length}`)),
        env.explain('restoration', 'Bring the other stations back online, one after another. Each takes goods from the stock here and credits; a restored station takes orders and has a shuttle for what it makes.'),
        h('div', { class: 'ui-list' }, projects.map((p) => Kit.optionRow({
          code: p.type ? 'IND' : 'SHP', name: p.name, sub: p.station ? `${p.station}${p.type ? '' : ' · shuttle'}` : null,
          tag: PROJECT_WORD[p.state], tagTone: { done: 'good', ready: 'cyan', short: 'warn' }[p.state] || null,
          vals: [], extra: h('span', { class: 'ui-note', style: { color: PROJECT_TONE[p.state] } }, cost(p)),
          note: `${p.note}${p.state === 'short' ? ` Still needed: ${[...p.short.map((x) => `${x.need - x.have} ${name(x.kind)}`), p.poor ? 'credits' : null].filter(Boolean).join(', ')}.` : ''}${p.state === 'locked' ? ' Restore the one before it first.' : ''}`,
          open: openProject === p.id, onToggle: () => { openProject = openProject === p.id ? null : p.id; env.refresh(); },
          action: p.state === 'ready' ? Kit.button('Restore', env.act(() => ind().restore(p.id)), { kind: 'primary', aria: `Restore: ${p.name}` }) : null,
          locked: p.state === 'locked', lockLabel: null,
        }))));
    }

    function render() {
      live = [];
      env.lead('');
      return [ind().restoring() ? restoration() : null, ordersHere(), storage(), aboard(), pipeline()].filter(Boolean).flat();
    }

    // ---------- Sheets ----------

    const madeBy = (kind) => Industry.recipeFor(kind, ind().known());
    // An order anywhere: its line, and what can be done from here.
    function viewSheet(open) {
      const o = find(open.id);
      if (!o) return null;
      const R = Recipes.RECIPES[o.recipe], B = Recipes.BAYS[R.bay], i = state().orders.indexOf(o), n = state().orders.length;
      const here = ind().here?.key === o.station, { S, text } = statusLine(o);
      return {
        title: recipeName(R), code: B.code, sub: `${B.label} · ${where(o)}`,
        body: [
          h('div', { class: 'pr-status' }, Kit.tag(S.word, S.tone), h('span', { class: 'txt' }, text)),
          h('div', { class: 'pr-board' }, line(o, false)),
          h('span', { class: 'ui-label' }, 'Priority'),
          h('div', { class: 'pr-prio' }, h('span', { class: 'num' }, `#${i + 1} of ${n} for inputs`),
            Kit.button('Up', env.act(() => ind().move(i, i - 1)), { kind: 'ghost', disabled: i === 0, aria: 'Move up: it goes first for inputs' }),
            Kit.button('Down', env.act(() => ind().move(i, i + 1)), { kind: 'ghost', disabled: i === n - 1, aria: 'Move down' })),
          here ? null : h('p', { class: 'ui-note' }, `Changed only at ${o.name}. Pause, resume and cancel work from any station.`),
        ],
        foot: [
          o.left !== 0 ? Kit.button(o.paused ? 'Resume' : 'Pause', env.act(() => ind().pause(o.id, !o.paused)), { kind: 'primary', lg: true, wide: true }) : null,
          here ? Kit.button('Change', () => env.showOrder(editing(o)), { kind: 'ghost', wide: true })
            : Kit.button('Set marker', env.act(() => ind().mark(o.station), () => env.closeSheet()), { kind: 'ghost', wide: true, aria: `Set a map marker on ${o.name}` }),
          Kit.button('Cancel order', env.act(() => ind().cancel(o.id), () => env.closeSheet()), { kind: 'warn', wide: true }),
        ],
      };
    }

    // What to make here, grouped by what comes out, recycling last.
    const GROUPS = ['Refined goods', 'Advanced goods', 'Parts', 'Gear', 'Mods', 'Kit', 'Recycling'];
    function groupOf(R) {
      if (R.id.startsWith('recycle.')) return 'Recycling';
      const it = Recipes.item(Object.keys(R.out)[0]);
      return { gear: 'Gear', mod: 'Mods', consumable: 'Kit' }[it.kind] || { refined: 'Refined goods', advanced: 'Advanced goods', part: 'Parts' }[it.stage] || 'Parts';
    }
    // A product to pick: its icon and name, its recipe and time a run, and whether the stock here has its inputs.
    function product(R, on, e, now) {
      const short = Object.entries(R.in).filter(([k, n]) => (ind().stock()[k] || 0) < n);
      const flowing = short.length && short.every(([k]) => makers(k, null).length);
      const [tag, tone] = !short.length ? ['Ready', 'var(--good)'] : flowing ? ['In the works', 'var(--cyan)'] : [`${short.length} missing`, 'var(--warn)'];
      return h('button', {
        class: 'pr-prod', type: 'button', 'aria-pressed': String(on), onclick: () => env.setOrder({ recipe: R.id }),
        title: short.length ? `Not in stock here: ${short.map(([k]) => name(k)).join(', ')}` : 'Every input is in stock here',
      },
      iconOf(Object.keys(R.out)[0], 40),
      h('span', { class: 'main' }, h('span', { class: 'nm' }, recipeName(R)),
        h('span', { class: 'formula num' }, `${recipeText(R)} · ${duration(Industry.runTime({ recipe: R.id }, e, now))}`)),
      Kit.tag(tag, tone));
    }
    function orderSheet(open) {
      const bays = ind().bays(), B = Recipes.BAYS[bays[0]], here = ind().here;
      const o = open.mode === 'edit' ? find(open.id) : null;
      if (!B || !ind().trusted() || (open.mode === 'edit' && !o)) return null;
      const known = ind().known(), e = ind().env(), now = ind().now();
      const all = Recipes.forBay(bays), recipes = all.filter((R) => known.has(R.id));
      const chosen = Recipes.RECIPES[open.recipe];
      const t = chosen ? Industry.runTime({ recipe: chosen.id }, e, now) : 0;
      const body = [];
      for (const g of GROUPS) {
        const rs = recipes.filter((R) => groupOf(R) === g);
        if (rs.length) body.push(h('span', { class: 'ui-label' }, g), rs.map((R) => product(R, R.id === open.recipe, e, now)));
      }
      if (all.length > recipes.length) body.push(h('p', { class: 'ui-note' }, `${all.length - recipes.length} more by blueprint (Research tab).`));
      body.push(
        h('span', { class: 'ui-label' }, 'Runs'),
        Kit.choices(COUNTS.map((n) => ({ id: String(n), label: n === null ? 'Continuous' : `×${n}`, on: open.count === n })),
          (id) => env.setOrder({ count: id === 'null' ? null : Number(id) }), { label: 'Runs' }),
        h('p', { class: 'ui-note' }, !chosen ? 'Pick a product above.' : open.count === null
          ? `Runs while there are inputs, ${duration(t)} each. New inputs in the stock here start it again.`
          : `${open.count} run${open.count === 1 ? '' : 's'}, ${duration(t)} each: about ${duration(t * open.count)} with the inputs in stock here.`));
      const go = open.mode === 'new' ? () => { if (ind().place(open.recipe, open.count)) showNewest(); } : () => ind().edit(open.id, open.recipe, open.count);
      return {
        title: open.mode === 'new' ? 'New order' : 'Change order', code: B.code, sub: `${B.label} · ${here.name}`, tall: true,
        body,
        foot: h('div', { class: 'pr-foot' },
          o ? Kit.button('Cancel order', env.act(() => ind().cancel(o.id), () => env.closeSheet()), { kind: 'warn' }) : null,
          o && o.left !== 0 ? Kit.button(o.paused ? 'Resume' : 'Pause', env.act(() => ind().pause(o.id, !o.paused)), { kind: 'ghost', aria: `${o.paused ? 'Resume' : 'Pause'} the order` }) : null,
          Kit.button(open.mode === 'new' ? 'Place order' : 'Save order', env.act(go, () => env.closeSheet()), {
            kind: 'primary', lg: true, disabled: !chosen, aria: chosen ? `${open.mode === 'new' ? 'Place' : 'Save'} an order for ${recipeName(chosen)}` : undefined,
          })),
      };
    }

    // An input's lineage: it, and (where the stock is short of it) what it is made from, three levels
    // down; then what to do about it.
    function inputSheet(open) {
      const o = find(open.id), bays = ind().bays(), B = Recipes.BAYS[bays[0]];
      if (!o || !B) return null;
      const known = ind().known(), have = (k) => stockOf(o.station)[k] || 0;
      const rows = [];
      const walk = (kind, need, depth) => {
        const R = Industry.isRaw(kind) ? null : madeBy(kind), s = supply(kind, need, o);
        const what = Goods.isSalvage(kind) ? 'Salvage' : !R ? 'Raw' : bays.includes(R.bay) ? `${Recipes.BAYS[R.bay].label} here` : `${Recipes.BAYS[R.bay].label} order`;
        rows.push(h('div', { class: `pr-lin${depth ? ' child' : ''}`, style: { '--depth': depth } },
          depth ? h('span', { class: 'elbow', 'aria-hidden': 'true' }) : null,
          h('div', { class: 'row' }, iconOf(kind, 32),
            h('span', { class: 'main' }, h('span', { class: 'nm' }, `${need} × ${name(kind)}`), h('span', { class: 'ui-label' }, what)),
            h('span', { class: 'have num', style: { color: MARK_TONE[s.cls] } }, s.mark))));
        // What it's made from, for an input the stock is short of.
        if (R && depth < 3 && s.cls !== 'ok') for (const [k, n] of Object.entries(R.in)) walk(k, n * need, depth + 1);
      };
      walk(open.kind, open.need, 0);
      const s = supply(open.kind, open.need, o), R = Industry.isRaw(open.kind) ? null : madeBy(open.kind);
      const here = R && bays.includes(R.bay) && known.has(R.id);
      const subShort = R ? Object.entries(R.in).filter(([k, n]) => have(k) < n).map(([k]) => name(k)) : [];
      const replaces = ind().orders().length >= ind().slots();
      const sells = env.ctx().market?.goods.some((g) => g.kind === open.kind && g.buy !== null);
      let note, action = null;
      if (s.cls === 'ok') note = `Enough ${name(open.kind)} in stock here for the next run.`;
      else if (s.cls === 'flow') note = `Another order here makes it; it goes into the stock here as it's made.`;
      else if (s.cls === 'away') note = `Your order at ${[...new Set(s.by.map((m) => m.name))].join(', ')} makes it. Take it from the stock there into your hold, and store it here.`;
      else if (here) {
        note = `Make it here first. ${subShort.length ? `You also need ${subShort.join(', ')}. ` : 'All of its inputs are in stock here. '}${replaces
          ? `This ${B.label.toLowerCase()} has no order free, so it replaces ${recipeName(Recipes.RECIPES[o.recipe])}.` : 'It takes a free order here.'}`;
        const make = replaces ? () => ind().edit(o.id, R.id, open.need) : () => { if (ind().place(R.id, open.need)) showNewest(); };
        action = Kit.button(`Make ${name(open.kind)} here`, env.act(make, () => env.closeSheet()), { wide: true, lg: true });
      } else if (R) note = `Made by ${stationsFor(R.bay)}${known.has(R.id) ? '' : ', once its blueprint is researched'}.`;
      else {
        note = `${name(open.kind)} is raw: ${Goods.isSalvage(open.kind) ? 'salvage it from pirates' : 'mine, collect or buy it'}. Store it from your hold.`;
        if (sells) action = Kit.button('Buy at Trade', () => { env.closeSheet(); env.showTab('trade'); }, { kind: 'ghost', wide: true, lg: true });
      }
      return {
        title: name(open.kind), code: R ? Recipes.BAYS[R.bay].code : 'RAW', sub: `${have(open.kind)} in stock · ${open.need} needed a run`,
        body: [h('span', { class: 'ui-label' }, 'Lineage'), h('div', { class: 'pr-lineage' }, rows), h('p', { class: 'pr-lin-note' }, note)],
        foot: action,
      };
    }
    const sheet = (open) => (open.mode === 'view' ? viewSheet(open) : open.mode === 'input' ? inputSheet(open) : orderSheet(open));

    // Every second: the running orders' meters and notes, without drawing again.
    function tick() {
      if (!ind()) return;
      const now = ind().now();
      for (const x of live) {
        const o = find(x.id);
        if (!o || o.next == null) continue;
        const p = progress(o, now), runs = runsOf(o);
        x.bar.style.width = `${(runs === null ? p : (o.made + p) / Math.max(1, runs)) * 100}%`;
        x.note.textContent = `${Math.round(p * 100)}% · ${duration(o.next - now)} left`;
      }
    }
    const reset = () => { live = []; openStored = openAboard = viewing = openProject = null; };

    return { render, sheet, tick, reset };
  },
};

export { IndustryView };
