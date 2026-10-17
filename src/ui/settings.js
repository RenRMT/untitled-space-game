// The settings menu: one panel for the game's options, opened with the Settings button in flight.
// Each option registers itself with add() and shows as a row of choices, with a line explaining
// the selected one, or as one action button (which closes the menu once run). Options keep their
// own state; this only draws them and passes clicks on.
//
//   Settings.add({ id, label, shortcut?, choices: [{ value, label, hint }], get(), set(value),
//                  note?, locked?() -> reason string | null })
//   Settings.add({ id, label, action: { label, hint?, run(), stay? }, note?, locked?() })
//   Settings.add({ id, label, actions: [{ label, hint?, run(), stay? }, ...], note?, locked?() })
//     note: a string, or a function asked each time the panel draws
//   group: a name ('Accessibility'): the option sits under that folding heading, after the rest
//   Settings.open(), Settings.close(), Settings.isOpen
//   Settings.onToggle = (open) => ...   called when the panel opens or closes
// ES module (`Settings`); needs a browser.

import { UI } from './ui.js';

const Settings = (() => {
  const root = document.getElementById('settings');
  const body = root.querySelector('.set-body');
  const options = [];
  let isOpen = false;
  let onToggle = null;
  let returnFocus = null;

  const { h } = UI; // ui/ui.js

  function choose(o, value) {
    if (o.get() === value || (o.locked && o.locked())) return;
    o.set(value);
    render(o.id);
  }

  // An action (or a row of them): its label, its buttons and what they do (or why they can't be
  // done right now). An action closes the menu once run unless it says `stay`.
  function actionGroup(o) {
    const locked = o.locked ? o.locked() : null;
    const labelId = `set-${o.id}-label`;
    const list = o.actions || [o.action];
    const run = (a) => () => { if (o.locked && o.locked()) return; if (!a.stay) close(); a.run(); if (a.stay) render(); };
    const hint = list.map((a) => a.hint).filter(Boolean).join(' ');
    return h('section', { class: 'set-group' },
      h('div', { class: 'set-label' }, h('span', { id: labelId }, o.label)),
      h('div', { class: 'seg' }, list.map((a) => h('button', {
        class: 'btn', type: 'button', 'aria-describedby': labelId, disabled: !!locked, 'data-option': o.id, onclick: run(a),
      }, a.label))),
      hint ? h('p', { class: 'set-hint' }, hint) : null,
      locked ? h('p', { class: 'set-note locked' }, locked) : o.note ? h('p', { class: 'set-note' }, typeof o.note === 'function' ? o.note() : o.note) : null);
  }

  // One option: its label, the choices as a radio group, the selected choice's hint, and a note
  // (or why it can't be changed right now).
  function group(o) {
    if (o.action || o.actions) return actionGroup(o);
    const current = o.get();
    const locked = o.locked ? o.locked() : null;
    const labelId = `set-${o.id}-label`;
    const choices = o.choices.map((c) => h('button', {
      class: 'btn', type: 'button', role: 'radio', 'aria-checked': String(c.value === current),
      tabindex: c.value === current ? 0 : -1, disabled: !!locked && c.value !== current,
      'data-option': o.id, 'data-value': c.value, onclick: () => choose(o, c.value),
    }, c.label));
    // Arrow keys move through the choices, as in any radio group.
    const onkeydown = (e) => {
      const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
      if (!step || locked) return;
      e.preventDefault();
      const i = o.choices.findIndex((c) => c.value === o.get());
      choose(o, o.choices[(i + step + o.choices.length) % o.choices.length].value);
    };
    const hint = (o.choices.find((c) => c.value === current) || {}).hint;
    return h('section', { class: 'set-group' },
      h('div', { class: 'set-label' }, h('span', { id: labelId }, o.label), o.shortcut ? h('kbd', {}, o.shortcut) : null),
      h('div', { class: 'seg', role: 'radiogroup', 'aria-labelledby': labelId, onkeydown }, choices),
      hint ? h('p', { class: 'set-hint' }, hint) : null,
      locked ? h('p', { class: 'set-note locked' }, locked) : o.note ? h('p', { class: 'set-note' }, o.note) : null);
  }

  // Options with a `group` sit under a heading that folds them away (Accessibility, Help), closed
  // until opened, after the options everyone uses.
  const openGroups = new Set();
  function folded() {
    const names = [...new Set(options.filter((o) => o.group).map((o) => o.group))];
    return names.map((name) => {
      const on = openGroups.has(name);
      const toggle = () => { if (on) openGroups.delete(name); else openGroups.add(name); render(); };
      return [
        h('button', { class: 'set-fold', type: 'button', 'aria-expanded': String(on), 'data-group': name, onclick: toggle },
          h('span', {}, name), h('span', { 'aria-hidden': 'true' }, on ? '▴' : '▾')),
        on ? options.filter((o) => o.group === name).map(group) : null,
      ];
    });
  }

  // Rebuild the panel; keep focus on the option that just changed.
  function render(focusId) {
    if (!isOpen) return;
    body.replaceChildren(...options.filter((o) => !o.group).map(group), ...folded().flat(Infinity).filter(Boolean));
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
    get isOpen() { return isOpen; },
    set onToggle(f) { onToggle = f; },
  };
})();

export { Settings };
