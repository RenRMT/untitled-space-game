// The real-world clock: milliseconds since the epoch. Markets drifting back to rest, the day's
// contracts and stock, and the elites' and raids' timers run on it, so they go on while the game is
// closed. The tests replace Clock.now to move time along.
// ES module (`Clock`); also runs in Node.

const Clock = { now: () => Date.now() };

export { Clock };
