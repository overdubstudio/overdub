// The rolling tape [input] (docs/research/GUITAR-ROOM.md §1.4, §2.2, §2.3, §4.3): while the room is open, the input
// is always on tape, quietly. The last minute (a setting, up to five) of the picked input, mono 16-bit at the device's
// rate, in a ring in the audio thread (input/tape-worklet.js: nothing allocated as it rolls), with the transport's bar
// grid alongside it, read off the audio clock as the deck's takes are placed (a frame f of the input was played to
// the band's scheduled time f / sr - latency, the measured round trip plus the engine's delay compensation: the
// recorder's own rule, input/recorder.js finishAudio). It never touches the song: grab copies a range into an asset in
// engine.assets and says where it belongs; the riff goes in the song only when the musician keeps it (riffOps, one
// dispatch the UI makes). Nothing here makes a sound or decides anything: the default selection is only where the
// handles start.
//
//   tape = app.input.tape
//   tape.start({ seconds? }) -> state     roll: from now on the picked input (whenever it's open, through reopens and
//                                         channel changes: audio.tap) goes on tape. The room calls it as it opens.
//   tape.stop()                           the room closed: the tape and its memory are let go
//   tape.state   { rolling, open (a ring is running), seconds (its length), sr, from, head (frames: the oldest held,
//                and the next to come), held (seconds on tape), bytes (the ring's), error }   read it in a frame
//   tape.seconds / tape.setSeconds(s)     15..300, 60 by default (localStorage overdub:tape); the newest audio is kept
//   tape.span() -> { from, to, seconds, sr, beats: { from, to } | null }   what's on tape (frames on the audio clock;
//                                         beats: the song beats at each end, when the band played there)
//   tape.peaks(from, to, n, out?) -> Float32Array(n)   the loudest sample (0..1) in each of n columns: the waveform,
//                                         cheap enough for every frame (from 256-frame bins kept on the page)
//   tape.level(from, to) -> 0..1          the loudest sample in a range (the faint line's life)
//   tape.lines(from, to, every?) -> [{ f, s, bar, beat }]   the drummer's bar lines in a range (every: 1 for beats too):
//                                         f the frame, s the song beat, bar 1-based (0 and under: the count-in)
//   tape.beatAt(f) -> { s, g, spb, bpb, gen } | null    the band's grid at a frame (null: the band wasn't playing)
//   tape.frameAt(s, near?) -> frame | null              where song beat s was played (the time nearest `near`)
//   tape.snap(f, every?) -> frame          the nearest bar line (or beat) to a handle, or f where there's no grid
//   tape.select({ within? }) -> Promise<Selection | null>   the default selection over the last `within` seconds (60):
//                                         the last few bars played, snapped to bar lines (input/tape-core.js
//                                         defaultSelection: its fields), from the attacks (input/onsets.js)
//   tape.grab(range, { lead, name, put, wait }) -> Promise<Grab>   range: { from, to } frames (a Selection, or the
//                                         handles); lead: seconds kept before `from` (0.03: the deck's seam); put:
//                                         false keeps it out of engine.assets; wait: a range whose end is still to come
//                                         (the bar isn't over) waits for the tape to reach it (default true).
//       Grab = { ok, asset: { id, kind: 'audio', name, sr, channels: 1, duration } (the song's recording format),
//         data (Float32Array: the samples), seconds, lead (s before the line), frames: { from, at, to } (the asset's
//         first frame, the line's, the end), peak (dBFS), place: { start (song beat of the first sample), from, to
//         (the range's song beats), beats, length (beats from start to the end), bars, bpm, bpb, gen } | null (free
//         time) } | { ok: false, error }
//   tape.ops(grab, { track, at, name, by }) -> ops   input/tape-core.js riffOps: asset.add and the clip, for one dispatch
//   tape.read(from, to) -> Promise<{ from, to, d: Int16Array } | null>   the raw 16-bit frames
//   tape.on('state', fn) -> off            rolling, open, the length or an error changed

import { BIN, SECONDS, createGrid, defaultSelection, fromPcm16, riffOps } from './tape-core.js';
import { createNoteFinder } from './onsets.js';

