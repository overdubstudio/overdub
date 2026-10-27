// input/tape.js, tape-core.js and tape-worklet.js: the rolling tape. The ring's wrap and its silence, its cost while
// it rolls (allocation and time per quantum, measured), the grid along the audio clock (tempo changes, loop wraps,
// a new run), the default selection on synthetic riffs, and grab: the samples exactly as they came in, placed where
// the deck would place them. The live tape runs here on a simulated audio thread: the worklet's own file in a vm with
// the worklet scope's globals, driven a quantum at a time.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import v8 from 'node:v8';
import { PerformanceObserver } from 'node:perf_hooks';
import { createTape } from '../../app/src/input/tape.js';
import { createGrid, defaultSelection, riffOps, pcm16, unpcm16, BIN } from '../../app/src/input/tape-core.js';
import { createClock } from '../../app/src/engine/clock.js';
import { createStore } from '../../app/src/core/store.js';
import { riffDI, rng } from '../../tools/liveroom/fake.js';

const SR = 48000;
const WORKLET = fs.readFileSync(new URL('../../app/src/input/tape-worklet.js', import.meta.url), 'utf8');

// the worklet's file with the worklet scope's globals: { make(frames) -> processor, scope (scope.currentFrame: the
// audio clock it reads) }. (A closure's variable, as the real scope's is cheap to read: a vm context's global would
// go through an interceptor and allocate on every read, and the measure below would be of that.)
function workletScope(sr = SR) {
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
function rolling(frames, sr = SR) {
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

describe('the ring', () => {
  test('16 bits as Chromium reads a 16-bit file: every value comes back', () => {
    for (let v = -32768; v <= 32767; v++) {
      const x = Math.fround(v < 0 ? v / 32768 : v / 32767);
      assert.equal(pcm16(x), v);
    }
    assert.equal(pcm16(1.5), 32767);
    assert.equal(pcm16(-2), -32768);
    assert.equal(unpcm16(-32768), -1);
  });

  test('it wraps: the newest frames are what it holds, to the sample, and older ones are gone', () => {
    const N = 4096 * 4,
      r = rolling(N);
    const sig = (f) => Math.fround((((f * 7919) % 65535) - 32767) / 32767);
    r.run((N * 2.5) / 128, sig);
    const head = r.p.w;
    assert.equal(head, N * 2.5);
    const got = r.get(head - N, head);
    assert.equal(got.from, head - N);
    assert.equal(got.d.length, N);
    let bad = 0;
    for (let i = 0; i < N; i++) if (got.d[i] !== pcm16(sig(head - N + i))) bad++;
    assert.equal(bad, 0);
    const old = r.get(0, head - N + 100);
    assert.equal(old.from, head - N, 'asked for frames it no longer holds: from where it does');
    assert.equal(old.d.length, 100);
  });

  test('quanta it was not run for, and no input, are silence; the peak bins say so', () => {
    const r = rolling(BIN * 64);
    r.run(40, () => 0.5, { skip: (f) => f >= 1024 && f < 2048 });
    r.run(8, null);
    const got = r.get(0, r.p.w);
    assert.equal(got.d[1023], pcm16(0.5));
    assert.equal(got.d[1024], 0);
    assert.equal(got.d[2047], 0);
    assert.equal(got.d[2048], pcm16(0.5));
    assert.equal(got.d[got.d.length - 1], 0);
    r.p.post();
    const bins = new Map();
    for (const m of r.posts.filter((x) => x.t === 'pk')) m.pk.forEach((v, i) => bins.set(m.b + i, v));
    assert.ok(Math.abs(bins.get(0) - 0.5) < 1e-4 && Math.abs(bins.get(3) - 0.5) < 1e-4);
    assert.ok(!bins.get(4) && !bins.get(7), 'the skipped bins hold nothing');
    assert.ok(!bins.get(Math.floor(r.p.w / BIN) - 1), 'nor the unplugged ones');
  });

  test('a new length keeps the newest audio', () => {
    const r = rolling(BIN * 100);
    const sig = (f) => Math.fround((f % 1000) / 1000);
    r.run(300, sig);
    const head = r.p.w;
    r.p.msg({ t: 'len', frames: BIN * 40 });
    r.run(10, sig);
    const got = r.get(0, r.p.w);
    assert.equal(got.to - got.from, BIN * 40);
    for (let i = 0; i < got.d.length; i += 97) assert.equal(got.d[i], pcm16(sig(got.from + i)));
    r.p.msg({ t: 'len', frames: BIN * 200 });
    const g2 = r.get(0, r.p.w);
    assert.equal(g2.to, head + 1280);
    assert.equal(g2.to - g2.from, BIN * 40, 'longer: what it held, no more');
  });

  test('rolling allocates nothing a quantum and costs little: measured', (t) => {
    const w = workletScope(SR),
      p = w.make(SR * 60);
    let posts = 0;
    p.port.postMessage = () => {
      posts++;
    };
    // a second of noise in quanta, made beforehand, so the loop below is the processor and nothing else
    const rnd = rng(3),
      blocks = [];
    for (let k = 0; k < 375; k++) {
      const q = new Float32Array(128);
      for (let i = 0; i < 128; i++) q[i] = (rnd() * 2 - 1) * 0.3;
      blocks.push([[q]]);
    }
    const sc = w.scope;
    const roll = (n) => {
      for (let k = 0; k < n; k++) {
        p.process(blocks[k % 375]);
        sc.currentFrame += 128;
      }
    };
    roll(20000); // (warm: compiled)
    let gcs = 0;
    const obs = new PerformanceObserver((l) => {
      gcs += l.getEntries().length;
    });
    obs.observe({ entryTypes: ['gc'] });
    let best = null;
    for (let tries = 0; tries < 6 && best == null; tries++) {
      const g0 = gcs,
        p0 = posts,
        h0 = v8.getHeapStatistics().used_heap_size;
      const t0 = process.hrtime.bigint();
      roll(22500); // a minute of audio at 48 kHz
      const ns = Number(process.hrtime.bigint() - t0);
      const h1 = v8.getHeapStatistics().used_heap_size;
      if (gcs === g0 && h1 >= h0) best = { bytes: h1 - h0, ns, posts: posts - p0 };
    }
    // and with the peaks held back (no posts): what a quantum itself allocates
    p.post = function () {
      this.np = 0;
    };
    roll(2000);
    let held = null;
    for (let tries = 0; tries < 6; tries++) {
      const g0 = gcs,
        h0 = v8.getHeapStatistics().used_heap_size;
      roll(22500);
      const h1 = v8.getHeapStatistics().used_heap_size;
      if (gcs === g0 && h1 >= h0) held = Math.min(held ?? Infinity, h1 - h0);
    }
    obs.disconnect();
    assert.ok(best && held != null, 'a minute rolled with no collection in between, to measure it by');
    const perQ = best.bytes / 22500,
      us = best.ns / 22500 / 1000;
    t.diagnostic(
      `a minute of audio: ${best.bytes} bytes allocated (${perQ.toFixed(2)} a quantum, all of it the ${best.posts} peak posts, one every 32 quanta), ${us.toFixed(2)} µs a quantum (${((us / ((128 / SR) * 1e6)) * 100).toFixed(2)}% of its 2.67 ms)`,
    );
    t.diagnostic(`the same minute with the peak posts held: ${held} bytes (${(held / 22500).toFixed(3)} a quantum)`);
    assert.ok(perQ < 16, `less than an object a quantum, the posts included (${perQ.toFixed(2)} bytes)`);
    assert.ok(held / 22500 < 1, `nothing a quantum without them (${held} bytes in a minute)`);
    assert.ok(us < 60, `a quantum in well under its time (${us.toFixed(2)} µs)`);
  });
});

/* ------------------------------------------------------------------------------------- the grid */
// a transport: { startT, s0, spb, bpb, gen, loop? } read as the engine's clock would be
function transport(o) {
  const g = (t) => o.s0 + (t - o.startT) / o.spb;
  return {
    mark(grid, t) {
      const gg = g(t);
      let s = t <= o.startT ? o.s0 : gg;
      if (o.loop && s >= o.loop.end) s = o.loop.start + ((s - o.loop.start) % (o.loop.end - o.loop.start));
      grid.mark({
        t,
        on: gg >= s - 1e-6 && t >= o.startT - 1e-9,
        gen: o.gen,
        g: gg,
        s,
        spb: o.spb,
        bpb: o.bpb || 4,
        t0: o.startT,
        g0: o.s0,
        ls: o.loop ? o.loop.start : NaN,
        le: o.loop ? o.loop.end : NaN,
      });
    },
  };
}

describe('the grid', () => {
  test('a count-in and a run: beats and bar lines where the transport had them', () => {
    const grid = createGrid();
    const tr = transport({ startT: 1, s0: -4, spb: 0.5, gen: 1 });
    for (let t = 0.13; t < 12; t += 0.1) tr.mark(grid, t);
    assert.equal(grid.at(0.5), null, 'before the run');
    const x = grid.at(3);
    assert.ok(Math.abs(x.s - 0) < 1e-9 && x.bpb === 4 && x.spb === 0.5);
    assert.ok(Math.abs(grid.timeOf(8, 6) - 7) < 1e-9);
    const ls = grid.lines(0, 6);
    assert.deepEqual(
      ls.map((l) => [Math.round(l.t * 1e6) / 1e6, l.bar]),
      [
        [1, 0],
        [3, 1],
        [5, 2],
      ],
    );
    assert.equal(grid.pieces().length, 1, 'one tempo, one piece');
  });

  test('a tempo change starts a piece where the old line meets the new one', () => {
    const grid = createGrid();
    const a = transport({ startT: 0, s0: 0, spb: 0.5, gen: 1 });
    for (let t = 0.05; t < 4.0; t += 0.1) a.mark(grid, t);
    // at t = 4.02 (beat 8.04) it goes to 150 bpm; read next at 4.05
    const tc = 4.02,
      gc = 8.04,
      spb2 = 0.4;
    for (let t = 4.05; t < 8; t += 0.1) {
      const g = gc + (t - tc) / spb2;
      grid.mark({ t, on: true, gen: 1, g, s: g, spb: spb2, bpb: 4, t0: 0, g0: 0 });
    }
    const p = grid.pieces();
    assert.equal(p.length, 2);
    assert.ok(Math.abs(p[1].ta - tc) < 1e-9, `the change found at ${p[1].ta}`);
    assert.ok(Math.abs(grid.at(4.01).s - (8 + 0.01 / 0.5)) < 1e-9);
    assert.ok(Math.abs(grid.at(6).s - (gc + (6 - tc) / spb2)) < 1e-9);
  });

  test('a loop wraps the song beat, never the grid; bar lines number the song', () => {
    const grid = createGrid();
    const tr = transport({ startT: 0, s0: 0, spb: 0.5, gen: 1, loop: { start: 4, end: 12 } });
    for (let t = 0.05; t < 14; t += 0.1) tr.mark(grid, t);
    // song beat 12 -> 4 at t = 6 and again at t = 10
    assert.ok(Math.abs(grid.at(5.9).s - 11.8) < 1e-9);
    assert.ok(Math.abs(grid.at(6.1).s - 4.2) < 1e-9);
    assert.ok(Math.abs(grid.at(6.1).g - 12.2) < 1e-9);
    const bars = grid.lines(0, 12).map((l) => l.bar);
    assert.deepEqual(bars, [1, 2, 3, 2, 3, 2]);
    assert.ok(Math.abs(grid.timeOf(4, 11) - 10) < 1e-9, 'beat 4 nearest t = 11 is the second wrap');
  });

  test('a stop, then a run from elsewhere: two runs, nothing between', () => {
    const grid = createGrid();
    const a = transport({ startT: 0, s0: 0, spb: 0.5, gen: 1 });
    for (let t = 0.05; t < 3; t += 0.1) a.mark(grid, t);
    grid.mark({ t: 3.0, on: false });
    for (let t = 3.05; t < 5; t += 0.1) grid.mark({ t, on: false });
    const b = transport({ startT: 5.2, s0: 16, spb: 0.6, gen: 2 });
    for (let t = 5.0; t < 9; t += 0.1) b.mark(grid, t);
    assert.equal(grid.at(4), null);
    assert.ok(Math.abs(grid.at(2).s - 4) < 1e-9);
    assert.ok(Math.abs(grid.at(5.2).s - 16) < 1e-9, 'the new run from its start');
    assert.equal(grid.at(6).gen, 2);
    assert.equal(grid.timeOf(2, 6), null, 'beat 2 is not in the run playing at t = 6');
  });
});

/* ------------------------------------------------------------------------------------- the default selection */
const RIFF2 = {
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
const BAR1 = {
  bpm: 120,
  beats: 4,
  notes: [
    [0, 40, 0],
    [1, 40, 0],
    [1.5, 43, 0],
    [2, 40, 0],
    [3, 45, 0.5],
  ],
};

// a simulated session: the band from startT (a bar of count-in), the guitar played at `bar` with the round trip L
// late, run through the live tape on a simulated audio thread. -> { tape, sim, src (frame -> sample), lineF(beat) }
async function session({
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

describe('that was the one', () => {
  test('four bars of a two-bar riff, then silence: the four bars, on their lines', async () => {
    const s = await session({ riff: RIFF2, passes: 2 });
    const sel = await s.tape.select();
    assert.ok(sel && sel.snapped, JSON.stringify(sel));
    assert.deepEqual(sel.beats, { from: 0, to: 16 });
    assert.equal(sel.bars, 4);
    assert.equal(sel.bar, 1);
    assert.ok(Math.abs(sel.from - s.lineF(0)) <= 1 && Math.abs(sel.to - s.lineF(16)) <= 1, `${sel.from} ${s.lineF(0)}`);
    s.tape.stop();
  });

  test('sixteen bars of it: the last pass that repeats the one before, two bars', async () => {
    const s = await session({ riff: RIFF2, passes: 8 });
    const sel = await s.tape.select();
    assert.equal(sel.why, 'repeat');
    assert.deepEqual(sel.beats, { from: 56, to: 64 });
    s.tape.stop();
  });

  test('a one-bar riff over and over: never under two bars', async () => {
    const s = await session({ riff: BAR1, passes: 9 });
    const sel = await s.tape.select();
    assert.equal(sel.why, 'repeat');
    assert.equal(sel.bars, 2);
    assert.equal(sel.beats.to, 36);
    s.tape.stop();
  });

  test('a lone hit on the next downbeat is the ending, not a bar; an attack a hair early is on its line', async () => {
    const hit = {
      bpm: 120,
      beats: 4,
      chord: true,
      notes: [[0, 40, 2]],
    };
    const s = await session({
      riff: RIFF2,
      passes: 2,
      bar: 3,
      early: 0.02,
      extra: (src, sched, L) => {
        const d = riffDI(hit, { passes: 1, seed: 3, tail: 0, peak: -12 }).buf,
          a = Math.round((sched(24) + L) * SR);
        for (let i = 0; i < d.length && a + i < src.length; i++) src[a + i] += d[i];
      },
    });
    const sel = await s.tape.select();
    assert.deepEqual(sel.beats, { from: 8, to: 24 }, JSON.stringify(sel));
    s.tape.stop();
  });

  test('with no band playing: from just before the first attack to where it rang out', async () => {
    const s = await session({ riff: BAR1, passes: 2, playing: false });
    const sel = await s.tape.select();
    assert.equal(sel.snapped, false);
    assert.equal(sel.beats, null);
    assert.ok(sel.from < s.at0 && s.at0 - sel.from < 0.05 * SR, `${(s.at0 - sel.from) / SR} s before`);
    // (the last note at 3.5 s rings a quarter second)
    assert.ok(sel.to > s.at0 + 3.75 * SR && sel.to < s.at0 + 4.5 * SR, `to ${(sel.to - s.at0) / SR} s in`);
    s.tape.stop();
  });

  test('nothing on tape: no selection', () => {
    assert.equal(defaultSelection({ onsets: [], sr: SR, head: 1000 }), null);
  });
});

describe('grab', () => {
  test('the samples as they came in, from the lead before the line, placed where the deck puts a take', async () => {
    const s = await session({ riff: RIFF2, passes: 2, L: 0.0173 });
    const sel = await s.tape.select();
    const g = await s.tape.grab(sel);
    assert.ok(g.ok, g.error);
    const lead = Math.round(0.03 * SR);
    assert.equal(g.frames.at, sel.from);
    assert.equal(g.frames.from, sel.from - lead);
    assert.equal(g.data.length, sel.to - sel.from + lead);
    let bad = 0;
    for (let i = 0; i < g.data.length; i++)
      if (g.data[i] !== Math.fround(unpcm16(pcm16(s.src[g.frames.from + i])))) bad++;
    assert.equal(bad, 0, 'every sample, as the 16-bit tape had it');
    // the deck's rule: the input frame of song beat b is (its scheduled time + the round trip) × the rate
    assert.ok(Math.abs(g.frames.at - s.lineF(0)) <= 1, `the line at ${g.frames.at}, the deck's at ${s.lineF(0)}`);
    assert.deepEqual(
      [g.place.from, g.place.to, g.place.beats, g.place.bars, g.place.bpm, g.place.bpb],
      [0, 16, 16, 4, 120, 4],
    );
    assert.ok(Math.abs(g.place.start - -0.03 / s.spb) < 1e-4, `the lead in beats: ${g.place.start}`);
    assert.ok(Math.abs(g.place.length - (16 + 0.03 / s.spb)) < 1e-4);
    assert.deepEqual(Object.keys(g.asset).sort(), ['channels', 'duration', 'id', 'kind', 'name', 'sr']);
    assert.equal(g.asset.sr, SR);
    assert.ok(s.sim.engine.stored[g.asset.id], 'in engine.assets');
    s.tape.stop();
  });

  test('handles dragged anywhere: the frames asked for, no lead past the tape', async () => {
    const s = await session({ riff: BAR1, passes: 3 });
    const sp = s.tape.span();
    const g = await s.tape.grab({ from: sp.from + 100, to: sp.from + 4900 }, { put: false });
    assert.equal(g.data.length, 4900, 'the lead only as far back as the tape goes');
    assert.equal(g.lead, 100 / SR);
    assert.equal(s.sim.engine.stored[g.asset.id], undefined);
    s.tape.stop();
  });

  test('the bar not over yet: grab waits for the tape to reach its end', async () => {
    const s = await session({ riff: BAR1, passes: 2, tail: 0.2 });
    const sp = s.tape.span();
    const want = sp.to + SR;
    const p = s.tape.grab({ from: sp.to - SR, to: want }, { put: false, lead: 0 });
    for (let k = 0; k < 20; k++) {
      await new Promise((r) => setTimeout(r, 5));
      s.sim.roll(4096);
    }
    const g = await p;
    assert.ok(g.ok);
    assert.equal(g.data.length, 2 * SR);
    s.tape.stop();
  });

  test('the tape keeps its length: 15 s of 40, to the sample', async () => {
    const s = await session({ riff: BAR1, passes: 20, seconds: 15 });
    const sp = s.tape.span();
    assert.ok(Math.abs(sp.seconds - 15) < 0.01, `${sp.seconds} s`);
    const r = await s.tape.read(sp.from, sp.to);
    let bad = 0;
    for (let i = 0; i < r.d.length; i++) if (r.d[i] !== pcm16(s.src[r.from + i])) bad++;
    assert.equal(bad, 0);
    assert.equal(s.tape.state.bytes, Math.ceil((15 * SR) / BIN) * BIN * 2);
    s.tape.stop();
  });

  test('peaks and bar lines for drawing it', async () => {
    const s = await session({ riff: RIFF2, passes: 2 });
    const sp = s.tape.span();
    const pk = s.tape.peaks(sp.from, sp.to, 400);
    assert.equal(pk.length, 400);
    const loud = Math.max(...pk);
    assert.ok(
      Math.abs(20 * Math.log10(loud) - -12) < 0.5,
      `the riff peaks at ${(20 * Math.log10(loud)).toFixed(2)} dBFS`,
    );
    const ls = s.tape.lines(sp.from, sp.to);
    const b1 = ls.find((l) => l.bar === 1);
    assert.ok(b1 && Math.abs(b1.f - s.lineF(0)) <= 1);
    assert.equal(s.tape.snap(s.lineF(0) + 900), b1.f);
    s.tape.stop();
  });

  test('a kept riff is one dispatch, its inverse exact', () => {
    const store = createStore();
    const t = store.dispatch({ type: 'track.add', ref: 'g', track: { name: 'Guitar', kind: 'audio' } }, { by: 'you' })
      .created.g;
    const before = JSON.stringify(store.get().tracks);
    const g = {
      asset: { id: 'a_test1', kind: 'audio', name: 'Riff', sr: SR, channels: 1, duration: 8.03 },
      seconds: 8.03,
      lead: 0.03,
      place: { start: -0.06, from: 0, length: 16.06, bpm: 120 },
    };
    const ops = riffOps(g, { track: t, at: 16, name: 'Riff 1' });
    const r = store.dispatch(ops, { by: 'you', label: 'keep a riff' });
    assert.ok(r.ok);
    const clip = store.get().tracks[0].clips[0];
    assert.deepEqual(
      [clip.start, clip.length, clip.offset, clip.asset, clip.name],
      [15.94, 16.06, 0, 'a_test1', 'Riff 1'],
    );
    assert.ok(store.get().assets.a_test1);
    store.undo();
    assert.equal(JSON.stringify(store.get().tracks), before);
    assert.equal(store.get().assets.a_test1, undefined);
    // at the song's beat 0, the lead goes into the offset
    const at0 = riffOps(g, { track: t, at: 0 })[1].clip;
    assert.deepEqual([at0.start, at0.offset, at0.length], [0, 0.03, 16]);
  });
});
