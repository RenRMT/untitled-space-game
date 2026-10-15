'use strict';

// The flight view's things in space, built once from a generated solar system (solar-system.js)
// and its cultures (art/culture.js):
// - the star, planets, moons, and the nebulae (drawn under everything),
// - stations in their culture, with their markets (economy.js),
// - asteroids, each with the stable key the system gave it, so a mined one can stay gone,
// - wrecks: hidden derelicts, ambush victims and the salvage yard's, each with things floating
//   around it to collect: salvaged components (better in more dangerous space, security.js) or,
//   from freighters, trade goods (goods.js, rarer ones less often). Each item has a stable key,
// - pirate ships circling their pack's centre.
// near(x, y, range) finds what is around a point from a coarse grid, so a frame only poses and
// draws what is close; the star and nebulae are too big for the grid and always checked.
// Positions are world units from the star. Browser script (global `Scene`); also loads in Node
// for the tests.

const Scene = (() => {
  const { TAU } = ArtUtil;
  const CELL = 5000; // grid cell size, in world units
  const MARGIN = 1200; // how far a gridded thing reaches from where it is filed (rings, pirate orbits)

  // weightedPick (rng.js) with a random generator instead of a number.
  const weighted = (list, r) => weightedPick(list, r());

  function create(system, cultures) {
    const base = seedToInt(system.seed);
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

    // ---------- Star, nebulae, planets and moons ----------
    const S = system.star;
    const star = addWide({ kind: 'star', body: { r: S.r, cls: S.cls, seed: S.seed, rays: 8 }, name: S.name, radius: S.r * 3.2, x: S.x, y: S.y });
    // A nebula as art/bodies.js draws it: its blobs in world units, inside its square, with the
    // cloud's features about a seventh of its radius across.
    for (const n of system.nebulae) {
      const cloud = {
        type: n.type, seed: n.seed, x: n.x - n.r, y: n.y - n.r, w: n.r * 2, h: n.r * 2, scale: Math.round(n.r / 7),
        blobs: n.blobs.map((b) => ({ x: n.x + b.dx, y: n.y + b.dy, r: b.r })),
      };
      addWide({ kind: 'nebula', nebula: n, cloud, radius: n.r, x: n.x, y: n.y });
    }
    // Planets, lit from the star; moons (art/bodies.js) by the fixed world light.
    for (const p of system.planets) {
      add({
        kind: 'planet', body: { r: p.r, type: p.type, ring: p.ring, ringTilt: p.ringTilt, seed: p.seed }, name: p.name, radius: p.r * 2,
        lightAngle: Math.atan2(S.y - p.y, S.x - p.x), x: p.x, y: p.y,
      });
    }
    for (const m of system.moons) add({ kind: 'moon', body: { type: m.type, r: m.r, seed: m.seed }, name: m.name, radius: m.r * 1.3, x: m.x, y: m.y });



    // ---------- Stations ----------
    // market: { kind: 'system' | 'outpost', type } for economy.js; key identifies the station.
    // culture: the culture it's built in (solar-system.js CULTURES), which also sets its colour.
    const stations = system.stations.map((s) => {
      const art = ArtBlueprints.create(s.size === 'major' ? 'station-major' : 'station-minor', cultures.of(s.culture), s.seed);
      return add({
        kind: 'station', art, name: s.name, culture: s.culture, color: system.cultureColor(s.culture),
        spin: mulberry32(s.seed)() * TAU, radius: art.radius, key: s.key, market: s.market, station: s, x: s.x, y: s.y,
      });
    });

    // ---------- Asteroids ----------
    for (const a of system.asteroids) {
      add({ kind: 'asteroid', ast: { type: a.type, r: a.r, seed: a.seed }, key: a.key, spin0: a.spin0, tumble: a.tumble, radius: a.r, x: a.x, y: a.y });
    }

    // ---------- Wrecks and what floats around them ----------
    let itemCount = 0;
    const LOOT_KINDS = Goods.categories('salvage'), TRADE_KINDS = Goods.categories('trade');
    // An item of one of these categories, from the wreck's own random stream. Trade goods: rarer
    // ones less likely (goods.js); components: a tier by the security there (security.js), better
    // in dangerous space.
    function item(r, categories, x, y, lootTier) {
      const category = categories[Math.floor(r() * categories.length)], seed = Math.floor(r() * 4294967295);
      const rng = mulberry32(seed ^ 0x6e7);
      const kind = Goods.CATEGORIES[category].group === 'salvage' ? Goods.component(category, Security.componentTier(rng, lootTier)) : Goods.pick(rng, category);
      const angle = r() * TAU, tumble = (r() - 0.5) * 0.3;
      return add(Entities.item({ key: `i${itemCount++}`, kind, seed, angle, tumble, x, y }));
    }
    system.wrecks.forEach((w, i) => {
      const art = ArtBlueprints.create(w.type, cultures.of(w.culture), w.seed);
      const e = add({ kind: 'wreck', art, name: w.name, angle: w.angle, tumble: w.tumble, radius: art.radius, key: w.key, contact: w.contact, x: w.x, y: w.y });
      const r = mulberry32(hashInt(base, i, 0x17e5));
      const kinds = w.cargo === 'trade' || art.label.includes('freighter') || (w.type === 'wreck-station' && r() < 0.5) ? TRADE_KINDS : LOOT_KINDS;
      const tier = Security.lootTier(system.securityAt(w.x, w.y));
      for (let k = 0; k < w.spoils; k++) {
        const a = r() * TAU, d = e.radius * 0.8 + 60 + r() * 220;
        item(r, kinds, e.x + Math.cos(a) * d, e.y + Math.sin(a) * d, tier);
      }
    });

    // ---------- Pirates ----------
    // Fighters in the pirates' kitbashed culture, circling their pack's centre. Each has a stable
    // key, so the flight view can keep one selected and remember the ones destroyed.
    // tier: their gear (loadout.js); pack: which pack a ship belongs to.
    for (const k of system.packs) {
      for (const s of k.ships) {
        const art = ArtBlueprints.create('fighter', cultures.pirates, s.seed);
        const motion = { type: 'orbit', cx: k.x, cy: k.y, r: s.orbit, w: s.speed / s.orbit, a0: s.a0 };
        add({ kind: 'ship', role: 'fighter', pirate: true, key: s.key, art, motion, radius: art.radius, x: k.x, y: k.y, tier: k.tier, pack: k.id }, k.x, k.y);
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

    return { entities, stations, star, near, byKey, get: (key) => byKey.get(key) || null };
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
