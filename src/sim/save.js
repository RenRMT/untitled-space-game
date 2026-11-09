// Redshift's saves: the run under way (`sim.run`) and what outlives runs (`sim.meta`: Insight, the
// Archive's upgrades, the story's furthest chapter, the best endless run, the settings), kept apart
// from the other games'. Writes wait a moment so a burst of taps is one write (Save.debounced).
// ?fresh forgets the run (not the meta).
//
//   SimSave.loadRun() -> state | null, SimSave.writeRun(state | null)
//   SimSave.loadMeta() -> meta, SimSave.writeMeta(meta)
//   SimSave.writer(get) -> a debounced writer of the run
// ES module (`SimSave`); needs a browser for anything to be kept (Store does nothing in Node).

import { Save } from '../core/save.js';
import { Params, Store } from '../core/store.js';
import { SimRules } from './rules.js';

const SimSave = (() => {
  const RUN = 'sim.run', META = 'sim.meta';
  const emptyMeta = () => ({ insight: 0, archive: {}, story: 0, best: 0, runs: 0, style: 'lowpoly', seen: {} });

  function loadRun() {
    if (Params.has('fresh')) Store.remove(RUN);
    const d = Store.getJSON(RUN, null);
    return d && d.version === SimRules.VERSION ? d : null;
  }
  const writeRun = (state) => (state ? Store.setJSON(RUN, state) : Store.remove(RUN));
  const loadMeta = () => ({ ...emptyMeta(), ...Store.getJSON(META, {}) });
  const writeMeta = (meta) => Store.setJSON(META, meta);
  const writer = (get) => Save.debounced(() => writeRun(get()), 1200);

  return { loadRun, writeRun, loadMeta, writeMeta, writer, emptyMeta };
})();

export { SimSave };
