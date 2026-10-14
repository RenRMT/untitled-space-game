'use strict';

// Smoke test for the whole game in Node: `node tests/smoke.js`. Loads every script in the order
// index.html lists them into a stand-in browser (tests/browser-stub.js), then plays: flying in
// every art style and both movement modes, docking and trading, mining, a gate jump, map travel,
// a fight in each combat mode, the settings and a start-style switch. Each step checks its
// effect; at the end nothing may have been drawn at a non-finite position. The steps share one
// game, in order, as a player would play them.

const fs = require('fs');
const vm = require('vm');
const path = require('path');
const assert = require('assert');
const { install } = require('./browser-stub.js');

const ROOT = path.join(__dirname, '..');
const browser = install({ width: 1280, height: 800, dpr: 2, search: '?seed=1' });
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const scripts = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map((m) => m[1]);
for (const file of scripts) vm.runInThisContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), { filename: file });
// Evaluate in the game's own global scope (its top-level consts aren't properties of globalThis).
const game = (src) => vm.runInThisContext(src);

let failed = 0;
function test(name, fn) {
  const t0 = Date.now();
  try {
    fn();
    console.log(`ok   ${name} (${Date.now() - t0} ms)`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${name}\n     ${e.stack.split('\n').slice(0, 4).join('\n     ')}`);
  }
}

// Helpers in the game's scope: find an entity in a list of sectors, and run frames until a
// condition holds (returns whether it did).
game(`
  globalThis.__systemSectors = () => world.galaxy.systems.map((s) => [s.x, s.y]);
  globalThis.__allSectors = () => { const out = []; for (let y = 0; y < world.galaxy.size; y++) for (let x = 0; x < world.galaxy.size; x++) out.push([x, y]); return out; };
  globalThis.__find = (pred, sectors) => {
    for (const [x, y] of sectors) {
      const s = world.sectors.at(x, y);
      const e = s && s.entities.find(pred);
      if (e) { Sectors.pose(e, simTime); return e; }
    }
    return null;
  };
  globalThis.__startStation = () => {
    const g = world.galaxy, s = g.systems[g.startSystem];
    return world.sectors.at(s.x, s.y).entities.filter((e) => e.kind === 'station').sort((a, b) => b.radius - a.radius)[0];
  };
`);
function until(cond, maxFrames, each = '') {
  for (let i = 0; i < maxFrames; i++) {
    if (game(cond)) return true;
    if (each) game(each);
    browser.frames(1);
  }
  return game(cond);
}

test('boots at the start station', () => {
  browser.frames(3);
  assert.ok(game('world.galaxy && world.sectors && world.knowledge'), 'world loaded');
  assert.ok(game('Number.isFinite(ship.x) && Number.isFinite(ship.y)'));
  assert.ok(game('perfStats.posed > 0'), 'entities around the ship');
  assert.ok(browser.draws > 0, 'something was drawn');
});

test('flies in every art style and both movement modes', () => {
  for (const mode of ['cruise', 'direct']) {
    game(`moveMode.set('${mode}')`);
    for (const style of game('ART_STYLES')) {
      game(`artStyle.set('${style}'); ship.targetSpeed = SHIP.maxSpeed * 0.7;`);
      const x0 = game('ship.x'), y0 = game('ship.y');
      for (let i = 0; i < 90; i++) { game('ship.targetAngle += 0.03; ship.targetSpeed = SHIP.maxSpeed * 0.7;'); browser.frames(1); }
      assert.ok(game(`Math.hypot(ship.x - ${x0}, ship.y - ${y0})`) > 100, `moved in ${style} / ${mode}`);
    }
  }
  game(`moveMode.set('cruise'); artStyle.set('line'); ship.targetSpeed = 0; ship.vx = ship.vy = 0;`);
  // The V shortcut cycles the style and says so.
  browser.key('v');
  assert.strictEqual(game('artStyle.value'), 'pixel');
  assert.match(game('toast.text'), /Art style: Pixel/);
  game(`artStyle.set('flat')`);
  browser.frames(5);
});

test('a rebuilt sector finds its sprites again', () => {
  // Beside a station, a star, a planet and an asteroid in turn: the same frame drawn from freshly
  // built sectors (new objects from the same seeds) builds no sprite.
  game('fight.grace = 1e9');
  for (const kind of ['station', 'star', 'planet', 'asteroid']) {
    assert.ok(game(`!!(globalThis.__near = __find((e) => e.kind === '${kind}', __systemSectors()))`), kind);
    game('placeShip(__near.x, __near.y + __near.radius + 100)');
    browser.frames(2);
    game('render()');
    const before = game('Art.stats()');
    game('world.sectors = Sectors.create(world.galaxy, world.cultures, SECTOR); render();');
    const after = game('Art.stats()');
    assert.ok(game(`frameList.some((e) => e.kind === '${kind}' && visible(e))`), `a ${kind} on screen`);
    assert.deepStrictEqual([after.builds, after.asteroidBuilds], [before.builds, before.asteroidBuilds], `near a ${kind}`);
  }
  game('{ const st = __startStation(); placeShip(st.x, st.y + st.radius + 300); }');
  browser.frames(2);
});

test('switching art style spreads the rebuild over frames', () => {
  // Only this style's sprites cached (earlier steps flew in every style), then a tiny budget: one
  // sprite per frame, the others keep their old-style sprite meanwhile.
  game('Art.clearCache(); render(); Art.config.buildBudgetMs = 1e-9;');
  const d0 = game('Art.stats().deferred'), b0 = game('Art.stats().builds');
  game(`artStyle.set('lowpoly')`);
  browser.frames(1);
  assert.strictEqual(game('Art.stats().builds'), b0 + 1, 'one build in the first frame');
  assert.ok(game('Art.stats().deferred') > d0, 'the rest waited');
  let settled = false;
  for (let i = 0; i < 120 && !settled; i++) {
    const d = game('Art.stats().deferred');
    browser.frames(1);
    settled = game('Art.stats().deferred') === d;
  }
  assert.ok(settled, 'every sprite was rebuilt within two seconds');
  game(`Art.config.buildBudgetMs = 4; artStyle.set('flat');`);
  browser.frames(3);
});

test('selects, approaches and docks at a station', () => {
  game(`fight.grace = 1e9; globalThis.__st = __startStation(); placeShip(__st.x, __st.y + __st.radius + 2500);`);
  browser.frames(1);
  game('select(__st); approach(__st);');
  browser.frames(1);
  assert.ok(game('ContextCard.isOpen'), 'the context card shows');
  assert.ok(until('!autopilot.key', 3000), 'the approach finishes');
  assert.ok(game('dockState(__st).ok'), `can dock: ${game('dockState(__st).label')}`);
  game('dock(__st)');
  assert.ok(game('!!docked && StationMenu.isOpen'), 'docked with the station menu open');
  browser.frames(3);
});

test('trades and launches', () => {
  const before = game('({ credits: cargo.credits, items: cargo.items.length })');
  game(`{
    const m = Economy.market(world.galaxy.seed, __st);
    const g = m.goods.filter((x) => x.buy !== null && x.buy <= cargo.credits).sort((a, b) => a.buy - b.buy)[0];
    globalThis.__good = g;
    hold.buy(g.kind, g.buy, Goods.type(g.kind).name);
  }`);
  assert.strictEqual(game('cargo.items.length'), before.items + 1);
  assert.strictEqual(game('cargo.credits'), before.credits - game('__good.buy'));
  assert.ok(game('hold.sell(__good.kind, __good.sell)'));
  assert.strictEqual(game('cargo.items.length'), before.items);
  game('launch()');
  assert.ok(game('!docked && !StationMenu.isOpen'), 'back in space');
  browser.frames(3);
});

test('mines an asteroid and collects what it leaves', () => {
  const found = game(`(globalThis.__rock = __find((e) => e.kind === 'asteroid' && !cargo.mined.has(e.key) && Mining.yieldOf(world.galaxy.seed, e), __systemSectors())) && __rock.key`);
  assert.ok(found, 'an asteroid with a yield');
  game('placeShip(__rock.x, __rock.y + __rock.radius + 60)');
  browser.frames(1);
  game('startMining(__rock)');
  assert.ok(game('mining.target === __rock'), `mining started: ${game('mineState(__rock).label')}`);
  assert.ok(until('cargo.mined.has(__rock.key)', Math.ceil(game('mineTime()') * 60) + 30), 'the asteroid broke up');
  const held = game('cargo.items.length');
  game(`{ const d = cargo.drops.find((e) => e.key === 'drop:' + __rock.key); placeShip(d.x, d.y); }`);
  browser.frames(2);
  assert.strictEqual(game('cargo.items.length'), held + 1, 'the drop was collected');
});

test('jumps through a gate', () => {
  game(`{ const st = __startStation(); globalThis.__gate = world.sectors.at(Math.floor(st.x / SECTOR), Math.floor(st.y / SECTOR)).entities.find((e) => e.kind === 'gate'); }`);
  assert.ok(game('!!__gate'), 'the start system has a gate');
  game('placeShip(__gate.x + __gate.radius + 200, __gate.y)');
  browser.frames(1);
  game('jumpVia(__gate)');
  assert.deepStrictEqual(game('sectorOf(ship.x, ship.y)'), game('[__gate.dest.x, __gate.dest.y]'));
  assert.ok(game('world.knowledge.knowsRoute(__gate.link)'));
  browser.frames(30);
});

test('travels on the galaxy map', () => {
  game('GalaxyMap.open()');
  browser.frames(2);
  assert.ok(game('GalaxyMap.isOpen'));
  // Drag and zoom the map.
  const map = browser.document.getElementById('map-canvas');
  map.dispatch('pointerdown', { pointerId: 7, pointerType: 'mouse', clientX: 600, clientY: 400 });
  for (let i = 1; i <= 10; i++) { map.dispatch('pointermove', { pointerId: 7, pointerType: 'mouse', clientX: 600 + i * 8, clientY: 400 + i * 4 }); browser.frames(1); }
  map.dispatch('pointerup', { pointerId: 7, pointerType: 'mouse', clientX: 680, clientY: 440 });
  map.dispatch('wheel', { deltaY: -200, deltaMode: 0, clientX: 640, clientY: 400 });
  browser.frames(2);
  // To the nearest charted system other than the one we're in.
  game(`{
    const [sx, sy] = sectorOf(ship.x, ship.y);
    const s = world.galaxy.systems.filter((q) => world.knowledge.knowsSystem(q.id) && (q.x !== sx || q.y !== sy))
      .sort((a, b) => Math.hypot(a.x - sx, a.y - sy) - Math.hypot(b.x - sx, b.y - sy))[0];
    globalThis.__dest = s;
    GalaxyMap.hooks.travel({ kind: 'system', id: s.id, x: s.x + 0.5, y: s.y + 0.5, name: s.name });
    GalaxyMap.hooks.fast();
  }`);
  assert.ok(game('world.travel.active'));
  assert.ok(until('!world.travel.active', 3000, 'if (world.travel.prompt) GalaxyMap.hooks.ignore();'), 'the trip ends');
  assert.ok(!game('GalaxyMap.isOpen'), 'the map closes on arrival');
  browser.frames(5);
});

// Somewhere a pirate flies, posed for now, and the ship placed 800 units from it (in attack
// range, outside the range where pirates attack on their own).
function meetPirate() {
  game(`globalThis.__pirate = __find((e) => e.kind === 'ship' && isHostile(e) && !cargo.destroyed.has(e.key), __systemSectors()) || __find((e) => e.kind === 'ship' && isHostile(e) && !cargo.destroyed.has(e.key), __allSectors());`);
  assert.ok(game('!!__pirate'), 'there are pirates somewhere');
  game(`cargo.hull = SHIP.hull; fight.grace = 1e9; { const a = Math.atan2(__pirate.y, __pirate.x); placeShip(__pirate.x + Math.cos(a) * (800 + __pirate.radius), __pirate.y + Math.sin(a) * (800 + __pirate.radius)); }`);
  browser.frames(1);
  game(`fight.grace = 0; { const e = frameList.find((x) => x.key === __pirate.key); engage(e); }`);
  assert.ok(game('!!fight.s'), 'the fight starts');
}

test('fights in rounds to the end', () => {
  game(`combatMode.set('rounds')`);
  meetPirate();
  assert.strictEqual(game('fight.mode'), 'rounds');
  assert.ok(until('!inFight()', 120 * 60), 'the fight ends');
  assert.ok(['won', 'lost', 'fled', null].includes(game('fight.result')));
  browser.frames(300); // the result panel times out
});

test('fights in real time, then gets away', () => {
  game(`combatMode.set('realtime')`);
  meetPirate();
  assert.strictEqual(game('fight.mode'), 'realtime');
  // Fly at the target for a while (the guns fire on their own), then break away.
  const chase = `{ const t = fight.s && fight.ships.get(fight.s.focus); if (t) { ship.targetAngle = Math.atan2(t.y - ship.y, t.x - ship.x); ship.targetSpeed = SHIP.maxSpeed * 0.5; } }`;
  until('!inFight()', 30 * 60, chase);
  const away = `{ const a = fight.s ? Math.atan2(ship.y - fight.s.anchor.y, ship.x - fight.s.anchor.x) : 0; ship.targetAngle = a; ship.targetSpeed = SHIP.maxSpeed; }`;
  assert.ok(until('!inFight()', 120 * 60, away), 'the fight ends');
  game('ship.targetSpeed = 0');
  browser.frames(300);
});

test('settings open, close and switch the start style', () => {
  game('Settings.open()');
  assert.ok(game('Settings.isOpen'));
  browser.frames(3);
  browser.key('Escape');
  assert.ok(!game('Settings.isOpen'), 'Escape closes the menu');
  const seed = game('world.galaxy.seed');
  game(`GalaxyMap.setStartStyle('frontier')`);
  assert.strictEqual(game('world.galaxy.start'), 'frontier');
  assert.strictEqual(game('world.galaxy.seed'), seed);
  browser.frames(30);
  game(`GalaxyMap.setStartStyle('core')`);
  browser.frames(30);
  assert.strictEqual(game('world.galaxy.start'), 'core');
});

test('cargo survives a save and reload', () => {
  const items = game('cargo.items.length'), credits = game('cargo.credits'), mined = game('cargo.mined.size');
  game('saveCargo(); loadCargo(world.galaxy);');
  assert.deepStrictEqual(game('[cargo.items.length, cargo.credits, cargo.mined.size]'), [items, credits, mined]);
});

test('nothing was drawn at a non-finite position', () => {
  assert.deepStrictEqual(browser.badDraws, []);
});

console.log(failed ? `\n${failed} smoke test(s) failed` : '\nall smoke tests passed');
process.exit(failed ? 1 : 0);
