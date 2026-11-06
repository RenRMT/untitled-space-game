// The 4X game's ways of giving a ship a move order (notes/4x-movement-research.md), as prototypes to
// play side by side: the page (4x/main.js) hands the map's taps, presses and drags to the scheme in
// use, and draws what the scheme is shaping. Every scheme sends a ship to a station, planet or moon
// (it parks in orbit) or to a point in space (it holds there); a right-click or long press on the
// map orders the picked ship in all of them (4x/main.js).
//
//   button  Move on the card, then a place or a point (the first scheme, kept to compare against)
//   tap     with a ship picked, a tap shows the order (route, ETA) and Send (or the same tap again)
//           gives it
//   drag    press a ship and drag: the line snaps to a place near the finger, the place and ETA are
//           written above the finger; let go to send, or let go back on the ship to cancel
//   path    press a ship and hold, then draw: a stop every so often along the stroke, the end
//           snapping to a place; let go to send it along the path
//
//   Movement.SCHEMES                       [{ id, name }] in the order the header cycles them
//   Movement.create(id, ctx) -> scheme     ctx: { world, view, selectedShip() -> key | null,
//                                          select(pick | null), send(shipKey, dest) -> ok, say(text) }
//     scheme.pick(it, at) -> handled       a tap (at: from the map, 4x/view.js); false: the page picks
//     scheme.press(it, at) -> claims       a press starts on the map (true: the drag is the scheme's)
//     scheme.drag(at) -> keep, scheme.release(at)
//     scheme.escape() -> handled
//     scheme.aiming                        taps pick only the places a ship can park
//     scheme.rings                         ring the places the picked ship can go
//     scheme.preview(now) -> preview | null   for view.draw
//     scheme.card(ship) -> { status?, acts: [[label, fn, tone]] }   the picked ship's card
//     scheme.hint(ship) -> text            the header's line while a ship is picked
// ES module (`Movement`); needs a browser (the map).

