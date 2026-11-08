// Redshift's tables (notes/sim.md): the resources, stations and their ships, body traits, hazards,
// cultures, the gate, the horizon's pull and the Archive's permanent upgrades. Every number the
// rules use lives here, so balancing is one file. Rates are per cycle (1 s at 1× speed).
// ES module (`SimConfig`); also runs in Node (the tests).

const SimConfig = (() => {
  // Resources: m minerals, v volatiles, cr credits, sci science. Security is a rating, not a stock.
  const RES = {
    m: { name: 'Minerals', short: 'Min', icon: 'iron', color: '#b9c4d4' },
    v: { name: 'Volatiles', short: 'Vol', icon: 'deuterium', color: '#ffab5c' },
    cr: { name: 'Credits', short: 'Cr', icon: null, color: '#7df9ff' },
    sci: { name: 'Science', short: 'Sci', icon: 'computer-components', color: '#c77dff' },
  };
  const START = { m: 40, v: 30, cr: 120, sci: 0 };
  // The Ark (the player's command ship) makes a little of its own, so nothing ever stalls for good.
  const ARK = { cr: 0.8, m: 0.15, v: 0.1 };

  // Stations. culture: who runs it (and draws it); art: an ArtStationRoles role or a blueprint
  // type; out: per cycle at level 1 (`per`: × the body's pips of that resource); in: what it uses;
  // sec: security rating it adds. Costs in resources; build: cycles to build.
  const STATIONS = {
    mine: {
      name: 'Mining rig', code: 'ORE', culture: 'android', art: 'refinery', size: 'minor',
      cost: { cr: 45 }, build: 6, out: { m: 0.55 }, per: 'm', note: 'Mines the body\'s minerals.',
      ship: { name: 'Ore hauler', hull: 'freighter', cost: { cr: 35, m: 10 }, bonus: 0.5 },
      upgrade: { name: 'Drill heads', gear: 'engine' },
    },
    siphon: {
      name: 'Gas siphon', code: 'VOL', culture: 'android', art: 'station-minor', size: 'minor',
      cost: { cr: 45 }, build: 6, out: { v: 0.55 }, per: 'v', note: 'Draws the body\'s volatiles.',
      ship: { name: 'Tanker', hull: 'freighter', cost: { cr: 35, m: 10 }, bonus: 0.5 },
      upgrade: { name: 'Scoop booms', gear: 'shield' },
    },
    hub: {
      name: 'Trade hub', code: 'TRD', culture: 'block', art: 'factory', size: 'major',
      cost: { cr: 70, m: 25 }, build: 8, in: { m: 0.2, v: 0.2 }, out: { cr: 1.4 }, note: 'Trades minerals and volatiles for credits.',
      ship: { name: 'Trader', hull: 'freighter', cost: { cr: 40, m: 15 }, bonus: 0.5 },
      upgrade: { name: 'Market computers', gear: 'computer' },
    },
    lab: {
      name: 'Research lab', code: 'LAB', culture: 'shard', art: 'research', size: 'major',
      cost: { cr: 70, m: 20, v: 10 }, build: 8, in: { v: 0.25 }, out: { sci: 0.6 }, note: 'Turns volatiles into science.',
      ship: { name: 'Survey probe', hull: 'fighter-light', cost: { cr: 40, v: 15 }, bonus: 0.5 },
      upgrade: { name: 'Sensor arrays', gear: 'scanner' },
    },
    defense: {
      name: 'Defense platform', code: 'SHD', culture: 'wedge', art: 'command', size: 'minor',
      cost: { cr: 60, m: 30 }, build: 7, in: { m: 0.15 }, out: {}, sec: 3, note: 'Keeps order: security for the system, and its group safe from blockades.',
      ship: { name: 'Patrol', hull: 'fighter', heavy: 'fighter-heavy', cost: { cr: 40, m: 15 }, bonus: 0, sec: 2 },
      upgrade: { name: 'Gun batteries', gear: 'laser' },
    },
  };
  const STATION_ORDER = ['mine', 'siphon', 'hub', 'lab', 'defense'];
  // Levels: output × LEVEL_MUL[level - 1]; the cost to reach each level after the first.
  const LEVEL_MUL = [1, 1.6, 2.2];
  const UPGRADE_COST = [null, { cr: 90, m: 35 }, { cr: 190, m: 70, v: 30 }];
  // A ship slot past the first: cost.
  const SLOT_COST = { cr: 80, m: 30 };
  const MAX_SLOTS = 3;
  // Deconstructing gives back this share of what it cost.
  const REFUND = 0.4;

  // What a body type holds: [minerals, volatiles] pips, before a seeded ±1 and the system's richness.
  const YIELD = {
    planet: { lava: [3, 0], desert: [2, 1], terran: [1, 2], ice: [1, 2], gas: [0, 3], blue: [0, 2] },
    moon: { grey: [2, 0], ice: [0, 2], sulfur: [1, 2], rust: [2, 1], dark: [1, 1] },
    belt: [3, 0],
    nebula: [0, 3],
  };

  // Traits: a body's reason to build there that isn't its yield. culture: only where that culture
  // is present. mul: a station type's output there.
  const TRAITS = {
    sacred: { name: 'Shard shrine', code: 'LAB', culture: 'shard', note: 'Sacred to the Shard: a lab here makes double science, and pleases them.', mul: { lab: 2 }, approval: { shard: 12 } },
    strategic: { name: 'High ground', code: 'SHD', culture: 'wedge', note: 'Strategic to the Wedge: a defense platform here covers every group, and pleases them.', mul: { defense: 1.5 }, approval: { wedge: 12 } },
    lane: { name: 'Trade lane', code: 'TRD', culture: 'block', note: 'On the Block\'s trade lane: a hub here earns half again, and pleases them.', mul: { hub: 1.5 }, approval: { block: 12 } },
    ruins: { name: 'Ancient ruins', code: 'ARC', note: 'Ruins older than the hole: any station here finds 1 Insight once built, a lab +0.4 science.', insight: 1, add: { lab: { sci: 0.4 } } },
    derelict: { name: 'Derelict', code: 'RCY', note: 'A wreck in orbit: building here salvages 40 minerals and 30 credits.', salvage: { m: 40, cr: 30 } },
    haunt: { name: 'Drifter haunt', code: 'PRG', culture: 'drifters', note: 'Drifters hide here: left empty, it\'s where a rogue station goes up; built on, unrest grows slower.' },
  };

  // Hazards: the system's one, if any. site: the deep-space art (ArtSites) drawn for it.
  const HAZARDS = {
    ion: { name: 'Ion storms', site: 'magnetar', nebula: 'ion', note: 'Every 80 cycles a storm: ships go dark for 18.', every: 80, lasts: 18 },
    pulsar: { name: 'Pulsar', site: 'pulsar', note: 'Labs +50%. Every 60 cycles a pulse knocks out an undefended station for 15.', every: 60, lasts: 15, mul: { lab: 1.5 } },
    flare: { name: 'Flare star', site: 'variable-star', note: 'The two inner orbits produce 30% less.', inner: 2, innerMul: 0.7 },
    remnant: { name: 'Supernova remnant', site: 'supernova-remnant', note: 'Every body +1 mineral; building costs 25% more.', minerals: 1, costMul: 1.25 },
    magnetar: { name: 'Magnetar', site: 'magnetar', note: 'Defense platforms make half the security.', secMul: 0.5 },
    drifters: { name: 'Drifter space', site: 'white-dwarf', culture: 'drifters', note: 'Unrest grows twice as fast.', unrestMul: 2 },
    alien: { name: 'Alien space', site: 'microquasar', culture: 'alien', note: 'The aliens come twice as often.', alienMul: 2 },
  };

  // Cultures. The three settled ones have approval; `values` is the output they want, `want(n)`
  // how much per cycle for n stations built.
  const CULTURES = {
    android: { name: 'Androids', lineage: 'android', color: '#4fd8ff', values: null, note: 'Your own: they run the Ark, the mines, the siphons and the gate.' },
    wedge: { name: 'Wedge', lineage: 'wedge', color: '#7da8ff', values: 'sec', provides: 'Security', station: 'defense', note: 'Order above all. They want security to match the stations you build.' },
    block: { name: 'Block', lineage: 'block', color: '#ffd66b', values: 'cr', provides: 'Economy', station: 'hub', note: 'Industry at any cost. They want credits flowing.' },
    shard: { name: 'Shard', lineage: 'shard', color: '#c77dff', values: 'sci', provides: 'Science', station: 'lab', note: 'Research as faith. They want science made.' },
    drifters: { name: 'Drifters', lineage: 'kitbash', color: '#d8824a', values: null, note: 'Freelancers and outlaws. Where security falls short, they rise.' },
    alien: { name: 'Aliens', lineage: 'alien', color: '#c86ad8', values: null, note: 'Beyond understanding. What they offer may help or harm.' },
  };
  const SETTLED = ['wedge', 'block', 'shard'];
  // Approval: starts at `start`; per cycle +up while what they value meets their want, -down while
  // not; at or above `high` their stations make ×highMul, at or below `low` ×lowMul, at 0 nothing.
  const APPROVAL = { start: 50, up: 0.12, down: 0.08, high: 70, highMul: 1.25, low: 25, lowMul: 0.5, boon: 75 };
  // What each wants per cycle: base + per station built (all kinds).
  const WANT = { sec: [2, 1], cr: [0.8, 0.25], sci: [0.4, 0.15] };
  // Security demand (Drifters' unrest when short): base + per station.
  const DEMAND = [2, 1];

  // Boons: a culture at APPROVAL.boon or more at the jump gives the next system this.
  const BOONS = {
    wedge: { name: 'Wedge escort', note: '+4 security in the next system.', sec: 4 },
    block: { name: 'Block credit line', note: '+120 credits in the next system.', start: { cr: 120 } },
    shard: { name: 'Shard star charts', note: '+2 Insight now.', insight: 2 },
  };

  // The gate: three stages at the gate site, each paid then built over cycles. × GATE_DEPTH per system
  // reached (endless) on the costs.
  const GATE = [
    { id: 'frame', name: 'Frame', cost: { m: 110, cr: 40 }, build: 12 },
    { id: 'ring', name: 'Ring', cost: { m: 90, v: 70 }, build: 14 },
    { id: 'core', name: 'Core', cost: { v: 100, cr: 90 }, build: 16 },
  ];
  const GATE_DEPTH = 0.08;
  // Overcharge once the gate is done: per cycle base + k × horizon², to 1.
  const OVERCHARGE = { base: 0.002, k: 0.006 };

  // The horizon: a system's life (cycles from 0 to 100%) by its distance, and how much shorter each
  // system reached makes it (endless), never below `min`. pull0: where the meter starts.
  const HORIZON = {
    life: { near: 560, mid: 700, far: 860 }, pull0: { near: 18, mid: 8, far: 0 },
    perDepth: 18, min: 380, dilateFrom: 50, dilatePow: 1.6, overchargeLife: 0.3,
  };
  // How much production and building slow at a horizon of p (0..100): 1 to dilateFrom, 0 at 100.
  const dilation = (p) => (p <= HORIZON.dilateFrom ? 1 : Math.max(0, 1 - ((p - HORIZON.dilateFrom) / (100 - HORIZON.dilateFrom)) ** HORIZON.dilatePow));

  // Drifters: unrest per cycle per point of security short of demand; at `at` they act.
  const DRIFTERS = { perShort: 0.06, base: 0.01, at: 10, blockade: 45, bribe: { cr: 60 }, skim: 0.15, evict: { m: 30 }, evictSec: 4, outpost: { cr: 0.8 }, outpostApproval: -15, haunted: 0.5 };
  // Aliens: a visit every `every` cycles (± jitter) once they're in the system.
  const ALIENS = { every: 150, jitter: 50, first: 70 };
  // Requests: one every `every` cycles (± jitter) from a culture present, at most `open` open.
  const REQUESTS = { every: 70, jitter: 30, first: 30, open: 2, deadline: 160, fail: -10 };

  // The Archive: permanent upgrades bought with Insight. lv: the most levels; cost: per level.
  const ARCHIVE = {
    kit: { name: 'Seed vault', code: 'HLD', note: '+30 minerals, +20 volatiles and +60 credits at every arrival.', lv: 3, cost: [3, 6, 10], start: { m: 30, v: 20, cr: 60 } },
    gate: { name: 'Gate schematics', code: 'BLU', note: 'The gate costs 12% less.', lv: 3, cost: [4, 8, 12], gateMul: 0.88 },
    drills: { name: 'Deep drills', code: 'MIN', note: 'Mines and siphons +15%.', lv: 3, cost: [3, 6, 10], extract: 0.15 },
    damper: { name: 'Tidal dampers', code: 'RAD', note: 'Every system lasts 6% longer.', lv: 3, cost: [5, 9, 14], life: 0.06 },
    hangar: { name: 'Hangar racks', code: 'BAY', note: 'Ships cost 25% less.', lv: 2, cost: [4, 8], shipMul: 0.75 },
    accord: { name: 'Accords', code: 'REP', note: 'Every culture starts at +10 approval.', lv: 2, cost: [4, 8], approval: 10 },
    scanner: { name: 'Long-range scanner', code: 'SCN', note: 'A fourth system to choose from at every jump.', lv: 1, cost: [8], choices: 1 },
    coils: { name: 'Overcharge coils', code: 'PRG', note: 'The gate overcharges 30% faster.', lv: 2, cost: [5, 10], overcharge: 0.3 },
    prefab: { name: 'Prefab rigs', code: 'IND', note: 'Stations build in half the time.', lv: 1, cost: [6], buildMul: 0.5 },
  };
  // Insight at a jump: one per `sci` science made in the system, + overcharge × `charge`.
  const INSIGHT = { sci: 40, charge: 4, lostKeep: 0.5 };

  // The clock: ms per cycle at 1×, and the speeds.
  const CYCLE_MS = 1000;
  const SPEEDS = [0, 1, 2, 4];

  return {
    RES, START, ARK, STATIONS, STATION_ORDER, LEVEL_MUL, UPGRADE_COST, SLOT_COST, MAX_SLOTS, REFUND, YIELD, TRAITS, HAZARDS,
    CULTURES, SETTLED, APPROVAL, WANT, DEMAND, BOONS, GATE, GATE_DEPTH, OVERCHARGE, HORIZON, dilation, DRIFTERS, ALIENS, REQUESTS,
    ARCHIVE, INSIGHT, CYCLE_MS, SPEEDS,
  };
})();

export { SimConfig };
