// @ts-check
// Reading a take [core] (docs/research/LIVE-ROOM-MODE.md §4.2): the DI of a pass (before the amp, which is an insert on
// its track) read for what the band needs: its notes on the place's grid, the chugs the kick goes on, the roots the
// bass plays, the key, and two readings for the room's own lines. The tempo and the 1 are given (you played to the
// count): nothing about a period or a downbeat is guessed. Pure and deterministic (no Math.random; the same samples
// give the same read); it never moves your take, changes the tempo or decides anything about the song's shape.
//
// Frozen (§14.2):
//   readTake(samples, sr, { tempo, start, bars, grid, latency, place })
//       -> { notes, chugs, roots, key, lean, cents, thin }
//       samples: Float32Array (mono), sr: its rate; start: the part's 1, in seconds into samples; bars: the part's
//       bars (4/4); grid: steps per beat (4 sixteenths, 3 triplets); latency: seconds the samples run late, taken off
//       every attack (0 when the take is already placed by the measured latency); place: the scale the key is read in
//       notes: [{ t (beats from the part's 1, on the grid), p (MIDI, null unpitched), d (beats), ms (where it was
//                picked against its grid point, ms: plus is late), v (0-1, its level against the part's median), db,
//                hz }]
//       chugs: the notes the kick follows (within 5 semitones of the lowest note, or unpitched)
//       roots: [pitch class per beat] (null before the first)   key: { root, scale } | null
//       lean: the median offset of chug attacks from the grid, ms   cents: the median tuning of sustained notes, cents
//       thin: too little on the grid to follow (the band keeps the groove's own kick, the bass waits)
//     and, for the band and the bench: low (the lowest pitched note), level (the median attack, dBFS), onsets (every
//     attack heard, on the grid or not), steps (grid steps per beat), beats
//   readInWorker(samples, sr, opts) -> Promise of the same, off the main thread (core/liveroom/read-worker.js, a
//       module Worker; an idle callback where there's no Worker)
// Also here (seam additions): earOf(sr), the room's ear (places.js re-exports it); riffOf(notes, { beats }), the chugs,
// roots and lowest note of notes already on the grid (band.js reads a part's Riff (as heard) clip back with it);
// attacksOf(samples, sr, { tempo, start, bars, grid, latency }), the attacks on the grid alone (tight.js); hear(samples,
// sr), every attack the room's ear hears.

import { createNoteFinder } from '../../input/onsets.js';
import { yin, ftom } from '../../input/pitch.js';

// The room's ear: a 30 Hz floor and a long window, so a power chord's own low note reads (its root an octave under the
// guitar's range), and attacks with no pitch kept (a muted chug is rhythm).
export const earOf = (sr) => ({ sr, lo: 30, win: sr > 50000 ? 8192 : 4096, unpitched: true });

const EPS = 1e-6;
const r4 = (x) => Math.round(x * 10000) / 10000;
const pcOf = (p) => ((Math.round(p) % 12) + 12) % 12;
const median = (xs) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const BLOCK = 2048;
// how far an attack may sit from a grid point and still be on it: 40% of a step (§4.2)
export const SNAP = 0.4;
// a note's end: where its level falls this far under its attack, or the next attack
const DECAY_DB = 18;
// too little to follow: fewer attacks than this on the grid
export const THIN_ONSETS = 8;

// The level of the samples in 4 ms hops (RMS), for each attack's level and each note's end.
function envelope(x, sr) {
  const H = Math.max(16, Math.round(sr * 0.004)), n = Math.ceil(x.length / H), env = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    let s = 0;
    const a = k * H, b = Math.min(x.length, a + H);
    for (let i = a; i < b; i++) s += x[i] * x[i];
    env[k] = Math.sqrt(s / Math.max(1, b - a));
  }
  return { env, H };
}
const dbOf = (x) => (x > 0 ? 20 * Math.log10(x) : -120);

// Every attack the room's ear hears: [{ s (seconds into the samples), p, hz, conf }]
export function hear(samples, sr) {
  const finder = createNoteFinder(earOf(sr)), out = [];
  for (let f0 = 0; f0 < samples.length; f0 += BLOCK) {
    for (const e of finder.push(samples.subarray(f0, Math.min(samples.length, f0 + BLOCK)), f0)) out.push({ s: e.f / sr, p: e.p ?? null, hz: e.hz || 0, conf: e.conf || 0 });
  }
  // a block that ends before the last attack's pitch window is in: a flush of silence lets it read
  for (const e of finder.push(new Float32Array(Math.round(sr * 0.3)), samples.length)) out.push({ s: e.f / sr, p: e.p ?? null, hz: e.hz || 0, conf: e.conf || 0 });
  return out.sort((a, b) => a.s - b.s);
}

