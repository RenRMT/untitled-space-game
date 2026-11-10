// The game's entry point (index.html loads it). The flight view lives in src/game/, one module per
// part; they import each other freely, so none of them does anything as it loads beyond declaring
// its names. Here, once all have loaded, each wires itself up (event listeners, settings, actions,
// panel hooks) in turn, then the first galaxy is generated and the frame loop starts.
//
// Layers, each importing only from those below it:
//   main.js       this file
//   game/         the flight view: state, input, missions and jobs, combat, squad, HUD, the frame loop
//   ui/           the DOM panels and the map
//   story/        the mission log and the galaxy's jobs
//   combat/       combat rules: the timeline, and the real-time engine under it
//   flight/       things in space: entities, the scene, flying, map travel
//   art/          procedural art in two styles (Line, Low-poly)
//   rules/        items, markets, ships, loot, classes and skills, levels, the squad, fog of war
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
import { Loot } from './rules/loot.js';
import { Structures } from './rules/structures.js';
import { Logic } from './rules/logic.js';
import { Mining } from './rules/mining.js';
import { Reputation } from './rules/reputation.js';
import { Clock } from './core/clock.js';
import { Progress } from './rules/progress.js';
import { Squad } from './rules/squad.js';
import { Vendor } from './rules/vendor.js';
import { Survey } from './rules/survey.js';
import { Jobs } from './story/jobs.js';
import { Missions } from './story/missions.js';
import { Scene } from './flight/scene.js';
import { Travel } from './flight/travel.js';
import { CombatPanel } from './ui/combat-panel.js';
import { Comms } from './ui/comms.js';
import { ContextCard } from './ui/context.js';
import { SystemMap } from './ui/map.js';
import { FactionsMenu } from './ui/factions.js';
import { Settings } from './ui/settings.js';
import { StationMenu } from './ui/station.js';
import { Factions } from './world/factions.js';
import { Galaxy } from './world/galaxy.js';
import { Security } from './world/security.js';
import * as state from './game/state.js';
import * as options from './game/options.js';
import * as world from './game/world.js';
import * as cargo from './game/cargo.js';
import * as outfitting from './game/outfitting.js';
import * as vendor from './game/vendor.js';
import * as progress from './game/progress.js';
import * as traffic from './game/traffic.js';
import * as missions from './game/missions.js';
import * as jobs from './game/jobs.js';
import * as docking from './game/docking.js';
import * as squad from './game/squad.js';
import * as mining from './game/mining.js';
import * as travel from './game/travel.js';
import * as selection from './game/selection.js';
import * as combat from './game/combat.js';
import * as field from './game/field.js';
import * as collisions from './game/collisions.js';
import * as input from './game/input.js';
import * as update from './game/update.js';
import * as starfield from './game/starfield.js';
import * as drawWorld from './game/draw-world.js';
import * as hud from './game/hud.js';
import * as loop from './game/loop.js';
import * as warp from './game/warp.js';
import * as landing from './game/landing.js';
import * as surfaceRun from './game/surface-run.js';
import * as dungeon from './game/dungeon.js';
import * as structures from './game/structures.js';
import * as surfaceSquad from './game/surface-squad.js';
import * as upgrades from './game/upgrades.js';
import * as rewards from './game/rewards.js';
import * as sites from './game/sites.js';
import * as quickfit from './game/quickfit.js';

const parts = [state, options, world, cargo, outfitting, vendor, progress, traffic, missions, jobs, docking, squad, mining, travel,
  selection, combat, collisions, field, input, update, starfield, drawWorld, hud, loop, warp, landing, surfaceRun, dungeon, structures, surfaceSquad, upgrades, rewards, quickfit, sites];
for (const part of parts) if (part.init) part.init();
world.newGalaxy(world.initialSeed());
requestAnimationFrame(loop.frame);

// For the tests (tests/smoke.js, tests/perf.js), which play the game and check it from outside:
// every name the flight view's modules export, read live, and the modules the tests use.
export const G = {
  Abilities, Art, ArtBodies, Clock, Combat, CombatPanel, Comms, ContextCard, Economy, FactionsMenu, Factions, Galaxy, Goods, Jobs, Knowledge, Loadout, Loot, Structures,
  Logic, Mining, Missions, Reputation, Scene, Security, Settings, Squad, StationMenu, SystemMap, Travel, Vendor, Progress, Survey,
};
for (const part of parts) {
  for (const name of Object.keys(part)) {
    if (name !== 'init') Object.defineProperty(G, name, { get: () => part[name], enumerable: true });
  }
}
