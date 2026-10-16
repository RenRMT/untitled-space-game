# Combat: the alternatives

**Decision (October 2026):** combat started as pure round-based, stats-driven ("RPG") combat
(`combat/combat.js`). You engage an enemy, then both sides trade attacks in rounds, resolved from the
loadout's numbers. Flying matters only before a fight: which fights to take and which to avoid.

**Update (October 2026):** Idea B below is now built as an alternative, `combat/combat-realtime.js`. The
**Combat** setting chooses between **Rounds** (the default) and **Real-time**. Idea A stays parked.
The Direct-mode fixes from "Cruise vs Direct movement" are done too, for all flying.

## Idea A: positional rounds (the middle ground) — parked

Combat still resolves in rounds using the same formulas, but the player keeps flying between them.
At each round, the geometry between the two ships modifies the result:

- **Distance** decides which weapons reach. Each weapon already has a `range` in `rules/loadout.js`.
- **Angle** decides which weapons can fire. Weapons now have a firing arc (`arc` in `rules/loadout.js`):
  forward guns hit hard but only with the target ahead, turrets fire all around but are weaker.
  That makes the 1–4 weapon slots a real choice.
- **Relative speed** lowers the hit chance, offset by the ship computer's accuracy.
- **Fleeing** means pulling out of every enemy weapon's range and staying out for a round or two.

Why it's attractive:

- Closing in, keeping a damaged target in your forward arc and running away are all things the
  player does by flying.
- It works the same in Cruise and Direct movement, because only the position at each round counts,
  not how you got there.
- The round resolver stays a pure, testable function; geometry is just one more input,
  e.g. `{ distance, angleOff, relativeSpeed }`.

What it costs:

- Enemy ships need light steering while engaged. The real-time mode's steering
  (`combat/combat-realtime.js`) could be reused.
- The player needs to see what is in range and in arc. The real-time mode's field-of-fire wedge
  could be reused.

## Idea B: full real-time combat with automatic fire — built as the Real-time setting

Weapons fire on their own at a locked target whenever it is in range and in arc. The player's skill
is entirely positioning. As built:

- **Targeting:** the attacked ship, or in an ambush the nearest enemy. Whoever shot you last is
  preferred while in lock range. A tap on a ship, its row on the combat panel or its edge marker
  targets it. A tap on empty space still means "all stop" in Cruise mode.
- **Locking:** a new target takes the ship computer's `lockTime` to lock (1 s for the Courier),
  within the scanner's `lockRange` (1.6k). Enemies lock onto you the same way.
- **Loadout:** weapons have a `range` and an `arc`. The pulse laser and autocannon are forward guns
  (60° and 40°). Freighters carry a turret (360°) with the same numbers their autocannon had, so
  round-based fights don't change.
- **Hit chance:** shots are instant beams, hit or miss.
  - The chance is accuracy − evasion, minus a penalty for target speed across the line of fire and
    one toward the end of the weapon's range.
  - Evasion counts in full from half top speed, and not at all at rest.
  - So sitting still makes you easy to hit, and moving across an enemy's guns is how you dodge.
- **Damage:** shields absorb hits and recharge after 3 s without being hit. Hull damage stays until
  repaired at a station.
- **AI:** fighters make attack runs: run in, brake inside gun range, edge in with guns on target,
  break off when close, veer away and come round again. Ships with turrets hold off at about
  two-thirds of their range and circle. Pirates flying into range join the fight.
- **Escape:** stay clear of every enemy's guns for 3 s. Pirates stop chasing 2,400 units from where
  the fight started, so flying straight out works; flying away under fire costs some shields.
  Gates and map travel are locked while fighting. Survivors fly back to their usual paths, then
  carry on along them.
- **Visuals:**
  - A dashed wedge ahead of the ship shows the guns' field of fire, brighter while the locked target
    is in it.
  - Brackets on the target close in as the lock comes on.
  - A faint red line runs from every enemy that has you in its sights.
  - Off-screen enemies get red edge markers.
  - Damage numbers add up while a ship keeps taking hits.
- **Balance:** checked by simulation in `tests/run.js`, like the round-based fights. A Courier that
  sits and turns to face its target wins easily against one fighter, at a cost against two, mostly
  loses against three and loses against four. Flying well does better: chasing the target in
  Direct mode wins about half the fights against three.

## Cruise vs Direct movement — done

These mattered once flying counts in combat. All of them are now in place, for all flying:

- **Direct mode respects the engine.** It used to ease to the set speed at a fixed rate and turn
  three times faster than Cruise. Both modes now share `flight/flight.js`: speed changes at the engine's
  acceleration and turning at its turn rate. Direct stays snappier only by having no drift.
- **An idle ship faces its target in a fight.** In a real-time fight, a ship that isn't steering
  turns to face its target, as mining does for asteroids. Direct plays as "drag to reposition, let
  go to plant and fire"; in Cruise, tap empty space to stop and fire.
- **Hit chance rather than dodging.** Beams hit instantly, with a chance computed from range, arc,
  target speed and the computer. That keeps both movement modes on equal footing.
- **Tap to target** works in both modes.

## Carried over from the round-based system

Both modes share:

- Hull points per ship class, shields and repair costs.
- Stable keys for NPC ships, destroyed ships as wrecks with loot, and saving which ships were destroyed.
- What happens when the player's ship is lost.
- Faction hostility and reputation, through `canDock` in game/docking.js.
