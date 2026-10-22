# Gathering under hazards: the plan

Oct 22, 2026

**Decision (October 2026):** the game is no longer about fighting. The loop is short trips out to
gather under environmental hazards, on planet and moon surfaces too, then back to base to collect
what production made, research, and set up the next trip. The long goal is restoring the jump gate
to reach the next solar system. This note is the design reference; the code follows it phase by
phase (see Phases at the end).

What was decided:

- **Mining runs on the real-time combat rules.** Asteroids and gas pockets have an integrity bar.
  The ship's tools fire at a locked rock on their own while it's in range and in arc, so mining is
  about positioning, as real-time combat was.
- **Collisions:** hitting an asteroid, a station, or a wall or obstacle on a surface costs shield,
  then hull, by how hard you hit.
- **Stations:** one per process. The android waystation is home: it posts every station's
  missions, and is where you restore the other stations and the gate.
- **The squad becomes drones.** The gambit programs stay; `attack` now means mine.
- **Failure:** when a meter runs out, the ship is towed home and its cargo stays where it was lost,
  as a cache to go back for.

The showcase system (`src/world/galaxy.js`) already has what this needs: every planet and moon
type, all of which can be landed on, one asteroid field and one nebula, one station of each type
plus the waystation HD-1863, and a gate switched on and off by `gatesOnline()` (`src/game/cargo.js`).

## Phase 1, as built

- **Rocks are passive combatants** (`rules/mining.js` `stats`, `integrity`, `material`): integrity
  6 per unit of radius for rock, 2 for gas; no shields, engine, guns or lock. `combat-realtime.js`
  skips steering, locking and firing for a `passive` enemy, and leaving one is flying out past lock
  range. `game/combat.js` `extract` starts a session (always real time), or adds a tapped rock to
  the one under way; a broken rock goes to `game/mining.js` `rockBroken`, which drops what it held.
  The old countdown mining is gone.
- **Tools** keep the ids of the weapons they were, so saves need no change: the pulse laser is the
  Mining laser (rock ×1, gas ×0.25), the heavy cannon the Fracture drill (rock ×1.5, short range,
  from Mk II), the beam turret the Gas siphon (gas only, all round, now from Mk I). A tool's `vs`
  also has `ship`, and the siphon's is 0, so it sits out the fights still in the game. The
  computer's `miningRate` scales damage to rocks. A new Courier carries a siphon in its second mount.
- **Collisions** (`flight/collide.js`, `game/collisions.js`, `game/landing.js` `fly`): the ship
  bounces off asteroids and station cores, and a hit faster than `safe` (150; 80 on a surface)
  knocks it, shields first. Shields outside a fight are `guard` in `game/combat.js`, recharging
  after 3 s clear. A hull knocked to nothing outside a fight loses the ship (`wreck`: the hold
  spills, then a tow home); on a surface, the ship takes off and is lost in orbit. Drones don't
  collide yet.
- **Pirates are switched off, not removed** (`notes/archived-systems.md`): no packs or ambushes in
  the showcase system, and the Combat setting is out of the menu. `?pirates` brings them back,
  which the opening missions' tests use.

## Phase 2, as built

