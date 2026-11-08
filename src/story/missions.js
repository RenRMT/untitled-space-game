// Missions: the log of the work stations give the player (the galaxy's jobs, story/jobs.js),
// offered and handed in on the station screen's Missions tab (ui/station.js), carried out in
// flight (game/jobs.js).
//
// A mission's data (story/jobs.js makes them):
//   { id, title, giver, briefing: [lines], reward, objectives: [objective], ... }
//   objective: { id, label, need? (a count, default 1), after?: [objective ids that come first],
//                hidden? (tracked, never listed), secret? (listed only once it's open),
//                percent? (its count shown as a percentage) }
// Lines and labels may name {things} (fill()); a line may be { text, if | unless: objective id },
// shown only when that objective is (or isn't) done (lines()), or a question, { text, ask: a
// setting, options: [{ label, value, reply? }] }, whose answer sets that setting.
// Each mission is offered, then active once accepted, ready once every objective is done, and
// done once handed in to its giver.
//
//   const log = Missions.create(saved?, jobs?)   saved: what log.save() gave; jobs: { [id]: job } (story/jobs.js)
//   log.status(id)                         'offered' | 'active' | 'ready' | 'done'
//   log.accept(id, at?), log.complete(id)  offered -> active (at: the station key), ready -> done (false if not)
//   log.finish(id)                         straight to done
//   log.abandon(id)                        a job under way back to offered, its progress gone
//   log.reopen(id)                         a job done offered again (a contract the next day)
//   log.at(id), log.attempt(id), log.ids() where it was accepted, how many times, every id with a state
//   log.count(id, obj), log.done(id, obj)  progress on an objective, and whether it's met
//   log.set(id, obj, n)                    progress made (while active or ready: ready once every
//                                          objective is met, active again if one no longer is); true if it changed
//   log.open(id, obj)                      its `after` objectives are done
//   log.objectives(id)                     the listed ones (not hidden; secret ones once open):
//                                          [{ id, label, need, count, done, open }]
//   log.current(id)                        the first listed objective open and not done, or null
//   log.save()                             plain data, for the cargo save
//   Missions.fill(text, vars), Missions.lines(list, log, id)
// ES module (`Missions`); also runs in Node (the tests).

import { clamp } from '../core/math.js';

const Missions = (() => {
  const STATUSES = ['offered', 'active', 'ready', 'done'];
  const need = (o) => o.need || 1;

  // saved: what log.save() gave; jobs: the galaxy's generated missions by id (story/jobs.js).
  function create(saved, jobs = {}) {
    const def = (id) => jobs[id];
    // id -> { status, progress: { [objective id]: count }, at?: the station key it was accepted at,
    //   n?: how many times it has been accepted (a job's things in space are keyed by it) }
    const state = {};
    if (saved && typeof saved === 'object') {
      for (const [id, s] of Object.entries(saved)) {
        if (!def(id) || !s || !STATUSES.includes(s.status)) continue;
        const progress = {};
        for (const [o, n] of Object.entries(s.progress || {})) {
          const obj = def(id).byId[o];
          if (obj && Number.isFinite(n) && n > 0) progress[o] = Math.min(need(obj), Math.floor(n));
        }
        state[id] = { status: s.status, progress };
        if (typeof s.at === 'string') state[id].at = s.at;
        if (Number.isInteger(s.n) && s.n > 0) state[id].n = s.n;
      }
    }
    const status = (id) => (state[id] ? state[id].status : 'offered');
    const count = (id, o) => (state[id] && state[id].progress[o]) || 0;
    const done = (id, o) => status(id) === 'done' || count(id, o) >= need(def(id).byId[o]);
    const open = (id, o) => (def(id).byId[o].after || []).every((a) => done(id, a));

    // Progress counts while a mission is under way, and may go down again (a job's goods sold
    // before they're handed in): ready once every objective is met, back to active if one isn't.
    function set(id, o, n) {
      const obj = def(id) && def(id).byId[o];
      if (!obj || !['active', 'ready'].includes(status(id))) return false;
      const v = clamp(Math.floor(n), 0, need(obj));
      if (v === count(id, o)) return false;
      if (v) state[id].progress[o] = v; else delete state[id].progress[o];
      state[id].status = def(id).objectives.every((x) => done(id, x.id)) ? 'ready' : 'active';
      return true;
    }

    function objectives(id) {
      return def(id).objectives.filter((o) => !o.hidden && (!o.secret || open(id, o.id)))
        .map((o) => ({ id: o.id, label: o.label, need: need(o), count: count(id, o.id), done: done(id, o.id), open: open(id, o.id), percent: !!o.percent }));
    }

    return {
      status,
      // at: where it was accepted (a job is handed in there, unless it names another station).
      accept(id, at) {
        if (!def(id) || status(id) !== 'offered') return false;
        state[id] = { status: 'active', progress: {}, n: ((state[id] && state[id].n) || 0) + 1 };
        if (at) state[id].at = at;
        return true;
      },
      complete(id) {
        if (status(id) !== 'ready') return false;
        state[id].status = 'done';
        return true;
      },
      finish(id) {
        if (!def(id)) return false;
        state[id] = { ...state[id], status: 'done', progress: state[id] ? state[id].progress : {} };
        return true;
      },
      // A job done, offered again (a repeatable contract): its next attempt starts afresh.
      reopen(id) {
        if (!jobs[id] || status(id) !== 'done') return false;
        state[id] = { status: 'offered', progress: {}, n: state[id].n };
        return true;
      },
      // A job given up: offered again, its progress gone.
      abandon(id) {
        if (!jobs[id] || !['active', 'ready'].includes(status(id))) return false;
        state[id] = { status: 'offered', progress: {}, n: state[id].n };
        return true;
      },
      at: (id) => (state[id] && state[id].at) || null,
      attempt: (id) => (state[id] && state[id].n) || 0,
      ids: () => Object.keys(state),
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

  return { STATUSES, create, fill, lines };
})();

export { Missions };
