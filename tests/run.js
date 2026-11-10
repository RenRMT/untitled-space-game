// Every game's Node checks, one file after another: `node tests/run.js`. No dependencies.
// Each file also runs on its own (`node tests/game.js`, `npm run test:game`): the main game's rules,
// world and flight (game.js), the race (race.js), the idle game (idle.js) and the 4X game (4x.js).
// tests/harness.js is what they share. The games played through, in a stand-in browser, are the
// smoke tests (smoke-default.js, smoke.js) and tests/sim.js.

import './game.js';
import './race.js';
import './idle.js';
import './4x.js';

console.log(process.exitCode ? '\nsome tests failed' : '\nall tests passed');
