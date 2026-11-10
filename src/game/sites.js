// The deep-space sites' finds in play (rules/survey.js): each site holds one. With the ship inside
// a site's survey range, out of a fight, the scanner works on it for a few seconds; then the find
// is made, once: credits, experience, and for some kinds gear to choose (game/rewards.js). The
// sites surveyed are kept in the save (cargo.world.surveyed: [site id]); the map says which are.
//
//   tickSites(dt)              each frame of flight
//   surveyed(site) -> bool
//   scanning() -> { site, k: 0..1 } | null   the scan under way
//   held(site) -> bool         a guarded site whose guardian still flies: no scan until it's destroyed
// Part of the flight view.

import { Feedback } from '../core/feedback.js';
import { Loot } from '../rules/loot.js';
import { Survey } from '../rules/survey.js';
import { DeepSpace } from '../world/deep-space.js';
import { cargo, lootClasses, pilotLevel, saveCargo } from './cargo.js';
import { docked } from './docking.js';
import { landing } from './landing.js';
import { checkMilestones, gainXP } from './progress.js';
import { offerReward } from './rewards.js';
import { fight, inFight, notify, ship, showBanner } from './state.js';
import { warp } from './warp.js';
import { guardKey, siteGuard } from './traffic.js';
import { world } from './world.js';

const scan = { site: null, t: 0, look: 0, held: false };
// A guarded site (rules/survey.js) is held until its guardian is destroyed (game/traffic.js siteGuard,
// which brings it in beside the ship the first time it's asked for).
export const held = (site) => Survey.guarded(site) && !cargo.removed.has(guardKey(site)) && !!siteGuard(site, ship);
export const surveyed = (site) => cargo.world.surveyed.includes(site.id);
export const scanning = () => (scan.site && !scan.held ? { site: scan.site, k: Math.min(1, scan.t / Survey.TIME) } : null);

// The unsurveyed site the ship is in range of (the nearest, if several overlap), or null.
function inRange() {
  const now = Date.now() / 1000; // movers run on the real clock (flight/scene.js)
  let best = null, bd = Infinity;
  for (const s of world.galaxy.sites || []) {
    if (!Survey.has(s) || surveyed(s)) continue;
    const p = s.path ? DeepSpace.positionAt(s, now) : s, d = Math.hypot(p.x - ship.x, p.y - ship.y);
    if (d <= Survey.range(s) && d < bd) { best = s; bd = d; }
  }
  return best;
}

function find(site) {
  const R = Survey.reward(site, pilotLevel());
  cargo.world.surveyed.push(site.id);
  cargo.credits += R.credits;
  showBanner('SURVEYED', `${site.name} · +${R.credits.toLocaleString('en-US')} credits${R.gear ? ' · gear to choose' : ''}`, 'good', 4);
  notify(`${R.what}.`, 5, { tone: 'good' });
  Feedback.emit('won');
  gainXP(R.xp);
  checkMilestones(); // the surveys' (rules/log.js)
  if (R.gear) offerReward(site.name, `site:${site.id}`, Loot.offer('mission', `site:${site.id}`, { ...R.gear, seed: world.galaxy.seed, cls: lootClasses(), pity: cargo.lootPity }));
  saveCargo();
}

export function tickSites(dt) {
  if (!world.galaxy || docked || landing.on || warp.on || inFight() || fight.wrecked) { scan.site = null; scan.t = 0; return; }
  // Which site is in range is looked up a few times a second; the scan itself runs every frame.
  scan.look -= dt;
  if (scan.look <= 0) {
    scan.look = 0.5;
    const s = inRange();
    if (s !== scan.site) {
      scan.site = s;
      scan.t = 0;
      scan.held = !!s && held(s);
      if (s) notify(scan.held ? `${s.name} is held · destroy ${siteGuard(s, ship).name} to scan it` : `Scanning ${s.name}… hold here`, Survey.TIME, { tone: scan.held ? 'hostile' : 'info' });
    } else if (s && scan.held && !held(s)) {
      scan.held = false; // its guardian beaten: the scan starts
      scan.t = 0;
      notify(`Scanning ${s.name}… hold here`, Survey.TIME);
    }
  }
  if (!scan.site || scan.held) return;
  scan.t += dt;
  if (scan.t >= Survey.TIME) { const s = scan.site; scan.site = null; scan.t = 0; find(s); }
}
