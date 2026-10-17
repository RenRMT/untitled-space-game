// The station screen's Research tab (ui/station.js), drawn like the Ship tab: the lab bench (what's
// building, with the queue as a pipeline of slots), a switch between the research groups, the
// group as a tree of packages joined by their requirements (Research.layout), what research adds
// as stat chips, and the components in store. Tapping a package opens its sheet: what it gives, what
// it needs and leads to, its cost, and Build, Queue or Cancel.
//
//   ResearchView.create(env) -> { render(), sheet(id), tick(), reset() }
//     env: { ctx() (the station's open() options), refresh(), show(id) (open a package's sheet),
//            act(fn, after), costChips(cost, credits, ...more), componentsGrid(components),
//            section(label, ...children), lead(text) (the tab's first line), explain(key, text) (a note
//            that folds away after a few visits), fold(key, label, content), openId() (the package
//            whose sheet is open) }
//     render(): the tab's contents; sheet(id): the options for its Kit.sheet; tick(): the bench's
//     numbers, every second without drawing again; reset(): back to the first group, chips closed.
// ES module (`ResearchView`); needs a browser.

import { Goods } from '../rules/goods.js';
import { Industry } from '../rules/industry.js';
import { Loadout } from '../rules/loadout.js';
import { Logic } from '../rules/logic.js';
import { Recipes } from '../rules/recipes.js';
import { Research } from '../rules/research.js';
import { Squad } from '../rules/squad.js';
import { Kit } from './kit.js';
import { UI } from './ui.js';

