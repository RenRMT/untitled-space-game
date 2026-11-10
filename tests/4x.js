// Node checks for the 4X game. No dependencies: `node tests/4x.js` (ONLY=text runs the tests whose
// names include it); `node tests/run.js` runs every game's.

import assert from 'node:assert';
import { Orbits4X } from '../src/4x/orbits.js';
import { World4X } from '../src/4x/world.js';
import { finish, test } from './harness.js';

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

// ---------- The 4X game (4x/, notes/4x.md) ----------

test('4x orbit rules: what may go round what', () => {
  const base = [
    { key: 'star', kind: 'star', parent: null },
    { key: 'p', kind: 'planet', parent: 'star', orbit: 9000, angle: 0, period: 100 },
    { key: 'm', kind: 'moon', parent: 'p', orbit: 900, angle: 0, period: 10 },
  ];
  assert.deepStrictEqual(Orbits4X.check(base), []);
  const ok = [...base,
    { key: 's1', kind: 'station', parent: 'p', orbit: 500, angle: 0, period: 10 },
    { key: 's2', kind: 'station', parent: 'm', orbit: 200, angle: 0, period: 10 },
    { key: 'u1', kind: 'ship', parent: 's1', orbit: 170, angle: 0, period: 10 },
    { key: 'u2', kind: 'ship', parent: 'm', orbit: 300, angle: 0, period: 10 },
    { key: 'b', kind: 'belt', parent: 'star', orbit: 20000, width: 2000 },
    { key: 'g', kind: 'graveyard', parent: 'p', point: 'L4' },
  ];
  assert.deepStrictEqual(Orbits4X.check(ok), []);
  const bad = (n, why) => assert(Orbits4X.check([...ok, n]).length > 0, why);
  bad({ key: 'x', kind: 'station', parent: 'p', orbit: 700, angle: 0, period: 10 }, 'a second station round one planet');
  bad({ key: 'x', kind: 'station', parent: 'star', orbit: 700, angle: 0, period: 10 }, 'a station round the star');
  bad({ key: 'x', kind: 'moon', parent: 'm', orbit: 70, angle: 0, period: 10 }, 'a moon round a moon');
  bad({ key: 'x', kind: 'ship', parent: 'star', orbit: 700, angle: 0, period: 10 }, 'a ship round the star');
  bad({ key: 'x', kind: 'ship', parent: 'g', orbit: 70, angle: 0, period: 10 }, 'a ship round a graveyard');
  bad({ key: 'x', kind: 'planet', parent: 'p', orbit: 70, angle: 0, period: 10 }, 'a planet round a planet');
  bad({ key: 'x', kind: 'graveyard', parent: 'p', point: 'L1' }, 'a graveyard off L4 and L5');
  bad({ key: 'x', kind: 'star', parent: null }, 'two stars');
  assert(Orbits4X.check(base.slice(0, 1)).length > 0, 'no planet');
  assert(!Orbits4X.canHost(ok, 'station', 'p') && Orbits4X.canHost(base, 'station', 'p') && Orbits4X.canHost(ok, 'ship', 's2') && !Orbits4X.canHost(ok, 'ship', 'star'));
  // Placed: everything on its orbit; the graveyard on the planet's orbit, 60° ahead of it.
  const sys = { x: 100, y: -50, nodes: ok };
  Orbits4X.place(sys, 37);
  const by = Object.fromEntries(ok.map((n) => [n.key, n]));
  for (const n of ok) if (n.orbit && n.kind !== 'belt') assert(Math.abs(dist(n, by[n.parent]) - n.orbit) < 1e-6, n.key);
  assert(Math.abs(dist(by.g, by.star) - 9000) < 1e-6 && Math.abs(dist(by.g, by.p) - 9000) < 1e-6, 'L4 is as far from the planet as from the star');
});

test('4x start system: a star, one planet, a station round it and a ship; ships fly to where they are sent and park', () => {
  for (const seed of [1, 7, 'abc']) {
    const w = World4X.create(seed);
    const kinds = w.start.nodes.map((n) => n.kind).sort();
    assert.deepStrictEqual(kinds, ['planet', 'ship', 'star', 'station']);
    assert.deepStrictEqual(Orbits4X.check(w.start.nodes), []);
    assert.strictEqual(w.systems.length, w.galaxy.systems.length, 'the main game\'s galaxy, every system in it');
    assert.strictEqual(w.start.radius, w.galaxy.systems[0].radius, 'the main game\'s play area');
    const ship = w.units()[0];
    assert.strictEqual(ship.parent, 'st0');
    assert(w.order(ship.key, 'star'), 'not round the star');
    assert(w.order('st0', 'p0'), 'stations take no orders');
    assert.strictEqual(w.order(ship.key, 'p0'), null);
    for (let i = 0; i < 6000 && ship.free; i++) w.step(0.05);
    assert(!ship.free && ship.parent === 'p0', 'parked round the planet');
    w.step(5);
    assert(Math.abs(dist(ship, w.node('p0')) - ship.orbit) < 1e-6, 'and goes round it');
    assert.strictEqual(w.order(ship.key, 'p0'), `Already in orbit round ${w.node('p0').name}`);
    assert.strictEqual(w.order(ship.key, 'st0'), null);
    for (let i = 0; i < 6000 && ship.free; i++) w.step(0.05);
    assert.strictEqual(ship.parent, 'st0');
  }
});

