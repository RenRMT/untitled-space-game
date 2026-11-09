// Smoke test for the game as a player gets it: `node tests/smoke-default.js`. tests/smoke.js plays
// with ?pirates&hazards&sites (to keep the switched-off fights, hazards and sites working);
// this one starts the game with no flags at all, in a process of its own (the game's scripts are
// global), and plays the core loop as it ships: the start beside the capital with the gates
// online, no squad and no pirates; docking and trading; mining; landing and taking off;
// restoring a station at the waystation; and a jump through the gate.

import assert from 'node:assert';
import { install } from './browser-stub.js';

const browser = install({ width: 1280, height: 800, dpr: 2, search: '?seed=1' });
const { G } = await import('../src/main.js');
const { Messages } = await import('../src/ui/messages.js');
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

test('a new game: beside the capital in Wedge space, the gates online; no squad', () => {
  browser.frames(3);
  assert.ok(game('world.scene.gates.every((g) => !g.offline)'), 'the gates are online from the start');
  assert.ok(game(`startStation().station.market.type === 'capital' && actions.state('dock', startStation()).inRange`), 'beside the capital, in docking range');
  assert.strictEqual(game('cargo.squad.length'), 0, 'no squad');
  assert.strictEqual(game('world.galaxy.systems[0].faction'), 'wedge', 'the start is Wedge space');
  // Hostiles out in low and lawless security, none in high.
  assert.ok(game('world.galaxy.packs.length') > 0, 'hostile packs');
  assert.ok(game(`world.galaxy.packs.filter((k) => k.system === 0).every((k) => k.tier <= 2)`), 'gentle ones in the start system');
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
  browser.frames(30);
  assert.ok(game('!mine.target'), 'selecting a rock doesn\'t mine it');
  clickCard('mine');
  assert.ok(game('mine.target === __rock'), 'mining, once Mine is pressed');
  assert.ok(until('cargo.removed.has(__rock.key)', 60 * 30), 'the asteroid broke up');
  // The tools stop there: its shards wait to be mined in turn, each by its own Mine.
  browser.frames(60 * 3);
  assert.ok(game('!mine.target'), 'the tools don\'t chain on by themselves');
  const shard = game('shards.filter((e) => e.parent.key === __rock.key).length');
  if (shard) {
    game('select(shards.find((e) => e.parent.key === __rock.key))');
    browser.frames(1);
    clickCard('mine');
    assert.ok(game('!!mine.target && mine.target.shard'), 'a shard mined by hand');
    game('endExtraction(); select(null)');
  }
  // What it left floats where it is: flying over it picks nothing up, dragging it onto the ship does.
  game('globalThis.__drop = cargo.drops.find((e) => e.key === "drop:" + __rock.key); __drop && placeShip(__drop.x, __drop.y)');
  browser.frames(60);
  assert.ok(game('!__drop || cargo.drops.includes(__drop)'), 'not pulled in nor picked up by flying over it');
  game('if (__drop) { placeShip(__drop.x + 400, __drop.y); ship.targetSpeed = 0 }');
  browser.frames(1);
  if (game('!!__drop')) {
    const from = game('worldToScreen(__drop.x, __drop.y)'), to = game('worldToScreen(ship.x, ship.y)'), canvas = browser.document.getElementById('game');
    canvas.dispatch('pointerdown', { pointerId: 9, pointerType: 'touch', button: 0, clientX: from[0], clientY: from[1], timeStamp: 100 });
    canvas.dispatch('pointermove', { pointerId: 9, pointerType: 'touch', clientX: to[0], clientY: to[1] });
    canvas.dispatch('pointerup', { pointerId: 9, pointerType: 'touch', button: 0, clientX: to[0], clientY: to[1], timeStamp: 800 });
    assert.ok(!game('cargo.drops.includes(__drop)'), 'dragged onto the ship, picked up');
    assert.ok(game('cargo.items.length') >= 1, 'something in the hold');
  }
  assert.strictEqual(game('cargo.hull'), game('SHIP.hull'), 'a rock never fires back');
  game('select(null)');
});

test('lands on the terran planet, flies over its surface, and takes off', () => {
  game(`globalThis.__body = __find((e) => e.kind === 'planet' && e.body && e.body.type === 'terran');
    placeBeside(__body); react(nearbyEntities(simTime)); select(__body); react(nearbyEntities(simTime));`);
  clickCard('land');
  assert.ok(until('landing.phase === "surface"', 1500), 'down on the surface');
  const x0 = game('landing.craft.x');
  game('ship.targetAngle = 0; ship.targetSpeed = SHIP.maxSpeed');
  browser.frames(30);
  game('ship.targetSpeed = 0');
  assert.ok(game('landing.craft.x') > x0 + 20, 'flying over the ground');
  game('takeOff()');
  assert.ok(until('!landing.on', 1500), 'back in space');
  assert.ok(game('Math.hypot(ship.x - __body.x, ship.y - __body.y) < __body.body.r * 2.1 + 400'), 'beside the planet');
});

