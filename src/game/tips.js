// Prompts: one line each, shown once per player at the moment it applies (a first fight, a first
// drop, a first dock), in the event log. Teaching happens in play, one thing at a time
// (notes/review.md); nothing here stops the game or asks to be dismissed.
//
//   tip(id)     show it, unless it has been shown before
// Part of the flight view.

import { Store } from '../core/store.js';
import { notify } from './state.js';

export const TIPS = {
  fight: 'Tap a ship to target it · skills at the bottom',
  heavy: 'HEAVY: break its shields to cancel the shot',
  drop: 'Drag a drop onto your ship',
  squad: 'Wingmen fight by their programs · Ship tab',
};
let seen = null;
export function tip(id) {
  if (!seen) seen = new Set(Store.getJSON('tips', []));
  if (seen.has(id) || !TIPS[id]) return;
  seen.add(id);
  Store.setJSON('tips', [...seen]);
  notify(TIPS[id], 6, { tone: 'warn' });
}
