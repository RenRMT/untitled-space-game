# Roadmap: the main game as an offline MMO-like space RPG

Nov 8, 2026


## Context
You asked what the main game (`index.html` / `src/main.js`) still needs to become an **offline, MMO-like space RPG** in the spirit of **Freelancer** (open space, factions, bases, a job board, a story, buying ships and gear by level), **FF12's gambits** (a party fighting on rules you write) and **Hostile Space** (a top-down space MMO with races, classes, stats, skills, psionic abilities, small-team play, gear to engineer). This note is that review.

The repo holds about 31k lines for the main game.

**Out of scope:**
- The race, idle and 4X games are separate games. They stay as they are.
- Both art and UI styles, Line and Low-poly, stay.

**A constraint on cuts:** the idle game runs on shared rule modules: `rules/industry.js`, `recipes.js`, `research.js`, `lab.js`, `restoration.js`, `logistics.js`, `goods.js` and `economy.js`. The race game imports `rules/hazards.js` (in `src/race/career.js`). So when this plan says to "cut" a system from the main game, it means unhooking the main game's wiring and screens from it. The shared `src/rules/` files stay.

---

## 1. What already fits (keep it and build on it)
| Inspiration | Already in the game |
|---|---|
| MMO zones by level | System levels 1–5: Wedge (where you start), then Block/Shard, then the frontier, then the aliens at the galactic core |
| MMO loot | Item level, 5 rarities, affixes, a drop table per source, bad-luck protection, drops biased toward your class (`src/rules/loot.js`). This is very close to best practice. |
| MMO trinity and party | Tank/DPS/Healer with 3 skills each; a squad of up to 3 wingmen (`classes.js`, `abilities.js`, `squad.js`) |
| FF12 gambits | Rules checked top to bottom, the first one that holds runs, and "not ready" skips to the next rule. Shown as instruction cards (`src/rules/logic.js`). This is a faithful design. |
| FF12 / ATB combat | An action timeline with telegraphed attacks, a heavy shot cancelled when its shields break, and ships still flying (`src/combat/combat.js`). The research behind it is solid (`notes/combat-research.md`). |
| Freelancer | Faction territories, jump gates, a job board at every station, reputation that ripples between factions, shipyards at capitals |
| MMO dungeons | Planet labyrinths with a Warden boss at the end, scaled by level (`src/game/dungeon.js`) |

The core combat loop (fight → loot → gear up → push into harder space) is in place. Most of what's missing is **progression, the feeling of a living world, and story**, not more systems.

## 2. What still needs to change (priority order)
1. **Character progression. This is the biggest gap.** Power comes only from gear. Every MMO, and Hostile Space in particular (stats, skills, classes), gives XP and levels, and Freelancer also limited ships and gear by level. Add:
   - pilot XP from kills, contracts and the Warden, and a pilot level;
   - a few skill or talent choices per class at each level (this replaces the hull refits and research stat bumps);
   - a level requirement on gear and ships, so that levels and system levels drive the pace.
   - Wingmen level up too, so they feel like party members rather than equipment.
2. **Gambits as rewards rather than research.** In FF12 you buy gambits at shops and find them in chests. Here a real-time lab unlocks them, which is an idle-game mechanic. Instead:
   - sell gambits at station vendors and drop them from dungeons and the Warden;
   - add more gambit slots as a level reward.
   - Add the conditions your own combat design calls for: "enemy is charging a heavy shot" (so wingmen can cancel it, as noted under Later in `combat-research.md`), "has status", "is taunted".
   - Optionally, let the player's own ship run gambits too (autopilot combat). That is very FF12, and it fits an offline game played in short sessions.
3. **A world that feels like an MMO.** An offline MMO-like game has to fake a population. NPC traffic was taken out (`notes/archived-systems.md`). Bring back:
   - named NPC pilots, freighters and faction patrols that join fights;
   - roaming rare elites (MMO "rares") with their own loot tables;
   - world events: a siege on a station that anyone nearby can join, or a raid on a convoy.
4. **A story spine.** Freelancer is driven by its story. The opening missions were removed. Add a short main quest per tier of the galaxy that drives you out from Wedge to the core and ends against the aliens. It can reuse the steps that jobs already support (go, fight, take, bring). (`notes/factions.md` is outdated: the story follows the factions' basic ideas instead. Wedge: security and order, but restrictive. Block: industry and progress, with little regard for human safety. Shard: scientific progress and research, held as a religious belief. Drifters: freedom and independence at any price. Aliens: inscrutable, running on a logic clearly unlike humans'. Androids: true neutral, at risk of apathy.)
5. **Contracts need variety and repetition.** They are combat-only and the board is fixed for each galaxy. Add:
   - repeatable bounties on named elites;
   - escort and convoy jobs (they need NPC traffic);
   - daily rotating contracts, a common MMO retention pattern that also suits an offline game.