test('the outfitter: gambits, today\'s gear and consumables for credits; the gear stock turns over each day', () => {
  game(`globalThis.__T = Date.UTC(2026, 10, 8, 12); Clock.now = () => __T; cargo.credits = 50000;
    globalThis.__st = startStation(); placeBeside(__st); dock(__st); StationMenu.showTab('outfitter')`);
  assert.ok(game('!!docked && StationMenu.tab === "outfitter"'), 'docked, on the Outfitter tab');
  assert.strictEqual(game('vendor.level'), 1, 'a level 1 outfitter in Wedge space');
  const text = onStation();
  assert.match(text, /Gambits/);
  assert.match(text, /import core\.bool@1\.0/);
  assert.ok(!/import mem\.ext@3\.0/.test(text), 'the best gambits are sold further out');
  // A gambit: bought once, known by the squad's programs from then on.
  assert.ok(!game('logicKnown().has("core.bool")'));
  const credits = game('cargo.credits');
  assert.ok(game('vendor.buyGambit("core.bool")'), 'bought');
  assert.ok(game('logicKnown().has("core.bool") && cargo.gambits.includes("core.bool")'), 'known');
  assert.strictEqual(game('cargo.credits'), credits - game('Vendor.gambitPrice("core.bool")'), 'paid for');
  assert.ok(!game('vendor.buyGambit("core.bool")'), 'only once');
  assert.ok(!game('vendor.buyGambit("core.bool.or")'), 'not sold at level 1');
  // Gear: six pieces, the same all day; one bought goes into the spare gear and is gone from the stock.
  const stock = game('vendor.gear().map((g) => g.spec.id).join()');
  assert.strictEqual(game('vendor.gear().length'), 6);
  assert.ok(game('vendor.gear().every((g) => Loot.RANK[g.spec.rarity] <= Loot.RANK.rare)'), 'nothing above Rare');
  const id = game('vendor.gear()[0].spec.id');
  assert.ok(game('vendor.buyGear(0)') && game(`cargo.gear['${id}'] === 1`), 'bought into the spare gear');
  assert.ok(game('vendor.gear()[0].sold') && !game('vendor.buyGear(0)'), 'sold out for today');
  game('StationMenu.refresh()');
  assert.match(onStation(), /Sold/);
  game('__T += 24 * 3600 * 1000');
  assert.notStrictEqual(game('vendor.gear().map((g) => g.spec.id).join()'), stock, 'a new stock the next day');
  assert.ok(!game('vendor.gear()[0].sold'), 'nothing sold from it yet');
  // A consumable: into the kit; mods at a capital.
  assert.ok(game('vendor.buyKit("repair-nanites")') && game('cargo.kit["repair-nanites"]') >= 1, 'into the kit');
  assert.ok(game('vendor.mods().length') > 0, 'mods at a capital');
  // Saved: gambits owned and what was bought today.
  game('saveCargoNow(); loadCargo(world.galaxy)');
  assert.ok(game('cargo.gambits.includes("core.bool") && !!cargo.shop'), 'survives a reload');
  game('Clock.now = () => Date.now(); launch()');
  browser.frames(2);
});

