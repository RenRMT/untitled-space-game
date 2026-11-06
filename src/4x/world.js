// The 4X game's world (notes/4x.md): the main game's galaxy (world/galaxy.js), the same play area,
// with the start system laid out by the 4X orbit rules (4x/orbits.js) and the player's units in it.
// For now the start system is a star, one planet, a station round the planet and one ship parked
// round the station; there are no hazards. The other systems are their stars only, not yet charted.
// With `testbed` the start system is the main game's whole one (every planet, moon and planet
// station) with three ships, for trying the ways of giving orders (notes/4x-movement-research.md).
// The player doesn't fly the ships: they order them somewhere and they fly there on their own. Sent
// to a station, planet or moon, a ship parks in orbit round it; sent to a point in space, it holds
// there; sent along a path, it passes each stop in turn and ends at the last.
//
//   World4X.create(seed, { testbed }) -> world
//     world.galaxy                   the generated galaxy (its shape, systems, deep-space sites)
//     world.systems[i]               { index, name, x, y, radius, star, charted, nodes? }: the start
//                                    system (0) has `nodes` (4x/orbits.js), the rest only their star
//     world.start                    world.systems[0]
//     world.t                        the game clock, seconds
//     world.node(key) -> node        a node of the start system by key
//     world.units() -> [ship nodes]  the player's units
//     world.hosts() -> [nodes]       the stations, planets and moons a ship may park round
//     world.order(shipKey, dest) -> null | why not   dest: a node key, a point { x, y }, or
//                                    { path: [key | { key } | { x, y }, ...] }
//     world.eta(shipKey, dest) -> seconds            a rough time to get there, from where things are now
//     world.stopAt(stop) -> { x, y } where a stop (a node key or a point) is now
//     world.step(dt)                 run the clock on: orbits go round, ships under way fly
// A ship under way has `free` and `route` (its stops still to reach, each { key } or { x, y }); a
// ship holding a point has `hold` { x, y } and no parent. Positions are world units, as in the main
// game. ES module (`World4X`); also runs in Node.

import { Galaxy } from '../world/galaxy.js';
import { Orbits4X } from './orbits.js';

