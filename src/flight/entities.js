// What each kind of thing in space is, in one place: draw order and how it is drawn, how close a
// tap must land to pick it, its name label and minimap mark, and how its context card describes
// it. A new kind of object is a new entry here (plus its art and, if it does something, an action
// in game/). Also the one factory for floating items, which both the scene (flight/scene.js) and the
// flight view (loot, mining drops, lost cargo) make.
//
//   Entities.KINDS[kind] = {
//     order                                  draw order, lowest first
//     selectable, hit                        a tap selects it, within hit × its radius
//     follow                                 an approach keeps station with it at this distance
//     draw(ctx, e, style, x, y, scene)       scene: { t, list, view } (list: everything nearby,
//                                            view: the visible world rect [x0, y0, x1, y1])
//     label(e) -> [colour, offset]           its name in space, that far below its centre
//                                            (only things with a name show one)
//     mark(e, system) -> { color, r, ring? } | null    on the minimap
//     card(e, system) -> { title, sub, color, tag?, tone? }   the context card (selectable kinds)
//   }
//   Entities.item({ key, kind, seed, angle, tumble, x?, y? }) -> a floating item of a rules/goods.js type
//   Entities.isHostile(e)                  pirate ships (android ships, e.android, are friendly,
//                                          except one marked a pirate too)
//   Entities.stationSubtitle(station)
// ES module (`Entities`); also runs in Node (the tests). Drawing and the
// colours need art/render.js, art/bodies.js and core/theme.js, so only the factories work in Node.

import { ArtBodies } from '../art/bodies.js';
import { ArtItems } from '../art/items.js';
import { Art } from '../art/render.js';
import { Theme } from '../core/theme.js';
import { Goods } from '../rules/goods.js';
import { Loadout } from '../rules/loadout.js';
import { Squad } from '../rules/squad.js';

const Entities = (() => {
  const ArtItemsRef = ArtItems;
  const GoodsRef = Goods;
  const color = () => Theme.color; // looked up when drawing, so Node never needs core/theme.js

  // A floating item: its art, its type (rules/goods.js) and how it turns. Position and turning come
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
  // What a pocket's nebula type says about its gas (art/bodies.js NEBULAE).
  const GAS_LABEL = { emission: 'Ionised hydrogen', reflection: 'Cold gas', ion: 'Charged gas', ember: 'Warm gas', dust: 'Dusty gas' };
  const asteroidSize = (r) => (r < 16 ? 'Small' : r < 32 ? 'Medium' : 'Large');
  const asset = (ctx, e, style, x, y, o) => Art.drawAsset(ctx, e.art, style, { x, y, ...o });
  const spinning = (e, t) => e.spin + t * e.art.spinRate;
  const named = (e) => [color().neutral, e.radius + 20]; // anything else with a name

  const KINDS = {
    nebula: {
      order: -1,
      // Drawn in world coordinates (art/bodies.js anchors its cloud there), culled to the view.
      draw(ctx, e, style, x, y, { view }) {
        ctx.save();
        ctx.translate(x - e.x, y - e.y);
        ArtBodies.drawNebula(ctx, e.cloud, style, { view });
        ctx.restore();
      },
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
      // Lit from the star (e.lightAngle, flight/scene.js).
      draw: (ctx, e, style, x, y) => Art.drawPlanet(ctx, e.body, style, { x, y, lightAngle: e.lightAngle ?? -2.2 }),

      label: (e) => [color().planet, e.body.r * 1.3],
      mark: () => ({ color: color().planet, r: 3 }),
    },
    moon: {
      order: 1,
      draw: (ctx, e, style, x, y) => ArtBodies.drawMoon(ctx, e.body, style, { x, y }),
      label: (e) => [color().planet, e.body.r * 1.3],
      mark: () => ({ color: color().planet, r: 2 }),
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
    // A gas pocket in a nebula (flight/scene.js): collected like an asteroid is mined (game/mining.js).
    gas: {
      order: 1.6, selectable: true, hit: 0.8,
      draw: (ctx, e, style, x, y, { t }) => asset(ctx, e, style, x, y, { spin: spinning(e, t), t }),
      label: () => null,
      mark: (e) => ({ color: e.color, r: 1.6 }),
      card: (e) => ({ title: 'Gas pocket', sub: `${GAS_LABEL[e.pocket.type] || 'Nebula gas'} · ${e.pocket.r < 70 ? 'small' : e.pocket.r < 85 ? 'medium' : 'large'}`, color: e.color }),
    },
    station: {
      order: 2, selectable: true, hit: 0.75, // docking arms reach far: only the core counts
      draw: (ctx, e, style, x, y, { t }) => asset(ctx, e, style, x, y, { spin: spinning(e, t), t }),
      label: (e) => [e.color, e.radius * 1.05],
      mark: (e) => ({ color: e.color, r: 2.5 }),
      card: (e) => ({ title: e.name, sub: stationSubtitle(e), color: e.color }),
    },
    gate: {
      order: 2, selectable: true, hit: 0.75, // the rings are wide: only the core counts
      draw: (ctx, e, style, x, y, { t }) => asset(ctx, e, style, x, y, { angle: e.angle, spin: spinning(e, t), t }),
      label: (e) => [e.color, e.radius * 1.05],
      mark: (e) => ({ color: e.color, r: 4, ring: true }),
      card: (e, galaxy) => ({ title: e.name, sub: e.offline ? 'Offline · leads nowhere yet' : `Jump gate to the ${galaxy.systems[e.gate.to].name} system`, color: e.color }),
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
    // A squad member flying with you (rules/squad.js, game/squad.js), named in its android culture's colour.
    wingman: {
      order: 4, selectable: true, hit: 1, follow: 300,
      draw: (ctx, e, style, x, y, { t }) => asset(ctx, e, style, x, y, { angle: e.a, t, thrust: e.thrust || 0 }),
      label: (e) => [e.color, e.radius + 20],
      mark: (e) => ({ color: e.color, r: 1.8 }),
      card(e) {
        const n = e.member.modules.filter(Boolean).length;
        const role = (ROLE_LABEL[e.member.hull] || 'ship').toLowerCase();
        return { title: e.name, sub: `Squad · android ${role} · ${n} logic module${n === 1 ? '' : 's'}`, color: e.color, tag: 'Squad' };
      },
    },
    ship: {
      order: 4, selectable: true, hit: 1, follow: 600,
      draw: (ctx, e, style, x, y, { t }) => asset(ctx, e, style, x, y, { angle: e.a, t, thrust: e.thrust || 0 }),
      label: (e) => (e.android ? [isHostile(e) ? color().hostile : e.color, e.radius + 20] : named(e)),
      mark: (e) => ({ color: isHostile(e) ? color().hostile : e.android ? e.color : color().neutral, r: 1.2 }),
      card(e) {
        const hostile = isHostile(e);
        // An android ship: one not in the squad (yet), its note saying how it is; or the hostile one
        // of the second mission, armed like a pirate.
        if (e.android && hostile) return { title: e.name, sub: `Android · unregistered · ${Loadout.MK[e.tier]} gear`, color: color().hostile, tag: 'Hostile', tone: 'hostile' };
        if (e.android) return { title: e.name, sub: e.note || 'Android', color: e.color, tag: 'Android' };
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

export { Entities };