test('traffic: freighters ply between stations, patrols circle them and join a fight; an elite and a raid, each with its bounty', () => {
  if (game('!!docked')) game('launch()');
  game('placeBeside(startStation()); tickTraffic()');
  assert.strictEqual(game('traffic.sys'), 0, 'the start system\'s traffic');
  assert.ok(game(`traffic.ships.some((e) => e.role === 'freighter')`), 'freighters');
  assert.ok(game(`traffic.ships.some((e) => e.patrol)`), 'a patrol');
  assert.ok(game(`traffic.ships.every((e) => !isHostile(e) && e.name)`), 'friendly, and named');
  const f = game(`(() => { const e = traffic.ships.find((x) => x.role === 'freighter'); return [e.key, e.x, e.y]; })()`);
  game('skipTime(20); tickTraffic()');
  assert.notDeepStrictEqual(game(`(() => { const e = traffic.ships.find((x) => x.key === '${f[0]}'); return [e.key, e.x, e.y]; })()`), f, 'a freighter flies on');
  browser.frames(1);
  assert.ok(game(`frameList.some((e) => e.key && e.key.startsWith('traffic:'))`), 'drawn in the flight view');
  // A patrol near a fight is on your side.
  const specs = game(`(() => { const p = traffic.ships.find((e) => e.patrol); return patrolSpecs({ x: p.x, y: p.y }); })()`);
  assert.ok(specs.length >= 1 && specs.every((a) => a.patrol), 'patrols as allies');
  // In a fight: a pirate engaged by a patrol, which fires on it.
  game(`fight.grace = 0; cargo.hull = SHIP.hull; globalThis.__pp = traffic.ships.find((e) => e.patrol);
    globalThis.__foe = world.scene.entities.find((e) => isHostile(e) && !cargo.removed.has(e.key) && e.tier === 1);
    Scene.pose(__foe, simTime); placeShip(__foe.x + 500, __foe.y); __pp.x = __foe.x + 300; __pp.y = __foe.y + 200;
    react(nearbyEntities(simTime)); engage(__foe)`);
  assert.ok(game('!!fight.s && fight.s.allies.some((a) => a.id === __pp.key && a.patrol)'), 'the patrol fights with you');
  assert.ok(until(`!fight.s || fight.fx.some((f) => f.type === 'beam' && f.from === __pp.key)`, 60 * 30), 'and fires');
  game('if (fight.s) fight.s.over = "fled"');
  browser.frames(3);
  game('fight.grace = 1e9; fight.returning.clear()');
  // An elite in a system of level 2 or more, a tier above its pirates; destroyed: a bounty, rare loot,
  // and another only after a while.
  game(`globalThis.__si = world.galaxy.systems.findIndex((s) => s.level >= 2 && world.galaxy.packs.some((k) => k.system === s.index));
    { const sys = world.galaxy.systems[__si]; placeShip(sys.star.x + 3000, sys.star.y); } tickTraffic()`);
  assert.ok(game('traffic.sys === __si && !!traffic.elite'), 'an elite');
  assert.match(game('traffic.elite.name'), /^[A-Z][a-z]+ /);
  assert.ok(game('isHostile(traffic.elite) && traffic.elite.stats.hull > Loadout.stats(Loadout.npc("fighter", traffic.elite.tier)).hull * 2'), 'hostile, and tough');
  game('globalThis.__cr = cargo.credits; globalThis.__gear = Object.keys(cargo.gear).length; eliteDown(traffic.elite)');
  assert.ok(game('cargo.credits > __cr && Object.keys(cargo.gear).length > __gear'), 'a bounty and loot');
  assert.ok(game('!traffic.elite && cargo.world.elites[__si].at > Clock.now()'), 'gone until it respawns');
  game('tickTraffic()');
  assert.ok(game('!traffic.elite'), 'not straight back');
  // A raid on a station: announced, and beaten off for a bounty.
  game('placeBeside(startStation()); tickTraffic(); cargo.world.raids.next = 1; tickTraffic()');
  assert.ok(game('!!traffic.raid && traffic.raid.ships.length >= 3'), 'raiders');
  assert.match(Messages.log.map((l) => l.text).join('|'), /Raiders are attacking .* · destroy them for a bounty/);
  assert.ok(game('traffic.raid.ships.every((e) => isHostile(e))'));
  game('globalThis.__cr = cargo.credits; for (const k of traffic.raid.keys) cargo.removed.add(k); tickTraffic()');
  assert.ok(game('!traffic.raid && cargo.credits > __cr'), 'the bounty');
  assert.match(Messages.log.map((l) => l.text).join('|'), /is safe · [\d,]+ cr bounty/);
  // Saved: the timers.
  game('saveCargoNow(); loadCargo(world.galaxy)');
  assert.ok(game('cargo.world.elites[__si].at > Clock.now() && cargo.world.raids.n >= 1'), 'survives a reload');
  game('fight.grace = 0; placeBeside(startStation())');
});