const World4X = (() => {
  const TAU = Math.PI * 2;
  const SHIP = { speed: 700, accel: 420, r: 22 }; // a courier's drive (rules/loadout.js), world units
  // How far out a ship parks round each kind of host: past the body's surface, or the station's hull.
  const parkOrbit = (host) => (host.kind === 'station' ? 170 : host.r + (host.kind === 'planet' ? 280 : 170));

  function create(seed, { testbed = false } = {}) {
    const galaxy = Galaxy.generate(seed);
    const systems = galaxy.systems.map((s, i) => ({ index: i, name: s.name, x: s.star.x, y: s.star.y, radius: s.radius, star: s.star, charted: i === 0 }));
    const start = systems[0];
    start.nodes = testbed ? testbedNodes(galaxy, start) : startNodes(galaxy, start);
    const problems = Orbits4X.check(start.nodes);
    if (problems.length) throw new Error(`the start system breaks the orbit rules: ${problems.join('; ')}`);
    const byKey = new Map(start.nodes.map((n) => [n.key, n]));

    const w = {
      galaxy, systems, start, t: 0,
      node: (key) => byKey.get(key),
      units: () => start.nodes.filter((n) => n.kind === 'ship'),
      hosts: () => start.nodes.filter((n) => Orbits4X.HOSTS.ship.includes(n.kind)),
      order, eta, stopAt, step,
    };
    Orbits4X.place(start, 0);

    // A destination as a list of stops: { key } for a body, { x, y } for a point.
    function stopsOf(dest) {
      const list = dest && typeof dest === 'object' && Array.isArray(dest.path) ? dest.path : [dest];
      return list.map((d) => (typeof d === 'string' ? { key: d } : typeof d?.key === 'string' ? { key: d.key }
        : d && Number.isFinite(d.x) && Number.isFinite(d.y) ? { x: d.x, y: d.y } : null));
    }
    function stopAt(stop) {
      if (typeof stop === 'string') stop = { key: stop };
      if (stop.key) { const n = byKey.get(stop.key); return { x: n.x, y: n.y }; }
      return { x: stop.x, y: stop.y };
    }

    function order(shipKey, dest) {
      const ship = byKey.get(shipKey);
      if (!ship || ship.kind !== 'ship') return 'Only ships take orders';
      const stops = stopsOf(dest);
      if (!stops.length || stops.some((s) => !s)) return 'Nowhere to go';
      for (const s of stops) {
        if (!s.key) continue;
        const host = byKey.get(s.key);
        if (!host) return 'Nothing there';
        if (!Orbits4X.HOSTS.ship.includes(host.kind)) return `Ships park round a station, planet or moon, not a ${host.kind}`;
      }
      const only = stops.length === 1 && stops[0].key;
      if (only && !ship.free && ship.parent === only) return `Already in orbit round ${byKey.get(only).name}`;
      if (!ship.free) ship.v = 0;
      Object.assign(ship, { free: true, route: stops, hold: null, parent: null });
      return null;
    }

    // Time at a courier's drive over a distance from rest to rest: speeding up, cruising, slowing.
    function travelTime(d) {
      const v = SHIP.speed, a = SHIP.accel;
      return d >= (v * v) / a ? d / v + v / a : 2 * Math.sqrt(d / a);
    }
    function eta(shipKey, dest) {
      const ship = byKey.get(shipKey), stops = stopsOf(dest);
      if (!ship || stops.some((s) => !s || (s.key && !byKey.get(s.key)))) return Infinity;
      let x = ship.x, y = ship.y, d = 0;
      stops.forEach((s, i) => {
        const p = stopAt(s);
        d += Math.hypot(p.x - x, p.y - y);
        if (i === stops.length - 1 && s.key) d = Math.max(0, d - parkOrbit(byKey.get(s.key)));
        x = p.x; y = p.y;
      });
      return travelTime(d);
    }

    function step(dt) {
      w.t += dt;
      Orbits4X.place(start, w.t);
      for (const s of w.units()) if (s.free) fly(s, dt);
      Orbits4X.place(start, w.t); // a ship that just parked takes its place on its orbit
    }

    // Toward the next stop (where a body is now), speeding up, and slowing only for the last one.
    // At a stop on the way it goes on to the next; at the last, it parks in orbit round a body (where
    // it is, going round prograde) or holds the point.
    function fly(s, dt) {
      const stop = s.route[0], last = s.route.length === 1;
      const host = stop.key ? byKey.get(stop.key) : null, at = stopAt(stop);
      const d = host ? parkOrbit(host) : 0;
      const dx = at.x - s.x, dy = at.y - s.y, dist = Math.hypot(dx, dy), gap = dist - d;
      const want = last ? Math.min(SHIP.speed, Math.sqrt(2 * SHIP.accel * Math.max(0, gap)) + 40) : SHIP.speed;
      s.v = s.v < want ? Math.min(want, s.v + SHIP.accel * dt) : want;
      const go = s.v * dt;
      if (dist > 1e-6) s.dir = Math.atan2(dy, dx);
      if (gap <= go) {
        if (!last) {
          if (dist > 1e-6) { const f = Math.max(0, gap) / dist; s.x += dx * f; s.y += dy * f; }
          s.route.shift();
          return;
        }
        if (host) {
          const a = Math.atan2(s.y - host.y, s.x - host.x);
          Object.assign(s, { free: false, route: null, v: 0, parent: host.key, orbit: d, period: Orbits4X.period('ship', d) });
          s.angle = a - (TAU * w.t) / s.period;
        } else {
          Object.assign(s, { free: false, route: null, v: 0, parent: null, hold: { x: at.x, y: at.y }, x: at.x, y: at.y });
        }
        return;
      }
      s.x += (dx / dist) * go;
      s.y += (dy / dist) * go;
    }

    return w;
  }

  // The start system: the start's star, its first temperate planet (or its first planet) on its own
  // orbit, the station built round that planet in the main game (or one named for it) and a ship.
  function startNodes(galaxy, sys) {
    const star = sys.star;
    const planets = galaxy.planets.filter((p) => p.system === 0);
    const pl = planets.find((p) => p.type === 'terran') || planets[0];
    const st = galaxy.stations.find((s) => s.system === 0 && s.planet === pl.id);
    const nodes = [];
    nodes.push({ key: 'star', kind: 'star', name: star.name, parent: null, r: star.r, cls: star.cls, seed: star.seed });
    nodes.push({ key: 'p0', kind: 'planet', name: pl.name, parent: 'star', r: pl.r, type: pl.type, ring: pl.ring, ringTilt: pl.ringTilt, seed: pl.seed,
      orbit: pl.orbit, angle: pl.angle, period: Orbits4X.period('planet', pl.orbit) });
    const so = st ? st.orbit : pl.r + 440;
    nodes.push({ key: 'st0', kind: 'station', name: st ? st.name : `${pl.name} Station`, parent: 'p0', r: 130, culture: st ? st.culture : 0, seed: st ? st.seed : pl.seed * 31,
      size: st ? st.size : 'major', orbit: so, angle: st ? st.angle : 0, period: Orbits4X.period('station', so) });
    nodes.push({ key: 'u0', kind: 'ship', name: 'Pathfinder', parent: 'st0', r: SHIP.r, culture: st ? st.culture : 0, seed: 11,
      orbit: parkOrbit({ kind: 'station' }), angle: 0, period: Orbits4X.period('ship', parkOrbit({ kind: 'station' })), free: false, route: null, hold: null, v: 0, dir: 0 });
    return nodes;
  }

  // The testbed: the main game's whole start system (every planet and moon of system 0, and its
  // stations round them, at most one to each), with three ships parked round different bodies.
  function testbedNodes(galaxy, sys) {
    const star = sys.star, nodes = [];
    nodes.push({ key: 'star', kind: 'star', name: star.name, parent: null, r: star.r, cls: star.cls, seed: star.seed });
    for (const pl of galaxy.planets.filter((p) => p.system === 0)) {
      nodes.push({ key: `p${pl.id}`, kind: 'planet', name: pl.name, parent: 'star', r: pl.r, type: pl.type, ring: pl.ring, ringTilt: pl.ringTilt, seed: pl.seed,
        orbit: pl.orbit, angle: pl.angle, period: Orbits4X.period('planet', pl.orbit) });
    }
    const has = (key) => nodes.some((n) => n.key === key);
    for (const m of galaxy.moons) {
      if (!has(`p${m.parent}`)) continue;
      nodes.push({ key: `m${m.id}`, kind: 'moon', name: m.name, parent: `p${m.parent}`, r: m.r, type: m.type, ringTilt: m.ringTilt, seed: m.seed,
        orbit: m.orbit, angle: m.angle, period: Orbits4X.period('moon', m.orbit) });
    }
    for (const st of galaxy.stations.filter((s) => s.system === 0 && Number.isFinite(s.orbit))) {
      const parent = st.moon != null ? `m${st.moon}` : st.planet != null ? `p${st.planet}` : null;
      if (!parent || !has(parent) || !Orbits4X.canHost(nodes, 'station', parent)) continue;
      nodes.push({ key: `st${nodes.filter((n) => n.kind === 'station').length}`, kind: 'station', name: st.name, parent, r: 130, culture: st.culture, seed: st.seed,
        size: st.size, orbit: st.orbit, angle: st.angle, period: Orbits4X.period('station', st.orbit) });
    }
    const station = nodes.find((n) => n.kind === 'station'), planet = nodes.find((n) => n.kind === 'planet' && n.key !== station?.parent), moon = nodes.find((n) => n.kind === 'moon');
    const homes = [station, planet, moon].filter(Boolean);
    ['Pathfinder', 'Wayfarer', 'Kestrel'].forEach((name, i) => {
      const host = homes[i % homes.length], d = parkOrbit(host);
      nodes.push({ key: `u${i}`, kind: 'ship', name, parent: host.key, r: SHIP.r, culture: station ? station.culture : 0, seed: 11 + i * 7,
        orbit: d, angle: (i * TAU) / 3, period: Orbits4X.period('ship', d), free: false, route: null, hold: null, v: 0, dir: 0 });
    });
    return nodes;
  }

  return { create, SHIP, parkOrbit };
})();

export { World4X };
