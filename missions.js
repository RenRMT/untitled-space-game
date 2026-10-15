'use strict';

// Missions: jobs a station gives the player, offered and handed in on the station screen's
// Missions tab (station.js), carried out in flight (game.js). There is one so far: the
// waystation's "Payment in kind", which ends the introduction (intro.js) and brings the player
// their first squad member (squad.js).
//
// A mission is data (LIST):
//   { id, title, giver ('waystation'), briefing: [lines], provided?: what the giver hands over on
//     accepting, provides?: { loadout }, reward: what it pays, objectives: [objective],
//     hail?: [lines], report: [lines once it's ready], debrief: [lines once it's done],
//     joined: a line once the reward is in }
//   objective: { id, label, need? (a count, default 1), after?: [objective ids that come first],
//                hidden? (tracked, never listed) }
// Lines and labels may name {ship} and {station} (fill()); a line may be { text, if | unless:
//   objective id }, shown only when that objective is (or isn't) done (lines()).
// Each mission is offered, then active once accepted, ready once every objective is done, and
// done once handed in to its giver.
//
//   const log = Missions.create(saved?)    saved: what log.save() gave
//   log.status(id)                         'offered' | 'active' | 'ready' | 'done'
//   log.accept(id), log.complete(id)       offered -> active, ready -> done (false if not)
//   log.finish(id)                         straight to done (a skipped opening, an old save)
//   log.count(id, obj), log.done(id, obj)  progress on an objective, and whether it's met
//   log.set(id, obj, n)                    progress made (only while active); true if it changed
//   log.open(id, obj)                      its `after` objectives are done
//   log.objectives(id)                     the listed ones: [{ id, label, need, count, done, open }]
//   log.current(id)                        the first listed objective open and not done, or null
//   log.save()                             plain data, for the cargo save
//   Missions.site(galaxy)                  where "Payment in kind" happens (see below)
//   Missions.fill(text, vars), Missions.lines(list, log, id)
// Works as a classic browser script (global `Missions`) and as a Node module.

