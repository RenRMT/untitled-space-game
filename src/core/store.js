// URL parameters and saved data in one place. localStorage can be missing or refuse writes
// (private windows, blocked site data, Node), so every access is guarded: reads fall back,
// writes are dropped, and the game carries on with what it has for the session.
//
//   Params.has(key), Params.get(key)     the page's URL parameters (?seed=, ?dev, ?fresh, ...)
//   Params.set(key, value)               change one in the address bar, without reloading
//   Store.get(key, fallback)             a saved string, or fallback
//   Store.set(key, value), Store.remove(key)
//   Store.getJSON(key, fallback), Store.setJSON(key, value)
//   Store.choice(key, options, fallback) a saved choice among options; ?key= overrides it
// ES module (`Params`, `Store`); also runs in Node, where nothing is saved.

const Params = (() => {
  const params = new URLSearchParams(typeof location !== 'undefined' ? location.search : '');
  return {
    has: (key) => params.has(key),
    get: (key) => params.get(key),
    set(key, value) {
      params.set(key, value);
      try {
        const url = new URL(location.href);
        url.searchParams.set(key, value);
        history.replaceState(null, '', url);
      } catch (e) { /* file:// in some browsers */ }
    },
  };
})();

const Store = (() => {
  function get(key, fallback = null) {
    try {
      const v = localStorage.getItem(key);
      return v === null ? fallback : v;
    } catch (e) {
      return fallback;
    }
  }
  function set(key, value) {
    try {
      localStorage.setItem(key, value);
      return true;
    } catch (e) {
      return false;
    }
  }
  function remove(key) {
    try { localStorage.removeItem(key); } catch (e) { /* storage unavailable */ }
  }
  function getJSON(key, fallback = null) {
    const raw = get(key);
    if (raw === null) return fallback;
    try { return JSON.parse(raw); } catch (e) { return fallback; }
  }
  const setJSON = (key, value) => set(key, JSON.stringify(value));
  function choice(key, options, fallback) {
    const asked = Params.get(key);
    if (options.includes(asked)) return asked;
    const saved = get(key);
    return options.includes(saved) ? saved : fallback;
  }
  return { get, set, remove, getJSON, setJSON, choice };
})();

export { Params, Store };
