// Collisions in space: the ship bounces off asteroids and stations, and a hard hit knocks its
// shields and hull (flight/collide.js, game/combat.js hurtShip), unless it hit mid-dash (game/dash.js). Gas pockets, planets and moons
// (landed on), gates and other ships don't block it. On a surface, game/landing.js does the same
// against what blocks the ship there.
// Part of the flight view; src/main.js starts it.

import { Collide } from '../flight/collide.js';
import { Feedback } from '../core/feedback.js';
import { hurtShip } from './combat.js';
import { dashHit, dashSafe } from './dash.js';
import { frameList } from './selection.js';
import { SHIP, fight, ship } from './state.js';

// What the ship can hit, and how big it is to hit: a station only by its core (its docking arms
// reach far; flight/entities.js picks it the same way).
const SOLID = { asteroid: 1, station: 0.75 };

// After the flight step, in open flight only (not while landing, jumping or in the introduction).
export function tickCollisions() {
  if (fight.wrecked) return;
  for (const e of frameList) {
    const k = SOLID[e.kind];
    if (!k || e.shard || fight.dying.has(e.key)) continue; // shards (game/mining.js) are too small to stop the ship
    const speed = Collide.resolve(ship, SHIP.radius, { x: e.x, y: e.y, radius: e.radius * k });
    if (!speed) continue;
    dashHit(SHIP.maxSpeed); // a hit ends a dash (game/dash.js)
    const knock = Collide.damage(speed);
    if (knock > 0 && !dashSafe()) hurtShip(knock, { x: (ship.x + e.x) / 2, y: (ship.y + e.y) / 2 });
    else if (speed > Collide.config.safe * 0.5) Feedback.emit('bump');
  }
}
