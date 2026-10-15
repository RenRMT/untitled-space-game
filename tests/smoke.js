'use strict';

// Smoke test for the whole game in Node: `node tests/smoke.js`. Loads every script in the order
// index.html lists them into a stand-in browser (tests/browser-stub.js), then plays: flying in
// every art style and both movement modes, docking and trading, mining, finding a derelict,
// flying into a nebula and to the system's edge, map travel, a fight in each combat mode, the
// settings and a start-style switch. It opens on the introduction and the first mission, which
// the first two tests play through. Each step checks its effect; at the end nothing may have
// been drawn at a non-finite position. The steps share one game, in order, as a player would
// play them.

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

// Helpers in the game's scope: find an entity in the scene (nearest the ship first), and run
// frames until a condition holds (returns whether it did).
game(`
  globalThis.__find = (pred) => {
    const e = world.scene.entities.filter(pred).sort((a, b) => Math.hypot(a.x - ship.x, a.y - ship.y) - Math.hypot(b.x - ship.x, b.y - ship.y))[0] || null;
    if (e) Scene.pose(e, simTime);
    return e;
  };
  globalThis.__startStation = startStation;
`);
// A click on one of the context card's buttons, as the card's click handler sees it.
function clickCard(id) {
  const button = { disabled: false, dataset: { id } };
  browser.document.getElementById('context').querySelector('.cx-actions').dispatch('click', { target: { closest: () => button } });
}
// All the text under an element of the DOM stub.
const textOf = (el) => (el === null || el === undefined ? '' : typeof el !== 'object' ? String(el) : (el.textContent || '') + (el.children || []).map(textOf).join(''));
// Every element under one (itself included), depth first.
const allOf = (el) => (el && typeof el === 'object' ? [el, ...(el.children || []).flatMap(allOf)] : []);
function until(cond, maxFrames, each = '') {
  for (let i = 0; i < maxFrames; i++) {
    if (game(cond)) return true;
    if (each) game(each);
    browser.frames(1);
  }
  return game(cond);
}

