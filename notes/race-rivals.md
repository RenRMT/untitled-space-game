# Racing: research on rivals

Oct 24, 2026

Research behind Phase 4 of `notes/race.md` (rivals and a career). It covers how other racing games
build AI opponents, how to make them hard but fair, how to keep them from all flying alike, how the
cultures' ships can give them personality, and how to set three challenge levels (regular, advanced,
expert). A first pass is built; "What's built" at the end says what and what it measured.

## Where the code stands
- **No rivals.** `Pilot.fly` (`src/race/pilot.js`) is a scripted pilot. It aims at a centreline point
  ahead, `AIM.near + v·AIM.lead` out, so it cuts bends a little at speed. It always flies at full throttle and
  brakes when a bend ahead can't be taken: `vmax = √(grip·(1/k + LINE·hw))`. It never dashes, hops
  or drifts. Its controls have the same shape as `Input.control()`, so a rival can fly through the same `Run.step`.
- **One craft per run.** `Run` holds a single craft, and ships don't collide with each other (`contact.js` handles walls only).
- **Deterministic.** The fixed 1/120 s step means the same inputs always fly the same lap. That makes rival tuning,
  ghosts and tests reproducible as long as rivals draw from a seeded RNG.
- **The track data rivals need is already there.** `tr.pts` has `k` and `hw`, `tr.corners` has apex and side,
  and `Track.ahead` and `Track.edgeDist` are available. The racing line and speed profile are still to do
  (`race-research.md` A-part, `race.md`'s "racing line and medal times").
- **Cultures are looks only.** `src/art/culture.js` defines Wedge, Block, Shard, Kitbash, Alien and Android.
  Their ideals are in `src/world/factions.js` and their lore in `notes/factions.md`.
- **The names regular / advanced / expert are taken** by the track style (`main.js`).

## 1. What other games do

| Game / source | Approach | What it means for us |
|---|---|---|
| *Pure* (Black Rock, GDC Europe) | Dropped speed-based rubber banding for **race scripting**: designers sketch how a race should unfold, and the AI is steered towards it quietly. | Players can see AI that is "superhumanly fast or brain-dead slow". Change *how well* rivals fly, never their top speed. |
| GameAIPro ch. 38, *An Architecture Overview for AI in Racing Games* | Built in layers: racing line, then speed profile, then steering and throttle. Each driver has a **skill** that can vary over a race, plus **aggression, control and mistake rate**. | A handful of numbers per driver is enough to make them distinct and readable. |
| Forza Drivatars (Turn 10) | Drivers are profiles of line, braking, aggression and shortcut use. On difficulty, Turn 10 found that mistake profiles alone **didn't make the AI reliably slower**, while cornering and line profiles did. Low difficulties also cut power. | Base the levels mostly on cornering and line quality, and use mistakes for flavour. A small power cut on the lowest level is acceptable. |
| Redout / Wipeout | Reviewers call the AI "infallible" and "robotic" because it flies perfect runs. Redout 2 has six levels plus automatic difficulty and assists, and reviewers criticised it. | Flawless AI feels unfair even when it doesn't cheat. Rivals should make human mistakes. |
| Mario Kart (Tour, on mobile) | Rubber banding through speed, grip and better items. Every Tour racer is a bot, and players found them too easy. | Mobile players accept bots. Keep catch-up hidden, and keep the top level a real fight. |
| Arcade practice (Unity forum) | In an arcade racer, a pack all on the perfect line "isn't any fun". | Vary the lines, not just the speeds. |

I found no public developer material on Asphalt 9's AI.

## 2. Fair challenge: the rules
1. **Same physics, same stats.** Rivals fly through `Handling.step` and `Run.step` with `Input.control()`-shaped
   controls, just as `Pilot` does. They never get extra top speed or grip on advanced or expert.
2. **Skill is line and braking.** A better rival brakes later, carries more of `vMax` through bends, takes a
   tighter line, and dashes and drifts on time. A weaker one brakes early, runs wide and wastes boosts.
3. **Skill banding, not speed banding.** A rival far behind the player gets slightly *better*, but only up to its
   level's ceiling. One far ahead gets slightly worse and makes more mistakes. No rival ever flies faster than it
   legitimately could. Banding is off in time trial and weakest on expert.
4. **Readable mistakes.** Late brakes, running wide and wall scrapes happen at a rate set by personality. The
   player should be able to see *why* they got past.
5. **A mobile race arc.** Races are three short laps. The grid puts the player behind slightly slower rivals, so
   there is a fight from the first lap and no leader vanishes at the first bend.
6. **Seeded.** All rival randomness comes from the race seed, so the same seed gives the same race.

## 3. Making them fly differently
The base is the planned **racing line and speed profile**: a minimum-curvature line with `vMax = √(a·r)`,
computed once per track. Each rival flies an **offset** of that line, not the line itself:

- **Line bias:** a lateral blend between the ideal line (0) and the centreline (1), plus how early it turns in.
- **Braking margin:** the share of `vMax` it is willing to carry, 0.88 to 1.0.
- **Aggression:** how small a gap it will pass into, whether it uses the overtaking line, whether it blocks, and
  whether it dashes sideways at others.
- **Boost use:** when it spends dash charges and drift boosts (on straights, out of bends, to defend, or at random).
- **Consistency:** noise in its skill from lap to lap, and how long it takes to recover after a hit.
- **Mistakes:** how often it makes them, and which kind (late brake, running wide, clipping a wall).
- **Hops:** how willing it is to hop over hazards or take short cuts.

On top of these sit a few **states**: race, overtake, defend, recover and, later, avoid. Each rival switches
between them based on the gap to the ships ahead and behind, which comes from distance along the track (`R.n`)
and lateral offset (`Track.edgeDist`).

## 4. Culture is personality
Each rival culture gets a **preset**: the numbers above, a small handling twist (within ±5%, so every ship can
win), and a voice. The ship is drawn with `ArtBlueprints.create(type, ArtCulture[c], …)`.

**Android is the player's culture, not a rival.** The player flies an Android ship (`ArtCulture.android`,
replacing `legacy` in `main.js`), and the field is drawn from the other five cultures.

