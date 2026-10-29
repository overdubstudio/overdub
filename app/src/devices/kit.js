// The graph DSP kit: what a graph device's build(c, kit) gets. A port of the guitar gear's PFX (the pedal platform:
// devices/guitar/gear/code.js, its pedals.js section, is the original), so the hundred-odd pedals in the gear run
// unchanged, and Overdub's own graph devices get the same tools.
//
//   PFX                         the context-free helpers: dB, toDb, clamp, rng, noteSec, noteFmt, NOTES, ENV, END
//   makeKit(c, { uid, seed, clock })   -> kit (below) plus kit.release() (stops what it started: devices/graph.js calls it)
//   loadWorklet(c, name, url)   load an AudioWorkletProcessor's module (a file on this origin) once per context, behind
//                               END: Promise<boolean>. A module that failed is asked for again by the next request, at
//                               least WORKLET_RETRY ms after it failed (never cached as failed for the page's life)
//   workletsReady(c, worklets)  true if every { name: url } is in (build now), else a Promise of the names that did
//                               not load ([] when they all did)
//   workletLoaded(c, name)      true / false (it failed last time) / undefined (not asked for yet, or loading)
//   endWorklet(node)            tell a processor loaded by loadWorklet to stop (it returns false from then on)
//   glide(c, param, v, dur, at) move an AudioParam along a raised cosine (no click at either end): live, linear ramps
//                               from one read of the clock; offline, a value curve scheduled ahead (as it always was)
//   cosineRamp(param, from, to, now, t, dur)   that raised cosine as linear ramps, held at `from` from `now` until `t`
//   isOffline(c)
//   softReach(fn), SOFT         how far out a soft clipper's curve has to be drawn for the WaveShaper's clamp to fall
//                               where it has flattened (kit.curve's reach 'soft'; kit.shaper always)
//
// The live rules (docs/DEVICES.md, "Graph devices in a live chain"; devices/lifecycle.js): nothing here schedules a
// setValueCurveAtTime on a live context (Chrome 155 and 156 drop a curve that is over before its node first renders,
// and leave the param where it was), and every live move reads the audio clock once (Chrome's currentTime steps 5.8 ms
// at a time, even inside one task: a second read can be later than the first).
//
// The kit (k.G, k.F, ...): the same names and meanings as the gear's (devices/guitar/gear/docs/PEDALS.md, "The kit"):
//   G(v) F(type, f, Q?, gain?) chain(...nodes) curve(fn, over, n, reach) shaper(k, bias, over) delay(max, t) lfo(rate, shape)
//   constant(v) noise({ secs, seed, color, channels }) noiseSource(opts) ir({ secs, pre, seed, tail, damp, darken,
//   width, channels }) convolver(buffer?) merge(L, R) pan(v) envelope({ attack, release }) worklet(name, opts)
//   later(fn, ms) own(node) onDispose(fn) dB toDb clamp rng noteSec noteFmt NOTES uid seed clock c sr
// Lowpass/highpass Q is Web Audio's (resonance in dB). Everything random is seeded: renders are the same every time.

// The delay notes a tempo-synced knob steps through: [label, quarter notes].
export const NOTES = [['1/16', 0.25], ['1/8', 0.5], ['1/8.', 0.75], ['1/4', 1], ['1/4.', 1.5], ['1/2', 2]];

// The envelope follower's processor (clawd-o-matic's PFX_ENV): audio in, its envelope out (0 to about 1, one channel).
// ENV is its module's URL (devices/worklets/env.js): a def calling kit.envelope() lists worklets: { 'pfx-env': ENV }.
export const ENV = new URL('./worklets/env.js', import.meta.url).href;

// The module every worklet goes in behind (devices/worklets/end.js, loaded once per context before the first): a
// processor whose node has been let go is sent { __pfxEnd } and returns false from then on (one returning true would
// otherwise be processed every render quantum for ever). Same message as clawd-o-matic's, so its pedals' own port
// handlers already ignore it.
export const END = new URL('./worklets/end.js', import.meta.url).href;

