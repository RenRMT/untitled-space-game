# Untitled Space Game

A browser space RPG: fly a ship through a procedurally generated galaxy, mine, fight, take loot from
what you destroy, and push out from the safe core of your faction's space into harder systems.

- **Factions.** Three human factions hold the settled band of the galaxy, each its own contiguous
  territory: Wedge (where the game starts), Block and Shard. Inside a territory every system is joined
  by jump gates; between territories there is one gate link per pair. Outside them, in the frontier,
  are the Drifters and the Androids, reached by cruising; the aliens hold the most remote systems, by
  the galactic core, the end game. Each system has a level (1 in Wedge space, 2 in Block and Shard, 3–4
  outside, 5 the aliens'), shown on the map.
- **Fighting and loot.** Hostile ships (Drifter raiders, or the aliens in their space) wait in packs
  in low and lawless security, never in high; their gear follows the system's level. Destroyed ones
  leave loot to pick up: components, goods and now and then a gambit. Fights are turn-based on a
  timeline (`src/combat/combat.js`, `notes/combat-research.md`): every ship flies on and acts when
  its gauge fills; enemies show what they're charging and at whom, and taking a ship's shields down
  knocks it back and cancels a heavy shot. It's all drawn round the ships, with only a skill bar
  below; tap a ship to target it. It's the one combat mode (real time can still be tried with
  `?combat=realtime`, for comparison).
  Fights play the same in space and on a surface, and the ship flies there as fast as in space.
- **Classes and skills.** The ship, and each squad member, is a Tank, DPS or Healer
  (`src/rules/classes.js`), picked at a dock. Each class has three skills (`src/rules/abilities.js`),
  each with an activation time and a cooldown: keys 1–3 or the skill bar's buttons in a fight.
- **The squad.** Wingmen are hired at a dock (Ship tab), up to three, each with a class. They fight by
  their programs (instruction cards, `src/rules/logic.js`), which can use their class's skills; each
  class starts with a program that does. A program is built from **gambits**, FF12 style: the
  building blocks (conditions such as "is charging a heavy shot" or "has Taunt", picks, actions,
  more memory), bought at any station's outfitter (better ones further out) or found on pirates
  and Wardens (`src/rules/vendor.js`, `src/game/vendor.js`).
- **The outfitter.** Every station's Outfitter tab sells gambits up to its system's level, a stock of
  gear rolled like loot (Common and Uncommon, Rare at a capital) that turns over every day,
  consumables, and at capitals and major stations mods. Hulls are at a capital's shipyard.
- **Dungeons.** Landing on any planet or moon puts the ship in a labyrinth cut into its own ground
  (canyons on a desert world, ice caves, lava tubes, a storm maze on a gas giant, crater mazes on moons)
  (`src/game/dungeon.js`): turrets that never move and raiders that patrol and chase hold the
  chambers, a Warden (a heavy ship) the deepest, harder the higher the system's level, with loot,
  gear, a bounty and a gambit for the Warden. The squad lands with the ship, follows its trail through the
  caverns and fights beside it (`src/game/surface-squad.js`); walls stop every ship in a fight.
- **Stations and turrets.** Every station holds 0–3 turrets in orbit round it, more in high
  security and in harder systems (`src/rules/structures.js`). Every man-made thing can be attacked
  and destroyed: turrets are tougher than ships, stations tougher still (`src/game/structures.js`).
  A station and its turrets fight as one. Attacking a faction's station warns first, then costs
  regard with it and keeps that station hostile for the session; a faction that counts you Hostile
  has its turrets open fire on sight. Destroyed, a faction's turret or station is a wreck until it's
  rebuilt (20 min, 90 min real time; no docking meanwhile). Friendly turrets fight on your side
  against hostiles near their station.
