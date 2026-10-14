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
// A click on one of the context card's buttons, as the card's click handler sees it.
function clickCard(id) {
  const button = { disabled: false, dataset: { id } };
  browser.document.getElementById('context').querySelector('.cx-actions').dispatch('click', { target: { closest: () => button } });
}
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
  assert.ok(game(`actions.state('dock', __st).ok`), `can dock: ${game(`actions.state('dock', __st).label`)}`);
  browser.key('f'); // the Dock shortcut, on the selected station
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
  // Menu icons keep their own image, not sprites in the flight view's cache.
  const built = game('Art.stats().builds');
  assert.ok(game(`ItemIcons.url(__good.kind, 'lowpoly', 113).startsWith('data:')`));
  assert.strictEqual(game('Art.stats().builds'), built, 'an icon leaves the sprite cache alone');
  game('launch()');
  assert.ok(game('!docked && !StationMenu.isOpen'), 'back in space');
  browser.frames(3);
});

test('researches with components and goods, then buys, fits and sells gear, and buys a hull', () => {
  game(`fight.grace = 1e9; globalThis.__cap = __find((e) => e.kind === 'station' && e.market.type === 'capital', __systemSectors());
    placeShip(__cap.x, __cap.y + __cap.radius + 150);`);
  browser.frames(1);
  game('dock(__cap)');
  assert.ok(game('!!docked && StationMenu.isOpen'), 'docked at a capital');
  // Every tab draws, with slot choices open on the Ship tab.
  for (const t of ['research', 'ship', 'trade']) game(`StationMenu.showTab('${t}')`);
  game(`StationMenu.showTab('ship'); StationMenu.toggleSlot('weapon-2'); StationMenu.showTab('trade')`);
  // What Pulse laser Mk II costs, put aboard: components to their store, goods to the hold.
  const give = (id) => game(`for (const c of lab.status('${id}').cost) {
    if (Goods.isSalvage(c.kind)) cargo.components[c.kind] = c.need;
    else for (let i = 0; i < c.need; i++) cargo.items.push({ kind: c.kind, label: Goods.type(c.kind).name, category: 'trade' });
  }`);
  assert.strictEqual(game(`lab.status('pulse-laser-2').ok`), false, 'nothing to research with yet');
  give('pulse-laser-2');
  const held = game('cargo.items.length');
  assert.ok(game(`lab.research('pulse-laser-2')`));
  assert.ok(game(`cargo.research.has('pulse-laser-2') && !cargo.components['weapon-simple']`), 'researched, components used up');
  assert.strictEqual(game('cargo.items.length'), held - game(`Research.NODES['pulse-laser-2'].cost.titanium`), 'the trade goods were used up');
  game(`StationMenu.showTab('research')`);
  // Buy and fit it in the empty hardpoint, then swap out the old laser and sell it.
  game('cargo.credits = 5000');
  const fp = game('SHIP.firepower');
  assert.ok(game(`outfitting.fit('weapon-2', 'pulse-laser-2', true)`));
  assert.strictEqual(game('cargo.credits'), 5000 - game(`Loadout.EQUIPMENT['pulse-laser-2'].price`));
  assert.ok(game('SHIP.firepower') > fp && game('SHIP.weaponsFitted') === 2, 'the ship fires harder');
  assert.ok(!game(`outfitting.fit('weapon-1', 'pulse-laser-3', true)`), 'unresearched gear is not for sale');
  assert.ok(game(`outfitting.fit('weapon-1', 'pulse-laser-2', true)`));
  assert.strictEqual(game(`cargo.gear['pulse-laser-1']`), 1, 'the old laser is spare gear');
  const credits = game('cargo.credits');
  assert.ok(game(`outfitting.sell('pulse-laser-1')`));
  assert.strictEqual(game('cargo.credits'), credits + game(`outfitting.sellPrice('pulse-laser-1')`));
  // A hull upgrade raises the hull at once, damage and all.
  give('armour-1');
  game('cargo.hull = SHIP.hull - 30');
  const maxHull = game('SHIP.hull');
  assert.ok(game(`lab.research('armour-1')`));
  assert.strictEqual(game('SHIP.hull'), Math.round(120 * 1.15));
  assert.strictEqual(game('cargo.hull'), game('SHIP.hull') - 30, `hull rose with the maximum from ${maxHull}`);
  // The shipyard: a Corvette, the Courier traded in, the gear moved across, the new hull undamaged.
  game('cargo.credits = 20000');
  assert.ok(game(`outfitting.hullBlocked('corvette') === null`), game(`outfitting.hullBlocked('corvette')`));
  const art = game('ship.art.id');
  assert.ok(game(`outfitting.buyHull('corvette')`));
  assert.strictEqual(game('cargo.credits'), 20000 - (16000 - 2000));
  assert.deepStrictEqual(game('[SHIP.name, SHIP.weaponSlots, SHIP.weaponsFitted, cargo.hull === SHIP.hull]'), ['Corvette', 3, 2, true]);
  assert.notStrictEqual(game('ship.art.id'), art, 'drawn as the new hull');
  // A Hauler has one hardpoint: the second laser goes to spare gear.
  game('cargo.credits = 20000');
  assert.ok(game(`outfitting.buyHull('hauler')`));
  assert.deepStrictEqual(game(`[SHIP.weaponsFitted, cargo.gear['pulse-laser-2']]`), [1, 1]);
  game(`StationMenu.showTab('ship')`);
  // All of it survives a save and reload.
  const before = game('JSON.stringify([cargo.loadout, cargo.gear, [...cargo.research], cargo.components, SHIP.hull, SHIP.cargo])');
  game('saveCargoNow(); loadCargo(world.galaxy)');
  assert.strictEqual(game('JSON.stringify([cargo.loadout, cargo.gear, [...cargo.research], cargo.components, SHIP.hull, SHIP.cargo])'), before);
  // Back to a Courier for the rest of the run.
  game(`cargo.credits = 20000; outfitting.buyHull('courier'); cargo.items = cargo.items.slice(0, 10); launch()`);
  assert.ok(game('!docked && SHIP.name === "Courier"'));
  browser.frames(3);
});

