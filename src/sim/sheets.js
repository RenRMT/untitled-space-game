// Redshift's bottom sheets, built from the game's UI kit (ui/kit.js: Kit.sheet, option rows,
// meters, quotes), one at a time over the map:
// - a body's: its art, what it holds (minerals and volatiles, as pips), its trait; then its station
//   (its crew chief, what it makes and why, its ships, its upgrade) or what could be built there,
// - Build: the station cards in a tray; one picked, the map marks where it could go and the sheet
//   lists the best spots,
// - Cultures: each culture here, its leader, its approval and what it wants,
// - Gate: its three stages, then the overcharge, what the jump would earn, and the jump,
// - Chart: the systems left behind, each to look at frozen in time,
// - the menu: the art style, back to the title.
// Each is rebuilt when what it shows changes (compared as markup, so a tap is never lost to a
// refresh). Buttons name what they do through act(name, args), which the page (main.js) carries out.
//
//   SimSheets.create(layer, { act, onClose }) -> sheets
//     sheets.show(view | null, ctx)   view: { kind: 'body' | 'build' | 'cultures' | 'gate' | 'chart' | 'offer' | 'menu', key?, id? };
//                                     ctx: { state, meta, w, style, buildType }
//     sheets.refresh(ctx)             rebuild if anything shown changed
//     sheets.view, sheets.top         what's open; the sheet's top edge on screen (px), or null
//   SimSheets.costLine(state, cost, style), resIcon(res, style, size), stationThumb(w, st, style, size)
// ES module (`SimSheets`); needs a browser.

import { ItemIcons } from '../art/icons.js';
import { Kit } from '../ui/kit.js';
import { UI } from '../ui/ui.js';
import { SimConfig } from './config.js';
import { SimEvents } from './events.js';
import { SimFaces } from './faces.js';
import { SimMap } from './map.js';
import { SimRules } from './rules.js';
import { SimWorld } from './world.js';

