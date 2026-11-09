// Redshift's events (notes/sim.md): what happens to a system besides what the player builds.
//
// Offers (state.offers) are what's waiting on the player: each from someone (people.js), about a
// body (its bubble floats there on the map), answered from its sheet. Requests (state.requests)
// are what the player took on.
//
// - Requests: now and then a culture in the system asks for something: a station at a particular
//   body (often not the best spot for its yield: that's the point), a stockpile, a ship, an upgrade,
//   or to hold on until the horizon reaches a mark with one of their stations running (the reason to
//   stay one more cycle). Done, they pay: approval, resources, sometimes Insight. Missed, approval
//   falls; turned down, a little.
// - Drifters (where they are): unrest grows while security is short of demand (twice as fast in
//   Drifter space, slower while their haunts are built on). When it boils over they blockade a
//   station no defense platform covers (it stops until they're bribed, a patrol breaks it, or they
//   tire of it), or put up a rogue station on an empty body that skims the system's minerals and
//   volatiles until it's evicted (a wreck is left) or parleyed with (it becomes an outpost that
//   pays its way, and the Wedge hate it).
// - Aliens (where they are): every so often a visitor, with an offer. Accepted, it may help (the
//   hole pushed back, Insight, a free upgrade, a burst of output) or harm (the hole pulled closer,
//   ships lost, a station taken for a hive). A lab can study them instead, safely.
// - Hazards: ion storms (ships dark for a while) and pulsar pulses (an undefended station knocked
//   out) come round on their own clock.
//
//   SimEvents.tick(state, meta, events) -> events   after the rules' tick: what else happened
//   SimEvents.answers(state, meta, id) -> [{ id, label, ok, why, primary, pick }]   what can be said to an offer
//   SimEvents.answer(state, meta, id, answer) -> { kicker, text, who, tone, key } | null
//   SimEvents.progress(state, req) -> { f (0..1), text }   how far along a request is
//   SimEvents.rewardText(reward) -> '+40 minerals, +2 Insight'
// ES module (`SimEvents`); also runs in Node (the tests).

import { hashInt, mulberry32 } from '../core/rng.js';
import { SimConfig } from './config.js';
import { SimPeople } from './people.js';
import { SimRules } from './rules.js';
import { SimWorld } from './world.js';

