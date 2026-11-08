// Redshift's bottom sheets, built from the game's UI kit (ui/kit.js: Kit.sheet, option rows,
// meters, quotes), one at a time over the map:
// - a body's: its art, what it holds (minerals and volatiles, as pips), its trait, its station (or
//   what could be built there),
// - the menu: the art style (Line or Low-poly), back to the title.
// Each is rebuilt when what it shows changes (compared as markup, so a tap is never lost to a
// refresh). Buttons name what they do through act(name, args), which the page (main.js) carries out.
//
//   SimSheets.create(layer, { act, onClose }) -> sheets
//     sheets.show(view | null, ctx)   view: { kind: 'body' | 'menu', key? }; ctx: { state, meta, w, style }
//     sheets.refresh(ctx)             rebuild if anything shown changed
//     sheets.view, sheets.top         what's open; the sheet's top edge on screen (px), or null
// ES module (`SimSheets`); needs a browser.

import { Kit } from '../ui/kit.js';
import { UI } from '../ui/ui.js';
import { SimConfig } from './config.js';
import { SimFaces } from './faces.js';

const SimSheets = (() => {
  const { h } = UI;
  const C = SimConfig;
  const KIND = { planet: 'Planet', moon: 'Moon', belt: 'Asteroid belt', nebula: 'Nebula', gate: 'Gate site' };
  const PLANET = { lava: 'Lava world', desert: 'Desert world', terran: 'Terran world', ice: 'Ice world', gas: 'Gas giant', blue: 'Ice giant' };
  const MOON = { grey: 'Grey moon', ice: 'Ice moon', rust: 'Rust moon', dark: 'Carbon moon', sulfur: 'Volcanic moon' };

  const pips = (n, color) => h('span', { class: 'sim-pips', style: { color }, 'aria-label': `${n} of 3` }, [0, 1, 2].map((i) => h('i', { class: i < n ? 'on' : '' })));
  const kindLine = (b) => (b.kind === 'planet' ? PLANET[b.art.type] : b.kind === 'moon' ? MOON[b.art.type] : KIND[b.kind]);

  function bodyArt(b, style, size = 96) {
    let src = null;
    if (b.kind === 'planet') src = SimFaces.planet(b.art, style, size);
    else if (b.kind === 'moon') src = SimFaces.moon(b.art, style, size);
    if (!src) return Kit.icon(b.kind === 'belt' ? 'ORE' : b.kind === 'nebula' ? 'VOL' : 'jump', 48, { code: 'ORB' });
    return h('img', { class: 'sim-art', src, width: size, height: size, alt: '', 'aria-hidden': 'true' });
  }

  function create(layer, { act, onClose }) {
    let view = null, sheet = null, last = '';
    const go = (name, args = {}) => () => act(name, args);

    // ---------- A body ----------
    function body(ctx) {
      const { w } = ctx, b = w.bodies.find((x) => x.key === view.key);
      if (!b) return null;
      const parent = b.parent ? w.bodies.find((x) => x.key === b.parent) : null;
      const out = [];
      out.push(h('div', { class: 'sim-row' }, bodyArt(b, ctx.style, 88),
        h('div', { class: 'grow' },
          b.kind === 'gate' ? h('p', { class: 'sim-note' }, 'The edge of the system, where the jump gate goes up.') : h('div', { class: 'sim-yield' },
            h('span', {}, 'Minerals', pips(b.m, C.RES.m.color)),
            h('span', {}, 'Volatiles', pips(b.v, C.RES.v.color))))));
      if (b.trait) {
        const t = C.TRAITS[b.trait], tone = t.culture ? C.CULTURES[t.culture].color : 'var(--new)';
        out.push(h('div', { class: 'sim-trait', style: { '--tone': tone } }, Kit.icon(t.code, 28, { code: t.code }), h('div', {}, h('b', {}, t.name), h('span', { class: 'sim-note' }, t.note))));
      }
      return { title: b.name, kicker: kindLine(b), sub: parent ? `round ${parent.name}` : `orbit ${b.ring + 1}`, body: out };
    }

    // ---------- The menu ----------
    function menu(ctx) {
      const style = ctx.style;
      return {
        title: 'Menu', code: 'SYS',
        body: [
          Kit.head('Art style'),
          h('div', { class: 'sim-acts' },
            Kit.button('Line', go('style', { style: 'line' }), { kind: style === 'line' ? 'primary' : '' }),
            Kit.button('Low-poly', go('style', { style: 'lowpoly' }), { kind: style === 'lowpoly' ? 'primary' : '' })),
          Kit.head('Run'),
          h('p', { class: 'sim-note' }, ctx.state ? `${ctx.state.mode === 'story' ? 'Story' : 'Endless'} · ${ctx.state.escaped} system${ctx.state.escaped === 1 ? '' : 's'} escaped` : ''),
          h('div', { class: 'sim-acts' }, Kit.button('Title screen', go('title'), { kind: 'ghost' })),
        ],
      };
    }

    const BUILD = { body, menu };

    function render(ctx) {
      const o = view && BUILD[view.kind] ? BUILD[view.kind](ctx) : null;
      if (!o) { close(); return; }
      const sig = JSON.stringify([view, o.title, o.sub, o.kicker]) + nodesSig(o.body) + nodesSig(o.foot);
      if (sheet && sheet.isOpen && sig === last) return;
      last = sig;
      const opts = { ...o, host: layer, onClose: () => { sheet = null; view = null; last = ''; onClose(); } };
      if (sheet && sheet.isOpen) sheet.update(opts);
      else { layer.hidden = false; sheet = Kit.sheet(opts); }
    }
    const nodesSig = (x) => (!x ? '' : (Array.isArray(x) ? x : [x]).flat(Infinity).map((n) => (n && n.outerHTML) || String(n ?? '')).join(''));
    function close() {
      if (sheet && sheet.isOpen) { const s = sheet; sheet = null; s.close(true); }
      layer.hidden = true; last = '';
    }

    return {
      show(v, ctx) { view = v; if (!v) { close(); return; } last = ''; render(ctx); },
      refresh(ctx) { if (view) render(ctx); },
      get view() { return view; },
      get top() { const p = layer.querySelector('.ui-sheet'); return p ? p.getBoundingClientRect().top : null; },
    };
  }

  return { create, bodyArt, pips, kindLine };
})();

export { SimSheets };
