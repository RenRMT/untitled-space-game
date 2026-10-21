// Smoke test for the whole game in Node: `node tests/smoke.js`. Starts the game (src/main.js and
// everything it imports) in a stand-in browser (tests/browser-stub.js), then plays: flying in
// every art style and both movement modes, docking and trading, mining, finding a derelict,
// flying into a nebula and to the system's edge, map travel, a fight in each combat mode and the
// settings. It opens on the introduction (switched off in the game for now, so the test asks for it
// with ?intro) and the waystation's three missions, which the first four tests play through. Each step checks its effect; at the end nothing may have been drawn at a
// non-finite position. The steps share one game, in order, as a player would play them.

import assert from 'node:assert';
import { install } from './browser-stub.js';

// The stand-in browser first: the game's modules use the DOM as they load.
const browser = install({ width: 1280, height: 800, dpr: 2, search: '?seed=1&intro&missions' }); // ?intro, ?missions: play them though they're off
const { G } = await import('../src/main.js');
const { ItemIcons } = await import('../src/art/icons.js');
const { SYSTEM_CONFIG } = await import('../src/world/system-config.js');
const { UI } = await import('../src/ui/ui.js');
const { Messages } = await import('../src/ui/messages.js');
const { Store } = await import('../src/core/store.js');
const { Theme } = await import('../src/core/theme.js');
const { Kit } = await import('../src/ui/kit.js');
const { JobTexts } = await import('../src/story/job-texts.js');

// game(src): run a snippet as if inside the game, its names (G, src/main.js) in scope. A sloppy-mode
// function, for `with`.
const scope = Object.assign(Object.create(G), { ItemIcons, SYSTEM_CONFIG });
const { ArtBodies, Galaxy } = G; // the tests use them too
const inGame = new Function('__scope', '__src', 'with (__scope) return eval(__src);');
const game = (src) => inGame(scope, src);

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
// A press of a station button that is named only to screen readers (a tile), by its aria-label.
function pressLabelled(pattern) {
  const b = stationParts().flatMap(allOf).find((el) => el.tagName === 'BUTTON' && pattern.test(el.getAttribute?.('aria-label') || ''));
  assert.ok(b, `a button labelled ${pattern}`);
  b.dispatch('click', {});
}
// A mission's card on the Missions tab, tapped: its sheet opens, with the whole message.
function openMission(title) {
  pressOnStation(new RegExp(`^${title}`));
  assert.ok(!stationParts().flatMap(allOf).some((el) => el.tagName === 'BUTTON' && /^Read all/.test(textOf(el))), 'the whole briefing, no Read all');
}
function until(cond, maxFrames, each = '') {
  for (let i = 0; i < maxFrames; i++) {
    if (game(cond)) return true;
    if (each) game(each);
    browser.frames(1);
  }
  return game(cond);
}

test('a new game opens on the introduction (with ?intro): the pod is talked in, flown to the waystation and docked', () => {
  assert.strictEqual(game('INTRO_ENABLED'), false, 'switched off unless asked for');
  assert.strictEqual(game('MISSIONS_ENABLED'), false, 'switched off unless asked for');
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
  assert.ok(game('view.k > 2 && Math.hypot(cam.x - ship.x, cam.y - ship.y) < 20'), 'close on the pod');
  const g0 = game('gapTo(intro.station)');
  browser.frames(60);
  const g1 = game('gapTo(intro.station)');
  assert.ok(g1 < g0 - 100, `it comes closer (${g0.toFixed(0)} → ${g1.toFixed(0)})`);
  game('ship.targetSpeed = SHIP.maxSpeed'); // no flying yet
  assert.ok(until('!intro.arrive', 60 * 6), 'it settles');
  assert.ok(Math.abs(game('view.k') - game('TRACTOR.zoom')) < 0.01, 'pulled back to the wide view');
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
  // Diagnostic one: two answers, each with the portrait in its style; it sets the art style.
  assert.match(text(), /Diagnostic one: please confirm visual functions/);
  assert.match(text(), /Looks bright.*Looks sharp/);
  assert.strictEqual(faces().length, 2, 'a portrait per answer');
  game('Comms.next()');
  assert.match(text(), /Diagnostic one/, 'a question waits for its answer');
  game('Comms.choose(1)');
  assert.strictEqual(game('artStyle.value'), 'lowpoly');
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
  const tab = onStation, press = pressOnStation;
  // Docked after the introduction: only the Missions tab, and no launching before accepting.
  assert.strictEqual(game('StationMenu.tab'), 'missions', 'opens on the Missions tab');
  assert.deepStrictEqual(game('stationLocks().tabs'), ['trade', 'ship', 'research', 'industry', 'squad']);
  game(`StationMenu.showTab('trade')`);
  assert.strictEqual(game('StationMenu.tab'), 'missions', 'the other tabs are locked');
  assert.match(tab(), /Payment in kind/);
  assert.match(tab(), /Station services are suspended/);
  assert.doesNotMatch(tab(), /tap to read the briefing/);
  openMission('Payment in kind');
  assert.match(tab(), /Briefing/);
  assert.match(tab(), /coolant regulator/);
  assert.match(tab(), new RegExp(`${game('mission.vars.ship')} has not returned`));
  assert.ok(allOf(body).some((el) => el.tagName === 'CANVAS'), 'the waystation\'s portrait');
  assert.strictEqual(game('cargo.squad.length'), 0, 'no squad yet');
  const launchBtn = browser.document.getElementById('st-launch');
  assert.ok(launchBtn.disabled, 'Launch waits for the mission');
  launchBtn.dispatch('click', {});
  assert.ok(game('!!docked'), 'still docked');
  // Accepting provides the ship: a Courier with both hardpoints armed.
  press('Accept mission');
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
  assert.ok(until('cargo.missions.count(OPENING, "pirates") === 2', 60 * 3), 'both down (once the last explosion plays)');
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
  assert.match(tab(), /Hand in/);
  openMission('Payment in kind');
  assert.match(tab(), /Please confirm the delivery/);
  // Handed in: the balance halved, the android in the squad, the Squad tab open; the second
  // mission offered.
  press('Complete mission');
  assert.strictEqual(game('cargo.missions.status(OPENING)'), 'done');
  assert.match(tab(), /surplus to requirements/);
  assert.match(tab(), /reduced to 6 bars of gold/);
  assert.match(tab(), /has joined your squad/);
  assert.deepStrictEqual(game('stationLocks().tabs'), ['trade', 'ship', 'research', 'industry'], 'Squad opens; the debt is not settled yet');
  assert.match(tab(), /The remaining balance/);
  assert.ok(game('!!stationLocks().launch'), 'Launch waits for the second mission');
  assert.strictEqual(game('cargo.squad.length'), 1);
  assert.strictEqual(game('cargo.squad[0].name'), game('mission.vars.ship'), 'the same android');
  assert.deepStrictEqual(game('cargo.squad[0].program'), [], 'with no program yet');
  game(`StationMenu.showTab('squad')`);
  assert.strictEqual(game('StationMenu.tab'), 'ship', 'the squad is on the Ship tab');
  assert.strictEqual(game('StationMenu.viewing'), game('cargo.squad[0].id'), 'on the wingman: your own ship is still locked');
  assert.match(tab(), new RegExp(`${game('mission.vars.ship')}.*Instructions.*Add instruction`), 'its program');
  assert.doesNotMatch(tab(), /Performance/, 'its loadout waits until the station opens');
  game(`StationMenu.showTab('missions')`);
});

