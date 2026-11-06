// The 4X game's ways of building a station round a planet or moon and taking one away
// (notes/4x-building-research.md), as prototypes to play side by side, like the ways of giving move
// orders (4x/movement.js). There are two kinds of station (World4X.STATIONS: an Outpost and a
// Starbase), at most one round each planet or moon; any station can be dismantled.
//
//   menu    tap a planet or moon: the card offers Build Outpost / Build Starbase; tap a station:
//           Dismantle. Done at once, with Undo on the card for a few seconds
//   ghost   pick a kind (or Remove) in the tray: the places it can go are ringed green, the ones it
//           can't red; tap one and a ghost shows where it would go, then Build (or Cancel) on the card
//   drag    drag a kind from the tray onto the map: the ghost follows the finger and snaps to a planet
//           or moon, green where it can go; let go to build. Drag a station off its body (or onto the
//           tray) to dismantle it
//
//   Building.SCHEMES                       [{ id, name }] in the order the header cycles them
//   Building.create(id, ctx) -> scheme     ctx: { world, view, selected() -> pick | null,
//                                          select(pick | null), say(text) }
//     scheme.pick(it, at) -> handled       a tap on the map (at from 4x/view.js); false: the page picks
//     scheme.press(it, at) -> claims       a press starts on the map (true: the drag is the scheme's)
//     scheme.drag(at), scheme.release(at)  at also has `body` (a planet or moon under the finger, or
//                                          null) and `overTray` (the finger is over the tray)
//     scheme.tray -> [{ id, label, on, bin }] | null    the tray's buttons (null: no tray)
//     scheme.trayTap(id), scheme.trayDown(id) -> claims a tap on a tray button, or a press that
//                                          starts a drag out of the tray
//     scheme.escape() -> handled
//     scheme.card(node | null) -> { kind, name, status, acts } | null   the card (null: the page's own)
//     scheme.hint() -> text                the header's line
//     scheme.overlay(now) -> build | null  for view.draw
// ES module (`Building`); needs a browser (the map).

import { World4X } from './world.js';

