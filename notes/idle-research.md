# Cold Start: research on idle games, city builders and earned automation

Nov 1, 2026

This is the research behind the "Manual, then automated" part of `notes/idle.md`. It looks at three things, each held up against Cold Start (`idle/`, `src/idle/`) as of commit 7d39137:

- what works in mobile idle games;
- what city-builder-like games add to that;
- what makes automation feel like a reward.

A word on the sources. Web search worked, but full pages on gamedeveloper.com, dev.to, bugnet.io and a Reddit mirror couldn't be fetched from where this was written, so some points come from search summaries of them. How specific games work (Factorio, AdVenture Capitalist, Idle Miner Tycoon, Universal Paperclips, Kittens Game, Stardew Valley, Egg Inc) is partly from knowing the games. Treat single numbers as anecdotal.

## 1. Idle games in general

**What works**
- **A reachable next goal, always in view.** It should be close enough to reach and big enough to matter, and the screen should say what it is. Rough pacing: several milestones in the first session, then one every 1 to 3 sessions.
- **Decisions before the wait.** Players put it as "numbers go up, but in a way I can influence with smart decisions". The interesting part is the planning before a timer runs. Aimless waiting is the most common complaint.
- **Layers that unlock over time,** with more automation as the game grows more complex.
- **Prestige as the retention loop.** Players who quit before the first reset never see the real game. Web incrementals put the first reset 10 to 35 minutes in; mobile games stretch it, but it still comes early and feels big. Players misjudge when to reset, so many games prompt the first one.
- **A "welcome back" summary.** An offline cap (12 hours is common) is a tuning knob for how often players come back.
- **Multiplicative upgrades** feel better than small linear ones (Kongregate's "Math of Idle Games", Pecorella's GDC talks).

**What players hate**
- Paywalls on progress, pay-to-win, forced ads and energy systems. Opt-in rewarded ads are tolerated; cosmetics draw almost no complaints.
- Too much at once early on, and long tutorials.
- Upgrades that only raise one number, with no change in how you play.
- A first prestige that comes far later than expected.

## 2. City builders

- **Placement and watching the place grow are the payoff.** Systems interlock, so one choice ripples through the rest. Cold Start fits this already: where a station goes sets its hauling distance, and the map shows haulers flying and the build scene.
- **The medium term is where city builders lose players.** Deconstructor of Fun on SimCity BuildIt: the short-term loop is strong, but medium-term goals are murky, so D14 and D30 retention suffer. Cold Start has the same shape: a station every 2 to 5 days after day 1.
- **Township and Hay Day:** grow, process in buildings, sell, and collect and re-queue by hand. Collecting is the session's activity.
- **Pocket City:** a one-off price, preferred by reviewers for casual play, with progression by unlocking buildings.
- **Logistics games:** "you can solve almost any problem by hand-building everything, which fans find anathema". The hand-built phase is where the core loop starts.

## 3. What makes automation a reward

1. **Feel the chore first, but briefly.** The contrast is what makes the relief land. Examples:
   - Factorio's handcrafting gets slow next to assemblers;
   - Universal Paperclips has a "Make Paperclip" button before AutoClippers;
   - AdVenture Capitalist has you tap each business before you hire managers.

   But Factorio took manual mining out (0.17) as "unfun manual labour". The manual phase is minutes, not hours.
2. **Automation promotes the player; it doesn't take work away.** The CHI 2018 idle taxonomy describes the genre as players moving from acting to planning. Each automation frees attention for the next bottleneck.
3. **The player chooses what to automate, and when.** Autonomy in self-determination theory. The feeling of growth matters as much as the numbers: a Torchlight II study found pacing changed how competent players felt in otherwise near-identical sessions.
4. **The moment it switches on is visible.**
5. **The manual way stays possible but is never needed again.** In AdVenture Capitalist you can still tap after hiring a manager.
6. **In an idle game, automation is what runs while you're away.**
   - An unmanaged business in AdVenture Capitalist or Idle Miner Tycoon doesn't earn offline. That is the strongest pull toward automating.
   - The risk is the opposite: if nothing is automated by the first time the player closes the app, the first return shows nothing. So the first automation has to land in the first session.

## 4. Other games that do it

| Game | By hand | Automated by |
| --- | --- | --- |
| AdVenture Capitalist | tap each business | a manager per business |
| Idle Miner Tycoon | tap shaft, elevator, warehouse | managers |
| Universal Paperclips | "Make Paperclip" | AutoClippers, then MegaClippers |
| Kittens Game | gather catnip | catnip fields, then workers |
| Factorio, Satisfactory, Dyson Sphere Program | handcraft, hand-feed | assemblers and belts |
| Mindustry | the core ship mines | drills |
| Stardew Valley | watering can | sprinklers |
| Egg Inc | tap to hatch | internal hatcheries |
| Cold Start (before this) | selling | auto-sell (Trade research): the only one |

## 5. Cold Start held up against it

