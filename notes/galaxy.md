# The galaxy

The play area is a **barred spiral galaxy** grown from the seed: about forty star systems along its
arms, and between them the deep-space sites and fields that make the space between the systems a
place. It is grounded in what real galaxies hold, not a model of one: each kind of place lives where
its real counterpart tends to, at sizes a game can use. The code:

- `src/world/galaxy-shape.js`: the shape (a density field) and its zones,
- `src/world/galaxy.js`: where the systems go, what each is made of, the gate links, and the merged
  galaxy object everything else reads,
- `src/world/deep-space.js`: the deep-space sites and the galaxy-wide fields,
- `src/ui/map.js`: the galaxy view,
- `src/rules/knowledge.js`: which systems are charted and which dark sites have been found.

To see what a seed gives, run `npm run galaxy -- <seed>`; add `--svg <file>` to draw it.

## Scale

Distances are what make a galaxy feel vast, so they are large, but a game has to cross them.

| | World units | In play |
| --- | --- | --- |
| A system's radius | 40,000 (the start: 40,000) | the flight view's whole play area, as before |
| Disc radius `R` | 1,600,000 | the start lies at 0.75 R; rim to core is about 10 minutes of cruise, 2.5 fast-forwarded |
| Between system centres | at least 170,000 | at least 90,000 of empty space between edges; on an arm the nearest neighbour is usually 180,000–260,000 away, a minute or two of cruise |
| A site from a system's edge | at least 25,000 | sites never crowd a system |
| The black hole's clear zone | 120,000 | only the core's own sites inside it |

Map travel burns one fuel per 8,000 units (`Hazards.config.fuel.travel`): a courier's tank of 100
cruises half the disc's radius, so a hop to a neighbouring system takes about a third of it and the
core is more than a tank away. The gates are the cheap way.

## The shape

`GalaxyShape.create(seed)` picks, from the seed: the disc's rotation and which way the arms wind, the
bar's angle and length (half of it 0.24–0.3 R), and the arms' pitch (11–15°). Two **major arms** rise
from the bar's two ends as logarithmic spirals out to the rim; up to two **spurs** branch off them
part-way out. `density(x, y)` adds a bulge round the centre, the bar, a thin disc fading at the rim,
and each arm (strongest along its spine, fading in at its root and out at its tip).

`zoneAt(x, y)` says where a point is:

| Zone | Where |
| --- | --- |
| `core` | within 0.13 R of the centre |
| `bar` | along the bar |
| `arm` | on an arm, with its `side`: `inner` (the trailing edge, where the dust lanes run) or `outer` (the leading edge, where stars are born) |
| `interarm` | between the arms |
| `rim` | past 0.88 R, off the arms |
| `halo` | past the disc, beyond 1.02 R |

## The systems

The start (system 0) is placed first: on a major arm's spine, 0.75 R out. It is the showcase it
always was (one of each planet and moon type, one of each station, a field and a nebula, the
waystation where the game starts), so its keys keep no prefix. The others are drawn from the density
(so the arms fill first), at least 170,000 apart and 240,000 from the centre, until there are forty.

Each is a `SolarSystem.generate` from its own seed, with params for its zone (`Galaxy.params.zones`):

| Zone | Stars | Nebulae | Planets |
| --- | --- | --- | --- |
| Core, bar | old: M, K, some G | 0–1 | as usual |
| Arm, leading edge | young: B, A, G | 2–3 | as usual |
| Arm, trailing edge | mixed | 1–2 | as usual |
| Between the arms | G, K, M | 0–1 | as usual |
| Rim | mostly M | 0–1 | 3–5 |

