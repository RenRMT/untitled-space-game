# Review of the main game, and a plan

Nov 10, 2026

The main game (`index.html`, `src/main.js`) is meant to be an MMO-like single-player RPG, played on
a phone held upright, after Freelancer and Hostile Space, with FF12-style gambits. `notes/roadmap.md`
listed what it needed; nearly all of that is built. This note checks the game as it now plays
against design practice, and says what changes. The race, idle, 4X and sim games are not touched.
Both art styles stay. Audio is out of scope.

## How it was checked
- Played from a fresh save in a 390×844 touch viewport, in both styles: the start, every station
  tab, the story briefing, the map, a dozen fights.
- Fights measured from a fresh save (level 1, starting gear, no squad).
- Read against the sources at the end.

## What practice asks for
1. **The first minutes teach by doing, one thing at a time, and get to the core loop fast.** A
   first quest that walks through moving, fighting and gearing up beats text.
2. **A phone is held in one hand.** What is tapped often sits in the bottom third, at 44–48 px or
   more; the HUD stays lean; the top of the screen is for reading.
3. **Failure is legible and cheap.** A player should see a loss coming, see why it happened, and
   be back in play quickly. What a loss takes away is time, so the gap between attempts is short.
4. **Gambits work when they trickle in.** FF12's best trick was pacing: new gambits and slots
   arrive as rewards, so trying them is progress. Its weakness was that fights played themselves;
   the player needs a job of their own in a fight.
5. **A level has to be felt.** Something new to do, rather than two percent more of a number.
6. **Freelancer's lesson:** move the player on before a zone gets dull, keep the world busy on the
   way, and vary the jobs.
7. **A game's interface belongs to its world.** Few words, icons and gauges over paragraphs, no
   form-like screens.

## What works (kept)
- The loop itself: contract → fly → fight → loot → gear up → harder space.
- The timeline fight with telegraphs and shield breaks that cancel heavy shots; it is drawn round
  the ships, which keeps the screen clear.
- Loot: rarity, item level, upgrade notices, fit-on-the-spot, one-of-three rewards.
- Gambits bought and found; programs as cards.
- Traffic, patrols, named elites, raids: the world reads as lived in.
- Dungeons with a layout per world.
- The two art styles, and a UI kit that follows each.

## What was found (and what changes)

### 1. The first fight can be an unfair death
The start system (level 1) holds tier 2 packs of three and four ships, some lying in ambush in a
nebula. A new pilot who flies into one dies in about six seconds: no warning, no time to act.
Nothing says how dangerous a ship is unless it is tapped first.

Tier 1 fights go the other way: two raiders are dead in five seconds, before a skill has come off
cooldown. The telegraph and cancel rules never get to matter.

- The start system has only tier 1 packs, and none in ambush.
- Fighters are sturdier and hit softer (`FOE`, `game/combat.js`): a fight lasts about twice as
  long, and a lone new ship comes out of a pack of three with over half its hull.
- A hostile's card already says Weak, Even or Outmatched, but only once it is tapped. Now every
  hostile on screen carries its level, in the colour of that verdict (green, amber, red): the MMO
  "con" colour, seen before the fight.

### 2. A new game says nothing
A fresh save opens on a ship beside a station, with no goal on screen. The story's first chapter
exists, but only on the fourth tab of the station screen, last in its list.

- A new game starts with chapter 1 already taken: its objective is on the HUD from the first frame.
- A dock opens on Missions whenever something there is new; the story is listed first and marked.
- One-line prompts, each shown once at the moment it applies: the controls in a new game, a first
  fight, a first drop (`game/tips.js`).

### 3. The fight controls are small and the pilot's own state is hard to read
The three skill buttons are about 40 px, in a box in the bottom centre. The pilot's hull and
shield are a thin arc on the ship. A loss is a line of small text.

- Skill buttons at thumb size, each with its cooldown swept over it.
- The pilot's hull and shield as a frame above the skills, the squad's beside it.
- A loss and a win each get a banner: what happened, what it cost or paid.

