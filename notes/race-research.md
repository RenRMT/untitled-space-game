# Racing: research on movement and tracks

Oct 24, 2026

Research behind `notes/race.md`: how other racing games, mobile ones especially, handle movement and
tracks, held up against the race prototype (`race/`, `src/race/`), with a close look at the track
generator (`Track.loop`, `Track.carve`). Rivals, pickups and abilities are left for later; where they
bear on movement or tracks it's said. Numbers measured on the prototype as of commit 8e0e6e3.

## Part A: the track generator

### A0. How it works today (from reading the code and measuring it)
- **Layout** (`Track.loop` → `corners()`): a seeded polygon of 8 to 13 vertices round the map's
  middle, each at a random distance out (0.25 to 1). It is squeezed to be taller than wide, then fitted to the map.
  Each vertex is rounded into **one circular arc** (radius skewed tight by `r()**3`) and joined to the next by
  straights. Layouts are rejected for corners sharper than 2.7 rad, arcs that don't fit their edge, a minimum
  radius under 2 half-widths, or two stretches closer than `gap`. After 60 tries it falls back to `blob()`.
  **One RNG stream** feeds everything.
- **Width**: a sine round the loop (±25%), unrelated to the corners.
- **Carve** (`Track.carve`) uses the surface's tile-corner grid `C` (T = 64 units): corners within
  0.4T of the edge are opened, a noisy band of 1.4T ± 0.8T outside it becomes high ground (cliffs), and
  **everything beyond is left as generated**: random mesas, dunes, props and holes. Props in wall tiles are
  dropped. **On the track**, tall rocks are thinned to one per 7T, and holes (craters, vents) stay.
- **Zones today: only two.** The track's edge *is* the cliff. Holes are the only slow ground (×0.5 speed;
  vents burn). There is no run-off, and the ground under the track is whatever biome texture happens to be there.
- Measured over seeds 1 to 8 or 1 to 20:
  - **76 to 95% of all bending goes one way**, with only **2 to 6 left/right direction changes a lap**.
    Real circuits mix both directions much more. This is the polygon-round-the-middle shape.
  - Lap length is 9.3k to 12.6k units (about 19 to 26 s); 40 to 67% of the lap is bend.
  - **79 to 91 of the 100 ground chunks lie within 700 units of the track.** Baking only near the track would
    barely shrink memory; what outside detail costs is mostly **build time** per chunk.
  - The ship's turning circle at top speed is v²/a ≈ 326, which is under every generated corner's radius
    (350 to 565), so **no corner needs a lift**.

### A1. Less detail outside the track
| Option | What | Gains | Costs |
|---|---|---|---|
| a. Strip props beyond the walls | In carve, drop every prop (small/tall/hole) with d > the wall band; ground stays | Simple, faster chunk builds, calmer screen | Ground still has dunes, mesas and colour noise |
| b. **Fill with high ground** | `C = 1` for all corners beyond the band: the track runs through a canyon of mesa/ice shelf/basalt | Strongest readability (anything not track is wall), walls between stretches come free (helps `gap`), no stray mesas, few cliff pieces | Less "planet" scenery; plateau tops can look flat (they keep `topZ` noise) |
| c. Calm the ground kinds | Set the `G`/`G2` weights beyond the run-off to one plain kind | Visually quiet, with no new geometry | Dunes (`amp`) still undulate |
| d. Smaller map / lower DPR far from track | Fit the map to the track's bounds; draw chunks far from the track at lower dpr | The real memory win | A change to the bake/`SurfaceGlobe.tiles` options |

**Recommendation: b + a**, keeping 3 to 6 large props outside the wall as **landmarks** at corner apexes
(they help players learn corners). Do d later if memory on phones becomes a problem.

### A2. No obstacles on the track
In `carve`, delete every `tall` and `hole` prop with `edgeDist(...).d < runoff + p.r`. Optionally drop
`small` clutter on the track too, for a clean surface. Keep the code paths in `Contact` and the hole
check in `Run.step` (rocks and holes come back later as deliberate features), and keep the minimap dots
(they just draw nothing). Bump `TRACKS` so old ghosts are dropped.

