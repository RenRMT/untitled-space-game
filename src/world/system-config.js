// Galaxy settings. The galaxy is generated from `seed` (a ?seed= URL parameter overrides it).
//
// params:    generator tuning for the system, merged over SolarSystem.params in world/solar-system.js
//            and the galaxy's own system params (any value there can be set).
// galaxy:    the galaxy's settings, over Galaxy.params in world/galaxy.js: the start system's params,
//            the station cultures, the gate's culture and the waystation's name, and the spiral's:
//            its shape, how many systems and how far apart, the zones' params, the habitable band,
//            the gates and the deep-space sites (spiral: false for the start system alone).

const SYSTEM_CONFIG = {
  seed: 1,
  params: {},
  galaxy: {},
};

export { SYSTEM_CONFIG };
