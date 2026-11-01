// The idle game's save: one state (IdleRules.empty's) under `idle.save` in the browser's storage,
// kept apart from the game's and the race's. Writes wait a moment so a burst of taps is one write
// (Save.debounced); a save from an older version is brought up to date (Save.migrate). Version 1's
// saves (the first slice: every station already there, waiting to be restored) can't be carried
// over into a system built from nothing, so they start again; version 2's gain an empty lab, and
// version 3's contracts and auto-sell (none yet); version 4's keep the system they were made in
// (layout 1, the same bodies for every seed), where new saves get one rolled from the seed.
// ?fresh starts a new save; ?seed= picks the system of a new save (a random one by default).
//
//   IdleSave.load(now) -> { state, w, fresh }   w: the save's system (IdleRules.world)
//   IdleSave.writer(get) -> Save.debounced writer of get()
// ES module (`IdleSave`); needs a browser for anything to be kept (Store does nothing in Node).

import { Save } from '../core/save.js';
import { Params, Store } from '../core/store.js';
import { IdleRules } from './rules.js';

const IdleSave = (() => {
  // Version 1 is the first: a save without a version is taken as it is. 1 -> 2: started again;
  // 2 -> 3: the lab (IdleRules.read gives an empty one); 3 -> 4: contracts and auto-sell (read gives none);
  // 4 -> 5: the system's layout, 1 for saves made before there was a choice.
  const KEY = 'idle.save', MIGRATIONS = [() => {}, (d) => { d.industry = null; }, (d) => { d.lab = d.lab || null; }, () => {}, (d) => { d.layout = 1; }];

  function load(now) {
    if (Params.has('fresh')) Store.remove(KEY);
    const data = Store.getJSON(KEY, null);
    const state = data ? IdleRules.read(Save.migrate(data, MIGRATIONS)) : null;
    if (state) return { state, w: IdleRules.world(state.seed, state.layout), fresh: false };
    const seed = Math.max(1, Math.floor(+Params.get('seed') || 1 + Math.random() * 1e6));
    const w = IdleRules.world(seed, IdleRules.LAYOUT);
    return { state: IdleRules.empty(w, now), w, fresh: true };
  }

  const writer = (get) => Save.debounced(() => Store.setJSON(KEY, get()), 1500);

  return { KEY, load, writer };
})();

export { IdleSave };