test('the main story: chapter 1 at any station from the start; the next waits for its level; a contract is posted again the next day', () => {
  if (game('!!docked')) game('launch()');
  game(`globalThis.__T = Date.UTC(2026, 10, 8, 12); Clock.now = () => __T; dock(startStation()); StationMenu.showTab('missions')`);
  const ch = game(`cargo.board.list.filter((j) => j.tier === 'story').map((j) => j.id)`);
  assert.strictEqual(ch.length, 7, 'seven chapters');
  assert.match(onStation(), /Chapter 1: Papers in order/, 'chapter 1, offered here');
  assert.doesNotMatch(onStation(), /Chapter 2/, 'not chapter 2 yet');
  // Chapter 1 done: chapter 2 shows, waiting for level 4.
  game(`globalThis.__xp = cargo.pilot.xp; cargo.pilot.xp = 0; applyShip(); cargo.missions.accept('${ch[0]}', startStation().key); cargo.missions.finish('${ch[0]}'); StationMenu.refresh()`);
  assert.match(onStation(), /Chapter 2: Overtime/);
  assert.ok(!game(`jobViews(startStation()).find((m) => m.id === '${ch[1]}').accept`), 'not offered yet');
  assert.match(game(`jobViews(startStation()).find((m) => m.id === '${ch[1]}').note`), /Opens at level 4/);
  game(`cargo.pilot.xp = 1e4; applyShip(); StationMenu.refresh()`);
  assert.ok(game(`!!jobViews(startStation()).find((m) => m.id === '${ch[1]}' && m.accept)`), 'offered once the pilot is level 4');
  // A contract handed in today is posted again tomorrow.
  game(`globalThis.__c = cargo.board.list.find((j) => j.tier === 'station' && j.scope === startStation().key && cargo.missions.status(j.id) === 'offered');
    cargo.missions.accept(__c.id, startStation().key); cargo.missions.finish(__c.id); cargo.world.daily[__c.id] = Vendor.day(__T)`);
  game('jobViews(startStation())');
  assert.strictEqual(game('cargo.missions.status(__c.id)'), 'done', 'not again today');
  game('__T += 24 * 3600 * 1000; jobViews(startStation())');
  assert.strictEqual(game('cargo.missions.status(__c.id)'), 'offered', 'posted again the next day');
  game(`cargo.pilot.xp = __xp; applyShip(); Clock.now = () => Date.now(); launch()`);
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
  assert.ok(until('!!fight.s', 120), 'the pirates attack');
  assert.strictEqual(game('fight.s.allies.length'), 1, 'the wingman fights beside you');
  assert.strictEqual(game('fight.mode'), 'rounds', 'turn-based by default');
  // A tap on an enemy targets it.
  if (game('fight.s.enemies.length') > 1) {
    game(`globalThis.__other = fight.s.enemies.find((e) => e.id !== fight.s.focus).id; globalThis.__at = worldToScreen(fighterPos(__other).x, fighterPos(__other).y)`);
    const [x, y] = game('__at'), canvas = browser.document.getElementById('game');
    canvas.dispatch('pointerdown', { pointerId: 5, pointerType: 'touch', button: 0, clientX: x, clientY: y, timeStamp: 100 });
    canvas.dispatch('pointerup', { pointerId: 5, pointerType: 'touch', button: 0, clientX: x, clientY: y, timeStamp: 150 });
    assert.ok(game('fight.s.focus === __other'), 'tapped, targeted');
  }
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
  assert.ok(until(`cargo.drops.some((d) => d.key.startsWith('drop:' + __foe.key)) || cargo.removed.has(__foe.key)`, 30), 'destroyed, its loot floating');
});

test('landing: every planet is a dungeon of guardians, its Warden in the deepest chamber, fought for loot', () => {
  game(`fight.result = null; cargo.hull = SHIP.hull; globalThis.__body = __find((e) => e.kind === 'planet' && e.body && e.body.type === 'desert');
    placeBeside(__body); react(nearbyEntities(simTime)); select(__body); react(nearbyEntities(simTime));`);
  clickCard('land');
  assert.ok(until('landing.phase === "surface"', 1500), 'down');
  assert.ok(game('!!surfaceRun.W.dungeon'), 'a labyrinth');
  assert.strictEqual(game('surfaceRun.W.type'), 'desert', 'cut into the desert world\'s own ground');
  assert.ok(!game('Object.keys(landing).includes("button")') && !browser.document.getElementById('takeoff-btn').listeners.click, 'no Take off button');
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
  assert.ok(!game('(cargo.surfaceDrops[surfaceRun.e.key] || []).some((d) => d.key.includes("loot:"))'), 'its cargo paid as credits, nothing to drag aboard');
  // The way out: off the landing pad, then back onto it.
  game('fight.s && endSurfaceFight(); cargo.hull = SHIP.hull; const W = surfaceRun.W; Object.assign(landing.craft, { x: W.start[0], y: W.start[1] - EXIT.r - EXIT.arm - 40, vx: 0, vy: 0 }); ship.targetSpeed = 0');
  browser.frames(2);
  assert.ok(game('dungeonRun.armed && landing.phase === "surface"'), 'off the pad: flying back onto it leaves');
  game('Object.assign(landing.craft, { x: surfaceRun.W.start[0], y: surfaceRun.W.start[1], vx: 0, vy: 0 })');
  browser.frames(2);
  assert.ok(game('landing.phase === "takeoff" || !landing.on'), 'taking off from the pad');
  assert.ok(until('!landing.on', 1500), 'back in space');
});

