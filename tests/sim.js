// Node checks for Redshift's rules (src/sim/, notes/sim.md): the systems it generates, building and
// production, the horizon and its dilation, the gate and the jump, and the Archive. No dependencies:
// `node tests/sim.js`.

import assert from 'node:assert';
import { SimConfig as C } from '../src/sim/config.js';
import { SimEvents } from '../src/sim/events.js';
import { SimRules as R } from '../src/sim/rules.js';
import { SimStory } from '../src/sim/story.js';
import { SimWorld } from '../src/sim/world.js';
import * as AppSw from '../tools/app-sw.js';

let failed = 0;
function test(name, fn) {
  try { fn(); console.log(`ok   ${name}`); } catch (e) { failed++; console.log(`FAIL ${name}\n  ${e.stack}`); }
}
const meta = () => ({ insight: 0, archive: {} });
const run = (mode = 'endless', seed = 5, m = meta()) => ({ s: R.newRun(mode, m, seed), m });
const rich = (s) => Object.assign(s.res, { m: 5000, v: 5000, cr: 5000, sci: 0 });
const free = (s, pred = () => true) => R.world(s).bodies.filter((b) => b.kind !== 'gate' && !s.stations[b.key] && pred(b));

test('a system is the same from the same seed and terms, and has a gate site last', () => {
  for (const seed of [1, 2, 3, 77, 'abc']) {
    const a = SimWorld.generate(seed, { cultures: R.ALL }), b = SimWorld.generate(seed, { cultures: R.ALL });
    assert.deepStrictEqual(a, b);
    assert.strictEqual(a.bodies[a.bodies.length - 1].kind, 'gate');
    assert.strictEqual(a.gate, a.bodies[a.bodies.length - 1].key);
    assert.ok(a.bodies.some((x) => x.m >= 2) && a.bodies.some((x) => x.v >= 2), 'something to mine and to siphon');
    for (const x of a.bodies) { assert.ok(x.m >= 0 && x.m <= 3 && x.v >= 0 && x.v <= 3); if (x.kind === 'moon') assert.ok(a.bodies.some((p) => p.key === x.parent)); }
  }
});

test('traits only come from cultures in the system', () => {
  for (let seed = 1; seed < 40; seed++) {
    const w = SimWorld.generate(seed, { cultures: ['android'] });
    for (const b of w.bodies) if (b.trait) assert.ok(!C.TRAITS[b.trait].culture, `${b.trait} without its culture`);
  }
});

test('the jump offers near, mid and far systems, the far ones longer-lived', () => {
  const ch = SimWorld.choices(9, 2, { cultures: R.ALL });
  assert.deepStrictEqual(ch.map((t) => t.distance), ['near', 'mid', 'far']);
  const lives = ch.map((t) => SimWorld.generate(t.seed, t).life);
  assert.ok(lives[0] < lives[1] && lives[1] < lives[2], String(lives));
});

test('the horizon fills at the system\'s rate, and time slows past half', () => {
  const { s, m } = run();
  const w = R.world(s);
  const p0 = s.pull;
  R.tick(s, m, 10);
  assert.ok(Math.abs(s.pull - p0 - 1000 / w.life) < 1e-9);
  assert.ok(Math.abs(s.time - 10) < 1e-9, 'no dilation below half');
  s.pull = 75;
  const t0 = s.time;
  R.tick(s, m, 1);
  assert.ok(s.time - t0 < 0.7 && s.time - t0 > 0.6, `${s.time - t0}`);
  assert.strictEqual(C.dilation(100), 0);
});

test('a system is lost when the horizon fills, and nothing runs after', () => {
  const { s, m } = run();
  s.pull = 99.9;
  const ev = R.tick(s, m, 5);
  assert.strictEqual(s.status, 'lost');
  assert.ok(ev.some((e) => e.kind === 'lost'));
  const res = { ...s.res };
  R.tick(s, m, 5);
  assert.deepStrictEqual(s.res, res);
});

