# Untitled Space Game

A browser space RPG, played on a phone held upright: fly a ship through a procedurally generated
galaxy, take contracts, fight on a timeline with a squad that follows programs you write, take loot
from what you destroy, level up, and push out from the safe core of your faction's space to the
aliens at the galactic core. Plain JavaScript (ES modules) on a 2D canvas, with no build step and
no runtime dependencies. It installs as an app and plays offline.

`notes/game.md` describes every system of the main game: factions, fights, classes and skills,
the squad and its gambits, loot, dungeons, contracts, the story and what follows it.
`notes/review.md` is the review behind its current shape, and `notes/roadmap.md` where it is
heading. Four smaller games share its code and live beside it: the race (`/race/`), the idle
game (`/idle/`), the 4X game (`/4x/`) and Redshift (`/sim/`).

## Running it

The game is ES modules, so it has to be served over http; opening `index.html` as a file won't work.

```sh
npm start                    # serves the folder at http://localhost:8000 (npx serve)
python3 -m http.server 8000  # or any static file server
```

URL parameters:

| Parameter | What it does |
| --- | --- |
| `?seed=123` | another galaxy (Settings → Games → New game picks one at random; the one last played opens when there is no parameter) |
| `?fresh` | forget this galaxy's saved cargo and charts |
| `?pirates` | pirates in the showcase-alone galaxy too, for the tests (the spiral galaxy has its hostiles anyway) |
| `?dev` | every system and contact on the map, the testing buttons, the performance overlay, god mode (your ship and your squad's take no damage), and everything unlocked even in a fresh game: every station service open and the jobs board up (the save isn't changed) |
| `?perf` | the performance overlay only (P toggles it) |
| `?style=lowpoly`, `?move=direct`, `?sound=off` | a setting for this visit |

The game installs as an app (`manifest.webmanifest`) and plays offline once opened: `sw.js` keeps a
copy of every file it loads, its list written by `npm run sw` (`tools/app-sw.js`); run that after
adding or removing a file the game loads, as `npm test` fails while the list is out of date.

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