test('drops: drawn as their icons; dragged onto the ship, picked up', () => {
  game(`fight.grace = 1e9; cargo.items = []; placeShip(ship.x, ship.y); ship.targetSpeed = 0;
    cargo.drops.push(dropEntity({ key: 'drop:smoke:drag', kind: 'iron', seed: 3, x: ship.x + 400, y: ship.y }))`);
  browser.frames(1);
  // A tap selects it (what it is), and it's drawn as its icon, DROP_PX across.
  const at = game(`worldToScreen(ship.x + 400, ship.y)`), DROP_PX = game('DROP_PX'), cv = browser.document.getElementById('game');
  cv.dispatch('pointerdown', { pointerId: 5, pointerType: 'touch', button: 0, clientX: at[0] + DROP_PX * 0.4, clientY: at[1], timeStamp: 50 });
  cv.dispatch('pointerup', { pointerId: 5, pointerType: 'touch', button: 0, clientX: at[0] + DROP_PX * 0.4, clientY: at[1], timeStamp: 120 });
  browser.frames(1);
  assert.strictEqual(game('selected && selected.key'), 'item:drop:smoke:drag', 'a tap on its icon selects it');
  assert.strictEqual(game('ship.targetSpeed'), 0, 'and doesn\'t fly to it');
  game('select(null)');
  assert.strictEqual(game(`cargo.drops.find((d) => d.key === 'drop:smoke:drag').angle`), game('DROP_ANGLE'), 'held at its icon\'s turn');
  const from = game(`worldToScreen(ship.x + 400, ship.y)`), to = game('worldToScreen(ship.x, ship.y)'), canvas = browser.document.getElementById('game');
  canvas.dispatch('pointerdown', { pointerId: 6, pointerType: 'touch', button: 0, clientX: from[0], clientY: from[1], timeStamp: 200 });
  canvas.dispatch('pointermove', { pointerId: 6, pointerType: 'touch', clientX: (from[0] + to[0]) / 2, clientY: from[1] });
  canvas.dispatch('pointermove', { pointerId: 6, pointerType: 'touch', clientX: to[0], clientY: to[1] });
  assert.strictEqual(game('ship.targetSpeed'), 0, 'carrying a drop doesn\'t steer');
  canvas.dispatch('pointerup', { pointerId: 6, pointerType: 'touch', button: 0, clientX: to[0], clientY: to[1], timeStamp: 900 });
  assert.ok(!game(`cargo.drops.some((d) => d.key === 'drop:smoke:drag')`) && game(`cargo.items.some((it) => it.kind === 'iron')`), 'picked up');
});

test('drops: the same thing lying together is one stack, named when selected, picked up whole', () => {
  game(`cargo.items = []; placeShip(ship.x, ship.y); ship.targetSpeed = 0;
    for (const [i, kind] of ['iron', 'iron', 'iron', 'silicates'].entries()) cargo.drops.push(dropEntity({ key: 'drop:smoke:st' + i, kind, seed: 10 + i, x: ship.x + 400 + i * 3, y: ship.y }))`);
  browser.frames(1);
  assert.strictEqual(game(`stackOf(cargo.drops.find((d) => d.key === 'drop:smoke:st0')).length`), 3, 'the three iron stack');
  assert.strictEqual(game(`stackOf(cargo.drops.find((d) => d.key === 'drop:smoke:st3')).length`), 1, 'the silicates apart');
  assert.ok(game(`underStack(cargo.drops.find((d) => d.key === 'drop:smoke:st1'))`), 'the rest under the top one');
  const at = game('worldToScreen(ship.x + 403, ship.y)');
  game(`select(pickAt(${at[0]}, ${at[1]}))`);
  assert.ok(['item:drop:smoke:st0', 'item:drop:smoke:st3'].includes(game('selected && selected.key')), 'a tap takes a top one');
  game(`select(frameList.find((e) => e.key === 'drop:smoke:st0'))`);
  assert.match(game('describe(selected.e).title'), / ×3$/, 'its card counts the stack');
  game('select(null)');
  // Ship size: drawn larger than a drop's icon at the smallest zoom.
  assert.ok(game('SHIP.radius * PLAYER_DRAW * 1.375 * 2 * 0.55') > game('DROP_PX'), 'the ship outsizes a drop');
  const from = game(`worldToScreen(cargo.drops.find((d) => d.key === 'drop:smoke:st0').x, ship.y)`), to = game('worldToScreen(ship.x, ship.y)'), cv = browser.document.getElementById('game');
  cv.dispatch('pointerdown', { pointerId: 7, pointerType: 'touch', button: 0, clientX: from[0], clientY: from[1], timeStamp: 2000 });
  cv.dispatch('pointermove', { pointerId: 7, pointerType: 'touch', clientX: (from[0] + to[0]) / 2, clientY: from[1] });
  cv.dispatch('pointermove', { pointerId: 7, pointerType: 'touch', clientX: to[0], clientY: to[1] });
  cv.dispatch('pointerup', { pointerId: 7, pointerType: 'touch', button: 0, clientX: to[0], clientY: to[1], timeStamp: 2700 });
  assert.strictEqual(game(`cargo.items.filter((it) => it.kind === 'iron').length`), 3, 'the whole stack picked up');
  assert.ok(game(`cargo.drops.some((d) => d.key === 'drop:smoke:st3')`), 'the silicates left');
  game(`cargo.items = []; cargo.drops = cargo.drops.filter((d) => !d.key.startsWith('drop:smoke'))`);
});

