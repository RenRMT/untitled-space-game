# Industry, research and upgrades

The plan for giving every trade good a purpose beyond selling. Goods become inputs to an
automatable production chain (raw → refined → parts → items). Research, in the same lab as the
logic packages, drives weapon, system and hull progression. This note is the design reference; the
code follows it phase by phase.

## Principles

- **Every good has a source and a sink.** Each trade good is used by at least one recipe and comes
  from mining, loot or a recipe. Tests check this.
- **A diamond, not a line.** A few shared intermediates feed many outputs (copper cable goes into
  electronics, capacitors, power cells and superconductors). No good is a dead end, and what to
  mine stays a real choice.
- **Each stage is its own machine.** Refineries, fabricators and assemblers are bays leased at
  stations. Each kind runs faster at the station type it suits, so where you make something
  matters and hauling between stations has a purpose.
- **Automation is the reward.** Jobs run for a count or "while inputs last", at seconds per item,
  on the real clock and through time offline, just like research. Bays at one station share a
  warehouse, so a refinery can feed a fabricator overnight.
- **No upkeep.** A lease is paid once. An offline game shouldn't punish you for being away.
- **Research feeds on industry.** Research costs crafted parts, and in return it unlocks recipes.
  Mostly it unlocks things (blueprints, alternative recipes, bays). Its stat gains are small and
  capped (+4% a step), so the gear's Mk stays the main power curve.
- **Mods are sidegrades.** Fixed effects with a tradeoff (extended barrel: +15% range, −10% fire
  rate), chosen by the player and swapped freely while docked. There are no random rolls.
- **Combat stays in the loop.** Pirate salvage can be recycled into refined goods. Mk IV–V gear
  needs Complex and Exotic components, so dangerous space still gates the top tier. A pirate
  schematic grants a blueprint.

## Stages

| Stage | Made at (base time per item) | Goods |
|---|---|---|
| raw | mined, gas, salvage | iron, titanium, platinum, corundum, diamond, deuterium, helium-3; later copper ore, silicates, carbon, water ice |
| refined | refinery (20 s) | steel pipe, copper cable, carbon fibre, hydrazine |
| advanced | refinery | graphene, aerogel, superconductor, optical fibre, metamaterial |
| part | fabricator (30 s) | electronics, robotics, AI cores, plasma conduit, nanite suspension; later focusing lens, capacitor, power cell, actuator, hull plating, sensor array, thruster nozzle, cooling loop |
| item | assembler (2 m to 2 h by Mk) | gear Mk I–V, mods; later consumables and refit kits |

Station specialties (×1.25 speed): mining camps and salvage yards run refineries, waystations and
major stations run fabricators, and capitals run assemblers. A crafted good is worth 1.15–4× its
inputs.

## Research

The research groups are Logic (the squad's packages), Weapons, Systems, Hull and Industry. They
share one lab queue, so every hour of lab time is a choice between them. Package kinds:

- **logic:** code libraries for squad programs (`notes/squad-logic.md`).
- **hull:** the hull refits (`hull.armour-2`), from `rules/hullmods.js`.
- **blueprint** (planned): unlocks the assembler recipe for one line at one Mk (`bp.pulse-laser-3`).
- **refine** (planned): +4% to one stat of a line, three steps per line.
- **industry** (planned): faster bays, more bays and storage, alternative recipes, a longer lab
  queue.

`Research.upgrades(done)` sums what's done for `Loadout.stats` (hull refits, and per-line stat
fractions through `Loadout.tuned`, kept within `Loadout.LIMITS`). `lab.doneAt` records when each
package finished. `Research.bonusAt(lab, t, key)` counts an industry bonus only from that time, so
work settled after a long time offline speeds up exactly when the bonus finished.

## Phases

0. Groundwork: goods carry a `stage`; research has kinds, `doneAt`, `upgrades` and `bonusAt`; gear
   is tuned by line. *(done)*
1. Hull refits move into the Hull research group (save migration 7). *(done)*
1b. The Research tab redrawn like the Ship tab: a lab bench, groups, a tech tree schematic, a sheet
    per node, and what research adds (`ui/research-view.js`, `Research.layout`). *(done)*
2. New goods and recipes (`rules/recipes.js`); mining yields name goods; markets stock by stage.
3. Facilities: leased bays, station warehouses, offline settlement in event order
   (`rules/industry.js`), and the Industry tab.
4. The assembler and blueprints. Gear is no longer sold, and schematics become blueprints.
5. Refinements and industry research.
6. Mods.
7. Later: consumables through `use()`, squad refit kits, logistics between warehouses.
