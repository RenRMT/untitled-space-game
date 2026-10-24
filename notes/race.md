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

## Biome character

Each biome races differently, not only looks different: one profile per biome in `src/race/config.js`
(`Config.BIOME`), each number × the standard one, read by the track (`Config.map(style, biome)`:
width and the odds of each kind of corner, `Track.loop`'s `mix` and `chicanes`), the handling
(`Handling.tune`) and the run (`Run`'s `R.tune`: run-off, walls, hop). **Terran is the standard**, the
track to learn on: it has no profile, so its tracks, feel and ghosts are as they were. A biome's
`rev` goes in its ghosts' key, so retuning one leaves the others' ghosts. `npm run tracks -- --biome=ice --fly`
measures one.

| Biome | Handling | Track | Run-off and walls |
|---|---|---|---|
| Terran | standard | standard | standard |
| Ice | grip ×0.65, slides start sooner and keep their speed, weak brake | wide, sweepers and carousels | slows less; slippery walls |
| Desert | grip ×0.8, slides come easier (rally) | flowing, fewer chicanes | deep sand slows more; soft walls |
| Lava | grip ×1.1, top speed ×1.05 | narrow, squares, hairpins, chicanes | rough run-off; walls dent ×1.5 |
| Moon | slow to pick up, grip ×0.85; long high hops | carousels and double apexes | standard |
| Gas giant | floaty: turn and acceleration ×0.9 | wide open sweepers | storm fronts soft but draggy |

Live biome hazards (vents, dust storms, crosswinds) are left for the content phase.

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

- **Controls:** portrait and one thumb first (`notes/race-research.md` Part C). A stick fixed in a
  band along the bottom; the view frames the race above it so the ship is never under the thumb. Back to
  the stick's middle brakes, a tap hops, a flick dashes (forward a boost, sideways a sidestep, back
  an airbrake; two charges). Drag-anywhere (point) and the left and right halves (sides, as Data
  Wing) stay as options.
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
   measures a run of seeds. Corners from a vocabulary (`Track.loop`: kink, sweeper, square,
   hairpin, double apex, decreasing radius, carousel; a chicane or esses in the longest straights),
   sized against the turning circle at top speed so one to a few a lap need a lift; three or four
   corners pulled in so it bends both ways; the width following the corners; the best of six
   layouts by score; the corners handed on as `tr.corners`. Over seeds 1–60: 55–77% of the bending
   one way (was 71–100%), 6–10 direction changes (was 0–8), 1–6 corners needing a lift (was none),
   laps of 19–25 s. Controls for portrait and one thumb: the pad (a stick in a band along the
   bottom, the view framed above it), a brake, a hop on a tap, dashes on a flick. Handling
   (`src/race/handling.js`, `notes/race-research.md` Part D): grip, a slide and a brake, so the tight
   corners need the brake (steering no longer slows the craft by itself); a slide held at speed
   charges a drift boost, with sparks by its level; dust off the tail (`src/race/dust.js`, drawn only)
   in the run-off's colour off the track and the track's while sliding, no skid marks (a hovering
   ship leaves none); a gas giant biome (haze track, cloud-deck run-off, storm fronts for walls); the
   pad's base fixed on its home ring. Still to
   do: a racing line and medal times; the camera zooming out with speed; gaps and ramps for the hop;
   the advanced style's corners still don't need the brake.
3. **Content:** boost pads (the dash); rocks, vents and dust storms as placed features; shortcuts;
   star targets; the daily seed.
4. **Rivals and a career:** AI ships, cups on the galaxy map, upgrades. Research and design: `notes/race-rivals.md`.