### 4. A level is not felt
A level adds 2% hull and 1.5% damage. All three class skills are there from the start, so there is
nothing to grow into, and three skills at once is a lot to learn in a first fight.

- Skills open by level: the first at 1, the second at 2, the third at 4. Squad members the same.
- A level up is a banner that names what it gave: a skill, a talent point, gear and hulls now in
  reach, program memory.

### 5. The station screens read like a web page
- Gambits are named like code imports (`import core.bool@1.0`). They get plain names.
- The Ship tab spells each skill out in a paragraph and wraps its headings. Skills become three
  chips; the detail waits behind a tap.
- Trade is the first tab, though it is the least part of the loop. Missions comes first.
- A gear comparison printed `2.6999999999999993`. Rounded.

### 6. Things that don't serve the loop (cut)
- **Attack as the first action on a friendly station.** It sat under the thumb, ahead of Dock. The
  freedom to attack anything stays (it warns first), but on anything that isn't hostile Attack is
  now the last action offered.
- **Rebuild timers in real minutes** (20 and 90). A clock that runs while the game is closed is an
  idle-game pattern. A wreck is rebuilt once the ship has been to another system.
- **`?combat=realtime`.** One combat mode; the flag goes (the engine stays, under the timeline).
- **Tools.** Weapon slots were still called tools, and the output stat spoke of rock and gas. They
  are guns now.

Looked at and kept: the deep-space sites. The README says flying to one finds nothing, but the
known ones have observatories to dock at, and they give the galaxy map its shape.

### 7. Smaller faults
- The map's bottom bar runs under the HUD buttons ("Reset view" is half hidden).
- The objective's label on the local map is drawn over the star.

## Order of work
All of the above is done, one commit each, in this order: the fights; the first session; the fight controls; levels; the
station screens; the cuts; the map and the documents.

## Left for later
- Talents that change how a class plays (most are still a share of a stat).
- A fourth skill per class at a high level.
- Contracts that are not fights (Freelancer's were criticised for sameness).
- Something to find at each deep-space site beyond its observatory.

## Sources
- Onboarding: [Apple, Onboarding for games](https://developer.apple.com/app-store/onboarding-for-games/),
  [Roblox, Onboarding](https://create.roblox.com/docs/production/game-design/onboarding),
  [Mighty Bear, Learning to teach](https://medium.com/mighty-bear-games/learning-to-teach-a-step-by-step-guide-to-making-an-in-game-tutorial-d58b0c98288a)
- Touch and HUD: [Roblox, Cross-platform design](https://create.roblox.com/docs/ui/cross-platform-design),
  [OpenReplay, Tap targets](https://blog.openreplay.com/improving-tap-targets-mobile-ux/),
  [Game UI vs web UI](https://dev.classmethod.jp/en/articles/game-ui-vs-web-ui/)
- Failure: [Game Developer, Against the death penalty](https://gamedeveloper.com/design/against-the-death-penalty),
  [Engadget, MMO death mechanics](https://www.engadget.com/2014-01-15-mmo-mechanics-exploring-death-mechanics.html),
  [Designing failure](https://bugnet.io/blog/designing-failure-how-to-make-losing-fun)
- Gambits: [PC Gamer on FF12's gambits](https://www.pcgamer.com/games/final-fantasy/turn-based-rpgs-are-officially-back-in-fashion-but-i-want-more-its-time-for-modern-developers-to-take-another-pass-at-ff12s-gambit-system),
  [Shamus Young, FF12 tour](https://www.shamusyoung.com/twentysidedtale/?p=53847)
- Loops and pacing: [Game Design Skills, Core loops](https://gamedesignskills.com/game-design/core-loops-in-gameplay/),
  [Freelancer (Wikipedia)](https://en.wikipedia.org/wiki/Freelancer_(video_game)),
  [Freelancer retrospective](https://yyoushouldplay.substack.com/p/freelancer-2003)
- Earlier notes: `notes/roadmap.md`, `notes/combat-research.md`, `notes/squad-logic.md`.