const Building = (() => {
  const SCHEMES = [
    { id: 'menu', name: 'Menu' },
    { id: 'ghost', name: 'Ghost' },
    { id: 'drag', name: 'Drag' },
  ];
  const TYPES = Object.keys(World4X.STATIONS);
  const BODIES = ['planet', 'moon'];
  const TAP_SNAP = 24; // px round a tap that still lands on a body or station
  const OFF = 60; // px a station is dragged from where it is before letting go dismantles it
  const UNDO = 4000; // ms Undo stays on the card

  const nameOf = (type) => World4X.STATIONS[type].name;

  function create(id, ctx) {
    const { world, view } = ctx;
    const node = (it) => (it?.key ? world.node(it.key) : null);
    const isBody = (n) => !!n && BODIES.includes(n.kind);
    const stationOf = (body) => world.start.nodes.find((n) => n.kind === 'station' && n.parent === body.key);
    // Ringed: green where it can go, red where it can't (in Remove, the station picked red).
    const marks = (type) => world.buildHosts().map((b) => ({ key: b.key, ok: !world.canBuild(b.key, type) }));
    const build = (body, type) => {
      const r = world.build(body, type);
      if (r.why) { ctx.say(r.why); return null; }
      ctx.say(`Building ${world.node(r.key).name}`);
      return r.key;
    };
    const dismantle = (key) => {
      const st = world.node(key), why = world.dismantle(key);
      if (why) { ctx.say(why); return null; }
      ctx.say(`${st.name} dismantled`);
      return st;
    };
    const base = {
      tray: null,
      pick: () => false, press: () => false, drag() {}, release() {}, escape: () => false,
      trayTap() {}, trayDown: () => false,
      card: () => null, overlay: () => null,
      hint: () => 'Build mode',
    };

    if (id === 'ghost') {
      let tool = null, target = null; // tool: a station type or 'remove'; target: a body or station key
      const confirm = () => {
        if (!target) return;
        if (tool === 'remove') { if (dismantle(target)) target = null; return; }
        if (build(target, tool)) target = null;
      };
      return {
        ...base,
        get tray() {
          return [...TYPES.map((t) => ({ id: t, label: nameOf(t), on: tool === t })), { id: 'remove', label: 'Remove', on: tool === 'remove', bin: true }];
        },
        trayTap(t) { tool = tool === t ? null : t; target = null; if (tool && view.band === 'galaxy') view.go('system'); },
        pick(it, at) {
          if (!tool) return false;
          const snapped = view.pickAt(at.x, at.y, tool === 'remove' ? ['station'] : BODIES, TAP_SNAP);
          target = snapped?.key || null;
          return true;
        },
        escape() { if (target) { target = null; return true; } if (tool) { tool = null; return true; } return false; },
        card() {
          if (!tool) return null;
          const t = target && world.node(target);
          if (tool === 'remove') {
            if (!t) return { kind: 'Remove', name: 'Dismantle a station', status: 'Tap a station to take it away', acts: [['Done', () => { tool = null; }, 'ghost']] };
            return { kind: 'Remove', name: t.name, status: `Dismantle it? Ships round it will park round ${world.node(t.parent).name}`, acts: [['Dismantle', confirm, 'warn'], ['Cancel', () => { target = null; }, 'ghost']] };
          }
          if (!t) return { kind: 'Build', name: nameOf(tool), status: 'Tap a planet or moon ringed green', acts: [['Done', () => { tool = null; }, 'ghost']] };
          const why = world.canBuild(t.key, tool);
          if (why) return { kind: 'Build', name: nameOf(tool), status: why, acts: [['Cancel', () => { target = null; }, 'ghost']] };
          return { kind: 'Build', name: nameOf(tool), status: `Build round ${t.name}?`, acts: [['Build', confirm, 'primary'], ['Cancel', () => { target = null; }, 'ghost']] };
        },
        overlay() {
          if (!tool) return null;
          if (tool === 'remove') {
            return { marks: world.start.nodes.filter((n) => n.kind === 'station').map((n) => ({ key: n.key, ok: n.key !== target })) };
          }
          const ok = !!target && !world.canBuild(target, tool);
          return { marks: marks(tool), ghost: target ? { type: tool, body: target, ok } : null, label: target ? (ok ? nameOf(tool) : 'Taken') : null };
        },
        hint: () => (!tool ? 'Pick a kind of station in the tray, or Remove'
          : tool === 'remove' ? 'Tap a station, then Dismantle'
            : target ? 'Build, or tap another planet or moon' : `Tap a planet or moon for the ${nameOf(tool)}`),
      };
    }

    if (id === 'drag') {
      let g = null; // { type, finger, body, overTray } dragging a kind out of the tray
      let off = null; // { key, finger, off } dragging a station off its body
      return {
        ...base,
        get tray() { return [...TYPES.map((t) => ({ id: t, label: nameOf(t), on: g?.type === t })), { id: 'bin', label: 'Drop to dismantle', bin: true, on: !!off?.off }]; },
        trayTap(t) { if (t !== 'bin') ctx.say(`Drag the ${nameOf(t)} onto a planet or moon`); else ctx.say('Drag a station here to dismantle it'); },
        trayDown(t) { if (t === 'bin') return false; g = { type: t, finger: null, body: null, overTray: true }; return true; },
        press(it) {
          const n = node(it);
          if (!n || n.kind !== 'station') return false;
          off = { key: n.key, finger: null, off: false };
          return true;
        },
        drag(at) {
          if (g) { Object.assign(g, { finger: { x: at.x, y: at.y }, body: at.overTray ? null : at.body?.key || null, overTray: at.overTray }); return; }
          if (off) {
            const st = world.node(off.key), p = view.toScreen(st.x, st.y);
            off.finger = { x: at.x, y: at.y };
            off.off = at.overTray || Math.hypot(at.x - p.x, at.y - p.y) > OFF;
          }
        },
        release(at) {
          if (g) {
            const it = g; g = null;
            if (at.cancel) return;
            if (!it.body) { ctx.say(it.overTray ? 'Put back' : 'Let go on a planet or moon to build'); return; }
            build(it.body, it.type);
            return;
          }
          if (off) {
            const it = off; off = null;
            if (at.cancel || !at.moved) return;
            if (it.off) dismantle(it.key);
            else ctx.say('Kept');
          }
        },
        escape() { if (!g && !off) return false; g = null; off = null; return true; },
        overlay() {
          if (g) {
            const ok = !!g.body && !world.canBuild(g.body, g.type);
            const label = g.overTray ? null : g.body ? (ok ? `${nameOf(g.type)} · ${world.node(g.body).name}` : world.canBuild(g.body, g.type)) : nameOf(g.type);
            return { marks: marks(g.type), ghost: g.finger && !g.overTray ? { type: g.type, body: g.body, at: g.finger, ok } : null, label, finger: g.finger };
          }
          if (off && off.finger) {
            return { marks: [], drag: { from: off.key, finger: off.finger, off: off.off }, label: off.off ? `Dismantle ${world.node(off.key).name}` : 'Let go to keep', finger: off.finger };
          }
          return null;
        },
        hint: () => (g ? 'Let go on a planet or moon ringed green' : off ? 'Let go away from it, or on the tray, to dismantle'
          : 'Drag a station from the tray onto a planet or moon'),
      };
    }

    // menu: pick a body, then a kind on the card; done at once, with Undo.
    let undo = null; // { label, fn, until }
    const undoAct = () => (undo && performance.now() < undo.until ? [[undo.label, () => { undo.fn(); undo = null; }, 'ghost']] : []);
    const buildNow = (body, type) => {
      const key = build(body, type);
      if (key) undo = { label: 'Undo', until: performance.now() + UNDO, fn: () => { world.dismantle(key); ctx.say('Undone'); } };
    };
    const dismantleNow = (key) => {
      const st = dismantle(key);
      if (!st) return;
      if (ctx.selected()?.key === key) ctx.select({ key: st.parent });
      undo = { label: 'Undo', until: performance.now() + UNDO, fn: () => { const why = world.restore(st); ctx.say(why || `${st.name} back`); } };
    };
    return {
      ...base,
      card(n) {
        const extra = undoAct();
        if (isBody(n)) {
          const st = stationOf(n);
          if (st) return { kind: `${n.kind === 'planet' ? 'Planet' : 'Moon'} · ${n.type}`, name: n.name, status: `${st.name} goes round it (one station each)`, acts: [[`Dismantle ${st.owner === 'player' ? nameOf(st.type) : 'station'}`, () => dismantleNow(st.key), 'warn'], ...extra] };
          return { kind: `${n.kind === 'planet' ? 'Planet' : 'Moon'} · ${n.type}`, name: n.name, status: 'No station yet: build one round it', acts: [...TYPES.map((t) => [`Build ${nameOf(t)}`, () => buildNow(n.key, t), 'primary']), ...extra] };
        }
        if (n?.kind === 'station') {
          return { kind: `Station${n.owner === 'player' ? ` · yours · ${nameOf(n.type)}` : ''}`, name: n.name, status: `In orbit round ${world.node(n.parent).name}`, acts: [['Dismantle', () => dismantleNow(n.key), 'warn'], ...extra] };
        }
        return extra.length ? { kind: 'Build', name: 'Done', status: 'Changed your mind?', acts: extra } : null;
      },
      hint: () => 'Tap a planet or moon to build round it, or a station to dismantle it',
    };
  }

  return { SCHEMES, create };
})();

export { Building };
