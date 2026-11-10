// The world: the galaxy (generated from world/system-config.js, or ?seed=), its scene, fog of war
// and map travel; loadGalaxy() swaps them all, as Settings' Re-roll does. Saves on leaving the page.
// Part of the flight view; src/main.js starts it.

import { ArtBodies } from '../art/bodies.js';
import { ArtCrew } from '../art/crew.js';
import { ArtCulture } from '../art/culture.js';
import { Art } from '../art/render.js';
import { Clock } from '../core/clock.js';
import { Params, Store } from '../core/store.js';
import { Scene } from '../flight/scene.js';
import { Travel } from '../flight/travel.js';
import { Knowledge } from '../rules/knowledge.js';
import { Reputation } from '../rules/reputation.js';
import { Survey } from '../rules/survey.js';
import { SystemMap } from '../ui/map.js';
import { Settings } from '../ui/settings.js';
import { Galaxy } from '../world/galaxy.js';
import { SYSTEM_CONFIG } from '../world/system-config.js';
import { cargo, loadCargo, saveCargoNow } from './cargo.js';
import { endTalk, showGates } from './missions.js';
import { ambushCleared, placeBeside, startStation } from './outfitting.js';
import { SHIP, notify, ship } from './state.js';
import { arriveAt } from './travel.js';

export const world = { galaxy: null, cultures: null, scene: null, knowledge: null, travel: null, orbitT: 0 };

// The orbit clock (world/orbits.js): seconds, set from the real clock when a galaxy loads, then run
// on with flight and map travel, so things stand still while the ship is docked, landed or the map
// is open, and a ship launching or taking off finds its station or planet where it left it.
export function tickOrbits(dt) {
  world.orbitT += dt;
  world.scene.move(world.orbitT);
}

// The galaxy is generated from SYSTEM_CONFIG (world/system-config.js); a ?seed= URL parameter
// overrides its seed, and the map's Reroll asks for a new one. ?pirates brings the pirates back
// (they're switched off: world/galaxy.js), for the fights still in the game.
export function initialSeed() {
  const param = Params.get('seed');
  if (param === null || param === '') return SYSTEM_CONFIG.seed;
  return /^\d+$/.test(param) ? Number(param) : param;
}
const PIRATES = { pirates: { density: 0.5, lawlessAmbushes: [1, 2], nebulaAmbushes: true } };
const config = () => (Params.has('pirates') ? { ...SYSTEM_CONFIG, galaxy: { ...SYSTEM_CONFIG.galaxy, system: { ...SYSTEM_CONFIG.galaxy.system, ...PIRATES } } } : SYSTEM_CONFIG);
export const newGalaxy = (seed) => loadGalaxy(Galaxy.generate(seed, config()));

export function loadGalaxy(galaxy) {
  if (world.knowledge) world.knowledge.save(); // keep the old galaxy's charts before switching
  SystemMap.galaxy = galaxy;
  world.galaxy = galaxy;
  world.cultures = ArtCulture.forGalaxy(galaxy);
  world.scene = Scene.create(galaxy, world.cultures);
  world.orbitT = Clock.now() / 1000;
  world.scene.move(world.orbitT); // everything that goes round, where it is now
  // What the player knows (fog of war); ?fresh forgets saved charts.
  world.knowledge = Knowledge.create(galaxy, { fresh: Params.has('fresh') });
  world.android = ArtCulture.xeno(galaxy.seed).android; // what squad members are built in
  const way = galaxy.stations[galaxy.waystation];
  world.wayFace = way ? ArtCrew.create(way.seed, world.cultures.of(way.culture)) : null; // its android
  endTalk(false);
  loadCargo(galaxy);
  SystemMap.knowledge = world.knowledge;
  SystemMap.surveyed = (s) => (Survey.has(s) ? cargo.world.surveyed.includes(s.id) : null); // its find made (game/sites.js)
  // An ambush is passed by once its pirates are gone, or while the pirates count you Friendly
  // (rules/reputation.js passage).
  world.travel = Travel.create(galaxy, world.knowledge, { pingRange: () => SHIP.pingRange, cleared: (c) => ambushCleared(c) || Reputation.passage(cargo.rep) });
  SystemMap.trip = world.travel;
  Art.clearCache();
  ArtBodies.clearCache();
  showGates();
  placeBeside(startStation());
  SystemMap.setPlayer(ship.x, ship.y);
}
// Knowledge and cargo save on a short debounce; everything is written out when the page is hidden
// or closed (a fight's hull damage isn't saved until then or the fight's end).
// keep: false while a backup is being put back, so leaving the page doesn't write the old game over it.
let keep = true;
export function saveAll() {
  if (!keep) return;
  world.knowledge.save();
  saveCargoNow();
}

// A backup of everything saved (every galaxy's cargo and charts, and the settings) as a file to
// keep, and putting one back. The browser's own storage can be cleared (Safari does after a week
// without a visit), so this is the player's way to keep a game safe or move it to another device.
export const BACKUP_TAG = 'untitled-space-game';
export function exportSave() {
  saveAll();
  const text = JSON.stringify({ game: BACKUP_TAG, saved: new Date().toISOString(), data: Store.dump() });
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `space-game-save-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  notify('Save exported', 2.5, { tone: 'good' });
}
// Read a backup's text: its saved data, or null if it isn't one of this game's.
export function readBackup(text) {
  try {
    const d = JSON.parse(text);
    if (!d || d.game !== BACKUP_TAG || !d.data || typeof d.data !== 'object') return null;
    return Object.fromEntries(Object.entries(d.data).filter(([, v]) => typeof v === 'string'));
  } catch (e) {
    return null;
  }
}
export function importSave() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json,application/json';
  input.addEventListener('change', () => {
    const file = input.files && input.files[0];
    if (!file) return;
    file.text().then((text) => {
      const data = readBackup(text);
      if (!data) { notify('That file is not a saved game', 3, { tone: 'warn' }); return; }
      if (!window.confirm('Replace the game in this browser with the one in the file? The current game will be lost unless you exported it.')) return;
      keep = false;
      if (!Store.load(data)) { keep = true; notify('Could not write the save here', 3, { tone: 'warn' }); return; }
      location.reload();
    });
  });
  input.click();
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
  Settings.add({
    id: 'save', label: 'Saved game',
    actions: [
      { label: 'Export', run: exportSave, stay: true },
      { label: 'Import', run: importSave, stay: true },
    ],
    note: 'Your game is saved in this browser. Export a copy now and then, or add the game to your home screen, so clearing site data or a long break can\'t lose it.',
  });
  window.addEventListener('pagehide', saveAll);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') saveAll(); });
  SystemMap.onJump = (dest) => arriveAt(dest);
}