test('4x move orders: to a point a ship holds there, along a path it passes each stop, and the testbed system keeps the rules', () => {
  for (const seed of [1, 7, 'abc']) {
    const w = World4X.create(seed, { testbed: true });
    assert.deepStrictEqual(Orbits4X.check(w.start.nodes), []);
    assert(w.hosts().length > 2 && w.units().length === 3, 'more places to go and three ships');
    assert.strictEqual(new Set(w.units().map((u) => u.parent)).size, 3, 'the ships start round different places');
    const ship = w.units()[0], p = { x: ship.x + 4000, y: ship.y - 3000 };
    assert(w.eta(ship.key, p) > 0 && w.eta(ship.key, { x: ship.x + 8000, y: ship.y }) > w.eta(ship.key, p), 'further takes longer');
    assert.strictEqual(w.order(ship.key, { x: NaN, y: 0 }), 'Nowhere to go');
    assert(w.order(ship.key, { path: [p, 'star'] }), 'not round the star, even at the end of a path');
    assert.strictEqual(w.order(ship.key, p), null);
    for (let i = 0; i < 6000 && ship.free; i++) w.step(0.05);
    assert(!ship.free && ship.hold && ship.parent === null, 'holding');
    assert(Math.hypot(ship.x - p.x, ship.y - p.y) < 1e-6, 'at the point');
    assert.deepStrictEqual(Orbits4X.check(w.start.nodes), [], 'a ship holding a point keeps the rules');
    w.step(30);
    assert(Math.hypot(ship.x - p.x, ship.y - p.y) < 1e-6, 'and stays there');
    const host = w.hosts().find((h) => h.kind === 'moon') || w.hosts()[0];
    const a = { x: p.x, y: p.y + 2500 }, b = { x: p.x + 2500, y: p.y + 2500 };
    assert.strictEqual(w.order(ship.key, { path: [a, b, host.key] }), null);
    let passed = false;
    for (let i = 0; i < 40000 && ship.free; i++) { w.step(0.05); if (ship.free && ship.route.length === 1) passed = true; }
    assert(passed, 'passed the stops on the way');
    assert(!ship.free && !ship.hold && ship.parent === host.key, 'parked round the last stop');
    assert.deepStrictEqual(Orbits4X.check(w.start.nodes), []);
  }
});

test('4x building: an Outpost or a Starbase round a planet or moon, one each; dismantling re-parks ships round the body', () => {
  for (const seed of [1, 7, 'abc']) {
    for (const testbed of [false, true]) {
      const w = World4X.create(seed, { testbed });
      assert.deepStrictEqual(Object.keys(World4X.STATIONS), ['outpost', 'starbase']);
      const taken = w.start.nodes.find((n) => n.kind === 'station');
      assert(w.canBuild('star', 'outpost'), 'not round the star');
      assert(w.canBuild(taken.key, 'outpost'), 'not round a station');
      assert(w.canBuild(taken.parent, 'outpost'), 'one station round a body');
      assert(w.canBuild(taken.parent, 'shipyard'), 'no such kind');
      assert(w.build(taken.parent, 'starbase').why);
      assert(w.dismantle(w.units()[0].key), 'ships are not dismantled');
      // Dismantle the start station: the ship parked round it parks round its body, and keeps going round.
      const ship = w.units().find((u) => u.parent === taken.key);
      const body = w.node(taken.parent);
      if (ship) {
        const before = { x: ship.x, y: ship.y };
        assert.strictEqual(w.dismantle(taken.key), null);
        assert.strictEqual(ship.parent, body.key);
        assert(Math.abs(Math.atan2(ship.y - body.y, ship.x - body.x) - Math.atan2(before.y - body.y, before.x - body.x)) < 1e-6, 'from where it was');
        w.step(3);
        assert(Math.abs(dist(ship, body) - ship.orbit) < 1e-6, 'round the body');
      } else assert.strictEqual(w.dismantle(taken.key), null);
      assert(!w.node(taken.key) && !w.start.nodes.includes(taken));
      assert.deepStrictEqual(Orbits4X.check(w.start.nodes), []);
      // Undo puts it back; then take it away again and build each kind.
      assert.strictEqual(w.restore(taken), null);
      assert(w.restore(taken), 'not twice');
      assert.strictEqual(w.dismantle(taken.key), null);
      const r = w.build(body.key, 'outpost');
      assert(r.key && !r.why);
      const st = w.node(r.key);
      assert.strictEqual(st.size, 'minor');
      assert.strictEqual(st.owner, 'player');
      assert(w.building(st) !== null, 'being built');
      const g = w.ghostAt(body.key);
      assert(Math.hypot(st.x - g.x, st.y - g.y) < 1e-6, 'where its ghost was');
      w.step(5);
      assert.strictEqual(w.building(st), null, 'built');
      assert(Math.abs(dist(st, body) - st.orbit) < 1e-6 && st.orbit > World4X.parkOrbit(body), 'round the body, past the ships parked there');
      assert.deepStrictEqual(Orbits4X.check(w.start.nodes), []);
      assert(w.build(body.key, 'starbase').why, 'still one each');
      // A ship on its way to a station that is dismantled goes to the body instead.
      const u = w.units()[0];
      assert.strictEqual(w.order(u.key, st.key), null);
      w.step(0.1);
      assert.strictEqual(w.dismantle(st.key), null);
      assert.deepStrictEqual(u.route, [{ key: body.key }]);
      for (let i = 0; i < 20000 && u.free; i++) w.step(0.05);
      assert.strictEqual(u.parent, body.key);
      const big = w.build(body.key, 'starbase');
      assert.strictEqual(w.node(big.key).size, 'major');
      assert.notStrictEqual(big.key, r.key, 'a new key each time');
      if (testbed) {
        const moon = w.buildHosts().find((n) => n.kind === 'moon' && !w.canBuild(n.key, 'outpost'));
        if (moon) { assert(w.build(moon.key, 'outpost').key, 'round a moon'); assert.deepStrictEqual(Orbits4X.check(w.start.nodes), []); }
      }
    }
  }
});

finish('4x');