| Culture | Ideals (`factions.js`) | How it flies | Handling twist |
|---|---|---|---|
| **Wedge** | Order and reach | *The Textbook.* A clean ideal line, very consistent, few mistakes, moderate aggression, and boost saved for straights. The disciplined front-runner. | Balanced |
| **Block** | Industry first | *The Wall.* Wide, defensive lines. Brakes early, blocks, and shrugs off contact with a short recovery. | −turn |
| **Shard** | Precision and stillness | *The Blade.* Brakes latest, takes the tightest apexes and boosts out of bends. Rarely passes recklessly, but its rare mistakes are costly. The boss on expert. | +turn |
| **Drifters** (kitbash) | Freelancers and outlaws | *The Wildcard.* Very aggressive: dashes sideways into rivals. Inconsistent, with high noise and many mistakes. | A small random ± turn |
| **Alien** | Grown, not built | *The Unreadable.* Strange lines with a large lateral bias and odd turn-ins, and smooth flowing drifts. No barks, since they "answer no hail". | +grip in slides |

Further ideas:
- **Named rivals** with crew portraits (`art/crew.js`, `art/portraits.js`) and short barks at overtakes and the finish.
- **Faction colours** in the position list.
- **A home biome** for each culture, which gives a skill bonus there (not a speed bonus).
- **A nemesis** who turns up in every cup.

## 5. Regular, advanced, expert
The level sets the **skill band** rivals are drawn from. Personality stays the same at every level.

| | Regular | Advanced | Expert |
|---|---|---|---|
| Share of `vMax` carried in bends | 0.86–0.92 | 0.92–0.96 | 0.95–0.98, the boss 1.1 |
| Line bias (0 ideal, 1 centre) | 0.5–0.8 | 0.2–0.5 | 0–0.2 |
| Mistake rate | ×1.5 | ×1 | ×0.5 |
| Drift boost and dash | rarely | usually | well-timed |
| Skill banding | strong, both ways | mild | minimal, upward only |
| Field | the slowest three start ahead of you | the same | the boss (Shard) on pole, on the racing line |
| Power cut (Forza-style) | −3% top speed | none | none |
| Rivals' hull (looks only) | light fighter | fighter | heavy fighter |

**Calibration.** Fly an ideal-line rival headless over many seeds, as `Pilot.lap` and `tools/race-tracks.js`
already do, to get a target lap time for each track. That doubles as the **medal times**: gold is about expert,
silver advanced and bronze regular. Then check that each band lands at its intended margin from the target.

**The name clash.** Tie the rival level to the track style by default, so an expert cup has expert tracks and
expert rivals. Keep a `?ai=` URL override for testing.

## 6. Order of work
1. **Racing line and speed profile** (`src/race/line.js`), from `tr.pts` and `tr.corners`. This also gives medal times.
2. **Several craft per run**, each with its own state, and simple ship-to-ship contact in `contact.js`.
3. **A `Rival` brain** (`src/race/rival.js`) that grows out of `Pilot.fly`. It follows the line with its offset,
   uses the speed profile × skill, decides when to dash, drift and hop, switches states, and makes seeded mistakes.
