// What each kind of thing in space is, in one place: draw order and how it is drawn, how close a
// tap must land to pick it, its name label and minimap mark, and how its context menu describes
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
//     card(e, system) -> { title, sub, color, tag?, tone? }   the context menu (selectable kinds)
//   }
//   Entities.item({ key, kind, seed, angle, tumble, x?, y? }) -> a floating item of a rules/goods.js type
//   Entities.lootDrop({ key, spec, x, y, angle, tumble }) -> floating loot (rules/loot.js spec)
//   Entities.asteroid(a) -> an asteroid from a generated one ({ key, type, r, seed, spin0, tumble, x, y })
//   Entities.fighter({ key, art, x, y, orbit, speed, a0, tier }) -> a hostile fighter circling (x, y)
//   Entities.isHostile(e)                  pirate ships (android ships, e.android, are friendly,
//                                          except one marked a pirate too)
//   Entities.stationSubtitle(station)    what it is and who owns it
// ES module (`Entities`); also runs in Node (the tests). Drawing and the
// colours need art/render.js, art/bodies.js and core/theme.js, so only the factories work in Node.

import { ArtBodies } from '../art/bodies.js';
import { ArtEquipment } from '../art/equipment.js';
import { ArtItems } from '../art/items.js';
import { Art } from '../art/render.js';
import { ArtSites } from '../art/sites.js';
import { hashInt, mulberry32 } from '../core/rng.js';
import { Theme } from '../core/theme.js';
import { Goods } from '../rules/goods.js';
import { Loot } from '../rules/loot.js';
import { Structures } from '../rules/structures.js';
import { DeepSpace } from '../world/deep-space.js';
import { Factions } from '../world/factions.js';