test('components go to their own store, even with a full hold, and stay when the ship is lost', () => {
  game(`cargo.items = Array.from({ length: SHIP.cargo }, () => ({ kind: 'iron', label: 'Iron', category: 'trade' }));
    globalThis.__had = cargo.components['hull-simple'] || 0;
    cargo.drops.push(dropEntity({ key: 'drop:smoke:c', kind: 'hull-simple', seed: 5, x: ship.x, y: ship.y }));
    cargo.drops.push(dropEntity({ key: 'drop:smoke:g', kind: 'titanium', seed: 6, x: ship.x, y: ship.y }));`);
  browser.frames(2);
  assert.strictEqual(game(`cargo.components['hull-simple']`), game('__had') + 1, 'the component was picked up');
  assert.strictEqual(game('cargo.items.length'), game('SHIP.cargo'), 'the hold is still full');
  assert.ok(game(`cargo.drops.some((d) => d.key === 'drop:smoke:g')`), 'the trade good is left floating');
  const components = game('JSON.stringify(cargo.components)');
  game('playerDestroyed(); towHome();');
  assert.strictEqual(game('cargo.items.length'), 0, 'the hold spilled');
  assert.strictEqual(game('JSON.stringify(cargo.components)'), components, 'the components are kept');
  game(`cargo.drops = cargo.drops.filter((d) => !d.key.startsWith('lost:') && !d.key.startsWith('drop:smoke'))`);
  browser.frames(3);
});

