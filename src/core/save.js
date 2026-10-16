// Saving: a writer that waits, so a burst of changes is one write, and bringing a save made by an
// older version of the game up to date.
//
//   const w = Save.debounced(write, ms)   one writer per save
//     w.change()       something changed: write `ms` after the first change since the last write
//     w.flush()        write now if a change is waiting (before switching to another save)
//     w.now()          write now, changed or not (the page being hidden or closed)
//   Save.migrate(data, steps) -> data
//     data.version (0 for saves from before versions) is taken through steps[version], ...: each
//     step changes the data in place to the next version's form. The result has version steps.length.
// ES module (`Save`); also runs in Node (the tests).

const Save = (() => {
  function debounced(write, ms = 1000) {
    let timer = null;
    const now = () => {
      clearTimeout(timer);
      timer = null;
      write();
    };
    return {
      change() { if (timer === null) timer = setTimeout(now, ms); },
      flush() { if (timer !== null) now(); },
      now,
      get pending() { return timer !== null; },
    };
  }

  function migrate(data, steps) {
    const from = Number.isInteger(data.version) ? data.version : 0;
    for (let v = from; v < steps.length; v++) steps[v](data);
    data.version = Math.max(from, steps.length);
    return data;
  }

  return { debounced, migrate };
})();

export { Save };
