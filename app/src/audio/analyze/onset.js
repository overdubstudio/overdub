// The onset-strength envelope (spec 0014 R13): log spectral flux at 22,050 Hz, STFT 2,048 / hop 256 (a Hann window,
// frame f centred on sample f * hop), in four bands: lows (kick, 30-150 Hz), low mids (snare body, bass, 150-600),
// mids (600-3k), highs (hats, snare noise, 3k-10k). Each band's flux is its mean rise over its bins, half-wave
// rectified; the envelope is the four summed, its slow drift (a 1 s moving mean) taken out, and scaled to unit spread.
// The same pass keeps a 12-band log-mel spectrum a frame (the timbre sections are read from). Pure, Float64.
//
//   onsetEnvelope(x, sr) -> { env, bands: [lows, lowMids, mids, highs], mel (Float32Array, frames x 12), frames, hop,
//                            fps, sr }
// Two frames go through one complex FFT (one in the real part, one in the imaginary), then are pulled apart.
import { fft } from '../../input/pitch.js';

export const N_FFT = 2048, HOP = 256, MEL_BANDS = 12;
const BAND_HZ = [[30, 150], [150, 600], [600, 3000], [3000, 10000]];
const GAMMA = 1000;

const hann = new Float64Array(N_FFT);
for (let i = 0; i < N_FFT; i++) hann[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N_FFT);
let hannSum = 0;
for (let i = 0; i < N_FFT; i++) hannSum += hann[i];

const melOf = (f) => 2595 * Math.log10(1 + f / 700);
const hzOfMel = (m) => 700 * (Math.pow(10, m / 2595) - 1);

export function onsetEnvelope(x, sr) {
  const nb = N_FFT / 2 + 1, hz = sr / N_FFT;
  const frames = Math.max(1, Math.floor(x.length / HOP) + 1);
  const bins = BAND_HZ.map(([a, b]) => [Math.max(1, Math.round(a / hz)), Math.min(nb - 1, Math.round(b / hz))]);
  const bands = BAND_HZ.map(() => new Float64Array(frames));
  // the mel bands: 12 triangles from 40 Hz to 10 kHz, as bin ranges with weights
  const m0 = melOf(40), m1 = melOf(Math.min(10000, sr / 2 - hz)), edges = [];
  for (let i = 0; i < MEL_BANDS + 2; i++) edges.push(hzOfMel(m0 + ((m1 - m0) * i) / (MEL_BANDS + 1)) / hz);
  const melW = [];
  for (let b = 0; b < MEL_BANDS; b++) {
    const lo = edges[b], mid = edges[b + 1], hi = edges[b + 2], ws = [];
    for (let k = Math.max(1, Math.floor(lo)); k <= Math.min(nb - 1, Math.ceil(hi)); k++) {
      const w = k <= mid ? (k - lo) / Math.max(1e-9, mid - lo) : (hi - k) / Math.max(1e-9, hi - mid);
      if (w > 0) ws.push(k, w);
    }
    melW.push(ws);
  }
  const mel = new Float32Array(frames * MEL_BANDS);
  const re = new Float64Array(N_FFT), im = new Float64Array(N_FFT);
  let prev = new Float64Array(nb), cur = new Float64Array(nb), other = new Float64Array(nb);
  const norm = 2 / hannSum, half = N_FFT / 2;
  const frameInto = (f, buf) => { // windowed frame f (centred on f * HOP) into buf
    const s0 = f * HOP - half;
    for (let i = 0; i < N_FFT; i++) { const k = s0 + i; buf[i] = k >= 0 && k < x.length ? x[k] * hann[i] : 0; }
  };
  const take = (f, L, pow) => {
    for (let b = 0; b < 4; b++) {
      const [a, z] = bins[b];
      let s = 0;
      for (let k = a; k <= z; k++) { const d = L[k] - prev[k]; if (d > 0) s += d; }
      bands[b][f] = f === 0 ? 0 : s / (z - a + 1);
    }
    for (let b = 0; b < MEL_BANDS; b++) {
      const ws = melW[b];
      let e = 0;
      for (let j = 0; j < ws.length; j += 2) e += pow[ws[j]] * ws[j + 1];
      mel[f * MEL_BANDS + b] = Math.log(1e-10 + e);
    }
  };
  const powA = new Float64Array(nb), powB = new Float64Array(nb);
  for (let f = 0; f < frames; f += 2) {
    frameInto(f, re);
    if (f + 1 < frames) frameInto(f + 1, im); else im.fill(0);
    fft(re, im);
    for (let k = 0; k < nb; k++) {
      const m = (N_FFT - k) % N_FFT, zr = re[k], zi = im[k], mr = re[m], mi = im[m];
      const ar = (zr + mr) / 2, ai = (zi - mi) / 2, br = (zi + mi) / 2, bi = -(zr - mr) / 2;
      const pa = (ar * ar + ai * ai) * norm * norm, pb = (br * br + bi * bi) * norm * norm;
      powA[k] = pa; powB[k] = pb;
      cur[k] = Math.log(1 + GAMMA * Math.sqrt(pa));
      other[k] = Math.log(1 + GAMMA * Math.sqrt(pb));
    }
    take(f, cur, powA);
    let t = prev; prev = cur; cur = t;
    if (f + 1 < frames) { take(f + 1, other, powB); t = prev; prev = other; other = t; }
  }
  // the envelope: the bands summed, the slow drift taken out, half-wave rectified, unit spread
  const raw = new Float64Array(frames);
  for (let f = 0; f < frames; f++) raw[f] = bands[0][f] + bands[1][f] + bands[2][f] + bands[3][f];
  const fps = sr / HOP, W = Math.round(fps / 2), env = new Float64Array(frames);
  let acc = 0, lo = 0, hi = -1;
  for (let f = 0; f < frames; f++) {
    while (hi < Math.min(frames - 1, f + W)) acc += raw[++hi];
    while (lo < f - W) acc -= raw[lo++];
    env[f] = Math.max(0, raw[f] - acc / (hi - lo + 1));
  }
  let ss = 0;
  for (let f = 0; f < frames; f++) ss += env[f] * env[f];
  const sd = Math.sqrt(ss / frames);
  if (sd > 0) for (let f = 0; f < frames; f++) env[f] /= sd;
  return { env, bands, mel, frames, hop: HOP, fps, sr };
}
