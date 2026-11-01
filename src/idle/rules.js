// The idle game's rules (notes/idle.md): one seeded system (world/galaxy.js) with nothing built in
// it. Its bodies are charted one survey at a time; stations are built in orbit round charted bodies,
// one after another (rules/restoration.js over Config.BUILDS); drills pull raw goods from charted
// bodies; production orders run at the stations, shuttles carry goods between them (rules/industry.js
// over Config.RECIPES), and the stations' markets buy (rules/economy.js). Everything runs on the real
// clock through Industry's settle and the survey's end time, so time away comes out the same as time
// watched.
//
// Bodies are drill sites as far as Industry is concerned: the asteroid field, each planet and each
// moon has a stock (key `site:<kind><id>`, type 'site', process 'extract'), and a drill is an order
// there running extract.<good>, a recipe with no inputs that stops while the site's stock is full. A
// site takes as many orders as it has drills (env slotsAt). A station is where its body is: travel
// times between them come from the bodies' places in the system.
//
// Manual, then automated (notes/idle.md): a site's goods go to the nearest station that uses them
// (the waystation if none does), and a station's to the waystation, but only by hand at first: the
// player sends a hauler (sendHaul), which takes what's there and arrives after the trip. A shuttle
// bought for the link (buyShuttle; free with Haulage research, which also gives new links theirs)
// carries it from then on. Orders at a station run a batch and wait to be run again (rerun) until a
// foreman is hired there (hireForeman); contracts are delivered by hand until the contract clerk
// (research) does it at the clock's steps; surveys are picked by hand until the probe network
// (research) starts them there.
//
// The lab (rules/lab.js over Config.PACKAGES) researches blueprints, mods, industry, logistics and
// extraction, paid from the credits and the waystation's stock; a package can be queued once the
// station type of its category is built. What's done adds to every order's speed, every station's
// room and orders, the drills' speed, the lab queue, and the routes and haulers the transport hub
// runs, each from the moment it finished (so time away comes out the same however it's settled).
// The transport hub runs routes: two stops, chosen goods carried from one place to another. The
// salvage yard's wreck field turns out salvaged components (orders with no inputs, like drills) for
// its recycler.
//
// Contracts: a new set every day (UTC), seeded from the system and the day, asking for some of one
// item the stations built (or the next to build) can make, and paying its price × a bonus when
// delivered from the waystation's stock. Auto-sell (Trade research): at every Config.AUTO_SELL.step
// of the clock, the waystation sells the goods picked for it while their price holds; the steps are
// fixed to the clock, so time away comes out the same however it's settled.
//
//   IdleRules.industry, IdleRules.builds, IdleRules.lab   the Industry, Restoration and Lab instances
//   IdleRules.world(seed, layout = 1) -> w   { seed, layout, galaxy, star, stations: [station], sites: [site], byKey: Map, waystation }
//     station: { key, name, type, kind: 'station', build (its Config.BUILDS id), code, culture, seed, size, src (the galaxy's) }
//     site:    { key, name, kind: 'field' | 'planet' | 'moon', type: 'site', x, y, goods: [kind], body (planet/moon) | null,
//                parent (a moon's planet key) | null, ring (planets and the field: their orbit's place from the star, 0 first) }
//   IdleRules.LAYOUT                  the layout new saves get (world)
//   IdleRules.empty(w, now) -> state  { version, seed, layout, credits, industry, built: [build id], hosts: { [station key]: site key },
//                                       charted: [site key], survey: { key, at, end } | null, finds: { [site key]: credits },
//                                       drills: { [site key]: n }, economy, lab, contracts: { day, list: [contract] },
//                                       autoSell: [kind], soldAt (the last auto-sell step settled to),
//                                       sales: { ['<station key>|<kind>']: { n, at } } (gear sold lately), seen,
//                                       earned (credits made in this system: sales, contracts, finds), legacy,
//                                       hauls: [haul], foremen: [build id], keep: [contract id] (the clerk leaves them),
//                                       autoSurvey (the probes on) }
//     haul: { from, to (keys), load: { [kind]: n }, at, end }   a hauler sent by hand, arriving at end
//     contract: { id, kind, n, reward (before research's bonus), from (a faction's name), done }
//   IdleRules.env(state) -> Industry env   with research's speed, room, order slots and drill rate
//   IdleRules.bonusAt(state, t, key) -> n   a research bonus from what was done by t ('speed', 'storage',
//                                       'bays', 'queue', 'routes', 'haulers', 'drill', 'contracts',
//                                       'contractBonus', 'auto', 'autoFloor')
//   IdleRules.known(state) -> Set     the recipes known (Recipes.known, and every drill's)
//   IdleRules.researchStatus(state, w, id) -> Lab status, + away: the station type to build first
//   IdleRules.research(state, w, id, now) -> bool   paid and queued (or started)
//   IdleRules.cancelResearch(state, w, id, now) -> [id]   refunded into the credits and the waystation
//   IdleRules.online(state, w, key) -> bool   a station built, a site charted
//   IdleRules.charted(state, key), surveyable(state, w, key) -> bool   (a moon once its planet is charted)
//   IdleRules.surveyCost(state) -> credits, surveyTime(state, w, key) -> ms
//   IdleRules.survey(state, w, key, now) -> bool   start one (one at a time)
//   IdleRules.findAt(w, key) -> credits   what surveying that body turns up (0: nothing)
//   IdleRules.hostOf(state, key) -> site key | null, berths(state, w, siteKey) -> { total, used, free }
//   IdleRules.posOf(state, w, key) -> { x, y }   where a site or a built station is (world units)
//   IdleRules.nextBuild(state) -> build | null, buildStatus(state, w, id)   Restoration.status, paid at the waystation
//   IdleRules.build(state, w, id, siteKey, now) -> bool
//   IdleRules.stationOf(w, buildId) -> station
//   IdleRules.drillCost(state, site) -> credits
//   IdleRules.buyDrill(state, w, siteKey, good, now) -> bool   (once the waystation is built)
//   IdleRules.setDrill(state, w, orderId, good, now) -> bool   what an existing drill pulls
//   IdleRules.recipesAt(state, w, key) -> [recipe]   the orders a station (or site) can take
//   IdleRules.place(state, w, key, recipe, now) -> order | null, cancel(state, w, orderId) -> bool (not drills)
//   IdleRules.pause(state, w, id, paused, now), raise(state, w, id, now) (ahead of the order before it
//     at its station), change(state, w, id, recipe, now) -> bool
//   IdleRules.lineage(state, w, orderId) -> Industry.lineage of its inputs
//   IdleRules.routeLimit(state), haulerLimit(state) -> n, routes(state) -> [route] (not shuttles)
//   IdleRules.canRoute(state, w) -> bool   the hub built, and a route to spare
//   IdleRules.addRoute(state, w, fromKey, toKey, kinds, now) -> route | null   (one between the same two places
//     is replaced, carrying both's goods), removeRoute(state, w, id) -> bool, carries(route) -> [kind]
//   IdleRules.fixes(state, w) -> [fix]   what would mend the chain (Industry.pipelines):
//     { kind: 'route', from, to, good } | { kind: 'shuttle', from, to, good }: a good made at one place
//       and used at another that nothing carries;
//     { kind: 'order', key, recipe, good, for }: an input no order makes, and a station that can;
//     { kind: 'build', type, good, for }: an input no built station can make
//   IdleRules.setShuttle(state, w, fromKey, toKey, now) -> route | null   (unpaid: buyShuttle pays for a new one)
//   IdleRules.haulTarget(state, w, key) -> station | null   where a place's goods go; haulable(state, key) -> counts
//   IdleRules.haulOf(state, key) -> haul | null, canHaul(state, w, key) -> bool, sendHaul(state, w, key, now) -> haul | null
//   IdleRules.haulage(state, t?) -> bool, shuttleCost(state) -> credits, buyShuttle(state, w, key, now, toKey?) -> route | null
//   IdleRules.batchOf(state, w, key, recipe) -> runs | null   an order's batch there (null: it goes on)
//   IdleRules.rerun(state, w, orderId, now) -> bool   a finished batch, again
//   IdleRules.hasForeman(state, w, key) -> bool, foremanStatus(state, w, buildId) -> { id: 'locked' | 'done' | 'short' | 'ready',
//     ok, credits, goods, short: [{ kind, need, have }] }, hireForeman(state, w, buildId, now) -> bool
//   IdleRules.hasClerk(state, t?), hasProbes(state, t?) -> bool; setKeep(state, contractId, on), setAutoSurvey(state, on) -> bool
//   IdleRules.priceOf(state, w, stKey, kind, now) -> credits | null   what that station pays for one
//   IdleRules.sell(state, w, stKey, kind, n, now) -> { sold, credits }
//   IdleRules.contracts(state) -> [contract] today's; contractSlots(state), contractPay(state, c) -> credits
//   IdleRules.canDeliver(state, w, id) -> bool, deliver(state, w, id, now) -> credits | 0   from the waystation
//   IdleRules.canAuto(state) -> bool (researched), autoFloor(state) -> share, setAuto(state, kind, on) -> bool
//   IdleRules.settle(state, w, now, max?) -> { log, truncated, charted: [{ key, find }], researched: [id],
//     sold: { [kind]: { n, credits } } (auto-sold), delivered: [{ id, kind, n, credits }] (by the clerk) }
//     log: Industry's, plus a hauler sent by hand arriving: { haul (where from), key, name, at, delivered }
//   IdleRules.legacy(state) -> { jumps, points, systems: [{ seed, name, points, built, at }] }   kept from
//     the systems left before (new systems: prestige); legacyBonus(state, 'speed' | 'pay') -> share added
//   IdleRules.canJump(state) -> bool (every station built), jumpPoints(state) -> n   what leaving now earns
//   IdleRules.nextSeed(state) -> seed   the next system's
//   IdleRules.jump(state, w, now) -> { state, w } | null   a new system (rolled from nextSeed), nothing built,
//     the legacy carried over with this one added to it
//   IdleRules.read(data) -> state | null   a saved state, checked lightly
// ES module (`IdleRules`); also runs in Node (the tests).

