// Fitting an upgrade where it's found: gear that comes aboard (game/cargo.js lootNotice) and is an
// upgrade someone can fit now (game/upgrades.js) is offered on the comms box once flight is calm,
// to fit on your ship or the squad member it helps most, or to keep spare. Fitting needs no dock;
// it's just not done in a fight. Nothing is kept: an offer passed by is in the spare gear, fitted on
// the Ship tab as ever.
//
//   queueFit(id)        gear just aboard: offered once things are calm, if it's still an upgrade
//   tickQuickFit(dt)    each frame: the next offer on the comms box when calm
//   fitNow(id, member)  fit it on that ship (member id, or null: yours) in its best slot -> bool
//   askingFit() -> id | null   the gear on the comms box now; passFit(): keep it spare
// Part of the flight view.

import { Loadout } from '../rules/loadout.js';
import { Comms } from '../ui/comms.js';
import { cargo } from './cargo.js';
import { docked } from './docking.js';
import { calm } from './missions.js';
import { outfitting } from './outfitting.js';
import { inFight, notify } from './state.js';
import { upgradesFor } from './upgrades.js';

const queue = [];
let asking = null; // the id on the comms box now
export const askingFit = () => asking;
// The offer on the comms box passed by: kept spare.
export function passFit() {
  if (!asking) return;
  asking = null;
  Comms.hide();
}

export function queueFit(id) {
  if (!queue.includes(id)) queue.push(id);
}

const pct = (g) => `+${Math.max(1, Math.round(g * 100))}%`;

export function fitNow(id, member = null) {
  const u = upgradesFor(id).find((x) => !x.need && x.member === member);
  if (!u || !cargo.gear[id] || inFight()) return false;
  const on = member ? outfitting.member(member) : outfitting;
  if (!on || !on.fit(u.slot, id)) return false;
  notify(`Fitted: ${Loadout.EQUIPMENT[id].name}${member ? ` on ${u.who}` : ''} · ▲ ${pct(u.gain)}`, 3, { tone: 'good' });
  return true;
}

export function tickQuickFit() {
  if (asking && (!Comms.isOpen || inFight() || docked)) { if (Comms.isOpen) Comms.hide(); asking = null; }
  if (asking || !queue.length || !calm()) return;
  const id = queue.shift();
  const now = cargo.gear[id] ? upgradesFor(id).filter((u) => !u.need) : [];
  if (!now.length) return; // fitted or sold meanwhile, or no upgrade any more
  // Yours first if it's one for you, then the squad member it helps most.
  const options = [now.find((u) => !u.member), now.find((u) => u.member)].filter(Boolean);
  asking = id;
  Comms.show({
    from: 'Ship computer', text: `**${Loadout.EQUIPMENT[id].name}** is an upgrade. Fit it now?`,
    choices: [...options.map((u) => ({ label: u.member ? `Fit on ${u.who} · ▲ ${pct(u.gain)}` : `Fit on your ship · ▲ ${pct(u.gain)}` })), { label: 'Keep it spare' }],
    onChoose: (i) => {
      passFit();
      if (options[i]) fitNow(id, options[i].member);
    },
  });
}
