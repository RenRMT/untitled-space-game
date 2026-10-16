// The world: the galaxy (generated from world/system-config.js, or ?seed=), its scene, fog of war
// and map travel; loadGalaxy() swaps them all, as the map's Reroll does. Saves on leaving the page.
// Part of the flight view; src/main.js starts it.

import { ArtAndroids } from '../art/androids.js';
import { ArtBodies } from '../art/bodies.js';
import { ArtCulture } from '../art/culture.js';
import { Art } from '../art/render.js';
import { Params } from '../core/store.js';
import { Scene } from '../flight/scene.js';
import { Travel } from '../flight/travel.js';
import { Knowledge } from '../rules/knowledge.js';
import { SystemMap } from '../ui/map.js';
import { Settings } from '../ui/settings.js';
import { Galaxy } from '../world/galaxy.js';
import { SYSTEM_CONFIG } from '../world/system-config.js';
import { GATE_JOB, OPENING, SALVAGE, cargo, loadCargo, opening, saveCargoNow } from './cargo.js';
import { endIntro, introDue, startIntro, waystation } from './intro.js';
import { buildMission, endTalk, mission, showGates, skipOpening } from './missions.js';
import { ambushCleared, placeBeside, startStation } from './outfitting.js';
import { SHIP, intro, ship } from './state.js';
import { arriveAt } from './travel.js';

export const world = { galaxy: null, cultures: null, scene: null, knowledge: null, travel: null };

// The galaxy is generated from SYSTEM_CONFIG (world/system-config.js); a ?seed= URL parameter
// overrides its seed, and the map's Reroll asks for a new one.
export function initialSeed() {
  const param = Params.get('seed');
  if (param === null || param === '') return SYSTEM_CONFIG.seed;
  return /^\d+$/.test(param) ? Number(param) : param;
}
export const newGalaxy = (seed) => loadGalaxy(Galaxy.generate(seed, SYSTEM_CONFIG));

export function loadGalaxy(galaxy) {
  if (world.knowledge) world.knowledge.save(); // keep the old galaxy's charts before switching
  SystemMap.galaxy = galaxy;
  world.galaxy = galaxy;
  world.cultures = ArtCulture.forGalaxy(galaxy);
  world.scene = Scene.create(galaxy, world.cultures);
  // What the player knows (fog of war); ?fresh forgets saved charts.
  world.knowledge = Knowledge.create(galaxy, { fresh: Params.has('fresh') });
  world.android = ArtCulture.xeno(galaxy.seed).android; // what squad members are built in
  const way = galaxy.stations[galaxy.waystation];
  world.wayFace = way ? ArtAndroids.create(way.seed, world.cultures.of(way.culture)) : null; // its android
  endTalk(false);
  buildMission();
  loadCargo(galaxy);
  SystemMap.knowledge = world.knowledge;
  world.travel = Travel.create(galaxy, world.knowledge, { pingRange: () => SHIP.pingRange, cleared: ambushCleared });
  SystemMap.trip = world.travel;
  Art.clearCache();
  ArtBodies.clearCache();
  if (intro.on) endIntro({ played: false }); // a new galaxy mid-introduction: start over
  if (!mission.site) cargo.missions.finish(OPENING); // no waystation: no opening missions
  if (!mission.salvage) cargo.missions.finish(SALVAGE); // (or no nebula for the second)
  if (!mission.gate) cargo.missions.finish(GATE_JOB); // (or no gate for the third)
  else if (Params.has('skipintro') && opening()) skipOpening();
  showGates();
  if (introDue()) startIntro();
  else if (opening()) placeBeside(waystation()); // the opening missions start and end there
  else placeBeside(startStation());
  SystemMap.setPlayer(ship.x, ship.y);
}
// Knowledge and cargo save on a short debounce; everything is written out when the page is hidden
// or closed (a fight's hull damage isn't saved until then or the fight's end).
export function saveAll() {
  world.knowledge.save();
  saveCargoNow();
}

// Wiring, run once every module has loaded (src/main.js).
export function init() {
  Settings.add({
    id: 'galaxy', label: 'Galaxy',
    action: {
      label: 'Re-roll',
      hint: 'Generate a new galaxy from a random seed.',
      run: () => { const seed = 1 + Math.floor(Math.random() * 999999); Params.set('seed', seed); newGalaxy(seed); },
    },
    locked: () => (world.travel && world.travel.active ? 'Not during map travel.' : null),
  });
  window.addEventListener('pagehide', saveAll);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') saveAll(); });
  SystemMap.onJump = (dest) => arriveAt(dest);
}
