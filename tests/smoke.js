// Smoke test for the whole game in Node: `node tests/smoke.js`. Starts the game (src/main.js and
// everything it imports) in a stand-in browser (tests/browser-stub.js), then plays: flying in
// every art style and both movement modes, docking and trading, mining, finding a derelict,
// flying into a nebula and to the system's edge, map travel, a fight in each combat mode, the
// settings, and landing: on every kind of planet and moon, and the surface run (deposits mined,
// losses and caches left on a surface, the dungeons).
// It plays with ?pirates, which turns on what the game has switched off for now (the pirates of
// the showcase), so those keep working; their tests are marked [off: ...]. The game as it
// ships, with no flags, has its own run: tests/smoke-default.js. Each step checks its effect; at
// the end nothing may have been drawn at a non-finite position. The steps share one game, in
// order, as a player would play them; Math.random is seeded (tests/browser-stub.js), so a run
// plays out the same every time (RANDOM_SEED=n tries another).

import assert from 'node:assert';
import { install } from './browser-stub.js';

// The stand-in browser first: the game's modules use the DOM as they load.
const browser = install({ width: 1280, height: 800, dpr: 2, search: '?seed=1&pirates' }); // ?pirates: play them though they're off
const { G } = await import('../src/main.js');
const { ItemIcons } = await import('../src/art/icons.js');
const { SYSTEM_CONFIG } = await import('../src/world/system-config.js');
const { UI } = await import('../src/ui/ui.js');
const { Messages } = await import('../src/ui/messages.js');
const { Store } = await import('../src/core/store.js');
const { Theme } = await import('../src/core/theme.js');
const { Kit } = await import('../src/ui/kit.js');
const { JobTexts } = await import('../src/story/job-texts.js');
const { ArtSurface } = await import('../src/art/surface.js');

// game(src): run a snippet as if inside the game, its names (G, src/main.js) in scope. A sloppy-mode
// function, for `with`.
const scope = Object.assign(Object.create(G), { ItemIcons, SYSTEM_CONFIG, ArtSurface });
const { ArtBodies, Galaxy } = G; // the tests use them too
const inGame = new Function('__scope', '__src', 'with (__scope) return eval(__src);');
const game = (src) => inGame(scope, src);

// Tests of what the game has switched off for now (notes/hazards.md, notes/archived-systems.md):
// pirates and fights with ships (?pirates), and the jobs board's machinery (no job texts written yet). Kept so those still work when they come back, and marked
// in the output so what guards the game as it ships is plain to see.
const off = (flag, name, fn) => test(`[off: ${flag}] ${name}`, fn);

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

// Helpers in the game's scope: find an entity in the scene (nearest the ship first), and run
// frames until a condition holds (returns whether it did).
game(`
  globalThis.__find = (pred) => {
    const e = world.scene.entities.filter(pred).sort((a, b) => Math.hypot(a.x - ship.x, a.y - ship.y) - Math.hypot(b.x - ship.x, b.y - ship.y))[0] || null;
    if (e) Scene.pose(e, simTime);
    return e;
  };
  globalThis.__startStation = startStation;
  // A fight under way broken off, as tickFight (game/combat.js) ends one: the ship got away.
  globalThis.__breakOff = () => { if (!fight.s) return; const s = fight.s; fight.s = null; fight.final = s; endFight('fled'); };
`);
// A click on one of the context card's buttons, as the card's click handler sees it.
function clickCard(id) {
  const button = { disabled: false, dataset: { id } };
  browser.document.getElementById('context').querySelector('.cx-actions').dispatch('click', { target: { closest: () => button } });
}
// A tap on the map, at screen px [x, y]; a press of one of its callout's buttons, by its id.
function tapMap([x, y]) {
  const map = browser.document.getElementById('map-canvas');
  map.dispatch('pointerdown', { pointerId: 9, pointerType: 'touch', clientX: x, clientY: y });
  map.dispatch('pointerup', { pointerId: 9, pointerType: 'touch', clientX: x, clientY: y });
}
function pressCallout(id) {
  const root = browser.document.getElementById('map-overlay').children.find((el) => el.className === 'callout');
  const button = { disabled: false, dataset: { id } };
  root.children[1].dispatch('click', { target: { closest: () => button } });
}
// All the text under an element of the DOM stub.
const textOf = (el) => (el === null || el === undefined ? '' : typeof el !== 'object' ? String(el) : (el.textContent || '') + (el.children || []).map(textOf).join(''));
// Every element under one (itself included), depth first.
const allOf = (el) => (el && typeof el === 'object' ? [el, ...(el.children || []).flatMap(allOf)] : []);
// The station screen: the text of its tab and of the sheet open over it (a mission, a slot), and
// a press of one of their buttons, by its text (a string, or a pattern).
const stationParts = () => [browser.document.getElementById('st-body'), browser.document.getElementById('st-layer')];
const onStation = () => stationParts().map(textOf).join('');
function pressOnStation(label) {
  const b = stationParts().flatMap(allOf).find((el) => el.tagName === 'BUTTON' && (typeof label === 'string' ? textOf(el) === label : label.test(textOf(el))));
  assert.ok(b, `a ${label} button`);
  b.dispatch('click', {});
}
// A mission's card on the Missions tab, tapped: its sheet opens, with the whole message.
function openMission(title) {
  pressOnStation(new RegExp(`^${title}`));
  assert.ok(!stationParts().flatMap(allOf).some((el) => el.tagName === 'BUTTON' && /^Read all/.test(textOf(el))), 'the whole briefing, no Read all');
}
// A floating drop (by key) dragged onto the ship, as a player picks one up: the ship set 300 units
// off it first, so the drag is a real one. Returns whether it was picked up.
let dragId = 100;
function dragOntoShip(key) {
  const k = JSON.stringify(key);
  game(`{ const d = cargo.drops.find((x) => x.key === ${k}) || world.scene.get(${k}); placeShip(d.x - 300, d.y, 0); ship.targetSpeed = 0; }`);
  browser.frames(1);
  const from = game(`(() => { const d = frameList.find((x) => x.key === ${k}); return worldToScreen(d.x, d.y); })()`), to = game('worldToScreen(ship.x, ship.y)');
  const cv = browser.document.getElementById('game'), id = dragId++;
  cv.dispatch('pointerdown', { pointerId: id, pointerType: 'touch', button: 0, clientX: from[0], clientY: from[1], timeStamp: 1000 * id });
  cv.dispatch('pointermove', { pointerId: id, pointerType: 'touch', clientX: (from[0] + to[0]) / 2, clientY: (from[1] + to[1]) / 2 });
  cv.dispatch('pointermove', { pointerId: id, pointerType: 'touch', clientX: to[0], clientY: to[1] });
  cv.dispatch('pointerup', { pointerId: id, pointerType: 'touch', button: 0, clientX: to[0], clientY: to[1], timeStamp: 1000 * id + 700 });
  browser.frames(1);
  return !game(`cargo.drops.some((x) => x.key === ${k}) || frameList.some((x) => x.key === ${k})`);
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
  game('cargo.squad = [Squad.member(4242)]; buildWings(); saveCargo()'); // a wingman, as if hired at a dock, for the tests that need one
  // Two mining lasers (a second in the tool mount for the gas siphon), as the tests below expect.
  game(`cargo.loadout = validLoadout({ hull: 'courier', fitted: { ...cargo.loadout.fitted, 'weapon-2': 'pulse-laser-1' } }); applyShip(); cargo.hull = SHIP.hull; saveCargo()`);
  assert.ok(game('world.galaxy && world.scene && world.knowledge'), 'world loaded');
  assert.ok(game('Number.isFinite(ship.x) && Number.isFinite(ship.y)'));
  assert.ok(game(`actions.state('dock', __startStation()).inRange`), 'beside the capital, in docking range');
  assert.ok(game('perfStats.posed > 0'), 'entities around the ship');
  assert.ok(game('perfStats.posed < world.scene.entities.length / 2'), 'only what is near is posed');
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
  assert.strictEqual(game('artStyle.value'), 'lowpoly');
  assert.match(game('toast.text'), /Art style: Low-poly/);
  browser.key('v');
  assert.strictEqual(game('artStyle.value'), 'line', 'and back: only Line and Low-poly');
  game(`artStyle.set('lowpoly')`);
  browser.frames(5);
});

test('moons and nebulae come from art/bodies.js, in every style', () => {
  // Every type the galaxy rolls is one the art draws.
  for (let seed = 1; seed <= 20; seed++) {
    const s = Galaxy.generate(seed, SYSTEM_CONFIG);
    for (const m of s.moons) assert.ok(ArtBodies.MOON_TYPES.includes(m.type), `moon type ${m.type}`);
    for (const n of s.nebulae) assert.ok(ArtBodies.NEBULA_TYPES.includes(n.type), `nebula type ${n.type}`);
  }
  // Beside a moon, then inside a nebula: drawn in each style, the nebula built over a few frames.
  game(`fight.grace = 1e9; globalThis.__moon = __find((e) => e.kind === 'moon'); placeShip(__moon.x + __moon.radius + 150, __moon.y);`);
  for (const style of game('ART_STYLES')) {
    game(`artStyle.set('${style}')`);
    browser.frames(2);
    assert.ok(game(`frameList.some((e) => e.kind === 'moon' && visible(e))`), `a moon on screen in ${style}`);
  }
  // (The frame's build budget is in real milliseconds; lifted here, so how many chunks a frame
  // builds doesn't depend on how fast the machine is. The budget's own test is further on.)
  const before = game('ArtBodies.stats().builds');
  game(`Art.config.buildBudgetMs = Infinity; { const n = world.galaxy.nebulae[0]; placeShip(n.x + n.blobs[0].dx, n.y + n.blobs[0].dy); }`);
  for (const style of game('ART_STYLES')) { game(`artStyle.set('${style}')`); browser.frames(4); }
  game('Art.config.buildBudgetMs = 4');
  assert.ok(game('ArtBodies.stats().builds') > before + 20, 'nebula chunks were built');
  game(`artStyle.set('line'); { const st = __startStation(); placeShip(st.x, st.y + st.radius + 300); }`);
  browser.frames(2);
});