test('mines an asteroid and collects what it leaves', () => {
  const found = game(`(globalThis.__rock = __find((e) => e.kind === 'asteroid' && !cargo.removed.has(e.key) && Mining.yieldOf(world.galaxy.seed, e), __systemSectors())) && __rock.key`);
  assert.ok(found, 'an asteroid with a yield');
  game('placeShip(__rock.x, __rock.y + __rock.radius + 60)');
  browser.frames(1);
  // Select it and press the context card's Mine button.
  game('select(__rock)');
  browser.frames(1);
  assert.deepStrictEqual(game('describe(__rock).actions.map((a) => a.id)'), ['mine']);
  clickCard('mine');
  assert.ok(game('mining.target === __rock'), `mining started: ${game(`actions.state('mine', __rock).label`)}`);
  assert.match(game('describe(__rock).actions[0].label'), /^Mining · \d+ sec$/);
  assert.ok(until('cargo.removed.has(__rock.key)', Math.ceil(game('mineTime()') * 60) + 30), 'the asteroid broke up');
  const held = game('cargo.items.length');
  game(`{ const d = cargo.drops.find((e) => e.key === 'drop:' + __rock.key); placeShip(d.x, d.y); }`);
  browser.frames(2);
  assert.strictEqual(game('cargo.items.length'), held + 1, 'the drop was collected');
});

test('builds the sectors past an edge ahead of time, one a frame', () => {
  // Near the east edge of a sector in the middle of the galaxy: the column two sectors east comes
  // into the 3×3 around the camera once the ship crosses, so it is built beforehand.
  game(`globalThis.__grace = fight.grace; fight.grace = 1e9; globalThis.__c = Math.floor(world.galaxy.size / 2);
    globalThis.__ahead = () => [-1, 0, 1].filter((d) => !world.sectors.has(__c + 2, __c + d)).length;`);
  game('placeShip((__c + 0.9) * SECTOR, (__c + 0.5) * SECTOR)');
  browser.frames(1);
  let left = game('__ahead()');
  for (let i = 0; i < 3; i++) {
    browser.frames(1);
    const now = game('__ahead()');
    assert.ok(left - now <= 1, 'at most one sector is built ahead per frame');
    left = now;
  }
  assert.strictEqual(left, 0, 'the sectors past the edge are built');
  game('fight.grace = __grace');
});

