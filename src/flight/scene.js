// The flight view's things in space, built once from a generated galaxy (world/galaxy.js: every solar
// system in one space) and its cultures (art/culture.js):
// - the stars, planets, moons, and the nebulae (drawn under everything),
// - stations in their culture, with their markets (rules/economy.js), and jump gates,
// - asteroids, each with the stable key the system gave it, so a mined one can stay gone,
// - gas pockets in the nebulae (drawn as small clouds of their nebula's type, art/bodies.js), keyed the same way,
// - wrecks: hidden derelicts, ambush victims and the salvage yard's, each with things floating
//   around it to collect: salvaged components (better in more dangerous space, world/security.js) or,
//   from freighters, trade goods (rules/goods.js, rarer ones less often). Each item has a stable key,
// - pirate ships circling their pack's centre.
// near(x, y, range) finds what is around a point from a coarse grid, so a frame only poses and
// draws what is close; stars and nebulae are too big for the grid and always checked.
// Positions are world units. ES module (`Scene`); also runs in Node (the tests).

import { ArtBlueprints } from '../art/blueprints.js';
import { ArtUtil } from '../art/util.js';
import { hashInt, mulberry32, nextSeed, seedToInt } from '../core/rng.js';
import { Entities } from './entities.js';
import { Goods } from '../rules/goods.js';
import { Security } from '../world/security.js';

