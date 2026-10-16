// Galaxy settings. The galaxy is generated from `seed` (a ?seed= URL parameter overrides it).
//
// params:    generator tuning for every system, merged over SolarSystem.params in world/solar-system.js
//            (any value there can be set).
// galaxy:    the galaxy's layout, over Galaxy.params in world/galaxy.js: the gap between systems, the
//            lattice spacing, how many systems of each region (`plan`; the regions themselves are
//            in world/regions.js) and the tutorial's and gateway's own params.

const SYSTEM_CONFIG = {
  seed: 1,
  params: {},
  galaxy: {},
};

export { SYSTEM_CONFIG };