const Entities = (() => {
  const ArtItemsRef = ArtItems;
  const GoodsRef = Goods;
  const color = () => Theme.color; // looked up when drawing, so Node never needs core/theme.js

  // A floating item: its art, its type (rules/goods.js) and how it turns. Position and turning come
  // from the caller's own random stream, so generated scenes stay as they were. The art is the
  // type's own, as its icon in the menus shows it (art/icons.js draws it from the same blueprint).
  function item({ key, kind, angle, tumble, x = 0, y = 0 }) {
    const art = ArtItemsRef.create(kind, 1);
    return {
      kind: 'item', art, key, label: GoodsRef.type(kind).name, category: art.category, itemKind: kind,
      angle, tumble, radius: art.radius, x, y,
    };
  }

  // A piece of loot floating where it dropped (rules/loot.js): its gear's art, its name in its
  // rarity's colour, a glow round it (the rarer, the brighter). spec: the item's saved spec.
  function lootDrop({ key, spec, x = 0, y = 0, angle = 0, tumble = 0.2 }) {
    const gear = Loot.make(spec);
    const art = ArtEquipment.create(spec.base, 1); // as its icon in the menus
    return {
      kind: 'loot', art, key, spec, name: gear.name, label: gear.name, rarity: spec.rarity, color: Loot.rarityOf(spec.rarity).color,
      angle, tumble, radius: art.radius * 1.4, x, y,
    };
  }

  const asteroid = (a) => ({
    kind: 'asteroid', ast: { type: a.type, r: a.r, seed: a.seed }, key: a.key, spin0: a.spin0, tumble: a.tumble, radius: a.r, x: a.x, y: a.y,
  });

  // A pirate fighter (or one marked a pirate), circling (x, y) at `orbit`, `speed` world units a
  // second, starting at angle a0. tier: its gear (rules/loadout.js). hitRadius: how big it is in a
  // fight, the size of a plain fighter whatever class it's drawn as (the class is looks only).
  const fighter = ({ key, art, x, y, orbit, speed, a0, tier }) => ({
    kind: 'ship', role: 'fighter', pirate: true, key, art, radius: art.radius, hitRadius: art.radius / (CLASS_SIZE[art.type] || 1), x, y, tier,
    motion: { type: 'orbit', cx: x, cy: y, r: orbit, w: speed / orbit, a0 },
  });

  // Which class of fighter a pirate is drawn as (art/blueprints.js), by its seed: packs mix them,
  // more of the heavy ones in more dangerous space (tier: their gear, Mk I–IV). Looks only.
  const CLASSES = ['fighter-light', 'fighter', 'fighter-heavy'];
  const CLASS_MIX = { 1: [0.6, 0.4, 0], 2: [0.35, 0.5, 0.15], 3: [0.2, 0.5, 0.3], 4: [0.1, 0.4, 0.5] };
  // About how big each class is drawn next to a plain fighter (their hull lengths: 25, 34, 46).
  const CLASS_SIZE = { 'fighter-light': 25 / 34, fighter: 1, 'fighter-heavy': 46 / 34 };
  function fighterClass(tier, seed) {
    const mix = CLASS_MIX[Math.min(4, Math.max(1, tier || 1))];
    let u = mulberry32(hashInt(seed >>> 0, 0xc1a55, 7))();
    for (let i = 0; i < CLASSES.length; i++) if ((u -= mix[i]) < 0) return CLASSES[i];
    return 'fighter';
  }

  // Pirates are the only hostile ships (and, for now, the only ships).
  const isHostile = (e) => e.kind === 'ship' && !!e.pirate;

  const MARKET_LABEL = { capital: 'Capital station', major: 'Station', minor: 'Station' };
  // What it is, and whose (world/factions.js): "Capital station · shipyard · Wedge".
  function stationSubtitle(st) {
    const owner = Factions.get((st.station || st).owner);
    const whose = owner ? ` · ${owner.name}` : '';
    if (st.market.kind === 'outpost') return st.market.type[0].toUpperCase() + st.market.type.slice(1) + whose;
    const type = MARKET_LABEL[st.market.type] || 'Station';
    return (st.market.type === 'capital' ? `${type} · shipyard` : type) + whose;
  }

  const ROLE_LABEL = { fighter: 'Fighter', freighter: 'Freighter' };
  // What a pocket's nebula type says about its gas (art/bodies.js NEBULAE).
  const GAS_LABEL = { emission: 'Ionised hydrogen', reflection: 'Cold gas', ion: 'Charged gas', ember: 'Warm gas', dust: 'Dusty gas' };
  const asteroidSize = (r) => (r < 16 ? 'Small' : r < 32 ? 'Medium' : 'Large');
  const PLANET_LABEL = { terran: 'Terran planet', desert: 'Desert planet', ice: 'Ice world', lava: 'Lava world', gas: 'Gas giant', blue: 'Ice giant' };
  const asset = (ctx, e, style, x, y, o) => Art.drawAsset(ctx, e.art, style, { x, y, ...o });
  // Ships (fighters, freighters, androids, the squad and the player's) are drawn larger than their
  // size (collisions, combat ranges), to read better among the stations and asteroids; tapping one
  // finds it out to where it's drawn.
  const SHIP_SCALE = 1.375;
  function shipAsset(ctx, e, style, x, y, o) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(SHIP_SCALE, SHIP_SCALE);
    asset(ctx, e, style, 0, 0, o);
    ctx.restore();
  }
  const spinning = (e, t) => e.spin + t * e.art.spinRate;
  // A turret, drawn larger than its blueprint (rules/structures.js TURRET_SCALE), its head aimed
  // (e.aim: the game turns it in a fight), and a structure's hull bar while it's damaged.
  function turretAsset(ctx, e, style, x, y, o) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(Structures.TURRET_SCALE, Structures.TURRET_SCALE);
    asset(ctx, e, style, 0, 0, { ...o, angle: e.aim || 0 });
    ctx.restore();
  }
  // A destroyed structure (game/structures.js razed): its art dim and still, until it's rebuilt.
  function razedAsset(ctx, e, style, x, y, o) {
    ctx.save();
    ctx.globalAlpha *= 0.35;
    asset(ctx, e, style, x, y, o);
    ctx.restore();
  }
  // Whose a structure is, for its card.
  const ownerName = (e) => (Factions.get(e.owner) ? Factions.get(e.owner).name : 'Independent');
  // A deep-space site's drawing (art/sites.js), at its flight art radius, doing what it does now:
  // beams and jets turn, a Cepheid swells, a nova bursts on the real clock, as on the galaxy map.
  function siteArt(ctx, e, style, x, y) {
    ctx.save();
    ctx.translate(x, y);
    ArtSites.draw(ctx, e.siteData, style, { part: e.part, reach: e.reach, phase: DeepSpace.phase(e.site, Date.now() / 1000) });
    ctx.restore();
  }
  const named = (e) => [color().neutral, e.radius + 20]; // anything else with a name

  const KINDS = {
    nebula: {
      order: -1,
      // Drawn in world coordinates (art/bodies.js anchors its cloud there), culled to the view.
      draw(ctx, e, style, x, y, { view }) {
        ctx.save();
        ctx.translate(x - e.x, y - e.y);
        ArtBodies.drawNebula(ctx, e.cloud, style, { view, layer: true });
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
    // Planets and moons: selected by their globe (their radius reaches past it, to their rings and
    // glow); the flight view adds what can be done there (game/landing.js).
    planet: {
      order: 1, selectable: true, hit: 0.5,
      // Lit from the star (e.lightAngle, flight/scene.js). e.ppu, while set, holds its sprite at one
      // resolution (a landing zooms right in: game/landing.js).
      draw: (ctx, e, style, x, y) => Art.drawPlanet(ctx, e.body, style, { x, y, lightAngle: e.lightAngle ?? -2.2, ppu: e.ppu }),

      label: (e) => [color().planet, e.body.r * 1.3],
      mark: () => ({ color: color().planet, r: 3 }),
      card: (e) => ({ title: e.name, sub: PLANET_LABEL[e.body.type] || 'Planet', color: color().planet }),
    },
    moon: {
      order: 1, selectable: true, hit: 0.8,
      draw: (ctx, e, style, x, y) => ArtBodies.drawMoon(ctx, e.body, style, { x, y, ppu: e.ppu }),
      label: (e) => [color().planet, e.body.r * 1.3],
      mark: () => ({ color: color().planet, r: 2 }),
      card: (e) => ({ title: e.name, sub: `Moon · ${(ArtBodies.MOONS[e.body.type] || { label: 'rock' }).label.toLowerCase()}`, color: color().planet }),
    },
    asteroid: {
      order: 1.5, selectable: true, hit: 1,
      draw: (ctx, e, style, x, y, { t }) => Art.drawAsteroid(ctx, e.ast, style, { x, y, spin: e.spin0 + t * e.tumble }),
      label: named,
      mark: () => null, // too many to show
      card(e) {
        const pal = Art.ASTEROIDS[e.ast.type] || Art.ASTEROIDS.stony;
        return { title: `${pal.label} ${e.shard ? 'shard' : 'asteroid'}`, sub: asteroidSize(e.radius), color: pal.line };
      },
    },
    // A gas pocket in a nebula (flight/scene.js): collected like an asteroid is mined (game/mining.js).
    gas: {
      order: 1.6, selectable: true, hit: 0.8,
      draw: (ctx, e, style, x, y, { t }) => ArtBodies.drawGas(ctx, e.gas, style, { x, y, t }),
      label: () => null,
      mark: (e) => ({ color: e.color, r: 1.6 }),
      card: (e) => ({ title: 'Gas pocket', sub: `${GAS_LABEL[e.pocket.type] || 'Nebula gas'} · ${e.pocket.r < 70 ? 'small' : e.pocket.r < 85 ? 'medium' : 'large'}`, color: e.color }),
    },
    // What lies between the systems (flight/deep-sites.js): a site drawn by art/sites.js, or one
    // of the stars, planets and moons a site is made of. Nothing to do there yet but look.
    deep: {
      order: 0.5, selectable: true, hit: 1,
      draw(ctx, e, style, x, y, { t }) {
        if (e.look === 'star') Art.drawStar(ctx, e.body, style, { x, y, t });
        else if (e.look === 'planet') Art.drawPlanet(ctx, e.body, style, { x, y, lightAngle: -2.2 });
        else if (e.look === 'moon') ArtBodies.drawMoon(ctx, e.body, style, { x, y });
        else siteArt(ctx, e, style, x, y);
      },
      label: (e) => (e.labelled ? [e.color, e.radius + 24] : null),
      mark: (e) => ({ color: e.color, r: e.look === 'moon' ? 2 : 3 }),
      card: (e) => ({ title: e.name, sub: e.sub, color: e.color }),
    },
    // A site's part spanning it, flown through: a shell, a bubble, a dark globule (flight/deep-sites.js).
    'deep-area': {
      order: -0.5,
      draw: (ctx, e, style, x, y) => siteArt(ctx, e, style, x, y),
      label: () => null,
      mark: () => null,
    },
    station: {
      order: 2, selectable: true, hit: 0.75, // docking arms reach far: only the core counts
      draw: (ctx, e, style, x, y, { t }) => (e.razed ? razedAsset(ctx, e, style, x, y, { spin: e.spin, t: 0 }) : asset(ctx, e, style, x, y, { spin: spinning(e, t), t })),
      label: (e) => [e.razed ? color().dim : e.color, e.radius * 1.05],
      mark: (e) => ({ color: e.razed ? color().dim : e.hostile ? color().hostile : e.color, r: 2.5 }),
      card: (e) => (e.razed ? { title: e.name, sub: `Destroyed · ${e.razed}`, color: color().dim, tag: 'Wrecked' }
        : { title: e.name, sub: stationSubtitle(e), color: e.hostile ? color().hostile : e.color, ...(e.hostile ? { tag: 'Hostile', tone: 'hostile' } : {}) }),
    },
    // A station's turret (flight/scene.js, rules/structures.js), going round it; hostile when its
    // owner counts you Hostile (game/structures.js sets e.hostile).
    turret: {
      order: 2.5, selectable: true, hit: 1.4,
      draw: (ctx, e, style, x, y, { t }) => turretAsset(ctx, e, style, x, y, { t }),
      label: () => null,
      mark: (e) => ({ color: e.hostile ? color().hostile : e.color, r: 1.4 }),
      card: (e) => ({
        title: e.name, sub: `${e.host ? `Defends ${e.host.name}` : 'Defence turret'} · ${ownerName(e)}`, color: e.hostile ? color().hostile : e.color,
        ...(e.hostile ? { tag: 'Hostile', tone: 'hostile' } : { tag: 'Turret' }),
      }),
    },
    // A mission's hostile outpost (game/jobs.js): a pirate station, its turrets round it; it docks no one.
    outpost: {
      order: 2, selectable: true, hit: 0.75,
      draw: (ctx, e, style, x, y, { t }) => asset(ctx, e, style, x, y, { spin: spinning(e, t), t }),
      label: (e) => [color().hostile, e.radius * 1.05],
      mark: () => ({ color: color().hostile, r: 2.5 }),
      card: (e) => ({ title: e.name, sub: `${e.crew || 'Pirate'} outpost`, color: color().hostile, tag: 'Hostile', tone: 'hostile' }),
    },
    gate: {
      order: 2, selectable: true, hit: 0.75, // the rings are wide: only the core counts
      draw: (ctx, e, style, x, y, { t }) => asset(ctx, e, style, x, y, { angle: e.angle, spin: spinning(e, t), t }),
      label: (e) => [e.color, e.radius * 1.05],
      mark: (e) => ({ color: e.color, r: 4, ring: true }),
      card: (e, galaxy) => ({ title: e.name, sub: e.offline ? 'Offline · leads nowhere yet' : `${e.gate.wormhole ? 'Wormhole' : 'Jump gate'} to ${galaxy.systems[e.gate.to]?.name || 'elsewhere'}`, color: e.color }),
    },
    wreck: {
      order: 3,
      draw: (ctx, e, style, x, y, { t }) => asset(ctx, e, style, x, y, { angle: e.a, t }),
      label: named,
      mark: () => ({ color: color().dim, r: 1.5 }),
    },
    // Drops: selectable (what it is), picked up by dragging onto the ship (game/input.js).
    item: {
      order: 3.5, selectable: true,
      card: (e) => ({ title: e.label, sub: 'Drag it onto the ship to pick it up', color: color().amber }),
      draw: (ctx, e, style, x, y, { t }) => asset(ctx, e, style, x, y, { angle: e.a, t }),
      label: named,
      mark: () => ({ color: color().amber, r: 1.2 }),
    },
    // Loot floating where it dropped (rules/loot.js), named in its rarity's colour, with a glow.
    loot: {
      order: 3.6, selectable: true,
      card: (e) => ({ title: e.name, sub: 'Drag it onto the ship to pick it up', color: e.color }),
      draw(ctx, e, style, x, y, { t }) {
        const pulse = 0.5 + 0.5 * Math.sin(t * 3 + (e.x % 7));
        ctx.save();
        ctx.globalAlpha *= 0.18 + 0.12 * pulse + 0.06 * Loot.RANK[e.rarity];
        ctx.fillStyle = e.color;
        ctx.beginPath();
        ctx.arc(x, y, e.radius * (1.3 + 0.2 * pulse), 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        asset(ctx, e, style, x, y, { angle: e.a, t });
      },
      label: (e) => [e.color, e.radius + 18],
      mark: (e) => ({ color: e.color, r: 1.6 }),
    },
    // A squad member flying with you (rules/squad.js, game/squad.js), named in its android culture's colour.
    wingman: {
      order: 4, selectable: true, hit: SHIP_SCALE, follow: 300,
      draw: (ctx, e, style, x, y, { t }) => shipAsset(ctx, e, style, x, y, { angle: e.a, t, thrust: e.thrust || 0 }),
      label: (e) => [e.color, e.radius * SHIP_SCALE + 20],
      mark: (e) => ({ color: e.color, r: 1.8 }),
      card(e) {
        const n = e.member.program.length;
        const role = (ROLE_LABEL[e.member.hull] || 'ship').toLowerCase();
        return { title: e.name, sub: `Squad · android ${role} · ${n} logic line${n === 1 ? '' : 's'}`, color: e.color, tag: 'Squad' };
      },
    },
    ship: {
      order: 4, selectable: true, hit: SHIP_SCALE, follow: 600,
      draw: (ctx, e, style, x, y, { t }) => shipAsset(ctx, e, style, x, y, { angle: e.a, t, thrust: e.thrust || 0 }),
      label: (e) => [e.android ? (isHostile(e) ? color().hostile : e.color) : named(e)[0], e.radius * SHIP_SCALE + 20],
      mark: (e) => ({ color: isHostile(e) ? color().hostile : e.android ? e.color : color().neutral, r: 1.2 }),
      card(e) {
        const hostile = isHostile(e);
        // An android ship: one not in the squad (yet), its note saying how it is; or the hostile one
        // of the second mission, armed like a pirate.
        if (e.android && hostile) return { title: e.name, sub: 'Android · unregistered', color: color().hostile, tag: 'Hostile', tone: 'hostile' };
        if (e.android) return { title: e.name, sub: e.note || 'Android', color: e.color, tag: 'Android' };
        // Pirates (or a mission's crew of another kind: e.crew) say who they are (the flight view
        // adds how a fight would go: game/combat.js threat); a friendly ship says what it's doing (e.note).
        return {
          title: e.name || ROLE_LABEL[e.role] || 'Ship', sub: hostile ? e.crew || 'Pirates' : e.note || 'Independent',
          color: hostile ? color().hostile : color().neutral,
          tag: hostile ? 'Hostile' : '', tone: hostile ? 'hostile' : '',
        };
      },
    },
  };

  return { KINDS, ROLE_LABEL, SHIP_SCALE, item, lootDrop, asteroid, fighter, fighterClass, isHostile, stationSubtitle };
})();

export { Entities };
