// What the HUD's status icons say about each meter (game/hud.js drawStatus, notes/hazards.md):
// the hazards (heat, radiation) are timers, so their icon shows which way the meter is going and
// how fast, and near the end the seconds left; fuel is a budget, so its icon shows what it buys
// (the dashes left; on a surface, against the take-off cost).
// The rate comes from the meter itself, smoothed over a short window, so it reads the same in
// space and on a surface whatever fills it.
//
//   Status.config                           { window (s), fast, still (a share of the max a second), timer (s) }
//   Status.smooth(rate, delta, dt) -> rate  the rate a second, eased toward delta / dt
//   Status.trend(rate, max) -> 'up2' | 'up' | 'flat' | 'down'
//   Status.eta(level, max, rate) -> seconds until it's full, or null while it isn't rising
//   Status.timerShown(eta) -> whether the countdown takes the trend's place
//   Status.dashesLeft(fuel, cost) -> how many dashes the tank holds
// ES module (`Status`); also runs in Node (the tests).

const Status = (() => {
  const config = { window: 0.5, fast: 0.04, still: 0.002, timer: 20 };

  const smooth = (rate, delta, dt) => (dt > 0 ? rate + (delta / dt - rate) * (1 - Math.exp(-dt / config.window)) : rate);
  function trend(rate, max) {
    const r = rate / max;
    if (r >= config.fast) return 'up2';
    if (r > config.still) return 'up';
    if (r < -config.still) return 'down';
    return 'flat';
  }
  const eta = (level, max, rate) => (rate / max > config.still && level < max ? (max - level) / rate : null);
  const timerShown = (s) => s !== null && s <= config.timer;
  const dashesLeft = (fuel, cost) => (cost > 0 ? Math.max(0, Math.floor((fuel + 1e-6) / cost)) : 0);

  return { config, smooth, trend, eta, timerShown, dashesLeft };
})();

export { Status };
