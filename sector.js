'use strict';

// Sector contents for the flight view, generated from the galaxy (galaxy.js) and the faction
// cultures (art/culture.js). Each map sector becomes a square play area `units` across, and its
// contents are recreated on demand from the galaxy seed and the sector coordinates:
// - systems: a star, one planet per planet location, stations and outposts of the owner,
// - gates: one per route (lanes and gates alike), on the side facing the destination; each end is built by a major
//   faction (the system's owner, else the major at the other end, else the nearest major),
// - outposts: a minor station; salvage yards collect wrecks,
// - traffic, only inside charted pockets: fighters patrol and freighters run to the gates; owners
//   are picked by the sector's faction presence. Claimed space outside pockets sees the odd border
//   patrol, and pirates lurk in the territories they operate in,
// - deep-space contacts: derelicts, distress calls, ambushes, anomalies and story points,
// - contested sectors: debris from border skirmishes,
// - asteroids: belts in some systems, a field around each mining camp, the odd field in deep space,
// - floating items to collect: loot components near wrecks, trade goods spilled by freighters and
//   piled up at salvage yards (art/items.js). Each item has a stable key for the cargo hold.
// Positions are world units from the galaxy's top-left corner. Browser only (global `Sectors`).

const Sectors = (() => {
  const U = ArtUtil;
  const { TAU, lerp, clamp } = U;

  const STAR_CLASSES = [['M', 4], ['K', 3], ['G', 3], ['A', 1], ['B', 1]];
  const STAR_RADIUS = { M: [160, 200], K: [190, 230], G: [210, 250], A: [240, 270], B: [250, 290] };
  const PLANET_TYPES = [['gas', 3], ['terran', 2], ['desert', 2], ['ice', 2], ['lava', 1], ['blue', 1]];
  const CONTACT_LABELS = { derelict: 'Derelict', distress: 'Distress signal', anomaly: 'Anomaly' };
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

    // Gate ends per system, with the faction that built each end.
    const majorOf = (fid) => (fid !== null && fid !== undefined && galaxy.factions[fid].kind === 'major' ? fid : null);
    const nearestMajor = (s) => majors
      .map((m) => ({ id: m.id, d: Math.hypot(m.centre.x - s.x, m.centre.y - s.y) }))
      .sort((a, b) => a.d - b.d)[0].id;
    const gatesAt = new Map();
    for (const route of galaxy.routes) {
      for (const [here, there] of [[route.a, route.b], [route.b, route.a]]) {
        const sys = galaxy.systems[here], other = galaxy.systems[there];
        const builder = majorOf(sys.faction) ?? majorOf(other.faction) ?? nearestMajor(sys);
        if (!gatesAt.has(here)) gatesAt.set(here, []);
        gatesAt.get(here).push({ link: route.link, hidden: route.kind === 'hidden', other, builder });
      }
    }

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
      const colorOf = (fid) => (fid === null || fid === undefined ? '#9aa4b8' : galaxy.factions[fid].color);

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

      const station = (type, fid, name, x, y) => {
        const art = ArtBlueprints.create(type, cultures.of(fid), nextSeed());
        return add({ kind: 'station', art, name, faction: fid, color: colorOf(fid), spin: r() * TAU, radius: art.radius }, x, y);
      };
      const wreck = (type, culture, x, y, name) => {
        const art = ArtBlueprints.create(type, culture, nextSeed());
        return add({ kind: 'wreck', art, name, angle: r() * TAU, tumble: (r() - 0.5) * 0.04, radius: art.radius }, x, y);
      };
      const ship = (role, fid, motion) => {
        const art = ArtBlueprints.create(role, cultures.of(fid), nextSeed());
        sec.entities.push({ kind: 'ship', art, faction: fid, motion, radius: art.radius, x: ox, y: oy });
      };
      const orbit = (cx, cy, rad, speed) => ({ type: 'orbit', cx: ox + cx, cy: oy + cy, r: rad, w: (r() < 0.5 ? -1 : 1) * speed / rad, a0: r() * TAU });
      const route = (ax, ay, bx, by, speed) => ({ type: 'route', ax: ox + ax, ay: oy + ay, bx: ox + bx, by: oy + by, speed, phase: r() * 2 });
      const randomCulture = () => cultures.of(majors[Math.floor(r() * majors.length)].id);

      // Asteroids and items draw from their own random stream, so they don't reshuffle the rest.
      const ra = mulberry32(hashInt(sx, sy, base ^ 0xa57e));
      const asteroid = (x, y, type, size) => add({
        kind: 'asteroid', ast: { type, r: size, seed: Math.floor(ra() * 4294967295) },
        spin0: ra() * TAU, tumble: (ra() - 0.5) * 0.5, radius: size,
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
      const LOOT_KINDS = ArtItems.LOOT.map((k) => k.id), TRADE_KINDS = ArtItems.TRADE.map((k) => k.id);
      const item = (kinds, x, y) => {
        const art = ArtItems.create(kinds[Math.floor(ra() * kinds.length)], Math.floor(ra() * 4294967295));
        return add({
          kind: 'item', art, key: `${sx},${sy},${itemCount++}`, label: art.label.split(' · ')[1], category: art.category,
          angle: ra() * TAU, tumble: (ra() - 0.5) * 0.3, radius: art.radius,
        }, x, y);
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
        if (!system.freeport) {
          const cls = weighted(STAR_CLASSES, r);
          const [r0, r1] = STAR_RADIUS[cls];
          cx = C + (r() - 0.5) * 600 * S;
          cy = C + (r() - 0.5) * 600 * S;
          const body = { r: lerp(r0, r1, r()), cls, seed: nextSeed() % 997, rays: 8 };
          placed.push([cx, cy, body.r * 2.2]);
          sec.star = add({ kind: 'star', body, name: system.name, radius: body.r * 3.2 }, cx, cy);
        }
        for (const end of gatesAt.get(system.id) || []) {
          const art = ArtBlueprints.create('gate', cultures.of(end.builder), nextSeed());
          if (!art) continue;
          const field = art.parts.find((q) => q.mat === 'field');
          const aperture = Math.min(...field.pts.map(([px, py]) => Math.hypot(px, py)));
          const a = Math.atan2(end.other.y - sy, end.other.x - sx);
          const [x, y] = spotToward(cx, cy, a, 2300 * S, art.bodyRadius);
          add({
            kind: 'gate', art, link: end.link, hidden: end.hidden, dest: { x: end.other.x, y: end.other.y },
            name: end.hidden ? 'Uncharted gate' : `Gate to ${end.other.name}`,
            faction: end.builder, color: colorOf(end.builder), aperture, angle: a, spin: r() * TAU, radius: art.radius,
          }, x, y);
        }
        const planets = [];
        system.locations.filter((l) => l.type === 'planet').forEach((l, i) => {
          const type = weighted(PLANET_TYPES, r);
          const body = { r: lerp(90, type === 'gas' ? 190 : 150, r()), type, ring: r() < (type === 'gas' ? 0.6 : 0.2), ringTilt: -0.35 + (r() - 0.5) * 0.5, seed: nextSeed() % 9973 };
          const [x, y] = spot(cx, cy, (1200 + i * 500) * S, (1600 + i * 550) * S, body.r * (body.ring ? 2 : 1.1));
          planets.push(add({ kind: 'planet', body, name: l.name, radius: body.r * 2 }, x, y));
        });
        system.locations.filter((l) => l.type !== 'planet').forEach((l, i) => {
          const major = l.type === 'station' && i === 0 && (system.capital || system.freeport || (fid !== null && galaxy.factions[fid].kind === 'major'));
          const rad = major ? 230 : 120;
          // The main station sits near the star or the first planet; outposts further out.
          const near = l.type === 'station' && planets.length && r() < 0.5 ? planets[Math.floor(r() * planets.length)] : null;
          const [x, y] = near ? spot(near.x - ox, near.y - oy, near.body.r * 2.2 + rad, near.body.r * 2.6 + rad, rad)
            : spot(cx, cy, l.type === 'outpost' ? 2100 * S : 900 * S + rad, l.type === 'outpost' ? 2600 * S : 1500 * S + rad, rad);
          station(major ? 'station-major' : 'station-minor', fid, l.name, x, y);
        });
        if (sec.star && ra() < BELT_CHANCE) {
          const radius = (1500 + ra() * 2000) * S;
          belt(cx, cy, radius, 500 * S, 70 + Math.floor(ra() * 40), radius < 2500 * S ? INNER_BELT : OUTER_BELT);
        }
      } else if (outpost) {
        const [x, y] = spot(C, C, 0, 500 * S, 120);
        station('station-minor', outpost.faction, outpost.name, x, y);
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
        if (contact.type === 'story') {
          spoils(wreck('wreck-station', randomCulture(), x, y, contact.name));
        } else if (contact.type === 'derelict') {
          const c = randomCulture();
          if (r() < 0.4) spoils(wreck('wreck-station', c, x, y, CONTACT_LABELS.derelict));
          else for (let i = 0; i < 2 + Math.floor(r() * 2); i++) { const [wx, wy] = spot(x, y, 0, 450, 60); spoils(wreck('wreck-ship', c, wx, wy, i ? undefined : CONTACT_LABELS.derelict)); }
        } else if (contact.type === 'distress') {
          const fid = majors[Math.floor(r() * majors.length)].id;
          const art = ArtBlueprints.create('freighter', cultures.of(fid), nextSeed());
          const stranded = { kind: 'ship', art, faction: fid, name: CONTACT_LABELS.distress, motion: { type: 'still', angle: r() * TAU }, radius: art.radius, x: ox + x, y: oy + y };
          sec.entities.push(stranded);
          const [wx, wy] = spot(x, y, 200, 400, 40);
          spoils(wreck('wreck-ship', cultures.of(fid), wx, wy));
          scatter(stranded, 2 + Math.floor(ra() * 2), TRADE_KINDS); // jettisoned cargo
        } else if (contact.type === 'ambush') {
          const n = 3 + Math.floor(r() * 2);
          for (let i = 0; i < n; i++) ship('fighter', pirates.id, orbit(x, y, 250 + r() * 300, 160 + r() * 60));
          scatter(wreck('wreck-ship', randomCulture(), x, y), 2 + Math.floor(ra() * 2), TRADE_KINDS); // the victim's cargo
        } else if (contact.type === 'anomaly') {
          const body = { r: 110 + r() * 60, type: r() < 0.5 ? 'lava' : 'ice', ring: r() < 0.5, ringTilt: (r() - 0.5) * 1.2, seed: nextSeed() % 9973 };
          add({ kind: 'planet', body, name: CONTACT_LABELS.anomaly, radius: body.r * 2 }, x, y);
          field(x, y, 10 + Math.floor(ra() * 6), body.r * 4, body.type === 'ice' ? [['ice', 1]] : [['metal', 2], ['carbon', 1]]);
        }
      }
      // The odd asteroid field out in uncharted space.
      if (!system && !outpost && !contact && ra() < (FIELD_CHANCE[territory.zone] || 0)) {
        field(C + (ra() - 0.5) * 3000 * S, C + (ra() - 0.5) * 3000 * S, 20 + Math.floor(ra() * 16), 1400, DEEP_FIELD);
      }

      // ---------- Traffic ----------

      const owners = territory.presence.filter((p) => p.share >= 0.04);
      const known = territory.zone === 'pocket';
      const settled = 1 - (owners.find((p) => p.faction === null)?.share ?? 0);
      let count = known ? Math.round((system ? 4 : outpost ? 2 : 1) * (0.5 + settled) + r() * 2) : 0;
      if (system?.freeport) count = 3 + Math.floor(r() * 3);
      const pickOwner = () => {
        if (system?.freeport) return r() < 0.3 ? system.faction : majors[Math.floor(r() * majors.length)].id;
        const p = weighted(owners.map((o) => [o.faction, o.share]), r);
        return p === null ? null : p;
      };
      const anchors = sec.entities.filter((e) => e.kind === 'station' || e.kind === 'star');
      // Freighters leave through the charted gates, or cross the sector.
      const edge = (a) => { const k = (C - 250) / Math.max(Math.abs(Math.cos(a)), Math.abs(Math.sin(a))); return [C + Math.cos(a) * k, C + Math.sin(a) * k]; };
      const exits = sec.entities.filter((g) => g.kind === 'gate' && !g.hidden).map((g) => ({ a: g.angle, to: [g.x - ox, g.y - oy] }));
      for (let i = 0; i < count; i++) {
        const fid = known ? pickOwner() : null;
        const anchor = anchors.length ? anchors[Math.floor(r() * anchors.length)] : null;
        const [axl, ayl] = anchor ? [anchor.x - ox, anchor.y - oy] : [C + (r() - 0.5) * 2000 * S, C + (r() - 0.5) * 2000 * S];
        if (r() < (anchor ? 0.45 : 0.6)) {
          const exit = exits.length ? exits[Math.floor(r() * exits.length)] : null;
          const a = exit ? exit.a : r() * TAU;
          const [ex, ey] = exit ? exit.to : edge(a);
          const [bx, by] = anchor ? [axl + Math.cos(a) * (anchor.radius + 120), ayl + Math.sin(a) * (anchor.radius + 120)] : edge(a + Math.PI);
          ship('freighter', fid, route(bx, by, ex, ey, 90 + r() * 70));
        } else {
          const rad = (anchor ? anchor.radius : 0) + 250 + r() * 400;
          ship('fighter', fid, orbit(axl, ayl, rad, 150 + r() * 80));
        }
      }
      // The odd border patrol in claimed space outside the pockets.
      if (territory.zone === 'claimed' && r() < 0.15) {
        const [x, y] = [C + (r() - 0.5) * 3000 * S, C + (r() - 0.5) * 3000 * S];
        for (let i = 0; i < 2; i++) ship('fighter', territory.owner, orbit(x, y, 300 + r() * 200, 170));
      }
      // Pirates prey on the territories they operate in, and haunt the frontier.
      const preyed = territory.owner !== null && pirates.operatesIn?.includes(territory.owner);
      if (!contact && ((preyed && r() < 0.25) || (territory.zone === 'frontier' && r() < 0.12))) {
        const [x, y] = [C + (r() - 0.5) * 3000 * S, C + (r() - 0.5) * 3000 * S];
        for (let i = 0; i < 2; i++) ship('fighter', pirates.id, orbit(x, y, 300 + r() * 200, 170));
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

    return { at, units };
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
    } else if (m.type === 'route') {
      // Out and back with an ease at each end.
      const len = Math.hypot(m.bx - m.ax, m.by - m.ay) || 1;
      const u = ((t * m.speed) / len + m.phase) % 2;
      const s = u < 1 ? u : 2 - u;
      const k = s * s * (3 - 2 * s);
      e.x = lerp(m.ax, m.bx, k);
      e.y = lerp(m.ay, m.by, k);
      e.a = Math.atan2(m.by - m.ay, m.bx - m.ax) + (u < 1 ? 0 : Math.PI);
      e.thrust = 0.25 + 0.5 * (1 - Math.abs(2 * s - 1));
    } else {
      e.a = m.angle + 0.03 * Math.sin(t * 0.3);
      e.thrust = 0;
    }
  }

  return { create, pose };
})();
