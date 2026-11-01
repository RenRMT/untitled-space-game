// The idle game's rules (notes/idle.md): one seeded system (world/galaxy.js), its stations brought
// back online one after another (rules/restoration.js over Config.PROJECTS), drills at the
// extraction sites, production orders at the stations and the shuttles between them (rules/industry.js
// over Config.RECIPES), and selling at the stations' markets (rules/economy.js). Everything runs
// on the real clock through Industry's settle, so time away comes out the same as time watched.
//
// Extraction sites are stations as far as Industry is concerned: the asteroid field, each planet and
// each moon has a stock (key `site:<kind><id>`, type 'site', process 'extract'), and a drill is an
// order there running extract.<good>, a recipe with no inputs that stops while the site's stock is full.
// A site takes as many orders as it has drills (env slotsAt), and its first drill gives it a shuttle
// to the nearest online station that uses what it pulls (the waystation if none does).
//
//   IdleRules.industry, IdleRules.restoration   the Industry and Restoration instances
//   IdleRules.world(seed) -> w        { seed, galaxy, stations: [station], sites: [site], byKey: Map }
//     station: { key, name, type, kind: 'station', x, y, culture, seed, size, src (the galaxy's) }
//     site:    { key, name, kind: 'field' | 'planet' | 'moon', type: 'site', x, y, goods: [kind], body (planet/moon) | null, parentType? }
//   IdleRules.empty(w, now) -> state  { version, seed, credits, industry, restored, drills: { [site key]: n }, economy, seen }
//   IdleRules.env(state) -> Industry env
//   IdleRules.online(state, w, key) -> bool   (sites: always)
//   IdleRules.drillCost(state, site) -> credits
//   IdleRules.buyDrill(state, w, siteKey, good, now) -> bool
//   IdleRules.setDrill(state, w, orderId, good, now) -> bool   what an existing drill pulls
//   IdleRules.recipesAt(state, w, key) -> [recipe]   the orders a station (or site) can take
//   IdleRules.place(state, w, key, recipe, now) -> order | null, cancel(state, w, orderId) -> bool (not drills)
//   IdleRules.setShuttle(state, w, fromKey, toKey, now) -> route | null
//   IdleRules.priceOf(state, w, stKey, kind, now) -> credits | null   what that station pays for one
//   IdleRules.sell(state, w, stKey, kind, n, now) -> { sold, credits }
//   IdleRules.nextProject(state) -> project | null, projectStatus(state, w, id)
//   IdleRules.restore(state, w, id, now) -> bool   paid from the waystation's stock and credits
//   IdleRules.settle(state, now, max?) -> { log, truncated }
//   IdleRules.read(data) -> state | null   a saved state, checked lightly
// ES module (`IdleRules`); also runs in Node (the tests).

import { Economy } from '../rules/economy.js';
import { Goods } from '../rules/goods.js';
import { Hazards } from '../rules/hazards.js';
import { Industry } from '../rules/industry.js';
import { Logistics } from '../rules/logistics.js';
import { Recipes } from '../rules/recipes.js';
import { Restoration } from '../rules/restoration.js';
import { Galaxy } from '../world/galaxy.js';
import { Config } from './config.js';

