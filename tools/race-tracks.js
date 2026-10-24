// Measures the race's generated tracks (src/race/track.js) a seed at a time: how long a lap is, how
// much of it bends and which way, its tightest bend against the ship's turning circle at top speed,
// its longest straight, its width, and the wall left between two stretches. For checking what a
// change to the generator does (notes/race-research.md has the targets).
//   node tools/race-tracks.js [from] [to] [--hw=tiles] [--gap=tiles] [--style=advanced] [--size=tiles]   (npm run tracks -- …); seeds 1–30
//
// Columns: lap (world units, s at top speed); bend: share of the lap bending; one-way: the share of
// the bending that goes the commoner way; flips: left/right changes; tight: the tightest radius (and
// over the half-width there); <Rv: bends tighter than the turning circle v²/a; straight: the longest
// (units, s, degrees off vertical); hw: narrowest–widest half-width; wall: the least wall between two
// stretches past both run-offs (< 0: their run-offs meet); fill: the area inside the loop over its
// convex hull's; rvar: the widest corner's radius over the tightest's; from: corners, skeleton (the
// advanced style), or the blob fallback.

import { Config } from '../src/race/config.js';
import { Track } from '../src/race/track.js';

const args = process.argv.slice(2), flag = (k) => { const a = args.find((s) => s.startsWith(`--${k}=`)); return a ? +a.split('=')[1] * Config.T : undefined; };
const [from = 1, to = 30] = args.filter((s) => !s.startsWith('--')).map(Number);
const style = (args.find((s) => s.startsWith('--style=')) || '=regular').split('=')[1];
const opts = { ...Config.map(style).TRACK, ...(flag('size') && { size: flag('size') }), ...(flag('hw') && { hw: flag('hw') }), ...(flag('gap') && { gap: flag('gap') }) };
const V = opts.speed, RV = opts.rv, FAR = Config.RUNOFF + Config.CARVE.open;

function measure(seed) {
  const tr = Track.loop(seed, opts), { pts, ds, samples: S } = tr, m = Track.measure(tr, opts);
  // The least wall between two stretches further apart round the loop than a bend could bring them.
  const skip = Math.ceil((1.6 * (2 * m.hwMax + opts.gap)) / ds);
  let wall = Infinity;
  for (let a = 0; a < S; a += 2) for (let b = a + skip; b < S; b += 2) {
    if (S - (b - a) < skip) break;
    const p = pts[a], q = pts[b];
    wall = Math.min(wall, Math.hypot(p.x - q.x, p.y - q.y) - p.hw - q.hw - 2 * FAR);
  }
  return { seed, ...m, wall, from: tr.from, score: tr.score ?? 0 };
}

const f = (v, d = 0) => v.toFixed(d), pad = (s, n) => String(s).padStart(n);
const COLS = [
  ['seed', 4, (m) => m.seed], ['lap', 13, (m) => `${f(m.len)} ${f(m.lap, 1)}s`], ['bend', 5, (m) => f(m.bend, 2)], ['one-way', 7, (m) => f(m.oneWay, 2)],
  ['flips', 5, (m) => m.flips], ['tight', 10, (m) => `${f(m.tight)} ${f(m.tightHw, 1)}`], ['<Rv', 3, (m) => m.underRv],
  ['straight', 15, (m) => `${f(m.straight)} ${f(m.straightS, 1)}s ${f(m.straightDeg)}°`], ['hw', 8, (m) => `${f(m.hwMin)}–${f(m.hwMax)}`], ['wall', 5, (m) => f(m.wall)], ['fill', 4, (m) => f(m.fill, 2)], ['rvar', 4, (m) => f(m.rvar, 1)], ['from', 8, (m) => m.from], ['score', 5, (m) => f(m.score, 1)],
  ['corners', 0, (m) => Object.entries(m.types).map(([k, n]) => `${n} ${k}`).join(', ')],
];
console.log(`Tracks ${from}–${to} (${style}): hw ${f(opts.hw)}, gap ${f(opts.gap)}, run-off ${f(Config.RUNOFF)}; top speed ${f(V)}, turning circle v²/a ${f(RV)}\n`);
console.log(COLS.map(([h, n]) => pad(h, n)).join('  '));
const all = [];
for (let s = from; s <= to; s++) { const m = measure(s); all.push(m); console.log(COLS.map(([, n, g]) => pad(g(m), n)).join('  ')); }
const stat = (k, d = 0) => { const v = all.map((m) => m[k]).sort((a, b) => a - b); return `${f(v[0], d)} / ${f(v[v.length >> 1], d)} / ${f(v[v.length - 1], d)}`; };
console.log(`\nmin / median / max: lap ${stat('lap', 1)} s · bend ${stat('bend', 2)} · one-way ${stat('oneWay', 2)} · flips ${stat('flips')} · tight ${stat('tight')} · <Rv ${stat('underRv')} · straight ${stat('straightS', 1)} s · wall ${stat('wall')} · fill ${stat('fill', 2)} · rvar ${stat('rvar', 1)}`);
console.log(`fallback: ${all.filter((m) => m.from !== (style === 'advanced' ? 'skeleton' : 'corners')).length} of ${all.length}`);