test('a new game opens on the introduction: the pod is talked in, flown to the waystation and docked', () => {
  browser.frames(3);
  const comms = browser.document.getElementById('comms');
  const text = () => textOf(comms);
  const faces = () => allOf(comms).filter((el) => el.tagName === 'CANVAS' && !el.hidden);
  assert.ok(game('intro.on && SHIP.name === "Escape pod"'), 'in the escape pod');
  const way = game('intro.station');
  assert.strictEqual(way.name, 'Waystation HD-1863');
  assert.strictEqual(way.art.culture.lineage, 'android');
  // The opening shot: the pod drifts in toward the station, slowing, with nothing said and no HUD.
  assert.ok(game('!!intro.arrive && !Comms.isOpen'), 'drifting in, nothing said yet');
  assert.ok(game('!hudShown() && navHits.length === 0'), 'no HUD');
  const g0 = game('gapTo(intro.station)');
  browser.frames(60);
  const g1 = game('gapTo(intro.station)');
  assert.ok(g1 < g0 - 100, `it comes closer (${g0.toFixed(0)} → ${g1.toFixed(0)})`);
  game('ship.targetSpeed = SHIP.maxSpeed'); // no flying yet
  assert.ok(until('!intro.arrive', 60 * 6), 'it settles');
  assert.ok(game('Math.hypot(ship.vx, ship.vy) < 1 && Comms.isOpen'), 'at rest; the station speaks');
  const gap = game('gapTo(intro.station)');
  assert.ok(gap > 400 && gap < 1200, `adrift ${gap.toFixed(0)} from the station`);
  assert.ok(game('!frameList.some((e) => e.kind === "wingman")'), 'no squad yet');
  game('SystemMap.open(); settingsBtn.dispatch("click", {})');
  assert.ok(game('!SystemMap.isOpen && !Settings.isOpen'), 'no map or settings');
  // Lines go on with a tap; the first two have no portrait.
  assert.match(text(), /This is Waystation HD-1863 to approaching escape pod/);
  assert.strictEqual(faces().length, 0);
  comms.dispatch('click', { target: { closest: () => null } });
  assert.match(text(), /It has been 793 solar cycles/);
  assert.ok(allOf(comms).some((el) => el.tagName === 'STRONG' && textOf(el) === '793'), '793 in bold');
  game('ship.targetSpeed = SHIP.maxSpeed');
  browser.frames(30);
  assert.ok(game('Math.hypot(ship.vx, ship.vy) < 1'), 'the pod waits while the station talks');
  game('Comms.next()');
  // Diagnostic one: four answers, each with the portrait in its style; it sets the art style.
  assert.match(text(), /Diagnostic one: please confirm visual functions/);
  assert.match(text(), /Looks bright.*Looks blocky.*Looks flat.*Looks sharp/);
  assert.strictEqual(faces().length, 4, 'a portrait per answer');
  game('Comms.next()');
  assert.match(text(), /Diagnostic one/, 'a question waits for its answer');
  game('Comms.choose(1)');
  assert.strictEqual(game('artStyle.value'), 'pixel');
  assert.match(text(), /Must be a pre-existing condition/);
  assert.strictEqual(faces().length, 1, 'the station\'s portrait from now on');
  game('Comms.next()');
  // Diagnostic two: movement.
  assert.match(text(), /Diagnostic two/);
  game('Comms.choose(0)');
  assert.strictEqual(game('moveMode.value'), 'cruise');
  assert.match(text(), /Inertial navigation\. A classic/);
  for (let i = 0; i < 20 && game('!intro.flying'); i++) game('Comms.next()');
  // Flying: a hint that doesn't wait; the pod is the player's to fly, into the beam's reach.
  assert.ok(game('intro.flying && !Comms.isOpen'), 'flying');
  assert.match(text(), /Drag anywhere to set a heading/);
  const steer = 'ship.targetAngle = Math.atan2(intro.station.y - ship.y, intro.station.x - ship.x); ship.targetSpeed = SHIP.maxSpeed;';
  assert.ok(until('!!intro.beam', 60 * 30, steer), 'reached the tractor beam');
  assert.ok(game('SHIP.maxSpeed') < 200, 'at the pod\'s gentle speed');
  // The beam has it; the security scan finds no weapons (combat comes with the first mission).
  assert.match(text(), /Security scan in progress/);
  game('Comms.next()');
  assert.match(text(), /No weapon systems detected/);
  assert.ok(!/Manual targeting/.test(text()), 'no targeting question yet');
  game('Comms.next()');
  assert.match(text(), /Registration complete\. Welcome to Waystation HD-1863/);
  game('Comms.next()');
  assert.ok(until('!!docked', 60 * 30), 'docked');
  assert.strictEqual(game('docked.station'), way, 'at the waystation');
  assert.ok(game('hudShown()'), 'the HUD is back for the first launch');
  assert.ok(game('!intro.on && cargo.story.has("intro")'));
  assert.strictEqual(game('SHIP.name'), 'Courier', 'the usual ship again');
  assert.strictEqual(game('cargo.hull'), game('SHIP.hull'));
  assert.match(textOf(browser.document.getElementById('st-sub')), /Waystation/);
});