const ResearchView = {
  create(env) {
    const { h } = UI;
    const SLOT_CODE = { weapon: 'WPN', shield: 'SHD', computer: 'CPU', engine: 'ENG', scanner: 'SCN' };
    const CAT_CODE = { core: 'SYS', combat: 'CMB', tactics: 'TAC', maint: 'MNT', hull: 'HUL' };
    for (const [line, L] of Object.entries(Loadout.LINES)) CAT_CODE[`bp.${line}`] = SLOT_CODE[L.slot];
    Object.assign(CAT_CODE, { 'mods.weapons': 'MOD', 'mods.systems': 'MOD', 'ind.speed': 'BAY', 'ind.room': 'WHS', 'ind.recipes': 'RCP', 'ind.lab': 'LAB' });
    const STATE = {
      done: { tag: 'Done', tone: 'var(--good)' },
      active: { tag: 'Building', tone: 'var(--cyan)' },
      queued: { tag: 'Queued', tone: 'var(--cyan)' },
      available: { tag: '', tone: null },
      locked: { tag: 'Locked', tone: 'var(--dim)' },
    };
    let group = Research.GROUPS[0].id;
    let openStat = null;
    let live = null; // the bench's meter and time left, and the building node's meter (see tick)

    // A duration: '45s', '20m', '1h 30m'.
    function duration(ms) {
      const sec = Math.max(0, Math.ceil(ms / 1000));
      if (sec < 60) return `${sec}s`;
      const m = Math.ceil(sec / 60), hrs = Math.floor(m / 60);
      return hrs ? `${hrs}h${m % 60 ? ` ${m % 60}m` : ''}` : `${m}m`;
    }
    const pct = (v) => `${Math.round(v * 100)}%`;
    const lab = () => env.ctx().lab;
    const catOf = (p) => Research.CATEGORIES.find((c) => c.id === p.cat);
    const inGroup = (g) => Research.LIST.filter((p) => catOf(p).group === g);
    const isDone = (id) => lab().state.done.includes(id);
    // A package's name on its node: 'select', 'bool 1.1', 'ext 2.0'; a refit's line ('Armour') with its Mk as pips.
    function short(p) {
      if (p.kind === 'blueprint') return Loadout.MK[p.tier];
      if (p.kind === 'refine') return `+${p.step * 4}%`;
      if (p.short) return p.short;
      if (p.kind !== 'logic') return p.name.replace(/ Mk [IV]+$/, '').split(' ')[0];
      const rest = p.name.split('.').slice(1).join('.');
      return p.ver === '1.0' && !p.lines ? rest : `${rest} ${p.ver}`;
    }
    const left = (a) => `${Math.floor(lab().progress() * 100)}% · ${duration(a.end - lab().now())} left`;

    // ---------- The lab bench ----------

    // What's building (a card with its progress), then a slot per place in the queue, joined as a pipeline.
    function bench() {
      const st = lab().state, a = st.active;
      live = null;
      let card;
      if (a) {
        const p = Research.PACKAGES[a.id];
        const bar = Kit.meter(lab().progress(), { color: 'var(--good)' }), time = h('span', { class: 'num' }, left(a));
        live = { bar, time, end: a.end, node: null };
        card = h('button', { class: 'st-bench-cur', type: 'button', 'aria-haspopup': 'dialog', 'aria-label': `Building ${Research.title(a.id)}`, onclick: () => env.show(a.id) },
          h('span', { class: 'cmd' }, p.kind === 'logic'
            ? [h('span', { class: 'tk-op' }, '$ '), h('span', { class: 'tk-fn' }, 'compiling '), h('span', { class: 'tk-subj' }, Research.title(a.id))]
            : [h('span', { class: 'tk-op' }, '$ '), h('span', { class: 'tk-fn' }, 'building '), h('span', { class: 'tk-subj' }, Research.title(a.id))]),
          bar, time);
      } else {
        card = h('div', { class: 'st-bench-cur idle' }, h('span', { class: 'cmd tk-cmt' }, '// idle: pick a package below'));
      }
      const slots = [];
      for (let i = 0; i < Research.queueMax(st); i++) {
        const id = st.queue[i];
        if (!id) { slots.push(h('div', { class: 'st-bench-slot empty', 'aria-hidden': 'true' }, Kit.icon('open', 20, { code: '+' }))); continue; }
        const p = Research.PACKAGES[id];
        slots.push(h('button', { class: 'st-bench-slot', type: 'button', 'aria-haspopup': 'dialog', 'aria-label': `Queued ${i + 1}: ${Research.title(id)}`, onclick: () => env.show(id) },
          Kit.icon(CAT_CODE[p.cat], 20, { code: CAT_CODE[p.cat], tier: p.kind === 'logic' ? null : p.tier }),
          h('span', { class: 'lbl' }, short(p)), h('span', { class: 'num' }, duration(Research.timeOf(id)))));
      }
      return [
        Kit.head('Lab', h('span', { class: 'aside num' }, `queue ${st.queue.length}/${Research.queueMax(st)}`)),
        h('div', { class: 'st-bench' }, card, h('div', { class: 'st-bench-q' }, slots)),
      ];
    }

    // ---------- The tree ----------

    // As wide as its columns (four fit a phone's width), centred like the ship schematic.
    const NODE = { w: 80, h: 70 }, PITCH = { x: 88, y: 84 }, LANE = 22;
    function tree(g) {
      const L = Research.layout(g), st = lab().state;
      const width = (L.cols - 1) * PITCH.x + NODE.w, x0 = 0;
      const lanesAbove = (row) => L.lanes.filter((l) => l.row <= row).length;
      const pos = {};
      for (const n of L.nodes) pos[n.id] = { x: x0 + n.col * PITCH.x, y: n.row * PITCH.y + lanesAbove(n.row) * LANE };
      const height = (L.rows - 1) * PITCH.y + L.lanes.length * LANE + NODE.h + 2;
      // Requirements as lines from the right of one node to the left of the next; solid once both are done.
      const lines = L.edges.map(([a, b]) => {
        const A = pos[a], B = pos[b], ax = A.x + NODE.w, ay = A.y + NODE.h / 2, bx = B.x, by = B.y + NODE.h / 2;
        const mx = Math.round(bx - (PITCH.x - NODE.w) / 2);
        const d = ay === by ? `M${ax} ${ay}H${bx}` : `M${ax} ${ay}H${mx}V${by}H${bx}`;
        return `<path d="${d}" class="${isDone(a) && isDone(b) ? 'done' : ''}"/>`;
      });
      const art = h('div', { class: 'st-outline', 'aria-hidden': 'true' });
      art.innerHTML = `<svg viewBox="0 0 ${width} ${height}"><g class="st-tree-lines" fill="none">${lines.join('')}</g></svg>`;
      const labels = L.lanes.map((l) => h('span', { class: 'st-lane', style: { left: `${x0}px`, top: `${pos[L.nodes.find((n) => n.row === l.row).id].y - LANE + 2}px` } },
        Research.CATEGORIES.find((c) => c.id === l.cat).label));
      const nodes = L.nodes.map((n) => {
        const p = Research.PACKAGES[n.id], s = lab().status(n.id).state;
        const at = s === 'queued' ? st.queue.indexOf(n.id) + 1 : 0;
        const node = Kit.techNode({
          x: pos[n.id].x, y: pos[n.id].y, w: NODE.w, h: NODE.h, label: short(p), code: CAT_CODE[p.cat], state: s,
          tier: p.kind === 'logic' ? null : p.tier, mark: s === 'done' ? '✓' : s === 'active' ? '▶' : at ? `Q${at}` : '',
          progress: s === 'active' ? lab().progress() : null, open: env.openId() === n.id,
          aria: `${Research.title(n.id)}${STATE[s].tag ? `, ${STATE[s].tag.toLowerCase()}` : ''}`, onclick: () => env.show(n.id),
        });
        if (s === 'active' && live) live.node = node.children[node.children.length - 1]; // its meter
        return node;
      });
      return h('section', { class: 'ui-schematic st-tree', style: { width: `${width}px`, height: `${height}px` }, 'aria-label': `${Research.GROUPS.find((x) => x.id === g).label} research` }, art, labels, nodes);
    }

    // ---------- What research adds ----------

    function bonuses() {
      const done = lab().state.done, u = Research.upgrades(done);
      const from = (pred) => done.filter((id) => pred(Research.PACKAGES[id])).map(Research.title).join(' + ') || 'Nothing yet';
      const lines = Squad.lineLimit(Research.lineBonus(done));
      const stats = [
        { id: 'mem', code: 'MEM', label: 'Program lines', value: `${lines}/${Squad.MAX_LINES}`, detail: 'Lines of each squad member\'s program that run.', from: from((p) => p.lines) },
        { id: 'hul', code: 'HUL', label: 'Hull', value: `+${pct(u.hull)}`, detail: 'Added to the hull of every ship you fly.', from: from((p) => p.upgrade?.hull) },
        { id: 'crg', code: 'CRG', label: 'Hold', value: `+${pct(u.cargo)}`, detail: 'Added to the hold of every ship you fly.', from: from((p) => p.upgrade?.cargo) },
        { id: 'wpn', code: 'WPN', label: 'Hardpoints', value: `+${u.weapons}`, detail: `Weapon slots added to every hull (${Loadout.MAX_WEAPONS} at most).`, from: from((p) => p.upgrade?.weapons) },
        { id: 'blu', code: 'BLU', label: 'Blueprints', value: `${done.filter((id) => Research.PACKAGES[id]?.kind === 'blueprint').length}/${Research.LIST.filter((p) => p.kind === 'blueprint').length}`, detail: 'Gear an assembler can make, beyond Mk I.', from: 'Research, and schematics recovered from pirates' },
        { id: 'que', code: 'QUE', label: 'Queue', value: `${Research.queueMax(lab().state)}`, detail: 'Packages that can wait behind the one building.', from: from((p) => p.industry?.queue) },
        { id: 'spd', code: 'BAY', label: 'Order speed', value: `+${pct(Research.bonusAt(lab().state, Infinity, 'speed'))}`, detail: 'Every production order runs this much faster.', from: from((p) => p.industry?.speed) },
        { id: 'rom', code: 'WHS', label: 'Slots, storage', value: `${Industry.SLOTS + Research.bonusAt(lab().state, Infinity, 'bays')} · +${Research.bonusAt(lab().state, Infinity, 'storage')}`, detail: 'Production orders per station, and room added to the shared storage.', from: from((p) => p.industry?.bays || p.industry?.storage) },
        { id: 'pkg', code: 'PKG', label: 'Researched', value: `${done.filter((id) => Research.LIST.some((p) => p.id === id)).length}/${Research.LIST.length}`, detail: 'Packages done, in every group.', from: '' },
      ];
      return Kit.statChips(stats, openStat, (id) => { openStat = id; env.refresh(); });
    }

    function render() {
      const groups = Research.GROUPS.filter((g) => inGroup(g.id).length);
      if (!groups.some((g) => g.id === group)) group = groups[0].id;
      const count = (g) => `${inGroup(g).filter((p) => isDone(p.id)).length}/${inGroup(g).length}`;
      env.lead(`${Research.LIST.filter((p) => isDone(p.id)).length}/${Research.LIST.length} done`);
      return [
        env.explain('research', 'Paid for when queued; builds in real time, even while you\'re away.'),
        env.section('Lab', bench()),
        env.section('Groups', Kit.choices(groups.map((g) => ({ id: g.id, label: `${g.label} ${count(g.id)}`, on: g.id === group })),
          (id) => { group = id; env.refresh(); }, { label: 'Research group' })),
        tree(group),
        env.fold('research-adds', 'What research adds', bonuses()),
        env.fold('components', `Components in store · ${Object.values(lab().components || {}).reduce((t, n) => t + n, 0)}`,
          [h('p', { class: 'ui-note' }, 'Recovered from pirates and wrecks.'), env.componentsGrid(lab().components)]),
      ];
    }

    // ---------- A package's sheet ----------

    // What a hull refit does to the ship as it is: without it, then with it.
    const SHIP_METRICS = [
      { code: 'HUL', label: 'Hull', get: (s) => s.hull, fmt: String, fmtDiff: String },
      { code: 'CRG', label: 'Hold', get: (s) => s.cargo, fmt: String, fmtDiff: String },
      { code: 'WPN', label: 'Weapon slots', get: (s) => s.weaponSlots, fmt: String, fmtDiff: String },
    ];
    function shipChange(id) {
      const { outfitting: o } = env.ctx(), others = lab().state.done.filter((x) => x !== id);
      const without = Loadout.stats(o.loadout, Research.upgrades(others)), withIt = Loadout.stats(o.loadout, Research.upgrades([...others, id]));
      return Kit.compareTable(Kit.compare(without, withIt, SHIP_METRICS).filter((r) => r.diff));
    }
    // A blueprint: what the gear does (against what's fitted in that kind of slot), and what it's made of.
    function gearInfo(p) {
      const item = { id: p.gear, ...Loadout.EQUIPMENT[p.gear] }, R = Recipes.gearRecipe(p.gear);
      const { outfitting: o } = env.ctx();
      const fitted = Loadout.slots(o.loadout, o.upgrades).filter((s) => s.type === item.slot && s.item).map((s) => s.item);
      const names = (counts) => Object.entries(counts).map(([k, n]) => (n > 1 ? `${n} ${Recipes.item(k).name}` : Recipes.item(k).name)).join(' + ');
      return [
        h('span', { class: 'ui-label' }, 'The gear'),
        h('p', { class: 'st-gives' }, Loadout.summary(item)),
        fitted.length ? h('p', { class: 'ui-note' }, `Fitted now: ${fitted.map((f) => `${f.name} (${Loadout.summary(f)})`).join('; ')}`) : null,
        h('span', { class: 'ui-label' }, 'Assembled from'),
        h('p', { class: 'ui-note' }, names(R.in)),
      ];
    }
    // A refinement: what it does to the gear of its line that's fitted, without it and with it.
    function refineInfo(p) {
      const { outfitting: o } = env.ctx(), others = lab().state.done.filter((x) => x !== p.id);
      const fitted = Loadout.slots(o.loadout, o.upgrades).filter((s) => s.item?.line === p.refine.line).map((s) => s.item);
      if (!fitted.length) return h('p', { class: 'ui-note' }, `No ${Loadout.LINES[p.refine.line].name.toLowerCase()} fitted now.`);
      const before = Research.upgrades(others).lines[p.refine.line], after = Research.upgrades([...others, p.id]).lines[p.refine.line];
      const r2 = (v) => Math.round(v * 100) / 100;
      return [h('span', { class: 'ui-label' }, 'Your gear'), fitted.map((f) => {
        const a = Loadout.tuned(f.stats, before), b = Loadout.tuned(f.stats, after);
        return h('p', { class: 'ui-note' }, `${f.name}: ${Object.keys(p.refine.stats).map((k) => `${k} ${r2(a[k])} → ${r2(b[k])}`).join(' · ')}`);
      })];
    }
    const link = (id) => h('div', { class: 'st-need' }, Kit.check(isDone(id) ? 'done' : 'open', true),
      h('button', { class: 'ui-link', type: 'button', onclick: () => env.show(id) }, Research.title(id)),
      h('span', { class: 'num' }, STATE[lab().status(id).state].tag));

    function sheet(id) {
      const p = Research.PACKAGES[id];
      if (!p) return null;
      const L = lab(), st = L.status(id), S = STATE[st.state], idle = !L.state.active;
      const gives = Research.gives(id).filter((g) => g.kind !== 'upgrade' && g.kind !== 'recipe').map((g) => g.label);
      const leads = Research.LIST.filter((q) => q.requires.includes(id));
      const lacking = st.cost.filter((c) => c.have < c.need).map((c) => Goods.type(c.kind).name);
      const why = st.state !== 'available' || st.ok ? null : st.full ? 'The queue is full.'
        : [env.ctx().hold.credits < st.credits ? `${(st.credits - env.ctx().hold.credits).toLocaleString('en-US')} cr short.` : '', lacking.length ? `Short of ${lacking.join(', ')}.` : ''].filter(Boolean).join(' ');
      const foot = st.state === 'available' ? [
        Kit.button(idle ? 'Build' : 'Queue', env.act(() => L.enqueue(id), () => Kit.toast(idle ? `Started ${Research.title(id)}` : `${Research.title(id)} queued`)), {
          kind: st.ok ? 'primary' : '', disabled: !st.ok, lg: true, wide: true, aria: `${idle ? 'Build' : 'Queue'} ${Research.title(id)}`,
        }),
        why ? h('p', { class: 'ui-note' }, why) : null,
      ] : st.state === 'active' ? Kit.button('Cancel build · half back', env.act(() => L.cancel(id), () => Kit.toast(`${Research.title(id)} cancelled · half refunded`, 'warn')), { kind: 'ghost', wide: true })
        : st.state === 'queued' ? Kit.button('Cancel · all back', env.act(() => L.cancel(id), () => Kit.toast('Cancelled · refunded', 'warn')), { kind: 'ghost', wide: true })
          : st.state === 'locked' ? h('p', { class: 'ui-note' }, `Needs ${st.needs.map(Research.title).join(', ')} first.`) : null;
      return {
        title: Research.title(id), code: CAT_CODE[p.cat], kicker: S.tag, kickerColor: S.tone,
        sub: `${catOf(p).label} · ${duration(Research.timeOf(id))} to build`,
        body: [
          h('p', { class: `ui-note${p.kind === 'logic' ? ' st-pkg-note' : ''}` }, p.kind === 'logic' ? `// ${p.note}` : p.note),
          st.state === 'active' ? [h('span', { class: 'ui-label' }, 'Building'), Kit.meter(L.progress(), { color: 'var(--good)' }), h('span', { class: 'num st-left' }, left(L.state.active))] : null,
          gives.length || p.example ? [h('span', { class: 'ui-label' }, 'Gives'),
            gives.length ? h('p', { class: 'st-gives' }, gives.join(' · ')) : null,
            p.example ? h('p', { class: 'ui-note' }, `e.g. ${Logic.say(p.example)}`) : null] : null,
          p.upgrade ? [h('span', { class: 'ui-label' }, 'Your ship'), shipChange(id)] : null,
          p.gear ? gearInfo(p) : null,
          p.refine ? refineInfo(p) : null,
          p.requires.length ? [h('span', { class: 'ui-label' }, 'Needs'), p.requires.map(link)] : null,
          leads.length ? [h('span', { class: 'ui-label' }, 'Leads to'), leads.map((q) => link(q.id))] : null,
          st.state === 'done' ? null : [h('span', { class: 'ui-label' }, 'Cost'),
            env.costChips(st.cost, st.credits, h('span', { class: 'cost num', title: 'Build time' }, `⏱ ${duration(Research.timeOf(id))}`))],
        ],
        foot,
      };
    }

    // Every second: the bench's numbers and the building node's meter, without drawing again.
    function tick() {
      if (!live) return;
      const k = lab().progress();
      live.bar.children[0].style.setProperty('--pct', `${k * 100}%`);
      live.time.textContent = left(lab().state.active || { end: live.end });
      live.node?.children[0]?.style.setProperty('--pct', `${k * 100}%`);
    }

    function reset() {
      openStat = null;
      live = null;
    }

    return { render, sheet, tick, reset, duration };
  },
};

export { ResearchView };
