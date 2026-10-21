// Jobs: the missions the galaxy's stations post, grown from the seed with it (the opening missions
// are story/missions.js's). There are no job texts at the moment (story/job-texts.js), so the board
// is empty; this module is the machinery that will place new ones. There are three tiers, by who
// offers a job and what is at stake:
//   station  one station's own concerns, offered only there: every station has one or two,
//   system   a system's local situation (one job per hook), offered at every station in that system,
//   faction  a faction's concern across known space (world/factions.js), offered at every station
//            it owns.
// Each is titled "[station, system or faction name]: [job]". What a job says and asks is
// story/job-texts.js's; this module places it in the galaxy, turns its steps into objectives for
// the mission log (story/missions.js) and works out what it pays. The flight view runs them
// (game/jobs.js).
//
// A job is a list of steps, done in order (each opens once the one before it is done):
//   go     reach points in space, or dock at stations, in any order (a station: docking counts)
//   fight  a wave of hostile ships at a point (rush: they come for the ship as soon as it's near)
//   take   collect items floating at points (they take no room in the hold)
//   bring  have goods in the hold, handed over with the job
//   mine   break up asteroids of a type, anywhere
//   gas    collect the job's own gas pockets in a nebula
// A step may have lines said on the comms as it opens (say: a new objective or changed plans),
// and be a twist (secret: not listed until then). Then the job is handed in: where it was
// accepted, or at the station its last step docks at (a delivery). A job may bring an escort, a
// ship that flies with you until then.
//
//   Jobs.board(galaxy) -> { list: [job], byId: { [id]: job } }
//   job: { id, tier, scope (station key | system index | faction id), title, name, from (who gives
//     it), faction (theirs), system (where it's offered, or null for a faction's), systems (every
//     system it goes to), briefing, report, debrief: [lines], steps, objectives, byId, escort?,
//     handIn (station key, or null: where it was accepted), situation?, against?, provided?,
//     reward: { credits, components: { [kind]: n }, loyalty: [{ keys, n, text }], regard: [text] }, rewardText }
//     regard: how the job moves the giver's and the opponent's regard for the player (rules/reputation.js)
//   step: { type, label, say?, twist?, points?, wave?, items?, kind?, n?, rock?, at?, pockets?,
//     nebula? } (positions in world units; keys for things in space are relative: `${step}.${k}`)
//   Jobs.TIERS, Jobs.CREWS, Jobs.REACH, Jobs.value(job), Jobs.offeredAt(job, station)
// ES module (`Jobs`); also runs in Node (the tests).

import { TAU, clamp, dist } from '../core/math.js';
import { hashInt, mulberry32, nextSeed, seedToInt } from '../core/rng.js';
import { Economy } from '../rules/economy.js';
import { Goods } from '../rules/goods.js';
import { Reputation } from '../rules/reputation.js';
import { Factions } from '../world/factions.js';
import { Security } from '../world/security.js';
import { JobTexts } from './job-texts.js';

