'use strict';

// The context card: tap something in space and this card shows what it is and what you can do
// with it (Dock, Mine, Jump, Approach, ...). game.js decides the contents every frame and calls
// show(); the DOM is only rebuilt when something visible changes, apart from progress bars.
//
//   ContextCard.show({ title, subtitle, tag, tone, color, actions: [{ id, label, enabled, busy, progress, title }] })
//   ContextCard.hide()
//   ContextCard.onAction = (id) => ...   a button was pressed
//   ContextCard.onClose = () => ...      the close button was pressed
// Browser script (global `ContextCard`).

const ContextCard = (() => {
  const root = document.getElementById('context');
  const el = (cls) => root.querySelector(cls);
  const titleEl = el('.cx-title'), tagEl = el('.cx-tag'), subEl = el('.cx-sub'), actionsEl = el('.cx-actions');
  let shown = ''; // what the DOM shows, to skip unchanged frames
  let onAction = null, onClose = null;

  el('.cx-close').addEventListener('click', () => onClose && onClose());
  actionsEl.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-id]');
    if (b && !b.disabled && onAction) onAction(b.dataset.id);
  });

  // Buttons are updated in place while the same actions are offered, so a press isn't lost to a
  // rebuild between pointer down and up (the distance in the subtitle changes all the time).
  function setButton(b, a) {
    b.className = `btn${a.busy ? ' busy' : ''}`;
    b.dataset.id = a.id;
    b.disabled = !a.enabled;
    if (b.textContent !== a.label) b.textContent = a.label;
    b.title = a.title || '';
  }

  function show(d) {
    const key = JSON.stringify([d.title, d.subtitle, d.tag, d.tone, d.color,
      d.actions.map((a) => [a.id, a.label, a.enabled, a.busy, a.title])]);
    if (key !== shown) {
      shown = key;
      root.hidden = false;
      root.style.setProperty('--accent', d.color || '');
      titleEl.textContent = d.title;
      tagEl.textContent = d.tag || '';
      tagEl.hidden = !d.tag;
      tagEl.className = `cx-tag ${d.tone || ''}`;
      subEl.textContent = d.subtitle || '';
      const buttons = [...actionsEl.children];
      if (buttons.length === d.actions.length && buttons.every((b, i) => b.dataset.id === d.actions[i].id)) {
        d.actions.forEach((a, i) => setButton(buttons[i], a));
      } else {
        actionsEl.replaceChildren(...d.actions.map((a) => {
          const b = document.createElement('button');
          b.type = 'button';
          setButton(b, a);
          return b;
        }));
      }
    }
    // Progress bars move every frame without rebuilding the buttons.
    for (const a of d.actions) {
      if (a.progress === undefined) continue;
      const b = actionsEl.querySelector(`button[data-id="${a.id}"]`);
      if (b) b.style.setProperty('--progress', `${(Math.min(1, a.progress) * 100).toFixed(1)}%`);
    }
  }

  function hide() {
    if (!shown) return;
    shown = '';
    root.hidden = true;
    actionsEl.replaceChildren();
  }

  return {
    show, hide,
    get isOpen() { return !!shown; },
    set onAction(f) { onAction = f; },
    set onClose(f) { onClose = f; },
  };
})();
