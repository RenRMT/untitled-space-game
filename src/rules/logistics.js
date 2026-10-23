// Logistics (notes/hazards.md phase 6): routes that move goods between stations' stocks, so what one
// station makes reaches the next without the player carrying it. A route is a loop of stops; at each
// a hauler unloads what that stop takes, then loads what it gives (never below what the stop keeps),
// then flies on to the next. A station's shuttle is a route of two stops: its own, loading what its
// orders make, and where it sends them. Haulers are events in the same settle as production runs
// (rules/industry.js), on the real-world clock, so a game closed for a day comes out the same as
// one watched throughout.
//   A hauler that moved nothing at a stop still flies on while some other stop has something for
// it (to load, or to take what it carries); with nothing to do anywhere it waits where it is, and
// looks again whenever the stocks change (Industry.kick).
//
//   route: { id, name, shuttle (station key) | null, cap, stops: [stop], haulers: [hauler] }
//   stop: { station (key), name, load: spec, unload: spec, keep: { [kind | '*' (every kind)]: n }, travel (ms to the next stop) }
//     spec: 'all' (every kind) | 'made' (what the station's orders make) | { [kind]: n | 'all' } (up to n a visit)
//   hauler: { stop (the stop it's at, or flying to), at (when it left, or arrived), next (arrival, ms) | null (waiting), load: { [kind]: n } }
//
//   Logistics.HAULER                          { speed (units a second), cap (goods aboard), minLeg (ms) }
//   Logistics.legTime(distance, speed?) -> ms
//   Logistics.make(id, stops, { name, shuttle, haulers, cap }, now) -> route   (stops without a travel take 0)
//   Logistics.visit(route, hauler, t, io) -> { moved, delivered: { [kind]: n } }   unload, then load, at its stop
//   Logistics.decide(route, hauler, t, io, moved) -> bool   fly on (true) or wait; called after a visit
//   Logistics.busy(route, hauler, i, io) -> bool     whether stop i has anything for the hauler
//     io: { stock(key) -> counts, free(key) -> n, put(key, kind, n), made(key) -> Set of kinds }
//   Logistics.aboard(route) -> n               goods on its haulers
//   Logistics.read(d) -> route | null          a saved route, checked
// ES module (`Logistics`); also runs in Node.

