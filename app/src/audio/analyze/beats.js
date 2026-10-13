// Beats (spec 0014 R13): dynamic programming over the onset envelope (Ellis 2007), each step held to the local
// tempogram's period; each beat then moved onto the attack it sits on (the steepest rise in level within 35 ms, in
// 64-sample blocks), and the beats smoothed: a median over the intervals finds the odd one, and a line through two
// bars either side puts each beat where its neighbours say. Beats where there is no pulse (the tempogram's salience
// low, or the envelope at the beats too weak against the song's) are dropped: those spans are free.
//
//   trackBeats(env, fps, tg) -> frames (the raw path)
//   refineBeats(frames, x, sr, fps) -> times (s)
//   smoothBeats(times) -> times
//   freeOf(times, env, fps, tg, end) -> { keep: [bool], free: [[t0, t1]] }
// Pure, Float64, fixed order.
import { periodAt, FREE_SALIENCE } from './tempo.js';

const TIGHT = 100;

export function trackBeats(env, fps, tg) {
  const n = env.length;
  if (n < 4) return [];
  // the local score: the envelope smoothed by a Gaussian a 32nd of the beat wide
  const sig = Math.max(1, tg.global.lag / 32), R = Math.ceil(3 * sig), g = new Float64Array(2 * R + 1);
  for (let k = -R; k <= R; k++) g[k + R] = Math.exp(-0.5 * (k / sig) * (k / sig));
  const local = new Float64Array(n);
  for (let f = 0; f < n; f++) { let s = 0; for (let k = -R; k <= R; k++) { const j = f + k; if (j >= 0 && j < n) s += env[j] * g[k + R]; } local[f] = s; }
  const C = new Float64Array(n), P = new Int32Array(n);
  for (let f = 0; f < n; f++) {
    const tau = periodAt(tg, f / fps), lo = f - Math.round(2 * tau), hi = f - Math.round(tau / 2);
    let best = -Infinity, bp = -1;
    for (let p = Math.max(0, lo); p <= hi; p++) {
      const l = Math.log((f - p) / tau), s = C[p] - TIGHT * l * l;
      if (s > best) { best = s; bp = p; }
    }
    if (bp >= 0 && best > 0) { C[f] = local[f] + best; P[f] = bp; } else { C[f] = local[f]; P[f] = -1; }
  }
  // the last beat: the last local peak of the cumulative score that reaches half the median peak
  const peaks = [];
  for (let f = 1; f < n - 1; f++) if (C[f] > C[f - 1] && C[f] >= C[f + 1]) peaks.push(f);
  if (!peaks.length) return [];
  const pv = peaks.map((f) => C[f]).sort((a, b) => a - b), med = pv[pv.length >> 1];
  let last = peaks[peaks.length - 1];
  for (let i = peaks.length - 1; i >= 0; i--) if (C[peaks[i]] >= 0.5 * med) { last = peaks[i]; break; }
  const out = [];
  for (let f = last; f >= 0; f = P[f]) out.push(f);
  out.reverse();
  // trailing and leading beats with nothing under them (the tail of the last chord, the silence before the first)
  const at = out.map((f) => local[f]).sort((a, b) => a - b), mid = at[at.length >> 1] || 0;
  let a = 0, b = out.length - 1;
  while (a < b && local[out[a]] < 0.15 * mid) a++;
  while (b > a && local[out[b]] < 0.15 * mid) b--;
  return out.slice(a, b + 1);
}

// Each beat onto its attack: the 64-sample block within ±35 ms whose level rises most over the 15 ms before it.
// A beat with no clear attack (under 6 dB) moves by the median of the others' moves.
export function refineBeats(frames, x, sr, fps) {
  const B = 64, back = 5, reach = Math.round((0.035 * sr) / B);
  const moved = [], times = frames.map((f) => f / fps);
  const blockE = (s) => { let e = 0; for (let i = s; i < s + B; i++) { const v = i >= 0 && i < x.length ? x[i] : 0; e += v * v; } return e / B; };
  for (let i = 0; i < times.length; i++) {
    const c = Math.round(times[i] * sr);
    let best = 0, bt = null;
    for (let k = -reach; k <= reach; k++) {
      const s = c + k * B, e = blockE(s);
      let pre = 0;
      for (let j = 1; j <= back; j++) pre += blockE(s - j * B);
      pre /= back;
      const rise = 10 * Math.log10((e + 1e-10) / (pre + 1e-10));
      if (rise > best) { best = rise; bt = s / sr; }
    }
    if (bt != null && best >= 6) { moved.push(bt - times[i]); times[i] = bt; } else times[i] = NaN;
  }
  const ms = moved.slice().sort((a, b) => a - b), shift = ms.length ? ms[ms.length >> 1] : 0;
  return times.map((t, i) => (Number.isNaN(t) ? frames[i] / fps + shift : t));
}

