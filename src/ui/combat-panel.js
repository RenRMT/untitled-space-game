// The combat panel: shown above the speed bar while a fight runs, in place of the context card.
// One row per ship (you first, then your squad) with hull and shield bars; tap an enemy row to
// focus your fire on it. Below, the latest of what happened, and a button: Flee in round-based fights, none while a
// real-time fight runs (you flee by flying), Close once the fight is over. The bar under the
// title shows progress: the round timer, or in real time the lock coming on ('lock') or getting
// clear ('escape').
// game.js describes it every frame; the DOM is rebuilt only when the rows, log or button change.
// Hull and shield readings update the bars in place, and the progress bar is set only when it moves.
//
//   CombatPanel.show({ title, tone, rows: [{ id, name, you, ally, hull, maxHull, shield, maxShield, focus }],
//                      log: [string], button: { id: 'flee' | 'close', label, enabled } | null,
//                      progress, bar?: 'lock' | 'escape' })
//   CombatPanel.hide()
//   CombatPanel.onFocus = (id) => ...; CombatPanel.onButton = (id) => ...
//   CombatPanel.top   its top edge on screen, null while hidden (UI.topEdge)
// ES module (`CombatPanel`); needs a browser.

import { UI } from './ui.js';

const CombatPanel = (() => {
  const root = document.getElementById('combat');
  const q = (cls) => root.querySelector(cls);
  const titleEl = q('.cb-title'), rowsEl = q('.cb-rows'), logEl = q('.cb-log'), btn = q('.cb-btn'), timer = q('.cb-timer');
  const { h } = UI; // ui/ui.js
  const view = UI.keyed(); // what the DOM shows, to skip unchanged frames
  const values = UI.keyed(); // the rows' hull and shield readings
  let bars = []; // per row: its bar and number elements, to update in place
  let timerWidth = '';
  const baseClass = root.className; // 'panel' (index.html), plus the tone while one is shown
  const edge = UI.topEdge(root);
  let onFocus = null, onButton = null;

  // Focus on pointer down: the rows are rebuilt every round, which could swallow a click whose
  // down and up land either side of it. Keyboard presses arrive as clicks with detail 0.
  const focusFrom = (e) => {
    const r = e.target.closest('[data-id]');
    if (r && onFocus) onFocus(r.dataset.id);
  };
  rowsEl.addEventListener('pointerdown', focusFrom);
  rowsEl.addEventListener('click', (e) => { if (e.detail === 0) focusFrom(e); });
  btn.addEventListener('click', () => onButton && !btn.disabled && onButton(btn.dataset.id));

  const pct = (v, max) => `${max > 0 ? Math.max(0, Math.min(100, (v / max) * 100)).toFixed(1) : 0}%`;

  // An enemy still flying is a button (focus fire on it); you, your squad and the destroyed are
  // plain rows. A squad member shot down is disabled, not destroyed.
  function row(r) {
    const down = r.hull <= 0, pick = !r.you && !r.ally && !down;
    return h(pick ? 'button' : 'div', {
      class: `cb-row${r.you || r.ally ? ' you' : ''}${r.focus ? ' focus' : ''}${down ? ' down' : ''}`,
      type: pick && 'button', 'data-id': pick && r.id, 'aria-pressed': pick && String(!!r.focus), title: pick && 'Focus fire on this ship',
    },
    h('span', { class: 'cb-name' }, down ? `${r.name} · ${r.ally ? 'disabled' : 'destroyed'}` : r.name),
    h('span', { class: 'cb-bars', 'aria-label': `Hull ${Math.ceil(r.hull)} of ${r.maxHull}, shield ${Math.floor(r.shield)} of ${r.maxShield}` },
      [['shd', r.shield, r.maxShield], ['hul', r.hull, r.maxHull]].map(([cls, v, max]) => h('span', { class: `cb-bar ${cls}` }, h('span', { style: { width: pct(v, max) } })))),
    h('span', { class: 'cb-nums' }, `${Math.ceil(r.hull)} · ${Math.floor(r.shield)}`));
  }

  // A row's readings into its elements: the two bars' widths, the numbers and the label.
  function setReadings(el, r) {
    el.bars.setAttribute('aria-label', `Hull ${Math.ceil(r.hull)} of ${r.maxHull}, shield ${Math.floor(r.shield)} of ${r.maxShield}`);
    el.shd.style.width = pct(r.shield, r.maxShield);
    el.hul.style.width = pct(r.hull, r.maxHull);
    el.nums.textContent = `${Math.ceil(r.hull)} · ${Math.floor(r.shield)}`;
  }

  function show(d) {
    const readings = d.rows.map((r) => [Math.ceil(r.hull), Math.floor(r.shield)]);
    if (view.changed([d.title, d.tone, d.log, d.button, d.bar || '', d.rows.map((r) => [r.id, r.name, r.hull <= 0, r.focus])])) {
      root.hidden = false;
      root.className = d.tone ? `${baseClass} ${d.tone}` : baseClass;
      titleEl.textContent = d.title;
      const els = d.rows.map(row);
      rowsEl.replaceChildren(...els);
      bars = els.map((el) => {
        const [, barsEl, nums] = el.children;
        return { bars: barsEl, shd: barsEl.children[0].children[0], hul: barsEl.children[1].children[0], nums };
      });
      values.changed(readings);
      logEl.replaceChildren(...d.log.map((line) => h('div', {}, line)));
      btn.hidden = !d.button;
      if (d.button) {
        btn.dataset.id = d.button.id;
        btn.textContent = d.button.label;
        btn.disabled = !d.button.enabled;
      }
      timer.className = `cb-timer${d.bar ? ` ${d.bar}` : ''}`;
    } else if (values.changed(readings)) {
      d.rows.forEach((r, i) => setReadings(bars[i], r));
    }
    const width = `${(Math.max(0, Math.min(1, d.progress || 0)) * 100).toFixed(1)}%`;
    if (width !== timerWidth) timer.style.width = timerWidth = width;
  }

  function hide() {
    if (!view.shown) return;
    view.reset();
    values.reset();
    timerWidth = '';
    bars = [];
    root.hidden = true;
    rowsEl.replaceChildren();
  }

  return {
    show, hide,
    get isOpen() { return view.shown; },
    get top() { return edge.top; },
    set onFocus(f) { onFocus = f; },
    set onButton(f) { onButton = f; },
  };
})();

export { CombatPanel };
