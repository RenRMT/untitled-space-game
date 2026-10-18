// The factions menu: every faction the player knows of and how it regards them (rules/reputation.js),
// highest regard first, opened with the Factions button in flight beside Map and Settings. Each row
// shows the faction's colour, name, its regard's tier and where it sits between hostile and devoted;
// a tap unfolds what that regard means (prices, docking, pirates leaving you be), what the faction
// stands for (world/factions.js) and its allies and enemies, each a chip that jumps to that
// faction's row.
//
//   FactionsMenu.open(rep, owners), FactionsMenu.close(), FactionsMenu.isOpen
//     rep: { [faction id]: regard } (cargo.rep), read each time the menu draws; owners: a Set of
//     the factions that own stations (only theirs say what regard does to prices and docking)
//   FactionsMenu.onToggle = (open) => ...   called when the menu opens or closes
// ES module (`FactionsMenu`); needs a browser.

import { Reputation } from '../rules/reputation.js';
import { UI } from './ui.js';

const FactionsMenu = (() => {
  const root = document.getElementById('factions');
  const body = root.querySelector('.fac-body');
  const { h } = UI; // ui/ui.js
  let rep = {};
  let owners = new Set();
  let isOpen = false;
  let unfolded = null; // the faction id whose row is open
  let onToggle = null;
  let returnFocus = null;

  const TONE = { devoted: 'var(--cyan)', friendly: 'var(--good)', neutral: 'var(--dim)', unfriendly: 'var(--busy)', hostile: 'var(--hostile)' };
  const ABOUT = [['ideals', 'Ideals'], ['drive', 'Drive'], ['territory', 'Territory'], ['concern', 'Concern']];

  // Where a regard sits on a track from hostile (left) to devoted (right), filled from the middle.
  function meter(v) {
    const k = v / Reputation.MAX / 2; // -0.5 .. 0.5
    return h('span', { class: 'fac-meter', 'aria-hidden': 'true' },
      h('span', { class: 'fill', style: { left: `${50 + Math.min(0, k) * 100}%`, width: `${Math.abs(k) * 100}%`, background: TONE[Reputation.tier(v).id] } }));
  }

  // A faction as a chip in its own colour; a tap opens its row.
  function chip(f) {
    return h('button', { class: 'fac-chip', type: 'button', style: { '--fc': f.color }, onclick: () => { unfolded = f.id; render(f.id); } }, f.name);
  }

  function row(f) {
    const v = Reputation.regard(rep, f.id), t = Reputation.tier(v), shown = unfolded === f.id;
    const allies = Reputation.allies(f.id), hostiles = Reputation.hostiles(f.id), effects = Reputation.effects(rep, f.id, owners.has(f.id));
    const more = shown ? h('div', { class: 'fac-more', id: `fac-${f.id}-more` },
      effects.length ? h('p', { class: 'fac-line fac-effects', style: { color: TONE[t.id] } }, h('span', { class: 'set-label' }, 'Toward you'), effects.join(' ')) : null,
      ABOUT.map(([key, label]) => (f[key] ? h('p', { class: 'fac-line' }, h('span', { class: 'set-label' }, label), f[key]) : null)),
      h('div', { class: 'fac-rel' }, h('span', { class: 'set-label' }, 'Allies'),
        allies.length ? h('span', { class: 'fac-chips' }, allies.map(chip)) : h('span', { class: 'fac-none' }, 'None')),
      h('div', { class: 'fac-rel' }, h('span', { class: 'set-label' }, 'Hostile to'),
        hostiles.length ? h('span', { class: 'fac-chips' }, hostiles.map(chip)) : h('span', { class: 'fac-none' }, 'No one'))) : null;
    return h('div', { class: `fac-item${shown ? ' open' : ''}`, 'data-faction': f.id },
      h('button', {
        class: 'fac-row', type: 'button', 'aria-expanded': String(shown), 'aria-controls': shown ? `fac-${f.id}-more` : null,
        style: { '--fc': f.color }, onclick: () => { unfolded = shown ? null : f.id; render(f.id); },
      },
      h('span', { class: 'swatch', 'aria-hidden': 'true' }),
      h('span', { class: 'name' }, f.name),
      h('span', { class: 'tier', style: { color: TONE[t.id] } }, t.label, h('span', { class: 'num' }, ` ${v > 0 ? '+' : ''}${Math.round(v)}`)),
      meter(v),
      h('span', { class: 'chev', 'aria-hidden': 'true' }, shown ? '▴' : '▾')),
      more);
  }

  // Redraw, keeping focus on the row just tapped, and it with what it unfolded in view.
  function render(focusId) {
    if (!isOpen) return;
    body.replaceChildren(
      h('p', { class: 'set-note' }, 'How each faction regards you. Jobs move it, and every faction reacts to what you do for its friends and enemies.'),
      h('div', { class: 'fac-list' }, Reputation.ranked(rep).map(row)));
    if (focusId) {
      const item = body.querySelector(`[data-faction="${focusId}"]`);
      if (item) { item.querySelector('.fac-row').focus({ preventScroll: true }); item.scrollIntoView({ block: 'nearest' }); }
    }
  }

  function open(r, o) {
    rep = r || {};
    owners = o || new Set();
    if (isOpen) { render(); return; }
    isOpen = true;
    returnFocus = document.activeElement;
    root.hidden = false;
    render();
    const first = body.querySelector('.fac-row');
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
  // While open: Escape (or R, which opened it) closes, Tab stays inside the panel, and the game's
  // shortcuts are held back.
  window.addEventListener('keydown', (e) => {
    if (!isOpen) return;
    if (e.key === 'Escape' || e.key === 'r' || e.key === 'R') { close(); e.stopImmediatePropagation(); return; }
    if (e.key === 'Tab') {
      const items = [...root.querySelectorAll('button:not([disabled])')];
      const i = items.indexOf(document.activeElement);
      if (items.length && (i < 0 || (e.shiftKey && i === 0) || (!e.shiftKey && i === items.length - 1))) {
        e.preventDefault();
        items[e.shiftKey ? items.length - 1 : 0].focus();
      }
    }
    e.stopImmediatePropagation();
  }, true);

  return {
    open, close,
    get isOpen() { return isOpen; },
    set onToggle(f) { onToggle = f; },
  };
})();

export { FactionsMenu };
