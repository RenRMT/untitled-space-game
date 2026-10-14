'use strict';

// The combat panel: shown above the speed bar while a fight runs, in place of the context card.
// One row per ship (you first) with hull and shield bars; tap an enemy row to focus your fire on
// it. Below, the latest of what happened, and a button: Flee in round-based fights, none while a
// real-time fight runs (you flee by flying), Close once the fight is over. The bar under the
// title shows progress: the round timer, or in real time the lock coming on ('lock') or getting
// clear ('escape').
// game.js describes it every frame; the DOM is rebuilt only when something visible changes,
// apart from the progress bar.
//
//   CombatPanel.show({ title, tone, rows: [{ id, name, you, hull, maxHull, shield, maxShield, focus }],
//                      log: [string], button: { id: 'flee' | 'close', label, enabled } | null,
//                      progress, bar?: 'lock' | 'escape' })
//   CombatPanel.hide()
//   CombatPanel.onFocus = (id) => ...; CombatPanel.onButton = (id) => ...
// Browser script (global `CombatPanel`).

const CombatPanel = (() => {
  const root = document.getElementById('combat');
  const q = (cls) => root.querySelector(cls);
  const titleEl = q('.cb-title'), rowsEl = q('.cb-rows'), logEl = q('.cb-log'), btn = q('.cb-btn'), timer = q('.cb-timer');
  let shown = '';
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

  function row(r) {
    const n = document.createElement(r.you || r.hull <= 0 ? 'div' : 'button');
    n.className = `cb-row${r.you ? ' you' : ''}${r.focus ? ' focus' : ''}${r.hull <= 0 ? ' down' : ''}`;
    if (!r.you && r.hull > 0) {
      n.type = 'button';
      n.dataset.id = r.id;
      n.setAttribute('aria-pressed', String(!!r.focus));
      n.title = 'Focus fire on this ship';
    }
    const name = document.createElement('span');
    name.className = 'cb-name';
    name.textContent = r.hull <= 0 ? `${r.name} · destroyed` : r.name;
    const bars = document.createElement('span');
    bars.className = 'cb-bars';
    bars.setAttribute('aria-label', `Hull ${Math.ceil(r.hull)} of ${r.maxHull}, shield ${Math.floor(r.shield)} of ${r.maxShield}`);
    for (const [cls, v, max] of [['shd', r.shield, r.maxShield], ['hul', r.hull, r.maxHull]]) {
      const bar = document.createElement('span');
      bar.className = `cb-bar ${cls}`;
      const fill = document.createElement('span');
      fill.style.width = pct(v, max);
      bar.append(fill);
      bars.append(bar);
    }
    const nums = document.createElement('span');
    nums.className = 'cb-nums';
    nums.textContent = `${Math.ceil(r.hull)} · ${Math.floor(r.shield)}`;
    n.append(name, bars, nums);
    return n;
  }

  function show(d) {
    const key = JSON.stringify([d.title, d.tone, d.log, d.button, d.bar || '',
      d.rows.map((r) => [r.id, r.name, Math.ceil(r.hull), Math.floor(r.shield), r.focus])]);
    if (key !== shown) {
      shown = key;
      root.hidden = false;
      root.className = d.tone || '';
      titleEl.textContent = d.title;
      rowsEl.replaceChildren(...d.rows.map(row));
      logEl.replaceChildren(...d.log.map((line) => Object.assign(document.createElement('div'), { textContent: line })));
      btn.hidden = !d.button;
      if (d.button) {
        btn.dataset.id = d.button.id;
        btn.textContent = d.button.label;
        btn.disabled = !d.button.enabled;
      }
      timer.className = `cb-timer${d.bar ? ` ${d.bar}` : ''}`;
    }
    timer.style.width = `${(Math.max(0, Math.min(1, d.progress || 0)) * 100).toFixed(1)}%`;
  }

  function hide() {
    if (!shown) return;
    shown = '';
    root.hidden = true;
    rowsEl.replaceChildren();
  }

  return {
    show, hide,
    get isOpen() { return !!shown; },
    set onFocus(f) { onFocus = f; },
    set onButton(f) { onButton = f; },
  };
})();
