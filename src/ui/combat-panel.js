// The combat bar: a small strip above the speed bar while a fight with ships runs (not while
// mining), in place of the context menu. Only what needs a tap: the class's three skills and the
// kit's consumables. Everything else about the fight is drawn round the ships themselves
// (game/combat.js drawFight, drawFightOverlay): their hull and shield bars, action gauges, whom
// each enemy is after and what it is charging, damage, breaches, the target's brackets.
// game/combat.js describes it every frame; the DOM is rebuilt only when the buttons change.
//
//   CombatPanel.show({ abilities: [{ id, code, label, count, enabled, skill?, badge?, cooling? }] })
// abilities: a button each (rules/abilities.js): its icon (by its code) and charges left, or for a class
// skill ({ skill: true, badge, cooling }) its key or the seconds of cooldown left, shaded as it cools;
// onButton gets its id.
//   CombatPanel.hide()
//   CombatPanel.onButton = (id) => ...
//   CombatPanel.top   its top edge on screen, null while hidden (UI.topEdge)
// ES module (`CombatPanel`); needs a browser.

import { Kit } from './kit.js';
import { UI } from './ui.js';

const CombatPanel = (() => {
  const root = document.getElementById('combat');
  const abilEl = root.querySelector('.cb-abil');
  const { h } = UI; // ui/ui.js
  const view = UI.keyed(); // what the DOM shows, to skip unchanged frames
  const edge = UI.topEdge(root);
  let onButton = null;

  abilEl.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-id]');
    if (b && !b.disabled && onButton) onButton(b.dataset.id);
  });

  function show(d) {
    const abil = d.abilities || [];
    if (!abil.length) { hide(); return; }
    if (!view.changed([abil])) return;
    root.hidden = false;
    abilEl.replaceChildren(...abil.map((a) => h('button', {
      class: `cb-ab${a.skill ? ' skill' : ''}`, type: 'button', 'data-id': a.id, disabled: !a.enabled,
      title: a.skill ? a.label : `${a.label} · ${a.count} left`, 'aria-label': a.skill ? `${a.label}, ${a.badge}` : `${a.label}, ${a.count} left`,
      style: a.cooling ? { background: `linear-gradient(to top, rgba(0,0,0,0.45) ${(a.cooling * 100).toFixed(0)}%, transparent 0)` } : null,
    }, Kit.icon(a.code, 22, { code: a.code }), h('span', { class: 'n' }, a.skill ? a.badge : `×${a.count}`))));
  }

  function hide() {
    if (!view.shown) return;
    view.reset();
    root.hidden = true;
    abilEl.replaceChildren();
  }

  return {
    show, hide,
    get isOpen() { return view.shown; },
    get top() { return edge.top; },
    set onButton(f) { onButton = f; },
  };
})();

export { CombatPanel };
