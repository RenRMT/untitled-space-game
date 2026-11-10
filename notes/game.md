# The main game, system by system

(Moved from the README. `notes/review.md` is the review most of it came from.)

A browser space RPG: fly a ship through a procedurally generated galaxy, mine, fight, take loot from
what you destroy, and push out from the safe core of your faction's space into harder systems.

- **Factions.** Three human factions hold the settled band of the galaxy, each its own contiguous
  territory: Wedge (where the game starts), Block and Shard. Inside a territory every system is joined
  by jump gates; between territories there is one gate link per pair. Outside them, in the frontier,
  are the Drifters and the Androids, reached by cruising; the aliens hold the most remote systems, by
  the galactic core, the end game. Each system has a level (1 in Wedge space, 2 in Block and Shard, 3–4
  outside, 5 the aliens'), shown on the map.
- **Fighting and loot.** Hostile ships (Drifter raiders, or the aliens in their space) wait in packs
  in low and lawless security, never in high; their gear follows the system's level. Destroyed ones
  pay their cargo as credits and now and then leave gear to pick up, or a gambit. Fights are turn-based on a
  timeline (`src/combat/combat.js`, `notes/combat-research.md`): every ship flies on and acts when
  its gauge fills; enemies show what they're charging and at whom, and taking a ship's shields down
  knocks it back and cancels a heavy shot. It's all drawn round the ships, with only a skill bar
  below; tap a ship to target it. It's the one combat mode. The bar under a fight has a frame for
  your ship's hull and shields and one per squad member, over thumb-sized skill buttons; a fight
  won, a ship lost and a level reached each get a banner across the view. Every hostile on screen
  carries its level, coloured by how a fight with its pack would go (green, amber, red), before
  the fight starts; hostiles are sturdier and hit softer than their gear alone says (`FOE`,
  `src/game/combat.js`), and the start system has no ambushes and no pack above its level.
  Fights play the same in space and on a surface, and the ship flies there as fast as in space.
- **Classes and skills.** The ship, and each squad member, is a Tank, DPS or Healer
  (`src/rules/classes.js`), picked at a dock. Each class has four skills (`src/rules/abilities.js`),
  each with an activation time and a cooldown: keys 1–4 or the skill bar's buttons in a fight. They
  open one at a time, at levels 1, 2, 4 and 10, for the pilot and the squad alike. The fourth gives
  the class a second job: Aegis (Tank) cuts the damage its whole side takes, Barrage (DPS) hits
  every enemy at once, Disrupt (Healer) silences a ship's guns and cancels its heavy shot.
- **A living galaxy.** The system the ship is in has traffic (`src/game/traffic.js`): freighters
  plying between its stations, and patrols of named pilots circling them, who join a fight against
  hostiles nearby unless their faction counts you Hostile. Every system of level 2 and up has a named
  elite pirate, much tougher than its pack, with its own loot (Rare or better), a gambit and a
  bounty; another comes after two hours. Now and then raiders come for a station: destroy them for a
  bounty, experience and gear, or they withdraw.
- **Levels and talents.** The pilot earns experience from what's destroyed (less for easy kills,
  none far below you), contracts by their difficulty and every Warden; the squad learns alongside.
  Levels go to 30, each a little sturdier and harder hitting; every third gives a talent point,
  spent on the Ship tab (more hold, armour or a weapon mount on every hull, or sharper class
  skills: `src/rules/progress.js`, `src/game/progress.js`). Two talents for each class are perks
  that change what a skill does: a Tank's Taunt exposes every enemy, or its guns hit harder while
  fortified; a DPS's Salvo finishes weakened ships or comes straight back after a kill; a Healer's
  repairs spill into shields or leave the mended ship hitting harder. There are more talents than
  points, so a build is a choice. Gear asks for a level (loot by its item
  level, Mk by Mk), hulls too, and levels 10 and 20 add program memory. A lost ship is towed home for
  a bill, more the further out it was lost.
- **The squad.** Wingmen are hired at a dock (Ship tab), up to three, each with a class. They fight by
  their programs (instruction cards, `src/rules/logic.js`), which can use their class's skills; each
  class starts with a program that does. A program is built from **gambits**, FF12 style: the
  building blocks (conditions such as "is charging a heavy shot" or "has Taunt", picks, actions,
  more memory; named in plain words: And · Not, Pick a target, Memory I), bought at any station's outfitter (better ones further out) or found on pirates
  and Wardens (`src/rules/vendor.js`, `src/game/vendor.js`).
- **The outfitter.** Every station's Outfitter tab sells gambits up to its system's level, a stock of
  gear rolled like loot (Common and Uncommon, Rare at a capital) that turns over every day,
  consumables, and at capitals and major stations mods. Hulls are at a capital's shipyard.
