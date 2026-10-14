'use strict';

// Node checks for the generators and map travel. No dependencies: `node tests/run.js`.
// Browser scripts are loaded into one shared context, in the same order as index.html.

const fs = require('fs');
const vm = require('vm');
const path = require('path');
const assert = require('assert');

const ROOT = path.join(__dirname, '..');
// Each script runs as its own classic script in Node's global context, then publishes its globals
// the way a browser would, so later scripts can see them.
const ctx = globalThis;
function load(file, names) {
  const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
  vm.runInThisContext(`((require, module) => {${src}\n;${names.map((n) => `globalThis.${n} = ${n};`).join(' ')}\n})();`, { filename: file });
}
load('rng.js', ['hashInt', 'mulberry32', 'seedToInt', 'weightedPick']);
load('data/galaxy-config.js', ['GALAXY_CONFIG']);
load('galaxy.js', ['Galaxy']);
load('art/util.js', ['ArtUtil']);
load('art/culture.js', ['ArtCulture']);
load('art/blueprints.js', ['ArtBlueprints']);
load('art/items.js', ['ArtItems']);
load('sector.js', ['Sectors']);
load('travel.js', ['Travel']);
const { Galaxy, Sectors, ArtCulture, Travel, GALAXY_CONFIG } = ctx;

let failed = 0;
function test(name, fn) {
  const t0 = Date.now();
  try {
    fn();
    console.log(`ok   ${name} (${Date.now() - t0} ms)`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${name}\n     ${e.stack.split('\n').slice(0, 3).join('\n     ')}`);
  }
}

const SEEDS = Array.from({ length: 40 }, (_, i) => i + 1).concat(['abc', 'Untitled']);
const galaxies = new Map(SEEDS.map((s) => [s, Galaxy.generate(s, GALAXY_CONFIG)]));

test('generation is deterministic', () => {
  for (const seed of [1, 'abc']) {
    const a = Galaxy.generate(seed, GALAXY_CONFIG), b = Galaxy.generate(seed, GALAXY_CONFIG);
    assert.deepStrictEqual(
      JSON.stringify({ s: a.systems, o: a.outposts, r: a.routes, f: a.factions }),
      JSON.stringify({ s: b.systems, o: b.outposts, r: b.routes, f: b.factions }),
    );
  }
});

test('every territorial faction holds systems; routes join real systems', () => {
  for (const [seed, g] of galaxies) {
    for (const f of g.factions) {
      if (f.kind === 'network') continue;
      assert(g.systems.some((s) => s.faction === f.id), `seed ${seed}: ${f.name} has no systems`);
    }
    for (const r of g.routes) {
      assert(g.systems[r.a] && g.systems[r.b] && r.a !== r.b, `seed ${seed}: bad route ${JSON.stringify(r)}`);
    }
    assert.strictEqual(g.systems[g.startSystem].capital, true, `seed ${seed}: start is not a capital`);
  }
});

test('every gate has a partner gate at its destination', () => {
  for (const seed of SEEDS.slice(0, 8)) {
    const g = galaxies.get(seed);
    const sectors = Sectors.create(g, ArtCulture.forGalaxy(g), g.sectorUnits);
    for (const s of g.systems) {
      for (const gate of sectors.at(s.x, s.y).entities.filter((e) => e.kind === 'gate')) {
        const there = sectors.at(gate.dest.x, gate.dest.y).entities.find((e) => e.kind === 'gate' && e.link === gate.link);
        assert(there, `seed ${seed}: gate ${gate.link} at ${s.name} has no partner`);
      }
    }
  }
});

test('every sector builds without errors', () => {
  const g = galaxies.get(1);
  const sectors = Sectors.create(g, ArtCulture.forGalaxy(g), g.sectorUnits);
  for (let y = 0; y < g.size; y++) for (let x = 0; x < g.size; x++) sectors.at(x, y);
});

test('save keys differ between galaxies and include the generator version', () => {
  const keys = new Set([...galaxies.values()].map((g) => Galaxy.saveKey(g)));
  assert.strictEqual(keys.size, galaxies.size);
  assert(Galaxy.saveKey(galaxies.get(1)).endsWith(`:v${Galaxy.VERSION}`));
});

// Every sector a segment passes through, found by fine sampling (slow but obviously right).
function sampledCells(a, b) {
  const out = new Set();
  for (let i = 0; i <= 20000; i++) {
    const t = i / 20000;
    out.add(`${Math.floor(a.x + (b.x - a.x) * t)},${Math.floor(a.y + (b.y - a.y) * t)}`);
  }
  out.delete(`${Math.floor(a.x)},${Math.floor(a.y)}`);
  return out;
}

test('map travel enters every sector on its path', () => {
  const entered = [];
  const galaxy = { territoryOf: (x, y) => (entered.push(`${x},${y}`), { zone: 'deep' }), deepSector: () => null };
  const knowledge = { pass() {}, contactState: () => null };
  const r = ctx.mulberry32(7);
  for (let i = 0; i < 500; i++) {
    const a = { x: 10 + r() * 60, y: 10 + r() * 60 }, b = { x: 10 + r() * 60, y: 10 + r() * 60 };
    entered.length = 0;
    const trip = Travel.create(galaxy, knowledge);
    trip.start(a, { kind: 'sector', x: b.x, y: b.y, name: '' });
    while (trip.active) trip.step(0.05);
    const want = sampledCells(a, b);
    const missed = [...want].filter((c) => !entered.includes(c));
    assert.strictEqual(missed.length, 0, `trip ${JSON.stringify([a, b])} skipped ${missed}`);
  }
  // Axis-aligned and corner-crossing lines.
  const cells = (a, b) => Travel.crossings(a, b).map((c) => `${c.x},${c.y}`);
  assert.deepStrictEqual(cells({ x: 0.5, y: 0.5 }, { x: 0.5, y: 3.5 }), ['0,1', '0,2', '0,3']);
  assert.deepStrictEqual(cells({ x: 0.5, y: 0.5 }, { x: 2.5, y: 2.5 }), ['1,1', '2,2']);
  assert.deepStrictEqual(cells({ x: 3.5, y: 1.5 }, { x: 3.5, y: 1.5 }), []);
});

test('a hostile contact on the path interdicts at its sector', () => {
  const galaxy = {
    territoryOf: () => ({ zone: 'deep' }),
    deepSector: (x, y) => (x === 5 && y === 2 ? { type: 'ambush', hostile: true } : null),
  };
  const trip = Travel.create(galaxy, { pass() {}, contactState: () => null });
  trip.start({ x: 0.5, y: 2.5 }, { kind: 'sector', x: 9.5, y: 2.5, name: '' });
  let ev = null;
  while (trip.active && !ev) ev = trip.step(0.1);
  assert.strictEqual(ev && ev.type, 'interdict');
  assert.deepStrictEqual(ev.cell, { x: 5, y: 2 });
  assert(Math.abs(ev.pos.x - 5) < 1e-9, 'interdicted at the sector edge');
});

if (failed) {
  console.log(`\n${failed} test(s) failed`);
  process.exit(1);
}
console.log('\nall tests passed');
