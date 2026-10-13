// The stems runner's signal half (spec 0014 R21): everything around the network, in JS. The network (htdemucs v4,
// four sources) sees one 7.8 s stereo segment at a time as two tensors: the segment itself and its spectrogram, and
// answers with a spectrogram per source (zx) plus a time-domain part per source (xt). This file makes the spectrogram,
// turns the answer back into sound, and cuts a song into overlapping segments and joins them again, exactly as demucs
// does it (HTDemucs._spec / _ispec, apply_model with split, overlap 0.25, shifts 0, and separate.py's normalising),
// so the same weights give the same stems as the reference.
//
//   SR, SEG, NFFT, HOP, FQ, T, SOURCES     44,100 Hz; 343,980 samples a segment; a 4,096-point FFT, hop 1,024; 2,048
//                                          bins; 336 frames; the sources in the model's order
//   spec(seg) -> Float32Array [4, FQ, T]   seg planar [2, SEG] -> L.re, L.im, R.re, R.im (normalised STFT, CaC)
//   ispec(planes, xt) -> Float32Array [2, SEG]   one source's [4, FQ, T] planes back to sound, plus its xt [2, SEG]
//   offsetsOf(L) -> number[]               where each segment starts (a stride of 3/4 of a segment)
//   separate({ network, mix, L, pool?, onProgress?, signal? }) -> Promise<Float32Array [4, 2, L]>
//       network(seg, mag) -> Promise<{ zx: [4 sources, 4, FQ, T], xt: [4 sources, 2, SEG] }>; mix planar [2, L],
//       already normalised; pool: pool.js (worker or inline), each segment's spectrogram is made in the pool while the
//       network runs the one before; onProgress(done, total) per segment; an aborted signal stops between segments
//   normalise(mix, L) -> { x, mean, std }   separate.py's whole-song normalising (the mono mean's mean and its std)
//
// Two real channels go through one complex FFT (left in the real part, right in the imaginary part) and are pulled
// apart by symmetry. Float64 inside, Float32 at the edges (what the network takes and gives); no randomness.

export const SR = 44100, SEG = 343980, NFFT = 4096, HOP = 1024, FQ = 2048, T = 336;
export const SOURCES = ['drums', 'bass', 'other', 'vocals'];

const N = NFFT, LOG = 12, PAD = (HOP / 2) * 3;

/* ---------------------------------------------------------------- a radix-2 complex FFT, in place, N = 4,096 */
const rev = new Uint32Array(N);
for (let i = 0; i < N; i++) {
  let r = 0;
  for (let b = 0; b < LOG; b++) r |= ((i >> b) & 1) << (LOG - 1 - b);
  rev[i] = r;
}
// sin(2πi/N) by its own series, not Math.sin: engines round Math.sin and Math.cos differently in the last bit (Node and
// Chromium do), and these tables decide every sample, so the same input splits the same everywhere
const sinQ = new Float64Array(N / 4 + 1);
for (let i = 0; i <= N / 4; i++) {
  const x = (2 * Math.PI * i) / N, x2 = x * x;
  let term = x, sum = x;
  for (let k = 1; k <= 14; k++) { term *= -x2 / ((2 * k) * (2 * k + 1)); sum += term; }
  sinQ[i] = i === N / 4 ? 1 : sum;
}
const sinN = (i) => {                                          // sin(2πi/N), i in 0..N−1, by symmetry from the quarter
  const q = N / 4;
  if (i <= q) return sinQ[i];
  if (i <= 2 * q) return sinQ[2 * q - i];
  if (i <= 3 * q) return -sinQ[i - 2 * q];
  return -sinQ[4 * q - i];
};
const cosN = (i) => sinN((i + N / 4) % N);
const cosT = new Float64Array(N / 2), sinT = new Float64Array(N / 2);
for (let i = 0; i < N / 2; i++) { cosT[i] = cosN(i); sinT[i] = sinN(i); }

function fft(re, im, inverse) {
  for (let i = 0; i < N; i++) {
    const j = rev[i];
    if (j > i) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
  }
  const sgn = inverse ? 1 : -1;
  for (let size = 2; size <= N; size <<= 1) {
    const half = size >> 1, step = N / size;
    for (let st = 0; st < N; st += size) {
      for (let k = 0; k < half; k++) {
        const wr = cosT[k * step], wi = sgn * sinT[k * step];
        const a = st + k, b = a + half;
        const xr = re[b] * wr - im[b] * wi, xi = re[b] * wi + im[b] * wr;
        re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi;
      }
    }
  }
}

