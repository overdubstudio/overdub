// Sections (spec 0014 R16). Each bar of a reading's grid gets its chroma (treble and bass), its timbre (the 12-band
// log-mel spectrum, less the song's mean) and its level. Self-similarity of the bars; Foote novelty with a ±8-bar
// Gaussian checkerboard; boundaries only on bar lines, chosen by a pass that pays for each boundary, earns its novelty
// and favours sections of 4 and 8 bars. Repeats from the lag: two sections are one group when bar k of one is like
// bar k of the other, on average, by GROUP. Names follow the spec's rules (Design, "Section naming rules"):
//   the chorus: the group heard most (twice or more) with the highest level; the verse: the group that comes before
//   the chorus most; the intro and the outro: edge sections, quiet (low vocal level when there is a vocal stem, else
//   low level); a bridge: a group heard once past half way; repeats numbered ("Verse 2"); anything else "Part A",
//   "Part B". They are proposals: the person renames them.
//
//   sectionsOf(reading, { chroma, mel, fps, x, sr, end, vocal? }) -> [{ name, start, length (beats), t0, t1, group,
//       chroma[12] }]
// Pure, Float64.
import { mapSec } from '../../core/music.js';
import { MEL_BANDS } from './onset.js';

export const KERNEL_BARS = 8, BOUNDARY_COST = 0.3, GROUP = 0.86;
const r4 = (x) => Math.round(x * 1e4) / 1e4;
const r6 = (x) => Math.round(x * 1e6) / 1e6;

function barsOf(reading, end) {
  const { anchors, off, bpb } = reading;
  const out = [];
  for (let j = 0; ; j++) {
    const t0 = mapSec(anchors, j * bpb) - off, t1 = mapSec(anchors, (j + 1) * bpb) - off;
    if (t0 >= end - 0.05) break;
    out.push({ j, t0, t1 });
  }
  return out;
}

const cos = (a, b) => { let ab = 0, aa = 0, bb = 0; for (let i = 0; i < a.length; i++) { ab += a[i] * b[i]; aa += a[i] * a[i]; bb += b[i] * b[i]; } return aa > 0 && bb > 0 ? ab / Math.sqrt(aa * bb) : 0; };

function features(bars, { chroma, mel, fps, x, sr, vocal }) {
  const nf = mel.length / MEL_BANDS;
  const F = bars.map((b) => {
    const a = Math.max(0, b.t0), z = Math.max(a, b.t1);
    const tre = chroma.treble.sum(a, z), bas = chroma.bass.sum(a, z), ch = new Float64Array(12);
    let mt = 0, mb = 0;
    for (let p = 0; p < 12; p++) { mt = Math.max(mt, tre[p]); mb = Math.max(mb, bas[p]); }
    for (let p = 0; p < 12; p++) ch[p] = (mt > 0 ? tre[p] / mt : 0) + (mb > 0 ? (0.5 * bas[p]) / mb : 0);
    const tm = new Float64Array(MEL_BANDS);
    const f0 = Math.max(0, Math.ceil(a * fps)), f1 = Math.min(nf, Math.ceil(z * fps));
    for (let f = f0; f < f1; f++) for (let k = 0; k < MEL_BANDS; k++) tm[k] += mel[f * MEL_BANDS + k];
    if (f1 > f0) for (let k = 0; k < MEL_BANDS; k++) tm[k] /= f1 - f0;
    else tm.fill(Math.log(1e-10));
    const lvl = (sig) => { if (!sig) return -120; const s0 = Math.round(a * sr), s1 = Math.min(sig.length, Math.round(z * sr)); let e = 0; for (let i = s0; i < s1; i++) e += sig[i] * sig[i]; return s1 > s0 ? 10 * Math.log10(e / (s1 - s0) + 1e-12) : -120; };
    return { chroma: ch, timbre: tm, db: lvl(x), vdb: vocal ? lvl(vocal) : null };
  });
  // timbre less the song's mean (what sets a section apart, not what the whole record sounds like)
  const mean = new Float64Array(MEL_BANDS);
  for (const f of F) for (let k = 0; k < MEL_BANDS; k++) mean[k] += f.timbre[k] / F.length;
  for (const f of F) for (let k = 0; k < MEL_BANDS; k++) f.timbre[k] -= mean[k];
  return F;
}

