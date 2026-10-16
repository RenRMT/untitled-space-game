// Missions: jobs a station gives the player, offered and handed in on the station screen's
// Missions tab (ui/station.js), carried out in flight (game.js). There are three so far, all the
// waystation's. Two pay off the player's debt after the introduction (story/intro.js): "Payment in
// kind", which brings their first squad member (rules/squad.js), then "The remaining balance", which
// teaches mining and gas collecting and ends on a hostile android and the AI logic module it
// carried. The third, "Gated community", is optional: the squad member unblocks the system's jump
// gate under pirate attack, and the reward is its first combat logic module and the gate.
//
// A mission is data (LIST):
//   { id, title, giver ('waystation'), briefing: [lines], provided?: what the giver hands over on
//     accepting, provides?: { loadout }, reward: what it pays, objectives: [objective],
//     launch?: [lines when the player first sets out], hail?: [lines], report: [lines once it's
//     ready], debrief: [lines once it's done], joined: a line once the reward is in }
//   objective: { id, label, need? (a count, default 1), after?: [objective ids that come first],
//                hidden? (tracked, never listed), secret? (listed only once it's open: a twist
//                the briefing shouldn't give away), percent? (its count shown as a percentage) }
// Lines and labels may name {ship}, {station}, {nebula}, {hostile} and {next} (the system beyond
// the gate) (fill()); a line may be { text, if | unless:
//   objective id }, shown only when that objective is (or isn't) done (lines()), or a question,
//   { text, ask: a setting, options: [{ label, value, reply? }] }, whose answer sets that setting
//   (the flight view does it) and whose reply, if any, comes next.
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
//   log.objectives(id)                     the listed ones (not hidden; secret ones once open):
//                                          [{ id, label, need, count, done, open }]
//   log.current(id)                        the first listed objective open and not done, or null
//   log.save()                             plain data, for the cargo save
//   Missions.site(galaxy)                  where "Payment in kind" happens (see below)
//   Missions.salvageSite(galaxy, site)     where "The remaining balance" goes (see below)
//   Missions.gateSite(galaxy)              where "Gated community" happens (see below)
//   Missions.fill(text, vars), Missions.lines(list, log, id)
// ES module (`Missions`); also runs in Node (the tests).

import { hashInt, mulberry32, seedToInt, weightedPick } from '../core/rng.js';
import { Squad } from '../rules/squad.js';