const Missions = (() => {
  const isNode = typeof require === 'function' && typeof module !== 'undefined';
  const { hashInt, mulberry32, seedToInt, weightedPick } = isNode ? require('./rng.js') : globalThis;
  const TAU = Math.PI * 2;

  const LIST = {
    repayment: {
      id: 'repayment',
      title: 'Payment in kind',
      giver: 'waystation',
      briefing: [
        'Your account shows an outstanding balance of **12 bars of gold**. You arrived with an escape pod and no gold. We have considered the alternatives.',
        'One of our units, **{ship}**, was sent to retrieve a **coolant regulator**. The station cannot operate for long without it.',
        '{ship} has not returned. Its last signal came from an asteroid field near this station. We suspect it was captured by pirates.',
        'Station personnel are pacifists. Sending a retrieval party would expose them to violence, which is against policy.',
        'You are not station personnel. We will provide a ship, and weapons salvaged from previous visitors.',
        'Bring back the regulator and {ship}, and your account will be settled.',
      ],
      provided: 'A Courier, with two salvaged Pulse laser Mk I fitted',
      provides: { loadout: { hull: 'courier', fitted: { 'weapon-1': 'pulse-laser-1', 'weapon-2': 'pulse-laser-1', shield: 'deflector-1', computer: 'flight-computer-1', engine: 'courier-drive-1', scanner: 'survey-scanner-1' } } },
      reward: 'Your account with {station} settled',
      objectives: [
        { id: 'field', label: 'Fly to the asteroid field' },
        { id: 'pirates', label: 'Defeat the pirates', need: 2 },
        { id: 'regulator', label: 'Recover the coolant regulator' },
        { id: 'hail', hidden: true, after: ['pirates'] }, // {ship} has called the player
        { id: 'escort', label: 'Escort {ship} back to {station}', after: ['hail'] },
      ],
      // {ship} calls once the pirates are gone.
      hail: [
        'Unidentified vessel, this is **{ship}**. Your hull registry matches an asset of {station}.',
        'Conclusion: you are not a pirate. Thank you for removing the pirates.',
        { text: 'The pirates cut the **coolant regulator** from my hold. It is drifting nearby. Please collect it.', unless: 'regulator' },
        { text: 'I see you have recovered the coolant regulator. Excellent.', if: 'regulator' },
        'My drive is functional. My weapons were never installed. Please escort me back to {station}.',
      ],
      // At the waystation once every objective is met, before it's handed in.
      report: [
        'Welcome back. Sensors confirm the coolant regulator and {ship} are aboard.',
        'Please confirm the delivery to settle your account.',
      ],
      debrief: [
        'The coolant regulator has been installed. Station temperature is returning to acceptable levels.',
        'Your account is settled. Thank you for your business.',
        'Regarding {ship}: during its absence, its station functions were reassigned to another unit.',
        'Two units performing one function would be inefficient. {ship} is surplus to requirements.',
        '{ship} and its ship are therefore yours. Please do not return them.',
      ],
      joined: '{ship} has joined your squad. See the Squad tab.',
    },
  };
  for (const m of Object.values(LIST)) m.byId = Object.fromEntries(m.objectives.map((o) => [o.id, o]));

  const STATUSES = ['offered', 'active', 'ready', 'done'];
  const need = (o) => o.need || 1;

  function create(saved) {
    const state = {}; // id -> { status, progress: { [objective id]: count } }
    if (saved && typeof saved === 'object') {
      for (const [id, s] of Object.entries(saved)) {
        if (!LIST[id] || !s || !STATUSES.includes(s.status)) continue;
        const progress = {};
        for (const [o, n] of Object.entries(s.progress || {})) {
          const obj = LIST[id].byId[o];
          if (obj && Number.isFinite(n) && n > 0) progress[o] = Math.min(need(obj), Math.floor(n));
        }
        state[id] = { status: s.status, progress };
      }
    }
    const status = (id) => (state[id] ? state[id].status : 'offered');
    const count = (id, o) => (state[id] && state[id].progress[o]) || 0;
    const done = (id, o) => status(id) === 'done' || count(id, o) >= need(LIST[id].byId[o]);
    const open = (id, o) => (LIST[id].byId[o].after || []).every((a) => done(id, a));

    function set(id, o, n) {
      const obj = LIST[id] && LIST[id].byId[o];
      if (!obj || status(id) !== 'active') return false;
      const v = Math.max(0, Math.min(need(obj), Math.floor(n)));
      if (v === count(id, o)) return false;
      state[id].progress[o] = v;
      if (LIST[id].objectives.every((x) => done(id, x.id))) state[id].status = 'ready';
      return true;
    }

    function objectives(id) {
      return LIST[id].objectives.filter((o) => !o.hidden)
        .map((o) => ({ id: o.id, label: o.label, need: need(o), count: count(id, o.id), done: done(id, o.id), open: open(id, o.id) }));
    }

    return {
      status,
      accept(id) {
        if (!LIST[id] || status(id) !== 'offered') return false;
        state[id] = { status: 'active', progress: {} };
        return true;
      },
      complete(id) {
        if (status(id) !== 'ready') return false;
        state[id].status = 'done';
        return true;
      },
      finish(id) {
        if (!LIST[id]) return false;
        state[id] = { status: 'done', progress: state[id] ? state[id].progress : {} };
        return true;
      },
      count, done, open, set, objectives,
      current: (id) => objectives(id).find((o) => o.open && !o.done) || null,
      save: () => JSON.parse(JSON.stringify(state)),
    };
  }

  // A line or label with its {names} filled in (unknown names are left as they are).
  const fill = (text, vars) => text.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
  // A mission's lines as they read now: conditional ones only when their objective is (or isn't) done.
  const lines = (list, log, id) => list.filter((l) => typeof l === 'string' || (l.if ? log.done(id, l.if) : !log.done(id, l.unless)))
    .map((l) => (typeof l === 'string' ? l : l.text));

  // ---------- Where "Payment in kind" happens ----------
  //
  // A small asteroid field a short flight from the waystation (5.5–7k units: about ten seconds at
  // the Courier's speed), placed from the galaxy's seed in open space: clear of planets, stations,
  // gates, nebulae, belts, other fields, contacts, and far enough from the system's pirate packs
  // that none of them joins the fight. Where that can't be had, it may lie in a belt or by other
  // rocks and wrecks, then a little nearer or further (4.5–9k). In it: the captured android ship at the centre, the
  // coolant regulator drifting beside it, and two Mk I pirate fighters circling them.
  //   Missions.site(galaxy) -> { id, x, y, spread, tier, rocks: [{ key, x, y, type, r, seed, spin0,
  //     tumble }], pirates: [{ key, orbit, speed, a0, seed }], android: { key, seed, angle },
  //     cargo: { key, kind, seed, x, y } } (keys unique in the galaxy), or null with no waystation
  // The android ship's seed is the one the starting wingman used to have, so its name stays.
  const SITE = { near: 5500, far: 7000, spread: 1100, rocks: [16, 22], pirates: 2, tier: 1, orbit: [380, 520], speed: [160, 190] };
  const FIELD_TYPES = [['carbon', 3], ['stony', 2], ['ice', 2], ['metal', 1]];

  function site(galaxy) {
    const W = galaxy.stations[galaxy.waystation];
    if (!W) return null;
    const sys = galaxy.systems[W.system];
    const base = seedToInt(galaxy.seed);
    const r = mulberry32(hashInt(base, 7, 0x3155));
    const d = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
    // Each check by name, so later passes can drop the ones that matter least.
    const CHECKS = {
      inside: (p) => d(p, sys.origin) <= sys.radius - 2000,
      planets: (p) => galaxy.planets.every((pl) => d(pl, p) >= pl.extent + 2500),
      stations: (p) => galaxy.stations.every((st) => st === W || d(st, p) >= 7000),
      gates: (p) => galaxy.gates.every((g) => d(g, p) >= 4000),
      nebulae: (p) => galaxy.nebulae.every((n) => d(n, p) >= n.r + 1500),
      packs: (p) => galaxy.packs.every((k) => d(k, p) >= 4500),
      belts: (p) => galaxy.belts.every((b) => Math.abs(Math.hypot(p.x - b.cx, p.y - b.cy) - b.r) >= b.width / 2 + 1500),
      fields: (p) => galaxy.fields.every((f) => d(f, p) >= f.spread + SITE.spread + 1500),
      contacts: (p) => galaxy.contacts.every((c) => d(c, p) >= c.r + 2500),
    };
    // Passes: everything at the usual distance; then inside a belt or by other rocks and wrecks
    // will do; then a little nearer or further.
    const PASSES = [
      { checks: Object.keys(CHECKS), range: [SITE.near, SITE.far] },
      { checks: ['inside', 'planets', 'stations', 'gates', 'nebulae', 'packs'], range: [SITE.near, SITE.far] },
      { checks: ['inside', 'planets', 'stations', 'gates', 'nebulae', 'packs'], range: [4500, 9000] },
      { checks: ['inside', 'planets', 'packs'], range: [4500, 9000] },
    ];
    let at = null;
    for (const pass of PASSES) {
      for (let tries = 0; tries < 400 && !at; tries++) {
        const a = r() * TAU, dist = pass.range[0] + r() * (pass.range[1] - pass.range[0]);
        const p = { x: W.x + Math.cos(a) * dist, y: W.y + Math.sin(a) * dist };
        if (pass.checks.every((k) => CHECKS[k](p))) at = p;
      }
      if (at) break;
    }
    if (!at) { // toward the star: inside the system, and away from the edge
      const a = Math.atan2(sys.origin.y - W.y, sys.origin.x - W.x);
      at = { x: W.x + Math.cos(a) * SITE.near, y: W.y + Math.sin(a) * SITE.near };
    }
    const pre = 'm.repayment.';
    const rocks = [];
    for (let i = 0, n = SITE.rocks[0] + Math.floor(r() * (SITE.rocks[1] - SITE.rocks[0] + 1)); i < n; i++) {
      const a = r() * TAU, dist = 260 + Math.sqrt(r()) * (SITE.spread - 260);
      rocks.push({
        key: `${pre}a${i}`, x: at.x + Math.cos(a) * dist, y: at.y + Math.sin(a) * dist, type: weightedPick(FIELD_TYPES, r()),
        r: 8 + r() ** 2.2 * 44, seed: Math.floor(r() * 4294967295), spin0: r() * TAU, tumble: (r() - 0.5) * 0.5,
      });
    }
    const pirates = [];
    for (let i = 0; i < SITE.pirates; i++) {
      const orbit = SITE.orbit[0] + r() * (SITE.orbit[1] - SITE.orbit[0]);
      const speed = (i % 2 ? -1 : 1) * (SITE.speed[0] + r() * (SITE.speed[1] - SITE.speed[0]));
      pirates.push({ key: `${pre}s${i}`, orbit, speed, a0: (i / SITE.pirates) * TAU + r(), seed: Math.floor(r() * 4294967295) });
    }
    const angle = r() * TAU, ca = angle + Math.PI / 2 + (r() - 0.5);
    return {
      id: 'repayment', x: at.x, y: at.y, spread: SITE.spread, tier: SITE.tier, rocks, pirates,
      android: { key: `${pre}android`, seed: hashInt(base, 1, 0x5a0d), angle },
      cargo: { key: `${pre}regulator`, kind: 'electronics', seed: Math.floor(r() * 4294967295), x: at.x + Math.cos(ca) * 170, y: at.y + Math.sin(ca) * 170 },
    };
  }

  return { LIST, STATUSES, create, fill, lines, site, SITE };
})();

if (typeof module !== 'undefined') module.exports = Missions;