**The habitable band.** Between 0.45 R and 0.86 R, off the core and the bar, systems are **settled**:
a capital, a major hub, a minor station or two, a mining camp, sometimes a salvage yard. Outside it,
in the hot crowded centre or out at the thin rim, they are **frontier**: no capital or hub, a station
or none, more derelicts. Each system says which (`settled`) and its region says where (the arm's name,
or the zone's: "Cinder Arm · settled", "Outer rim · frontier").

Hostile packs are placed by territory and level (below).

## Territories and gates

Who holds each system (`Galaxy.generate`, "Territories"):

- **Wedge, Block and Shard** split the settled band (0.45–0.86 R, off the core and the bar) into three
  contiguous territories by angle round the centre: the third of those systems nearest the start's
  angle are Wedge's, the rest split either side, Block one way and Shard the other. Their stations are
  built in their culture (salvage yards the Drifters', the waystation the Androids').
- **The aliens** hold the systems furthest in (at least three, up to six while they're in the core or
  the bar): no stations, lawless, more wrecks. The end game.
- **The Drifters and the Androids** hold the rest of the frontier (about three Drifter systems to two
  Android ones): a few kitbashed stations and a yard, or one android station. Their security is never
  more than low (`params.security.cap`).

Each system has a `level` (1..5): Wedge 1, Block and Shard 2, outside 3 (4 beyond the median
distance from the start), the aliens 5. Hostile packs (`Galaxy.params.hostiles`) lie in each system's
low and lawless space, never in high, their gear tier the level (a step up now and then in lawless
space: `Security.levelTier`); in the aliens' systems they are alien ships.

Gates join the territories only:

1. **Inside each territory** its systems are joined by the shortest links that join them all (a
   minimum spanning tree), so every system of a territory is reachable by gate.
2. **Between territories** one link joins each pair, at their nearest systems: three in all.

The outside and alien systems have none: they're reached by cruising. There is no wormhole.

## Deep space

`DeepSpace.generate` places the sites after the systems, clear of them, each in the zones its kind
grows in (`DeepSpace.KINDS`). **Luminous** sites (marked ☀ below) are on the chart from the start;
**dark** ones are found by sensors: identified within 15,000 units of their reach and pinged within
60,000, further with a better scanner (`Knowledge.SITE`), and pinged along a cruise as it passes.

| Site | Where | Count | What it holds for later |
| --- | --- | --- | --- |
| ☀ Supermassive black hole ("Core A*") | the centre | 1 | its accretion disc, horizon, and a jet along an axis |
| ☀ Nuclear star cluster | round the black hole | 1 | the densest crowd of old stars |
| ☀ H II region | arms, leading edge | 3–5 | a glowing gas cloud of blobs, with Bok globules and young discs inside |
| Bok globule | inside H II regions | 1–3 each | small, very dark clouds |
| Protoplanetary disc | inside H II regions | 1–2 | a young star, its planets still forming (proplyds) |
| Giant molecular cloud | arms, trailing edge; between the arms | 3–5 | cold dense gas: dusty, and it shields from cosmic rays |
| ☀ Open cluster | arms, leading edge | 2–4 | 5–12 young blue stars together |
| ☀ Globular cluster | the halo | 2–3 | hundreds of old stars, maybe a millisecond pulsar |
| ☀ Supernova remnant | arms, the bar | 2–3 | an expanding shell, a pulsar or neutron star at its heart |
| ☀ Pulsar | in remnants and globulars | — | a sweeping beam (`DeepSpace.phase`: its angle at t) |
| Neutron star | the bar, between the arms | 1–2 | a magnetic field |
| ☀ Magnetar | arms, the bar | 1 | an extreme field and its reach |
| Stellar-mass black hole | the bar, between the arms | 2–3 | its mass and horizon |
| ☀ Microquasar | the bar, arms | 1 | a black hole feeding on a companion, its jet precessing |
| White dwarf | between the arms, the rim | 3–5 | 40% with a planetary nebula ring (☀ on the map as a ring) |
| ☀ Recurrent nova | between the arms, the bar | 1–2 | a white dwarf that bursts on a seeded timer |
| Kilonova remnant | between the arms, the bar, the rim | 1–2 | where neutron stars merged: gold, platinum, iridium |
| ☀ Wolf–Rayet star | arms, leading edge | 1–3 | a massive star blowing a bubble with a fierce wind |
| ☀ Cepheid variable | arms, between them | 2–3 | a star pulsing on a strict period: a beacon |
| Brown dwarf | between the arms, the rim | 4–6 | a failed star (L, T or Y), 0–2 moons |
| Rogue planet | the rim, between the arms, the halo | 4–6 | an ice or dark world, maybe a moon, maybe an ocean under the ice |
| Interstellar object | crossing the disc | 2–4 | moving: in from outside and out again (`DeepSpace.positionAt`) |
| ☀ Hypervelocity star | out from the core | 1 | moving: flung from the centre past the rim |
| ☀ Stellar stream | the halo | 1 | an arc of old stars from a torn-up cluster |
| ☀ Dwarf galaxy | beyond the rim | 1 | a small galaxy orbiting ours: a landmark |

Moving sites run on the real clock (seconds since 1970), so they are where they are whenever the
map opens; their paths never come within 1.5 system radii of a star.

## Fields

`galaxy.space` holds three galaxy-wide lookups, cheap enough for a frame, and `regionAt(x, y)`
returns them with the zone, arm and site there:

- **`mediumAt`**: the interstellar medium's density (0..1) and its phase: `molecular` in the clouds
  and the central molecular zone (a dense ring round the core), `warm` in the H II regions, `hot` in
  the core and the remnants, `void` in the superbubbles (hot near-empty cavities between the arms),
  else `cold` or `warm` by density.
- **`dustAt`**: high in the lanes along the arms' trailing edges, in the clouds and the central ring,
  low in the superbubbles.
- **`cosmicRaysAt`**: a background, strongest toward the core and in the two Fermi lobes either side
  of it, round the remnants, pulsars, magnetars and microquasars, and in the black hole's jet;
  higher in the superbubbles and cut by the shielding inside dense clouds.

## The galaxy map

The galaxy view draws the shape once to a layer of its own (its glow, warm at the core and blue on
the arms, darkened by the dust; fading as the view closes in), every system's star (a faint dot until
charted, then in its class's colour with its name), the gate links (wormholes violet), and the sites
the player knows of (a '?' for a pinged dark one). Site names show as the view zooms in, the
landmarks' always. Selecting a site or any point shows where it is in the galaxy and the fields
there, and Travel goes there (to a small site's edge). `?dev` shows every site and its F key cycles
an overlay of each field.

## In flight

Each system's hazards (heat, belts, moons, flares) are its own: `galaxy.placeAt(x, y)` gives the
system a point is in, and deep space has no star, so no heat and no flares. The flight scene builds
every system's bodies, stations and gates up front, and its rocks, pockets, wrecks and pirates when
the camera first comes near it (`Scene`: `ensure`, `ensureAll`), with the same keys whatever the
order.

## Later

(Built since: every site holds a find, made by scanning it from close by: `rules/survey.js`, `game/sites.js`.)

- Flight art for each kind of site, and the galaxy's glow in the flight view's sky.
- Mechanics on the fields: dust cuts sensor range, cosmic rays add to the radiation meter, the
  molecular clouds hide and shield.
- Moving hazards: pulsar beams and jets sweeping, a recurrent nova's burst, a Wolf–Rayet's wind
  (the ion storm's push).
- Places to land and mine: rogue planets, brown dwarfs' moons, kilonova debris rich in heavy metals,
  protoplanetary discs dense with rock.
- More from the research behind this: S-stars round the black hole, red supergiants and carbon
  stars, binary and circumbinary systems, polluted white dwarfs, Oort clouds and Trojans inside
  systems, high-velocity clouds at the rim.

# The factions in the galaxy (as it was)

> **Pared back (October 2026):** the factions, regions and local situations below are archived; see
> `notes/archived-systems.md`. What follows describes how they were placed in the galaxy before it
> became a spiral.


How the sixteen factions of `notes/factions.md` are placed in a generated galaxy. The code is
`src/world/factions.js` (the factions and the standing matrix), `src/world/regions.js` (regions,
routes, station owners and local situations) and `src/world/galaxy.js` (the map). To see what a
seed gives, run `npm run galaxy -- <seed>`: every system with its region, holder, factions,
stations, gates and situations.

The story beats in `notes/factions.md` are not in the game yet. The world is the one at the start
of the game.

## The tutorial system

The first system is the one the seed always gave: the waystation HD-1863, one planet, a belt, a
nebula and a gate, generated from the seed itself at the origin, with its gate pointing where it
always pointed. Nothing that grows the rest of the galaxy touches it (a test checks it against the
system generated on its own). Its one gate leads to the **gateway**, a small Spoke frontier colony
on the galaxy's rim, which always has the next waystation, HD-1908 (the opening missions name it).

## Regions

The galaxy grows on a hex lattice from the Compact's capital, one system at a time, each beside a
system of a region it may grow from. A spot scores for how far out its region lies, for lying
toward its region's side of the galaxy (the Compact's spokes one way, the Combines another, the
Facet a third) and for keeping close to its own kind, so the core and the Facet stay compact and
the frontier stays thin. Between 14 and 20 systems.

| Region | Held by | Grows from | What it is |
| --- | --- | --- | --- |
| Compact capital | Meridian Compact | — | the hub: the largest system, low piracy, Collegium labs, Union bays |
| Compact core | Meridian Compact | capital, core | the contiguous, patrolled core |
| Company system | Lattice Combines | capital, core, company | one of Hadal, Tessaro or Corvane runs it; Union crews, Blackline and Scorched hiding among them |
| Facet see | The Facet | core, capital, see | small and concentrated, nebulae close in, few waystations (pilgrims avoid the "cold houses") |
| Spoke colony | Meridian Compact | core, capital, spoke | outer colonies: pirates, the Broken Wheel, Free Claim, the levy fight |
| Claim belt | no one | company, spoke, claim belt | belts and fields of Free Claim and Hadal camps, low security |
| Pilgrim nebula | no one | see, pilgrim nebula | nebula-heavy: Facet hermitages, Hadal gas harvesting, ambush crews and the hidden Thren |
| Lawless reach | no one | spoke, claims, nebula, reach | the edge: pirates, wreck fields, waystations, whoever hides there |
| Spoke frontier (gateway) | Meridian Compact | spoke | the tutorial's neighbour, on the rim |
| Waystation reach (tutorial) | The Registry | gateway | HD-1863, alone |

Each region sets its systems' size, stations, nebulae, security and pirates (`params`), who owns
which stations (`owners`), who is always or sometimes there (`present`, `maybe`) and its chance of
a waystation.

## Routes

Every system is linked to the one it grew from. Neighbours are then linked by chance along the
routes their regions share (`Regions.LINKS`): the core is densely linked, company systems link to
the core and to the claim belts their haulage runs through, the sees link to each other and out
along the pilgrim routes into the nebulae, and the frontier regions link to each other and to the
reaches. Some pairs are never linked directly: the core does not open onto lawless space, and the
Facet keeps its sees apart from company space. Each region caps how many gates one of its systems may have.

## Stations and gates

Every station has an `owner`: the capital its holder's, a salvage yard the Breakers' Guild's, a
waystation the Registry's, and the rest by the region's tables. A station is built in its owner's
culture (Compact wedge, Combines block, Facet shard, Registry android), or the region's where the
owner has none of its own (Free Claim, the Breakers). Some are renamed to match: a Facet station is
a chapterhouse (a hermitage in the nebulae), a Combine port a depot, a company capital an exchange,
a Facet one a sanctum. Jump gates are built in the culture of whoever holds the system.

The station's card in flight and the station screen say who owns it; the galaxy map says who holds
each charted system.

## Factions present

A system's `factions` are its holder, its station owners, its region's regulars and everyone its
situations name. Factions whose places are never on a chart (the Broken Wheel, the Scorched,
Blackline, the Unfaceted, pirates, the Thren, the Remainder) are marked `hidden`. The Remainder is
in no system at the start: it returns with the story.

## Local situations

Each system has one situation, often two, picked from those its region can have
(`Regions.SITUATIONS`), preferring ones not yet used elsewhere in the galaxy. Each comes from the
factions' concerns before the story starts: the levy stand-off, the strike vote, the Lapidary
scandal, Tessaro's standing order for android cores, pilgrims lost in the gas. Its text names the
system's own stations, nebulae and neighbours, and it has two or three mission hooks: who would
put the player to work, at what, and against whom. The hooks are not missions yet; they are what
the mission system can be built out from.

## Ideas not done yet

- The player's standing with each faction, and the ripple rule (`notes/factions.md`).
- Missions from the hooks: a hook's giver at a station they own, its target a faction there.
- Ships of the factions in space: patrols, freighters, Blackline crews, Scorched raiders.
