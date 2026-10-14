'use strict';

// Map travel: plot a course on the galaxy map and watch the ship cruise there. The trip runs in
// real time on the map, sector by sector:
// - every sector crossed outside a pocket gets a coarse long-range pass (explored, contacts only
//   pinged, see Knowledge.pass),
// - a hostile contact on the route interdicts the trip and drops the ship into the flight view,
// - an unidentified non-hostile contact pauses the trip with a prompt: investigate (drop in) or
//   ignore (keep going),
// - otherwise the trip ends at the destination.
// Positions are fractional sector coordinates. Browser script (global `Travel`).

const Travel = (() => {
  const config = { sectorsPerSecond: 1.5, fastForward: 4 };

  // Every sector a straight line from `from` to `to` passes through after the first, in order,
  // with the distance along the line at which it is entered (Amanatides–Woo grid traversal).
  // A line through a sector corner steps diagonally, since it touches neither side neighbour.
  function crossings(from, to) {
    const dx = to.x - from.x, dy = to.y - from.y;
    const dist = Math.hypot(dx, dy);
    const out = [];
    if (!dist) return out;
    const ux = dx / dist, uy = dy / dist;
    let cx = Math.floor(from.x), cy = Math.floor(from.y);
    const sx = Math.sign(ux), sy = Math.sign(uy);
    const firstEdge = (p, c, u) => (u > 0 ? (c + 1 - p) / u : u < 0 ? (p - c) / -u : Infinity);
    let tx = firstEdge(from.x, cx, ux), ty = firstEdge(from.y, cy, uy);
    const stepX = ux ? 1 / Math.abs(ux) : Infinity, stepY = uy ? 1 / Math.abs(uy) : Infinity;
    for (;;) {
      const t = Math.min(tx, ty);
      if (t >= dist) break;
      if (tx <= ty) { cx += sx; tx += stepX; }
      if (ty <= t) { cy += sy; ty += stepY; }
      out.push({ x: cx, y: cy, t });
    }
    return out;
  }

  function create(galaxy, knowledge) {
    let trip = null; // { from, to, dest, dist, t, fast, cells, next, cell, ignored, prompt }
    const cellKey = (x, y) => `${x},${y}`;
    const posOf = () => {
      const k = trip.dist ? trip.t / trip.dist : 1;
      return { x: trip.from.x + (trip.to.x - trip.from.x) * k, y: trip.from.y + (trip.to.y - trip.from.y) * k };
    };
    const end = (type, extra = {}) => {
      const ev = { type, pos: posOf(), dest: trip.dest, dir: Math.atan2(trip.to.y - trip.from.y, trip.to.x - trip.from.x), ...extra };
      trip = null;
      return ev;
    };

    // dest: { kind: 'system' | 'outpost' | 'sector', id?, x, y (fractional), name }
    function start(from, dest) {
      const dist = Math.hypot(dest.x - from.x, dest.y - from.y);
      trip = {
        from: { ...from }, to: { x: dest.x, y: dest.y }, dest, dist, t: 0, fast: false,
        cells: crossings(from, dest), next: 0,
        cell: cellKey(Math.floor(from.x), Math.floor(from.y)), ignored: new Set(), prompt: null,
      };
      trip.ignored.add(trip.cell); // whatever is where you start, you already left behind
    }

    // A newly entered sector: chart it coarsely and check for contacts. Returns an event or null.
    function enter(x, y) {
      const t = galaxy.territoryOf(x, y);
      if (!t) return null;
      knowledge.pass(x, y);
      const key = cellKey(x, y);
      if (t.zone === 'pocket' || trip.ignored.has(key)) return null;
      const contact = galaxy.deepSector(x, y);
      if (!contact) return null;
      const destCell = cellKey(Math.floor(trip.to.x), Math.floor(trip.to.y));
      if (key === destCell) return null; // arrival handles it
      if (contact.hostile) return end('interdict', { cell: { x, y }, contact });
      if (knowledge.contactState(x, y) === 'known') return null;
      trip.prompt = { x, y, contact };
      return { type: 'prompt', prompt: trip.prompt };
    }

    // Advance the trip by dt seconds. Returns an event ({ type: 'arrive' | 'interdict' | 'prompt' })
    // or null while cruising.
    function step(dt) {
      if (!trip || trip.prompt) return null;
      const speed = config.sectorsPerSecond * (trip.fast ? config.fastForward : 1);
      const t1 = Math.min(trip.dist, trip.t + speed * dt);
      // Enter every sector the line crosses up to t1, stopping at the entry point of any event.
      while (trip.next < trip.cells.length && trip.cells[trip.next].t <= t1) {
        const c = trip.cells[trip.next++];
        trip.t = c.t;
        trip.cell = cellKey(c.x, c.y);
        const ev = enter(c.x, c.y);
        if (ev) return ev;
      }
      trip.t = t1;
      if (trip.t >= trip.dist) return end('arrive');
      return null;
    }

    return {
      config,
      start, step,
      get active() { return !!trip; },
      get pos() { return trip ? posOf() : null; },
      get dest() { return trip ? trip.dest : null; },
      get route() { return trip ? { from: trip.from, to: trip.to } : null; },
      get remaining() { return trip ? trip.dist - trip.t : 0; },
      get eta() { return trip ? (trip.dist - trip.t) / (config.sectorsPerSecond * (trip.fast ? config.fastForward : 1)) : 0; },
      get prompt() { return trip ? trip.prompt : null; },
      get fast() { return !!trip && trip.fast; },
      toggleFast() { if (trip) trip.fast = !trip.fast; },
      stop: () => (trip ? end('stop') : null),
      investigate() {
        if (!trip || !trip.prompt) return null;
        const { x, y, contact } = trip.prompt;
        return end('investigate', { cell: { x, y }, contact });
      },
      ignore() {
        if (!trip || !trip.prompt) return;
        trip.ignored.add(cellKey(trip.prompt.x, trip.prompt.y));
        trip.prompt = null;
      },
    };
  }

  return { create, config, crossings };
})();

if (typeof module !== 'undefined') module.exports = Travel;
