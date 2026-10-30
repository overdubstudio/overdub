// What the guitar amps are measured by: the numbers in tools/fixtures/amp-voices.json (the graph amps as they were,
// rendered once in Chromium by tools/amp-voices.js), and the same numbers for the kernel amps (devices/guitar/
// voicings.js), so the two can be held side by side. Plain functions of Float32Arrays at 48 kHz.
//   halfOct(x)        half-octave band levels, 40 Hz to 14.5 kHz (18 bands), dB (averaged Hann periodograms, 8192)
//   thirds(x)         third-octave band levels, 25 Hz to 20 kHz (30 bands), dB
//   shape(a, b)       a against b over 100 Hz-8 kHz, their mean difference taken out (loudness matched): { rms, max, d }
//   thd(y, f0)        a sine's harmonics against it, %, over the last 65,536 samples (Blackman-Harris)
//   alias(y, f0, top) what isn't a harmonic of a sine at f0, dB re its harmonics, 20 Hz to `top`
//   share(x, lo, hi)  the energy between lo and hi Hz as a share of 40 Hz-12 kHz, dB (what a tone knob moves)
//   clawdLufs(L, R)   clawd-o-matic's loudness (tools/guitar-test.js's, without the band's soft clip)
//   sine(f, dB, secs) a sine moved onto a bin of the 65,536-point spectrum
import { psd, fft } from './amp-scenes.js';

export const SR = 48000;
export const HALF = Array.from({ length: 18 }, (_, k) => 40 * Math.pow(2, k / 2));
export const THIRD = Array.from({ length: 30 }, (_, k) => 25 * Math.pow(2, k / 3));
const bands = (cen, w) => (x) => {
  const p = psd(x), N = 8192;
  return cen.map((fc) => {
    let s = 0;
    for (let k = 1; k < N / 2; k++) { const f = (k * SR) / N; if (f >= fc / w && f < fc * w) s += p[k]; }
    return Math.round(100 * 10 * Math.log10(s + 1e-30)) / 100;
  });
};
export const halfOct = bands(HALF, Math.pow(2, 0.25));
export const thirds = bands(THIRD, Math.pow(2, 1 / 6));
export function shape(a, b, cen = HALF, lo = 100, hi = 8000) {
  const d = a.map((v, i) => v - b[i]), sel = cen.map((f) => f >= lo && f <= hi);
  const ds = d.filter((_, i) => sel[i]), m = ds.reduce((s, v) => s + v, 0) / ds.length;
  const r = ds.map((v) => v - m);
  return { rms: Math.sqrt(r.reduce((s, v) => s + v * v, 0) / r.length), max: Math.max(...r.map(Math.abs)), d: d.map((v) => Math.round(10 * (v - m)) / 10) };
}
function bh(y, N = 65536) {
  const re = new Float64Array(N), im = new Float64Array(N), o = y.length - N;
  for (let i = 0; i < N; i++) { const u = (2 * Math.PI * i) / N; re[i] = y[o + i] * (0.35875 - 0.48829 * Math.cos(u) + 0.14128 * Math.cos(2 * u) - 0.01168 * Math.cos(3 * u)); }
  fft(re, im);
  return (b) => re[b] * re[b] + im[b] * im[b];
}
const binOf = (f, N = 65536) => Math.round((f * N) / SR);
export function thd(y, f0 = 196) {
  const P = bh(y), b0 = binOf(f0);
  let fund = 0, h = 0;
  for (let d = -4; d <= 4; d++) fund += P(b0 + d);
  for (let k = 2; k * b0 < 32768 - 4; k++) for (let d = -4; d <= 4; d++) h += P(k * b0 + d);
  return 100 * Math.sqrt(h / fund);
}
export function alias(y, f0, top = 24000) {
  const N = 65536, P = bh(y, N), bin = binOf(f0), harm = new Uint8Array(N / 2);
  for (let k = 0; k * bin < N / 2 + 4; k++) for (let d = -4; d <= 4; d++) { const b = k * bin + d; if (b >= 0 && b < N / 2) harm[b] = 1; }
  let h = 0, o = 0;
  for (let b = Math.ceil((20 * N) / SR); b < Math.min(N / 2, (top * N) / SR); b++) { const pw = P(b); if (harm[b]) h += pw; else o += pw; }
  return 10 * Math.log10(o / h);
}
export function share(x, lo, hi) {
  const p = psd(x), N = 8192;
  let a = 0, t = 0;
  for (let k = 1; k < N / 2; k++) { const f = (k * SR) / N; if (f < 40 || f > 12000) continue; t += p[k]; if (f >= lo && f < hi) a += p[k]; }
  return 10 * Math.log10(a / t);
}
// the band each tone knob works on (GAIN: loudness)
export const KNOB_BAND = { bass: [40, 250], mid: [400, 1200], treble: [2500, 12000], presence: [2500, 12000] };
export function clawdLufs(L, R = L, from = 0.5) {
  const hs = () => {
    const sr = 44100, w = (2 * Math.PI * 1500) / sr, c = Math.cos(w), s = Math.sin(w), A = Math.pow(10, 4 / 40), sA = 2 * Math.sqrt(A) * (s / 2) * Math.SQRT2;
    const b0 = A * (A + 1 + (A - 1) * c + sA), b1 = -2 * A * (A - 1 + (A + 1) * c), b2 = A * (A + 1 + (A - 1) * c - sA), a0 = A + 1 - (A - 1) * c + sA, a1 = 2 * (A - 1 - (A + 1) * c), a2 = A + 1 - (A - 1) * c - sA;
    const f = { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0, z1: 0, z2: 0 };
    return (x) => { const y = f.b0 * x + f.z1; f.z1 = f.b1 * x - f.a1 * y + f.z2; f.z2 = f.b2 * x - f.a2 * y; return y; };
  };
  const hp = () => {
    const g = Math.tan((Math.PI * 38) / 44100), k = 1 / 0.5, a1 = 1 / (1 + g * (g + k)), a2 = g * a1, a3 = g * a2;
    let s1 = 0, s2 = 0;
    return (x) => { const v3 = x - s2, v1 = a1 * s1 + a2 * v3, v2 = s2 + a2 * s1 + a3 * v3; s1 = 2 * v1 - s1; s2 = 2 * v2 - s2; return x - k * v1 - v2; };
  };
  const sl = hs(), sr = hs(), hl = hp(), hr = hp();
  let ms = 0;
  const a = Math.round(from * SR), b = L.length;
  for (let i = a; i < b; i++) { const l = hl(sl(L[i])), r = hr(sr(R[i])); ms += l * l + r * r; }
  return -0.691 + 10 * Math.log10(ms / Math.max(1, b - a) + 1e-12);
}
export function sine(f, db, secs) {
  const N = 65536, bin = Math.round((f * N) / SR), ff = (bin * SR) / N, a = Math.pow(10, db / 20), x = new Float32Array(Math.round(secs * SR));
  for (let i = 0; i < x.length; i++) x[i] = a * Math.sin((2 * Math.PI * ff * i) / SR);
  return x;
}
// the lag (samples) of b behind a that best lines them up, within ±max, over 1 s to 3 s
export function lagOf(a, b, max = 400) {
  let best = 0, bv = -Infinity;
  for (let L = -max; L <= max; L++) { let s = 0; for (let i = SR; i < SR * 3; i++) s += a[i] * (b[i + L] || 0); if (s > bv) { bv = s; best = L; } }
  return best;
}
