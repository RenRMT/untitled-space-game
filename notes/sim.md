# Redshift: the plan

Nov 8, 2026

A portrait sim/strategy game beside the others (`sim/`, code in `src/sim/`): a black hole is
swallowing the galaxy, and the player keeps one step ahead of it, one star system at a time. In each
system they build stations round its bodies, run a small economy and keep its cultures content
while they build a jump gate to the next system, further out. The tension is in **when to jump**:
the gate is ready long before the black hole arrives, and there are always reasons to stay one more
cycle.

The working name is **Redshift**: light stretched by the hole's pull, and a people moving away.

## The loop

1. **Arrive** in a system through the gate, with nothing but the Ark (the command ship) and a
   starting kit; nothing built.
2. **Build** stations in the system's slots: one per body (planet, moon, asteroid belt, nebula).
   Each body has a level of **minerals** and of **volatiles** (0–3 pips), and sometimes a trait.
3. **Run** the economy on a clock of cycles (1 s at 1×; pause, 1×, 2×, 4×): mines and siphons pull
   minerals and volatiles; trade hubs turn them into credits; labs into science; defense platforms
   into security. Each station has one ship slot (more with upgrades); its ship boosts it.
4. **Build the gate** at the gate site on the system's edge, in three stages (frame, ring, core).
5. **Jump**, when ready: three systems to pick from, differing in distance (how long until the
   hole arrives), resources and hazards. Nothing built is carried; permanent upgrades are.

## The black hole

The **horizon meter** fills every cycle at the system's rate (its distance). Past half, time
dilates: production and construction slow (×1 at 50%, ×0.67 at 75%, ×0.3 at 90%, ×0 at 100%), and
so does everything on screen: orbits crawl, the star reddens, the hole's lensing creeps in from the
top of the map. At 100% everything stops and the system is lost (story: try the system again;
endless: the run ends, with half of what it earned kept).

## Reasons to stay one more cycle

- **Overcharge.** A finished gate keeps charging, faster the nearer the horizon. Charge pushes the
  next jump further: every choice is further from the hole, and the jump gives more Insight.
- **Science becomes Insight** at the jump: the longer the labs run, the more permanent upgrades.
- **Requests** from the cultures' people (with their portraits) pay out when they're done: some
  only by holding on ("keep the lab running until the horizon reaches 80%").
- **Boons**: a culture at 75 approval or more at the jump gives its boon for the next system.

## Placement tension

The best yield isn't the only reason to put a station somewhere:

- **Traits**: a body sacred to the Shard (a lab there makes double science), a strategic one for
  the Wedge (a defense platform covers the whole system), a trade lane for the Block (a hub earns
  half again), ancient ruins, a derelict to salvage, a Drifter haunt (left empty, Drifters build
  there).
- **Neighbours**: a planet and its moons are a group. A hub beside a mine or siphon trades half
  again; a defense platform protects its whole group from blockades.
- **Requests** ask for a station at a particular body.

## Cultures

Encountered one by one in the story; all at once in endless.

| Culture | Role | Values | Station |
| --- | --- | --- | --- |
| Androids | the player's own; the advisor | — | mines, siphons, the gate |
| Wedge | security and order | security vs. demand | defense platform |
| Block | economy | credits income | trade hub |
| Shard | science as faith | science income | research lab |
| Drifters | revolt | — | rogue stations, blockades |
| Aliens | wildcard | ? | gifts and curses |

Each of the three settled cultures has an **approval** (0–100) that drifts up while what it values
is provided and down while not. High approval (70+) makes its stations work harder; low (25-)
halves them; 0 is a strike. **Drifters** rise from unrest (security short of demand): they
blockade a station, or build a rogue station on an empty body that skims production. **Aliens**
come with offers: accept and something happens, good or bad.

## Hazards

A system can have one: ion storms (ships go dark now and then), a pulsar (labs gain, pulses knock
stations out), a flare star (inner orbits produce less), a supernova remnant (rich minerals,
dearer building), a magnetar (defenses jammed), Drifter space (unrest doubled), alien space (more
alien visits). Each is drawn with the repo's deep-space site art.

## Permanent upgrades: the Archive

Insight, earned at each jump (science, overcharge, requests), buys Archive upgrades that every later
system starts with: a better starting kit, cheaper gates, better drills, a slower horizon, more
ship slots, a fourth jump choice, and more. Kept across endless runs.

## Past systems

