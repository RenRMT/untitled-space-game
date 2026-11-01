// Plays the idle game (src/idle/) in Node with a scripted player, for measuring its numbers against
// the targets in notes/idle.md (Numbers): when each station is built, and when the first gear of
// each Mk comes out of the shipyard. The rules are the page's own (src/idle/rules.js), so what this
// reports is what a player who plays like the script would see.
//   node tools/idle-sim.js [--days=30] [--seed=1] [--log]   (npm run idle:sim -- …)
//
// The player checks in every 2 minutes for the first half hour, every 15 minutes to the end of the
// second hour, then every 3 hours, day and night. At each check-in, after settling to now, it:
// builds the next station when it can (round a charted body with a free berth, one whose goods it
// uses first); delivers the contracts it can; sells what it doesn't keep (what the next station and
// the next research cost, and up to 20 of every input an order at the station uses); takes the chain's fixes
// (routes, shuttles, orders); keeps an order going for each good the next station or research
// needs, and for the best gear of one line (deflectors) at the shipyard; buys drills while they
// cost a fifth of its credits or less; surveys the nearest signal while it has twice the price; and
// queues research in a fixed order of preference. --log prints each check-in that changed something.
// Runs in Node.

import { Config } from '../src/idle/config.js';
import { IdleRules } from '../src/idle/rules.js';
import { Recipes } from '../src/rules/recipes.js';

const args = process.argv.slice(2);
const opt = (k, d) => { const a = args.find((s) => s.startsWith(`--${k}=`)); return a ? +a.split('=')[1] : d; };
const DAYS = opt('days', 30), SEED = opt('seed', 1), LOG = args.includes('--log');
const R = IdleRules, I = R.industry, MIN = 60e3, HOUR = 3600e3, DAY = 24 * HOUR;
const T0 = Date.UTC(2026, 10, 2, 8); // a Monday morning
const LINE = 'deflector';
const PREFER = [
  'ext.drill.1', 'ind.speed.1', 'trade.auto', 'ind.bays.1', 'ext.drill.2', 'log.routes.1', 'trade.contracts', 'ind.storage.1',
  'ind.speed.2', 'log.haulers.1', `bp.${LINE}-2`, 'ind.bays.2', 'trade.bonus.1', `bp.${LINE}-3`, 'ext.drill.3', 'ind.speed.3',
  'log.routes.2', `bp.${LINE}-4`, 'ind.storage.2', 'trade.auto.2', `bp.${LINE}-5`, 'trade.bonus.2', 'ind.lab.1',
];