const SimEvents = (() => {
  const C = SimConfig, R = SimRules;
  const TONE = { good: '#b6ff8a', bad: '#ff5a6e', warn: '#ffb347' };

  const rnd = (state, salt) => mulberry32(hashInt(state.terms.seed, Math.floor(state.cycle) * 31 + state.seq, salt));
  const pickOf = (r, list) => list[Math.floor(r() * list.length)];
  const bodyOf = (state, key) => R.world(state).bodies.find((b) => b.key === key);
  const nameOf = (state, key) => bodyOf(state, key)?.name || '';
  const leader = (state, c) => SimPeople.person(c, state.terms.seed + c.length * 101);
  const someone = (state, c, r) => SimPeople.person(c, Math.floor(r() * 1e6));
  const resName = (r) => (r === 'sci' ? 'science' : C.RES[r].name.toLowerCase());

  function rewardText(rw) {
    if (!rw) return '';
    const parts = [];
    for (const r of R.RES) if (rw[r]) parts.push(`+${rw[r]} ${resName(r)}`);
    if (rw.insight) parts.push(`+${rw.insight} Insight`);
    if (rw.approval) parts.push(`+${rw.approval} approval`);
    return parts.join(', ');
  }
  function give(state, rw, culture) {
    for (const r of R.RES) if (rw[r]) state.res[r] += rw[r];
    if (rw.insight) state.insightSys += rw.insight;
    if (rw.approval && state.approval[culture] != null) state.approval[culture] = Math.min(100, state.approval[culture] + rw.approval);
  }
  const shift = (state, culture, n) => { if (state.approval[culture] != null) state.approval[culture] = Math.max(0, Math.min(100, state.approval[culture] + n)); };

  // ---------- Requests ----------
  // What each culture asks for: [kind, weight].
  const ASKS = {
    wedge: [['place', 3], ['ship', 2], ['upgrade', 1], ['stock', 1], ['hold', 2]],
    block: [['place', 3], ['stock', 3], ['ship', 1], ['upgrade', 1], ['hold', 1]],
    shard: [['place', 3], ['upgrade', 1], ['stock', 1], ['hold', 3]],
    android: [['place', 2], ['ship', 1], ['stock', 1]],
  };
  const LINES = {
    place: {
      wedge: (b, S) => [`Put a ${S.name.toLowerCase()} over **${b}**. I don't care what's in the rocks there. I care what can see us coming.`],
      block: (b, S) => [`We want a ${S.name.toLowerCase()} at **${b}**. The guild has its reasons; the guild pays for them.`],
      shard: (b, S) => [`The light falls strangely at **${b}**. Raise a ${S.name.toLowerCase()} there, and we will see what it shows us.`],
      android: (b, S) => [`Recommendation: a ${S.name.toLowerCase()} at **${b}**. Projected yield is secondary. Projected survival is not.`],
    },
    stock: {
      wedge: (n, r) => [`Stockpile **${n} ${r}**. If we have to run, we run with full holds.`],
      block: (n, r) => [`Show the guild **${n} ${r}** on the books. Confidence is a currency too.`],
      shard: (n, r) => [`Gather **${n} ${r}**. The work cannot wait for supply.`],
      android: (n, r) => [`Reserve target: **${n} ${r}**. Margin of error: none.`],
    },
    ship: {
      wedge: (S) => [`Commission a ship at a **${S.name.toLowerCase()}**. Crews that fly don't panic.`],
      block: (S) => [`Get a ship working out of a **${S.name.toLowerCase()}**. Idle docks make idle hands.`],
      android: (S) => [`Add a vessel at a **${S.name.toLowerCase()}**. Throughput will follow.`],
    },
    upgrade: {
      wedge: (S) => [`Fit a **${S.name.toLowerCase()}** to Mk II. We hold with what we have; let's have more.`],
      block: (S) => [`A Mk II **${S.name.toLowerCase()}**. The guild invests in winners.`],
      shard: (S) => [`Refine a **${S.name.toLowerCase()}** to Mk II. Every facet polished is a truth revealed.`],
    },
    hold: {
      wedge: (p, S) => [`A convoy of ours is still coming in. Hold until the horizon reaches **${p}%** with a ${S.name.toLowerCase()} on watch.`, 'Jump before that and they die out there.'],
      block: (p, S) => [`The guild's last contract here closes at **${p}%** on the meter. Keep a ${S.name.toLowerCase()} trading until then.`, 'It will be worth it.'],
      shard: (p, S) => [`We must see the hole up close. Keep a ${S.name.toLowerCase()} watching until the horizon reaches **${p}%**.`, 'What we learn there, we keep. All of us, in every system after.'],
    },
  };
  const TITLE = { place: (S, b) => `A ${S.name.toLowerCase()} at ${b}`, stock: (n, r) => `${n} ${r} in store`, ship: (S) => `A ship at a ${S.name.toLowerCase()}`, upgrade: (S) => `A Mk II ${S.name.toLowerCase()}`, hold: (p) => `Hold to ${p}%` };

  // A request from a culture here; if what it picked can't be asked yet (a ship where there's no
  // station), a place or a stockpile instead.
  function newRequest(state, meta) {
    const r = rnd(state, 0x2e9);
    for (let i = 0; i < 4; i++) {
      const q = request0(state, meta, r, i ? (i === 1 ? 'place' : 'stock') : null);
      if (q) return q;
    }
    return null;
  }
  function request0(state, meta, r, force) {
    const cultures = [...C.SETTLED.filter((c) => R.has(state, c)), 'android'];
    const c = cultures.length > 1 && r() < 0.85 ? pickOf(r, cultures.filter((x) => x !== 'android')) : 'android';
    const list = ASKS[c];
    const tot = list.reduce((s, [, w]) => s + w, 0);
    let x = r() * tot, kind = list[0][0];
    for (const [k, w] of list) { x -= w; if (x < 0) { kind = k; break; } }
    if (force) kind = force;
    const w = R.world(state);
    const type = c === 'android' ? pickOf(r, ['mine', 'siphon']) : C.CULTURES[c].station;
    const S = C.STATIONS[type];
    const who = someone(state, c, r);
    const deadline = state.cycle + C.REQUESTS.deadline;
    const base = { culture: c, who, ask: kind, type, deadline, reward: { approval: 15 } };
    switch (kind) {
      case 'place': {
        // A body that can take it, the culture's trait first, else one at random: not the best for
        // its yield, as often as not.
        const free = w.bodies.filter((b) => b.kind !== 'gate' && !state.stations[b.key] && (!S.per || b[S.per] > 0));
        if (!free.length) return null;
        const own = free.filter((b) => b.trait && C.TRAITS[b.trait].culture === c);
        const b = own.length ? pickOf(r, own) : pickOf(r, free);
        return { ...base, key: b.key, title: TITLE.place(S, b.name), lines: LINES.place[c](b.name, S), reward: { approval: 15, cr: 40 + 10 * state.depth, insight: own.length ? 1 : 0 } };
      }
      case 'stock': {
        const res = c === 'block' ? 'cr' : c === 'shard' ? pickOf(r, R.has(state, 'shard') ? ['v', 'sci'] : ['v']) : pickOf(r, ['m', 'v']);
        const n = Math.round(((res === 'sci' ? 40 : res === 'cr' ? 180 : 140) + (state.depth * 20)) * (0.8 + r() * 0.4) / 10) * 10;
        return { ...base, res, n, key: w.gate, title: TITLE.stock(n, resName(res)), lines: LINES.stock[c](n, resName(res)), reward: { approval: 12, [res === 'cr' ? 'm' : 'cr']: Math.round(n * 0.4) } };
      }
      case 'ship': {
        const types = c === 'android' ? ['mine', 'siphon'] : [type];
        const t = pickOf(r, types), have = shipsOf(state, t);
        if (!Object.values(state.stations).some((s) => s.type === t && !s.rogue)) return null;
        return { ...base, type: t, base: have, key: keyOfType(state, t), title: TITLE.ship(C.STATIONS[t]), lines: LINES.ship[c](C.STATIONS[t]), reward: { approval: 12, cr: 50 } };
      }
      case 'upgrade': {
        if (!Object.values(state.stations).some((s) => s.type === type && !s.rogue)) return null;
        return { ...base, key: keyOfType(state, type), title: TITLE.upgrade(S), lines: LINES.upgrade[c](S), reward: { approval: 15, m: 40 } };
      }
      case 'hold': {
        if (!R.gateStatus(state, meta).stage && state.pull < 20) return null;
        const p = Math.min(92, Math.max(Math.ceil(state.pull) + 15, 60 + Math.round(r() * 25)));
        return { ...base, pull: p, deadline: null, key: keyOfType(state, type) || w.gate, title: TITLE.hold(p), lines: LINES.hold[c](p, S), reward: { approval: 10, insight: 2 + Math.round((p - 60) / 10) } };
      }
      default: return null;
    }
  }
  const shipsOf = (state, type) => Object.values(state.stations).filter((s) => s.type === type).reduce((t, s) => t + s.ships, 0);
  const keyOfType = (state, type) => Object.entries(state.stations).find(([, s]) => s.type === type && !s.rogue)?.[0] || null;
  const running = (state, type) => Object.values(state.stations).some((s) => s.type === type && !s.left && !s.blocked && !s.off && !s.rogue);

  function progress(state, q) {
    switch (q.ask) {
      case 'place': { const st = state.stations[q.key]; return st?.type === q.type ? { f: st.left > 0 ? 0.5 : 1, text: st.left > 0 ? 'Building' : 'Built' } : { f: 0, text: `At ${nameOf(state, q.key)}` }; }
      case 'stock': { const n = state.res[q.res] || 0; return { f: Math.min(1, n / q.n), text: `${Math.floor(n)} / ${q.n}` }; }
      case 'ship': { const n = shipsOf(state, q.type) - q.base; return { f: n > 0 ? 1 : 0, text: n > 0 ? 'Done' : 'No new ship yet' }; }
      case 'upgrade': { const ok = Object.values(state.stations).some((s) => s.type === q.type && s.level >= 2); return { f: ok ? 1 : 0, text: ok ? 'Done' : 'Mk I' }; }
      case 'hold': { const on = running(state, q.type); return { f: Math.min(1, state.pull / q.pull), text: `${state.pull.toFixed(0)}% of ${q.pull}%${on ? '' : ' · no ' + C.STATIONS[q.type].name.toLowerCase() + ' running'}` }; }
      default: return { f: 0, text: '' };
    }
  }
  const doneOf = (state, q) => (q.ask === 'hold' ? state.pull >= q.pull && running(state, q.type) : progress(state, q).f >= 1);


  // ---------- Drifters ----------
  // Whether a station is covered by a defense platform: one in its group, or one on high ground.
  function covered(state, key) {
    const w = R.world(state);
    const grp = SimWorld.group(w, key);
    return Object.entries(state.stations).some(([k, s]) => s.type === 'defense' && !s.left && !s.blocked
      && (grp.includes(k) || R.bodyOf(w, k)?.trait === 'strategic'));
  }
  function drifters(state, meta) {
    if (!R.has(state, 'drifters')) return [];
    const r = state.rates, D = C.DRIFTERS, hz = C.HAZARDS[state.terms.hazard];
    const w = R.world(state);
    const haunts = w.bodies.filter((b) => b.trait === 'haunt');
    const held = haunts.length && haunts.every((b) => state.stations[b.key] && !state.stations[b.key].rogue);
    const short = Math.max(0, r.demand - r.sec);
    if (short > 0) state.unrest += (D.base + D.perShort * short) * (hz?.unrestMul || 1) * (held ? D.haunted : 1);
    else state.unrest = Math.max(0, state.unrest - 0.05);
    if (state.unrest < D.at) return [];
    state.unrest = 0;
    const rr = rnd(state, 0xd41f);
    const who = someone(state, 'drifters', rr);
    const empty = w.bodies.filter((b) => b.kind !== 'gate' && !state.stations[b.key]);
    const hauntFree = empty.filter((b) => b.trait === 'haunt');
    const targets = Object.entries(state.stations).filter(([k, s]) => C.STATIONS[s.type] && !s.left && !s.blocked && !covered(state, k));
    if ((hauntFree.length || (empty.length && rr() < 0.4)) || !targets.length) {
      if (!empty.length) return [{ kind: 'toast', kicker: 'Drifters', text: 'Drifters circled the system, found nowhere to settle, and left. This time.', who, tone: C.CULTURES.drifters.color }];
      const b = hauntFree.length ? pickOf(rr, hauntFree) : pickOf(rr, empty);
      state.stations[b.key] = { type: 'rogue', rogue: true, level: 1, ships: 0, slots: 0, left: 8, total: 8, culture: 'drifters', seed: (state.seq++ * 4099) % 99991 };
      state.offers.push({ id: `o${state.seq++}`, kind: 'rogue', who, key: b.key, title: `A rogue station at ${b.name}`, mark: '⚠',
        lines: [`We're setting up at **${b.name}**. You weren't using it, and your people weren't keeping anyone safe.`, 'We take a cut of what passes. Or you can try to make us leave.'] });
      return [{ kind: 'toast', kicker: 'Drifters', text: `A rogue station is going up at ${b.name}.`, who, tone: TONE.bad, key: b.key, bad: true }];
    }
    const [key, st] = pickOf(rr, targets);
    st.blocked = D.blockade;
    state.offers.push({ id: `o${state.seq++}`, kind: 'blockade', who, key, title: `Blockade at ${nameOf(state, key)}`, mark: '⚠',
      lines: [`Nothing in or out of your ${C.STATIONS[st.type].name.toLowerCase()} at **${nameOf(state, key)}** until we say so.`, 'Credits would help us say so sooner.'] });
    return [{ kind: 'toast', kicker: 'Blockade', text: `Drifters have blockaded the ${C.STATIONS[st.type].name.toLowerCase()} at ${nameOf(state, key)}.`, who, tone: TONE.bad, key, bad: true }];
  }
  const patrols = (state) => Object.values(state.stations).filter((s) => s.type === 'defense' && !s.left && !s.blocked && s.ships > 0 && !(state.effects.storm > 0));

  // ---------- Aliens ----------
  const ALIEN_LINES = {
    gift: ['We have watched you run. We could make it easier. Give us something of yours, and see.'],
    fold: ['Space bends. The hole knows. We could bend it away from you. Or toward. We do not always choose.'],
    hive: ['Let us grow here. We will be quiet. We will give back what we are given, and more, perhaps.'],
  };
  function aliens(state, meta) {
    if (!R.has(state, 'alien')) return [];
    const n = Math.floor(state.cycle), A = C.ALIENS, hz = C.HAZARDS[state.terms.hazard];
    if (n < state.next.alien) return [];
    const rr = rnd(state, 0xa11e);
    state.next.alien = n + Math.round((A.every + (rr() - 0.5) * 2 * A.jitter) / (hz?.alienMul || 1));
    if (state.offers.some((o) => o.kind === 'alien')) return [];
    const w = R.world(state);
    const empty = w.bodies.filter((b) => b.kind !== 'gate' && !state.stations[b.key]);
    const kind = empty.length && rr() < 0.3 ? 'hive' : rr() < 0.5 ? 'fold' : 'gift';
    const key = kind === 'hive' ? pickOf(rr, empty).key : pickOf(rr, w.bodies).key;
    const who = someone(state, 'alien', rr);
    const cost = kind === 'gift' ? { m: 40 + 10 * state.depth, v: 30 + 10 * state.depth } : kind === 'fold' ? { v: 40 + 10 * state.depth } : null;
    state.offers.push({ id: `o${state.seq++}`, kind: 'alien', alien: kind, who, key, cost, title: kind === 'hive' ? `A hive at ${nameOf(state, key)}?` : 'A visitor', mark: '?',
      lines: ALIEN_LINES[kind], expires: n + 90 });
    return [{ kind: 'toast', kicker: 'Aliens', text: 'Something has come through a wormhole. It wants to talk.', who, tone: C.CULTURES.alien.color, key }];
  }
  // What accepting does: good or bad, from the visitor's whim.
  const GOOD = [['fold', 3], ['insight', 2], ['upgrade', 2], ['cache', 2], ['boost', 2]];
  const BAD = [['pull', 3], ['ships', 2], ['drain', 2], ['hive', 1]];
  function outcome(state, meta, o) {
    const rr = rnd(state, 0x0dd);
    if (o.alien === 'hive') {
      state.stations[o.key] = { type: 'hive', alien: true, level: 1, ships: 0, slots: 0, left: 0, total: 1, culture: 'alien', seed: (state.seq++ * 6007) % 99991 };
      return { kicker: 'Aliens', text: `A hive grows at ${nameOf(state, o.key)}. It gives science and volatiles, for now.`, tone: C.CULTURES.alien.color };
    }
    const good = rr() < (o.alien === 'fold' ? 0.62 : 0.6);
    const table = good ? GOOD.filter(([k]) => o.alien !== 'fold' || k === 'fold' || k === 'insight') : BAD.filter(([k]) => o.alien !== 'fold' || k === 'pull');
    const tot = table.reduce((t, [, x]) => t + x, 0);
    let x = rr() * tot, what = table[0][0];
    for (const [k, wt] of table) { x -= wt; if (x < 0) { what = k; break; } }
    const built = Object.entries(state.stations).filter(([, s]) => C.STATIONS[s.type] && !s.left);
    switch (what) {
      case 'fold': state.pull = Math.max(0, state.pull - 8); return { kicker: 'Space folded', text: 'The horizon falls back 8%.', tone: TONE.good };
      case 'insight': state.insightSys += 3; return { kicker: 'A gift', text: 'They leave a thought in every mind: +3 Insight at the jump.', tone: TONE.good };
      case 'upgrade': {
        const cand = built.filter(([, s]) => s.level < 3);
        if (!cand.length) { state.insightSys += 2; return { kicker: 'A gift', text: '+2 Insight at the jump.', tone: TONE.good }; }
        const [k, s] = pickOf(rr, cand);
        s.level++;
        return { kicker: 'A gift', text: `The ${C.STATIONS[s.type].name.toLowerCase()} at ${nameOf(state, k)} is changed overnight: Mk ${['', 'I', 'II', 'III'][s.level]}.`, tone: TONE.good, key: k };
      }
      case 'cache': state.res.m += 100; state.res.v += 100; return { kicker: 'A gift', text: '+100 minerals and volatiles, from nowhere.', tone: TONE.good };
      case 'boost': state.effects.boost = 60; return { kicker: 'A gift', text: 'Every station works half again as hard, for 60 cycles.', tone: TONE.good };
      case 'pull': state.pull = Math.min(99, state.pull + 6); return { kicker: 'Space folded', text: 'Wrong way. The horizon jumps 6% closer.', tone: TONE.bad, bad: true };
      case 'ships': { for (const [, s] of built) s.ships = Math.max(0, s.ships - 1); return { kicker: 'Taken', text: 'A ship is gone from every station. No one saw them leave.', tone: TONE.bad, bad: true }; }
      case 'drain': for (const r0 of ['m', 'v', 'cr']) state.res[r0] = Math.floor(state.res[r0] * 0.7); return { kicker: 'Taken', text: 'A third of our stores, gone.', tone: TONE.bad, bad: true };
      case 'hive': {
        if (!built.length) { state.pull = Math.min(99, state.pull + 4); return { kicker: 'Space folded', text: 'The horizon jumps 4% closer.', tone: TONE.bad, bad: true }; }
        const [k] = pickOf(rr, built);
        state.stations[k] = { type: 'hive', alien: true, level: 1, ships: 0, slots: 0, left: 0, total: 1, culture: 'alien', seed: (state.seq++ * 6007) % 99991 };
        return { kicker: 'Taken', text: `Our station at ${nameOf(state, k)} is a hive now.`, tone: TONE.bad, key: k, bad: true };
      }
      default: return null;
    }
  }

  // ---------- Hazards ----------
  function hazards(state) {
    const hz = C.HAZARDS[state.terms.hazard], n = Math.floor(state.cycle);
    if (!hz?.every || n < state.next.hazard) return [];
    state.next.hazard = n + hz.every;
    if (state.terms.hazard === 'ion') {
      state.effects.storm = hz.lasts;
      return [{ kind: 'toast', kicker: 'Ion storm', text: `Ships are dark for ${hz.lasts} cycles.`, tone: TONE.warn, bad: true }];
    }
    if (state.terms.hazard === 'pulsar') {
      const rr = rnd(state, 0x9175);
      const open = Object.entries(state.stations).filter(([k, s]) => C.STATIONS[s.type] && !s.left && !covered(state, k));
      if (!open.length) return [{ kind: 'toast', kicker: 'Pulsar', text: 'The pulse washes over the defenses. Nothing hit.', tone: TONE.good }];
      const [k, s] = pickOf(rr, open);
      s.off = hz.lasts;
      return [{ kind: 'toast', kicker: 'Pulsar', text: `The pulse knocks out the ${C.STATIONS[s.type].name.toLowerCase()} at ${nameOf(state, k)}.`, tone: TONE.bad, key: k, bad: true }];
    }
    return [];
  }

  // ---------- Each cycle ----------
  function cycle(state, meta) {
    const out = [];
    const n = Math.floor(state.cycle);
    // Requests: a new one now and then, while few are open.
    const open = state.offers.filter((o) => o.kind === 'request').length + state.requests.length;
    if (n >= state.next.request) {
      const r = rnd(state, 0x71);
      state.next.request = n + C.REQUESTS.every + Math.round((r() - 0.5) * 2 * C.REQUESTS.jitter);
      if (open < C.REQUESTS.open) {
        const q = newRequest(state, meta);
        if (q) {
          state.offers.push({ id: `o${state.seq++}`, kind: 'request', ...q, expires: n + 60, mark: '!' });
          out.push({ kind: 'toast', kicker: C.CULTURES[q.culture].name, text: `${q.who.name} has a request.`, who: q.who, tone: C.CULTURES[q.culture].color, key: q.key });
        }
      }
    }
    out.push(...drifters(state, meta), ...aliens(state, meta), ...hazards(state));
    // Offers left unanswered go away; a blockade's when it's over, a rogue station's when it's gone.
    for (const o of [...state.offers]) {
      const gone = (o.expires && n >= o.expires) || (o.kind === 'blockade' && !(state.stations[o.key]?.blocked > 0)) || (o.kind === 'rogue' && !state.stations[o.key]?.rogue);
      if (!gone) continue;
      state.offers.splice(state.offers.indexOf(o), 1);
      if (o.kind === 'request') shift(state, o.culture, -2);
    }
    // Requests taken on: done, or missed.
    for (const q of [...state.requests]) {
      if (doneOf(state, q)) {
        state.requests.splice(state.requests.indexOf(q), 1);
        give(state, q.reward, q.culture);
        out.push({ kind: 'toast', kicker: 'Request done', text: `${q.title}: ${rewardText(q.reward)}.`, who: q.who, tone: TONE.good, key: q.key });
      } else if (q.deadline && n >= q.deadline) {
        state.requests.splice(state.requests.indexOf(q), 1);
        shift(state, q.culture, C.REQUESTS.fail);
        out.push({ kind: 'toast', kicker: 'Request missed', text: `${q.title}. The ${C.CULTURES[q.culture].name} remember.`, who: q.who, tone: TONE.bad, key: q.key, bad: true });
      }
    }
    return out;
  }

  function tick(state, meta) {
    const out = [];
    if (!state || state.status !== 'play') return out;
    state.next.events ??= 0;
    while (state.next.events < Math.floor(state.cycle)) {
      state.next.events++;
      out.push(...cycle(state, meta));
    }
    return out;
  }

  // ---------- Answers ----------
  function answers(state, meta, id) {
    const o = state.offers.find((x) => x.id === id);
    if (!o) return [];
    if (o.kind === 'request') return [{ id: 'accept', label: 'Accept', ok: true, primary: true, pick: true }, { id: 'decline', label: 'Decline', ok: true }];
    const D = C.DRIFTERS;
    if (o.kind === 'blockade') {
      const p = patrols(state).length;
      return [
        { id: 'patrol', label: 'Send a patrol', ok: p > 0, why: p ? '' : 'No patrol free: a defense platform with a ship', primary: p > 0, pick: true },
        { id: 'bribe', label: 'Pay them off', ok: R.afford(state, D.bribe), cost: D.bribe, why: 'Not enough credits', pick: true },
        { id: 'wait', label: 'Wait it out', ok: true },
      ];
    }
    if (o.kind === 'rogue') {
      const r = state.rates, need = r.demand + D.evictSec;
      const can = r.sec >= need && R.afford(state, D.evict);
      return [
        { id: 'evict', label: 'Evict them', ok: can, cost: D.evict, why: `Needs ${need.toFixed(1)} security (have ${r.sec.toFixed(1)}) and minerals`, primary: can, pick: true },
        { id: 'parley', label: 'Let them stay', ok: true, warn: true },
      ];
    }
    if (o.kind === 'alien') {
      const lab = Object.values(state.stations).some((s) => s.type === 'lab' && !s.left);
      return [
        { id: 'accept', label: o.alien === 'hive' ? 'Let it grow' : 'Accept', ok: !o.cost || R.afford(state, o.cost), cost: o.cost, primary: true, why: 'Not enough to give' },
        o.alien === 'hive' ? null : { id: 'study', label: 'Study them', ok: lab, why: 'Needs a research lab', pick: true },
        { id: 'refuse', label: 'Refuse', ok: true, pick: o.alien === 'hive' },
      ].filter(Boolean);
    }
    return [];
  }
  function answer(state, meta, id, a) {
    const o = state.offers.find((x) => x.id === id);
    if (!o || !answers(state, meta, id).some((x) => x.id === a && x.ok)) return null;
    state.offers.splice(state.offers.indexOf(o), 1);
    if (o.kind === 'request') {
      if (a === 'accept') {
        const { expires, mark, ...q } = o; // eslint-disable-line no-unused-vars
        if (q.deadline) q.deadline = state.cycle + C.REQUESTS.deadline;
        state.requests.push(q);
        return { kicker: 'Accepted', text: q.title, who: o.who, tone: C.CULTURES[o.culture].color, key: o.key };
      }
      shift(state, o.culture, -3);
      return { kicker: 'Declined', text: `${o.who.name} won't forget it.`, who: o.who, tone: TONE.warn };
    }
    const D = C.DRIFTERS, st = state.stations[o.key];
    if (o.kind === 'blockade') {
      if (a === 'wait') { state.offers.push(o); return null; }
      if (a === 'bribe') { for (const [r0, n] of Object.entries(D.bribe)) state.res[r0] -= n; shift(state, 'wedge', -4); }
      if (st) st.blocked = 0;
      return { kicker: 'Blockade lifted', text: a === 'patrol' ? 'The patrol scatters them.' : 'They take the credits and go. The Wedge are not impressed.', who: o.who, tone: TONE.good, key: o.key };
    }
    if (o.kind === 'rogue') {
      if (!st) return null;
      if (a === 'evict') {
        for (const [r0, n] of Object.entries(D.evict)) state.res[r0] -= n;
        state.stations[o.key] = { type: 'wreck', wreck: true, level: 1, ships: 0, slots: 0, left: 0, total: 1, culture: 'drifters', seed: st.seed };
        shift(state, 'wedge', 6);
        return { kicker: 'Evicted', text: `The Drifters are gone from ${nameOf(state, o.key)}. Their station is a wreck.`, who: o.who, tone: TONE.good, key: o.key };
      }
      Object.assign(st, { type: 'outpost', rogue: false, outpost: true, left: 0 });
      shift(state, 'wedge', D.outpostApproval);
      return { kicker: 'Outpost', text: `The Drifters at ${nameOf(state, o.key)} pay their way now. The Wedge are furious.`, who: o.who, tone: TONE.warn, key: o.key };
    }
    if (o.kind === 'alien') {
      if (a === 'refuse') return { kicker: 'Refused', text: 'It leaves the way it came.', who: o.who, tone: C.CULTURES.alien.color };
      if (a === 'study') { state.res.sci += 20 + 5 * state.depth; return { kicker: 'Studied', text: `The lab learns what it can: +${20 + 5 * state.depth} science.`, who: o.who, tone: C.CULTURES.shard.color }; }
      if (o.cost) for (const [r0, n] of Object.entries(o.cost)) state.res[r0] -= n;
      const res = outcome(state, meta, o);
      state.rates = R.rates(state, meta);
      return res && { ...res, who: o.who };
    }
    return null;
  }

  return { tick, answers, answer, progress, rewardText, leader, covered };
})();

export { SimEvents };
