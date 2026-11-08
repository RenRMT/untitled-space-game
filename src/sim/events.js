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
    // Offers left unanswered go away.
    for (const o of [...state.offers]) if (o.expires && n >= o.expires) { state.offers.splice(state.offers.indexOf(o), 1); if (o.kind === 'request') shift(state, o.culture, -2); }
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
    return null;
  }

  return { tick, answers, answer, progress, rewardText, leader };
})();

export { SimEvents };
