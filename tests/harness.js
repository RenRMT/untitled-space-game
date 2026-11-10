// What the Node test files share (tests/game.js, race.js, idle.js, 4x.js): a test is a name and a
// function that throws when something is wrong. A file ends with finish(), which says how it went
// and marks the process as failed without ending it, so tests/run.js can run them one after another.
//
//   test(name, fn)           ONLY=text (an environment variable) runs just the tests whose names include it
//   off(flag, name, fn)      a test of something the game has switched off for now, marked so in the output
//   finish(label)            the file's result; the process exits 1 if any test in any file failed

let failed = 0;
export function test(name, fn) {
  if (process.env.ONLY && !name.includes(process.env.ONLY)) return;
  const t0 = Date.now();
  try {
    fn();
    console.log(`ok   ${name} (${Date.now() - t0} ms)`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${name}\n     ${e.stack.split('\n').slice(0, 3).join('\n     ')}`);
  }
}

// Tests of what the game has switched off for now (notes/hazards.md, notes/archived-systems.md):
// pirates and fights with ships (?pirates), the introduction (?intro), the opening missions and
// the squad they bring (?missions), and the jobs board's machinery. Kept so those still work when
// they come back, and marked in the output so what guards the game as it ships is plain to see.
export const off = (flag, name, fn) => test(`[off: ${flag}] ${name}`, fn);

export function finish(label) {
  console.log(failed ? `\n${failed} ${label} test(s) failed` : `\nall ${label} tests passed`);
  if (failed) process.exitCode = 1;
  failed = 0;
}
