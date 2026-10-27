// Hearing a riff, round and round, through your rig [ui; the guitar room's TAPE stream] (docs/research/GUITAR-ROOM.md
// §2.3: "hear what you just played"). The tape and the library keep the dry input, as a recording does; hearing one
// plays it into the guitar track's input (engine.inputNode, where the monitored guitar goes in: core/liveroom/guitar
// rig.js's chain, the room's EQ, the fader), so it sounds as your playing does, at the level you played it. It never
// touches the song, History or the transport: a source node looping between the riff's first beat and its last, faded
// in and out over a few milliseconds (setTargetAtTime; never a value curve).
//
//   createHear({ app, track }) -> hear
//     hear.play(key, { buffer | sr + data, from = 0, to?, loop = true }) -> Promise<bool>   start (another stops first)
//     hear.stop()                 fade it out
//     hear.key                    what's playing (the caller's key), or null
//     hear.pos() -> 0..1 | null   where it is in its loop (for a playhead)
//     hear.dispose()

const FADE = 0.008;

export function createHear({ app, track }) {
  let cur = null;
  const ctxOf = () => app.engine?.ctx || null;
  function stop() {
    const c = cur;
    cur = null;
    if (!c) return;
    try {
      const t = c.ctx.currentTime;
      c.gain.gain.cancelScheduledValues(t);
      c.gain.gain.setValueAtTime(c.gain.gain.value, t);
      c.gain.gain.setTargetAtTime(0, t, FADE);
      c.src.stop(t + FADE * 8);
      setTimeout(() => { try { c.gain.disconnect(); } catch { /* gone */ } }, 200);
    } catch { /* closed */ }
  }
  async function play(key, { buffer = null, sr = 0, data = null, from = 0, to = null, loop = true } = {}) {
    stop();
    try { if (!ctxOf() && app.engine?.start) await app.engine.start(); } catch { /* no sound here */ }
    const ctx = ctxOf();
    const tid = typeof track === 'function' ? track() : track;
    const dest = ctx && tid && app.engine?.inputNode ? app.engine.inputNode(tid) : null;
    if (!ctx || !dest || dest.context !== ctx) return false;
    try { if (ctx.state === 'suspended') await ctx.resume(); } catch { /* fine */ }
    let buf = buffer;
    if (!buf && data && sr) { buf = ctx.createBuffer(1, Math.max(1, data.length), sr); buf.copyToChannel(data, 0); }
    if (!buf) return false;
    const dur = buf.duration;
    const a = Math.max(0, Math.min(dur, +from || 0)), b = to == null ? dur : Math.max(a + 0.05, Math.min(dur, +to));
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = !!loop;
    if (loop) { src.loopStart = a; src.loopEnd = b; }
    const gain = ctx.createGain();
    const t = ctx.currentTime + 0.02;
    gain.gain.setValueAtTime(0, t);
    gain.gain.setTargetAtTime(1, t, FADE);
    src.connect(gain);
    gain.connect(dest);
    src.start(t, a, loop ? undefined : b - a);
    const me = { key, src, gain, ctx, t, a, b, loop };
    cur = me;
    src.onended = () => { if (cur === me) cur = null; };
    return true;
  }
  return {
    play, stop,
    get key() { return cur ? cur.key : null; },
    pos() {
      if (!cur) return null;
      const len = cur.b - cur.a, el = cur.ctx.currentTime - cur.t;
      if (el < 0) return 0;
      return cur.loop ? (el % len) / len : Math.min(1, el / len);
    },
    dispose() { stop(); },
  };
}