const WORKLET = new URL('./tape-worklet.js', import.meta.url).href;
const SAVE = 'overdub:tape';
const CHUNK = 4;   // seconds asked back from the audio thread at a time
const r6 = (x) => Math.round(x * 1e6) / 1e6;
const clampS = (s) => Math.max(SECONDS.min, Math.min(SECONDS.max, Math.round(+s) || SECONDS.def));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function createTape(app, input) {
  const engine = app.engine, store = app.store;
  let seconds = SECONDS.def;
  try { const v = JSON.parse(localStorage.getItem(SAVE) || 'null'); if (v && Number.isFinite(+v.seconds)) seconds = clampS(v.seconds); } catch { /* private mode */ }
  const state = { rolling: false, open: false, seconds, sr: 0, from: 0, head: 0, held: 0, bytes: 0, error: '' };
  const fns = new Map();
  const changed = () => { for (const fn of fns.get('state') || []) { try { fn(state); } catch (e) { console.error('tape listener', e); } } };
  let node = null, nodeCtx = null, untap = null, making = null, offs = [];
  let sr = 0, N = 0, start = -1, head = -1;           // frames: the ring's length, the first written, the next to come
  let pk = new Float32Array(0), NB = 0, pkEnd = -1;   // the peak bins, by bin index mod NB; the bin after the newest
  const grid = createGrid({ cap: pieceCap(seconds) });
  const gets = new Map();
  let gid = 0, seq = 0, ticks = 0;

  function pieceCap(s) { return Math.round(s * 12) + 256; }
  // seconds from a frame to the band's scheduled time it was played to: the round trip and the engine's delay compensation
  function lat() {
    let L = 0;
    try { L = +input.audio?.latency?.get?.() || 0; } catch { L = 0; }
    try { L += +engine?.latency?.total || 0; } catch { /* no engine */ }
    return L;
  }
  const spanFrom = () => (head < 0 ? 0 : Math.max(start, head - N));

  /* ---- the ring in the audio thread */
  function sync() {
    if (!state.rolling) return;
    const a = input.audio, c = a && a.state && a.state.open ? a.ctx : null;
    if (node && c && nodeCtx !== c) release();
    // (the input closed: the ring rolls on in silence, keeping what it has)
    if (!c || node || making) return;
    making = make(c).catch((e) => { state.error = String(e?.message || e); changed(); }).finally(() => { making = null; });
  }
  async function make(c) {
    if (!c.__ewTape) c.__ewTape = c.audioWorklet.addModule(WORKLET).then(() => true, () => false);
    if (!(await c.__ewTape)) { state.error = 'This browser can’t keep a tape (no AudioWorklet).'; changed(); return; }
    if (!state.rolling || node) return;
    sr = c.sampleRate;
    N = Math.ceil((seconds * sr) / BIN) * BIN;
    node = new AudioWorkletNode(c, 'ew-tape', { numberOfInputs: 1, numberOfOutputs: 0, channelCount: 1, channelCountMode: 'explicit', channelInterpretation: 'speakers', processorOptions: { frames: N } });
    nodeCtx = c;
    NB = N / BIN + 64; pk = new Float32Array(NB); pkEnd = -1; start = -1; head = -1;
    node.port.onmessage = onMsg;
    untap = input.audio.tap(node);
    Object.assign(state, { open: true, sr, bytes: N * 2, error: '' });
    mark();
    changed();
  }
  function release() {
    if (untap) { untap(); untap = null; }
    if (node) { try { node.port.postMessage('off'); node.port.onmessage = null; node.disconnect(); } catch { /* closed */ } }
    for (const [, w] of gets) w(null);
    gets.clear();
    node = null; nodeCtx = null; head = -1; start = -1; pkEnd = -1; pk = new Float32Array(0); NB = 0;
    grid.clear();
    Object.assign(state, { open: false, from: 0, head: 0, held: 0, bytes: 0 });
  }
  function onMsg(e) {
    const m = e.data;
    if (!m) return;
    if (m.t === 'pk') {
      const b = m.b, n = m.pk.length;
      if (pkEnd < 0) pkEnd = b;
      for (let j = pkEnd, z = Math.min(b, pkEnd + NB); j < z; j++) pk[j % NB] = 0;   // (bins it never sent: silence)
      for (let i = 0; i < n; i++) pk[(b + i) % NB] = m.pk[i];
      pkEnd = Math.max(pkEnd, b + n);
      head = m.head; start = m.start;
      state.head = head; state.from = spanFrom(); state.held = (head - state.from) / sr;
      mark();
      if (++ticks % 64 === 0) grid.prune(state.from / sr - lat() - 2);
    } else if (m.t === 'got') {
      const w = gets.get(m.id);
      if (w) { gets.delete(m.id); w(m); }
    }
  }
  // The transport, read where the audio clock is now (what's scheduled up to now can't move any more), into the grid
  function mark() {
    const c = nodeCtx;
    if (!c) return;
    const t = c.currentTime;
    const k = engine && engine.ctx === c && engine.playing ? engine.clock : null;
    if (!k) { grid.mark({ t, on: false }); return; }
    try {
      const bpb = k.beatsPerBar(), g = k.barAt(t) * bpb, s = k.beatAt(t), d = 1 / 64;
      const spb = (t - k.barTime((g - d) / bpb)) / d;
      const s0 = k.beatAt(0), t0 = k.barTime(s0 / bpb);
      const lp = store.get().loop, on = !!(lp && lp.on);
      grid.mark({ t, on: g >= s - 1e-6, gen: engine.gen, g, s, spb, bpb, t0, g0: s0, ls: on ? +lp.start : NaN, le: on ? +lp.end : NaN });
    } catch { grid.mark({ t, on: false }); }
  }
  function get(from, to) {
    return new Promise((res) => {
      if (!node) { res(null); return; }
      const id = ++gid;
      gets.set(id, res);
      node.port.postMessage({ t: 'get', id, from, to });
      setTimeout(() => { if (gets.delete(id)) res(null); }, 3000);
    });
  }

  /* ---- reading it */
  async function read(from, to) {
    if (!node || head < 0) return null;
    from = Math.max(Math.floor(from), spanFrom()); to = Math.min(Math.ceil(to), head);
    if (!(to > from)) return { from, to: from, d: new Int16Array(0) };
    const out = new Int16Array(to - from);
    let first = null;
    for (let f = from; f < to; ) {
      const e = Math.min(to, f + CHUNK * sr);
      const r = await get(f, e);
      if (!r) return null;
      if (first == null) first = r.from;
      if (r.to > r.from) out.set(r.d, r.from - from);
      f = e;
    }
    // (the oldest frames, overwritten while it read: gone from the front)
    return first > from ? { from: first, to, d: out.subarray(first - from) } : { from, to, d: out };
  }
  function level(from, to) {
    if (pkEnd < 0) return 0;
    const b0 = Math.max(Math.floor(from / BIN), Math.floor(spanFrom() / BIN), pkEnd - NB + 1), b1 = Math.min(Math.ceil(to / BIN), pkEnd);
    let m = 0;
    for (let b = b0; b < b1; b++) { const v = pk[b % NB]; if (v > m) m = v; }
    return m;
  }
  function peaks(from, to, n, out) {
    const y = out && out.length >= n ? out : new Float32Array(n);
    const w = (to - from) / n;
    for (let i = 0; i < n; i++) y[i] = level(from + i * w, from + (i + 1) * w);
    return y;
  }
  const beatAt = (f) => (sr ? grid.at(f / sr - lat()) : null);
  function frameAt(s, near = head) {
    if (!sr) return null;
    const L = lat(), t = grid.timeOf(s, near / sr - L);
    return t == null ? null : Math.round((t + L) * sr);
  }
  function lines(from, to, every = 0) {
    if (!sr) return [];
    const L = lat();
    return grid.lines(from / sr - L, to / sr - L, every).map((x) => ({ f: Math.round((x.t + L) * sr), s: x.s, bar: x.bar, beat: x.beat, gen: x.gen }));
  }

  /* ---- that was the one */
  async function select({ within = SECONDS.def } = {}) {
    if (!node || head < 0) return null;
    const h = head, r = await read(Math.max(spanFrom(), h - Math.round(within * sr)), h);
    if (!r || !r.d.length) return null;
    const fd = createNoteFinder({ sr, pitch: false }), x = new Float32Array(4096), onsets = [];
    for (let i = 0; i < r.d.length; i += 4096) {
      const n = Math.min(4096, r.d.length - i);
      fromPcm16(r.d.subarray(i, i + n), x);
      for (const o of fd.push(n === 4096 ? x : x.subarray(0, n), r.from + i)) onsets.push(o.f);
    }
    return defaultSelection({ onsets, sr, head: r.to, at: beatAt, frameOf: (s, near) => frameAt(s, near), level });
  }

  async function grab(range, { lead = 0.03, name = 'Riff', put = true, wait = true } = {}) {
    if (!node || head < 0) return { ok: false, error: 'The tape isn’t rolling.' };
    const from = Math.round(+range?.from), want = Math.round(+range?.to);
    if (!(want > from)) return { ok: false, error: 'Nothing selected.' };
    // the bar isn't over: the tape rolls on with the band, so wait for its end to come in
    if (wait && want > head) {
      const until = performance.now() + ((want - head) / sr) * 1000 + 1500;
      while (head < want && node && performance.now() < until) await sleep(20);
    }
    if (!node) return { ok: false, error: 'The tape stopped.' };
    const to = Math.min(want, head);
    const r = await read(from - Math.max(0, Math.round(lead * sr)), to);
    if (!r || r.to <= Math.max(r.from, from)) return { ok: false, error: 'That part of the tape is gone.' };
    const data = fromPcm16(r.d);
    let pkv = 0;
    for (let i = 0; i < data.length; i++) { const v = Math.abs(data[i]); if (v > pkv) pkv = v; }
    const asset = { id: 'a_' + Date.now().toString(36).slice(-6) + 'r' + (++seq).toString(36), kind: 'audio', name: String(name || 'Riff'), sr, channels: 1, duration: r6(data.length / sr) };
    if (put) {
      try { await engine.assets.put(asset.id, { sr, channels: [data] }); } catch (e) { return { ok: false, error: 'Couldn’t keep the audio: ' + (e?.message || e) }; }
    }
    // where it was played: the grid at its first sample, its line and its end
    const x0 = beatAt(r.from), x1 = beatAt(from), x2 = beatAt(to);
    let place = null;
    if (x0 && x1 && x2 && x0.gen === x1.gen && x1.gen === x2.gen) {
      const exact = range.beats && Number.isFinite(range.beats.from) && Number.isFinite(range.beats.to) && to === want;
      const lineAt = exact ? range.beats.from : x1.s, beats = exact ? range.beats.to - range.beats.from : x2.g - x1.g, leadB = x1.g - x0.g;
      place = { start: r6(lineAt - leadB), from: r6(lineAt), to: r6(lineAt + beats), beats: r6(beats), length: r6(leadB + beats), bars: r6(beats / x1.bpb), bpm: r6(60 / x1.spb), bpb: x1.bpb, gen: x1.gen };
    }
    return { ok: true, asset, data, seconds: data.length / sr, lead: (from - r.from) / sr, frames: { from: r.from, at: from, to: r.to }, peak: 20 * Math.log10(pkv + 1e-12), place };
  }

  /* ---- the length */
  function setSeconds(s) {
    const v = clampS(s);
    seconds = state.seconds = v;
    try { localStorage.setItem(SAVE, JSON.stringify({ seconds: v })); } catch { /* private mode */ }
    grid.resize(pieceCap(v));
    if (node) {
      const n2 = Math.ceil((v * sr) / BIN) * BIN, nb2 = n2 / BIN + 64, p2 = new Float32Array(nb2);
      if (pkEnd >= 0) for (let b = Math.max(0, pkEnd - Math.min(NB, nb2) + 1); b < pkEnd; b++) p2[b % nb2] = pk[b % NB];
      N = n2; NB = nb2; pk = p2;
      node.port.postMessage({ t: 'len', frames: n2 });
      state.bytes = n2 * 2; state.from = spanFrom();
    }
    changed();
    return v;
  }

  const tape = {
    state,
    get seconds() { return seconds; },
    setSeconds,
    start({ seconds: s = null } = {}) {
      if (s != null) setSeconds(s);
      if (state.rolling) return state;
      state.rolling = true;
      offs.push(input.on('audio', sync));
      try { const off = engine.on('transport', () => mark()); if (typeof off === 'function') offs.push(off); } catch { /* no engine */ }
      sync();
      changed();
      return state;
    },
    stop() {
      if (!state.rolling) return;
      state.rolling = false;
      for (const o of offs) { try { o(); } catch { /* ok */ } }
      offs = [];
      release();
      changed();
    },
    span() {
      if (head < 0) return { from: 0, to: 0, seconds: 0, sr, beats: null };
      const from = spanFrom(), a = beatAt(from), b = beatAt(head - 1);
      return { from, to: head, seconds: (head - from) / sr, sr, beats: a && b ? { from: a.s, to: b.s } : null };
    },
    peaks, level, lines, beatAt, frameAt,
    snap(f, every = 0) {
      if (!sr) return f;
      const w = Math.round(8 * sr), ls = lines(f - w, f + w, every);
      let best = f, d = Infinity;
      for (const x of ls) { const e = Math.abs(x.f - f); if (e < d) { d = e; best = x.f; } }
      return best;
    },
    select, grab, read,
    ops: (g, o) => riffOps(g, o),
    on(evt, fn) { if (!fns.has(evt)) fns.set(evt, new Set()); fns.get(evt).add(fn); return () => fns.get(evt).delete(fn); },
    get _grid() { return grid; },   // (checks)
  };
  return tape;
}