### A3. Track, run-off, wall: three zones
**Gameplay** (all cheap: `Run.step` already calls `Track.edgeDist` every step, so `d` comes for free):
- **Track** (d ≤ 0): full stats.
- **Run-off** (0 < d ≤ RUNOFF, about 1.25T ≈ 80 units ≈ 3 ship widths): top speed eases toward about ×0.6 and
  accel/grip toward about ×0.7, over about 0.2 s rather than instantly, so it doesn't jolt. No damage. This replaces the
  hole slow-down as the "off-track" rule. Research says the penalty must be consistent and readable, and
  not so soft that cutting pays: check that crossing run-off on the inside of any corner is slower than staying on the track.
- **Wall** (cliffs beyond): existing `Contact` slide plus dent. Keep the damage for "clean lap" scoring (and
  optionally the wreck).
- Carve must open corners out to d < RUNOFF + 0.4T. Cliff outlines snap to the 64-unit grid with seeded
  offsets, so a run-off under 1T would let walls poke into the track. `gap` between stretches must grow to about
  2·RUNOFF + 1.5T (≈ 4T), or b above makes this moot.

**Visual** (two layers):
1. **Ground kinds, baked into the chunks**: carve also writes `W.G`/`W.G2` at tile corners. Ground
   kinds per biome already fit almost one-to-one:

   | Biome | Track | Run-off | Beyond (if not plateau) |
   |---|---|---|---|
   | Desert | b Hardpan (flat, cracked) | c Gravel reg (dark grit) | a Dune sea |
   | Ice | b Glare ice (flat) | c Pressure ridges | a Snowfield |
   | Moon | b Mare (flat, dark) | c Ejecta (grit) | a Regolith |
   | Lava | c Ash field (smooth) | a Basalt (rough) | b Lava flow (glows) |
   | Terran | a Meadow | c Woodland | — (b is the sea: avoid) |

   The weights are per tile corner (64 units) and blend, so edges blur over about ±32 units. Flat kinds also flatten
   the track (`amp: 0`).
2. **A crisp overlay** drawn each frame in `Draw.marks` from the centreline: edge lines at d = 0, and
   **kerbs** (alternating biome-tinted stripes) on the inside at the apex and the outside at the exit wherever curvature is
   high. Kerbs also act as corner warnings. Terran needs the overlay most (a tinted road ribbon).
   Cost: one or two paths per frame over the visible span only.
3. Feedback: dust or spray particles behind the ship and a light haptic tick on run-off; sparks, shake and a
   stronger haptic on walls. The HUD notes "off track".

### A4. Generating common corners and features
Corner vocabulary, with sizes measured against the turning circle Rv ≈ 326 (v²/a at top speed) and half-width hw ≈ 120:

