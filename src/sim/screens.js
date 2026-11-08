// Redshift's full screens, over everything (the #screen layer): the title (story, endless, or the run
// under way), the jump's choice of destinations, the arrival (what the last system earned), a system
// lost to the horizon, a run's end, and the Archive (permanent upgrades, bought with Insight). Built from the UI kit; buttons name what they do through
// act(name, args), which the page (main.js) carries out.
//
//   SimScreens.create(layer, { act }) -> screens
//     screens.title(state, meta, style), jump(state, meta, style), arrived(state, meta, style, summary),
//     lost(state, meta, style), over(result, meta, style), archive(state, meta, style, back: 'title' | 'arrive'),
//     hide(), refresh()   (the title, the jump or the Archive again, after something changed)
//     screens.open: whether one is showing
// ES module (`SimScreens`); needs a browser.

import { ArtSites } from '../art/sites.js';
import { Kit } from '../ui/kit.js';
import { UI } from '../ui/ui.js';
import { SimConfig } from './config.js';
import { SimFaces } from './faces.js';
import { SimRules } from './rules.js';
import { SimSheets } from './sheets.js';

const SimScreens = (() => {
  const { h } = UI;
  const C = SimConfig, R = SimRules;
  const DIST = { near: 'Near the hole', mid: 'Middle distance', far: 'Far out' };
  const RICH = { m: 'Rich in minerals', v: 'Rich in volatiles', poor: 'Poor', null: 'Ordinary' };

  function create(layer, { act }) {
    let shown = null; // which screen, to refresh it
    const go = (name, args = {}) => () => act(name, args);
    function put(...children) {
      layer.replaceChildren(h('div', { class: 'inner' }, children));
      layer.hidden = false;
      layer.scrollTop = 0;
    }

    function title(state, meta, style) {
      shown = ['title', state, meta, style];
      const hole = SimFaces.site({ ...ArtSites.sample('smbh', 7), r: 40 }, style, 220);
      const w = state ? R.world(state) : null;
      put(
        h('img', { class: 'sim-hero', src: hole, alt: '' }),
        h('h1', { class: 'sim-title' }, 'Red', h('span', {}, 'shift')),
        h('p', { class: 'sim-tag' }, 'The hole is eating the galaxy. Build, jump, stay ahead of it.'),
        h('div', { class: 'sim-modes' },
          state ? h('button', { class: 'sim-mode', type: 'button', onclick: go('continue') },
            h('img', { src: SimFaces.star(w.star, style, 112), alt: '' }),
            h('span', {}, h('b', {}, 'Continue'), h('small', {}, `${w.name} · ${state.mode === 'story' ? 'Story' : 'Endless'} · horizon ${Math.round(state.pull)}%`))) : null,
          h('button', { class: 'sim-mode', type: 'button', onclick: go('start', { mode: 'story' }) },
            h('img', { src: SimFaces.face(SimFaces.person('android', 7), style, 112), alt: '' }),
            h('span', {}, h('b', {}, state ? 'New story' : 'Story'), h('small', {}, 'Seven systems. Meet the cultures one by one.'))),
          h('button', { class: 'sim-mode', type: 'button', onclick: go('start', { mode: 'endless' }) },
            h('img', { src: SimFaces.star({ cls: 'M', r: 200, seed: 3 }, style, 112), alt: '' }),
            h('span', {}, h('b', {}, state ? 'New endless run' : 'Endless'), h('small', {}, meta.best ? `Everything at once. Best: ${meta.best} systems.` : 'Everything at once, for as long as you last.')))),
        R.archiveOpen(meta) ? h('button', { class: 'sim-mode', type: 'button', onclick: go('archivescreen', { back: 'title' }) },
          h('span', { class: 'sim-mode-ic' }, Kit.icon('ARC', 40, { code: 'ARC' })),
          h('span', {}, h('b', {}, 'Archive'), h('small', {}, `${meta.insight || 0} Insight to spend on what every system starts with.`))) : null,
        h('div', { class: 'sim-acts', style: { justifyContent: 'center' } },
          Kit.button('Line', go('style', { style: 'line' }), { kind: style === 'line' ? 'primary' : 'ghost' }),
          Kit.button('Low-poly', go('style', { style: 'lowpoly' }), { kind: style === 'lowpoly' ? 'primary' : 'ghost' })));
    }

    // A destination: its star, how far from the hole, what it holds, its hazard.
    function destCard(state, d, i, style) {
      const hz = d.terms.hazard ? C.HAZARDS[d.terms.hazard] : null;
      return h('div', { class: 'sim-dest' },
        h('div', { class: 'top' },
          h('img', { src: SimFaces.star(d.star, style, 128), alt: '' }),
          h('div', { class: 'grow' },
            h('h3', {}, d.name),
            h('div', { class: 'facts' }, h('span', {}, DIST[d.terms.distance]), h('span', {}, RICH[d.terms.rich])),
            h('div', { class: 'facts' }, h('span', {}, 'Horizon from ', h('b', {}, `${d.pull0}%`)), h('span', {}, h('b', {}, `${d.life}`), ' cycles')),
            h('div', { class: 'facts' }, h('span', {}, `${d.bodies} bodies`), h('span', {}, SimSheets.resIcon('m', style, 14), ` ${d.minerals}`), h('span', {}, SimSheets.resIcon('v', style, 14), ` ${d.volatiles}`), d.traits.length ? h('span', {}, `${d.traits.length} traits`) : null))),
        hz ? h('div', { class: 'hz' }, h('img', { src: SimFaces.site({ ...ArtSites.sample(hz.site, d.terms.seed % 50 + 1), r: 40 }, style, 80), alt: '' }), h('span', {}, h('b', {}, hz.name), ' · ', hz.note)) : h('div', { class: 'hz', style: { color: 'var(--good)' } }, 'No hazards'),
        Kit.button('Jump here', go('jump', { i }), { kind: 'primary', wide: true }));
    }

    function jump(state, meta, style) {
      shown = ['jump', state, meta, style];
      const list = R.choices(state, meta), ins = R.insightNow(state);
      put(
        h('p', { class: 'sim-big' }, 'Where to?'),
        h('p', { class: 'sim-sub' }, `Overcharge ${Math.round(state.gate.charge * 100)}% · jumping now earns ${ins} Insight. Nothing built comes with us.`),
        list.map((d, i) => destCard(state, d, i, style)),
        Kit.button('Not yet', go('jumpback'), { kind: 'ghost', wide: true }));
    }

    function arrived(state, meta, style, r) {
      shown = null;
      const w = R.world(state), hz = w.hazard ? C.HAZARDS[w.hazard] : null;
      put(
        h('p', { class: 'sim-big' }, `Escaped ${r.from}`),
        h('div', { class: 'sim-summary' },
          r.parts.map(([label, n]) => h('div', { class: 'row' }, h('span', {}, label), h('b', {}, `+${n} Insight`))),
          h('div', { class: 'row' }, h('span', {}, 'Insight banked'), h('b', {}, `${meta.insight}`)),
          r.boons.map((b) => h('div', { class: 'row' }, h('span', {}, b.name), h('b', {}, b.note)))),
        h('img', { class: 'sim-hero', src: SimFaces.star(w.star, style, 220), alt: '' }),
        h('p', { class: 'sim-big' }, `${w.name}`),
        h('p', { class: 'sim-sub' }, `${DIST[w.distance]} · ${RICH[w.rich]}${hz ? ` · ${hz.name}` : ''}`),
        R.archiveOpen(meta) ? Kit.button(`Archive · ${meta.insight} Insight`, go('archivescreen', { back: 'arrive' }), { wide: true }) : null,
        Kit.button('Arrive', go('arrive'), { kind: 'primary', lg: true, wide: true }));
    }

    function lost(state, meta, style) {
      shown = null;
      const w = R.world(state), story = state.mode === 'story';
      put(
        h('img', { class: 'sim-hero', src: SimFaces.site({ ...ArtSites.sample('stellar-black-hole', 3, 'heavy'), r: 40 }, style, 220), alt: '' }),
        h('p', { class: 'sim-big' }, 'Lost to the horizon'),
        h('p', { class: 'sim-sub' }, `${w.name} has stopped. Every orbit, every station, every crew, held still at the edge of the hole.`),
        story ? Kit.button('Try this system again', go('retry'), { kind: 'primary', lg: true, wide: true })
          : h('p', { class: 'sim-sub' }, `${state.escaped} systems escaped. Half of what this one earned, ${Math.floor(R.insightNow(state) * C.INSIGHT.lostKeep)} Insight, is kept.`),
        story ? Kit.button('Title screen', go('title'), { kind: 'ghost', wide: true }) : Kit.button('End the run', go('endrun'), { kind: 'primary', lg: true, wide: true }));
    }

    function over(r, meta, style) {
      shown = null;
      put(
        h('p', { class: 'sim-big' }, 'Run over'),
        h('div', { class: 'sim-summary' },
          h('div', { class: 'row' }, h('span', {}, 'Systems escaped'), h('b', {}, `${r.escaped}`)),
          h('div', { class: 'row' }, h('span', {}, 'Best'), h('b', {}, `${meta.best || 0}`)),
          h('div', { class: 'row' }, h('span', {}, 'Insight kept'), h('b', {}, `+${r.insight}`)),
          h('div', { class: 'row' }, h('span', {}, 'Insight banked'), h('b', {}, `${meta.insight}`))),
        Kit.button('Title screen', go('title'), { kind: 'primary', lg: true, wide: true }));
    }

    // The Archive: permanent upgrades bought with Insight, kept across systems and runs.
    function archive(state, meta, style, back = 'title') {
      shown = ['archive', state, meta, style, back];
      put(
        h('p', { class: 'sim-big' }, 'The Archive'),
        h('p', { class: 'sim-sub' }, 'What we learn outlives what we build. Every system after this one starts with these.'),
        h('div', { class: 'sim-insight' }, Kit.icon('ARC', 28, { code: 'ARC' }), h('span', { class: 'num' }, `${meta.insight || 0}`), h('span', {}, 'Insight')),
        Object.entries(C.ARCHIVE).map(([id, A]) => {
          const lv = R.archive(meta, id), cost = A.cost[lv];
          return Kit.optionRow({
            code: A.code, name: A.name, sub: A.note, current: lv > 0,
            extra: h('span', { class: 'sim-lv' }, Array.from({ length: A.lv }, (_, i) => h('i', { class: i < lv ? 'on' : '' })), lv >= A.lv ? h('b', {}, 'Complete') : null),
            action: lv >= A.lv ? null : Kit.button(`${cost} ✦`, go('archive', { id }), { kind: (meta.insight || 0) >= cost ? 'primary' : '', disabled: (meta.insight || 0) < cost, aria: `Buy ${A.name} for ${cost} Insight` }),
          });
        }),
        Kit.button(back === 'arrive' ? 'Arrive' : 'Back', go(back === 'arrive' ? 'arrive' : 'title'), { kind: back === 'arrive' ? 'primary' : 'ghost', lg: back === 'arrive', wide: true }));
    }

    function hide() { layer.hidden = true; layer.replaceChildren(); shown = null; }
    function refresh() {
      if (!shown) return;
      const [kind, ...args] = shown;
      ({ title, jump, archive })[kind]?.(...args);
    }

    return { title, jump, arrived, lost, over, archive, hide, refresh, get open() { return !layer.hidden; } };
  }

  return { create };
})();

export { SimScreens };
