// The race's collisions: a craft against the surface's walls and rocks, so it slides along a wall
// rather than sticking to it. Rocks are circles (Collide.resolve). Walls are found by what's drawn
// (a `blocked` test, ArtSurface.blocked), but their way out comes from the track (towards the nearest
// centreline point), which is smooth where the cliffs' outlines are jagged: the craft is pushed out
// along it to where it's free, and only its speed into the wall is taken (Collide.bounce with the
// race's own restitution and friction), so a graze keeps most of its speed.
//
//   Contact.step(body, r, world, tune, from) -> speed   one step's hits; the hardest one's speed into
//     what it hit (for Collide.damage); body { x, y, vx, vy } changed in place; from { x, y }: where
//     it was before the step, to go back to if it can't be pushed out
//   world: { rocks(x, y) -> [{ x, y, r }], blocked(x, y, r) -> bool, normal(x, y) -> [nx, ny] }
//     (normal: out of the wall, into the track)
//   tune: { restitution, friction, reach } (reach: the furthest a craft is pushed out)
//   Contact.pushOut(body, nx, ny, free, reach, by?) -> bool   moves body along (nx, ny), by at a time, until
//     free(x, y), at most reach; false (and unmoved) when it can't
// ES module (`Contact`); also runs in Node (the tests).

import { Collide } from '../flight/collide.js';

const Contact = (() => {
  function pushOut(body, nx, ny, free, reach, by = 2) {
    for (let s = by; s <= reach; s += by) {
      if (free(body.x + nx * s, body.y + ny * s)) {
        // Back in from there in finer steps, to rest against the wall rather than off it.
        let lo = s - by, hi = s;
        for (let k = 0; k < 4; k++) { const m = (lo + hi) / 2; if (free(body.x + nx * m, body.y + ny * m)) hi = m; else lo = m; }
        body.x += nx * hi; body.y += ny * hi;
        return true;
      }
    }
    return false;
  }

  function step(body, r, world, tune, from) {
    let hit = 0;
    for (const p of world.rocks(body.x, body.y)) hit = Math.max(hit, Collide.resolve(body, r, { x: p.x, y: p.y, radius: p.r }, tune));
    if (world.blocked(body.x, body.y, r)) {
      const [nx, ny] = world.normal(body.x, body.y);
      if (!pushOut(body, nx, ny, (x, y) => !world.blocked(x, y, r), tune.reach)) { body.x = from.x; body.y = from.y; }
      hit = Math.max(hit, Collide.bounce(body, nx, ny, tune));
    }
    return hit;
  }

  return { step, pushOut };
})();

export { Contact };
