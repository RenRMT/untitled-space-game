// AI logic: the programs squad members (rules/squad.js) run, gambit style. A program is a list of
// lines, each one rule written like a line of code:
//
//   if enemy.hull < 30% and not enemy.isLeaderTarget → attack(nearest(enemy))
//
// A squad member runs its program top down whenever it decides what to do, and carries out the
// first line that holds; if none does, it keeps formation with its leader. A line has a subject
// (enemy, ally, self or leader) whose candidates are tried in its pick order (any, nearest,
// weakest, strongest); conditions about that candidate, or about self, the leader or the fight,
// joined by and / or (and binds tighter) and negated with not; and an action. Every building
// block belongs to a package (`pkg`), which research unlocks (rules/research.js); 'core' is always
// known. Logic only decides: abilities a ship can `use` come from elsewhere (its gear, later).
//
//   A line: { on, subject, pick, when: [clause], act, skill }
//     clause: { join: null | 'and' | 'or', not, of: null | 'self' | 'leader' | 'fight', prop, rel, value }
//       of: what the clause is about (null: the line's subject)
//   Logic.SUBJECTS, PICKS, PROPS, RELS, KEYWORDS, ACTIONS   the building blocks, each { label, pkg, ... }
//   Logic.PRESETS[id] -> a line              ready-made lines ('assist.leader': the first module)
//   Logic.copy(line), Logic.blank(), Logic.clause(o)   a line to change, a new line, a new condition
//   Logic.check(line, known) -> { ok, errors: [text] }      known: a Set of package ids
//   Logic.read(saved, known) -> line         a saved line, cleaned; one that fails check is kept, off,
//                                            with its first error in `err`
//   Logic.decide(program, ctx, limit) -> { line: index | -1, intent }
//   Logic.tokens(line) -> [{ t, text }]      the line as code: t is kw | subj | prop | op | num | fn |
//                                            punc | ws | err; Logic.text(line) joins them
//   Logic.blocks(pkg) -> [{ kind, id, label }]   what a package gives
// ctx: what a squad member knows when it decides: { self, leader, enemies: the enemies still
//   flying, allies: the other squad members still flying, leaderTarget: the enemy id the leader is
//   fighting or null, dist(a, b), targetOf(enemy) -> the id it shoots at, ready(skill, target) }.
//   A combatant: { id, hull, shield, stats: { hull, shield, name, weapons }, x?, y? }.
// Intents: { type: 'follow' }, { type: 'attack', target, keep? }, { type: 'guard', ward },
//   { type: 'retreat' }, { type: 'use', skill, target }.
// ES module (`Logic`); also runs in Node (the tests).

