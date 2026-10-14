# Combat: parked alternatives

**Decision (October 2026):** combat starts as pure round-based, stats-driven ("RPG") combat. You engage
an enemy, then both sides trade attacks in rounds, resolved from the loadout's numbers. Flying matters
only before a fight: which fights to take and which to avoid.

This note keeps the two alternatives we considered, for when we want flying to matter during a fight
as well. Both would build on the round-based system rather than replace it.

## Idea A: positional rounds (the middle ground)

Combat still resolves in rounds using the same formulas, but the player keeps flying between them.
At each round, the geometry between the two ships modifies the result:

- **Distance** decides which weapons reach. Each weapon already has a `range` in `loadout.js`.
- **Angle** decides which weapons can fire. This needs a firing arc per weapon: forward guns hit hard
  but only with the target ahead, turrets fire all around but are weaker. That makes the 1–4 weapon
  slots a real choice.
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

- Enemy ships need light steering while engaged: approach to a preferred range, circle, back off at
  low hull. Today NPC ships follow fixed paths computed from time (`Sectors.pose`), so an engaged ship
  has to leave its path and be simulated, and rejoin or be removed afterwards.
- The player needs to see what is in range and in arc, e.g. arc wedges and range rings around the ship.

## Idea B: full real-time combat with automatic fire

Weapons fire on their own at a locked target whenever it is in range and in arc. The player's skill
is entirely positioning.

- **Targeting:** lock the nearest hostile, or whoever shoots you. A tap on a ship targets it. In
  Cruise mode a tap currently means "all stop", so taps on empty space would keep that meaning.
- **Loadout:** weapons with arcs (forward vs turret). The ship computer sets lock time and accuracy,
  and the scanner sets lock range.
- **Damage:** shields absorb hits and recharge after a short pause. Hull damage stays until repaired
  at a station for credits.
- **Escape:** no map travel while hostiles are near, so breaking away means outflying them.
- **AI:** each ship follows its fixed path until engaged, then is simulated with steering behaviour.
  If destroyed, it becomes a wreck with loot and its key is saved so it doesn't respawn (the same
  approach as mined asteroids). If not, it goes back to its path once the player leaves the sector.
- **Visuals:** beams or short projectile streaks, a shield ring flash on hits, the mining debris
  burst for explosions, and edge-of-screen markers for off-screen hostiles. Hit detection can be
  circle checks, since every entity has a `radius`.

Why we parked it: it is the most expensive option (steering AI, readable fights against groups of
3–4 ambushers, mostly testable only by hand), and it needs the movement modes balanced against each
other (below).

## Cruise vs Direct movement

Relevant to both ideas, and worth fixing whenever flying starts to matter in combat:

- **Direct mode ignores the engine's acceleration.** In `update()` (game.js) it eases to the set
  speed at a fixed rate instead of using `SHIP.accel`, and it turns three times faster than Cruise.
  Engine upgrades would barely matter in Direct mode, and instant direction changes make dodging
  slow projectiles trivial.
  Fix: make Direct respect the engine's acceleration and turn rate, and keep it snappier only by
  having less drift.
- **Letting go stops the ship in Direct mode.** An idle ship should turn to face its target, as
  `tickMining` already does for asteroids. Direct then plays as "drag to reposition, let go to plant
  and fire".
- **Prefer hit chance over dodging.** Beams or instant hits with a computed hit chance (range, arc,
  target speed, computer) keep both modes on equal footing. Slow projectiles favour Direct mode's
  reflexes.
- **Tap to target** has no conflict in Direct mode, since a tap there doesn't mean "all stop".

## Carries over from the round-based system

Whatever comes later should reuse these rather than rebuild them:

- Hull points per ship class, the shield model and repair costs.
- Stable keys for NPC ships, destroyed ships as wrecks with loot, and saving which ships were destroyed.
- What happens when the player's ship is lost.
- Faction hostility and reputation, through `canDock` in game.js.