test('the second mission: mining and gas, an android signal, a hostile android, and the AI logic module settles the debt', () => {
  const comms = browser.document.getElementById('comms');
  const tab = onStation, press = pressOnStation;
  const talkThrough = () => { for (let i = 0; i < 12 && game('!!talk.lines'); i++) game('Comms.next()'); };
  assert.ok(game('!!docked && docked.station === waystation()'), 'still at the waystation');
  openMission('The remaining balance');
  assert.match(tab(), /mine 3 asteroids, and collect gas from 3 gas pockets/);
  assert.match(tab(), new RegExp(game('mission.vars.nebula')));
  assert.ok(!/android signal|AI logic module/.test(tab()), 'the briefing keeps the twist to itself');
  press('Accept mission');
  assert.strictEqual(game('cargo.missions.status(SALVAGE)'), 'active');
  game('launch()');
  assert.match(textOf(comms), /asteroid field and the .* are marked on your map/);
  talkThrough();
  browser.frames(2);
  assert.match(game('objective().text'), /^Mine asteroids · 0\/3/);
  assert.ok(game('frameList.some((e) => e.kind === "wingman")'), 'the squad member flies along');
  // Three asteroids from the first mission's field (the first mined in full, the rest hurried).
  game('fight.grace = 1e9');
  for (let i = 0; i < 3; i++) {
    game(`{ globalThis.__rock = mission.rocks.find((a) => !cargo.removed.has(a.key)); placeShip(__rock.x, __rock.y + __rock.radius + 60); }`);
    browser.frames(1);
    game('startMining(__rock)');
    assert.ok(game('mining.target === __rock'), 'mining');
    if (i) game('mining.t = mineTime() - 0.05');
    assert.ok(until('cargo.removed.has(__rock.key)', 60 * 8), 'mined');
  }
  assert.strictEqual(game('cargo.missions.count(SALVAGE, "mine")'), 3);
  assert.match(game('objective().text'), /^Collect gas pockets · 0\/3/);
  // Three pockets in the nebula the marker points to.
  for (let i = 0; i < 3; i++) {
    game(`{ const o = objective(); globalThis.__gas = world.scene.entities.find((e) => e.kind === 'gas' && e.x === o.x && e.y === o.y); }`);
    assert.ok(game('!!__gas && __gas.pocket.nebula === mission.salvage.nebula'), 'the marker is on a pocket of the nebula');
    game('placeShip(__gas.x, __gas.y + __gas.radius + 60)');
    browser.frames(1);
    game('startMining(__gas); mining.t = mineTime() - 0.05');
    assert.ok(until('cargo.removed.has(__gas.key)', 60 * 4), 'collected');
    game(`for (const d of cargo.drops.filter((e) => e.key.startsWith('drop:' + __gas.key))) { placeShip(d.x, d.y); react(nearbyEntities(simTime)); }`);
  }
  assert.strictEqual(game('cargo.missions.count(SALVAGE, "gas")'), 3);
  // The squad member picks up the signal.
  assert.ok(until('!!talk.lines', 60 * 5), 'the squad member calls');
  assert.match(textOf(comms), new RegExp(`${game('mission.vars.ship')}.*faint ship reading further inside the nebula`));
  game('Comms.next()');
  assert.match(textOf(comms), /The signature is android/);
  talkThrough();
  assert.match(game('objective().text'), /^Investigate the android signal/);
  assert.deepStrictEqual(game('[objective().x, objective().y]'), game('[mission.salvage.x, mission.salvage.y]'));
  assert.ok(game('world.galaxy.nebulaAt(mission.salvage.x, mission.salvage.y) === world.galaxy.nebulae[mission.salvage.nebula]'), 'inside the nebula');
  // There: a hostile android, which attacks.
  game('cargo.hull = SHIP.hull; combatMode.set("rounds"); fight.grace = 0; placeShip(mission.salvage.x - 1800, mission.salvage.y, 0)');
  browser.frames(2);
  assert.ok(game('cargo.missions.done(SALVAGE, "investigate")'), 'investigated');
  assert.ok(game('frameList.includes(mission.hostile)'), 'the hostile android is there');
  game('select(mission.hostile)');
  browser.frames(1);
  assert.match(game('describe(selected.e).subtitle'), /^Android · unregistered · /);
  assert.match(game('describe(selected.e).detail'), /^Alone · Mk III gear$/, 'its pack and gear, a tap away');
  assert.match(game('describe(selected.e).tag'), /^(Weak|Even|Outmatched)$/, 'how a fight would go, in a word');
  game('select(null)');
  const toIt = 'ship.targetAngle = Math.atan2(mission.hostile.y - ship.y, mission.hostile.x - ship.x); ship.targetSpeed = SHIP.maxSpeed * 0.5;';
  assert.ok(until('!!fight.s', 60 * 20, toIt), 'it attacks');
  assert.deepStrictEqual(game('fight.s.enemies.map((e) => e.name)'), [game('mission.vars.hostile')], 'alone, by its designation');
  assert.match(game('toast.text'), new RegExp(`^${game('mission.vars.hostile')} attacks!`));
  assert.ok(until('!inFight()', 120 * 60), 'the fight ends');
  assert.strictEqual(game('fight.result'), 'won');
  // Done for, though it blows up a moment later: meanwhile it can't start another fight.
  for (let i = 0; i < 180 && !game('cargo.removed.has(mission.salvage.hostile.key)'); i++) {
    assert.ok(!game('fight.s'), 'no second fight with a destroyed ship');
    browser.frames(1);
  }
  assert.ok(game('cargo.missions.done(SALVAGE, "hostile") && !fight.dying.size'), 'destroyed (once its explosion plays)');
  browser.frames(2);
  assert.ok(game('frameList.includes(mission.module)'), 'it left the AI logic module');
  // The squad member is puzzled.
  assert.ok(until('!!talk.lines', 60 * 10), 'the squad member calls again');
  assert.match(textOf(comms), /That vessel was android/);
  game('Comms.next()');
  assert.match(textOf(comms), /Androids are pacifists/);
  game('Comms.next()');
  assert.match(textOf(comms), /It dropped something: an AI logic module/);
  talkThrough();
  // The module (not into the hold), then home.
  const held = game('cargo.items.length');
  game('placeShip(mission.module.x + 10, mission.module.y)');
  browser.frames(2);
  assert.ok(game('cargo.missions.done(SALVAGE, "module")') && game('cargo.items.length') === held, 'recovered, outside the hold');
  assert.match(game('objective().text'), /^Return to Waystation HD-1863/);
  game('placeShip(waystation().x, waystation().y + waystation().radius + 150); dock(waystation())');
  assert.strictEqual(game('cargo.missions.status(SALVAGE)'), 'ready');
  openMission('The remaining balance');
  assert.match(tab(), /hand over the AI logic module/);
  // Handed in: the module studied, the debt settled, every tab open.
  press('Complete mission');
  assert.strictEqual(game('cargo.missions.status(SALVAGE)'), 'done');
  assert.match(tab(), /pacifist by design/);
  assert.match(tab(), /anomaly/);
  assert.match(tab(), /come back later/);
  assert.match(tab(), /your account is settled/);
  assert.match(tab(), /Trade, Ship and Research are now open/);
  assert.deepStrictEqual(game('stationLocks().tabs'), []);
  assert.ok(!game('opening()'));
  game(`StationMenu.showTab('trade')`);
  assert.strictEqual(game('StationMenu.tab'), 'trade', 'Trade is open');
  assert.ok(game(`cargo.items.some((it) => Goods.type(it.kind).category === 'gas')`), 'the gas is the player\'s to keep');
  game('launch()');
  browser.frames(3);
  assert.strictEqual(game('objective()'), null, 'nothing more to do');
  // A save from before the second mission, with the first done: its debt was settled already.
  game('saveCargoNow()');
  const key = game('cargo.key'), saved = JSON.parse(browser.storage.get(key));
  delete saved.missions.salvage;
  delete saved.version; // saves of that time had none
  delete saved.missionsVersion;
  browser.storage.set(key, JSON.stringify(saved));
  game('loadCargo(world.galaxy)');
  assert.strictEqual(game('cargo.missions.status(SALVAGE)'), 'done', 'an older save');
  // From before missions altogether, having played the introduction: both done.
  delete saved.missions;
  browser.storage.set(key, JSON.stringify(saved));
  game('loadCargo(world.galaxy)');
  assert.deepStrictEqual(game('[cargo.missions.status(OPENING), cargo.missions.status(SALVAGE)]'), ['done', 'done'], 'an even older save');
  // On to the usual start, with the usual settings.
  game('artStyle.set("line"); combatMode.set("rounds"); fight.grace = 0; placeBeside(startStation())');
});

