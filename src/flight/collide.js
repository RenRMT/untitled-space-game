// Collisions: the ship against things in space (asteroids, stations) and against what blocks it on
// a surface (cliffs, tall rocks, storm pockets). A hit pushes the ship out of what it ran into and
// bounces it off, losing some speed along the surface too; how hard it hit (its speed into the
// obstacle) sets the knock it takes (game/combat.js hurtShip, shields first): none below `safe`, so
// docking, approaches and nudging past a rock never hurt, and steeply more above it.
//
//   Collide.config                        restitution, friction, safe (space and surface), scale, power
//   Collide.resolve(body, radius, o) -> speed   a circle (body { x, y, vx, vy }, changed in place)
//                                         against a still circle o { x, y, radius }: the speed it hit
//                                         at along the contact normal, 0 when they don't touch (or it
//                                         was already moving away)
//   Collide.bounce(body, nx, ny) -> speed     a hit along the unit normal (nx, ny), pointing out of
//                                         the obstacle: the velocity into it is reflected and damped
//   Collide.damage(speed, safe?) -> points    the knock from a hit at that speed
// Positions and speeds are world units (per second). ES module (`Collide`); also runs in Node (the tests).

const Collide = (() => {
  const config = {
    restitution: 0.35, // share of the speed into the obstacle that comes back out
    friction: 0.15, // share of the speed along the obstacle lost in a hit
    safe: 150, // hits slower than this do nothing (space: the approach and docking speeds stay below it)
    surfaceSafe: 80, // ... on a surface, where the ship flies slower
    scale: 7, // the knock at `safe` + 100 ...
    power: 1.5, // ... growing by the excess speed to this power
  };

  function bounce(body, nx, ny) {
    const vn = body.vx * nx + body.vy * ny;
    if (vn >= 0) return 0; // moving away already
    const tx = body.vx - vn * nx, ty = body.vy - vn * ny; // the part along the obstacle
    const keep = 1 - config.friction;
    body.vx = tx * keep - vn * config.restitution * nx;
    body.vy = ty * keep - vn * config.restitution * ny;
    return -vn;
  }

  function resolve(body, radius, o) {
    const dx = body.x - o.x, dy = body.y - o.y, d = Math.hypot(dx, dy), min = radius + o.radius;
    if (d >= min) return 0;
    const nx = d > 1e-6 ? dx / d : 1, ny = d > 1e-6 ? dy / d : 0;
    body.x = o.x + nx * min;
    body.y = o.y + ny * min;
    return bounce(body, nx, ny);
  }

  const damage = (speed, safe = config.safe) => (speed <= safe ? 0 : Math.round(config.scale * ((speed - safe) / 100) ** config.power));

  return { config, resolve, bounce, damage };
})();

export { Collide };