import { hashInt, mulberry32, seedToInt } from '../core/rng.js';
import { Economy } from '../rules/economy.js';
import { Goods } from '../rules/goods.js';
import { Hazards } from '../rules/hazards.js';
import { Industry } from '../rules/industry.js';
import { Lab } from '../rules/lab.js';
import { Logistics } from '../rules/logistics.js';
import { Recipes } from '../rules/recipes.js';
import { Research } from '../rules/research.js';
import { Restoration } from '../rules/restoration.js';
import { Factions } from '../world/factions.js';
import { Galaxy } from '../world/galaxy.js';
import { Config } from './config.js';

const IdleRules = (() => {
  const VERSION = 7;
  const industry = Industry.create({ recipes: Config.RECIPES, process: Config.PROCESS, storage: { base: Config.STATION_STORAGE }, slots: Config.STATION_SLOTS });
  const builds = Restoration.create({ list: Config.BUILDS, online: [] });
  const P = Config.PACKAGES;
  // What's done adds from the moment it finished.
  const bonusOf = (labState, t, key) => labState.done.reduce((n, id) => n + ((labState.doneAt?.[id] ?? 0) <= t ? P[id]?.industry?.[key] || 0 : 0), 0);
  const bonusAt = (state, t, key) => bonusOf(state.lab, t, key);
  // Legacy (new systems): kept from the systems left before, the same from start to end of this one.
  const noLegacy = () => ({ jumps: 0, points: 0, systems: [] });
  const legacy = (state) => state.legacy;
  const legacyBonus = (state, key) => state.legacy.points * (Config.LEGACY[key] || 0);
  const payMul = (state) => 1 + legacyBonus(state, 'pay');
  const lab = Lab.create({ packages: P, categories: Config.CATEGORIES, queueMax: (l) => Config.LAB_QUEUE + bonusOf(l, Infinity, 'queue'), config: Research.config });
  // Drills and the wreck field need no research.
  const DRILLS = Object.keys(Config.RECIPES).filter((id) => id.startsWith('extract.') || id.startsWith('salvage.'));
  const known = (state) => new Set([...Recipes.known(state.lab.done).values(), ...DRILLS]);
  const isSite = (key) => key.startsWith('site:');
  const uniq = (a) => [...new Set(a)];

  // Layout 1 is the galaxy's own system: one planet of each type and one moon of each, the same
  // bodies for every seed. Layout 2 (new saves) rolls the system's make-up from the seed: 5 to 7
  // planets of types picked with repeats (hot ones inside, giants outside) and their moons, rolled
  // again until every raw good the chain needs is on some body and every station has its place.
  const LAYOUT = 2;
  const PLANET_TYPES = ['lava', 'desert', 'terran', 'ice', 'gas', 'blue'];
  const MOON_TYPES = ['grey', 'ice', 'rust', 'dark', 'sulfur'];
  const MOONS = { gas: [0, 3], blue: [0, 2], terran: [0, 1], ice: [0, 1], desert: [0, 1], lava: [0, 0] };
  const NEEDED = ['iron', 'silicates', 'deuterium', 'titanium-ore', 'tungsten', 'rare-earths', 'sulfur'];
  function makeup(seed, attempt) {
    const r = mulberry32(hashInt(seedToInt(seed), attempt, 0x1a7));
    const n = 5 + Math.floor(r() * 3);
    const planets = Array.from({ length: n }, () => PLANET_TYPES[Math.floor(r() * PLANET_TYPES.length)])
      .sort((a, b) => PLANET_TYPES.indexOf(a) - PLANET_TYPES.indexOf(b));
    const moons = [...MOON_TYPES, ...MOON_TYPES.map(() => MOON_TYPES[Math.floor(r() * MOON_TYPES.length)])];
    for (let i = moons.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [moons[i], moons[j]] = [moons[j], moons[i]]; }
    const counts = Object.fromEntries(Object.entries(MOONS).map(([k, [a, b]]) => { const c = a + Math.floor(r() * (b - a + 1)); return [k, [c, c]]; }));
    return { galaxy: { system: { kinds: { planets, moons }, moons: counts } } };
  }
  function world(seed, layout = 1) {
    if (layout >= 2) {
      for (let attempt = 0; attempt < 40; attempt++) {
        const w = layoutOf(seed, Galaxy.generate(seed, makeup(seed, attempt)), layout);
        const goods = new Set(w.sites.flatMap((x) => x.goods));
        if (w.stations.length === Config.BUILDS.length && w.waystation && NEEDED.every((g) => goods.has(g))) return w;
      }
    }
    return layoutOf(seed, Galaxy.generate(seed), 1);
  }
  function layoutOf(seed, galaxy, layout) {
    const star = galaxy.stars[0];
    const byType = new Map(Config.BUILDS.map((b) => [b.type, b]));
    const stations = galaxy.stations.filter((s) => byType.has(s.market.type)).map((s) => {
      const b = byType.get(s.market.type);
      return { key: s.key, name: s.name, type: s.market.type, kind: 'station', build: b.id, code: b.code, culture: s.culture, seed: s.seed, size: s.size, src: s };
    });
    const sites = [];
    for (const f of galaxy.fields) sites.push({ key: `site:field${f.id}`, name: f.name, kind: 'field', type: 'site', x: f.x, y: f.y, goods: ['iron', 'silicates'], body: null, parent: null, field: f });
    for (const p of galaxy.planets) {
      const goods = uniq(Hazards.surface('planet', p.type, p.seed).deposits.map(([k]) => k));
      sites.push({ key: `site:planet${p.id}`, name: p.name, kind: 'planet', type: 'site', x: p.x, y: p.y, goods, body: p, parent: null });
    }
    for (const m of galaxy.moons) {
      const parentType = galaxy.planets[m.parent]?.type;
      const goods = uniq(Hazards.surface('moon', m.type, m.seed, parentType).deposits.map(([k]) => k));
      sites.push({ key: `site:moon${m.id}`, name: m.name, kind: 'moon', type: 'site', x: m.x, y: m.y, goods, body: m, parent: `site:planet${m.parent}`, parentType });
    }
    // The orbits, inner to outer: the planets' and the field's.
    const fromStar = (s) => Math.hypot(s.x - star.x, s.y - star.y);
    sites.filter((s) => s.kind !== 'moon').sort((a, b) => fromStar(a) - fromStar(b)).forEach((s, i) => { s.ring = i; });
    const byKey = new Map([...stations, ...sites].map((x) => [x.key, x]));
    return { seed, layout, galaxy, star, stations, sites, byKey, rings: sites.filter((s) => s.kind !== 'moon').length, waystation: stations.find((s) => s.type === 'waystation') };
  }

  function env(state) {
    return {
      recipe: (id) => Config.RECIPES[id],
      speed: (t) => 1 + bonusAt(state, t, 'speed') + legacyBonus(state, 'speed'),
      room: (t) => bonusAt(state, t, 'storage'),
      slots: () => bonusAt(state, Infinity, 'bays'),
      slotsAt: (key) => (isSite(key) ? state.drills[key] || 0 : Config.STATION_SLOTS + bonusAt(state, Infinity, 'bays')),
      // A site holds SITE_STORAGE, whatever the racks researched add to the stations.
      roomAt: (key, t) => (isSite(key) ? Config.SITE_STORAGE - Config.STATION_STORAGE - bonusAt(state, t, 'storage') : 0),
      rate: (id, t) => (id.startsWith('extract.') ? 1 + bonusAt(state, t, 'drill') : 1),
    };
  }

  // ---------- Charting ----------

  const charted = (state, key) => state.charted.includes(key);
  function surveyable(state, w, key) {
    const s = w.byKey.get(key);
    return !!s && s.kind !== 'station' && !charted(state, key) && (!s.parent || charted(state, s.parent));
  }
  const surveysDone = (state) => Math.max(0, state.charted.length - 1); // the field is charted from the start
  const surveyCost = (state) => Math.round((Config.SURVEY.credits * Config.SURVEY.growth ** surveysDone(state)) / 10) * 10;
  function surveyTime(state, w, key) {
    const s = w.byKey.get(key);
    const near = Math.min(...state.charted.map((k) => dist(w.byKey.get(k), s)));
    return Math.round((Config.SURVEY.secs + Config.SURVEY.perUnit * near) * 1000);
  }
  function survey(state, w, key, now) {
    if (state.survey || !surveyable(state, w, key)) return false;
    const cost = surveyCost(state);
    if (state.credits < cost) return false;
    state.credits -= cost;
    state.survey = { key, at: now, end: now + surveyTime(state, w, key) };
    return true;
  }
  // Seeded per body: whether its survey turns up a derelict, and what it's worth.
  function findAt(w, key) {
    const s = w.byKey.get(key);
    if (!s || s.kind === 'field') return 0;
    const r = mulberry32(hashInt(seedToInt(w.seed), seedToInt(key), 0xf1d));
    if (r() >= Config.SURVEY.find) return 0;
    const [a, b] = Config.SURVEY.findCredits, ring = s.ring ?? w.byKey.get(s.parent)?.ring ?? 0;
    return Math.round(((a + r() * (b - a)) * (1 + ring / 2)) / 10) * 10;
  }
  function chartDue(state, w, now) {
    const sv = state.survey;
    if (!sv || now < sv.end) return [];
    state.survey = null;
    if (charted(state, sv.key)) return [];
    state.charted.push(sv.key);
    const find = findAt(w, sv.key);
    if (find) { state.finds[sv.key] = find; state.credits += find; state.earned += find; }
    return [{ key: sv.key, find }];
  }

  // ---------- Places ----------

  const online = (state, w, key) => {
    const x = w.byKey.get(key);
    if (!x) return false;
    return x.kind === 'station' ? builds.online(x.type, state.built) : charted(state, key);
  };
  const hostOf = (state, key) => state.hosts[key] || null;
  function posOf(state, w, key) {
    const x = w.byKey.get(key);
    if (!x) return null;
    if (x.kind !== 'station') return { x: x.x, y: x.y };
    const h = hostOf(state, key);
    return h ? { x: w.byKey.get(h).x, y: w.byKey.get(h).y } : { x: x.src.x, y: x.src.y };
  }
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const travel = (state, w, a, b) => Logistics.legTime(dist(posOf(state, w, a), posOf(state, w, b)), Config.HAULER_SPEED);
  const ref = (x) => ({ key: x.key, name: x.name, type: x.type });
  function berths(state, w, siteKey) {
    const s = w.byKey.get(siteKey), total = s ? Config.BERTHS[s.kind] || 0 : 0;
    const used = Object.values(state.hosts).filter((h) => h === siteKey).length;
    return { total, used, free: Math.max(0, total - used) };
  }
  const stationOf = (w, buildId) => w.stations.find((s) => s.build === buildId) || null;

  function setShuttle(state, w, fromKey, toKey, now) {
    const from = w.byKey.get(fromKey), to = toKey ? w.byKey.get(toKey) : null;
    if (!from || !online(state, w, fromKey) || (to && (to.kind !== 'station' || !online(state, w, toKey) || to === from))) return null;
    return industry.setShuttle(state.industry, ref(from), to ? ref(to) : null, to ? travel(state, w, fromKey, toKey) : 0, env(state), now);
  }

  // Where a site's goods go: the nearest station with a process that uses one of them, else the
  // waystation; null before the waystation is built.
  const uses = (st, goods) => industry.processes(st.type).some((bay) => Object.values(Config.RECIPES).some((R) => R.bay === bay && goods.some((g) => g in R.in)));
  function shuttleTarget(state, w, site) {
    const at = w.stations.filter((st) => online(state, w, st.key) && uses(st, site.goods))
      .sort((a, b) => dist(posOf(state, w, a.key), site) - dist(posOf(state, w, b.key), site));
    return at[0] || (online(state, w, w.waystation.key) ? w.waystation : null);
  }

  function empty(w, now) {
    const field = w.sites.find((s) => s.kind === 'field');
    return {
      version: VERSION, seed: w.seed, layout: w.layout, credits: Config.START_CREDITS, industry: industry.empty(), built: [], hosts: {},
      charted: field ? [field.key] : [], survey: null, finds: {}, drills: {}, economy: Economy.empty(), lab: lab.empty(),
      contracts: { day: null, list: [] }, autoSell: [], soldAt: now, sales: {}, seen: now, earned: 0, legacy: noLegacy(),
      hauls: [], foremen: [], keep: [], autoSurvey: true,
    };
  }

  // ---------- Building ----------

  const nextBuild = (state) => builds.LIST.find((b) => !state.built.includes(b.id)) || null;
  const wayStock = (state, w) => (online(state, w, w.waystation.key) ? industry.stockAt(state.industry, w.waystation.key) : {});
  const buildStatus = (state, w, id) => builds.status(id, state.built, wayStock(state, w), state.credits);

  function build(state, w, id, siteKey, now) {
    const b = builds.PROJECTS[id], st = b && stationOf(w, id), site = w.byKey.get(siteKey);
    if (!st || !site || site.kind === 'station' || !charted(state, siteKey) || !berths(state, w, siteKey).free) return false;
    const r = builds.restore(id, state.built, wayStock(state, w), state.credits);
    if (!r) return false;
    for (const [kind, n] of Object.entries(r.take)) industry.withdraw(state.industry, w.waystation.key, kind, n);
    state.credits -= r.credits;
    state.built.push(id);
    state.hosts[st.key] = siteKey;
    if (b.shuttle && st !== w.waystation && haulage(state, now)) setShuttle(state, w, st.key, w.waystation.key, now);
    // The ore works starts on steel pipe.
    if (st.type === 'mining camp') industry.place(state.industry, ref(st), 'make.steel-pipe', batchOf(state, w, st.key, 'make.steel-pipe'), env(state), now);
    // Drill sites whose shuttle sends to the waystation (or that have none, with Haulage done) send
    // to this station instead if it uses what they pull. Hauling by hand goes there too (haulTarget).
    for (const s of w.sites) {
      if (!state.drills[s.key]) continue;
      const r0 = industry.shuttle(state.industry, s.key), to = r0 ? r0.stops[1].station : null;
      if (to && to !== w.waystation.key) continue;
      if (!to && !haulage(state, now)) continue;
      const target = shuttleTarget(state, w, s);
      if (target && target.key !== to) setShuttle(state, w, s.key, target.key, now);
    }
    industry.kick(state.industry, env(state), now);
    return true;
  }

  // ---------- Drills ----------

  function drillCost(state, site) {
    const n = state.drills[site.key] || 0;
    if (site.kind === 'field' && n < Config.DRILL.free) return 0;
    const base = site.kind === 'field' ? Config.DRILL.base.field : Math.max(...site.goods.map((g) => Config.DRILL.base.surface[Goods.type(g)?.rarity || 1]));
    return Math.round((base * Config.DRILL.growth ** n) / 10) * 10;
  }

  function buyDrill(state, w, siteKey, good, now) {
    const site = w.byKey.get(siteKey);
    if (!site || site.kind === 'station' || !charted(state, siteKey) || !site.goods.includes(good)) return false;
    const target = shuttleTarget(state, w, site), cost = drillCost(state, site);
    if (!target || state.credits < cost) return false;
    state.credits -= cost;
    state.drills[siteKey] = (state.drills[siteKey] || 0) + 1;
    industry.place(state.industry, ref(site), `extract.${good}`, null, env(state), now);
    if (!industry.shuttle(state.industry, siteKey) && haulage(state, now)) setShuttle(state, w, siteKey, target.key, now);
    return true;
  }

  function setDrill(state, w, orderId, good, now) {
    const o = state.industry.orders.find((x) => x.id === orderId), site = o && w.byKey.get(o.station);
    if (!site || site.kind === 'station' || !site.goods.includes(good)) return false;
    return industry.change(state.industry, orderId, `extract.${good}`, null, env(state), now);
  }

  // ---------- Orders ----------

  function recipesAt(state, w, key) {
    const x = w.byKey.get(key);
    if (!x || !online(state, w, key)) return [];
    if (x.kind !== 'station') return x.goods.map((g) => Config.RECIPES[`extract.${g}`]);
    const k = known(state);
    return Object.values(Config.RECIPES).filter((R) => k.has(R.id) && industry.canMake(x.type, R.id));
  }

  function place(state, w, key, recipe, now) {
    const x = w.byKey.get(key);
    if (!x || x.kind !== 'station' || !online(state, w, key) || !known(state).has(recipe)) return null;
    return industry.place(state.industry, ref(x), recipe, batchOf(state, w, key, recipe), env(state), now);
  }
  const orderOf = (state, id) => state.industry.orders.find((x) => x.id === id) || null;
  function cancel(state, w, id) {
    const o = orderOf(state, id);
    if (!o || isSite(o.station)) return false;
    return industry.cancel(state.industry, id);
  }
  const pause = (state, w, id, paused, now) => !!orderOf(state, id) && industry.pause(state.industry, id, paused, env(state), now);
  // Ahead of the order before it at the same station: it gets inputs first when both want them.
  function raise(state, w, id, now) {
    const list = state.industry.orders, o = orderOf(state, id);
    if (!o) return false;
    const i = list.indexOf(o);
    let j = i - 1;
    while (j >= 0 && list[j].station !== o.station) j--;
    if (j < 0 || !industry.move(state.industry, i, j)) return false;
    industry.kick(state.industry, env(state), now);
    return true;
  }
  function change(state, w, id, recipe, now) {
    const o = orderOf(state, id);
    if (!o || isSite(o.station) || o.recipe === recipe || !known(state).has(recipe)) return false;
    return industry.change(state.industry, id, recipe, batchOf(state, w, o.station, recipe), env(state), now);
  }
  function lineage(state, w, id) {
    const o = orderOf(state, id);
    return o ? industry.lineage(state.industry, o.recipe, known(state), o.station) : [];
  }

  // ---------- Batches and foremen ----------

  // Without a foreman, an order at a station runs a batch (about FOREMAN.batch of work) and waits to
  // be run again; with one, it goes on while its inputs last. Drills and the wreck field have no
  // batches: buying them is already the automation.
  const hasForeman = (state, w, key) => { const x = w.byKey.get(key); return !!x && x.kind === 'station' && state.foremen.includes(x.build); };
  function batchOf(state, w, key, recipe) {
    const R = Config.RECIPES[recipe];
    if (!R || isSite(key) || R.bay === 'salvage' || hasForeman(state, w, key)) return null;
    return Math.max(Config.FOREMAN.minRuns, Math.round(Config.FOREMAN.batch / (R.time * 1000)));
  }
  // A finished batch, run again.
  function rerun(state, w, id, now) {
    const o = orderOf(state, id);
    if (!o || isSite(o.station) || o.left !== 0) return false;
    return industry.change(state.industry, id, o.recipe, batchOf(state, w, o.station, o.recipe), env(state), now);
  }
  // What a station's foreman costs, and whether it can be paid: { id: 'locked' | 'done' | 'short' | 'ready', ok, credits, goods, short: [{ kind, need, have }] }.
  function foremanStatus(state, w, buildId) {
    const c = Config.FOREMAN.cost[buildId];
    if (!c || !state.built.includes(buildId)) return { id: 'locked', ok: false, credits: 0, goods: {}, short: [] };
    const { credits = 0, ...goods } = c;
    if (state.foremen.includes(buildId)) return { id: 'done', ok: false, credits, goods, short: [] };
    const have = wayStock(state, w);
    const short = Object.entries(goods).filter(([k, n]) => (have[k] || 0) < n).map(([kind, need]) => ({ kind, need, have: have[kind] || 0 }));
    const ok = !short.length && state.credits >= credits;
    return { id: ok ? 'ready' : 'short', ok, credits, goods, short };
  }
  function hireForeman(state, w, buildId, now) {
    const f = foremanStatus(state, w, buildId);
    if (!f.ok) return false;
    state.credits -= f.credits;
    for (const [kind, n] of Object.entries(f.goods)) industry.withdraw(state.industry, w.waystation.key, kind, n);
    state.foremen.push(buildId);
    // Its station's orders go on from now: a finished batch starts again.
    for (const o of industry.at(state.industry, stationOf(w, buildId).key)) o.left = null;
    industry.kick(state.industry, env(state), now);
    return true;
  }

  // ---------- Hauling: by hand, then shuttles ----------

  // A link is carried on its own once its shuttle is bought (Config.SHUTTLE; free with Haulage,
  // which also gives new stations and drill sites theirs). Until then the player sends a hauler by
  // hand: it takes what's there (up to HAUL.cap) and arrives after the trip, settled at that moment.
  const haulage = (state, t = Infinity) => bonusAt(state, t, 'haulage') > 0;
  const shuttleCount = (state) => state.industry.routes.filter((r) => r.shuttle).length;
  const shuttleCost = (state) => (haulage(state) ? 0 : Math.round((Config.SHUTTLE.base * Config.SHUTTLE.growth ** shuttleCount(state)) / 10) * 10);
  // Where a place's goods go: a site's to the nearest station that uses them (shuttleTarget); a
  // station's that sends by shuttle (Config.BUILDS) to the waystation; null for anywhere else.
  function haulTarget(state, w, key) {
    const x = w.byKey.get(key);
    if (!x || !online(state, w, key)) return null;
    if (x.kind !== 'station') return shuttleTarget(state, w, x);
    return builds.PROJECTS[x.build]?.shuttle && x !== w.waystation && online(state, w, w.waystation.key) ? w.waystation : null;
  }
  // What a hauler takes: all of a site's stock, and what a station's orders make.
  function haulable(state, key) {
    const stock = industry.stockAt(state.industry, key);
    const made = isSite(key) ? null : new Set(industry.at(state.industry, key).flatMap((o) => Object.keys(Config.RECIPES[o.recipe]?.out || {})));
    return Object.fromEntries(Object.entries(stock).filter(([k, n]) => n > 0 && (!made || made.has(k))).sort(([a], [b]) => (a < b ? -1 : 1)));
  }
  const haulOf = (state, key) => state.hauls.find((h) => h.from === key) || null;
  function canHaul(state, w, key) {
    return !haulOf(state, key) && !!haulTarget(state, w, key) && Object.keys(haulable(state, key)).length > 0;
  }
  function sendHaul(state, w, key, now) {
    if (!canHaul(state, w, key)) return null;
    const to = haulTarget(state, w, key), load = {};
    let room = Config.HAUL.cap;
    for (const [kind, n] of Object.entries(haulable(state, key))) {
      if (room <= 0) break;
      const k = industry.withdraw(state.industry, key, kind, Math.min(n, room));
      if (k > 0) { load[kind] = k; room -= k; }
    }
    const h = { from: key, to: to.key, load, at: now, end: now + travel(state, w, key, to.key) };
    state.hauls.push(h);
    industry.kick(state.industry, env(state), now); // room freed: a full drill site goes on
    return h;
  }
  // A hauler sent by hand arrives: what fits goes into the stock there, the rest back where it came
  // from. Its log line is a delivery, like a shuttle's.
  function arrive(state, w, h) {
    const e = env(state), delivered = {};
    for (const [kind, n] of Object.entries(h.load)) {
      const k = industry.deposit(state.industry, h.to, kind, n, e, h.end);
      if (k > 0) delivered[kind] = k;
      if (n > k) industry.deposit(state.industry, h.from, kind, n - k, e, h.end);
    }
    state.hauls = state.hauls.filter((x) => x !== h);
    return { haul: h.from, key: h.to, name: w.byKey.get(h.to)?.name || h.to, at: h.end, delivered };
  }
  // A shuttle for a link that has none: paid, then running to `toKey` (by default where its goods go).
  function buyShuttle(state, w, key, now, toKey = null) {
    const to = toKey ? w.byKey.get(toKey) : haulTarget(state, w, key), cost = shuttleCost(state);
    if (!to || industry.shuttle(state.industry, key) || state.credits < cost) return null;
    const r = setShuttle(state, w, key, to.key, now);
    if (r) state.credits -= cost;
    return r;
  }

  // ---------- Routes (the transport hub) ----------

  const hubOnline = (state) => builds.online('transport hub', state.built);
  const routeLimit = (state) => Config.ROUTES.routes + bonusAt(state, Infinity, 'routes');
  const haulerLimit = (state) => Config.ROUTES.haulers + bonusAt(state, Infinity, 'haulers');
  const routes = (state) => state.industry.routes.filter((r) => !r.shuttle);
  const canRoute = (state) => hubOnline(state) && routes(state).length < routeLimit(state);
  const routeOf = (state, fromKey, toKey) => routes(state).find((r) => r.stops[0].station === fromKey && r.stops[1].station === toKey) || null;
  // Goods a route carries (its first stop's load).
  const carries = (r) => Object.keys(r.stops[0].load || {});
  // A route between the same two places as one already there takes its place, carrying both's goods.
  function addRoute(state, w, fromKey, toKey, kinds, now) {
    const from = w.byKey.get(fromKey), to = w.byKey.get(toKey), old = routeOf(state, fromKey, toKey);
    if (!hubOnline(state) || (!old && !canRoute(state)) || !from || !to || from === to || to.kind !== 'station' || !online(state, w, fromKey) || !online(state, w, toKey)) return null;
    const list = [...new Set([...(old ? carries(old) : []), ...kinds])].filter((k) => Recipes.item(k));
    if (!list.length) return null;
    if (old) industry.removeRoute(state.industry, old.id);
    const t = travel(state, w, fromKey, toKey);
    return industry.addRoute(state.industry, [
      { station: from.key, name: from.name, load: Object.fromEntries(list.map((k) => [k, 'all'])), travel: t },
      { station: to.key, name: to.name, unload: 'all', travel: t },
    ], { name: `${from.name} → ${to.name}`, haulers: haulerLimit(state) }, env(state), now);
  }
  function removeRoute(state, w, id) {
    const r = state.industry.routes.find((x) => x.id === id);
    return !!r && !r.shuttle && industry.removeRoute(state.industry, id);
  }

  // ---------- The chain ----------

  function fixes(state, w) {
    const out = [], seen = new Set(), orders = state.industry.orders, by = (id) => orders.find((o) => o.id === id);
    const push = (f) => { const id = JSON.stringify(f); if (!seen.has(id)) { seen.add(id); out.push(f); } };
    for (const g of industry.pipelines(state.industry)) {
      for (const l of g.links) {
        if (!l.away || l.routed) continue;
        const a = by(l.from), b = by(l.to);
        // A site's goods go by its shuttle; a station's by a route if the hub has one to spare.
        const kind = !isSite(a.station) && (canRoute(state) || (hubOnline(state) && routeOf(state, a.station, b.station))) ? 'route' : 'shuttle';
        push({ kind, from: a.station, to: b.station, good: l.kind });
      }
      for (const gap of g.gaps) {
        const o = by(gap.order), R = industry.recipeFor(gap.kind, known(state));
        const st = R && w.stations.find((x) => online(state, w, x.key) && industry.canMake(x.type, R.id));
        if (st) push({ kind: 'order', key: st.key, recipe: R.id, good: gap.kind, for: o.station });
        else push({ kind: 'build', type: Object.entries(Config.PROCESS).find(([, ps]) => ps.includes(gap.stage))?.[0] || null, good: gap.kind, for: o.station });
      }
    }
    return out;
  }

  // ---------- Research ----------

  const wayHave = (state, w) => { const s = wayStock(state, w); return (kind) => s[kind] || 0; };
  const stationTypeOf = (id) => Config.CATEGORIES.find((c) => c.id === P[id]?.cat)?.station || 'waystation';
  function researchStatus(state, w, id) {
    const st = lab.status(id, state.lab, state.credits, wayHave(state, w)), where = stationTypeOf(id);
    return st.state === 'available' && !builds.online(where, state.built) ? { ...st, ok: false, away: where } : st;
  }
  function research(state, w, id, now) {
    const st = researchStatus(state, w, id);
    if (!st.ok || !lab.enqueue(state.lab, id, now)) return false;
    state.credits -= st.credits;
    for (const { kind, need } of st.cost) industry.withdraw(state.industry, w.waystation.key, kind, need);
    industry.kick(state.industry, env(state), now);
    return true;
  }
  // Refunds go back where they were paid from: goods into the waystation's stock, as far as it has room.
  function cancelResearch(state, w, id, now) {
    const out = lab.cancel(state.lab, id, now);
    for (const { id: x, refund } of out) {
      for (const [kind, n] of Object.entries(P[x].cost)) {
        const back = Math.floor(n * refund);
        if (kind === 'credits') state.credits += back;
        else if (back > 0) industry.deposit(state.industry, w.waystation.key, kind, back, env(state), now);
      }
    }
    return out.map((x) => x.id);
  }

  // ---------- Selling ----------

  // Trade goods sell at the station's market price (falling as it fills), and gear, consumables and
  // salvage at a share of their price; either way that halves with every `soft` of it sold there
  // lately (what was sold counts for half every halfLife: Config.TRADE_MARKET for trade goods,
  // GEAR_MARKET for the rest), so neither the drills nor the bench are an endless mint.
  const traded = (kind) => !!Goods.type(kind) && !Goods.isSalvage(kind);
  const glutRule = (kind) => (traded(kind)
    ? { soft: Config.TRADE_MARKET.soft[Goods.type(kind).rarity] || Config.TRADE_MARKET.soft[1], halfLife: Config.TRADE_MARKET.halfLife }
    : Config.GEAR_MARKET);
  const glutOf = (state, stKey, kind, now) => {
    const x = state.sales[`${stKey}|${kind}`];
    return x ? x.n * 0.5 ** (Math.max(0, now - x.at) / glutRule(kind).halfLife) : 0;
  };
  function priceOf(state, w, stKey, kind, now) {
    const st = w.byKey.get(stKey);
    if (!st || st.kind !== 'station' || !online(state, w, stKey)) return null;
    const glut = 0.5 ** (glutOf(state, stKey, kind, now) / glutRule(kind).soft);
    if (traded(kind)) {
      const p = Economy.market(w.galaxy.seed, st.src, state.economy, now).goods.find((g) => g.kind === kind)?.sell;
      return p == null ? null : Math.max(1, Math.round(p * glut * payMul(state)));
    }
    const item = Recipes.item(kind);
    return item ? Math.max(1, Math.round(item.price * Config.GEAR_SALE * glut * payMul(state))) : null;
  }
  function sell(state, w, stKey, kind, n, now) {
    let sold = 0, credits = 0;
    for (; sold < n; sold++) {
      const p = priceOf(state, w, stKey, kind, now);
      if (p == null || industry.withdraw(state.industry, stKey, kind, 1) !== 1) break;
      if (traded(kind)) Economy.trade(state.economy, w.galaxy.seed, w.byKey.get(stKey).src, kind, 1, now);
      state.sales[`${stKey}|${kind}`] = { n: glutOf(state, stKey, kind, now) + 1, at: now };
      credits += p;
    }
    state.credits += credits;
    state.earned += credits;
    if (sold) industry.kick(state.industry, env(state), now); // room freed: blocked orders and haulers go on
    return { sold, credits };
  }

  // ---------- Contracts ----------

  const DAY = 86400e3;
  const dayOf = (t) => Math.floor(t / DAY);
  const contractSlots = (state, t = Infinity) => Config.CONTRACTS.slots + bonusAt(state, t, 'contracts');
  const FROM = Factions.LIST.filter((f) => !f.hidden && f.start > -50).map((f) => f.name);
  // What a contract may ask for: what the stations built, or the next to build, can make with what's
  // researched or one step on (a package whose own requirements are done), and what the drills pull.
  // Only what the player did and the research done by the day's start decide it, so a day's
  // contracts are the same however time away is settled.
  function wanted(state, w, t) {
    const types = new Set(state.built.map((id) => builds.PROJECTS[id].type));
    const next = nextBuild(state);
    if (next) types.add(next.type);
    const done = state.lab.done.filter((id) => (state.lab.doneAt?.[id] ?? 0) <= t);
    const have = Recipes.known(done), met = (r) => [r].flat().some((x) => done.includes(x));
    const near = (R) => !R.unlock || have.has(R.id) || (P[R.unlock] && P[R.unlock].requires.every(met));
    const kinds = new Set();
    for (const R of Object.values(Config.RECIPES)) {
      if (R.bay === 'extract' || R.bay === 'recycle' || !near(R)) continue;
      if ([...types].some((ty) => industry.canMake(ty, R.id))) for (const x of Object.keys(R.out)) kinds.add(x);
    }
    for (const key of Object.keys(state.drills)) for (const g of w.byKey.get(key)?.goods || []) kinds.add(g);
    return [...kinds].filter((k) => Recipes.item(k)?.price).sort();
  }
  // Stations built past the ore works, at the day's start: what a day's contracts grow with.
  const grownBy = (state) => 1 + Config.CONTRACTS.perStation * Math.max(0, state.built.length - 2);
  function rollContracts(state, w, now) {
    const day = dayOf(now);
    if (state.contracts.day === day) return;
    const r = mulberry32(hashInt(seedToInt(w.seed), day, 0xc0d)), C = Config.CONTRACTS;
    const pool = wanted(state, w, day * DAY), list = [], grow = grownBy(state);
    const price = (k) => Recipes.item(k).price;
    const slots = contractSlots(state, day * DAY), top = Math.round(slots * C.top);
    for (let i = 0; i < slots && pool.length; i++) {
      // The first `top` slots ask for one of the dearest third of what's on offer.
      const from = i < top ? [...pool].sort((a, b) => price(b) - price(a)).slice(0, Math.max(1, Math.ceil(pool.length / 3))) : pool;
      const kind = from[Math.floor(r() * from.length)], it = Recipes.item(kind);
      pool.splice(pool.indexOf(kind), 1);
      const [a, b] = C.size[it.kind] || [1, 3];
      const n = Math.max(1, Math.round((a + Math.floor(r() * (b - a + 1))) * (it.kind === 'good' || it.kind === 'component' ? grow : 1)));
      list.push({ id: `${day}.${i}`, kind, n, reward: Math.round((it.price * n * C.bonus * grow) / 10) * 10, from: FROM[Math.floor(r() * FROM.length)], done: false });
    }
    state.contracts = { day, list };
    state.keep = [];
  }
  const contracts = (state) => state.contracts.list;
  const contractPay = (state, c) => Math.round(c.reward * (1 + bonusAt(state, Infinity, 'contractBonus')) * payMul(state));
  function canDeliver(state, w, id) {
    const c = contracts(state).find((x) => x.id === id);
    return !!c && !c.done && (wayStock(state, w)[c.kind] || 0) >= c.n;
  }
  function deliver(state, w, id, now) {
    if (!canDeliver(state, w, id)) return 0;
    const c = contracts(state).find((x) => x.id === id), pay = contractPay(state, c);
    industry.withdraw(state.industry, w.waystation.key, c.kind, c.n);
    c.done = true;
    state.credits += pay;
    state.earned += pay;
    industry.kick(state.industry, env(state), now);
    return pay;
  }

  // ---------- The contract clerk ----------

  // Once researched, at every step of the clock the clerk delivers each open contract the waystation
  // can spare, keeping back what the next station needs, and skipping those the player keeps.
  const hasClerk = (state, t = Infinity) => bonusAt(state, t, 'clerk') > 0;
  function setKeep(state, id, on) {
    if (!contracts(state).some((c) => c.id === id)) return false;
    state.keep = on ? uniq([...state.keep, id]) : state.keep.filter((x) => x !== id);
    return true;
  }
  function autoDeliver(state, w, t, out) {
    const have = { ...wayStock(state, w) };
    for (const [kind, n] of Object.entries(nextBuild(state)?.goods || {})) have[kind] = (have[kind] || 0) - n;
    for (const c of contracts(state)) {
      if (c.done || state.keep.includes(c.id) || (have[c.kind] || 0) < c.n) continue;
      const credits = deliver(state, w, c.id, t);
      if (credits) { have[c.kind] -= c.n; out.push({ id: c.id, kind: c.kind, n: c.n, credits }); }
    }
  }

  // ---------- The probe network ----------

  // Once researched (and while it's on), at every step of the clock with no survey under way, a
  // survey starts on the signal that's quickest to chart, while the credits cover twice its cost.
  const hasProbes = (state, t = Infinity) => bonusAt(state, t, 'probes') > 0;
  function setAutoSurvey(state, on) {
    if (!hasProbes(state)) return false;
    state.autoSurvey = !!on;
    return true;
  }
  function autoSurvey(state, w, t) {
    if (state.survey || state.credits < 2 * surveyCost(state)) return null;
    const open = w.sites.filter((x) => surveyable(state, w, x.key)).map((x) => ({ key: x.key, ms: surveyTime(state, w, x.key) }))
      .sort((a, b) => a.ms - b.ms || (a.key < b.key ? -1 : 1));
    return open.length && survey(state, w, open[0].key, t) ? open[0].key : null;
  }

  // ---------- Auto-sell ----------

  const canAuto = (state, t = Infinity) => bonusAt(state, t, 'auto') > 0;
  const autoFloor = (state, t = Infinity) => Math.max(0, Config.AUTO_SELL.floor - bonusAt(state, t, 'autoFloor'));
  function setAuto(state, kind, on) {
    if (!canAuto(state) || !Recipes.item(kind)) return false;
    state.autoSell = on ? uniq([...state.autoSell, kind]) : state.autoSell.filter((k) => k !== kind);
    return true;
  }
  // Sell the picked goods at the waystation while each still fetches its floor.
  function autoSell(state, w, t, sold) {
    const key = w.waystation.key, floor = autoFloor(state, t);
    for (const kind of state.autoSell) {
      const base = Recipes.item(kind)?.price || 0;
      let n = 0, credits = 0;
      while ((industry.stockAt(state.industry, key)[kind] || 0) > 0) {
        const p = priceOf(state, w, key, kind, t);
        if (p == null || p < floor * base) break;
        const r = sell(state, w, key, kind, 1, t);
        if (!r.sold) break;
        n++;
        credits += r.credits;
      }
      if (n) { const x = sold[kind] || (sold[kind] = { n: 0, credits: 0 }); x.n += n; x.credits += credits; }
    }
  }

  // ---------- New systems (prestige) ----------

  // Once every station is built, the player can leave for a new system: everything here stays
  // behind (stations, drills, research, credits), and what was earned here becomes legacy points,
  // kept for good. The next system is rolled from this one's seed and the jumps made, so it's fixed.
  const canJump = (state) => !nextBuild(state);
  const jumpPoints = (state) => Math.floor(Math.sqrt(Math.max(0, state.earned) / Config.LEGACY.per));
  const nextSeed = (state) => 1 + (hashInt(seedToInt(state.seed), state.legacy.jumps + 1, 0x7a3) % 999999);
  function jump(state, w, now) {
    if (!canJump(state)) return null;
    const points = jumpPoints(state), L = state.legacy;
    const nw = world(nextSeed(state), LAYOUT), next = empty(nw, now);
    next.legacy = {
      jumps: L.jumps + 1, points: L.points + points,
      systems: [...L.systems, { seed: state.seed, name: w.galaxy.name, points, built: state.built.length, at: now }],
    };
    return { state: next, w: nw };
  }

  // ---------- Time ----------

  // Production settles from one moment to the next that matters, in order: a survey's end, a
  // hauler sent by hand arriving, and, while something runs on its own (auto-sell, the clerk, the
  // probes), every step of the clock, where it acts. All of them are fixed times, so time away comes
  // out the same however it's settled. Contracts roll over at the first moment of each day.
  const stepping = (state, t) => (state.autoSell.length > 0 && canAuto(state, t)) || hasClerk(state, t) || (state.autoSurvey && hasProbes(state, t));
  function settle(state, w, now, max = Industry.MAX_EVENTS) {
    const researched = lab.settle(state.lab, now);
    const e = env(state), log = [], sold = {}, delivered = [], found = [], STEP = Config.STEP;
    const out = (truncated) => ({ log, truncated, charted: found, researched, sold, delivered });
    const steps = stepping(state, now);
    for (;;) {
      const step = steps ? (Math.floor(state.soldAt / STEP) + 1) * STEP : Infinity;
      const b = Math.min(now, step, state.survey ? state.survey.end : Infinity, ...state.hauls.map((h) => h.end));
      const left = max - log.length;
      if (left <= 0) return out(true);
      const r = industry.settle(state.industry, b, e, left);
      log.push(...r.log);
      if (r.truncated) return out(true);
      found.push(...chartDue(state, w, b));
      for (const h of state.hauls.filter((x) => x.end <= b).sort((x, y) => x.end - y.end || (x.from < y.from ? -1 : 1))) log.push(arrive(state, w, h));
      if (online(state, w, w.waystation.key)) rollContracts(state, w, b);
      if (b === step) {
        if (state.autoSell.length && canAuto(state, b)) autoSell(state, w, b, sold);
        if (hasClerk(state, b) && online(state, w, w.waystation.key)) autoDeliver(state, w, b, delivered);
        if (state.autoSurvey && hasProbes(state, b)) autoSurvey(state, w, b);
        state.soldAt = b;
      }
      if (b >= now) break;
    }
    state.seen = state.soldAt = now;
    return out(false);
  }

  function readLab(l) {
    if (!l || typeof l !== 'object' || !Array.isArray(l.done) || !Array.isArray(l.queue)) return lab.empty();
    return {
      done: l.done.filter((id) => P[id]), doneAt: l.doneAt && typeof l.doneAt === 'object' ? l.doneAt : {},
      active: l.active && P[l.active.id] && Number.isFinite(l.active.end) ? l.active : null, queue: l.queue.filter((id) => P[id]),
    };
  }
  function read(d) {
    if (!d || typeof d !== 'object' || d.version !== VERSION || !d.industry || !Array.isArray(d.industry.orders) || !Array.isArray(d.charted)) return null;
    const obj = (x) => (x && typeof x === 'object' ? x : {});
    return {
      version: VERSION, seed: d.seed ?? 1, layout: Number.isInteger(d.layout) ? Math.min(d.layout, LAYOUT) : 1, credits: Number.isFinite(d.credits) ? d.credits : Config.START_CREDITS,
      industry: d.industry, built: Array.isArray(d.built) ? d.built.filter((id) => builds.PROJECTS[id]) : [], hosts: obj(d.hosts),
      charted: d.charted, survey: d.survey && Number.isFinite(d.survey.end) ? d.survey : null, finds: obj(d.finds),
      drills: obj(d.drills), economy: d.economy && typeof d.economy === 'object' ? d.economy : Economy.empty(),
      lab: readLab(d.lab),
      contracts: d.contracts && Array.isArray(d.contracts.list) ? { day: d.contracts.day ?? null, list: d.contracts.list.filter((c) => c && Recipes.item(c.kind)) } : { day: null, list: [] },
      autoSell: Array.isArray(d.autoSell) ? d.autoSell.filter((k) => Recipes.item(k)) : [],
      sales: obj(d.sales),
      soldAt: Number.isFinite(d.soldAt) ? d.soldAt : Number.isFinite(d.seen) ? d.seen : 0,
      seen: Number.isFinite(d.seen) ? d.seen : 0,
      earned: Number.isFinite(d.earned) ? d.earned : 0, legacy: readLegacy(d.legacy),
      hauls: Array.isArray(d.hauls) ? d.hauls.filter((h) => h && typeof h.from === 'string' && typeof h.to === 'string' && h.load && typeof h.load === 'object' && Number.isFinite(h.end)) : [],
      foremen: Array.isArray(d.foremen) ? d.foremen.filter((id) => builds.PROJECTS[id]) : [],
      keep: Array.isArray(d.keep) ? d.keep.filter((x) => typeof x === 'string') : [],
      autoSurvey: d.autoSurvey !== false,
    };
  }
  function readLegacy(l) {
    if (!l || typeof l !== 'object') return noLegacy();
    const n = (x) => (Number.isFinite(x) && x > 0 ? Math.floor(x) : 0);
    return { jumps: n(l.jumps), points: n(l.points), systems: Array.isArray(l.systems) ? l.systems.filter((x) => x && typeof x === 'object') : [] };
  }

  return {
    VERSION, LAYOUT, industry, builds, lab, bonusAt, known, researchStatus, research, cancelResearch, pause, raise, change, lineage,
    routeLimit, haulerLimit, routes, canRoute, carries, addRoute, removeRoute, fixes, isSite, world, env, online, charted, surveyable, surveyCost, surveyTime, survey, findAt,
    hostOf, posOf, berths, stationOf, nextBuild, buildStatus, build, empty, drillCost, buyDrill, setDrill, recipesAt,
    place, cancel, setShuttle, priceOf, sell, contracts, contractSlots, contractPay, canDeliver, deliver, canAuto, autoFloor, setAuto,
    batchOf, rerun, hasForeman, foremanStatus, hireForeman, haulage, shuttleCost, haulTarget, haulable, haulOf, canHaul, sendHaul, buyShuttle,
    hasClerk, setKeep, hasProbes, setAutoSurvey,
    legacy, legacyBonus, canJump, jumpPoints, nextSeed, jump, settle, read,
  };
})();

export { IdleRules };