- **Dungeons.** Landing on any planet or moon puts the ship in a labyrinth cut into its own ground
  (canyons on a desert world, ice caves, lava tubes, a storm maze on a gas giant, crater mazes on moons)
  (`src/game/dungeon.js`): turrets that never move and raiders that patrol and chase hold the
  chambers, a Warden (a heavy ship) the deepest, harder the higher the system's level, with loot,
  gear, a bounty and a gambit for the Warden. The squad lands with the ship, follows its trail through the
  caverns and fights beside it (`src/game/surface-squad.js`); walls stop every ship in a fight.
- **Stations and turrets.** Every station holds 0–3 turrets in orbit round it, more in high
  security and in harder systems (`src/rules/structures.js`). Every man-made thing can be attacked
  and destroyed: turrets are tougher than ships, stations tougher still (`src/game/structures.js`).
  A station and its turrets fight as one. Attacking a faction's station warns first, then costs
  regard with it and keeps that station hostile for the session; a faction that counts you Hostile
  has its turrets open fire on sight. Destroyed, a faction's turret or station is a wreck until it's
  rebuilt, once the ship has been to another system (no docking meanwhile). On a station or turret
  that isn't hostile, Attack is the last action offered. Friendly turrets fight on your side
  against hostiles near their station.
- **The main story.** A new game starts with chapter 1 already taken and tracked. Seven chapters (`STORY` in `src/story/job-texts.js`, placed by
  `src/story/jobs.js` as the `story` tier), offered at every station, each once the one before is
  done and the pilot has reached its level (1 to 24); while it waits, the Missions tab says what
  level it opens at. It takes you from Wedge space out past the frontier to the aliens at the
  galactic core, asked by each faction in turn as it is: Wedge's security and order, Block's
  industry at any human cost, Shard's research as faith, the Drifters' freedom at any price, the
  Androids' neutrality close to apathy, and the aliens, beyond understanding.
- **Contracts.** Every station posts combat contracts (`src/story/job-texts.js`, run by
  `src/game/jobs.js`): a raider patrol (Easy), a turret battery and a convoy escort with an ambush
  on the way (Normal), holding the station against waves with its turrets beside you (Normal or
  Hard), a pirate outpost (Hard) and a strike a jump away (Elite). The difficulty sets the hostiles'
  tier, the pay and the gear rewarded: one of three pieces to choose, as a Warden's is (on the comms
  box when flight is calm, or on the station screen: `src/game/rewards.js`). Four kinds are not
  fights (marked No combat: less pay, no gear): dispatches carried to another station, a survey of
  three points in the system, drifting cargo to recover, and stores the station is short of, bought
  at a station that sells them. A contract handed in is posted again the next day.
- **Loot.** Gear drops MMO style (`src/rules/loot.js`): seven bases (laser, missile launcher, plasma
  cannon, shield generator, scanner, engine, ship computer; art in `src/art/equipment.js`), an item
  level from the level of what dropped it, five rarities (Common to Legendary) with more affixes and
  stronger stats the rarer (a Legendary also has a power, a rule of the fight it bends: Breaker,
  Overkill, Meltdown, Second wind, Foresight, Afterburn or Insight, by its base), drop tables per source (fighters, turrets, stations, outposts, dungeon
  guardians, the Warden, missions) with rarity floors (nothing destroyed drops Common: fewer drops,
  each worth a look), bad-luck protection (Rare at least after a
  long dry run) and drops biased toward your party's classes (yours and your squad's). Loot floats in its rarity's colour where it
  dropped, goes into the spare gear (it takes no hold room) and fits like any gear. When it drops, and
  over a selected drop and in the spare gear, it says whom it's an upgrade for and by how much: your
  ship or a squad member's, by how much stronger it makes that ship in a fight (`src/game/upgrades.js`).
  An upgrade that can be fitted now is offered on the comms box once flight is calm, to fit there and
  then on your ship or the squad member it helps most, no dock needed (`src/game/quickfit.js`).
- **No hazards.** Heat, radiation, flares, ion storms, surface hazards, fuel and the dash were taken
  out of the main game (`notes/archived-systems.md` says where they are; `rules/hazards.js` stays for
  the race and for each surface's deposits). `notes/hazards.md` was their plan.

Mining is an action you start: select a rock (or, on a surface, a deposit) and press Mine (or
Siphon, or E) on its menu; a ring round it fills as the tools work, and it breaks up when it's done
(`src/game/mining.js`). The tools never pick a rock on their own, nor go on to the next, and a big
asteroid's shards are each mined the same way. Fly off and the work stops. Drops (in space and on a
surface) are drawn large as their menu icons; a tap selects one, and dragging it onto the ship picks
it up. In space a drop's menu also has Collect all (G), outside a fight: every drop within reach of
the ship comes aboard at once. Nothing is pulled in or picked up by flying near it. The drag joypad
shows under the finger in space and on a surface alike, and the map, settings, factions and
context menu stay up in a fight. Jump gates are named for where they lead. A dungeon's way out is
its landing pad: fly off it and back onto it to take off.
Explanations in the menus wait behind an ⓘ. A dock opens on Missions (the first tab) on a first
visit and whenever a mission can be handed in there. Three prompts, one line each, show once: the
controls in a new game, a first fight, a first drop (`src/game/tips.js`). `notes/review.md` is the
review these changes came from. There is no production or research in the main game
any more (the idle game has them, on the same rules: `notes/archived-systems.md`).
Plain JavaScript (ES modules) on a 2D canvas, with no build step and no runtime dependencies.