test('a mine builds over cycles, then mines its body\'s minerals by its pips', () => {
  const { s, m } = run();
  const b = free(s, (x) => x.m >= 2)[0];
  assert.ok(R.build(s, m, b.key, 'mine'));
  assert.ok(!R.build(s, m, b.key, 'mine'), 'one station a body');
  const before = s.res.m;
  R.tick(s, m, C.STATIONS.mine.build + 0.01);
  assert.ok(!(s.stations[b.key].left > 0), 'built');
  const r = R.rates(s, m).by[b.key];
  assert.ok(Math.abs(r.out.m - C.STATIONS.mine.out.m * b.m) < 1e-9);
  const m0 = s.res.m;
  R.tick(s, m, 10);
  assert.ok(s.res.m - m0 > r.out.m * 10 * 0.99, 'mined');
  assert.ok(s.res.m > before);
});

test('nothing to mine, no mine; no culture, no station', () => {
  const { s, m } = run('story');
  const b = free(s, (x) => x.m === 0)[0];
  if (b) assert.ok(!R.canBuild(s, m, b.key, 'mine').ok);
  assert.ok(!R.canBuild(s, m, free(s)[0].key, 'hub').ok, 'no Block in the first story system');
});

test('ships, upgrades and a hub beside a rig all add to output', () => {
  const { s, m } = run();
  rich(s);
  const w = R.world(s);
  const p = w.bodies.find((b) => b.kind === 'planet' && w.bodies.some((x) => x.parent === b.key && x.m > 0));
  const moon = w.bodies.find((x) => x.parent === p.key && x.m > 0);
  R.build(s, m, moon.key, 'mine');
  R.build(s, m, p.key, 'hub');
  R.tick(s, m, 20);
  const r0 = R.rates(s, m).by[moon.key].out.m;
  assert.ok(R.addShip(s, m, moon.key));
  assert.ok(!R.addShip(s, m, moon.key), 'one slot');
  assert.ok(R.addSlot(s, m, moon.key) && R.addShip(s, m, moon.key));
  assert.ok(R.upgrade(s, m, moon.key));
  const r1 = R.rates(s, m).by[moon.key].out.m;
  assert.ok(Math.abs(r1 - r0 * 2 * C.LEVEL_MUL[1]) < 1e-9, `${r0} -> ${r1}`);
  assert.ok(R.rates(s, m).by[p.key].notes.some(([n]) => n === 'Next to a rig'));
});

test('a hub runs short when what it trades runs out', () => {
  const { s, m } = run();
  rich(s);
  const b = free(s)[0];
  R.build(s, m, b.key, 'hub');
  R.tick(s, m, 20);
  s.res.m = 0; s.res.v = 0;
  const cr = s.res.cr;
  R.tick(s, m, 5);
  assert.ok(s.res.m >= 0 && s.res.v >= 0, 'never below zero');
  assert.ok(s.res.cr - cr < (C.ARK.cr + C.STATIONS.hub.out.cr * 0.5) * 5, 'starved');
});

test('the gate goes up in three paid stages, then overcharges faster near the horizon', () => {
  const { s, m } = run();
  rich(s);
  for (let i = 0; i < C.GATE.length; i++) {
    assert.ok(R.buildGate(s, m));
    assert.ok(!R.buildGate(s, m), 'one stage at a time');
    R.tick(s, m, 40);
  }
  assert.ok(R.gateStatus(s, m).done);
  const c0 = s.gate.charge;
  R.tick(s, m, 10);
  const slow = s.gate.charge - c0;
  s.pull = 90;
  const c1 = s.gate.charge;
  R.tick(s, m, 10);
  assert.ok(s.gate.charge - c1 > slow * 2, 'faster near the horizon');
});

