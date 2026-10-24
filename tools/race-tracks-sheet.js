// A contact sheet of the race's generated tracks (src/race/track.js): each seed's centreline drawn
// at its width in a grid, as SVG, for looking a style's shapes over at a glance.
//   node tools/race-tracks-sheet.js [from] [to] [--style=advanced] > sheet.svg   (npm run tracks:sheet -- …); seeds 1–24

import { Config } from '../src/race/config.js';
import { Track } from '../src/race/track.js';

const args = process.argv.slice(2), [from = 1, to = 24] = args.filter((s) => !s.startsWith('--')).map(Number);
const style = (args.find((s) => s.startsWith('--style=')) || '=regular').split('=')[1];
const CELL = 200, COLS = 6, PAD = 12, k = (CELL - 2 * PAD) / Config.SIZE, n = to - from + 1, rows = Math.ceil(n / COLS);
const out = [`<svg xmlns="http://www.w3.org/2000/svg" width="${COLS * CELL}" height="${rows * CELL}" font-family="sans-serif" font-size="11">`, `<rect width="100%" height="100%" fill="#fff"/>`];
for (let s = from; s <= to; s++) {
  const tr = Track.loop(s, { ...Config.TRACK, style }), m = Track.measure(tr, Config.TRACK), c = s - from, ox = (c % COLS) * CELL + PAD, oy = Math.floor(c / COLS) * CELL + PAD;
  const d = tr.pts.map((p, i) => `${i ? 'L' : 'M'}${(ox + p.x * k).toFixed(1)} ${(oy + p.y * k).toFixed(1)}`).join('') + 'Z';
  const start = tr.pts[0];
  out.push(`<rect x="${ox - PAD}" y="${oy - PAD}" width="${CELL}" height="${CELL}" fill="none" stroke="#bbb"/>`,
    `<path d="${d}" fill="none" stroke="#222" stroke-width="${(2 * Config.HW * k).toFixed(1)}" stroke-linejoin="round"/>`,
    `<circle cx="${(ox + start.x * k).toFixed(1)}" cy="${(oy + start.y * k).toFixed(1)}" r="3" fill="#e33"/>`,
    `<text x="${ox - PAD + 4}" y="${oy - PAD + 13}">${s} · ${tr.from} · ${m.lap.toFixed(1)} s · fill ${m.fill.toFixed(2)}</text>`);
}
out.push('</svg>');
console.log(out.join('\n'));