The galaxy is a barred spiral grown from the seed: about forty star systems along its bar and arms
(settled ones in the habitable band, split between the three territories; sparse frontier ones in the
core and out at the rim, the Drifters', the Androids' and the aliens'), far enough apart that crossing
between them is a trip, the territories' jump gates as shortcuts, and between
the systems the places a galaxy holds: the supermassive black hole at the centre, star clusters,
H II regions and dark clouds, supernova remnants with their pulsars, black holes, white dwarfs,
brown dwarfs, rogue planets, interstellar objects passing through, and fields of dust, gas and
cosmic rays. The game starts in the showcase system (one of each planet, moon and station type, a
nebula and an asteroid field) on an outer arm. `notes/galaxy.md` is how it is grown. Every
deep-space site holds a find (`src/rules/survey.js`, `src/game/sites.js`): fly inside its survey
range and hold there for a few seconds while the scanner works, and it pays credits and experience
by the pilot's level, and from the rarer kinds gear to choose. Each is made once; the map says
which sites are surveyed.

## Added in the second review (Nov 10, 2026)

- **Sound.** A short voice for each game event (`src/core/sound.js`), made on the spot from
  oscillators and filtered noise: no files. It answers the same events as the vibration
  (`src/core/feedback.js`) and is Off, Low or Full in Settings. Nothing is made until the first
  tap or key, as browsers require.
- **Offline.** The game installs and starts without a network: `sw.js` at the root keeps every
  file it loads (`npm run sw` writes the list; `npm test` fails while it is out of date). The
  race, the idle game and Redshift keep their own workers, and their pages are never answered
  from the game's.
- **Games.** The galaxy last played opens next time, with or without `?seed=`. Settings lists
  the other games saved in this browser, to go back to; New game asks first. A backup file holds
  this game's saves only, so putting one back leaves the other games' alone.
- **Saves kept safe.** A damaged save is set aside under `<key>:bad` before anything is written
  over it; a write the browser refuses is said once; a frame that throws is logged and the next
  tried, and three in a row stop the game behind a notice with Reload and Export save
  (`src/game/loop.js`).
- **The pilot's log.** What a game has done, counted (`src/rules/log.js`, `src/game/progress.js`):
  time flown, hostiles, elites, Wardens, raids, contracts, chapters, systems, sites, ships lost.
  Seventeen milestones each pay credits once; the grandest reached is the name flown under. On
  the Ship tab.
- **The workshop.** Every outfitter works spare loot gear over for salvaged components and
  credits (`Loot.reroll`, `Loot.promote`, `src/game/vendor.js`): Reroll rolls all of a piece's
  affixes anew (a piece is remade from its seed, so not one at a time); Refine makes it one
  rarity better, never Legendary. Weapon components for guns, hull for shields, computer for
  scanners and computers, drive for engines. Components had no other use.
- **Wanted.** The Missions tab lists the named elite of every system visited, with its bounty or
  that it has gone to ground; the map's card for a system says the same (`wanted`, `eliteOf` in
  `src/game/traffic.js`).
- **After the story.** With chapter 7 handed in, the Missions tab has an epilogue, and a job at
  the core, Core incursion, is asked again each day (`AFTER` in `src/story/job-texts.js`). From
  the epilogue or Settings the pilot can go to a new galaxy with its level, talents, class,
  gambits and log; the ship, gear, squad and credits stay with the game left, which stays saved.
- **Contracts can fail.** A defence with a wave out, or an escort with its ship along, fails if
  your ship is lost: back on the board, progress gone, a little regard lost with whoever asked
  (`failOnLoss`, `src/game/jobs.js`). Enemies fight you, not the station or the convoy, so the
  loss of your ship is what failure means. Story chapters wait instead.
- **Squad perks.** A squad member learns its class's two perks at levels 6 and 12
  (`Progress.squadPerks`), with no points to spend; its ship's screen lists them.
- **Guarded sites.** The deep-space sites that give Rare gear are held by a named elite, a tier
  above what the pilot's level counts as (`Survey.guarded`, `siteGuard` in
  `src/game/traffic.js`). No scan until it is destroyed, once.

The game is otherwise pared back to its core mechanics: one trade good per category and one
component per salvage type, six factions. `notes/archived-systems.md` says what was taken out and
how to bring it back.