6. **Pick one combat mode.** Keep the timeline mode. It ties into telegraphs, cancels and gambits. Remove Active/real time, or keep it only as the engine that mining uses internally.
7. **Something to spend credits on.** With industry gone (see section 3), give credits clear uses:
   - hulls, which already exist at shipyards, gated by level;
   - repairs;
   - gambits and skill resets;
   - wingman hires and upgrades;
   - optionally, upgrading a dropped item's rarity or rerolling an affix (a light MMO crafting step that uses salvage).
8. **Death and risk rules.** Decide what losing a fight costs: a repair bill, dropping some cargo, or respawning at the last dock. Make it a little harsher in lawless and higher-level space.

## 3. What to remove (doesn't serve the loop)
The loop to protect: **take a contract → fly out → fight with a squad on gambits → loot → level up and gear up → push into higher-level space and dungeons → follow the story.**

**Remove from the repo**
- **The Python wheels in the repo root** (playwright 48 MB, greenlet, pyee, typing_extensions) and the stray `flight.png`. Playwright is already preinstalled, and nothing in the repo references these files.

**Cut from the main game (unhook it; the shared rule modules stay for the idle game)**
- **Industry, production orders, logistics routes and haulers, station restoration.** In the main game this is a factory and data-pipeline game. It competes with loot as the way to get gear, and it isn't a fit for Freelancer, FF12 or an MMO combat loop. It already lives on as the idle game, which is where it belongs.
  - Remove: `game/industry.js`, `game/restoration.js`, `ui/industry-view.js`, the Production tab, and the station stock in `station.js`.
  - If you want crafting, replace it with salvage turned into upgrades or rerolls (see section 2, item 7).
- **The real-time research lab in the main game.** Gambits move to vendors and loot, and refits move to talents.
  - Remove: `game/lab.js`, `ui/research-view.js` and the Research tab. `rules/research.js` and `rules/lab.js` stay for the idle game.
  - Real-time timers that run while the game is closed are idle-game patterns. Also drop or shorten the 20- and 90-minute rebuild of turrets and stations.
- **Hazards, already switched off:** heat, radiation, flares, ion storms, fuel, landing sites (`?hazards`, `?sites`).
  - Remove: `game/hazards.js`, `surface-run.js`, the `hazardsOn` branches in the main game, and the field consumables (coolant, radiation purge, fuel canister, seismic charge).
  - Keep `rules/hazards.js`, because the race game imports it. The archive branch already keeps everything else.
  - Also cut the dash (it costs fuel) unless combat needs a dodge.
- **The Active (real-time) combat mode**, as a player option (see section 2, item 6).
- **Deep-space sites that "find nothing yet".** Keep them on the map as scenery, or give each a purpose (a rare elite, a hidden dungeon, a story beat). Stop building their art until then.

**Make smaller**
- **Mining.** Hostile Space and Freelancer both had mining, but here it's a timed action that mostly fed industry. With industry gone, either drop it or keep it as a small income loop for credits and upgrade materials. **This is your decision.**
- **Trade.** It's already down to one good per category. Keep it as a simple Freelancer-style trade-run option for credits, without production stages.

## 4. Suggested order of work
1. Clean up: remove the wheels, keep one combat mode, delete the main game's hazards code.
2. Unhook industry and the research lab from the main game. Move gambit unlocks to vendors and loot. Check that the idle and race games still pass their tests.
3. Add pilot and wingman XP, levels, talents and level-gated gear.
4. Bring back NPC traffic, rare elites and world events.
5. Write the main story line and repeatable or daily contracts.

## Verification
Each cleanup PR later runs `npm test` and `npm run lint` (CI). The smoke tests (`tests/smoke.js`) exercise industry, research and hazards, so they will need to be trimmed along with that code. The idle game's tests (`tests/run.js`, `npm run idle:sim`) and the race's service-worker check must keep passing.

Sources: [Hostile Space Revived wiki](https://hostilespace.fandom.com/wiki/Hostile_Space_Wiki?oldid=4075), [Hostile Space (Wikipedia mirror)](https://wikipedia2007.classicistranieri.com/h/o/s/Hostile_Space_a4d9.html), [GameSpot beta article](https://gamespot.com/articles/hostile-space-closed-beta-begins/1100-2876246/). Also `notes/combat-research.md` (ATB, Grandia and Into the Breach sources).