// The second ear, for the grid it knows: the note finder waits for a jump over the last 40 ms, so a pick right after a
// ringing chord, or tremolo sixteenths at 200, can pass under it. Here, around each grid point it found nothing at, the
// pick's own jump: the energy of the signal's slope (a pick is a burst of high harmonics) over the next 3 ms against
// the loudest 3 ms of the 30 before, in 1 ms steps. A jump of JUMP_DB or more, at a level within FLOOR_DB of the part's attacks, is an
// attack, placed at the first millisecond of its rise.
const JUMP_DB = 6, FLOOR_DB = 30;
function slopeEnergy(x, sr) {
  const F = Math.max(8, Math.round(sr / 1000)), n = Math.floor(x.length / F), c = new Float64Array(n + 1);
  let prev = 0;
  for (let k = 0; k < n; k++) { let e = 0; for (let i = k * F; i < (k + 1) * F; i++) { const d = x[i] - prev; prev = x[i]; e += d * d; } c[k + 1] = c[k] + e / F; }
  const avg = (a, b) => { const lo = Math.max(0, a), hi = Math.min(n, b); return hi > lo ? (c[hi] - c[lo]) / (hi - lo) : 0; };
  return { n, ms: F / sr, avg };
}
function gridAttack(E, a, b, floor) {
  // the strongest rise in frames [a, b), and the first frame of it that rose half as far
  let best = -Infinity, bk = -1;
  // (against the loudest 3 ms of the 30 before: a low string's own waveform swings its slope's energy within a period)
  const rise = (k) => {
    const after = E.avg(k, k + 3);
    if (after < floor) return -Infinity;
    let before = 0;
    for (let j = k - 30; j <= k - 3; j++) before = Math.max(before, E.avg(j, j + 3));
    return 10 * Math.log10((after + 1e-15) / (before + floor * 1e-3));
  };
  for (let k = Math.max(1, a); k < Math.min(E.n - 3, b); k++) { const r = rise(k); if (r > best) { best = r; bk = k; } }
  if (bk < 0 || best < JUMP_DB) return null;
  let k0 = bk;
  while (k0 > a && rise(k0 - 1) >= best / 2) k0--;
  return { k: k0, rise: best };
}

// The chugs, the roots and the lowest note of notes on a grid: notes [{ t, p, d }] (beats), beats: how many.
//   chugs: within 5 semitones of the lowest pitched note, or unpitched (a palm mute is rhythm)
//   roots: per beat, the lowest pitch sounding for 40% of the beat or more (repeated chugs on one note count together);
//          a beat without one keeps the last root, and the beats before the first take the first
export function riffOf(notes, { beats = 0 } = {}) {
  const pitched = notes.filter((n) => n.p != null);
  const low = pitched.length ? pitched.reduce((m, n) => Math.min(m, n.p), Infinity) : null;
  const chugs = notes.filter((n) => n.p == null || (low != null && n.p <= low + 5));
  const B = Math.max(0, Math.round(beats || (notes.length ? Math.ceil(notes[notes.length - 1].t + EPS) : 0)));
  const roots = new Array(B).fill(null), held = new Array(B).fill(null);
  for (let b = 0; b < B; b++) {
    const sound = new Map();
    for (const n of pitched) {
      const over = Math.min(b + 1, n.t + n.d) - Math.max(b, n.t);
      if (over > EPS) sound.set(n.p, (sound.get(n.p) || 0) + over);
    }
    const ok = [...sound].filter(([, d]) => d >= 0.4 - EPS).map(([p]) => p);
    if (ok.length) held[b] = Math.min(...ok);
  }
  let last = null;
  for (let b = 0; b < B; b++) { if (held[b] != null) last = held[b]; roots[b] = last == null ? null : pcOf(last); }
  const first = roots.find((r) => r != null);
  if (first != null) for (let b = 0; b < B && roots[b] == null; b++) roots[b] = first;
  return { chugs, roots, low, held };
}

// The riff's floor: the lowest pitch at least a sixth of its pitched notes sit on (or the lowest, with fewer than six).
function floorOf(ps) {
  if (!ps.length) return null;
  const count = new Map();
  for (const p of ps) count.set(p, (count.get(p) || 0) + 1);
  const need = ps.length >= 6 ? ps.length / 6 : 1;
  return [...count].filter(([, n]) => n >= need - EPS).map(([p]) => p).sort((a, b) => a - b)[0] ?? Math.min(...ps);
}