// the periodic Hann window (torch.hann_window's default), and 1 / the overlap-added squared window that iSTFT divides by
// over the 336 frames plus the two empty frames demucs pads on each side
const win = new Float64Array(N);
for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * cosN(i);
export const tables = { cosT, sinT, win };                    // for the unit tests
const FRAMES = T + 4, BUFLEN = N + HOP * (FRAMES - 1);
const envInv = new Float64Array(BUFLEN);
for (let f = 0; f < FRAMES; f++) for (let i = 0; i < N; i++) envInv[f * HOP + i] += win[i] * win[i];
for (let i = 0; i < BUFLEN; i++) envInv[i] = envInv[i] > 1e-11 ? 1 / envInv[i] : 1;

// numpy's and torch's 'reflect' (the edge sample is not repeated)
function reflectPad(x, left, total) {
  const L = x.length, out = new Float64Array(total);
  for (let i = 0; i < total; i++) {
    let j = i - left;
    while (j < 0 || j >= L) { if (j < 0) j = -j; if (j >= L) j = 2 * (L - 1) - j; }
    out[i] = x[j];
  }
  return out;
}

/* ---------------------------------------------------------------- the spectrogram the network reads */
export function spec(seg) {
  const le = Math.ceil(SEG / HOP), p1len = PAD + le * HOP + PAD;
  // _spec pads by (PAD, PAD + le·HOP − SEG), reflecting; the STFT (center=True) reflects another N/2 each side
  const [a, b] = [0, 1].map((c) => reflectPad(reflectPad(seg.subarray(c * SEG, (c + 1) * SEG), PAD, p1len), N / 2, p1len + N));
  const mag = new Float32Array(4 * FQ * T), re = new Float64Array(N), im = new Float64Array(N), norm = 1 / Math.sqrt(N);
  for (let t = 0; t < le; t++) {
    const s = (t + 2) * HOP;                                   // frames 2 .. 2 + le: _spec drops the first two
    for (let i = 0; i < N; i++) { re[i] = a[s + i] * win[i]; im[i] = b[s + i] * win[i]; }
    fft(re, im, false);
    for (let k = 0; k < FQ; k++) {
      const nk = (N - k) & (N - 1);
      const xr = re[k], xi = im[k], yr = re[nk], yi = im[nk];
      // left  A_k = (Z_k + conj Z_{N−k}) / 2 ; right B_k = (Z_k − conj Z_{N−k}) / 2i
      mag[k * T + t] = 0.5 * (xr + yr) * norm;
      mag[(FQ + k) * T + t] = 0.5 * (xi - yi) * norm;
      mag[(2 * FQ + k) * T + t] = 0.5 * (xi + yi) * norm;
      mag[(3 * FQ + k) * T + t] = -0.5 * (xr - yr) * norm;
    }
  }
  return mag;
}

/* ---------------------------------------------------------------- one source's answer back to sound */
export function ispec(planes, xt) {
  const bufA = new Float64Array(BUFLEN), bufB = new Float64Array(BUFLEN);
  const re = new Float64Array(N), im = new Float64Array(N), scale = Math.sqrt(N) / N;
  for (let t = 0; t < T; t++) {
    re.fill(0); im.fill(0);
    for (let k = 0; k < FQ; k++) {
      // irfft ignores the DC bin's imaginary part, so it is dropped here too (else it leaks from one channel to the
      // other); the Nyquist bin is zero (_ispec pads it)
      const ar = planes[k * T + t], ai = k ? planes[(FQ + k) * T + t] : 0;
      const br = planes[(2 * FQ + k) * T + t], bi = k ? planes[(3 * FQ + k) * T + t] : 0;
      re[k] = ar - bi; im[k] = ai + br;                        // Z_k = A_k + i B_k
      if (k > 0) { re[N - k] = ar + bi; im[N - k] = br - ai; } // Z_{N−k} = conj A_k + i conj B_k
    }
    fft(re, im, true);
    const s = (t + 2) * HOP;
    for (let i = 0; i < N; i++) { const w = win[i] * scale; bufA[s + i] += re[i] * w; bufB[s + i] += im[i] * w; }
  }
  const out = new Float32Array(2 * SEG), base = N / 2 + PAD;
  for (let n = 0; n < SEG; n++) {
    const j = base + n, e = envInv[j];
    out[n] = bufA[j] * e + xt[n];
    out[SEG + n] = bufB[j] * e + xt[SEG + n];
  }
  return out;
}

