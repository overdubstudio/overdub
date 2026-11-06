// The sampled-instrument test kit (every sample a sine at a known frequency) and the helpers that play it through the
// sampler kernel and read it back. Shared by test/unit/sampler.test.js and tools/sampler-test.js. Not a test file.
import { encodeOdk, decodeOdk } from '../../app/src/kernel/odk.js';
import { kernelCore, kernelCompiler } from '../../app/src/kernel/worklet.js';
import { makeDsp } from '../../app/src/kernel/dsp.js';
import { normParam, paramValues } from '../../app/src/devices/registry.js';
import { samplerKernel, samplerParams } from '../../app/src/devices/builtin/sampler.js';

export const db = (x) => (x > 0 ? 20 * Math.log10(x) : -200);

// ------------------------------------------------------------------------------------------------ a test kit
// Every sample is a sine (or two) at a known frequency, 48 kHz, so the kernel's output can be read back exactly:
//   key 60 (C4, 261.63 Hz), keys 55-66: a soft layer (vel 0-63, 2 round robins: 261.63 Hz and the same with a
//     2nd harmonic marker at 3x) and a hard layer (vel 64-127: 261.63 Hz plus a 5x marker)
//   key 72, keys 67-80, one layer, tuned 30 cents flat on record (tune: +30 puts it right)
//   key 48, keys 40-54: 1.0 s with a sustain loop over its last 0.5 s
//   a release sample for keys 55-66: 1.5 kHz, 0.3 s
//   key 84, keys 81-96: a 6 kHz tone, `cutoff` 2 kHz (filtered: much quieter than without)
//   key 100, keys 97-127: a 15 kHz tone (the interpolator's bright test)
export const SR = 48000;
export const tone = (secs, parts, fade = 0.02) => {
  const n = Math.round(secs * SR),
    x = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    let v = 0;
    for (const [f, a] of parts) v += a * Math.sin((2 * Math.PI * f * i) / SR);
    const g = Math.min(1, i / (0.002 * SR), (n - i) / (fade * SR));
    x[i] = Math.round(v * g * 16000);
  }
  return x;
};
export const C4 = 261.6255653005986;
export const st = (s) => [tone(s[0], s[1], s[2]), tone(s[0], s[1], s[2])];
export const SAMPLES = [
  { id: 'c4.soft.0', key: 60, lo: 55, hi: 66, vlo: 0, vhi: 63, rr: 0, ch: st([2, [[C4, 1]]]) },
  {
    id: 'c4.soft.1',
    key: 60,
    lo: 55,
    hi: 66,
    vlo: 0,
    vhi: 63,
    rr: 1,
    ch: st([
      2,
      [
        [C4, 1],
        [3 * C4, 0.3],
      ],
    ]),
  },
  {
    id: 'c4.hard',
    key: 60,
    lo: 55,
    hi: 66,
    vlo: 64,
    vhi: 127,
    gain: 0,
    ch: st([
      2,
      [
        [C4, 1],
        [5 * C4, 0.3],
      ],
    ]),
  },
  { id: 'c5', key: 72, lo: 67, hi: 80, tune: 30, ch: st([2, [[2 * C4 * Math.pow(2, -30 / 1200), 1]]]) },
  {
    id: 'c3.loop',
    key: 48,
    lo: 40,
    hi: 54,
    loop: { s: 24000, e: 48000, mode: 'sustain' },
    ch: st([1, [[C4 / 2, 1]], 0]),
  },
  { id: 'c4.rel', key: 60, lo: 55, hi: 66, trig: 'release', ch: st([0.3, [[1500, 0.5]]]) },
  { id: 'c6.lp', key: 84, lo: 81, hi: 96, cutoff: 2000, ch: st([1, [[6000, 1]]]) },
  { id: 'bright', key: 100, lo: 97, hi: 127, ch: st([1, [[15000, 1]]]) },
];
export const kitBytes = encodeOdk({
  name: 'Sine Test',
  sr: SR,
  bits: 16,
  channels: 2,
  meta: { kind: 'melodic', rt: { decay: 6 } },
  samples: SAMPLES,
});
export const KIT = decodeOdk(kitBytes);

export const PARAMS = samplerParams().map(normParam);
export const SRC = samplerKernel({ makeup: 1, poly: 8, xfade: 6, law: 'linear' }); // (the test kit's layers are in phase: their amplitudes add)
export function play(
  events,
  { secs = 2, sr = SR, params = {}, seed = 1, kit = KIT, src = SRC, poly = 8, specs = PARAMS } = {},
) {
  const Core = kernelCore(sr, makeDsp(sr), kernelCompiler);
  const out = [];
  const c = new Core(
    {
      source: src,
      kind: 'instrument',
      params: specs,
      values: paramValues({ params: specs }, params),
      poly,
      seed,
      tail: 4,
      data: { kit },
    },
    (m) => out.push(m),
  );
  const err = out.find((m) => m.type === 'error');
  if (err) throw new Error(err.message);
  for (const e of events) c.msg({ ...e, time: e.time || 0 });
  const n = Math.ceil((secs * sr) / 128) * 128,
    L = new Float32Array(n),
    R = new Float32Array(n);
  const bl = new Float32Array(128),
    br = new Float32Array(128);
  for (let f = 0; f < n; f += 128) {
    bl.fill(0);
    br.fill(0);
    c.block(null, null, bl, br, f);
    L.set(bl, f);
    R.set(br, f);
  }
  out.length = 0;
  c.msg({ type: 'stats' });
  return { sr, channels: [L, R], length: n, stats: out.find((m) => m.type === 'stats'), core: c };
}
export const on = (p, v, time = 0) => ({ type: 'on', p, v, time });
export const off = (p, time) => ({ type: 'off', p, time });
export const rms = (x, a, b, sr = SR) => {
  let e = 0;
  const i0 = Math.round(a * sr),
    i1 = Math.min(x.length, Math.round(b * sr));
  for (let i = i0; i < i1; i++) e += x[i] * x[i];
  return Math.sqrt(e / Math.max(1, i1 - i0));
};
// the amplitude of frequency f in x[a s..b s] (a Hann-windowed single-bin DFT)
export const amp = (x, f, a, b, sr = SR) => {
  const i0 = Math.round(a * sr),
    i1 = Math.round(b * sr),
    N = i1 - i0;
  let re = 0,
    im = 0,
    w = 0;
  for (let i = 0; i < N; i++) {
    const h = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N);
    re += x[i0 + i] * h * Math.cos((2 * Math.PI * f * i) / sr);
    im += x[i0 + i] * h * Math.sin((2 * Math.PI * f * i) / sr);
    w += h;
  }
  return (2 * Math.hypot(re, im)) / w;
};
// the frequency of the strongest partial near f0 (a fine search over a single-bin DFT), in Hz
export const peakHz = (x, f0, a, b, sr = SR) => {
  let best = f0,
    bv = 0;
  for (let c = -60; c <= 60; c += 0.25) {
    const f = f0 * Math.pow(2, c / 1200),
      v = amp(x, f, a, b, sr);
    if (v > bv) {
      bv = v;
      best = f;
    }
  }
  return best;
};
export const cents = (f, ref) => 1200 * Math.log2(f / ref);
