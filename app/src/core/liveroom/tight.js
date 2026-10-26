// @ts-check
// Measuring the pair [core] (docs/research/LIVE-ROOM-MODE.md §4.7): how tightly the right side was played to the left,
// bar by bar, from the two DIs (never through the amps), so the room can say which bar to play again. Pure and
// deterministic.
//
// Frozen (§14.2):
//   measurePair(left, right, { sr, tempo, start, bars, grid }) -> { perBar, median, drift, unmatched, verdict }
//       left, right: Float32Array DIs (mono, the same rate and start)
//       perBar: [{ bar (1 is the part's first), ms (right minus left, the median of its matched attacks: plus is
//                late; null with none), matched, unmatched (the share of its attacks with no partner), drifts }]
//       median: ms over the part   drift: ms per bar (the slope of the bars' figures)
//       unmatched: the share of attacks with no partner   verdict: 'tight' | 'fine' | 'loose' | 'bar' (one or two
//       bars to play again), or null when there's too little to measure
// Its thresholds (LIMIT_MS, a quarter of a sixteenth, UNMATCHED, TIGHT_MS, MATCH_MS) are constants here, printed by
// the bench.
// Also here (seam additions): the options place (the basement's limit is 25 ms) and limit (ms, in place of the
// place's); the result's limit, worst ({ bar, ms, dir: 'late' | 'early' }: the bar the line names), from (the first
// bar that drifts), drifting (how many), and line: { id, vars } for lines/double.js (side.tight, side.fine, side.drift,
// side.wander; the caller adds part).

import { attacksOf } from './read.js';

export const LIMIT_MS = 20, BASEMENT_MS = 25, TIGHT_MS = 10, UNMATCHED = 0.3, MATCH_MS = 60, REFINE_MS = 15;
const median = (xs) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const r1 = (x) => Math.round(x * 10) / 10;

// The slope energy in 1 ms frames, for refining a matched pair's offset by cross-correlation: a strum's smear lines
// up as a whole rather than at its first string.
function frames(x, sr) {
  const F = Math.max(8, Math.round(sr / 1000)), n = Math.floor(x.length / F), e = new Float32Array(n);
  let prev = 0;
  for (let k = 0; k < n; k++) { let s = 0; for (let i = k * F; i < (k + 1) * F; i++) { const d = x[i] - prev; prev = x[i]; s += d * d; } e[k] = Math.sqrt(s / F); }
  return e;
}
function refine(EL, ER, lk, lag0) {
  // the left's 40 ms from its attack against the right's at lags within REFINE_MS of the matched one
  let best = -Infinity, bl = lag0;
  for (let lag = lag0 - REFINE_MS; lag <= lag0 + REFINE_MS; lag++) {
    let s = 0, a2 = 0, b2 = 0;
    for (let k = -3; k < 40; k++) {
      const a = EL[lk + k] || 0, b = ER[lk + k + lag] || 0;
      s += a * b; a2 += a * a; b2 += b * b;
    }
    const c = a2 > 0 && b2 > 0 ? s / Math.sqrt(a2 * b2) : -Infinity;
    if (c > best + 1e-9) { best = c; bl = lag; }
  }
  return bl;
}

