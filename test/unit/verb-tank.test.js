// The reverbs' tank (the 'verb-tank' worklet: app/src/devices/guitar/gear/worklets/verb-tank.js, VERB_TANK in
// gear/code.js), run in Node on a stand-in for the worklet scope: DECAY is the T60 a plate and a hall ring for (the
// 1 kHz octave, from the first echo), at short and long settings; a seed plays the same every time and another seed
// doesn't; nothing goes non-finite at the knobs' ends; Halo Jelly's shimmer at its top (an octave and a fifth, DECAY
// at 8 s) blooms and dies; with nothing coming in and nothing ringing it outputs exact zeros; DECAY moved while it
// rings doesn't jump.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const SR = 48000;
const file = fs.readFileSync(
  new URL('../../app/src/devices/guitar/gear/worklets/verb-tank.js', import.meta.url),
  'utf8',
);
const reg = {};
new Function('AudioWorkletProcessor', 'registerProcessor', 'sampleRate', file.slice(file.indexOf('\n') + 1))(
  class {
    constructor() {
      this.port = { onmessage: null, postMessage() {} };
    }
  },
  (name, C) => {
    reg[name] = C;
  },
  SR,
);
const Tank = reg['verb-tank'];

// run the tank: opts (processorOptions), params (k-rate, or a function of the block's start sample), secs, the input
// (a function of the sample; an impulse by default); returns [L, R]
function run(opts, params, secs, input = (i) => (i === 0 ? 1 : 0)) {
  const node = new Tank({ processorOptions: opts }),
    n = Math.round(secs * SR);
  const pd = {};
  const L = new Float64Array(n),
    R = new Float64Array(n),
    x = new Float32Array(128),
    oL = new Float32Array(128),
    oR = new Float32Array(128);
  for (let b = 0; b < n; b += 128) {
    const p = typeof params === 'function' ? params(b) : params;
    for (const d of Tank.parameterDescriptors) pd[d.name] = new Float32Array([p[d.name] ?? d.defaultValue]);
    for (let i = 0; i < 128; i++) x[i] = input(b + i);
    node.process([[x]], [[oL, oR]], pd);
    for (let i = 0; i < 128 && b + i < n; i++) {
      L[b + i] = oL[i];
      R[b + i] = oR[i];
    }
  }
  return [L, R];
}

// RBJ band-pass at fc, twice; T30 from the Schroeder curve of both channels
function bandpass(x, fc) {
  const w = (2 * Math.PI * fc) / SR,
    al = Math.sin(w) / (2 * 1.414),
    a0 = 1 + al,
    b0 = al / a0,
    a1 = (-2 * Math.cos(w)) / a0,
    a2 = (1 - al) / a0;
  let y = x;
  for (let pass = 0; pass < 2; pass++) {
    let x1 = 0,
      x2 = 0,
      y1 = 0,
      y2 = 0;
    const o = new Float64Array(y.length);
    for (let i = 0; i < y.length; i++) {
      const v = b0 * y[i] - b0 * x2 - a1 * y1 - a2 * y2;
      x2 = x1;
      x1 = y[i];
      y2 = y1;
      y1 = v;
      o[i] = v;
    }
    y = o;
  }
  return y;
}
function t30(hs) {
  const n = hs[0].length,
    edc = new Float64Array(n);
  let s = 0;
  for (let i = n - 1; i >= 0; i--) {
    s += hs[0][i] * hs[0][i] + hs[1][i] * hs[1][i];
    edc[i] = s;
  }
  const db = (i) => 10 * Math.log10(edc[i] / edc[0] + 1e-300);
  let a = -1,
    b = -1;
  for (let i = 0; i < n; i++) {
    const d = db(i);
    if (a < 0 && d <= -5) a = i;
    if (d <= -35) {
      b = i;
      break;
    }
  }
  let sx = 0,
    sy = 0,
    sxx = 0,
    sxy = 0,
    k = 0;
  for (let i = a; i <= b; i += 4) {
    const t = i / SR,
      d = db(i);
    sx += t;
    sy += d;
    sxx += t * t;
    sxy += t * d;
    k++;
  }
  return -60 / ((k * sxy - sx * sy) / (k * sxx - sx * sx));
}
const rms = (hs, a, b) => {
  let s = 0;
  for (const h of hs) for (let i = Math.round(a * SR); i < Math.round(b * SR); i++) s += h[i] * h[i];
  return 10 * Math.log10(s / ((b - a) * SR * hs.length) + 1e-300);
};
const PLATE = { algo: 'plate', seed: 7, early: 0.4 },
  HALL = { algo: 'hall', seed: 7, scale: 1.3, early: 0.25, er: 0.3 };

