// Feedback: game events the player should feel or hear, named once and sent from where they happen,
// so what answers them (vibration now, sound later) is wired in one place instead of in every system.
// Listeners get (event, detail); nothing listening is fine.
//
//   Feedback.emit(event, detail?)   events:
//     'hit'         the player's ship is hit, or knocked in a collision ({ hull: true when it reached the hull })
//     'bump'        a collision too gentle to do harm
//     'shields-down' the player's shields just failed
//     'low-hull'    the hull fell below a third
//     'locked'      the player's guns locked on
//     'targeted'    an enemy began locking on the player
//     'destroyed'   the player's ship is lost
//     'won'         a fight won
//     'mined'       an asteroid broken up or a gas pocket used up
//     'docked', 'launched'
//     'done'        research or production finished
//   Feedback.on(fn) -> off()        listen to every event: fn(event, detail)
//
//   Feedback.vibrate(pattern)       the Vibration API where there is one (Android browsers; not
//                                   iPhones), else nothing. Feedback.canVibrate says which.
// ES module (`Feedback`); also runs in Node (the tests), where nothing vibrates.

const Feedback = (() => {
  const listeners = new Set();
  const emit = (event, detail = {}) => { for (const fn of listeners) fn(event, detail); };
  const on = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
  const canVibrate = typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
  const vibrate = (pattern) => { if (canVibrate) { try { navigator.vibrate(pattern); } catch (e) { /* not allowed now */ } } };
  return { emit, on, vibrate, canVibrate };
})();

export { Feedback };
