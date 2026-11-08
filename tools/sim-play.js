// Redshift's scripted player (`npm run sim:play`, notes/sim.md): plays runs of the sim in Node on the
// real rules and says, per system, when the gate is done, when it jumps (or is lost), and what it had
// built. For balancing: the targets are a gate ready around 50–65% of the horizon for a fair player,
// so the jump's timing is the choice.
//
//   node tools/sim-play.js [--mode=endless|story] [--seed=N] [--systems=N] [--runs=N] [--wait=0.6] [-v]
//     wait: the overcharge it waits for before jumping (it jumps anyway at 88%)
// Runs in Node.

import { SimConfig as C } from '../src/sim/config.js';
import { SimEvents } from '../src/sim/events.js';
import { SimRules as R } from '../src/sim/rules.js';

const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.split('=')[1] : d; };
const verbose = process.argv.includes('-v');

// One decision a cycle: the first that applies.
function decide(s, meta) {
  const w = R.world(s), r = s.rates;
  const free = w.bodies.filter((b) => b.kind !== 'gate' && !s.stations[b.key]);
  const count = (t) => Object.values(s.stations).filter((x) => x.type === t && !x.rogue).length;
  const value = (p) => Object.entries(p.out).reduce((t, [k, n]) => t + n * (k === 'cr' ? 1 : k === 'sci' ? 1.5 : 0.8), 0) + p.sec;
  const tryBuild = (type) => {
    const best = free.map((b) => [b, R.canBuild(s, meta, b.key, type)]).filter(([, x]) => x.ok).sort((a, b) => value(b[1].preview) - value(a[1].preview))[0];
    return best && R.build(s, meta, best[0].key, type) ? `build ${type} at ${best[0].name}` : null;
  };
  // Events first: accept what's offered when it's affordable.
  for (const o of s.offers) { const a = SimEvents.answers(s, meta, o.id).find((x) => x.ok && x.pick); if (a && SimEvents.answer(s, meta, o.id, a.id)) return `answer ${o.kind}`; }
  if (!count('mine')) return tryBuild('mine');
  if (!count('siphon')) return tryBuild('siphon');
  if (R.has(s, 'block') && !count('hub')) return tryBuild('hub'); // saves up for it
  const g = R.gateStatus(s, meta);
  if (g.ok && Object.keys(s.stations).length >= 3) { R.buildGate(s, meta); return `gate ${g.next.name}`; }
  const urgent = (lim) => {
    for (const c of C.SETTLED) {
      if (!R.has(s, c)) continue;
      const t = C.CULTURES[c].station;
      if (s.approval[c] < lim && count(t) < 1 + Math.floor(R.builtCount(s) / 4)) { const x = tryBuild(t); if (x) return x; }
    }
    return null;
  };
  const u = urgent(30);
  if (u) return u;
  if (r.sec < r.demand && R.has(s, 'drifters') && count('defense') < 3) { const x = tryBuild('defense'); if (x) return x; }
  if (g.next && !g.building) {
    for (const [res, n] of Object.entries(g.cost)) {
      if (s.res[res] >= n) continue;
      if (res === 'm' && r.m < 1.5) { const x = tryBuild('mine'); if (x) return x; }
      if (res === 'v' && r.v < 1.5) { const x = tryBuild('siphon'); if (x) return x; }
      if (res === 'cr' && r.cr < 3 && R.has(s, 'block')) { const x = tryBuild('hub'); if (x) return x; }
      return null; // save up for the gate
    }
  }
  const u2 = urgent(60);
  if (u2) return u2;
  for (const [k, st] of Object.entries(s.stations)) if (st.ships < st.slots && R.addShip(s, meta, k)) return `ship at ${st.type}`;
  for (const [k, st] of Object.entries(s.stations)) if (st.level < 2 && R.upgrade(s, meta, k)) return `upgrade ${st.type}`;
  return null;
}

function play({ mode, seed, systems, wait }) {
  const meta = { insight: 0, archive: {} };
  const s = R.newRun(mode, meta, seed);
  const out = [];
  for (let n = 0; n < systems; n++) {
    const w = R.world(s);
    const row = { name: w.name, dist: w.distance, hazard: w.hazard || '-', life: w.life, gate: null, left: null, built: 0 };
    for (let c = 0; c < 3000 && s.status === 'play'; c++) {
      const ev = R.tick(s, meta, 1);
      ev.push(...SimEvents.tick(s, meta, ev));
      for (const e of ev) if (e.kind === 'gate' && e.done) row.gate = Math.round(s.pull);
      const d = decide(s, meta);
      if (d && verbose) console.log(`  ${Math.floor(s.cycle)} ${s.pull.toFixed(0)}% ${d}`);
      if (R.gateStatus(s, meta).done && (s.gate.charge >= wait || s.pull >= 88)) {
        row.built = R.builtCount(s); row.charge = s.gate.charge.toFixed(2);
        const choice = R.choices(s, meta).findIndex((x) => x.terms.distance === 'mid');
        const r = R.jump(s, meta, Math.max(0, choice));
        row.left = Math.round(s.past[s.past.length - 1].pull); row.insight = r.insight;
        break;
      }
    }
    if (s.status !== 'play') { row.built = R.builtCount(s); row.left = 'LOST'; out.push(row); break; }
    out.push(row);
  }
  return { rows: out, meta };
}

const runs = +arg('runs', 1), seed0 = +arg('seed', 1);
for (let i = 0; i < runs; i++) {
  const { rows, meta } = play({ mode: arg('mode', 'endless'), seed: seed0 + i, systems: +arg('systems', 5), wait: +arg('wait', 0.6) });
  console.log(`seed ${seed0 + i}: insight ${meta.insight}`);
  for (const r of rows) console.log(`  ${r.name.padEnd(10)} ${r.dist.padEnd(4)} ${String(r.hazard).padEnd(9)} life ${String(r.life).padStart(4)}  gate at ${String(r.gate ?? '-').padStart(3)}%  left at ${String(r.left).padStart(4)}%  built ${r.built}  charge ${r.charge ?? '-'}  insight ${r.insight ?? '-'}`);
}
