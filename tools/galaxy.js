// Prints a generated galaxy: every system with its region, who holds it, the factions there, its
// gate links, and its local situations with their mission hooks. For checking what a seed gives.
//   node tools/galaxy.js [seed]     (npm run galaxy -- [seed]); the seed defaults to the game's

import { Factions } from '../src/world/factions.js';
import { Galaxy } from '../src/world/galaxy.js';
import { SYSTEM_CONFIG } from '../src/world/system-config.js';

const arg = process.argv[2];
const seed = arg === undefined ? SYSTEM_CONFIG.seed : /^\d+$/.test(arg) ? Number(arg) : arg;
const g = Galaxy.generate(seed, SYSTEM_CONFIG);
const name = (id) => Factions.get(id).name;

console.log(`Galaxy from seed ${seed}: ${g.systems.length} systems, ${g.links.length} gate links\n`);
for (const s of g.systems) {
  const to = g.links.flatMap(([a, b]) => (a === s.index ? [b] : b === s.index ? [a] : [])).map((i) => g.systems[i].name);
  console.log(`${s.index}. ${s.name} (${s.region.label}${s.branch ? `, ${s.branch}` : ''}) — held by ${s.holder ? name(s.holder) : 'no one'}`);
  console.log(`   gates to: ${to.join(', ')}`);
  console.log(`   factions: ${s.factions.map((f) => `${name(f.id)}${f.hidden ? ' (hidden)' : ''}${f.stations ? ` ×${f.stations}` : ''}`).join(', ')}`);
  console.log(`   stations: ${s.stations.map((st) => `${st.name} [${name(st.owner)}]`).join(', ')}`);
  for (const sit of s.situations) {
    console.log(`   * ${sit.title}: ${sit.text}`);
    for (const h of sit.hooks) console.log(`       - ${name(h.from)}: ${h.text}${h.against ? ` (against ${name(h.against)})` : ''}`);
  }
  console.log('');
}
