// Sound: a short voice for each game event (core/feedback.js names them), made on the spot with the
// Web Audio API from oscillators and filtered noise. No files: nothing to download or keep offline.
// Browsers only let a page make sound after the player has touched it, so nothing is created until
// unlock() is called from a tap or a key (game/options.js), and nothing at all while the volume is 0.
//
//   Sound.setVolume(v)        0 (off: no audio context is made, or the one there is suspended) to 1
//   Sound.unlock()            from a pointer or key event: make (or wake) the audio context
//   Sound.play(event, detail) the event's voice, if there is one and sound is on and unlocked;
//                             'hit' with detail.hull is the heavier 'hit-hull', 'loot' rings by detail.rarity
//   Sound.VOICES              { name: (v) => ... } where v.tone(...) and v.noise(...) add to the voice
//   Sound.available           whether this browser can make sound
//   Sound.use(Ctor)           (the tests) an AudioContext class to use in place of the browser's
// ES module (`Sound`); also runs in Node (the tests), where there is no sound.

const Sound = (() => {
  let Ctor = typeof window !== 'undefined' ? (window.AudioContext || window.webkitAudioContext || null) : null;
  let ctx = null, master = null, hiss = null, volume = 0, unlocked = false;
  const last = {}; // event -> when its voice last began (s): a burst of the same event is one sound
  const GAP = { hit: 0.07, 'hit-hull': 0.1, bump: 0.15, mined: 0.08, locked: 0.1, targeted: 0.25, loot: 0.12 };

  function start() {
    if (ctx || !Ctor || volume <= 0) return;
    try {
      ctx = new Ctor();
      master = ctx.createGain();
      master.gain.value = volume;
      master.connect(ctx.destination);
    } catch (e) {
      ctx = null; // no audio device, or too many contexts: the game goes on in silence
    }
  }
  function unlock() {
    unlocked = true;
    start();
    if (ctx && ctx.state === 'suspended' && volume > 0) ctx.resume().catch(() => {});
  }
  function setVolume(v) {
    volume = Math.min(1, Math.max(0, Number(v) || 0));
    if (unlocked) start();
    if (!ctx) return;
    master.gain.value = volume;
    if (volume <= 0 && ctx.state === 'running') ctx.suspend().catch(() => {});
    if (volume > 0 && ctx.state === 'suspended' && unlocked) ctx.resume().catch(() => {});
  }

  // One second of white noise, made once, played through a filter for bursts and rumbles.
  function noiseBuffer() {
    if (hiss) return hiss;
    hiss = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = hiss.getChannelData(0);
    let s = 22222;
    for (let i = 0; i < d.length; i++) { s = (s * 16807) % 2147483647; d[i] = (s / 2147483647) * 2 - 1; }
    return hiss;
  }
  // A gain that rises in a few ms, then dies away over dur: every voice's envelope.
  function envelope(t, dur, gain) {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    g.connect(master);
    return g;
  }
  // What a voice is built from. at: seconds after the voice begins.
  const builder = (t0) => ({
    // A pitched sound sliding from f to `to` (Hz) over dur.
    tone({ type = 'sine', f, to = f, dur = 0.1, gain = 0.2, at = 0 }) {
      const t = t0 + at, o = ctx.createOscillator();
      o.type = type;
      o.frequency.setValueAtTime(f, t);
      if (to !== f) o.frequency.exponentialRampToValueAtTime(Math.max(1, to), t + dur);
      o.connect(envelope(t, dur, gain));
      o.start(t);
      o.stop(t + dur + 0.02);
    },
    // Noise through a filter (lowpass, or bandpass with q) whose cutoff slides from f to `to`.
    noise({ f = 800, to = f, q = 0, dur = 0.1, gain = 0.2, at = 0 }) {
      const t = t0 + at, src = ctx.createBufferSource(), flt = ctx.createBiquadFilter();
      src.buffer = noiseBuffer();
      flt.type = q ? 'bandpass' : 'lowpass';
      if (q) flt.Q.value = q;
      flt.frequency.setValueAtTime(f, t);
      if (to !== f) flt.frequency.exponentialRampToValueAtTime(Math.max(1, to), t + dur);
      src.connect(flt);
      flt.connect(envelope(t, dur, gain));
      src.start(t);
      src.stop(t + dur + 0.02);
    },
  });

  // Loot rings a note more the rarer it is, up a major scale.
  const SCALE = [523.25, 659.25, 783.99, 1046.5, 1318.5];
  const chime = (n) => (v) => { for (let i = 0; i < n; i++) v.tone({ type: 'triangle', f: SCALE[i], dur: 0.22, gain: 0.16, at: i * 0.075 }); };
  const VOICES = {
    hit: (v) => { v.noise({ f: 1400, to: 300, dur: 0.08, gain: 0.22 }); v.tone({ type: 'square', f: 150, to: 70, dur: 0.07, gain: 0.07 }); },
    'hit-hull': (v) => { v.noise({ f: 700, to: 120, dur: 0.2, gain: 0.34 }); v.tone({ type: 'sawtooth', f: 95, to: 38, dur: 0.22, gain: 0.16 }); },
    bump: (v) => v.tone({ f: 85, to: 48, dur: 0.09, gain: 0.2 }),
    'shields-down': (v) => { v.tone({ type: 'sawtooth', f: 720, to: 110, dur: 0.38, gain: 0.14 }); v.noise({ f: 3000, to: 200, dur: 0.3, gain: 0.12 }); },
    'low-hull': (v) => { for (const at of [0, 0.2]) v.tone({ type: 'square', f: 392, dur: 0.12, gain: 0.1, at }); },
    locked: (v) => v.tone({ f: 880, to: 1320, dur: 0.07, gain: 0.1 }),
    targeted: (v) => { for (const at of [0, 0.11]) v.tone({ type: 'square', f: 622, dur: 0.06, gain: 0.07, at }); },
    skill: (v) => v.tone({ type: 'triangle', f: 520, to: 830, dur: 0.1, gain: 0.14 }),
    destroyed: (v) => { v.noise({ f: 1800, to: 60, dur: 1.1, gain: 0.4 }); v.tone({ type: 'sawtooth', f: 130, to: 28, dur: 1, gain: 0.2 }); },
    won: (v) => { [523.25, 659.25, 783.99].forEach((f, i) => v.tone({ type: 'triangle', f, dur: 0.3, gain: 0.14, at: i * 0.09 })); },
    mined: (v) => { v.noise({ f: 1300, q: 1.2, dur: 0.18, gain: 0.26 }); v.tone({ f: 190, to: 85, dur: 0.16, gain: 0.12 }); },
    docked: (v) => { v.tone({ f: 330, to: 220, dur: 0.28, gain: 0.14 }); v.noise({ f: 500, dur: 0.12, gain: 0.08, at: 0.2 }); },
    launched: (v) => { v.tone({ f: 220, to: 440, dur: 0.3, gain: 0.14 }); v.noise({ f: 300, to: 1600, dur: 0.3, gain: 0.07 }); },
    hazard: (v) => v.tone({ type: 'sawtooth', f: 210, to: 150, dur: 0.22, gain: 0.1 }),
    'loot-common': chime(1), 'loot-uncommon': chime(2), 'loot-rare': chime(3), 'loot-epic': chime(4), 'loot-legendary': chime(5),
  };
  const voiceOf = (event, detail) => (event === 'hit' && detail.hull ? 'hit-hull'
    : event === 'loot' ? (VOICES[`loot-${detail.rarity}`] ? `loot-${detail.rarity}` : 'loot-common') : event);

  function play(event, detail = {}) {
    if (!ctx || volume <= 0 || ctx.state !== 'running') return false;
    const name = voiceOf(event, detail), voice = VOICES[name];
    if (!voice) return false;
    const t = ctx.currentTime, gap = GAP[event] || 0;
    if (gap && last[event] !== undefined && t - last[event] < gap) return false;
    last[event] = t;
    try { voice(builder(t)); } catch (e) { return false; }
    return true;
  }

  return {
    setVolume, unlock, play, VOICES,
    get available() { return !!Ctor; },
    get volume() { return volume; },
    get running() { return !!ctx; },
    use(C) { Ctor = C; ctx = null; master = null; hiss = null; unlocked = false; for (const k of Object.keys(last)) delete last[k]; },
  };
})();

export { Sound };
