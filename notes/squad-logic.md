# Squad logic: programs, research and (later) abilities

**Decision (October 2026):** squad members are programmed gambit style, like Final Fantasy XII:
each runs a short program of lines (`rules/logic.js`), top down, and does what the first line
that holds says; with none, it keeps formation. Lines are built by tapping choices in the Squad
tab, never typed.

**Update (October 2026):** pseudo-code put some players off, so the Squad tab shows and edits each
line as an **instruction card**: plain-word chips with control-flow badges and symbol operators.

    IF    [Enemy] [Hull] [< 30%]
    AND   NOT [Enemy] [is targeting] [Leader]
    THEN  ▶ [Attack] [weakest Enemy]
    ELSE  ▶ Follow leader

In combat, wingmen still show the line they are running as code, for flavour
(`L2 › attack(weakest(enemy))`), and research keeps its package names (`import combat.select@1.0`).
Both views come from the same line data: `Logic.rows`/`Logic.say` for the cards,
`Logic.tokens`/`Logic.text` for the code.

The Research tab no longer unlocks gear. Its Logic group builds **logic packages** (`rules/research.js`), shown
as imports (`import combat.select@1.0`). Each package unlocks building blocks (subjects, picks,
conditions, keywords, actions) or more program lines (`mem.ext`). Packages are paid for when
queued and take real time, which keeps running while the game is closed. Gear is now sold by
station outfitters and found as schematics on pirates. Hull refits are researched in the same lab
(the Hull group; see `industry.md`).

## Categories

- **Core:** the language: `and`/`not`, `or`, memory for more lines.
- **Combat:** who to target and how: picks (nearest, weakest, strongest), threat
  (`enemy.targeting(...)`), range (`distance`, `keepRange()`), ship class.
- **Tactics:** reading the fight (`fight.enemies`, `fight.allies`), and later when to use crowd
  control and debuffs.
- **Maintenance:** self-preservation and support: hull and shield %, the ally subject,
  `guard()`, `retreat()`, and later buffs and repairs.

## Abilities are not logic

*Built: abilities are consumables industry makes (`rules/abilities.js`, see `industry.md` phase 7);
energy was left out, a charge per use and a cooldown do its job.*

**Decision:** logic modules only decide; they never grant abilities. Abilities (crowd control,
debuffs, repairs, boosts) must be open to the player too, so they will come from somewhere else,
most likely **gear**. Logic has a seam ready for them:

- `use(skill)` is an action (package `tactics.use`, hidden until abilities exist). A `use` line runs
  only when `ctx.ready(skill, target)` says the ability is ready. Otherwise the next line runs, like
  FF12's "not enough MP".
- `game/squad.js logicContext` gives `ready` (always false for now). Whatever grants abilities
  supplies `ready`, the abilities a ship has, and a `cast` step in both combat modes.

Ideas kept for that system:

- **Energy:** a capacitor per ship (from the ship computer), full at the start of a fight and
  regenerating during it. Abilities cost energy and have a cooldown.
- **Status effects:** timed changes to a combatant's stats (jam: −accuracy; slow: ×speed and
  evasion; EMP: disabled, with immunity afterwards so a squad can't lock a target down; boost;
  mark: +accuracy against the target). These rebuild `c.stats` from a base copy, so the existing
  hit chance, steering and shield code would not need to change. Rounds mode counts a round as 1.5 s.
- **Instant effects:** repair (hull up to its maximum, written back by `syncAllies`) and shield restore.
- **Logic for it:** a `has(status)` condition and a `disabled` flag, as a tactics package.
