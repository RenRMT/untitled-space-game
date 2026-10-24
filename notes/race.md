# Racing: the plan

Oct 24, 2026

The race (`race/index.html`, code in `src/race/`; it started as `tools/race.html`) is a lap race on
a generated planet surface, flown in the game's own ship by the game's own rules: `Flight` (Cruise
drift and the dash), `Collide`, `ArtSurface` and `SurfaceGlobe` (the ground, built in chunks), the
`fighter-light` blueprint and the drag-to-steer input. This note is the design reference for
growing it into a game; the code follows it phase by phase (see Phases at the end).

## Where it lives

In this repo, beside the game. The "assets" it shares are code (procedural art in `src/art/`,
flying in `src/flight/`, `src/core/`), and with no build step the race imports them directly; a
second repo would mean copying them or a submodule, and copies drift. GitHub Pages serves it at
`/race/` with the game.

- `src/race/` sits beside `src/game/` in the layers: it imports `src/core`, `src/art`, `src/flight`
  and `src/rules`, never `src/game` or `src/ui` (the game's global state). ESLint enforces it
  (`no-restricted-imports` in `eslint.config.js`), so a split later stays mechanical.
- The race tunes shared rules through its own numbers, never by changing shared config (e.g.
  `Collide.config` is the game's: the race passes its own restitution and friction).
- Split it into its own repo only when it needs its own release, branding or manifest, or when
  shared modules start bending to fit it.

## What else of the game fits a race

Beyond the ships, portraits, surfaces, movement, dash and hazards:

- **The dash as boost pads** on the track (free bursts); the player's own dash costs a charge.
- **Each biome's hazard** (`rules/hazards.js` surface): lava vents that erupt on a timer (timing
  puzzles), desert dust storms that cut what you see, ice where dashes cost double (a charge
  economy), radiation on moons (a shortcut that burns).
- **Space tracks:** asteroid fields and gas pockets; jump gates and wormholes as shortcuts or
  teleports; a station as the start and finish gantry, or the pit.
- **Consumables** (coolant, purge, fuel canister, seismic charge) as pickups or a loadout taken
  into a race; a seismic charge could clear a rock or leave a hazard behind you.
- **Cultures and factions** (`ArtBlueprints`, `ArtCulture`) as rival teams with their own liveries;
  **crew portraits** (`art/crew.js`, `art/portraits.js`) for rivals' barks, the team radio and the
  podium.
- **The loadout** (`rules/loadout.js`) for a light upgrade layer (engine, turn, hull); **feedback**
  (`core/feedback.js`) for haptics on hits, boosts and gates.
- **The galaxy** as a career map: a system a cup, a planet a track, every seed already
  deterministic. Day and night for a race before sunrise.

## The track: three zones, designed corners

`notes/race-research.md` has the research and measurements behind this.

- **Three zones**, each clear to see and to fly: the track (full speed, a flat ground kind and edge
  lines, kerbs at the apexes and exits); a run-off band about 1.25 tiles wide past the edge (slower:
  top speed and grip eased down, a rougher ground kind, dust); then the wall (cliffs: slide, dent).
  Off-track is measured from the centreline (`Track.edgeDist`), not from what's drawn.
- **Nothing on the track** for now: rocks and holes come back later as deliberate features.
- **Calm outside:** high ground beyond the walls, no props there but a few landmarks at the corners.
- **Corners from a vocabulary** (kink, sweeper, square, hairpin, double apex, decreasing radius,
  carousel, chicane, esses) sized against the ship's turning circle, so one or two a lap need a lift;
  bends both ways (today 76–95% of the bending goes one way); width tied to the corners.
- **Checked by numbers:** each seed scored (lap time, the mix of directions, straights, radii) and the
  best of a few candidates kept; the corners and a racing line handed on with the track (kerbs,
  pace-note chevrons, the camera, medal times, later rivals and pads).

An open area with checkpoints in any order is a good second mode later (rally, time attack); on a
phone it needs a strong arrow to the next one.

## The camera: angled top-down, framing the track

The low-poly ground is drawn ahead of time in chunks at a fixed tilt along +y (`Art.config.tilt`,
`ArtSurface.project`), so a camera that turns, or sits behind the ship, would mean redrawing every
chunk at every angle: a WebGL rewrite. (Line has no tilt and could turn; low-poly can't.) Within
that:

- lead toward the track ahead (its direction a moment ahead, blended with the velocity), not only
  the velocity;
- zoom out a little on straights and in for tight bends (the centreline's curvature is known);
- relative steering (below) takes most of the wish for a chase camera away.

## Smooth flying

1. **Walls you slide along.** The prototype put the ship back in x or y and bounced it off an
   axis, which stair-steps, sticks and bleeds speed on diagonal cliffs. Now the cliffs are still
   detected by what's drawn (`ArtSurface.blocked`), but the wall's normal comes from the track
   (towards the nearest centreline point); the ship is pushed out along it, only the speed into
   the wall is taken away, most of the speed along it is kept, and only a hit's speed into the
   wall dents the hull. Rocks are circles (`Collide.resolve`'s geometry).
2. **A fixed step** (120 a second) with the drawing interpolated between steps: smooth when frame
   times wobble, and the same inputs fly the same lap (for ghosts).
3. **A steering assist:** a heading close to the track's way (within about 20°) is pulled onto it.
4. **No chunk hitches:** the ground along the start is built during the countdown, and in the race
   chunks are built ahead along the track, not only along the velocity.
5. **Smaller costs:** the HUD's text is rewritten only when it changes (10 times a second); the
   canvas's pixel ratio is held lower on phones.
6. **Drivable tracks:** a polygon of 8 to 13 seeded corners, rounded into arcs from hairpins to
   sweepers and joined by straights, a little taller than wide; no bend tighter than twice the
   track's half-width, no two stretches without a wall between them, and the track never narrows
   below a few ship widths.

## From mobile racing games

- **Controls:** auto-accelerate so the player only steers (Asphalt's TouchDrive, Mario Kart Tour,
  Horizon Chase); hold the left or right half of the screen to turn (Data Wing, Absolute Drift);
  the game's drag-to-point stays as the other mode. One button (or flick) for the dash or boost.
- **Forgiving:** walls turn you rather than stop you, and no wreck in the core loop (Data Wing even
  makes scraping a wall speed). Hull damage can become a penalty or a "clean lap" bonus.
- **Short sessions:** 45 to 90 s races, an instant restart, star targets on each track (time,
  clean, every pickup).
- **Racing apart:** your best lap's ghost, then friends', then a daily track for everyone (the seed
  the date).
- **Readable:** gate beacons, a line to follow, hazards that warn before they fire, a minimap with
  the bends ahead.
- **Feel:** speed lines, the ship banking into turns, the flame on a dash, haptics on gates and
  hits, a small shake on impact.
- **Later:** cups across the galaxy map, light upgrades from the loadout's numbers, rivals from the
  factions with portraits.

## Phases

1. **Feel and structure** (done): moved to `race/` and `src/race/` (track, contact, ghost, input,
   drawing, the run and its wiring) with the import boundary; walls you slide along and rocks as
   circles; the fixed step with interpolation; chunks built during the countdown and ahead along
   the track; auto-accelerate with left and right halves to steer (`?steer=sides`), and the steering assist; the camera leading along the track, zooming by its bends;
   the centreline smoothed with a minimum width; your best lap's ghost (saved per biome and seed).
   Tests for the track and for sliding along a wall in `tests/run.js`.
2. **Tracks and feel:** done: the three zones (`Track.carve`: ground kinds per biome in
   `src/race/config.js`, the run-off's slowing in `Run.step`, edge lines and kerbs in `Draw.lines`);
   high ground beyond the walls; nothing on the track; `npm run tracks` (`tools/race-tracks.js`)
   measures a run of seeds. Still to do: corners from a vocabulary, scored; a racing line and medal
   times; the camera zooming out with speed; a touch brake or airbrake, and corners that need it.
3. **Content:** boost pads (the dash); rocks, vents and dust storms as placed features; shortcuts;
   star targets; the daily seed.
4. **Rivals and a career:** AI ships, cups on the galaxy map, upgrades.
