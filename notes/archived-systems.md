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