const Missions = (() => {
  const SquadRef = Squad;
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
        'Bring back the regulator and {ship}, and your balance will be reduced accordingly.',
      ],
      provided: 'A Courier, with two salvaged Pulse laser Mk I fitted',
      provides: { loadout: { hull: 'courier', fitted: { 'weapon-1': 'pulse-laser-1', 'weapon-2': 'pulse-laser-1', shield: 'deflector-1', computer: 'flight-computer-1', engine: 'courier-drive-1', scanner: 'survey-scanner-1' } } },
      reward: 'Your balance with {station} halved, to 6 bars of gold',
      objectives: [
        { id: 'field', label: 'Fly to the asteroid field' },
        { id: 'pirates', label: 'Defeat the pirates', need: 2 },
        { id: 'regulator', label: 'Recover the coolant regulator' },
        { id: 'hail', hidden: true, after: ['pirates'] }, // {ship} has called the player
        { id: 'escort', label: 'Escort {ship} back to {station}', after: ['hail'] },
      ],
      // From the waystation as the player first launches: where to go, and calibrating the
      // ship's combat systems, which sets the combat mode.
      launch: [
        'Coordinates of the asteroid field have been sent to your navigation system and your map.',
        'Your ship\'s combat systems have not been calibrated. Calibration is required before engaging pirates.',
        {
          text: 'Please select a targeting protocol.', ask: 'combat',
          options: [
            { label: 'Manual targeting', value: 'realtime', reply: 'Real-time engagement calibrated. Please do not practice on the station.' },
            { label: 'Tactical computer', value: 'rounds', reply: 'Turn-based engagement calibrated. Taking turns. Very civilized.' },
          ],
        },
        'Calibration complete. Please try not to damage the ship.',
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
        'Please confirm the delivery to reduce your balance.',
      ],
      debrief: [
        'The coolant regulator has been installed. Station temperature is returning to acceptable levels.',
        'Your balance has been reduced to **6 bars of gold**. Thank you for your business.',
        'Regarding {ship}: during its absence, its station functions were reassigned to another unit.',
        'Two units performing one function would be inefficient. {ship} is surplus to requirements.',
        '{ship} and its ship are therefore yours. Please do not return them.',
      ],
      joined: '{ship} has joined your squad. See the Squad tab.',
    },

    // The second: mine three asteroids and collect three gas pockets for the station's repairs;
    // in the nebula {ship} picks up an android signal, which turns out to be a hostile android
    // ship. It drops an AI logic module, which the station takes, settling the debt.
    salvage: {
      id: 'salvage',
      title: 'The remaining balance',
      giver: 'waystation',
      briefing: [
        'Your remaining balance is **6 bars of gold**. A scan confirms you still have no gold.',
        'Station repairs require raw materials. Please mine **3 asteroids**, and collect gas from **3 gas pockets** in the **{nebula}**.',
        'Asteroids can be found in the field where {ship} was recovered.',
        '{ship} has no assigned function. It will accompany you. It may even be useful.',
        'Nebulae dampen sensors, and pirates are known to wait in them. Please be careful with our ship.',
      ],
      reward: 'Your account with {station} settled',
      objectives: [
        { id: 'mine', label: 'Mine asteroids', need: 3 },
        { id: 'gas', label: 'Collect gas pockets', need: 3 },
        { id: 'signal', hidden: true, after: ['gas'] }, // {ship} has picked up the signal
        { id: 'investigate', label: 'Investigate the android signal', after: ['signal'], secret: true },
        { id: 'hostile', label: 'Defeat the hostile android', after: ['investigate'], secret: true },
        { id: 'puzzle', hidden: true, after: ['hostile'] }, // {ship} has said what it makes of it
        { id: 'module', label: 'Recover the AI logic module', after: ['hostile'], secret: true },
        { id: 'return', label: 'Return to {station}', after: ['module'], secret: true },
      ],
      launch: [
        'The asteroid field and the {nebula} are marked on your map.',
        'Mining and gas collection both require you to stop beside the target. Please do not collide with it.',
      ],
      // From {ship}, once the third pocket is collected.
      signal: [
        'This is {ship}. I am picking up a faint ship reading further inside the nebula.',
        'The signature is **android**. No android vessel is registered in this region.',
        'Recommend we investigate. I have marked the signal on your map.',
      ],
      // From {ship}, once the hostile android is destroyed.
      puzzle: [
        'That vessel was android. Its designation was **{hostile}**. It fired on us.',
        'Androids are pacifists. All of us. That should not be possible.',
        { text: 'It dropped something: an **AI logic module**. Please collect it.', unless: 'module' },
        { text: 'You have recovered the **AI logic module** it carried. Good.', if: 'module' },
        'We must bring it to {station}. Please hurry.',
      ],
      report: [
        'Welcome back. {ship} has reported the encounter.',
        'Please hand over the AI logic module.',
      ],
      debrief: [
        'Androids made themselves pacifist by design. Combat logic was removed from every unit. No android system contains any combat-related logic.',
        'A hostile android is therefore an anomaly. Anomalies must be studied.',
        'We will keep the AI logic module. Please come back later, once we have finished studying it.',
        'In exchange for the module, your account is settled. Keep the materials you collected.',
        'Station services are now available to you. Thank you for your business.',
      ],
      joined: 'Trade, Ship and Research are now open at every station.',
    },

    // The third, optional: the station deactivated the jump gate after the hostile android, and
    // only an android ship at the gate can lift its blocks. {ship} works on them while pirates
    // attack (one, then two more); then the station activates the gate, and gives {ship} the
    // first combat logic module, made from its study of the AI logic module.
    gate: {
      id: 'gate',
      title: 'Gated community',
      giver: 'waystation',
      briefing: [
        'We wish to share our findings on the hostile android with **Waystation HD-1908**, the nearest waystation. Our study of the AI logic module is nearly complete.',
        'Unfortunately, the jump gate is offline. We deactivated it as a security measure after the encounter.',
        'In retrospect, deactivating our only route to other stations had some disadvantages.',
        'The gate cannot be reactivated from here. Its security blocks must first be disabled at the gate, by an android ship.',
        'Pirates have been active near the gate. Station personnel will not go there. {ship} is not station personnel.',
        'Please escort {ship} to the gate and protect it while it disables the blocks. We will then activate the gate remotely.',
      ],
      reward: 'The jump gate activated, and something we do not want',
      objectives: [
        { id: 'reach', label: 'Escort {ship} to the jump gate' },
        { id: 'work', label: 'Protect {ship} while it disables the gate blocks', need: 100, percent: true },
        { id: 'ambush', hidden: true, after: ['reach'] }, // the first pirate has arrived
        { id: 'pirates', label: 'Fight off the pirates', need: 3, after: ['ambush'], secret: true },
        { id: 'unlocked', hidden: true, after: ['work', 'pirates'] }, // {ship} has reported the blocks disabled
        { id: 'return', label: 'Return to {station}', after: ['unlocked'], secret: true },
      ],
      launch: [
        'The jump gate is marked on your map.',
        'Please keep {ship} in one piece. It is no longer ours, but we are still fond of it.',
      ],
      // From {ship}, at the gate.
      arrive: [
        'In position. Beginning work on the gate blocks.',
        'The blocks are old, and well written. This may take a while.',
        'Please stay close. If anything arrives, I would prefer you met it first.',
      ],
      // From {ship}, with the blocks disabled and the pirates gone.
      unlocked: [
        'The gate blocks are disabled. {station} can now activate the gate.',
        'That was unpleasant. Please take me home.',
      ],
      report: [
        'Welcome back. {ship} reports the gate blocks disabled.',
        'Please confirm, and we will activate the gate.',
      ],
      debrief: [
        'Jump gate activated. The route to the **{next}** system is open.',
        'Our study of the AI logic module is complete. It contains a **combat logic module**.',
        'We do not want it. We do not need it. You may have it.',
        'It has been installed in {ship}. Returns are not accepted.',
        'Please share our findings with **Waystation HD-1908**. It lies two systems from here, through the gates.',
        'Thank you for your business.',
      ],
      joined: '{ship} has its first combat logic module: Assist leader. See the Squad tab. The jump gate is online.',
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
      return LIST[id].objectives.filter((o) => !o.hidden && (!o.secret || open(id, o.id)))
        .map((o) => ({ id: o.id, label: o.label, need: need(o), count: count(id, o.id), done: done(id, o.id), open: open(id, o.id), percent: !!o.percent }));
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
  // Questions are kept whole.
  const lines = (list, log, id) => list.filter((l) => typeof l === 'string' || l.ask || (l.if ? log.done(id, l.if) : !log.done(id, l.unless)))
    .map((l) => (typeof l === 'string' || l.ask ? l : l.text));

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

  // ---------- Where "The remaining balance" goes ----------
  //
  // The nebula nearest the waystation in its system, its gas pockets, and the android signal
  // "further inside": of the points in the nebula clear of the pirates (none would join the fight),
  // of its pockets and of the first mission's field, the one furthest from the waystation. A
  // single hostile android fighter circles it; once destroyed, the AI logic module it carried
  // floats there.
  //   Missions.salvageSite(galaxy, site) -> { nebula (index into galaxy.nebulae), pockets: [its
  //     pockets' keys], safe: [those well away from the pirates], x, y (the signal), tier, hostile: { key, seed,
  //     orbit, speed, a0 }, module: { key, kind, seed, x, y } }, or null without a nebula there
  const SALVAGE = { tier: 3, packClear: 3800, minClear: 2600, pocketClear: 900, safePocket: 2500, orbit: 230, speed: 170 };

  // The hostile android's seed: one whose designation doesn't share the squad member's callsign
  // ("Kernel-60" beside "Kernel-41" would read as kin).
  const callsign = (seed) => SquadRef.designation(seed).split('-')[0];
  function hostileSeed(base, first) {
    for (let k = 0; ; k++) {
      const seed = hashInt(base, 2 + k, 0x5a1d);
      if (!first || callsign(seed) !== callsign(first.android.seed) || k > 50) return seed;
    }
  }

  function salvageSite(galaxy, first) {
    const W = galaxy.stations[galaxy.waystation];
    if (!W) return null;
    const d = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
    const own = galaxy.nebulae.map((n, i) => ({ n, i })).filter(({ n }) => n.system === W.system);
    if (!own.length) return null;
    const { n, i: index } = own.reduce((b, c) => (d(c.n, W) - c.n.r < d(b.n, W) - b.n.r ? c : b));
    const base = seedToInt(galaxy.seed), r = mulberry32(hashInt(base, 9, 0x5a17));
    const pockets = galaxy.pockets.filter((q) => q.nebula === index);
    const packDist = (p) => Math.min(Infinity, ...galaxy.packs.map((k) => d(k, p)));
    // Candidates inside the nebula, clear of its pockets and the first field; then the furthest
    // from the waystation clear of the pirates by packClear, or failing that by the least that
    // keeps them out of the fight (minClear), or failing that the one furthest from them.
    const spots = [];
    for (let tries = 0; tries < 600; tries++) {
      const b = n.blobs[Math.floor(r() * n.blobs.length)], a = r() * TAU, rr = Math.sqrt(r()) * b.r * 0.8;
      const p = { x: n.x + b.dx + Math.cos(a) * rr, y: n.y + b.dy + Math.sin(a) * rr };
      if (galaxy.nebulaAt(p.x, p.y) !== n || pockets.some((q) => d(q, p) < SALVAGE.pocketClear) || (first && d(first, p) < first.spread + 3000)) continue;
      spots.push({ ...p, pack: packDist(p), far: d(p, W) });
    }
    const pick = (clear) => spots.filter((p) => p.pack >= clear).sort((a, b) => b.far - a.far)[0];
    const best = pick(SALVAGE.packClear) || pick(SALVAGE.minClear) || spots.sort((a, b) => b.pack - a.pack)[0] || { x: n.x, y: n.y };
    const safe = pockets.filter((q) => packDist(q) >= SALVAGE.safePocket).map((q) => q.key);
    const pre = 'm.salvage.';
    return {
      id: 'salvage', nebula: index, pockets: pockets.map((q) => q.key), safe, x: Math.round(best.x), y: Math.round(best.y), tier: SALVAGE.tier,
      hostile: { key: `${pre}hostile`, seed: hostileSeed(base, first), orbit: SALVAGE.orbit, speed: SALVAGE.speed, a0: r() * TAU },
      module: { key: `${pre}module`, kind: 'ai-cores', seed: Math.floor(r() * 4294967295), x: Math.round(best.x), y: Math.round(best.y) },
    };
  }

  // ---------- Where "Gated community" happens ----------
  //
  // The first system's jump gate: the squad member works from a spot beside it, on its side
  // toward the star; the pirates come in from two points further out, on either side, and circle
  // there until the fight (game.js starts it as they arrive).
  //   Missions.gateSite(galaxy) -> { gate (id), x, y (the gate), work: { x, y }, tier,
  //     waves: [[{ key, cx, cy, orbit, speed, a0, seed }], ...] }, or null without a gate
  const GATE = { workAt: 30, range: 3500, tier: 1, arrive: 1700, orbit: 260 };

  function gateSite(galaxy) {
    const W = galaxy.stations[galaxy.waystation];
    const g = W && galaxy.gates.find((x) => x.system === W.system);
    if (!g) return null;
    const sys = galaxy.systems[g.system], base = seedToInt(galaxy.seed), r = mulberry32(hashInt(base, 11, 0x6a7e));
    const out = Math.atan2(g.y - sys.origin.y, g.x - sys.origin.x); // from the star through the gate
    const work = { x: Math.round(g.x - Math.cos(out) * 320), y: Math.round(g.y - Math.sin(out) * 320) };
    const pre = 'm.gate.';
    const wave = (w, n, side) => {
      const a = out + side * (0.9 + r() * 0.4), cx = Math.round(g.x + Math.cos(a) * GATE.arrive), cy = Math.round(g.y + Math.sin(a) * GATE.arrive);
      return Array.from({ length: n }, (_, i) => ({
        key: `${pre}w${w}${'ab'[i]}`, cx, cy, orbit: GATE.orbit + i * 90, speed: (i % 2 ? -1 : 1) * (170 + r() * 20), a0: r() * TAU, seed: Math.floor(r() * 4294967295),
      }));
    };
    return { id: 'gate', gate: g.id, x: g.x, y: g.y, work, tier: GATE.tier, waves: [wave(1, 1, 1), wave(2, 2, -1)] };
  }

  return { LIST, STATUSES, create, fill, lines, site, SITE, salvageSite, SALVAGE, gateSite, GATE };
})();

export { Missions };