test('settings: combat is turn-based, and not a setting; the hints wait behind the ⓘ', () => {
  assert.strictEqual(game('combatMode.value'), 'rounds');
  game('Settings.open()');
  const body = browser.document.getElementById('settings').querySelector('.set-body');
  const flat = (n) => [n, ...(n.children || []).flatMap((c) => (c && typeof c === 'object' ? flat(c) : []))];
  const all = () => flat(body);
  assert.ok(!all().some((n) => n.attributes && n.attributes['data-option'] === 'combat'), 'no Combat setting');
  assert.ok(!all().some((n) => n.className === 'set-hint'), 'no hints unasked');
  browser.document.getElementById('settings').querySelector('.set-info').dispatch('click');
  assert.ok(all().some((n) => n.className === 'set-hint'), 'the ⓘ shows them');
  game('Settings.close()');
});

test('turrets: round the stations; a friendly one warns before a fight, then its station\'s defence fights back; destroyed, razed, loot', () => {
  game(`fight.result = null; fight.grace = 0; cargo.hull = SHIP.hull; globalThis.__st = world.scene.stations.find((st) => st.turrets.length >= 2 && st.station.owner === 'wedge')`);
  assert.ok(game('!!__st'), 'a Wedge station with turrets');
  assert.ok(game('world.scene.turrets.length > 0'));
  game(`globalThis.__t = __st.turrets[0]; placeShip(__t.x + 500, __t.y); react(nearbyEntities(simTime))`);
  assert.ok(game(`actions.of(__t).some((a) => a.id === 'attack-structure')`), 'Attack on a turret');
  assert.ok(game('!__t.hostile'), 'friendly to start');
  const regard = game(`Reputation.regard(cargo.rep, 'wedge')`);
  game('attackStructure(__t)');
  assert.ok(game('!fight.s'), 'the first press only warns');
  game('attackStructure(__t)');
  assert.ok(game('!!fight.s && fight.ships.has(__t.key)'), 'the fight is on');
  assert.ok(game(`fight.ships.has(__st.key) && __st.turrets.every((t) => fight.ships.has(t.key))`), 'the station and its turrets together');
  assert.ok(game(`Reputation.regard(cargo.rep, 'wedge')`) < regard, 'regard lost');
  const t = game(`(() => { const s = fight.s, c = (id) => s.enemies.find((e) => e.id === id); return { turret: c(__t.key).stats.hull, station: c(__st.key).stats.hull }; })()`);
  assert.ok(t.station > t.turret * 3 && t.turret > game(`Loadout.stats(Loadout.npc('fighter', 1)).hull`) * 3, 'stations tougher than turrets, turrets than ships');
  game(`fight.s.player.invulnerable = true; const c = fight.s.enemies.find((e) => e.id === __t.key); c.hull = 1; c.shield = 0; fight.s.focus = __t.key`);
  assert.ok(until('cargo.razed[__t.key] > 0', 60 * 20), 'the turret destroyed');
  assert.ok(game('isRazed(__t.key) && !nearbyEntities(simTime).includes(__t)'), 'gone until it is rebuilt');
  assert.ok(game(`__t.hostile === false || structureHostile(__st)`), 'the provoked station stays hostile');
  game('endSurfaceFight(); fight.s = null; fight.result = null; setMode("in-combat", false); fight.grace = 30');
  // Rebuilt after its time.
  game('Clock.now = ((n) => () => n + 3 * 3600 * 1000)(Date.now())');
  assert.ok(game('!isRazed(__t.key)'), 'rebuilt');
  game('Clock.now = () => Date.now()');
});

