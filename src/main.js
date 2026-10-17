// The game's entry point (index.html loads it). The flight view lives in src/game/, one module per
// part; they import each other freely, so none of them does anything as it loads beyond declaring
// its names. Here, once all have loaded, each wires itself up (event listeners, settings, actions,
// panel hooks) in turn, then the first galaxy is generated and the frame loop starts.
//
// Layers, each importing only from those below it:
//   main.js       this file
//   game/         the flight view: state, input, missions and jobs, combat, squad, HUD, the frame loop
//   ui/           the DOM panels and the map
//   story/        the introduction, the missions' data and the galaxy's jobs
//   combat/       combat rules: round-based and real time
//   flight/       things in space: entities, the scene, flying, map travel
//   art/          procedural art in four styles
//   rules/        items, markets, ships, refits, research, the squad, fog of war
//   world/        galaxy generation
//   core/         maths, randomness, saved data, display, colours

import { Art } from './art/render.js';
import { Abilities } from './rules/abilities.js';
import { ArtBodies } from './art/bodies.js';
import { Combat } from './combat/combat.js';
import { Economy } from './rules/economy.js';
import { Goods } from './rules/goods.js';
import { Knowledge } from './rules/knowledge.js';
import { Loadout } from './rules/loadout.js';
import { Logic } from './rules/logic.js';
import { Mining } from './rules/mining.js';
import { HullMods } from './rules/hullmods.js';
import { Industry } from './rules/industry.js';
import { Recipes } from './rules/recipes.js';
import { Research } from './rules/research.js';
import { Clock } from './core/clock.js';
import { Squad } from './rules/squad.js';
import { Jobs } from './story/jobs.js';
import { Missions } from './story/missions.js';
import { Scene } from './flight/scene.js';
import { Travel } from './flight/travel.js';
import { CombatPanel } from './ui/combat-panel.js';
import { Comms } from './ui/comms.js';
import { ContextCard } from './ui/context.js';
import { SystemMap } from './ui/map.js';
import { Settings } from './ui/settings.js';
import { StationMenu } from './ui/station.js';
import { Galaxy } from './world/galaxy.js';
import { Security } from './world/security.js';
import * as state from './game/state.js';
import * as options from './game/options.js';
import * as world from './game/world.js';
import * as cargo from './game/cargo.js';
import * as outfitting from './game/outfitting.js';
import * as lab from './game/lab.js';
import * as industry from './game/industry.js';
import * as intro from './game/intro.js';
import * as missions from './game/missions.js';
import * as jobs from './game/jobs.js';
import * as docking from './game/docking.js';
import * as squad from './game/squad.js';
import * as mining from './game/mining.js';
import * as travel from './game/travel.js';
import * as selection from './game/selection.js';
import * as combat from './game/combat.js';
import * as input from './game/input.js';
import * as update from './game/update.js';
import * as starfield from './game/starfield.js';
import * as drawWorld from './game/draw-world.js';
import * as hud from './game/hud.js';
import * as loop from './game/loop.js';
import * as warp from './game/warp.js';

const parts = [state, options, world, cargo, outfitting, lab, industry, intro, missions, jobs, docking, squad, mining, travel,
  selection, combat, input, update, starfield, drawWorld, hud, loop, warp];
for (const part of parts) if (part.init) part.init();
world.newGalaxy(world.initialSeed());
requestAnimationFrame(loop.frame);

// For the tests (tests/smoke.js, tests/perf.js), which play the game and check it from outside:
// every name the flight view's modules export, read live, and the modules the tests use.
export const G = {
  Abilities, Art, ArtBodies, Clock, Combat, CombatPanel, Comms, ContextCard, Economy, Galaxy, Goods, HullMods, Industry, Jobs, Knowledge, Loadout,
  Logic, Mining, Missions, Recipes, Research, Scene, Security, Settings, Squad, StationMenu, SystemMap, Travel,
};
for (const part of parts) {
  for (const name of Object.keys(part)) {
    if (name !== 'init') Object.defineProperty(G, name, { get: () => part[name], enumerable: true });
  }
}
