// Flutter Valve (core.tremolo): the def, and the kernel run in Node through the KernelCore the AudioWorklet runs.
// Gain envelopes are read off a constant input of ones: depth 0 is the input exactly, tremolo mode moves both sides
// together and pan mode opposite (their sum constant for the sine), the period follows RATE and the song's tempo (SYNC),
// a square steps over a few milliseconds with no sample-to-sample jump, and the defaults sit within 3 LU of bypass.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { kernelCore, kernelCompiler } from '../../app/src/kernel/worklet.js';
import { kernelSpecs } from '../../app/src/kernel/host.js';
import { makeDsp } from '../../app/src/kernel/dsp.js';
import { getDevice, paramValues } from '../../app/src/devices/registry.js';
import { BUILTINS, EFFECTS } from '../../app/src/devices/builtin/index.js';
import { lufs } from '../../app/src/audio/measure.js';

const SR = 48000;
const def = getDevice('core.tremolo');
const K = kernelCore(SR, makeDsp(SR), kernelCompiler);

function render(params, inL, inR = inL, bpm = 120) {
  const values = paramValues(def, params),
    errs = [];
  const c = new K(
    {
      source: def.kernel,
      kind: 'effect',
      params: kernelSpecs(def),
      values,
      seed: 1,
      transport: { bpm, playing: true, beat: 0, time: 0 },
    },
    (m) => {
      if (m.type === 'error') errs.push(m.message);
    },
  );
  c.msg({ type: 'params', values, jump: true });
  if (errs.length || !c.cur) throw new Error('core.tremolo did not compile: ' + errs.join('; '));
  const n = inL.length,
    oL = new Float32Array(n),
    oR = new Float32Array(n);
  const iL = new Float32Array(128),
    iR = new Float32Array(128),
    bL = new Float32Array(128),
    bR = new Float32Array(128);
  for (let f = 0; f < n; f += 128) {
    const m = Math.min(128, n - f);
    iL.fill(0);
    iR.fill(0);
    iL.set(inL.subarray(f, f + m));
    iR.set(inR.subarray(f, f + m));
    c.block(iL, iR, bL, bR, f);
    oL.set(bL.subarray(0, m), f);
    oR.set(bR.subarray(0, m), f);
  }
  return [oL, oR];
}
const ones = (secs) => new Float32Array(Math.round(secs * SR)).fill(1);
const sine = (secs, hz = 220, amp = 0.3) =>
  Float32Array.from({ length: Math.round(secs * SR) }, (_, i) => amp * Math.sin((2 * Math.PI * hz * i) / SR));
// seconds between upward crossings of the envelope's middle, skipping the first (settling) one
function period(g) {
  let lo = Infinity,
    hi = -Infinity;
  for (let i = Math.floor(g.length / 4); i < g.length; i++) {
    lo = Math.min(lo, g[i]);
    hi = Math.max(hi, g[i]);
  }
  const mid = (lo + hi) / 2,
    ups = [];
  for (let i = 1; i < g.length; i++) if (g[i - 1] < mid && g[i] >= mid) ups.push(i);
  return (ups[ups.length - 1] - ups[1]) / (ups.length - 2) / SR;
}
const corr = (a, b) => {
  const n = a.length;
  let ma = 0,
    mb = 0;
  for (let i = 0; i < n; i++) {
    ma += a[i];
    mb += b[i];
  }
  ma /= n;
  mb /= n;
  let s = 0,
    va = 0,
    vb = 0;
  for (let i = 0; i < n; i++) {
    s += (a[i] - ma) * (b[i] - mb);
    va += (a[i] - ma) ** 2;
    vb += (b[i] - mb) ** 2;
  }
  return s / Math.sqrt(va * vb);
};

test('registered as a built-in effect with its five params', () => {
  assert.ok(BUILTINS.some((d) => d.id === 'core.tremolo') && EFFECTS.some((d) => d.id === 'core.tremolo'));
  assert.equal(def.kind, 'effect');
  assert.deepEqual(
    def.params.map((p) => p.key),
    ['rate', 'div', 'depth', 'shape', 'mode'],
  );
  const p = Object.fromEntries(def.params.map((x) => [x.key, x]));
  assert.deepEqual(p.shape.opts, ['SINE', 'TRIANGLE', 'SQUARE']);
  assert.deepEqual(p.mode.opts, ['TREMOLO', 'PAN']);
  assert.equal(p.div.opts[0], 'FREE');
  assert.ok(p.div.opts.includes('1/4'));
  for (const x of def.params) {
    assert.ok(x.role, `${x.key} has a role`);
    if (x.opts) assert.ok(x.def >= 0 && x.def < x.opts.length);
    else assert.ok(x.def >= x.min && x.def <= x.max);
  }
});

