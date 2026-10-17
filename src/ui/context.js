// The context menu: tap something in space and it shows around it, as the map's callout does
// (ui/callout.js): what it is above it (name, details, why an action can't be done yet), and what
// you can do with it (Dock, Mine, Jump, Approach, ...) as round icon buttons fanned out below it.
// game/selection.js decides the contents every frame and calls show(); the flight view's renderer
// calls place() each frame with where the thing is on screen. The DOM is only rebuilt when
// something visible changes, apart from progress rings and positions.
//
//   ContextCard.show({ title, subtitle, tag, tone, color, detail?, actions: [{ id, label, enabled, busy, progress, title }] })
//     detail: a line folded under the title until the title row is tapped (its tag shows ▾)
//     each action's icon is its id's line icon (ui/glyphs.js); its label is its name to screen
//     readers and as a tooltip, and the first that can't be done says why above the thing
//   ContextCard.place(x, y, r)           anchor it on (x, y), screen px, around something r px across
//   ContextCard.hide()
//   ContextCard.onAction = (id) => ...   a button was pressed
//   ContextCard.onClose = () => ...      the close button was pressed
// ES module (`ContextCard`); needs a browser.

import { Store } from '../core/store.js';
import { Theme } from '../core/theme.js';
import { Glyphs } from './glyphs.js';
import { UI } from './ui.js';

