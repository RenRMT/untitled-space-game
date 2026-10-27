// The race's menus, drawn in the Low-poly UI kit (src/ui/kit.css, kit-lowpoly.css, linked by
// race/index.html; their classes only, never src/ui's code) with the race's own parts in menu.css:
// - the title: the planets as cards in a row, scrolled left and right (swipe, the arrow keys, the
//   ‹ › keys), each the planet itself (Art.drawPlanet, a moon by ArtBodies.drawMoon) in low-poly;
//   picking one shows it large with the three levels as dots on its face (regular, advanced,
//   expert), and Race starts it.
// - in the race: one Menu button at the bottom right (Esc too), opening a sheet with Resume,
//   Restart, Hangar and Main menu, under the planet and the track's seed (after the finish: Race
//   again in place of Resume).
// - the hangar: the career's research (Career), a tab per tree; each tree its three tiers of two
//   choices (Lab's layout), a choice's gains and costs, what it rules out; the one building and the
//   queue; the whole build against the stock ship; a tree stripped back (respec).
//
//   Menu.title({ planets, levels, biome, level, onPick(biome, level), onHangar? })   the title, on the planet given
//     planets: [{ id, label, about, body: { kind: 'planet' | 'moon', type, ring? } }]; levels: [{ id, label, about }]
//   Menu.pause({ planet, seed, onResume, onRestart, onMain, onHangar, over })   the sheet over the race (planet: its label;
//     over: the run is done, so Race again rather than Resume)
//   Menu.hangar({ career, now() -> ms, onChange(), onBack() })   the hangar; onChange after anything bought, cancelled or reset
//   Menu.close()        any one closed (the sheet's onResume isn't called)
//   Menu.up             'title' | 'pause' | 'hangar' | null: what's open
//   Menu.key(key) -> handled   a key while a menu is up (Menu.up)
// ES module (`Menu`); needs a browser.

import { Art } from '../art/render.js';
import { ArtBodies } from '../art/bodies.js';
import { Career } from './career.js';

