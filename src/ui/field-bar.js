// The field bar: a button for each consumable in the kit that can be used out in the field
// (rules/abilities.js FIELD: repair nanites, shield cells, coolant flushes, radiation purges, fuel
// canisters, seismic charges), stacked up the right-hand side above the corner buttons. Each shows
// its icon (by its code) and the charges left, dimmed while it's cooling down or wouldn't help.
// game/field.js describes it every frame; the DOM is rebuilt only when something on it changes.
//
//   FieldBar.show([{ id, code, label, count, enabled, key }])   key: its keyboard shortcut ('1')
//   FieldBar.hide()
//   FieldBar.onUse = (id) => ...
// ES module (`FieldBar`); needs a browser.

import { Kit } from './kit.js';
import { UI } from './ui.js';

const FieldBar = (() => {
  const root = document.getElementById('field');
  const { h } = UI;
  const view = UI.keyed();
  let onUse = null;
  root.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-id]');
    if (b && !b.disabled && onUse) onUse(b.dataset.id);
  });

  function show(items) {
    if (!items.length) { hide(); return; }
    if (!view.changed(items)) return;
    root.hidden = false;
    root.replaceChildren(...items.map((a) => h('button', {
      class: 'fb-ab', type: 'button', 'data-id': a.id, disabled: !a.enabled,
      title: `${a.label} · ${a.count} left${a.key ? ` (${a.key})` : ''}`, 'aria-label': `${a.label}, ${a.count} left`,
    }, Kit.icon(a.code, 22, { code: a.code }), h('span', { class: 'n' }, `×${a.count}`))));
  }

  function hide() {
    if (!view.shown) return;
    view.reset();
    root.hidden = true;
    root.replaceChildren();
  }

  return {
    show, hide,
    set onUse(f) { onUse = f; },
  };
})();

export { FieldBar };