const Scene = (() => {
  const { TAU } = ArtUtil;
  const CELL = 5000; // grid cell size, in world units
  const MARGIN = 1200; // how far a gridded thing reaches from where it is filed (rings, pirate orbits)


  function create(galaxy, cultures) {
    const base = seedToInt(galaxy.seed);
    const entities = [];
    const wide = [];
    const grid = new Map();
    const byKey = new Map();
    const cellOf = (v) => Math.floor(v / CELL);
    // File an entity under the grid cell of (ax, ay): where it is, or the centre it circles.
    function add(e, ax = e.x, ay = e.y) {
      entities.push(e);
      if (e.key) byKey.set(e.key, e);
      const k = `${cellOf(ax)},${cellOf(ay)}`;
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k).push(e);
      return e;
    }
    const addWide = (e) => { entities.push(e); wide.push(e); return e; };

    // ---------- Stars, nebulae, planets and moons ----------
    const stars = galaxy.stars.map((S) => addWide({ kind: 'star', body: { r: S.r, cls: S.cls, seed: S.seed, rays: 8 }, name: S.name, radius: S.r * 3.2, x: S.x, y: S.y }));
    // A nebula as art/bodies.js draws it: its blobs in world units, inside its square, with the
    // cloud's features about a seventh of its radius across.
    for (const n of galaxy.nebulae) {
      const cloud = {
        type: n.type, seed: n.seed, x: n.x - n.r, y: n.y - n.r, w: n.r * 2, h: n.r * 2, scale: Math.round(n.r / 7),
        blobs: n.blobs.map((b) => ({ x: n.x + b.dx, y: n.y + b.dy, r: b.r })),
      };
      addWide({ kind: 'nebula', nebula: n, cloud, radius: n.r, x: n.x, y: n.y });
    }
    // Planets, lit from their star; moons (art/bodies.js) by the fixed world light.
    for (const p of galaxy.planets) {
      const S = galaxy.stars[p.system];
      add({
        kind: 'planet', body: { r: p.r, type: p.type, ring: p.ring, ringTilt: p.ringTilt, seed: p.seed }, name: p.name, radius: p.r * 2,
        lightAngle: Math.atan2(S.y - p.y, S.x - p.x), x: p.x, y: p.y,
      });
    }
    for (const m of galaxy.moons) add({ kind: 'moon', body: { type: m.type, r: m.r, seed: m.seed }, name: m.name, radius: m.r * 1.3, x: m.x, y: m.y });

    // ---------- Stations ----------
    // market: { kind: 'system' | 'outpost', type } for rules/economy.js; key identifies the station.
    // culture: the culture it's built in (solar-galaxy.js CULTURES), which also sets its colour.
    const stations = galaxy.stations.map((s) => {
      const art = ArtBlueprints.create(s.size === 'major' ? 'station-major' : 'station-minor', cultures.of(s.culture), s.seed);
      return add({
        kind: 'station', art, name: s.name, culture: s.culture, color: galaxy.cultureColor(s.culture),
        spin: mulberry32(s.seed)() * TAU, radius: art.radius, key: s.key, market: s.market, station: s, x: s.x, y: s.y,
      });
    });

    // ---------- Jump gates ----------
    // gate: the generated gate (world/galaxy.js), with the id of the one it links to.
    const gates = galaxy.gates.map((g) => {
      const art = ArtBlueprints.create('gate', cultures.of(g.culture), g.seed);
      return add({
        kind: 'gate', art, name: g.name, color: galaxy.cultureColor(g.culture), angle: Math.atan2(g.y - galaxy.stars[g.system].y, g.x - galaxy.stars[g.system].x),
        spin: mulberry32(g.seed)() * TAU, radius: art.radius, key: g.key, gate: g, x: g.x, y: g.y,
      });
    });

    // ---------- Asteroids ----------
    for (const a of galaxy.asteroids) add(Entities.asteroid(a));

    // ---------- Gas pockets ----------
    // pocket: the generated pocket (world/solar-system.js); color: its nebula's.
    for (const q of galaxy.pockets || []) {
      const n = galaxy.nebulae[q.nebula];
      add({ kind: 'gas', gas: { type: n.type, seed: q.seed, r: q.r }, key: q.key, pocket: q, color: n.color, radius: q.r, x: q.x, y: q.y });
    }

    // ---------- Wrecks and what floats around them ----------
    let itemCount = 0;
    const LOOT_KINDS = Goods.categories('salvage'), TRADE_KINDS = Goods.categories('trade');
    // An item of one of these categories, from the wreck's own random stream. Trade goods: rarer
    // ones less likely (rules/goods.js); components: a tier by the security there (world/security.js), better
    // in dangerous space.
    function item(r, categories, x, y, lootTier) {
      const category = categories[Math.floor(r() * categories.length)], seed = nextSeed(r);
      const rng = mulberry32(seed ^ 0x6e7);
      const kind = Goods.CATEGORIES[category].group === 'salvage' ? Goods.component(category, Security.componentTier(rng, lootTier)) : Goods.pick(rng, category);
      const angle = r() * TAU, tumble = (r() - 0.5) * 0.3;
      return add(Entities.item({ key: `i${itemCount++}`, kind, seed, angle, tumble, x, y }));
    }
    galaxy.wrecks.forEach((w, i) => {
      const art = ArtBlueprints.create(w.type, cultures.of(w.culture), w.seed);
      const e = add({ kind: 'wreck', art, name: w.name, angle: w.angle, tumble: w.tumble, radius: art.radius, key: w.key, contact: w.contact, x: w.x, y: w.y });
      const r = mulberry32(hashInt(base, i, 0x17e5));
      const kinds = w.cargo === 'trade' || art.label.includes('freighter') || (w.type === 'wreck-station' && r() < 0.5) ? TRADE_KINDS : LOOT_KINDS;
      const tier = Security.lootTier(galaxy.securityAt(w.x, w.y));
      for (let k = 0; k < w.spoils; k++) {
        const a = r() * TAU, d = e.radius * 0.8 + 60 + r() * 220;
        item(r, kinds, e.x + Math.cos(a) * d, e.y + Math.sin(a) * d, tier);
      }
    });

    // ---------- Pirates ----------
    // Fighters in the pirates' kitbashed culture, circling their pack's centre. Each has a stable
    // key, so the flight view can keep one selected and remember the ones destroyed.
    // tier: their gear (rules/loadout.js); pack: which pack a ship belongs to.
    for (const k of galaxy.packs) {
      for (const s of k.ships) {
        const art = ArtBlueprints.create(Entities.fighterClass(k.tier, s.seed), cultures.pirates, s.seed);
        add({ ...Entities.fighter({ key: s.key, art, x: k.x, y: k.y, orbit: s.orbit, speed: s.speed, a0: s.a0, tier: k.tier }), pack: k.id }, k.x, k.y);
      }
    }

    // Everything that may be within `range` of (x, y): the big things that reach it, and all
    // filed in the grid cells around it.
    function near(x, y, range) {
      const out = [];
      for (const e of wide) if (Math.hypot(e.x - x, e.y - y) - e.radius <= range) out.push(e);
      const reach = range + MARGIN;
      for (let cy = cellOf(y - reach); cy <= cellOf(y + reach); cy++) {
        for (let cx = cellOf(x - reach); cx <= cellOf(x + reach); cx++) {
          const list = grid.get(`${cx},${cy}`);
          if (list) for (const e of list) out.push(e);
        }
      }
      return out;
    }

    return { entities, stations, gates, stars, near, byKey, get: (key) => byKey.get(key) || null };
  }

  // Position, heading and thrust of an entity at time t.
  function pose(e, t) {
    const m = e.motion;
    if (!m) {
      e.a = (e.angle || 0) + (e.tumble || 0) * t;
      return;
    }
    if (m.type === 'orbit') {
      const a = m.a0 + t * m.w;
      e.x = m.cx + Math.cos(a) * m.r;
      e.y = m.cy + Math.sin(a) * m.r;
      e.a = a + Math.sign(m.w) * Math.PI / 2;
      e.thrust = 0.45;
    }
  }

  return { create, pose };
})();

export { Scene };