test('depth 0 is the input, sample for sample', () => {
  const x = sine(0.5);
  for (const shape of [0, 1, 2]) {
    const [l, r] = render(
      { depth: 0, shape, mode: shape % 2 },
      x,
      x.map((v) => v * 0.5),
    );
    for (let i = 0; i < x.length; i++) assert.ok(l[i] === x[i] && r[i] === x[i] * 0.5, `sample ${i}`);
  }
});

test('tremolo mode moves both sides together; pan moves them opposite, the sine pair summing to a constant', () => {
  const [tl, tr] = render({ rate: 4, depth: 1, mode: 0 }, ones(2));
  assert.ok(corr(tl, tr) > 0.999);
  const [pl, pr] = render({ rate: 4, depth: 1, mode: 1 }, ones(2));
  assert.ok(corr(pl, pr) < -0.99, `pan correlation ${corr(pl, pr)}`);
  let lo = Infinity,
    hi = -Infinity;
  for (let i = SR / 2; i < pl.length; i++) {
    const s = pl[i] + pr[i];
    lo = Math.min(lo, s);
    hi = Math.max(hi, s);
  }
  assert.ok(hi - lo < 1e-3, `pan sum spread ${hi - lo}`);
  // one side at its loudest while the other is at its quietest
  const iMax = pl.indexOf(Math.max(...pl.subarray(SR / 2)), SR / 2);
  assert.ok(pr[iMax] < Math.min(...pr.subarray(SR / 2)) + 0.02);
});

test('the period follows RATE, and the song tempo through SYNC', () => {
  const near = (a, b) => Math.abs(a - b) < 0.005 * b;
  assert.ok(near(period(render({ rate: 4, depth: 1 }, ones(3))[0]), 0.25));
  assert.ok(near(period(render({ rate: 2, depth: 1 }, ones(4))[0]), 0.5));
  assert.ok(
    near(period(render({ div: def.params[1].opts.indexOf('1/4'), depth: 1 }, ones(4), ones(4), 120)[0]), 0.5),
    'a 1/4 at 120 bpm pulses twice a second',
  );
  assert.ok(
    near(period(render({ div: def.params[1].opts.indexOf('1/4'), depth: 1 }, ones(5), ones(5), 60)[0]), 1),
    'and once a second at 60',
  );
});

test('a square steps with no jump: each step ramps over a few milliseconds', () => {
  const [g] = render({ rate: 2, depth: 1, shape: 2 }, ones(2));
  let jump = 0,
    lo = Infinity,
    hi = -Infinity;
  for (let i = SR / 2 + 1; i < g.length; i++) {
    jump = Math.max(jump, Math.abs(g[i] - g[i - 1]));
    lo = Math.min(lo, g[i]);
    hi = Math.max(hi, g[i]);
  }
  assert.ok(jump < 0.02, `largest sample step ${jump}`);
  assert.ok(hi - lo > 0.9, `the steps still reach ${hi - lo}`);
  // from the low plateau, 10 ms after a rise the gain is 90% of the way up
  let rise = -1;
  for (let i = SR / 2 + 1; i < g.length - 1; i++)
    if (g[i] > lo + 0.5 * (hi - lo) && g[i - 1] <= lo + 0.5 * (hi - lo)) {
      rise = i;
      break;
    }
  assert.ok(rise > 0 && g[rise + Math.round(0.01 * SR)] > lo + 0.9 * (hi - lo), 'a step settles within 10 ms');
});

test('at its defaults the level is within 3 LU of bypass (and the sine, triangle and square all stay close)', () => {
  const x = sine(4);
  const ref = lufs({ sr: SR, channels: [x, x] });
  for (const shape of [0, 1, 2]) {
    const [l, r] = render({ shape }, x);
    const d = lufs({ sr: SR, channels: [l, r] }) - ref;
    assert.ok(Math.abs(d) < 3, `shape ${shape}: ${d.toFixed(2)} LU`);
  }
});
