# Missions

Oct 17, 2026

## Two kinds

- **Story missions** (`story/missions.js` LIST, run by `game/missions.js`): hand-written, the
  waystation's opening chain. Unchanged, except that settling the account ("The remaining
  balance") and the gate mission each raise the waystation's loyalty by 1.
- **Jobs** (`story/jobs.js`, texts in `story/job-texts.js`, run by `game/jobs.js`): grown from the
  galaxy's seed with it, about 200–240 per galaxy. They open once the opening missions are done,
  and those outside the first system once the gates are online.

Both live in the one mission log (`cargo.missions`) and on the station screen's Missions tab.

## Tiers

| Tier | Offered at | Stakes | Title |
| --- | --- | --- | --- |
| Station | that station only | the station's own trouble: its lanes, its stores, its wrecks | `Talixdra Station: Lane patrol` |
| System | every station in the system | the system's local situation (`world/regions.js` SITUATIONS), one job per hook, with sides to take | `Livo: The assessor's rounds` |
| Faction | every station the faction owns | the faction's concern across known space: long, far, well paid | `Meridian Compact: The crackdown` |

Every station outside the tutorial gets one or two station jobs from its type's templates
(capital, major hub, minor station, Facet chapterhouse/sanctum, mining camp, salvage yard,
waystation). Every hook of every situation has its job. Each faction that holds stations
(Compact, Combines, Facet, Free Claim, Breakers, Registry) posts two.

## How a job is built

A job is a list of steps done in order: **go** (reach points, or dock at stations), **fight** (a
wave at a point; a *rushing* wave comes for you once its step opens, out in open space), **take**
(collect items, which take no hold room), **bring** (goods in the hold, handed over), **mine** (rocks
of a type, anywhere) and **gas** (the job's own pockets in a nebula). A job may bring an escort that
flies in formation with you.

Exposition is the briefing; resolution and consequences are the debrief. Comms during a job are
only a step's `say` lines, used for changed plans or a new objective (an ambush, a redirect); a
step with lines can be a *twist*, not listed until it opens.

Delivery jobs (the last step docks at a station, `deliver`) are handed in there; the rest where
they were accepted. Jobs can be abandoned (they start over when taken again) and tracked: the HUD,
edge marker and map follow the tracked job, or the first under way.

## Pay

`Jobs.value`: a tier base, plus the flying (distance in a system, 700 a jump between systems), each
hostile ship by tier^1.5, items, goods at 1.3× their base price, rocks and gas pockets, an escort,
times the tier's factor (and 15% more from hidden factions). Across the test galaxies the medians
are roughly 900 (station), 2,800 (system) and 12,000 (faction) credits. The pirates a job sends
still drop their loot, so a job always beats hunting the same pirates freely.

## Loyalty and consequences

- A station job: +1 at that station (enough to open its production orders).
- A system job: +1 at every station in the system the giver's faction owns; −1 (never below 0) at
  those of the faction it works against.
- A faction job: +1 at every station of that faction.
- A situation's offers from a faction are withdrawn once a job in that situation has been done
  against it.

## Not yet

- Repeatable jobs: the board is fixed per galaxy, so each job can be done once.
- Failure: jobs don't fail (an escort survives your ship's loss, a timer doesn't exist); they can
  only be abandoned.
- Loyalty only gates production; higher levels could unlock more.
