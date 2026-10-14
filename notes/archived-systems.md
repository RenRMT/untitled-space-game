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