test('the first mission: accepted at the waystation, the pirates beaten, the android escorted home, and it joins the squad', () => {
  const body = browser.document.getElementById('st-body'), comms = browser.document.getElementById('comms');
  const tab = () => textOf(body);
  const press = (label) => {
    const b = allOf(body).find((el) => el.tagName === 'BUTTON' && textOf(el) === label);
    assert.ok(b, `a ${label} button`);
    b.dispatch('click', {});
  };
  // Docked after the introduction: only the Missions tab, and no launching before accepting.
  assert.strictEqual(game('StationMenu.tab'), 'missions', 'opens on the Missions tab');
  assert.deepStrictEqual(game('stationLocks().tabs'), ['trade', 'ship', 'research', 'squad']);
  game(`StationMenu.showTab('trade')`);
  assert.strictEqual(game('StationMenu.tab'), 'missions', 'the other tabs are locked');
  assert.match(tab(), /Payment in kind/);
  assert.match(tab(), /Station services are suspended/);
  assert.match(tab(), /coolant regulator/);
  assert.match(tab(), new RegExp(`${game('mission.vars.ship')} has not returned`));
  assert.ok(allOf(body).some((el) => el.tagName === 'CANVAS'), 'the waystation\'s portrait');
  assert.strictEqual(game('cargo.squad.length'), 0, 'no squad yet');
  const launchBtn = browser.document.getElementById('st-launch');
  assert.ok(launchBtn.disabled, 'Launch waits for the mission');
  launchBtn.dispatch('click', {});
  assert.ok(game('!!docked'), 'still docked');
  // Accepting provides the ship: a Courier with both hardpoints armed.
  press('Accept');
  assert.strictEqual(game('cargo.missions.status(OPENING)'), 'active');
  assert.ok(game('SHIP.name === "Courier" && SHIP.weaponsFitted === 2'), 'two salvaged lasers');
  assert.ok(!launchBtn.disabled, 'Launch is open');
  assert.match(tab(), /Fly to the asteroid field/);
  assert.strictEqual(game('StationMenu.tab'), 'missions', 'still only Missions');
  game('combatMode.set("realtime")');
  launchBtn.dispatch('click', {});
  assert.ok(game('!docked'), 'launched');
  // The waystation says where to go and calibrates the combat systems: the combat mode is picked
  // here. The HUD, an edge marker and the map show the way.
  assert.match(textOf(comms), /asteroid field have been sent to your navigation system/);
  game('Comms.next()');
  assert.match(textOf(comms), /combat systems have not been calibrated/);
  game('Comms.next()');
  assert.match(textOf(comms), /Please select a targeting protocol.*Manual targeting.*Tactical computer/);
  game('Comms.next()');
  assert.match(textOf(comms), /select a targeting protocol/, 'the question waits for an answer');
  game('Comms.choose(1)');
  assert.strictEqual(game('combatMode.value'), 'rounds');
  assert.match(textOf(comms), /Turn-based engagement calibrated/);
  game('Comms.next()');
  assert.match(textOf(comms), /Calibration complete/);
  for (let i = 0; i < 5 && game('!!talk.lines'); i++) game('Comms.next()');
  assert.ok(game('!talk.lines && !Comms.isOpen'));
  browser.frames(2);
  assert.match(game('objective().text'), /^Fly to the asteroid field/);
  assert.deepStrictEqual(game('[SystemMap.objective.x, SystemMap.objective.y]'), game('[mission.site.x, mission.site.y]'));
  assert.ok(game('navHits.some((m) => m.ref === null)'), 'the objective has an edge marker');
  const fromWay = game('Math.hypot(mission.site.x - waystation().x, mission.site.y - waystation().y)');
  assert.ok(fromWay > 4000 && fromWay < 9500, `the field is near the waystation (${fromWay.toFixed(0)})`);
  // Map travel to the objective stops short of the pirates; the field counts as found.
  game('combatMode.set("rounds"); arriveAt({ kind: "objective", x: mission.site.x, y: mission.site.y })');
  browser.frames(2);
  assert.ok(game('cargo.missions.done(OPENING, "field") && !inFight()'), 'found, and not yet fighting');
  assert.ok(game('frameList.filter((e) => isHostile(e) && e.key.startsWith("m.")).length') === 2, 'two pirates');
  assert.ok(game('frameList.some((e) => e === mission.android) && frameList.some((e) => e === mission.cargo)'), 'the android and the regulator');
  game('select(mission.android)');
  browser.frames(1);
  assert.match(game('describe(selected.e).subtitle'), /^Android · held by pirates/);
  game('select(null)');
  assert.match(game('objective().text'), /Defeat the pirates · 0\/2/);
  // Fly in: the pirates attack, both together; and both go down.
  const toSite = 'ship.targetAngle = Math.atan2(mission.site.y - ship.y, mission.site.x - ship.x); ship.targetSpeed = SHIP.maxSpeed * 0.5;';
  assert.ok(until('!!fight.s', 60 * 20, toSite), 'the pirates attack');
  assert.strictEqual(game('fight.s.enemies.length'), 2, 'the pair fights together');
  assert.ok(until('!inFight()', 120 * 60), 'the fight ends');
  assert.strictEqual(game('fight.result'), 'won');
  assert.strictEqual(game('cargo.missions.count(OPENING, "pirates")'), 2);
  // Once the fight is over, the android calls.
  assert.ok(until('!!talk.lines', 60 * 10), 'the android calls');
  assert.match(textOf(comms), new RegExp(`${game('mission.vars.ship')}.*Your hull registry matches`));
  game('Comms.next(); Comms.next()');
  assert.match(textOf(comms), /coolant regulator from my hold\. It is drifting nearby/);
  for (let i = 0; i < 6 && game('!!talk.lines'); i++) game('Comms.next()');
  assert.ok(game('escorting()'), 'it follows the ship now');
  // The regulator, then home: the android keeps up in formation.
  game('placeShip(mission.cargo.x + 10, mission.cargo.y)');
  browser.frames(2);
  assert.ok(game('cargo.missions.done(OPENING, "regulator") && cargo.items.length === 0'), 'recovered, outside the hold');
  assert.match(game('objective().text'), /^Escort .+ back to Waystation HD-1863/);
  game('ship.targetAngle = Math.atan2(waystation().y - ship.y, waystation().x - ship.x); ship.targetSpeed = SHIP.maxSpeed');
  browser.frames(240);
  game('ship.targetSpeed = 0');
  browser.frames(200);
  const gap = game('{ const st = Squad.formation(ship, 0); Math.hypot(mission.android.x - st.x, mission.android.y - st.y) }');
  assert.ok(gap < 120, `in formation behind the ship (${gap.toFixed(0)} off)`);
  game('placeShip(waystation().x, waystation().y + waystation().radius + 150); dock(waystation())');
  assert.ok(game('!!docked'), 'docked at the waystation');
  assert.strictEqual(game('cargo.missions.status(OPENING)'), 'ready');
  assert.match(tab(), /Please confirm the delivery/);
  // Handed in: the debt settled, the android in the squad, every tab open.
  press('Complete mission');
  assert.strictEqual(game('cargo.missions.status(OPENING)'), 'done');
  assert.match(tab(), /surplus to requirements/);
  assert.match(tab(), /has joined your squad/);
  assert.deepStrictEqual(game('stationLocks().tabs'), []);
  assert.strictEqual(game('cargo.squad.length'), 1);
  assert.strictEqual(game('cargo.squad[0].name'), game('mission.vars.ship'), 'the same android');
  assert.deepStrictEqual(game('Squad.modulesOf(cargo.squad[0])'), [], 'with no logic modules yet');
  game(`StationMenu.showTab('squad')`);
  assert.strictEqual(game('StationMenu.tab'), 'squad');
  assert.match(tab(), new RegExp(game('mission.vars.ship')));
  game('launch()');
  browser.frames(3);
  assert.ok(game('frameList.some((e) => e.kind === "wingman") && !frameList.includes(mission.android)'), 'it flies as a wingman now');
  assert.strictEqual(game('objective()'), null, 'nothing more to do');
  // A save from before missions that played the introduction has it done already.
  game('saveCargoNow()');
  const key = game('cargo.key'), saved = JSON.parse(browser.storage.get(key));
  assert.deepStrictEqual(saved.missions.repayment.status, 'done');
  delete saved.missions;
  browser.storage.set(key, JSON.stringify(saved));
  game('loadCargo(world.galaxy)');
  assert.strictEqual(game('cargo.missions.status(OPENING)'), 'done', 'an older save');
  // On to the usual start, with the usual settings.
  game('artStyle.set("line"); combatMode.set("rounds"); placeBeside(startStation())');
});