// The key's root: the pitch class the riff's lowest notes sit on, weighted by how long each is held and a beat more
// for the part's 1 (the prototype's rootOf).
function keyRoot(notes, low) {
  if (low == null) return null;
  const w = new Map();
  for (const n of notes) if (n.p != null && n.p <= low + 5) w.set(pcOf(n.p), (w.get(pcOf(n.p)) || 0) + n.d + (Math.abs(n.t) < EPS ? 1 : 0));
  return [...w].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0] ?? null;
}
const SCALES = { metal: 'minor', basement: 'minor', bluesbar: 'blues' };

const mtof = (m) => 440 * 2 ** ((m - 69) / 12);
// The period of a short stretch (half rate): YIN's cumulative mean normalised difference, its window whatever the
// stretch leaves after the longest period looked for (the ear's own window wants four periods; this wants one and a
// half). Nothing when no dip goes under 0.5.
function shortPeriod(seg, sr, loHz, hiHz) {
  const n = seg.length >> 1, hs = sr / 2, x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = (seg[2 * i] + seg[2 * i + 1]) * 0.5;
  const maxT = Math.floor(hs / loHz), minT = Math.max(2, Math.floor(hs / hiHz)), W = n - maxT;
  if (W < maxT * 0.5 || maxT <= minT + 2) return 0;
  const d = new Float32Array(maxT + 1);
  let sum = 0;
  d[0] = 1;
  for (let t = 1; t <= maxT; t++) {
    let a = 0;
    for (let i = 0; i < W; i++) { const v = x[i] - x[i + t]; a += v * v; }
    sum += a;
    d[t] = sum > 0 ? (a * t) / sum : 1;
  }
  // the deepest dip, then the shortest period whose own dip comes within 0.1 of it (a period's multiples dip too)
  let best = 1;
  for (let t = minT; t < maxT; t++) if (d[t] < best) best = d[t];
  if (best >= 0.5) return 0;
  for (let t = minT; t < maxT; t++) {
    if (d[t] <= best + 0.1) { while (t + 1 < maxT && d[t + 1] < d[t]) t++; return hs / t; }
  }
  return 0;
}

// The attacks of a take on the grid it knows: the room's ear and the second ear, each attack snapped to a grid point
// within 40% of a step, one per point (the louder). -> { pts: [{ s, t, off (beats off the point), p, hz, conf, db, end,
// at }], onsets (every attack, on the grid or not), heard, env, H, spb, step, steps, beats }
function onGrid(x, sr, { tempo = 120, start = 0, bars = 0, grid = 4, latency = 0 } = {}) {
  const spb = 60 / tempo, steps = grid === 3 ? 3 : grid > 0 ? Math.round(grid) : 4, step = 1 / steps;
  const beats = Math.max(0, Math.round(bars * 4));
  const heard = x.length ? hear(x, sr) : [];
  const { env, H } = envelope(x, sr);
  const peakAt = (s) => { const a = Math.max(0, Math.floor(s * sr / H)), b = Math.min(env.length, a + Math.ceil(0.03 * sr / H) + 1); let m = 0; for (let k = a; k < b; k++) m = Math.max(m, env[k]); return m; };
  // each attack: its level, and where it ends (its level DECAY_DB under the attack, or the next attack)
  /** @type {any[]} */
  const onsets = heard.map((h, i) => {
    const pk = peakAt(h.s), next = i + 1 < heard.length ? heard[i + 1].s : x.length / sr;
    let end = next;
    const thr = pk * 10 ** (-DECAY_DB / 20);
    for (let k = Math.floor(h.s * sr / H) + Math.ceil(0.03 * sr / H); k < env.length && k * H / sr < next; k++) if (env[k] < thr) { end = k * H / sr; break; }
    const at = (h.s - latency - start) / spb;
    return { ...h, at, db: dbOf(pk), end: (end - latency - start) / spb };
  });
  // the second ear, at the grid points the first heard nothing near
  if (onsets.length && beats > 0) {
    const E = slopeEnergy(x, sr);
    let top = 0;
    for (const o of onsets) top = Math.max(top, E.avg(Math.round((o.s) / E.ms), Math.round(o.s / E.ms) + 3));
    const floor = top * 10 ** (-FLOOR_DB / 10), have = onsets.map((o) => o.at);
    for (let k = 0; k * step < beats - EPS; k++) {
      const g = k * step;
      if (have.some((t) => Math.abs(t - g) <= SNAP * step + EPS)) continue;
      const toFrame = (beat) => Math.round(((beat * spb) + start + latency) / E.ms);
      const hit = gridAttack(E, toFrame(g - SNAP * step), toFrame(g + SNAP * step), floor);
      if (!hit) continue;
      const s0 = hit.k * E.ms, at = (s0 - latency - start) / spb;
      // its pitch: what the finder heard sounding just before or after, else none (rhythm)
      const near = heard.find((h) => h.s > s0 - 0.03 && h.s < s0 + 0.12) || null;
      const i = onsets.findIndex((o) => o.at > at);
      const nextS = i >= 0 ? onsets[i].s : x.length / sr, pk = peakAt(s0);
      let end = nextS;
      const thr = pk * 10 ** (-DECAY_DB / 20);
      for (let q = Math.floor(s0 * sr / H) + Math.ceil(0.03 * sr / H); q < env.length && q * H / sr < nextS; q++) if (env[q] < thr) { end = q * H / sr; break; }
      const o = { s: s0, p: near ? near.p : null, hz: near ? near.hz : 0, conf: near ? near.conf : 0, at, db: dbOf(pk), end: (end - latency - start) / spb, second: true };
      if (i >= 0) onsets.splice(i, 0, o); else onsets.push(o);
    }
  }
  // on the grid it knows: within 40% of a step of a grid point inside the part, one note per point (the louder)
  const byPoint = new Map();
  for (const o of onsets) {
    const k = Math.round(o.at / step), t = k * step, off = o.at - t;
    if (Math.abs(off) > SNAP * step + EPS || t < -EPS || t >= beats - EPS) continue;
    const had = byPoint.get(k);
    if (!had || o.db > had.db) byPoint.set(k, { ...o, t: r4(t) || 0, off });
  }
  const pts = [...byPoint.values()].sort((a, b) => a.t - b.t);
  return { pts, onsets, heard, env, H, spb, step, steps, beats };
}

