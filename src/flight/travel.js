'use strict';

// Map travel: plot a course on the system map and watch the ship cruise there in a straight
// line, far faster than it flies. On the way:
// - contacts the route passes within ping range of are pinged (Knowledge.pass),
// - an ambush the route runs into interdicts the trip and drops the ship into the flight view,
// - an unidentified derelict the route passes pauses the trip with a prompt: investigate (drop
//   in) or ignore (keep going),
// - otherwise the trip ends at the destination.
// Contacts reached where the trip starts are left behind, and the destination's own contact is
// for the arrival. Positions are world units. Works as a classic browser script (global
// `Travel`) and as a Node module.

const Travel = (() => {
  const config = { speed: 5000, fastForward: 4 }; // world units per second
  const INTERDICT = 1500; // an ambush catches a route this far beyond its reach
  const PING_RANGE = 7000; // when no scanner range is given

  // Where along the segment from `from` (length dist, direction u) a point first comes within
  // `reach` of c: the distance from `from`, or null if it never does. 0 if it starts within it.
  function firstWithin(from, u, dist, c, reach) {
    const px = c.x - from.x, py = c.y - from.y;
    const along = px * u.x + py * u.y;
    const off2 = px * px + py * py - along * along;
    if (off2 > reach * reach) return null;
    const t = along - Math.sqrt(reach * reach - off2);
    if (t > dist || along + Math.sqrt(reach * reach - off2) < 0) return null;
    return Math.max(0, t);
  }

  // The contacts a trip meets, in order: [{ contact, t, kind: 'interdict' | 'signal' }].
  // pingRange: how far the scanner pings; cleared(c): an ambush whose pirates are all gone.
  function encounters(system, from, to, { pingRange, cleared = () => false, destId = null }) {
    const dx = to.x - from.x, dy = to.y - from.y, dist = Math.hypot(dx, dy);
    const u = dist ? { x: dx / dist, y: dy / dist } : { x: 1, y: 0 };
    const out = [];
    for (const c of system.contacts) {
      if (c.id === destId || (c.hostile && cleared(c))) continue;
      const reach = c.r + (c.hostile ? INTERDICT : pingRange);
      const t = firstWithin(from, u, dist, c, reach);
      if (t === null || t === 0) continue; // never met, or already here when the trip starts
      out.push({ contact: c, t, kind: c.hostile ? 'interdict' : 'signal' });
    }
    return out.sort((a, b) => a.t - b.t);
  }

  // options: { pingRange(), cleared(contact) }
  function create(system, knowledge, options = {}) {
    let trip = null; // { from, to, dest, dist, t, fast, events, next, prompt }
    const posOf = () => {
      const k = trip.dist ? trip.t / trip.dist : 1;
      return { x: trip.from.x + (trip.to.x - trip.from.x) * k, y: trip.from.y + (trip.to.y - trip.from.y) * k };
    };
    const end = (type, extra = {}) => {
      const ev = { type, pos: posOf(), dest: trip.dest, dir: Math.atan2(trip.to.y - trip.from.y, trip.to.x - trip.from.x), ...extra };
      trip = null;
      return ev;
    };
    const pingRange = () => (options.pingRange ? options.pingRange() : PING_RANGE);

    // dest: { kind: 'station' | 'planet' | 'contact' | 'point', id?, x, y, name }
    function start(from, dest) {
      const dist = Math.hypot(dest.x - from.x, dest.y - from.y);
      trip = {
        from: { x: from.x, y: from.y }, to: { x: dest.x, y: dest.y }, dest, dist, t: 0, fast: false, next: 0, prompt: null,
        events: encounters(system, from, dest, { pingRange: pingRange(), cleared: options.cleared, destId: dest.kind === 'contact' ? dest.id : null }),
      };
    }

    // Advance the trip by dt seconds. Returns an event ({ type: 'arrive' | 'interdict' | 'prompt' })
    // or null while cruising.
    function step(dt) {
      if (!trip || trip.prompt) return null;
      const speed = config.speed * (trip.fast ? config.fastForward : 1);
      const t1 = Math.min(trip.dist, trip.t + speed * dt);
      // Meet every contact on the route up to t1, stopping where any event happens.
      while (trip.next < trip.events.length && trip.events[trip.next].t <= t1) {
        const { contact: c, t, kind } = trip.events[trip.next++];
        trip.t = t;
        const at = posOf();
        knowledge.pass(at.x, at.y, c.r + pingRange());
        if (kind === 'interdict') return end('interdict', { contact: c });
        if (knowledge.contactState(c.id) === 'known') continue;
        trip.prompt = { contact: c };
        return { type: 'prompt', prompt: trip.prompt };
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
      get eta() { return trip ? (trip.dist - trip.t) / (config.speed * (trip.fast ? config.fastForward : 1)) : 0; },
      get prompt() { return trip ? trip.prompt : null; },
      get fast() { return !!trip && trip.fast; },
      toggleFast() { if (trip) trip.fast = !trip.fast; },
      stop: () => (trip ? end('stop') : null),
      investigate() {
        if (!trip || !trip.prompt) return null;
        return end('investigate', { contact: trip.prompt.contact });
      },
      ignore() {
        if (!trip || !trip.prompt) return;
        trip.prompt = null;
      },
    };
  }

  return { create, config, encounters, INTERDICT };
})();

if (typeof module !== 'undefined') module.exports = Travel;