test('boots at the start station', () => {
  browser.frames(3);
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
  assert.strictEqual(game('artStyle.value'), 'pixel');
  assert.match(game('toast.text'), /Art style: Pixel/);
  game(`artStyle.set('flat')`);
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
  const before = game('ArtBodies.stats().builds');
  game(`{ const n = world.galaxy.nebulae[0]; placeShip(n.x + n.blobs[0].dx, n.y + n.blobs[0].dy); }`);
  for (const style of game('ART_STYLES')) { game(`artStyle.set('${style}')`); browser.frames(4); }
  assert.ok(game('ArtBodies.stats().builds') > before + 20, 'nebula chunks were built');
  game(`artStyle.set('flat'); { const st = __startStation(); placeShip(st.x, st.y + st.radius + 300); }`);
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
  game(`fight.grace = 1e9; globalThis.__cap = __find((e) => e.kind === 'station' && e.market.type === 'capital');
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
  // Take out the second salvaged laser (from the first mission) and sell it, freeing a hardpoint.
  assert.ok(game(`outfitting.unfit('weapon-2') && cargo.gear['pulse-laser-1'] === 1 && outfitting.sell('pulse-laser-1')`));
  assert.ok(game(`!cargo.gear['pulse-laser-1'] && SHIP.weaponsFitted === 1`));
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
  const found = game(`(globalThis.__rock = __find((e) => e.kind === 'asteroid' && !cargo.removed.has(e.key) && Mining.yieldOf(world.galaxy.seed, e))) && __rock.key`);
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
  // Fly in, toward the nebula's core.
  game('placeShip(__neb.x + __neb.blobs[0].dx, __neb.y + __neb.blobs[0].dy)');
  game('lastRegion = { level: 3, nebula: null, system: world.galaxy.systems[0] }');
  browser.frames(2);
  assert.match(game('toast.text'), /Entering the .* Nebula/);
  assert.ok(game('frameList.some((e) => e.kind === "nebula")'), 'the nebula is drawn');
  game('{ const st = __startStation(); placeShip(st.x, st.y + st.radius + 300); }');
  browser.frames(2);
});

test('no edge: the ship flies on out of the system into deep space', () => {
  // Just inside the first system's edge, flying outward away from the second system.
  game(`fight.grace = 1e9; {
    const [A, B] = world.galaxy.systems, R = A.radius, a = Math.atan2(B.origin.y, B.origin.x) + Math.PI;
    placeShip(Math.cos(a) * (R - 300), Math.sin(a) * (R - 300), a);
    ship.vx = Math.cos(a) * SHIP.maxSpeed; ship.vy = Math.sin(a) * SHIP.maxSpeed; ship.targetAngle = a; ship.targetSpeed = SHIP.maxSpeed;
  }`);
  browser.frames(90);
  assert.ok(game('Math.hypot(ship.x, ship.y) > world.galaxy.systems[0].radius + 300'), 'past where the edge was');
  assert.strictEqual(game('world.galaxy.systemAt(ship.x, ship.y)'), null);
  assert.match(game('toast.text'), /Leaving the .* system · deep space/);
  game('ship.targetSpeed = 0; ship.vx = ship.vy = 0; { const st = __startStation(); placeShip(st.x, st.y + st.radius + 300); }');
  browser.frames(2);
});

test('a jump gate is offline until the gates come online, then takes the ship to the other system', () => {
  game('globalThis.__gate = world.scene.gates.find((g) => g.gate.system === 0)');
  assert.ok(game('__gate'), 'the first system has a gate');
  assert.ok(!game('world.knowledge.visited(1)'), 'the second system is not charted yet');
  game('fight.grace = 1e9; select(null); placeShip(__gate.x, __gate.y + __gate.radius + 120)');
  browser.frames(2);
  assert.ok(game('frameList.some((e) => e.kind === "gate" && visible(e))'), 'the gate is drawn');
  // Offline: no jump, no name for where it leads, and the galaxy map shows only this system.
  assert.deepStrictEqual(game(`[actions.state('jump', __gate).ok, actions.state('jump', __gate).label]`), [false, 'Gate offline']);
  assert.strictEqual(game('__gate.name'), 'Jump gate');
  assert.match(game('describe(__gate).subtitle'), /^Offline/);
  game('SystemMap.open(); SystemMap.setMode("galaxy")');
  browser.frames(2);
  assert.match(textOf(browser.document.getElementById('map-stats')), /1 system charted · 0 gate links/);
  game('SystemMap.setMode("local"); SystemMap.close()');
  game('cargo.story.add("gates"); showGates()');
  assert.match(game('__gate.name'), /Gate$/);
  assert.notStrictEqual(game('__gate.name'), 'Jump gate');
  assert.ok(game(`actions.state('jump', __gate).ok`), 'in range to jump');
  game('select(__gate)');
  browser.key('j');
  browser.frames(2);
  assert.strictEqual(game('world.galaxy.systemAt(ship.x, ship.y)?.index'), 1, 'in the second system');
  assert.match(game('toast.text'), /^Jumped to the .* system/);
  assert.ok(game('world.knowledge.visited(1)'), 'the second system is charted');
  assert.ok(game('Math.hypot(ship.x - world.scene.gates[__gate.gate.link].x, ship.y - world.scene.gates[__gate.gate.link].y) < 800'), 'beside the gate at the other end');
  // The map follows: its local view shows the second system; the galaxy view shows both.
  game('SystemMap.open()');
  browser.frames(2);
  assert.strictEqual(game('SystemMap.system.index'), 1);
  browser.document.getElementById('map-view-galaxy').dispatch('click', {});
  browser.frames(2);
  assert.strictEqual(game('SystemMap.mode'), 'galaxy');
  assert.match(browser.document.getElementById('map-stats').textContent, /2 systems charted · 1 gate link/);
  assert.ok(browser.document.getElementById('map-travel').disabled, 'no map travel from the galaxy view');
  browser.document.getElementById('map-view-local').dispatch('click', {});
  game('SystemMap.close()');
  // And back through the same pair of gates.
  game('globalThis.__back = world.scene.gates[__gate.gate.link]; select(__back);');
  browser.key('j');
  browser.frames(2);
  assert.strictEqual(game('world.galaxy.systemAt(ship.x, ship.y)?.index'), 0, 'back in the first system');
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
  // To the station furthest from the one we're at: the trip ends there, or at a contact on the way.
  game(`{
    const s = world.galaxy.systems[0].stations.slice().sort((a, b) => Math.hypot(b.x - ship.x, b.y - ship.y) - Math.hypot(a.x - ship.x, a.y - ship.y))[0];
    globalThis.__dest = s;
    SystemMap.hooks.travel({ kind: 'station', id: s.id, x: s.x, y: s.y, name: s.name });
    SystemMap.hooks.fast();
  }`);
  assert.ok(game('world.travel.active'));
  assert.ok(until('!world.travel.active', 3000, 'if (world.travel.prompt) SystemMap.hooks.ignore();'), 'the trip ends');
  assert.ok(!game('SystemMap.isOpen'), 'the map closes on arrival');
  assert.match(game('toast.text'), /^(Arrived at|Interdicted)/);
  if (/^Arrived/.test(game('toast.text'))) assert.ok(game('Math.hypot(ship.x - __dest.x, ship.y - __dest.y) < 800'), 'beside the station');
  browser.frames(5);
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
function meetPirate() {
  game(`globalThis.__pirate = __find((e) => e.kind === 'ship' && isHostile(e) && !cargo.removed.has(e.key));`);
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

test('the wingman flies in formation, assists the leader in both combat modes, and is repaired at a dock', () => {
  assert.strictEqual(game('cargo.squad.length'), 1, 'a new game has one wingman');
  const id = game('cargo.squad[0].id');
  assert.match(game('cargo.squad[0].name'), /^[A-Z][a-z]+-\d\d$/);
  assert.strictEqual(game(`wings.get('${id}').art.culture.lineage`), 'android', 'built in the android culture');
  // It joined with empty logic slots; give it the Assist leader module (a later mission's job).
  assert.ok(game(`Squad.install(cargo.squad[0], 'assist-leader', 0)`));
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
  assert.match(game('describe(selected.e).subtitle'), /^Squad · android fighter · 1 logic module/);
  game('select(null)');
  // In a fight it joins as an ally, and its combat logic module has it fire on the leader's target.
  for (const mode of ['rounds', 'realtime']) {
    game(`combatMode.set('${mode}'); repairSquad(); snapWings();`);
    meetPirate();
    assert.strictEqual(game('fight.s.allies.length'), 1, `${mode}: the wingman fights`);
    const chase = mode === 'realtime' ? `{ const t = fight.s && fight.ships.get(fight.s.focus); if (t) { ship.targetAngle = Math.atan2(t.y - ship.y, t.x - ship.x); ship.targetSpeed = SHIP.maxSpeed * 0.4; } }` : '';
    assert.ok(until(`!fight.s || fight.fx.some((f) => f.type === 'beam' && f.from === '${id}')`, 60 * 40, chase), `${mode}: it opens fire`);
    if (game('!!fight.s')) assert.strictEqual(game(`fight.s.allies[0].order.target`), game('fight.s.focus'), `${mode}: on the leader's target`);
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
  assert.match(tab, /Combat logic module · Assist leader/);
  assert.match(tab, /If the leader is fighting a target, then attack it/);
  assert.match(tab, /1 of 4 logic slots in use/);
  game('launch()');
  browser.frames(3);
  assert.ok(game(`frameList.some((e) => e.kind === 'wingman')`), 'back in formation');
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
