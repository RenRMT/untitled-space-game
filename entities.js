'use strict';

// What each kind of thing in space is, in one place: draw order and how it is drawn, how close a
// tap must land to pick it, its name label and minimap mark, and how its context card describes
// it. A new kind of object is a new entry here (plus its art and, if it does something, an action
// in game.js). Also the one factory for floating items, which both the scene (scene.js) and the
// flight view (loot, mining drops, lost cargo) make.
//
//   Entities.KINDS[kind] = {
//     order                                  draw order, lowest first
//     selectable, hit                        a tap selects it, within hit × its radius
//     follow                                 an approach keeps station with it at this distance
//     draw(ctx, e, style, x, y, scene)       scene: { t, list } (list: everything nearby)
//     label(e) -> [colour, offset]           its name in space, that far below its centre
//                                            (only things with a name show one)
//     mark(e, system) -> { color, r, ring? } | null    on the minimap
//     card(e, system) -> { title, sub, color, tag?, tone? }   the context card (selectable kinds)
//   }
//   Entities.item({ key, kind, seed, angle, tumble, x?, y? }) -> a floating item of a goods.js type
//   Entities.isHostile(e)                  pirate ships
//   Entities.stationSubtitle(station)
// Works as a classic browser script (global `Entities`) and as a Node module. Drawing and the
// colours need art/render.js and theme.js, so only the factories work in Node.

