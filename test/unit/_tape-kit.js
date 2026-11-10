// The rolling tape's test rig: the worklet's file in a vm with the worklet scope's globals, a processor driven a
// quantum at a time, and a simulated session (the band, the guitar late by the round trip, the live tape on a simulated
// audio thread). Shared by tape.test.js and tools/input-test.js (which times it: wall clock does not belong in test/unit).
import fs from 'node:fs';
import { createTape } from '../../app/src/input/tape.js';
import { createClock } from '../../app/src/engine/clock.js';
import { riffDI, rng } from '../../tools/liveroom/fake.js';

export const SR = 48000;
const WORKLET = fs.readFileSync(new URL('../../app/src/input/tape-worklet.js', import.meta.url), 'utf8');

// the worklet's file with the worklet scope's globals: { make(frames) -> processor, scope (scope.currentFrame: the
// audio clock it reads) }. (A closure's variable, as the real scope's is cheap to read: a vm context's global would
// go through an interceptor and allocate on every read, and the measure below would be of that.)
export function workletScope(sr = SR) {
  const reg = {};
  const base = class {
    constructor() {
      this.port = { onmessage: null, postMessage: () => {} };
    }
  };
  const mk = new Function(
    'AudioWorkletProcessor',
    'registerProcessor',
    'sampleRate',
    `let currentFrame = 0;\n${WORKLET}\nreturn [(f) => { currentFrame = f; }, () => currentFrame];`,
  );
  const [set, get] = mk(base, (name, cls) => (reg[name] = cls), sr);
  const scope = {
    get currentFrame() {
      return get();
    },
    set currentFrame(f) {
      set(f);
    },
  };
  return { scope, make: (frames) => new reg['ew-tape']({ processorOptions: { frames } }) };
}

// a processor and its posts, driven a quantum at a time from `signal` (frame -> sample; null: no input connected)
export function rolling(frames, sr = SR) {
  const w = workletScope(sr);
  const p = w.make(frames);
  const posts = [];
  p.port.postMessage = (m) => posts.push(m);
  const q = new Float32Array(128),
    ins = [[q]],
    none = [[]];
  return {
    p,
    posts,
    scope: w.scope,
    run(n, signal, { skip = null } = {}) {
      for (let k = 0; k < n; k++) {
        const f = w.scope.currentFrame;
        if (!skip || !skip(f)) {
          if (signal instanceof Float32Array) for (let i = 0; i < 128; i++) q[i] = signal[(f + i) % signal.length];
          else if (signal) for (let i = 0; i < 128; i++) q[i] = signal(f + i);
          p.process(signal ? ins : none);
        }
        w.scope.currentFrame = f + 128;
      }
    },
    get: (from, to) => {
      p.msg({ t: 'get', id: 1, from, to });
      return posts.findLast((m) => m.t === 'got');
    },
  };
}

export const RIFF2 = {
  bpm: 120,
  beats: 8,
  chord: true,
  notes: [
    [0, 40, 0],
    [0.5, 40, 0],
    [1, 43, 1],
    [2.5, 40, 0],
    [3, 45, 0.5],
    [4, 40, 0],
    [4.75, 40, 0],
    [5.5, 47, 1],
    [7, 43, 0],
  ],
};

// a simulated session: the band from startT (a bar of count-in), the guitar played at `bar` with the round trip L
// late, run through the live tape on a simulated audio thread. -> { tape, sim, src (frame -> sample), lineF(beat) }
export async function session({
  riff,
  passes,
  bar = 1,
  L = 0.012,
  bpm = 120,
  startT = 0.5,
  tail = 3,
  playing = true,
  seconds = 60,
  extra = null,
  early = 0,
} = {}) {
  const spb = 60 / bpm,
    s0 = -4,
    sched = (beat) => startT + (beat - s0) * spb;
  const di = riffDI(riff, { passes, bpm, seed: 7, jitter: 0.003, solid: true, tail: 0, peak: -12 });
  const at0 = Math.round((sched((bar - 1) * 4) + L - early) * SR);
  const len = at0 + di.buf.length + Math.round(tail * SR);
  const src = new Float32Array(len);
  const rnd = rng(9);
  for (let i = 0; i < len; i++)
    src[i] =
      Math.fround(i >= at0 && i - at0 < di.buf.length ? di.buf[i - at0] : 0) + Math.fround((rnd() * 2 - 1) * 0.0004);
  if (extra) extra(src, sched, L);
  const sim = simulated(src, { spb, s0, startT, playing, L });
  const tape = createTape(sim.app, sim.input);
  tape.start({ seconds });
  await sim.ready();
  sim.roll(len);
  return { tape, sim, src, at0, lineF: (beat) => Math.round((sched(beat) + L) * SR), L, spb, sched };
}

// the browser, simulated: an audio context whose clock is the frames rolled, the worklet's file in a vm, the input
// tapped into it, an engine whose clock is a steady transport
function simulated(src, { spb, s0, startT, playing, L = 0.012 }) {
  const w = workletScope(SR);
  let proc = null,
    frame = 0;
  const ctx = {
    sampleRate: SR,
    get currentTime() {
      return frame / SR;
    },
    audioWorklet: { addModule: async () => {} },
  };
  installed.push({ had: 'AudioWorkletNode' in globalThis, prev: globalThis.AudioWorkletNode });
  globalThis.AudioWorkletNode = class {
    constructor(c, name, o) {
      this.context = c;
      proc = w.make(o.processorOptions.frames);
      this.port = { onmessage: null, postMessage: (m) => proc.msg(m) };
      proc.port.postMessage = (m) => this.port.onmessage && this.port.onmessage({ data: m });
    }
    disconnect() {}
  };
  const gridAt = (t) => s0 + (t - startT) / spb;
  const clock = createClock({
    now: () => ctx.currentTime,
    playing: () => playing,
    bpm: () => 60 / spb,
    beatsPerBar: () => 4,
    gridAt,
    timeAtGrid: (g) => startT + (g - s0) * spb,
    songBeatAt: (t) => (t <= startT ? s0 : gridAt(t)),
  });
  const listeners = new Map();
  const audio = {
    state: { open: true },
    ctx,
    latency: { get: () => L },
    tap: () => () => {},
  };
  const engine = {
    ctx,
    get playing() {
      return playing;
    },
    gen: 1,
    clock,
    latency: { total: 0 },
    assets: { put: async (id, d) => (engine.stored[id] = d) },
    stored: {},
    on: () => () => {},
  };
  const app = { engine, store: { get: () => ({ loop: { on: false } }) } };
  const input = {
    audio,
    on: (e, fn) => {
      listeners.set(e, fn);
      return () => listeners.delete(e);
    },
  };
  const q = new Float32Array(128),
    ins = [[q]];
  return {
    app,
    input,
    engine,
    async ready() {
      for (let i = 0; i < 10 && !proc; i++) await new Promise((r) => setImmediate(r));
    },
    roll(n) {
      const end = frame + n;
      while (frame < end) {
        for (let i = 0; i < 128; i++) q[i] = src[frame + i] || 0;
        w.scope.currentFrame = frame;
        proc.process(ins);
        frame += 128;
      }
    },
  };
}

// simulated() installs a fake globalThis.AudioWorkletNode (the tape builds its node from it); this puts back what was there
const installed = [];
export function restoreWorkletNode() {
  while (installed.length) {
    const { had, prev } = installed.pop();
    if (had) globalThis.AudioWorkletNode = prev;
    else delete globalThis.AudioWorkletNode;
  }
}
