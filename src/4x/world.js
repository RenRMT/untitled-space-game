// The 4X game's world (notes/4x.md): the main game's galaxy (world/galaxy.js), the same play area,
// with the start system laid out by the 4X orbit rules (4x/orbits.js) and the player's units in it.
// For now the start system is a star, one planet, a station round the planet and one ship parked
// round the station; there are no hazards. The other systems are their stars only, not yet charted.
// The player doesn't fly the ship: they pick it and order it to another body, and it flies there on
// its own and parks in orbit (an idle ship always goes round a station, planet or moon).
//
//   World4X.create(seed) -> world
//     world.galaxy                   the generated galaxy (its shape, systems, deep-space sites)
//     world.systems[i]               { index, name, x, y, radius, star, charted, nodes? }: the start
//                                    system (0) has `nodes` (4x/orbits.js), the rest only their star
//     world.start                    world.systems[0]
//     world.t                        the game clock, seconds
//     world.node(key) -> node        a node of the start system by key
//     world.units() -> [ship nodes]  the player's units
//     world.order(shipKey, hostKey) -> null | why not   send a ship to park round a body
//     world.step(dt)                 run the clock on: orbits go round, ships under way fly
// Positions are world units, as in the main game. ES module (`World4X`); also runs in Node.

import { Galaxy } from '../world/galaxy.js';
import { Orbits4X } from './orbits.js';

const World4X = (() => {
  const TAU = Math.PI * 2;
  const SHIP = { speed: 700, accel: 420, r: 22 }; // a courier's drive (rules/loadout.js), world units
  // How far out a ship parks round each kind of host: past the body's surface, or the station's hull.
  const parkOrbit = (host) => (host.kind === 'station' ? 170 : host.r + (host.kind === 'planet' ? 280 : 170));

  function create(seed) {
    const galaxy = Galaxy.generate(seed);
    const systems = galaxy.systems.map((s, i) => ({ index: i, name: s.name, x: s.star.x, y: s.star.y, radius: s.radius, star: s.star, charted: i === 0 }));
    const start = systems[0];
    start.nodes = startNodes(galaxy, start);
    const problems = Orbits4X.check(start.nodes);
    if (problems.length) throw new Error(`the start system breaks the orbit rules: ${problems.join('; ')}`);
    const byKey = new Map(start.nodes.map((n) => [n.key, n]));

    const w = {
      galaxy, systems, start, t: 0,
      node: (key) => byKey.get(key),
      units: () => start.nodes.filter((n) => n.kind === 'ship'),
      order, step,
    };
    Orbits4X.place(start, 0);

    function order(shipKey, hostKey) {
      const ship = byKey.get(shipKey), host = byKey.get(hostKey);
      if (!ship || ship.kind !== 'ship') return 'Only ships take orders';
      if (!host) return 'Nothing there';
      if (!Orbits4X.HOSTS.ship.includes(host.kind)) return `Ships park round a station, planet or moon, not a ${host.kind}`;
      if (!ship.free && ship.parent === hostKey) return `Already in orbit round ${host.name}`;
      if (!ship.free) ship.v = 0;
      ship.free = true;
      ship.target = hostKey;
      return null;
    }

    function step(dt) {
      w.t += dt;
      Orbits4X.place(start, w.t);
      for (const s of w.units()) if (s.free) fly(s, dt);
      Orbits4X.place(start, w.t); // a ship that just parked takes its place on its orbit
    }

    // Toward where the host is now, speeding up and slowing to arrive; once at its parking orbit, it
    // joins the orbit where it is, going round prograde.
    function fly(s, dt) {
      const host = byKey.get(s.target), d = parkOrbit(host);
      const dx = host.x - s.x, dy = host.y - s.y, dist = Math.hypot(dx, dy), gap = dist - d;
      const want = Math.min(SHIP.speed, Math.sqrt(2 * SHIP.accel * Math.max(0, gap)) + 40);
      s.v = s.v < want ? Math.min(want, s.v + SHIP.accel * dt) : want;
      const go = s.v * dt;
      s.dir = Math.atan2(dy, dx);
      if (gap <= go) {
        const a = Math.atan2(s.y - host.y, s.x - host.x);
        Object.assign(s, { free: false, target: null, v: 0, parent: host.key, orbit: d, period: Orbits4X.period('ship', d) });
        s.angle = a - (TAU * w.t) / s.period;
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
      orbit: parkOrbit({ kind: 'station' }), angle: 0, period: Orbits4X.period('ship', parkOrbit({ kind: 'station' })), free: false, target: null, v: 0, dir: 0 });
    return nodes;
  }

  return { create, SHIP, parkOrbit };
})();

export { World4X };
