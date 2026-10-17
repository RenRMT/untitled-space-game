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
//   Store.dump() -> { key: value }, Store.load(data) -> ok   everything saved, for a backup file
//   Store.persist()                      ask the browser not to clear saved data under storage pressure
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
  // Everything saved, as { key: string }, for a backup file; and putting a backup back, replacing
  // what's there. load() returns whether it could write.
  function dump() {
    const out = {};
    try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); out[k] = localStorage.getItem(k); } } catch (e) { /* storage unavailable */ }
    return out;
  }
  function load(data) {
    try {
      localStorage.clear();
      for (const [k, v] of Object.entries(data)) if (typeof v === 'string') localStorage.setItem(k, v);
      return true;
    } catch (e) {
      return false;
    }
  }
  // Ask the browser to keep saved data even when the device runs short of space (granted silently
  // or not at all in Chromium, asked in Firefox). Best asked after something the player did.
  function persist() {
    try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {}); } catch (e) { /* no storage API */ }
  }
  return { get, set, remove, getJSON, setJSON, choice, dump, load, persist };
})();

export { Params, Store };