test('a rebuilt scene finds its sprites again', () => {

  // Beside a station, the star, a planet and an asteroid in turn: the same frame drawn from a
  // freshly built scene (new objects from the same seeds) builds no sprite.
  game('fight.grace = 1e9');
  for (const kind of ['station', 'star', 'planet', 'asteroid']) {
    assert.ok(game(`!!(globalThis.__near = __find((e) => e.kind === '${kind}'))`), kind);
    game('placeShip(__near.x, __near.y + __near.radius + 100)');
    browser.frames(2);
    game('render()');
    const before = game('Art.stats()');
    game('world.scene = Scene.create(world.galaxy, world.cultures); showGates(); render();');
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
  game(`Art.config.buildBudgetMs = 4; artStyle.set('line');`);
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

test('buys gear at the outfitter, fits it, fits a mod and sells gear, and buys a hull', () => {
  game(`fight.grace = 1e9; globalThis.__T = Date.now(); Clock.now = () => __T;
    globalThis.__cap = __find((e) => e.kind === 'station' && e.market.type === 'capital');
    placeShip(__cap.x, __cap.y + __cap.radius + 150);`);
  browser.frames(1);
  game('dock(__cap)');
  assert.ok(game('!!docked && StationMenu.isOpen'), 'docked at a capital');
  // Gear and hulls ask for a level (rules/progress.js): at level 1, no Mk II and no Corvette.
  game(`globalThis.__xpFor = (n) => { let xp = 0; for (let k = 1; k < n; k++) xp += Progress.toNext(k); return xp; }; globalThis.__xp = cargo.pilot.xp; cargo.pilot.xp = 0; applyShip()`);
  game(`cargo.gear['pulse-laser-2'] = 1`);
  assert.strictEqual(game(`outfitting.blocked('weapon-1', 'pulse-laser-2')`), 'Needs level 5');
  assert.ok(!game(`outfitting.fit('weapon-1', 'pulse-laser-2')`), 'not at level 1');
  game('cargo.credits = 20000');
  assert.strictEqual(game(`outfitting.hullBlocked('corvette')`), 'Needs level 8');
  game(`delete cargo.gear['pulse-laser-2']; cargo.pilot.xp = __xpFor(16); applyShip()`);
  // Every tab draws, with slot choices open on the Ship tab.
  for (const t of ['outfitter', 'missions', 'ship', 'trade']) game(`StationMenu.showTab('${t}')`);
  game(`StationMenu.showTab('ship'); StationMenu.toggleSlot('weapon-2')`);
  assert.match(onStation(), /Gun 2Gun mount · \d+ options?/, 'the slot\'s sheet');
  assert.match(onStation(), /Fitted.*Mining laserMk I.*Spare gear/, 'what is fitted, then the spare gear');
  game(`StationMenu.showTab('trade')`);
  assert.doesNotMatch(onStation(), /Gun mount/, 'the sheet closes with the tab');
  // Take out the second laser and sell it, freeing a hardpoint.
  assert.ok(game(`outfitting.unfit('weapon-2') && cargo.gear['pulse-laser-1'] === 1 && outfitting.sell('pulse-laser-1')`));
  assert.ok(game(`!cargo.gear['pulse-laser-1'] && SHIP.weaponsFitted === 1`));
  // A weapon from the outfitter's stock (a day with one in it), bought into the spare gear.
  game(`cargo.credits = 50000; for (let k = 0; k < 30 && !vendor.gear().some((g) => g.item.slot === 'weapon'); k++) __T += 24 * 3600 * 1000;`);
  const i = game(`vendor.gear().findIndex((g) => g.item.slot === 'weapon')`);
  assert.ok(i >= 0, 'a weapon for sale');
  const id = game(`vendor.gear()[${i}].spec.id`);
  game(`StationMenu.showTab('outfitter')`);
  assert.match(onStation(), /Gear.*today's stock/);
  assert.ok(game(`vendor.buyGear(${i})`) && game(`cargo.gear['${id}']`) === 1, 'bought');
  // Fitted through the Ship tab: the empty hardpoint's sheet, Fit on it.
  const fp = game('SHIP.firepower');
  game(`StationMenu.showTab('ship'); StationMenu.toggleSlot('weapon-2')`);
  assert.match(onStation(), /Open mount/);
  pressOnStation('Fit');
  assert.doesNotMatch(onStation(), /Gun mount/, 'fitted, and the sheet closed');
  assert.ok(game('SHIP.firepower') > fp && game('SHIP.weaponsFitted') === 2, 'the ship fires harder');
  // A mod, bought at the capital's outfitter, in a Mk II's slot: fitted from the slot's sheet.
  assert.ok(game(`vendor.buyMod('mod.extended-barrel') && cargo.mods['mod.extended-barrel'] === 1`), 'a mod bought');
  game(`cargo.gear['pulse-laser-2'] = 1`);
  assert.ok(game(`outfitting.fit('weapon-2', 'pulse-laser-2')`));
  game(`StationMenu.showTab('ship'); StationMenu.toggleSlot('weapon-2')`);
  assert.match(onStation(), /Mods · 0\/1.*Extended barrel.*Spare ×1/, 'the slot\'s mods');
  const range = game('SHIP.weapons[1].range');
  pressOnStation('Fit');
  assert.ok(game(`cargo.loadout.mods['weapon-2'][0] === 'mod.extended-barrel' && !cargo.mods['mod.extended-barrel']`));
  assert.ok(game('SHIP.weapons[1].range') > range, 'reaches further');
  game('StationMenu.closeSheet()');
  // Gear out of a slot: its mods go back to the spare mods.
  assert.ok(game(`outfitting.unfit('weapon-2') && cargo.mods['mod.extended-barrel'] === 1 && !cargo.loadout.mods['weapon-2']`), 'mods back');
  assert.ok(game(`outfitting.fit('weapon-2', 'pulse-laser-2') && outfitting.fitMod('weapon-2', 'mod.extended-barrel')`));
  // Spare gear sells for half.
  const credits = game('cargo.credits');
  assert.ok(game(`outfitting.sell('${id}')`));
  assert.strictEqual(game('cargo.credits'), credits + game(`outfitting.sellPrice('${id}')`));
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
  const before = game('JSON.stringify([cargo.loadout, cargo.gear, cargo.mods, cargo.gambits, cargo.components, SHIP.hull, SHIP.cargo, SHIP.weapons])');
  game('saveCargoNow(); loadCargo(world.galaxy)');
  assert.strictEqual(game('JSON.stringify([cargo.loadout, cargo.gear, cargo.mods, cargo.gambits, cargo.components, SHIP.hull, SHIP.cargo, SHIP.weapons])'), before);
  // Back to a Courier for the rest of the run.
  game(`cargo.credits = 20000; outfitting.buyHull('courier'); cargo.items = cargo.items.slice(0, 10); cargo.pilot.xp = __xp; applyShip(); Clock.now = () => Date.now(); launch()`);
  assert.ok(game('!docked && SHIP.name === "Courier"'));
  browser.frames(3);
});

test('gambits: bought at an outfitter, known by every squad program, and the telegraphs as conditions', () => {
  game(`fight.grace = 1e9; cargo.gambits = []; { const st = __startStation(); placeShip(st.x, st.y + st.radius + 150); dock(st); }`);
  assert.ok(game('!!docked'));
  // Not owned yet: a line with AND can't be set.
  const two = `{ ...Logic.blank(), when: [Logic.clause(), Logic.clause({ join: 'and', not: true })] }`;
  assert.ok(!game(`programs.set(cargo.squad[0].id, 0, ${two})`), 'and needs core.bool');
  game(`StationMenu.showTab('outfitter')`);
  game('cargo.credits = 1e5; StationMenu.refresh()');
  pressOnStation(/^Buy/); // the first gambit for sale: core.bool
  assert.ok(game(`cargo.gambits.includes('core.bool')`), 'bought from the tab');
  assert.ok(game(`programs.set(cargo.squad[0].id, 0, ${two})`), 'and, not are known now');
  game('cargo.squad[0].program.splice(0, 1)');
  // The heavy shot as a condition (tactics.read): a wingman switches fire to the enemy charging one.
  assert.ok(!game(`Logic.check({ ...Logic.blank(), when: [Logic.clause({ prop: 'charging' })] }, logicKnown()).ok`), 'not known without its gambit');
  game(`cargo.gambits.push('tactics.read')`);
  const line = `{ ...Logic.blank(), when: [Logic.clause({ prop: 'charging' })] }`;
  assert.ok(game(`Logic.check(${line}, logicKnown()).ok`));
  const picked = game(`(() => {
    const c = (id, o = {}) => ({ id, x: 0, y: 0, hull: 10, shield: 0, stats: { hull: 10, shield: 0 }, ...o });
    const s = { t: 0, player: c('player'), allies: [c('w1')], enemies: [c('e1', { intent: { kind: 'volley' } }), c('e2', { intent: { kind: 'heavy' } })], focus: 'e1' };
    const ctx = logicContext(s, s.allies[0]);
    return Logic.decide([${line}], ctx).intent;
  })()`);
  assert.deepStrictEqual(picked, { type: 'attack', target: 'e2' }, 'fire on the one charging');
  assert.ok(game(`Logic.check({ ...Logic.blank(), subject: 'self', act: 'follow', when: [Logic.clause({ prop: 'has', value: 'taunt' })] }, logicKnown()).ok`), 'a status as a condition');
  assert.match(game(`Logic.say({ ...Logic.blank(), when: [Logic.clause({ prop: 'charging' })] })`), /is charging a heavy shot/);
  game('launch()');
  browser.frames(2);
});

test('logic intents become orders: guard fires on the ward\'s attacker, retreat falls back behind the leader', () => {
  const orders = (intent) => game(`(() => {
    const c = (id, x, y, o = {}) => ({ id, x, y, angle: 0, hull: 10, shield: 0, stats: { hull: 10, shield: 0 }, ...o });
    const s = { player: c('player', 0, 0), allies: [c('w1', -100, 0), c('w2', -100, 100)],
      enemies: [c('e1', 800, 0, { aim: 'w2' }), c('e2', 600, 300, { aim: 'w2' }), c('e3', 900, -50, { aim: 'player' })] };
    return ordersFor(s, s.allies[0], ${JSON.stringify(intent)}, 0);
  })()`);
  assert.deepStrictEqual(orders({ type: 'attack', target: 'e1' }), { target: 'e1', keep: false });
  assert.deepStrictEqual(orders({ type: 'attack', target: 'e1', keep: true }), { target: 'e1', keep: true });
  assert.deepStrictEqual(orders({ type: 'guard', ward: 'w2' }), { target: 'e2' }, 'the nearest of those shooting at it');
  assert.deepStrictEqual(orders({ type: 'guard', ward: 'player' }), { target: 'e3' });
  const st = orders({ type: 'retreat' }).station;
  assert.ok(st.x < -100, `behind the leader, away from the enemies (${st.x.toFixed(0)}, ${st.y.toFixed(0)})`);
  assert.ok(orders({ type: 'follow' }).station && !orders({ type: 'follow' }).target);
  assert.ok(!orders({ type: 'use', skill: 'x', target: 'e1' }).target, 'no abilities yet: keeps formation');
});

test('an old save: brought up to date, step by step, to gambits in place of the lab', () => {
  const d = game(`(() => { const d = { version: 3, research: ['pulse-laser-2', 'armour-1', 'cargo-racks-1', 'nonsense'] }; CARGO_MIGRATIONS[3](d); return d; })()`);
  assert.deepStrictEqual(d, { version: 3, schematics: ['pulse-laser-2'], hullMods: ['armour-1', 'cargo-racks-1'] });
  // Logic modules in slots become program lines.
  const sq = game(`(() => { const d = { squad: [{ seed: 1, modules: ['assist-leader', null, 'gone', null] }, { seed: 2 }] }; CARGO_MIGRATIONS[4](d); return d.squad; })()`);
  assert.deepStrictEqual(sq, [{ seed: 1, program: [game(`Logic.PRESETS['assist.leader']`)] }, { seed: 2 }]);
  // Squad members get a loadout of their own: the player's starting gear, in place of android gear.
  const fl = game(`(() => { const d = { squad: [{ seed: 1, hull: 'fighter', tier: 3 }, { seed: 2, hull: 'fighter' }, { seed: 3, hull: 'fighter', loadout: { mine: 1 } }] }; CARGO_MIGRATIONS[12](d); return d.squad; })()`);
  const kit = game(`Squad.starter('fighter')`);
  assert.deepStrictEqual(fl.map((m) => [m.tier, m.loadout]), [[undefined, kit], [undefined, kit], [undefined, { mine: 1 }]]);
  // Logic research starts empty; a damaged lab reads as what can be made of it.
  assert.deepStrictEqual(game(`(() => { const d = {}; CARGO_MIGRATIONS[5](d); return d.lab; })()`), { done: [], doneAt: {}, active: null, queue: [] });
  // Hull refits fitted become hull research done.
  const lab = game(`(() => { const d = { hullMods: ['armour-1', 'gone'], lab: { done: ['core.bool'], active: null, queue: [] } }; CARGO_MIGRATIONS[6](d); return d; })()`);
  assert.deepStrictEqual(lab, { lab: { done: ['core.bool', 'hull.armour-1'], doneAt: { 'hull.armour-1': 0 }, active: null, queue: [] } });
  // Industry starts empty; a damaged one keeps what makes sense.
  assert.deepStrictEqual(game(`(() => { const d = {}; CARGO_MIGRATIONS[7](d); return d.industry; })()`), { stock: {}, orders: [], routes: [], seq: 1 });
  // Gear owned and schematics recovered become their blueprints.
  const bps = game(`(() => { const d = { schematics: ['deflector-4'], loadout: { hull: 'courier', fitted: { 'weapon-1': 'pulse-laser-3', shield: 'deflector-1' } },
    gear: { 'survey-scanner-2': 1 }, lab: { done: [], active: { id: 'bp.pulse-laser-3', start: 1, end: 2 }, queue: ['bp.deflector-4', 'core.bool'] } }; CARGO_MIGRATIONS[8](d); return d; })()`);
  assert.deepStrictEqual(bps.lab, { done: ['bp.deflector-4', 'bp.pulse-laser-3', 'bp.survey-scanner-2'], doneAt: { 'bp.deflector-4': 0, 'bp.pulse-laser-3': 0, 'bp.survey-scanner-2': 0 }, active: null, queue: ['core.bool'] });
  assert.strictEqual(bps.schematics, undefined);
  // Leased bays become production orders: warehouses merged into one storage (with the inputs of
  // runs under way), leases refunded, each station's first job kept where its stage fits.
  const v12 = game(`(() => { const d = { credits: 100, industry: { sites: {
    c: { name: 'Camp', type: 'mining camp', storage: { iron: 4 }, bays: [
      { type: 'refinery', job: { recipe: 'make.steel-pipe', left: 3, made: 1, at: 5, next: 9 } },
      { type: 'refinery', job: { recipe: 'make.copper-cable', left: null, made: 0, at: null, next: null } }] },
    p: { name: 'Port', type: 'minor', storage: { iron: 1, electronics: 2 }, bays: [
      { type: 'refinery', job: { recipe: 'make.carbon-fibre', left: null, made: 0, at: 1, next: 2 } },
      { type: 'assembler', job: null }] } } } }; CARGO_MIGRATIONS[11](d); return d; })()`);
  assert.deepStrictEqual(v12, { credits: 100 + 1500 * 3 + 5000, loyalty: {}, industry: { storage: { iron: 7, electronics: 2, silicates: 3 }, seq: 2, orders: [
    { id: 1, station: 'c', name: 'Camp', type: 'mining camp', recipe: 'make.steel-pipe', left: 4, made: 1, at: null, next: null, paused: false }] } });
  // Stations per process: an order its station no longer makes is cancelled, its run's inputs back.
  const v19 = game(`(() => { const d = { industry: { storage: { iron: 1 }, seq: 4, orders: [
    { id: 1, station: 'p', name: 'Port', type: 'minor', recipe: 'make.electronics', left: 2, made: 0, at: 1, next: 9, paused: false },
    { id: 2, station: 'c', name: 'Camp', type: 'mining camp', recipe: 'make.steel-pipe', left: null, made: 3, at: 1, next: 9, paused: false },
    { id: 3, station: 'w', name: 'Way', type: 'waystation', recipe: 'make.electronics', left: null, made: 0, at: null, next: null, paused: false }] } };
    CARGO_MIGRATIONS[18](d); return d.industry; })()`);
  assert.deepStrictEqual([v19.storage, v19.orders.map((o) => o.id)], [{ iron: 1, 'steel-pipe': 1, 'carbon-fibre': 1 }, [2]]);
  // A stock at each station: what was in the one storage goes to the waystation's.
  const v20 = game(`(() => { const d = { industry: { storage: { iron: 4 }, orders: [], seq: 1 } }; CARGO_MIGRATIONS[19](d); return d.industry; })()`);
  assert.deepStrictEqual(v20, { stock: { [game('HOME_STOCK')]: { iron: 4 } }, orders: [], seq: 1 });
  // No lab or industry any more: the logic packages researched become gambits owned; the rest goes.
  const v22 = game(`(() => { const d = { lab: { done: ['core.bool', 'bp.pulse-laser-2', 'hull.armour-1', 'squad.link'] }, industry: { stock: {} }, loyalty: { a: 1 }, restored: ['x'] };
    CARGO_MIGRATIONS[21](d); return d; })()`);
  assert.deepStrictEqual(v22, { gambits: ['core.bool', 'squad.link'] });
});

test('components go to their own store, even with a full hold, and stay when the ship is lost', () => {
  game(`cargo.items = Array.from({ length: SHIP.cargo }, () => ({ kind: 'iron', label: 'Iron', category: 'trade' }));
    globalThis.__had = cargo.components['hull-components'] || 0;
    cargo.drops.push(dropEntity({ key: 'drop:smoke:c', kind: 'hull-components', seed: 5, x: ship.x, y: ship.y }));
    cargo.drops.push(dropEntity({ key: 'drop:smoke:g', kind: 'silicates', seed: 6, x: ship.x, y: ship.y }));`);
  browser.frames(2);
  assert.ok(game(`cargo.drops.some((d) => d.key === 'drop:smoke:c')`), 'flying over it picks nothing up');
  assert.ok(dragOntoShip('drop:smoke:c'), 'dragged onto the ship');
  assert.strictEqual(game(`cargo.components['hull-components']`), game('__had') + 1, 'the component was picked up');
  assert.ok(!dragOntoShip('drop:smoke:g'), 'the trade good can\'t be');
  assert.strictEqual(game('cargo.items.length'), game('SHIP.cargo'), 'the hold is still full');
  assert.ok(game(`cargo.drops.some((d) => d.key === 'drop:smoke:g')`), 'the trade good is left floating');
  const components = game('JSON.stringify(cargo.components)');
  game('playerDestroyed(); towHome();');
  assert.strictEqual(game('cargo.items.length'), 0, 'the hold spilled');
  assert.strictEqual(game('JSON.stringify(cargo.components)'), components, 'the components are kept');
  game(`cargo.drops = cargo.drops.filter((d) => !d.key.startsWith('lost:') && !d.key.startsWith('drop:smoke'))`);
  browser.frames(3);
});

test('drops are never pulled in nor picked up by flying near: a tap selects one, a drag onto the ship takes it', () => {
  game(`cargo.items = []; placeShip(ship.x, ship.y); ship.targetSpeed = 0;
    cargo.drops.push(dropEntity({ key: 'drop:smoke:pull', kind: 'silicates', seed: 7, x: ship.x + 60, y: ship.y }));
    for (let i = 0; i < 20; i++) react(nearbyEntities(simTime), 0.05);`);
  assert.strictEqual(game(`cargo.drops.find((d) => d.key === 'drop:smoke:pull').x`), game('ship.x + 60'), 'not pulled');
  assert.strictEqual(game('cargo.items.length'), 0, 'nor picked up');
  game(`select(frameList.find((e) => e.key === 'drop:smoke:pull'))`);
  assert.match(game('describe(selected.e).subtitle'), /Drag it onto the ship/);
  assert.deepStrictEqual(game('describe(selected.e).actions.map((a) => a.id)'), ['gather'], 'only Collect all: not even Approach');
  game('select(null)');
  assert.ok(dragOntoShip('drop:smoke:pull'), 'dragged onto the ship, picked up');
  assert.strictEqual(game('cargo.items.length'), 1);
  game(`cargo.items = []; cargo.drops = cargo.drops.filter((d) => !d.key.startsWith('drop:smoke'))`);
});

test('mines an asteroid by its Mine action, then each shard the same way, and drags in what they leave', () => {
  const found = game(`(globalThis.__rock = __find((e) => e.kind === 'asteroid' && e.radius >= Mining.config.shards.from && !cargo.removed.has(e.key) && Mining.yieldOf(world.galaxy.seed, e))) && __rock.key`);
  assert.ok(found, 'an asteroid with a yield');
  game('placeShip(__rock.x, __rock.y + __rock.radius + 60)');
  browser.frames(1);
  const held = game('cargo.items.length');
  // Selected, nothing happens yet; the context card's Mine button starts it.
  game('select(__rock)');
  browser.frames(30);
  assert.ok(!game('mine.target'), 'selecting it doesn\'t mine it');
  assert.deepStrictEqual(game('describe(__rock).actions.map((a) => a.id)'), ['mine']);
  // Mining is a timed action: the tools work the rock until it breaks.
  clickCard('mine');
  assert.ok(game('mine.target === __rock'), `mining started: ${game(`actions.state('mine', __rock).label`)}`);
  browser.frames(30); // some work
  // No combat panel pops up: the rock shows its own progress; the settings stay to hand.
  assert.ok(!game('CombatPanel.isOpen'), 'no panel while mining');
  assert.ok(game('modes.has("mining") && !modes.has("in-combat")'), 'mining, not a fight');
  assert.match(game('describe(__rock).actions[0].label'), /^Mining · \d+%$/);
  assert.ok(game('mine.t > 0 && mine.t < mine.total && !fight.s'), 'under way, and no fight');
  assert.strictEqual(game('cargo.hull'), game('SHIP.hull'), 'a rock never fires back');
  assert.ok(until('cargo.removed.has(__rock.key)', 60 * 30), 'the asteroid broke up');
  // Into shards; the tools stop there, and each shard is mined by its own Mine.
  const n = game('shards.filter((e) => e.parent.key === __rock.key).length');
  assert.ok(n >= game('Mining.config.shards.n[0]'), `${n} shards`);
  browser.frames(60 * 2);
  assert.ok(!game('mine.target'), 'the tools don\'t carry on by themselves');
  for (let i = 0; i < n; i++) {
    game('select(shards.find((e) => e.parent.key === __rock.key))');
    browser.frames(1);
    clickCard('mine');
    assert.ok(until('!mine.target', 60 * 20), `shard ${i + 1} broken`);
  }
  assert.ok(!game('shards.some((e) => e.parent.key === __rock.key)'), 'every shard broken');
  game('select(null)');
  // What they left floats where it is, until dragged onto the ship.
  const left = game('cargo.drops.filter((e) => e.key.startsWith("drop:" + __rock.key)).map((e) => e.key)');
  assert.ok(left.length >= 1, 'something left floating');
  for (const k of left) assert.ok(dragOntoShip(k), `${k} dragged in`);
  assert.ok(game('cargo.items.length') >= held + 1, `collected: ${held} → ${game('cargo.items.length')}`);
  // Flying past an asteroid never starts mining by itself.
  game(`{ const r = __find((e) => e.kind === 'asteroid' && !cargo.removed.has(e.key)); placeShip(r.x, r.y + r.radius + 80); }`);
  browser.frames(60);
  assert.ok(!game('mine.target'), 'no mining without Mine');
});

test('the ship bounces off an asteroid: a gentle bump does nothing, a hard one knocks the shields', () => {
  game(`fight.grace = 1e9; cargo.hull = SHIP.hull; guard.shield = SHIP.shield; guard.quiet = Infinity;
    globalThis.__rock = __find((e) => e.kind === 'asteroid' && !cargo.removed.has(e.key));
    globalThis.__at = (gap, speed) => { placeShip(__rock.x - __rock.radius - SHIP.radius - gap, __rock.y, 0); Object.assign(ship, { vx: speed, vy: 0, targetSpeed: 0, targetAngle: 0 }); };`);
  const apart = () => game('Math.hypot(ship.x - __rock.x, ship.y - __rock.y) - __rock.radius - SHIP.radius');
  game('__at(20, 140)');
  browser.frames(30);
  assert.ok(apart() > -1, 'kept out of the rock');
  assert.deepStrictEqual(game('[cargo.hull, guard.shield]'), game('[SHIP.hull, SHIP.shield]'), 'a gentle bump does nothing');
  game('__at(40, SHIP.maxSpeed)');
  browser.frames(10);
  assert.ok(apart() > -1, 'kept out of the rock');
  assert.ok(game('ship.vx') < 0, 'bounced back');
  assert.ok(game('guard.shield < SHIP.shield'), 'the shields took the knock');
  assert.strictEqual(game('cargo.hull'), game('SHIP.hull'), 'all of it, at full speed with full shields');
  // The shields come back after a few seconds clear.
  browser.frames(60 * (game('SHIELD_DELAY') + 1) + game('Math.ceil(60 * SHIP.shield / SHIP.shieldRecharge)'));
  assert.strictEqual(game('guard.shield'), game('SHIP.shield'), 'recharged');
});

test('collects a gas pocket in a nebula and picks up its gas', () => {
  // (Earlier tests may have used up the pockets within reach: put one back if so.)
  game(`fight.grace = 1e9; if (!world.scene.entities.some((e) => e.kind === 'gas' && !cargo.removed.has(e.key))) cargo.removed.delete(world.scene.entities.find((e) => e.kind === 'gas').key);
    globalThis.__gas = __find((e) => e.kind === 'gas' && !cargo.removed.has(e.key));`);
  assert.ok(game('!!__gas'), 'a gas pocket');
  game('placeShip(__gas.x, __gas.y + __gas.radius + 60)');
  browser.frames(1);
  assert.ok(game('frameList.includes(__gas)'), 'drawn in the nebula');
  assert.match(game('describe(__gas).title'), /^Gas pocket$/);
  // The E shortcut collects it (no asteroid near enough to mine instead).
  game('select(null)');
  browser.key('e');
  assert.ok(game('mine.target === __gas'), `siphoning: ${game(`actions.state('collect', __gas).label`)}`);
  game('select(__gas)');
  browser.frames(30);
  assert.match(game('describe(__gas).actions[0].label'), /^Siphoning · \d+%$/);
  assert.ok(until('cargo.removed.has(__gas.key)', 60 * 30), 'the pocket is used up');
  assert.match(game('toast.text'), /^Gas pocket used up · \d × /);
  assert.ok(game('!frameList.includes(__gas)'), 'and gone');
  const n = game('Mining.gasOf(world.galaxy.seed, __gas).length'), held = game('cargo.items.length');
  // (Gas of one kind lying together is a stack, dragged in at once: game/draw-world.js stackDrops.)
  for (const k of game(`cargo.drops.filter((e) => e.key.startsWith('drop:' + __gas.key)).map((e) => e.key)`)) {
    if (game(`cargo.drops.some((d) => d.key === ${JSON.stringify(k)})`)) assert.ok(dragOntoShip(k), `${k} dragged in`);
  }
  assert.strictEqual(game('cargo.items.length'), held + n, 'its gas is in the hold');
  assert.ok(game(`cargo.items.slice(-${n}).every((it) => Goods.type(it.kind).category === 'gas')`));
});

// Hazards (rules/hazards.js, game/hazards.js): a calm moment first, so no flare muddles a test.

test('consumables in the field: a button each on the HUD, used on the ship, mining or not', () => {
  game(`fight.grace = 1e9; cargo.items = []; field.cool = {};
    cargo.kit = { 'coolant-flush': 2, 'repair-nanites': 1, 'shield-cell': 1, 'seismic-charge': 2, 'emp-charge': 1 };
    cargo.hull = SHIP.hull; guard.shield = SHIP.shield;
    { const st = __find((e) => e.kind === 'station'); placeShip(st.x + 2500, st.y); }`);
  browser.frames(1);
  const bar = browser.document.getElementById('field');
  assert.ok(!bar.hidden, 'the bar is up');
  assert.deepStrictEqual(game('fieldItems().map((a) => a.id)'), ['repair-nanites', 'shield-cell'], 'the ones that mend the ship, not the hazards\' or the EMP');
  assert.ok(game('fieldItems().every((a) => !a.enabled)'), 'nothing to use them on yet');
  game('cargo.hull = SHIP.hull / 2; guard.shield = 0; guard.quiet = 0');
  const press = (id) => bar.dispatch('click', { target: { closest: () => ({ disabled: false, dataset: { id } }) } });
  press('repair-nanites');
  assert.deepStrictEqual(game('[cargo.hull, cargo.kit["repair-nanites"] || 0]'), game('[Math.min(SHIP.hull, SHIP.hull / 2 + SHIP.hull * 0.3), 0]'), 'hull mended, the last charge spent');
  assert.ok(!game('useField("coolant-flush")'), 'a hazard consumable is not used here');
  assert.ok(game('useField("shield-cell")') && game('shieldNow()') === game('SHIP.shield'), 'shields back');
  assert.ok(!game('useField("shield-cell")'), 'cooling down, and none left');
  assert.ok(!game('CombatPanel.isOpen'), 'still no panel');
  game('cargo.kit = {}');
  browser.frames(1);
  assert.ok(bar.hidden, 'an empty kit: no bar');
});

test('sensors find a hidden derelict, and the radar shows it once found', () => {
  game(`fight.grace = 1e9; globalThis.__der = world.galaxy.contacts.find((c) => c.type === 'derelict' && !world.knowledge.contactState(c.id));`);
  assert.ok(game('!!__der'), 'an unfound derelict');
  // From afar it is only a signal; closer in, the sensors identify it and say so.
  game('placeShip(__der.x + __der.r + SHIP.sensorRange + 1500, __der.y)');
  browser.frames(2);
  assert.strictEqual(game('world.knowledge.contactState(__der.id)'), 'ping');
  game(`toast.text = ""; placeShip(__der.x + __der.r + SHIP.sensorRange - 500, __der.y)`);
  browser.frames(20);
  assert.strictEqual(game('world.knowledge.contactState(__der.id)'), 'known');
  assert.match(game('toast.text'), /derelict identified/);
  assert.ok(game('frameList.some((e) => e.kind === "wreck" && e.contact === __der.id)'), 'its wrecks are around');
  game('placeShip(__der.x, __der.y + 900)');
  browser.frames(2);
});

test('a nebula dampens the sensors and lowers security', () => {
  game(`fight.grace = 1e9; globalThis.__neb = world.galaxy.nebulae[0]; placeShip(__neb.x + __neb.r + 400, __neb.y, Math.PI);`);
  browser.frames(2);
  // Into the nebula's core.
  game('ship.x = __neb.x + __neb.blobs[0].dx; ship.y = __neb.y + __neb.blobs[0].dy');
  browser.frames(2);
  assert.strictEqual(game('here.region.nebula === __neb'), true, 'the HUD shows the nebula');
  assert.doesNotMatch(game('toast.text'), /Entering/, 'with no notice of its own');
  assert.ok(game('frameList.some((e) => e.kind === "nebula")'), 'the nebula is drawn');
  game('{ const st = __startStation(); placeShip(st.x, st.y + st.radius + 300); }');
  browser.frames(2);
});

test('no edge: the ship flies on out of the system into deep space', () => {
  // Just inside the system's edge, flying outward.
  game(`fight.grace = 1e9; {
    const [A] = world.galaxy.systems, R = A.radius, a = 0.4;
    placeShip(Math.cos(a) * (R - 300), Math.sin(a) * (R - 300), a);
    ship.vx = Math.cos(a) * SHIP.maxSpeed; ship.vy = Math.sin(a) * SHIP.maxSpeed; ship.targetAngle = a; ship.targetSpeed = SHIP.maxSpeed;
  }`);
  browser.frames(90);
  assert.ok(game('Math.hypot(ship.x, ship.y) > world.galaxy.systems[0].radius + 300'), 'past where the edge was');
  assert.strictEqual(game('world.galaxy.systemAt(ship.x, ship.y)'), null);
  assert.strictEqual(game('here.region.system'), null, 'the HUD says deep space');
  game('ship.targetSpeed = 0; ship.vx = ship.vy = 0; { const st = __startStation(); placeShip(st.x, st.y + st.radius + 300); }');
  browser.frames(2);
});

test('a jump gate takes the ship to the next system and back', () => {
  game('globalThis.__gate = world.scene.gates.find((g) => !g.gate.wormhole && g.gate.system === 0); globalThis.__there = world.scene.gates[__gate.gate.link]; globalThis.__hole = world.scene.gates.find((g) => g.gate.wormhole)');
  assert.ok(game('!!__gate && !!__there'), 'the start has a gate'); // (the territories' galaxy has no wormhole: hole checks below only with one)
  assert.strictEqual(game('__there.gate.link'), game('__gate.gate.id'), 'the gates lead to each other');
  assert.notStrictEqual(game('__there.gate.system'), 0, 'into another system');
  assert.strictEqual(game('__gate.art.culture.lineage'), 'wedge', 'a Wedge gate');
  game('fight.grace = 1e9; select(null); placeShip(__gate.x, __gate.y + __gate.radius + 120)');
  browser.frames(2);
  assert.ok(game('frameList.some((e) => e.kind === "gate" && visible(e))'), 'the gate is drawn');
  assert.match(game('__gate.name'), /Gate$/);
  assert.match(game('describe(__gate).subtitle'), /^Jump gate to \w+/);
  assert.ok(game(`actions.state('jump', __gate).ok`), 'in range to jump');
  game('select(__gate)');
  browser.key('j');
  browser.frames(2);
  assert.ok(game('warp.on'), 'the jump is under way');
  assert.ok(until('!warp.on', 60 * 3), 'and over within a few seconds');
  assert.match(game('toast.text'), /^Through to \w+/);
  assert.ok(game('Math.hypot(ship.x - __there.x, ship.y - __there.y) < 800'), 'beside the gate at the other end');
  assert.strictEqual(game('world.galaxy.systemAt(ship.x, ship.y).index'), game('__there.gate.system'), 'in the other system');
  // And back.
  game('select(__there)');
  browser.key('j');
  assert.ok(until('!warp.on', 60 * 3), 'the jump back is over');
  assert.ok(game('Math.hypot(ship.x - __gate.x, ship.y - __gate.y) < 800'), 'beside the first gate again');
  game('select(null); { const st = __startStation(); placeShip(st.x, st.y + st.radius + 300); }');
  browser.frames(2);
});

test('an off-screen station gets an edge marker, and a tap on it selects the station', () => {
  game('globalThis.__st0 = __startStation(); select(null); placeShip(__st0.x + __st0.radius + 3000, __st0.y)');
  browser.frames(2);
  const m = game('navHits.find((h) => h.ref === __st0)');
  assert.ok(m, 'the station has a marker');
  const canvas = browser.document.getElementById('game');
  canvas.dispatch('pointerdown', { pointerId: 3, pointerType: 'touch', button: 0, clientX: m.x, clientY: m.y });
  canvas.dispatch('pointerup', { pointerId: 3, pointerType: 'touch', button: 0, clientX: m.x, clientY: m.y });
  assert.strictEqual(game('selected && selected.e'), game('__st0'), 'the tap selected the station');
  game('select(null)');
});

test('a panel that opens mid-drag moves nothing until the finger lifts', () => {
  const canvas = browser.document.getElementById('game');
  const at = { pointerId: 4, pointerType: 'touch', button: 0, clientX: 200, clientY: 300 };
  canvas.dispatch('pointerdown', at);
  assert.strictEqual(game('steady("test", 0)'), 0, 'the cover as the drag began');
  assert.strictEqual(game('steady("test", 180)'), 0, 'held while the finger is down');
  canvas.dispatch('pointerup', at);
  assert.strictEqual(game('steady("test", 180)'), 180, 'and where the panel is once it lifts');
});

test('travels on the system map', () => {
  game('SystemMap.open()');
  browser.frames(2);
  assert.ok(game('SystemMap.isOpen'));
  // Drag and zoom the map, and tap a station on it.
  const map = browser.document.getElementById('map-canvas');
  const frames = game('SystemMap.stats.frames');
  map.dispatch('pointerdown', { pointerId: 7, pointerType: 'mouse', clientX: 600, clientY: 400 });
  for (let i = 1; i <= 10; i++) { map.dispatch('pointermove', { pointerId: 7, pointerType: 'mouse', clientX: 600 + i * 8, clientY: 400 + i * 4 }); browser.frames(1); }
  map.dispatch('pointerup', { pointerId: 7, pointerType: 'mouse', clientX: 680, clientY: 440 });
  map.dispatch('wheel', { deltaY: -200, deltaMode: 0, clientX: 640, clientY: 400 });
  browser.frames(2);
  assert.ok(game('SystemMap.stats.frames') > frames, 'the map redraws as it moves');
  browser.document.getElementById('map-reset').dispatch('click', {});
  browser.frames(1);
  // Local view. Tap a station: its callout shows its name and security above it, and Set marker below.
  const st = game('__startStation()');
  tapMap(game(`SystemMap.toScreen(${st.x}, ${st.y})`));
  let c = game('SystemMap.callout.content');
  assert.ok(c, 'a callout for the station');
  assert.strictEqual(c.lines[0].text, st.name);
  assert.match(c.lines[1].text, /^Security: /);
  assert.deepStrictEqual(c.actions.map((a) => a.id), ['mark']);
  pressCallout('mark');
  assert.strictEqual(game('SystemMap.marker.name'), st.name, 'the station is marked');
  assert.ok(!game('SystemMap.callout.isShown'), 'and let go');
  // Tapped again, it offers to clear the marker.
  tapMap(game(`SystemMap.toScreen(${st.x}, ${st.y})`));
  assert.deepStrictEqual(game('SystemMap.callout.content').actions.map((a) => a.id), ['unmark']);
  pressCallout('unmark');
  assert.strictEqual(game('SystemMap.marker'), null, 'cleared');
  // Tap empty space inside the system: only its security, and Set marker.
  const o = game('SystemMap.system.origin'), R = game('SystemMap.system.radius');
  const spot = game(`SystemMap.toScreen(${o.x + R * 0.37}, ${o.y + R * 0.61})`);
  tapMap(spot);
  c = game('SystemMap.callout.content');
  assert.ok(c, 'a callout for the point');
  assert.strictEqual(c.lines.length, 1);
  assert.match(c.lines[0].text, /^Security: /);
  assert.deepStrictEqual(c.actions.map((a) => a.id), ['mark']);
  // Tapping it again lets go.
  tapMap(spot);
  assert.ok(!game('SystemMap.callout.isShown'), 'deselected');
  // Marked, then reached in flight: the marker clears.
  tapMap(spot);
  pressCallout('mark');
  const mk = game('SystemMap.marker');
  assert.ok(mk && mk.name === null, 'a point is marked');
  game('SystemMap.close()');
  browser.frames(2);
  assert.ok(game('!!SystemMap.marker'), 'still marked while far away');
  game(`fight.grace = 1e9; placeShip(${mk.x}, ${mk.y})`);
  browser.frames(2);
  assert.strictEqual(game('SystemMap.marker'), null, 'reached');
  assert.match(game('toast.text'), /^Reached your marker/);
  game('{ const st = __startStation(); placeShip(st.x, st.y + st.radius + 300); }');
  browser.frames(2);

  // Galaxy view: the one system, tapped: no map travel to where the ship already is.
  game('SystemMap.open(); SystemMap.setMode("galaxy")');
  browser.frames(2);
  const home = game('world.galaxy.systems[0]');
  tapMap(game(`SystemMap.toScreen(${home.origin.x}, ${home.origin.y})`));
  c = game('SystemMap.callout.content');
  assert.ok(c, 'a callout for the system');
  assert.strictEqual(c.lines[0].text, `${home.name} system`);
  assert.deepStrictEqual(c.actions.map((a) => [a.id, a.enabled]), [['travel', false]]);
  game('SystemMap.setMode("local"); SystemMap.close()');
  browser.frames(2);
  // A trip to a point, stopped halfway: the ship drops out of cruise where the trip had got to.
  game(`fight.grace = 1e9; SystemMap.open(); SystemMap.hooks.travel({ kind: 'point', x: 0, y: -world.galaxy.systems[0].radius * 0.8, name: 'the marked point' });`);
  browser.frames(3);
  const at = game('({ ...world.travel.pos })');
  game('SystemMap.hooks.stop()');
  assert.ok(game(`!world.travel.active && Math.hypot(ship.x - ${at.x}, ship.y - ${at.y}) < 1`), 'dropped out where the trip was');
  game('{ const st = __startStation(); placeShip(st.x, st.y + st.radius + 300); }');
  browser.frames(5);
});

// Somewhere a pirate flies, posed for now, and the ship placed 800 units from it (in attack
// range, outside the range where pirates attack on their own).
// A fight test leaves no fight behind, even when it fails part way: the steps share one game.
function fightTest(name, fn) {
  off('?pirates', name, () => {
    try { fn(); } finally {
      game('__breakOff()');
      browser.frames(300); // the result panel times out
    }
  });
}
function meetPirate() {
  game(`globalThis.__pirate = __find((e) => e.kind === 'ship' && isHostile(e) && !cargo.removed.has(e.key));`);
  assert.ok(game('!!__pirate'), 'there are pirates somewhere');
  game(`cargo.hull = SHIP.hull; fight.grace = 1e9; { const a = Math.atan2(__pirate.y, __pirate.x); placeShip(__pirate.x + Math.cos(a) * (800 + __pirate.radius), __pirate.y + Math.sin(a) * (800 + __pirate.radius)); }`);
  browser.frames(1);
  // Its card says how a fight would go, and (a tap away) how many would fight with it: that's who
  // the fight takes on.
  const card = game('describe(frameList.find((x) => x.key === __pirate.key))');
  assert.match(card.tag, /^(Weak|Even|Outmatched)$/, 'the threat, in a word');
  const m = card.detail.match(/^(Alone|Pack of (\d+)) · Mk [IV]+ gear$/);
  assert.ok(m, `the card's detail shows the pack: ${card.detail}`);
  game(`fight.grace = 0; { const e = frameList.find((x) => x.key === __pirate.key); engage(e); }`);
  assert.ok(game('!!fight.s'), 'the fight starts');
  assert.strictEqual(game('fight.s.enemies.length'), m[2] ? Number(m[2]) : 1, 'the whole pack, and only the pack, fights');
}

fightTest('fights in rounds to the end', () => {
  game(`combatMode.set('rounds')`);
  meetPirate();
  assert.strictEqual(game('fight.mode'), 'rounds');
  assert.ok(until('!inFight()', 120 * 60), 'the fight ends');
  assert.ok(['won', 'lost', 'fled'].includes(game('fight.result')), `ended with a result: ${game('fight.result')}`);
});

fightTest('abilities in a fight: the player spends a charge from the panel, a wingman by its use line', () => {
  game(`combatMode.set('rounds'); cargo.kit = { 'emp-charge': 2, 'repair-nanites': 1 }`);
  meetPirate();
  browser.frames(2);
  const panel = () => textOf(browser.document.getElementById('combat').querySelector('.cb-abil'));
  const labels = () => browser.document.getElementById('combat').querySelector('.cb-abil').children.map((b) => b.getAttribute('aria-label'));
  assert.deepStrictEqual(labels().slice(0, 4).map((l) => l.split(' (')[0]), ['Overload', 'Salvo', 'Mark target', 'Barrage'], 'the class\'s four skills first (a DPS)');
  assert.deepStrictEqual(labels().slice(4), ['Repair nanites, 1 left', 'EMP charge, 2 left'], 'a button per consumable in the kit');
  assert.match(panel(), /×1.*×2/, 'with its charges');
  // The player: an EMP on the enemy targeted.
  game('fight.s.player.hull = Math.min(fight.s.player.hull, 10)');
  game(`useAbility(fight.s, fight.s.player, 'emp-charge', fight.s.focus)`);
  assert.ok(game(`cargo.kit['emp-charge'] === 1 && Abilities.disabled(fight.s.enemies.find((e) => e.id === fight.s.focus), fight.s.t)`), 'spent, and the target silenced');
  assert.ok(!game(`useAbility(fight.s, fight.s.player, 'emp-charge', fight.s.focus)`), 'cooling down');
  // The bar's buttons are updated in place while one cools down, not rebuilt every frame (a press
  // between pointer down and up would be lost to a rebuild).
  const buttons = () => browser.document.getElementById('combat').querySelector('.cb-abil').children;
  browser.frames(1); // the charge spent: the bar rebuilt once for the count
  const before = buttons();
  browser.frames(3);
  assert.ok(before.length === buttons().length && before.every((b, i) => b === buttons()[i]), 'the same buttons through the cooldown');
  assert.ok(buttons().find((b) => b.getAttribute('data-id') === 'ability:emp-charge').disabled, 'the spent charge\'s button disabled in place');
  // A wingman with a use line repairs the damaged leader.
  game(`cargo.squad[0].program.unshift({ ...Logic.blank(), subject: 'leader', act: 'use', skill: 'repair-nanites' })`);
  browser.frames(2);
  assert.ok(game(`!cargo.kit['repair-nanites'] && fight.s.player.hull > 10`), 'the wingman used the nanites on the leader');
  game('cargo.squad[0].program.shift()');
  assert.ok(until('!inFight()', 120 * 60), 'the fight ends');
});

fightTest('fights in real time, then gets away', () => {
  game(`combatMode.set('realtime')`);
  meetPirate();
  assert.strictEqual(game('fight.mode'), 'realtime');
  // Fly at the target for a while (the guns fire on their own), then break away.
  const chase = `{ const t = fight.s && fight.ships.get(fight.s.focus); if (t) { ship.targetAngle = Math.atan2(t.y - ship.y, t.x - ship.x); ship.targetSpeed = SHIP.maxSpeed * 0.5; } }`;
  // The combat bar is only the skills: the fight is drawn round the ships.
  browser.frames(1);
  const bar = browser.document.getElementById('combat');
  assert.ok(!bar.hidden && bar.querySelector('.cb-abil').children.length >= 3, 'a skill bar');
  let fired = false;
  for (let i = 0; i < 30 * 60 && game('!!fight.s'); i++) {
    game(chase);
    browser.frames(1);
    fired ||= game(`fight.fx.some((f) => f.type === 'beam' && f.from === 'player')`);
  }
  assert.ok(fired, 'the guns fired');
  const away = `{ const a = fight.s ? Math.atan2(ship.y - fight.s.anchor.y, ship.x - fight.s.anchor.x) : 0; ship.targetAngle = a; ship.targetSpeed = SHIP.maxSpeed; }`;
  assert.ok(until('!inFight()', 120 * 60, away), 'the fight ends');
  game('ship.targetSpeed = 0');
});

test('the wingman flies in formation, assists the leader in both combat modes, and is repaired at a dock', () => {
  assert.strictEqual(game('cargo.squad.length'), 1, 'one wingman (hired at the start)');
  const id = game('cargo.squad[0].id');
  game('repairSquad()'); // an earlier fight may have left it disabled until the next dock
  assert.match(game('cargo.squad[0].name'), /^[A-Z][a-z]+-\d\d$/);
  assert.strictEqual(game(`wings.get('${id}').art.culture.lineage`), 'android', 'built in the android culture');
  // Give it the Assist leader line.
  assert.ok(game(`programs.set(cargo.squad[0].id, 0, Logic.PRESETS['assist.leader'])`));
  // It follows the ship around and settles into its place in formation.
  game(`fight.grace = 1e9; { const st = __startStation(); placeShip(st.x, st.y + st.radius + 2500, Math.PI / 2); } ship.targetAngle = 0.4; ship.targetSpeed = SHIP.maxSpeed * 0.6;`);
  browser.frames(120);
  game('ship.targetSpeed = 0');
  browser.frames(240);
  const gap = game(`{ const w = wings.get('${id}'), st = Squad.formation(ship, 0); Math.hypot(w.x - st.x, w.y - st.y) }`);
  assert.ok(gap < 80, `in formation (${gap.toFixed(0)} units off)`);
  assert.ok(game(`frameList.some((e) => e.kind === 'wingman' && e.key === '${id}' && visible(e))`), 'drawn beside the ship');
  game(`select(frameList.find((e) => e.kind === 'wingman'))`);
  browser.frames(1);
  assert.match(game('describe(selected.e).subtitle'), /^Squad · android fighter · 1 logic line/);
  game('select(null)');
  // In a fight it joins as an ally, and its combat logic module has it fire on the leader's target.
  for (const mode of ['rounds', 'realtime']) {
    game(`combatMode.set('${mode}'); repairSquad(); snapWings();`);
    meetPirate();
    assert.strictEqual(game('fight.s.allies.length'), 1, `${mode}: the wingman fights`);
    browser.frames(1);
    assert.ok(game(`fight.fx.some((f) => f.type === 'code' && f.at === '${id}' && f.text === 'L1 › attack(enemy)')`), `${mode}: the line it runs shows over it`);
    const chase = mode === 'realtime' ? `{ const t = fight.s && fight.ships.get(fight.s.focus); if (t) { ship.targetAngle = Math.atan2(t.y - ship.y, t.x - ship.x); ship.targetSpeed = SHIP.maxSpeed * 0.4; } }` : '';
    assert.ok(until(`!fight.s || fight.fx.some((f) => f.type === 'beam' && f.from === '${id}')`, 60 * 40, chase), `${mode}: it opens fire`);
    if (game('!!fight.s')) assert.strictEqual(game(`fight.s.allies[0].order.target`), game('fight.s.focus'), `${mode}: on the leader's target`);
    if (game('!!fight.s')) assert.strictEqual(game('fight.s.allies[0].line'), 0, `${mode}: it runs line 1`);
    assert.ok(game(`lineRuns.get('${id}')[0] >= 1`), `${mode}: line 1 ran`);
    game('fight.s && (fight.s.over = "fled")');
    browser.frames(2);
    game('ship.targetSpeed = 0');
    browser.frames(300);
  }
  // Shot down: gone from space until the ship docks, which repairs it.
  game(`wingDisabled('${id}')`);
  browser.frames(2);
  assert.ok(game(`cargo.squad[0].disabled && !frameList.some((e) => e.kind === 'wingman')`), 'disabled and out of sight');
  game('{ const st = __startStation(); placeShip(st.x, st.y + st.radius + 150); dock(st); }');
  assert.ok(game('!!docked'), 'docked');
  assert.ok(game('!cargo.squad[0].disabled && cargo.squad[0].hullPoints === Squad.stats(cargo.squad[0]).hull'), 'repaired');
  game(`StationMenu.showTab('squad')`);
  const tab = textOf(browser.document.getElementById('st-body'));
  assert.match(tab, /01IFEnemyis the leader's targetTHEN ▶AttackEnemy/, 'its instruction, as a card');
  assert.match(tab, /ELSE ▶Follow leader/, 'and what it does when none applies');
  assert.match(tab, /1\/3 run/);
  assert.match(tab, /Used \d+× last fight/, 'how often the instruction was used');
  // The last fight, step by step: folded, then each line switch with its time, what it did and on whom.
  assert.match(tab, /Last fight · \d+ steps?/, 'the fight\'s timeline, folded');
  pressOnStation(/^Last fight/);
  assert.match(textOf(browser.document.getElementById('st-body')), /\d:\d\d1\. If Enemy is the leader's target: Attack Enemy\. → \w.*\d+%.*Disabled/, 'a step: when, which instruction, on whom, its hull; and when it was disabled');
  game(`StationMenu.showTab('squad')`);
  // A line after one that always holds never runs, and says so.
  assert.ok(game(`programs.set(cargo.squad[0].id, 0, Logic.blank()) && programs.set(cargo.squad[0].id, 1, Logic.PRESETS['assist.leader'])`));
  game(`StationMenu.refresh()`);
  assert.match(textOf(browser.document.getElementById('st-body')), /Never runs: instruction 1 always applies first/);
  assert.ok(game(`programs.set(cargo.squad[0].id, 0, Logic.PRESETS['assist.leader']) && programs.remove(cargo.squad[0].id, 1)`));
  // The Ship tab steps between your ship and the wingman's, round and round.
  const ship = () => textOf(browser.document.getElementById('st-body'));
  const name = game('cargo.squad[0].name');
  game(`StationMenu.showTab('ship')`);
  assert.strictEqual(game('StationMenu.viewing'), id, 'the Ship tab stays on the wingman it showed');
  game('StationMenu.stepShip(1)');
  assert.strictEqual(game('StationMenu.viewing'), null, 'and steps round to your ship');
  assert.match(ship(), /Your ship 1\/2/);
  assert.match(ship(), /Shipyard|sell new hulls/, 'with the shipyard');
  game('StationMenu.stepShip(1)');
  assert.strictEqual(game('StationMenu.viewing'), id, 'then the wingman');
  assert.match(ship(), new RegExp(`${name} 2/2`));
  assert.match(ship(), /Fighter · 5\/5 fitted/);
  assert.match(ship(), /Performance.*Instructions.*ELSE/, 'its performance, then its program');
  assert.doesNotMatch(ship(), /Shipyard|Hold/, 'not your ship\'s hold or the shipyard');
  assert.ok(ship().includes(`${Math.round(game('Squad.stats(cargo.squad[0]).maxSpeed'))}Speed`), 'its own speed');
  // Its gear is fitted from the spare gear, like yours: a Mk II laser in place of its Mk I.
  game(`cargo.gear['pulse-laser-2'] = 1; cargo.squad[0].xp = 5000; refreshWing(cargo.squad[0]); StationMenu.refresh(); StationMenu.toggleSlot('weapon-1')`);
  assert.match(onStation(), new RegExp(`Gun 1${name} · Gun mount`), 'the sheet is for the wingman');
  assert.match(onStation(), /Fitted.*Mining laserMk I.*Remove.*Spare gear.*Mining laserMk IISpare ×1/, 'what it has (your starting gear), then the spare gear');
  const dps = game('Squad.stats(cargo.squad[0]).firepower');
  assert.ok(game(`outfitting.member('${id}').fit('weapon-1', 'pulse-laser-2')`));
  assert.ok(game('Squad.stats(cargo.squad[0]).firepower') > dps, 'it fires harder');
  assert.strictEqual(game(`wings.get('${id}').stats.firepower`), game('Squad.stats(cargo.squad[0]).firepower'), 'and flies with it');
  assert.deepStrictEqual(game(`[cargo.gear['pulse-laser-2'] || 0, cargo.gear['pulse-laser-1']]`), [0, 1], 'its Mk I to the spare gear');
  game(`StationMenu.closeSheet()`);
  pressOnStation(/^Spare gear · /); // folded until opened
  assert.match(ship(), /Spare gear.*Mining laserMk I.*Sell/, 'spare gear like any other');
  assert.ok(game(`outfitting.member('${id}').unfit('shield') && cargo.squad[0].loadout.fitted.shield === null && Squad.stats(cargo.squad[0]).shield === 0`), 'a slot emptied');
  assert.ok(game(`outfitting.member('${id}').fit('shield', 'deflector-1') && outfitting.member('${id}').fit('weapon-1', 'pulse-laser-1')`), 'and its own gear back');
  // Android gear (from a save made before) fits squad ships only, and isn't sold.
  game(`cargo.gear['autocannon-1'] = 1`);
  assert.ok(game(`!outfitting.sell('autocannon-1') && !outfitting.fit('weapon-1', 'autocannon-1')`), 'not sold, and not for your ship');
  game(`StationMenu.refresh()`);
  assert.match(ship(), /AutocannonMk IAndroid.*Squad only/);
  game(`delete cargo.gear['autocannon-1']`);
  assert.strictEqual(game('Squad.stats(cargo.squad[0]).firepower'), dps);
  assert.strictEqual(game(`cargo.gear['pulse-laser-2']`), 1, 'the laser back with the spare gear');
  assert.ok(!game(`outfitting.member('nobody')`));
  game('StationMenu.stepShip(1)');
  assert.strictEqual(game('StationMenu.viewing'), null, 'and round to your ship again');
  assert.doesNotMatch(onStation(), /Fighter · /, 'your own ship shown');
  game('StationMenu.stepShip(-1)');
  assert.strictEqual(game('StationMenu.viewing'), id, 'backwards too');
  game('launch()');
  game('{ const st = __startStation(); placeShip(st.x, st.y + st.radius + 150); dock(st); StationMenu.showTab("ship"); }');
  assert.strictEqual(game('StationMenu.viewing'), null, 'docking again shows your ship');
  game('launch()');
  browser.frames(3);
  assert.ok(game(`frameList.some((e) => e.kind === 'wingman')`), 'back in formation');
});

// The galaxy's jobs (story/jobs.js, game/jobs.js). The gates are online for these, and fights are
// won (the enemies are worn down), so a job's steps are what's tested, not the dice.
const winFight = (what) => {
  assert.ok(until('!inFight()', 120 * 60, 'cargo.hull = SHIP.hull; if (fight.s) for (const e of fight.s.enemies) e.hull = Math.min(e.hull, 1)'), `${what}: the fight ends`);
  assert.strictEqual(game('fight.result'), 'won', what);
  browser.frames(200); // the last explosion, and the result panel
};
// Dock at a station (by key), on the Missions tab.
function dockAt(key) {
  if (game('!!docked')) game('launch()');
  // (A pirate pack met on the way, in this ?pirates galaxy, isn't what these tests are about: away
  // from it, and left alone while docking.)
  game('__breakOff(); fight.grace = Math.max(fight.grace, 5)');
  game(`{ const st = world.scene.stations.find((s) => s.key === '${key}'); placeShip(st.x, st.y + st.radius + 150); dock(st); StationMenu.showTab('missions'); }`);
  assert.strictEqual(game('docked && docked.station.key'), key, `docked (${game(`fight.wreckT > 0 ? 'the ship was lost: ' + JSON.stringify([cargo.hull, cargo.heat ?? hazard.heat, cargo.rad, cargo.fuel]) : inFight() ? 'in a fight' : actions.state('dock', world.scene.stations.find((s) => s.key === '${key}')).label`)})`);
}

// The game has no job texts at the moment (story/job-texts.js), so the job tests write their own:
// a hunt at the outposts and the minor station, an escort with a twist from the capital to the
// hub, and a delivery at the hub. The board is rebuilt with them, and without them afterwards.
function rebuildBoard() {
  game('cargo.board = Jobs.board(world.galaxy); cargo.missions = Missions.create(cargo.missions.save(), cargo.board.byId)');
}
function installTestJobs() {
  const { go, fight, bring } = JobTexts;
  const hunt = (c) => {
    const at = c.space(c.st, 5000, 9000);
    return at && {
      name: 'Pirate hunt', briefing: [`Pirates are watching the lanes out of ${c.st.name}.`, `Traffic control has them **${at.name}**.`],
      steps: [go([at], `Fly to the pirates ${at.name}`), fight(at, 2, 'Destroy the pirates')], debrief: ['The lanes are clear.'],
    };
  };
  const escort = (c) => {
    const hub = c.stations((st) => st.market.type === 'major')[0], mid = hub && c.space({ x: (c.st.x + hub.x) / 2, y: (c.st.y + hub.y) / 2 }, 0, 4000);
    return mid && {
      name: 'Freight run', briefing: ['A freighter needs an escort to the hub.', 'Keep it in one piece.'],
      escort: { name: 'Freighter', culture: 1 },
      steps: [go([mid], `Escort the freighter ${mid.name}`), fight(mid, 2, 'Fight off the ambush', { rush: true, say: ['Contacts closing fast. They were waiting for us.'] }), go([hub], `Deliver the freighter to ${hub.name}`)],
      deliver: true, debrief: ['Delivered.'],
    };
  };
  const supply = () => ({ name: 'Iron for the hub', briefing: ['The hub is short of iron.', 'Bring some in.'], steps: [bring('iron', 4, 'Bring 4 iron')], debrief: ['Thanks.'] });
  Object.assign(JobTexts.STATION, {
    capital: [['escort', escort]], major: [['supply', supply]],
    minor: [['hunt', hunt]], 'mining camp': [['hunt', hunt]], 'salvage yard': [['hunt', hunt]], 'transport hub': [['hunt', hunt]],
  });
  rebuildBoard();
}
function removeTestJobs() {
  for (const k of Object.keys(JobTexts.STATION)) delete JobTexts.STATION[k];
  rebuildBoard();
}

off('no job texts', 'jobs: every station posts one, named for it; a hunt is taken, fought and handed in, and raises regard', () => {
  installTestJobs();
  game(`combatMode.set('rounds'); fight.grace = 1e9; cargo.hull = SHIP.hull; repairSquad()`);
  assert.ok(game(`world.galaxy.stations.filter((st) => !st.waystation && st.site === undefined).every((st) => cargo.board.list.some((j) => j.tier === 'station' && j.scope === st.key))`), 'every station has a job of its own (but the observatories out in deep space)');
  // A hunt at a station.
  game(`globalThis.__job = cargo.board.list.find((j) => j.tier === 'station' && j.steps.length === 2 && j.steps[1].type === 'fight' && cargo.missions.status(j.id) === 'offered');`);
  const id = game('__job.id'), title = game('__job.title'), key = game('__job.scope');
  dockAt(key);
  assert.ok(title.startsWith(`${game('docked.station.name')}: `), `named for its station: ${title}`);
  game(`StationMenu.showTab('missions')`);
  assert.match(onStation(), new RegExp(title));
  openMission(title);
  assert.match(onStation(), /Regard \+4 with /, 'and regard with its faction');
  pressOnStation('Accept mission');
  assert.deepStrictEqual(game(`[cargo.missions.status('${id}'), cargo.missions.at('${id}'), cargo.track]`), ['active', key, id]);
  game('launch()');
  browser.frames(2);
  assert.match(game('objective().text'), /^Fly to the /);
  // There by map travel to the objective: reached, and the pirates are there.
  game(`arriveAt({ kind: 'objective', x: objective().x, y: objective().y })`);
  browser.frames(2);
  assert.ok(game(`cargo.missions.done('${id}', 's0')`), 'reached');
  const n = game('__job.steps[1].wave.ships.length');
  assert.strictEqual(game(`frameList.filter((e) => isHostile(e) && e.key.startsWith('j:${id}:')).length`), n, 'its wave');
  assert.match(game('objective().text'), new RegExp(`^Destroy the \\w+${n > 1 ? ` · 0/${n}` : ''}`));
  game(`{ const e = frameList.find((x) => isHostile(x) && x.key.startsWith('j:${id}:')); placeShip(e.x + 800 + e.radius, e.y); }`);
  browser.frames(1);
  game(`fight.grace = 0; engage(frameList.find((e) => isHostile(e) && e.key.startsWith('j:${id}:')))`);
  assert.strictEqual(game('fight.s.enemies.length'), n, 'the whole wave fights');
  winFight('the hunt');
  assert.strictEqual(game(`cargo.missions.status('${id}')`), 'ready');
  assert.match(game('objective().text'), /^Report to /);
  // Handed in: paid, and its faction thinks better of you.
  const credits = game('cargo.credits'), reward = game('__job.reward.credits');
  const regard = game(`Reputation.regard(cargo.rep, __job.faction)`);
  dockAt(key);
  openMission(title);
  pressOnStation('Complete mission');
  assert.strictEqual(game(`cargo.missions.status('${id}')`), 'done');
  assert.strictEqual(game('cargo.credits'), credits + reward, 'paid');
  assert.ok(reward >= 400, `worth the trip (${reward} cr)`);
  assert.strictEqual(game(`Reputation.regard(cargo.rep, __job.faction)`), regard + game('Reputation.JOB.station'), 'regard with the giver');
  game('launch()');
  browser.frames(2);
  assert.ok(game(`!objective() || jobOf(trackedJob()).tier === 'story'`), 'nothing under way but the story');
});

off('no job texts', 'jobs: an escort with a twist on the comms, handed in where it delivers; goods handed over; abandoning starts over', () => {
  // An escort, delivered elsewhere, with a wave that comes for you after a call on the comms.
  game(`globalThis.__job = cargo.board.list.find((j) => j.escort && j.escort.from === undefined && j.handIn
    && j.steps.some((s) => s.wave && s.wave.rush && s.say) && j.steps.every((s) => s.type === 'go' || s.type === 'fight'));
    globalThis.__at = world.scene.stations.find((s) => Jobs.offeredAt(__job, s.station));`);
  const id = game('__job.id'), title = game('__job.title');
  assert.ok(title.startsWith(`${game('__at.name')}: `), `named for its station: ${title}`);
  dockAt(game('__at.key'));
  openMission(title);
  // Away from the waystation too, the giver has a portrait (art/crew.js) of their faction's culture.
  const stBody = browser.document.getElementById('st-body');
  assert.ok(allOf(stBody).some((el) => el.tagName === 'CANVAS' && el.className === 'ui-face'), 'the giver\'s portrait');
  pressOnStation('Accept mission');
  game('launch()');
  browser.frames(2);
  assert.ok(game(`formationShips().some((e) => e.escort === '${id}')`), 'the escorted ship flies with you');
  const steps = game('__job.steps.length');
  for (let i = 0; i < steps; i++) {
    assert.ok(until(`cargo.missions.open('${id}', 's${i}')`, 60 * 10, 'if (talk.lines) Comms.next()'), `step ${i} opens`);
    if (game(`__job.steps[${i}].type`) === 'fight') {
      assert.ok(until('!!fight.s', 60 * 10, 'if (talk.lines) Comms.next()'), 'the wave comes for you');
      assert.match(game('fight.log[0]'), / attack!$/);
      winFight(`step ${i}`);
      continue;
    }
    for (const p of game(`__job.steps[${i}].points`)) {
      if (p.station) { dockAt(p.station); if (i < steps - 1) game('launch()'); } else { game(`fight.grace = 0; placeShip(${p.x + 300}, ${p.y})`); browser.frames(2); }
    }
    if (i === 0 && game(`__job.steps[1].say`)) {
      assert.ok(until('!!talk.lines', 60 * 10), 'a call on the comms');
      assert.match(game('talk.from'), new RegExp(game('__job.from')));
    }
  }
  assert.strictEqual(game(`cargo.missions.status('${id}')`), 'ready');
  assert.strictEqual(game('docked.station.key'), game('__job.handIn'), 'docked where it delivers');
  openMission(title);
  pressOnStation('Complete mission');
  assert.strictEqual(game(`cargo.missions.status('${id}')`), 'done');
  assert.ok(!game(`formationShips().some((e) => e.escort === '${id}')`), 'the escort stays where it was going');
  // Goods to bring: taken, abandoned, taken again (starting over), the goods counted from the hold.
  game(`globalThis.__bring = cargo.board.list.find((j) => j.tier === 'station' && j.steps.length === 1 && j.steps[0].type === 'bring' && cargo.missions.status(j.id) === 'offered')`);
  const bid = game('__bring.id'), [kind, need] = game('[__bring.steps[0].kind, __bring.steps[0].n]');
  dockAt(game('__bring.scope'));
  openMission(game('__bring.title'));
  pressOnStation('Accept mission');
  pressOnStation('Abandon');
  assert.deepStrictEqual(game(`[cargo.missions.status('${bid}'), cargo.missions.attempt('${bid}')]`), ['offered', 1]);
  openMission(game('__bring.title'));
  pressOnStation('Accept mission');
  assert.strictEqual(game(`cargo.missions.attempt('${bid}')`), 2);
  game(`cargo.items = []; for (let i = 0; i < ${need}; i++) cargo.items.push({ kind: '${kind}', label: Goods.type('${kind}').name, category: 'trade' })`);
  game('launch()');
  browser.frames(2);
  assert.strictEqual(game(`cargo.missions.status('${bid}')`), 'ready', 'the goods are aboard');
  game('cargo.items.pop()');
  browser.frames(2);
  assert.strictEqual(game(`cargo.missions.status('${bid}')`), 'active', 'one sold: not yet');
  game(`cargo.items.push({ kind: '${kind}', label: 'x', category: 'trade' }); cargo.items.push({ kind: 'iron', label: 'Iron', category: 'trade' })`);
  browser.frames(2);
  dockAt(game('__bring.scope'));
  openMission(game('__bring.title'));
  pressOnStation('Complete mission');
  assert.deepStrictEqual(game('cargo.items.map((it) => it.kind)'), ['iron'], 'the goods handed over, nothing else');
  game('launch(); fight.grace = 0');
  removeTestJobs();
});

test('progress: a kill gives experience, a level up makes the ship stronger, a talent is taken; a lost ship is towed for a bill', () => {
  if (game('!!docked')) game('launch()');
  game(`globalThis.__was = { xp: cargo.pilot.xp, talents: [...cargo.pilot.talents], cls: cargo.cls, credits: cargo.credits };
    cargo.pilot.xp = 0; cargo.pilot.talents = []; applyShip(); cargo.hull = SHIP.hull`);
  const hull = game('SHIP.hull');
  game(`gainXP(Progress.toNext(1) + Progress.toNext(2) + Progress.toNext(3) - 1)`);
  assert.strictEqual(game('pilotLevel()'), 3);
  assert.ok(game('SHIP.hull') > hull, 'sturdier at level 3');
  assert.match(Messages.log.map((l) => l.text).join('|'), /Level 3 · talent point/);
  assert.ok(game(`cargo.squad.every((m) => m.disabled || m.xp > 0)`), 'the squad learns too');
  // A destroyed enemy: experience by its tier.
  const xp = game('cargo.pilot.xp');
  game(`gainXP(Progress.killXP(1, pilotLevel()))`);
  assert.ok(game('cargo.pilot.xp') > xp);
  // A talent: a point at level 3, spent on the Ship tab's sheet.
  game('{ const st = __startStation(); placeShip(st.x, st.y + st.radius + 150); dock(st); } StationMenu.showTab("ship")');
  assert.match(onStation(), /Pilot · level [34].*1 talent point to spend/);
  assert.ok(game(`pilotView.take('reinforced-frame')`), 'taken');
  assert.ok(!game(`pilotView.take('cargo-racks')`), 'no point left');
  const withTalent = game('SHIP.hull');
  game('cargo.credits = 10000');
  assert.ok(game('pilotView.respec()') && game('SHIP.hull') < withTalent, 'forgotten for credits');
  assert.strictEqual(game('cargo.credits'), 10000 - game('Progress.RESPEC(pilotLevel())'));
  game('launch()');
  // Lost: towed home, billed by the hull's price and how far out it was.
  game('cargo.credits = 10000; wreck()');
  const bill = game('towBill()');
  assert.ok(bill > 0, `a bill (${bill})`);
  assert.ok(until('!fight.wrecked && !(fight.wreckT > 0)', 60 * 10), 'towed home');
  assert.strictEqual(game('cargo.credits'), 10000 - bill);
  game(`cargo.pilot.xp = __was.xp; cargo.pilot.talents = __was.talents; cargo.credits = __was.credits; applyShip(); cargo.hull = SHIP.hull`);
});

test('text with **bold** runs becomes text and <strong> elements', () => {
  const parts = UI.rich('It has been **793** solar cycles');
  assert.deepStrictEqual(parts.map((p) => (typeof p === 'string' ? p : `<${p.tagName}>${textOf(p)}`)), ['It has been ', '<STRONG>793', ' solar cycles']);
});

test('notices are an event log: the last 5 lines, a repeat counted, each gone after 10 s', () => {
  Messages.clear();
  for (const t of ['a', 'b', 'b', 'c', 'd', 'e', 'f']) game(`notify(${JSON.stringify(t)})`);
  assert.deepStrictEqual(Messages.log.map((l) => (l.n > 1 ? `${l.text}×${l.n}` : l.text)), ['b×2', 'c', 'd', 'e', 'f'], 'five lines, the oldest gone');
  game(`notify('Hold full', 2.5, { once: true }); notify('Hold full', 2.5, { once: true })`);
  assert.strictEqual(Messages.log.at(-1).n, 1, 'once: not counted up while it is in the log');
  Messages.tick(6);
  Messages.push('g');
  Messages.tick(4.5);
  assert.deepStrictEqual(Messages.log.map((l) => l.text), ['g'], 'ten seconds each');
  Messages.tick(6);
  assert.deepStrictEqual(Messages.log, []);
  browser.frames(1); // the HUD draws it
});

test('a save exported to a file comes back in, and nothing else does', () => {
  game('saveAll()');
  const data = Store.dump();
  assert.ok(Object.keys(data).some((k) => k.startsWith('cargo:')), 'the cargo is in it');
  const text = JSON.stringify({ game: 'untitled-space-game', saved: '2026-10-17', data });
  assert.deepStrictEqual(game(`readBackup(${JSON.stringify(text)})`), data, 'read back as it was');
  assert.strictEqual(game(`readBackup('{"game":"another","data":{}}')`), null, 'not another game\'s file');
  assert.strictEqual(game(`readBackup('not json')`), null, 'not a damaged one');
  assert.ok(Store.load(data));
  assert.deepStrictEqual(Store.dump(), data, 'written back whole');
  // The other games on the same site keep their saves: not in the file, not touched coming back.
  Store.set('idle.save', 'theirs');
  assert.ok(!('idle.save' in Store.dump(game('ownKey'))), 'another game\'s save is left out');
  assert.strictEqual(game(`readBackup(${JSON.stringify(JSON.stringify({ game: 'untitled-space-game', data: { ...data, 'race.career': 'old' } }))})`)['race.career'], undefined, 'and not read from an older file');
  assert.ok(Store.load(data, game('ownKey')));
  assert.strictEqual(Store.get('idle.save'), 'theirs', 'nor rolled back');
  assert.deepStrictEqual(Store.dump(game('ownKey')), data);
  Store.remove('idle.save');
});

test('in Cruise a tap on empty space keeps your speed; a double-tap stops', () => {
  game(`moveMode.set('cruise'); select(null); fight.grace = 1e9; { const st = __startStation(); placeShip(st.x + st.radius + 5000, st.y); }`);
  browser.frames(1);
  const canvas = browser.document.getElementById('game');
  const tap = (pointerId, timeStamp) => {
    const at = { pointerId, pointerType: 'touch', button: 0, clientX: 60, clientY: 520, timeStamp };
    canvas.dispatch('pointerdown', at);
    canvas.dispatch('pointerup', at);
  };
  // Far past any real timestamp: earlier taps in the run are stamped with performance.now(), and
  // one of those within 0.4 s would make the first tap here the second of a double-tap.
  const T = 1e9;
  game('ship.targetSpeed = 200');
  tap(21, T);
  assert.strictEqual(game('ship.targetSpeed'), 200, 'one tap: still flying');
  tap(22, T + 250);
  assert.strictEqual(game('ship.targetSpeed'), 0, 'a double-tap: stopped');
  game('ship.targetSpeed = 200');
  tap(23, T + 10000);
  tap(24, T + 11000);
  assert.strictEqual(game('ship.targetSpeed'), 200, 'two taps a second apart are two taps');
  game('ship.targetSpeed = 0');
});

test('text size, colours and motion apply at once and are remembered', () => {
  game(`textSize.set('130')`);
  assert.strictEqual(Theme.scale, 1.3);
  assert.match(Theme.font(10), /^13px /, 'canvas text scales with it');
  const red = Theme.color.hostile;
  game(`palette.set('safe')`);
  assert.notStrictEqual(Theme.color.hostile, red, 'hostile is no longer red');
  assert.strictEqual(game('HOSTILE_COLOR'), Theme.color.hostile, 'and what copied it follows');
  assert.strictEqual(browser.storage.get('palette'), 'safe', 'remembered');
  game(`motion.set('reduce'); whiteOut()`);
  assert.ok(game('flash') < 0.5, 'a soft fade instead of a white-out');
  game(`textSize.set('100'); palette.set('standard'); motion.set('full'); fadeFlash(10)`);
  assert.strictEqual(Theme.color.hostile, red);
});

off('?pirates', 'back from another app mid-fight, flight waits for a tap', () => {
  game('pauseForResume()');
  const t0 = game('simTime');
  browser.frames(5);
  assert.strictEqual(game('simTime'), t0, 'paused');
  browser.document.getElementById('resume').dispatch('click');
  browser.frames(3);
  assert.ok(game('simTime') > t0, 'going again after the tap');
});

test('docked: what finished since the last dock, Sell all, and a program tried out', () => {
  game(`globalThis.__sellable = Economy.market(world.galaxy.seed, __startStation()).goods.find((g) => g.sell !== null && g.buy !== null)`);
  game(`cargo.items = []; for (let i = 0; i < 3; i++) cargo.items.push({ kind: __sellable.kind, label: 'x', category: 'trade' });
    addNews('Research done · Test package', 'research');
    { const st = __startStation(); placeShip(st.x, st.y + st.radius + 150); dock(st); }`);
  assert.match(onStation(), /Since you last docked.*Research done · Test package/, 'what finished, on docking');
  pressOnStation('Done');
  game(`StationMenu.showTab('trade')`);
  const credits = game('cargo.credits');
  pressOnStation('Sell all');
  assert.strictEqual(game('cargo.items.length'), 0, 'the hold sold');
  // Each unit at the price the last left: no more than three at the first price.
  const gained = game('cargo.credits') - credits, first = game('__sellable.sell');
  assert.ok(gained <= 3 * first && gained >= 3 * first * 0.9, `Sell all made ${gained}, at ${first} each`);
  // The squad's program tried in fights on paper: one result per fight, the first instruction
  // that holds.
  const id = game('cargo.squad[0] && cargo.squad[0].id');
  if (id) {
    game(`programs.set('${id}', 0, Logic.PRESETS['assist.leader'])`);
    const results = game(`programs.test('${id}')`);
    assert.strictEqual(results.length, game('TEST_FIGHTS.length'));
    assert.deepStrictEqual([results[0].line, results[0].act], [0, 'attack'], 'a lone pirate on you: it assists');
    game(`StationMenu.showTab('squad')`);
    pressOnStation(/^Try it out/);
    assert.match(onStation(), /A lone pirate attacks you1\. Attacks Fighter A/);
  }
  game('launch()');
  browser.frames(2);
});

test('settings open and close', () => {
  game('Settings.open()');
  assert.ok(game('Settings.isOpen'));
  const reroll = allOf(browser.document.getElementById('settings').querySelector('.set-body')).find((el) => el.tagName === 'BUTTON' && textOf(el) === 'Re-roll');
  assert.ok(reroll && !reroll.disabled, 'Re-roll is in the menu');
  browser.frames(3);
  browser.key('Escape');
  assert.ok(!game('Settings.isOpen'), 'Escape closes the menu');
  browser.frames(3);

  // Paused behind the menu, flight stands still; once it closes, it goes on.
  game('fight.grace = 1e9; ship.targetSpeed = SHIP.maxSpeed * 0.5');
  game('Settings.open()');
  const t0 = game('simTime');
  browser.frames(5);
  assert.strictEqual(game('simTime'), t0, 'paused behind the menu');
  browser.key('Escape');
  browser.frames(2);
  assert.ok(game('simTime') > t0, 'going on once it closes');
  game('ship.targetSpeed = 0');
});

test('the menus follow the art style: its UI kit, its number font, a station in its culture\'s look', () => {
  const root = browser.document.documentElement;
  const deltas = () => textOf(Kit.deltas([{ code: 'DPS', diff: '8', better: 1 }, { code: 'RNG', diff: '50', better: -1 }]));
  game('artStyle.set("lowpoly")');
  assert.strictEqual(root.getAttribute('data-ui'), 'lowpoly');
  assert.match(Theme.font(12), /Martian Mono/, 'canvas numbers in the Low-poly kit\'s font');
  assert.match(deltas(), /▲8.*▼50/, 'filled arrows');
  game('artStyle.set("line")');
  assert.strictEqual(root.getAttribute('data-ui'), 'line');
  assert.match(Theme.font(12), /B612 Mono/, 'canvas numbers in the Line kit\'s font');
  assert.match(deltas(), /△8.*▽50/, 'open arrows');
  // Docked, the station screen takes the look of the culture it's built in.
  const st = browser.document.getElementById('station');
  st.setAttribute('data-culture', '');
  game('placeBeside(__startStation()); dock(__startStation())');
  assert.ok(game('!!docked'), 'docked');
  assert.strictEqual(st.getAttribute('data-culture'), game('__startStation().art.culture.lineage'));
  game('launch()');
});

test('selling drives a station\'s price down, and it recovers on the clock, saved', () => {
  game(`globalThis.__T = 1e12; Clock.now = () => __T; globalThis.__mk = marketAt(__startStation());
    globalThis.__g = __mk.goods.find((g) => g.buy !== null && g.rarity === 1);
    cargo.items = []; for (let i = 0; i < 60; i++) cargo.items.push({ kind: __g.kind, label: 'x', category: 'trade' });`);
  const price = () => game('__mk.good(__g.kind).sell');
  const first = price();
  for (let i = 0; i < 60; i++) assert.ok(game('__mk.sell(__g.kind)'));
  const low = price();
  assert.ok(low < first, `the price fell: ${first} -> ${low}`);
  assert.ok(game('__mk.good(__g.kind).left') > game('__g.left'), 'the stockpile grew');
  game('saveCargoNow(); loadCargo(world.galaxy); globalThis.__mk = marketAt(__startStation())');
  assert.strictEqual(price(), low, 'the stockpile is saved');
  game('__T += 10 * Economy.config.halfLife');
  assert.ok(Math.abs(price() - first) <= 1, `recovered: ${price()} vs ${first}`);
  // Buying it out: sold out, and Buy refuses.
  game(`cargo.credits = 1e9; cargo.items = []; for (let i = 0; i < 1000 && __mk.good(__g.kind).left > 0; i++) { if (!__mk.buy(__g.kind)) cargo.items = []; }`);
  assert.strictEqual(game('__mk.good(__g.kind).left'), 0, 'sold out');
  assert.ok(!game('__mk.buy(__g.kind)'), 'nothing left to buy');
  game('cargo.items = []; cargo.market = Economy.empty(); Clock.now = () => Date.now(); saveCargoNow()');
});

test('the factions menu: regard highest first, a row unfolds to enemies', () => {
  game(`cargo.rep = Reputation.empty(); Reputation.change(cargo.rep, 'block', 30); Reputation.change(cargo.rep, 'shard', -30)`);
  const root = browser.document.getElementById('factions').querySelector('.fac-body');
  const btn = browser.document.getElementById('factions-btn');
  btn.dispatch('click', {});
  assert.ok(game('FactionsMenu.isOpen'), 'opened from its button');
  assert.strictEqual(btn.getAttribute('aria-expanded'), 'true');
  const rows = () => allOf(root).filter((el) => el.className === 'fac-row');
  const names = rows().map((el) => textOf(allOf(el).find((x) => x.className === 'name')));
  assert.strictEqual(names.length, game('Reputation.visible().length'));
  assert.strictEqual(names[0], 'Block', 'the highest regard first');
  assert.strictEqual(names[names.length - 1], 'Aliens', 'the lowest last: the aliens are hostile');
  const regards = game('Reputation.ranked(cargo.rep).map((f) => Reputation.regard(cargo.rep, f.id))');
  assert.deepStrictEqual(regards, [...regards].sort((a, b) => b - a), 'ordered high to low');
  // The Shard row unfolds: what it stands for, and its enemies.
  rows().find((el) => /Shard/.test(textOf(el))).dispatch('click', {});
  const text = textOf(root);
  assert.match(text, /Ideals.*Allies.*None.*Hostile to.*Aliens/s);
  // A chip jumps to that faction's row.
  allOf(root).find((el) => el.className === 'fac-chip' && textOf(el) === 'Aliens').dispatch('click', {});
  assert.strictEqual(textOf(rows().find((el) => el.getAttribute('aria-expanded') === 'true')).includes('Aliens'), true, 'the chip opened its row');
  assert.ok(game("MAP_BLOCKERS.includes('factions') && document.body.classList.contains('factions')"), 'no map over the menu');
  browser.key('Escape');
  assert.ok(!game('FactionsMenu.isOpen'), 'Escape closes it');
  browser.key('r');
  assert.ok(game('FactionsMenu.isOpen'), 'R opens it');
  browser.key('r');
  assert.ok(!game('FactionsMenu.isOpen'), 'and closes it');
  game('cargo.rep = Reputation.empty()');
});

test('regard has consequences: docking refused, prices, pirates letting you pass, and kills costing regard', () => {
  if (game('!!docked')) game('launch()');
  game(`fight.grace = 0; combatMode.set('rounds'); cargo.hull = SHIP.hull; cargo.rep = Reputation.empty();
    globalThis.__owned = world.scene.stations.find((s) => s.station && s.station.owner && s.station.owner !== Factions.WAYSTATION);
    globalThis.__way = world.scene.stations.find((s) => s.station && s.station.owner === Factions.WAYSTATION);`);
  const owner = game('__owned.station.owner');
  // Hostile: the dock button says why, and docking does nothing.
  game(`cargo.rep['${owner}'] = -80; placeShip(__owned.x, __owned.y + __owned.radius + 150)`);
  assert.ok(!game(`actions.state('dock', __owned).ok`), 'refused');
  assert.match(game(`actions.state('dock', __owned).label`), /^Refused · .* hostile$/);
  game('dock(__owned)');
  assert.ok(!game('docked'), 'not docked');
  // The androids' waystations take everyone.
  game(`cargo.rep.android = -100; placeShip(__way.x, __way.y + __way.radius + 150)`);
  assert.ok(game(`actions.state('dock', __way).ok`), 'a waystation never refuses');
  // Devoted: better prices, and the Trade tab says so.
  const usual = game(`(cargo.rep = Reputation.empty(), marketAt(__owned).goods.map((g) => [g.buy, g.sell]))`);
  game(`cargo.rep['${owner}'] = 80`);
  const better = game(`marketAt(__owned).goods.map((g) => [g.buy, g.sell])`);
  assert.ok(better.every(([b, s], i) => s >= usual[i][1] && (b === null || b <= usual[i][0])), 'better both ways');
  assert.ok(better.some(([, s], i) => s > usual[i][1]), 'and some better by a credit or more');
  game(`placeShip(__owned.x, __owned.y + __owned.radius + 150); dock(__owned); StationMenu.showTab('trade')`);
  assert.match(onStation(), /Devoted: 4% better prices here/);
  game('launch()');
  // A pirate pack: it attacks on sight, unless the Drifters count you Friendly.
  game(`globalThis.__pirate = world.scene.entities.find((e) => e.kind === 'ship' && e.pack !== undefined && !cargo.removed.has(e.key)
      && world.galaxy.packs[e.pack].ships.length === 1 && e.tier === 1);
    cargo.rep.drifter = 30; fight.grace = 0; placeShip(__pirate.x + __pirate.radius + 300, __pirate.y);`);
  browser.frames(20);
  assert.ok(!game('inFight()'), 'friendly pirates leave you be');
  assert.ok(game(`world.travel && Reputation.passage(cargo.rep)`), 'and their ambushes let a trip pass');
  // (It circles on: beside it again, where it is now.)
  game('cargo.rep.drifter = 0; Scene.pose(__pirate, simTime); placeShip(__pirate.x + __pirate.radius + 300, __pirate.y)');
  assert.ok(until('inFight()', 60), 'neutral pirates attack');
  winFight('the pack');
  // Every pirate of a pack destroyed cost regard with the Drifters, and pleased their enemies.
  assert.ok(game('cargo.rep.drifter') < 0, `regard with the Drifters: ${game('cargo.rep.drifter')}`);
  assert.ok(game('Reputation.regard(cargo.rep, "alien") > Factions.get("alien").start'), 'the aliens, hostile to them, approve');
  game('cargo.rep = Reputation.empty(); fight.grace = 1e9');
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
  // What lies on a surface is kept (anything unknown dropped); nothing is kept of the deposits worked
  // out there, since each landing seeds a fresh field.
  game(`cargo.surfaceDrops = { 'Zantal I': [{ key: 'k', kind: 'tungsten', x: 10, y: 20 }, { key: 'bad', kind: 'nope', x: 1, y: 1 }] };
    saveCargoNow(); loadCargo(world.galaxy)`);
  assert.deepStrictEqual(JSON.parse(game('JSON.stringify(cargo.surfaceDrops)')), { 'Zantal I': [{ key: 'k', kind: 'tungsten', x: 10, y: 20 }] });
  assert.ok(!('mined' in JSON.parse(saved())), 'no list of worked-out deposits saved');
  // A save from before the removed list: its three lists are merged. And from before components
  // had their own store: those in the hold move to it.
  const old = JSON.parse(saved());
  const [a, b, ...rest] = old.removed;
  delete old.removed;
  delete old.version;
  Object.assign(old, { collected: [a], mined: [b], destroyed: rest });
  const comps = game(`cargo.components['weapon-components'] || 0`);
  old.items.push({ kind: 'weapon-standard', label: 'Standard weapon components', category: 'loot' });
  browser.storage.set(key, JSON.stringify(old));
  game('loadCargo(world.galaxy)');

  assert.strictEqual(game('cargo.removed.size'), removed, 'an older save loads');
  assert.strictEqual(game('cargo.mined'), undefined, 'its old list of mined asteroids is not taken for deposits');
  game('cargo.surfaceDrops = {}');
  assert.strictEqual(game(`cargo.components['weapon-components']`), comps + 1, 'components in an old hold move to their store (tiered ones as their kind)');
  assert.strictEqual(game('cargo.items.length'), items);
  game('cargo.credits += 1; saveCargo()');
  browser.emit('pagehide');
  assert.strictEqual(JSON.parse(saved()).credits, credits + 1, 'leaving the page writes the pending save');
});

test('landing on each kind of planet and a moon: down to the surface, flying round it, and back to space', () => {
  game(`fight.grace = 1e9; artStyle.set('line')`);
  // Every planet and moon has a surface (landing.js LANDABLE) and offers Land.
  assert.ok(game(`__find((e) => (e.kind === 'planet' || e.kind === 'moon') && !landable(e))`) === null, 'every planet and moon has a surface');
  const until = (cond) => { for (let i = 0; i < 1500 && !game(cond); i++) browser.frames(1); return game(cond); };
  // Zantal I to VI: lava, desert, terran, ice, gas and blue; Zantal III a: a grey moon (the moon types
  // share one surface, in their own colours).
  for (const name of ['Zantal I', 'Zantal II', 'Zantal III', 'Zantal IV', 'Zantal V', 'Zantal VI', 'Zantal III a']) {
    game(`globalThis.__body = __find((e) => e.name === '${name}'); placeBeside(__body); react(nearbyEntities(simTime)); select(__body); react(nearbyEntities(simTime));`);
    assert.ok(game(`describe(__body).actions.some((a) => a.id === 'land' && a.enabled)`), `${name}: Land on its menu`);
    clickCard('land');
    assert.strictEqual(game('landing.phase'), 'landing', `${name}: the landing begins`);
    assert.ok(game('modes.has("landing") && MAP_BLOCKERS.includes("landing")'), 'no map while landing');
    assert.ok(until('landing.phase === "surface"'), `${name}: down on the surface`);
    assert.ok(game('modes.has("landed")'), 'Take off shows');
    // Flying: a drag's heading and speed (here set directly) move the ship over the ground.
    const x0 = game('landing.craft.x');
    game('ship.targetAngle = 0; ship.targetSpeed = SHIP.maxSpeed');
    browser.frames(30);
    game('ship.targetSpeed = 0');
    assert.ok(game('landing.craft.x') > x0 + 20, `${name}: the ship flies on the surface`);
    // Off again from the dungeon's landing pad.
    game('takeOff()');
    assert.ok(until('!landing.on'), `${name}: back in space`);
    assert.ok(!game('modes.has("landing") || modes.has("landed")'), 'the modes are cleared');
    assert.ok(game('Math.hypot(ship.x - __body.x, ship.y - __body.y) < __body.body.r * 2.1 + 400'), `${name}: the ship is beside it`);
  }
});

// Down on a planet or moon by name (the Land action on its card), and back up.
function landOn(name) {
  game(`globalThis.__body = __find((e) => e.name === '${name}'); placeBeside(__body); react(nearbyEntities(simTime)); select(__body); react(nearbyEntities(simTime));`);
  clickCard('land');
  assert.ok(until('landing.phase === "surface"', 1500), `down on ${name}`);
}
function takeOffTo() {
  game('takeOff()');
  assert.ok(until('!landing.on', 1500), 'back in space');
}
// The ship over each thing lying on the body's surface in turn, a frame at each: it picks them up.
// What lies on this surface dragged onto the ship, one at a time (the craft set 150 units off
// each first, so the drag is a real one); flying over it picks nothing up.
function dragAllOntoCraft(name) {
  for (let i = 0; i < 40 && game(`!!cargo.surfaceDrops['${name}']`); i++) {
    const n = game(`cargo.surfaceDrops['${name}'].length`);
    game(`globalThis.__it = cargo.surfaceDrops['${name}'][0]; Object.assign(landing.craft, { x: __it.x - 150, y: __it.y, vx: 0, vy: 0 }); ship.targetSpeed = 0;`);
    browser.frames(1);
    const from = game('surfaceToScreen(__it.x, __it.y)'), to = game('surfaceToScreen(landing.craft.x, landing.craft.y)');
    const cv = browser.document.getElementById('game'), id = dragId++;
    cv.dispatch('pointerdown', { pointerId: id, pointerType: 'touch', button: 0, clientX: from[0], clientY: from[1], timeStamp: 1000 * id });
    cv.dispatch('pointermove', { pointerId: id, pointerType: 'touch', clientX: (from[0] + to[0]) / 2, clientY: from[1] });
    cv.dispatch('pointermove', { pointerId: id, pointerType: 'touch', clientX: to[0], clientY: to[1] });
    cv.dispatch('pointerup', { pointerId: id, pointerType: 'touch', button: 0, clientX: to[0], clientY: to[1], timeStamp: 1000 * id + 700 });
    if (game(`(cargo.surfaceDrops['${name}'] || []).length`) >= n) break; // (the hold full)
  }
}

test('the surface run: the scan before landing; a node selected and mined by its Mine action, its goods dragged in, a fresh field each landing', () => {
  game(`fight.grace = 1e9; cargo.items = []; cargo.hull = SHIP.hull; artStyle.set('line')`);
  // The scan: the lava planet's card names its dungeon's level, and its detail what's down there.
  game(`globalThis.__body = __find((e) => e.name === 'Zantal I'); placeBeside(__body); react(nearbyEntities(simTime)); select(__body); react(nearbyEntities(simTime));`);
  const card = game('describe(__body)');
  assert.match(card.tag, /^Dungeon L\d$/);
  assert.match(card.detail, /^Guarded labyrinth, a Warden at its heart · Deposits: \w/);
  game('nextField.value = 1');
  clickCard('land');
  assert.ok(until('landing.phase === "surface"', 1500), 'down');
  game('dungeonRun.guards = []'); // no guardians to fight here: this is about the nodes
  const n = game('surfaceRun.deposits.length');
  assert.ok(n >= 10, `nodes through the labyrinth: ${n}`);
  const field = game('surfaceRun.deposits.map((d) => [d.x, d.y]).join(" ")');
  browser.frames(1);
  assert.match(game('surfaceLines().map((l) => l[0]).join("|")'), /\d+ nodes · hold 0\/\d+ · yield ×1.5/);
  // Beside a node, doing nothing: nothing happens. A tap selects it; its card's Mine sets the tools on it.
  game(`globalThis.__dep = surfaceRun.deposits[0]; Object.assign(landing.craft, { x: __dep.x - __dep.radius - 40, y: __dep.y, vx: 0, vy: 0, angle: 0 }); ship.targetSpeed = 0`);
  browser.frames(60);
  assert.ok(!game('mine.target'), 'no mining by itself');
  const at = game('surfaceToScreen(__dep.x, __dep.y)'), cv = browser.document.getElementById('game');
  cv.dispatch('pointerdown', { pointerId: 90, pointerType: 'touch', button: 0, clientX: at[0], clientY: at[1], timeStamp: 90000 });
  cv.dispatch('pointerup', { pointerId: 90, pointerType: 'touch', button: 0, clientX: at[0], clientY: at[1], timeStamp: 90100 });
  browser.frames(1);
  assert.ok(game('surfaceSel.it === __dep && !mine.target'), 'a tap selects it, and doesn\'t mine it');
  assert.deepStrictEqual(game('ContextCard.isOpen && mineState(__dep).enabled'), true, 'its card offers Mine');
  clickCard('mine');
  assert.ok(game('mine.target === __dep'), 'Mine: mining it');
  assert.ok(until('!surfaceRun.deposits.includes(__dep)', 60 * 5), 'worked out quickly');
  assert.ok(!game('surfaceSel.it'), 'its selection goes with it');
  // Its goods lie beside it, drawn as their icons, until dragged onto the ship.
  browser.frames(60);
  assert.ok(game('(cargo.surfaceDrops["Zantal I"] || []).length') >= 1, 'its goods lie there, not pulled in');
  assert.ok(!game('cargo.items.some((it) => it.kind === __dep.good)'), 'nothing in the hold yet');
  dragAllOntoCraft('Zantal I');
  assert.ok(game('cargo.items.some((it) => it.kind === __dep.good)'), 'dragged onto the ship: in the hold');
  assert.strictEqual(game('cargo.surfaceDrops["Zantal I"]'), undefined, 'nothing left lying there');
  // The tools don't go on to the next node by themselves.
  game(`{ const C = landing.craft, d = surfaceRun.deposits.slice().sort((a, b) => Math.hypot(a.x - C.x, a.y - C.y) - Math.hypot(b.x - C.x, b.y - C.y))[0]; Object.assign(C, { x: d.x - 80, y: d.y, vx: 0, vy: 0, angle: 0 }); }`);
  browser.frames(90);
  assert.ok(!game('mine.target'), 'no chaining from node to node');
  // Too far: Mine waits for the ship to come closer.
  // (The tools reach far: shorter-ranged ones for this.)
  game(`globalThis.__lock = SHIP.lockRange; SHIP.lockRange = 600;
    { const o = surfaceRun.deposits[0], sx = o.x - o.radius - 40, sy = o.y, gap = (x) => Math.hypot(x.x - sx, x.y - sy) - x.radius, d = surfaceRun.deposits.slice().sort((a, b) => gap(b) - gap(a))[0];
      selectOnSurface(d); Object.assign(landing.craft, { x: sx, y: sy, vx: 0, vy: 0 }); }`);
  browser.frames(1);
  assert.ok(game('landing.phase === "surface" && !!surfaceSel.it'), 'still down, a far node selected');
  assert.match(game('mineState(surfaceSel.it).label'), /too far/);
  clickCard('mine');
  assert.ok(!game('mine.target'), 'Mine does nothing from there');
  game('SHIP.lockRange = __lock');
  // A full hold: no mining.
  game(`cargo.items = Array.from({ length: SHIP.cargo }, () => ({ kind: 'iron', label: 'Iron', category: 'trade' })); endExtraction();
    { const C = landing.craft, d = surfaceSel.it; Object.assign(C, { x: d.x - 80, y: d.y, vx: 0, vy: 0, angle: 0 }); }`);
  browser.frames(1);
  assert.match(game('mineState(surfaceSel.it).label'), /hold full/);
  clickCard('mine');
  assert.ok(!game('mine.target'), 'no mining with the hold full');
  assert.match(game('surfaceLines().map((l) => l[0]).join("|")'), /HOLD FULL/);
  game('selectOnSurface(null)');
  game('cargo.items = []; cargo.surfaceDrops = {}');
  // Back again later: a fresh field.
  takeOffTo();
  landOn('Zantal I');
  game('dungeonRun.guards = []');
  assert.notStrictEqual(game('surfaceRun.deposits.map((d) => [d.x, d.y]).join(" ")'), field, 'another field');
  takeOffTo();
  game('cargo.items = []; cargo.surfaceDrops = {}');
});

test('a dungeon: Zantal VI is a labyrinth cut into its own ground; the ship charts it chamber by chamber', () => {
  game(`fight.grace = 1e9; cargo.items = []; cargo.hull = SHIP.hull; artStyle.set('line')`);
  game(`globalThis.__body = __find((e) => e.name === 'Zantal VI'); placeBeside(__body); react(nearbyEntities(simTime)); select(__body); react(nearbyEntities(simTime));`);
  assert.ok(game('isDungeon(__body)') && game(`isDungeon(__find((e) => e.name === 'Zantal III a'))`), 'every planet and moon');
  assert.strictEqual(game('siteScan(__body).tone'), 'warn', 'the scan says it is guarded');
  landOn('Zantal VI');
  game('dungeonRun.guards = []'); // this is about the labyrinth: the guardians have their own tests
  const W = 'surfaceRun.W';
  assert.strictEqual(game(`${W}.type`), game('ArtSurface.SURFACE_OF[__body.body.type]'), 'cut into the planet\'s own ground');
  assert.ok(game(`${W}.dungeon.rooms.length`) >= 9, 'chambers');
  assert.strictEqual(game(`${W}.dungeon.rooms.filter((r) => r.role === 'deep').length`), 1, 'one deepest chamber');
  assert.ok(game(`${W}.dungeon.rooms.find((r) => r.role === 'deep').hops`) >= 2, 'some passages away');
  assert.ok(game('surfaceRun.deposits.length') >= 10, 'nodes about the caverns');
  // Every chamber can be reached from the landing spot (a flood over open ground).
  assert.ok(game(`(() => {
    const W = surfaceRun.W, T = ArtSurface.T, step = T / 2, key = (x, y) => x + ',' + y, seen = new Set(), q = [[W.start[0], W.start[1]]];
    seen.add(key(...q[0]));
    while (q.length) { const [x, y] = q.pop(); for (const [dx, dy] of [[step, 0], [-step, 0], [0, step], [0, -step]]) { const nx = x + dx, ny = y + dy, k = key(nx, ny); if (seen.has(k) || ArtSurface.blocked(W, nx, ny, 12)) continue; seen.add(k); q.push([nx, ny]); } }
    return W.dungeon.rooms.every((r) => [...seen].some((k) => { const [x, y] = k.split(',').map(Number); return Math.hypot(x - r.x, y - r.y) < r.r; }));
  })()`), 'every chamber reachable');
  // No hazards: a stay costs nothing.
  const hull = game('cargo.hull');
  browser.frames(300);
  assert.ok(game('cargo.hull') === hull && game('landing.phase') === 'surface', 'unharmed, still down');
  assert.match(game('surfaceLines().map((l) => l[0]).join("|")'), /CHAMBERS 1\/\d+ · the deepest still ahead/);
  // Flying into the deepest chamber: it's charted, and counted.
  game(`{ const r = surfaceRun.W.dungeon.rooms.find((r) => r.role === 'deep'); Object.assign(landing.craft, { x: r.x, y: r.y, vx: 0, vy: 0 }); ship.targetSpeed = 0; }`);
  browser.frames(2);
  assert.ok(game('charted(landing.craft.x, landing.craft.y)'), 'charted round the ship');
  assert.match(game('surfaceLines().map((l) => l[0]).join("|")'), /CHAMBERS 2\/\d+ · the deepest found/);
  takeOffTo();
  game('cargo.items = []; cargo.surfaceDrops = {}');
});

test('planets, moons and stations go round with flight; a ship parked by a station is carried along, still in docking range', () => {
  if (game('!!docked')) game('launch()');
  game(`globalThis.__st = world.scene.stations.find((s) => s.station.planet !== undefined); placeBeside(__st);
    globalThis.__p = world.scene.byKey.get(world.galaxy.planets[__st.station.planet].name);
    globalThis.__was = { t: world.orbitT, x: __st.x, y: __st.y, px: __p.x, py: __p.y, gap: gapTo(__st) }`);
  browser.frames(600); // ten seconds
  assert.ok(game('world.orbitT - __was.t') > 9, 'the orbit clock ran with flight');
  assert.ok(game('Math.hypot(__st.x - __was.x, __st.y - __was.y)') > 50, 'the station went round');
  assert.ok(game('Math.hypot(__p.x - __was.px, __p.y - __was.py)') > 20, 'and its planet round the star');
  assert.ok(game('Math.abs(Math.hypot(__st.x - __p.x, __st.y - __p.y) - __st.station.orbit) < 1e-6'), 'at its orbit round the planet');
  assert.ok(game('gapTo(__st)') < game('DOCK.range'), `the ship kept up with it (${game('gapTo(__st)')} from it)`);
  // Docked, everything waits: it launches beside the station where it was left.
  game('dock(__st); globalThis.__t = world.orbitT');
  browser.frames(120);
  assert.strictEqual(game('world.orbitT'), game('__t'), 'docking stops the orbit clock');
  game('launch()');
  assert.ok(game('gapTo(__st)') < game('DOCK.range'), 'launched beside it');
});

test('one bad frame is passed over; frames that keep failing stop the game behind a notice', () => {
  const say = console.error;
  console.error = () => {};
  try {
    game(`perfStats.onFrame = () => { perfStats.onFrame = null; throw new Error('once'); }`);
    browser.frames(3);
    assert.ok(!game('crash.stopped'), 'the loop goes on after one');
    assert.strictEqual(game('crash.n'), 0, 'and a good frame clears the count');
    game(`perfStats.onFrame = () => { throw new Error('every frame'); }`);
    browser.frames(game('CRASH_LIMIT') + 2);
    assert.ok(game('crash.stopped'), 'stopped');
    assert.strictEqual(document.getElementById('crash').hidden, false, 'behind the notice');
    assert.strictEqual(game('crash.error.message'), 'every frame');
    const t = game('simTime');
    browser.frames(5);
    assert.strictEqual(game('simTime'), t, 'no more frames run');
  } finally {
    console.error = say;
    document.getElementById('crash').hidden = true;
    game('perfStats.onFrame = null; crash.stopped = false; crash.n = 0; requestAnimationFrame(frame)');
  }
  browser.frames(2);
  assert.ok(!game('crash.stopped'), 'and the game runs again for the tests after');
});

test('a damaged save is set aside before a new game is written over it', () => {
  game('saveAll()');
  const key = game('cargo.key'), good = Store.get(key), torn = good.slice(0, Math.floor(good.length / 2));
  Store.set(key, torn);
  game('loadCargo(world.galaxy)');
  assert.strictEqual(Store.get(`${key}:bad`), torn, 'kept as it was');
  assert.match(Messages.log.map((l) => l.text).join('|'), /saved game was damaged/, 'and said');
  game('cargoSave.flush()');
  Store.set(key, good);
  Store.remove(`${key}:bad`);
  game('loadCargo(world.galaxy)');
  assert.strictEqual(Store.get(`${key}:bad`), null, 'a sound save sets nothing aside');
});

test('nothing was drawn at a non-finite position', () => {
  assert.deepStrictEqual(browser.badDraws, []);
});

console.log(failed ? `\n${failed} smoke test(s) failed` : '\nall smoke tests passed');
process.exit(failed ? 1 : 0);
