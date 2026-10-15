'use strict';

// The introduction: an escape pod drifting near Waystation HD-1863 (the android-run station on
// the first system's outer edge) is talked in by the station. Its diagnostic questions set the
// art style, the movement mode and the combat mode; between them the pod flies itself to the
// station (a first lesson in flying), where a tractor beam takes it in to dock.
//
// The script is a list of steps, run in order:
//   { say }                          a line from the station (**bold** marks emphasis)
//   { say, ask, options, portraits } a question: each option { label, value, reply? } sets the
//                                    setting `ask` ('style' | 'move' | 'combat') to its value,
//                                    and its reply, if any, is the next line. portraits: show
//                                    each option with the station's portrait in that art style
//   { wait }                         something the flight view does: 'approach' (fly the pod
//                                    into the tractor beam's reach), 'docked' (the beam brings
//                                    it in and it docks)
//
//   const run = Intro.create(onChoice)    onChoice(setting, value) for each answer
//   run.step                              the current step, or null once the script is done
//   run.next()                            past a line
//   run.choose(i)                         answer the current question with option i
//   run.signal(name)                      the flight view did what a wait step waits for
//   run.answers                           { style, move, combat } as answered so far
//   run.portrait                          whether lines show the station's portrait (they do
//                                         once the art style has been picked)
// Works as a classic browser script (global `Intro`) and as a Node module.

const Intro = (() => {
  const STATION = 'Waystation HD-1863';

  const SCRIPT = [
    { say: 'This is Waystation HD-1863 to approaching escape pod. You are entering a safe zone.' },
    { say: 'It has been **793** solar cycles since we received a visitor. Please answer these diagnostic questions so we can proceed with your safe retrieval.' },
    {
      say: 'Diagnostic one: please confirm visual functions.', ask: 'style', portraits: true,
      options: [
        { label: 'Looks bright', value: 'line' },
        { label: 'Looks blocky', value: 'pixel' },
        { label: 'Looks flat', value: 'flat' },
        { label: 'Looks sharp', value: 'lowpoly' },
      ],
    },
    { say: 'Must be a pre-existing condition. The Waystation cannot be held liable.' },
    {
      say: 'Diagnostic two. Please describe how your pod responds when you stop pressing the thruster controls.', ask: 'move',
      options: [
        { label: 'It keeps drifting', value: 'cruise', reply: 'Inertial navigation. A classic. Please plan your stops in advance.' },
        { label: 'It stops right away', value: 'direct', reply: 'Inertial dampeners. Responsive. Expensive. We will add that to your file.' },
      ],
    },
    { say: 'We will proceed with your safe retrieval.' },
    { say: 'As a not-for-profit station we only ask reimbursement of resources spent.' },
    { say: 'This is estimated to be equal to 12 bars of gold.' },
    { say: '...' },
    { say: 'I guess you can also pay in kind.' },
    { say: 'To reduce costs, please use your own thrusters to approach the Waystation.' },
    { wait: 'approach' },
    { say: 'Security scan in progress.' },
    { say: 'A weapon system has been detected. Safe zone regulations require all weapons to be registered.' },
    {
      say: 'Please confirm your targeting protocol.', ask: 'combat',
      options: [
        { label: 'Manual targeting', value: 'realtime', reply: 'Real-time engagement registered. Please do not practice on the station.' },
        { label: 'Tactical computer', value: 'rounds', reply: 'Turn-based engagement registered. Taking turns. Very civilized.' },
      ],
    },
    { say: 'Registration complete. Welcome to Waystation HD-1863.' },
    { wait: 'docked' },
  ];

  function create(onChoice = () => {}) {
    let i = 0;
    let reply = null; // the answer's reply, shown before the script goes on
    const answers = {};
    return {
      get step() { return reply || SCRIPT[i] || null; },
      get answers() { return answers; },
      get portrait() { return 'style' in answers; },
      next() {
        if (reply) reply = null;
        else if (SCRIPT[i] && SCRIPT[i].say && !SCRIPT[i].ask) i++;
      },
      choose(k) {
        const s = SCRIPT[i];
        if (reply || !s || !s.ask || !s.options[k]) return;
        const o = s.options[k];
        answers[s.ask] = o.value;
        i++;
        if (o.reply) reply = { say: o.reply };
        onChoice(s.ask, o.value);
      },
      signal(name) {
        if (!reply && SCRIPT[i] && SCRIPT[i].wait === name) i++;
      },
    };
  }

  // A line split into plain and **bold** runs: [{ text, bold }].
  const runs = (text) => text.split(/\*\*/).map((t, k) => ({ text: t, bold: k % 2 === 1 })).filter((r) => r.text);

  return { STATION, SCRIPT, create, runs };
})();

if (typeof module !== 'undefined') module.exports = Intro;
