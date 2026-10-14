'use strict';

// The settings menu: one panel for the game's options, opened with the Settings button in flight.
// Each option registers itself with add() and shows as a row of choices, with a line explaining
// the selected one. Options keep their own state; this only draws them and passes clicks on.
//
//   Settings.add({ id, label, shortcut?, choices: [{ value, label, hint }], get(), set(value),
//                  note?, locked?() -> reason string | null })
//   Settings.open(), Settings.close(), Settings.refresh(), Settings.isOpen
//   Settings.onToggle = (open) => ...   called when the panel opens or closes
// Browser script (global `Settings`).

const Settings = (() => {
  const root = document.getElementById('settings');
  const body = root.querySelector('.set-body');
  const options = [];
  let isOpen = false;
  let onToggle = null;
  let returnFocus = null;

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  function choose(o, value) {
    if (o.get() === value || (o.locked && o.locked())) return;
    o.set(value);
    render(o.id);
  }

  // One option: its label, the choices as a radio group, the selected choice's hint, and a note
  // (or why it can't be changed right now).
  function group(o) {
    const current = o.get();
    const locked = o.locked ? o.locked() : null;
    const g = el('section', 'set-group');
    const head = el('div', 'set-label');
    const name = el('span', '', o.label);
    name.id = `set-${o.id}-label`;
    head.append(name);
    if (o.shortcut) head.append(el('kbd', '', o.shortcut));
    const seg = el('div', 'seg');
    seg.setAttribute('role', 'radiogroup');
    seg.setAttribute('aria-labelledby', name.id);
    for (const c of o.choices) {
      const b = el('button', 'btn', c.label);
      b.type = 'button';
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(c.value === current));
      b.tabIndex = c.value === current ? 0 : -1;
      b.disabled = !!locked && c.value !== current;
      b.dataset.option = o.id;
      b.dataset.value = c.value;
      b.addEventListener('click', () => choose(o, c.value));
      seg.append(b);
    }
    // Arrow keys move through the choices, as in any radio group.
    seg.addEventListener('keydown', (e) => {
      const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
      if (!step || locked) return;
      e.preventDefault();
      const i = o.choices.findIndex((c) => c.value === o.get());
      choose(o, o.choices[(i + step + o.choices.length) % o.choices.length].value);
    });
    const hint = (o.choices.find((c) => c.value === current) || {}).hint;
    g.append(head, seg);
    if (hint) g.append(el('p', 'set-hint', hint));
    if (locked) g.append(el('p', 'set-note locked', locked));
    else if (o.note) g.append(el('p', 'set-note', o.note));
    return g;
  }

  // Rebuild the panel; keep focus on the option that just changed.
  function render(focusId) {
    if (!isOpen) return;
    body.replaceChildren(...options.map(group));
    if (focusId) {
      const b = body.querySelector(`[data-option="${focusId}"][aria-checked="true"]`);
      if (b) b.focus();
    }
  }

  function open() {
    if (isOpen) return;
    isOpen = true;
    returnFocus = document.activeElement;
    root.hidden = false;
    render();
    const first = body.querySelector('[aria-checked="true"]');
    if (first) first.focus({ preventScroll: true });
    if (onToggle) onToggle(true);
  }

  function close() {
    if (!isOpen) return;
    isOpen = false;
    root.hidden = true;
    body.replaceChildren();
    if (returnFocus && returnFocus.focus) returnFocus.focus({ preventScroll: true });
    if (onToggle) onToggle(false);
  }

  root.querySelector('.set-close').addEventListener('click', close);
  root.addEventListener('pointerdown', (e) => { if (e.target === root) close(); }); // the backdrop
  // While open: Escape closes, arrow keys reach the choice groups, Tab stays inside the panel, and
  // the game's and map's shortcuts (V, C, M, ...) are held back.
  window.addEventListener('keydown', (e) => {
    if (!isOpen) return;
    if (e.key === 'Escape') { close(); e.stopImmediatePropagation(); return; }
    if (e.key.startsWith('Arrow')) return;
    if (e.key === 'Tab') {
      const items = [...root.querySelectorAll('button:not([disabled])')].filter((b) => b.tabIndex >= 0);
      const i = items.indexOf(document.activeElement);
      if (items.length && (i < 0 || (e.shiftKey && i === 0) || (!e.shiftKey && i === items.length - 1))) {
        e.preventDefault();
        items[e.shiftKey ? items.length - 1 : 0].focus();
      }
    }
    e.stopImmediatePropagation();
  }, true);

  return {
    add(o) { options.push(o); render(); },
    open, close,
    refresh() { render(); },
    get isOpen() { return isOpen; },
    set onToggle(f) { onToggle = f; },
  };
})();