const Jobs = (() => {
  // base and k: what a job pays before and on top of its steps (value()).
  const TIERS = {
    station: { label: 'Station', base: 250, k: 1, cap: 2 },
    system: { label: 'System', base: 600, k: 1.2, cap: 3 },
    faction: { label: 'Faction', base: 1500, k: 1.35, cap: 4 },
  };
  // Who a wave of hostile ships is: its name in notices and on their cards, and what it's built
  // in ('pirates': kitbashed, or a settled culture by id, world/solar-system.js CULTURES).
  const CREWS = {
    pirates: { label: 'Pirates', culture: 'pirates' },
  };
  const REACH = 2500; // a point in space counts as reached this close (map travel to it stops 2200 short)
  const ROCK_LABEL = { metal: 'metallic', stony: 'stony', carbon: 'carbonaceous', ice: 'icy' };
  // The rock that's commonest where (solar-system.js ASTEROIDS).
  const ROCK_OF = { main: 'stony', outer: 'ice', field: 'carbon' };

  // ---------- Places in a system ----------

  // Helpers for one system's jobs (story/job-texts.js uses them). r: the job's own stream; taken:
  // points other jobs already fight at, kept apart so their fights never merge.
  function places(galaxy, sys, r, taken) {
    const star = sys.star;
    const near = (list, p) => [...list].sort((a, b) => dist(a, p) - dist(b, p));
    // What a point is near, as a text names it: "near Livo III", "in the Livo Belt".
    function nameAt(p) {
      const neb = galaxy.nebulaAt(p.x, p.y);
      if (neb) return `in the ${neb.name}`;
      const at = galaxy.regionAt(p.x, p.y).near;
      if (at && at.name) return at.kind === 'main' || at.kind === 'outer' || at.spread ? `in the ${at.name}` : `near ${at.name}`;
      const pl = near(sys.planets, p)[0];
      return pl ? `out past ${pl.name}` : `in the ${sys.name} system`;
    }
    // Open space for a fight or something floating: inside the system, clear of planets, the
    // star, stations, gates, pirate packs (so none joins in), contacts and other jobs' fights;
    // outside the nebulae unless `nebula` (a nebula: inside it). Each pass asks less.
    // A point nothing fights at (keep false) only has to be somewhere a ship can fly to.
    function open(p, pass, nebula, keep) {
      const neb = galaxy.nebulaAt(p.x, p.y);
      const base = dist(p, sys.origin) <= sys.radius - 2500 && dist(p, star) >= star.reach + 1500
        && (nebula ? neb === nebula : !neb)
        && sys.planets.every((pl) => dist(pl, p) >= pl.extent + 1500);
      if (!keep) return base && sys.stations.every((st) => dist(st, p) >= 1500) && sys.gates.every((g) => dist(g, p) >= 1500);
      return base
        && sys.stations.every((st) => dist(st, p) >= (st.waystation ? 7500 : pass < 2 ? 3500 : 2500)) // no fights in a waystation's signal
        && sys.gates.every((g) => dist(g, p) >= 3000)
        && sys.packs.every((k) => dist(k, p) >= (pass < 1 ? 3400 : 2700))
        && (pass >= 2 || sys.contacts.every((c) => dist(c, p) >= c.r + 1500))
        && (pass >= 2 || taken.every((t) => dist(t, p) >= 3500));
    }
    function space(anchor, lo, hi, { nebula = null, keep = true } = {}) {
      for (let pass = 0; pass < 3; pass++) {
        for (let tries = 0; tries < 300; tries++) {
          let p;
          if (nebula) {
            const b = nebula.blobs[Math.floor(r() * nebula.blobs.length)], a = r() * TAU, d = Math.sqrt(r()) * b.r * 0.75;
            p = { x: nebula.x + b.dx + Math.cos(a) * d, y: nebula.y + b.dy + Math.sin(a) * d };
          } else {
            const a = r() * TAU, d = lo + r() * (hi - lo) * (1 + pass * 0.5);
            p = { x: anchor.x + Math.cos(a) * d, y: anchor.y + Math.sin(a) * d };
          }
          if (!open(p, pass, nebula, keep)) continue;
          const at = { x: Math.round(p.x), y: Math.round(p.y), system: sys.index };
          at.name = nameAt(at);
          if (keep) taken.push(at);
          return at;
        }
      }
      return null;
    }
    // Rocks to mine: the field or stretch of belt nearest the anchor (a mining camp's own clump if
    // it's one), with the rock commonest there.
    function rocks(anchor) {
      const camp = anchor.market && anchor.market.type === 'mining camp';
      const spots = [
        ...sys.fields.map((f) => ({ x: f.x, y: f.y, name: `the ${f.name}`, rock: ROCK_OF.field })),
        ...sys.belts.map((b) => {
          const a = Math.atan2(anchor.y - b.cy, anchor.x - b.cx);
          return { x: b.cx + Math.cos(a) * b.r, y: b.cy + Math.sin(a) * b.r, name: `the ${b.name}`, rock: ROCK_OF[b.kind] };
        }),
      ];
      const best = near(spots, anchor)[0];
      if (camp && best) return { x: anchor.x, y: anchor.y, system: sys.index, name: `around ${anchor.name}`, rock: best.rock };
      return best ? { ...best, x: Math.round(best.x), y: Math.round(best.y), system: sys.index } : null;
    }
    // The derelicts nearest the anchor (hidden wrecks: world/solar-system.js contacts).
    const derelicts = (anchor, n) => near(sys.contacts.filter((c) => c.type === 'derelict'), anchor).slice(0, n)
      .map((c) => ({ x: c.x, y: c.y, system: sys.index, name: `the derelict ${nameAt(c)}`, contact: c.id }));
    const nebula = (anchor, name) => (name && sys.nebulae.find((n) => n.name === name)) || near(sys.nebulae, anchor)[0] || null;
    const stations = (pred = () => true) => sys.stations.filter(pred);
    const named = (name) => (name && sys.stations.find((st) => st.name === name)) || null;
    // A good this station is short of: one it consumes, raw or refined and not rare (anything a
    // market stocks or a ship can mine), else deuterium.
    function wanted(st) {
      const goods = Economy.market(galaxy.seed, st).goods.filter((g) => g.consumed && g.rarity <= 2 && ['raw', 'refined'].includes(Goods.type(g.kind).stage));
      return goods.length ? goods[Math.floor(r() * goods.length)].kind : 'deuterium';
    }
    const n = (lo, hi) => lo + Math.floor(r() * (hi - lo + 1));
    const pick = (list) => list[Math.floor(r() * list.length)];
    return { galaxy, sys, r, n, pick, nameAt, space, rocks, derelicts, nebula, stations, named, wanted, hops: (to) => hops(galaxy, sys.index, to), jumps: (a, b) => hops(galaxy, a, b) };
  }

  // Gate jumps between two systems (Infinity if they aren't linked at all).
  function hops(galaxy, a, b) {
    if (a === b) return 0;
    const seen = new Map([[a, 0]]), queue = [a];
    while (queue.length) {
      const i = queue.shift();
      for (const [x, y] of galaxy.links) {
        const j = x === i ? y : y === i ? x : -1;
        if (j < 0 || seen.has(j)) continue;
        seen.set(j, seen.get(i) + 1);
        if (j === b) return seen.get(j);
        queue.push(j);
      }
    }
    return Infinity;
  }

  // ---------- Steps into objectives ----------

  // A wave of n ships circling (x, y), at a tier: from the security there (as the system's own
  // pirates would be), raised by `up`, within the job's tier's cap.
  function wave(galaxy, r, at, n, { tier, up = 0, crew = 'pirates', rush = false } = {}, cap = 4) {
    const t = tier || clamp(Security.pick(r, Security.pirates(galaxy.securityAt(at.x, at.y)).tier) + up, 1, cap);
    const ships = Array.from({ length: n }, (_, i) => ({ orbit: 300 + i * 70 + Math.round(r() * 120), speed: (i % 2 ? -1 : 1) * (160 + Math.round(r() * 30)), a0: r() * TAU, seed: nextSeed(r) }));
    return { x: at.x, y: at.y, system: at.system, name: at.name, tier: t, crew, rush, ships };
  }

  // A step as job-texts.js writes it, made concrete: points kept, waves and items rolled, gas
  // pockets placed. Returns null if it can't be (no place for it).
  function makeStep(galaxy, r, s, tier, taken) {
    const out = { type: s.type, label: s.label, say: s.say || null, twist: !!s.twist };
    if (s.type === 'go') {
      if (!s.points.length || s.points.some((p) => !p)) return null;
      out.points = s.points.map((p) => (p.key ? { station: p.key, x: p.x, y: p.y, system: p.system, name: p.name } : { x: p.x, y: p.y, system: p.system, name: p.name }));
    } else if (s.type === 'fight') {
      if (!s.at) return null;
      out.wave = wave(galaxy, r, s.at, s.n, s, TIERS[tier].cap + (s.up || 0));
    } else if (s.type === 'take') {
      const at = Array.isArray(s.at) ? s.at : [s.at];
      if (!at.length || at.some((p) => !p)) return null;
      out.items = at.map((p, k) => {
        const a = r() * TAU, d = s.spread ?? 160;
        return { x: Math.round(p.x + Math.cos(a) * d), y: Math.round(p.y + Math.sin(a) * d), system: p.system, name: p.name, kind: s.kind, label: s.item, seed: nextSeed(r), k };
      });
    } else if (s.type === 'bring') {
      if (!Goods.type(s.kind)) return null;
      Object.assign(out, { kind: s.kind, n: s.n });
    } else if (s.type === 'mine') {
      if (!s.at) return null;
      Object.assign(out, { n: s.n, rock: s.at.rock, at: { x: s.at.x, y: s.at.y, system: s.at.system, name: s.at.name } });
    } else if (s.type === 'gas') {
      const neb = s.nebula;
      if (!neb) return null;
      const pockets = [];
      for (let tries = 0; pockets.length < s.n && tries < 400; tries++) {
        const b = neb.blobs[Math.floor(r() * neb.blobs.length)], a = r() * TAU, d = Math.sqrt(r()) * b.r * 0.7;
        const p = { x: Math.round(neb.x + b.dx + Math.cos(a) * d), y: Math.round(neb.y + b.dy + Math.sin(a) * d) };
        const sys = galaxy.systems[neb.system];
        if (galaxy.nebulaAt(p.x, p.y) !== neb || sys.packs.some((k) => dist(k, p) < 1800) || sys.pockets.some((q) => dist(q, p) < 300) || pockets.some((q) => dist(q, p) < 700)) continue;
        pockets.push({ ...p, r: 60 + Math.round(r() * 30), seed: nextSeed(r), type: neb.type });
      }
      if (pockets.length < s.n) return null;
      Object.assign(out, { n: s.n, nebula: galaxy.nebulae.indexOf(neb), name: neb.name, pockets: pockets.map((q) => ({ ...q, system: neb.system })) });
    } else return null;
    return out;
  }

  // The log's objectives for the steps: per step one listed (s0, s1, ...), with a hidden one per
  // point when a go step has several (s0p0, ...) and a hidden one before it for its lines (m1).
  function objectives(steps) {
    const list = [];
    steps.forEach((s, i) => {
      const prev = i ? [`s${i - 1}`] : [];
      if (s.say && i) list.push({ id: `m${i}`, hidden: true, after: prev });
      const after = s.say && i ? [`m${i}`] : prev;
      const need = s.type === 'go' ? s.points.length : s.type === 'fight' ? s.wave.ships.length : s.type === 'take' ? s.items.length : s.n;
      list.push({ id: `s${i}`, label: s.label, ...(need > 1 ? { need } : {}), after, ...(s.twist ? { secret: true } : {}) });
      if (s.type === 'go' && s.points.length > 1) s.points.forEach((p, k) => list.push({ id: `s${i}p${k}`, hidden: true, after }));
    });
    return list;
  }

  // ---------- What a job pays ----------

  // Credits by what its steps take: the flying (within a system by distance, between systems by
  // the jumps), each hostile ship by its tier, items, goods handed over at a little over their
  // worth, rocks and gas; then the tier's share on top. Rounded to 50.
  const VALUE = { perUnit: 0.025, perJump: 700, ship: 170, item: 100, goods: 1.3, rock: 70, pocket: 150, escort: 400 };
  function value(galaxy, job, start, end) {
    let v = TIERS[job.tier].base, at = start;
    const fly = (p) => {
      if (!p) return;
      v += p.system === at.system ? dist(at, p) * VALUE.perUnit : hops(galaxy, at.system, p.system) * VALUE.perJump + dist(galaxy.systems[p.system].origin, p) * VALUE.perUnit;
      at = p;
    };
    for (const s of job.steps) {
      if (s.type === 'go') for (const p of s.points) fly(p);
      if (s.type === 'fight') { fly(s.wave); v += s.wave.ships.length * VALUE.ship * s.wave.tier ** 1.5; }
      if (s.type === 'take') { for (const p of s.items) fly(p); v += s.items.length * VALUE.item; }
      if (s.type === 'bring') v += Goods.type(s.kind).price * s.n * VALUE.goods;
      if (s.type === 'mine') { fly(s.at); v += s.n * VALUE.rock; }
      if (s.type === 'gas') { fly(s.pockets[0]); v += s.n * VALUE.pocket; }
    }
    fly(end);
    if (job.escort) v += VALUE.escort;
    return Math.max(50, Math.round((v * TIERS[job.tier].k * (job.hiddenGiver ? 1.15 : 1)) / 50) * 50);
  }

  // Loyalty: a station's job raises that station's; a system's raises every station in it the
  // giver's faction owns, and lowers those of the faction it works against there; a faction's
  // raises every station the faction owns.
  function loyalty(galaxy, tier, scope, from, against, sysIndex) {
    const F = (id) => ({ name: Factions.get(id).name.replace(/^The /, '') }); // "3 Wedge stations"
    if (tier === 'station') {
      const st = galaxy.stations.find((x) => x.key === scope);
      return [{ keys: [scope], n: 1, text: `Loyalty +1 at ${st.name}` }];
    }
    const out = [];
    if (tier === 'system') {
      const sys = galaxy.systems[sysIndex];
      const own = (id) => sys.stations.filter((st) => st.owner === id).map((st) => st.key);
      const word = (id, keys, sign) => `Loyalty ${sign}1 at ${keys.length === 1 ? sys.stations.find((st) => st.key === keys[0]).name : `${keys.length} ${F(id).name} stations in ${sys.name}`}`;
      if (own(from).length) out.push({ keys: own(from), n: 1, text: word(from, own(from), '+') });
      if (against && own(against).length) out.push({ keys: own(against), n: -1, text: word(against, own(against), '−') });
      return out;
    }
    const keys = galaxy.stations.filter((st) => st.owner === scope).map((st) => st.key);
    if (keys.length) out.push({ keys, n: 1, text: `Loyalty +1 at every ${F(scope).name} station (${keys.length})` });
    return out;
  }

  // ---------- The board ----------

  // A job as job-texts.js wrote it (or null), made into one the log and the flight view can use.
  function make(galaxy, r, taken, o) {
    const w = o.write;
    if (!w || !w.steps || !w.steps.length) return null;
    const steps = [];
    for (const s of w.steps) {
      const step = makeStep(galaxy, r, s, o.tier, taken);
      if (!step) return null;
      steps.push(step);
    }
    const last = steps[steps.length - 1];
    const deliver = last.type === 'go' && last.points.length === 1 && last.points[0].station && w.deliver;
    const handIn = deliver ? last.points[0].station : null;
    const job = {
      id: o.id, tier: o.tier, scope: o.scope, name: w.name, title: `${o.scopeName}: ${w.name}`, from: w.from || o.from,
      faction: o.faction, system: o.system, situation: o.situation || null, against: o.against || null,
      hiddenGiver: !!Factions.get(o.faction)?.hidden,
      briefing: w.briefing, report: w.report || REPORT[o.tier], debrief: w.debrief,
      provided: w.provided || null, escort: w.escort ? { ...w.escort, seed: nextSeed(r) } : null, steps, handIn,
    };
    job.objectives = objectives(steps);
    job.byId = Object.fromEntries(job.objectives.map((x) => [x.id, x]));
    job.systems = [...new Set([o.system, ...steps.flatMap((s) => [...(s.points || []), ...(s.items || []), s.wave, s.at].filter(Boolean).map((p) => p.system)),
      ...steps.filter((s) => s.nebula !== undefined).map((s) => galaxy.nebulae[s.nebula].system)].filter((x) => x !== null && x !== undefined))];
    const start = o.anchor, end = handIn ? null : o.anchor;
    const credits = value(galaxy, job, start, end);
    const components = {};
    for (const [cat, n] of w.components || []) components[Goods.component(cat)] = (components[Goods.component(cat)] || 0) + n;
    const loyal = loyalty(galaxy, o.tier, o.scope, o.faction, o.against, o.system);
    const d = Reputation.JOB[o.tier], name = (id) => Factions.get(id).name.replace(/^The /, '');
    const regard = [`Regard +${d} with ${name(o.faction)}`, ...(o.against ? [`Regard −${d} with ${name(o.against)}`] : [])];
    job.reward = { credits, components, loyalty: loyal, regard };
    job.rewardText = [`${credits.toLocaleString('en-US')} credits`, ...Object.entries(components).map(([k, n]) => `${n} × ${Goods.type(k).name}`), ...loyal.map((l) => l.text), ...regard].join(' · ');
    return job;
  }
  // What the giver says once the job is done, before it's handed in, unless the job says otherwise.
  const REPORT = {
    station: ['That\'s all of it. Confirm the hand-in, and the station will settle up.'],
    system: ['Word travels fast in this system. Confirm the hand-in and we\'ll settle up.'],
    faction: ['Our people will want the details. Confirm the hand-in, and the payment clears.'],
  };

  function board(galaxy) {
    const base = seedToInt(galaxy.seed);
    const list = [];
    const add = (job) => { if (job) list.push(job); };
    const taken = new Map(); // system index -> points fought at
    const takenIn = (i) => { if (!taken.has(i)) taken.set(i, []); return taken.get(i); };
    // Stations: one or two of their type's jobs each.
    for (const sys of galaxy.systems) {
      const used = new Set();
      for (const st of sys.stations) {
        const r = mulberry32(hashInt(base, seedToInt(st.key), 0x70b5));
        const pool = JobTexts.forStation(st);
        // In the order the stream deals them, those not yet used in this system first.
        const order = pool.map((t) => ({ t, k: r() + (used.has(t.id) ? 1 : 0) })).sort((a, b) => a.k - b.k).map((x) => x.t);
        const want = r() < 0.5 ? 2 : 1;
        let made = 0;
        for (const t of order) {
          if (made >= want) break;
          const c = places(galaxy, sys, r, takenIn(sys.index));
          const job = make(galaxy, r, takenIn(sys.index), {
            id: `st/${st.key}/${t.id}`, tier: 'station', scope: st.key, scopeName: st.name, from: st.name, faction: st.owner,
            system: sys.index, anchor: { x: st.x, y: st.y, system: sys.index }, write: t.write({ ...c, st, owner: Factions.get(st.owner) }),
          });
          if (!job) continue;
          add(job);
          used.add(t.id);
          made++;
        }
      }
    }
    // Systems: a job for each hook of each situation there.
    for (const sys of galaxy.systems) {
      const main = sys.stations.find((st) => st.market.type === 'capital') || sys.stations.find((st) => st.market.kind === 'system') || sys.stations[0];
      if (!main) continue;
      for (const sit of sys.situations) {
        for (const h of sit.hooks) {
          const t = JobTexts.forHook(sit.id, h.i);
          if (!t) continue;
          const r = mulberry32(hashInt(base, sys.index * 97 + h.i, seedToInt(sit.id)));
          const c = places(galaxy, sys, r, takenIn(sys.index));
          add(make(galaxy, r, takenIn(sys.index), {
            id: `sy/${sys.index}/${sit.id}/${h.i}`, tier: 'system', scope: sys.index, scopeName: sys.name, from: Factions.get(h.from).name,
            faction: h.from, against: h.against, situation: sit.id, system: sys.index, anchor: { x: main.x, y: main.y, system: sys.index },
            write: t({ ...c, main, sit, hook: h, owner: Factions.get(h.from), vars: sys.places || {} }),
          }));
        }
      }
    }
    // Factions: their concerns, for those with stations to offer them at.
    for (const f of Factions.LIST) {
      const own = galaxy.stations.filter((st) => st.owner === f.id);
      if (!own.length) continue;
      JobTexts.forFaction(f.id).forEach((t, i) => {
        const r = mulberry32(hashInt(base, i, seedToInt(f.id) ^ 0xfac7));
        // Each picks the system it happens in and where it starts from (null: not in this galaxy).
        const plan = t.where({ galaxy, own, r, hops: (a, b) => hops(galaxy, a, b) });
        if (!plan) return;
        const sys = galaxy.systems[plan.system];
        const c = places(galaxy, sys, r, takenIn(sys.index));
        add(make(galaxy, r, takenIn(sys.index), {
          id: `fa/${f.id}/${t.id}`, tier: 'faction', scope: f.id, scopeName: f.name, from: f.name, faction: f.id,
          system: null, anchor: { x: plan.from.x, y: plan.from.y, system: plan.from.system },
          write: t.write({ ...c, owner: f, plan, home: plan.from, stationIn: (k, pred) => galaxy.systems[k].stations.find(pred) || null }),
        }));
      });
    }
    return { list, byId: Object.fromEntries(list.map((j) => [j.id, j])) };
  }

  // Whether a job is offered at a station: its own station, any station in its system, or any
  // station of its faction.
  const offeredAt = (job, st) => (job.tier === 'station' ? job.scope === st.key : job.tier === 'system' ? job.scope === st.system : job.scope === st.owner);

  return { TIERS, CREWS, REACH, ROCK_LABEL, VALUE, board, offeredAt, hops, value };
})();

export { Jobs };