test('the jump banks Insight, keeps the past and leaves everything else behind', () => {
  const { s, m } = run();
  rich(s);
  R.build(s, m, free(s)[0].key, 'lab');
  for (let i = 0; i < C.GATE.length; i++) { R.buildGate(s, m); R.tick(s, m, 40); }
  R.tick(s, m, 400);
  const ins = R.insightNow(s), name = R.world(s).name;
  assert.ok(ins > 0);
  const r = R.jump(s, m, 1);
  assert.ok(r && r.insight >= ins && m.insight === r.insight, 'Insight banked (with any boon)');
  assert.strictEqual(s.past[0].name, name);
  assert.strictEqual(s.escaped, 1);
  assert.deepStrictEqual(s.stations, {});
  assert.strictEqual(s.gate.stage, 0);
  assert.strictEqual(s.res.cr, C.START.cr);
});

test('Archive upgrades are bought with Insight and change every arrival', () => {
  const m = meta();
  m.insight = 100;
  assert.ok(R.buyArchive(m, 'kit'));
  assert.ok(R.buyArchive(m, 'damper'));
  assert.ok(!R.buyArchive(m, 'scanner') || m.archive.scanner === 1);
  const { s } = run('endless', 5, m);
  assert.strictEqual(s.res.m, C.START.m + C.ARCHIVE.kit.start.m);
  const plain = SimWorld.generate(s.terms.seed, { ...s.terms, lifeMul: 1 }).life;
  assert.ok(R.world(s).life > plain);
  assert.ok(m.insight < 100);
});

test('a lost story system can be tried again from its arrival', () => {
  const { s, m } = run('story');
  rich(s);
  R.build(s, m, free(s)[0].key, 'siphon');
  s.pull = 99.99;
  R.tick(s, m, 1);
  assert.strictEqual(s.status, 'lost');
  R.retry(s, m);
  assert.strictEqual(s.status, 'play');
  assert.deepStrictEqual(s.stations, {});
});

test('a request comes from a culture here, and pays when done', () => {
  const { s, m } = run('endless', 21);
  rich(s);
  let o = null;
  for (let i = 0; i < 300 && !o; i++) { const ev = R.tick(s, m, 1); SimEvents.tick(s, m, ev); o = s.offers.find((x) => x.kind === 'request' && x.ask === 'place'); }
  assert.ok(o, 'a place request within 300 cycles');
  assert.ok(R.has(s, o.culture));
  assert.ok(SimEvents.answer(s, m, o.id, 'accept'));
  assert.strictEqual(s.requests.length, 1);
  const before = s.res.cr, ap = s.approval[o.culture];
  assert.ok(R.build(s, m, o.key, o.type));
  for (let i = 0; i < 20; i++) { const ev = R.tick(s, m, 1); SimEvents.tick(s, m, ev); }
  assert.strictEqual(s.requests.length, 0, 'done');
  assert.ok(s.res.cr > before - C.STATIONS[o.type].cost.cr, 'paid');
  if (ap != null) assert.ok(s.approval[o.culture] > ap, 'approval up');
});

test('Drifters rise when security falls short: a rogue station skims until evicted', () => {
  const { s, m } = run('endless', 13);
  rich(s);
  const b = free(s)[0];
  R.build(s, m, b.key, 'mine');
  for (let i = 0; i < 10; i++) R.tick(s, m, 1);
  s.unrest = C.DRIFTERS.at - 0.001;
  let o = null;
  for (let i = 0; i < 5 && !o; i++) { const ev = R.tick(s, m, 1); SimEvents.tick(s, m, ev); o = s.offers.find((x) => x.kind === 'rogue' || x.kind === 'blockade'); }
  assert.ok(o, 'the Drifters act');
  if (o.kind === 'blockade') {
    assert.ok(s.stations[o.key].blocked > 0);
    assert.deepStrictEqual(R.stationRates(s, m, R.world(s), o.key, s.stations[o.key]).out, {});
    assert.ok(SimEvents.answer(s, m, o.id, 'bribe'));
    assert.ok(!s.stations[o.key].blocked);
  } else {
    R.tick(s, m, 10);
    assert.ok(R.rates(s, m).skim > 0, 'skims');
    assert.ok(!SimEvents.answers(s, m, o.id).find((a) => a.id === 'evict').ok, 'no security to evict');
    assert.ok(SimEvents.answer(s, m, o.id, 'parley'));
    assert.ok(s.stations[o.key].outpost);
  }
});

