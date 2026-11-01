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
// site takes as many orders as it has drills (env slotsAt), and its first drill gives it a shuttle to
// the nearest station that uses what it pulls (the waystation if none does). A station is where its
// body is: travel times between them come from the bodies' places in the system.
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
//   IdleRules.world(seed) -> w        { seed, galaxy, star, stations: [station], sites: [site], byKey: Map, waystation }
//     station: { key, name, type, kind: 'station', build (its Config.BUILDS id), code, culture, seed, size, src (the galaxy's) }
//     site:    { key, name, kind: 'field' | 'planet' | 'moon', type: 'site', x, y, goods: [kind], body (planet/moon) | null,
//                parent (a moon's planet key) | null, ring (planets and the field: their orbit's place from the star, 0 first) }
//   IdleRules.empty(w, now) -> state  { version, seed, credits, industry, built: [build id], hosts: { [station key]: site key },
//                                       charted: [site key], survey: { key, at, end } | null, finds: { [site key]: credits },
//                                       drills: { [site key]: n }, economy, lab, contracts: { day, list: [contract] },
//                                       autoSell: [kind], soldAt (the last auto-sell step settled to), seen }
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
//   IdleRules.setShuttle(state, w, fromKey, toKey, now) -> route | null
//   IdleRules.priceOf(state, w, stKey, kind, now) -> credits | null   what that station pays for one
//   IdleRules.sell(state, w, stKey, kind, n, now) -> { sold, credits }
//   IdleRules.contracts(state) -> [contract] today's; contractSlots(state), contractPay(state, c) -> credits
//   IdleRules.canDeliver(state, w, id) -> bool, deliver(state, w, id, now) -> credits | 0   from the waystation
//   IdleRules.canAuto(state) -> bool (researched), autoFloor(state) -> share, setAuto(state, kind, on) -> bool
//   IdleRules.settle(state, w, now, max?) -> { log, truncated, charted: [{ key, find }], researched: [id],
//     sold: { [kind]: { n, credits } } (auto-sold) }
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
  const VERSION = 4;
  const industry = Industry.create({ recipes: Config.RECIPES, process: Config.PROCESS, storage: { base: Config.STATION_STORAGE }, slots: Config.STATION_SLOTS });
  const builds = Restoration.create({ list: Config.BUILDS, online: [] });
  const P = Config.PACKAGES;
  // What's done adds from the moment it finished.
  const bonusOf = (labState, t, key) => labState.done.reduce((n, id) => n + ((labState.doneAt?.[id] ?? 0) <= t ? P[id]?.industry?.[key] || 0 : 0), 0);
  const bonusAt = (state, t, key) => bonusOf(state.lab, t, key);
  const lab = Lab.create({ packages: P, categories: Config.CATEGORIES, queueMax: (l) => Config.LAB_QUEUE + bonusOf(l, Infinity, 'queue'), config: Research.config });
  // Drills and the wreck field need no research.
  const DRILLS = Object.keys(Config.RECIPES).filter((id) => id.startsWith('extract.') || id.startsWith('salvage.'));
  const known = (state) => new Set([...Recipes.known(state.lab.done).values(), ...DRILLS]);
  const isSite = (key) => key.startsWith('site:');
  const uniq = (a) => [...new Set(a)];

  function world(seed) {
    const galaxy = Galaxy.generate(seed);
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
    return { seed, galaxy, star, stations, sites, byKey, rings: sites.filter((s) => s.kind !== 'moon').length, waystation: stations.find((s) => s.type === 'waystation') };
  }

  function env(state) {
    return {
      recipe: (id) => Config.RECIPES[id],
      speed: (t) => 1 + bonusAt(state, t, 'speed'),
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
    if (find) { state.finds[sv.key] = find; state.credits += find; }
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
      version: VERSION, seed: w.seed, credits: Config.START_CREDITS, industry: industry.empty(), built: [], hosts: {},
      charted: field ? [field.key] : [], survey: null, finds: {}, drills: {}, economy: Economy.empty(), lab: lab.empty(),
      contracts: { day: null, list: [] }, autoSell: [], soldAt: now, seen: now,
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
    if (b.shuttle && st !== w.waystation) setShuttle(state, w, st.key, w.waystation.key, now);
    // The ore works starts on steel pipe.
    if (st.type === 'mining camp') industry.place(state.industry, ref(st), 'make.steel-pipe', null, env(state), now);
    // Drill sites that send to the waystation, or nowhere, send to this station instead if it uses
    // what they pull.
    for (const s of w.sites) {
      if (!state.drills[s.key]) continue;
      const r0 = industry.shuttle(state.industry, s.key), to = r0 ? r0.stops[1].station : null;
      if (to && to !== w.waystation.key) continue;
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
    if (!industry.shuttle(state.industry, siteKey)) setShuttle(state, w, siteKey, target.key, now);
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
    return industry.place(state.industry, ref(x), recipe, null, env(state), now);
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
    return industry.change(state.industry, id, recipe, null, env(state), now);
  }
  function lineage(state, w, id) {
    const o = orderOf(state, id);
    return o ? industry.lineage(state.industry, o.recipe, known(state), o.station) : [];
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

  // Trade goods sell at the station's market price (falling as it fills); gear, consumables and
  // salvage at a flat share of their price.
  const traded = (kind) => !!Goods.type(kind) && !Goods.isSalvage(kind);
  function priceOf(state, w, stKey, kind, now) {
    const st = w.byKey.get(stKey);
    if (!st || st.kind !== 'station' || !online(state, w, stKey)) return null;
    if (traded(kind)) return Economy.market(w.galaxy.seed, st.src, state.economy, now).goods.find((g) => g.kind === kind)?.sell ?? null;
    const item = Recipes.item(kind);
    return item ? Math.round(item.price * Config.GEAR_SALE) : null;
  }
  function sell(state, w, stKey, kind, n, now) {
    let sold = 0, credits = 0;
    for (; sold < n; sold++) {
      const p = priceOf(state, w, stKey, kind, now);
      if (p == null || industry.withdraw(state.industry, stKey, kind, 1) !== 1) break;
      if (traded(kind)) Economy.trade(state.economy, w.galaxy.seed, w.byKey.get(stKey).src, kind, 1, now);
      credits += p;
    }
    state.credits += credits;
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
  function rollContracts(state, w, now) {
    const day = dayOf(now);
    if (state.contracts.day === day) return;
    const r = mulberry32(hashInt(seedToInt(w.seed), day, 0xc0d));
    const pool = wanted(state, w, day * DAY), list = [];
    for (let i = 0; i < contractSlots(state, day * DAY) && pool.length; i++) {
      const kind = pool.splice(Math.floor(r() * pool.length), 1)[0], it = Recipes.item(kind);
      const [a, b] = Config.CONTRACTS.size[it.kind] || [1, 3];
      const n = a + Math.floor(r() * (b - a + 1));
      list.push({ id: `${day}.${i}`, kind, n, reward: Math.round((it.price * n * Config.CONTRACTS.bonus) / 10) * 10, from: FROM[Math.floor(r() * FROM.length)], done: false });
    }
    state.contracts = { day, list };
  }
  const contracts = (state) => state.contracts.list;
  const contractPay = (state, c) => Math.round(c.reward * (1 + bonusAt(state, Infinity, 'contractBonus')));
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
    industry.kick(state.industry, env(state), now);
    return pay;
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

  // ---------- Time ----------

  // The survey is charted before production settles, so its find is in the credits from its end.
  // With auto-sell on, production settles to each step of the clock in turn, and sells there.
  function settle(state, w, now, max = Industry.MAX_EVENTS) {
    const researched = lab.settle(state.lab, now);
    const found = chartDue(state, w, now);
    if (online(state, w, w.waystation.key)) rollContracts(state, w, now);
    const e = env(state), log = [], sold = {}, STEP = Config.AUTO_SELL.step;
    const out = (truncated) => ({ log, truncated, charted: found, researched, sold });
    if (state.autoSell.length && canAuto(state, now)) {
      for (;;) {
        const b = (Math.floor(state.soldAt / STEP) + 1) * STEP;
        if (b > now) break;
        const left = max - log.length;
        if (left <= 0) return out(true);
        const r = industry.settle(state.industry, b, e, left);
        log.push(...r.log);
        if (r.truncated) return out(true);
        if (canAuto(state, b)) autoSell(state, w, b, sold);
        state.soldAt = b;
      }
    }
    const r = industry.settle(state.industry, now, e, Math.max(1, max - log.length));
    log.push(...r.log);
    if (r.truncated) return out(true);
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
      version: VERSION, seed: d.seed ?? 1, credits: Number.isFinite(d.credits) ? d.credits : Config.START_CREDITS,
      industry: d.industry, built: Array.isArray(d.built) ? d.built.filter((id) => builds.PROJECTS[id]) : [], hosts: obj(d.hosts),
      charted: d.charted, survey: d.survey && Number.isFinite(d.survey.end) ? d.survey : null, finds: obj(d.finds),
      drills: obj(d.drills), economy: d.economy && typeof d.economy === 'object' ? d.economy : Economy.empty(),
      lab: readLab(d.lab),
      contracts: d.contracts && Array.isArray(d.contracts.list) ? { day: d.contracts.day ?? null, list: d.contracts.list.filter((c) => c && Recipes.item(c.kind)) } : { day: null, list: [] },
      autoSell: Array.isArray(d.autoSell) ? d.autoSell.filter((k) => Recipes.item(k)) : [],
      soldAt: Number.isFinite(d.soldAt) ? d.soldAt : Number.isFinite(d.seen) ? d.seen : 0,
      seen: Number.isFinite(d.seen) ? d.seen : 0,
    };
  }

  return {
    VERSION, industry, builds, lab, bonusAt, known, researchStatus, research, cancelResearch, pause, raise, change, lineage,
    routeLimit, haulerLimit, routes, canRoute, carries, addRoute, removeRoute, fixes, isSite, world, env, online, charted, surveyable, surveyCost, surveyTime, survey, findAt,
    hostOf, posOf, berths, stationOf, nextBuild, buildStatus, build, empty, drillCost, buyDrill, setDrill, recipesAt,
    place, cancel, setShuttle, priceOf, sell, contracts, contractSlots, contractPay, canDeliver, deliver, canAuto, autoFloor, setAuto,
    settle, read,
  };
})();

export { IdleRules };
