// Orbits: the planets go round their stars, the moons round their planets, the stations built at a
// planet round it in a low orbit (inside its moons), and the observatories out in deep space in a
// wide orbit round the site they watch (world/galaxy.js). Like the idle game's system view
// (idle/map.js), the inner orbits go round faster, by Kepler's 1.5 power, though slowly enough at
// flight scale that a ship parked by a station keeps up with it (game/update.js carries it along).
//
// Each orbiting thing carries its own orbit, set when it is generated: `orbit` (its distance from
// what it circles, world units), `angle` (where it is at t = 0, radians) and `period` (seconds per
// turn). The generator lays everything out at t = 0; place() moves it all to where it is at t.
//
//   Orbits.PERIOD[kind] -> [seconds, at distance]   a turn's length at that distance, by kind
//   Orbits.period(kind, d) -> seconds               by Kepler from PERIOD
//   Orbits.angleAt(o, t) -> radians                 where on its orbit o is at t
//   Orbits.place(galaxy, t)                         every planet, moon and orbiting station of a
//                                                   generated galaxy (or system) moved to t, in place
// t is seconds of the orbit clock (game/world.js runs it with flight). ES module (`Orbits`); also
// runs in Node (the tests).

const Orbits = (() => {
  const TAU = Math.PI * 2;

  // A turn's length at a distance, by what goes round: a planet 5,000 units out takes half an hour
  // (about 17 units a second), a moon 1,000 units from its planet under three minutes, a station in
  // low orbit 600 units up two and a half, an observatory 4,000 units out ten minutes.
  const PERIOD = { planet: [1800, 5000], moon: [160, 1000], station: [150, 600], site: [600, 4000] };
  const period = (kind, d) => PERIOD[kind][0] * (Math.max(1, d) / PERIOD[kind][1]) ** 1.5;
  const angleAt = (o, t) => o.angle + (TAU * t) / o.period;

  // o round (cx, cy) at t, into o.x, o.y.
  function put(o, cx, cy, t) {
    const a = angleAt(o, t);
    o.x = cx + Math.cos(a) * o.orbit;
    o.y = cy + Math.sin(a) * o.orbit;
  }

  function place(galaxy, t) {
    const stars = galaxy.stars || [galaxy.star];
    for (const p of galaxy.planets) { const S = stars[p.system || 0]; put(p, S.x, S.y, t); }
    for (const m of galaxy.moons) { const p = galaxy.planets[m.parent]; put(m, p.x, p.y, t); }
    for (const s of galaxy.stations) {
      if (!s.period) continue; // parked: camps, yards, hubs and the waystation keep their place
      const c = s.planet !== undefined ? galaxy.planets[s.planet] : galaxy.sites[s.site];
      put(s, c.x, c.y, t);
    }
    galaxy.orbitT = t; // when it was last placed: what's built from it later starts there too (flight/scene.js)
  }

  return { PERIOD, period, angleAt, place };
})();

export { Orbits };