const Entities = (() => {
  const isNode = typeof require === 'function' && typeof module !== 'undefined';
  const ArtItemsRef = isNode ? require('./art/items.js') : ArtItems;
  const GoodsRef = isNode ? require('./goods.js') : Goods;
  const color = () => Theme.color; // looked up when drawing, so Node never needs theme.js

  // A floating item: its art, its type (goods.js) and how it turns. Position and turning come
  // from the caller's own random stream, so generated scenes stay as they were.
  function item({ key, kind, seed, angle, tumble, x = 0, y = 0 }) {
    const art = ArtItemsRef.create(kind, seed);
    return {
      kind: 'item', art, key, label: GoodsRef.type(kind).name, category: art.category, itemKind: kind,
      angle, tumble, radius: art.radius, x, y,
    };
  }

  // Pirates are the only hostile ships (and, for now, the only ships).
  const isHostile = (e) => e.kind === 'ship' && !!e.pirate;

  const MARKET_LABEL = { capital: 'Capital station', major: 'Station', minor: 'Station' };
  function stationSubtitle(st) {
    if (st.market.kind === 'outpost') return st.market.type[0].toUpperCase() + st.market.type.slice(1);
    const type = MARKET_LABEL[st.market.type] || 'Station';
    return ['capital', 'major'].includes(st.market.type) ? `${type} · shipyard` : type;
  }

  const ROLE_LABEL = { fighter: 'Fighter', freighter: 'Freighter' };
  const asteroidSize = (r) => (r < 16 ? 'Small' : r < 32 ? 'Medium' : 'Large');
  const asset = (ctx, e, style, x, y, o) => Art.drawAsset(ctx, e.art, style, { x, y, ...o });
  const spinning = (e, t) => e.spin + t * e.art.spinRate;
  const named = (e) => [color().neutral, e.radius + 20]; // anything else with a name

  // Nebulae have no art of their own yet: until art/render.js has an Art.drawNebula(ctx, nebula,
  // style, { x, y, t }), each is painted once as soft overlapping clouds in its colour (its blobs,
  // solar-system.js), small, and drawn stretched over the whole cloud; blocky in the pixel style.
  const NEBULA_PX = 192;
  function nebulaSprite(n) {
    if (n._sprite) return n._sprite;
    const cv = document.createElement('canvas');
    cv.width = cv.height = NEBULA_PX;
    const c = cv.getContext('2d'), k = NEBULA_PX / (n.r * 2), C = NEBULA_PX / 2;
    const [cr, cg, cb] = [1, 3, 5].map((i) => parseInt(n.color.slice(i, i + 2), 16));
    const cloud = (x, y, r, a) => {
      const g = c.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `rgba(${cr}, ${cg}, ${cb}, ${a})`);
      g.addColorStop(0.6, `rgba(${cr}, ${cg}, ${cb}, ${a * 0.45})`);
      g.addColorStop(1, `rgba(${cr}, ${cg}, ${cb}, 0)`);
      c.fillStyle = g;
      c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill();
    };
    for (const b of n.blobs) cloud(C + b.dx * k, C + b.dy * k, b.r * k, 0.5);
    // Knots and wisps inside the blobs, so the cloud isn't a smooth disc.
    const r = mulberry32(n.seed);
    for (let i = 0; i < 26; i++) {
      const b = n.blobs[Math.floor(r() * n.blobs.length)], a = r() * Math.PI * 2, d = Math.sqrt(r()) * b.r * 0.8;
      cloud(C + (b.dx + Math.cos(a) * d) * k, C + (b.dy + Math.sin(a) * d) * k, b.r * k * (0.15 + r() * 0.3), 0.25 + r() * 0.3);
    }
    n._sprite = cv;
    return cv;
  }
  function drawNebula(ctx, n, style, x, y, t) {
    if (typeof Art !== 'undefined' && Art.drawNebula) { Art.drawNebula(ctx, n, style, { x, y, t }); return; }
    ctx.save();
    ctx.globalAlpha = 0.42;
    ctx.imageSmoothingEnabled = style !== 'pixel';
    ctx.drawImage(nebulaSprite(n), x - n.r, y - n.r, n.r * 2, n.r * 2);
    ctx.restore();
  }

  const KINDS = {
    nebula: {
      order: -1,
      draw: (ctx, e, style, x, y, { t }) => drawNebula(ctx, e.nebula, style, x, y, t),
      label: () => null, // too big for a name in space: the HUD names the one you're in
      mark: () => null,
    },
    star: {
      order: 0,
      draw: (ctx, e, style, x, y, { t }) => Art.drawStar(ctx, e.body, style, { x, y, t }),
      label: (e) => [color().star, e.body.r * 1.5],
      mark: () => ({ color: color().star, r: 4 }),
    },
    planet: {
      order: 1,
      // Lit from the star (e.lightAngle, scene.js).
      draw: (ctx, e, style, x, y) => Art.drawPlanet(ctx, e.body, style, { x, y, lightAngle: e.lightAngle ?? -2.2 }),

      label: (e) => [color().planet, e.body.r * 1.3],
      mark: () => ({ color: color().planet, r: 3 }),
    },
    asteroid: {
      order: 1.5, selectable: true, hit: 1,
      draw: (ctx, e, style, x, y, { t }) => Art.drawAsteroid(ctx, e.ast, style, { x, y, spin: e.spin0 + t * e.tumble }),
      label: named,
      mark: () => null, // too many to show
      card(e) {
        const pal = Art.ASTEROIDS[e.ast.type] || Art.ASTEROIDS.stony;
        return { title: `${pal.label} asteroid`, sub: asteroidSize(e.radius), color: pal.line };
      },
    },
    station: {
      order: 2, selectable: true, hit: 0.75, // docking arms reach far: only the core counts
      draw: (ctx, e, style, x, y, { t }) => asset(ctx, e, style, x, y, { spin: spinning(e, t), t }),
      label: (e) => [e.color, e.radius * 1.05],
      mark: (e) => ({ color: e.color, r: 2.5 }),
      card: (e) => ({ title: e.name, sub: stationSubtitle(e), color: e.color }),
    },
    wreck: {
      order: 3,
      draw: (ctx, e, style, x, y, { t }) => asset(ctx, e, style, x, y, { angle: e.a, t }),
      label: named,
      mark: () => ({ color: color().dim, r: 1.5 }),
    },
    item: {
      order: 3.5,
      draw: (ctx, e, style, x, y, { t }) => asset(ctx, e, style, x, y, { angle: e.a, t }),
      label: named,
      mark: () => ({ color: color().amber, r: 1.2 }),
    },
    ship: {
      order: 4, selectable: true, hit: 1, follow: 600,
      draw: (ctx, e, style, x, y, { t }) => asset(ctx, e, style, x, y, { angle: e.a, t, thrust: e.thrust || 0 }),
      label: named,
      mark: (e) => ({ color: isHostile(e) ? color().hostile : color().neutral, r: 1.2 }),
      card(e) {
        const hostile = isHostile(e);
        // Pirates show their gear tier, so you can judge a fight before starting it.
        const gear = hostile && e.tier ? ` · ${Loadout.MK[e.tier]} gear` : '';
        return {
          title: e.name || ROLE_LABEL[e.role] || 'Ship', sub: `${hostile ? 'Pirates' : 'Independent'}${gear}`,
          color: hostile ? color().hostile : color().neutral,
          tag: hostile ? 'Hostile' : '', tone: hostile ? 'hostile' : '',
        };
      },
    },
  };

  return { KINDS, ROLE_LABEL, item, isHostile, stationSubtitle };
})();

if (typeof module !== 'undefined') module.exports = Entities;
