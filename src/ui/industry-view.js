// The station screen's Industry tab (ui/station.js): the bays leased here and their jobs, this
// station's warehouse, the hold to store goods from, leasing a bay, and how the bays at other
// stations are doing. A bay opens a sheet to pick its recipe and how many runs.
//
//   IndustryView.create(env) -> { render(), sheet(open), tick(), reset() }
//     env: { ctx() (the station's open() options; ctx.industry: game/industry.js), refresh(), act(fn, after),
//            section(label, ...children), titleRow(title, aside), costChips(cost, credits, ...more),
//            itemIcon(kind, size), showBay(i), setBay(changes), closeSheet() }
//     sheet(open): the options for a bay's Kit.sheet, open being { i, recipe, count } (count null: repeat)
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
      idle: { word: 'Idle', tone: 'var(--dim)' },
      working: { word: 'Working', tone: 'var(--cyan)' },
      waiting: { word: 'Waiting', tone: 'var(--warn)' },
      finished: { word: 'Finished', tone: 'var(--good)' },
    };
    const COUNTS = [1, 5, 20, 100, null]; // runs to choose from; null: as long as inputs last
    let live = []; // working bays' meters and times left (see tick)

    const ind = () => env.ctx().industry;
    const name = (kind) => Recipes.item(kind).name;
    const SLOT_CODE = { weapon: 'WPN', shield: 'SHD', computer: 'CPU', engine: 'ENG', scanner: 'SCN' };
    // A thing's icon: a good's art, or for gear its slot's code.
    const iconOf = (kind, size) => {
      const it = Recipes.item(kind);
      if (it.kind === 'mod') return Kit.icon('MOD', size, { code: 'MOD' });
      return it.kind === 'gear' ? Kit.icon(SLOT_CODE[it.slot], size, { code: SLOT_CODE[it.slot], tier: it.tier }) : env.itemIcon(kind, size);
    };
    const list = (counts) => Object.entries(counts).map(([k, n]) => (n > 1 ? `${n} ${name(k)}` : name(k))).join(' + ');
    const recipeText = (R) => `${list(R.in)} → ${list(R.out)}`;
    const recipeName = (R) => Object.keys(R.out).map(name).join(' + ');
    // A bay's name: its kind, numbered among the bays of that kind here.
    const bayName = (s, i) => {
      const b = s.bays[i], same = s.bays.filter((x) => x.type === b.type);
      return `${Recipes.BAYS[b.type].label}${same.length > 1 ? ` ${same.indexOf(b) + 1}` : ''}`;
    };
    function duration(ms) {
      const sec = Math.max(0, Math.ceil(ms / 1000));
      if (sec < 60) return `${sec}s`;
      const m = Math.ceil(sec / 60), hrs = Math.floor(m / 60);
      return hrs ? `${hrs}h${m % 60 ? ` ${m % 60}m` : ''}` : `${m}m`;
    }
    const progress = (j, now) => Math.max(0, Math.min(1, (now - j.at) / Math.max(1, j.next - j.at)));
    const fast = (s, type) => Industry.SPECIALTY[s.type] === type;

    // ---------- Bays ----------

    function bayRow(s, i) {
      const b = s.bays[i], j = b.job, st = Industry.status(s, i), S = STATUS[st], now = ind().now();
      const R = j && Recipes.RECIPES[j.recipe];
      let extra = null;
      if (st === 'working') {
        const bar = Kit.meter(progress(j, now), { thin: true, color: 'var(--good)' }), time = h('span', { class: 'num' }, `${duration(j.next - now)} left`);
        live.push({ bar, time, i });
        extra = h('span', { class: 'st-run' }, bar, time);
      }
      const runs = j ? `${j.made} made${j.left === null ? ' · repeating' : j.left ? ` · ${j.left} to go` : ''}` : '';
      return Kit.optionRow({
        code: Recipes.BAYS[b.type].code, name: bayName(s, i), tag: S.word, tagTone: null,
        sub: R ? `${recipeText(R)} · ${runs}` : 'No job: pick a recipe',
        extra: [extra, st === 'waiting' ? h('span', { class: 'ui-note st-why' }, 'Waiting for inputs or room in the warehouse') : null],
        action: h('span', { class: 'st-deal' },
          i > 0 ? Kit.button('↑', env.act(() => ind().move(i, i - 1)), { kind: 'ghost', aria: `Move ${bayName(s, i)} up: it goes first for inputs` }) : null,
          Kit.button(j ? 'Change' : 'Set job', () => env.showBay(i), { kind: j ? 'ghost' : 'primary', aria: `${j ? 'Change the job of' : 'Set a job for'} ${bayName(s, i)}` })),
      });
    }

    // ---------- Warehouse and hold ----------

    function goodRow(kind, n, action) {
      const t = Recipes.item(kind);
      return Kit.optionRow({
        icon: h('span', { class: 'st-item' }, iconOf(kind, 40), h('span', { class: 'n num' }, `×${n}`)),
        name: t.name, tag: t.kind === 'gear' || t.kind === 'mod' ? t.kind : t.stage, tagTone: null, action,
      });
    }
    function warehouse(s) {
      const e = ind().env(), now = ind().now();
      const cap = Industry.capacity(s, e, now), used = Industry.used(s), held = Industry.reserved(s);
      const order = (k) => [...Goods.STAGES, 'item'].indexOf(Recipes.item(k).stage);
      const kinds = Object.keys(s.storage).sort((a, b) => order(a) - order(b));
      return env.section('Warehouse',
        Kit.head('Warehouse', Kit.meter((used + held) / cap, { thin: true }), h('span', { class: 'aside num' }, `${used + held}/${cap}`)),
        kinds.length ? h('div', { class: 'ui-list' }, kinds.map((k) => goodRow(k, s.storage[k],
          Kit.button('Take', env.act(() => ind().withdraw(k), () => Kit.toast(`${name(k)} to your ${{ component: 'components', gear: 'spare gear', mod: 'spare mods' }[Recipes.item(k).kind] || 'hold'}`)), {
            kind: 'ghost', disabled: Recipes.item(k).kind === 'good' && env.ctx().hold.free < 1, aria: `Take ${name(k)} out of the warehouse`,
          }))))
          : h('p', { class: 'ui-empty' }, 'Empty. Store goods from your hold below.'),
        held ? h('p', { class: 'ui-note' }, `${held} kept free for what the bays are making.`) : null);
    }
    function aboard(s) {
      const { hold } = env.ctx(), counts = {};
      for (const it of hold.items) counts[it.kind] = (counts[it.kind] || 0) + 1;
      const comps = env.ctx().lab.components;
      const free = Industry.free(s, ind().env(), ind().now());
      const store = (k) => Kit.button('Store', env.act(() => ind().deposit(k), () => Kit.toast(`${name(k)} stored`)), {
        kind: 'ghost', disabled: free < 1, aria: `Store ${name(k)} in the warehouse`,
      });
      const kinds = Object.keys(counts), parts = Object.keys(comps).filter((k) => Recipes.consumers(k).length);
      return env.section('Aboard',
        Kit.head('Aboard', kinds.length ? Kit.button('Store all', env.act(() => { for (const k of kinds) ind().deposit(k); }, () => Kit.toast('Hold stored')), { kind: 'ghost', disabled: free < 1 }) : null),
        kinds.length || parts.length ? h('div', { class: 'ui-list' }, kinds.map((k) => goodRow(k, counts[k], store(k))), parts.map((k) => goodRow(k, comps[k], store(k))))
          : h('p', { class: 'ui-empty' }, 'Nothing aboard to store. Mine, salvage or buy goods.'));
    }

    // ---------- Leasing, and other stations ----------

    function leasing(s) {
      const here = ind().here, max = ind().maxBays(), n = s ? s.bays.length : 0, credits = env.ctx().hold.credits;
      return env.section('Lease a bay',
        Kit.head('Lease a bay', h('span', { class: 'aside num' }, `${n}/${max} here`)),
        h('div', { class: 'ui-list' }, Object.values(Recipes.BAYS).map((B) => {
          const price = Industry.LEASE[B.id], quick = fast({ type: here.type }, B.id);
          return Kit.optionRow({
            code: B.code, name: B.label, tag: quick ? `×${Industry.FAST} speed here` : '', tagTone: 'good',
            sub: `${B.note} · paid once`,
            action: Kit.button('Lease', env.act(() => ind().lease(B.id), () => Kit.toast(`${B.label} leased`)), {
              price, disabled: n >= max || credits < price, title: n >= max ? 'No more bays here' : undefined, aria: `Lease a ${B.label} for ${price} credits`,
            }),
          });
        })));
    }
    function elsewhere() {
      const here = ind().here?.key, others = ind().sites.filter((x) => x.key !== here && x.bays.length);
      if (!others.length) return null;
      return env.section('Elsewhere', Kit.head('Elsewhere'), h('div', { class: 'ui-list' }, others.map((x) => h('div', { class: 'st-site' },
        h('span', { class: 'name' }, x.name),
        h('span', { class: 'sub' }, x.bays.map((b, i) => `${Recipes.BAYS[b.type].label}: ${STATUS[Industry.status(x, i)].word.toLowerCase()}`).join(' · ')),
        h('span', { class: 'num' }, `${Industry.used(x)} stored`)))));
    }

    function render() {
      live = [];
      const s = ind().site();
      return [
        env.titleRow('Industry', s ? `${s.bays.length} bay${s.bays.length === 1 ? '' : 's'} here` : ''),
        h('p', { class: 'ui-note' }, 'Bays refine and make goods from what\'s in this station\'s warehouse, in real time, even while you\'re away.'),
        s && s.bays.length ? env.section('Bays', Kit.head('Bays', h('span', { class: 'aside' }, 'first in line gets inputs first')), h('div', { class: 'ui-list' }, s.bays.map((b, i) => bayRow(s, i)))) : null,
        s ? [warehouse(s), aboard(s)] : null,
        leasing(s),
        elsewhere(),
      ];
    }

    // ---------- A bay's sheet: recipe and runs ----------

    function sheet(open) {
      const s = ind().site(), b = s?.bays[open.i];
      if (!b) return null;
      const known = ind().known(), e = ind().env();
      const recipes = Recipes.forBay(b.type).filter((R) => known.has(R.id));
      const locked = Recipes.forBay(b.type).length - recipes.length;
      const chosen = Recipes.RECIPES[open.recipe];
      const t = chosen ? Industry.runTime(s, { type: b.type, job: { recipe: chosen.id } }, e, ind().now()) : 0;
      return {
        title: bayName(s, open.i), code: Recipes.BAYS[b.type].code,
        sub: `${Recipes.BAYS[b.type].note}${fast(s, b.type) ? ` · ×${Industry.FAST} speed here` : ''}`,
        tall: true,
        body: [
          h('span', { class: 'ui-label' }, 'Recipe'),
          h('div', { class: 'ui-list' }, recipes.map((R) => {
            const on = open.recipe === R.id;
            return Kit.optionRow({
              icon: iconOf(Object.keys(R.out)[0], 40), name: recipeName(R), tag: on ? 'Chosen' : '', tagTone: 'cyan', current: on,
              sub: recipeText(R),
              extra: env.costChips(Object.entries(R.in).map(([kind, need]) => ({ kind, need, have: s.storage[kind] || 0 })), 0,
                h('span', { class: 'cost num', title: 'Time per run' }, `⏱ ${duration(Industry.runTime(s, { type: b.type, job: { recipe: R.id } }, e, ind().now()))}`)),
              action: on ? null : Kit.button('Choose', () => env.setBay({ recipe: R.id }), { kind: 'ghost', aria: `Choose ${recipeName(R)}` }),
            });
          })),
          locked ? h('p', { class: 'ui-note' }, `${locked} more by blueprint (Research tab).`) : null,
          h('span', { class: 'ui-label' }, 'Runs'),
          Kit.choices(COUNTS.map((n) => ({ id: String(n), label: n === null ? 'Repeat' : `×${n}`, on: open.count === n })),
            (id) => env.setBay({ count: id === 'null' ? null : Number(id) }), { label: 'Runs' }),
          h('p', { class: 'ui-note' }, chosen ? (open.count === null
            ? `Runs as long as there are inputs, ${duration(t)} each. Stored goods start it again.`
            : `${open.count} run${open.count === 1 ? '' : 's'}, ${duration(t)} each: about ${duration(t * open.count)} with the inputs in store.`) : 'Pick a recipe.'),
        ],
        foot: [
          Kit.button('Start', env.act(() => ind().setJob(open.i, open.recipe, open.count), () => { env.closeSheet(); Kit.toast(`${bayName(s, open.i)}: ${recipeName(chosen)}`); }), {
            kind: 'primary', lg: true, wide: true, disabled: !chosen, aria: chosen ? `Start making ${recipeName(chosen)}` : undefined,
          }),
          b.job ? Kit.button('Stop the bay', env.act(() => ind().clearJob(open.i), () => { env.closeSheet(); Kit.toast(`${bayName(s, open.i)} stopped · inputs back in store`, 'warn'); }), { kind: 'ghost', wide: true }) : null,
        ],
      };
    }

    // Every second: the working bays' meters and times left, without drawing again.
    function tick() {
      const s = ind()?.site(), now = ind()?.now();
      if (!s) return;
      for (const x of live) {
        const j = s.bays[x.i]?.job;
        if (!j || j.next == null) continue;
        x.bar.children[0]?.style.setProperty('--pct', `${progress(j, now) * 100}%`);
        x.time.textContent = `${duration(j.next - now)} left`;
      }
    }
    const reset = () => { live = []; };

    return { render, sheet, tick, reset };
  },
};

export { IndustryView };