export function measurePair(left, right, { sr = 48000, tempo = 120, start = 0, bars = 0, grid = 4, place = null, limit = null } = {}) {
  const none = { perBar: [], median: null, drift: null, unmatched: 0, verdict: null, limit: null, worst: null, from: null, drifting: 0, line: null };
  if (!left || !right || !bars) return none;
  const L = attacksOf(left, sr, { tempo, start, bars, grid }), R = attacksOf(right, sr, { tempo, start, bars, grid });
  if (L.length < 4 || R.length < 4) return none;
  const spb = 60 / tempo, sixteenth = (spb / 4) * 1000;
  const lim = Number.isFinite(limit) ? limit : place === 'basement' ? BASEMENT_MS : Math.min(LIMIT_MS, sixteenth / 4);
  const EL = frames(left, sr), ER = frames(right, sr), F = Math.max(8, Math.round(sr / 1000)) / sr;
  // each left attack to the nearest right attack within MATCH_MS (each right attack used once, the closest pairs first)
  const cand = [];
  L.forEach((a, i) => R.forEach((b, j) => { const d = (b.s - a.s) * 1000; if (Math.abs(d) <= MATCH_MS) cand.push({ i, j, d }); }));
  cand.sort((a, b) => Math.abs(a.d) - Math.abs(b.d) || a.i - b.i || a.j - b.j);
  const li = new Map(), rj = new Set();
  for (const c of cand) if (!li.has(c.i) && !rj.has(c.j)) { li.set(c.i, c); rj.add(c.j); }
  const pairs = [...li.values()].map((c) => {
    const lk = Math.round(L[c.i].s / F), lag = refine(EL, ER, lk, Math.round(c.d));
    return { i: c.i, j: c.j, bar: Math.floor(L[c.i].t / 4 + 1e-6) + 1, ms: lag };
  });
  const perBar = [];
  for (let b = 1; b <= bars; b++) {
    const ps = pairs.filter((x) => x.bar === b), nl = L.filter((a) => Math.floor(a.t / 4 + 1e-6) + 1 === b).length, nr = R.filter((a) => Math.floor(a.t / 4 + 1e-6) + 1 === b).length;
    const total = nl + nr, un = total ? (total - 2 * ps.length) / total : 0;
    const ms = ps.length ? median(ps.map((x) => x.ms)) : null;
    const drifts = total > 0 && ((ms != null && Math.abs(ms) > lim + 1e-9) || un > UNMATCHED + 1e-9);
    perBar.push({ bar: b, ms: ms == null ? null : r1(ms), matched: ps.length, unmatched: Math.round(un * 100) / 100, drifts });
  }
  const all = L.length + R.length, unmatched = Math.round(((all - 2 * pairs.length) / all) * 100) / 100;
  const med = median(pairs.map((x) => x.ms));
  // the slope of the bars' figures (least squares), ms per bar
  const pts = perBar.filter((x) => x.ms != null);
  let drift = null;
  if (pts.length >= 2) {
    const mx = pts.reduce((s, x) => s + x.bar, 0) / pts.length, my = pts.reduce((s, x) => s + x.ms, 0) / pts.length;
    const num = pts.reduce((s, x) => s + (x.bar - mx) * (x.ms - my), 0), den = pts.reduce((s, x) => s + (x.bar - mx) ** 2, 0);
    drift = den > 0 ? r1(num / den) : 0;
  }
  if (pairs.length < 4) return { ...none, perBar, unmatched, limit: lim };
  const drifting = perBar.filter((x) => x.drifts), from = drifting.length ? drifting[0].bar : null;
  const largest = Math.max(0, ...pts.map((x) => Math.abs(x.ms)));
  // the bar the line names: the drifting one furthest off (or with the most unmatched), else the largest figure
  const pool = drifting.length ? drifting : pts;
  const w = pool.slice().sort((a, b) => Math.abs(b.ms ?? 999) - Math.abs(a.ms ?? 999) || b.unmatched - a.unmatched || a.bar - b.bar)[0];
  const worst = w ? { bar: w.bar, ms: w.ms == null ? null : Math.abs(w.ms), dir: (w.ms ?? 0) < 0 ? 'early' : 'late' } : null;
  let verdict, line;
  if (!drifting.length && largest <= TIGHT_MS + 1e-9) { verdict = 'tight'; line = { id: 'side.tight', vars: { ms: Math.max(1, Math.round(largest)) } }; }
  else if (!drifting.length) { verdict = 'fine'; line = { id: 'side.fine', vars: { ms: Math.round(largest) } }; }
  else if (drifting.length <= 2) { verdict = 'bar'; line = { id: 'side.drift', vars: { bar: worst?.bar, dir: worst?.dir, ms: worst?.ms ?? Math.round(lim) } }; }
  else { verdict = 'loose'; line = { id: 'side.wander', vars: { bar: from } }; }
  return { perBar, median: med == null ? null : r1(med), drift, unmatched, verdict, limit: r1(lim), worst, from, drifting: drifting.length, line };
}