const ContextCard = (() => {
  const EDGE = 8; // px kept clear of the screen's edges
  const BTN = 44; // a button's size (the touch target, --hit)
  const GAP = 10; // px between buttons along their arc
  const LABEL_GAP = 26; // ... when they carry their names below them
  // Each action's name shows under its round button until it has been used LEARN times: icons
  // alone mean little at first, and tooltips never appear on touch screens.
  const LEARN = 5;
  const uses = Store.getJSON('actionUses', {}) || {};
  const learning = (id) => (uses[id] || 0) < LEARN;
  let gap = GAP;
  const root = document.getElementById('context');
  const el = (cls) => root.querySelector(cls);
  const infoEl = el('.cx-info'), titleEl = el('.cx-title'), tagEl = el('.cx-tag'), subEl = el('.cx-sub'), stateEl = el('.cx-state'), actionsEl = el('.cx-actions');
  const view = UI.keyed(); // what the DOM shows, to skip unchanged frames (ui/ui.js)
  let onAction = null, onClose = null;
  let anchor = null; // { x, y, r } from place()

  // A detail line (a pirate pack's size and gear) folds away under the title; a tap on the title
  // row shows it.
  const headEl = el('.cx-head'), detailEl = el('.cx-detail');
  let detail = '', detailOpen = false, shownTitle = null;
  headEl.addEventListener('click', (e) => {
    if (!detail || e.target.closest('.cx-close')) return;
    detailOpen = !detailOpen;
    view.reset(); // redrawn on the next frame
  });
  el('.cx-close').addEventListener('click', () => onClose && onClose());
  actionsEl.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-id]');
    if (!b || b.disabled) return;
    const id = b.dataset.id;
    if (learning(id)) { uses[id] = (uses[id] || 0) + 1; Store.setJSON('actionUses', uses); }
    if (onAction) onAction(id);
  });

  // Buttons are updated in place while the same actions are offered, so a press isn't lost to a
  // rebuild between pointer down and up.
  function setButton(b, a) {
    b.className = `cx-act${a.busy ? ' busy' : ''}`;
    b.dataset.id = a.id;
    b.disabled = !a.enabled;
    b.title = a.title || a.label;
    b.setAttribute('aria-label', a.label);
    const name = learning(a.id) ? a.label : '';
    if (b.dataset.glyph !== a.id || b.dataset.name !== name) {
      b.dataset.glyph = a.id;
      b.dataset.name = name;
      b.innerHTML = Glyphs.svg(Glyphs.has(a.id) ? a.id : 'approach', 24);
      if (name) b.append(UI.h('span', { class: 'cx-lbl', 'aria-hidden': 'true' }, name));
    }
  }

  function show(d) {
    const why = d.actions.find((a) => !a.enabled || a.busy);
    if (d.title !== shownTitle) { shownTitle = d.title; detailOpen = false; } // a new thing: its detail folded
    detail = d.detail || '';
    if (view.changed([d.title, d.subtitle, d.tag, d.tone, d.color, why ? why.label : '', detail, detailOpen, d.actions.map((a) => [a.id, a.label, a.enabled, a.busy, a.title])])) {
      root.hidden = false;
      root.style.setProperty('--accent', d.color || '');
      titleEl.textContent = d.title;
      tagEl.textContent = d.tag ? `${d.tag}${detail ? (detailOpen ? ' ▴' : ' ▾') : ''}` : '';
      tagEl.hidden = !d.tag;
      headEl.classList.toggle('more', !!detail);
      headEl.setAttribute('aria-expanded', detail ? String(detailOpen) : '');
      detailEl.textContent = detail;
      detailEl.hidden = !detail || !detailOpen;
      tagEl.className = `cx-tag ${d.tone || ''}`;
      subEl.textContent = d.subtitle || '';
      stateEl.textContent = why ? why.label : '';
      stateEl.hidden = !why;
      const buttons = [...actionsEl.children];
      if (buttons.length === d.actions.length && buttons.every((b, i) => b.dataset.id === d.actions[i].id)) {
        d.actions.forEach((a, i) => setButton(buttons[i], a));
      } else {
        actionsEl.replaceChildren(...d.actions.map((a) => {
          const b = UI.h('button', { type: 'button' });
          setButton(b, a);
          return b;
        }));
      }
      gap = d.actions.some((a) => learning(a.id)) ? LABEL_GAP : GAP;
      if (anchor) place(anchor.x, anchor.y, anchor.r);
    }
    // Progress rings fill every frame without rebuilding the buttons.
    for (const a of d.actions) {
      if (a.progress === undefined) continue;
      const b = actionsEl.querySelector(`button[data-id="${a.id}"]`);
      const p = `${(Math.min(1, a.progress) * 100).toFixed(1)}%`;
      if (b && b.dataset.progress !== p) { b.dataset.progress = p; b.style.setProperty('--progress', p); }
    }
  }

  // The details centred above the thing, the buttons on an arc below it, all kept on screen. A thing
  // off the screen (or too near its edge for all that) has its menu at the edge nearest it, as if
  // it were a point there.
  function place(sx, sy, sr) {
    anchor = { x: sx, y: sy, r: sr };
    if (!view.shown) return;
    // The card is zoomed by the text size setting (index.html), so it works in its own, zoomed, px.
    const k = Theme.scale;
    const x0 = sx / k, y0 = sy / k, r0 = sr / k;
    const W = window.innerWidth / k, H = window.innerHeight / k;
    const clampX = (v, w) => Math.max(EDGE, Math.min(W - EDGE - w, v));
    const clampY = (v, h) => Math.max(EDGE, Math.min(H - EDGE - h, v));
    const iw = infoEl.offsetWidth || 0, ih = infoEl.offsetHeight || 0;
    const x = Math.max(EDGE + BTN, Math.min(W - EDGE - BTN, x0));
    const y = Math.max(EDGE + ih + 12 + r0, Math.min(H - EDGE - BTN * 2 - 14 - r0 - (gap > GAP ? 16 : 0), y0));
    const r = x === x0 && y === y0 ? r0 : Math.min(r0, 24);
    infoEl.style.transform = `translate(${Math.round(clampX(x - iw / 2, iw))}px, ${Math.round(clampY(y - r - 12 - ih, ih))}px)`;
    const buttons = [...actionsEl.children], n = buttons.length;
    const R = r + 14 + BTN / 2, step = (BTN + gap) / R; // radians between button centres
    buttons.forEach((b, i) => {
      const a = Math.PI / 2 + (i - (n - 1) / 2) * step; // fanned out round straight down
      const bx = clampX(x + Math.cos(a) * R - BTN / 2, BTN), by = clampY(y + Math.sin(a) * R - BTN / 2, BTN);
      b.style.transform = `translate(${Math.round(bx)}px, ${Math.round(by)}px)`;
    });
  }

  function hide() {
    if (!view.shown) return;
    view.reset();
    root.hidden = true;
    anchor = null;
    actionsEl.replaceChildren();
  }

  return {
    show, hide, place,
    get isOpen() { return view.shown; },
    set onAction(f) { onAction = f; },
    set onClose(f) { onClose = f; },
  };
})();

export { ContextCard };
