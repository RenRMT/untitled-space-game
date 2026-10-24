// Races the rivals (src/race/rival.js) against each other, headless, a seed at a time, at each level:
// each one's finish time over three laps, its hard hits and its slips, and what the field averages
// against a perfect lap on the racing line (Line) without boosts, ×3. For tuning the levels and the
// cultures (notes/race-rivals.md).
//   node tools/race-rivals.js [from] [to] [--style=advanced|expert] [--biome=ice|…] [--level=regular|advanced|expert]   (npm run rivals -- …); seeds 1–5

import { Config } from '../src/race/config.js';
import { Line } from '../src/race/line.js';
import { Pilot } from '../src/race/pilot.js';
import { Rival } from '../src/race/rival.js';

const args = process.argv.slice(2), opt = (k, d) => (args.find((s) => s.startsWith(`--${k}=`)) || `=${d}`).split('=')[1] || undefined;
const [from = 1, to = 5] = args.filter((s) => !s.startsWith('--')).map(Number);
const style = opt('style', 'regular'), biome = opt('biome', ''), levels = opt('level', '') ? [opt('level')] : Object.keys(Rival.LEVELS);
const opts = Config.map(style, biome).TRACK, f = (v, d = 1) => v.toFixed(d);

console.log(`Rivals on ${style} tracks${biome ? ` (${biome})` : ''}, seeds ${from}–${to}: finish time over 3 laps (s), hard hits, slips; field: its average over the line's perfect lap ×3\n`);
for (const level of levels) {
  const sum = {};
  let field = 0;
  for (let seed = from; seed <= to; seed++) {
    const { G, cfg, run } = Pilot.flat(seed, opts, { biome }), ideal = 3 * Line.build(G.tr, { stats: cfg.stats, handling: run().tune.handling, r: cfg.r }).time;
    const res = Rival.race(seed, opts, { level, biome }).sort((a, b) => a.time - b.time);
    field += res.reduce((t, r) => t + r.time, 0) / res.length / ideal;
    console.log(`${level.padEnd(8)} ${String(seed).padStart(3)}  ${res.map((r) => `${r.id} ${f(r.time)}${r.hits ? ` ${r.hits}h` : ''}${r.slips ? ` ${r.slips}s` : ''}`).join('  ')}`);
    for (const [i, r] of res.entries()) { const s = (sum[r.id] ??= { place: 0, n: 0 }); s.place += i + 1; s.n++; }
  }
  console.log(`${level}: field ${f(field / (to - from + 1), 3)} × the line · average place ${Object.entries(sum).sort((a, b) => a[1].place - b[1].place).map(([id, s]) => `${id} ${f(s.place / s.n)}`).join(', ')}\n`);
}