// The attacks on the grid alone, for measuring the pair (tight.js): [{ s (seconds into the samples), t (the grid
// point, beats from the part's 1), off (ms from it), db }]
export function attacksOf(samples, sr, { tempo = 120, start = 0, bars = 0, grid = 4, latency = 0 } = {}) {
  const x = samples instanceof Float32Array ? samples : Float32Array.from(samples || []);
  const { pts, spb } = onGrid(x, sr, { tempo, start, bars, grid, latency });
  return pts.map((o) => ({ s: o.s, t: o.t, off: Math.round(o.off * spb * 10000) / 10, db: Math.round(o.db * 10) / 10 }));
}

export function readTake(samples, sr, { tempo = 120, start = 0, bars = 0, grid = 4, latency = 0, place = null } = {}) {
  const x = samples instanceof Float32Array ? samples : Float32Array.from(samples || []);
  const { pts, onsets, spb, step, steps, beats } = onGrid(x, sr, { tempo, start, bars, grid, latency });
  // an attack the finder couldn't name (its window ran into the next notes, or the strings were still settling) is
  // read again between it and the next attack: 22, 50 and 100 ms past the pick, the surest reading kept
  pts.forEach((o, i) => {
    if (o.p != null) return;
    const nextS = i + 1 < pts.length ? pts[i + 1].s : x.length / sr;
    /** @type {{ hz: number, conf: number } | null} */
    let best = null;
    for (const settle of [0.022, 0.05, 0.1]) {
      const a = Math.round((o.s + settle) * sr), n = Math.min(Math.round(sr * 0.17), Math.round((nextS - 0.004) * sr) - a);
      if (n < Math.round(sr * 0.03) || a + n > x.length) continue;
      const y = /** @type {any} */ (yin(x.subarray(a, a + n), sr, { lo: 30, hi: 1300 }));
      if (y.hz > 0 && y.conf >= 0.45 && (!best || y.conf > best.conf)) best = { hz: y.hz, conf: y.conf };
    }
    if (best) { o.p = Math.round(ftom(best.hz)); o.hz = best.hz; o.conf = best.conf; }
  });
  // a power chord reads as its common fundamental, an octave under its root (the ear's 30 Hz floor is for that): a
  // reading a tritone or more under the riff's floor (the lowest pitch a sixth of its notes or more sit on) is a chord
  // an octave down, and goes up one
  const floorP = floorOf(pts.filter((o) => o.p != null).map((o) => o.p));
  if (floorP != null) for (const o of pts) if (o.p != null && o.p <= floorP - 6) { o.p += 12; if (o.hz) o.hz *= 2; }
  // what's still unnamed is a palm mute (rhythm) unless it's plainly a note a tritone or more over the floor: a short
  // chord between chugs has too little room for the ear's window, so its period is looked for in what room it has
  if (floorP != null) {
    pts.forEach((o, i) => {
      if (o.p != null) return;
      const nextS = i + 1 < pts.length ? pts[i + 1].s : x.length / sr;
      const a = Math.round((o.s + 0.012) * sr), n = Math.min(Math.round(sr * 0.12), Math.round((nextS - 0.004) * sr) - a);
      if (n < Math.round(sr * 0.04) || a + n > x.length) return;
      const hz = shortPeriod(x.subarray(a, a + n), sr, mtof(floorP - 13), mtof(floorP + 19));
      if (!hz) return;
      let p = Math.round(ftom(hz));
      if (p <= floorP - 6) p += 12;
      if (p >= floorP + 6) { o.p = p; o.hz = p > Math.round(ftom(hz)) ? hz * 2 : hz; o.conf = 0.3; }
    });
  }
  const level = median(pts.map((o) => o.db));
  const notes = pts.map((o, i) => {
    const nextT = i + 1 < pts.length ? pts[i + 1].t : beats;
    const d = r4(Math.max(step / 2, Math.min(nextT, Math.max(o.t + step / 2, o.end)) - o.t));
    const v = level == null ? 0.8 : Math.max(0.1, Math.min(1, 0.7 + (o.db - level) / 20));
    return { t: o.t, p: o.p, d, ms: Math.round(o.off * spb * 10000) / 10, v: r4(v), db: Math.round(o.db * 10) / 10, hz: o.hz ? Math.round(o.hz * 100) / 100 : 0 };
  });
  const { chugs, roots, low } = riffOf(notes, { beats });
  // the lean: where your chugs land against the grid (plus is late); the tuning: sustained pitched notes against the
  // nearest semitone
  const lean = median(chugs.map((n) => n.ms));
  const sustained = notes.filter((n) => n.p != null && n.hz > 0 && n.d >= 0.5 - EPS);
  const cents = median(sustained.map((n) => 1200 * Math.log2(n.hz / (440 * 2 ** ((n.p - 69) / 12)))));
  const root = keyRoot(notes, low);
  const thin = notes.length < THIN_ONSETS || !roots.some((r) => r != null);
  return {
    notes, chugs, roots,
    key: root == null ? null : { root, scale: SCALES[place] || 'minor' },
    lean: lean == null ? null : Math.round(lean * 10) / 10,
    cents: cents == null ? null : Math.round(cents * 10) / 10,
    thin, low, level: level == null ? null : Math.round(level * 10) / 10, steps, beats,
    onsets: onsets.map((o) => ({ at: r4(o.at), p: o.p, db: Math.round(o.db * 10) / 10 })),
    sustained: sustained.length,
  };
}

