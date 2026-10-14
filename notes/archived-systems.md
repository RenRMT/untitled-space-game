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

## Trade goods research doesn't use

**What they were.** The catalogue (`goods.js`) had 62 trade goods in nine categories, each with a
rarity (common to exotic), a base price and a colour of its own. It now keeps the 21 that research
(`research.js`) asks for:

| Category | Kept | Taken out |
| --- | --- | --- |
| Metals | iron, titanium, platinum | aluminium, copper, silver, gold, neutronium |
| Minerals | corundum, diamond | quartz, hematite, malachite, fluorite, beryl, void crystal |
| Gases | deuterium, helium-3 | hydrogen, nitrogen, ammonia, argon, xenon, antihydrogen |
| Synthetics | carbon fibre, aerogel, graphene, metamaterial | polymer sheet, fibreglass, aramid weave, programmable matter |
| Manufactured | electronics, robotics, AI cores | tools, spare parts, medical supplies, luxury goods, precursor relics |
| Liquids | hydrazine, nanite suspension | water, coolant, sulphuric acid, heavy water, ferrofluid, quantum fluid |
| Conduits | steel pipe, copper cable, optical fibre, superconductor cable, plasma conduit | plastic conduit, tachyon conduit |
| Fabrics (whole category) | | cotton, nylon, wool, silk, spider silk, smart fabric, nanoweave |
| Food (whole category) | | algae paste, grain, fresh fruit, coffee, spices, saffron, xenoflora |

With them went every exotic trade good (rarity 5), the fabric and food item art
(`art/items.js`: "Fabric bolts", "Produce crate"), and the market profiles' uses of those two
categories. Because everything left is needed for research, markets stock rarer goods more
often (`Economy.config.stock`), and each category on sale always stocks its commonest type.
Minerals and gases now start at rare, so mined stony and icy asteroids are worth more than before.
Old saves drop goods that no longer exist (`Goods.resolve` gives null).

**Where it lived.** `goods.js` (`TABLE`, `CATEGORIES`, `LEGACY_LABELS`), `art/items.js` (the two
category shapes), `economy.js` (`PROFILES`, `config.stock`).

**To bring them back.** Copy the rows back into `TABLE` (and the fabric and food shapes into
`art/items.js`). They'd want a use beyond buying low and selling high: more research recipes, or
station demand that makes some runs worth flying.

## Jump gates, lanes and hidden routes

