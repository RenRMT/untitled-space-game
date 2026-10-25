// The race's menus, drawn in the Low-poly UI kit (src/ui/kit.css, kit-lowpoly.css, linked by
// race/index.html; their classes only, never src/ui's code) with the race's own parts in menu.css:
// - the title: the planets as cards in a row, scrolled left and right (swipe, the arrow keys, the
//   ‹ › keys), each the planet itself (Art.drawPlanet, a moon by ArtBodies.drawMoon) in low-poly;
//   picking one shows it large with the three levels as dots on its face (regular, advanced,
//   expert), and Race starts it.
// - in the race: one Menu button at the bottom right (Esc too), opening a sheet with Resume,
//   Restart and Main menu, and the controls' help.
//
//   Menu.title({ planets, levels, biome, level, onPick(biome, level) })   the title, on the planet given
//     planets: [{ id, label, about, body: { kind: 'planet' | 'moon', type, ring? } }]; levels: [{ id, label, about }]
//   Menu.pause({ help, onResume, onRestart, onMain })   the sheet over the race (help: html)
//   Menu.close()        either one closed (the sheet's onResume isn't called)
//   Menu.up             'title' | 'pause' | null: what's open
//   Menu.key(key) -> handled   a key while a menu is up (Menu.up)
// ES module (`Menu`); needs a browser.

import { Art } from '../art/render.js';
import { ArtBodies } from '../art/bodies.js';