const SimSheets = (() => {
  const { h } = UI;
  const C = SimConfig, R = SimRules;
  const KIND = { planet: 'Planet', moon: 'Moon', belt: 'Asteroid belt', nebula: 'Nebula', gate: 'Gate site' };
  const PLANET = { lava: 'Lava world', desert: 'Desert world', terran: 'Terran world', ice: 'Ice world', gas: 'Gas giant', blue: 'Ice giant' };
  const MOON = { grey: 'Grey moon', ice: 'Ice moon', rust: 'Rust moon', dark: 'Carbon moon', sulfur: 'Volcanic moon' };
  const MK = ['', 'Mk I', 'Mk II', 'Mk III'];
  const fmt = (n) => (Math.abs(n) >= 10 ? n.toFixed(0) : n.toFixed(1));

  const pips = (n, color) => h('span', { class: 'sim-pips', style: { color }, 'aria-label': `${n} of 3` }, [0, 1, 2].map((i) => h('i', { class: i < n ? 'on' : '' })));
  const kindLine = (b) => (b.kind === 'planet' ? PLANET[b.art.type] : b.kind === 'moon' ? MOON[b.art.type] : KIND[b.kind]);

  // A resource's icon: minerals, volatiles and science as their goods' art (art/icons.js), credits
  // as the kit's diamond.
  function resIcon(res, style, size = 16) {
    const R0 = C.RES[res];
    if (!R0?.icon) return h('span', { class: 'sim-ri cr', style: { width: `${size}px`, height: `${size}px` }, 'aria-hidden': 'true' }, h('i', {}));
    return h('img', { class: 'sim-ri', src: ItemIcons.url(R0.icon, style, size), width: size, height: size, alt: '', 'aria-hidden': 'true' });
  }
  // A cost: each resource's icon and amount, short ones in the warning colour.
  function costLine(state, cost, style) {
    if (!cost) return null;
    return h('span', { class: 'sim-cost', 'aria-label': Object.entries(cost).map(([r, n]) => `${n} ${C.RES[r].name}`).join(', ') },
      Object.entries(cost).map(([r, n]) => h('span', { class: (state.res[r] || 0) >= n ? '' : 'short' }, resIcon(r, style, 14), String(n))));
  }
  // What something makes per cycle: +1.2 Min −0.3 Vol.
  function rateLine(r, style) {
    const parts = [];
    for (const [res, n] of Object.entries(r.out || {})) if (n) parts.push(h('span', { class: 'up' }, resIcon(res, style, 14), `+${fmt(n)}`));
    for (const [res, n] of Object.entries(r.in || {})) if (n) parts.push(h('span', { class: 'down' }, resIcon(res, style, 14), `−${fmt(n)}`));
    if (r.sec) parts.push(h('span', { class: 'up' }, Kit.icon('SHD', 14, { code: 'SHD' }), `+${fmt(r.sec)} sec`));
    return h('span', { class: 'sim-rate' }, parts.length ? parts : h('span', { class: 'dim' }, 'nothing'));
  }

  function bodyArt(b, style, size = 96) {
    let src = null;
    if (b.kind === 'planet') src = SimFaces.planet(b.art, style, size);
    else if (b.kind === 'moon') src = SimFaces.moon(b.art, style, size);
    if (!src) return Kit.icon(b.kind === 'belt' ? 'ORE' : b.kind === 'nebula' ? 'VOL' : 'jump', 48, { code: 'ORB' });
    return h('img', { class: 'sim-art', src, width: size, height: size, alt: '', 'aria-hidden': 'true' });
  }
  const stationThumb = (w, st, style, size = 72) => h('img', { class: 'sim-art', src: SimFaces.bp(SimMap.stationArt(w.seed, st), style, size, `st:${w.seed}:${SimMap.stationArtKey(st)}`), width: size, height: size, alt: '', 'aria-hidden': 'true' });
  const typeThumb = (w, type, style, size = 64) => stationThumb(w, { type, level: 1, culture: C.STATIONS[type].culture, seed: 3 }, style, size);
  const shipThumb = (w, st, i, style, size = 44) => h('img', { class: 'sim-art', src: SimFaces.bp(SimMap.shipArt(w.seed, st, i), style, size, `sh:${w.seed}:${st.type}:${st.culture}:${st.level >= 3}:${st.seed}:${i}`), width: size, height: size, alt: '', 'aria-hidden': 'true' });

  // What a station's crew chief says about how it's going.
  function chiefLine(st, r) {
    const S = C.STATIONS[st.type];
    if (st.left > 0) return 'Still putting her together. Give us a few cycles.';
    if (st.blocked > 0) return `Drifters have us boxed in. ${st.blocked} cycles of this, or someone does something.`;
    if (st.off > 0) return `We're knocked out. Back in ${st.off} cycles.`;
    if (r.notes.some(([n]) => n === 'On strike')) return 'The crew have downed tools. Give them a reason to care.';
    if (r.running != null && r.running < 0.99) return 'We\'re short of what we run on. Keep it coming.';
    if (!st.ships && S.ship) return `Running. A ${S.ship.name.toLowerCase()} would do a lot for us.`;
    return 'All running.';
  }

  function create(layer, { act, onClose }) {
    let view = null, sheet = null, last = '';
    const go = (name, args = {}) => () => act(name, args);

    // ---------- A body ----------
    function body(ctx) {
      const { w, state, style } = ctx, b = w.bodies.find((x) => x.key === view.key);
      if (!b) return null;
      if (b.kind === 'gate') return gate(ctx, b);
      const parent = b.parent ? w.bodies.find((x) => x.key === b.parent) : null;
      const out = [];
      out.push(h('div', { class: 'sim-row' }, bodyArt(b, style, 80),
        h('div', { class: 'grow' },
          h('div', { class: 'sim-yield' },
            h('span', {}, resIcon('m', style, 16), 'Minerals', pips(b.m, C.RES.m.color)),
            h('span', {}, resIcon('v', style, 16), 'Volatiles', pips(b.v, C.RES.v.color))),
          h('p', { class: 'sim-note' }, groupNote(w, state, b)))));
      if (b.trait) {
        const t = C.TRAITS[b.trait], tone = t.culture ? C.CULTURES[t.culture].color : 'var(--new)';
        out.push(h('div', { class: 'sim-trait', style: { '--tone': tone } }, Kit.icon(t.code, 28, { code: t.code }), h('div', {}, h('b', {}, t.name), h('span', { class: 'sim-note' }, t.note))));
      }
      // Its ground, as the survey drones saw it (art/surface.js).
      if (b.kind === 'planet' || b.kind === 'moon') out.push(h('figure', { class: 'sim-survey' }, h('img', { src: SimFaces.surface(b.kind, b.art, style), alt: `The surface of ${b.name}` }), h('figcaption', {}, 'Surface survey')));
      const st = state.stations[b.key];
      if (st) out.push(...station(ctx, b, st));
      else out.push(...buildHere(ctx, b));
      return { title: b.name, kicker: kindLine(b), sub: parent ? `round ${parent.name}` : `orbit ${b.ring + 1}`, body: out };
    }
    function groupNote(w, state, b) {
      const g = SimWorld.group(w, b.key).filter((k) => k !== b.key);
      if (!g.length) return b.kind === 'belt' ? 'A ring of rock round the star.' : b.kind === 'nebula' ? 'A cloud of gas, rich in volatiles.' : 'No moons.';
      const built = g.filter((k) => state.stations[k]).length;
      return `${g.length === 1 ? 'One neighbour' : `${g.length} neighbours`} in its group${built ? `, ${built} built on` : ''}.`;
    }

    function station(ctx, b, st) {
      const { w, state, meta, style } = ctx, S = C.STATIONS[st.type], key = b.key;
      const out = [];
      if (st.wreck) return [h('p', { class: 'sim-note' }, 'A wreck. Clear it to build here again.'), h('div', { class: 'sim-acts' }, Kit.button('Clear wreck', go('demolish', { key }), { kind: 'ghost' }))];
      if (st.rogue || st.alien || st.outpost) {
        const what = st.rogue ? ['Rogue station', `Drifters built this without asking. It skims ${Math.round(C.DRIFTERS.skim * 100)}% of the system's minerals and volatiles.`]
          : st.outpost ? ['Drifter outpost', `It pays ${C.DRIFTERS.outpost.cr} credits a cycle. The Wedge hate it.`] : ['Alien hive', 'Something grown, not built. It gives science and volatiles, and answers to no one.'];
        const off = state.offers.find((o) => o.key === key);
        return [Kit.head(what[0]), h('div', { class: 'sim-row' }, stationThumb(w, st, style, 72), h('p', { class: 'sim-note grow' }, what[1])),
          off ? h('div', { class: 'sim-acts' }, Kit.button('Deal with it', go('offer', { id: off.id }), { kind: 'primary' })) : null,
          st.outpost ? h('div', { class: 'sim-acts' }, Kit.button('Tear it down', go('demolish', { key }), { kind: 'ghost' })) : null];
      }
      const r = state.rates?.by?.[key] || R.stationRates(state, meta, w, key, st);
      const chief = SimFaces.person(st.culture, st.seed);
      out.push(Kit.head(`${S.name} · ${MK[st.level]}`, h('span', { class: 'aside' }, C.CULTURES[st.culture].name)));
      out.push(h('div', { class: 'sim-row' }, stationThumb(w, st, style, 72),
        h('div', { class: 'grow' },
          st.left > 0 ? [h('span', { class: 'sim-note' }, `Building · ${Math.ceil(st.left)} cycles`), Kit.meter(1 - st.left / st.total, { thin: true })] : rateLine(r, style),
          r.notes.length ? h('div', { class: 'sim-notes' }, r.notes.map(([n, k]) => h('span', { class: k > 1 ? 'up' : k < 1 ? 'down' : '' }, k && k !== 1 ? `${n} ×${fmt(k)}` : n))) : null)));
      out.push(Kit.quote({ from: chief.name, kind: `${chief.title}, ${S.name.toLowerCase()}`, face: SimFaces.img(chief, style, 56), lines: [chiefLine(st, r)], color: C.CULTURES[st.culture].color }));
      if (st.left > 0) return out;
      // Ships: a slot each, filled or to fill; one more slot to buy.
      const shipCost = R.cost(state, meta, 'ship', key), slotCost = R.cost(state, meta, 'slot', key);
      out.push(Kit.head('Ships', h('span', { class: 'aside' }, `${st.ships} / ${st.slots}`)));
      const tiles = [];
      for (let i = 0; i < st.slots; i++) {
        if (i < st.ships) tiles.push(h('div', { class: 'sim-slot full' }, shipThumb(w, st, i, style, 44), h('span', {}, S.ship.name)));
        else tiles.push(h('button', { class: 'sim-slot', type: 'button', disabled: !R.afford(state, shipCost), onclick: go('ship', { key }), 'aria-label': `Commission a ${S.ship.name}` }, h('b', {}, '+'), h('span', {}, S.ship.name), costLine(state, shipCost, style)));
      }
      if (st.slots < C.MAX_SLOTS) tiles.push(h('button', { class: 'sim-slot ghost', type: 'button', disabled: !R.afford(state, slotCost), onclick: go('slot', { key }), 'aria-label': 'Add a ship slot' }, h('b', {}, '⊕'), h('span', {}, 'Slot'), costLine(state, slotCost, style)));
      out.push(h('div', { class: 'sim-slots' }, tiles));
      out.push(h('p', { class: 'sim-note' }, S.ship.sec ? `Each ${S.ship.name.toLowerCase()} adds ${S.ship.sec} security, and can break a blockade.` : `Each ${S.ship.name.toLowerCase()} adds ${Math.round(S.ship.bonus * 100)}% to what the station makes.`));
      // The upgrade: its fitting (an equipment icon) at the next Mk.
      if (st.level < 3) {
        const c = R.cost(state, meta, 'upgrade', key);
        out.push(Kit.optionRow({
          icon: h('img', { class: 'icon', src: ItemIcons.url(S.upgrade.gear, style, 40), alt: '', 'aria-hidden': 'true' }),
          name: `${S.upgrade.name} ${MK[st.level + 1]}`, sub: `×${C.LEVEL_MUL[st.level]} output${st.type === 'defense' ? ', a turret more' : ''}`,
          extra: costLine(state, c, style),
          action: Kit.button('Fit', go('upgrade', { key }), { disabled: !R.afford(state, c) }),
        }));
      }
      out.push(h('div', { class: 'sim-acts' }, Kit.button('Deconstruct', go('demolish', { key }), { kind: 'ghost', title: `Gives back ${Math.round(C.REFUND * 100)}% of its cost` })));
      return out;
    }

    // What could go up on an empty body: each station type with what it'd make here.
    function buildHere(ctx, b) {
      const { w, state, meta, style } = ctx;
      const types = C.STATION_ORDER.filter((t) => R.has(state, C.STATIONS[t].culture));
      const pickedFirst = ctx.buildType ? [ctx.buildType, ...types.filter((t) => t !== ctx.buildType)] : types;
      return [Kit.head('Build here'), ...pickedFirst.map((t) => {
        const S = C.STATIONS[t], r = R.canBuild(state, meta, b.key, t);
        const empty = S.per && !b[S.per];
        return Kit.optionRow({
          icon: typeThumb(w, t, style, 44), name: S.name, current: t === ctx.buildType,
          tag: C.CULTURES[S.culture].name, tagTone: C.CULTURES[S.culture].color,
          sub: empty ? r.why : null, extra: empty ? null : [rateLine(r.preview, style), costLine(state, r.cost, style)],
          action: Kit.button('Build', go('build', { key: b.key, type: t }), { kind: t === ctx.buildType && r.ok ? 'primary' : '', disabled: !r.ok, title: r.why }),
          locked: empty, lockLabel: null,
        });
      })];
    }

    // ---------- Build ----------
    function buildSheet(ctx) {
      const { w, state, meta, style } = ctx;
      const types = C.STATION_ORDER.filter((t) => R.has(state, C.STATIONS[t].culture));
      const picked = ctx.buildType;
      const tray = h('div', { class: 'sim-tray', role: 'listbox', 'aria-label': 'Stations' }, types.map((t) => {
        const S = C.STATIONS[t], c = R.cost(state, meta, 'station', t);
        return h('button', { class: 'sim-card', type: 'button', 'aria-pressed': String(t === picked), onclick: go('buildmode', { type: t === picked ? null : t }) },
          typeThumb(w, t, style, 64), h('span', { class: 'n' }, S.name), costLine(state, c, style));
      }));
      const out = [tray];
      if (picked) {
        const S = C.STATIONS[picked];
        out.push(h('p', { class: 'sim-note' }, `${S.note} Tap a marked body on the map, or pick one here.`));
        const spots = w.bodies.filter((b) => b.kind !== 'gate' && !state.stations[b.key])
          .map((b) => ({ b, r: R.canBuild(state, meta, b.key, picked) })).filter((x) => !(S.per && !x.b[S.per]))
          .sort((a, b) => score(b.r.preview) - score(a.r.preview)).slice(0, 4);
        out.push(spots.length ? spots.map(({ b, r }) => Kit.optionRow({
          icon: bodyArt(b, style, 40), name: b.name, tag: b.trait ? C.TRAITS[b.trait].name : null, tagTone: b.trait && C.TRAITS[b.trait].culture ? C.CULTURES[C.TRAITS[b.trait].culture].color : 'new',
          extra: rateLine(r.preview, style),
          action: Kit.button('Build', go('build', { key: b.key, type: picked }), { disabled: !r.ok, title: r.why }),
        })) : h('p', { class: 'ui-empty' }, 'Nowhere left for one.'));
      } else out.push(h('p', { class: 'sim-note' }, 'Pick a station, then where it goes. Every body takes one station.'));
      return { title: 'Build', code: 'IND', body: out };
    }
    const score = (p) => Object.entries(p.out).reduce((t, [, n]) => t + n, 0) + p.sec;

    // ---------- Cultures ----------
    function cultures(ctx) {
      const { state, style } = ctx;
      const out = [];
      // What the player took on, first: each request's asker, how far along, and the time left.
      if (state.requests.length) {
        out.push(Kit.head('Requests', h('span', { class: 'aside' }, `${state.requests.length}`)));
        for (const q of state.requests) {
          const p = SimEvents.progress(state, q);
          out.push(h('div', { class: 'sim-culture', style: { '--tone': C.CULTURES[q.culture].color } }, SimFaces.img(q.who, style, 40),
            h('div', { class: 'grow' },
              h('div', { class: 'sim-row' }, h('b', { class: 'req' }, q.title), q.deadline ? h('span', { class: 'aside num' }, `${Math.max(0, Math.ceil(q.deadline - state.cycle))}c`) : null),
              Kit.meter(p.f, { thin: true, color: C.CULTURES[q.culture].color }),
              h('span', { class: 'sim-note' }, `${p.text} · ${SimEvents.rewardText(q.reward)}`))));
        }
      }
      for (const o of state.offers) {
        out.push(h('button', { class: 'sim-culture sim-ask', type: 'button', style: { '--tone': C.CULTURES[o.who.culture].color }, onclick: go('offer', { id: o.id }) }, SimFaces.img(o.who, style, 40),
          h('div', { class: 'grow' }, h('b', { class: 'req' }, o.title), h('span', { class: 'sim-note' }, `${o.who.name} is waiting on an answer.`))));
      }
      const built = R.builtCount(state);
      for (const c of C.SETTLED) {
        if (!R.has(state, c)) continue;
        const K = C.CULTURES[c], ap = state.approval[c], lead = SimFaces.person(c, state.terms.seed + c.length * 101);
        const want = C.WANT[K.values], need = want[0] + want[1] * Math.max(0, built - C.WANT_FREE);
        const got = c === 'wedge' ? state.rates.sec : state.rates[K.values] * R.dilation(state);
        const mood = ap <= 0 ? 'On strike' : ap >= C.APPROVAL.high ? 'Devoted' : ap <= C.APPROVAL.low ? 'Discontent' : 'Content';
        out.push(h('div', { class: 'sim-culture', style: { '--tone': K.color } },
          SimFaces.img(lead, style, 56),
          h('div', { class: 'grow' },
            h('div', { class: 'sim-row' }, h('b', {}, K.name), Kit.tag(mood, mood === 'Devoted' ? 'var(--good)' : mood === 'Content' ? 'var(--dim)' : 'var(--hostile)'), h('span', { class: 'aside num' }, `${Math.round(ap)}`)),
            Kit.meter(ap / 100, { thin: true, color: K.color }),
            h('span', { class: 'sim-note' }, `${lead.name}, ${lead.title}. Wants ${fmt(need)} ${K.values === 'sec' ? 'security' : C.RES[K.values].name.toLowerCase()} a cycle, has ${fmt(got)}${got >= need ? ' ✓' : ''}.`))));
      }
      for (const c of ['android', 'drifters', 'alien']) {
        if (!R.has(state, c)) continue;
        const K = C.CULTURES[c], p = SimFaces.person(c, state.terms.seed + 7);
        out.push(h('div', { class: 'sim-culture', style: { '--tone': K.color } }, SimFaces.img(p, style, 56),
          h('div', { class: 'grow' }, h('div', { class: 'sim-row' }, h('b', {}, K.name)), h('span', { class: 'sim-note' }, K.note),
            c === 'drifters' ? [Kit.meter(Math.min(1, state.unrest / C.DRIFTERS.at), { thin: true, color: K.color }), h('span', { class: 'sim-note' }, `Unrest ${Math.round((state.unrest / C.DRIFTERS.at) * 100)}% · security ${fmt(state.rates.sec)} of ${fmt(state.rates.demand)} needed`)] : null)));
      }
      return { title: 'Cultures', code: 'REP', body: out };
    }

    // ---------- The gate ----------
    function gate(ctx) {
      const { state, meta, style } = ctx, g = R.gateStatus(state, meta);
      const out = [h('div', { class: 'ui-segs' }, C.GATE.map((x, i) => h('span', { class: i < g.stage ? 'done' : i === g.stage ? 'open' : '', title: x.name })))];
      out.push(h('div', { class: 'sim-row' }, C.GATE.map((x, i) => h('span', { class: `sim-stage${i < g.stage ? ' done' : ''}` }, `${i < g.stage ? '✓ ' : ''}${x.name}`))));
      if (!g.done) {
        out.push(Kit.head(`Stage ${g.stage + 1}: ${g.next.name}`));
        if (g.building) out.push(Kit.meter(g.f, {}), h('p', { class: 'sim-note' }, `${Math.ceil(state.gate.left)} cycles of system time to go.`));
        else out.push(h('div', { class: 'sim-row' }, h('span', { class: 'grow' }, costLine(state, g.cost, style)), Kit.button('Build', go('gate'), { kind: 'primary', disabled: !g.ok, title: g.why })));
        out.push(h('p', { class: 'sim-note' }, 'Three stages, each paid for, then built over cycles. Built, the gate keeps charging: the longer you hold, the further it throws you.'));
        return { title: 'Jump gate', code: 'jump', kicker: 'Gate site', body: out };
      }
      const ins = R.insightNow(state), boons = R.boonsNow(state);
      out.push(Kit.head('Overcharge', h('span', { class: 'aside' }, `${Math.round(g.charge * 100)}%`)), Kit.meter(g.charge, { color: 'var(--cyan-hi)' }));
      out.push(h('p', { class: 'sim-note' }, `Charging faster as the horizon nears. Every choice will be ${Math.round(g.charge * C.HORIZON.overchargeLife * 100)}% further out, and start ${Math.round(g.charge * 10)}% lower on the meter.`));
      out.push(Kit.head('Jump now'),
        h('div', { class: 'sim-yield' }, h('span', {}, Kit.icon('ARC', 16, { code: 'ARC' }), `+${ins} Insight`),
          boons.map((c) => h('span', { style: { color: C.CULTURES[c].color } }, C.BOONS[c].name))));
      out.push(h('div', { class: 'sim-acts' }, Kit.button('Choose a destination', go('jumpscreen'), { kind: 'primary', lg: true })));
      return { title: 'Jump gate', code: 'jump', kicker: 'Ready', body: out };
    }

    // ---------- The Chart: the systems left behind ----------
    function chart(ctx) {
      const { state, style, w } = ctx;
      const out = [h('p', { class: 'sim-note' }, 'Every system we left is still there, frozen at the edge of the hole: so near it, its clock has all but stopped. Look, but nothing there can be changed.')];
      out.push(Kit.optionRow({ icon: h('img', { class: 'icon', src: SimFaces.star(w.star, style, 80), alt: '' }), name: w.name, tag: 'Here', tagTone: 'good', sub: `Horizon ${state.pull.toFixed(0)}% · ${R.builtCount(state)} stations` }));
      if (!state.past.length) out.push(h('p', { class: 'ui-empty' }, 'Nowhere yet. The gate is the only way out.'));
      for (let i = state.past.length - 1; i >= 0; i--) {
        const p = state.past[i], pw = SimWorld.generate(p.terms.seed, p.terms);
        const n = Object.values(p.stations).filter((x) => C.STATIONS[x.type] && !x.left).length;
        out.push(Kit.optionRow({
          icon: h('img', { class: 'icon', src: SimFaces.star(pw.star, style, 80), alt: '' }), name: p.name,
          sub: `Left at ${p.pull.toFixed(0)}% · ${n} station${n === 1 ? '' : 's'} · ${Math.floor(p.made.sci)} science`,
          action: Kit.button('Look', go('chart', { i }), {}),
        }));
      }
      return { title: 'Chart', code: 'SYS', body: out };
    }

    // ---------- An offer (a request, a revolt, a visitor: events.js) ----------
    function offer(ctx) {
      const { state, meta, style } = ctx, o = state.offers.find((x) => x.id === view.id);
      if (!o) return null;
      const K = C.CULTURES[o.who.culture];
      const out = [Kit.quote({ from: o.who.name, kind: o.who.title, face: SimFaces.img(o.who, style, 72), lines: o.lines, color: K.color })];
      if (o.deadline) out.push(h('p', { class: 'sim-note' }, `${Math.max(0, Math.ceil(o.deadline - state.cycle))} cycles to answer.`));
      if (o.reward) out.push(h('div', { class: 'sim-yield' }, h('span', { class: 'ui-label' }, 'Reward'), h('span', { class: 'num' }, SimEvents.rewardText(o.reward))));
      if (o.kind === 'request' && o.key && o.key !== ctx.w.gate) out.push(h('div', { class: 'sim-acts' }, Kit.button('Show me', go('open', { key: o.key }), { kind: 'ghost' })));
      const answers = SimEvents.answers(state, meta, o.id);
      const foot = [
        h('div', { class: 'sim-answers' }, answers.map((a) => h('div', { class: 'sim-answer' },
          Kit.button(a.label, go('answer', { id: o.id, answer: a.id }), { kind: a.primary && a.ok ? 'primary' : a.warn ? 'warn' : '', disabled: !a.ok, title: a.why, wide: true }),
          a.cost ? costLine(state, a.cost, style) : null))),
        answers.filter((a) => !a.ok && a.why).map((a) => h('p', { class: 'sim-note' }, `${a.label}: ${a.why}.`)),
      ];
      return { title: o.title, kicker: K.name, kickerColor: K.color, body: out, foot };
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

    const BUILD = { body, build: buildSheet, cultures, gate: (ctx) => gate(ctx), offer, chart, menu };

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

  return { create, bodyArt, pips, kindLine, costLine, rateLine, resIcon, stationThumb, typeThumb, fmt };
})();

export { SimSheets };