const Menu = (() => {
  const api = { up: null, title, pause, hangar, close, key };
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

  function title({ planets, levels, biome, level, onPick, onHangar }) {
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
        el('footer', { className: 'rm-foot' }, onHangar ? btn('Hangar', onHangar, 'ghost lg') : null, btn('Select', () => levelsOf(at), 'primary lg')),
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

  function pause({ planet, seed, onResume, onRestart, onMain, onHangar, over = false }) {
    const resume = () => { close(); if (over) onRestart(); else onResume(); };
    const sheet = el('div', { className: 'ui-sheet rm-sheet', role: 'dialog' },
      el('div', { className: 'head' }, el('div', { className: 'titles' }, el('span', { className: 't', textContent: 'Paused' }),
        el('span', { className: 's rm-where' }, el('span', { textContent: planet }), ' · seed ', el('span', { className: 'num', textContent: String(seed) })))),
      el('div', { className: 'body' }, btn(over ? 'Race again' : 'Resume', resume, 'primary lg wide'), over ? null : btn('Restart', () => { close(); onRestart(); }, 'lg wide'),
        onHangar ? btn('Hangar', () => { close(); onHangar(); }, 'lg wide') : null, btn('Main menu', () => { close(); onMain(); }, 'ghost lg wide')));
    sheet.setAttribute('aria-label', 'Race menu');
    const scrim = el('div', { className: 'ui ui-scrim', onclick: (e) => { if (e.target === scrim) resume(); } }, sheet);
    open('pause', scrim, (k) => {
      if (k === 'Escape') resume();
      else if (k === 'r') { close(); onRestart(); }
      else return false;
    });
    sheet.querySelector('.ui-btn').focus();
  }

  // ---------- The hangar ----------

  const pct = (f) => `${f > 0 ? '+' : '−'}${Math.round(Math.abs(f) * 100)}%`;
  const amount = (k, f) => (k === 'charges' ? `${f > 0 ? '+' : '−'}${Math.abs(f)}` : pct(f));
  const span = (s) => (s >= 3600 ? `${Math.floor(s / 3600)}h${s % 3600 >= 60 ? ` ${Math.floor((s % 3600) / 60)}m` : ''}` : s >= 60 ? `${Math.floor(s / 60)}m${s % 60 >= 1 && s < 600 ? ` ${Math.floor(s % 60)}s` : ''}` : `${Math.max(0, Math.ceil(s))}s`);
  // A choice's effects as the kit's deltas: better green (up), worse red (down), gains first.
  function deltas(fx) {
    const rows = Object.entries(fx).filter(([, f]) => f).map(([k, f]) => ({ k, f, good: Career.FX[k].dir * f > 0 })).sort((a, b) => b.good - a.good);
    return el('span', { className: 'ui-deltas' }, rows.map((r) => el('span', { className: 'ui-delta' }, `${Career.FX[r.k].label} `, el('span', { className: r.good ? 'up' : 'down', textContent: amount(r.k, r.f) }))));
  }
  const wallet = (c) => el('div', { className: 'rm-wallet' },
    el('span', { className: 'ui-cr' }, el('i'), String(c.credits)),
    ...Career.PARTS.map((p) => el('span', { className: 'rm-part', style: `--part:var(--part-${p})` }, el('i'), `${c.parts[p] || 0} ${p}`)));

  function hangar({ career: c, now, onChange, onBack }) {
    let tree = Career.TREES[0].id, pick = null;
    const node = el('div', { className: 'ui rm-title rm-hangar' });
    const lab = Career.lab, P = Career.PACKAGES;
    const changed = () => { onChange(); draw(); };
    function draw() {
      lab.settle(c.lab, now());
      const T = Career.TREES.find((t) => t.id === tree), list = Object.values(P).filter((p) => p.cat === tree), L = lab.layout(list);
      const tabs = el('div', { className: 'rm-tabs', role: 'tablist' }, Career.TREES.map((t) => {
        const b = el('button', { type: 'button', className: 'ui-btn sm rm-tab', role: 'tab', onclick: () => { tree = t.id; pick = null; draw(); } }, el('span', { textContent: t.name }));
        b.setAttribute('aria-selected', String(t.id === tree));
        return b;
      }));
      const grid = el('div', { className: 'rm-tree', style: `grid-template-columns:repeat(${L.cols},minmax(0,1fr))` },
        ...Array.from({ length: L.cols }, (_, i) => el('span', { className: 'ui-label rm-tier', style: `grid-column:${i + 1}`, textContent: `Tier ${i + 1}` })),
        ...L.nodes.map(({ id, col, row }) => {
          const p = P[id], st = Career.status(c, id), building = st.state === 'active';
          const mark = { done: '✓', active: `${Math.round(lab.progress(c.lab, now()) * 100)}%`, queued: 'queued', closed: '✕', locked: '🔒' }[st.state] || '';
          const b = el('button', {
            type: 'button', className: `ui-tnode rm-node ${st.state === 'closed' ? 'locked closed' : st.state}`, style: `grid-column:${col + 1};grid-row:${row + 2}`,
            onclick: () => { pick = pick === id ? null : id; draw(); },
          }, el('span', { className: 'top' }, el('span', { className: 'lbl', textContent: p.name }), el('span', { className: 'mark', textContent: mark })), deltas(p.fx),
          building ? el('span', { className: 'ui-meter thin' }, el('span', { style: `--pct:${lab.progress(c.lab, now()) * 100}%` })) : null);
          b.setAttribute('aria-expanded', String(pick === id));
          return b;
        }));
      node.replaceChildren(
        el('header', { className: 'rm-head' }, el('span', { className: 'ui-label', textContent: 'Hangar' }), el('h1', { className: 'ui-title', textContent: T.name }), el('p', { className: 'ui-note', textContent: T.note }), wallet(c)),
        tabs, grid, pick ? detail(pick) : el('p', { className: 'ui-note rm-hint', textContent: 'Each tier is a choice of two: taking one closes the other. Every choice gives more than it takes.' }),
        bench(), build(),
        el('footer', { className: 'rm-foot' }, respecBtn(), btn('Back', onBack, 'primary lg')),
      );
    }
    function detail(id) {
      const p = P[id], st = Career.status(c, id), other = Object.values(P).find((x) => x.fork === p.fork && x.id !== id);
      const cost = [`${st.credits} credits`, ...st.cost.map((x) => `${x.need} ${x.kind} (have ${x.have})`)].join(' · ');
      const why = st.state === 'closed' ? `Closed: you took ${P[st.by].name}. Respec the tree to choose again.`
        : st.state === 'locked' ? 'Needs a choice from the tier before.' : st.full ? 'The queue is full.' : !st.ok && st.state === 'available' ? 'Not enough credits or parts yet.' : '';
      const act = st.state === 'available' ? btn(`Research · ${span(lab.timeOf(id) / 1000)}`, () => { if (Career.buy(c, id, now())) changed(); }, `primary wide${st.ok ? '' : ' disabled'}`)
        : st.state === 'active' || st.state === 'queued' ? btn(st.state === 'active' ? 'Cancel (half back)' : 'Cancel (all back)', () => { Career.cancel(c, id, now()); changed(); }, 'ghost wide') : null;
      if (act && st.state === 'available' && !st.ok) act.disabled = true;
      return el('div', { className: 'ui-card rm-detail' },
        el('span', { className: 'ui-title', textContent: p.name }), el('p', { className: 'ui-note', textContent: p.note }), deltas(p.fx),
        el('p', { className: 'ui-note', textContent: `Cost ${cost}` }),
        st.state === 'available' || st.state === 'locked' ? el('p', { className: 'ui-note', textContent: `Rules out ${other.name}.` }) : null,
        why ? el('p', { className: 'ui-note rm-why', textContent: why }) : null, act);
    }
    function bench() {
      const a = c.lab.active;
      if (!a) return el('p', { className: 'ui-note rm-bench', textContent: 'Nothing building. Research goes on while the game is closed.' });
      return el('div', { className: 'rm-bench' },
        el('span', { className: 'ui-label', textContent: `Building ${P[a.id].name} · ${span((a.end - now()) / 1000)} left` }),
        el('span', { className: 'ui-meter' }, el('span', { style: `--pct:${lab.progress(c.lab, now()) * 100}%` })),
        c.lab.queue.length ? el('span', { className: 'ui-note', textContent: `Then ${c.lab.queue.map((q) => P[q].name).join(', ')}` }) : null);
    }
    function build() {
      const fx = Career.fx(c.lab.done);
      return el('div', { className: 'rm-build' }, el('span', { className: 'ui-label', textContent: c.lab.done.length ? 'Your build against the stock ship' : 'Stock ship' }), c.lab.done.length ? deltas(fx) : null);
    }
    function respecBtn() {
      const done = c.lab.done.filter((id) => P[id].cat === tree).length, pend = lab.pending(c.lab).some((id) => P[id].cat === tree);
      const fee = Career.RESPEC * done, b = btn(fee ? `Respec · ${fee} credits` : 'Respec', () => { if (Career.respec(c, tree, now())) { pick = null; changed(); } }, 'ghost lg');
      b.disabled = (!done && !pend) || c.credits < fee;
      return b;
    }
    open('hangar', node, (k) => { if (k === 'Escape' || k === 'Backspace') onBack(); else return false; });
    draw();
    // The one building, kept moving while the hangar is open.
    const tick = setInterval(() => { if (api.up !== 'hangar' || !node.isConnected) clearInterval(tick); else if (c.lab.active) draw(); }, 1000);
  }

  return api;
})();

export { Menu };
