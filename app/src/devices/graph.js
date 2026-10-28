// @ts-check
// Graph devices: a def whose build(c, kit) makes a Web Audio node graph (the ported pedals and amps, Overdub's own
// trusted built-ins). graphInstance(c, def, opts) wraps one in the Instance contract (docs/ARCHITECTURE.md, "Devices"),
// with the guitar gear's pedalRig manners (devices/guitar/gear/code.js, pedals.js): click-free bypass, gliding knobs, the bar clock.
//
// build(c, kit) returns:
//   { input (effects), output, set(v, x), sync?(x), dispose?(), latency?, noteOn?/noteOff?/allOff? (instruments) }
//   v: { uid, id, on, ...every param's value }   (an effect ignores v.on: the wrapper does bypass)
//   x: { bpm, first, t, to(param, value, tc?), note(i), clock, phaseAt(t, bars?) }
//      to(): jumps on the first set, glides after (setTargetAtTime, tc default 15 ms), so knobs never zipper
//      note(i): a delay note (kit.NOTES index or '1/8.') in seconds at the song's tempo
//   set() is called again when the params change and when the tempo changes (only then).
//   sync(x), if there: { why: 'build' | 'start' | 'stop' | 'tempo' | 'jump' | 'bar', playing, bpm, beatsPerBar, bar,
//     next (audio time of the next bar line), barLen, now, phaseAt, barTime, barAt, clock }. 'build' once after the first
//     set; live, the rest from one watcher per context (10 Hz at most, only while a device has sync and only on change).
//
// Bypass (setOn), as the Guitar Studio's:
//   insert (the default): in -> dry -> out, in -> device -> wet (dB(trim) when on) -> out; a 10 ms raised-cosine
//     crossfade. Live, an insert off for 80 ms stops being fed (it costs nothing). Off is exactly the dry signal.
//   trails (def.trails): in -> out at unity always, in -> send (on/off) -> device -> dB(trim) -> out: its output is
//     WET ONLY and its tail rings on after it's switched off. Params changed while it's off wait till it's back on
//     (moving a delay's time under its ringing tail warps it).
//
// The lifecycle in a live chain (devices/lifecycle.js; docs/DEVICES.md, "Graph devices in a live chain"):
//   build    the device's own build(c, kit) and its first set() and bypass: on a live context the bypass gains are set
//            by .value, nothing scheduled (a node that hasn't rendered yet may drop a value curve: Chrome 155, 156).
//   ready    resolves once built; REJECTS with lifecycle.failure(code) when build() threw ('threw'), returned no
//            output or an effect no input ('no-output'), or a worklet the def declares didn't load ('worklet'). The
//            wrapper never stands in for the device: the engine plays its own stand-in, says so and builds it again.
//   setOn    a 10 ms raised cosine from one read of the clock, as linear ramps (kit.js glide); offline as it always was.
//   health() { ok, failed, on, settled, dry, wet, want: { dry, wet } }: the bypass gains as they are and should be.
//   assure() snaps the bypass gains (and the feed) to their targets at once; true if it had to.
//   dispose  idempotent: stops what the kit started, the device's own dispose(), disconnects.
import { makeKit, workletsReady, glide, cosineRamp, LEAD, dB, noteSec, isOffline } from './kit.js';
import { paramValues, seedOf } from './registry.js';
import { failure, failureCode } from './lifecycle.js';

// A switch has settled once the audio clock is past its fade's end, or (a stalled or suspended clock) this long after it
// by the wall clock (lifecycle.js: health().settled within the live path's HEALTH.settle, 150 ms, of the last setOn).
const SETTLE_MS = 100;
// how near a gain must be to its target to count as there
const near = (v, want) => Math.abs(v - want) <= 1e-3 * Math.max(1, Math.abs(want));

/* ---- the live clock: the engine's (engine.clock) on the live context, for code that asks for it globally (the ported
   packs' PLUG.clock: devices/guitar/index.js). Set whenever a graph device is made live with opts.clock. */
export const live = { c: null, clock: null };
const liveFns = new Set();
export function onLive(fn) { liveFns.add(fn); return () => liveFns.delete(fn); }
function setLive(c, clock) {
  if (live.c === c && live.clock === clock) return;
  live.c = c; live.clock = clock;
  for (const fn of liveFns) { try { fn(live); } catch (e) { console.error(e); } }
}