const median = (xs) => { const s = xs.slice().sort((a, b) => a - b); return s.length ? s[s.length >> 1] : 0; };

// A median over the intervals (5 wide) marks the odd beat (an interval more than a quarter off); a line through the
// beats two bars (8 beats) either side, odd ones left out, puts each beat where its neighbours say. Runs split where
// an interval is far out of line (a missed or doubled beat) and are fitted apart.
export function smoothBeats(times) {
  const n = times.length;
  if (n < 5) return times.slice();
  const d = [];
  for (let i = 1; i < n; i++) d.push(times[i] - times[i - 1]);
  const md = d.map((_, i) => median(d.slice(Math.max(0, i - 2), Math.min(d.length, i + 3))));
  const odd = new Array(n).fill(false);
  for (let i = 0; i < d.length; i++) if (Math.abs(d[i] - md[i]) > 0.25 * md[i]) { odd[i] = true; odd[i + 1] = true; }
  // runs: a break where an interval is far from the median (a skipped or doubled beat)
  const run = new Int32Array(n);
  for (let i = 1; i < n; i++) run[i] = run[i - 1] + (Math.abs(d[i - 1] - md[i - 1]) > 0.4 * md[i - 1] ? 1 : 0);
  const out = times.slice();
  for (let i = 0; i < n; i++) {
    let sx = 0, sy = 0, sxx = 0, sxy = 0, k = 0;
    for (let j = Math.max(0, i - 8); j <= Math.min(n - 1, i + 8); j++) {
      if (run[j] !== run[i] || odd[j]) continue;
      const xj = j - i;
      sx += xj; sy += times[j]; sxx += xj * xj; sxy += xj * times[j]; k++;
    }
    if (k < 4) continue;
    const den = k * sxx - sx * sx;
    if (Math.abs(den) < 1e-12) continue;
    const slope = (k * sxy - sx * sy) / den, icpt = (sy - slope * sx) / k;
    out[i] = icpt;
  }
  return out;
}

// Free time: where the tempogram's salience is under FREE_SALIENCE, or the envelope at the beats (±2 beats) is under a
// quarter of its median at the beats. Returns which beats to keep and the free spans (s) between kept beats.
export function freeOf(times, env, fps, tg, end) {
  const n = times.length;
  const val = times.map((t) => { const f = Math.round(t * fps); let m = 0; for (let k = -2; k <= 2; k++) { const j = f + k; if (j >= 0 && j < env.length) m = Math.max(m, env[j]); } return m; });
  const mid = median(val);
  const sal = (t) => {
    const ws = tg.windows;
    if (!ws.length) return 1;
    let lo = 0;
    while (lo < ws.length - 1 && ws[lo + 1].t <= t) lo++;
    const a = ws[lo], b = ws[Math.min(ws.length - 1, lo + 1)];
    if (b === a || t <= a.t) return a.salience;
    return a.salience + ((b.salience - a.salience) * (t - a.t)) / (b.t - a.t);
  };
  const keep = times.map((t, i) => {
    let s = 0, k = 0;
    for (let j = Math.max(0, i - 2); j <= Math.min(n - 1, i + 2); j++) { s += val[j]; k++; }
    const clear = s / k >= 0.25 * mid;
    return clear && sal(t) >= FREE_SALIENCE;
  });
  // a lone kept beat inside free time, or a lone dropped one inside a pulse, follows its neighbours
  for (let i = 1; i < n - 1; i++) if (keep[i - 1] === keep[i + 1] && keep[i] !== keep[i - 1]) keep[i] = keep[i - 1];
  const free = [];
  let i = 0;
  while (i < n) {
    if (keep[i]) { i++; continue; }
    let j = i;
    while (j < n && !keep[j]) j++;
    const t0 = i > 0 ? times[i - 1] : 0, t1 = j < n ? times[j] : end;
    free.push([t0, t1]);
    i = j;
  }
  // (a song whose pulse starts well after its first second: the silence or the singing before it is free too)
  if (n > 1 && keep[0] && times[0] > 4 * (times[1] - times[0])) free.unshift([0, times[0]]);
  return { keep, free };
}
