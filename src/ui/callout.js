// A selection callout: what is selected on a canvas, shown around it. Short lines of text above the
// selected thing (its name, its security, ...) and its actions as buttons below, both centred on it
// and following it as the view pans and zooms. The map's local view uses it; any canvas view with a
// selection can make its own.
//
//   const c = Callout.create(host, { onAction(id) })   one per view; host: the element it is put in
//   c.show({ lines: [{ text, color, kind: 'name' | 'meta' }], actions: [{ id, label, enabled, title, kind }] })
//     kind: 'primary' for the main action (cyan)
//   c.place(x, y, gap)   anchor it at (x, y) in the host's px: the lines end `gap` px above, the
//                        actions start `gap` px below; kept inside the host. Cheap: moves only.
//   c.hide(), c.isShown, c.content (what show() was last given; null while hidden)
// The DOM is only rebuilt when the contents change; buttons are updated in place while the same
// actions are offered, so a press isn't lost to a rebuild between pointer down and up.
// ES module (`Callout`); needs a browser.

import { UI } from './ui.js';

const Callout = (() => {
  const EDGE = 8; // px kept clear of the host's edges

  function create(host, { onAction } = {}) {
    const { h } = UI; // ui/ui.js
    const above = h('div', { class: 'co-above' });
    const below = h('div', { class: 'co-below' });
    const root = h('div', { class: 'callout' }, above, below);
    root.hidden = true;
    host.append(root);
    const view = UI.keyed();
    let shown = false;
    let actionIds = '';
    let content = null; // what show() was last given, while shown

    below.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-id]');
      if (b && !b.disabled && onAction) onAction(b.dataset.id);
    });

    function setButton(b, a) {
      b.className = `btn${a.kind === 'primary' ? ' primary' : ''}`;
      b.dataset.id = a.id;
      b.disabled = !a.enabled;
      if (b.textContent !== a.label) b.textContent = a.label;
      b.title = a.title || '';
    }

    function show({ lines = [], actions = [] }) {
      shown = true;
      root.hidden = false;
      content = { lines, actions };
      if (!view.changed([lines, actions])) return;
      above.replaceChildren(...lines.map((l) => h('div', { class: `co-${l.kind || 'meta'}`, style: l.color ? { color: l.color } : null }, l.text)));
      const ids = actions.map((a) => a.id).join(' ');
      if (ids !== actionIds) {
        actionIds = ids;
        below.replaceChildren(...actions.map(() => h('button', { type: 'button' })));
      }
      actions.forEach((a, i) => setButton(below.children[i], a));
    }

    function hide() {
      if (!shown) return;
      shown = false;
      content = null;
      root.hidden = true;
      view.reset();
      actionIds = '';
      above.replaceChildren();
      below.replaceChildren();
    }

    // A stack centred on x, kept inside the host.
    function put(stack, x, y, up) {
      const w = stack.getBoundingClientRect().width || 0;
      const hostW = host.clientWidth || window.innerWidth;
      const left = Math.max(EDGE, Math.min(hostW - EDGE - w, x - w / 2));
      stack.style.transform = `translate(${Math.round(left)}px, ${Math.round(y)}px)${up ? ' translateY(-100%)' : ''}`;
    }

    function place(x, y, gap = 10) {
      if (!shown) return;
      const hostH = host.clientHeight || window.innerHeight;
      const off = x < 0 || y < 0 || x > (host.clientWidth || window.innerWidth) || y > hostH;
      root.hidden = off;
      if (off) return;
      put(above, x, y - gap, true);
      put(below, x, y + gap, false);
    }

    return { show, hide, place, get isShown() { return shown; }, get content() { return content; } };
  }

  return { create };
})();

export { Callout };
