// Mono and resampled: what the analysis reads (audio/analyze/index.js). Pure, Float64, fixed order.
//
//   downmix(channels | Float32Array) -> Float64Array        the channels' mean
//   resample(x, from, to) -> Float64Array                   a windowed-sinc (Blackman, 12 zero crossings of the lower
//                                                           rate, cut off at 0.47 of it), 1,024 phases a sample with
//                                                           the nearest taken: about 90 dB down, plenty for envelopes
//                                                           and chroma
//   resample(x, from, to, { interp: true })                 the same filter with the phases interpolated (the stems
//                                                           runner's way in and out of 44.1 kHz, jobs/stems/runner.js):
//                                                           twice the work; a 48k-44.1k-48k round trip measured
//                                                           18-33 dB cleaner (about −92 dB)
// The analysis runs at 22,050 Hz (onsets, tempo, timbre) and 11,025 Hz (chroma); the bass chroma at 2,756.25 Hz.

export function downmix(input) {
  const chs = ArrayBuffer.isView(input) ? [input] : input;
  const n = chs[0] ? chs[0].length : 0, out = new Float64Array(n), g = 1 / Math.max(1, chs.length);
  for (const c of chs) for (let i = 0; i < n; i++) out[i] += c[i] * g;
  return out;
}

const PHASES = 1024, ZC = 12;
const tables = new Map();
function tableFor(ratio) {
  // ratio: input samples per output sample; the filter is cut at the lower of the two rates
  const id = ratio.toFixed(12);
  if (tables.has(id)) return tables.get(id);
  const scale = Math.max(1, ratio), fc = 0.47 / scale;   // cycles per input sample
  const half = Math.ceil(ZC * scale), taps = 2 * half;
  const tab = new Float64Array((PHASES + 1) * taps);
  for (let ph = 0; ph <= PHASES; ph++) {
    const frac = ph / PHASES;
    let sum = 0;
    for (let j = 0; j < taps; j++) {
      const x = j - half + 1 - frac;                       // input sample (floor + j - half + 1) minus the position
      const w = Math.abs(x) >= half ? 0 : 0.42 + 0.5 * Math.cos((Math.PI * x) / half) + 0.08 * Math.cos((2 * Math.PI * x) / half);
      const s = x === 0 ? 2 * fc : Math.sin(2 * Math.PI * fc * x) / (Math.PI * x);
      tab[ph * taps + j] = s * w;
      sum += s * w;
    }
    for (let j = 0; j < taps; j++) tab[ph * taps + j] /= sum;   // unity gain at DC, every phase
  }
  const t = { tab, half, taps };
  tables.set(id, t);
  return t;
}

export function resample(x, from, to, { interp = false } = {}) {
  if (from === to) return Float64Array.from(x);
  const ratio = from / to, n = Math.floor((x.length * to) / from), out = new Float64Array(n);
  const { tab, half, taps } = tableFor(ratio), len = x.length;
  for (let i = 0; i < n; i++) {
    const pos = i * ratio, i0 = Math.floor(pos), base = i0 - half + 1;
    const at = (row) => {
      let acc = 0;
      if (base >= 0 && base + taps <= len) for (let j = 0; j < taps; j++) acc += x[base + j] * tab[row + j];
      else for (let j = 0; j < taps; j++) { const k = base + j; if (k >= 0 && k < len) acc += x[k] * tab[row + j]; }
      return acc;
    };
    if (!interp) { out[i] = at(Math.round((pos - i0) * PHASES) * taps); continue; }
    const f = (pos - i0) * PHASES, p0 = Math.floor(f), t = f - p0;
    out[i] = t ? (1 - t) * at(p0 * taps) + t * at((p0 + 1) * taps) : at(p0 * taps);
  }
  return out;
}
