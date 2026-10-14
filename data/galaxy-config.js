// Galaxy settings. The map is generated from `seed` (a ?seed= URL parameter overrides it).
//
// params:    generator tuning, merged over Galaxy.params in galaxy.js (any value there can be set).

const GALAXY_CONFIG = {
  seed: 1,
  params: {
    sectorUnits: 12000, // world units per sector in the flight view
    systems: { spacing: 3 }, // minimum distance between systems, in sectors
    outposts: { spacing: 2.5 }, // minimum distance from an outpost to any other settlement
  },
};