- **Missions.** Every station posts combat contracts (`src/story/job-texts.js`, run by
  `src/game/jobs.js`): a raider patrol (Easy), a turret battery (Normal), holding the station against
  waves with its turrets beside you (Normal or Hard), a pirate outpost with its turrets in this
  system or a nearby one (Hard), and a strike on a fortified outpost a jump away (Elite). The
  difficulty sets the hostiles' tier, the pay and the gear rewarded.
- **Loot.** Gear drops MMO style (`src/rules/loot.js`): seven bases (laser, missile launcher, plasma
  cannon, shield generator, scanner, engine, ship computer; art in `src/art/equipment.js`), an item
  level from the level of what dropped it, five rarities (Common to Legendary) with more affixes and
  stronger stats the rarer, drop tables per source (fighters, turrets, stations, outposts, dungeon
  guardians, the Warden, missions) with rarity floors, bad-luck protection (Rare at least after a
  long dry run) and drops biased toward your class. Loot floats in its rarity's colour where it
  dropped, goes into the spare gear (it takes no hold room) and fits like any gear.
- **No hazards.** Heat, radiation, flares, ion storms, surface hazards, fuel and the dash were taken
  out of the main game (`notes/archived-systems.md` says where they are; `rules/hazards.js` stays for
  the race and for each surface's deposits). `notes/hazards.md` was their plan.

Mining is an action you start: select a rock (or, on a surface, a deposit) and press Mine (or
Siphon, or E) on its menu; a ring round it fills as the tools work, and it breaks up when it's done
(`src/game/mining.js`). The tools never pick a rock on their own, nor go on to the next, and a big
asteroid's shards are each mined the same way. Fly off and the work stops. Drops (in space and on a
surface) are drawn large as their menu icons; a tap selects one, and dragging it onto the ship is
the only way to pick it up: nothing is pulled in or picked up by flying near it. The drag joypad
shows under the finger in space and on a surface alike, and the map, settings, factions and
context menu stay up in a fight. Jump gates are named for where they lead. A dungeon's way out is
its landing pad: fly off it and back onto it to take off.
Explanations in the menus wait behind an ⓘ. There is no production or research in the main game
any more (the idle game has them, on the same rules: `notes/archived-systems.md`).
Plain JavaScript (ES modules) on a 2D canvas, with no build step and no runtime dependencies.