/* ---------------------------------------------------------------- the song in segments */
const STRIDE = Math.floor(0.75 * SEG), HALF = Math.floor(SEG / 2);
// the triangular crossfade (demucs' transition_power 1): rises to 1 at the middle and back down
const fade = new Float32Array(SEG);
for (let i = 0; i < HALF; i++) fade[i] = (i + 1) / HALF;
for (let i = HALF; i < SEG; i++) fade[i] = (SEG - i) / HALF;

export function offsetsOf(L) {
  const out = [];
  for (let o = 0; o < L; o += STRIDE) out.push(o);
  return out;
}

// a segment of the song: the last one, shorter, is centred in a full segment of silence (TensorChunk.padded)
function segmentAt(mix, L, off) {
  const clen = Math.min(SEG, L - off), delta = SEG - clen, start = off - Math.floor(delta / 2);
  const seg = new Float32Array(2 * SEG);
  for (let c = 0; c < 2; c++) {
    for (let i = 0; i < SEG; i++) { const j = start + i; seg[c * SEG + i] = j >= 0 && j < L ? mix[c * L + j] : 0; }
  }
  return { seg, clen, trim: Math.floor(delta / 2) };
}

const aborted = () => { const e = new Error('The split was cancelled'); e.name = 'AbortError'; return e; };

export async function separate({ network, mix, L, pool, onProgress = null, signal = null }) {
  const offsets = offsetsOf(L);
  const out = new Float32Array(4 * 2 * L), sumw = new Float64Array(L);
  const specOf = (s) => pool.call({ op: 'spec', seg: s.seg });
  let cur = segmentAt(mix, L, offsets[0]), curSpec = specOf(cur);
  // the answers are added into the song in segment order, whichever worker finishes first, so the float sums (and the
  // stems) come out the same on every machine and every run
  let added = Promise.resolve();
  for (let n = 0; n < offsets.length; n++) {
    if (signal && signal.aborted) throw aborted();
    const { mag } = await curSpec;
    const next = n + 1 < offsets.length ? segmentAt(mix, L, offsets[n + 1]) : null;
    const nextSpec = next ? specOf(next) : null;               // the next spectrogram is made while the network runs
    const { zx, xt } = await network(cur.seg, mag);
    if (signal && signal.aborted) throw aborted();
    const off = offsets[n], { clen, trim } = cur;
    for (let i = 0; i < clen; i++) sumw[off + i] += fade[i];
    const answers = Promise.all([0, 1, 2, 3].map((s) => {
      const planes = zx.slice(s * 4 * FQ * T, (s + 1) * 4 * FQ * T), x2 = xt.slice(s * 2 * SEG, (s + 1) * 2 * SEG);
      return pool.call({ op: 'ispec', planes, xt: x2 }, [planes.buffer, x2.buffer]);
    }));
    added = Promise.all([added, answers]).then(([, outs]) => {
      outs.forEach(({ out: so }, s) => {
        for (let c = 0; c < 2; c++) {
          const o = (s * 2 + c) * L + off, b = c * SEG + trim;
          for (let i = 0; i < clen; i++) out[o + i] += fade[i] * so[b + i];
        }
      });
    });
    added.catch(() => {});                                     // seen below; a cancel may leave it waiting
    if (onProgress) onProgress(n + 1, offsets.length);
    cur = next; curSpec = nextSpec;
  }
  await added;
  if (signal && signal.aborted) throw aborted();
  for (let s = 0; s < 8; s++) for (let i = 0; i < L; i++) out[s * L + i] /= sumw[i];
  return out;
}

/* ---------------------------------------------------------------- separate.py's normalising */
export function normalise(mix, L) {
  let mean = 0;
  for (let i = 0; i < L; i++) mean += 0.5 * (mix[i] + mix[L + i]);
  mean /= Math.max(1, L);
  let v = 0;
  for (let i = 0; i < L; i++) { const d = 0.5 * (mix[i] + mix[L + i]) - mean; v += d * d; }
  const std = Math.sqrt(v / Math.max(1, L - 1)) || 1;          // torch's std is the unbiased one
  const x = new Float32Array(2 * L);
  for (let i = 0; i < 2 * L; i++) x[i] = (mix[i] - mean) / std;
  return { x, mean, std };
}