- **Strong:**
  - real decisions (berths, routes, recipes, research order);
  - the away sheet, with fixes for what stopped;
  - the header's next thing to do;
  - no ads, energy or paywalls.
- **Gaps:**
  - nothing between the volatiles works (1 h 15) and the hub (day 1);
  - a station every 2 to 5 days after that;
  - the first new system only around day 10, and legacy is only a multiplier;
  - nothing says when stock will fill;
  - almost nothing starts by hand: shuttles came free with every station and drill site, and orders repeated forever.

## 6. What it led to

Four loops start by hand and are automated later, each bought or researched by the player:

| Loop | By hand | Automated by |
| --- | --- | --- |
| hauling | "Send hauler" | a shuttle bought per link, and later Haulage research |
| restarting orders | orders run in batches, then "Run again" | a foreman bought per station |
| contracts | tap to deliver | the contract clerk (research) |
| surveying | pick each survey | the probe network (research) |

Shared rules for all four:
- the manual way stays possible;
- every automation runs at fixed clock steps or exact event times, so time away comes out the same however it's settled;
- the away sheet names what stopped for want of automation.

`notes/idle.md` ("Manual, then automated") has what was built.

Left for later, from section 5:
- small milestones in the first day;
- an earlier or softer first jump;
- a legacy shop that carries automation over (start with foremen, the field's shuttle, the probes);
- per-system goals;
- tabs revealed as they're needed;
- contract streaks;
- "full in 3 h" estimates;
- compact numbers (1.2M).

## Sources

- Kongregate and Anthony Pecorella: [GDC: Idle Games, the Mechanics and Monetization](https://gdcvault.com/play/1022065/Idle-Games-The-Mechanics-and), ["Quest for Progress" slides](https://www.slideshare.net/slideshow/quest-for-progress-gdc-europe-2016/65405507), [The Math of Idle Games, Part III](https://www.gamedeveloper.com/design/the-math-of-idle-games-part-iii), [The rise of games you mostly don't play](https://www.gamedeveloper.com/design/the-rise-of-games-you-mostly-don-t-play)
- Design and pacing: [How to design an idle game (bugnet)](https://bugnet.io/blog/how-to-design-an-idle-or-incremental-game), [Player progression (abratabia)](https://abratabia.com/game-economy/player-progression.php), [Lessons of my first incremental game](https://www.gamedeveloper.com/design/lessons-of-my-first-incremental-game), [7 idle games in 30 days](https://dev.to/aguier/i-built-7-idle-games-in-30-days-what-i-learned-about-incremental-design-5d3f), [Subpixel's 10 rules](https://www.patreon.com/Subpixel/posts/10-rules-for-160530914)
- Players: [r/incremental_games: what makes an idle game fun](https://libreddit.neb.cx/r/incremental_games/comments/1epowcl/what_makes_an_idle_game_fun), [itch.io: prestige loop feedback](https://itch.io/t/5446445/feedback-prestige-loop-accelerates-to-endgame-levels-at-3-prestige-points), [AppFollow: paywall complaints](https://appfollow.io/blog/monetization-paywall-complaints-mobile-game-reviews)
- Offline and money: [Mind Studios: idle design and monetization](https://themindstudios.com/blog/idle-clicker-game-design-and-monetization), [CrazyGames: monetizing clickers](https://docs.crazygames.com/resources/monetizing-clicker/), [Pocket Gamer: Egg Inc](https://www.pocketgamer.biz/egg-inc-idle-games-gold-standard/), [Mergeciv: offline earnings](https://mergeciv.io/idle-progression)
- City builders: [Deconstructor of Fun: SimCity BuildIt](https://www.deconstructoroffun.com/blog//2015/02/simcity-buildit-nice-town-but-would-you.html), [Progression control in SimCity BuildIt](https://www.gamedeveloper.com/design/progression-control-in-sim-city-buildit), [Destructoid: Pocket City](https://destructoid.com/?p=227371), [How to design a city builder (bugnet)](https://bugnet.io/blog/how-to-design-a-city-builder), [An ode to optimization games](https://game-wisdom.com/critical/an-ode-to-optimization), [GDC: Cities: Skylines, a case study](https://gdcvault.com/play/1022809/Cities-Skylines-A-Case)
- Automation: [Factorio wiki: Crafting](https://wiki.factorio.com/Crafting), [Alt-F4 #34](https://alt-f4.blog/ALTF4-34/), [The Factorio Mindset](https://www.thediff.co/p/the-factorio-mindset), [Playing to wait: a taxonomy of idle games](https://research.monash.edu/en/publications/playing-to-wait-a-taxonomy-of-idle-games/), [Self-determination theory at GDC](https://www.gamedeveloper.com/marketing/self-determination-theory-at-gdc), [Torchlight II competence study](https://boa.unimib.it/handle/10281/250748), [Cookie Clicker and doing almost nothing](https://mechanicsofmagic.com/2025/05/24/cookie-clicker-satisfaction-of-doing-nothing/), [AdVenture Capitalist (Wikipedia)](https://en.wikipedia.org/wiki/AdVenture_Capitalist)
