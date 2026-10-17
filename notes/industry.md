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
- **Each stage has its own stations.** Refining, fabricating and assembling are done by
  production orders at stations, and each station type does one stage. Where you make something
  matters: you visit the right kind of station to place each step of a chain.
- **Automation is the reward.** Orders run for a count or continuously, at seconds per item, on
  the real clock and through time offline, just like research. Every order reads from and writes
  to one shared storage, so a refinery order at a camp feeds a fabricator order at a port
  overnight, with no hauling.
- **No upkeep.** Orders cost no credits; a station takes them once it trusts you. An offline game
  shouldn't punish you for being away.
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
| raw | mined, gas, salvage | iron, copper ore, titanium, platinum, silicates, carbon, corundum, diamond, water ice, deuterium, helium-3 |
| refined | refinery (20 s) | steel pipe, copper cable, carbon fibre, hydrazine |
| advanced | refinery (25–60 s) | graphene, aerogel, superconductor, optical fibre, metamaterial |
| part | fabricator (30–90 s) | electronics, actuators, power cells, sensor arrays, thruster nozzles, capacitors, hull plating, focusing lenses, cooling loops, robotics, plasma conduit, nanite suspension, AI cores |
| item | assembler (2 m to 2 h by Mk) | gear Mk I–V (Mk I from refined goods, then parts; Mk IV–V also complex and exotic components); later mods, consumables and refit kits |

Salvaged components are recycled at a refinery: simple and standard ones into refined goods,
advanced ones into parts. Mining picks raw goods only: carbonaceous rock gives carbon, icy rock
water ice, and nebula gas pockets the rarer gases. Markets stock goods further along the chain
less often (except where they're made), and never the rarest parts, which have to be made.

Each station type works one stage: mining camps and salvage yards refine, minor stations and the
waystation fabricate, and capitals and major hubs (the shipyards) assemble. A crafted good is worth
1.15–4× its inputs.

## Storage and production orders

The player sets production up like a data pipeline, and the game's words map onto it:

| Data engineering | In the game |
|---|---|
| data lake | storage: one store for the whole game, reached from any station |
| job | a production order: one recipe running at one station |
| trigger | an order starts a run as soon as its inputs are in storage |
| backpressure | Blocked: no room in storage for what a run makes |
| lineage | where an order's inputs come from: storage, another order, or a stage still missing |
| pipeline | the chain of orders, linked by what one makes and the next uses |

**Storage.** Docked anywhere, you move goods between the hold (and the components store) and the
storage, and take out what orders make: goods into the hold, gear, mods and consumables into the
spare gear, spare mods and kit. Room: 200, plus storage racks research.

**Orders.** An order is placed at the station docked at, and only for what that station's stage
makes. Picking a product first shows its lineage: each input, and whether it's in storage, made by
another of your orders (and where), raw (mine, collect, salvage or buy it), or needs an order of
another stage (and which station types do it). A station takes one order (more with research).
An order runs for 1, 5, 20 or 100 runs, or continuously while inputs last. Its status is Running
(progress and time left), Starved (the missing input named), Blocked (storage full), Done or
Paused. Orders are set up or changed only at their station; pause, resume, cancel and priority
work from any station. Cancelling or changing an order returns the inputs of the run under way.

**Priority.** Orders share storage, so the order list decides who takes inputs first.

**Loyalty.** Orders cost no credits. A station takes orders when its loyalty to the player
(`cargo.loyalty[station key]`) is at least `Industry.LOYALTY.required` (1). Every station starts at
`LOYALTY.start` (0); missions raise it (notes/missions.md): every station posts at least one job of
its own, and the waystation's second opening mission opens its orders. Loyalty is a number so that
higher levels can unlock more later.

**The production pipeline** on the Production tab shows every order, linked by output → input, in
three columns (refinery, fabricator, assembler), each pipeline headed by its end product. A line is
dim when none of its good is in storage. An input that isn't raw and no order makes is a gap,
drawn as an amber stub with the stage that could make it. An order linked to nothing is listed as
standalone. On a phone the columns stack and the links become "feeds" lines.

**Exact offline time.** A run takes its inputs when it starts and keeps room for what it makes, so
finishing never fails. Orders start runs only when a run finishes or when something changes, in
priority order. That makes settling time order exact (`Industry.settle`): whether the game catches
up in one step on load or every second while docked, the result is the same. Each settle call stops
after a set number of runs and goes on in the next.

Saves from the leased-bay version (migration 12) merge every warehouse into the storage, refund
every lease, and keep each station's first job as its order where the station's stage fits.

## Research

The research groups are Logic (the squad's packages), Weapons, Systems, Hull and Industry. They
share one lab queue, so every hour of lab time is a choice between them. Package kinds:

- **logic:** code libraries for squad programs (`notes/squad-logic.md`).
- **hull:** the hull refits (`hull.armour-2`), from `rules/hullmods.js`.
- **blueprint:** unlocks the assembler recipe for one line at one Mk (`bp.pulse-laser-3`). Mk II
  needs only credits and components; from Mk III, parts made by industry too (capacitors, power
  cells, electronics, thruster nozzles); Mk V an exotic component. Each needs the Mk before it.
- **refine:** +4% to a line's stats (damage; shield strength and recharge; accuracy; top speed and
  acceleration; identify and ping range), three steps per line. Each step needs the one before and a
  blueprint (Mk II, then III, then IV). Drawn under the blueprints in the same row group.
- **industry** (the Production group): order speed (+15% a step, three steps), storage racks
  (+100 room), order slots per station (+1, two steps), alternative recipes (power cells straight from water ice, graphene
  without corundum) and a longer lab queue (+1).

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
2. New goods and recipes (`rules/recipes.js`); mining yields name goods; markets stock by stage. *(done)*
3. Facilities: leased bays, station warehouses, offline settlement in event order
   (`rules/industry.js`, `game/industry.js`), and the Industry tab (`ui/industry-view.js`). *(done)*
4. The assembler and blueprints. Gear is no longer sold, and schematics become blueprints
   (migration 9: gear owned and schematics recovered become blueprints done). *(done)*
5. Refinements and industry research. *(done)*
6. Mods (`rules/mods.js`): fourteen fixed trades across the five kinds of gear, researched per kind
   (`mods.<slot>`), assembled from parts, fitted from a slot's sheet on the Ship tab (room by Mk: I
   none, II–III one, IV–V two), kept with the slot when its gear is swapped (migration 10). *(done)*
7. Abilities (`rules/abilities.js`): consumables an assembler makes (repair nanites, shield cells,
   EMP charges, jammer pods), carried in the kit (migration 11) and spent a charge at a time in a
   fight, with a cooldown per ship. The player uses them from buttons on the combat panel; squad
   members by `use` lines (`tactics.use`, no longer hidden), which run only when there's a charge,
   it's off cooldown and it would help. EMP and jamming are timed statuses on fight time, so both
   combat modes see them. *(done)* Still open: squad refit kits.
8. Production orders (`rules/industry.js`, `ui/industry-view.js`): leased bays and per-station
   warehouses give way to one shared storage and production orders, a station type per stage, the
   lineage of a product and the production pipeline overview (migration 12). *(done)*