function ssmOf(F) {
  const n = F.length, S = new Float64Array(n * n);
  for (let i = 0; i < n; i++) for (let j = i; j < n; j++) {
    const s = 0.4 * cos(F[i].chroma, F[j].chroma) + 0.4 * (0.5 + 0.5 * cos(F[i].timbre, F[j].timbre)) + 0.2 * Math.exp(-Math.abs(F[i].db - F[j].db) / 6);
    S[i * n + j] = s; S[j * n + i] = s;
  }
  return S;
}

function noveltyOf(S, n) {
  const nov = new Float64Array(n + 1);
  for (let b = 1; b < n; b++) {
    // (near an edge the checkerboard shrinks to the bars both sides have: a lopsided one hears the edge, not a change)
    const L = Math.max(1, Math.min(KERNEL_BARS, b, n - b)), sg = Math.max(1, L / 2);
    let s = 0, w = 0;
    for (let i = -L; i < L; i++) for (let j = -L; j < L; j++) {
      const x = b + i, y = b + j;
      if (x < 0 || y < 0 || x >= n || y >= n) continue;
      const g = Math.exp(-((i + 0.5) * (i + 0.5) + (j + 0.5) * (j + 0.5)) / (2 * sg * sg)), sign = (i < 0) === (j < 0) ? 1 : -1;
      s += sign * g * S[x * n + y]; w += g;
    }
    nov[b] = w > 0 ? Math.max(0, s / w) : 0;
  }
  let mx = 0;
  for (const v of nov) mx = Math.max(mx, v);
  if (mx > 0) for (let b = 0; b <= n; b++) nov[b] /= mx;
  return nov;
}

const prior = (len) => (len % 8 === 0 ? 0.3 : len % 4 === 0 ? 0.2 : len % 2 === 0 ? 0 : -0.15);

function boundariesOf(nov, n) {
  // best[b]: the best score of a split of bars 0..b with a boundary at b
  const best = new Float64Array(n + 1).fill(-Infinity), from = new Int32Array(n + 1).fill(-1);
  best[0] = 0;
  for (let b = 1; b <= n; b++) {
    for (let len = 1; len <= Math.min(32, b); len++) {
      const a = b - len;
      if (best[a] === -Infinity) continue;
      const edge = b === n ? 0 : nov[b] - BOUNDARY_COST;
      const s = best[a] + prior(len) + edge - (len < 2 ? 0.5 : 0);
      if (s > best[b]) { best[b] = s; from[b] = a; }
    }
  }
  const cuts = [];
  for (let b = n; b > 0; b = from[b]) cuts.push(b);
  cuts.push(0);
  return cuts.reverse();
}