test('loot: a station destroyed drops gear that floats, is picked up into the spare gear, and survives a save', () => {
  game(`globalThis.__st2 = world.scene.stations.find((st) => st !== __st && !st.station.waystation); provoked.add(__st2.key);
    structureDestroyed(__st2)`);
  assert.ok(game('isRazed(__st2.key)'), 'razed');
  assert.ok(game(`!canDock(__st2).ok && /Destroyed/.test(canDock(__st2).reason)`), 'docking refused while it is a wreck');
  // (Earlier fights may have left loot of their own floating: only the station's counts here.)
  game('globalThis.__mine = (d) => d.kind === "loot" && d.key.startsWith(`loot:${__st2.key}:`)');
  const drops = game(`cargo.drops.filter(__mine).length`);
  assert.ok(drops >= 2, 'a station drops two pieces, at least');
  assert.ok(game(`cargo.drops.filter(__mine).every((d) => Loot.RANK[d.rarity] >= Loot.RANK.uncommon)`), 'Uncommon or better');
  game(`const d = cargo.drops.find(__mine); globalThis.__lootId = d.spec.id; placeShip(d.x, d.y); collectItems(nearbyEntities(simTime))`);
  assert.ok(game('cargo.gear[__lootId] === 1 && !!Loadout.EQUIPMENT[__lootId].loot'), 'in the spare gear, as equipment');
  assert.ok(game(`/loot/.test(toast.text)`), 'announced');
  // Whom gear is an upgrade for: a Legendary laser far above the starting gear is one for you; the
  // gear you fly with is none.
  game(`globalThis.__big = Loot.roll(() => 0.5, { level: 5, floor: 'legendary', base: 'laser' }); Loot.register(__big, Loadout.EQUIPMENT)`);
  assert.ok(game(`upgradesFor(__big.id).some((u) => u.member === null && u.gain > 0.1)`), 'an upgrade for you');
  assert.ok(game(`/▲ \\+\\d+% for you/.test(upgradeLine(__big.id))`), game('upgradeLine(__big.id)'));
  assert.ok(game(`upgradesFor(__big.id).find((u) => u.member === null).need > pilotLevel()`), 'not fittable yet: it asks for a higher level');
  assert.ok(game(`Object.values(cargo.loadout.fitted).filter(Boolean).every((id) => !upgradesFor(id).some((u) => u.member === null))`), 'what is fitted is no upgrade on itself');
  game(`takeLoot(__big); lootNotice(Loadout.EQUIPMENT[__big.id])`);
  assert.ok(game(`/▲/.test(toast.text)`), game('toast.text'));
  game(`delete cargo.gear[__big.id]; delete cargo.loot[__big.id]`);
  // Fitted, then saved and read back: the same item.
  game(`const slot = Loadout.slotsOf(cargo.loadout.hull).find((x) => x.type === Loadout.EQUIPMENT[__lootId].slot).id; outfitting.fit(slot, __lootId); applyShip()`);
  assert.ok(game('Object.values(cargo.loadout.fitted).includes(__lootId)'), 'fitted');
  const saved = game('JSON.stringify(ownedLoot())');
  assert.ok(JSON.parse(saved)[game('__lootId')], 'kept with the save');
  game(`const name = Loadout.EQUIPMENT[__lootId].name; delete Loadout.EQUIPMENT[__lootId]; readCargo({ loot: JSON.parse(${JSON.stringify(saved)}), loadout: cargo.loadout }); globalThis.__name = name`);
  assert.ok(game('Loadout.EQUIPMENT[__lootId] && Loadout.EQUIPMENT[__lootId].name === __name'), 'remade from its spec');
});