Redshift, the sim, is a fifth page, `/sim/` (`sim/index.html`, code in `src/sim/`, `notes/sim.md` the
plan): a portrait sim/strategy game in which a black hole is swallowing the galaxy and the player stays
a system ahead of it. Each star system (a condensed take on the idle game's map) has bodies with
minerals and volatiles to build stations round (mining rigs, gas siphons, trade hubs, research labs,
defense platforms, each with ships and Mk upgrades), cultures to keep content (the Wedge want
security, the Block credits, the Shard science; the Drifters revolt where security is short, the
aliens come with gifts and curses), and a jump gate to build at its edge. The horizon meter fills
cycle by cycle, slowing time past half and stopping everything at 100%; the gate overcharges faster
the nearer it gets, so when to jump is the choice. Each jump offers three systems (near, mid, far;
their resources and hazards differ), leaves everything built behind, and banks Insight for the
Archive's permanent upgrades; systems left behind stay on the Chart, frozen. Story mode brings in a
culture a system (Androids, Wedge, Block, Shard, Drifters, aliens, then the last jump); endless has
them all at once. Requests come from the cultures' people as portrait bubbles over the map, and it
shows every kind of the repo's procedural art. `npm run sim:play` plays runs with a scripted player
(`tools/sim-play.js`, `--mode=story`, `--systems=`, `--runs=`); `?fresh` forgets the run in progress,
`?seed=` picks a new run's seed and `?style=line|lowpoly` the art style. It installs as its own app
(`sim/manifest.webmanifest`, icons `assets/sim-icon*`) and plays offline (`sim/sw.js`, its list
written by `npm run sim:sw`).

## Code layout

`index.html` loads `src/main.js`. Each layer imports only from the layers below it:

| Folder | What it holds |
| --- | --- |
| `src/main.js` | the entry point: wires up the flight view, generates the galaxy, starts the frame loop |
| `src/game/` | the flight view, one module per part: shared state, input, docking, mining, the squad, combat (mining sessions run on it too), collisions, consumables used from the HUD (`field.js`), missions, landing on planets and moons (`landing.js`) and what there is to do down there (`surface-run.js`: deposits and what lies about; `dungeon.js`: the labyrinth, its guardians and Warden), HUD, the frame loop |
| `src/race/` | the race (`race/index.html`), beside `src/game/`: the track (`track.js`), sliding along walls (`contact.js`), the controls, the run and its drawing, the menus (`menu.js`, `menu.css`: the UI kit's classes, linked as CSS); it imports `src/core`, `src/art`, `src/flight` and `src/rules`, never `src/game` or `src/ui` (ESLint checks) |
| `src/sim/` | Redshift (`sim/index.html`, `notes/sim.md`): its tables (`config.js`), a system from a seed (`world.js`), the rules cycle by cycle (`rules.js`), requests, Drifters, aliens and hazards (`events.js`), the story (`story.js`), people (`people.js`), the map and the hole's effects (`map.js`), sheets and full screens (`sheets.js`, `screens.js`), portraits and thumbnails (`faces.js`), the page (`main.js`, `sim.css`); it imports `src/core`, `src/art`, `src/world` and the UI kit, never `src/game`, `src/flight` or `src/ui` beyond the kit (ESLint checks) |
| `src/4x/` | the 4X game (`4x/index.html`): the orbit rules (`orbits.js`), the world and its units' orders (`world.js`), the map zoomed from flight to system to galaxy (`view.js`), the ways of giving move orders and of building (`movement.js`, `building.js`, prototypes to compare), the page (`main.js`, `4x.css`); it imports `src/core`, `src/art`, `src/world` and `src/rules`, never `src/game`, `src/flight` or `src/ui` beyond the UI kit (ESLint checks) |
| `src/ui/` | the DOM panels (station menu, context menu, combat panel, the field bar of consumables, comms, settings, factions), the event log (`messages.js`) and the map, built from the UI kit (`kit.js`, `kit.css`), restyled for each art style (`kit-line.css`, `kit-lowpoly.css`) |
| `src/story/` | the mission log (`missions.js`), the jobs' machinery (`jobs.js`) and the texts it places: contracts, the story's chapters and the job after it (`job-texts.js`) |
| `src/combat/` | combat rules: the timeline fights (`combat.js`) and the real-time engine under them (`combat-realtime.js`, which mining uses against passive targets), on a shared core |
| `src/flight/` | things in space: entity kinds, the scene, flying, interactions, map travel |
| `src/art/` | procedural art in two styles (line, low-poly), crew portraits for every culture (`crew.js`), planet and moon surfaces to land on (`surface.js`: a landing site ringed by cliffs or sea; `surface-globe.js` draws them in chunks built as the ship flies (and, in the prototype, bent over a globe); `tools/surface.html` is the prototype it started from) and the sprite caches |
| `src/rules/` | items, markets, mining (asteroids, gas pockets and surface deposits), hazards in space and on surfaces (`hazards.js`), ships and equipment, research, the squad and its AI logic, how the factions regard the player, fog of war |
| `src/world/` | the factions, galaxy and solar system generation, security levels |
| `src/core/` | maths, seeded randomness, saved data (and its backup), the screen's pixel ratio, colours and text size, number formats, game events felt as vibration and heard (`feedback.js`, `sound.js`) |
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
  happens; `src/game/options.js` turns events into vibration and sound (each switched off in Settings); a
  new event needs a voice in `src/core/sound.js` and a pattern in `BUZZ`.
- **Text on a station screen that explains it:** `explain(key, text)` in `src/ui/station.js`: shown on
  the first three visits, then behind the tab's ⓘ.
- **A change to what is saved:** a step at the end of `CARGO_MIGRATIONS` in `src/game/cargo-migrations.js`, so
  older saves are brought up to date (`Save.migrate`, `src/core/save.js`).

## Tests and tools

```sh
npm test       # every test: tests/run.js (the rules of each game), the smoke tests (the game played in Node), tests/sim.js
npm run test:game   # the main game only: tests/game.js, tests/smoke-default.js, tests/smoke.js (also test:race, test:idle, test:4x, test:sim)
npm run sw     # sw.js's file list, after adding or removing a file the game loads
npm run lint   # ESLint (eslint.config.js)
npm run perf   # tests/perf.js: frame cost in Chromium as a phone would run it (needs Playwright)
npm run galaxy -- 7   # tools/galaxy.js: what a seed gives: its systems, gates and deep-space sites (--svg file draws it)
```

The tests need no dependencies beyond Node 22. The rules are checked in one file a game
(`tests/game.js`, `race.js`, `idle.js`, `4x.js`, sharing `tests/harness.js`; `tests/run.js` runs all
four, and `ONLY=text` runs the tests whose names include it). `tests/smoke.js` runs the game in a stand-in
browser (`tests/browser-stub.js`) and checks it through `G`, the game's state and functions by name,
which `src/main.js` exports for the tests. CI (`.github/workflows/ci.yml`) runs the lint and each test file side by side.

Design notes live in `notes/`: `roadmap.md` is where the main game is heading (an offline MMO-like
space RPG) and what was cut on the way; `hazards.md` was the plan for gathering under hazards (taken
out); `archived-systems.md` lists systems taken out of the game and how to bring each back (the
latest: the hazards); `combat-alternatives.md` records the combat designs considered; `squad-logic.md`
records how squad programs and logic research work, and the plan for abilities; `industry.md` is the
plan for crafting, production orders and ship research, phase by phase; `factions.md` is the faction
overview (the factions, their standings and the story beats); `galaxy.md` is how the galaxy is
grown (its shape, systems, gates and deep space) and how the factions were placed in it; `race.md` is the plan for the race (`/race/`), phase by phase; `4x.md` is the plan for the 4X game (`/4x/`); `sim.md` is the plan for Redshift (`/sim/`).