**What they were.** A fast-travel network between systems (`galaxy.routes`): *lanes* joined each
faction's neighbouring systems (a minimum spanning tree per cluster plus a loop or two), *gates*
joined factions to each other (a spanning network over nearby majors, links to the main
faction's network, about half the minor factions, colonies back to their home cluster), and
*hidden* routes led into one or two isolated major factions and sometimes to a Waystation. Every
route had a gate station at each end, built in the culture of the faction that owned the system
(or the major at the other end), on the side facing the destination. Flying into a gate's
aperture (or pressing Jump on its card within 500 units) carried the ship to the partner gate,
with a white flash; a gate lock stopped it bouncing straight back, and jumping was locked in
combat. Using a gate charted its route, hidden ones included. The fog of war started with the
start system's whole network charted, the map drew lanes in faction colours and gates as dashed
lines (hidden ones red, behind the dev "Hidden" toggle), and a system's map card listed its links.
Off-screen gates within 1.5 sectors got edge markers.

The art had six gate forms, one per lineage (ring, halo, frame, pylons, spar, maw), each with a
clear "field" aperture.

**What replaced them.** Flying and map travel (`travel.js`). Every settled system is charted
from the start. Off-screen *stations* within 1.5 sectors now get the edge markers gates had.

**Where it lived.** `galaxy.js` (the "Lanes", "Gates" and "Routes" sections, `isolated` on
factions), `sector.js` (`gatesAt`, gate entities with `dest`, `link`, `aperture`), `entities.js`
(the `gate` kind), `game.js` (`partnerGate`, `checkGates`, `jumpVia`, the `jump` action,
`gateLock`, `gateFlash`, gate nav markers), `knowledge.js` (`routes`, `knowRoute`, charting the
start network), `map.js` (route drawing, `routeKnown`, the Hidden toggle, links rows, legend),
`art/blueprints.js` (the "Gate stations" section), `art/culture.js` (`gate` and `gateNote` per
lineage), `art/render.js` (the `field` material), tests in both suites.

**To bring them back.** Routes need something to join; with factions gone they'd join systems
directly (nearest neighbours). Restore the gate art and the gate entity first, then
`checkGates`/`jumpVia` and route knowledge; the rest of the network logic depended on factions.

## Factions, territory and Waystations

**What they were.** The galaxy's politics. A *main faction* held the centre (its capital the start
system), seven to nine *major factions* of uneven size grew outward from capitals at least 14
sectors from the centre, and 15–25 *minor factions* of one to three systems filled the gaps; some
majors had a colony away from home. Each faction spread a control field over the map (a Gaussian
per system, `sigma` and `reach` per tier): a sector belonged to the faction with the most control
above `ownThreshold`, and was *contested* when a rival had at least 60% of the owner's control.
Every sector had a `presence` list (each faction's share), each system a `dominance`. Outside the
charted pockets, owned space was the *claimed* zone. There were also network factions without
territory: the *Waystations* (neutral safe havens on the outer edge of settled space, named by a
registry code like "Waystation KX-418", with their own market profile and no pirates nearby), and
the pirates, smugglers and guild.

None of this changed play beyond colour: no reputation, no prices by faction, no wars. Security
came from the zone (pocket, claimed, deep, frontier) plus Waystation proximity.

Art followed politics: each major faction got one of six lineages (wedge, arc, block, shard,
spindle, coral), minor factions *descended* from the nearest major (blending its numbers by an
`influence` share), and independents used a fixed culture.

The map drew faction borders (a tint and an outline per owned sector, for factions on your
charts), contested stripes, systems in faction colours (minor ones smaller, independents hollow,
Waystations as diamonds, major capitals ringed), presence and dominance rows on the info panels,
and a stats line counting factions and Waystations. The flight HUD named the sector's owner and
any rival, and the minimap's frame took the owner's colour. Station cards named the owning
faction, and ships the faction they flew for.

**What replaced them.**
- *Cultures*: three regions, wedge, block and shard (`galaxy.cultures`), each system taking
  the culture of the nearest of three anchor points, and each outpost the culture of its nearest
  system. Culture sets the art and the colour on the map, nothing else. Pirates kitbash from all
  three. The one capital is still at the centre.
- *Security from distance*: each sector's security comes from its distance to the nearest
  settled system (`params.security`: high within 1.5 sectors, medium within 3.5, low within 6,
  lawless beyond). Outposts don't count, so a mining camp can sit in rough space.
- The map tints explored sectors by security; info panels show culture and security; the HUD
  shows the pocket's name in its culture's colour; the minimap frame shows the security colour.

**Where it lived.** `galaxy.js` (the "Factions", "Control", "Territory" and "Waystations"
sections, `factions`, `presence`, `owner`/`dominance`/`contestedBy` on `territoryOf`,
`factionColor`, `factionName`, `nearWaystation`), `data/galaxy-config.js` (`factions`,
`networks`, sigma overrides), `art/culture.js` (`descend`, the arc, spindle and coral lineages,
`independent`, faction assignment in `forGalaxy`), `art/blueprints.js` (the arc, spindle and
coral hulls, wings, insignia and station topologies), `sector.js` (station owners, border
skirmish debris, the Waystation sector), `economy.js` (the `waystation` profile), `entities.js`
(faction names on cards), `map.js` (borders, contested stripes, faction legend rows,
`presenceRows`), `game.js` (owner and rival on the HUD, the claimed zone), `knowledge.js`
(`knowsFaction`), the Asset Gallery's faction picker, tests in `tests/run.js`.

**To bring them back.** Factions want a mechanic first: reputation (docking, prices, which
pirates hunt you), territory that pirates or players can change, or missions given per faction.
The control-field generator can come back almost unchanged from `galaxy.js` on the archive
branch; security would then add faction strength back to distance. The extra lineages are pure
art and can return on their own (add them to `LINEAGES` and `CULTURES`).