const Movement = (() => {
  const SCHEMES = [
    { id: 'button', name: 'Button' },
    { id: 'tap', name: 'Tap' },
    { id: 'drag', name: 'Drag' },
    { id: 'path', name: 'Path' },
  ];
  const TAP_SNAP = 24; // px round a tap that still lands on a place
  const HOLD = 300; // ms a press on a ship is held before a path is drawn
  const STEP = 48; // px of stroke between a path's stops
  const MAX_STOPS = 12;

  const time = (s) => (!Number.isFinite(s) ? '?' : s < 60 ? `${Math.max(1, Math.round(s))} s` : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`);

  function create(id, ctx) {
    const { world, view } = ctx;
    const stopOf = (it, at) => (it?.key && world.hosts().some((h) => h.key === it.key) ? { key: it.key } : { x: at.world.x, y: at.world.y });
    const nameOf = (stop) => (stop.key ? world.node(stop.key).name : 'Hold here');
    const label = (ship, stops) => `${nameOf(stops[stops.length - 1])}${stops.length > 1 ? ` · ${stops.length} stops` : ''} · ~${time(world.eta(ship, { path: stops }))}`;
    const own = (it) => it?.key && world.node(it.key)?.kind === 'ship';
    const dest = (stops) => (stops.length === 1 ? (stops[0].key || stops[0]) : { path: stops });
    const base = {
      aiming: false, rings: false,
      pick: () => false, press: () => false, drag: () => false, release() {}, escape: () => false,
      preview: () => null,
      card: () => ({ acts: [['Focus', ctx.focus, '']] }),
      hint: () => 'Long-press a place or a point to send it',
    };

    if (id === 'tap') {
      let pending = null; // { ship, stops, at } the order shown, not yet given
      const send = () => { if (pending && ctx.send(pending.ship, dest(pending.stops))) pending = null; };
      return {
        ...base,
        get rings() { return !!ctx.selectedShip(); },
        pick(it, at) {
          const ship = ctx.selectedShip();
          if (!ship || own(it)) { pending = null; return false; }
          const snapped = view.pickAt(at.x, at.y, true, TAP_SNAP), stop = stopOf(snapped, at);
          const same = pending && pending.ship === ship && (stop.key ? pending.stops[0].key === stop.key : !pending.stops[0].key && Math.hypot(at.x - pending.at.x, at.y - pending.at.y) < TAP_SNAP);
          if (same) send();
          else pending = { ship, stops: [stop], at: { x: at.x, y: at.y } };
          return true;
        },
        escape() { if (!pending) return false; pending = null; return true; },
        preview: () => (pending && pending.ship === ctx.selectedShip() ? { from: pending.ship, stops: pending.stops, label: label(pending.ship, pending.stops) } : null),
        card(ship) {
          if (pending && pending.ship === ship.key) return { status: `Send to ${label(ship.key, pending.stops)}?`, acts: [['Send', send, 'primary'], ['Cancel', () => { pending = null; }, 'ghost']] };
          return { acts: [['Focus', ctx.focus, ''], ['Done', () => ctx.select(null), 'ghost']] };
        },
        hint: () => (pending ? 'Send, or tap the same place again' : 'Tap a place or a point, then Send'),
      };
    }

    if (id === 'drag' || id === 'path') {
      const path = id === 'path';
      // The press: { ship, t0, drawing, points (world), last (screen), stops, finger, back }
      let g = null;
      const backOnShip = (at) => { const s = world.node(g.ship), p = view.toScreen(s.x, s.y); return Math.hypot(at.x - p.x, at.y - p.y) < 24; };
      return {
        ...base,
        press(it) {
          if (!own(it)) return false;
          ctx.select({ key: it.key });
          g = { ship: it.key, t0: performance.now(), drawing: !path, points: [], last: null, stops: [], finger: null, back: false };
          return true;
        },
        drag(at) {
          if (!g) return false;
          if (path && !g.drawing) {
            if (performance.now() - g.t0 < HOLD) { g = null; return false; } // a quick drag: the camera's
            g.drawing = true; g.last = { x: at.x, y: at.y };
          }
          g.finger = { x: at.x, y: at.y };
          g.back = backOnShip(at);
          if (path && Math.hypot(at.x - g.last.x, at.y - g.last.y) >= STEP) { g.points.push({ x: at.world.x, y: at.world.y }); g.last = { x: at.x, y: at.y }; }
          const end = stopOf(at.snap, at);
          g.stops = g.back ? [] : path ? [...g.points, end] : [end];
          return true;
        },
        release(at) {
          const it = g; g = null;
          if (!it || at.cancel || !at.moved || !it.drawing) return;
          if (it.back || !it.stops.length) { ctx.say('Order cancelled'); return; }
          let stops = it.stops;
          if (path) {
            const end = stopOf(at.snap, at), mids = it.points;
            const keep = mids.length > MAX_STOPS - 1 ? Array.from({ length: MAX_STOPS - 1 }, (_, i) => mids[Math.round(((i + 1) * mids.length) / MAX_STOPS) - 1]) : mids;
            stops = [...keep, end];
          }
          ctx.send(it.ship, dest(stops));
        },
        escape() { if (!g) return false; g = null; return true; },
        preview(now) {
          if (!g) return null;
          const pulse = path && !g.drawing ? Math.min(1, (now - g.t0) / HOLD) : 0;
          if (!g.drawing || !g.stops.length) return { from: g.ship, stops: [], pulse, finger: g.finger, label: g.back ? 'Let go to cancel' : null };
          return { from: g.ship, stops: g.stops, finger: g.finger, label: label(g.ship, g.stops) };
        },
        hint: () => (path ? 'Hold the ship, then draw its path' : 'Drag from the ship to a place or a point'),
      };
    }

    // button: Move, then a place (or a point).
    let targeting = null;
    return {
      ...base,
      get aiming() { return !!targeting; },
      get rings() { return !!targeting; },
      pick(it, at) {
        if (!targeting) return false;
        const ship = targeting;
        if (ctx.send(ship, dest([stopOf(it, at)]))) targeting = null;
        return true;
      },
      escape() { if (!targeting) return false; targeting = null; return true; },
      card(ship) {
        if (targeting) return { acts: [['Cancel', () => { targeting = null; }, 'ghost']] };
        return { acts: [['Move', () => { targeting = ship.key; if (view.band === 'galaxy') view.go('system'); }, 'primary'], ['Focus', ctx.focus, '']] };
      },
      hint: () => (targeting ? `Tap a place or a point for ${world.node(targeting).name}` : 'Move, then a place or a point'),
    };
  }

  return { SCHEMES, create, time };
})();

export { Movement };
