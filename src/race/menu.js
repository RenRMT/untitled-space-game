// The race's menus, drawn in the Low-poly UI kit (src/ui/kit.css, kit-lowpoly.css, linked by
// race/index.html; their classes only, never src/ui's code) with the race's own parts in menu.css:
// - the landing: the race's name over Resume, New game (after a warning, if there's a career to
//   lose), Controls and Profile; the controls (the steering, and what every key and gesture does)
//   and the profile (your portrait, name, ship and seed) open from it.
// - the title: the planets as cards in a row, scrolled left and right (swipe, the arrow keys, the
//   ‹ › keys), each the planet itself (Art.drawPlanet, a moon by ArtBodies.drawMoon) in low-poly;
//   picking one shows it large, the three levels (regular, advanced, expert) as points on its face,
//   each joined by a dotted line to its label beside the planet, and Race starts it.
// - in the race: one Menu button at the bottom right (Esc too), opening a sheet with Resume,
//   Restart, Hangar, Change planet and Main menu, under the planet and the track's seed (after the finish: Race
//   again in place of Resume).
// - the hangar: the career's research (Career), a tab per tree; each tree its three tiers of two
//   choices (Lab's layout), a choice's gains and costs, what it rules out; the one building and the
//   queue; the whole build against the stock ship; a tree stripped back (respec). And a tab of
//   ships: the hulls (Career.SHIPS), each bought once and flown by choice.
//
//   Menu.landing({ canResume, progress, onResume, onNew, onControls, onProfile })   progress: a career to
//     lose, so New game asks first
//   Menu.controls({ mode, coarse, onMode(mode), onBack })   mode: Input.mode; coarse: a touch screen
//   Menu.profile({ name, seed, portrait (ArtPortraits'), ship: { art, name }, onBack })
//   Menu.title({ planets, levels, biome, level, onPick(biome, level), onHangar?, onBack? })   the title, on the planet given
//     planets: [{ id, label, about, body: { kind: 'planet' | 'moon', type, ring? } }]; levels: [{ id, label, about }]
//   Menu.pause({ planet, seed, onResume, onRestart, onPlanets, onMain, onHangar, over })   the sheet over the race (planet: its label;
//     onPlanets: back to the title, to pick another; over: the run is done, so Race again rather than Resume)
//   Menu.hangar({ career, now() -> ms, shipArt(hull) -> art, onChange(), onBack() })   the hangar; onChange after
//     anything bought, cancelled, reset or flown
//   Menu.close()        any one closed (the sheet's onResume isn't called)
//   Menu.up             'landing' | 'controls' | 'profile' | 'title' | 'pause' | 'hangar' | null: what's open
//   Menu.covers() -> bool   what's open hides the race (nothing to draw under it)
//   Menu.key(key) -> handled   a key while a menu is up (Menu.up)
// ES module (`Menu`); needs a browser.

import { Art } from '../art/render.js';
import { ArtBodies } from '../art/bodies.js';
import { ArtPortraits } from '../art/portraits.js';
import { Career } from './career.js';
import { Draw } from './draw.js';

