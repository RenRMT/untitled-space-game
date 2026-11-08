// The flight view's things in space, built once from a generated galaxy (world/galaxy.js: every solar
// system in one space) and its cultures (art/culture.js):
// - the stars, planets, moons, and the nebulae (drawn under everything),
// - stations in their culture, with their markets (rules/economy.js), each drawn as what it does
//   (art/station-roles.js), and jump gates,
// - asteroids, each with the stable key the system gave it, so a mined one can stay gone,
// - gas pockets in the nebulae (drawn as small clouds of their nebula's type, art/bodies.js), keyed the same way,
// - wrecks: hidden derelicts, ambush victims and the salvage yard's, each with things floating
//   around it to collect: salvaged components (better in more dangerous space, world/security.js) or,
//   from freighters, trade goods (rules/goods.js, rarer ones less often). Each item has a stable key,
// - pirate ships circling their pack's centre,
// - the deep-space sites between the systems, as bodies, places, areas or sky (flight/deep-sites.js);
//   the rocks some of them hold are built when first near, like a system's, keyed `d<site>.a<n>`;
//   the moving ones (an interstellar object, a runaway star) where the real clock puts them.
// near(x, y, range) finds what is around a point from a coarse grid, so a frame only poses and
// draws what is close; stars and nebulae are too big for the grid and always checked.
// Lazy, per system: the bodies, stations and gates of every system are built at once, but a
// system's rocks, gas pockets, wrecks with what floats round them, and pirates only when near()
// first looks within reach of it (or ensure(i), ensureAll()); `entities` holds what is built.
// Every key is the same whichever order the systems are built in.
// Planets, moons and the stations at planets go round (world/orbits.js), and so do the
// observatories round their deep-space sites and the moons of a brown dwarf or rogue planet:
// move(t) puts them all where the orbit clock has them, each with `moved` { x, y }, how far it went
// (for game/update.js to carry a ship parked by it). They aren't filed in the grid: near() checks a
// system's when the system is near, and the deep-space ones are always checked.
// Positions are world units. ES module (`Scene`); also runs in Node (the tests).

