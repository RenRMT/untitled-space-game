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

  // The buttons are rebuilt only when what they stand for changes (which skills and consumables,
  // and the charges left). What moves every frame while a skill cools down (its shade, its badge,
  // whether it can be pressed) is set on the buttons in place, so a press isn't lost to a rebuild
  // between pointer down and up, and no frame rebuilds the bar.
  const badges = new WeakMap(); // button -> its badge span
  function show(d) {
    const abil = d.abilities || [];
    if (!abil.length) { hide(); return; }
    root.hidden = false;
    showParty(d.party || []);
    if (view.changed([abil.map((a) => [a.id, a.code, a.label, !!a.skill, a.count])])) {
      abilEl.replaceChildren(...abil.map((a) => {
        const n = h('span', { class: 'n' }, a.skill ? '' : `×${a.count}`);
        const b = h('button', { class: `cb-ab${a.skill ? ' skill' : ''}`, type: 'button', 'data-id': a.id, title: a.skill ? a.label : `${a.label} · ${a.count} left` },
          Kit.icon(a.code, a.skill ? 28 : 22, { code: a.code }), n);
        badges.set(b, n);
        return b;
      }));
    }
    abil.forEach((a, i) => {
      const b = abilEl.children[i];
      if (!b) return;
      b.disabled = !a.enabled;
      b.classList.toggle('busy', !!a.busy);
      const label = a.skill ? `${a.label}, ${a.badge}` : `${a.label}, ${a.count} left`;
      if (b.getAttribute('aria-label') !== label) b.setAttribute('aria-label', label);
      const cool = a.cooling ? `${(a.cooling * 100).toFixed(0)}%` : '0%';
      if (b.dataset.cool !== cool) { b.dataset.cool = cool; b.style.setProperty('--cool', cool); }
      const n = badges.get(b);
      if (a.skill && n && n.textContent !== a.badge) n.textContent = a.badge;
    });
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
