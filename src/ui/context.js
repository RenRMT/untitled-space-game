// The context menu: tap something in space and it shows around it, as the map's callout does
// (ui/callout.js): what it is above it (name, details, why an action can't be done yet), and what
// you can do with it (Dock, Mine, Jump, Approach, ...) as round icon buttons fanned out below it.
// game/selection.js decides the contents every frame and calls show(); the flight view's renderer
// calls place() each frame with where the thing is on screen. The DOM is only rebuilt when
// something visible changes, apart from progress rings and positions.
//
//   ContextCard.show({ title, subtitle, tag, tone, color, actions: [{ id, label, enabled, busy, progress, title }] })
//     each action's icon is its id's line icon (ui/glyphs.js); its label is its name to screen
//     readers and as a tooltip, and the first that can't be done says why above the thing
//   ContextCard.place(x, y, r)           anchor it on (x, y), screen px, around something r px across
//   ContextCard.hide()
//   ContextCard.onAction = (id) => ...   a button was pressed
//   ContextCard.onClose = () => ...      the close button was pressed
// ES module (`ContextCard`); needs a browser.

import { Theme } from '../core/theme.js';
import { Glyphs } from './glyphs.js';
import { UI } from './ui.js';

const ContextCard = (() => {
  const EDGE = 8; // px kept clear of the screen's edges
  const BTN = 44; // a button's size (the touch target, --hit)
  const GAP = 10; // px between buttons along their arc
  const root = document.getElementById('context');
  const el = (cls) => root.querySelector(cls);
  const infoEl = el('.cx-info'), titleEl = el('.cx-title'), tagEl = el('.cx-tag'), subEl = el('.cx-sub'), stateEl = el('.cx-state'), actionsEl = el('.cx-actions');
  const view = UI.keyed(); // what the DOM shows, to skip unchanged frames (ui/ui.js)
  let onAction = null, onClose = null;
  let anchor = null; // { x, y, r } from place()

  el('.cx-close').addEventListener('click', () => onClose && onClose());
  actionsEl.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-id]');
    if (b && !b.disabled && onAction) onAction(b.dataset.id);
  });

  // Buttons are updated in place while the same actions are offered, so a press isn't lost to a
  // rebuild between pointer down and up.
  function setButton(b, a) {
    b.className = `cx-act${a.busy ? ' busy' : ''}`;
    b.dataset.id = a.id;
    b.disabled = !a.enabled;
    b.title = a.title || a.label;
    b.setAttribute('aria-label', a.label);
    if (b.dataset.glyph !== a.id) {
      b.dataset.glyph = a.id;
      b.innerHTML = Glyphs.svg(Glyphs.has(a.id) ? a.id : 'approach', 24);
    }
  }

  function show(d) {
    const why = d.actions.find((a) => !a.enabled || a.busy);
    if (view.changed([d.title, d.subtitle, d.tag, d.tone, d.color, why ? why.label : '', d.actions.map((a) => [a.id, a.label, a.enabled, a.busy, a.title])])) {
      root.hidden = false;
      root.style.setProperty('--accent', d.color || '');
      titleEl.textContent = d.title;
      tagEl.textContent = d.tag || '';
      tagEl.hidden = !d.tag;
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
    const y = Math.max(EDGE + ih + 12 + r0, Math.min(H - EDGE - BTN * 2 - 14 - r0, y0));
    const r = x === x0 && y === y0 ? r0 : Math.min(r0, 24);
    infoEl.style.transform = `translate(${Math.round(clampX(x - iw / 2, iw))}px, ${Math.round(clampY(y - r - 12 - ih, ih))}px)`;
    const buttons = [...actionsEl.children], n = buttons.length;
    const R = r + 14 + BTN / 2, step = (BTN + GAP) / R; // radians between button centres
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
