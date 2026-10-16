// Numbers as the player reads them.
//   Format.dist(d)   a distance in world units, in thousands: '1.2k', '340k' (never below 0)
// ES module (`Format`); also runs in Node (the tests).

const Format = {
  dist(d) {
    const k = Math.max(0, d) / 1000;
    return k >= 100 ? `${Math.round(k)}k` : `${k.toFixed(1)}k`;
  },
};

export { Format };
