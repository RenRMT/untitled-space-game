'use strict';

// Sector contents for the flight view, generated from the galaxy (galaxy.js) and the faction
// cultures (art/culture.js). Each map sector becomes a square play area `units` across, and its
// contents are recreated on demand from the galaxy seed and the sector coordinates:
// - systems: a star, one planet per planet location, stations and outposts of the owner,
// - outposts: a minor station; salvage yards collect wrecks,
// - pirates, in packs by the sector's security (security.js): lone ones in safe space, more,
//   larger and better-armed packs the more lawless the sector, each pack far enough from the
//   others to be fought on its own,
// - deep-space contacts: derelicts (wrecks with salvage) and ambushes (a pirate pack),
// - contested sectors: debris from border skirmishes,
// - asteroids: belts in some systems, a field around each mining camp, the odd field in deep space;
//   each has a stable key so a mined asteroid can stay destroyed,
// - floating items to collect: salvaged components near wrecks, trade goods spilled by freighters
//   and piled up at salvage yards, of goods.js types (rarer ones less often). Each item has a
//   stable key for the cargo hold.
// Positions are world units from the galaxy's top-left corner. Browser only (global `Sectors`).

const Sectors = (() => {
  const U = ArtUtil;
  const { TAU, lerp, clamp } = U;

  const STAR_CLASSES = [['M', 4], ['K', 3], ['G', 3], ['A', 1], ['B', 1]];
  const STAR_RADIUS = { M: [160, 200], K: [190, 230], G: [210, 250], A: [240, 270], B: [250, 290] };
  const PLANET_TYPES = [['gas', 3], ['terran', 2], ['desert', 2], ['ice', 2], ['lava', 1], ['blue', 1]];
  const CONTACT = Galaxy.CONTACT_TYPES;
  const MAX_CACHED = 40;
  const BELT_CHANCE = 0.45;
  const FIELD_CHANCE = { claimed: 0.04, deep: 0.06, frontier: 0.1 };
  const INNER_BELT = [['stony', 3], ['metal', 2], ['carbon', 1]];
  const OUTER_BELT = [['ice', 3], ['carbon', 2], ['stony', 1]];
  const DEEP_FIELD = [['carbon', 3], ['stony', 2], ['ice', 2], ['metal', 1]];

  // weightedPick (rng.js) with a random generator instead of a number.
  const weighted = (list, r) => weightedPick(list, r());

  function create(galaxy, cultures, units) {
    // Layout distances were tuned for 6000-unit sectors; bigger sectors spread systems out
    // proportionally, while object sizes and local groupings (wreck clusters, patrols) stay put.
    const S = units / 6000;
    const base = seedToInt(galaxy.seed);
    const key = (x, y) => `${x},${y}`;
    const systemAt = new Map(galaxy.systems.map((s) => [key(s.x, s.y), s]));
    const outpostAt = new Map(galaxy.outposts.map((o) => [key(o.x, o.y), o]));
    const pirates = galaxy.factions.find((f) => f.key === 'pirates');
    const majors = galaxy.factions.filter((f) => f.kind === 'major');
    const cache = new Map();

    function at(sx, sy) {
      if (sx < 0 || sy < 0 || sx >= galaxy.size || sy >= galaxy.size) return null;
      const k = key(sx, sy);
      let s = cache.get(k);
      if (s) { cache.delete(k); cache.set(k, s); return s; }
      s = build(sx, sy);
      cache.set(k, s);
      while (cache.size > MAX_CACHED) cache.delete(cache.keys().next().value);
      return s;
    }

    function build(sx, sy) {
      const r = mulberry32(hashInt(sx, sy, base ^ 0x5ec70));
      const ox = sx * units, oy = sy * units, C = units / 2;
      const territory = galaxy.territoryOf(sx, sy);
      const system = systemAt.get(key(sx, sy)) || null;
      const outpost = outpostAt.get(key(sx, sy)) || null;
      const contact = system || outpost ? null : galaxy.deepSector(sx, sy);
      const sec = { x: sx, y: sy, territory, system, outpost, contact, entities: [], star: null };
      const nextSeed = () => Math.floor(r() * 4294967295);
      const colorOf = galaxy.factionColor;

      // Placement in local coordinates, keeping things apart and inside the sector.
      const placed = [];
      const fits = (x, y, rad) => placed.every(([px, py, pr]) => Math.hypot(px - x, py - y) > pr + rad + 120);
      function spot(cx, cy, dmin, dmax, rad) {
        let x = cx, y = cy;
        for (let i = 0; i < 40; i++) {
          const a = r() * TAU, d = lerp(dmin, dmax, r());
          x = clamp(cx + Math.cos(a) * d, rad + 200, units - rad - 200);
          y = clamp(cy + Math.sin(a) * d, rad + 200, units - rad - 200);
          if (fits(x, y, rad)) break;
        }
        placed.push([x, y, rad]);
        return [x, y];
      }
      // A spot at distance d from (cx, cy), as close to angle a as fits.
      function spotToward(cx, cy, a, d, rad) {
        let x = cx, y = cy;
        for (let i = 0; i < 24; i++) {
          const aa = a + (i % 2 ? 1 : -1) * Math.ceil(i / 2) * 0.12;
          x = clamp(cx + Math.cos(aa) * d, rad + 200, units - rad - 200);
          y = clamp(cy + Math.sin(aa) * d, rad + 200, units - rad - 200);
          if (fits(x, y, rad)) break;
        }
        placed.push([x, y, rad]);
        return [x, y];
      }
      const add = (e, x, y) => { e.x = ox + x; e.y = oy + y; sec.entities.push(e); return e; };

      // market: { kind: 'system' | 'outpost', type } for economy.js; key identifies the station.
      const station = (type, fid, name, x, y, market) => {
        const art = ArtBlueprints.create(type, cultures.of(fid), nextSeed());
        return add({
          kind: 'station', art, name, faction: fid, color: colorOf(fid), spin: r() * TAU, radius: art.radius,
          key: `${sx},${sy}:${name}`, market,
        }, x, y);
      };
      const wreck = (type, culture, x, y, name) => {
        const art = ArtBlueprints.create(type, culture, nextSeed());
        return add({ kind: 'wreck', art, name, angle: r() * TAU, tumble: (r() - 0.5) * 0.04, radius: art.radius }, x, y);
      };
      // Ships have a role ('fighter' | 'freighter') and a stable key, so the flight view can keep
      // one selected and remember the ones destroyed. motion may be a function, called once the
      // art is made (so its random draws come after the art's seed). extra: name, position, ...
      let shipCount = 0;
      const ship = (role, fid, motion, extra = {}) => {
        const art = ArtBlueprints.create(role, cultures.of(fid), nextSeed());
        const e = {
          kind: 'ship', role, key: `${sx},${sy},s${shipCount++}`, art, faction: fid,
          motion: typeof motion === 'function' ? motion() : motion, radius: art.radius, x: ox, y: oy, ...extra,
        };
        sec.entities.push(e);
        return e;
      };
      const orbit = (cx, cy, rad, speed) => ({ type: 'orbit', cx: ox + cx, cy: oy + cy, r: rad, w: (r() < 0.5 ? -1 : 1) * speed / rad, a0: r() * TAU });
      const randomCulture = () => cultures.of(majors[Math.floor(r() * majors.length)].id);
      const between = ([lo, hi]) => lo + Math.floor(r() * (hi - lo + 1)); // a whole number in [lo, hi]

      // Asteroids and items draw from their own random stream, so they don't reshuffle the rest.
      // Each asteroid has a stable key, so a mined one stays gone (mining.js, game.js).
      const ra = mulberry32(hashInt(sx, sy, base ^ 0xa57e));
      let asteroidCount = 0;
      const asteroid = (x, y, type, size) => add({
        kind: 'asteroid', ast: { type, r: size, seed: Math.floor(ra() * 4294967295) },
        key: `${sx},${sy},a${asteroidCount++}`, spin0: ra() * TAU, tumble: (ra() - 0.5) * 0.5, radius: size,
      }, x, y);
      const rockSize = () => 8 + ra() ** 2.2 * 44;
      function field(cx, cy, n, spread, types) {
        for (let i = 0; i < n; i++) {
          const a = ra() * TAU, d = spread * Math.sqrt(ra());
          asteroid(cx + Math.cos(a) * d, cy + Math.sin(a) * d, weighted(types, ra), rockSize());
        }
      }
      // A ring of clumps around a star.
      function belt(cx, cy, radius, width, n, types) {
        const clumps = Array.from({ length: 8 + Math.floor(ra() * 6) }, () => ra() * TAU);
        for (let i = 0; i < n; i++) {
          const a = clumps[Math.floor(ra() * clumps.length)] + (ra() + ra() - 1) * 0.22;
          const d = radius + (ra() - 0.5) * width;
          asteroid(cx + Math.cos(a) * d, cy + Math.sin(a) * d, weighted(types, ra), rockSize());
        }
      }
      let itemCount = 0;
      const LOOT_KINDS = Goods.categories('salvage'), TRADE_KINDS = Goods.categories('trade');
      const lootTier = Security.lootTier(territory.security);
      // An item of one of these categories; its type comes from the item's own seed, so the
      // sector's random stream is used as before. Trade goods: rarer ones less likely (goods.js);
      // components: a tier by the sector's security (security.js), better in dangerous space.
      const item = (categories, x, y) => {
        const category = categories[Math.floor(ra() * categories.length)], seed = Math.floor(ra() * 4294967295);
        const rng = mulberry32(seed ^ 0x6e7);
        const kind = Goods.CATEGORIES[category].group === 'salvage' ? Goods.component(category, Security.componentTier(rng, lootTier)) : Goods.pick(rng, category);
        const angle = ra() * TAU, tumble = (ra() - 0.5) * 0.3;
        return add(Entities.item({ key: `${sx},${sy},${itemCount++}`, kind, seed, angle, tumble }), x, y);
      };
      // Things floating around an entity: loot by default, trade goods from freighters.
      function scatter(e, n, kinds) {
        for (let i = 0; i < n; i++) {
          const a = ra() * TAU, d = e.radius * 0.8 + 60 + ra() * 220;
          item(kinds, e.x - ox + Math.cos(a) * d, e.y - oy + Math.sin(a) * d);
        }
      }
      const spoils = (w) => scatter(w, 1 + Math.floor(ra() * 3),
        w.art.label.includes('freighter') || (w.art.type === 'wreck-station' && ra() < 0.5) ? TRADE_KINDS : LOOT_KINDS);

      // ---------- Fixed features ----------

      if (system) {
        const fid = system.faction;
        let cx = C, cy = C;
        if (!system.waystation) {
          const cls = weighted(STAR_CLASSES, r);
          const [r0, r1] = STAR_RADIUS[cls];
          cx = C + (r() - 0.5) * 600 * S;
          cy = C + (r() - 0.5) * 600 * S;
          const body = { r: lerp(r0, r1, r()), cls, seed: nextSeed() % 997, rays: 8 };
          placed.push([cx, cy, body.r * 2.2]);
          sec.star = add({ kind: 'star', body, name: system.name, radius: body.r * 3.2 }, cx, cy);
        }
        const planets = [];
        system.locations.filter((l) => l.type === 'planet').forEach((l, i) => {
          const type = weighted(PLANET_TYPES, r);
          const body = { r: lerp(90, type === 'gas' ? 190 : 150, r()), type, ring: r() < (type === 'gas' ? 0.6 : 0.2), ringTilt: -0.35 + (r() - 0.5) * 0.5, seed: nextSeed() % 9973 };
          const [x, y] = spot(cx, cy, (1200 + i * 500) * S, (1600 + i * 550) * S, body.r * (body.ring ? 2 : 1.1));
          planets.push(add({ kind: 'planet', body, name: l.name, radius: body.r * 2 }, x, y));
        });
        system.locations.filter((l) => l.type !== 'planet').forEach((l, i) => {
          const major = l.type === 'station' && i === 0 && (system.capital || system.waystation || (fid !== null && galaxy.factions[fid].kind === 'major'));
          const rad = major ? 230 : 120;
          // The main station sits near the star or the first planet; outposts further out.
          const near = l.type === 'station' && planets.length && r() < 0.5 ? planets[Math.floor(r() * planets.length)] : null;
          const [x, y] = near ? spot(near.x - ox, near.y - oy, near.body.r * 2.2 + rad, near.body.r * 2.6 + rad, rad)
            : spot(cx, cy, l.type === 'outpost' ? 2100 * S : 900 * S + rad, l.type === 'outpost' ? 2600 * S : 1500 * S + rad, rad);
          const marketType = system.waystation ? 'waystation' : major && system.capital ? 'capital' : major ? 'major' : 'minor';
          station(major ? 'station-major' : 'station-minor', fid, l.name, x, y, { kind: 'system', id: system.id, type: marketType });
        });
        if (sec.star && ra() < BELT_CHANCE) {
          const radius = (1500 + ra() * 2000) * S;
          belt(cx, cy, radius, 500 * S, 70 + Math.floor(ra() * 40), radius < 2500 * S ? INNER_BELT : OUTER_BELT);
        }
      } else if (outpost) {
        const [x, y] = spot(C, C, 0, 500 * S, 120);
        station('station-minor', outpost.faction, outpost.name, x, y, { kind: 'outpost', id: outpost.id, type: outpost.type });
        if (outpost.type === 'salvage yard') {
          for (let i = 0; i < 4; i++) {
            const [wx, wy] = spot(x, y, 350, 800, 90);
            spoils(wreck(r() < 0.75 ? 'wreck-ship' : 'wreck-station', randomCulture(), wx, wy));
          }
        }
        if (outpost.type === 'mining camp') field(x, y, 25 + Math.floor(ra() * 16), 1500, DEEP_FIELD);
      }

      // ---------- Deep-space contacts ----------

      if (contact) {
        const [x, y] = spot(C, C, 0, 1200 * S, 200);
        if (contact.type === 'derelict') {
          const c = randomCulture();
          if (r() < 0.4) spoils(wreck('wreck-station', c, x, y, CONTACT.derelict.label));
          else for (let i = 0; i < 2 + Math.floor(r() * 2); i++) { const [wx, wy] = spot(x, y, 0, 450, 60); spoils(wreck('wreck-ship', c, wx, wy, i ? undefined : CONTACT.derelict.label)); }
        } else if (contact.type === 'ambush') {
          // One pack, as big as the sector's biggest or one larger (security.js).
          const P = Security.pirates(territory.security), tier = Security.pick(r, P.tier);
          const n = Math.max(...P.size.map(([s]) => s)) + Math.floor(r() * 2);
          for (let i = 0; i < n; i++) ship('fighter', pirates.id, orbit(x, y, 250 + r() * 300, 160 + r() * 60), { tier, pack: 0 });
          scatter(wreck('wreck-ship', randomCulture(), x, y), 2 + Math.floor(ra() * 2), TRADE_KINDS); // the victim's cargo
        }
      }
      // The odd asteroid field out in uncharted space.
      if (!system && !outpost && !contact && ra() < (FIELD_CHANCE[territory.zone] || 0)) {
        field(C + (ra() - 0.5) * 3000 * S, C + (ra() - 0.5) * 3000 * S, 20 + Math.floor(ra() * 16), 1400, DEEP_FIELD);
      }

      // ---------- Pirates ----------

      // Pirates, by the sector's security (security.js): a few packs spread over the sector, far
      // enough apart that attacking one never draws in another, and clear of stations and the
      // star. Lone, lightly armed pirates in safe space; larger, better-armed packs in lawless
      // space. Never right next to a Waystation (galaxy.nearWaystation), which hostile contacts
      // avoid too. tier: their gear; pack: which pack a ship belongs to.
      const P = Security.pirates(territory.security);
      if (!contact && r() < P.chance && !galaxy.nearWaystation(sx, sy)) {
        const { spacing, orbit: [o0, o1], clear, margin } = Security.PACK;
        const keepClear = sec.entities.filter((e) => e.kind === 'station' || e.kind === 'star');
        const centres = [];
        // A spot for a pack's centre (sector coordinates), or null when the sector is too crowded.
        const packSpot = () => {
          for (let tries = 0; tries < 40; tries++) {
            const x = margin + o1 + r() * (units - 2 * (margin + o1)), y = margin + o1 + r() * (units - 2 * (margin + o1));
            if (centres.every(([cx, cy]) => Math.hypot(cx - x, cy - y) >= spacing)
              && keepClear.every((e) => Math.hypot(e.x - ox - x, e.y - oy - y) >= e.radius + clear + o1)) return [x, y];
          }
          return null;
        };
        for (let i = 0, n = between(P.packs); i < n; i++) {
          const at = packSpot();
          if (!at) break;
          centres.push(at);
          const size = Security.pick(r, P.size), tier = Security.pick(r, P.tier);
          for (let k = 0; k < size; k++) ship('fighter', pirates.id, orbit(at[0], at[1], o0 + r() * (o1 - o0), 160 + r() * 30), { tier, pack: i });
        }
      }
      // Border skirmish debris.
      if (territory.contestedBy !== null && r() < 0.5) {
        for (const fid of [territory.owner, territory.contestedBy]) {
          const [x, y] = spot(C, C, 800 * S, 2400 * S, 50);
          scatter(wreck('wreck-ship', cultures.of(fid), x, y), 1 + Math.floor(ra() * 2), LOOT_KINDS);
        }
      }
      return sec;
    }

    // Whether a sector is built and cached, without building it (for prefetching).
    const has = (sx, sy) => cache.has(key(sx, sy));

    return { at, has, units };
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