export function sectionsOf(reading, ctx) {
  const bars = barsOf(reading, ctx.end);
  const n = bars.length;
  if (!n) return [];
  const F = features(bars, ctx);
  // the bars the music is in: not a first bar mostly before the recording (a pickup's bar), nor the silence after the
  // last note (its tail); those join the first and the last section
  const dbs0 = F.map((f) => f.db).sort((a, b) => a - b), loud = dbs0[dbs0.length >> 1];
  let lo = 0, hi = n;
  if (n > 1 && bars[0].t0 < 0 && bars[0].t1 < (bars[0].t1 - bars[0].t0) / 2) lo = 1;
  while (hi - 1 > lo && F[hi - 1].db < loud - 25) hi--;
  const Fm = F.slice(lo, hi), m = Fm.length, S0 = ssmOf(Fm), nov = noveltyOf(S0, m);
  const cuts = boundariesOf(nov, m).map((c) => c + lo);
  cuts[0] = 0; cuts[cuts.length - 1] = n;
  // the similarity over every bar (the edges' bars as their neighbours': their own are silence)
  const S = new Float64Array(n * n);
  const cl = (j) => Math.min(hi - 1, Math.max(lo, j)) - lo;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) S[i * n + j] = S0[cl(i) * m + cl(j)];
  const segs = [];
  for (let i = 0; i + 1 < cuts.length; i++) segs.push({ a: cuts[i], b: cuts[i + 1] });
  // groups: by the lag similarity, each to the first earlier segment it repeats
  const sim = (A, B) => { const m = Math.min(A.b - A.a, B.b - B.a); if (Math.max(A.b - A.a, B.b - B.a) > 2 * m) return 0; let s = 0; for (let k = 0; k < m; k++) s += S[(A.a + k) * n + B.a + k]; return s / m; };
  const groups = [];
  for (const sg of segs) {
    let g = -1, gs = GROUP;
    for (let q = 0; q < groups.length; q++) { const s = sim(groups[q][0], sg); if (s >= gs) { gs = s; g = q; } }
    if (g < 0) { groups.push([sg]); sg.group = groups.length - 1; } else { groups[g].push(sg); sg.group = g; }
  }
  for (const sg of segs) {
    let e = 0, v = 0, k = 0;
    for (let j = sg.a; j < sg.b; j++) { e += F[j].db; if (F[j].vdb != null) v += F[j].vdb; k++; }
    sg.db = e / k; sg.vdb = F[sg.a].vdb != null ? v / k : null;
  }
  const meanDb = (g) => groups[g].reduce((a, s) => a + s.db, 0) / groups[g].length;
  // the chorus: heard most (twice or more), loudest
  let chorus = -1;
  for (let g = 0; g < groups.length; g++) {
    if (groups[g].length < 2) continue;
    if (chorus < 0 || groups[g].length > groups[chorus].length || (groups[g].length === groups[chorus].length && meanDb(g) > meanDb(chorus))) chorus = g;
  }
  // (a tie on count goes to the loudest: re-check the loudest among those heard as often)
  if (chorus >= 0) for (let g = 0; g < groups.length; g++) if (groups[g].length >= 2 && groups[g].length >= groups[chorus].length - 1 && meanDb(g) > meanDb(chorus) + 1) chorus = g;
  const before = new Array(groups.length).fill(0);
  segs.forEach((s, i) => { if (i && s.group === chorus && segs[i - 1].group !== chorus) before[segs[i - 1].group]++; });
  let verse = -1;
  for (let g = 0; g < groups.length; g++) if (g !== chorus && before[g] > 0 && (verse < 0 || before[g] > before[verse])) verse = g;
  const dbs = segs.map((s) => s.db).sort((a, b) => a - b), medDb = dbs[dbs.length >> 1];
  const vdbs = segs.filter((s) => s.vdb != null).map((s) => s.vdb).sort((a, b) => a - b), medV = vdbs.length ? vdbs[vdbs.length >> 1] : null;
  const quiet = (s) => (s.vdb != null && medV != null ? s.vdb < medV - 6 : s.db < medDb - 3);
  const half = bars[n - 1].t1 / 2;
  const names = new Array(segs.length);
  segs.forEach((s, i) => {
    if (s.group === chorus) names[i] = 'Chorus';
    else if (s.group === verse) names[i] = 'Verse';
    else if (i === 0 && segs.length > 1 && groups[s.group].length === 1 && quiet(s)) names[i] = 'Intro';
    else if (i === segs.length - 1 && segs.length > 1 && groups[s.group].length === 1 && quiet(s)) names[i] = 'Outro';
    else if (groups[s.group].length === 1 && bars[s.a].t0 >= half) names[i] = 'Bridge';
  });
  // everything else: Part A, Part B, ... by group, in order of first appearance
  const parts = new Map();
  segs.forEach((s, i) => { if (!names[i]) { if (!parts.has(s.group)) parts.set(s.group, 'Part ' + String.fromCharCode(65 + (parts.size % 26))); names[i] = parts.get(s.group); } });
  const seen = new Map();
  return segs.map((s, i) => {
    const base = names[i], k = (seen.get(base) || 0) + 1;
    seen.set(base, k);
    const ch = new Float64Array(12);
    for (let j = s.a; j < s.b; j++) for (let p = 0; p < 12; p++) ch[p] += F[j].chroma[p];
    return { name: k > 1 ? `${base} ${k}` : base, start: s.a * reading.bpb, length: (s.b - s.a) * reading.bpb, t0: r6(Math.max(0, bars[s.a].t0)), t1: r6(Math.min(ctx.end, bars[s.b - 1].t1)), group: s.group, chroma: Array.from(ch, (v) => r4(v)) };
  });
}