const w = R.world(SEED), state = R.empty(w, T0), way = w.waystation.key;
const field = w.sites.find((s) => s.kind === 'field');
const milestones = [], gearFirst = {}, income = {};
const earn = (k, n) => { income[k] = (income[k] || 0) + n; };
const at = (t) => { const m = Math.round((t - T0) / MIN); return `${Math.floor(m / 1440)}d ${String(Math.floor((m % 1440) / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; };
const note = (t, what) => { milestones.push([t, what]); if (LOG) console.log(`${at(t)}  ${what}`); };
const stock = (key) => I.stockAt(state.industry, key);
const stationsOn = () => w.stations.filter((s) => R.online(state, w, s.key));
const nameOf = (k) => Recipes.item(k)?.name || k;

function settle(t) {
  let r;
  do {
    r = R.settle(state, w, t);
    for (const [k, x] of Object.entries(r.sold)) earn(`${k} (auto)`, x.credits);
    for (const c of r.charted) note(t, `charted ${w.byKey.get(c.key).name}${c.find ? ` (+${c.find} cr)` : ''}`);
    for (const id of r.researched) note(t, `researched ${Config.PACKAGES[id].name}`);
    for (const x of r.log) {
      if (!x.out) continue;
      for (const k of Object.keys(x.out)) {
        const it = Recipes.item(k);
        if (it?.kind === 'gear' && it.tier > 1 && !gearFirst[it.tier]) { gearFirst[it.tier] = x.at; note(x.at, `first Mk ${it.tier} gear (${it.name})`); }
      }
    }
  } while (r.truncated);
}

// What the player keeps at the waystation: the next station's goods and the next research's.
function reserve() {
  const keep = {};
  const add = (k, n) => { keep[k] = Math.max(keep[k] || 0, n); };
  const nb = R.nextBuild(state);
  if (nb) for (const [k, n] of Object.entries(nb.goods)) add(k, n);
  const next = nextResearch();
  if (next) for (const [k, n] of Object.entries(Config.PACKAGES[next].cost)) if (k !== 'credits') add(k, n);
  for (const c of R.contracts(state)) if (!c.done) add(c.kind, c.n);
  return keep;
}
// The first package it can pay for now, else the first whose goods the stations built can make.
function nextResearch() {
  const open = PREFER.filter((id) => { const s = R.researchStatus(state, w, id); return s.state === 'available' && !s.away; });
  const makeable = (id) => Object.keys(Config.PACKAGES[id].cost).every((k) => k === 'credits' || (stock(way)[k] || 0) > 0
    || stationsOn().some((st) => { const x = I.recipeFor(k, R.known(state)); return x && I.canMake(st.type, x.id); }));
  return open.find((id) => R.researchStatus(state, w, id).ok) || open.find(makeable) || null;
}

function sell(t) {
  const keep = reserve();
  for (const st of stationsOn()) {
    const inputs = new Set(I.at(state.industry, st.key).flatMap((o) => Object.keys(Config.RECIPES[o.recipe].in)));
    for (const [k, n] of Object.entries(stock(st.key))) {
      const extra = n - Math.max(keep[k] || 0, inputs.has(k) ? 20 : 0);
      if (extra > 0 && R.priceOf(state, w, st.key, k, t) != null) earn(k, R.sell(state, w, st.key, k, extra, t).credits);
    }
  }
}

function build(t) {
  const nb = R.nextBuild(state);
  if (!nb || R.buildStatus(state, w, nb.id).id !== 'ready') return;
  const free = w.sites.filter((s) => R.charted(state, s.key) && R.berths(state, w, s.key).free);
  const uses = (s) => I.processes(nb.type).some((bay) => Object.values(Config.RECIPES).some((x) => x.bay === bay && s.goods.some((g) => g in x.in)));
  const host = free.find(uses) || free.find((s) => s.kind !== 'moon') || free[0];
  if (host && R.build(state, w, nb.id, host.key, t)) note(t, `built the ${nb.name.toLowerCase()} round ${host.name}`);
}

// Keep an order going for each good wanted at the waystation and short there.
function orders(t) {
  for (const f of R.fixes(state, w)) {
    if (f.kind === 'route') R.addRoute(state, w, f.from, f.to, [f.good], t);
    else if (f.kind === 'shuttle') R.setShuttle(state, w, f.from, f.to, t);
    else if (f.kind === 'order') R.place(state, w, f.key, f.recipe, t);
  }
  const want = reserve(), have = stock(way), known = R.known(state);
  for (const [k, n] of Object.entries(want)) {
    if ((have[k] || 0) >= n || state.industry.orders.some((o) => k in Config.RECIPES[o.recipe].out)) continue;
    const recipe = I.recipeFor(k, known);
    if (!recipe || recipe.bay === 'extract') { drillFor(k, t); continue; }
    const st = stationsOn().find((s) => I.canMake(s.type, recipe.id) && I.at(state.industry, s.key).length < R.env(state).slotsAt(s.key));
    if (st) R.place(state, w, st.key, recipe.id, t);
  }
  // A station that both shuttles to the waystation and sends a good on by route loses that good to the
  // shuttle (it takes everything): swap the shuttle for a route of just what the waystation wants.
  for (const r of R.routes(state)) {
    const from = r.stops[0].station, sh = I.shuttle(state.industry, from);
    if (R.isSite(from) || !sh || sh.stops[1].station !== way) continue;
    const made = new Set(I.at(state.industry, from).flatMap((o) => Object.keys(Config.RECIPES[o.recipe].out)));
    const kinds = Object.keys(want).filter((k) => made.has(k));
    R.setShuttle(state, w, from, null, t);
    if (kinds.length) R.addRoute(state, w, from, way, kinds, t);
  }
  // A drill site whose good is wanted at the waystation, shuttling it somewhere that doesn't use it:
  // to the waystation instead.
  for (const site of w.sites.filter((x) => state.drills[x.key])) {
    const sh = I.shuttle(state.industry, site.key), to = sh?.stops[1].station;
    if (!to || to === way) continue;
    const used = new Set(I.at(state.industry, to).flatMap((o) => Object.keys(Config.RECIPES[o.recipe].in)));
    if (site.goods.some((g) => g in want && !used.has(g))) R.setShuttle(state, w, site.key, way, t);
  }
  // Stop gear and consumables nobody wants any more (a contract's, delivered).
  for (const o of [...state.industry.orders]) {
    const out = Object.keys(Config.RECIPES[o.recipe].out)[0], it = Recipes.item(out);
    if (['gear', 'consumable', 'mod'].includes(it?.kind) && !(out in want) && o.station !== R.stationOf(w, 'build.shipyard').key) R.cancel(state, w, o.id);
  }
  // A drill for every raw input an order uses that no drill pulls.
  const drilled = new Set(state.industry.orders.filter((o) => R.isSite(o.station)).map((o) => Object.keys(Config.RECIPES[o.recipe].out)[0]));
  for (const o of state.industry.orders) {
    for (const k of Object.keys(Config.RECIPES[o.recipe].in)) if (Recipes.item(k)?.stage === 'raw' && !drilled.has(k)) { drillFor(k, t); drilled.add(k); }
  }
  // The best deflector known, at the shipyard.
  const ship = R.stationOf(w, 'build.shipyard');
  if (R.online(state, w, ship.key)) {
    const best = [5, 4, 3, 2].map((n) => `make.${LINE}-${n}`).find((id) => known.has(id));
    if (best && !I.at(state.industry, ship.key).some((o) => o.recipe === best)) {
      const old = I.at(state.industry, ship.key).find((o) => o.recipe.startsWith(`make.${LINE}-`));
      if (old) R.change(state, w, old.id, best, t);
      else if (I.at(state.industry, ship.key).length < R.env(state).slotsAt(ship.key)) R.place(state, w, ship.key, best, t);
    }
  }
}

// A drill for a raw good, at the nearest charted body that has it.
function drillFor(k, t) {
  const site = w.sites.filter((s) => R.charted(state, s.key) && s.goods.includes(k)).sort((a, b) => R.drillCost(state, a) - R.drillCost(state, b))[0];
  if (site && !(state.drills[site.key] > 0 && I.at(state.industry, site.key).some((o) => o.recipe === `extract.${k}`)) && R.drillCost(state, site) <= state.credits / 2) R.buyDrill(state, w, site.key, k, t);
}

// More drills at the field while its shuttle keeps up (its stock under half full), up to 8.
function drills(t) {
  for (let i = 0; i < 2; i++) {
    const n = state.drills[field.key] || 0, cost = R.drillCost(state, field);
    if (n >= 8 || cost > state.credits / 5 || I.used(state.industry, field.key) > Config.SITE_STORAGE / 2) break;
    if (!R.buyDrill(state, w, field.key, n % 2 ? 'silicates' : 'iron', t)) break;
  }
}

function survey(t) {
  if (state.survey) return;
  const open = w.sites.filter((s) => R.surveyable(state, w, s.key)).sort((a, b) => R.surveyTime(state, w, a.key) - R.surveyTime(state, w, b.key));
  if (open.length && state.credits >= 2 * R.surveyCost(state)) R.survey(state, w, open[0].key, t);
}

function research(t) {
  const id = nextResearch();
  if (id && R.researchStatus(state, w, id).ok) R.research(state, w, id, t);
}

function turn(t) {
  settle(t);
  if (!R.online(state, w, way)) { R.build(state, w, 'build.waystation', field.key, t); note(t, 'built the waystation'); }
  for (const c of R.contracts(state)) if (R.canDeliver(state, w, c.id)) { const pay = R.deliver(state, w, c.id, t); earn('contracts', pay); if (LOG) note(t, `delivered ${c.n} ${nameOf(c.kind)} (+${pay} cr)`); }
  build(t);
  orders(t);
  sell(t);
  research(t);
  drills(t);
  survey(t);
  if (R.canAuto(state)) for (const k of ['iron', 'silicates']) if (!state.autoSell.includes(k)) R.setAuto(state, k, true);
}

const times = [];
for (let t = 0; t < 30 * MIN; t += 2 * MIN) times.push(t);
for (let t = 30 * MIN; t < 2 * HOUR; t += 15 * MIN) times.push(t);
for (let t = 2 * HOUR; t <= DAYS * DAY; t += 3 * HOUR) times.push(t);
for (const dt of times) turn(T0 + dt);

const built = milestones.filter(([, s]) => s.startsWith('built'));
console.log(`Idle sim: seed ${SEED} (${w.galaxy.name}), ${DAYS} days, ${times.length} check-ins\n`);
console.log('Built:');
for (const [t, s] of built) console.log(`  ${at(t).padEnd(10)} ${s.slice(6)}`);
console.log('\nFirst gear:');
for (let n = 2; n <= 5; n++) console.log(`  Mk ${['', '', 'II', 'III', 'IV', 'V'][n].padEnd(4)} ${gearFirst[n] ? at(gearFirst[n]) : '—'}`);
console.log(`\nAt the end: ${Math.round(state.credits).toLocaleString('en')} cr, ${state.charted.length} of ${w.sites.length} bodies charted, ` +
  `${Object.values(state.drills).reduce((a, b) => a + b, 0)} drills, ${state.lab.done.length} packages researched, ${R.routes(state).length} routes`);
const T = { 'build.ore': 'within the first session (~5 min)', 'build.volatiles': 'day 1', 'build.shipyard': 'days 7–10' };
console.log('\nTargets (notes/idle.md): ore works ' + T['build.ore'] + ', volatiles works ' + T['build.volatiles'] + ', shipyard ' + T['build.shipyard'] + ', first Mk V about week 3');
console.log('\nIncome:', Object.entries(income).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, n]) => `${k} ${Math.round(n).toLocaleString('en')}`).join(', '));
if (args.includes('--dump')) {
  console.log('\nStations:');
  for (const st of [...stationsOn(), ...w.sites.filter((s) => state.drills[s.key])]) {
    const sh = I.shuttle(state.industry, st.key);
    console.log(`  ${st.name} (${st.type})${sh ? ` → ${w.byKey.get(sh.stops[1].station).name}` : ''}: ${JSON.stringify(stock(st.key))}`);
    for (const o of I.at(state.industry, st.key)) console.log(`    ${o.recipe} ${I.status(state.industry, o).id} ${I.status(state.industry, o).missing || ''} made ${o.made}`);
  }
  console.log('Next research:', nextResearch(), nextResearch() && JSON.stringify(R.researchStatus(state, w, nextResearch())));
  console.log('Fixes:', JSON.stringify(R.fixes(state, w)));
}