// The bar clock a device sees (kit.clock, x.clock): clawd-o-matic's shape (playing, bpm, beatsPerBar are getters).
// src is the engine's clock ({ playing(), bpm(), beatsPerBar(), barTime(b), barAt(t)?, bar() }); while it isn't
// playing (or there's none) it's a free grid of 4/4 bars from audio time 0 at the device's tempo, so offline renders
// are the same every time.
export function deviceClock(c, src, getBpm) {
  const band = () => { if (!src) return null; try { return src.playing() ? src : null; } catch { return null; } };
  const barAt = (s, t) => {
    if (!s) return (t * getBpm()) / (60 * bpb(s));
    if (typeof s.barAt === 'function') { const b = +s.barAt(t); if (Number.isFinite(b)) return b; }
    let b = Math.floor(+s.bar() || 0), k = 0;
    while (s.barTime(b) > t && k++ < 512) b--;
    while (s.barTime(b + 1) <= t && k++ < 512) b++;
    const a = s.barTime(b), z = s.barTime(b + 1);
    return b + (z > a ? (t - a) / (z - a) : 0);
  };
  const bpb = (s) => { let n = 4; try { if (s && s.beatsPerBar) n = +s.beatsPerBar() || 4; } catch { /* 4 */ } return n; };
  const clock = {
    get playing() { return !!band(); },
    get beatsPerBar() { return bpb(band()); },
    get bpm() { const s = band(); if (!s) return getBpm(); const b = Math.floor(barAt(s, c.currentTime)), len = s.barTime(b + 1) - s.barTime(b); return len > 0 ? (bpb(s) * 60) / len : getBpm(); },
    barTime: (b) => { const s = band(); return s ? s.barTime(b) : (b * 60 * bpb(s)) / getBpm(); },
    barAt: (t) => barAt(band(), t == null ? c.currentTime : t),
    bar: () => clock.barAt(c.currentTime),
    phaseAt: (t, bars = 1) => { const x = clock.barAt(t) / (bars || 1); return x - Math.floor(x); },
    next: (t) => { const b = Math.floor(barAt(band(), t == null ? c.currentTime : t)) + 1, time = clock.barTime(b); return { bar: b, time, len: clock.barTime(b + 1) - time }; },
  };
  return clock;
}

/* ---- one watcher per live context for every device with a sync() */
const WATCH = new Map(); // context -> { set: Set<inst>, timer }
function watch(c, inst) {
  let w = WATCH.get(c);
  if (!w) WATCH.set(c, (w = { set: new Set(), timer: 0 }));
  w.set.add(inst);
  if (!w.timer) {
    const tick = () => {
      w.timer = 0;
      if (c.state === 'closed' || !w.set.size) { WATCH.delete(c); return; }
      for (const i of w.set) i._tick();
      w.timer = setTimeout(tick, 100);
    };
    w.timer = setTimeout(tick, 0);
  }
}
function unwatch(c, inst) { const w = WATCH.get(c); if (w) w.set.delete(inst); }

