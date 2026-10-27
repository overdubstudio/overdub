// Plucked strings for the tuner's checks [tools]: Karplus-Strong as a fractional delay line, so the pitch is known to a
// hundredth of a cent and can glide, seeded (never Math.random), in Node. tools/input-test.js measures the tuner
// (input/tuner.js) on them across a guitar's and a bass's range, and the calibration (input/calibrate.js) on strums.
//
//   string(midi, { sr, dur, cents, peak, pick, pickup, t60, glide, glideS, seed, hum, noise, at, len }) -> {
//       buf: Float32Array, hz (the pitch it settles on), truth(t) -> Hz at t seconds into buf }
//     a string plucked at `at` s (default 0.1) into a buffer `len` s long (default at + dur + 0.2):
//       cents   how far off the note it's tuned
//       peak    dBFS of its loudest sample (−12: a guitar into an interface with sensible gain)
//       pick    where it's plucked, as a fraction of the string from the bridge (0.18; a comb on the harmonics)
//       pickup  where the pickup sits, as a fraction (0.12: a bridge pickup, which thins the fundamental of a low
//               string: its 3rd and 4th harmonics come out louder than it); 0 reads the string whole
//       t60     seconds to fall 60 dB (default: longer for lower strings, as a guitar's do)
//       glide   cents sharp at the pick's attack, falling back over glideS (a real string's tension, struck hard)
//       bend    (s) -> cents: a peg turned while it rings (cents off `cents`, s after the pluck)
//       hum     dBFS of mains hum at 60 Hz with its 2nd and 3rd harmonics (null: none); noise: dBFS of the floor
//   strum(chords, { sr, at, gap, peak, seed, mute }) -> { buf, times }   strums at the times given (s), each a quick
//       pick across the strings (8 ms apart); mute: palm-muted (a short, dull chop: the calibration's strum along)
//   rng(seed)                                                            the seeded generator

export const rng = (seed = 1) => { let s = Math.abs(Math.floor(seed)) % 2147483647 || 1; return () => (s = (s * 16807) % 2147483647) / 2147483647; };
const midiHz = (m) => 440 * 2 ** ((m - 69) / 12);

export function string(midi, {
  sr = 48000, dur = 3, cents = 0, peak = -12, pick = 0.18, pickup = 0.12, t60 = null, glide = 0, glideS = 0.25,
  seed = 7, hum = null, noise = -84, at = 0.1, len = null, bend = null,
} = {}) {
  const r = rng(seed + Math.round(midi * 100 + cents * 7));
  const hz = midiHz(midi + cents / 100), T60 = t60 ?? Math.max(1.2, 6 * 2 ** (-(midi - 40) / 24));
  const N = Math.round((len ?? at + dur + 0.2) * sr), buf = new Float32Array(N);
  const truth = (t) => hz * 2 ** ((t < at ? 0 : glide * Math.exp(-(t - at) / glideS) + (bend ? bend(t - at) : 0)) / 1200);
  // the delay line: D(t) + 0.5 samples round the loop (the two-point average adds the half), read by cubic Lagrange
  const P0 = sr / hz, size = 1 << Math.ceil(Math.log2(P0 * 1.2 + 8)), line = new Float32Array(size), mask = size - 1;
  const g = 0.001 ** (1 / (hz * T60));
  // the pluck: a burst one period long, low-passed a little, with the pick's comb on it
  const ex = new Float32Array(Math.round(P0));
  let lp = 0;
  for (let i = 0; i < ex.length; i++) { lp += 0.5 * (r() * 2 - 1 - lp); ex[i] = lp; }
  const pk = Math.max(1, Math.round(pick * P0));
  const exc = ex.map((v, i) => v - (i >= pk ? ex[i - pk] : 0));
  const a = Math.round(at * sr), B = Math.min(N, a + Math.round(dur * sr)), fade = Math.round(0.02 * sr);
  const out = new Float32Array(N);
  let w = 0, prev = 0;
  // y[n - d] for a fractional d (line[w] holds y[n - 1]): cubic Lagrange on the four samples round it
  const at_ = (k) => line[(w - k + 1) & mask];
  const lag = (d) => {
    const di = Math.floor(d), f = d - di;
    const c0 = (-f * (f - 1) * (f - 2)) / 6, c1 = ((f + 1) * (f - 1) * (f - 2)) / 2, c2 = (-(f + 1) * f * (f - 2)) / 2, c3 = ((f + 1) * f * (f - 1)) / 6;
    return c0 * at_(di - 1) + c1 * at_(di) + c2 * at_(di + 1) + c3 * at_(di + 2);
  };
  for (let i = a; i < B; i++) {
    const n = i - a, t = i / sr, D = sr / truth(t) - 0.5;
    const back = lag(D);
    const y = (n < exc.length ? exc[n] : 0) + g * 0.5 * (back + prev);
    prev = back;
    w = (w + 1) & mask;
    line[w] = y;
    out[i] = y * (i > B - fade ? (B - i) / fade : 1);
  }
  // the pickup: the string read at a point near the bridge (a comb on the output)
  const pu = pickup > 0 ? Math.max(1, Math.round(pickup * P0)) : 0;
  for (let i = 0; i < N; i++) buf[i] = pu ? out[i] - (i >= pu ? out[i - pu] : 0) : out[i];
  // level: the loudest sample at `peak`
  let mx = 0; for (let i = 0; i < N; i++) mx = Math.max(mx, Math.abs(buf[i]));
  const k = mx > 0 ? 10 ** (peak / 20) / mx : 0;
  for (let i = 0; i < N; i++) buf[i] *= k;
  if (hum != null) { const hg = 10 ** (hum / 20); for (let i = 0; i < N; i++) { const t = i / sr; buf[i] += hg * (Math.sin(2 * Math.PI * 60 * t) + 0.5 * Math.sin(2 * Math.PI * 120 * t + 1) + 0.3 * Math.sin(2 * Math.PI * 180 * t + 2)); } }
  if (noise != null) { const ng = 10 ** (noise / 20) * Math.sqrt(3); for (let i = 0; i < N; i++) buf[i] += ng * (r() * 2 - 1); }
  return { buf, hz, truth, sr, at };
}

// Strums at `times` (s): each chord's strings picked 8 ms apart, low to high; mute: a palm-muted chop (40 ms, dull)
export function strum(chord, times, { sr = 48000, len = null, peak = -12, seed = 3, mute = true } = {}) {
  const N = Math.round((len ?? Math.max(...times) + 1) * sr), buf = new Float32Array(N);
  times.forEach((t0, k) => chord.forEach((m, i) => {
    const s = string(m, { sr, dur: mute ? 0.06 : 0.6, at: 0, len: mute ? 0.08 : 0.7, t60: mute ? 0.05 : null, peak: 0, pickup: 0.15, seed: seed + k * 31 + i, noise: null });
    const a = Math.round((t0 + i * 0.008) * sr);
    for (let j = 0; j < s.buf.length && a + j < N; j++) if (a + j >= 0) buf[a + j] += s.buf[j] * (1 - i * 0.06);
  }));
  let mx = 0; for (let i = 0; i < N; i++) mx = Math.max(mx, Math.abs(buf[i]));
  const k = mx > 0 ? 10 ** (peak / 20) / mx : 0;
  for (let i = 0; i < N; i++) buf[i] *= k;
  return { buf, times };
}