export const dB = (d) => Math.pow(10, d / 20);
export const toDb = (g) => 20 * Math.log10(Math.max(1e-12, Math.abs(g)));
export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
// a seeded random in [-1, 1): the same numbers every time
export const rng = (seed) => { let s = seed >>> 0 || 1; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1; };
// a NOTES index (or a label like '1/8.') in seconds at bpm
export const noteSec = (note, bpm) => {
  const n = typeof note === 'string' ? NOTES.find((d) => d[0] === note) : NOTES[clamp(Math.round(note), 0, NOTES.length - 1)];
  return ((n ? n[1] : 1) * 60) / (bpm || 120);
};
export const noteFmt = (v) => NOTES[clamp(Math.round(v), 0, NOTES.length - 1)][0];
export const PFX = { dB, toDb, clamp, rng, noteSec, noteFmt, NOTES, ENV, END };

export const isOffline = (c) => typeof OfflineAudioContext !== 'undefined' && c instanceof OfflineAudioContext;

// A WaveShaperNode clamps its input to the curve's [-1, 1]: past ±1 it holds the end value, so a soft clipper whose
// curve is still climbing there (tanh at a small drive: Blue Tang's first stage keeps 15% of its slope at +1, 53% at
// -1) turns into a hard corner the moment it's driven past it. softReach(fn) is how far out the curve has to be drawn
// for the clamp to land where fn has flattened: the least R ≥ 1, in 64ths, at which fn's slope at ±R is no more than
// SOFT (1%) of its slope at rest (fn'(0), its small-signal gain). A step in slope of 1% is 40 dB down on the curve's
// own, under the harmonics of the tanh itself. 1 for a curve already that flat at ±1 (a tanh driven hard, from about
// k = 3; a diode clip), and for one with no slope at rest (a dead zone): those are drawn exactly as they always were.
export const SOFT = 0.01;
export function softReach(fn, max = 8) {
  const h = 1e-5, slope = (x) => Math.abs(fn(x + h) - fn(x - h)), s0 = slope(0);
  if (!(s0 > 0)) return 1;
  let R = 1;
  while (R < max && Math.max(slope(R), slope(-R)) > SOFT * s0) R += 1 / 64;
  return R;
}

/* ---- worklets: a def's worklets map each processor name to its module's URL, a file on the page's own origin (the
   pages' policy refuses data: and blob: scripts, so a worklet can't be made from a string). Each is loaded once per
   context, behind END (once per context, first). A processor name is one per context, so the first module to load
   under a name keeps it. A load that failed (a network blip, a busy machine) is not the answer for the page's life: the
   next request asks again, WORKLET_RETRY ms after the failure at the soonest. */
export const WORKLET_RETRY = 1000;
const BOX = new WeakMap(); // context -> { end: load, w: { name: load } }; load: { p: Promise<bool>, ok: true | false | undefined, at, bad }
const box = (c) => { let b = BOX.get(c); if (!b) BOX.set(c, (b = { end: null, w: {} })); return b; };
const addModule = (c, url) => (c.state === 'closed' ? Promise.resolve(false) : Promise.resolve().then(() => c.audioWorklet.addModule(url)).then(() => true, () => false));
const after = (ms) => new Promise((r) => setTimeout(r, ms));
// one load, retried WORKLET_RETRY after a failure: prev is the load it replaces (or null)
function attempt(prev, run) {
  const wait = prev && prev.ok === false ? Math.max(0, prev.at + WORKLET_RETRY - Date.now()) : 0;
  const l = { p: null, ok: undefined, at: 0, bad: false };
  l.p = (wait ? after(wait) : Promise.resolve()).then(run).then((ok) => { l.ok = !!ok; if (!ok) l.at = Date.now(); return l.ok; });
  return l;
}
// END, once per context (again after a failure)
function endLoaded(c, b) {
  if (!b.end || (b.end.ok === false && !b.end.bad)) b.end = attempt(b.end, () => addModule(c, END));
  return b.end.p;
}
export function loadWorklet(c, name, url) {
  if (!c || !c.audioWorklet) return Promise.resolve(false);
  const b = box(c), cur = b.w[name];
  if (cur && (cur.ok !== false || cur.bad)) return cur.p; // in, on its way, or a def that can never load
  if (typeof url !== 'string' || !url || /\s/.test(url)) {
    console.error(`worklet "${name}": a def's worklets give its module's URL (a .js file on this origin), not its source`);
    b.w[name] = { p: Promise.resolve(false), ok: false, at: 0, bad: true };
    return b.w[name].p;
  }
  b.w[name] = attempt(cur, () => endLoaded(c, b).then((ok) => ok && addModule(c, url)));
  return b.w[name].p;
}
export const workletLoaded = (c, name) => { const l = box(c).w[name]; return l ? l.ok : undefined; };
export function workletsReady(c, worklets) {
  const names = Object.keys(worklets || {});
  if (names.every((n) => workletLoaded(c, n) === true)) return true;
  return Promise.all(names.map((n) => loadWorklet(c, n, worklets[n]))).then((oks) => names.filter((n, i) => !oks[i]));
}
export function endWorklet(n) { try { if (n && n.port) n.port.postMessage({ __pfxEnd: true }); } catch { /* gone */ } }