- **Rules** (`rules/hazards.js`, pure and seeded, on flight time): the star's heat by
  (4000 / distance)², 20 a second at that distance; a ship sheds 6 a second, so heat builds only
  inside about 7,300 units (the lava planet's orbit) and sheds everywhere else. Thrust adds a
  little. Gas giants have a radiation belt from 150 to 1,100 units outside the planet, 6 a second
  in the thick of it, with two gaps of 0.7 radians placed by the planet's seed. Every moon gives
  radiation up close (2 a second, 4 round a giant), fading out 350 units from its surface.
  **Stations shelter their approaches** (no belt or moon radiation within 800), because some
  stations orbit inside a giant's belt.
- **Flares:** one in each 200 s stretch of flight time, at a seeded moment; a 15 s warning, then an
  8 s wave of heat and radiation, stronger closer to the star (×0.4 to ×3), unless a planet, moon
  or asteroid of radius 24 or more lies between the star and the ship.
- **Ion storms:** one 30 s storm in each 150 s stretch per nebula. Inside it, a wind pushes the ship
  and the sensors stop.
- **Meters** (`game/hazards.js`): heat (not saved, sheds), radiation (`cargo.rad`, saved, cleared
  by docking), fuel (`cargo.fuel`, saved; tanks by hull, the Courier's 100). Thrust burns 0.5 a
  second at full; map travel burns one per 2,500 units, and an empty tank drops out of cruise.
  Full heat or radiation loses the ship (`wreck`). An empty tank leaves it adrift, engine dead, and
  calls a tow after 6 s. The tow cools, decontaminates and leaves a quarter tank; the hold stays
  where the ship was lost (it no longer picks it back up while waiting for the tow).
- **Refuelling** at any station (the Ship tab, beside the hull): hydrazine aboard first, then
  hydrazine in storage (25 fuel a unit), then fuel bought at 6 credits a unit.
- **Shown:** the belts as bands with their gaps, shadows behind the bodies while a flare comes, an
  orange glow in the wave when exposed, a warning line at the top of the HUD (flare countdown,
  sheltered or exposed, storm, out of fuel), and gauges at the bottom left (hull, shield, heat,
  radiation, fuel) that appear as each needs watching. Warnings sound off as meters pass 60/85%
  heat, 50/75/90% radiation and 25/10% fuel, with the 'hazard' vibration.

## 1. Extraction: real-time combat pointed at rocks

The real-time mode (`src/combat/combat-realtime.js` on `src/combat/combat-core.js`) already does
most of this. It changes from "ship against ships" to "ship and drones against rocks":

- **Targets** are asteroids and gas pockets, made with `CombatCore.combatant`:
  - their **integrity** is their hull: it scales with size (`Entities.asteroidSize`: small, medium,
    large) and with type;
  - they have no shields and no evasion, and they never shoot back;
  - their AI is replaced by a passive pose (they tumble where they are, as now).
- **Lock and fire** stay as they are:
  - tap or long-press a rock (the existing `hold` action on asteroids) to lock it, within the
    scanner's `lockRange`, after the computer's `lockTime`;
  - tools fire on their own while the rock is in range and in arc;
  - the hit chance keeps its range and motion penalties, so a drifting ship misses more.
- **Tools replace weapons.** Weapon slots become **tool slots** (same slot count, same Mk I–V lines,
  same `range` and `arc`). Each tool has a **material factor**, so the choice of tool matters:

  | Tool (the line it was) | Range / arc | Rock | Gas |
  |---|---|---|---|
  | Mining laser (pulse laser) | long, forward 60° | 1.0 | 0.2 |
  | Fracture drill (autocannon) | short, forward 40°, high damage | 1.4 | 0 |
  | Gas siphon (new line) | short, 360° | 0 | 1.0 |

  The damage step multiplies by the factor for the target's material; `look` and `arcs` (the
  field-of-fire wedge) stay.
- **Breaking a rock** works as destroying a ship does: `shipDestroyed`-style loot is left floating
  (`Mining.yieldOf` / `Mining.gasOf` decide what), and the rock stays gone (the existing `removed`
  keys). A later step: large rocks split into two medium fragments that fly apart, which can hit the
  ship (see collisions).
- **A session** starts with the first lock and ends when nothing locked remains in range. More rocks
  join as they are locked (`join`). There is no escape timer and no leash.
- **Hazards during mining:** you sit near a rock while hazards build up. Mining in a gas giant's
  belt or on a moon means radiation climbs the whole time, so tool choice and Mk are about time spent
  exposed.
- **The rounds mode goes:** mining needs positioning. The Combat setting and `combat/combat.js` are
  removed; `CombatCore` keeps the shared parts.
- **What happens on screen** stays: beams, sparks, damage numbers that add up (`addDamage`), the
  wedge, brackets closing in as the lock comes on. The integrity bar uses the combat panel's bar,
  slimmed down to the target's name, integrity and lock.
- The old mining countdown (`game/mining.js` startMining / finishMining) is replaced. `burst`,
  `chips` and debris particles stay for effects.

## 2. Collisions

New pure module **`src/flight/collide.js`**, Node-testable:
- `Collide.resolve(body, radius, obstacle) -> { hit, normalSpeed }`: circle against circle.
  - The ship is pushed out along the contact normal.
  - Its velocity along the normal is reflected and scaled by `RESTITUTION` (about 0.3), and a little
    is lost along the surface as friction.
- `Collide.damage(normalSpeed) -> points`: zero below `SAFE` (a gentle bump, so docking and
  approaches never hurt; above `GATE.maxSpeed` and the approach speeds). Above that it rises
  steeply, linear or squared, tuned by test.

Applied in **space** (`game/update.js`, after the flight step):
- **What's solid:** asteroids, stations and gates, found with `Scene.near(x, y, range)`. Planets and
  moons are not: they're for landing.
- **Damage:** `CombatCore.applyDamage` on the ship, so shields go first and then hull, with
  `Feedback.emit('impact')`, a spark `burst` and the damage number.

Applied on **surfaces** (`game/landing.js` `fly()`):
- `fly()` already stops the ship on whichever axis `ArtSurface.blocked` refuses. The speed it loses
  there becomes `normalSpeed`, and the same damage rule applies to cliffs, tall props and storm
  pockets. A small bounce instead of a dead stop makes it read as a hit.

**Shields outside fights:** the ship needs a lasting shield meter, `cargo.shield` beside
`cargo.hull`. It recharges after `shieldDelay` (3 s) without a hit, as in real-time combat, so
collisions and hazards are absorbed the same way.

Drones skip collisions for now: their formation flying doesn't avoid rocks. They can get them once
they steer round obstacles.

## 3. Ship meters (the source of tension)

| Meter | Drains | Recovers | Existing hook |
|---|---|---|---|
| Shield | collisions, flying debris, storm pockets | on its own 3 s after the last hit; shield cells | the real-time shield, made to last |
| Hull | collisions past the shield, hazards | repair at a dock, repair nanites | `cargo.hull`, `repairs` |
| Heat | near the star, the day side of a surface, lava, hard thrust | sheds on its own out of heat; coolant flush | new |
| Radiation | gas-giant belts, flares, **moons** | only at a dock or with a radiation purge charge (it accumulates) | new |
| Fuel | thrust, taking off (gravity × how full the hold is) | refuelled with **hydrazine** at a dock | hydrazine already exists as a good |

When hull, heat or radiation reaches its limit, the ship is disabled. When fuel runs out, the ship
drifts, and you can call a tow. In both cases the existing `playerDestroyed()` / `towHome()`
(`game/combat.js:272,291`) run. They already spill the hold into saved `cargo.drops`, so caches in
space work today. Caches on surfaces are new (§6).

## 4. Hazards and resources by place

Each body type has one main hazard and something worth landing for. **Moons all carry radiation**,
strongest round the gas giants.

| Place | Main hazard | Resource (new raw goods marked *) |
|---|---|---|
| Asteroid field | collisions; fragments from rocks you break | iron, silicates (existing) |
| Nebula | ion storm: no minimap or scanner, the ship drifts | deuterium (existing gas pockets) |
| Inner space / flares | heat; flares you shelter from in a shadow | — |
| Lava planet | heat, worst on the day side | tungsten* |
| Desert planet | dust storms (short visibility, wind pushing you into walls) | rare earths* |
| Terran planet | mild (the first landing to learn on) | water* |
| Ice planet | cold: fuel burns faster | volatile ice* |
| Gas / blue giant | storm pockets (the existing `tall` props) to collide with; radiation belts around them | helium-3* (siphoned from the cloud deck) |
| Moons (grey, rust, dark, ice, sulfur) | radiation | one each: regolith titanium*, iron oxide*, carbon*, water ice*, sulfur* (start with 2–3 of them) |

Every new good needs a recipe that uses it, so it is never a dead end. The rule from
`notes/industry.md` ("every good has a source and a sink") stays, and the test that checks it covers
the new goods.

## 5. Stations: one per process, the waystation as home

Map onto the existing station types (`station.market.type`). `Industry.STAGE` already ties each type
to one stage, so this mostly renames them and widens what each does.

| Station (existing type) | Process | Market sells | Makes | Researches |
|---|---|---|---|---|
| **Waystation HD-1863** (home) | — | hydrazine, repairs | — | drone programs (logic packages) |
| Mining camp | Ore works | iron, silicates | metals and minerals refined | ore yield, laser and drill lines |
| Minor station | Volatiles works | deuterium, water | gas and ice refined, hydrazine | fuel, siphon line, radiators |
| Salvage yard | Recycling | derelict components | components recycled | caches, scanners |
| Major hub | Fabricator | parts | electronics, shielding, radiators | radiation gear, shield line |
| Capital | Shipyard / assembler | — | tools, gear, consumables, drones, **gate segments** | hulls, cargo, the gate |

The **waystation** is the single home beat:
- **Mission board** for every station. Each job names the station it's for, pays in that station's
  material and raises loyalty there. The jobs system (`story/jobs.js`, `game/jobs.js`) and loyalty
  (`cargo.loyalty`) already exist.
- **Restoration projects:** repair or unlock a process station by delivering materials to storage
  and paying. At the start, only the waystation and one process station (the ore works) are online.
- **The gate project:** a few stages, each needing goods from a harder zone, with the last one
  needing material from the gas giants' moons.
- **Drone bay:** program the drones (the Squad tab).

Storage stays shared (`Industry` storage), so production keeps working however many stations there
are. **Research becomes per station.** Each package gets a `station` (process) field and can be
queued only while docked there. **The lab queue stays global**, so lab time is still one budget to
spend.

## 6. The surface run (`game/landing.js`)

- **Scan before landing:** a planet's context menu shows the site's hazard and its deposit types,
  from `Hazards.surface`.
- **Deposits** are extraction targets like rocks: seeded points in open tiles (test them with
  `ArtSurface.blocked`), each with an integrity bar. They're locked and broken by the same session
  as in space, with the session's ship pose taken from `landing.craft`.
  - **The tool in the hard slot:** the drill is short-ranged, so you hover close among obstacles,
    and collisions matter there.
  - Mined deposits are saved per body (`cargo.mined[bodyKey]`).
- **The surface clock:** the day side moves across the site. Inside it, heat climbs fast. The
  countdown to it is on the HUD.
- **Biome hazards:**
  - lava: hot vents (the glowing `hole` props) burn;
  - desert: dust storms (darker view, wind added to `fly()`);
  - gas: storm pockets as obstacles that damage;
  - moons: steady radiation;
  - ice: fuel burns faster.
- **Taking off** costs `takeoffFuel`. Without enough fuel, Take off is refused with its reason, and
  "Jettison" drops items as a surface cache.
- **Surface caches:** `cargo.surfaceDrops[bodyKey]`, drawn on that surface, collected when you fly
  over them. A ship lost on a surface leaves its hold there.

## 7. Drones (`rules/logic.js`, `game/squad.js`)

The logic barely changes, because mining is now "attack":
- **Subjects:** enemy is replaced by **rock** and **gas** (and **item** for floating drops). Ally,
  self and leader stay. Picks (nearest, weakest = least integrity left, strongest) work unchanged.
- **Actions:**
  - **attack** keeps its intent and is labelled **Mine** (or Siphon);
  - **collect** (fly to items) and **return** (to the ship, unloading into the hold) are new;
  - guard and follow stay;
  - `use(skill)` stays for consumables.
- **Conditions:** heat %, radiation %, hold %; `hazard.flare` and `hazard.storm` in place of
  `fight.*`; distance stays.
- **`logicContext`** in `game/squad.js` gets its candidates from the session's targets plus nearby
  rocks (`nearbyEntities`). `setOrders` is unchanged.
- **Drones' own meters:** a drone left in a belt overheats and is disabled until the next dock.
- **Packages:** Combat and Tactics become Gathering and Hazards; Core and Maintenance stay.
  `Logic.read` already keeps old lines that no longer check, switched off, so old saves still load.
- **Phase one is drones in space;** drones on surfaces come later.

## 8. New modules and changes

- **`src/rules/hazards.js`** (pure). What a place does to the ship:
  - `exposure(system, x, y, t)`: rates per second for heat and radiation;
  - nebula: the ion storm flag;
  - `flares(seed, t)`: the seeded schedule on real time;
  - `shadowed(system, x, y)`: whether something lies on the line from the star to the ship;
  - `surface(bodyType, seed)`: the biome's hazard, rates, surface clock, gravity and deposit types;
  - `takeoffFuel(gravity, holdFill)`.
- **`src/flight/collide.js`** (pure): §2.
- **`src/game/hazards.js`:** each frame, applies exposure and collisions to the meters (scaled down
  by fitted gear), raises warnings (`notify`, `Feedback.emit`) and disables the ship when a meter
  runs out. It also carries the ship-loss and tow code.
- **`src/game/combat.js` becomes `src/game/extraction.js`:** sessions against rocks, events into
  effects, loot. Engaging, ambushes, aggro, foe markers and fleeing are removed.
- **Rules:**
  - `rules/loadout.js`: weapon lines become tool lines (factor per material), plus the siphon line.
  - `rules/abilities.js`: repair nanites and shield cell stay; EMP becomes a **seismic charge**
    (burst damage to a rock); jammer becomes **coolant flush**; **radiation purge** and **fuel
    canister** are added. Used from HUD buttons.
  - `rules/mods.js`: weapon mods carry over as tool mods.
- **HUD:** five compact meters in `game/hud.js` and the surface HUD, plus the flare and sunrise
  countdowns.
- **Removed:**
  - `src/combat/combat.js` (rounds) and the Combat setting;
  - pirates and ambushes (`world/security.js`, packs in `world/solar-system.js`);
  - schematics from pirates, enemy AI in `combat-realtime.js`, and `rules/reputation.js` pirate
    passage.
  - `notes/archived-systems.md` gets an entry for combat.

## 9. Saves

A step at the end of `CARGO_MIGRATIONS` (`game/cargo.js`):
- fitted weapons become the tools of the same line and Mk (an id map);
- EMP charges and jammer pods become seismic charges and coolant flushes;
- `cargo.shield` and the new meters start full or empty;
- the starting set of stations online: the waystation and the ore works;
- the gate starts offline, and a save that had the gates online gets the gate project as done.

---

## Phases (each one playable on its own)

1. **Mining as real-time combat, and collisions.** *(done: see Phase 1, as built; pirates and the
   rounds mode are switched off rather than removed)*
   - Rocks and gas pockets as passive combatants with integrity; tools with material factors.
   - Remove pirates and the rounds mode.
   - Collisions in space and on surfaces; the lasting shield meter.
   - This alone is playable, with today's production and research.
2. **Hazards in space.** *(done: see Phase 2, as built)* `rules/hazards.js` with star heat, flares and shadows, radiation belts and
   moons; heat, radiation and fuel meters (fuel from hydrazine); disabled ship → tow home with its
   cargo cached.
3. **Surface run.** Deposits as targets, the surface clock, biome hazards (lava, moons, desert first),
   takeoff fuel, surface caches, the scan before landing. 3–4 new raw goods with recipes.
4. **Gear and consumables for hazards.** Siphon line, radiator, shielding, tank and cargo pod; field
   consumables on the HUD.
5. **Stations per process and the waystation as home.** Station roles, restoration projects,
   research per station, the mission board at the waystation (job steps land and sample in place of
   fight).
6. **Drones.** New subjects, actions and packages; `logicContext` from the world; drone meters.
7. **The gate.** The staged gate project at the waystation that turns on `gatesOnline()`. A second
   system for the gate to lead to (`Galaxy.generate` already has the multi-system shape: `systems`,
   `links`).