const Menu = (() => {
  const api = { up: null, title, pause, close, key };
  // Where the levels sit on the planet's face (of its radius from the centre), and their gems' tier colours.
  const SPOTS = [[-0.42, 0.3], [0.38, -0.12], [-0.08, -0.5]], GEMS = ['var(--t2)', 'var(--t3)', 'var(--t5)'];
  const bodies = {}; // the planets' bodies, kept so their sprites are (Art's cache keys them by object)
  let root = null, keys = null; // what's open, and its keys

  const el = (tag, props = {}, ...kids) => {
    const n = Object.assign(document.createElement(tag), props);
    for (const k of kids.flat()) if (k != null) n.append(k);
    return n;
  };
  const btn = (label, onclick, cls = '') => el('button', { type: 'button', className: `ui-btn ${cls}`, onclick }, el('span', { textContent: label }));

  // A planet drawn into a canvas `size` px across (the disc a little smaller, for the light's rim).
  function paint(cv, p, size) {
    const dpr = Math.min(2, devicePixelRatio || 1), ctx = cv.getContext('2d');
    cv.width = cv.height = Math.round(size * dpr);
    cv.style.width = cv.style.height = `${size}px`;
    const b = bodies[p.id] ||= { ...p.body, r: 1, seed: 7 }, r = size * 0.44;
    ctx.setTransform(dpr * r, 0, 0, dpr * r, (size * dpr) / 2, (size * dpr) / 2);
    if (b.kind === 'moon') ArtBodies.drawMoon(ctx, b, 'lowpoly', { force: true });
    else Art.drawPlanet(ctx, b, 'lowpoly', { force: true, lightAngle: -2.2 });
  }

  function open(kind, node, onKey) {
    close();
    api.up = kind; root = node; keys = onKey;
    document.body.append(node);
  }
  function close() {
    root?.remove();
    api.up = root = keys = null;
  }
  // Enter on a focused button is the button's own (its click); the rest go to the screen's keys.
  function key(k) {
    if (k === 'Enter' && document.activeElement?.tagName === 'BUTTON' && root?.contains(document.activeElement)) return true;
    return keys ? keys(k) !== false : false;
  }

  // ---------- The title ----------

  function title({ planets, levels, biome, level, onPick }) {
    let at = Math.max(0, planets.findIndex((p) => p.id === biome));
    const node = el('div', { className: 'ui rm-title' });
    const home = () => {
      const row = el('div', { className: 'rm-cards' }), cards = planets.map((p, i) => {
        const cv = el('canvas', { className: 'rm-planet' });
        const card = el('button', { type: 'button', className: 'rm-card', onclick: () => (i === at ? levelsOf(i) : go(i)) },
          cv, el('span', { className: 'ui-label', textContent: `Planet ${i + 1} of ${planets.length}` }),
          el('span', { className: 'ui-title', textContent: p.label }), el('span', { className: 'ui-note', textContent: p.about }));
        card.setAttribute('aria-label', `${p.label}: ${p.about}`);
        requestAnimationFrame(() => paint(cv, p, Math.min(220, innerWidth * 0.5)));
        return card;
      });
      row.append(...cards);
      const go = (i, smooth = true) => {
        at = (i + planets.length) % planets.length;
        const c = cards[at];
        row.scrollTo({ left: c.offsetLeft - (row.clientWidth - c.offsetWidth) / 2, behavior: smooth ? 'smooth' : 'instant' });
        mark();
      };
      const mark = () => cards.forEach((c, i) => c.classList.toggle('on', i === at));
      // Scrolled by hand: the card nearest the middle is the one.
      let tick = 0;
      row.addEventListener('scroll', () => {
        cancelAnimationFrame(tick);
        tick = requestAnimationFrame(() => {
          const mid = row.scrollLeft + row.clientWidth / 2;
          let best = 0;
          cards.forEach((c, i) => { if (Math.abs(c.offsetLeft + c.offsetWidth / 2 - mid) < Math.abs(cards[best].offsetLeft + cards[best].offsetWidth / 2 - mid)) best = i; });
          if (best !== at) { at = best; mark(); }
        });
      });
      const prev = el('button', { type: 'button', className: 'ui-iconbtn rm-arrow', textContent: '‹', onclick: () => go(at - 1) });
      const next = el('button', { type: 'button', className: 'ui-iconbtn rm-arrow', textContent: '›', onclick: () => go(at + 1) });
      prev.setAttribute('aria-label', 'Previous planet'); next.setAttribute('aria-label', 'Next planet');
      node.replaceChildren(
        el('header', { className: 'rm-head' }, el('span', { className: 'ui-label', textContent: 'Surface race' }), el('h1', { className: 'ui-title', textContent: 'Choose a planet' })),
        el('div', { className: 'rm-row' }, prev, row, next),
        el('footer', { className: 'rm-foot' }, btn('Select', () => levelsOf(at), 'primary lg')),
      );
      keys = (k) => {
        if (k === 'ArrowLeft' || k === 'a') go(at - 1);
        else if (k === 'ArrowRight' || k === 'd') go(at + 1);
        else if (k === 'Enter') levelsOf(at);
        else return false;
      };
      mark();
      requestAnimationFrame(() => go(at, false));
    };

    // The planet large, the levels as dots on it.
    const levelsOf = (i) => {
      const p = planets[i];
      let lv = Math.max(0, levels.findIndex((l) => l.id === level));
      const size = Math.min(340, innerWidth - 48, innerHeight * 0.48), cv = el('canvas', { className: 'rm-planet' });
      const about = el('p', { className: 'ui-note rm-about' });
      const dots = levels.map((l, n) => {
        const d = el('button', { type: 'button', className: 'rm-dot', onclick: () => pick(n) },
          el('i', {}), el('span', { className: 'rm-dot-l' }, el('b', { textContent: l.label }), el('span', { className: 'rm-gems' }, ...levels.map((_, g) => el('i', { className: g <= n ? 'on' : '' })))));
        d.style.left = `${50 + SPOTS[n][0] * 44}%`; d.style.top = `${50 + SPOTS[n][1] * 44}%`;
        d.style.setProperty('--gem', GEMS[n]);
        d.setAttribute('aria-label', `${l.label}: ${l.about}`);
        return d;
      });
      const pick = (n) => {
        lv = (n + levels.length) % levels.length; level = levels[lv].id;
        dots.forEach((d, m) => { d.classList.toggle('on', m === lv); d.setAttribute('aria-pressed', m === lv); });
        about.textContent = levels[lv].about;
      };
      const race = () => onPick(p.id, levels[lv].id);
      node.replaceChildren(
        el('header', { className: 'rm-head' }, el('span', { className: 'ui-label', textContent: p.label }), el('h1', { className: 'ui-title', textContent: 'Choose a level' })),
        el('div', { className: 'rm-globe', style: `width:${size}px;height:${size}px` }, cv, ...dots),
        about,
        el('footer', { className: 'rm-foot' }, btn('Back', () => { biome = p.id; home(); }, 'ghost lg'), btn('Race', race, 'primary lg')),
      );
      keys = (k) => {
        if (k === 'ArrowLeft' || k === 'ArrowUp' || k === 'a' || k === 'w') pick(lv - 1);
        else if (k === 'ArrowRight' || k === 'ArrowDown' || k === 'd' || k === 's') pick(lv + 1);
        else if (k === 'Enter') race();
        else if (k === 'Escape' || k === 'Backspace') home();
        else return false;
      };
      pick(lv);
      requestAnimationFrame(() => paint(cv, p, size));
    };

    open('title', node, null);
    home();
  }

  // ---------- In the race ----------

  function pause({ help, onResume, onRestart, onMain }) {
    const resume = () => { close(); onResume(); };
    const sheet = el('div', { className: 'ui-sheet rm-sheet', role: 'dialog' },
      el('div', { className: 'head' }, el('div', { className: 'titles' }, el('span', { className: 't', textContent: 'Paused' }))),
      el('div', { className: 'body' }, btn('Resume', resume, 'primary lg wide'), btn('Restart', () => { close(); onRestart(); }, 'lg wide'), btn('Main menu', () => { close(); onMain(); }, 'ghost lg wide'),
        el('span', { className: 'ui-label', textContent: 'Controls' }), el('p', { className: 'ui-note', innerHTML: help })));
    sheet.setAttribute('aria-label', 'Race menu');
    const scrim = el('div', { className: 'ui ui-scrim', onclick: (e) => { if (e.target === scrim) resume(); } }, sheet);
    open('pause', scrim, (k) => {
      if (k === 'Escape') resume();
      else if (k === 'r') { close(); onRestart(); }
      else return false;
    });
    sheet.querySelector('.ui-btn').focus();
  }

  return api;
})();

export { Menu };