// Move an AudioParam to v along a raised cosine over dur seconds, from audio time `at` (or now). Live it starts from
// where the param is (or `from`), from ONE read of the clock: held there from now, then linear ramps through the
// cosine's 24 points from `at` (at least 3 ms ahead), the trajectory a 24-point value curve gave (Web Audio draws a
// curve as straight lines between its points) without the curve: linear ramps land on a node that hasn't rendered, on
// every browser. Offline (scheduled ahead from time 0) it is the value curve it always was, so renders stay
// bit-identical.
export const LEAD = 0.003;
export function glide(c, param, v, dur, at, from) {
  if (!isOffline(c)) {
    const now = c.currentTime;
    cosineRamp(param, from != null ? from : param.value, v, now, Math.max(now + LEAD, at || 0), dur);
    return;
  }
  // offline: exactly as before (the curve, and its last value set again where it ends)
  const t = Math.max(c.currentTime, at || 0);
  const f0 = from != null ? from : param.value, n = 24, cv = new Float32Array(n);
  if (Math.abs(f0 - v) < 1e-9) { param.cancelScheduledValues(t); param.setValueAtTime(v, t); return; }
  for (let i = 0; i < n; i++) cv[i] = f0 + (v - f0) * (0.5 - 0.5 * Math.cos((Math.PI * i) / (n - 1)));
  param.cancelScheduledValues(t); param.setValueAtTime(f0, t);
  try { param.setValueCurveAtTime(cv, t, dur); } catch { param.setTargetAtTime(v, t, dur / 4); return; } // (offline only: isOffline above)
  try { param.setValueAtTime(v, t + dur); } catch { /* the curve stands */ }
}
// The raised cosine from `from` to `to` as linear ramps: everything scheduled on param is dropped, it holds `from`
// from `now` (the one clock read) until t, then moves over dur and lands on `to` exactly. n points (24: the curve's).
export function cosineRamp(param, from, to, now, t, dur, n = 24) {
  param.cancelScheduledValues(0);
  if (Math.abs(from - to) < 1e-9) { param.setValueAtTime(to, now); return; }
  param.setValueAtTime(from, now);
  if (t > now) param.setValueAtTime(from, t);
  for (let i = 1; i < n; i++) param.linearRampToValueAtTime(i === n - 1 ? to : from + (to - from) * (0.5 - 0.5 * Math.cos((Math.PI * i) / (n - 1))), t + (dur * i) / (n - 1));
}