test('the gate mission: the squad member unblocks the gate under attack, and gets its first combat logic module', () => {
  const comms = browser.document.getElementById('comms');
  const tab = onStation, press = pressOnStation;
  const talkThrough = () => { for (let i = 0; i < 12 && game('!!talk.lines'); i++) game('Comms.next()'); };
  const win = (what) => {
    assert.ok(until('!!fight.s', 60 * 10), `${what}: the pirates attack`);
    game('cargo.hull = SHIP.hull');
    assert.ok(until('!inFight()', 120 * 60), `${what}: the fight ends`);
    assert.strictEqual(game('fight.result'), 'won', what);
  };
  // Offered at the waystation once the debt is settled: optional, so nothing is locked.
  game('cargo.hull = SHIP.hull; repairSquad(); placeShip(waystation().x, waystation().y + waystation().radius + 150); dock(waystation())');
  assert.deepStrictEqual(game('stationLocks().tabs'), []);
  assert.ok(!game('stationLocks().launch'), 'Launch is open');
  game(`StationMenu.showTab('missions')`);
  assert.match(tab(), /Gated community/);
  openMission('Gated community');
  assert.match(tab(), /Optional/);
  assert.match(tab(), /We deactivated it as a security measure/);
  assert.match(tab(), /Waystation HD-1908/);
  assert.ok(game('gatesOnline() === false'), 'the gate is offline');
  press('Accept mission');
  assert.strictEqual(game('cargo.missions.status(GATE_JOB)'), 'active');
  game('combatMode.set("rounds"); launch()');
  assert.match(textOf(comms), /The jump gate is marked on your map/);
  talkThrough();
  browser.frames(2);
  assert.match(game('objective().text'), /^Escort .* to the jump gate/);
  assert.deepStrictEqual(game('[objective().x, objective().y]'), game('[mission.gate.x, mission.gate.y]'));
  // At the gate: the squad member starts work, flies to its spot and cuts at the blocks.
  game('fight.grace = 0; placeShip(mission.gate.work.x - 400, mission.gate.work.y, 0)');
  browser.frames(2);
  assert.ok(game('cargo.missions.done(GATE_JOB, "reach")'), 'reached');
  assert.match(textOf(comms), /Beginning work on the gate blocks/);
  talkThrough();
  browser.frames(240);
  const at = game('{ const w = wings.get(firstMember().id); Math.hypot(w.x - mission.gate.work.x, w.y - mission.gate.work.y) }');
  assert.ok(at < 60, `at its spot by the gate (${at.toFixed(0)} off)`);
  assert.ok(game('cargo.missions.count(GATE_JOB, "work")') > 0, 'the work goes on');
  assert.match(game('objective().text'), /^Protect .* while it disables the gate blocks · \d+%/);
  // A third of the way in, a pirate; then two more.
  game('mission.work = Missions.GATE.workAt - 0.2');
  assert.ok(until('cargo.missions.done(GATE_JOB, "ambush")', 60 * 2), 'the ambush');
  win('the first wave');
  assert.ok(until('cargo.missions.count(GATE_JOB, "pirates") === 1', 60 * 3), 'one down');
  assert.ok(game('cargo.missions.count(GATE_JOB, "work") < 100'), 'the work waits for the pirates');
  assert.ok(until('!!fight.s', 60 * 10), 'the second wave attacks');
  assert.strictEqual(game('fight.s.enemies.length'), 2, 'two in the second wave');
  win('the second wave');
  assert.ok(until('cargo.missions.count(GATE_JOB, "pirates") === 3', 60 * 3), 'all three down');
  // The work finishes; the squad member reports.
  game('mission.work = 99.5');
  assert.ok(until('!!talk.lines', 60 * 10), 'the squad member reports');
  assert.match(textOf(comms), /The gate blocks are disabled/);
  talkThrough();
  assert.match(game('objective().text'), /^Return to Waystation HD-1863/);
  game('placeShip(waystation().x, waystation().y + waystation().radius + 150); dock(waystation())');
  assert.strictEqual(game('cargo.missions.status(GATE_JOB)'), 'ready');
  game(`StationMenu.showTab('missions')`);
  openMission('Gated community');
  // Handed in: the gate online, the squad member's first combat logic module.
  press('Complete mission');
  assert.strictEqual(game('cargo.missions.status(GATE_JOB)'), 'done');
  assert.match(tab(), /Jump gate activated/);
  assert.match(tab(), /We do not want it\. We do not need it\. You may have it/);
  assert.match(tab(), /share our findings with Waystation HD-1908/);
  assert.deepStrictEqual(game('firstMember().program.map(Logic.text)'), ['if enemy.isLeaderTarget → attack(enemy)'], 'its first combat logic module');
  assert.ok(game('gatesOnline() && !world.scene.gates[mission.gate.gate].offline'), 'the gate is online');
  game(`StationMenu.showTab('squad')`);
  assert.match(tab(), /01IFEnemyis the leader's targetTHEN ▶AttackEnemy/, 'its first instruction, as a card');
  // Editing it: a new line, through its sheet.
  game(`StationMenu.showLine(firstMember().id, 1)`);
  assert.match(onStation(), /New instruction/);
  assert.match(onStation(), /ALWAYSTHEN ▶AttackEnemy/, 'a blank instruction to start from');
  assert.match(onStation(), /Who.*Then/, 'its choices in plain words');
  pressOnStation('Add instruction');
  assert.deepStrictEqual(game('firstMember().program.map(Logic.text)'), ['if enemy.isLeaderTarget → attack(enemy)', 'if true → attack(enemy)']);
  // Moved up, switched off, then deleted.
  game(`StationMenu.showLine(firstMember().id, 1)`);
  pressOnStation('↑');
  assert.strictEqual(game('Logic.text(firstMember().program[0])'), 'if true → attack(enemy)');
  game(`StationMenu.showLine(firstMember().id, 0)`);
  pressOnStation('Off');
  assert.strictEqual(game('firstMember().program[0].on'), false);
  game(`StationMenu.showLine(firstMember().id, 0)`);
  pressOnStation('Delete');
  assert.deepStrictEqual(game('firstMember().program.map(Logic.text)'), ['if enemy.isLeaderTarget → attack(enemy)']);
  // What research hasn't unlocked can't be picked.
  assert.ok(!game(`programs.set(firstMember().id, 1, { ...Logic.blank(), pick: 'nearest' })`), 'nearest needs combat.select');
  game('launch()');
  browser.frames(3);
  assert.strictEqual(game('objective()'), null, 'nothing more to do');
  // The tests after this one start from offline gates and a fresh squad member.
  game('cargo.story.delete("gates"); showGates(); firstMember().program = []; saveCargo()');
  game('artStyle.set("line"); combatMode.set("rounds"); fight.grace = 0; placeBeside(startStation())');
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
  const before = game('ArtBodies.stats().builds');
  game(`{ const n = world.galaxy.nebulae[0]; placeShip(n.x + n.blobs[0].dx, n.y + n.blobs[0].dy); }`);
  for (const style of game('ART_STYLES')) { game(`artStyle.set('${style}')`); browser.frames(4); }
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

test('assembles gear by blueprint, fits and sells it, researches a hull refit, and buys a hull', () => {
  game(`fight.grace = 1e9; globalThis.__T = Date.now(); Clock.now = () => __T;
    globalThis.__cap = __find((e) => e.kind === 'station' && e.market.type === 'capital');
    placeShip(__cap.x, __cap.y + __cap.radius + 150);`);
  browser.frames(1);
  game('dock(__cap)');
  assert.ok(game('!!docked && StationMenu.isOpen'), 'docked at a capital');
  // Every tab draws, with slot choices open on the Ship tab.
  for (const t of ['research', 'industry', 'ship', 'trade']) game(`StationMenu.showTab('${t}')`);
  game(`StationMenu.showTab('ship'); StationMenu.toggleSlot('weapon-2')`);
  assert.match(onStation(), /Weapon 2Weapon hardpoint · \d+ options?/, 'the slot\'s sheet');
  assert.match(onStation(), /Fitted.*Pulse laserMk I.*Options/, 'what is fitted, then the options');
  assert.match(onStation(), /Pulse laserMk IIBlueprint needed/, 'the next Mk, not made without its blueprint');
  game(`StationMenu.showTab('trade')`);
  assert.doesNotMatch(onStation(), /Weapon hardpoint/, 'the sheet closes with the tab');
  // Components for a refit, put aboard.
  const give = (id) => game(`for (const c of lab.status('${id}').cost) cargo.components[c.kind] = c.need`);
  // Take out the second salvaged laser (from the first mission) and sell it, freeing a hardpoint.
  assert.ok(game(`outfitting.unfit('weapon-2') && cargo.gear['pulse-laser-1'] === 1 && outfitting.sell('pulse-laser-1')`));
  assert.ok(game(`!cargo.gear['pulse-laser-1'] && SHIP.weaponsFitted === 1`));
  // Gear isn't sold: with its blueprint, an assembler makes a Mk II from parts.
  assert.ok(!game(`outfitting.fit('weapon-2', 'pulse-laser-2')`), 'none to fit');
  assert.ok(game(`lab.grant('bp.pulse-laser-2') && !lab.grant('bp.pulse-laser-2')`), 'a blueprint, as a schematic gives one');
  game(`cargo.credits = 20000; cargo.items = [];
    for (const [k, n] of Object.entries(Recipes.gearRecipe('pulse-laser-2').in)) for (let i = 0; i < n; i++) cargo.items.push({ kind: k, label: Goods.type(k).name, category: 'trade' });`);
  // Production orders need the station's trust: a mission done for it (the jobs' test does one).
  game(`StationMenu.showTab('industry')`);
  assert.match(onStation(), new RegExp(`Complete a mission for ${game('industry.here.name')} first`), 'untrusted');
  game(`cargo.loyalty[industry.here.key] = 1; StationMenu.refresh()`);
  pressOnStation('Store all');
  pressOnStation(/^\+ New order/);
  assert.match(onStation(), /New order.*Gear.*Pulse laser Mk II/, 'the blueprint\'s recipe is there');
  game(`StationMenu.closeSheet(); industry.place('make.pulse-laser-2', 1)`);
  game(`__T += Industry.runTime(industry.orders()[0], industry.env(), __T); StationMenu.tick()`);
  assert.match(onStation(), /Done.*1 of 1 made.*Pulse laser Mk II1 in storage.*Storage/, 'made');
  pressLabelled(/^Pulse laser Mk II, 1$/); // its tile in storage
  pressOnStation('Take');
  game(`industry.cancel(industry.orders()[0].id)`);
  assert.strictEqual(game(`cargo.gear['pulse-laser-2']`), 1, 'into the spare gear');
  // Fitted through the Ship tab: the empty hardpoint's sheet, Fit on the Mk II.
  const fp = game('SHIP.firepower');
  game(`StationMenu.showTab('ship'); StationMenu.toggleSlot('weapon-2')`);
  assert.match(onStation(), /Open hardpoint/);
  pressOnStation('Fit');
  assert.doesNotMatch(onStation(), /Weapon hardpoint/, 'fitted, and the sheet closed');
  assert.ok(game('SHIP.firepower') > fp && game('SHIP.weaponsFitted') === 2, 'the ship fires harder');
  // A mod in the Mk II's slot: a spare one fitted from the slot's sheet, changing the ship.
  game(`cargo.mods['mod.extended-barrel'] = 1`);
  game(`StationMenu.showTab('ship'); StationMenu.toggleSlot('weapon-2')`);
  assert.match(onStation(), /Mods · 0\/1.*Extended barrel.*Spare ×1/, 'the slot\'s mods');
  const range = game('SHIP.weapons[1].range');
  pressOnStation('Fit');
  assert.ok(game(`cargo.loadout.mods['weapon-2'][0] === 'mod.extended-barrel' && !cargo.mods['mod.extended-barrel']`));
  assert.ok(game('SHIP.weapons[1].range') > range, 'reaches further');
  assert.match(onStation(), /Mods · 1\/1.*Extended barrel.*Remove/);
  game('StationMenu.closeSheet()');
  // Swapped in: the old laser is spare gear, sold for half.
  game(`cargo.gear['pulse-laser-2'] = 1`);
  assert.ok(game(`outfitting.fit('weapon-1', 'pulse-laser-2')`));
  // Gear out of a slot: its mods go back to the spare mods.
  assert.ok(game(`outfitting.unfit('weapon-2') && cargo.mods['mod.extended-barrel'] === 1 && !cargo.loadout.mods['weapon-2']`), 'mods back');
  assert.ok(game(`outfitting.fit('weapon-2', 'pulse-laser-2') && outfitting.fitMod('weapon-2', 'mod.extended-barrel')`));
  assert.strictEqual(game(`cargo.gear['pulse-laser-1']`), 1, 'the old laser is spare gear');
  const credits = game('cargo.credits');
  assert.ok(game(`outfitting.sell('pulse-laser-1')`));
  assert.strictEqual(game('cargo.credits'), credits + game(`outfitting.sellPrice('pulse-laser-1')`));
  // A hull refit is researched: paid up front, and once built it raises the hull, damage and all.
  give('hull.armour-1');
  game('cargo.hull = SHIP.hull - 30; cargo.credits = 3000');
  const maxHull = game('SHIP.hull');
  game(`StationMenu.showTab('research')`);
  pressOnStation(/^Hull \d+\/\d+$/);
  assert.match(onStation(), /Hull refits.*Cargo.*Armour.*Hardpoint/, 'refits are researched, in their own group');
  game(`StationMenu.showNode('hull.armour-1')`);
  assert.match(onStation(), /Armour plating Mk I.*Your ship.*Hull120→138/, 'its sheet says what it does to the ship');
  pressOnStation('Build');
  game('StationMenu.closeSheet()');
  assert.ok(game(`cargo.credits === 0 && !cargo.components['hull-components']`), 'paid for');
  assert.strictEqual(game('SHIP.hull'), maxHull, 'not until it is built');
  game(`__T += Research.timeOf('hull.armour-1'); StationMenu.tick()`);
  assert.ok(game(`cargo.lab.done.includes('hull.armour-1')`));
  pressOnStation(/^What research adds/);
  assert.match(onStation(), /\+15%Hull/, 'research adds it, as a stat chip (folded under "What research adds")');
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
  const before = game('JSON.stringify([cargo.loadout, cargo.gear, cargo.mods, cargo.lab, cargo.industry, cargo.components, SHIP.hull, SHIP.cargo, SHIP.weapons])');
  game('saveCargoNow(); loadCargo(world.galaxy)');
  assert.strictEqual(game('JSON.stringify([cargo.loadout, cargo.gear, cargo.mods, cargo.lab, cargo.industry, cargo.components, SHIP.hull, SHIP.cargo, SHIP.weapons])'), before);
  // Back to a Courier for the rest of the run.
  game(`cargo.credits = 20000; outfitting.buyHull('courier'); cargo.items = cargo.items.slice(0, 10); Clock.now = () => Date.now(); launch()`);
  assert.ok(game('!docked && SHIP.name === "Courier"'));
  browser.frames(3);
});

test('researches a logic package: paid up front, built on the real clock, and then usable', () => {
  game(`fight.grace = 1e9; globalThis.__T = Date.now(); Clock.now = () => __T;
    { const st = __startStation(); placeShip(st.x, st.y + st.radius + 150); dock(st); }`);
  assert.ok(game('!!docked'));
  game(`StationMenu.showTab('research')`);
  pressOnStation(/^Logic \d+\/\d+$/); // the group last looked at stays open
  assert.match(onStation(), /Lab.*idle: pick a package below.*Core.*bool.*ext/, 'the bench, the groups and the tree');
  // What core.bool costs, put aboard.
  game(`for (const c of lab.status('core.bool').cost) {
    if (Goods.isSalvage(c.kind)) cargo.components[c.kind] = c.need;
    else for (let i = 0; i < c.need; i++) cargo.items.push({ kind: c.kind, label: Goods.type(c.kind).name, category: 'trade' });
  } cargo.credits = 1000; StationMenu.refresh()`);
  const held = game('cargo.items.length');
  game(`StationMenu.showNode('core.bool')`);
  assert.match(onStation(), /core\.bool@1\.0.*Gives.*Cost/, 'the package\'s sheet');
  pressOnStation('Build');
  assert.ok(game(`cargo.lab.active.id === 'core.bool' && cargo.credits === 700 && !cargo.components['computer-simple']`), 'paid up front');
  assert.strictEqual(game('cargo.items.length'), held - 1, 'the goods went too');
  assert.match(onStation(), /compiling core\.bool@1\.0/);
  // Not done yet: and isn't known.
  assert.ok(!game(`programs.set(firstMember().id, 0, { ...Logic.blank(), when: [Logic.clause(), Logic.clause({ join: 'and' })] })`), 'and needs core.bool');
  // Half way, then done: the timer tick sees it.
  game(`__T += Research.timeOf('core.bool') / 2; StationMenu.tick()`);
  assert.match(onStation(), /50% · 3m left/);
  game(`__T += Research.timeOf('core.bool'); StationMenu.tick()`);
  assert.ok(game(`cargo.lab.done.includes('core.bool') && !cargo.lab.active`), 'built');
  assert.match(Messages.log.at(-1).text, /Build ok · import core\.bool@1\.0/, 'logged');
  assert.ok(game(`programs.set(firstMember().id, 0, { ...Logic.blank(), when: [Logic.clause(), Logic.clause({ join: 'and', not: true })] })`), 'and, not are known now');
  game('firstMember().program.splice(0, 1)');
  // Queued, then the game closed for an hour: done on load, and the next one has started.
  game(`cargo.credits = 1e5; for (const id of ['maint.sense', 'squad.link']) for (const c of lab.status(id).cost) {
    if (Goods.isSalvage(c.kind)) cargo.components[c.kind] = (cargo.components[c.kind] || 0) + c.need;
    else for (let i = 0; i < c.need; i++) cargo.items.push({ kind: c.kind, label: Goods.type(c.kind).name, category: 'trade' });
  }`);
  assert.ok(game(`lab.enqueue('maint.sense') && lab.enqueue('squad.link')`));
  game(`StationMenu.showNode('squad.link')`);
  assert.match(onStation(), /squad\.link@1\.0.*Cancel · all back/, 'queued: it can be cancelled from its sheet');
  game('StationMenu.closeSheet()');
  game(`saveCargoNow(); __T += Research.timeOf('maint.sense') + 1000; loadCargo(world.galaxy)`);
  assert.ok(game(`cargo.lab.done.includes('maint.sense') && cargo.lab.active.id === 'squad.link'`), 'finished while away');
  // Cancelled while building: half back.
  const credits = game('cargo.credits');
  assert.deepStrictEqual(game(`lab.cancel('squad.link')`), ['squad.link']);
  assert.strictEqual(game('cargo.credits'), credits + Math.floor(game(`Research.PACKAGES['squad.link'].cost.credits`) / 2));
  game('Clock.now = () => Date.now(); launch()');
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

test('production: an order at a mining camp makes steel pipe while away, taken out at another station', () => {
  game(`fight.grace = 1e9; globalThis.__T = Date.now(); Clock.now = () => __T;
    globalThis.__camp = __find((e) => e.kind === 'station' && e.market.type === 'mining camp');
    placeShip(__camp.x, __camp.y + __camp.radius + 150); cargo.loyalty[__camp.key] = 1; dock(__camp);`);
  game(`StationMenu.showTab('industry')`);
  assert.match(onStation(), /Refinery0\/1 orders.*Idle.*No order placed.*\+ New order.*Storage/, 'nothing placed yet');
  assert.doesNotMatch(onStation(), /Production pipeline/, 'no pipeline without orders');
  game('cargo.items = []');
  // Iron aboard, stored.
  game(`for (let i = 0; i < 10; i++) cargo.items.push({ kind: 'iron', label: 'Iron', category: 'trade' }); StationMenu.refresh()`);
  pressOnStation('Store all');
  assert.ok(game(`cargo.items.length === 0 && industry.state.storage.iron === 10`), 'from the hold into storage');
  // A new order, product first: only what a refinery makes, then the product's lineage.
  pressOnStation(/^\+ New order/);
  assert.match(onStation(), /New order.*Refined goods.*Steel pipe/, 'what this station can make');
  assert.doesNotMatch(onStation(), /Actuator/, 'not parts: a mining camp refines');
  assert.match(onStation(), /Steel pipe2 Iron → Steel pipe · 20sReady/, 'each product with its recipe, and whether storage has its inputs');
  pressOnStation(/^Steel pipe/); // the first: steel pipe
  assert.match(onStation(), /1 run, 20s each/, 'picked');
  pressOnStation('Continuous');
  pressOnStation('Place order');
  assert.ok(game(`industry.orders()[0].recipe === 'make.steel-pipe' && industry.orders()[0].next > __T`), 'running');
  assert.match(onStation(), /Running0 made · while inputs last.*Iron✓ 8.*Refinery.*left.*Steel pipe/, 'its line: iron into the refinery, steel pipe out');
  // An input opens its lineage.
  pressLabelled(/^Iron: 8 in storage, needs 2/);
  assert.match(onStation(), /Lineage2 × IronRaw✓ 8.*Enough Iron in storage/);
  game('StationMenu.closeSheet()');
  // With room for more than one order (research), the Ship tab's switcher steps through them, a free order last.
  game(`lab.grant('ind.bays.1'); StationMenu.refresh()`);
  assert.match(onStation(), /Steel pipe 1\/2.*Refinery1\/2 orders.*Running/, 'the order shown, one of two');
  pressOnStation('›');
  assert.match(onStation(), /New order 2\/2.*Idle1 order free here.*\+ New order/, 'then the free one');
  assert.doesNotMatch(onStation(), /Running/, 'one at a time');
  pressOnStation(/^\+ New order/);
  pressOnStation(/^Hydrazine/);
  pressOnStation('Place order');
  assert.match(onStation(), /Hydrazine 2\/2.*Refinery2\/2 orders.*Starved/, 'the new order, shown');
  pressOnStation('›'); // round to the first
  assert.match(onStation(), /Steel pipe 1\/2.*Running/);
  game(`industry.cancel(industry.orders()[1].id); cargo.lab.done.splice(cargo.lab.done.indexOf('ind.bays.1'), 1); delete cargo.lab.doneAt['ind.bays.1']; StationMenu.refresh()`);
  assert.doesNotMatch(onStation(), /\b1\/2\b/, 'one order again: no switcher');
  pressOnStation(/^Production pipeline · 1 order/); // folded until opened
  assert.match(onStation(), /Production pipeline.*Standalone/, 'a lone order');
  // Away for an hour: on load, everything the iron makes is made.
  game('launch(); saveCargoNow(); __T += 3600e3; loadCargo(world.galaxy)');
  assert.ok(game(`cargo.industry.storage['steel-pipe'] === 5 && !cargo.industry.storage.iron`), 'made while away');
  // At another station, taken out of the same storage.
  game(`{ const st = __startStation(); placeShip(st.x, st.y + st.radius + 150); dock(st); } StationMenu.showTab('industry')`);
  assert.match(onStation(), /Storage.*Production pipeline.*Steel pipe.*Starved/, 'the camp\'s order, seen from here');
  pressLabelled(/^Steel pipe, 5$/); // its tile: what uses it
  assert.match(onStation(), /Steel piperefined5 in storage · Used in Electronics.*Fabricator order/, 'what uses steel pipe');
  pressOnStation('Take');
  assert.strictEqual(game(`hold.count('steel-pipe')`), 5);
  // Pausing and cancelling work from anywhere; changing only at the order's station.
  const id = game('cargo.industry.orders[0].id');
  game(`StationMenu.showOrder({ mode: 'view', id: ${id} })`);
  assert.match(onStation(), /Steel pipe.*Refinery order.*Changed only at/);
  pressOnStation('Pause');
  assert.ok(game('cargo.industry.orders[0].paused'));
  assert.ok(!game(`industry.edit(${id}, 'make.hydrazine', 1)`), 'not changed from here');
  pressOnStation('Cancel order');
  assert.strictEqual(game('cargo.industry.orders.length'), 0);
  game('Clock.now = () => Date.now(); launch()');
  browser.frames(2);
});

test('an old save: researched gear becomes schematics, hull upgrades become refits', () => {
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
  assert.deepStrictEqual(game(`readLab(${JSON.stringify(lab.lab)}).doneAt`), { 'core.bool': 0, 'hull.armour-1': 0 });
  // Industry starts empty; a damaged one keeps what makes sense.
  assert.deepStrictEqual(game(`(() => { const d = {}; CARGO_MIGRATIONS[7](d); return d.industry; })()`), { storage: {}, orders: [], seq: 1 });
  const ind = game(`readIndustry({ storage: { iron: 3.7, nope: 2, titanium: -1 }, seq: 2, orders: [
    { id: 1, station: 'st1', name: 'A', type: 'minor', recipe: 'make.electronics', left: null, made: 2, at: 5, next: 9, paused: 0 },
    { id: 4, station: 'st2', name: 'B', type: 'minor', recipe: 'make.steel-pipe', left: 1, made: 0, at: null, next: null },
    { id: 1, station: 'st3', name: 'C', type: 'capital', recipe: 'make.shield-cell', left: 1, made: 0 }, 'x',
    { id: 5, station: 'st4', name: 'D', type: 'mining camp', recipe: 'make.steel-pipe', left: 2.5, made: 1, at: 9, next: 'x', paused: true }] })`);
  // Gear owned and schematics recovered become their blueprints.
  const bps = game(`(() => { const d = { schematics: ['deflector-4'], loadout: { hull: 'courier', fitted: { 'weapon-1': 'pulse-laser-3', shield: 'deflector-1' } },
    gear: { 'survey-scanner-2': 1 }, lab: { done: [], active: { id: 'bp.pulse-laser-3', start: 1, end: 2 }, queue: ['bp.deflector-4', 'core.bool'] } }; CARGO_MIGRATIONS[8](d); return d; })()`);
  assert.deepStrictEqual(bps.lab, { done: ['bp.deflector-4', 'bp.pulse-laser-3', 'bp.survey-scanner-2'], doneAt: { 'bp.deflector-4': 0, 'bp.pulse-laser-3': 0, 'bp.survey-scanner-2': 0 }, active: null, queue: ['core.bool'] });
  assert.strictEqual(bps.schematics, undefined);
  assert.deepStrictEqual(ind, { storage: { iron: 3 }, seq: 6, orders: [
    { id: 1, station: 'st1', name: 'A', type: 'minor', recipe: 'make.electronics', left: null, made: 2, at: 5, next: 9, paused: false },
    { id: 5, station: 'st4', name: 'D', type: 'mining camp', recipe: 'make.steel-pipe', left: 2, made: 1, at: null, next: null, paused: true }] },
  'a recipe the station type does not make, a repeated id and a broken run are dropped');
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
  assert.deepStrictEqual(game(`readLoyalty({ a: 2, b: 'x', c: null })`), { a: 2 });
  assert.deepStrictEqual(game(`readLab({ done: ['core.bool', 'nope', 'core.bool'], active: { id: 'maint.sense', start: 5, end: 'x' }, queue: ['core.bool', 'squad.link'] }).done`), ['core.bool']);
  assert.strictEqual(game(`readLab({ active: { id: 'maint.sense', start: 5, end: 'x' }, queue: ['squad.link'] }).active.id`), 'squad.link', 'a broken build is dropped, the queue moves up');
});

test('components go to their own store, even with a full hold, and stay when the ship is lost', () => {
  game(`cargo.items = Array.from({ length: SHIP.cargo }, () => ({ kind: 'iron', label: 'Iron', category: 'trade' }));
    globalThis.__had = cargo.components['hull-components'] || 0;
    cargo.drops.push(dropEntity({ key: 'drop:smoke:c', kind: 'hull-components', seed: 5, x: ship.x, y: ship.y }));
    cargo.drops.push(dropEntity({ key: 'drop:smoke:g', kind: 'silicates', seed: 6, x: ship.x, y: ship.y }));`);
  browser.frames(2);
  assert.strictEqual(game(`cargo.components['hull-components']`), game('__had') + 1, 'the component was picked up');
  assert.strictEqual(game('cargo.items.length'), game('SHIP.cargo'), 'the hold is still full');
  assert.ok(game(`cargo.drops.some((d) => d.key === 'drop:smoke:g')`), 'the trade good is left floating');
  const components = game('JSON.stringify(cargo.components)');
  game('playerDestroyed(); towHome();');
  assert.strictEqual(game('cargo.items.length'), 0, 'the hold spilled');
  assert.strictEqual(game('JSON.stringify(cargo.components)'), components, 'the components are kept');
  game(`cargo.drops = cargo.drops.filter((d) => !d.key.startsWith('lost:') && !d.key.startsWith('drop:smoke'))`);
  browser.frames(3);
});

test('items near the ship are pulled in and picked up; a trade good with no room stays put', () => {
  game(`cargo.items = [];
    cargo.drops.push(dropEntity({ key: 'drop:smoke:pull', kind: 'silicates', seed: 7, x: ship.x + PULL_RANGE * 0.8, y: ship.y }));
    for (let i = 0; i < 20; i++) react(nearbyEntities(simTime), 0.05);`);
  assert.ok(!game(`cargo.drops.some((d) => d.key === 'drop:smoke:pull')`), 'pulled in and picked up');
  assert.strictEqual(game('cargo.items.length'), 1);
  game(`cargo.items = Array.from({ length: SHIP.cargo }, () => ({ kind: 'iron', label: 'Iron', category: 'trade' }));
    cargo.drops.push(dropEntity({ key: 'drop:smoke:stay', kind: 'silicates', seed: 8, x: ship.x + PULL_RANGE * 0.8, y: ship.y }));
    for (let i = 0; i < 20; i++) react(nearbyEntities(simTime), 0.05);`);
  assert.strictEqual(game(`cargo.drops.find((d) => d.key === 'drop:smoke:stay').x`), game('ship.x + PULL_RANGE * 0.8'), 'not pulled');
  game(`cargo.items = []; cargo.drops = cargo.drops.filter((d) => !d.key.startsWith('drop:smoke'))`);
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

test('collects a gas pocket in a nebula and picks up its gas', () => {
  // (The opening missions may have used up the pockets within reach: put one back if so.)
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
  assert.ok(game('mining.target === __gas'), `collecting: ${game(`actions.state('collect', __gas).label`)}`);
  game('select(__gas)');
  browser.frames(1);
  assert.match(game('describe(__gas).actions[0].label'), /^Collecting · \d+ sec$/);
  assert.ok(until('cargo.removed.has(__gas.key)', Math.ceil(game('mineTime(__gas)') * 60) + 30), 'the pocket is used up');
  assert.match(game('toast.text'), /^Gas pocket collected · \d × /);
  assert.ok(game('!frameList.includes(__gas)'), 'and gone');
  const n = game('Mining.gasOf(world.galaxy.seed, __gas).length'), held = game('cargo.items.length');
  game(`for (const d of cargo.drops.filter((e) => e.key.startsWith('drop:' + __gas.key))) { placeShip(d.x, d.y); react(nearbyEntities(simTime)); }`);
  browser.frames(2);
  assert.strictEqual(game('cargo.items.length'), held + n, 'its gas is in the hold');
  assert.ok(game(`cargo.items.slice(-${n}).every((it) => Goods.type(it.kind).category === 'gas')`));
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

test('a jump gate is offline until the gates come online, then takes the ship to the wormhole and back', () => {
  game('globalThis.__gate = world.scene.gates.find((g) => !g.gate.wormhole); globalThis.__hole = world.scene.gates.find((g) => g.gate.wormhole)');
  assert.ok(game('!!__gate && !!__hole'), 'the system has a gate and a wormhole');
  assert.strictEqual(game('__gate.gate.link'), game('__hole.gate.id'), 'the gate leads to the wormhole');
  assert.strictEqual(game('__gate.art.culture.lineage'), 'wedge', 'a Wedge gate');
  game('cargo.story.delete("gates"); showGates()');
  game('fight.grace = 1e9; select(null); placeShip(__gate.x, __gate.y + __gate.radius + 120)');
  browser.frames(2);
  assert.ok(game('frameList.some((e) => e.kind === "gate" && visible(e))'), 'the gate is drawn');
  // Offline: no jump and no name for where it leads; the wormhole is never offline.
  assert.deepStrictEqual(game(`[actions.state('jump', __gate).ok, actions.state('jump', __gate).label]`), [false, 'Gate offline']);
  assert.strictEqual(game('__gate.name'), 'Jump gate');
  assert.match(game('describe(__gate).subtitle'), /^Offline/);
  assert.notStrictEqual(game(`actions.state('jump', __hole).label`), 'Gate offline');
  assert.match(game('describe(__hole).subtitle'), /^Wormhole to the .* Gate\b/);
  game('cargo.story.add("gates"); showGates()');
  assert.match(game('__gate.name'), /Gate$/);
  assert.match(game('describe(__gate).subtitle'), /^Jump gate to the .* Wormhole\b/);
  assert.ok(game(`actions.state('jump', __gate).ok`), 'in range to jump');
  game('select(__gate)');
  browser.key('j');
  browser.frames(2);
  assert.ok(game('warp.on'), 'the jump is under way');
  assert.ok(until('!warp.on', 60 * 3), 'and over within a few seconds');
  assert.match(game('toast.text'), /^Through to the .* Wormhole/);
  assert.ok(game('Math.hypot(ship.x - __hole.x, ship.y - __hole.y) < 800'), 'beside the wormhole');
  // And back through the wormhole.
  game('select(__hole)');
  browser.key('j');
  assert.ok(until('!warp.on', 60 * 3), 'the jump back is over');
  assert.ok(game('Math.hypot(ship.x - __gate.x, ship.y - __gate.y) < 800'), 'beside the gate again');
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

test('fights in rounds to the end', () => {
  game(`combatMode.set('rounds')`);
  meetPirate();
  assert.strictEqual(game('fight.mode'), 'rounds');
  assert.ok(until('!inFight()', 120 * 60), 'the fight ends');
  assert.ok(['won', 'lost', 'fled', null].includes(game('fight.result')));
  browser.frames(300); // the result panel times out
});

test('abilities in a fight: the player spends a charge from the panel, a wingman by its use line', () => {
  game(`combatMode.set('rounds'); cargo.kit = { 'emp-charge': 2, 'repair-nanites': 1 }`);
  meetPirate();
  browser.frames(2);
  const panel = () => textOf(browser.document.getElementById('combat').querySelector('.cb-abil'));
  const labels = () => browser.document.getElementById('combat').querySelector('.cb-abil').children.map((b) => b.getAttribute('aria-label'));
  assert.deepStrictEqual(labels(), ['Repair nanites, 1 left', 'EMP charge, 2 left'], 'a button per consumable in the kit');
  assert.match(panel(), /×1.*×2/, 'with its charges');
  // The player: an EMP on the enemy targeted.
  game('fight.s.player.hull = Math.min(fight.s.player.hull, 10)');
  game(`useAbility(fight.s, fight.s.player, 'emp-charge', fight.s.focus)`);
  assert.ok(game(`cargo.kit['emp-charge'] === 1 && Abilities.disabled(fight.s.enemies.find((e) => e.id === fight.s.focus), fight.s.t)`), 'spent, and the target silenced');
  assert.ok(!game(`useAbility(fight.s, fight.s.player, 'emp-charge', fight.s.focus)`), 'cooling down');
  // A wingman with a use line repairs the damaged leader.
  game(`cargo.lab.done.push('tactics.use'); firstMember().program.unshift({ ...Logic.blank(), subject: 'leader', act: 'use', skill: 'repair-nanites' })`);
  browser.frames(2);
  assert.ok(game(`!cargo.kit['repair-nanites'] && fight.s.player.hull > 10`), 'the wingman used the nanites on the leader');
  game('firstMember().program.shift(); cargo.lab.done.pop()');
  assert.ok(until('!inFight()', 120 * 60), 'the fight ends');
  browser.frames(300);
});

test('fights in real time, then gets away', () => {
  game(`combatMode.set('realtime')`);
  meetPirate();
  assert.strictEqual(game('fight.mode'), 'realtime');
  // Fly at the target for a while (the guns fire on their own), then break away.
  const chase = `{ const t = fight.s && fight.ships.get(fight.s.focus); if (t) { ship.targetAngle = Math.atan2(t.y - ship.y, t.x - ship.x); ship.targetSpeed = SHIP.maxSpeed * 0.5; } }`;
  // Meanwhile the panel's first row (the player's) shows the hull and shield every frame, as they
  // change between the log's lines (the shield recharging, from half).
  const shown = () => textOf(browser.document.getElementById('combat').querySelector('.cb-rows').children[0].children[2]);
  const actual = '`${Math.ceil(fight.s.player.hull)} · ${Math.floor(fight.s.player.shield)}`';
  const readings = new Set();
  game('fight.s.player.shield = Math.floor(fight.s.player.stats.shield / 2)'); // so it recharges, hit or not
  for (let i = 0; i < 30 * 60 && game('!!fight.s'); i++) {
    game(chase);
    browser.frames(1);
    if (!game('!!fight.s')) break;
    assert.strictEqual(shown(), game(actual), 'the panel shows the player\'s hull and shield');
    readings.add(shown());
  }
  assert.ok(readings.size > 1, 'the readings changed during the fight');
  const away = `{ const a = fight.s ? Math.atan2(ship.y - fight.s.anchor.y, ship.x - fight.s.anchor.x) : 0; ship.targetAngle = a; ship.targetSpeed = SHIP.maxSpeed; }`;
  assert.ok(until('!inFight()', 120 * 60, away), 'the fight ends');
  game('ship.targetSpeed = 0');
  browser.frames(300);
});

test('the wingman flies in formation, assists the leader in both combat modes, and is repaired at a dock', () => {
  assert.strictEqual(game('cargo.squad.length'), 1, 'a new game has one wingman');
  const id = game('cargo.squad[0].id');
  game('repairSquad()'); // an earlier fight may have left it disabled until the next dock
  assert.match(game('cargo.squad[0].name'), /^[A-Z][a-z]+-\d\d$/);
  assert.strictEqual(game(`wings.get('${id}').art.culture.lineage`), 'android', 'built in the android culture');
  // It joined with an empty program; give it the Assist leader line (a later mission's job).
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
    if (game('!!fight.s')) assert.match(textOf(browser.document.getElementById('combat').querySelector('.cb-rows')), /L1/, `${mode}: the panel shows the line it runs`);
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
  game(`cargo.gear['pulse-laser-2'] = 1; StationMenu.refresh(); StationMenu.toggleSlot('weapon-1')`);
  assert.match(onStation(), new RegExp(`Weapon 1${name} · Weapon hardpoint`), 'the sheet is for the wingman');
  assert.match(onStation(), /Fitted.*Pulse laserMk I.*Remove.*Options.*Pulse laserMk IISpare ×1/, 'what it has (your starting gear), then the spare gear');
  const dps = game('Squad.stats(cargo.squad[0]).firepower');
  assert.ok(game(`outfitting.member('${id}').fit('weapon-1', 'pulse-laser-2')`));
  assert.ok(game('Squad.stats(cargo.squad[0]).firepower') > dps, 'it fires harder');
  assert.strictEqual(game(`wings.get('${id}').stats.firepower`), game('Squad.stats(cargo.squad[0]).firepower'), 'and flies with it');
  assert.deepStrictEqual(game(`[cargo.gear['pulse-laser-2'] || 0, cargo.gear['pulse-laser-1']]`), [0, 1], 'its Mk I to the spare gear');
  game(`StationMenu.closeSheet()`);
  pressOnStation(/^Spare gear · /); // folded until opened
  assert.match(ship(), /Spare gear.*Pulse laserMk I.*Sell/, 'spare gear like any other');
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
  game(`{ const st = world.scene.stations.find((s) => s.key === '${key}'); placeShip(st.x, st.y + st.radius + 150); dock(st); StationMenu.showTab('missions'); }`);
  assert.strictEqual(game('docked && docked.station.key'), key, 'docked');
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
    minor: [['hunt', hunt]], 'mining camp': [['hunt', hunt]], 'salvage yard': [['hunt', hunt]],
  });
  rebuildBoard();
}
function removeTestJobs() {
  for (const k of Object.keys(JobTexts.STATION)) delete JobTexts.STATION[k];
  rebuildBoard();
}

test('jobs: every station posts one, named for it; a hunt is taken, fought and handed in, and opens production there', () => {
  installTestJobs();
  game(`cargo.story.add('gates'); showGates(); combatMode.set('rounds'); fight.grace = 1e9; cargo.hull = SHIP.hull; repairSquad()`);
  assert.ok(game(`world.galaxy.stations.filter((st) => !st.waystation).every((st) => cargo.board.list.some((j) => j.tier === 'station' && j.scope === st.key))`), 'every station has a job of its own');
  // A hunt at a station that takes production orders.
  game(`globalThis.__job = cargo.board.list.find((j) => j.tier === 'station' && j.steps.length === 2 && j.steps[1].type === 'fight'
    && Industry.STAGE[world.scene.stations.find((s) => s.key === j.scope).market.type] && !Industry.trusted(cargo.loyalty, j.scope) && cargo.missions.status(j.id) === 'offered');`);
  const id = game('__job.id'), title = game('__job.title'), key = game('__job.scope');
  dockAt(key);
  assert.ok(title.startsWith(`${game('docked.station.name')}: `), `named for its station: ${title}`);
  game(`StationMenu.showTab('industry')`);
  assert.match(onStation(), /Complete a mission for .* first/, 'no production orders yet');
  game(`StationMenu.showTab('missions')`);
  assert.match(onStation(), new RegExp(title));
  openMission(title);
  assert.match(onStation(), /Loyalty \+1 at/, 'what it pays, loyalty with it');
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
  // Handed in: paid, the station trusts you, and its faction thinks better of you.
  const credits = game('cargo.credits'), reward = game('__job.reward.credits');
  const regard = game(`Reputation.regard(cargo.rep, __job.faction)`);
  dockAt(key);
  openMission(title);
  pressOnStation('Complete mission');
  assert.strictEqual(game(`cargo.missions.status('${id}')`), 'done');
  assert.strictEqual(game('cargo.credits'), credits + reward, 'paid');
  assert.ok(reward >= 400, `worth the trip (${reward} cr)`);
  assert.strictEqual(game(`cargo.loyalty['${key}']`), 1);
  assert.strictEqual(game(`Reputation.regard(cargo.rep, __job.faction)`), regard + game('Reputation.JOB.station'), 'regard with the giver');
  assert.match(onStation(), /now takes your production orders/);
  game(`StationMenu.showTab('industry')`);
  assert.doesNotMatch(onStation(), /Complete a mission for/, 'production orders open');
  game('launch()');
  browser.frames(2);
  assert.strictEqual(game('objective()'), null, 'nothing under way');
});

test('jobs: an escort with a twist on the comms, handed in where it delivers; goods handed over; abandoning starts over', () => {
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
  game('launch(); cargo.story.delete("gates"); showGates(); fight.grace = 0');
  removeTestJobs();
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
  game('ship.targetSpeed = 200');
  tap(21, 50000);
  assert.strictEqual(game('ship.targetSpeed'), 200, 'one tap: still flying');
  tap(22, 50250);
  assert.strictEqual(game('ship.targetSpeed'), 0, 'a double-tap: stopped');
  game('ship.targetSpeed = 200');
  tap(23, 60000);
  tap(24, 61000);
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

test('back from another app mid-fight, flight waits for a tap', () => {
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

  // Paused behind the menu, the ship parked on a loose item doesn't pick it up; once the menu
  // closes, it does.
  const item = `world.scene.entities.find((e) => e.kind === 'item' && !e.mission && !cargo.removed.has(e.key))`;
  assert.ok(game(`!!(globalThis.__item = ${item})`), 'a loose item');
  game('fight.grace = 1e9; placeShip(__item.x, __item.y); cargo.credits += 0');
  game('Settings.open()');
  browser.frames(5);
  assert.ok(!game('cargo.removed.has(__item.key)'), 'nothing is picked up while paused');
  browser.key('Escape');
  browser.frames(2);
  assert.ok(game('cargo.removed.has(__item.key)'), 'picked up once flight resumes');
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
  game('cargo.rep.drifter = 0');
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
    // Off the planets with Take off; off the moon by flying out past the landing site's rim.
    if (game('__body.kind') === 'planet') game('takeOff()'); else game('landing.craft.x += 2500');
    assert.ok(until('!landing.on'), `${name}: back in space`);
    assert.ok(!game('modes.has("landing") || modes.has("landed")'), 'the modes are cleared');
    assert.ok(game('Math.hypot(ship.x - __body.x, ship.y - __body.y) < __body.body.r * 2.1 + 400'), `${name}: the ship is beside it`);
  }
});

test('nothing was drawn at a non-finite position', () => {
  assert.deepStrictEqual(browser.badDraws, []);
});

console.log(failed ? `\n${failed} smoke test(s) failed` : '\nall smoke tests passed');
process.exit(failed ? 1 : 0);