The galaxy is a barred spiral grown from the seed: about forty star systems along its bar and arms
(settled ones in the habitable band, split between the three territories; sparse frontier ones in the
core and out at the rim, the Drifters', the Androids' and the aliens'), far enough apart that crossing
between them is a trip, the territories' jump gates as shortcuts, and between
the systems the places a galaxy holds: the supermassive black hole at the centre, star clusters,
H II regions and dark clouds, supernova remnants with their pulsars, black holes, white dwarfs,
brown dwarfs, rogue planets, interstellar objects passing through, and fields of dust, gas and
cosmic rays. The game starts in the showcase system (one of each planet, moon and station type, a
nebula and an asteroid field) on an outer arm. `notes/galaxy.md` is how it is grown. The deep-space
sites are on the galaxy map for now; flying to them finds nothing yet.

The game is otherwise pared back to its core mechanics for now: one trade good per category and one
component per salvage type, six factions (one per culture, all neutral but the hostile aliens), only
combat contracts on the jobs board. The old introduction and opening missions are gone. `notes/archived-systems.md` says what was taken
out and how to bring it back.

## Running it

The game is ES modules, so it has to be served over http; opening `index.html` as a file won't work.

```sh
npm start                    # serves the folder at http://localhost:8000 (npx serve)
python3 -m http.server 8000  # or any static file server
```

URL parameters:

| Parameter | What it does |
| --- | --- |
| `?seed=123` | another galaxy (Settings → Re-roll picks one at random) |
| `?fresh` | forget this galaxy's saved cargo and charts |
| `?pirates` | pirates in the showcase-alone galaxy too, for the tests (the spiral galaxy has its hostiles anyway) |
| `?combat=realtime` | fights in real time instead of on the timeline, for comparison (not saved) |
| `?dev` | every system and contact on the map, the testing buttons, the performance overlay, god mode (your ship and your squad's take no damage), and everything unlocked even in a fresh game: every station service open and the jobs board up (the save isn't changed) |
| `?perf` | the performance overlay only (P toggles it) |
| `?style=lowpoly`, `?move=direct` | a setting for this visit |

The race is a second page beside the game: `/race/` (`race/index.html`), a lap race on a generated
surface in the game's own ship. It opens on a title (`src/race/menu.js`, in the Low-poly UI kit): a
planet chosen from cards scrolled sideways, then a level (regular, advanced, expert) as dots on it; in
the race one Menu button pauses it, to restart or go back to the title. Its parameters are listed at
the top of `src/race/main.js`; `notes/race.md` is the plan.

The race installs as its own app, Exo Drift (`race/manifest.webmanifest`, its icons
`assets/race-icon*`), and plays offline once opened: `race/sw.js` keeps a copy of every file the
race loads, fetched from the network first while there is one. Its file list is written by
`npm run race:sw` (`tools/app-sw.js`, following the page's links and imports); run it after adding
or removing a file the race loads, as `npm test` fails while the list is out of date. Installing
needs HTTPS (or localhost).

The idle game is a third page, `/idle/` (`idle/index.html`, code in `src/idle/`): an idle station
builder, Cold Start, on the game's production, haulers and restoration rules, run on
the real clock while the page is closed. The system starts with nothing built (its planets and moons rolled from
the save's seed): bodies are charted by survey and stations built in orbit round them, on a star-centred map in the Line style, with the
game's UI kit for its screens. Production chains run across the stations, with routes from the
transport hub and a chain view that says what to mend, and a lab researches the game's blueprints,
mods and industry. The waystation takes daily contracts and, once researched, auto-sells; the
salvage yard picks components out of a wreck field. Once every station is built, the player can
leave for a new system, carrying legacy points (from the credits earned) that make the next one
faster and better paid. It installs as its own app, Cold Start
(`idle/manifest.webmanifest`, icons `assets/idle-icon*`), and plays offline once opened (`idle/sw.js`,
its list written by `npm run idle:sw`). `npm run idle:sim` plays 30 days with a scripted player and
says when each station is built, when the first gear of each Mk comes out and what leaving would earn (`tools/idle-sim.js`; `-- --legacy=N` starts with N points). `?fresh` starts a new save, `?seed=` picks its system (a random one otherwise) and `?fastresearch` runs
the lab 60 times faster;
`notes/idle.md` is the plan.

The 4X game is a fourth page, `/4x/` (`4x/index.html`, code in `src/4x/`): the main game's galaxy at
the main game's scale, played as a map instead of a ship. One camera zooms without a break from the
flight view out to the star system and the galaxy (Flight / System / Galaxy in the header, or 1 / 2 / 3;
the wheel or a pinch). The player no longer flies a ship: they pick a unit and order it somewhere,
and it flies there: round a station, planet or moon it parks in orbit, at a point in space it holds.
How orders are given is one of four prototypes to compare (`?move=button | tap | drag | path`, or the
header's Move button; `notes/4x-movement-research.md`), and `?testbed` gives the whole start system
with three ships. The header's Build button switches to building an Outpost or a Starbase round a
planet or moon, or dismantling a station, in one of three prototypes to compare (`?build=menu | ghost |
drag`; `notes/4x-building-research.md`). Orbits follow the 4X rules (`src/4x/orbits.js`: planets round the star, moons round planets,
at most one station round a planet or moon, idle ships round a station, planet or moon, asteroids in
belts, wrecks in graveyards at Lagrange points). For now the start system is a star, one planet, a
station round it and a ship, with no hazards. `?seed=` picks the galaxy. `notes/4x.md` is the plan.

## Code layout

`index.html` loads `src/main.js`. Each layer imports only from the layers below it:

| Folder | What it holds |
| --- | --- |
| `src/main.js` | the entry point: wires up the flight view, generates the galaxy, starts the frame loop |
| `src/game/` | the flight view, one module per part: shared state, input, docking, mining, the squad, combat (mining sessions run on it too), collisions, consumables used from the HUD (`field.js`), missions, landing on planets and moons (`landing.js`) and what there is to do down there (`surface-run.js`: deposits and what lies about; `dungeon.js`: the labyrinth, its guardians and Warden), HUD, the frame loop |
| `src/race/` | the race (`race/index.html`), beside `src/game/`: the track (`track.js`), sliding along walls (`contact.js`), the controls, the run and its drawing, the menus (`menu.js`, `menu.css`: the UI kit's classes, linked as CSS); it imports `src/core`, `src/art`, `src/flight` and `src/rules`, never `src/game` or `src/ui` (ESLint checks) |
| `src/4x/` | the 4X game (`4x/index.html`): the orbit rules (`orbits.js`), the world and its units' orders (`world.js`), the map zoomed from flight to system to galaxy (`view.js`), the ways of giving move orders and of building (`movement.js`, `building.js`, prototypes to compare), the page (`main.js`, `4x.css`); it imports `src/core`, `src/art`, `src/world` and `src/rules`, never `src/game`, `src/flight` or `src/ui` beyond the UI kit (ESLint checks) |
| `src/ui/` | the DOM panels (station menu, context menu, combat panel, the field bar of consumables, comms, settings, factions), the event log (`messages.js`) and the map, built from the UI kit (`kit.js`, `kit.css`), restyled for each art style (`kit-line.css`, `kit-lowpoly.css`) |
| `src/story/` | the mission log (`missions.js`) and the jobs' machinery (`jobs.js`; the texts it places, `job-texts.js`, are empty for now) |
| `src/combat/` | combat rules: real time (`combat-realtime.js`, which mining uses against passive targets) and round-based (`combat.js`, parked with the pirates), on a shared core |
| `src/flight/` | things in space: entity kinds, the scene, flying, interactions, map travel |
| `src/art/` | procedural art in two styles (line, low-poly), crew portraits for every culture (`crew.js`), planet and moon surfaces to land on (`surface.js`: a landing site ringed by cliffs or sea; `surface-globe.js` draws them in chunks built as the ship flies (and, in the prototype, bent over a globe); `tools/surface.html` is the prototype it started from) and the sprite caches |
| `src/rules/` | items, markets, mining (asteroids, gas pockets and surface deposits), hazards in space and on surfaces (`hazards.js`), ships and equipment, research, the squad and its AI logic, how the factions regard the player, fog of war |
| `src/world/` | the factions, galaxy and solar system generation, security levels |
| `src/core/` | maths, seeded randomness, saved data (and its backup), the screen's pixel ratio, colours and text size, number formats, game events felt as vibration (`feedback.js`) |
| `assets/` | the fonts (OFL, served with the game) and the app icons, the game's and the race's (`race-icon*`); `manifest.webmanifest` makes the game installable, `race/manifest.webmanifest` the race |

Modules under `src/game/` import each other freely. None of them does anything as it loads beyond
declaring its names: each part's wiring (event listeners, settings, actions, panel hooks) is in its
`init()`, which `main.js` calls once every module has loaded.

Each file starts with a comment saying what it does and, for modules other parts use, its API.

## Adding things

- **A mission:** its data and lines go in `src/story/missions.js`. In `src/game/missions.js` it needs
  its things in space (the `build*` functions), the progress rules its tick passes to `progress()`
  (a place reached, things gone from the world), and anything else it does (a comms call, an escort).
- **A kind of thing in space:** an entry in `KINDS` in `src/flight/entities.js` (drawing, picking, label,
  minimap mark, context menu) and its art; if it does something, an action added in its part of
  `src/game/` (see `Interactions` in `src/flight/interactions.js`).
- **A planet or moon to land on:** every planet and moon type has a surface (`LANDABLE` in
  `src/game/landing.js`): planets the one `SURFACE_OF` in `src/art/surface.js` names, moons `moon-` and
  their type (one per `ArtBodies.MOONS` type), so a new type needs one of those; and what its surface
  does to a ship and holds (`Hazards.surface` in `src/rules/hazards.js`).
- **A combat mode:** a module with the shape `src/combat/combat-core.js` describes, added to `COMBAT`
  in `src/game/options.js`.
- **A panel or a screen:** build it from the UI kit's components (`Kit` in `src/ui/kit.js`: buttons,
  meters, rows that expand, bottom sheets, the tab bar, folding sections) and its tokens (`src/ui/kit.css`:
  colours, the two fonts, radii, the 44 px touch target). The menus follow the art style: each has
  its own kit over the base one (`src/ui/kit-line.css`, `src/ui/kit-lowpoly.css`, on `html[data-ui]`),
  which redraws the same components; a new component needs its look in both. Line: hairlines in the
  culture's ink, hatched shadows, B612 and B612 Mono. Low-poly: plates with lips, bays and glass
  readouts in the culture's materials, Chakra Petch and Martian Mono. A docked station's screen takes
  its culture's look. Icons are line icons by their short code (`src/ui/glyphs.js`: a 24 px grid, 1.6 px
  strokes in the text colour, like the map and settings buttons); a code without one shows as a dashed
  placeholder until it gets one.
- **A notice:** `notify(text, seconds, { tone, once })` (`src/game/state.js`) adds a line to the event log
  (`src/ui/messages.js`), which the HUD draws in the top-left corner: the last 5, each for 10 s. Station
  buttons don't announce what they did: the screen shows it.
- **Something the player should feel:** `Feedback.emit(event)` (`src/core/feedback.js`) where it
  happens; `src/game/options.js` turns events into vibration (switched off in Settings), and sound
  can listen to the same events later.
- **Text on a station screen that explains it:** `explain(key, text)` in `src/ui/station.js`: shown on
  the first three visits, then behind the tab's ⓘ.
- **A change to what is saved:** a step at the end of `CARGO_MIGRATIONS` in `src/game/cargo.js`, so
  older saves are brought up to date (`Save.migrate`, `src/core/save.js`).

## Tests and tools

```sh
npm test       # tests/run.js: generators, rules and combat; tests/smoke.js: plays the whole game in Node
npm run lint   # ESLint (eslint.config.js)
npm run perf   # tests/perf.js: frame cost in Chromium as a phone would run it (needs Playwright)
npm run galaxy -- 7   # tools/galaxy.js: what a seed gives: its systems, gates and deep-space sites (--svg file draws it)
```

The tests need no dependencies beyond Node 22. `tests/smoke.js` runs the game in a stand-in
browser (`tests/browser-stub.js`) and checks it through `G`, the game's state and functions by name,
which `src/main.js` exports for the tests. CI (`.github/workflows/ci.yml`) runs the lint and the tests.

Design notes live in `notes/`: `roadmap.md` is where the main game is heading (an offline MMO-like
space RPG) and what was cut on the way; `hazards.md` was the plan for gathering under hazards (taken
out); `archived-systems.md` lists systems taken out of the game and how to bring each back (the
latest: the hazards); `combat-alternatives.md` records the combat designs considered; `squad-logic.md`
records how squad programs and logic research work, and the plan for abilities; `industry.md` is the
plan for crafting, production orders and ship research, phase by phase; `factions.md` is the faction
overview (the factions, their standings and the story beats); `galaxy.md` is how the galaxy is
grown (its shape, systems, gates and deep space) and how the factions were placed in it; `race.md` is the plan for the race (`/race/`), phase by phase; `4x.md` is the plan for the 4X game (`/4x/`).