const NOISE = new WeakMap();
// The kit for one device instance on context c. own: what it started (stopped by release()).
export function makeKit(c, { uid = 'device', seed = 1, clock = null } = {}) {
  const own = { src: [], timers: new Set(), fns: [], wk: [] }; // (timers: the pending ones, each gone once it fires)
  const G = (v = 1) => { const n = c.createGain(); n.gain.value = v; return n; };
  const F = (type, f, q, g) => { const n = c.createBiquadFilter(); n.type = type; n.frequency.value = f; if (q != null) n.Q.value = q; if (g != null) n.gain.value = g; return n; };
  const chain = (...ns) => { for (let i = 0; i + 1 < ns.length; i++) ns[i].connect(ns[i + 1]); return ns[ns.length - 1]; };
  // A WaveShaper from fn(x) over [-1, 1]. reach R > 1 (or 'soft': softReach(fn)) draws fn over [-R, R] instead, behind a
  // gain of 1/R: the signal still meets fn(x) (the same small-signal gain, the same curve inside ±1), but the clamp
  // moves out to ±R. It's drawn with more points (an odd number: one sits on 0, so nothing at rest) so they're no
  // further apart than N over [-1, 1]; the gain stands in for the node (connect and disconnect go on from the shaper).
  // R = 1: the plain node, as it always was.
  const curve = (fn, over = '2x', N = 4096, reach = 1) => {
    const R = reach === 'soft' ? softReach(fn) : Math.max(1, reach);
    const n = c.createWaveShaper();
    if (R === 1) {
      const cv = new Float32Array(N);
      for (let i = 0; i < N; i++) cv[i] = fn((i / (N - 1)) * 2 - 1);
      n.curve = cv; n.oversample = over; return n;
    }
    const M = 2 * Math.ceil(((N - 1) * R) / 2) + 1, cv = new Float32Array(M);
    for (let i = 0; i < M; i++) cv[i] = fn(R * ((i / (M - 1)) * 2 - 1));
    n.curve = cv; n.oversample = over;
    const g = G(1 / R);
    g.connect(n);
    g.connect = (...a) => n.connect(...a);
    g.disconnect = (...a) => n.disconnect(...a);
    return g;
  };
  // tanh at k with a bias b (asymmetry: even harmonics), centred (no DC at rest) and normalised so ±1 in is ±1 out on
  // its stronger side. It reaches as far as it takes to flatten (softReach): past ±1 it goes on rounding off toward
  // tanh's own ceiling instead of meeting the clamp, so a small k stays soft however hard it's driven.
  const shaper = (k, b = 0, over = '2x') => {
    const t0 = Math.tanh(k * b), norm = Math.max(Math.tanh(k * (1 + b)) - t0, t0 - Math.tanh(k * (b - 1)));
    return curve((x) => (Math.tanh(k * (x + b)) - t0) / norm, over, 4096, 'soft');
  };
  const start = (n) => { n.start(); own.src.push(n); return n; };
  const lfo = (rate, shape = 'sine') => {
    const o = c.createOscillator();
    if (Array.isArray(shape)) { const re = new Float32Array(shape.length + 1), im = new Float32Array(shape.length + 1); shape.forEach((a, i) => (im[i + 1] = a)); o.setPeriodicWave(c.createPeriodicWave(re, im)); }
    else o.type = shape;
    o.frequency.value = rate; return start(o);
  };
  const constant = (v = 0) => { const n = c.createConstantSource(); n.offset.value = v; return start(n); };
  const delay = (max, t = 0) => { const n = c.createDelay(max); n.delayTime.value = t; return n; };
  // a deterministic noise buffer, cached per context
  const noise = ({ secs = 2, seed = 1, color = 'white', channels = 1 } = {}) => {
    let cache = NOISE.get(c); if (!cache) NOISE.set(c, (cache = {}));
    const key = [secs, seed, color, channels].join();
    if (cache[key]) return cache[key];
    const n = Math.round(secs * c.sampleRate), b = c.createBuffer(channels, n, c.sampleRate), r = rng(seed);
    for (let ch = 0; ch < channels; ch++) {
      const d = b.getChannelData(ch);
      let b0 = 0, b1 = 0, b2 = 0, br = 0;
      for (let i = 0; i < n; i++) {
        const w = r();
        if (color === 'pink') { b0 = 0.99765 * b0 + w * 0.099046; b1 = 0.963 * b1 + w * 0.2965164; b2 = 0.57 * b2 + w * 1.0526913; d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.2; }
        else if (color === 'brown') { br = (br + 0.02 * w) / 1.02; d[i] = br * 3.5; }
        else d[i] = w;
      }
    }
    return (cache[key] = b);
  };
  const noiseSource = (opts) => { const s = c.createBufferSource(); s.buffer = noise(opts); s.loop = true; return start(s); };
  // a reverb tail: decaying noise that darkens as it goes, -60 dB at secs (deterministic for a seed)
  const ir = ({ secs = 2, pre = 0.012, seed = 1, tail = 1.2, damp = 0.25, darken = 0.7, width = 1, channels = 2 } = {}) => {
    const sr = c.sampleRate, n = Math.round(sr * secs * tail), p0 = Math.round(sr * pre), b = c.createBuffer(channels, n, sr), rnd = rng(seed);
    for (let ch = 0; ch < channels; ch++) {
      const d = b.getChannelData(ch);
      let lp = 0;
      for (let i = p0; i < n; i++) {
        const t = (i - p0) / sr, dark = damp + darken * Math.min(1, t / secs);
        lp += (rnd() - lp) * (1 - dark);
        d[i] = lp * Math.exp((-6.9 * t) / secs);
      }
    }
    if (channels === 2 && width < 1) {
      const L = b.getChannelData(0), R = b.getChannelData(1);
      for (let i = 0; i < n; i++) { const m = (L[i] + R[i]) / 2, s = ((L[i] - R[i]) / 2) * width; L[i] = m + s; R[i] = m - s; }
    }
    return b;
  };
  // A convolver whose IR can change under a ringing tail: live, a new .buffer fades in a new ConvolverNode over 50 ms
  // while the old one fades out over 300 ms (a plain ConvolverNode drops its tail: a click). The new branch is made
  // first (setting a ConvolverNode's buffer takes a while), its gain set to 0 by .value, and then the clock is read
  // once for both fades (linear ramps: kit.js glide). Offline, and for the first IR: one node.
  const later = (fn, ms) => { const id = setTimeout(() => { own.timers.delete(id); fn(); }, ms); own.timers.add(id); return id; };
  const convolver = (buffer) => {
    const live = !isOffline(c);
    const inp = G(1), out = G(1), link = (a, b) => AudioNode.prototype.connect.call(a, b), unlink = (a, b) => { try { AudioNode.prototype.disconnect.call(a, b); } catch { /* gone */ } };
    let norm = true;
    const add = (b, g0 = 1) => { const n = c.createConvolver(), g = G(g0); n.normalize = norm; if (b) n.buffer = b; link(inp, n); n.connect(g); g.connect(out); return { n, g }; };
    let cur = add(buffer);
    Object.defineProperty(inp, 'buffer', { configurable: true, get: () => cur.n.buffer, set(b) {
      if (!live || !cur.n.buffer) { cur.n.buffer = b; return; }
      const old = cur;
      cur = add(b, 0);
      const now = c.currentTime, t = now + LEAD;
      cosineRamp(cur.g.gain, 0, 1, now, t, 0.05); cosineRamp(old.g.gain, old.g.gain.value, 0, now, t, 0.3);
      later(() => { unlink(inp, old.n); old.n.disconnect(); old.g.disconnect(); }, 400);
    } });
    Object.defineProperty(inp, 'normalize', { configurable: true, get: () => norm, set(v) { norm = !!v; cur.n.normalize = norm; } });
    inp.connect = (...a) => out.connect(...a);
    inp.disconnect = (...a) => out.disconnect(...a);
    return inp;
  };
  // an AudioWorkletNode for a processor the def's worklets loaded (null if it couldn't load: pass the signal through)
  const worklet = (name, opts) => { if (!workletLoaded(c, name)) return null; const n = new AudioWorkletNode(c, name, opts); own.wk.push(n); return n; };
  // the envelope follower (needs worklets: { 'pfx-env': PFX.ENV } in the def): null without worklets
  const envelope = ({ attack = 0.005, release = 0.12 } = {}) => {
    const n = worklet('pfx-env', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
    if (n) { n.parameters.get('attack').value = attack; n.parameters.get('release').value = release; }
    return n;
  };
  const merge = (L, R) => { const m = c.createChannelMerger(2); L.connect(m, 0, 0); (R || L).connect(m, 0, 1); return m; };
  const pan = (v = 0) => { const n = c.createStereoPanner(); n.pan.value = v; return n; };
  const kit = { c, sr: c.sampleRate, G, F, chain, curve, shaper, lfo, constant, delay, noise, noiseSource, ir, convolver, worklet, envelope, merge, pan, later,
    own: (n) => { own.src.push(n); return n; }, onDispose: (fn) => own.fns.push(fn), dB, toDb, clamp, rng, noteSec, noteFmt, NOTES, ENV, uid, seed, clock,
    loaded: (name) => !!workletLoaded(c, name) };
  // stop what this kit started, clear its timers, run its cleanups, let its worklets go
  Object.defineProperty(kit, 'release', { enumerable: false, value() {
    for (const t of own.timers) clearTimeout(t);
    for (const s of own.src) { try { s.stop(); } catch { /* not started */ } try { s.disconnect(); } catch { /* gone */ } }
    for (const fn of own.fns) { try { fn(); } catch { /* its business */ } }
    for (const n of own.wk) endWorklet(n);
    own.src = []; own.timers.clear(); own.fns = []; own.wk = [];
  } });
  return kit;
}
