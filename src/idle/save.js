// The idle game's save: one state (IdleRules.empty's) under `idle.save` in the browser's storage,
// kept apart from the game's and the race's. Writes wait a moment so a burst of taps is one write
// (Save.debounced); a save from an older version is brought up to date (Save.migrate, no steps yet).
// ?fresh starts a new save; ?seed= picks the system of a new save (1 by default).
//
//   IdleSave.load(now) -> { state, w, fresh }   w: the save's system (IdleRules.world)
//   IdleSave.writer(get) -> Save.debounced writer of get()
// ES module (`IdleSave`); needs a browser for anything to be kept (Store does nothing in Node).

import { Save } from '../core/save.js';
import { Params, Store } from '../core/store.js';
import { IdleRules } from './rules.js';

const IdleSave = (() => {
  // Version 1 is the first: a save without a version is taken as it is.
  const KEY = 'idle.save', MIGRATIONS = [() => {}];

  function load(now) {
    if (Params.has('fresh')) Store.remove(KEY);
    const data = Store.getJSON(KEY, null);
    const state = data ? IdleRules.read(Save.migrate(data, MIGRATIONS)) : null;
    if (state) return { state, w: IdleRules.world(state.seed), fresh: false };
    const seed = Math.max(1, Math.floor(+Params.get('seed') || 1));
    const w = IdleRules.world(seed);
    return { state: IdleRules.empty(w, now), w, fresh: true };
  }

  const writer = (get) => Save.debounced(() => Store.setJSON(KEY, get()), 1500);

  return { KEY, load, writer };
})();

export { IdleSave };