test('an off-screen gate gets an edge marker, and a tap on it selects the gate', () => {
  game(`{ const st = __startStation(); globalThis.__gate = world.sectors.at(Math.floor(st.x / SECTOR), Math.floor(st.y / SECTOR)).entities.find((e) => e.kind === 'gate'); }`);
  game('select(null); placeShip(__gate.x + 3000, __gate.y)');
  browser.frames(2);
  const m = game('navHits.find((h) => h.ref === __gate)');
  assert.ok(m, 'the gate has a marker');
  const canvas = browser.document.getElementById('game');
  canvas.dispatch('pointerdown', { pointerId: 3, pointerType: 'touch', button: 0, clientX: m.x, clientY: m.y });
  canvas.dispatch('pointerup', { pointerId: 3, pointerType: 'touch', button: 0, clientX: m.x, clientY: m.y });
  assert.strictEqual(game('selected && selected.e'), game('__gate'), 'the tap selected the gate');
  game('select(null)');
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
  const rebuilds = () => game('GalaxyMap.stats.rebuilds');
  const before = rebuilds();
  map.dispatch('pointerdown', { pointerId: 7, pointerType: 'mouse', clientX: 600, clientY: 400 });
  for (let i = 1; i <= 10; i++) { map.dispatch('pointermove', { pointerId: 7, pointerType: 'mouse', clientX: 600 + i * 8, clientY: 400 + i * 4 }); browser.frames(1); }
  assert.strictEqual(rebuilds(), before, 'a drag moves the map\'s layer rather than redrawing it');
  map.dispatch('pointerup', { pointerId: 7, pointerType: 'mouse', clientX: 680, clientY: 440 });
  browser.frames(1);
  assert.strictEqual(rebuilds(), before + 1, 'the layer is redrawn once the drag ends');
  map.dispatch('wheel', { deltaY: -200, deltaMode: 0, clientX: 640, clientY: 400 });
  browser.frames(2);
  assert.strictEqual(rebuilds(), before + 1, 'and is not redrawn while the wheel turns');
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
  game(`globalThis.__pirate = __find((e) => e.kind === 'ship' && isHostile(e) && !cargo.removed.has(e.key), __systemSectors()) || __find((e) => e.kind === 'ship' && isHostile(e) && !cargo.removed.has(e.key), __allSectors());`);
  assert.ok(game('!!__pirate'), 'there are pirates somewhere');
  game(`cargo.hull = SHIP.hull; fight.grace = 1e9; { const a = Math.atan2(__pirate.y, __pirate.x); placeShip(__pirate.x + Math.cos(a) * (800 + __pirate.radius), __pirate.y + Math.sin(a) * (800 + __pirate.radius)); }`);
  browser.frames(1);
  // Its card says how many would fight with it, and that's who the fight takes on.
  const sub = game('describe(frameList.find((x) => x.key === __pirate.key)).subtitle');
  const m = sub.match(/· (alone|pack of (\d+)) ·/);
  assert.ok(m, `the card shows the pack: ${sub}`);
  game(`fight.grace = 0; { const e = frameList.find((x) => x.key === __pirate.key); engage(e); }`);
  assert.ok(game('!!fight.s'), 'the fight starts');
  assert.strictEqual(game('fight.s.enemies.length'), m[2] ? Number(m[2]) : 1, 'the whole pack, and only the pack, fights');
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

test('settings open and close', () => {
  game('Settings.open()');
  assert.ok(game('Settings.isOpen'));
  browser.frames(3);
  browser.key('Escape');
  assert.ok(!game('Settings.isOpen'), 'Escape closes the menu');
  browser.frames(3);
});

test('cargo saves once after a burst of changes, and survives a reload', () => {
  game('saveCargoNow()');
  const key = game('cargo.key'), saved = () => browser.storage.get(key);
  const before = saved();
  game(`for (let i = 0; i < 5; i++) { cargo.credits += 1; saveCargo(); }`); // like Sell all
  assert.strictEqual(saved(), before, 'nothing is written straight away');
  const items = game('cargo.items.length'), credits = game('cargo.credits'), removed = game('cargo.removed.size');
  assert.ok(removed > 0, 'something was taken out of the world earlier');
  game('loadCargo(world.galaxy)'); // writes the pending save first
  assert.deepStrictEqual(game('[cargo.items.length, cargo.credits, cargo.removed.size]'), [items, credits, removed]);
  // A save from before the removed list: its three lists are merged. And from before components
  // had their own store: those in the hold move to it.
  const old = JSON.parse(saved());
  const [a, b, ...rest] = old.removed;
  delete old.removed;
  Object.assign(old, { collected: [a], mined: [b], destroyed: rest });
  const comps = game(`cargo.components['weapon-standard'] || 0`);
  old.items.push({ kind: 'weapon-standard', label: 'Standard weapon components', category: 'loot' });
  browser.storage.set(key, JSON.stringify(old));
  game('loadCargo(world.galaxy)');
  assert.strictEqual(game('cargo.removed.size'), removed, 'an older save loads');
  assert.strictEqual(game(`cargo.components['weapon-standard']`), comps + 1, 'components in an old hold move to their store');
  assert.strictEqual(game('cargo.items.length'), items);
  game('cargo.credits += 1; saveCargo()');
  browser.emit('pagehide');
  assert.strictEqual(JSON.parse(saved()).credits, credits + 1, 'leaving the page writes the pending save');
});

test('nothing was drawn at a non-finite position', () => {
  assert.deepStrictEqual(browser.badDraws, []);
});

console.log(failed ? `\n${failed} smoke test(s) failed` : '\nall smoke tests passed');
process.exit(failed ? 1 : 0);
