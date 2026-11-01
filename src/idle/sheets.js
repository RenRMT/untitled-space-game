// The idle game's bottom sheets, in the UI kit (src/ui/kit.css, kit-lowpoly.css): a station's (its
// stock and what it sells for, its orders, its shuttle), a drill site's (its drills, the next one's
// price, its shuttle), the restoration (the next project and what it's short of) and the summary of
// time away. Each is HTML built from the state; a button's data-act names what it does, handed to
// the page (main.js) to carry out. A sheet is rebuilt only when what it shows changes, so a tap is
// never lost to a refresh; the run meters move every frame on their own (progress()).
//
//   IdleSheets.create(root, w, { act(name, args) }) -> sheets
//     sheets.show(view | null, state, now)   view: { kind: 'station' | 'site' | 'restore' | 'away', key?, away? }
//     sheets.refresh(state, now)             rebuild if anything shown changed
//     sheets.progress(now)                   move the run meters
//     sheets.view                            what's open
// ES module (`IdleSheets`); needs a browser.

import { Goods } from '../rules/goods.js';
import { Recipes } from '../rules/recipes.js';
import { Config } from './config.js';
import { IdleRules } from './rules.js';

const IdleSheets = (() => {
  const I = IdleRules.industry;
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const nameOf = (kind) => Recipes.item(kind)?.name || kind;
  const hsl = ([h, s, l]) => `hsl(${h} ${Math.round(s * 100)}% ${Math.round(l * 100)}%)`;
  const dot = (kind) => { const t = Goods.type(kind); return `<i class="idle-dot" style="--c:${t ? hsl(t.color) : 'var(--hud)'}"></i>`; };
  const counts = (o) => Object.entries(o).map(([k, n]) => `${n} ${esc(nameOf(k))}`).join(' + ');
  const cr = (n) => `${Math.round(n).toLocaleString('en')} cr`;
  const secs = (s) => (s >= 3600 ? `${+(s / 3600).toFixed(1)} h` : s >= 60 ? `${Math.round(s / 60)} min` : `${Math.round(s)} s`);
  const btn = (act, args, label, cls = 'ghost', off = false) => `<button class="ui-btn ${cls}" data-act="${act}" data-args='${esc(JSON.stringify(args))}'${off ? ' disabled' : ''}><span>${label}</span></button>`;
  const STATUS = { running: ['Running', 'var(--good)'], starved: ['Waiting for', 'var(--warn)'], blocked: ['Storage full', 'var(--warn)'], paused: ['Paused', 'var(--dim)'], done: ['Done', 'var(--dim)'] };
  const PROCESS_LABEL = { ...Object.fromEntries(Object.values(Recipes.BAYS).map((b) => [b.id, b.label])), extract: 'Drills' };

  function create(root, w, { act }) {
    let view = null, last = '';

    // ---------- Pieces ----------

    function stockBlock(state, key, now, sellHere) {
      const stock = I.stockAt(state.industry, key), e = IdleRules.env(state);
      const cap = I.capacity(state.industry, e, now, key), used = I.used(state.industry, key);
      const rows = Object.entries(stock).sort(([a], [b]) => nameOf(a).localeCompare(nameOf(b))).map(([kind, n]) => {
        const p = sellHere ? IdleRules.priceOf(state, w, key, kind, now) : null;
        const sell = p != null ? `<span class="idle-acts">${btn('sell', { key, kind, n: 1 }, `Sell 1 <b class="price">${p}</b>`)}${btn('sell', { key, kind, n }, 'All')}</span>` : '';
        return `<li class="idle-row">${dot(kind)}<span class="idle-name">${esc(nameOf(kind))}</span><span class="num">${n}</span>${sell}</li>`;
      }).join('');
      return `<div class="ui-head"><span class="ui-label">Stock</span><span class="aside">${used} / ${cap}</span></div>
        <span class="ui-meter"><span style="--pct:${Math.min(100, (used / Math.max(1, cap)) * 100)}%;--meter:${used >= cap ? 'var(--warn)' : 'var(--cyan)'}"></span></span>
        <ul class="idle-list">${rows || '<li class="ui-empty">Nothing here yet.</li>'}</ul>`;
    }

    function orderRow(state, o, cancel) {
      const R = Config.RECIPES[o.recipe], st = I.status(state.industry, o), [label, tone] = STATUS[st.id];
      const what = st.missing ? `${label} ${esc(nameOf(st.missing))}` : label;
      return `<li class="idle-order">
        <div class="idle-row">${dot(Object.keys(R.out)[0])}<span class="idle-name">${counts(R.out)}</span><span class="ui-tag" style="--tone:${tone}">${what}</span>${cancel ? btn('cancel', { id: o.id }, '✕', 'ghost idle-x') : ''}</div>
        <span class="ui-meter thin"><span data-run="${o.id}"></span></span>
        <div class="idle-sub">${Object.keys(R.in).length ? `from ${counts(R.in)} · ` : ''}${secs(R.time)} a run · made ${o.made}</div>
      </li>`;
    }

    function shuttleBlock(state, key) {
      const r = I.shuttle(state.industry, key), to = r ? r.stops[1].station : null;
      const opts = w.stations.filter((s) => s.key !== key && IdleRules.online(state, w, s.key));
      return `<div class="ui-head"><span class="ui-label">Shuttle to</span><span class="aside">${r ? `${r.cap} a trip` : 'none'}</span></div>
        <div class="idle-chips">${opts.map((s) => btn('shuttle', { from: key, to: s.key }, esc(s.name), s.key === to ? 'primary' : 'ghost')).join('')}</div>`;
    }

    // ---------- Sheets ----------

    function station(state, key, now) {
      const st = w.byKey.get(key), on = IdleRules.online(state, w, key);
      const procs = I.processes(st.type).map((p) => PROCESS_LABEL[p]).join(', ') || (st.type === 'transport hub' ? 'Routes' : 'Market');
      let html = `<header class="idle-top"><div><div class="ui-title">${esc(st.name)}</div><div class="ui-tag">${esc(procs)}${on ? '' : ' · offline'}</div></div>${btn('close', {}, '✕', 'ghost idle-x')}</header>`;
      if (!on) {
        const p = IdleRules.restoration.LIST.find((x) => x.type === st.type);
        return `${html}<p class="ui-note">Dark and cold. ${p ? `Restored by <b>${esc(p.name)}</b>, paid at the waystation.` : ''}</p>${btn('open', { kind: 'restore' }, 'Restoration', 'primary wide')}`;
      }
      html += stockBlock(state, key, now, true);
      const orders = I.at(state.industry, key), slots = IdleRules.env(state).slotsAt(key);
      if (I.processes(st.type).length) {
        html += `<div class="ui-head"><span class="ui-label">Orders</span><span class="aside">${orders.length} / ${slots}</span></div><ul class="idle-list">${orders.map((o) => orderRow(state, o, true)).join('')}</ul>`;
        if (orders.length < slots) {
          html += `<div class="ui-label idle-gap">New order</div><div class="idle-picks">${IdleRules.recipesAt(state, w, key).map((R) => btn('place', { key, recipe: R.id }, `${dot(Object.keys(R.out)[0])}${counts(R.out)} <b class="price">${Object.keys(R.in).length ? `← ${counts(R.in)}` : ''}</b>`)).join('')}</div>`;
        }
      }
      if (st !== w.waystation) html += shuttleBlock(state, key);
      return html;
    }

    function site(state, key, now) {
      const s = w.byKey.get(key), cost = IdleRules.drillCost(state, s);
      const kind = { field: 'Asteroid field', planet: 'Planet', moon: 'Moon' }[s.kind];
      let html = `<header class="idle-top"><div><div class="ui-title">${esc(s.name)}</div><div class="ui-tag">${kind} · ${s.goods.map((g) => esc(nameOf(g))).join(', ')}</div></div>${btn('close', {}, '✕', 'ghost idle-x')}</header>`;
      const drills = I.at(state.industry, key);
      html += `<div class="ui-head"><span class="ui-label">Drills</span><span class="aside">${drills.length}</span></div><ul class="idle-list">${drills.map((o) => {
        const row = orderRow(state, o, false);
        if (s.goods.length < 2) return row;
        const pick = s.goods.map((g) => btn('drill-set', { id: o.id, good: g }, esc(nameOf(g)), o.recipe === `extract.${g}` ? 'primary' : 'ghost')).join('');
        return row.replace('</li>', `<div class="idle-chips">${pick}</div></li>`);
      }).join('') || '<li class="ui-empty">No drills yet.</li>'}</ul>`;
      html += `<div class="idle-picks">${s.goods.map((g) => btn('drill', { key, good: g }, `${dot(g)}Drill for ${esc(nameOf(g))} <b class="price">${cost ? cr(cost) : 'free'}</b>`, 'primary', state.credits < cost)).join('')}</div>`;
      html += stockBlock(state, key, now, false);
      if (drills.length) html += shuttleBlock(state, key);
      return html;
    }

    function restore(state) {
      let html = `<header class="idle-top"><div><div class="ui-title">Restoration</div><div class="ui-tag">paid from ${esc(w.waystation.name)}</div></div>${btn('close', {}, '✕', 'ghost idle-x')}</header>`;
      const p = IdleRules.nextProject(state);
      if (!p) return `${html}<p class="ui-note">Every station is back online.</p>`;
      const s = IdleRules.projectStatus(state, w, p.id), stock = I.stockAt(state.industry, w.waystation.key);
      html += `<div class="ui-head"><span class="ui-label">${esc(p.name)}</span></div><p class="ui-note">${esc(p.note)}</p><ul class="idle-list">`;
      for (const [kind, need] of Object.entries(p.goods)) {
        const have = stock[kind] || 0;
        html += `<li class="idle-row">${dot(kind)}<span class="idle-name">${esc(nameOf(kind))}</span><span class="num" style="color:${have >= need ? 'var(--good)' : 'var(--warn)'}">${Math.min(have, need)} / ${need}</span></li>`;
      }
      html += `<li class="idle-row"><span class="idle-name">Credits</span><span class="num" style="color:${state.credits >= p.credits ? 'var(--good)' : 'var(--warn)'}">${cr(p.credits)}</span></li></ul>`;
      html += btn('restore', { id: p.id }, 'Restore', 'primary lg wide', s.id !== 'ready');
      const done = IdleRules.restoration.LIST.filter((x) => state.restored.includes(x.id));
      if (done.length) html += `<div class="ui-label idle-gap">Restored</div><ul class="idle-list">${done.map((x) => `<li class="idle-row"><span class="idle-name">${esc(x.name)}</span><span class="ui-tag" style="--tone:var(--good)">Online</span></li>`).join('')}</ul>`;
      return html;
    }

    function away(a) {
      const lines = (m) => [...m.entries()].map(([id, n]) => { const [name, kind] = id.split('|'); return `<li class="idle-row">${dot(kind)}<span class="idle-name">${esc(name)}</span><span class="num">${n} ${esc(nameOf(kind))}</span></li>`; }).join('');
      return `<header class="idle-top"><div><div class="ui-title">While you were away</div><div class="ui-tag">${secs(a.ms / 1000)}</div></div>${btn('close', {}, '✕', 'ghost idle-x')}</header>
        <div class="ui-label">Made</div><ul class="idle-list">${lines(a.made) || '<li class="ui-empty">Nothing.</li>'}</ul>
        <div class="ui-label idle-gap">Delivered</div><ul class="idle-list">${lines(a.delivered) || '<li class="ui-empty">Nothing.</li>'}</ul>
        ${a.stuck.length ? `<div class="ui-label idle-gap">Stopped</div><ul class="idle-list">${a.stuck.map((x) => `<li class="idle-row"><span class="idle-name">${esc(x.name)}</span><span class="ui-tag" style="--tone:var(--warn)">${esc(x.why)}</span>${btn('open', { kind: IdleRules.isSite(x.key) ? 'site' : 'station', key: x.key }, 'Open')}</li>`).join('')}</ul>` : ''}
        ${btn('close', {}, 'Carry on', 'primary lg wide')}`;
    }

    // ---------- Showing ----------

    function build(state, now) {
      if (!view) return '';
      if (view.kind === 'station') return station(state, view.key, now);
      if (view.kind === 'site') return site(state, view.key, now);
      if (view.kind === 'restore') return restore(state, now);
      if (view.kind === 'away') return away(view.away);
      return '';
    }
    let runs = [];
    function refresh(state, now) {
      const html = build(state, now);
      root.hidden = !html;
      if (html !== last) { root.innerHTML = html; last = html; }
      runs = I.at(state.industry, view?.key || '').map((o) => ({ id: o.id, at: o.at, next: o.next }));
      progress(now);
    }
    function progress(now) {
      for (const r of runs) {
        const el = root.querySelector(`[data-run="${r.id}"]`);
        if (el) el.style.setProperty('--pct', `${r.next == null ? 0 : Math.min(100, ((now - r.at) / Math.max(1, r.next - r.at)) * 100)}%`);
      }
    }
    function show(v, state, now) { view = v; last = ''; refresh(state, now); }

    root.addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]');
      if (!b || b.disabled) return;
      act(b.dataset.act, JSON.parse(b.dataset.args || '{}'));
    });

    return { show, refresh, progress, get view() { return view; } };
  }

  return { create };
})();

export { IdleSheets };
