// Downbeats and the meter (spec 0014 R13). Each beat gets three strengths: the kick (the lows' rise there), the snare
// (the low mids' and mids' rise) and the harmony's change (the chroma two beats before against two beats after), each
// against its median over the song. A bar's phase is scored as the tap door scores a loop (input/rounds.js
// accentScore: kicks on 1 and 3, snares on 2 and 4, never a snare on the 1), plus the harmony changing on the 1, and
// a Viterbi over the bar phase reads it beat by beat (a step out of turn costs JUMP). The meter: 3 when the accents
// repeat every three beats clearly better than every four.
//
//   downbeatsOf(times, { bands, fps, chroma }) -> { bpb, cum (beat count per beat: gaps counted in beats), phase
//       (cum % bpb at the 1), alt (the runner-up phase), margin, scores }
// Pure, Float64.
import { accentScore } from '../../input/rounds.js';

const JUMP = 6, HARM = 2.5;
const median = (xs) => { const s = xs.slice().sort((a, b) => a - b); return s.length ? s[s.length >> 1] : 0; };

function strengths(times, { bands, fps, chroma }) {
  const n = times.length;
  const peak = (band, t) => { const f = Math.round(t * fps); let m = 0; for (let k = -2; k <= 2; k++) { const j = f + k; if (j >= 0 && j < band.length) m = Math.max(m, band[j]); } return m; };
  const kick = times.map((t) => peak(bands[0], t));
  const snare = times.map((t) => peak(bands[1], t) + peak(bands[2], t));
  const vec = (t0, t1) => {
    const a = chroma.treble.sum(t0, t1), b = chroma.bass.sum(t0, t1), v = new Float64Array(12);
    let ta = 0, tb = 0;
    for (let p = 0; p < 12; p++) { ta += a[p]; tb += b[p]; }
    for (let p = 0; p < 12; p++) v[p] = (ta > 0 ? a[p] / ta : 0) + (tb > 0 ? b[p] / tb : 0);
    return v;
  };
  const harm = times.map((t, i) => {
    const p = times[Math.max(0, i - 2)], q = times[Math.min(n - 1, i + 2)];
    if (i < 2 || i > n - 3) return 0;
    const A = vec(p, t), B = vec(t, q);
    let ab = 0, aa = 0, bb = 0;
    for (let k = 0; k < 12; k++) { ab += A[k] * B[k]; aa += A[k] * A[k]; bb += B[k] * B[k]; }
    return aa > 0 && bb > 0 ? 1 - ab / Math.sqrt(aa * bb) : 0;
  });
  const rel = (xs) => { const m = median(xs) || 1e-9; return xs.map((x) => Math.max(-1, Math.min(3, x / m - 1))); };
  const rh = (() => { const m = median(harm), sp = median(harm.map((h) => Math.abs(h - m))) || 1e-3; return harm.map((h) => Math.max(-1, Math.min(3, (h - m) / (4 * sp)))); })();
  return { kick: rel(kick), snare: rel(snare), harm: rh };
}

const corr = (a, lag) => {
  const n = a.length - lag;
  if (n < 8) return 0;
  let ma = 0, mb = 0;
  for (let i = 0; i < n; i++) { ma += a[i]; mb += a[i + lag]; }
  ma /= n; mb /= n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) { const x = a[i] - ma, y = a[i + lag] - mb; num += x * y; da += x * x; db += y * y; }
  return da > 0 && db > 0 ? num / Math.sqrt(da * db) : 0;
};

export function downbeatsOf(times, ctx) {
  const n = times.length;
  // the beat count: a gap of more than one beat (free time, a missed beat) counts the beats it would hold
  const cum = new Array(n).fill(0);
  const d = times.map((t, i) => (i ? t - times[i - 1] : 0));
  for (let i = 1; i < n; i++) {
    const loc = median(d.slice(Math.max(1, i - 4), Math.min(n, i + 5))) || d[i];
    cum[i] = cum[i - 1] + Math.max(1, Math.round(d[i] / loc));
  }
  if (n < 8) return { bpb: 4, cum, phase: 0, alt: null, margin: 0, scores: [0, 0, 0, 0] };
  const S = strengths(times, ctx);
  const accent = S.kick.map((k, i) => k + S.harm[i] - 0.5 * S.snare[i]);
  const r3 = corr(accent, 3), r4 = corr(accent, 4);
  const bpb = r3 > r4 + 0.08 ? 3 : 4;
  const emit = (i, pos) => accentScore('kick', pos, bpb) * S.kick[i] + accentScore('snare', pos, bpb) * S.snare[i] + (pos === 0 ? HARM * S.harm[i] : 0);
  // Viterbi over the bar phase: state = where in the bar the beat is
  let cost = new Float64Array(bpb);
  for (let s = 0; s < bpb; s++) cost[s] = -emit(0, s);
  const back = [];
  for (let i = 1; i < n; i++) {
    const adv = cum[i] - cum[i - 1], nc = new Float64Array(bpb), bk = new Int32Array(bpb);
    for (let s = 0; s < bpb; s++) {
      let best = Infinity, bi = 0;
      for (let q = 0; q < bpb; q++) { const c = cost[q] + ((q + adv) % bpb === s ? 0 : JUMP); if (c < best) { best = c; bi = q; } }
      nc[s] = best - emit(i, s); bk[s] = bi;
    }
    cost = nc; back.push(bk);
  }
  let st = 0;
  for (let s = 1; s < bpb; s++) if (cost[s] < cost[st]) st = s;
  const pos = new Array(n);
  for (let i = n - 1; i >= 0; i--) { pos[i] = st; if (i > 0) st = back[i - 1][st]; }
  // the phase most beats agree on (cum - pos at the 1), and every constant phase's score for the runner-up
  const votes = new Array(bpb).fill(0);
  for (let i = 0; i < n; i++) votes[(((cum[i] - pos[i]) % bpb) + bpb) % bpb]++;
  let phase = 0;
  for (let p = 1; p < bpb; p++) if (votes[p] > votes[phase]) phase = p;
  const scores = [];
  for (let p = 0; p < bpb; p++) { let s = 0; for (let i = 0; i < n; i++) s += emit(i, (((cum[i] - p) % bpb) + bpb) % bpb); scores.push(s); }
  let alt = null;
  for (let p = 0; p < bpb; p++) if (p !== phase && (alt == null || scores[p] > scores[alt])) alt = p;
  const margin = scores[phase] > 0 ? (scores[phase] - scores[alt]) / scores[phase] : 0;
  return { bpb, cum, phase, alt, margin, scores, meter: { r3, r4 } };
}