const Logistics = (() => {
  const HAULER = { speed: 300, cap: 12, minLeg: 20e3 };
  const legTime = (distance, speed = HAULER.speed) => Math.max(HAULER.minLeg, Math.round((distance / speed) * 1000));
  const total = (counts) => Object.values(counts).reduce((n, k) => n + k, 0);
  const keys = (counts) => Object.keys(counts).filter((k) => counts[k] > 0).sort();

  function make(id, stops, { name = null, shuttle = null, haulers = 1, cap = HAULER.cap } = {}, now = 0) {
    return {
      id, name, shuttle, cap,
      stops: stops.map((s) => ({ station: s.station, name: s.name || s.station, load: s.load || {}, unload: s.unload || {}, keep: s.keep || {}, travel: s.travel || 0 })),
      haulers: Array.from({ length: Math.max(1, haulers) }, () => ({ stop: 0, at: now, next: null, load: {} })),
    };
  }

  // How many of a kind a spec takes at a visit: 0 if it doesn't, Infinity for all of it.
  function amount(spec, kind, made) {
    if (spec === 'all') return Infinity;
    if (spec === 'made') return made.has(kind) ? Infinity : 0;
    const n = spec?.[kind];
    return n === 'all' ? Infinity : Math.max(0, Math.floor(n) || 0);
  }

  // What unloading and loading at stop i would move, without moving it: [{ kind, n, out }].
  function plan(route, h, i, io) {
    const s = route.stops[i], made = io.made(s.station), moves = [];
    let room = io.free(s.station);
    for (const kind of keys(h.load)) {
      const n = Math.min(h.load[kind], amount(s.unload, kind, made), room);
      if (n > 0) { moves.push({ kind, n, out: true }); room -= n; }
    }
    let space = route.cap - total(h.load) + moves.reduce((t, m) => t + m.n, 0);
    const stock = io.stock(s.station);
    for (const kind of keys(stock)) {
      if (space <= 0) break;
      if (moves.some((m) => m.kind === kind)) continue; // not straight back aboard
      const n = Math.min(stock[kind] - (s.keep[kind] ?? s.keep['*'] ?? 0), amount(s.load, kind, made), space);
      if (n > 0) { moves.push({ kind, n, out: false }); space -= n; }
    }
    return moves;
  }
  const busy = (route, h, i, io) => plan(route, h, i, io).length > 0;

  function visit(route, h, t, io) {
    const moves = plan(route, h, h.stop, io), key = route.stops[h.stop].station, delivered = {};
    for (const m of moves) {
      if (m.out) {
        io.put(key, m.kind, m.n);
        h.load[m.kind] -= m.n;
        if (!h.load[m.kind]) delete h.load[m.kind];
        delivered[m.kind] = (delivered[m.kind] || 0) + m.n;
      } else {
        io.put(key, m.kind, -m.n);
        h.load[m.kind] = (h.load[m.kind] || 0) + m.n;
      }
    }
    return { moved: moves.length > 0, delivered };
  }

  // After a visit: fly on to the next stop if anything was moved here, or another stop has
  // something for the hauler; else wait here.
  function decide(route, h, t, io, moved = false) {
    const n = route.stops.length;
    if (n < 2) { h.next = null; h.at = t; return false; }
    const go = moved || route.stops.some((_, i) => i !== h.stop && busy(route, h, i, io));
    if (!go) { h.next = null; h.at = t; return false; }
    h.at = t;
    h.next = t + route.stops[h.stop].travel;
    h.stop = (h.stop + 1) % n;
    return true;
  }

  const aboard = (route) => route.haulers.reduce((t, h) => t + total(h.load), 0);

  // A saved route, checked (goods kinds are checked by the caller's isKind).
  function read(d, isKind = () => true) {
    if (!d || typeof d !== 'object' || !Number.isInteger(d.id) || !Array.isArray(d.stops) || d.stops.length < 2) return null;
    const whole = (n) => Math.max(0, Math.floor(n) || 0);
    const spec = (x) => {
      if (x === 'all' || x === 'made') return x;
      const out = {};
      if (x && typeof x === 'object') for (const [k, n] of Object.entries(x)) if (isKind(k) && (n === 'all' || whole(n) > 0)) out[k] = n === 'all' ? 'all' : whole(n);
      return out;
    };
    const stops = d.stops.filter((s) => s && typeof s.station === 'string').map((s) => ({
      station: s.station, name: String(s.name || s.station), load: spec(s.load), unload: spec(s.unload),
      keep: Object.fromEntries(Object.entries(s.keep && typeof s.keep === 'object' ? s.keep : {}).filter(([k, n]) => (k === '*' || isKind(k)) && whole(n) > 0).map(([k, n]) => [k, whole(n)])),
      travel: whole(s.travel),
    }));
    if (stops.length < 2) return null;
    const haulers = (Array.isArray(d.haulers) ? d.haulers : []).filter((h) => h && typeof h === 'object').map((h) => {
      const load = {};
      for (const [k, n] of Object.entries(h.load && typeof h.load === 'object' ? h.load : {})) if (isKind(k) && whole(n) > 0) load[k] = whole(n);
      const flying = Number.isFinite(h.next) && Number.isFinite(h.at) && h.next >= h.at;
      return { stop: Math.min(stops.length - 1, whole(h.stop)), at: Number.isFinite(h.at) ? h.at : 0, next: flying ? h.next : null, load };
    });
    if (!haulers.length) return null;
    return { id: d.id, name: typeof d.name === 'string' ? d.name : null, shuttle: typeof d.shuttle === 'string' ? d.shuttle : null, cap: whole(d.cap) || HAULER.cap, stops, haulers };
  }

  return { HAULER, legTime, make, visit, decide, busy, aboard, read };
})();

export { Logistics };