// Off the main thread: one module Worker, made the first time it's needed, answering by id. Where there's no Worker
// (Node, an old browser), the read runs in an idle callback (or on the next turn), so a pass never stalls the frames
// it lands in.
let worker = null, seq = 0;
const waiting = new Map();
function theWorker() {
  if (worker !== null) return worker;
  const W = /** @type {any} */ (globalThis).Worker;
  worker = false;
  if (typeof W !== 'function') return worker;
  try {
    worker = new W(new URL('./read-worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => {
      const { id, read, error } = e.data || {};
      const w = waiting.get(id);
      if (!w) return;
      waiting.delete(id);
      if (error) w.reject(new Error(error)); else w.resolve(read);
    };
    worker.onerror = () => { for (const w of waiting.values()) w.fallback(); waiting.clear(); worker = false; };
  } catch { worker = false; }
  return worker;
}
function later(fn) {
  const g = /** @type {any} */ (globalThis);
  if (typeof g.requestIdleCallback === 'function') g.requestIdleCallback(fn, { timeout: 500 }); else setTimeout(fn, 0);
}
export function readInWorker(samples, sr, opts = {}) {
  const local = () => new Promise((resolve, reject) => later(() => { try { resolve(readTake(samples, sr, opts)); } catch (e) { reject(e); } }));
  const w = theWorker();
  if (!w) return local();
  return new Promise((resolve, reject) => {
    const id = ++seq;
    waiting.set(id, { resolve, reject, fallback: () => local().then(resolve, reject) });
    // (a copy goes over, so the caller's samples stay theirs)
    const copy = Float32Array.from(samples || []);
    try { w.postMessage({ id, samples: copy, sr, opts }, [copy.buffer]); } catch { waiting.delete(id); local().then(resolve, reject); }
  });
}