| Corner | Turn | Radius | Role |
|---|---|---|---|
| Kink | < 30° | ≫ Rv | flat out, line only |
| Sweeper | 30 to 100° | 1.5 to 4 Rv | flat out with a clean line |
| Square (90°) | 80 to 100° | about Rv | edge of a lift |
| Hairpin | > 140° (GT Course Maker's rule) | < Rv (≥ 2 hw) | forces lift/brake: a braking zone |
| Double apex | 100 to 180° | two arcs with a short straight | two clipping points |
| Decreasing radius | 90 to 180° | r1 > r2 | trap corner ("mistake generator") |
| Carousel | 180 to 270° | constant, ≥ 2 Rv | sustained drift |
| Chicane | net ≈ 0, ±30 to 50° | small | sideways shift > track width, or it gets driven straight |
| Esses | alternating 40 to 90° | medium | rhythm, tests drift transitions |

Spacing rule from the physics: at top speed the velocity swings at a/v ≈ 1.5 rad/s, so a chicane
or esses element needs about 0.3 s × (degrees/30) of straight between apexes (≈ 300 to 400 units for ±30°).
A chicane's sideways offset must be larger than track width minus a ship width, or it can be flown straight.

**Generation options:**
1. **Polygon + corner types (extend the current one)**: keep the polygon for the overall shape. Per vertex,
   pick a type from its turn angle plus a seeded roll, and emit a *compound* segment list (two arcs for double apex
   or decreasing radius, one tight arc for a hairpin). Insert chicanes or esses *inside* long straights (net turn 0,
   so the polygon doesn't change). Force 2 to 4 **concave** vertices (push them inward) for opposite-hand corners.
   *Pros*: incremental, keeps fit/apart/blob. *Cons*: compound corners need longer edges, so more rejects.
2. **Segment grammar + Dubins closure**: walk a sequence of corner/straight tokens (a rhythm such as "long
   straight → hairpin → short → esses → sweeper…"), then close back to the start pose with a Dubins path
   (arc-straight-arc at a minimum radius). Reject on self-intersection or leaving the map. (Prasetya & Maulidevi: tracks as
   parameterised segment sequences plus multi-objective search.) *Pros*: explicit rhythm.
   *Cons*: the shape wanders, fitting a portrait map is hard, and the closing section is generic.
3. **Curvature profile / clothoids**: define κ(s) piecewise linear (Euler spirals, as GT's Course
   Maker uses for easing), integrate, and solve closure (x, y, heading). *Pros*: smooth transitions built in.
   *Cons*: closure needs a small optimiser.
4. **Search-based** (Togelius' SBPCG taxonomy; Lanzi et al. evolved tracks with a shape-diversity fitness
   plus a simulated-driver fitness): any of the above as the representation, with a score. At runtime, cheap
   geometric scoring of K candidates per seed. Offline, a bot flying the deterministic physics in Node
   curates a pool (daily seed, "New track").
5. **Corner-complex library**: hand-made combos (e.g. a "Becketts" esses) stamped into option 1 or 2. Gives
   identity at authoring cost.

**Recommendation: 1 + light 4.** Extend the polygon with corner types, inserted chicanes/esses and forced
concave vertices. Generate a few candidates per seed and keep the best score (deterministic). Ease arc↔straight
joins with a short spiral or local smoothing. Keep option 4 offline for a curated pool later.

### A5. Other generator features suggested by the research
- **Corner metadata output**: `tr.corners = [{ type, dir, entry, apex, exit, radius, vMax }]`. It feeds kerbs,
  pace-note chevrons before corners (rally-style readability on a small screen), the camera's bend zoom
  (instead of scanning `k`), the steering assist, and later AI, pads and corner names.
- **Racing line and speed profile**: a minimum-curvature line inside the width, then vMax = √(a·r) along
  it. This gives a lap-time estimate (score and medal times without a bot), places kerbs and landmarks, and
  later rivals' line and pad placement (pads *off* the line are a choice; *on* it are just speed).
- **Width tied to corners**: wider into hairpins and slow corners (line choice, and later overtaking and braking
  zones), narrower through fast esses. Changes stay gradual (FIA: about 1 in 20).
- **Scoring and validity** (also the tests): closed and non-intersecting; min radius ≥ 2 hw; `gap`; lap
  time 20 to 30 s; **one-way bend share ≤ about 0.7 and ≥ 6 direction changes**; 1 or 2 corners under Rv; a longest
  straight ≥ about 2 s; radius variety; horizontal straights capped (sideways look-ahead is only about 0.9 s on phones).
- **Start/finish**: halfway down the longest straight (already done). The first corner should be medium, not a hairpin, with
  a wide start straight; this matters for a starting grid later.
- **Separate RNG streams per stage** (layout, corner types, width, decoration) so tuning one stage doesn't
  reshuffle another seed's layout, which would silently invalidate ghosts. Bump `TRACKS` when the layout changes.
- **Hooks reserved for later, as metadata only**: straights long enough for pads, corner exits for
  pickups, and "thin wall" spots where two stretches pass close (the `apart` check finds them) as shortcut
  candidates.
- **Difficulty dial**: corner count, hairpin count, width and run-off width from one value, for daily or tiered tracks.
- **Landmarks**: one distinctive tall prop outside the wall per major corner, for memorability.

### A6. The advanced style: irregular layouts like real circuits
Every regular layout is a polygon placed by angle round the map's middle, so it reads as a wobbly
ring (convex-hull fill about 0.87). Real circuits (Bahrain, Zandvoort, Hungaroring, Baku, Interlagos,
Austin, Abu Dhabi, Singapore) are irregular in ways a ring can't be:

| Feature | Examples | In `skeleton()` |
|---|---|---|
| Fingers: out and back on itself, a hairpin at the tip | Bahrain T4–10, Abu Dhabi, Austin, Zandvoort | a narrow U (4 vertices) into an edge, out or in; its tip corners squares |
| Bays: the outline folds far in | Hungaroring, Interlagos | a wide, slanted notch inward |
| Elongated or L-shaped, not a ring | Baku, Montreal, Monza, Mexico | base shapes: long, block, wedge, L |
| A technical sector beside fast ones | Monaco, Baku castle, Singapore | a square wave of six square corners |
| Kinked straights | Jeddah, Baku | one or two tiny offsets (kinks) |
| Steps | Mexico stadium | a shallow, wide notch out or in (plateau) |

`Track.loop(seed, { …, style: 'advanced' })` grows such a skeleton in a portrait box (the base shape
shrunk to leave room for fingers out), rejects it if it crosses itself or two far-apart edges come
closer than two half-widths plus `gap`, then builds corners, wiggles, widths and checks exactly as
the regular style. Scoring adds a bonus for a low fill, more flips and slow corners beside fast ones,
and is scored for the lap `Config.map('advanced')` asks (26–38 s). About one skeleton in six
survives; 160 tries, the best of 12 kept, and the regular style as the fallback (none needed over
seeds 1–30). Regular layouts are unchanged bit for bit. The page takes `?track=advanced` and a
Regular / Advanced toggle. `npm run tracks -- 1 30 --style=advanced [--size=tiles]` and
`npm run tracks:sheet -- 1 24 --style=advanced > sheet.svg` show them.

**A bigger map for the advanced style.** At the regular 76 tiles a finger has to be about 0.15 of
the map wide (two half-widths, both run-offs and a wall), so shapes stayed chunky. Fingers and the
technical sector are sized against the track, the rest against the map, so a bigger map makes them
relatively thinner. Measured over seeds 1–30, all scored for a 26–38 s lap (fill: area inside over its convex hull's; lap at top speed):

| Map (tiles) | Fill min / median / max | Lap min / median / max | Flips median |
|---|---|---|---|
| 76 (regular style) | 0.80 / 0.87 / 0.91 | 18.6 / 22.3 / 24.4 s | 6 |
| 76 | 0.63 / 0.74 / 0.84 | 24.3 / 27.1 / 30.5 s | 8 |
| **90 (chosen)** | 0.58 / 0.71 / 0.82 | 25.7 / 34.1 / 40.1 s | 8 |
| 100 | 0.62 / 0.76 / 0.94 | 29.5 / 36.4 / 40.3 s | 12 |

90 folds in most for the shortest lap; 100 adds lap time without folding more. The cost is 1.4× the
ground chunks (90² against 76²): building the track took about 6.2 s against 4.5 s in headless
Chromium on a desktop, and memory grows alike. A three-lap race is about 1¾ minutes.

### A7. The expert style: folded everywhere, tight corners, few long straights
The advanced style still starts from a convex base shape with a few edges reworked, so it reads as
a blob with notches: mostly sweepers and squares, a handful of folds. The expert style
(`style: 'expert'`, `?track=expert`, the Expert button) builds the polygon differently. It is the
outline of a branchy **polyomino** grown on an uneven grid (`grid()`): 4–6 columns by 5–7 rows,
each 1–1.7 units, with 11–17 cells.
- A cell is likelier the fewer filled cells it touches (weights 1, 0.05, 0.01 for 1, 2, 3), and
  2.5× likelier again when it carries an arm on straight. So the clump grows arms, not a lump.
- A cell is never added when it would touch the clump only at a corner (the outline would pinch)
  or would close a hole. That keeps the outline a single simple loop.
- In the outline, every one-cell arm is a finger: the track runs out, makes two square corners a
  cell apart (a hairpin) and runs back. Every gap between arms is a bay it runs into and out of.
- Any two stretches side by side are at least one cell apart. So the spacing checks (`clear()`,
  `apart()`) pass by construction instead of throwing most skeletons away.
- Corners are nudged up to 0.24 of the smallest cell, so they turn about 70–110° instead of all
  90°. About two in three are marked tight (square whatever the roll); the rest are picked from
  kinds leaning to squares, hairpins and decreasing bends. Slow corners are sized at 0.7× (down to
  the tightest the width allows, SAFE), so almost every corner needs a lift.
- Every straight but the longest gets a chance of a wiggle (four at most, 85% of them chicanes).
- The score rewards a low fill (down to 0.5), flips up to 18, one or two straights of 1.5 s or more
  (`longs` in `Track.measure`), and penalises a longest straight over 4 s or one that runs
  sideways.
- 200 tries, the best of 24 kept. It falls back to the advanced style (not needed over seeds 1–30).

Over seeds 1–30, both styles on the 90-tile map:

| Style | Fill min / median / max | Flips median | Corners per lap | Tight share | Longest straight median | Lap median |
|---|---|---|---|---|---|---|
| Advanced | 0.58 / 0.71 / 0.82 | 8 | 15 | 0.67 | 2.5 s | 34.1 s |
| **Expert** | 0.51 / 0.64 / 0.74 | 12 | 19 | 0.99 | 4.4 s (23 of 30 vertical) | 38.4 s |

The tight share counts squares, hairpins, decreasing bends, double apexes and chicanes. Fill
understates the difference: nested fingers fold the track in far more than the hull ratio shows,
as the contact sheet makes plain. A 100-tile map with more cells folded no further (fill median
0.64), so the expert style stays at 90 tiles and costs no more to build than the advanced one.
`longs` medians 3 in both styles, because a chicane splits a straight into two halves that can
each pass 1.5 s. The expert style's straights, though, are fewer and broken up.

---

## Part B: movement, camera and sessions

Measured: ship radius 13.6 (about 27 across); top speed 487 u/s, accel 728 u/s², nose turn 4.5 rad/s.
In Cruise the velocity turns at most a/v ≈ 1.5 rad/s at top speed (turning circle v²/a ≈ 326); the
nose turns 3× faster, which is the drift. Track about 243 wide (9 ship widths). Look-ahead (ship at 55%
of the screen's height, lead held to 0.3 of its short side): phone portrait about 1.7 s flying up,
1.4 s down, 0.9 s sideways; desktop 1920×1080 (zoom 1.69) about 1.1 s up.

### Findings from other games
- **Controls:** auto-accelerate is the mobile default (Asphalt 9, Mario Kart Tour, Horizon Chase).
  Touch beats tilt (GI2014; tilt works as a supplement). Data Wing: left/right halves, both halves
  brake, scraping a wall gives speed. Steering toward the finger (Touch Racing Nitro: distance is
  speed) is the other family, as point mode. Relative steering under a fixed camera inverts when
  driving down the screen (the "RC car" complaint about isometric top-down racers). Assists like
  Smart Steering are optional, framed as correcting touch, and off raises the ceiling. Avoid controls
  that need an arc of the thumb (one direction is harder).
- **Feel:** a solid simulation with assists and camera polish on top (Criterion, GDC 2018).
  Collisions forgiving but punchy. Wipeout makes walls cost a lot of speed and pairs them with
  airbrakes. The grip-to-slide change must be predictable.
- **Camera:** zoom out as speed rises (Rush Rally, Art of Rally), the car low on the screen, about
  1.5 to 2 s of road ahead. Close cameras need designed sightlines; an unseen corner reads as unfair.
- **Sessions:** Trackmania's 30 to 40 s tracks, instant restart, ghosts and medal ghosts; multi-lap
  races several times longer weaken "one more go". Mobile: 45 to 90 s, star targets, async ghosts and
  daily seeds.
- **Tracks:** wider is easier and lets the skilled carry a smoother line (about 1.6 car widths a lane
  plus a shoulder in arcade guidance; real circuits change width gradually). Vary corner types, a few
  deliberate mistake generators rather than uniform difficulty; a long straight into a tight corner is
  the braking and passing zone. The racing line and its clipping points are what a track is designed
  round.
- **Later features:** rivals need room to pass (an overtaking line beside the main one, mostly on
  straights) and corners that force speed differences; AI needs a minimum-curvature line. Pads need
  width and sightlines (off the line a choice, on it just speed). A sideways dash longer than half the
  width becomes a wall-hit generator.

### What the prototype does well
The deterministic 120 Hz step with interpolation (ghosts, medals, replays, AI later); walls you slide
along with low restitution and track-derived normals; about 22 s laps, 70 s races; a camera that leads
along the track and zooms by bends; every chunk baked before the countdown and the pixel ratio dropped
on missed frames; generator constraints (min radius, gap, min width, portrait shape); the Cruise drift
as an identity; auto-accelerate, assist, ghost, minimap, wrong way.

### What can improve, most first
1. No corner needs a lift: the turning circle (326) is under every corner's radius, so laps are flat
   out and skill is only line tidiness. It also removes the braking zones rivals need. *Done (Part D):
   the Cruise step cut the chord, so pointing the nose at a corner's exit braked by itself.*
2. Look-ahead is short and the camera zooms in at speed (`cam.pull`), the opposite of common practice;
   the ship sits at 55% whichever way it flies.
3. Sides mode inverts on downward stretches and has no touch brake (both halves go straight).
4. Corners are random rather than designed (Part A).
5. Rocks on the track can land on an apex, untelegraphed.
6. Wall damage and the wreck run against mobile forgiveness: better a clean-lap target.
7. No targets but your own ghost.
8. Arc-to-straight curvature jumps (minor for a drifting ship).

### Directions
- **Cornering depth:** scrub (speed lost with the slip angle), corners tighter than the turning
  circle, an airbrake (brake one side to turn tighter at a small cost), or walls as speed (Data Wing).
  Recommended: a little scrub plus a touch brake or airbrake, with 1 or 2 corners a lap that need it.
- **Steering:** point (absolute) as the main scheme, with a second finger or zone to brake; sides as an
  option, both halves braking. A turning camera is out (chunks are drawn at a fixed tilt).
- **Camera:** zoom out with speed, the ship opposite its way, at least 1.5 s ahead; speed lines make up
  for the sense of speed lost.

## Part C: controls in portrait, one thumb

Oct 24, 2026. Portrait on a phone comes first, steered with one thumb.

### C0. What went wrong
- **The ship under the thumb.** The camera's focus sat 0.55 down the screen and led the ship by up to 0.3
  of the short side. On a 390×844 phone flying up, the ship was drawn 69% down, where the thumb rests.
  Flying down, the track ahead ran under it.
- **One gesture did everything.** Drag-anywhere steering left no room for maneuvers: dash, a real brake, a hop.

### C1. Findings from other games and research
- **One-handed grip is the commonest.** In Hoober's field study 49% of touches were one-handed, two-thirds
  right-handed. The easy reach is the lower middle of the screen.
- **Mario Kart Tour** (portrait first, landscape added later): it accelerates by itself and you slide one
  finger to steer. **Tap** uses an item, a swipe up or down throws it forward or back, swipe-and-hold drifts.
  Tilt doesn't fit portrait.
- **Other one-thumb games.**
  - Data Wing: halves to turn, both to brake.
  - Subway Surfers: swipes for lanes, jump and roll.
  - Alto: tap to jump, hold to flip.
  - Archero, Vampire Survivors: a floating stick in the lower screen.
  - Asphalt 9 TouchDrive: tap to drift or brake, swipes for tricks.
- **Fixed or floating stick.** No study isolates thumb drift. A small portrait study found the floating stick
  slightly ahead on every measure, and developers find thumbs slide off fixed ones. The usual hybrid:
  - a home ring drawn where the thumb goes;
  - a touch anywhere in a lower band re-centres the stick;
  - the base follows past its rim;
  - a small deadzone.
- **Gestures one thumb can make without blocking steering:**
  - hold and drag: steer;
  - back to the middle: brake;
  - let go: keep the course;
  - a **flick** (short, quick, released): an action with a direction;
  - a **tap** (short, still): an action;
  - a second finger's tap, for two-thumb players.
  Avoid a long press (it clashes with the start of a drag) and double-taps (slow, easy to trigger by accident).
- **Letting go keeps the course**, so gestures that lift the thumb cost about 150 ms of steering and nothing else.

### C2. What the race does now (`src/race/input.js`, `view.js`, `run.js`)
- **Pad** (the default on touch screens, `?steer=pad`):
  - a stick in a band along the bottom 28% of a portrait screen (40% in landscape), kept clear of the home bar;
  - a ring fixed at home in the band; a touch anywhere in it steers from the ring's centre, and anywhere past the rim
    is full speed that way (the base no longer moves to the thumb or follows it: no drag, one place to learn);
  - angle is the heading and reach the speed, as point mode;
  - brought back into the middle quarter once out, it **brakes** (top speed eased to ×0.35 at 2.5× the acceleration).
- **The view** (`View.frame`) frames the race above the band on a portrait screen:
  - the focus sits 0.42 down;
  - the ship is held in a box from 0.16 of the height to 40 px above the band;
  - flying up it rests just above the thumb with most of the screen ahead; flying down it rises toward the top.
- **Tap** (any finger, anywhere; Space) **hops**: 0.55 s off the ground. No slowing on the run-off or in holes,
  only 0.4 of the grip, and walls still stop it. It's a run-off shortcut and a dodge for now; gaps and ramps later.
- **Flick** (any finger; the game's FLICK) **dashes**, read against the craft's way:
  - within 50°: a boost, 2× top speed, eased back down;
  - up to 130°: a sidestep, 1.6× top speed square to the way, the velocity given back after;
  - beyond: an airbrake, the speed halved.
  It takes two charges, one back every 2.5 s, shown as pips under the ring. Keys: Shift, Q and E.
- **Haptics** (Android browsers): a buzz on each dash, the hop, the landing and a charge back.
- Point (drag anywhere) stays the default with a mouse and gets the same taps and flicks; its double-tap stop is gone.
  Sides is unchanged, with X and Space too.

## Part D: grip, the slide and the brake

Oct 24, 2026. Before this, no corner needed the brake. Measured, there were three reasons:
- **Steering braked by itself.** In Cruise the velocity eases toward heading × speed as one vector, so
  pointing the nose at a corner's exit cut the chord: the velocity turned and lost speed together, for free.
- **The brake was grip.** It multiplied all of the acceleration by 2.5, turning included.
- **Walls were free.** A graze kept 96% of its speed.

On top of that, the track is wide against its corners. A 90° corner's line has a radius far over the
centreline's, so `<Rv` overstates how tight a corner flies.

`src/race/handling.js` (the race's own step; the game's `Flight` is untouched; Direct still uses it)
splits the change in velocity in two:
- **Along the velocity:** the engine holds the speed asked for whichever way the nose points
  (×1 the acceleration up, or down from over top speed). Lifting slows at ×0.35; the brake slows at ×2.5.
- **Across it:** the grip, ×0.85 the acceleration, so the tightest circle at top speed is about
  384. The brake no longer adds grip.
- **The slide:** the slip is the nose's angle from the velocity. Over 0.42 rad the craft slides: the
  grip drops to ×0.8 and the speed is scrubbed by 0.3 × the acceleration × the slip's sine. It grips
  again under 0.22 rad. The gap between the two (hysteresis) makes the change predictable.
- **Walls:** friction 0.12, so a graze keeps 88% and scraping costs more than braking.

**The drift.** A slide held over half of top speed, on the track and on the ground, charges level 1
at 0.5 s and level 2 at 1.1 s. When the grip comes back it gives a boost: ×1.2 top speed for 0.3 s, or
×1.35 for 0.5 s. A hit or the run-off loses the charge.
- Skid marks (the last 240 points) and dust or sparks coloured by level (dust, blue, orange).
- An arc over the pad's ring fills with the charge.
- Haptics on the slide, each level and the boost.

**Checked by a scripted pilot** (`src/race/pilot.js`, `npm run tracks -- --fly`). It flies a lap flat
out, then a lap braking for the bends ahead it can't take (their radius plus half the half-width,
against the grip). Grip was swept from 0.75 to 0.9; 0.85 gives about three braking zones a lap.

| Style (seeds) | Braking gains a lap, min / median / max | Gains > 0.2 s | Braking zones (median) | Flat out off the track (median) |
|---|---|---|---|---|
| Regular (1–30) | −0.14 / 0.52 / 2.35 s | 20 of 30 | 3 | 0.9 s |
| Expert (1–12) | 0.92 / 2.67 / 4.20 s | 12 of 12 | 16 | 6.0 s |
| Advanced (1–12) | about 0 | 0 of 12 | – | 0 s |

The advanced style's skeleton layouts still fly flat out. Making their slow corners tighter (× 0.75
to 0.85) didn't change that, so it's left for the generator: shorter run-ins and corners that turn
further.

## Sources
- [Search-based PCG: taxonomy and survey (Togelius et al.)](https://course.ccs.neu.edu/cs5150f13/readings/togelius_sbpcg.pdf)
- [Track generation by GA, shape and simulation fitness (Lanzi et al., cited in TU Delft survey)](https://publications.graphics.tudelft.nl/rails/active_storage/blobs/redirect/eyJfcmFpbHMiOnsibWVzc2FnZSI6IkJBaHBBc3dNIiwiZXhwIjpudWxsLCJwdXIiOiJibG9iX2lkIn19--abf95264f8d6bf9b4093135f332b098978f253bd/TWB11a.pdf)
- [Segment-sequence tracks with multi-objective search (Prasetya & Maulidevi)](https://lppm.itb.ac.id/?p=64965)
- [Closed-loop layouts and self-crossing repair (Chulalongkorn thesis)](https://digital.car.chula.ac.th/chulaetd/75063)
- [GT Course Maker: hairpins over 140°, Euler-spiral easing](https://www.gtplanet.net/forum/threads/course-maker-toolbox.352281/post-14000734)
- [Generating procedural racetracks (hull + displacement)](https://gamedeveloper.com/programming/generating-procedural-racetracks)
- [Adversarial RL for PCG: road segments](https://arxiv.org/pdf/2103.04847)
- [Clothoid discussion](https://www.gtplanet.net/forum/threads/cities-skylines-the-sim-city-we-deserve.325276/page-23) · [Clothoid limits](https://pmc.ncbi.nlm.nih.gov/articles/PMC7184578/)
- [Track boundary / kerbs debate](https://www.gtplanet.net/forum/threads/poll-where-is-the-track-boundary-in-your-opinion.202836/) · [Grass vs gravel run-off](https://motorsportweek.com/?p=12501) · [Kerbs explained](https://flowracers.com/?p=9290)
- [Arcade track design fundamentals](https://gamedeveloper.com/design/feature-the-fundamentals-of-arcade-style-racing-track-design) · [A Rational Approach to Racing Game Track Design](https://gamedeveloper.com/design/a-rational-approach-to-racing-game-track-design) · [Magnopus: memorable tracks](https://www.magnopus.com/blog/the-art-of-designing-a-memorable-race-track) · [Five rules of racetrack design](https://www.autocarindia.com/motor-sports-news-amp/five-rules-that-drive-racetrack-design-420806) · [GTPlanet: track width](https://www.gtplanet.net/forum/threads/track-width.189125)
- [GDC: Vehicle Feel Masterclass](https://gdcvault.com/play/1025295/Vehicle-Feel-Masterclass-Balancing-Arcade) · [Data Wing](https://www.pocketgamer.co.uk/data-wing/data-wing-is-a-minimalist-arcade-racer-out-now-for-ios-and-android/) · [Touch Racing Nitro](https://www.pocketgamer.com/touch-racing-nitro/review) · [Tilt vs touch (GI2014)](https://www.csit.carleton.ca/~rteather/pdfs/GI2014.pdf) · [Smart Steering](https://www.mariowiki.com/Smart_Steering) · [Top-down rally cameras](https://traxion.gg/heres-why-are-so-many-rally-games-going-top-down/) · [Art of Rally camera](https://jalopnik.com/how-a-small-change-in-camera-angle-completely-transform-1849152549) · [Wipeout 2097 airbrakes](https://wipeout.fandom.com/wiki/Wipeout_2097) · [Trackmania Turbo review](https://www.godisageek.com/reviews/trackmania-turbo-review)
- [Mario Kart Tour drifting (iMore)](https://www.imore.com/mario-kart-tour-how-drift-and-when-you-should-try-it) · [Mario Kart Tour first impressions](https://9to5google.com/2019/05/23/mariokart-tour-first-impressions/) · [Mario Kart Tour landscape mode](https://www.siliconera.com/mario-kart-tour-landscape-mode-is-here/) · [How users hold phones (Hoober)](https://www.uxmatters.com/mt/archives/2013/02/how-do-users-really-hold-mobile-devices.php) · [On-screen gamepad designs](https://publications.ait.ac.at/en/publications/investigating-on-screen-gamepad-designs-for-smartphone-controlled/) · [Fixed vs floating joystick (UPI)](https://repository.upi.edu/101077) · [Fixing virtual joysticks](https://bugnet.io/blog/how-to-fix-mobile-virtual-joystick-feeling-bad)