test('an alien visitor\'s offer changes something, for good or ill', () => {
  const { s, m } = run('endless', 17);
  rich(s);
  s.next.alien = 1;
  let o = null;
  for (let i = 0; i < 5 && !o; i++) { const ev = R.tick(s, m, 1); SimEvents.tick(s, m, ev); o = s.offers.find((x) => x.kind === 'alien'); }
  assert.ok(o);
  const before = JSON.stringify([s.pull, s.res, s.stations, s.insightSys, s.effects]);
  assert.ok(SimEvents.answer(s, m, o.id, 'accept'));
  assert.notStrictEqual(JSON.stringify([s.pull, s.res, s.stations, s.insightSys, s.effects]), before);
});

test('the story brings in a culture a system, and its last jump wins', () => {
  const m = meta();
  const s = R.newRun('story', m, 31);
  assert.deepStrictEqual(s.terms.cultures, ['android']);
  for (let ch = 0; ch < SimStory.LAST; ch++) {
    assert.deepStrictEqual(s.terms.cultures, SimStory.CHAPTERS[ch].cultures, `chapter ${ch}`);
    rich(s);
    for (let i = 0; i < C.GATE.length; i++) { R.buildGate(s, m); R.tick(s, m, 40); }
    const ch2 = SimStory.CHAPTERS[ch + 1];
    for (const d of R.choices(s, m)) assert.ok(!d.terms.hazard || ch2.hazards.includes(d.terms.hazard));
    assert.ok(R.jump(s, m, 0));
  }
  assert.ok(R.isFinal(s));
  assert.ok(m.story >= 3 && R.archiveOpen(m), 'the Archive opens with the Shard');
  rich(s);
  for (let i = 0; i < C.GATE.length; i++) { R.buildGate(s, m); R.tick(s, m, 40); }
  const r = R.jump(s, m, 0);
  assert.ok(r.won && s.status === 'won');
});

test('events run on the rules without error over a long game', () => {
  const { s, m } = run('endless', 11);
  rich(s);
  for (let i = 0; i < 600 && s.status === 'play'; i++) {
    const ev = R.tick(s, m, 1);
    SimEvents.tick(s, m, ev);
    for (const o of [...s.offers]) { const a = SimEvents.answers(s, m, o.id).find((x) => x.ok); if (a) SimEvents.answer(s, m, o.id, a.id); }
    if (i % 25 === 0) { const b = free(s)[0]; if (b) for (const t of C.STATION_ORDER) if (R.build(s, m, b.key, t)) break; }
  }
  assert.ok(Number.isFinite(s.res.m) && Number.isFinite(s.res.cr));
});

test('the installed sim keeps every file it loads (sim/sw.js)', () => {
  const files = AppSw.appFiles('sim');
  for (const f of ['./', 'manifest.webmanifest', '../src/sim/main.js', '../src/sim/sim.css', '../src/ui/kit-lowpoly.css', '../src/art/surface.js', '../assets/sim-icon-512.png']) assert.ok(files.includes(f), f);
  assert.ok(!files.some((f) => f.includes('/game/') || f.endsWith('sw.js')), 'nothing of the game, and not the worker itself');
  const { current, wanted } = AppSw.check('sim');
  assert.strictEqual(current, wanted, 'sim/sw.js: the file list is out of date: npm run sim:sw');
});

if (failed) { console.log(`${failed} failed`); process.exit(1); }