4. **Presets**, keyed by culture id (`wedge`, `block`, `shard`, `drifter`, `alien`), plus the level table.
5. **Drawing**: rival ships by culture, the player's Android ship, and a position list.
6. **Tests**: the same race from the same seed, lap times ordered by band, and no rival above its band's ceiling.

## Sources
- [The Pure Advantage: Advanced Racing Game AI (Game Developer)](https://www.gamedeveloper.com/design/the-pure-advantage-advanced-racing-game-ai)
- [Black Rock Studio blasts "rubber banding" (MCV)](https://www.mcvuk.com/development-news/black-rock-studio-blasts-arubber-bandinga/)
- [GameAIPro ch. 38: An Architecture Overview for AI in Racing Games](https://www.gameaipro.com/GameAIPro/GameAIPro_Chapter38_An_Architecture_Overview_for_AI_in_Racing_Games.pdf)
- [Forza Horizon 2: Drivatars (Xbox Wire)](https://news.xbox.com/en-us/2014/09/30/games-forza-horizon-2-drivatars/)
- [Forza Motorsport 4 interview, part 3](https://www.osftw.com/news/508931/forza-motorsport-4-interview-under-the-hood-part-3)
- [Redout 2 review: difficulty or rubberband AI (Wccftech)](https://wccftech.com/review/redout-2-difficulty-or-rubberband-ai-at-its-worst/amp/)
- [Rubber Band AI (Giant Bomb)](https://giantbomb.com/wiki/Concepts/Rubber_Band_AI)
- [Mario Kart Tour bots (MobileSyrup)](https://mobilesyrup.com/2019/09/30/mario-kart-tour-bots-racing/)
- [Fixing racing AI rubber banding that feels unfair (Bugnet)](https://bugnet.io/blog/how-to-fix-racing-ai-rubber-banding-feeling-unfair)
- [The quest for a better racing AI system (Unity forum)](https://discussions.unity.com/t/the-quest-for-a-better-racing-ai-system/492635)

## What's built (first pass)
- **`src/race/line.js`:** the racing line and its speed profile. The relaxation mixes in only a
  little of the shorter way (`LENGTH` 0.02); more of it hugs the inside of long bends. The line is
  3–13% faster than the centreline (`Line.ride` with zero offsets).
- **`src/race/rival.js`:** the presets (`CULTURES`, `LEVELS`), the field and grid, the brain (its own
  line, the brake scan against its own speeds, bends rolled for pace noise and slips, passing and
  defending, boosts, a calm spell after a hit, skill banding), ship-to-ship knocks without damage,
  the standings, and `Rival.race` (a race of rivals alone, headless).
- **`src/race/run.js`:** `cfg.grid` places a run on the grid; `cam: null` and `ghostKey: null` leave out
  the camera and the ghost (a rival's run). **`src/race/pilot.js`:** `Pilot.flat`, the headless track
  both the pilot and the rivals fly.
- **The page:** five rivals by default, at the track style's level (`?ai=` to set it, `?ai=off` for
  none), drawn in their cultures' ships; you in an Android ship. Your place and the order are in the
  HUD, coloured dots on the minimap, and your place at the finish.
- **`npm run rivals`** (`tools/race-rivals.js`) races them per level and prints the order and the
  field's time against the line. On regular tracks, seeds 1–3, the field averaged 1.14 × the line
  on regular, 1.05 on advanced and 1.02 on expert, and the boss won every expert race.

What tuning found:
- **Acceleration is grip.** Handling's grip is GRIP × the acceleration, so +3% acceleration (Block's
  first twist) won nearly every race. The twists are turn rate only.
- **Pace matters less than expected.** From 0.86 to 1.0 a lap is only about 3% quicker: most of a
  lap is at top speed. The levels come as much from the line bias, the regular level's −3% top
  speed, the boosts and the slips.
- **Boosts dominate.** Used well, they make a lap about 15% quicker than the line's boost-free time.
  Boosted blindly into a gentle bend, a rival runs wide. A rival boosts only when its line ahead holds
  twice top speed for the burst and the slowdown after.
- **From the back, the boss lost in traffic.** It was quickest alone, but starting last it finished
  mid-field. It starts on pole now, the one to hunt down.

Not built yet: drifting and hopping rivals, named pilots with portraits and barks, home biomes,
a nemesis, and cups. Rivals don't avoid holes or rocks on the real surface (the headless track has
none). The passing logic is simple: a lot of side-by-side bumping in a tight field.
