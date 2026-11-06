// The 4X game's orbit rules (notes/4x.md): what may go round what in a star system, and where
// everything is at a moment of the game clock.
//
//   - the star sits at the centre and goes round nothing,
//   - planets (one or more) go round the star,
//   - moons (none or more) go round a planet,
//   - a station goes round a planet or a moon, at most one to each,
//   - a ship that is idle goes round a station, a planet or a moon, or holds a point in space it
//     was sent to (`hold: { x, y }`, no parent),
//   - an asteroid belt is a band round the star (never a field in one place): it has a radius and
//     a width, and no position of its own,
//   - a graveyard of wrecks sits at a planet's L4 or L5 Lagrange point: on the planet's orbit, 60°
//     ahead of it (L4) or behind it (L5), going round with it.
//
// A system is a flat list of nodes keyed by `key`, each naming its `parent` by key:
//   { key, kind, name, parent, orbit, angle, period, r, ... }   orbit: distance from the parent
//   (world units), angle: where it is at t = 0 (radians), period: seconds per turn; a belt has
//   `width`, a graveyard `point` ('L4' | 'L5') in place of an orbit of its own.
//
//   Orbits4X.HOSTS[kind] -> [kinds it may go round]          (the star: [])
//   Orbits4X.check(nodes) -> [problems]                      every rule broken, as text ([] if none)
//   Orbits4X.canHost(nodes, kind, parentKey) -> bool         whether a `kind` could join parentKey's
//                                                            orbit (counting the one-station limit)
//   Orbits4X.period(kind, d) -> seconds                      a turn's length (Kepler, world/orbits.js)
//   Orbits4X.place(system, t)                                every node's x, y (and `a`, the angle
//                                                            round its parent) at t, in place
//   Orbits4X.lagrange(planet, star, point) -> { x, y }       L4 / L5 of a placed planet
// Positions are world units, the star at system.x, system.y. ES module (`Orbits4X`); also runs in Node.

import { Orbits } from '../world/orbits.js';

const Orbits4X = (() => {
  const TAU = Math.PI * 2;

  const HOSTS = {
    star: [],
    planet: ['star'],
    moon: ['planet'],
    station: ['planet', 'moon'],
    ship: ['station', 'planet', 'moon'],
    belt: ['star'],
    graveyard: ['planet'],
  };
  const ONE_EACH = new Set(['station']); // at most one of these round any one parent

  // A turn's length by kind: the bodies and stations as in the main game (world/orbits.js); a
  // ship's parking orbit as a station's, a belt's as a planet's at its radius.
  const period = (kind, d) => Orbits.period(kind === 'ship' ? 'station' : kind === 'belt' ? 'planet' : kind, d);

  const index = (nodes) => new Map(nodes.map((n) => [n.key, n]));

  function canHost(nodes, kind, parentKey) {
    const byKey = index(nodes), p = byKey.get(parentKey);
    if (!p || !(HOSTS[kind] || []).includes(p.kind)) return false;
    if (ONE_EACH.has(kind) && nodes.some((n) => n.kind === kind && n.parent === parentKey)) return false;
    return true;
  }

  function check(nodes) {
    const byKey = index(nodes), out = [];
    const stars = nodes.filter((n) => n.kind === 'star');
    if (stars.length !== 1) out.push(`a system has one star (this one has ${stars.length})`);
    if (!nodes.some((n) => n.kind === 'planet')) out.push('a system has at least one planet');
    for (const n of nodes) {
      const hosts = HOSTS[n.kind];
      if (!hosts) { out.push(`${n.key}: no such kind "${n.kind}"`); continue; }
      if (n.kind === 'star') { if (n.parent != null) out.push(`${n.key}: the star goes round nothing`); continue; }
      if (n.kind === 'ship' && (n.hold || n.free) && n.parent == null) continue; // holding a point, or under way
      const p = byKey.get(n.parent);
      if (!p) { out.push(`${n.key}: goes round "${n.parent}", which isn't in the system`); continue; }
      if (!hosts.includes(p.kind)) out.push(`${n.key}: a ${n.kind} can't go round a ${p.kind} (only ${hosts.join(', ')})`);
      if (n.kind === 'graveyard' && n.point !== 'L4' && n.point !== 'L5') out.push(`${n.key}: a graveyard sits at L4 or L5`);
    }
    for (const kind of ONE_EACH) {
      const seen = new Map();
      for (const n of nodes) if (n.kind === kind) seen.set(n.parent, (seen.get(n.parent) || 0) + 1);
      for (const [p, c] of seen) if (c > 1) out.push(`${p}: ${c} ${kind}s round it (at most one)`);
    }
    return out;
  }

  function lagrange(planet, star, point) {
    const a = Math.atan2(planet.y - star.y, planet.x - star.x) + (point === 'L5' ? -1 : 1) * (TAU / 6);
    const d = Math.hypot(planet.x - star.x, planet.y - star.y);
    return { x: star.x + Math.cos(a) * d, y: star.y + Math.sin(a) * d };
  }

  // Parents before children: a node is placed once its parent has been (the list may be in any order).
  function place(system, t) {
    const byKey = index(system.nodes), done = new Set();
    const put = (n) => {
      if (done.has(n.key)) return;
      done.add(n.key);
      if (n.kind === 'star') { n.x = system.x; n.y = system.y; n.a = 0; return; }
      if (n.free) return; // a ship under way: its own position (4x/world.js moves it)
      if (n.hold) { n.x = n.hold.x; n.y = n.hold.y; return; } // a ship holding a point in space
      const p = byKey.get(n.parent);
      if (!p) return;
      put(p);
      if (n.kind === 'belt') { n.x = p.x; n.y = p.y; n.a = 0; return; }
      if (n.kind === 'graveyard') {
        const star = byKey.get(p.parent), at = lagrange(p, star, n.point);
        n.x = at.x; n.y = at.y; n.a = p.a + (n.point === 'L5' ? -1 : 1) * (TAU / 6);
        return;
      }
      n.a = n.angle + (TAU * t) / n.period;
      n.x = p.x + Math.cos(n.a) * n.orbit;
      n.y = p.y + Math.sin(n.a) * n.orbit;
    };
    for (const n of system.nodes) put(n);
  }

  return { HOSTS, check, canHost, period, place, lagrange };
})();

export { Orbits4X };
