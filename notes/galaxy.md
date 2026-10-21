# The galaxy and its factions

> **Pared back (October 2026):** the galaxy is one showcase system for now, without regions or local situations; see `notes/archived-systems.md`. What follows describes the galaxy as it was.

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