test('the squad lands with the ship, follows its trail and fights the guardians beside it', () => {
  game(`fight.result = null; cargo.hull = SHIP.hull; repairSquad(); globalThis.__body2 = __find((e) => e.kind === 'planet' && e.body && e.body.type === 'ice');
    placeBeside(__body2); react(nearbyEntities(simTime)); select(__body2); react(nearbyEntities(simTime));`);
  clickCard('land');
  assert.ok(until('landing.phase === "surface"', 1500), 'down');
  assert.ok(game(`activeSquad().length === 1 && Math.hypot(wings.get(cargo.squad[0].id).x - landing.craft.x, wings.get(cargo.squad[0].id).y - landing.craft.y) < 300`), 'the wingman beside the ship');
  assert.ok(game(`dungeonRun.guards.some((g) => g.role === 'turret') && dungeonRun.guards.some((g) => g.role === 'raider')`), 'turrets and raiders');
  assert.ok(game(`dungeonRun.guards.filter((g) => g.role === 'turret').every((g) => g.art.type === 'station-turret')`), 'the turrets are turrets');
  // A guardian roused: the wingman is in the fight.
  game(`globalThis.__g = dungeonRun.guards.find((g) => g.role === 'raider'); cargo.hull = SHIP.hull * 50;
    for (const g of dungeonRun.guards) if (g !== __g) g.alive = false; Object.assign(landing.craft, { x: __g.x + 200, y: __g.y, vx: 0, vy: 0 })`);
  assert.ok(until('!!fight.s && fight.ships.has(__g.key)', 30), 'the raider wakes');
  assert.ok(game('fight.s.allies.length === 1 && !!fight.s.blocked'), 'the squad beside you, the walls in the fight');
  assert.ok(game(`!fight.s.enemies.find((e) => e.id === __g.key).fixed`), 'a raider flies');
  game('fight.s.player.invulnerable = true; for (const a of fight.s.allies) a.invulnerable = true; const c = fight.s.enemies[0]; c.hull = 2; c.shield = 0');
  assert.ok(until('!__g.alive', 60 * 20), 'destroyed');
  game('cargo.hull = SHIP.hull; takeOff()');
  assert.ok(until('!landing.on', 1500), 'back in space');
  assert.ok(game(`Math.hypot(wings.get(cargo.squad[0].id).x - ship.x, wings.get(cargo.squad[0].id).y - ship.y) < 1000`), 'the wingman back in formation in space');
});

test('missions: a siege (waves at the station, its turrets with you) and an assault (a battery destroyed), each paid in gear', () => {
  game(`fight.result = null; fight.grace = 0; cargo.hull = SHIP.hull;
    globalThis.__siege = cargo.board.list.find((j) => j.id.endsWith('/siege') && world.scene.stations.find((st) => st.key === j.steps[0].station.key && st.turrets.length && !isRazed(st.key) && !structureHostile(st)));
    acceptJob(__siege.id, __siege.scope); globalThis.__sst = world.scene.stations.find((st) => st.key === __siege.steps[0].station.key);
    placeShip(__sst.x + __sst.radius + 300, __sst.y)`);
  assert.ok(game('!!__siege && cargo.missions.status(__siege.id) === "active"'), 'a siege accepted');
  const waves = game('__siege.steps[0].waves.length');
  for (let w = 0; w < waves; w++) {
    assert.ok(until('!!fight.s', 60 * 15), `wave ${w + 1} attacks`);
    if (w === 0) assert.ok(game('fight.s.allies.some((a) => a.defender)'), 'the station\'s turrets fight with you');
    game('fight.s.player.invulnerable = true; for (const e of fight.s.enemies) { e.hull = 1; e.shield = 0; }');
    assert.ok(until('!fight.s', 60 * 30), `wave ${w + 1} beaten`);
    game('fight.result = null; fight.grace = 0');
    browser.frames(2);
  }
  assert.ok(until('cargo.missions.status(__siege.id) === "ready"', 60), 'every wave counted (the last blows up a moment after its fatal hit)');
  const gear = game('Object.values(cargo.gear).reduce((a, b) => a + b, 0)');
  game('completeJob(__siege.id)');
  assert.ok(game('Object.values(cargo.gear).reduce((a, b) => a + b, 0)') > gear, 'gear as the reward');
  // A battery: its turrets appear at its point and are counted as they go.
  game(`globalThis.__bat = cargo.board.list.find((j) => j.id.endsWith('/battery') && j.systems.length === 1); acceptJob(__bat.id, __bat.scope);
    const b = __bat.steps[0].base; placeShip(b.x + 3000, b.y); react(nearbyEntities(simTime))`);
  assert.ok(game(`nearbyEntities(simTime).filter((e) => e.kind === 'turret' && e.mission === __bat.id).length === __bat.steps[0].base.turrets.length`), 'its turrets');
  game(`for (const e of nearbyEntities(simTime).filter((x) => x.kind === 'turret' && x.mission === __bat.id)) structureDestroyed(e); tickJobs(0.1)`);
  assert.strictEqual(game('cargo.missions.status(__bat.id)'), 'ready');
  game('completeJob(__bat.id)');
  assert.strictEqual(game('cargo.missions.status(__bat.id)'), 'done');
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