export function graphInstance(c, def, opts = {}) {
  const offline = isOffline(c), fx = def.kind === 'effect', trails = fx && !!def.trails;
  const uid = String(opts.uid || def.id), seed = opts.seed != null ? opts.seed >>> 0 : seedOf(uid);
  if (!offline && opts.clock) setLive(c, opts.clock);
  let bpm = 120;
  try { if (opts.clock && opts.clock.bpm) bpm = +opts.clock.bpm() || 120; } catch { /* 120 */ }
  if (opts.bpm) bpm = opts.bpm;
  const clock = deviceClock(c, opts.clock || null, () => bpm);
  const kit = makeKit(c, { uid, seed, clock });
  const G = (v) => { const n = c.createGain(); n.gain.value = v; return n; };
  const trim = dB(def.trim || 0);
  let on = opts.on == null ? true : !!opts.on;
  // the wrapper: i (in), o (out), dry, wet (insert: the wet level; trails: the send)
  const i = fx ? G(1) : null, o = G(1), dry = fx ? G(1) : null, wet = fx ? G(0) : null, post = trails ? G(trim) : null;
  if (fx) { i.connect(dry); dry.connect(o); }
  let p = null, firstSet = true, lastKey = null, values = paramValues(def, opts.params || {}), pending = null, fed = false, offT = 0, dead = false;
  let grid = null;

  const feed = (yes) => {
    if (!p || trails) return;
    if (yes && !fed) { i.connect(p.input); fed = true; }
    else if (!yes && fed) { try { i.disconnect(p.input); } catch { /* gone */ } fed = false; }
  };
  // A footswitch move. Live: at build (`first`), straight there by .value with nothing scheduled; after, a 10 ms raised
  // cosine as linear ramps (kit.js cosineRamp) from `now`, the switch's one read of the clock (both gains move from the
  // same read: Chrome's clock can step 5.8 ms between two). Offline, exactly as it always was: straight there before
  // anything has played, else the glide scheduled ahead from the gain's last target.
  let swEnd = 0, swWall = 0; // (the last switch's fade: where it ends on the audio clock, and when by the wall clock)
  const sw = (param, v, at, first, now) => {
    if (!offline) {
      if (first) { param.cancelScheduledValues(0); param.value = v; return; }
      const t = Math.max(now + LEAD, at || 0);
      swEnd = Math.max(swEnd, t + 0.01); swWall = Math.max(swWall, performance.now() + (t + 0.01 - now) * 1000 + SETTLE_MS);
      cosineRamp(param, param.value, v, now, t, 0.01);
      return;
    }
    if (c.currentTime === 0 && !(at > 0)) { param.cancelScheduledValues(0); param.setValueAtTime(v, 0); return; }
    glide(c, param, v, 0.01, at, param.__to);
  };
  const track = (param, v) => { param.__to = v; return v; };
  function applyOn(at, first = false) {
    if (!fx) return;
    const now = offline ? 0 : c.currentTime; // (live: the one read)
    if (!p) { sw(dry.gain, track(dry.gain, 1), at, first, now); return; } // (not built yet: dry)
    if (trails) { sw(wet.gain, track(wet.gain, on ? 1 : 0), at, first, now); return; }
    clearTimeout(offT);
    if (on) feed(true);
    sw(dry.gain, track(dry.gain, on ? 0 : 1), at, first, now); sw(wet.gain, track(wet.gain, on ? trim : 0), at, first, now);
    if (!on) {
      if (offline ? c.currentTime === 0 && !(at > 0) : first || (now === 0 && !(at > 0))) feed(false);
      else if (!offline) {
        // stops being fed once it's been off a moment (by the audio clock: a starved thread mustn't cut it early)
        const quiet = Math.max(now, at || 0) + 0.02;
        const off = () => { if (on || dead) return; if (c.currentTime < quiet && c.state === 'running') offT = setTimeout(off, 10); else feed(false); };
        offT = setTimeout(off, 80);
      }
    }
  }
  function syncOne(why) {
    if (!p || !p.sync) return;
    const nx = clock.next();
    const x = { why, playing: clock.playing, bpm: clock.bpm, beatsPerBar: clock.beatsPerBar, bar: nx.bar, next: nx.time, barLen: nx.len, now: c.currentTime,
      phaseAt: clock.phaseAt, barTime: clock.barTime, barAt: clock.barAt, clock };
    try { p.sync(x); } catch (e) { if (!inst._syncErr) console.error('device ' + def.id + ' sync:', e); inst._syncErr = true; }
  }
  function callSet(v, at) {
    if (!p) return;
    const first = firstSet, t = Math.max(c.currentTime, at || 0);
    const to = (param, val, tc) => { if (!Number.isFinite(val)) return; if (first) param.setValueAtTime(val, t); else param.setTargetAtTime(val, t, tc || 0.015); };
    const x = { bpm, first, t, to, note: (n) => noteSec(n, bpm), clock, phaseAt: clock.phaseAt };
    try { p.set && p.set(Object.assign({ uid, id: def.pedal || def.id, on }, v), x); } catch (e) { console.error('device ' + def.id + ' set:', e); }
    firstSet = false; lastKey = JSON.stringify(v);
    if (first && p.sync) { syncOne('build'); if (!offline) watch(c, inst); }
  }
  // Build the device (throws a lifecycle failure: ready rejects with it). What a failed build started is let go.
  let failed = '';
  function fail(code, message, cause) {
    const e = cause && failureCode(cause) ? cause : failure(code, message, cause);
    failed = e.message;
    /** @type {any} */ (e).device = def.id;
    kit.release();
    return e;
  }
  function build() {
    if (dead) throw fail('threw', `${def.name || def.id} was taken down before it was built`);
    if (p) return;
    let q = null;
    try { q = def.build(c, kit); } catch (e) { throw fail('threw', `${def.name || def.id} didn't build: ${(e && e.message) || e}`, e); }
    if (!q || !q.output || (fx && !q.input)) {
      if (q && typeof q.dispose === 'function') { try { q.dispose(); } catch { /* its business */ } }
      throw fail('no-output', `${def.name || def.id} built with no ${!q || !q.output ? 'output' : 'input'}`);
    }
    p = q;
    if (trails) { i.connect(wet); wet.connect(p.input); p.output.connect(post); post.connect(o); }
    else if (fx) { p.output.connect(wet); wet.connect(o); } else p.output.connect(o);
    callSet(values);
    applyOn(undefined, true);
  }

  const inst = {
    def, uid, seed, clock,
    input: i, output: o,
    get on() { return on; },
    get params() { return Object.assign({}, values); },
    get bpm() { return bpm; },
    // (tests and the faces: what build() returned)
    get device() { return p; },
    set(params = {}, x = {}) {
      const v = paramValues(def, params);
      let tempoMoved = false;
      if (x.bpm && x.bpm !== bpm) { bpm = +x.bpm; tempoMoved = true; }
      values = v;
      if (!p) return;
      const key = JSON.stringify(v);
      if (key === lastKey && !tempoMoved) return;
      // a trails device that's off keeps the params its tail rings with: the new ones go in when it's next on
      if (trails && !on && !firstSet) { pending = v; if (tempoMoved) syncOne('tempo'); return; }
      callSet(v, x.at);
      if (tempoMoved) syncOne('tempo');
    },
    setOn(next, at) {
      next = !!next;
      if (!fx || next === on) { on = next; return; }
      on = next;
      if (on && pending) { const v = pending; pending = null; callSet(v, at); }
      applyOn(at);
    },
    noteOn(pitch, vel = 0.8, time) { if (p && p.noteOn) p.noteOn(pitch, vel, time == null ? c.currentTime : time); },
    noteOff(pitch, time) { if (p && p.noteOff) p.noteOff(pitch, time == null ? c.currentTime : time); },
    allOff(time) { if (p && p.allOff) p.allOff(time == null ? c.currentTime : time); },
    get latency() {
      if (!p || trails || (fx && !on)) return 0;
      const l = p.latency != null ? p.latency : def.latency;
      return Number.isFinite(+l) ? +l : 0;
    },
    meter: null,
    // (live: the watcher's tick) the band started or stopped, the tempo moved, the grid jumped, or a new bar
    _tick() {
      if (!p || !p.sync || dead) return;
      const nx = clock.next(), g = { playing: clock.playing, bpm: clock.bpm, time: nx.time, len: nx.len };
      let why = null;
      if (grid) {
        if (g.playing !== grid.playing) why = g.playing ? 'start' : 'stop';
        else if (Math.abs(g.bpm - grid.bpm) > 1e-6) why = 'tempo';
        else if (Math.abs(g.time - grid.time) <= 0.002) why = null;
        else why = Math.abs(g.time - (grid.time + grid.len)) <= 0.002 ? 'bar' : 'jump';
      }
      grid = g;
      if (why) syncOne(why);
    },
    // What the device says about itself (lifecycle.js): built or why not, the bypass gains as they are and should be.
    health() {
      const why = failed || (dead ? 'disposed' : p ? '' : 'building');
      if (!fx) return { ok: !why, failed: why, on: true, settled: true, dry: null, wet: null, want: null };
      const settled = offline || c.state !== 'running' || c.currentTime >= swEnd || performance.now() >= swWall;
      const want = { dry: dry.gain.__to ?? 1, wet: wet.gain.__to ?? 0 }, dv = dry.gain.value, wv = wet.gain.value;
      const fedOk = trails || !on || fed || !p;
      return { ok: !why && settled && near(dv, want.dry) && near(wv, want.wet) && fedOk, failed: why, on, settled, dry: dv, wet: wv, want };
    },
    // Snap the bypass gains to their targets at once (cancel what's scheduled, set .value), and feed an insert that's
    // on and isn't fed: true if anything had to move. (The engine calls it once a wired device's fades are over.)
    assure() {
      if (!fx || !p || dead) return false;
      let moved = false;
      for (const g of [dry.gain, wet.gain]) {
        const want = g.__to;
        if (want == null || near(g.value, want)) continue;
        g.cancelScheduledValues(0); g.value = want; moved = true;
      }
      if (on && !trails && !fed) { clearTimeout(offT); feed(true); moved = true; }
      if (moved) { swEnd = 0; swWall = 0; }
      return moved;
    },
    dispose() {
      if (dead) return;
      dead = true;
      clearTimeout(offT); unwatch(c, inst);
      kit.release();
      if (p) { try { p.dispose && p.dispose(); } catch (e) { console.error('device ' + def.id + ' dispose:', e); } }
      try { if (i) i.disconnect(); o.disconnect(); if (p) p.output.disconnect(); } catch { /* gone */ }
    },
  };
  inst._syncErr = false;
  if (fx) { track(dry.gain, 1); dry.gain.value = 1; wet.gain.value = 0; }
  // ready: built, or a lifecycle failure (a declared worklet that didn't load is one: the device isn't what it says)
  const r = workletsReady(c, def.worklets);
  if (r === true) {
    try { build(); inst.ready = Promise.resolve(inst); } catch (e) { inst.ready = Promise.reject(e); }
  } else {
    inst.ready = r.then((missing) => {
      if (missing.length) throw fail('worklet', `${def.name || def.id}: its worklet${missing.length > 1 ? 's' : ''} ${missing.join(', ')} didn't load`);
      build();
      return inst;
    });
  }
  // (a caller that never asks still sees the failure here, as a warning; the engine reports it and stands in)
  inst.ready.catch((e) => console.warn('device ' + def.id + ': ' + ((e && e.message) || e)));
  return inst;
}
