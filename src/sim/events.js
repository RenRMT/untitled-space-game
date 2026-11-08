// Redshift's events (notes/sim.md): what happens to a system besides what the player builds. Filled
// in by the later phases: the cultures' requests, the Drifters' revolts, the aliens' offers, the
// hazards' pulses.
//
//   SimEvents.tick(state, meta, events) -> events   after the rules' tick: what else happened
//   SimEvents.answers(state, meta, id) -> [{ id, label, ok, pick }]   what can be said to an offer
//   SimEvents.answer(state, meta, id, answer) -> result | null
// ES module (`SimEvents`); also runs in Node (the tests).

const SimEvents = (() => {
  const tick = () => [];
  const answers = () => [];
  const answer = () => null;
  return { tick, answers, answer };
})();

export { SimEvents };
