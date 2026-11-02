// Prints a generated galaxy: its arms, every system with its zone, region, gates, planets and
// stations, and the deep-space sites by kind. For checking what a seed gives.
//   node tools/galaxy.js [seed] [--svg file]     (npm run galaxy -- [seed] [--svg file])
// The seed defaults to the game's; --svg also draws the galaxy to that file: its glow and dust
// lanes, the systems (settled ones ringed), the gate links (wormholes dashed) and the sites.

import fs from 'node:fs';
import { DeepSpace } from '../src/world/deep-space.js';
import { Factions } from '../src/world/factions.js';
import { Galaxy } from '../src/world/galaxy.js';
import { SYSTEM_CONFIG } from '../src/world/system-config.js';

const args = process.argv.slice(2);
const svgAt = args.indexOf('--svg');
const svgFile = svgAt >= 0 ? args.splice(svgAt, 2)[1] : null;
const arg = args[0];
const seed = arg === undefined ? SYSTEM_CONFIG.seed : /^\d+$/.test(arg) ? Number(arg) : arg;
const g = Galaxy.generate(seed, SYSTEM_CONFIG);
const name = (id) => Factions.get(id).name;
const k = (n) => `${Math.round(n / 1000)}k`;

console.log(`Galaxy from seed ${seed}: ${g.systems.length} systems (${g.systems.filter((s) => s.settled).length} settled), ${g.links.length} gate links (${g.wormholes.length} wormholes), ${g.sites.length} deep-space sites`);
console.log(`Arms: ${g.arms.map((a) => a.name).join(', ')}; disc radius ${k(g.shape.R)}\n`);
for (const s of g.systems) {
  const to = g.links.flatMap(([a, b]) => (a === s.index ? [b] : b === s.index ? [a] : [])).map((i) => g.systems[i].name);
  const near = g.systems.filter((o) => o !== s).reduce((m, o) => Math.min(m, Math.hypot(o.origin.x - s.origin.x, o.origin.y - s.origin.y)), Infinity);
  console.log(`${s.index}. ${s.name} — ${s.region.label}; ${s.star.cls} star, ${k(Math.hypot(s.origin.x, s.origin.y))} from the centre, nearest system ${k(near)} away`);
  if (to.length) console.log(`   gates to: ${to.join(', ')}`);
  console.log(`   planets: ${s.planets.map((p) => p.type).join(', ')}; nebulae ${s.nebulae.length}; fields ${s.fields.length}`);
  console.log(`   stations: ${s.stations.map((st) => `${st.name} [${name(st.owner)}]`).join(', ') || 'none'}`);
}
console.log('\nDeep space:');
const byKind = new Map();
for (const s of g.sites) byKind.set(s.kind, [...(byKind.get(s.kind) || []), s]);
for (const [kind, list] of byKind) {
  console.log(`  ${DeepSpace.KINDS[kind].label} ×${list.length}${DeepSpace.KINDS[kind].visible ? '' : ' (dark)'}: ${list.map((s) => `${s.name} (${s.zone}${s.parent !== undefined ? `, in ${g.sites[s.parent].name}` : ''})`).join('; ')}`);
}

if (svgFile) {
  const R = g.shape.R * 1.5, N = 150, cell = (2 * R) / N;
  const px = (v) => ((v + R) / (2 * R) * 1000).toFixed(1);
  const sz = (v) => (v / (2 * R) * 1000).toFixed(2);
  const out = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000" width="1000" height="1000"><rect width="1000" height="1000" fill="#05070d"/>`];
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const x = -R + (i + 0.5) * cell, y = -R + (j + 0.5) * cell;
      const d = Math.min(1, g.shape.density(x, y) / 1.3), dust = g.space.dustAt(x, y);
      const a = d * (1 - 0.65 * dust);
      if (a > 0.02) out.push(`<rect x="${px(x - cell / 2)}" y="${px(y - cell / 2)}" width="${sz(cell) * 1.05}" height="${sz(cell) * 1.05}" fill="#b8c8ff" fill-opacity="${(a * 0.55).toFixed(2)}"/>`);
    }
  }
  for (const b of g.space.bubbles) out.push(`<circle cx="${px(b.x)}" cy="${px(b.y)}" r="${sz(b.r)}" fill="none" stroke="#ff9a6a" stroke-opacity="0.3" stroke-dasharray="3 3"/>`);
  for (const [a, b] of g.links) {
    const A = g.systems[a].origin, B = g.systems[b].origin, hole = g.wormholes.some(([x, y]) => x === a && y === b);
    out.push(`<line x1="${px(A.x)}" y1="${px(A.y)}" x2="${px(B.x)}" y2="${px(B.y)}" stroke="${hole ? '#b6a8ff' : '#7df9ff'}" stroke-opacity="0.6" ${hole ? 'stroke-dasharray="6 4"' : ''}/>`);
  }
  for (const s of g.sites) {
    const c = DeepSpace.KINDS[s.kind].color;
    if (s.kind === 'stellar-stream') { out.push(`<polyline points="${s.points.map((p) => `${px(p.x)},${px(p.y)}`).join(' ')}" fill="none" stroke="${c}" stroke-opacity="0.5" stroke-dasharray="1 4"/>`); continue; }
    out.push(`<circle cx="${px(s.x)}" cy="${px(s.y)}" r="${Math.max(1.5, sz(s.r))}" fill="${c}" fill-opacity="${s.r > 20000 ? 0.25 : 0.9}" stroke="${c}" stroke-opacity="0.8" stroke-width="0.6"/>`);
  }
  for (const s of g.systems) {
    out.push(`<circle cx="${px(s.origin.x)}" cy="${px(s.origin.y)}" r="${Math.max(2.5, sz(s.radius))}" fill="${s.index === 0 ? '#7df9ff' : '#ffe9a8'}"/>`);
    if (s.settled) out.push(`<circle cx="${px(s.origin.x)}" cy="${px(s.origin.y)}" r="${Math.max(2.5, sz(s.radius)) + 3}" fill="none" stroke="#ffe9a8" stroke-opacity="0.6"/>`);
    out.push(`<text x="${px(s.origin.x)}" y="${(+px(s.origin.y) + 13).toFixed(1)}" font-size="8" fill="#aab3cc" text-anchor="middle" font-family="sans-serif">${s.name}</text>`);
  }
  out.push('</svg>');
  fs.writeFileSync(svgFile, out.join('\n'));
  console.log(`\nDrawn to ${svgFile}`);
}
