# Untitled Space Game

A browser space game: fly a ship through a procedurally generated galaxy, trade and mine for credits,
fight pirates for salvaged components, buy better gear and take it into more dangerous space.
Plain JavaScript (ES modules) on a 2D canvas, with no build step and no runtime dependencies.

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
| `?skipintro` | skip the introduction and the opening missions |
| `?dev` | every system and contact on the map, the testing buttons and the performance overlay |
| `?perf` | the performance overlay only (P toggles it) |
| `?style=pixel`, `?move=direct`, `?combat=realtime` | a setting for this visit |

## Code layout

`index.html` loads `src/main.js`. Each layer imports only from the layers below it:

| Folder | What it holds |
| --- | --- |
| `src/main.js` | the entry point: wires up the flight view, generates the galaxy, starts the frame loop |
| `src/game/` | the flight view, one module per part: shared state, input, docking, mining, the squad, combat, missions, HUD, the frame loop |
| `src/ui/` | the DOM panels (station menu, context menu, combat panel, comms, settings), the event log (`messages.js`) and the map, built from the UI kit (`kit.js`, `kit.css`) |
| `src/story/` | the introduction's script and the missions' data |
| `src/combat/` | combat rules: round-based (`combat.js`) and real time (`combat-realtime.js`), on a shared core |
| `src/flight/` | things in space: entity kinds, the scene, flying, interactions, map travel |
| `src/art/` | procedural art in four styles (line, pixel, flat, low-poly) and the sprite caches |
| `src/rules/` | items, markets, mining, ships and equipment, research, the squad and its AI logic, fog of war |
| `src/world/` | the factions, galaxy and solar system generation, regions and their politics, security levels |
| `src/core/` | maths, seeded randomness, saved data (and its backup), the screen's pixel ratio, colours and text size, number formats, game events felt as vibration (`feedback.js`) |
| `assets/` | the two fonts (OFL, served with the game) and the app icons; `manifest.webmanifest` makes the game installable |

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
- **A combat mode:** a module with the shape `src/combat/combat-core.js` describes, added to `COMBAT`
  in `src/game/options.js`.
- **A panel or a screen:** build it from the UI kit's components (`Kit` in `src/ui/kit.js`: buttons,
  meters, rows that expand, bottom sheets, the tab bar, folding sections) and its tokens (`src/ui/kit.css`:
  colours, the two fonts, radii, the 44 px touch target). Words are Barlow Semi Condensed, numbers
  IBM Plex Mono. Icons are line icons by their short code (`src/ui/glyphs.js`: a 24 px grid, 1.6 px
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
npm run galaxy -- 7   # tools/galaxy.js: what a seed gives: systems, factions, routes, situations
```

The tests need no dependencies beyond Node 22. `tests/smoke.js` runs the game in a stand-in
browser (`tests/browser-stub.js`) and checks it through `G`, the game's state and functions by name,
which `src/main.js` exports for the tests. CI (`.github/workflows/ci.yml`) runs the lint and the tests.

Design notes live in `notes/`: `archived-systems.md` lists systems taken out of the game and how to
bring each back; `combat-alternatives.md` records the combat designs considered; `squad-logic.md`
records how squad programs and logic research work, and the plan for abilities; `industry.md` is the
plan for crafting, production orders and ship research, phase by phase; `factions.md` is the faction
overview (the factions, their standings and the story beats); `galaxy.md` is how the factions are
placed in a generated galaxy.
