// Smoke test for the game as a player gets it: `node tests/smoke-default.js`. tests/smoke.js plays
// with ?intro&missions&pirates (to keep the switched-off opening, missions and fights working);
// this one starts the game with no flags at all, in a process of its own (the game's scripts are
// global), and plays the core loop as it ships: the start beside the capital with the gates
// online, no squad and no pirates; docking and trading; mining; landing and taking off;
// restoring a station at the waystation; and a jump through the gate.

import assert from 'node:assert';
import { install } from './browser-stub.js';

const browser = install({ width: 1280, height: 800, dpr: 2, search: '?seed=1' });
const { G } = await import('../src/main.js');
const inGame = new Function('__scope', '__src', 'with (__scope) return eval(__src);');
const scope = Object.create(G);
const game = (src) => inGame(scope, src);

let failed = 0;
function test(name, fn) {
  const t0 = process.hrtime.bigint(); // (Date.now runs with the game's frames: browser-stub.js)
  try {
    fn();
    console.log(`ok   ${name} (${(process.hrtime.bigint() - t0) / 1000000n} ms)`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${name}\n     ${e.stack.split('\n').slice(0, 4).join('\n     ')}`);
  }
}
function until(cond, maxFrames) {
  for (let i = 0; i < maxFrames; i++) {
    if (game(cond)) return true;
    browser.frames(1);
  }
  return game(cond);
}
function clickCard(id) {
  const button = { disabled: false, dataset: { id } };
  browser.document.getElementById('context').querySelector('.cx-actions').dispatch('click', { target: { closest: () => button } });
}
const textOf = (el) => (el === null || el === undefined ? '' : typeof el !== 'object' ? String(el) : (el.textContent || '') + (el.children || []).map(textOf).join(''));
const allOf = (el) => (el && typeof el === 'object' ? [el, ...(el.children || []).flatMap(allOf)] : []);
const stationParts = () => [browser.document.getElementById('st-body'), browser.document.getElementById('st-layer')];
const onStation = () => stationParts().map(textOf).join('');
function pressOnStation(label) {
  const b = stationParts().flatMap(allOf).find((el) => el.tagName === 'BUTTON' && (typeof label === 'string' ? textOf(el) === label : label.test(textOf(el))));
  assert.ok(b, `a ${label} button`);
  b.dispatch('click', {});
}
game(`globalThis.__find = (pred) => {
  const e = world.scene.entities.filter(pred).sort((a, b) => Math.hypot(a.x - ship.x, a.y - ship.y) - Math.hypot(b.x - ship.x, b.y - ship.y))[0] || null;
  if (e) Scene.pose(e, simTime);
  return e;
};`);

test('a new game: beside the capital in Wedge space, the gates online; no introduction, missions or squad', () => {
  browser.frames(3);
  assert.ok(game('!intro.on && !missionsOn && !opening()'), 'straight into the game');
  assert.ok(game('gatesOnline()'), 'the gates are online from the start');
  assert.ok(game(`startStation().station.market.type === 'capital' && actions.state('dock', startStation()).inRange`), 'beside the capital, in docking range');
  assert.strictEqual(game('cargo.squad.length'), 0, 'no squad');
  assert.strictEqual(game('world.galaxy.systems[0].faction'), 'wedge', 'the start is Wedge space');
  // Hostiles out in low and lawless security, none in high.
  assert.ok(game('world.galaxy.packs.length') > 0, 'hostile packs');
  assert.ok(game(`world.galaxy.packs.filter((k) => k.system === 0).every((k) => k.tier <= 2)`), 'gentle ones in the start system');
  assert.strictEqual(game('hazardsOn'), false, 'no hazards');
  assert.deepStrictEqual(game('stationLocks().tabs'), [], 'no station services locked');
  assert.ok(game('hudShown()'), 'the HUD shows');
});

test('docks at the capital, buys and sells a good, and launches', () => {
  game('dock(startStation())');
  assert.ok(game('!!docked && StationMenu.isOpen'), 'docked');
  const before = game('({ credits: cargo.credits, items: cargo.items.length })');
  game(`{ const m = marketAt(startStation()), g = m.goods.filter((x) => x.buy !== null && x.buy <= cargo.credits).sort((a, b) => a.buy - b.buy)[0];
    globalThis.__good = g; hold.buy(g.kind, g.buy, Goods.type(g.kind).name); }`);
  assert.deepStrictEqual(game('[cargo.items.length, cargo.credits]'), [before.items + 1, before.credits - game('__good.buy')]);
  assert.ok(game('hold.sell(__good.kind, __good.sell)'));
  assert.strictEqual(game('cargo.items.length'), before.items);
  game('launch()');
  assert.ok(game('!docked && !StationMenu.isOpen'), 'back in space');
});

test('mines an asteroid with the starting tools and keeps what it drops', () => {
  assert.ok(game(`!!(globalThis.__rock = __find((e) => e.kind === 'asteroid' && !e.site && Mining.yieldOf(world.galaxy.seed, e) && !cargo.removed.has(e.key)))`), 'an asteroid with a yield');
  game('cargo.items = []; placeShip(__rock.x, __rock.y + __rock.radius + 60); select(__rock)');
  browser.frames(1);
  clickCard('mine');
  assert.ok(game('extracting() && fight.ships.has(__rock.key)'), 'mining');
  assert.ok(until('cargo.removed.has(__rock.key)', 60 * 30), 'the asteroid broke up');
  // The tools chain on through its shards; what it all left is pulled in and collected.
  assert.ok(until('!shards.some((e) => e.parent.key === __rock.key)', 60 * 20), 'every shard broken');
  game('endExtraction()');
  assert.ok(until('!cargo.drops.some((e) => e.key.startsWith("drop:" + __rock.key))', 60 * 3), 'the drops pulled in');
  assert.ok(game('cargo.items.length') >= 1, 'something in the hold');
  assert.strictEqual(game('cargo.hull'), game('SHIP.hull'), 'a rock never fires back');
  game('select(null)');
});

test('lands on the terran planet, flies over its surface, and takes off', () => {
  game(`globalThis.__body = __find((e) => e.kind === 'planet' && e.body && e.body.type === 'terran'); cargo.fuel = SHIP.fuel;
    placeBeside(__body); react(nearbyEntities(simTime)); select(__body); react(nearbyEntities(simTime));`);
  clickCard('land');
  assert.ok(until('landing.phase === "surface"', 1500), 'down on the surface');
  const x0 = game('landing.craft.x');
  game('while (Hazards.dust(surfaceRun.site, simTime)) skipTime(1); ship.targetAngle = 0; ship.targetSpeed = SHIP.maxSpeed');
  browser.frames(30);
  game('ship.targetSpeed = 0');
  assert.ok(game('landing.craft.x') > x0 + 20, 'flying over the ground');
  game('takeOff()');
  assert.ok(until('!landing.on', 1500), 'back in space');
  assert.ok(game('Math.hypot(ship.x - __body.x, ship.y - __body.y) < __body.body.r * 2.1 + 400'), 'beside the planet');
});

test('at the waystation, goods and credits restore the first station', () => {
  game(`globalThis.__T = Date.now(); Clock.now = () => __T;
    globalThis.__way = world.galaxy.stations[world.galaxy.waystation];
    globalThis.__wayAt = __find((e) => e.kind === 'station' && e.key === __way.key);
    placeBeside(__wayAt); dock(__wayAt); StationMenu.showTab('industry')`);
  assert.ok(game('!!docked'), 'docked at the waystation');
  assert.match(onStation(), /Restoration0\/\d+/, 'nothing restored yet');
  const first = game('Restoration.LIST[0]');
  game(`for (const [k, n] of Object.entries(Restoration.LIST[0].goods)) Industry.deposit(cargo.industry, __way.key, k, n, industry.env(), __T);
    cargo.credits = Math.max(cargo.credits, Restoration.LIST[0].credits); StationMenu.refresh()`);
  pressOnStation('Restore');
  assert.deepStrictEqual(game('cargo.restored'), [first.id]);
  game('Clock.now = () => Date.now(); launch()');
  browser.frames(2);
});

test('the gate jumps the ship to the next system, with no story step first', () => {
  game(`globalThis.__gate = world.scene.gates.find((g) => !g.gate.wormhole && g.gate.system === 0); globalThis.__there = world.scene.gates[__gate.gate.link];
    select(null); placeShip(__gate.x, __gate.y + __gate.radius + 120)`);
  browser.frames(2);
  assert.ok(game(`actions.state('jump', __gate).ok`), `can jump: ${game(`actions.state('jump', __gate).label`)}`);
  game('select(__gate)');
  browser.key('j');
  assert.ok(until('!warp.on', 60 * 3), 'the jump is over');
  assert.strictEqual(game('world.galaxy.systemAt(ship.x, ship.y).index'), game('__there.gate.system'), 'in the other system');
});

test('classes: the ship is a DPS to start, and turns Tank or Healer at a dock, its stats following', () => {
  assert.strictEqual(game('cargo.cls'), 'dps');
  const dpsFire = game('SHIP.firepower');
  game(`placeBeside(startStation()); dock(startStation()); StationMenu.showTab('ship')`);
  assert.ok(game('!!docked'), 'docked');
  assert.match(onStation(), /Your class/);
  game(`programs.setPlayerClass('tank')`);
  assert.ok(game('SHIP.hull') > game('Loadout.stats(cargo.loadout).hull') && game('SHIP.firepower') < dpsFire, 'a Tank is sturdier and hits softer');
  game(`programs.setPlayerClass('dps')`);
  assert.strictEqual(game('SHIP.cls'), 'dps');
});

test('the squad: a wingman hired at a dock, its class program using its skills', () => {
  game(`cargo.credits = 10000; StationMenu.showTab('ship')`);
  assert.match(onStation(), /Hire a wingman/);
  pressOnStation(/^Hire Healer/);
  assert.strictEqual(game('cargo.squad.length'), 1, 'hired');
  assert.strictEqual(game('cargo.squad[0].cls'), 'healer');
  assert.ok(game(`cargo.squad[0].program.some((l) => l.act === 'use' && l.skill === 'repair-beam' && l.on && !l.err)`), 'its program uses a repair beam');
  game(`programs.setClass(cargo.squad[0].id, 'tank')`);
  assert.ok(game(`Squad.stats(cargo.squad[0]).hull > Loadout.stats(cargo.squad[0].loadout).hull`), 'a Tank wingman');
  game(`programs.setClass(cargo.squad[0].id, 'healer'); launch()`);
  browser.frames(2);
});

test('a fight with hostiles: skills activate, then cool down; the healer wingman repairs; loot drops', () => {
  game(`globalThis.__foe = __find((e) => e.kind === 'ship' && e.pirate && e.tier === 1 && !cargo.removed.has(e.key) && world.galaxy.securityAt(e.x, e.y) < 2);
    placeShip(__foe.x + 300, __foe.y); snapWings()`);
  assert.ok(until('!!fight.s && !fight.extract', 120), 'the pirates attack');
  assert.strictEqual(game('fight.s.allies.length'), 1, 'the wingman fights beside you');
  game('for (const e of fight.s.enemies) { e.stats = { ...e.stats, hull: e.stats.hull * 6 }; e.hull = e.stats.hull; }'); // long enough to see it all
  assert.ok(game(`skillButtons(fight.s).length === 3`), 'three skill buttons');
  game(`fight.s.player.hull = fight.s.player.stats.hull * 0.5`);
  browser.key('1'); // overload
  assert.ok(game(`fight.s.player.casting && fight.s.player.casting.id === 'overload'`), 'activating');
  assert.ok(until(`!fight.s || Abilities.has(fight.s.player, 'overload', fight.s.t)`, 60), 'overload on once activated');
  if (game('!!fight.s')) assert.ok(game(`fight.s.player.cooldowns.overload > fight.s.t`), 'and cooling down');
  assert.ok(until(`fight.s.player.hull > fight.s.player.stats.hull * 0.5 + 1`, 60 * 10), 'the healer repairs you');
  game('fight.s.player.invulnerable = true; for (const e of fight.s.enemies) { e.hull = Math.min(e.hull, 3); e.shield = 0; }');
  assert.ok(until('!fight.s', 60 * 90), 'the fight is over');
  assert.strictEqual(game('fight.result'), 'won');
  assert.ok(game(`cargo.drops.some((d) => d.key.startsWith('drop:' + __foe.key))`) || game(`cargo.removed.has(__foe.key)`), 'destroyed, its loot floating');
});

test('landing: every planet is a dungeon of guardians, its Warden in the deepest chamber, fought for loot', () => {
  game(`fight.result = null; cargo.hull = SHIP.hull; globalThis.__body = __find((e) => e.kind === 'planet' && e.body && e.body.type === 'desert');
    placeBeside(__body); react(nearbyEntities(simTime)); select(__body); react(nearbyEntities(simTime));`);
  clickCard('land');
  assert.ok(until('landing.phase === "surface"', 1500), 'down');
  assert.ok(game('!!surfaceRun.W.dungeon'), 'a labyrinth');
  assert.ok(game('dungeonRun.guards.filter((g) => g.boss).length === 1 && dungeonRun.guards.length > 3'), 'guardians and one Warden');
  // Straight to the Warden (god mode for the test: the hull doesn't matter here).
  game(`globalThis.__boss = dungeonRun.guards.find((g) => g.boss); fight.s && endSurfaceFight();
    for (const g of dungeonRun.guards) if (!g.boss) g.alive = false;
    Object.assign(landing.craft, { x: __boss.x + 250, y: __boss.y, vx: 0, vy: 0 }); cargo.hull = SHIP.hull * 50;`);
  assert.ok(until('!!fight.s && fight.ships.has(__boss.key)', 30), 'the Warden wakes');
  game(`fight.s.player.invulnerable = true; const b = fight.s.enemies.find((e) => e.id === __boss.key); b.hull = 5; b.shield = 0;`);
  const gear = game('Object.values(cargo.gear).reduce((a, b) => a + b, 0)'), credits = game('cargo.credits');
  assert.ok(until('!__boss.alive', 60 * 20), 'the Warden destroyed');
  assert.ok(game('dungeonRun.bossDown'));
  assert.ok(game('Object.values(cargo.gear).reduce((a, b) => a + b, 0)') > gear, 'gear looted');
  assert.ok(game('cargo.credits') > credits, 'a bounty');
  assert.ok(game('(cargo.surfaceDrops[surfaceRun.e.key] || []).some((d) => d.key.includes("loot:"))'), 'loot lying on the ground');
  game('cargo.hull = SHIP.hull; takeOff()');
  assert.ok(until('!landing.on', 1500), 'back in space');
});

test('the galaxy: three territories joined inside by gates, one link between each pair; outside and alien systems', () => {
  const r = game(`(() => {
    const g = world.galaxy, f = (i) => g.systems[i].faction;
    const cross = g.links.filter(([a, b]) => f(a) !== f(b));
    return { factions: [...new Set(g.systems.map((s) => s.faction))].sort(), cross: cross.length, outsideGated: g.links.some(([a, b]) => !['wedge', 'block', 'shard'].includes(f(a)) || !['wedge', 'block', 'shard'].includes(f(b))) };
  })()`);
  assert.deepStrictEqual(r.factions, ['alien', 'android', 'block', 'drifter', 'shard', 'wedge']);
  assert.strictEqual(r.cross, 3);
  assert.strictEqual(r.outsideGated, false);
});

test('nothing was drawn at a non-finite position', () => {
  assert.deepStrictEqual(browser.badDraws, []);
});

console.log(failed ? `\n${failed} default-game smoke test(s) failed` : '\nall default-game smoke tests passed');
process.exit(failed ? 1 : 0);