Every system left behind is on the **Chart**: open one to see it as it was left, frozen in time
(so close to the hole, its clock has all but stopped), with its stations still in orbit.

## Modes

- **Story**: seven systems, a culture or a feature in each: the Androids (building, the gate), the
  Wedge (security), the Block (credits, ships), the Shard (science, the Archive), the Drifters
  (revolts), the Aliens (the wildcard), and the last jump, out of the hole's reach.
- **Endless**: everything from the start, the hole a little faster each system; the score is
  systems escaped.

## Interface (portrait, one thumb)

Taken from mobile city builders (Pocket City's pattern): the system fills the screen; a header
with the resources and the horizon meter, and the clock (pause and speeds) at the top; a tab bar
along the bottom (System, Build, Cultures, Gate, Chart); requests float over the map as portrait
bubbles to tap; build mode is a tray of station cards, the map marking where each could go and
what it would make there; every body and station opens a sheet. The advisor (an android) says
the next thing to do in a line under the header, with its face.

## Showcase

The game uses every kind of procedural art in the repo: stars, planets (all types, rings), moons,
asteroid belts, nebulae and gas pockets; stations (culture majors and minors, and the role
stations), ships (light, medium, heavy fighters and freighters, and the player's ship as the Ark),
the gate, wormholes, wrecks, turrets, equipment and goods as icons, deep-space sites (the black hole
and the hazards), surfaces (a body's survey image), and portraits of every culture, which appear
everywhere: the advisor, requests, the culture screen, events, station crews.

## Code

`src/sim/` imports `src/core`, `src/art`, `src/world` and the UI kit only (ESLint checks).

| File | What |
| --- | --- |
| `config.js` | the tables: stations, ships, traits, hazards, cultures, the gate, Archive upgrades |
| `world.js` | a system from a seed and a destination's terms (Node) |
| `rules.js` | the state and everything that changes it, cycle by cycle (Node) |
| `events.js` | requests, Drifters, aliens, hazards' pulses (Node) |
| `story.js` | the chapters and their lines |
| `faces.js` | portraits and art thumbnails as images |
| `map.js` | the system on canvas, and the hole's effects |
| `sheets.js` | the bottom sheets |
| `main.js` | the page |

`tests/sim.js` checks the rules in Node; `npm run sim:play` plays systems with a scripted player and
prints when the gate is ready and when it jumps.

## As built (phases 1–7)

All of the above is in. What each phase added is in its commit; the numbers as they stand:

- **The clock.** A cycle is a second at 1× (2× and 4× to hurry, a pause). A system lasts 560 (near),
  700 (mid) or 860 (far) cycles from an empty meter, 28 fewer for every system reached in endless
  (14 in the story), never under 380. Near systems start the meter at 18%, mid at 8%, far at 0.
- **The economy.** The Ark makes a little of everything (1.2 credits a cycle) so nothing stalls for
  good. A rig or siphon makes 0.35 a pip a cycle; a hub trades 0.3 minerals and 0.3 volatiles for
  1.8 credits (half again beside a rig); a lab turns 0.25 volatiles into 0.6 science; a platform
  gives 3 security. Each ship adds half (a patrol adds 2 security), Mk II ×1.6 and Mk III ×2.2.
- **The gate.** Frame (120 minerals, 40 credits), ring (100 minerals, 80 volatiles), core (120
  volatiles, 100 credits), 22% dearer for every system reached (11% in the story). Overcharge
  gains 0.002 a cycle plus 0.006 × the meter²; a full charge makes every choice 20% longer-lived and
  start 10% lower, and is worth 4 Insight.
- **Insight.** One per 40 science, plus the overcharge, finds (ruins), requests that pay it and the
  Shard's boon. The Archive's nine upgrades cost 143 in all.

`npm run sim:play` with its scripted player (no Archive bought, jumping at 60% charge or 88%),
three seeds each:

| | Gate done | Jumped at | Lost |
| --- | --- | --- | --- |
| Endless, systems 1–3 | 26–59% | 53–77% | — |
| Endless, systems 4–8 | 29–94% | 59–94% | most runs end between the 6th and 8th system |
| Story, chapters 1–7 | 18–71% | 45–87% | none: all three seeds win |

So a fair player has the gate around half the meter, and the time from there to the jump is theirs
to spend; endless runs end by the 6th to 8th system until the Archive is built up.

Left for later: sound (the game's Feedback events are emitted for it), a tutorial that points at
the buttons themselves (the advisor's line says what to do next, and the story's openings explain
each culture), and more kinds of request.
