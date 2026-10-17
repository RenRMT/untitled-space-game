// The station screen's Production tab (ui/station.js): this station's production orders, each a
// card laid out like a pipeline node (its inputs, the stage and station, what it makes, its
// status), the shared storage and the hold to store goods from, and the production pipeline: every
// order in the galaxy, linked by what one makes and another uses, in three columns (refinery,
// fabricator, assembler), with the gaps no order fills. A new order opens a sheet that lists what
// this station can make; picking a product shows its lineage, where each input comes from.
//
//   IndustryView.create(env) -> { render(), sheet(open), tick(), reset() }
//     env: { ctx() (the station's open() options; ctx.industry: game/industry.js), refresh(), act(fn, after),
//            section(label, ...children), titleRow(title, aside), itemIcon(kind, size),
//            showOrder(open), setOrder(changes), closeSheet() }
//     sheet(open): the options for an order's Kit.sheet, open being
//       { mode: 'new' | 'edit', id?, recipe, count (null: while inputs last), peek (an input whose own lineage is unfolded) }
//       or { mode: 'view', id }: an order anywhere, to pause, cancel, reorder or mark on the map
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
    };
    const COUNTS = [1, 5, 20, 100, null]; // runs to choose from; null: as long as inputs last
    const COLUMNS = ['refinery', 'fabricator', 'assembler'];
    const ROW = 84; // px per row of the pipeline's columns
    let live = []; // running orders' meters and times left (see tick)
    let uses = null; // the stored good whose "What uses this?" is open

    const ind = () => env.ctx().industry;
    const state = () => ind().state;
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
    const made = (o) => (o.left === null ? `${o.made} made · while inputs last` : `${o.made} of ${o.made + o.left + (o.next != null ? 1 : 0)} made`);
    function statusLine(o) {
      const st = Industry.status(state(), o);
      const text = {
        running: o.paused ? 'pausing after this run' : made(o),
        starved: st.missing ? `no ${name(st.missing)} in storage` : '',
        blocked: 'storage is full',
        done: made(o),
        paused: made(o),
      }[st.id];
      return { st, S: STATUS[st.id], text };
    }
    // The change sheet for an order: its recipe, and its runs as first set (a count picked from COUNTS).
    const editing = (o) => ({ mode: 'edit', id: o.id, recipe: o.recipe, count: o.left === null ? null : COUNTS.find((n) => n !== null && n >= o.made + o.left + (o.next != null ? 1 : 0)) || 100, peek: null });
    const stationsFor = (stage) => `${Recipes.BAYS[stage].label} order (${Industry.STATIONS[stage]})`;

    // ---------- An order as a card ----------

    // An input as a chip: ✓ in storage (how many), ⟳ made by another order (where), ✗ missing.
    function inChip(o, kind, need) {
      const have = state().storage[kind] || 0;
      const by = state().orders.filter((x) => x !== o && kind in Recipes.RECIPES[x.recipe].out);
      const [mark, cls, note] = have >= need ? ['✓', 'ok', `${have}`] : by.length ? ['⟳', 'flow', by[0].name] : ['✗', 'miss', `${have}/${need}`];
      return h('span', { class: `pr-chip ${cls}`, title: `${name(kind)}: ${have} in storage${by.length ? `, made at ${by.map((x) => x.name).join(', ')}` : ''}` },
        iconOf(kind, 18), h('span', { class: 'nm' }, need > 1 ? `${need} ${name(kind)}` : name(kind)), h('span', { class: 'mk num' }, `${mark} ${note}`));
    }
    const outChip = (kind, n) => h('span', { class: 'pr-chip out' }, iconOf(kind, 18), h('span', { class: 'nm' }, n > 1 ? `${n} ${name(kind)}` : name(kind)));
    function flow(o) {
      const R = Recipes.RECIPES[o.recipe], B = Recipes.BAYS[R.bay];
      return h('div', { class: 'pr-flow' },
        h('span', { class: 'pr-ins' }, Object.entries(R.in).map(([k, n]) => inChip(o, k, n))),
        h('span', { class: 'pr-arrow', 'aria-hidden': 'true' }, '→'),
        h('span', { class: 'pr-stage' }, Kit.icon(B.code, 18, { code: B.code }), h('span', {}, `${B.label} · ${o.name}`)),
        h('span', { class: 'pr-arrow', 'aria-hidden': 'true' }, '→'),
        h('span', { class: 'pr-outs' }, Object.entries(R.out).map(([k, n]) => outChip(k, n))));
    }
    function stateRow(o) {
      const { st, S, text } = statusLine(o), now = ind().now();
      let run = null;
      if (st.id === 'running') {
        const bar = Kit.meter(progress(o, now), { thin: true, color: 'var(--good)' }), time = h('span', { class: 'num' }, `${duration(o.next - now)} left`);
        live.push({ bar, time, id: o.id });
        run = h('span', { class: 'st-run' }, bar, time);
      }
      return h('div', { class: 'pr-state' }, h('span', { class: 'line' }, Kit.tag(S.word, S.tone), h('span', { class: 'txt' }, text)), run);
    }
    function orderCard(o) {
      const R = Recipes.RECIPES[o.recipe];
      return h('div', { class: 'pr-card', style: { '--tone': STATUS[Industry.status(state(), o).id].tone } },
        flow(o), stateRow(o),
        h('div', { class: 'pr-acts' },
          o.left !== 0 ? Kit.button(o.paused ? 'Resume' : 'Pause', env.act(() => ind().pause(o.id, !o.paused)), { kind: 'ghost', aria: `${o.paused ? 'Resume' : 'Pause'} the order for ${recipeName(R)}` }) : null,
          Kit.button('Change', () => env.showOrder(editing(o)), { kind: 'ghost', aria: `Change the order for ${recipeName(R)}` })));
    }

    function ordersHere() {
      const here = ind().here, stage = ind().stage(), B = Recipes.BAYS[stage];
      if (!B) return env.section('Orders here', Kit.head('Orders here'), h('p', { class: 'ui-empty' }, 'This station takes no production orders.'));
      if (!ind().trusted()) {
        return env.section('Orders here', Kit.head('Orders here'), Kit.optionRow({ code: B.code, name: B.label, sub: `Complete a mission for ${here.name} first`, locked: true }));
      }
      const orders = ind().orders(), max = ind().slots();
      const free = Math.max(0, max - orders.length);
      return env.section('Orders here',
        Kit.head('Orders here', h('span', { class: 'aside num' }, `${orders.length}/${max}`)),
        orders.map(orderCard),
        Array.from({ length: free }, () => h('button', { class: 'pr-new', type: 'button', onclick: () => env.showOrder({ mode: 'new', recipe: null, count: null, peek: null }) },
          Kit.icon(B.code, 24, { code: B.code }), h('span', { class: 'main' }, h('span', { class: 'name' }, '+ New order'), h('span', { class: 'sub' }, `${B.label}: ${B.note.split(',')[0]}`)))));
    }

    // ---------- Storage and hold ----------

    function goodRow(kind, n, action, extra) {
      const t = Recipes.item(kind);
      return Kit.optionRow({
        icon: h('span', { class: 'st-item' }, iconOf(kind, 40), h('span', { class: 'n num' }, `×${n}`)),
        name: t.name, tag: { gear: 'gear', mod: 'mod', consumable: 'kit' }[t.kind] || t.stage, tagTone: null, action, extra,
      });
    }
    // "What uses this?": the recipes that take a good, and the stage that makes each.
    function usesOf(kind) {
      const rs = Recipes.consumers(kind);
      return h('ul', { class: 'pr-uses' }, rs.length ? rs.map((R) => h('li', {}, h('span', { class: 'nm' }, recipeName(R)), h('span', { class: 'sub' }, ` · ${stationsFor(R.bay)}`)))
        : h('li', { class: 'sub' }, 'No recipe uses it: it\'s an end product.'));
    }
    function storage() {
      const s = state(), e = ind().env(), now = ind().now();
      const cap = Industry.capacity(s, e, now), used = Industry.used(s), held = Industry.reserved(s);
      const order = (k) => [...Goods.STAGES, 'item'].indexOf(Recipes.item(k).stage);
      const kinds = Object.keys(s.storage).sort((a, b) => order(a) - order(b));
      const into = (k) => ({ component: 'components', gear: 'spare gear', mod: 'spare mods', consumable: 'kit' }[Recipes.item(k).kind] || 'hold');
      return env.section('Storage',
        Kit.head('Storage', Kit.meter((used + held) / cap, { thin: true }), h('span', { class: 'aside num' }, `${used + held}/${cap}`)),
        kinds.length ? h('div', { class: 'ui-list' }, kinds.map((k) => goodRow(k, s.storage[k],
          Kit.button('Take', env.act(() => ind().withdraw(k), () => Kit.toast(`${name(k)} to your ${into(k)}`)), {
            kind: 'ghost', disabled: Recipes.item(k).kind === 'good' && env.ctx().hold.free < 1, aria: `Take ${name(k)} out of storage`,
          }),
          [h('button', { class: 'ui-link pr-uses-link', type: 'button', 'aria-expanded': String(uses === k), onclick: () => { uses = uses === k ? null : k; env.refresh(); } }, 'What uses this?'),
            uses === k ? usesOf(k) : null])))
          : h('p', { class: 'ui-empty' }, 'Empty. Store goods from your hold below.'),
        h('p', { class: 'ui-note' }, `One storage for every station: what an order makes here can be taken out anywhere.${held ? ` ${held} kept free for runs under way.` : ''}`));
    }
    function aboard() {
      const { hold } = env.ctx(), counts = {};
      for (const it of hold.items) counts[it.kind] = (counts[it.kind] || 0) + 1;
      const comps = env.ctx().lab.components;
      const free = Industry.free(state(), ind().env(), ind().now());
      const store = (k) => Kit.button('Store', env.act(() => ind().deposit(k), () => Kit.toast(`${name(k)} stored`)), {
        kind: 'ghost', disabled: free < 1, aria: `Store ${name(k)}`,
      });
      const kinds = Object.keys(counts), parts = Object.keys(comps).filter((k) => Recipes.consumers(k).length);
      return env.section('Aboard',
        Kit.head('Aboard', kinds.length ? Kit.button('Store all', env.act(() => { for (const k of kinds) ind().deposit(k); }, () => Kit.toast('Hold stored')), { kind: 'ghost', disabled: free < 1 }) : null),
        kinds.length || parts.length ? h('div', { class: 'ui-list' }, kinds.map((k) => goodRow(k, counts[k], store(k))), parts.map((k) => goodRow(k, comps[k], store(k))))
          : h('p', { class: 'ui-empty' }, 'Nothing aboard to store. Mine, salvage or buy goods.'));
    }

    // ---------- The production pipeline ----------

    // One node: the station and system, the recipe and its status, and its place in line for inputs.
    function node(o, feeds) {
      const R = Recipes.RECIPES[o.recipe], B = Recipes.BAYS[R.bay], { S } = statusLine(o);
      const i = state().orders.indexOf(o), n = state().orders.length;
      return h('div', { class: 'pr-node', style: { '--tone': S.tone } },
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
    const gapNode = (g) => h('div', { class: 'pr-node gap' },
      h('span', { class: 'main' },
        h('span', { class: 'where' }, `No order makes ${name(g.kind)}`),
        h('span', { class: 'what' }, g.stage ? `Needs a ${stationsFor(g.stage)}` : 'Buy it, or find it'),
        h('span', { class: 'pr-feeds' }, h('span', {}, `→ needed by ${g.to.map((id) => find(id)?.name).join(', ')}`))));

    function graph(g) {
      const s = state(), cols = COLUMNS.map(() => []);
      for (const o of g.orders) cols[COLUMNS.indexOf(Recipes.RECIPES[o.recipe].bay)].push({ id: o.id, o });
      const gaps = new Map();
      for (const x of g.gaps) {
        if (!gaps.has(x.kind)) gaps.set(x.kind, { kind: x.kind, stage: x.stage, to: [] });
        gaps.get(x.kind).to.push(x.order);
      }
      for (const x of gaps.values()) cols[Math.max(0, COLUMNS.indexOf(x.stage))].push({ id: `gap:${x.kind}`, gap: x });
      const at = new Map();
      cols.forEach((c, ci) => c.forEach((x, ri) => at.set(x.id, { c: ci, r: ri })));
      const rows = Math.max(...cols.map((c) => c.length));
      const links = [...g.links.map((l) => ({ ...l, dim: !s.storage[l.kind] })),
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
        links.map((l) => `<path class="${l.gap ? 'gap' : l.dim ? 'dim' : ''}" d="${path(l)}" vector-effect="non-scaling-stroke"/>`).join('')}</svg>`;
      const feeds = (o) => g.links.filter((l) => l.from === o.id).map((l) => `→ ${name(l.kind)} feeds ${find(l.to)?.name}`);
      const end = g.end.length ? g.end.map(name).join(' + ') : 'A loop';
      return h('div', { class: 'pr-pipe', role: 'group', 'aria-label': `Pipeline: ${end}` },
        h('span', { class: 'pr-end' }, `→ ${end}`),
        h('div', { class: 'pr-cols', 'aria-hidden': 'true' }, COLUMNS.map((c) => h('span', {}, Recipes.BAYS[c].label))),
        h('div', { class: 'pr-graph', style: { '--rows': rows, '--row': `${ROW}px` } }, art,
          cols.flatMap((c, ci) => c.map((x, ri) => h('div', { class: 'pr-cell', style: { gridColumn: `${ci + 1}`, gridRow: `${ri + 1}` } },
            x.o ? node(x.o, feeds(x.o)) : gapNode(x.gap))))));
    }
    function pipeline() {
      const groups = Industry.pipelines(state());
      const chains = groups.filter((g) => !g.standalone), lone = groups.filter((g) => g.standalone);
      return env.section('Production pipeline',
        Kit.head('Production pipeline', h('span', { class: 'aside num' }, `${state().orders.length} order${state().orders.length === 1 ? '' : 's'}`)),
        groups.length ? h('p', { class: 'ui-note' }, 'Every order you have placed, linked by what one makes and the next uses. The first in line (#1) gets inputs first.')
          : h('p', { class: 'ui-empty' }, 'No production orders yet. Place one at a station: what it makes goes into storage, where the next order in the chain picks it up.'),
        chains.map(graph),
        lone.length ? [h('span', { class: 'ui-label' }, 'Standalone'), h('div', { class: 'pr-lone' }, lone.map((g) => {
          const gaps = g.gaps.map((x) => h('span', { class: 'pr-gap' }, `No order makes ${name(x.kind)}${x.stage ? `: needs a ${stationsFor(x.stage)}` : ''}`));
          return h('div', { class: 'pr-lone-row' }, node(g.orders[0], []), gaps);
        }))] : null);
    }

    function render() {
      live = [];
      const B = Recipes.BAYS[ind().stage()];
      return [
        env.titleRow('Production', B ? `${B.label} here` : ''),
        h('p', { class: 'ui-note' }, 'Production orders make goods from your storage in real time, even while you\'re away. Each station works one stage of the chain; what one order makes feeds the next through storage.'),
        ordersHere(),
        storage(),
        aboard(),
        pipeline(),
      ];
    }

    // ---------- Sheets ----------

    // Where an input comes from, in words.
    function source(x) {
      if (x.source === 'storage') return { mark: '✓', cls: 'ok', text: `${x.have} in storage` };
      if (x.source === 'order') return { mark: '⟳', cls: 'flow', text: `made by your order at ${x.makers.map((o) => o.name).join(', ')}${x.have ? ` · ${x.have} in storage` : ''}` };
      if (x.source === 'raw') return { mark: '✗', cls: 'miss', text: `${x.have}/${x.need} in storage · ${Goods.isSalvage(x.kind) ? 'salvage it from pirates' : 'mine, collect or buy it'}` };
      return { mark: '✗', cls: 'miss', text: `${x.have}/${x.need} in storage · needs a ${stationsFor(x.stage)}` };
    }
    const madeBy = (kind) => Industry.recipeFor(kind, ind().known());
    function lineageList(recipe, open, depth = 0) {
      return h('div', { class: `pr-lineage${depth ? ' sub' : ''}` }, Industry.lineage(state(), recipe, ind().known()).map((x) => {
        const s = source(x), R = !x.raw && madeBy(x.kind), on = open && open.peek === x.kind;
        const row = [iconOf(x.kind, 24), h('span', { class: 'main' }, h('span', { class: 'nm' }, `${x.need} × ${name(x.kind)}`), h('span', { class: `src ${s.cls}` }, `${s.mark} ${s.text}`)),
          R && depth === 0 ? h('span', { class: 'chev', 'aria-hidden': 'true' }, on ? '▴' : '▾') : null];
        return [
          R && depth === 0
            ? h('button', { class: 'pr-in', type: 'button', 'aria-expanded': String(!!on), onclick: () => env.setOrder({ peek: on ? null : x.kind }) }, row)
            : h('div', { class: 'pr-in' }, row),
          on ? [h('p', { class: 'ui-note pr-peek' }, `${recipeName(R)} is made from:`), lineageList(R.id, null, 1)] : null,
        ];
      }));
    }

    function viewSheet(open) {
      const o = find(open.id);
      if (!o) return null;
      const R = Recipes.RECIPES[o.recipe], B = Recipes.BAYS[R.bay], i = state().orders.indexOf(o), n = state().orders.length;
      const here = ind().here?.key === o.station;
      return {
        title: recipeName(R), code: B.code, sub: `${B.label} order · ${where(o)}`,
        body: [
          flow(o), stateRow(o),
          h('span', { class: 'ui-label' }, 'Priority'),
          h('div', { class: 'pr-prio' }, h('span', { class: 'num' }, `#${i + 1} of ${n} for inputs`),
            Kit.button('Up', env.act(() => ind().move(i, i - 1)), { kind: 'ghost', disabled: i === 0, aria: 'Move up: it goes first for inputs' }),
            Kit.button('Down', env.act(() => ind().move(i, i + 1)), { kind: 'ghost', disabled: i === n - 1, aria: 'Move down' })),
          here ? null : h('p', { class: 'ui-note' }, `Changed only at ${o.name}. Pause, resume and cancel work from any station.`),
        ],
        foot: [
          o.left !== 0 ? Kit.button(o.paused ? 'Resume' : 'Pause', env.act(() => ind().pause(o.id, !o.paused)), { kind: 'primary', lg: true, wide: true }) : null,
          here ? Kit.button('Change', () => env.showOrder(editing(o)), { kind: 'ghost', wide: true })
            : Kit.button('Set marker', env.act(() => ind().mark(o.station), () => { env.closeSheet(); Kit.toast(`Marker set on ${o.name}`); }), { kind: 'ghost', wide: true, aria: `Set a map marker on ${o.name}` }),
          Kit.button('Cancel order', env.act(() => ind().cancel(o.id), () => { env.closeSheet(); Kit.toast(`Order cancelled · inputs back in storage`, 'warn'); }), { kind: 'warn', wide: true }),
        ],
      };
    }

    // What to make here, grouped by what comes out, recycling last.
    const GROUPS = ['Refined goods', 'Advanced goods', 'Parts', 'Gear', 'Mods', 'Consumables', 'Recycling'];
    function groupOf(R) {
      if (R.id.startsWith('recycle.')) return 'Recycling';
      const it = Recipes.item(Object.keys(R.out)[0]);
      return { gear: 'Gear', mod: 'Mods', consumable: 'Consumables' }[it.kind] || { refined: 'Refined goods', advanced: 'Advanced goods', part: 'Parts' }[it.stage] || 'Parts';
    }
    function orderSheet(open) {
      const stage = ind().stage(), B = Recipes.BAYS[stage], here = ind().here;
      if (!B || !ind().trusted() || (open.mode === 'edit' && !find(open.id))) return null;
      const known = ind().known(), e = ind().env(), now = ind().now();
      const all = Recipes.forBay(stage), recipes = all.filter((R) => known.has(R.id));
      const chosen = Recipes.RECIPES[open.recipe];
      const t = chosen ? Industry.runTime({ recipe: chosen.id }, e, now) : 0;
      const body = [];
      if (!chosen) {
        body.push(h('p', { class: 'ui-note' }, `A ${B.label.toLowerCase()} makes ${B.note.split(',')[0].replace(/^.* into /, '')}. Pick a product to see what it needs.`));
        for (const g of GROUPS) {
          const rs = recipes.filter((R) => groupOf(R) === g);
          if (!rs.length) continue;
          body.push(h('span', { class: 'ui-label' }, g), h('div', { class: 'ui-list' }, rs.map((R) => Kit.optionRow({
            icon: iconOf(Object.keys(R.out)[0], 40), name: recipeName(R), sub: recipeText(R),
            extra: h('span', { class: 'pr-mini' }, Industry.lineage(state(), R.id, known).map((x) => { const s = source(x); return h('span', { class: `src ${s.cls}`, title: s.text }, `${s.mark} ${name(x.kind)}`); }),
              h('span', { class: 'cost num', title: 'Time per run' }, `⏱ ${duration(Industry.runTime({ recipe: R.id }, e, now))}`)),
            action: Kit.button('Choose', () => env.setOrder({ recipe: R.id, peek: null }), { kind: 'ghost', aria: `Choose ${recipeName(R)}` }),
          }))));
        }
        if (all.length > recipes.length) body.push(h('p', { class: 'ui-note' }, `${all.length - recipes.length} more by blueprint (Research tab).`));
      } else {
        body.push(
          h('span', { class: 'ui-label' }, 'Product'),
          Kit.optionRow({
            icon: iconOf(Object.keys(chosen.out)[0], 40), name: recipeName(chosen), sub: recipeText(chosen), current: true,
            action: Kit.button('Other', () => env.setOrder({ recipe: null, peek: null }), { kind: 'ghost', aria: 'Pick another product' }),
          }),
          h('span', { class: 'ui-label' }, 'Lineage'),
          h('p', { class: 'ui-note' }, 'Where each input comes from. Tap one to see what it is made from.'),
          lineageList(chosen.id, open),
          h('span', { class: 'ui-label' }, 'Runs'),
          Kit.choices(COUNTS.map((n) => ({ id: String(n), label: n === null ? 'Continuous' : `×${n}`, on: open.count === n })),
            (id) => env.setOrder({ count: id === 'null' ? null : Number(id) }), { label: 'Runs' }),
          h('p', { class: 'ui-note' }, open.count === null
            ? `Runs while there are inputs, ${duration(t)} each. New inputs in storage start it again.`
            : `${open.count} run${open.count === 1 ? '' : 's'}, ${duration(t)} each: about ${duration(t * open.count)} with the inputs in storage.`));
      }
      const go = open.mode === 'new' ? () => ind().place(open.recipe, open.count) : () => ind().edit(open.id, open.recipe, open.count);
      return {
        title: open.mode === 'new' ? 'New order' : 'Change order', code: B.code, sub: `${B.label} · ${here.name}`, tall: true,
        body,
        foot: [
          Kit.button(open.mode === 'new' ? 'Place order' : 'Save order', env.act(go, () => { env.closeSheet(); Kit.toast(`${B.label} order: ${recipeName(chosen)}`); }), {
            kind: 'primary', lg: true, wide: true, disabled: !chosen, aria: chosen ? `Place an order for ${recipeName(chosen)}` : undefined,
          }),
          open.mode === 'edit' ? Kit.button('Cancel order', env.act(() => ind().cancel(open.id), () => { env.closeSheet(); Kit.toast('Order cancelled · inputs back in storage', 'warn'); }), { kind: 'warn', wide: true }) : null,
        ],
      };
    }
    const sheet = (open) => (open.mode === 'view' ? viewSheet(open) : orderSheet(open));

    // Every second: the running orders' meters and times left, without drawing again.
    function tick() {
      const now = ind()?.now();
      if (!ind()) return;
      for (const x of live) {
        const o = find(x.id);
        if (!o || o.next == null) continue;
        x.bar.children[0]?.style.setProperty('--pct', `${progress(o, now) * 100}%`);
        x.time.textContent = `${duration(o.next - now)} left`;
      }
    }
    const reset = () => { live = []; uses = null; };

    return { render, sheet, tick, reset };
  },
};

export { IndustryView };