const IdleRules = (() => {
  const VERSION = 1;
  const industry = Industry.create({ recipes: Config.RECIPES, process: Config.PROCESS, storage: { base: Config.STATION_STORAGE }, slots: Config.STATION_SLOTS });
  const restoration = Restoration.create({ list: Config.PROJECTS, online: Config.ONLINE });
  const isSite = (key) => key.startsWith('site:');
  const uniq = (a) => [...new Set(a)];

  function world(seed) {
    const galaxy = Galaxy.generate(seed);
    const stations = galaxy.stations.map((s) => ({ key: s.key, name: s.name, type: s.market.type, kind: 'station', x: s.x, y: s.y, culture: s.culture, seed: s.seed, size: s.size, src: s }));
    const sites = [];
    for (const f of galaxy.fields) sites.push({ key: `site:field${f.id}`, name: f.name, kind: 'field', type: 'site', x: f.x, y: f.y, goods: ['iron', 'silicates'], body: null });
    for (const p of galaxy.planets) {
      const goods = uniq(Hazards.surface('planet', p.type, p.seed).deposits.map(([k]) => k));
      sites.push({ key: `site:planet${p.id}`, name: p.name, kind: 'planet', type: 'site', x: p.x, y: p.y, goods, body: p });
    }
    for (const m of galaxy.moons) {
      const parentType = galaxy.planets[m.parent]?.type;
      const goods = uniq(Hazards.surface('moon', m.type, m.seed, parentType).deposits.map(([k]) => k));
      sites.push({ key: `site:moon${m.id}`, name: m.name, kind: 'moon', type: 'site', x: m.x, y: m.y, goods, body: m, parentType });
    }
    const byKey = new Map([...stations, ...sites].map((x) => [x.key, x]));
    return { seed, galaxy, stations, sites, byKey, waystation: stations.find((s) => s.type === 'waystation') };
  }

  function env(state) {
    return {
      recipe: (id) => Config.RECIPES[id],
      speed: () => 1,
      room: () => 0,
      slots: () => 0,
      slotsAt: (key) => (isSite(key) ? state.drills[key] || 0 : Config.STATION_SLOTS),
      roomAt: (key) => (isSite(key) ? Config.SITE_STORAGE - Config.STATION_STORAGE : 0),
    };
  }

  const online = (state, w, key) => {
    const x = w.byKey.get(key);
    return !!x && (x.kind !== 'station' || restoration.online(x.type, state.restored));
  };
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const travel = (a, b) => Logistics.legTime(dist(a, b), Config.HAULER_SPEED);
  const ref = (x) => ({ key: x.key, name: x.name, type: x.type });

  function setShuttle(state, w, fromKey, toKey, now) {
    const from = w.byKey.get(fromKey), to = toKey ? w.byKey.get(toKey) : null;
    if (!from || !online(state, w, fromKey) || (to && (to.kind !== 'station' || !online(state, w, toKey) || to === from))) return null;
    return industry.setShuttle(state.industry, ref(from), to ? ref(to) : null, to ? travel(from, to) : 0, env(state), now);
  }

  // Where a site's goods go: the nearest online station with a process that uses one of them.
  function shuttleTarget(state, w, site) {
    const uses = (st) => industry.processes(st.type).some((bay) => Object.values(Config.RECIPES).some((R) => R.bay === bay && site.goods.some((g) => g in R.in)));
    const at = w.stations.filter((st) => online(state, w, st.key) && uses(st)).sort((a, b) => dist(a, site) - dist(b, site));
    return at[0] || w.waystation;
  }

  function empty(w, now) {
    const state = { version: VERSION, seed: w.seed, credits: Config.START_CREDITS, industry: industry.empty(), restored: [], drills: {}, economy: Economy.empty(), seen: now };
    // The ore works starts on steel pipe, shuttled to the waystation.
    const camp = w.stations.find((s) => s.type === 'mining camp');
    if (camp) {
      industry.place(state.industry, ref(camp), 'make.steel-pipe', null, env(state), now);
      setShuttle(state, w, camp.key, w.waystation.key, now);
    }
    return state;
  }

  function drillCost(state, site) {
    const n = state.drills[site.key] || 0;
    if (site.kind === 'field' && n < Config.DRILL.free) return 0;
    const base = site.kind === 'field' ? Config.DRILL.base.field : Math.max(...site.goods.map((g) => Config.DRILL.base.surface[Goods.type(g)?.rarity || 1]));
    return Math.round((base * Config.DRILL.growth ** n) / 10) * 10;
  }

  function buyDrill(state, w, siteKey, good, now) {
    const site = w.byKey.get(siteKey);
    if (!site || site.kind === 'station' || !site.goods.includes(good)) return false;
    const cost = drillCost(state, site);
    if (state.credits < cost) return false;
    state.credits -= cost;
    state.drills[siteKey] = (state.drills[siteKey] || 0) + 1;
    industry.place(state.industry, ref(site), `extract.${good}`, null, env(state), now);
    if (!industry.shuttle(state.industry, siteKey)) setShuttle(state, w, siteKey, shuttleTarget(state, w, site).key, now);
    return true;
  }

  function setDrill(state, w, orderId, good, now) {
    const o = state.industry.orders.find((x) => x.id === orderId), site = o && w.byKey.get(o.station);
    if (!site || site.kind === 'station' || !site.goods.includes(good)) return false;
    return industry.change(state.industry, orderId, `extract.${good}`, null, env(state), now);
  }

  function recipesAt(state, w, key) {
    const x = w.byKey.get(key);
    if (!x || !online(state, w, key)) return [];
    if (x.kind !== 'station') return x.goods.map((g) => Config.RECIPES[`extract.${g}`]);
    return Object.values(Config.RECIPES).filter((R) => industry.canMake(x.type, R.id));
  }

  function place(state, w, key, recipe, now) {
    const x = w.byKey.get(key);
    if (!x || x.kind !== 'station' || !online(state, w, key)) return null;
    return industry.place(state.industry, ref(x), recipe, null, env(state), now);
  }
  function cancel(state, w, id) {
    const o = state.industry.orders.find((x) => x.id === id);
    if (!o || isSite(o.station)) return false;
    return industry.cancel(state.industry, id);
  }

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

  const nextProject = (state) => restoration.LIST.find((p) => !state.restored.includes(p.id)) || null;
  const projectStatus = (state, w, id) => restoration.status(id, state.restored, industry.stockAt(state.industry, w.waystation.key), state.credits);
  function restore(state, w, id, now) {
    const r = restoration.restore(id, state.restored, industry.stockAt(state.industry, w.waystation.key), state.credits);
    if (!r) return false;
    for (const [kind, n] of Object.entries(r.take)) industry.withdraw(state.industry, w.waystation.key, kind, n);
    state.credits -= r.credits;
    state.restored.push(id);
    const p = restoration.PROJECTS[id];
    if (p.shuttle) for (const st of w.stations.filter((s) => s.type === p.shuttle && s !== w.waystation)) setShuttle(state, w, st.key, w.waystation.key, now);
    industry.kick(state.industry, env(state), now);
    return true;
  }

  function settle(state, now, max) {
    const r = industry.settle(state.industry, now, env(state), max);
    if (!r.truncated) state.seen = now;
    return r;
  }

  function read(d) {
    if (!d || typeof d !== 'object' || d.version !== VERSION || !d.industry || !Array.isArray(d.industry.orders)) return null;
    return {
      version: VERSION, seed: d.seed ?? 1, credits: Number.isFinite(d.credits) ? d.credits : Config.START_CREDITS,
      industry: d.industry, restored: Array.isArray(d.restored) ? d.restored.filter((id) => restoration.PROJECTS[id]) : [],
      drills: d.drills && typeof d.drills === 'object' ? d.drills : {}, economy: d.economy && typeof d.economy === 'object' ? d.economy : Economy.empty(),
      seen: Number.isFinite(d.seen) ? d.seen : 0,
    };
  }

  return { VERSION, industry, restoration, isSite, world, env, online, empty, drillCost, buyDrill, setDrill, recipesAt, place, cancel, setShuttle, priceOf, sell, nextProject, projectStatus, restore, settle, read };
})();

export { IdleRules };
