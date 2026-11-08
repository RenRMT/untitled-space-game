# Combat: turn-based that still feels dynamic

**Decision (November 2026):** fights with ships run on an **action timeline** with the ships
still flying (`combat/combat.js`, the default Combat setting; its saved name stays `rounds`). Real
time (`combat/combat-realtime.js`) stays as the alternative. The big combat panel is gone: the fight
is drawn round the ships, and only a small skill bar remains.

## What was wrong

- **The player's ship often didn't fight.** In real time (the default then) your guns fire only with
  the target inside their forward arc (the mining laser's is 60°). The ship turns to face its
  target only while it isn't steered; in Cruise, Attack from the context menu left the ship
  flying on at its approach speed, so it sailed past with its guns pointing the wrong way. Pirates on
  attack runs overshoot, so even a parked ship lost them often.
- **Rounds were static.** Every ship stopped dead and every 1.5 s all of them fired at once. The
  only choices were which enemy to focus and Flee. Class skills never landed in rounds at all
  (the mode didn't resolve activations).
- **The panel hid the fight.** A tall panel listed every ship with bars, aims and log lines, while
  the same information was already drawn on the ships.

## What turn-based games do to stay dynamic

| Pattern | Seen in | What it gives |
|---|---|---|
| Per-unit charge gauges instead of shared rounds (Active Time Battle) | Final Fantasy IV–IX, XII | Turns overlap; speed is a stat you feel; no dead time waiting for a round |
| A visible turn order, actions with their own delay (Conditional Turn-Based) | Final Fantasy X | Planning against a known order; risk vs reward per action |
| A timeline where a hit during an enemy's wind-up **cancels** it | Grandia II/III | The defining "dynamic" moment of a turn-based fight: you react to what's coming |
| **Telegraphed intents**: enemies show what they'll do and to whom | Into the Breach, Slay the Spire | Every turn is a decision against known threats; losses feel fair |
| Break / stagger: depleting a defence knocks the enemy back | FF XIII, Octopath Traveler | Momentum; focusing fire pays off visibly |
| Positioning between or during turns | Grandia, XCOM | Movement matters without needing twitch reflexes |
| Information on the battlefield, not in menus | most modern tactics games | Eyes stay on the action |

Sources: [Grandia II (Wikipedia)](https://en.wikipedia.org/wiki/Grandia_II),
[Grandia III review (RPGamer)](https://rpgamer.com/review/grandia-iii-review-2/),
[Conditional Turn-Based Battle (Giant Bomb)](https://giantbomb.com/wiki/Concepts/Conditional_Turn_Based_Battle),
[Active Time Battle (Giant Bomb)](https://giantbomb.com/wiki/Concepts/Active_Time_Battle),
[Turn-based vs active-time battles (OHRRPGCE wiki)](https://rpg.hamsterrepublic.com/ohrrpgce/Turn-based_battles_compared_to_Active-time_battles),
[Road to the IGF: Into the Breach (Game Developer)](https://gamedeveloper.com/game-platforms/road-to-the-igf-subset-games-i-into-the-breach-i-),
[What can we learn from Into the Breach?](https://sleepingbagworm.blogspot.com/2024/01/what-can-we-learn-from-into-breach.html).

## Options weighed

1. **Keep rounds, fix the bugs.** Cheapest; still static, still one choice per fight.
2. **Pure turn-based with menus (pick an action per turn).** Clear, but it stops a flying game dead,
   and the squad already acts on its own programs (gambits).
3. **Simultaneous turns (WEGO).** Strong for tactics games with many units and orders; too much
   ceremony for a ship that's already being flown.
4. **Action timeline + telegraphs + cancels, ships flying (chosen).** Keeps the readability of turns
   (discrete volleys you can count), adds per-ship tempo, gives the player real decisions mid-fight
   (switch fire to cancel a heavy shot, time a skill, fly to dodge or get clear), and fits what was
   already there: FF12-style gambits for the squad, class skills with activation times, and the
   real-time mode's steering for enemies.

## How it plays (as built)

- **Gauges.** Every ship's action gauge charges over its turn (1.5 s, up to 15% quicker or slower
  by scanner initiative). Full: a volley from every weapon in reach of its target. Out of reach,
  it holds full and fires the moment it reaches. A fight you start begins with your gauge half full
  (first strike); an ambush starts it empty.
- **Telegraphs.** Each enemy picks its next action as its gauge starts: a volley, or (30%) a heavy
  shot that charges 1.8× as long and hits 2× as hard. Its target and what it is charging are shown
  on the ship.
- **Breach and cancel.** A hit that takes a ship's shields down knocks its gauge back by a third,
  and cancels a heavy shot it was charging. Retargeting is free, so the play is: see the orange
  ring, switch fire to it, break its shields before it lands.
- **Flying.** Everyone keeps flying. Weapons fire all round; a target inside a weapon's field of fire
  is +10% to hit; evasion counts half at rest and in full from half top speed; long range costs
  accuracy. The ship eases to a stop as a fight starts so it doesn't cruise out of it; fly clear of
  every enemy's guns for 3 s to get away.
- **Skills** (keys 1–3, the skill bar) now land in this mode too; an EMP freezes a gauge.

## On screen

- Round each ship: its action gauge (yours cyan, the squad's light blue, enemies red; orange for a
  heavy shot). A dashed full ring: holding fire, out of reach.
- From each enemy: a dashed line to whom it's after, firming up as its turn nears; a heavy shot's
  line is orange and pulses as it comes due, with `A · HEAVY → you 0.8s` above the ship.
- Over each ship: shield and hull bars, its letter, damage numbers per volley (`−30!` for a heavy),
  `BREACH` / `CANCELLED` when shields go down.
- Breaking away: a cyan ring closing round your ship and a countdown.
- Below: only the skill bar (class skills and consumables). The outcome is a notice.

## Balance

Checked by simulation in `tests/run.js` with the player parked and facing its target (flying well does
better): the starter Courier beats one Mk I pirate easily, two most of the time at a real cost, and
loses to three or four; each step up the gear ladder takes on the next band. The opening missions'
fights stay winnable.

## Later

- Let the player bank a full gauge (hold fire) to time volleys with a breach.
- A heavy-shot cancel bonus (e.g. the cancelled ship loses more gauge) if cancelling feels weak.
- Squad logic conditions for intents (`enemy.charging(heavy)`), so wingmen can cancel too.