import { ArtBlueprints } from '../art/blueprints.js';
import { ArtStationRoles } from '../art/station-roles.js';
import { ArtTurrets } from '../art/turrets.js';
import { ArtUtil } from '../art/util.js';
import { hashInt, mulberry32, nextSeed, seedToInt } from '../core/rng.js';
import { DeepSpace } from '../world/deep-space.js';
import { Orbits } from '../world/orbits.js';
import { DeepSites } from './deep-sites.js';
import { Entities } from './entities.js';
import { Goods } from '../rules/goods.js';
import { Structures } from '../rules/structures.js';

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
    // Things that go round: [entity, its data] (data: the galaxy's planet, moon or station, or for a
    // deep-space moon its own orbit round its site's centre). By system, and the deep-space ones.
    const systemCount = galaxy.systems ? galaxy.systems.length : 1;
    const orbiters = [], orbitersOf = Array.from({ length: systemCount }, () => []);
    function addOrbiter(e, data) {
      entities.push(e);
      if (e.key) byKey.set(e.key, e);
      e.moved = { x: 0, y: 0 };
      orbiters.push([e, data]);
      if (data.site === undefined && !data.deep) orbitersOf[data.system || 0].push(e);
      else wide.push(e);
      return e;
    }

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
    // Planets, lit from their star; moons (art/bodies.js) by the fixed world light. Each is keyed by
    // its name, so it can be selected (and landed on, game/landing.js).
    for (const p of galaxy.planets) {
      const S = galaxy.stars[p.system || 0];
      addOrbiter({
        kind: 'planet', key: p.name, body: { r: p.r, type: p.type, ring: p.ring, ringTilt: p.ringTilt, seed: p.seed }, name: p.name, radius: p.r * 2,
        lightAngle: Math.atan2(S.y - p.y, S.x - p.x), star: S, x: p.x, y: p.y,
      }, p);
    }
    for (const m of galaxy.moons) addOrbiter({ kind: 'moon', key: m.name, body: { type: m.type, r: m.r, seed: m.seed }, name: m.name, radius: m.r * 1.3, x: m.x, y: m.y }, m);

    // ---------- Stations ----------
    // market: { kind: 'system' | 'outpost', type } for rules/economy.js; key identifies the station.
    // culture: the culture it's built in (solar-galaxy.js CULTURES), which also sets its colour.
    const stations = galaxy.stations.map((s) => {
      const role = ArtStationRoles.ROLE_OF[s.market?.type];
      const art = role ? ArtStationRoles.create(role, cultures.of(s.culture), s.seed, s.size)
        : ArtBlueprints.create(s.size === 'major' ? 'station-major' : 'station-minor', cultures.of(s.culture), s.seed);
      const sys = galaxy.systems && galaxy.systems[s.system || 0];
      const e = {
        kind: 'station', art, name: s.name, culture: s.culture, color: galaxy.cultureColor(s.culture),
        spin: mulberry32(s.seed)() * TAU, radius: art.radius, key: s.key, market: s.market, station: s, x: s.x, y: s.y,
        owner: s.owner, tier: (sys && sys.level) || 1, size: s.market?.type === 'capital' ? 'capital' : s.size, turrets: [],
      };
      return s.period ? addOrbiter(e, s) : add(e);
    });

    // ---------- Station turrets ----------
    // Each station's 0–3 turrets (rules/structures.js), in its culture, going round it. Keyed by the
    // station's key, so a destroyed one stays gone (game/structures.js).
    const turrets = [];
    for (const st of stations) {
      const s = st.station, sys = galaxy.systems && galaxy.systems[s.system || 0];
      const r = mulberry32(hashInt(base, seedToInt(s.key), 0x7a22e7));
      const security = sys && sys.securityAt ? sys.securityAt(s.x, s.y) : 2;
      const n = Structures.turretCount(r, { security, level: st.tier, size: st.size === 'capital' || s.size === 'major' ? 'major' : 'minor' });
      for (let i = 0; i < n; i++) {
        const kind = Structures.turretKind(r), seed = nextSeed(r);
        const art = ArtTurrets.create(kind, cultures.of(s.culture), seed);
        const o = Structures.orbit(i, n, st.radius), a = o.angle + (TAU * (galaxy.orbitT || 0)) / o.period;
        const t = {
          kind: 'turret', key: `${s.key}.t${i}`, art, turretKind: kind, name: kind === 'missile' ? 'Missile turret' : 'Gun turret', host: st,
          owner: s.owner, culture: s.culture, color: st.color, tier: st.tier, radius: art.radius * Structures.TURRET_SCALE,
          x: s.x + Math.cos(a) * o.orbit, y: s.y + Math.sin(a) * o.orbit, aim: o.angle,
        };
        addOrbiter(t, { around: s, orbit: o.orbit, angle: o.angle, period: o.period, system: s.system || 0, site: s.site });
        st.turrets.push(t);
        turrets.push(t);
      }
    }

    // ---------- Jump gates and wormholes ----------
    // gate: the generated gate or wormhole (world/galaxy.js), with the id of the one it links to.
    const gates = galaxy.gates.map((g) => {
      const art = ArtBlueprints.create(g.wormhole ? 'wormhole' : 'gate', cultures.of(g.culture), g.seed);
      return add({
        kind: 'gate', art, name: g.name, color: g.color || galaxy.cultureColor(g.culture), angle: Math.atan2(g.y - galaxy.stars[g.system].y, g.x - galaxy.stars[g.system].x),
        spin: mulberry32(g.seed)() * TAU, radius: art.radius, key: g.key, gate: g, x: g.x, y: g.y,
      });
    });

    // ---------- Deep space ----------
    // Sites are big or few, so all of them are checked each frame; their rocks are built when near.
    const deep = DeepSites.build(galaxy);
    for (const e of deep.entities) {
      if (e.circles) { addOrbiter(e, e.circles); continue; } // a moon round a brown dwarf or rogue planet
      addWide(e);
      if (e.key) byKey.set(e.key, e);
    }
    const deepLazy = new Map(deep.lazy.map((l) => [l.site.id, l]));
    const sitesBuilt = new Set();
    function ensureSite(id) {
      const l = deepLazy.get(id);
      if (!l || sitesBuilt.has(id)) return false;
      sitesBuilt.add(id);
      for (const a of l.rocks()) add(Entities.asteroid(a));
      return true;
    }

    // ---------- Per system, built when first near ----------
    const bySystem = (list) => {
      const out = Array.from({ length: systemCount }, () => []);
      list.forEach((o, i) => out[o.system || 0].push([o, i]));
      return out;
    };
    const parts = { asteroids: bySystem(galaxy.asteroids), pockets: bySystem(galaxy.pockets || []), wrecks: bySystem(galaxy.wrecks), packs: bySystem(galaxy.packs) };
    // A wreck's items are keyed by their place in the galaxy's whole list.
    const itemBase = [];
    galaxy.wrecks.reduce((n, w, i) => { itemBase[i] = n; return n + w.spoils; }, 0);
    const built = new Set();

    // ---------- Asteroids ----------
    const buildAsteroids = (si) => { for (const [a] of parts.asteroids[si]) add(Entities.asteroid(a)); };

    // ---------- Gas pockets ----------
    // pocket: the generated pocket (world/solar-system.js); color: its nebula's.
    const buildPockets = (si) => {
      for (const [q] of parts.pockets[si]) {
        const n = galaxy.nebulae[q.nebula];
        add({ kind: 'gas', gas: { type: n.type, seed: q.seed, r: q.r }, key: q.key, pocket: q, color: n.color, radius: q.r, x: q.x, y: q.y });
      }
    };

    // ---------- Wrecks and what floats around them ----------
    const LOOT_KINDS = Goods.categories('salvage'), TRADE_KINDS = Goods.categories('trade');
    // An item of one of these categories, from the wreck's own random stream (rarer trade goods
    // less likely: rules/goods.js; none of those found only on surfaces).
    function item(r, categories, x, y, key) {
      const category = categories[Math.floor(r() * categories.length)], seed = nextSeed(r);
      const rng = mulberry32(seed ^ 0x6e7);
      const kind = Goods.CATEGORIES[category].group === 'salvage' ? Goods.component(category) : Goods.pick(rng, category, (t) => !t.surface);
      const angle = r() * TAU, tumble = (r() - 0.5) * 0.3;
      return add(Entities.item({ key, kind, seed, angle, tumble, x, y }));
    }
    const buildWrecks = (si) => parts.wrecks[si].forEach(([w, i]) => {
      const art = ArtBlueprints.create(w.type, cultures.of(w.culture), w.seed);
      const e = add({ kind: 'wreck', art, name: w.name, angle: w.angle, tumble: w.tumble, radius: art.radius, key: w.key, contact: w.contact, x: w.x, y: w.y });
      const r = mulberry32(hashInt(base, i, 0x17e5));
      const kinds = w.cargo === 'trade' || art.label.includes('freighter') || (w.type === 'wreck-station' && r() < 0.5) ? TRADE_KINDS : LOOT_KINDS;
      for (let k = 0; k < w.spoils; k++) {
        const a = r() * TAU, d = e.radius * 0.8 + 60 + r() * 220;
        item(r, kinds, e.x + Math.cos(a) * d, e.y + Math.sin(a) * d, `i${itemBase[i] + k}`);
      }
    });

    // ---------- Pirates ----------
    // Fighters in the pirates' kitbashed culture, circling their pack's centre. Each has a stable
    // key, so the flight view can keep one selected and remember the ones destroyed.
    // tier: their gear (rules/loadout.js); pack: which pack a ship belongs to.
    const buildPirates = (si) => {
      for (const [k] of parts.packs[si]) {
        for (const s of k.ships) {
          const alien = k.faction === 'alien';
          const art = ArtBlueprints.create(Entities.fighterClass(k.tier, s.seed), alien ? cultures.alien || cultures.pirates : cultures.pirates, s.seed);
          add({ ...Entities.fighter({ key: s.key, art, x: k.x, y: k.y, orbit: s.orbit, speed: s.speed, a0: s.a0, tier: k.tier }), pack: k.id, faction: k.faction || 'drifter', ...(alien ? { crew: 'Aliens' } : {}) }, k.x, k.y);
        }
      }
    };

    // A system's lazy parts, once.
    function ensure(si) {
      if (built.has(si)) return false;
      built.add(si);
      buildAsteroids(si);
      buildPockets(si);
      buildWrecks(si);
      buildPirates(si);
      return true;
    }
    const ensureAll = () => { for (let i = 0; i < systemCount; i++) ensure(i); for (const id of deepLazy.keys()) ensureSite(id); };
    // The systems whose disc comes within `range` of (x, y).
    // Returns the indices of those systems.
    const ensureNear = (x, y, range) => {
      if (!galaxy.systems) { ensure(0); return [0]; }
      const out = [];
      for (const sys of galaxy.systems) if (Math.hypot(sys.origin.x - x, sys.origin.y - y) - sys.radius * 1.1 <= range + MARGIN) { ensure(sys.index); out.push(sys.index); }
      for (const [id, l] of deepLazy) if (!sitesBuilt.has(id) && Math.hypot(l.site.x - x, l.site.y - y) - l.site.r <= range + MARGIN) ensureSite(id);
      return out;
    };

    // Everything that may be within `range` of (x, y): the big things that reach it, and all
    // filed in the grid cells around it.
    function near(x, y, range) {
      const systems = ensureNear(x, y, range);
      const out = [];
      for (const si of systems) for (const e of orbitersOf[si]) if (Math.hypot(e.x - x, e.y - y) - (e.extent || e.radius) <= range + MARGIN) out.push(e);
      for (const e of wide) {
        if (e.motion && e.motion.type === 'path') pose(e); // a mover is wherever it is now
        if (Math.hypot(e.x - x, e.y - y) - (e.extent || e.radius) <= range) out.push(e);
      }
      const reach = range + MARGIN;
      for (let cy = cellOf(y - reach); cy <= cellOf(y + reach); cy++) {
        for (let cx = cellOf(x - reach); cx <= cellOf(x + reach); cx++) {
          const list = grid.get(`${cx},${cy}`);
          if (list) for (const e of list) out.push(e);
        }
      }
      return out;
    }

    // get(key) finds anything, building its system first if it hasn't been.
    const systemOfKey = (key) => { const m = /^(\d+)\./.exec(key); return m ? Number(m[1]) : 0; };
    const get = (key) => {
      const site = typeof key === 'string' && /^d(\d+)\./.exec(key);
      if (!byKey.has(key) && site) ensureSite(Number(site[1]));
      else if (!byKey.has(key) && typeof key === 'string') ensure(systemOfKey(key));
      return byKey.get(key) || null;
    };
    // Everything that goes round to where it is at t (seconds of the orbit clock): the galaxy's
    // data first (world/orbits.js), then the entities from it.
    function move(t) {
      Orbits.place(galaxy, t);
      for (const [e, o] of orbiters) {
        const x0 = e.x, y0 = e.y;
        if (o.around) { const a = Orbits.angleAt(o, t); e.x = o.around.x + Math.cos(a) * o.orbit; e.y = o.around.y + Math.sin(a) * o.orbit; } else { e.x = o.x; e.y = o.y; }
        e.moved.x = e.x - x0; e.moved.y = e.y - y0;
        if (e.star) e.lightAngle = Math.atan2(e.star.y - e.y, e.star.x - e.x);
      }
    }

    return { entities, stations, turrets, gates, stars, near, move, byKey, get, ensure, ensureAll, ensureSite, built: (i) => built.has(i) };
  }

  // Position, heading and thrust of an entity at time t. A deep-space mover runs on the real clock
  // (as on the galaxy map), whatever t is.
  function pose(e, t) {
    const m = e.motion;
    if (!m) {
      e.a = (e.angle || 0) + (e.tumble || 0) * t;
      return;
    }
    if (m.type === 'path') {
      const p = DeepSpace.positionAt(m.site, Date.now() / 1000);
      e.x = p.x; e.y = p.y;
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
