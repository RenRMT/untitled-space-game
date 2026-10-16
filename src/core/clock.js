// The real-world clock: milliseconds since the epoch. Research (rules/research.js) runs on it, so
// it goes on while the game is closed. The tests replace Clock.now to move time along.
// ES module (`Clock`); also runs in Node.

const Clock = { now: () => Date.now() };

export { Clock };