const Menu = (() => {
  const api = { up: null, landing, controls, profile, title, pause, hangar, close, key, covers: () => ['landing', 'controls', 'profile', 'title'].includes(api.up) };
  // Where the levels sit on the planet's face (of its radius from the centre), where their labels sit
  // beside it (the same), and their gems' tier colours. MAP: the room round the planet for the labels (px).
  const SPOTS = [[-0.42, 0.3], [0.38, -0.12], [-0.08, -0.5]], LABELS = [[-0.95, 0.95], [1.12, 0.32], [0.62, -1.08]], GEMS = ['var(--t2)', 'var(--t3)', 'var(--t5)'];
  const MAP = { x: 64, y: 34 };
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

  // ---------- The landing ----------

  // A screen over everything (the title's look): a header (a label and a title, or its own node), its
  // body, a footer.
  function screen(kind, cls, head, body, foot, onKey) {
    const node = el('div', { className: `ui rm-title ${cls}` },
      Array.isArray(head) ? el('header', { className: 'rm-head' }, el('span', { className: 'ui-label', textContent: head[0] }), el('h1', { className: 'ui-title', textContent: head[1] })) : head,
      ...body, foot ? el('footer', { className: 'rm-foot' }, ...foot) : null);
    open(kind, node, onKey);
    return node;
  }

  function landing({ canResume, progress, onResume, onNew, onControls, onProfile }) {
    const resume = btn('Resume game', onResume, 'primary lg wide');
    resume.disabled = !canResume;
    const list = el('nav', { className: 'rm-menu' }, resume, btn('New game', () => (progress ? ask() : onNew()), 'lg wide'),
      btn('Controls', onControls, 'lg wide'), btn('Profile', onProfile, 'lg wide'));
    // The game's name: a wordmark, Exo in glass, Drift in hull, over its subtitle.
    const logo = el('header', { className: 'rm-head rm-logo' },
      el('h1', { className: 'rm-word', ariaLabel: 'Exo Drift' }, el('span', { className: 'exo', textContent: 'Exo' }), el('span', { textContent: 'Drift' })),
      el('span', { className: 'ui-label rm-sub', textContent: 'USG Planet Racer' }));
    const node = screen('landing', 'rm-landing', logo, [list], null, null);
    // A new game, asked first when there's a career to lose.
    const ask = () => {
      const sheet = el('div', { className: 'ui-sheet rm-sheet', role: 'alertdialog' },
        el('div', { className: 'head' }, el('div', { className: 'titles' }, el('span', { className: 't', textContent: 'Start a new game?' }))),
        el('div', { className: 'body' },
          el('p', { className: 'ui-note rm-warn', textContent: 'You get a new pilot, and your progress starts over: your credits, salvage parts, ships and all research are lost. This cannot be undone.' }),
          btn('New game', onNew, 'warn lg wide'), btn('Cancel', () => shut(), 'ghost lg wide')));
      sheet.setAttribute('aria-label', 'Start a new game');
      const scrim = el('div', { className: 'ui ui-scrim', onclick: (e) => { if (e.target === scrim) shut(); } }, sheet);
      const shut = () => { scrim.remove(); keys = null; list.querySelector('.ui-btn:not([disabled])').focus(); };
      node.append(scrim);
      keys = (k) => { if (k === 'Escape' || k === 'Backspace') shut(); else return false; };
      sheet.querySelector('.ui-btn.ghost').focus();
    };
    list.querySelector('.ui-btn:not([disabled])').focus();
  }

  // The controls: how to steer (Input's modes), and what every key and gesture does.
  const STEER = [
    { id: 'pad', label: 'Stick', about: 'A stick in a band along the bottom of the screen: its angle steers, its reach sets the speed; back into its middle brakes.' },
    { id: 'point', label: 'Drag', about: 'Drag anywhere: the drag points the way, its length sets the speed. Letting go keeps the course.' },
    { id: 'sides', label: 'Sides', about: 'The ship flies itself at full speed: hold the left half of the screen to turn left, the right half to turn right.' },
  ];
  const KEYS = [
    ['W A S D / arrows', 'Fly that way (Sides: A, D turn; S brakes)'], ['X', 'Brake'], ['Space · tap', 'Hop'],
    ['Shift · flick forward', 'Boost'], ['Q / E · flick sideways', 'Sidestep'], ['Flick back', 'Airbrake'],
    ['Esc', 'Pause menu'], ['R', 'Restart'], ['N', 'New track'],
  ];
  function controls({ mode, coarse, onMode, onBack }) {
    const about = el('p', { className: 'ui-note rm-about' });
    const opts = STEER.map((m) => btn(m.label, () => set(m.id), 'rm-opt'));
    const set = (id) => {
      mode = id; onMode(id);
      opts.forEach((b, i) => b.setAttribute('aria-pressed', String(STEER[i].id === id)));
      about.textContent = STEER.find((m) => m.id === id).about;
    };
    const table = el('dl', { className: 'rm-keys' }, KEYS.flatMap(([k, what]) => [el('dt', { textContent: k }), el('dd', { textContent: what })]));
    screen('controls', 'rm-page', ['Controls', 'How to fly'], [
      el('span', { className: 'ui-label', textContent: coarse ? 'Steering · touch' : 'Steering · mouse or touch' }),
      el('div', { className: 'rm-opts', role: 'group' }, opts), about, table,
    ], [btn('Back', onBack, 'primary lg')], (k) => { if (k === 'Escape' || k === 'Backspace') onBack(); else return false; });
    set(mode);
  }

  // The profile: your portrait, name, ship and seed.
  function profile({ name, seed, portrait, ship, onBack }) {
    const face = el('canvas', { className: 'rm-face-l' }), hull = el('canvas', { className: 'rm-ship' });
    screen('profile', 'rm-page', ['Profile', name], [
      el('div', { className: 'ui-card rm-profile' },
        face,
        el('dl', { className: 'rm-keys' },
          el('dt', { textContent: 'Pilot' }), el('dd', { textContent: name }),
          el('dt', { textContent: 'Ship' }), el('dd', { textContent: ship.name }),
          el('dt', { textContent: 'Seed' }), el('dd', {}, el('span', { className: 'num', textContent: String(seed) }))),
        hull),
    ], [btn('Back', onBack, 'primary lg')], (k) => { if (k === 'Escape' || k === 'Backspace') onBack(); else return false; });
    const dpr = Math.min(2, devicePixelRatio || 1);
    const fit = (cv, size) => { cv.width = cv.height = Math.round(size * dpr); cv.style.width = cv.style.height = `${size}px`; const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, size / 2 * dpr, size / 2 * dpr); return g; };
    const g = fit(face, 140);
    g.scale(1.4, 1.4); ArtPortraits.draw(g, portrait, 'lowpoly', { texel: 2 });
    const h = fit(hull, 140), k = 56 / ship.art.radius;
    h.scale(k, k); Art.drawAsset(h, ship.art, 'lowpoly', { angle: -Math.PI / 2, t: 0, thrust: 0.6 });
  }

  // ---------- The title ----------

  function title({ planets, levels, biome, level, onPick, onHangar, onBack }) {
    let at = Math.max(0, planets.findIndex((p) => p.id === biome));
    const node = el('div', { className: 'ui rm-title' });
    const home = () => {
      const row = el('div', { className: 'rm-cards' }), cards = planets.map((p, i) => {
        const cv = el('canvas', { className: 'rm-planet' });
        const card = el('button', { type: 'button', className: 'rm-card', onclick: () => (i === at ? levelsOf(i) : go(i)) },
          cv, el('span', { className: 'ui-title', textContent: p.label }), el('span', { className: 'ui-note', textContent: p.about }));
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
        el('footer', { className: 'rm-foot' }, onBack ? btn('Back', onBack, 'ghost lg') : null, onHangar ? btn('Hangar', onHangar, 'ghost lg') : null, btn('Select', () => levelsOf(at), 'primary lg')),
      );
      keys = (k) => {
        if (k === 'ArrowLeft' || k === 'a') go(at - 1);
        else if (k === 'ArrowRight' || k === 'd') go(at + 1);
        else if (k === 'Enter') levelsOf(at);
        else if ((k === 'Escape' || k === 'Backspace') && onBack) onBack();
        else return false;
      };
      mark();
      requestAnimationFrame(() => go(at, false));
    };

    // The planet large, the levels as points on it, each joined to its label beside the planet by a
    // dotted line (an SVG under the labels, over the planet).
    const levelsOf = (i) => {
      const p = planets[i];
      let lv = Math.max(0, levels.findIndex((l) => l.id === level));
      const size = Math.min(340, innerWidth - 2 * MAP.x - 16, innerHeight * 0.46), cv = el('canvas', { className: 'rm-planet' });
      const W = size + 2 * MAP.x, H = size + 2 * MAP.y, r = size * 0.44, spot = ([x, y]) => [W / 2 + x * r, H / 2 + y * r];
      const about = el('p', { className: 'ui-note rm-about' });
      const NS = 'http://www.w3.org/2000/svg', svg = document.createElementNS(NS, 'svg');
      svg.setAttribute('class', 'rm-links'); svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.setAttribute('aria-hidden', 'true');
      const links = levels.map((l, n) => {
        const [x1, y1] = spot(SPOTS[n]), [x2, y2] = spot(LABELS[n]), ln = document.createElementNS(NS, 'line');
        Object.entries({ x1, y1, x2, y2 }).forEach(([k, v]) => ln.setAttribute(k, v));
        ln.style.setProperty('--gem', GEMS[n]);
        svg.append(ln);
        return ln;
      });
      const place = (e, xy) => { const [x, y] = spot(xy); e.style.left = `${x}px`; e.style.top = `${y}px`; };
      const dots = levels.map((l, n) => {
        const d = el('button', { type: 'button', className: 'rm-pin', onclick: () => pick(n) }, el('i'));
        place(d, SPOTS[n]); d.style.setProperty('--gem', GEMS[n]);
        d.setAttribute('aria-hidden', 'true'); d.tabIndex = -1;
        return d;
      });
      const tags = levels.map((l, n) => {
        const d = el('button', { type: 'button', className: 'rm-dot', onclick: () => pick(n) },
          el('span', { className: 'rm-dot-l' }, el('b', { textContent: l.label }), el('span', { className: 'rm-gems' }, ...levels.map((_, g) => el('i', { className: g <= n ? 'on' : '' })))));
        place(d, LABELS[n]); d.style.setProperty('--gem', GEMS[n]);
        d.setAttribute('aria-label', `${l.label}: ${l.about}`);
        return d;
      });
      const pick = (n) => {
        lv = (n + levels.length) % levels.length; level = levels[lv].id;
        [dots, tags, links].forEach((L) => L.forEach((d, m) => d.classList.toggle('on', m === lv)));
        tags.forEach((d, m) => d.setAttribute('aria-pressed', m === lv));
        about.textContent = levels[lv].about;
      };
      const race = () => onPick(p.id, levels[lv].id);
      cv.style.margin = `${MAP.y}px ${MAP.x}px`;
      node.replaceChildren(
        el('header', { className: 'rm-head' }, el('span', { className: 'ui-label', textContent: p.label }), el('h1', { className: 'ui-title', textContent: 'Choose a level' })),
        el('div', { className: 'rm-globe', style: `width:${W}px;height:${H}px` }, cv, svg, ...dots, ...tags),
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

  function pause({ planet, seed, onResume, onRestart, onPlanets, onMain, onHangar, over = false }) {
    const resume = () => { close(); if (over) onRestart(); else onResume(); };
    const sheet = el('div', { className: 'ui-sheet rm-sheet', role: 'dialog' },
      el('div', { className: 'head' }, el('div', { className: 'titles' }, el('span', { className: 't', textContent: 'Paused' }),
        el('span', { className: 's rm-where' }, el('span', { textContent: planet }), ' · seed ', el('span', { className: 'num', textContent: String(seed) })))),
      el('div', { className: 'body' }, btn(over ? 'Race again' : 'Resume', resume, 'primary lg wide'), over ? null : btn('Restart', () => { close(); onRestart(); }, 'lg wide'),
        onHangar ? btn('Hangar', () => { close(); onHangar(); }, 'lg wide') : null,
        onPlanets ? btn('Change planet', () => { close(); onPlanets(); }, 'lg wide') : null, btn('Main menu', () => { close(); onMain(); }, 'ghost lg wide')));
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
  const SHIPS_TAB = { id: 'ships', name: 'Ships' };
  const wallet = (c) => el('div', { className: 'rm-wallet' },
    el('span', { className: 'ui-cr' }, el('i'), String(c.credits)),
    ...Career.PARTS.map((p) => el('span', { className: 'rm-part' }, el('img', { className: 'rm-icon', src: Draw.icon(p, 20), alt: '', width: 20, height: 20 }), `${c.parts[p] || 0} ${p}`)));

  function hangar({ career: c, now, shipArt, onChange, onBack }) {
    let tree = Career.TREES[0].id, pick = null;
    const node = el('div', { className: 'ui rm-title rm-hangar' });
    const lab = Career.lab, P = Career.PACKAGES;
    const changed = () => { onChange(); draw(); };
    function draw() {
      lab.settle(c.lab, now());
      const tabs = el('div', { className: 'rm-tabs', role: 'tablist' }, [...Career.TREES, SHIPS_TAB].map((t) => {
        const b = el('button', { type: 'button', className: 'ui-btn sm rm-tab', role: 'tab', onclick: () => { tree = t.id; pick = null; draw(); } }, el('span', { textContent: t.name }));
        b.setAttribute('aria-selected', String(t.id === tree));
        return b;
      }));
      if (tree === SHIPS_TAB.id) {
        node.replaceChildren(
          el('header', { className: 'rm-head' }, el('span', { className: 'ui-label', textContent: 'Hangar' }), el('h1', { className: 'ui-title', textContent: SHIPS_TAB.name }), wallet(c)),
          ...[tabs, ships(), build(), el('footer', { className: 'rm-foot' }, btn('Back', onBack, 'primary lg'))].filter(Boolean));
        return;
      }
      const T = Career.TREES.find((t) => t.id === tree), list = Object.values(P).filter((p) => p.cat === tree), L = lab.layout(list);
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
      node.replaceChildren(...[
        el('header', { className: 'rm-head' }, el('span', { className: 'ui-label', textContent: 'Hangar' }), el('h1', { className: 'ui-title', textContent: T.name }), wallet(c)),
        tabs, grid, pick ? detail(pick) : null,
        bench(), build(),
        el('footer', { className: 'rm-foot' }, respecBtn(), btn('Back', onBack, 'primary lg')),
      ].filter(Boolean));
    }
    function detail(id) {
      const p = P[id], st = Career.status(c, id), other = Object.values(P).find((x) => x.fork === p.fork && x.id !== id);
      const cost = [`${st.credits} credits`, ...st.cost.map((x) => `${x.need} ${x.kind} (have ${x.have})`)].join(' · ');
      const why = st.state === 'closed' ? `Closed by ${P[st.by].name}`
        : st.state === 'locked' ? 'Needs the tier before' : st.full ? 'Queue full' : !st.ok && st.state === 'available' ? 'Not enough credits or parts' : '';
      const act = st.state === 'available' ? btn(`Research · ${span(lab.timeOf(id) / 1000)}`, () => { if (Career.buy(c, id, now())) changed(); }, `primary wide${st.ok ? '' : ' disabled'}`)
        : st.state === 'active' || st.state === 'queued' ? btn(st.state === 'active' ? 'Cancel (half back)' : 'Cancel (all back)', () => { Career.cancel(c, id, now()); changed(); }, 'ghost wide') : null;
      if (act && st.state === 'available' && !st.ok) act.disabled = true;
      return el('div', { className: 'ui-card rm-detail' },
        el('span', { className: 'ui-title', textContent: p.name }), deltas(p.fx),
        el('p', { className: 'ui-note', textContent: cost }),
        st.state === 'available' || st.state === 'locked' ? el('p', { className: 'ui-note', textContent: `Closes ${other.name}` }) : null,
        why ? el('p', { className: 'ui-note rm-why', textContent: why }) : null, act);
    }
    // The hulls: each its look, what it changes, its price; bought once, then flown by choice.
    function ships() {
      return el('div', { className: 'rm-ships' }, Object.values(Career.SHIPS).map((S) => {
        const st = Career.shipStatus(c, S.id), cv = el('canvas', { className: 'rm-ship' });
        const cost = [S.cost.credits ? `${S.cost.credits} credits` : null, ...Career.PARTS.filter((k) => S.cost[k]).map((k) => `${S.cost[k]} ${k}`)].filter(Boolean).join(' · ');
        const act = st.flown ? btn('Flying', null, 'wide') : st.owned ? btn('Fly', () => { Career.fly(c, S.id); changed(); }, 'primary wide')
          : btn('Buy', () => { if (Career.buyShip(c, S.id)) changed(); }, 'primary wide');
        if (st.flown || (!st.owned && !st.ok)) act.disabled = true;
        requestAnimationFrame(() => {
          const dpr = Math.min(2, devicePixelRatio || 1), size = 96, g = cv.getContext('2d'), art = shipArt(S.id), k = 38 / art.radius;
          cv.width = cv.height = size * dpr; cv.style.width = cv.style.height = `${size}px`;
          g.setTransform(dpr * k, 0, 0, dpr * k, (size * dpr) / 2, (size * dpr) / 2);
          Art.drawAsset(g, art, 'lowpoly', { angle: -Math.PI / 2, t: 0, thrust: 0 });
        });
        return el('div', { className: `ui-card rm-hull${st.flown ? ' on' : ''}` }, cv,
          el('span', { className: 'ui-title', textContent: S.name }),
          Object.keys(S.fx).length ? deltas(S.fx) : el('span', { className: 'ui-note', textContent: 'Stock' }),
          !st.owned ? el('p', { className: 'ui-note', textContent: cost }) : null,
          st.why ? el('p', { className: 'ui-note rm-why', textContent: st.why }) : null, act);
      }));
    }
    function bench() {
      const a = c.lab.active;
      if (!a) return null;
      return el('div', { className: 'rm-bench' },
        el('span', { className: 'ui-label', textContent: `Building ${P[a.id].name} · ${span((a.end - now()) / 1000)} left` }),
        el('span', { className: 'ui-meter' }, el('span', { style: `--pct:${lab.progress(c.lab, now()) * 100}%` })),
        c.lab.queue.length ? el('span', { className: 'ui-note', textContent: `Then ${c.lab.queue.map((q) => P[q].name).join(', ')}` }) : null);
    }
    function build() {
      const fx = Career.fx(c.lab.done, c.ship);
      return Object.keys(fx).length ? el('div', { className: 'rm-build' }, el('span', { className: 'ui-label', textContent: 'Build' }), deltas(fx)) : null;
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
