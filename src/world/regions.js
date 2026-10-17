// What each system in the galaxy is, politically: its region (the part of known space it belongs
// to), who holds it, who else is there, and the local situation that gives it its mission hooks.
// The galaxy (world/galaxy.js) grows its map from REGIONS by their link rules, generates each
// system with its region's params, then settles it here. Factions are world/factions.js's.
//
// Regions, roughly from the capital outward:
//   capital  the Meridian Compact's capital system; core: the Compact's core systems around it,
//   combine  a Lattice Combines company system (one of Hadal, Tessaro, Corvane runs it),
//   see      a Facet system, small and concentrated, linked to the core by one route or two,
//   spoke    an outer Compact colony (the Assembly of Spokes), resentful of the hub,
//   claims   a belt system of Free Claim camps and Combine buyouts, low security,
//   veil     a nebula-heavy system at the end of the pilgrim routes: hermitages, gas harvesting,
//            ambush crews, and lights in the gas,
//   reach    lawless space at the edge: pirates, wreck fields and whoever hides there,
//   gateway  the one system the tutorial's gate leads to: a Spoke frontier colony,
//   tutorial the waystation's own system (its layout is the galaxy's first system's; see galaxy.js).
//
//   Regions.REGIONS[key] -> { key, label, holder (faction id or null), build (culture id of what
//     the region builds when no faction of its own does), params (SolarSystem params), owners,
//     present, maybe, waystation (chance), parents, sector, out, cluster, gates (max) }
//   Regions.LINKS: [[region, region, chance]]: extra links between neighbouring systems
//   Regions.SITUATIONS: the local situations, each { id, title, regions, factions, needs, text, hooks }
//   Regions.linkChance(a, b) -> the chance two neighbouring systems of these regions are linked
//   Regions.settle(system, key, r, ctx) gives a generated system its politics, in place:
//     stations get `owner` (a faction id) and the owner's culture (and some a name to match),
//     gates the culture of whoever holds the system, and the system:
//       region: { key, label }, holder: faction id or null, branch: the Combine running it or null,
//       places: the names its situations' text uses ({ system, station, hub, camp, yard, waystation,
//         nebula, belt, branch, neighbour }, those it has),
//       factions: [{ id, hidden, stations }], situations: [{ id, title, text, factions,
//         hooks: [{ i (its place in SITUATIONS' list), from, text, against }] }]
//     ctx: { neighbours: [system names], used: Map(situation id -> times used so far) }
// ES module (`Regions`); also runs in Node (the tests).

import { Factions } from './factions.js';