const Logic = (() => {
  const MAX_CLAUSES = 4;

  const SUBJECTS = {
    enemy: { label: 'enemy', pkg: 'core', many: true },
    self: { label: 'self', pkg: 'core' },
    leader: { label: 'leader', pkg: 'core' },
    ally: { label: 'ally', pkg: 'squad.link', many: true },
  };
  // The order a subject's candidates are tried in (only for enemy and ally: there's one self).
  const total = (c) => Math.max(0, c.hull) + Math.max(0, c.shield || 0);
  const PICKS = {
    any: { label: 'any', pkg: 'core', sort: null },
    nearest: { label: 'nearest', pkg: 'combat.select', sort: (a, b, ctx) => ctx.dist(ctx.self, a) - ctx.dist(ctx.self, b) },
    weakest: { label: 'weakest', pkg: 'combat.select', sort: (a, b) => total(a) - total(b) },
    strongest: { label: 'strongest', pkg: 'combat.select', sort: (a, b) => total(b) - total(a) },
  };

  const pct = (v, max) => (max > 0 ? (100 * v) / max : 0);
  const CMP = ['<', '<=', '>', '>=', '=='];
  const EQ = ['==', '!='];
  // Properties a clause tests. kind: flag (true or not), flagArg (true or not, of an argument
  // from `values`), cmp (a number against a value, by rel), enum (one of `values`, == or !=).
  // of: the subjects it can be about ('fight' for the fight as a whole).
  const PROPS = {
    isLeaderTarget: { kind: 'flag', of: ['enemy'], pkg: 'core', note: 'the enemy the leader is fighting', get: (c, ctx) => c.id === ctx.leaderTarget },
    hull: { kind: 'cmp', of: ['enemy', 'ally', 'self', 'leader'], pkg: 'maint.sense', unit: '%', values: [10, 20, 30, 50, 70, 90, 100], note: 'hull left, %', get: (c) => pct(c.hull, c.stats.hull) },
    shield: { kind: 'cmp', of: ['enemy', 'ally', 'self', 'leader'], pkg: 'maint.sense', unit: '%', values: [0, 10, 30, 50, 70, 100], note: 'shield left, %', get: (c) => pct(c.shield || 0, c.stats.shield) },
    distance: { kind: 'cmp', of: ['enemy', 'ally', 'leader'], pkg: 'combat.range', unit: '', values: [200, 400, 600, 900, 1200], note: 'how far from self', get: (c, ctx) => ctx.dist(ctx.self, c) },
    targeting: {
      kind: 'flagArg', of: ['enemy'], pkg: 'combat.threat', values: ['self', 'leader', 'ally'], note: 'whom the enemy is shooting at',
      get: (c, ctx, v) => {
        const at = ctx.targetOf(c);
        return v === 'self' ? at === ctx.self.id : v === 'leader' ? at === ctx.leader.id : ctx.allies.some((a) => a.id === at);
      },
    },
    class: { kind: 'enum', of: ['enemy'], pkg: 'combat.focus', values: ['fighter', 'freighter'], note: 'what kind of ship', get: (c) => String(c.stats.name || '').toLowerCase() },
    enemies: { kind: 'cmp', of: ['fight'], pkg: 'tactics.count', unit: '', values: [1, 2, 3, 4, 5], note: 'enemies still flying', get: (c, ctx) => ctx.enemies.length },
    allies: { kind: 'cmp', of: ['fight'], pkg: 'tactics.count', unit: '', values: [1, 2, 3, 4, 5], note: 'squad members flying, self included', get: (c, ctx) => ctx.allies.length + 1 },
  };
  const RELS = { '<': (a, b) => a < b, '<=': (a, b) => a <= b, '>': (a, b) => a > b, '>=': (a, b) => a >= b, '==': (a, b) => a === b, '!=': (a, b) => a !== b };
  for (const p of Object.values(PROPS)) p.rels = p.kind === 'cmp' ? CMP : p.kind === 'enum' ? EQ : [];
  const KEYWORDS = {
    and: { label: 'and', pkg: 'core.bool' },
    not: { label: 'not', pkg: 'core.bool' },
    or: { label: 'or', pkg: 'core.bool.or' },
  };
  // Actions. on: the subjects it can take (any: whatever the line is about); target: whether the
  // subject is its argument.
  const ACTIONS = {
    attack: { label: 'attack', pkg: 'core', on: ['enemy'], target: true, note: 'fire on it', intent: (c) => ({ type: 'attack', target: c.id }) },
    follow: { label: 'follow', pkg: 'core', on: null, note: 'keep formation', intent: () => ({ type: 'follow' }) },
    keepRange: { label: 'keepRange', pkg: 'combat.range', on: ['enemy'], target: true, note: 'fire on it from as far as the guns reach', intent: (c) => ({ type: 'attack', target: c.id, keep: true }) },
    guard: { label: 'guard', pkg: 'maint.guard', on: ['ally', 'leader'], target: true, note: 'stay close and fire on whoever shoots at it', intent: (c) => ({ type: 'guard', ward: c.id }) },
    retreat: { label: 'retreat', pkg: 'maint.retreat', on: null, note: 'fall back beside the leader and hold fire', intent: () => ({ type: 'retreat' }) },
    use: { label: 'use', pkg: 'tactics.use', on: null, target: true, note: 'use an ability the ship has', intent: (c, line) => ({ type: 'use', skill: line.skill, target: c.id }) },
  };
  for (const B of [SUBJECTS, PICKS, PROPS, KEYWORDS, ACTIONS]) for (const [id, b] of Object.entries(B)) b.id = id;

  const PRESETS = {
    'assist.leader': { on: true, subject: 'enemy', pick: 'any', when: [{ join: null, not: false, of: null, prop: 'isLeaderTarget', rel: null, value: null }], act: 'attack', skill: null },
  };

  const knows = (known, pkg) => pkg === 'core' || !!known?.has(pkg);
  const FOLLOW = { type: 'follow' };

  const copy = (line) => JSON.parse(JSON.stringify(line));
  // A blank line to start from: attack any enemy.
  const blank = () => ({ on: true, subject: 'enemy', pick: 'any', when: [], act: 'attack', skill: null });
  const clause = (o = {}) => ({ join: null, not: false, of: null, prop: 'isLeaderTarget', rel: null, value: null, ...o });

  function check(line, known) {
    const errors = [];
    const need = (b, what) => {
      if (!b) { errors.push(`unknown ${what}`); return false; }
      if (!knows(known, b.pkg)) { errors.push(`${b.label || b.id} needs import ${b.pkg}`); return false; }
      return true;
    };
    const subject = SUBJECTS[line?.subject];
    if (!need(subject, 'subject')) return { ok: false, errors };
    const pick = PICKS[line.pick];
    if (need(pick, 'pick') && line.pick !== 'any' && !subject.many) errors.push(`${line.subject} has nothing to pick from`);
    const when = Array.isArray(line.when) ? line.when : [];
    if (when.length > MAX_CLAUSES) errors.push(`at most ${MAX_CLAUSES} conditions`);
    when.forEach((c, i) => {
      if (i === 0 ? c.join !== null : !KEYWORDS[c.join] || c.join === 'not') errors.push(`condition ${i + 1}: needs and / or`);
      else if (i > 0) need(KEYWORDS[c.join], 'keyword');
      if (c.not) need(KEYWORDS.not, 'keyword');
      const p = PROPS[c.prop];
      if (!need(p, 'property')) return;
      const about = c.of || line.subject;
      if (c.of && !['self', 'leader', 'fight'].includes(c.of)) errors.push(`condition ${i + 1}: unknown subject ${c.of}`);
      else if (!p.of.includes(about)) errors.push(`${about}.${c.prop} isn't a thing`);
      if (p.rels.length ? !p.rels.includes(c.rel) : c.rel !== null) errors.push(`condition ${i + 1}: bad operator`);
      if (p.values ? !p.values.includes(c.value) : c.value !== null) errors.push(`condition ${i + 1}: bad value`);
    });
    const act = ACTIONS[line.act];
    if (need(act, 'action')) {
      if (act.on && !act.on.includes(line.subject)) errors.push(`${line.act}() can't take ${line.subject}`);
      if (line.act === 'use' ? typeof line.skill !== 'string' || !line.skill : line.skill !== null) errors.push('bad ability');
    }
    return { ok: !errors.length, errors };
  }

  const str = (v, fallback = null) => (typeof v === 'string' ? v : fallback);
  function read(saved, known) {
    const d = saved && typeof saved === 'object' ? saved : {};
    const line = {
      on: d.on !== false, subject: str(d.subject, 'enemy'), pick: str(d.pick, 'any'),
      when: (Array.isArray(d.when) ? d.when : []).filter((c) => c && typeof c === 'object').map((c) => ({
        join: str(c.join), not: !!c.not, of: str(c.of), prop: str(c.prop, ''), rel: str(c.rel),
        value: Number.isFinite(c.value) || typeof c.value === 'string' ? c.value : null,
      })),
      act: str(d.act, 'follow'), skill: str(d.skill),
    };
    const { ok, errors } = check(line, known);
    if (!ok) { line.on = false; line.err = errors[0]; }
    return line;
  }

  function holds(when, c, ctx) {
    // and binds tighter than or: true when every clause of some or-group holds.
    let group = true;
    for (let i = 0; i < when.length; i++) {
      const w = when[i];
      if (w.join === 'or') { if (group) return true; group = true; }
      if (!group) continue;
      const p = PROPS[w.prop];
      const about = w.of === 'self' ? ctx.self : w.of === 'leader' ? ctx.leader : c;
      let v;
      if (p.kind === 'flag') v = !!p.get(about, ctx);
      else if (p.kind === 'flagArg') v = !!p.get(about, ctx, w.value);
      else v = RELS[w.rel](p.get(about, ctx), w.value);
      if (w.not) v = !v;
      group = v;
    }
    return group;
  }

  function candidates(line, ctx) {
    const list = line.subject === 'enemy' ? ctx.enemies : line.subject === 'ally' ? ctx.allies
      : line.subject === 'self' ? [ctx.self] : [ctx.leader];
    const sort = PICKS[line.pick]?.sort;
    return sort ? list.slice().sort((a, b) => sort(a, b, ctx)) : list;
  }

  function decide(program, ctx, limit = Infinity) {
    const n = Math.min(program.length, limit);
    for (let i = 0; i < n; i++) {
      const line = program[i];
      if (!line || !line.on || line.err) continue;
      const act = ACTIONS[line.act];
      for (const c of candidates(line, ctx)) {
        if (!c || !holds(line.when, c, ctx)) continue;
        if (line.act === 'use' && !ctx.ready?.(line.skill, c)) continue; // not ready: on to the next
        return { line: i, intent: act.intent(c, line) };
      }
    }
    return { line: -1, intent: FOLLOW };
  }

  // ---------- The line as code ----------

  const tok = (t, text) => ({ t, text });
  const WS = tok('ws', ' ');
  function subjectTokens(line) {
    const s = SUBJECTS[line.subject] ? tok('subj', line.subject) : tok('err', String(line.subject));
    return line.pick && line.pick !== 'any' ? [tok('fn', line.pick), tok('punc', '('), s, tok('punc', ')')] : [s];
  }
  function clauseTokens(c, line) {
    const p = PROPS[c.prop];
    const about = c.of || line.subject;
    const head = [tok('subj', about), tok('punc', '.'), p ? tok('prop', c.prop) : tok('err', c.prop || '?')];
    if (!p) return head;
    if (p.kind === 'flag') return head;
    if (p.kind === 'flagArg') return [...head, tok('punc', '('), tok('num', String(c.value)), tok('punc', ')')];
    return [...head, WS, tok('op', c.rel || '?'), WS, tok('num', `${c.value}${p.unit || ''}`)];
  }
  function tokens(line) {
    const out = [tok('kw', 'if'), WS];
    if (!line.when.length) out.push(tok('kw', 'true'));
    line.when.forEach((c, i) => {
      if (i) out.push(WS, tok('kw', c.join || '?'), WS);
      if (c.not) out.push(tok('kw', 'not'), WS);
      out.push(...clauseTokens(c, line));
    });
    out.push(WS, tok('op', '→'), WS);
    const act = ACTIONS[line.act];
    out.push(act ? tok('fn', line.act) : tok('err', String(line.act)), tok('punc', '('));
    if (line.act === 'use') out.push(tok('num', line.skill || '?'), tok('punc', ','), WS, ...subjectTokens(line));
    else if (line.act === 'follow') out.push(tok('subj', 'leader'));
    else if (act?.target) out.push(...subjectTokens(line));
    out.push(tok('punc', ')'));
    return out;
  }
  const text = (line) => tokens(line).map((x) => x.text).join('');

  // What a package gives: every block tagged with it.
  function blocks(pkg) {
    const out = [];
    const add = (kind, B, label) => { for (const b of Object.values(B)) if (b.pkg === pkg) out.push({ kind, id: b.id, label: label(b) }); };
    add('subject', SUBJECTS, (b) => b.id);
    add('pick', PICKS, (b) => `${b.id}(…)`);
    add('prop', PROPS, (b) => (b.of[0] === 'fight' ? `fight.${b.id}` : `.${b.id}`));
    add('keyword', KEYWORDS, (b) => b.id);
    add('action', ACTIONS, (b) => `${b.id}()`);
    return out;
  }

  return { MAX_CLAUSES, SUBJECTS, PICKS, PROPS, RELS, KEYWORDS, ACTIONS, PRESETS, knows, copy, blank, clause, check, read, decide, tokens, text, blocks };
})();

export { Logic };
