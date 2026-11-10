// The combat bar: a strip above the speed bar while a fight with ships runs (not while
// mining), in place of the context menu. Only what needs a tap: the class's four skills and the
// kit's consumables. Everything else about the fight is drawn round the ships themselves
// (game/combat.js drawFight, drawFightOverlay): their hull and shield bars, action gauges, whom
// each enemy is after and what it is charging, damage, breaches, the target's brackets.
// game/combat.js describes it every frame; the DOM is rebuilt only when the buttons change.
//
//   CombatPanel.show({ abilities: [{ id, code, label, count, enabled, skill?, badge?, cooling?, busy? }],
//                      party: [{ id, code, hull, shield (0..1), text, you? }] })
// party: a frame per ship on your side (yours first, larger): its hull and shields as bars, MMO style.
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

  // The party's frames: a row per ship (yours first), built when who's fighting changes; after
  // that only the bars' widths move.
  const partyEl = root.querySelector('.cb-party');
  const party = UI.keyed();
  function showParty(list) {
    if (party.changed([list.map((v) => `${v.id}|${v.code}`)])) {
      partyEl.replaceChildren(...list.map((v) => h('div', { class: `cb-frame${v.you ? ' you' : ''}`, 'data-id': v.id },
        h('span', { class: 'who' }, v.code),
        h('span', { class: 'bars' }, h('span', { class: 'shd' }, h('i')), h('span', { class: 'hul' }, h('i'))),
        h('span', { class: 'num' }))));
    }
    list.forEach((v, i) => {
      const f = partyEl.children[i];
      if (!f || !f.querySelector) return;
      const set = (sel, x) => { const el = f.querySelector(sel); if (el) el.style.width = `${Math.round(Math.max(0, Math.min(1, x)) * 100)}%`; };
      set('.shd i', v.shield);
      set('.hul i', v.hull);
      f.classList.toggle('low', v.hull < 0.3);
      f.classList.toggle('down', v.hull <= 0);
      const num = f.querySelector('.num');
      if (num && num.textContent !== v.text) num.textContent = v.text;
    });
  }

  function show(d) {
    const abil = d.abilities || [];
    if (!abil.length) { hide(); return; }
    root.hidden = false;
    showParty(d.party || []);
    if (!view.changed([abil])) return;
    abilEl.replaceChildren(...abil.map((a) => h('button', {
      class: `cb-ab${a.skill ? ' skill' : ''}${a.busy ? ' busy' : ''}`, type: 'button', 'data-id': a.id, disabled: !a.enabled,
      title: a.skill ? a.label : `${a.label} · ${a.count} left`, 'aria-label': a.skill ? `${a.label}, ${a.badge}` : `${a.label}, ${a.count} left`,
      style: a.cooling ? { '--cool': `${(a.cooling * 100).toFixed(0)}%` } : null,
    }, Kit.icon(a.code, a.skill ? 28 : 22, { code: a.code }), h('span', { class: 'n' }, a.skill ? a.badge : `×${a.count}`))));
  }

  function hide() {
    if (!view.shown && root.hidden) return;
    view.reset();
    party.reset();
    root.hidden = true;
    abilEl.replaceChildren();
    partyEl.replaceChildren();
  }

  return {
    show, hide,
    get isOpen() { return view.shown; },
    get top() { return edge.top; },
    set onButton(f) { onButton = f; },
  };
})();

export { CombatPanel };
