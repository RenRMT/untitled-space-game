// Gear rewards to choose: a contract handed in and a Warden destroyed offer three pieces of gear
// (rules/loot.js offer), each a different kind, and the player takes one. They wait in the save
// (cargo.rewards) until chosen: on the comms box while flight is calm, or on the station screen.
//
//   offerReward(from, key, specs)   a reward to choose (from: who gives it; key: unique to it)
//   rewardViews() -> [{ key, from, options: [{ id, item, up }] }]   the rewards waiting, for the station screen
//   chooseReward(key, i) -> item | null   take option i (into the spare gear)
//   tickRewards(dt)                 each frame: the first one waiting, offered on the comms box when calm
// Part of the flight view.

import { Loadout } from '../rules/loadout.js';
import { Loot } from '../rules/loot.js';
import { Comms } from '../ui/comms.js';
import { cargo, lootNotice, saveCargo, takeLoot } from './cargo.js';
import { docked } from './docking.js';
import { calm } from './missions.js';
import { inFight, notify } from './state.js';
import { upgradeLine } from './upgrades.js';

// The reward on the comms box now (its key), and how long a "Later" holds the next offer off.
const asked = { key: null, later: 0 };
export const LATER = 90; // seconds

export function offerReward(from, key, specs) {
  if (!specs.length || cargo.rewards.some((w) => w.key === key)) return;
  for (const spec of specs) Loot.register(spec, Loadout.EQUIPMENT);
  cargo.rewards.push({ key, from, options: specs });
  asked.later = 0;
  notify(`${from}: a reward to choose · one of ${specs.length}`, 3.5, { tone: 'good' });
  saveCargo();
}

// One option's line: its rarity, name and whom it's an upgrade for.
const optionText = (spec) => {
  const item = Loadout.EQUIPMENT[spec.id], R = Loot.rarityOf(spec.rarity), up = upgradeLine(spec.id);
  return `${R.name} ${item.name}${up ? ` · ${up}` : ''}`;
};

export const rewardViews = () => cargo.rewards.map((w) => ({
  key: w.key, from: w.from, options: w.options.map((spec) => ({ id: spec.id, item: { id: spec.id, ...Loadout.EQUIPMENT[spec.id] }, up: upgradeLine(spec.id) })),
}));

export function chooseReward(key, i) {
  const k = cargo.rewards.findIndex((w) => w.key === key), spec = cargo.rewards[k]?.options[i];
  if (!spec) return null;
  cargo.rewards.splice(k, 1);
  if (asked.key === key) { asked.key = null; Comms.hide(); }
  const item = takeLoot(spec);
  lootNotice(item);
  saveCargo();
  return item;
}

export function tickRewards(dt) {
  asked.later = Math.max(0, asked.later - dt);
  // A fight (or docking) takes the comms box back: offered again later.
  if (asked.key && !Comms.isOpen) asked.key = null; // a conversation took the box over
  if (asked.key && (inFight() || docked || !cargo.rewards.some((w) => w.key === asked.key))) { asked.key = null; Comms.hide(); }
  if (asked.key || asked.later > 0 || !cargo.rewards.length || !calm()) return;
  const w = cargo.rewards[0];
  asked.key = w.key;
  Comms.show({
    from: w.from, text: 'Your reward: **choose one**.',
    choices: [...w.options.map((spec) => ({ label: optionText(spec) })), { label: 'Later (or at any station)' }],
    onChoose: (i) => {
      if (i < w.options.length) chooseReward(w.key, i);
      else { asked.key = null; asked.later = LATER; Comms.hide(); }
    },
  });
}
