# Archived systems

Systems taken out to keep the game to its core loop: trade and mine for credits, fight pirates
for components, research better gear, buy it, and take it into more dangerous space.

Everything here still exists, working, on the **`archive/pre-trim`** branch (commit `29ee61e`, the
`main` of 14 October 2026, after PR #20). To look at a system as it was, check out that branch
and open the files listed. To bring one back, start from those files and the removal commit
named in its entry (`git show <commit>` shows exactly what was taken out), and read "To bring it
back" first: some of these were never finished.

Each entry: what it did, how it worked, where the code lived, and what it would need to return.

## Missions tab

**What it was.** A third tab on the station screen (after Trade and Ship, later Research) with
the text "No contracts posted here yet". There were never any missions.

**Where it lived.** `station.js` (`renderMissions()`, the tab switch in `refresh()`),
`index.html` (the tab button).

**To bring it back.** A mission type first. Bounty contracts fit the loop best: "destroy the
pirate pack in sector x, y" (the packs are already generated per sector with a stable `pack`
index and keys), paid in credits on docking, with the contract saved in the cargo save. Then the
tab lists the contracts on offer and the one you hold.

## Distress signals, anomalies and the story signal

**What they were.** Three of the five deep-space contact types (`galaxy.deepSector()`):
- *Distress signal*: a stranded freighter of a random major faction (motion `still`), a wreck
  beside it and two or three jettisoned trade goods floating nearby.
- *Anomaly*: a lava or ice planet with a ring, named "Anomaly", inside a small asteroid field.
- *Story signal*: handcrafted points of interest from `GALAXY_CONFIG.storyPois` (one, "Unidentified
  signal" at sector 3, 5): a station wreck with salvage around it, shown on the map in cyan.

None of them did anything more: the freighter couldn't be helped or talked to, the anomaly was
scenery, the story point was a wreck. Derelicts (salvage) and ambushes (a pirate pack) stay.

**Where they lived.** `galaxy.js` (`CONTACT_TYPES` rows with their weights per zone, the `story`
list in `deepSector()`), `data/galaxy-config.js` (`storyPois`), `sector.js` (the contact
branches under "Deep-space contacts"), `map.js` (story signals pinged in cyan).

**To bring them back.** Each needs an outcome. Distress: rescue (escort or repair the freighter
for credits, or a reward on docking), or a trap (an ambush pack arrives). Anomaly: something to
scan or mine there (rare goods or components). Story signals: a reason to visit, such as a
unique component or a research unlock.

## Trading posts, research outposts, refineries and hermitages

**What they were.** Four of the six outpost types (`OUTPOST_TYPES` in `galaxy.js`). An outpost is a
single minor station in its own sector. These four only differed in their market
(`Economy` `PROFILES`): trading posts made manufactured goods and stocked every category,
research outposts made synthetics, refineries made metals, gases and liquids and wanted
minerals, hermitages made fabrics and food. Nothing else set them apart; the research outpost had
nothing to do with research. Mining camps (an asteroid field) and salvage yards (wrecks with
salvage) stay.

**Where they lived.** `galaxy.js` (`OUTPOST_TYPES`), `economy.js` (`PROFILES`).

**To bring them back.** Add the types back to `OUTPOST_TYPES` and their profiles to `PROFILES`;
better, give each something of its own first (a refinery that turns ore into metal, a research
outpost that researches cheaper or faster, a trading post with contracts).

## Frontier start

**What it was.** A second way to begin, chosen under Settings → Map ("Core start" / "Frontier
start", also `?start=frontier`). The same galaxy plus one extra Waystation 2–4 sectors in from a
corner or an edge, placed from its own random stream so the rest of the galaxy stayed identical.
The player started there with only that Waystation charted: the map showed nothing beyond what
had been explored (stats line, framing and the frontier ring all followed the charts), and no
hostile contacts or raiders spawned within two sectors. Each start style kept its own charts and
cargo (the save key gained `:frontier`).

**Where it lived.** `galaxy.js` (`START_STYLES`, the "Frontier start" block, `w.start` in
`nearWaystation`, `saveKey`), `map.js` (`startStyle`, `setStartStyle`, `hiddenStart` and its uses
in `updateStats`, `frameArea` and `drawStatic`), `knowledge.js` (`chartStart`), `game.js` (the
Map setting), tests in `tests/run.js` and `tests/smoke.js`.

**To bring it back.** It depended on Waystations and the frontier ring, both of which are later
removed or reshaped; it would now be "start at a remote outpost with nothing charted". The fog of
war (`knowledge.js`) still supports it: chart only the start, and hide what isn't explored.

## NPC traffic

**What it was.** Ships of the factions going about their business, inside the charted pockets
only: 1–6 per sector (more around systems, 3–5 at Waystations), owners picked by the sector's
faction presence. Freighters ran out and back between a station or star and a gate (or the
sector's edge) on a `route` motion; fighters circled a station or star on an `orbit`. In claimed
space outside the pockets a pair of the owner's fighters patrolled now and then (15% of
sectors). None of them could be attacked, hailed or traded with: only pirates are hostile.

**Where it lived.** `sector.js` (the "Traffic" block in `build()`, the `route` motion helper and
its case in `pose()`), `loadout.js` (the NPC `freighter` hull and its gear, still there for
freighter loot and the hauler's art).

**To bring it back.** It needs factions (who owns the ships) or a stand-in. To matter it needs
interaction: escort or trade contracts, freighters pirates attack, patrols that help in a fight.