describe('verb-tank: DECAY is the T60', () => {
  for (const [name, opts, T] of [
    ['plate', PLATE, 0.5],
    ['plate', PLATE, 2.7],
    ['hall', HALL, 1.8],
    ['hall', HALL, 4.9],
  ]) {
    test(`a ${name} at ${T} s rings ${T} s at 1 kHz (±10%)`, () => {
      const hs = run(opts, { decay: T }, T + 1.5).map((h) => bandpass(h, 1000));
      const got = t30(hs);
      assert.ok(Math.abs(got / T - 1) <= 0.1, `T30 ${got.toFixed(2)} s`);
    });
  }
});

describe('verb-tank: seeded', () => {
  test('a seed plays the same every time, another seed does not', () => {
    const a = run(HALL, { decay: 3 }, 1),
      b = run(HALL, { decay: 3 }, 1),
      c = run({ ...HALL, seed: 8 }, { decay: 3 }, 1);
    assert.deepEqual(a[0], b[0]);
    assert.deepEqual(a[1], b[1]);
    let d = 0;
    for (let i = 0; i < a[0].length; i++) d = Math.max(d, Math.abs(a[0][i] - c[0][i]));
    assert.ok(d > 1e-4, `another seed differs by ${d}`);
  });
});

describe('verb-tank: the ends of the knobs', () => {
  test('finite at the shortest and longest DECAY, all highs and none, on a full-scale square', () => {
    const sq = (i) => (Math.floor(i / 100) % 2 ? 0.99 : -0.99);
    for (const p of [
      { decay: 0.05, hf: 0 },
      { decay: 40, hf: 1 },
      { decay: 40, hf: 0.05, shim: 2, ratio: 4 },
    ]) {
      for (const opts of [PLATE, HALL, { ...HALL, shimmer: true }]) {
        const hs = run(opts, p, 2, sq);
        for (const h of hs)
          for (const v of h) assert.ok(Number.isFinite(v) && Math.abs(v) < 64, `${JSON.stringify(p)} ${v}`);
      }
    }
  });
  test("Halo Jelly's shimmer at its top (an octave 1.7, a fifth 1), DECAY at 8 s: it blooms and dies", () => {
    for (const [shim, ratio] of [
      [1.7, 2],
      [1, 1.5],
    ]) {
      const strum = (i) => (i < 2 * SR ? 0.3 * Math.sin(i * 0.05) * Math.exp(-(i % 24000) / 8000) : 0);
      const hs = run(
        { algo: 'hall', seed: 3, scale: 1.1, pre: 0.02, bw: 0.1, early: 0.3, shimmer: true },
        { decay: 8, shim, ratio, hf: 0.8 },
        30,
        strum,
      );
      let top = -Infinity;
      for (let s = 0; s < 28; s++) top = Math.max(top, rms(hs, s, s + 1));
      assert.ok(top - rms(hs, 28, 29) > 30, `${ratio}: ${(top - rms(hs, 28, 29)).toFixed(1)} dB down after 26 s`);
    }
  });
});

describe('verb-tank: idle and moving', () => {
  test('with nothing in and nothing ringing it outputs exact zeros, and plays again when something comes', () => {
    const hs = run(PLATE, { decay: 0.3 }, 4, (i) => (i === 0 || i === 3 * SR ? 1 : 0));
    for (let i = Math.round(2.5 * SR); i < 3 * SR; i++) assert.equal(hs[0][i], 0);
    assert.ok(rms(hs, 3, 3.3) > -80);
  });
  test('DECAY swept from 0.1 to 20 s and back while it rings: no step bigger than the sound makes on its own', () => {
    const tone = (i) => 0.25 * Math.sin((2 * Math.PI * 196 * i) / SR);
    const steady = run(HALL, { decay: 20 }, 3, tone),
      swept = run(HALL, (b) => ({ decay: Math.floor(b / 6000) % 2 ? 20 : 0.1 }), 3, tone);
    const d2 = (h) => {
      let m = 0;
      for (let i = SR; i < h.length; i++) m = Math.max(m, Math.abs(h[i] - 2 * h[i - 1] + h[i - 2]));
      return m;
    };
    assert.ok(d2(swept[0]) < 1.6 * d2(steady[0]), `${d2(swept[0])} against ${d2(steady[0])}`);
  });
});