const Regions = (() => {
  // Settled cultures (world/solar-system.js CULTURES) by faction.
  const CULTURE = { compact: 0, combines: 1, facet: 2, registry: 3 };
  const BRANCHES = ['Hadal Extraction', 'Tessaro Fabrication', 'Corvane Logistics'];

  // Station owners by station kind, as [[faction, weight]]; the capital goes to the holder, a
  // salvage yard to the Breakers' Guild and a waystation to the Registry, everywhere.
  const REGIONS = {
    tutorial: {
      label: 'Waystation reach', holder: 'registry', build: 0,
      owners: {}, present: [], maybe: [], waystation: 1,
    },
    gateway: {
      label: 'Spoke frontier', holder: 'compact', build: 0,
      owners: { major: [['compact', 1]], minor: [['compact', 2], ['freeClaim', 1]], camp: [['freeClaim', 3], ['combines', 1]] },
      present: ['freeClaim', 'pirates'], maybe: [['brokenWheel', 0.6], ['union', 0.4], ['owed', 0.3]], waystation: 1,
      parents: ['spoke'], sector: 'compact', out: 2, gates: 3,
    },
    capital: {
      label: 'Compact capital', holder: 'compact', build: 0,
      params: { radius: 48000, pirates: { density: 0.3, lawlessAmbushes: [0, 1] } },
      owners: { major: [['combines', 2], ['compact', 1]], minor: [['compact', 3], ['combines', 1], ['facet', 1]], camp: [['combines', 2], ['freeClaim', 1]] },
      present: ['collegium', 'union'], maybe: [['facet', 0.6], ['blackline', 0.3]], waystation: 0,
      gates: 5,
    },
    core: {
      label: 'Compact core', holder: 'compact', build: 0,
      params: { radius: 44000, pirates: { density: 0.35, lawlessAmbushes: [0, 1] } },
      owners: { major: [['combines', 1], ['compact', 1]], minor: [['compact', 2], ['combines', 2]], camp: [['combines', 2], ['freeClaim', 1]] },
      present: ['union'], maybe: [['collegium', 0.5], ['combines', 0.6], ['blackline', 0.2]], waystation: 0.1,
      parents: ['capital', 'core'], out: -1, cluster: 1, gates: 4,
    },
    combine: {
      label: 'Company system', holder: 'combines', build: 1,
      params: { radius: 44000, stations: { minor: [2, 3], miningCamps: [2, 2] }, pirates: { density: 0.45 } },
      owners: { major: [['combines', 1]], minor: [['combines', 3], ['compact', 1]], camp: [['combines', 3], ['freeClaim', 1]] },
      present: ['union'], maybe: [['blackline', 0.6], ['scorched', 0.5], ['collegium', 0.4]], waystation: 0.1,
      parents: ['capital', 'core', 'combine'], sector: 'combines', out: 0, cluster: 0.8, gates: 4,
    },
    see: {
      label: 'Facet see', holder: 'facet', build: 2,
      params: {
        radius: 32000, planets: { count: [3, 5], first: [3600, 4400], gap: [2600, 3600] },
        nebulae: { count: [2, 2], r: [3500, 5000] }, stations: { major: false, minor: [2, 3], miningCamps: [0, 1] },
        security: { high: 7000, medium: 13000, low: 20000 }, pirates: { density: 0.3, lawlessAmbushes: [0, 1] },
      },
      owners: { minor: [['facet', 4], ['compact', 1]], camp: [['facet', 1], ['freeClaim', 1]] },
      present: ['owed'], maybe: [['unfaceted', 0.7], ['collegium', 0.3], ['union', 0.3]], waystation: 0.1, // pilgrims avoid the "cold houses"
      parents: ['core', 'capital', 'see'], sector: 'facet', out: 0.5, cluster: 2, gates: 3,
    },
    spoke: {
      label: 'Spoke colony', holder: 'compact', build: 0,
      params: {
        radius: 38000, stations: { minor: [1, 2], miningCamps: [1, 1] }, nebulae: { count: [1, 2], r: [3500, 6000] },
        security: { high: 7000, medium: 13000, low: 20000 }, pirates: { density: 0.6 },
      },
      owners: { major: [['compact', 1]], minor: [['compact', 2], ['freeClaim', 1], ['combines', 1]], camp: [['freeClaim', 2], ['combines', 1]] },
      present: ['pirates'], maybe: [['brokenWheel', 0.7], ['freeClaim', 0.6], ['union', 0.3]], waystation: 0.3,
      parents: ['core', 'capital', 'spoke'], sector: 'compact', out: 1, gates: 3,
    },
    claims: {
      label: 'Claim belt', holder: null, build: 1,
      params: {
        radius: 36000, belts: { outer: 1 }, fields: { count: [3, 4] }, nebulae: { count: [0, 1], r: [3500, 5500] },
        stations: { capital: false, major: false, minor: [0, 1], miningCamps: [2, 3] },
        security: { high: 6000, medium: 11000, low: 17000 }, pirates: { density: 0.7 },
      },
      owners: { minor: [['freeClaim', 1], ['combines', 1]], camp: [['freeClaim', 2], ['combines', 2]] },
      present: ['freeClaim', 'combines', 'pirates'], maybe: [['blackline', 0.6], ['scorched', 0.5], ['union', 0.5]], waystation: 0.35,
      parents: ['combine', 'spoke', 'claims'], sector: 'claims', out: 1.5, gates: 3,
    },
    veil: {
      label: 'Pilgrim nebula', holder: null, build: 2,
      params: {
        radius: 40000, nebulae: { count: [3, 4], r: [5000, 7500] }, fields: { count: [1, 2] },
        stations: { capital: false, major: false, minor: [1, 2], miningCamps: [0, 1], yard: false },
        security: { high: 6000, medium: 11000, low: 17000 }, pirates: { density: 0.55 },
      },
      owners: { minor: [['facet', 2], ['combines', 1]], camp: [['combines', 1], ['freeClaim', 1]] },
      present: ['facet', 'pirates', 'thren'], maybe: [['unfaceted', 0.6], ['combines', 0.6]], waystation: 0.3,
      parents: ['see', 'veil'], sector: 'facet', out: 1.5, gates: 3,
    },
    reach: {
      label: 'Lawless reach', holder: null, build: 0,
      params: {
        radius: 36000, stations: { capital: false, major: false, minor: [1, 1], miningCamps: [0, 1] },
        security: { high: 5000, medium: 9000, low: 14000 }, pirates: { density: 0.9, lawlessAmbushes: [2, 3] },
        derelicts: { count: [8, 11] },
      },
      owners: { minor: [['freeClaim', 1], ['compact', 1]], camp: [['freeClaim', 1]] },
      present: ['pirates', 'breakers'], maybe: [['brokenWheel', 0.4], ['scorched', 0.3], ['unfaceted', 0.3]], waystation: 0.45,
      parents: ['spoke', 'claims', 'veil', 'reach'], out: 2.5, gates: 3,
    },
  };
  for (const [key, R] of Object.entries(REGIONS)) Object.assign(R, { key, params: R.params || {}, parents: R.parents || [], out: R.out || 0, cluster: R.cluster || 0, gates: R.gates || 3 });

  // Extra gate links between neighbouring systems, beyond the one each system grew from: the
  // trade, haulage and pilgrim routes that make loops. Pairs not listed are never linked directly
  // (the core doesn't open onto lawless space; the Facet keeps its sees apart from company space).
  const LINKS = [
    ['capital', 'core', 1], ['core', 'core', 0.7], ['capital', 'combine', 0.6], ['core', 'combine', 0.6],
    ['combine', 'combine', 0.6], ['capital', 'see', 0.3], ['core', 'see', 0.3], ['see', 'see', 1],
    ['core', 'spoke', 0.5], ['spoke', 'spoke', 0.4], ['combine', 'claims', 0.7], ['spoke', 'claims', 0.4],
    ['claims', 'claims', 0.5], ['see', 'veil', 0.6], ['veil', 'veil', 0.5], ['claims', 'veil', 0.35],
    ['spoke', 'reach', 0.4], ['claims', 'reach', 0.5], ['veil', 'reach', 0.5], ['reach', 'reach', 0.4],
    ['gateway', 'spoke', 0.3], ['gateway', 'claims', 0.3], ['gateway', 'reach', 0.4],
  ];
  const linkChance = (a, b) => (LINKS.find(([x, y]) => (x === a && y === b) || (x === b && y === a)) || [0, 0, 0])[2];

  // Local situations: what is going on in a system when the story starts, built from the
  // factions' concerns (notes/factions.md), and the work each side would put the player to.
  // regions: where it can happen; factions: who is in it (they, and everyone its hooks name, are
  // added to the system's factions);
  // needs: places it names ({camp}, {yard}, {waystation}, {nebula}, {hub}, {neighbour}).
  // In text: {system}, {station} (the main station), {hub}, {camp}, {yard}, {waystation},
  // {nebula}, {belt}, {neighbour} (a linked system) and {branch} (the Combine there).
  // hooks: [from, what they want done, against whom (or null)].
  const SITUATIONS = [
    // ----- The Compact and the Broken Wheel -----
    {
      id: 'levy', title: 'The levy stand-off', regions: ['spoke', 'gateway'], factions: ['compact', 'brokenWheel'],
      text: 'The {system} colony families have voted to withhold this year\'s levy until the Admiralty stations a patrol here. {station} is full of Chancery assessors, and someone is painting cut wheels on the cargo pods.',
      hooks: [
        ['compact', 'The Chancery wants its assessor escorted to the outlying stations and back', 'brokenWheel'],
        ['compact', 'The Assembly of Spokes families want their petition carried to the capital, unread', null],
        ['brokenWheel', 'A cell needs supplies run to a hidden pocket past the assessors', 'compact'],
      ],
    },
    {
      id: 'patrols', title: 'Who pays for the patrols', regions: ['spoke', 'gateway', 'core'], factions: ['compact', 'pirates'],
      text: 'The Admiralty pulled its patrol back to the core while the budget fight drags on. Pirate packs work the lanes beyond {station} openly now, and the local captains will hire anyone with guns.',
      hooks: [
        ['compact', 'The station commander posts a bounty on the pack that took a levy shuttle', 'pirates'],
        ['pirates', 'A crew wants the new patrol schedule from {station}, and pays in components', 'compact'],
        ['freeClaim', 'Prospectors want an escort out to their claims and back', 'pirates'],
      ],
    },
    {
      id: 'cut-rim', title: 'Cut rim', regions: ['spoke', 'gateway', 'core'], factions: ['compact', 'brokenWheel', 'freeClaim'],
      text: 'A Compact relay near {station} went dark: sabotage, the Admiralty says, with a cut wheel scratched into the casing. The colonists swear they saw nothing, and the claim camps have gone very quiet.',
      hooks: [
        ['compact', 'The Admiralty wants the relay\'s spare parts hauled out under guard', 'brokenWheel'],
        ['brokenWheel', 'A wanted organiser needs passage out to {neighbour}', 'compact'],
        ['freeClaim', 'The camps want proof they had nothing to do with it before the Admiralty decides they did', null],
      ],
    },
    {
      id: 'project', title: 'The quiet project', regions: ['capital', 'core'], factions: ['compact', 'collegium'], needs: ['hub'],
      text: 'A Collegium lab at {hub} runs on Admiralty money, and everyone knows what the Admiralty wants from it: a way past the pacification signal. Its Ethicists have started asking where the test subjects come from.',
      hooks: [
        ['collegium', 'An Ethicist wants a copy of the lab\'s records carried out quietly', 'compact'],
        ['compact', 'The Admiralty needs rare components delivered to the lab, with no manifest', null],
        ['collegium', 'An Engineer wants old android logic recovered from a derelict', null],
      ],
    },
    {
      id: 'reclamation', title: 'The reclamation reform', regions: ['capital', 'core', 'reach'], factions: ['compact', 'breakers'], needs: ['yard'],
      text: 'The Chancery is drafting a reform that would let a wreck\'s owners reclaim it. At {yard} the Breakers are stripping every hull they hold before it passes, and old owners are turning up with papers.',
      hooks: [
        ['breakers', 'The yard pays well for derelicts salvaged and brought in before the reform', null],
        ['compact', 'A Chancery clerk wants the derelicts of {system} surveyed and their owners logged', 'breakers'],
        ['breakers', 'Someone has to tow a disputed hull away before its owners arrive', 'compact'],
      ],
    },
    // ----- The Combines, the Bay Union, Blackline and the Scorched -----
    {
      id: 'strike', title: 'The strike vote', regions: ['combine', 'claims'], factions: ['union', 'combines', 'blackline'], needs: ['camp'],
      text: 'A fatal accident at {camp} has the Bay Union crews voting on a strike against {branch}. Blackline crews have started turning up under other names.',
      hooks: [
        ['union', 'Carry the ballots in from the outlying camps before the count', 'blackline'],
        ['combines', 'Haul replacement ore past the picket line', 'union'],
        ['blackline', 'Keep watch on the organisers; no questions, good pay', 'union'],
      ],
    },
    {
      id: 'robotics', title: 'Bays without crews', regions: ['combine', 'core'], factions: ['combines', 'union', 'collegium'], needs: ['hub'],
      text: 'Tessaro robotics are replacing whole bay crews at {hub}. The Union calls it a lockout by other means; the Collegium is studying the logic the machines run on.',
      hooks: [
        ['combines', 'Tessaro needs robotics parts delivered before the next shift change', 'union'],
        ['union', 'The bay crews want proof the robots fail more than Tessaro admits', 'combines'],
        ['collegium', 'A researcher wants a robot\'s logic core brought in for study', null],
      ],
    },
    {
      id: 'burning', title: 'Freighters burning', regions: ['combine', 'claims'], factions: ['combines', 'scorched', 'union'],
      text: 'Scorched raiders have hit three Corvane freighters on the haul route to {neighbour}. Insurance has tripled, and the cargo they free keeps turning up in workers\' settlements.',
      hooks: [
        ['combines', 'Corvane wants a convoy escorted through to {neighbour}', 'scorched'],
        ['scorched', 'A freed cargo has to reach a workers\' settlement before Corvane finds it', 'combines'],
        ['union', 'The Union wants the families of a dead crew moved somewhere safe', null],
      ],
    },
    {
      id: 'hunt', title: 'The hunt', regions: ['claims', 'combine', 'reach'], factions: ['blackline', 'scorched', 'union'],
      text: 'Blackline is hunting a Scorched cell said to hide among the Union crews of {system}. Every crew is being searched, and every search makes more Scorched.',
      hooks: [
        ['blackline', 'Blackline pays for the cell\'s location, and more for its leaders', 'scorched'],
        ['scorched', 'The cell needs its families moved out before the next search', 'blackline'],
        ['union', 'The crews want the searches to stop, without anyone seen to take sides', null],
      ],
    },
    {
      id: 'buyout', title: 'Buyout offers', regions: ['claims', 'spoke', 'gateway'], factions: ['freeClaim', 'combines', 'blackline'], needs: ['camp'],
      text: 'Hadal Extraction is buying up claims around {camp}, and the prospectors who won\'t sell keep having accidents. Everyone knows who the claim-jumpers work for; nobody can prove it.',
      hooks: [
        ['freeClaim', 'A prospector wants their drill site guarded through the next shift', 'blackline'],
        ['combines', 'Hadal wants the belt surveyed for the claims it hasn\'t bought yet', 'freeClaim'],
        ['freeClaim', 'The camp wants a claim-jumper\'s contract found and carried to the Chancery', 'blackline'],
      ],
    },
    {
      id: 'disown', title: 'Disown them', regions: ['combine', 'capital', 'core'], factions: ['union', 'scorched', 'compact'],
      text: 'After a Scorched raid near {station}, the Compact wants the Bay Union to disown the Scorched publicly or lose its strike rights. The Union\'s rank and file are cheering the raid.',
      hooks: [
        ['union', 'The Union leadership wants a message carried to the Scorched, off the record', 'compact'],
        ['compact', 'The Chancery wants evidence the Union helped the raiders', 'union'],
        ['scorched', 'The raiders need their wounded brought somewhere quiet', null],
      ],
    },
    {
      id: 'cores', title: 'The standing order', regions: ['combine', 'reach', 'claims'], factions: ['combines', 'breakers'], needs: ['yard'],
      text: 'Tessaro has a standing order at {yard} for salvaged android cores, at prices no one has seen before. The Breakers don\'t ask what Tessaro does with them. Some of the salvagers have stopped going out.',
      hooks: [
        ['breakers', 'The yard buys android wrecks, no questions, if you can find them', null],
        ['combines', 'Tessaro wants a crate of cores carried to its fabricators without a manifest', null],
        ['breakers', 'A salvager wants to know what happened to the crew that didn\'t come back', null],
      ],
    },
    // ----- The Facet and the Unfaceted -----
    {
      id: 'fraud', title: 'The Lapidary scandal', regions: ['see'], factions: ['facet', 'unfaceted', 'collegium'],
      text: 'Senior Lapidaries at {station} are accused of selling fake Watcher relics. The Clear want it buried, the Unfaceted want it shouted from every dock, and a Collegium scholar has the ledger that proves it.',
      hooks: [
        ['facet', 'The Clear want the ledger recovered from the scholar, quietly', 'collegium'],
        ['unfaceted', 'The Unfaceted pay well for a copy of that ledger', 'facet'],
        ['collegium', 'A relic needs carrying to {neighbour} to be authenticated away from Facet eyes', null],
      ],
    },
    {
      id: 'shrines', title: 'Shrines stripped', regions: ['see', 'veil'], factions: ['facet', 'unfaceted'],
      text: 'Unfaceted raiders have stripped two hermitages in {system} and hit a pilgrim ship on the way in. The relics are already on sale at the Breakers\' yards.',
      hooks: [
        ['facet', 'Escort a pilgrim ship through to the hermitages', 'unfaceted'],
        ['facet', 'Buy back a stolen relic before it leaves the system', 'unfaceted'],
        ['unfaceted', 'Fence a crate of relics through the Breakers', 'facet'],
      ],
    },
    {
      id: 'pews', title: 'The quiet pews', regions: ['see'], factions: ['facet', 'owed'],
      text: 'The young are leaving the Facet of {system}: the Watchers never answer, and a waystation that does is only a gate away. The elders call it a crisis of stillness.',
      hooks: [
        ['facet', 'An elder wants a runaway acolyte found and brought home', null],
        ['owed', 'A former acolyte, rescued once by a waystation, wants letters carried home', null],
        ['facet', 'A Clear chapter wants a pilgrimage escorted to the edge of the nebula', null],
      ],
    },
    {
      id: 'vanished', title: 'Lost in the gas', regions: ['veil'], factions: ['facet', 'pirates', 'thren'], needs: ['nebula'],
      text: 'Occluded pilgrims who go deep into the {nebula} have stopped coming back. The Facet blames pirates; the pilgrims who do return talk about lights that watch.',
      hooks: [
        ['facet', 'The Occluded want the {nebula} searched for a missing pilgrim ship', 'pirates'],
        ['pirates', 'An ambush crew in the gas will trade what it knows for its own safe passage', null],
        ['facet', 'A hermit wants a sensor log from deep inside the nebula, and won\'t say why', null],
      ],
    },
    // ----- The nebulae: harvest, ambush and the lights -----
    {
      id: 'harvest', title: 'A deeper harvest', regions: ['veil', 'claims'], factions: ['combines', 'collegium', 'thren'], needs: ['nebula'],
      text: 'Hadal Extraction is running gas harvesters deeper into the {nebula} each season, with new Collegium sensors aboard. The crews say the readings come back wrong, as if something were moving away from them.',
      hooks: [
        ['combines', 'Hadal wants a harvester escorted to the deep pockets and back', null],
        ['collegium', 'A researcher wants the strange readings collected and brought in', null],
        ['facet', 'The Occluded want the harvest stopped, and will pay for proof of damage', 'combines'],
      ],
    },
    {
      id: 'lights', title: 'Lights in the gas', regions: ['veil', 'reach'], factions: ['pirates', 'thren'], needs: ['nebula'],
      text: 'Spacers in {system} won\'t fly through the {nebula} alone: they say lights watch them in there. The pirate crews leave offerings at its edge, for luck.',
      hooks: [
        ['pirates', 'A crew wants its offering carried deep into the nebula, where they won\'t go', null],
        ['facet', 'A pilgrim wants to be taken to where the lights were last seen', null],
        ['collegium', 'A scholar wants proof either way, and pays for sensor data', null],
      ],
    },
    {
      id: 'ambush', title: 'Ambush crews', regions: ['veil', 'reach', 'claims'], factions: ['pirates', 'combines', 'facet'], needs: ['nebula'],
      text: 'Pirate crews lie in wait in the {nebula}, where sensors are dampened. Hadal harvesters and Facet pilgrims both use the same routes, and neither will travel with the other.',
      hooks: [
        ['combines', 'Hadal posts a bounty on the crew that took its last harvester', 'pirates'],
        ['facet', 'A pilgrim ship needs an escort through the nebula', 'pirates'],
        ['breakers', 'Salvage what the ambushes left behind', null],
      ],
    },
    // ----- Pirates, the frontier and the edge -----
    {
      id: 'grounds', title: 'Shrinking hunting grounds', regions: ['reach', 'spoke', 'claims'], factions: ['pirates', 'breakers'],
      text: 'Two pirate crews are working the same lanes around {system} and the code is wearing thin between them. The Breakers buy from both, and sell each one news of the other.',
      hooks: [
        ['pirates', 'A captain wants the rival crew\'s stash found', 'pirates'],
        ['breakers', 'The yard wants the wrecks of their last fight salvaged', null],
        ['compact', 'A bounty stands on both crews, whichever falls first', 'pirates'],
      ],
    },
    {
      id: 'claims', title: 'Drill-holders', regions: ['claims', 'gateway', 'reach'], factions: ['freeClaim', 'pirates'], needs: ['camp'],
      text: 'Free Claim prospectors at {camp} work a low-security belt with their claims registered at a Chancery office two systems away. Pirates take a cut of every load that leaves.',
      hooks: [
        ['freeClaim', 'The camp wants an ore run escorted through the belt', 'pirates'],
        ['freeClaim', 'A prospector needs their claim papers carried to the Chancery', null],
        ['pirates', 'A crew wants to know when the next ore run leaves', 'freeClaim'],
      ],
    },
    {
      id: 'shelter', title: 'Friends on the frontier', regions: ['claims', 'spoke', 'gateway', 'reach'], factions: ['freeClaim', 'brokenWheel', 'compact'],
      text: 'The camps of {system} are sheltering a Broken Wheel cell: fellow frontier people, they say. The Admiralty has noticed, and its next patrol will not be a friendly one.',
      hooks: [
        ['brokenWheel', 'The cell needs to move before the patrol arrives', 'compact'],
        ['compact', 'The Admiralty wants the cell found, and pays for its location', 'brokenWheel'],
        ['freeClaim', 'The camp wants the patrol to find nothing, and nobody hurt', null],
      ],
    },
    {
      id: 'boneyard', title: 'Who owns the dead', regions: ['reach'], factions: ['breakers', 'pirates', 'freeClaim'],
      text: 'The derelicts scattered through {system} are old enough that nobody remembers whose they were. The Breakers claim them by licence, the prospectors by finding them, the pirates by getting there first.',
      hooks: [
        ['breakers', 'The Guild wants its licence enforced on a wreck field', 'freeClaim'],
        ['freeClaim', 'A prospector found a derelict first and needs it held until the claim is filed', 'breakers'],
        ['pirates', 'A crew will split whatever you salvage before the Breakers arrive', 'breakers'],
      ],
    },
    // ----- The waystations -----
    {
      id: 'sanctuary', title: 'Sanctuary', regions: ['reach', 'claims', 'spoke', 'veil', 'gateway'], factions: ['registry', 'pirates', 'owed'], needs: ['waystation'],
      text: '{waystation} is the only place in {system} where nobody can fire a shot. Pirates honour the code and leave it alone; it is short of spare parts, and it keeps exact accounts of everyone it has saved.',
      hooks: [
        ['registry', 'The waystation needs spare parts brought in, and will pay exactly', null],
        ['pirates', 'A crew wants a wounded member carried to the waystation', null],
        ['owed', 'Someone the waystation once saved wants to settle a debt on its behalf', null],
      ],
    },
    {
      id: 'cold-house', title: 'The cold house', regions: ['capital', 'core', 'combine', 'spoke'], factions: ['registry', 'collegium'], needs: ['waystation'],
      text: 'A Collegium team wants to study the gate blocks of {waystation}. The waystation answers every request with perfect courtesy, then shuts its gate "as a security measure".',
      hooks: [
        ['collegium', 'The team wants a reading of the waystation\'s signal taken from inside its reach', null],
        ['registry', 'The waystation would like an account settled with the team, to the credit', 'collegium'],
        ['collegium', 'An Ethicist wants the team\'s findings kept from its Admiralty sponsors', 'compact'],
      ],
    },
  ];

  // The tutorial system's own situation (the opening missions play it out).
  const TUTORIAL = {
    id: 'balance', title: 'The balance due', factions: ['registry', 'pirates', 'owed'],
    text: '{waystation} has had no visitor for 793 solar cycles. A single coolant regulator is a crisis here, and an unpaid balance means a service that cannot continue.',
    hooks: [
      ['registry', 'Work off the cost of your rescue', null],
      ['registry', 'Recover the coolant regulator from the pirates who took it', 'pirates'],
    ],
  };

  const pickWeighted = (r, list) => {
    let x = r() * list.reduce((n, [, w]) => n + w, 0);
    for (const [v, w] of list) if ((x -= w) < 0) return v;
    return list[list.length - 1][0];
  };
  // A station's kind for the owner tables.
  const kindOf = (st) => (st.waystation ? 'waystation' : st.market.type === 'salvage yard' ? 'yard' : st.market.type === 'mining camp' ? 'camp' : st.market.type);
  // Names that fit the owner: a Facet station is a chapterhouse (a hermitage out in the nebulae),
  // a Combine port a depot, a company capital an exchange and a Facet one a sanctum.
  const RENAME = {
    facet: { minor: 'Chapterhouse', capital: 'Sanctum' },
    combines: { minor: 'Depot', capital: 'Exchange' },
  };

  function settle(system, key, r, ctx = {}) {
    const R = REGIONS[key];
    const branch = key === 'combine' ? BRANCHES[Math.floor(r() * BRANCHES.length)] : 'Hadal Extraction';
    // Station owners, and the culture each is built in.
    const owned = new Map();
    for (const st of system.stations) {
      const kind = kindOf(st);
      const owner = kind === 'waystation' ? 'registry' : kind === 'yard' ? 'breakers'
        : kind === 'capital' && R.holder ? R.holder : R.owners[kind] ? pickWeighted(r, R.owners[kind]) : R.holder || 'freeClaim';
      st.owner = owner;
      if (key !== 'tutorial') {
        st.culture = CULTURE[owner] ?? (CULTURE[R.holder] ?? R.build);
        const rename = owner === 'facet' && kind === 'minor' && key === 'veil' ? 'Hermitage' : RENAME[owner] && RENAME[owner][kind];
        if (rename) st.name = st.name.replace(/ (Station|Port)$/, ` ${rename}`);
      }
      owned.set(owner, (owned.get(owner) || 0) + 1);
    }
    if (key !== 'tutorial') for (const g of system.gates) g.culture = CULTURE[R.holder] ?? R.build;

    // Places a situation can name.
    const first = (type) => system.stations.find((st) => st.market.type === type);
    const main = first('capital') || system.stations.find((st) => st.market.kind === 'system') || system.stations[0];
    const places = {
      system: system.name, station: main && main.name, hub: (first('major') || {}).name, camp: (first('mining camp') || {}).name,
      yard: (first('salvage yard') || {}).name, waystation: (system.stations.find((st) => st.waystation) || {}).name,
      nebula: system.nebulae.length ? system.nebulae[Math.floor(r() * system.nebulae.length)].name : undefined,
      belt: system.belts[0] && system.belts[0].name, branch,
      neighbour: ctx.neighbours && ctx.neighbours.length ? ctx.neighbours[Math.floor(r() * ctx.neighbours.length)] : undefined,
    };
    const fill = (text) => text.replace(/\{(\w+)\}/g, (m, k) => places[k] || m);
    // A situation's parties are its own and everyone its hooks name.
    const make = (s) => {
      const hooks = s.hooks.map(([from, text, against], i) => ({ i, from, text, against })).filter((h) => !/\{neighbour\}/.test(h.text) || places.neighbour)
        .map((h) => ({ ...h, text: fill(h.text) }));
      const factions = [...new Set([...s.factions, ...hooks.flatMap((h) => [h.from, h.against]).filter(Boolean)])];
      return { id: s.id, title: s.title, text: fill(s.text), factions, hooks };
    };

    // One situation, often two, preferring ones not yet used elsewhere in the galaxy.
    const used = ctx.used || new Map();
    const situations = [];
    if (key === 'tutorial') situations.push(make(TUTORIAL));
    else {
      let open = SITUATIONS.filter((s) => s.regions.includes(key) && (s.needs || []).every((k) => places[k]) && (!/\{neighbour\}/.test(s.text) || places.neighbour));
      for (let n = r() < 0.6 ? 2 : 1; n > 0 && open.length; n--) {
        const s = pickWeighted(r, open.map((o) => [o, 1 / (1 + 3 * (used.get(o.id) || 0))]));
        open = open.filter((o) => o !== s);
        used.set(s.id, (used.get(s.id) || 0) + 1);
        situations.push(make(s));
      }
    }

    // Who is here: the holder, the station owners, the region's regulars, the situations' parties.
    const ids = [R.holder, ...owned.keys(), ...R.present, ...R.maybe.filter(([, p]) => r() < p).map(([id]) => id), ...situations.flatMap((s) => s.factions)];
    const factions = [...new Set(ids.filter(Boolean))].map((id) => ({ id, hidden: Factions.get(id).hidden, stations: owned.get(id) || 0 }));
    Object.assign(system, {
      region: { key, label: R.label }, holder: R.holder, branch: key === 'combine' ? branch : null, factions, situations, places,
    });
    return system;
  }

  return { REGIONS, LINKS, SITUATIONS, TUTORIAL, BRANCHES, CULTURE, linkChance, settle };
})();

export { Regions };
