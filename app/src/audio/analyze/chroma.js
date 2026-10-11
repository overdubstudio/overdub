// Tuning and chroma (spec 0014 R15). The treble (250-2,000 Hz) is read at 11,025 Hz (STFT 2,048 / hop 512), the bass
// (40-250 Hz) at 2,756.25 Hz (STFT 2,048 / hop 256: 1.3 Hz bins, fine enough for a low E). Each frame keeps its
// spectral peaks (a parabola through the log magnitudes for the exact frequency). Tuning first: a histogram of the
// peaks' distance from the equal-tempered grid in cents, weighed by level; its peak is how far the band sits off A440.
// Then each peak goes to its pitch class, shifted by the tuning, weighed by cos² of how far off the semitone it is.
// Chroma sums are kept as running totals, so any span's chroma is two lookups.
//
//   chromaOf(x22, sr22) -> { tuning (cents), treble, bass: { fps, frames, sum(t0, t1) -> Float64Array(12) } }
// Pure, Float64, fixed order.
import { fft } from '../../input/pitch.js';
import { resample } from './resample.js';

const N = 2048;
const hann = new Float64Array(N);
for (let i = 0; i < N; i++) hann[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N);

// the peaks of each frame between lo and hi Hz: a flat list [frame, hz, magnitude, ...]
function peaksOf(x, sr, hop, lo, hi) {
  const nb = N / 2 + 1, bin = sr / N, frames = Math.max(1, Math.floor(x.length / hop) + 1);
  const kLo = Math.max(2, Math.floor(lo / bin)), kHi = Math.min(nb - 3, Math.ceil(hi / bin));
  const re = new Float64Array(N), im = new Float64Array(N), magA = new Float64Array(nb), magB = new Float64Array(nb);
  const out = [];
  const fill = (f, buf) => { const s0 = f * hop - N / 2; for (let i = 0; i < N; i++) { const k = s0 + i; buf[i] = k >= 0 && k < x.length ? x[k] * hann[i] : 0; } };
  const pick = (f, mag) => {
    let mx = 0;
    for (let k = kLo; k <= kHi; k++) if (mag[k] > mx) mx = mag[k];
    if (mx < 1e-7) return;
    const th = mx * 0.01;
    for (let k = kLo; k <= kHi; k++) {
      const v = mag[k];
      if (v <= th || v < mag[k - 1] || v < mag[k + 1]) continue;
      const a = Math.log(mag[k - 1] + 1e-12), b = Math.log(v + 1e-12), c = Math.log(mag[k + 1] + 1e-12), den = a - 2 * b + c;
      const d = den < 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / den)) : 0;
      out.push(f, (k + d) * bin, v);
    }
  };
  for (let f = 0; f < frames; f += 2) {
    fill(f, re);
    if (f + 1 < frames) fill(f + 1, im); else im.fill(0);
    fft(re, im);
    for (let k = 0; k < nb; k++) {
      const m = (N - k) % N, zr = re[k], zi = im[k], mr = re[m], mi = im[m];
      const ar = (zr + mr) / 2, ai = (zi - mi) / 2, br = (zi + mi) / 2, bi = -(zr - mr) / 2;
      magA[k] = Math.sqrt(ar * ar + ai * ai); magB[k] = Math.sqrt(br * br + bi * bi);
    }
    pick(f, magA);
    if (f + 1 < frames) pick(f + 1, magB);
  }
  return { peaks: out, frames, fps: sr / hop };
}

function tuningOf(peaks) {
  const H = new Float64Array(100);
  for (let i = 0; i < peaks.length; i += 3) {
    const hz = peaks[i + 1];
    if (hz < 100 || hz > 2000) continue;
    const m = 69 + 12 * Math.log2(hz / 440), c = Math.round((m - Math.round(m)) * 100);   // -50..50
    H[(c + 100) % 100] += peaks[i + 2];
  }
  // smoothed round the circle, ±3 cents
  let best = 0, bc = 0;
  for (let c = 0; c < 100; c++) {
    let s = 0;
    for (let k = -3; k <= 3; k++) s += H[(c + k + 100) % 100] * (4 - Math.abs(k));
    if (s > best) { best = s; bc = c; }
  }
  return bc >= 50 ? bc - 100 : bc;
}

function chromaTrack({ peaks, frames, fps }, tuning) {
  const cum = new Float64Array((frames + 1) * 12);
  const fr = new Float64Array(frames * 12);
  const ref = 440 * Math.pow(2, tuning / 1200);
  for (let i = 0; i < peaks.length; i += 3) {
    const f = peaks[i], hz = peaks[i + 1], mag = peaks[i + 2];
    const m = 69 + 12 * Math.log2(hz / ref), r = Math.round(m), d = m - r;
    const w = Math.cos(Math.PI * d);
    fr[f * 12 + (((r % 12) + 12) % 12)] += mag * w * w;
  }
  for (let f = 0; f < frames; f++) for (let p = 0; p < 12; p++) cum[(f + 1) * 12 + p] = cum[f * 12 + p] + fr[f * 12 + p];
  // frames whose centres fall in [t0, t1)
  const sum = (t0, t1) => {
    const a = Math.max(0, Math.min(frames, Math.ceil(t0 * fps - 1e-9))), b = Math.max(a, Math.min(frames, Math.ceil(t1 * fps - 1e-9)));
    const out = new Float64Array(12);
    for (let p = 0; p < 12; p++) out[p] = cum[b * 12 + p] - cum[a * 12 + p];
    return out;
  };
  return { fps, frames, sum };
}

export function chromaOf(x22, sr22) {
  const x11 = resample(x22, sr22, sr22 / 2);
  const xb = resample(x11, sr22 / 2, sr22 / 8);
  const tp = peaksOf(x11, sr22 / 2, 512, 250, 2000);
  const bp = peaksOf(xb, sr22 / 8, 256, 40, 250);
  const tuning = tuningOf(tp.peaks);
  return { tuning, treble: chromaTrack(tp, tuning), bass: chromaTrack(bp, tuning) };
}
