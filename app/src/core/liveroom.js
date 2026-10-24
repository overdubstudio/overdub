// The live room's music [core, a prototype: ?room]: the places you can play (a room, its rig, its band), "play it
// twice" (a riff found in what you play, with its tempo and its 1), and the band that comes in under it. Pure: no DOM,
// no Math.random, so Node and the browser give the same band for the same riff. The room itself is ui/liveroom.js.
//
//   PLACES, PLACE_IDS, placeOf(id)
//   earOf(sr) -> the note finder's options for the room (input/onsets.js createNoteFinder; ui/liveroom.js and
//       tools/liveroom-bench.js both hear with it)
//   findRiff(onsets, { place, gap, need }) -> riff | null
//       onsets: [{ t (seconds, any clock), p (MIDI, null when unpitched), ps? (other pitches it could be) }], in order.
//       A riff is the last stretch of playing (since a pause of `gap` seconds) that repeats: the newest pass matches
//       the pass before it, note for note (onset within a few tens of ms, same pitch class), checked at the last two
//       onsets so one lucky line-up isn't enough. The shortest period that matches as well as any is the riff (a riff
//       with a different last bar is two bars, not one). Its tempo is a whole number of beats in that period (2, 4, 8 or
//       16) at the place's kind of tempo, the notes on the place's grid; its 1 is the riff's first note, the place you
//       started it from.
//       -> { period (s), t0 (the first pass's first note), last (the newest pass's first note), passes, n (beats), bars,
//            bpm, root (pitch class), notes: [{ t (beats from the 1), p, d }] (one pass, on the grid), score }
//   riffFromTaps(onsets, [ta, tb], { place, snap }) -> riff | null   tap the 1: two taps on the riff's 1 (each moved to
//       the note it was meant for) give its start and its length when it wasn't caught by ear; tapped: true
//   fitsRiff(riff, onset) -> bool   whether a note is where the riff has one (the room calls the band off when two of
//       the notes after it heard the riff don't fit: what it heard was part of something longer)
//   nextEntry(riff, now, { lead, minPasses }) -> { t, beat, pass }   the first pass start the band can make: `lead`
//       seconds from now at least, after `minPasses` passes, and on a bar line (a two-beat riff comes in on a bar)
//   bandFor(place, riff, { from, length, seed, count }) -> { drums, bass, chords }   notes from `from` (beats) for
//       `length` beats: the place's grooves in 8-bar phrases (the twelve-bar at the blues bar) with a fill to end each
//       and a crash to start the next; the metal club's kick on your chugs; the bass doubling the riff (metal), on its
//       roots in eighths (punk) or walking the boogie through the changes (blues). count: one bar of sticks first.
//   bandOps(place, riff, { from, length, kit, seed, count }) -> ops for one dispatch: Drums and Bass, each a track with
//       one clip (from `from` for `length` beats), at the place's levels
//   chordAt(place, riff, beat, from) -> { name, next, bar, of } | null   the blues bar's chart: where the form is
//   AMP, AMP_NAME, RIGS, rigChain(id) -> [{ device, params, on }] | null, rigLabel(id)   the amp on the stage, its
//       settings, and a setting's name as the studio gives a device on a preset ("Half Stack, Modern")

import { realize, getGroove } from './grooves.js';
import STACK from '../devices/builtin/stack.js';
import { presetParams } from '../devices/registry.js';

const EPS = 1e-6;
const r4 = (x) => Math.round(x * 10000) / 10000;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const pcOf = (p) => ((Math.round(p) % 12) + 12) % 12;
const NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
export const pcName = (pc) => NAMES[pcOf(pc)];

/* ------------------------------------------------------------------------------------------------ the amp */
// The amp on every stage is Half Stack (core.stack): a kernel, so a take sounds the same live, in the studio's renders
// and in the canonical Node one, and it breaks up at the level a guitar comes in at. (The Guitar Studio rigs the room
// started with were voiced for a hot input: at a moderate one, peaks around -24 dBFS, their amps hardly break up, and a
// guitar through them sounds like its DI.) A rig is one of its settings: a preset of its own with the knobs given over
// it (GAIN, as its description has it: 3 crunch, 5 hard rock, 6 to 7 modern metal rhythm), and LEVEL so it comes out as
// loud as Modern, measured (tools/liveroom-test.js, on its metal DI fixtures). The rig ids are the room's own (R.rig).
export const AMP = 'core.stack', AMP_NAME = STACK.name;
export const RIGS = {
  modern: { id: 'modern', name: 'Modern', preset: 'Modern' },
  djent: { id: 'djent', name: 'Djent', preset: 'Djent', params: { level: -0.4 } },
  thrash: { id: 'thrash', name: 'Thrash', preset: 'Thrash', params: { level: -2.5 } },
  hardrock: { id: 'hardrock', name: 'Hard rock', preset: 'Modern', params: { gain: 5, level: 0.6 } },
  crunch: { id: 'crunch', name: 'Crunch', preset: 'Modern', params: { gain: 3, level: 1.7 } },
  edge: { id: 'edge', name: 'Edge of breakup', preset: 'Modern', params: { gain: 2, level: 2.4 } },
};
export function rigChain(id) {
  const r = RIGS[id];
  return r ? [{ device: AMP, params: { ...(presetParams(STACK, r.preset) || {}), ...(r.params || {}) }, on: true }] : null;
}
export const rigLabel = (id) => (RIGS[id] ? `${AMP_NAME}, ${RIGS[id].name}` : AMP_NAME);

/* ------------------------------------------------------------------------------------------------ the places */
// Each place: its tempo (the range a riff's tempo is read in, and the one it leans to), its grid (4: sixteenths; 3:
// eighth-note triplets, a shuffle), its rigs (RIGS: the first one plugged in, the next heavier, the last cleaner), its
// grooves (core/grooves.js ids), its bass, the scale the song is set to, the band's levels, and what's painted on the kick.
// The levels are faders, measured (tools/liveroom-test.js): a reference DI of the place's own riff with its peaks at
// -12 dBFS (a guitar as an interface brings it in), through the place's first rig at LIVE_DB (ui/liveroom.js), sits
// 3 dB over the band, and the drums 3 dB over the bass.
export const PLACES = {
  basement: {
    id: 'basement', name: 'The basement', what: 'Punk', blurb: 'Fast and loud, under somebody’s house.',
    tempo: [140, 210], prefer: 172, grid: 4, scale: 'minor', rigs: ['hardrock', 'modern', 'thrash'],
    drums: { style: 'punk', verse: 'punk/straight-punk', chorus: 'punk/open-eighths', fill: 'punk/snare-to-floor', kit: { device: 'core.drums', params: { kit: 0, room: 0.4, tone: 0.2, decay: 1, drive: 0.3 } } },
    bass: { mode: 'eighths', params: { style: 1, tone: 0.5, pickup: 0.5, sustain: 1, mute: 0.1, drive: 0.5 } },
    gain: { drums: -6.5, bass: -6 },
    kick: 'SUMP PUMP',
  },
  metal: {
    id: 'metal', name: 'The metal club', what: 'Metal', blurb: 'Tight and heavy. The kick locks to your chugs.',
    tempo: [90, 200], prefer: 132, grid: 4, scale: 'minor', rigs: ['modern', 'djent', 'thrash'],
    drums: { style: 'modernmetal', verse: 'modernmetal/djent-unison-quarters-on-the-hat', chorus: 'modernmetal/open-chorus-crash-riding', fill: 'modernmetal/kick-and-snare-flurry', follow: true, kit: { device: 'core.drums', params: { kit: 5, room: 0.3, tone: 0.2, decay: 0.9, drive: 0.4 } } },
    bass: { mode: 'double', params: { style: 1, tone: 0.5, pickup: 0.35, sustain: 1, mute: 0.08, drive: 0.6 } },
    gain: { drums: -6, bass: -6 },
    kick: 'VOID',
  },
  bluesbar: {
    id: 'bluesbar', name: 'The blues bar', what: 'Blues', blurb: 'A shuffle in a small room, twelve bars at a time.',
    tempo: [66, 140], prefer: 96, grid: 3, scale: 'blues', rigs: ['crunch', 'hardrock', 'edge'],
    drums: { style: 'shuffle', verse: 'shuffle/shuffle', chorus: 'shuffle/double-shuffle', fill: 'shuffle/triplet-pickup', kit: { device: 'core.drums', params: { kit: 5, room: 0.45, tone: 0, decay: 1, drive: 0.15 } } },
    bass: { mode: 'boogie', params: { style: 0, tone: 0.35, pickup: 0.25, sustain: 1, mute: 0.08, drive: 0.2 } },
    // the twelve-bar, in steps from the riff's root (I, IV, V)
    form: [0, 0, 0, 0, 5, 5, 0, 0, 7, 5, 0, 7],
    gain: { drums: -3, bass: -7 },
    kick: 'LAST CALL',
  },
};
export const PLACE_IDS = Object.keys(PLACES);

// The room's ear: a 30 Hz floor and a long window, so a power chord's own low note reads (its root an octave under the
// guitar's range), and attacks with no pitch kept (a muted chug is rhythm).
export const earOf = (sr) => ({ sr, lo: 30, win: sr > 50000 ? 8192 : 4096, unpitched: true });
export const placeOf = (id) => PLACES[id] || PLACES.metal;

/* ------------------------------------------------------------------------------------------------ play it twice */
// Two onsets are the same note when they share a pitch class (an octave slip or a chord's other note still counts);
// one with no pitch matches anything (a muted chug is rhythm).
function same(a, b) {
  if (a.p == null || b.p == null) return true;
  const A = [a.p, ...(a.ps || [])].map(pcOf), B = [b.p, ...(b.ps || [])].map(pcOf);
  return A.some((x) => B.includes(x));
}
// How the newest pass (the period up to tEnd) matches the one before it. Each note in it looks for its partner one
// period back (within tol), allowing the pass a little faster or slower than the last (a person's tempo breathes:
// warp, up to 3%). Only what was played counts: while the second pass is still going, its notes are matched against
// the part of the first they line up with (cover: how much of a pass that is). -> { score (matched notes over all
// notes in both), matched, cover, period (the mean gap of the pairs), pairs: [[earlier, later]] } | null (fewer
// than three notes a side)
function matchAt(run, tEnd, P, start) {
  const tol = clamp(P * 0.025, 0.035, 0.07);
  const from = Math.max(tEnd - 2 * P + tol, start - tol);
  const cover = (tEnd - P + tol - from) / P;
  const A = [], B = [];
  for (const o of run) {
    if (o.t > tEnd - P + tol && o.t <= tEnd + EPS) { if (o.t - P >= from - tol) A.push(o); }
    else if (o.t > from && o.t <= tEnd - P + tol) B.push(o);
  }
  if (A.length < 3 || B.length < 3) return null;
  let best = null;
  for (const warp of [0, -0.01, 0.01, -0.02, 0.02, -0.03, 0.03]) {
    const used = new Set(), pairs = [];
    for (const a of A) {
      // (the pass is stretched about its own last note: a note x before tEnd has its partner x(1+warp) before tEnd-P)
      const want = tEnd - P - (tEnd - a.t) * (1 + warp);
      let bj = -1, be = tol;
      for (let j = 0; j < B.length; j++) {
        if (used.has(j)) continue;
        const e = Math.abs(B[j].t - want);
        if (e <= be && same(a, B[j])) { be = e; bj = j; }
      }
      if (bj >= 0) { used.add(bj); pairs.push([B[bj], a]); }
    }
    const score = (2 * pairs.length) / (A.length + B.length);
    if (!best || score > best.score + EPS) best = { score, matched: pairs.length, pairs, cover };
    if (score > 0.999) break;
  }
  best.period = best.pairs.reduce((s, [b, a]) => s + (a.t - b.t), 0) / Math.max(1, best.pairs.length);
  return best;
}

// How well every note in the last `span` seconds has its partner one period back (only notes whose partner time was
// played count): 0..1
function holds(run, tEnd, P, span, start) {
  const tol = clamp(P * 0.025, 0.035, 0.07);
  let n = 0, ok = 0;
  for (const a of run) {
    if (a.t <= tEnd - span + tol || a.t > tEnd + EPS || a.t - P < start - tol) continue;
    n++;
    if (run.some((b) => b !== a && Math.abs(b.t - (a.t - P)) <= tol * 1.4 && same(a, b))) ok++;
  }
  return n ? ok / n : 0;
}

// Whether a note fits the riff: a note of the riff sits where it falls in the pass (within the timing a person has,
// or half a step of the grid the riff was put on), with its pitch.
export function fitsRiff(riff, o) {
  const P = riff.period, spb = P / riff.n, step = spb / (riff.grid || 4);
  const tol = Math.max(clamp(P * 0.025, 0.035, 0.07), step * 0.6);
  const x = (((o.t - riff.t0) % P) + P) % P;
  return riff.notes.some((nt) => {
    const d = Math.abs(nt.t * spb - x);
    return Math.min(d, P - d) <= tol && same(o, nt);
  });
}

// The tempo a period is at: n beats in it (2, 4, 8 or 16), at the place's kind of tempo, with the notes on a grid:
// sixteenths or eighth-note triplets, whichever they sit on better (the place's own first, by a hair). err: how far
// off the grid the notes sit, in steps of it (0 on it, 0.5 halfway between).
function tempoOf(P, rel, place) {
  const [lo, hi] = place.tempo, own = place.grid || 4;
  let best = null;
  for (const n of [2, 4, 8, 16]) {
    const bpm = (n * 60) / P;
    const out = bpm < lo ? Math.log2(lo / bpm) : bpm > hi ? Math.log2(bpm / hi) : 0;
    const lean = Math.abs(Math.log2(bpm / place.prefer));
    for (const grid of [own, own === 4 ? 3 : 4]) {
      let err = 0;
      for (const x of rel) { const g = ((x * bpm) / 60) * grid; err += Math.abs(g - Math.round(g)); }
      err = err / Math.max(1, rel.length) + (grid === own ? 0 : 0.02);
      const score = -4 * out - lean - 1.5 * err;
      if (!best || score > best.score) best = { n, bpm, score, err, grid, out };
    }
  }
  return best;
}
const OFF_GRID = 0.16;   // a period whose notes sit further off every beat grid than this isn't a riff's

export function findRiff(onsets, { place = 'metal', gap = 2.5, need = 0.85, minPeriod = 0.6, maxPeriod = 10 } = {}) {
  const P = placeOf(place);
  if (!Array.isArray(onsets) || onsets.length < 6) return null;
  // the run: what you've played since the last pause
  let i0 = onsets.length - 1;
  while (i0 > 0 && onsets[i0].t - onsets[i0 - 1].t < gap) i0--;
  const run = onsets.slice(i0);
  if (run.length < 6) return null;
  const L = run.length - 1, last = run[L], start = run[0].t;
  // the periods worth trying: from each of the newest three notes back to an earlier one with its pitch
  const cands = [];
  for (let a = L; a >= Math.max(1, L - 2); a--) {
    for (let b = a - 1; b >= 0; b--) {
      const d = run[a].t - run[b].t;
      if (d > maxPeriod) break;
      if (d >= minPeriod && same(run[a], run[b]) && !cands.some((c) => Math.abs(c - d) < 0.015)) cands.push(d);
    }
  }
  cands.sort((x, y) => x - y);
  const good = [];
  for (const d of cands) {
    const m = matchAt(run, last.t, d, start);
    // half a pass heard twice at least, four notes matched, nearly all of them
    if (!m || m.score < need || m.matched < 4 || m.cover < 0.5) continue;
    // (and still so at the note before, a little looser: one lucky line-up is not a riff)
    const prev = matchAt(run, run[L - 1].t, m.period, start);
    if (prev && prev.score < need - 0.1) continue;
    // (a short period, three passes)
    if (m.period < 1.2) { const third = matchAt(run, last.t - m.period, m.period, start); if (!third || third.score < need) continue; }
    // (and a whole number of beats with the notes on a grid, at a tempo a band plays: 13 sixteenths of a chug riff
    // line up with themselves too)
    const t0 = Math.min(...m.pairs.map(([b]) => b.t));
    const tp = tempoOf(m.period, run.filter((o) => o.t >= t0 - 0.03 && o.t < t0 + m.period - 0.03).map((o) => o.t - t0), P);
    if (tp.err > OFF_GRID || tp.out > 0.25) continue;
    good.push(m);
  }
  if (!good.length) return null;
  const top = Math.max(...good.map((m) => m.score));
  // the shortest period that matches as well as any, unless a longer one matches too and the short one doesn't hold
  // over the long one's span (four bars whose first and third are alike are a four-bar riff, not a one-bar one)
  const m = good.find((x) => x.score >= top - 0.06 && good.every((y) => y.period < x.period * 1.5 || holds(run, last.t, x.period, y.period, start) >= need));
  if (!m) return null;
  const period = m.period, tol = clamp(period * 0.025, 0.035, 0.07);
  // the 1: the first note of the earliest pass that still matches the one after it
  let first = Math.min(...m.pairs.map(([b]) => b.t));
  for (let k = 1; k < 16; k++) {
    const back = matchAt(run, last.t - k * period, period, start);
    if (!back || back.score < 0.6) break;
    const f = Math.min(...back.pairs.map(([b]) => b.t));
    if (f < first - period * 0.5) first = f; else break;
  }
  const t0 = first, firstNote = run.find((o) => o.t === t0) || last;
  // the newest pass's own first note (the band counts from it: drift since the first pass doesn't add up)
  const k = Math.max(0, Math.floor((last.t - t0 + tol) / period));
  const near = run.find((o) => Math.abs(o.t - (t0 + k * period)) < tol && same(o, firstNote));
  const lastStart = near ? near.t : t0 + k * period;
  return { period, t0, last: lastStart, passes: k + 1, ...onGrid(run, t0, period, P), score: r4(m.score), place: P.id };
}

// One pass of a riff, on the grid, for the band: its beats, tempo and grid (tempoOf), and its notes in beats from the 1.
function onGrid(run, t0, period, P) {
  const tol = clamp(period * 0.025, 0.035, 0.07);
  const pass = run.filter((o) => o.t >= t0 - tol && o.t < t0 + period - tol);
  const tp = tempoOf(period, pass.map((o) => o.t - t0), P);
  const n = tp.n, step = 1 / tp.grid, notes = [];
  for (const o of pass) {
    const t = r4(Math.round((((o.t - t0) / period) * n) / step) * step);
    if (t >= n - EPS || notes.some((x) => Math.abs(x.t - t) < EPS)) continue;
    notes.push({ t, p: o.p == null ? null : Math.round(o.p) });
  }
  notes.sort((a, b) => a.t - b.t);
  notes.forEach((x, i) => { x.d = r4((i + 1 < notes.length ? notes[i + 1].t : n) - x.t); });
  return { n, bars: Math.max(1, n / 4), bpm: Math.round(tp.bpm * 10) / 10, grid: tp.grid, root: rootOf(notes), notes };
}

// Tap the 1: two taps on a riff's 1 (a key, or a footswitch that types one) say where it starts and how long it is,
// when the riff wasn't caught by ear (findRiff is strict on purpose). Each tap moves to the note it was meant for, the
// nearest onset within `snap` seconds (a key is less exact than the string's attack); the notes between the two are
// the riff, read at the place's kind of tempo. No grid check: the person said it's a riff. Its length is the two 1s'
// gap, or, when the riff was played before the first tap too, every note of the tapped pass against its partner a pass
// before (the mean gap of the pairs, as findRiff's), so one late 1 doesn't set the band's tempo.
// -> riff (findRiff's fields; score null, tapped: true) | null (taps under 0.6 s or over 10 s apart)
export function riffFromTaps(onsets, taps, { place = 'metal', snap = 0.12 } = {}) {
  const P = placeOf(place), [ta, tb] = taps || [];
  if (!(Number.isFinite(ta) && Number.isFinite(tb) && tb > ta)) return null;
  const run = Array.isArray(onsets) ? onsets : [];
  const to = (t) => {
    let best = null;
    for (const o of run) if (Math.abs(o.t - t) <= snap && (!best || Math.abs(o.t - t) < Math.abs(best.t - t))) best = o;
    return best ? best.t : t;
  };
  const t0 = to(ta), t1 = to(tb), P0 = t1 - t0;
  if (P0 < 0.6 || P0 > 10) return null;
  const m = run.length ? matchAt(run, t1 - 0.03, P0, run[0].t) : null;
  const period = m && m.matched >= 4 && m.score >= 0.6 && Math.abs(m.period - P0) < P0 * 0.05 ? m.period : P0;
  return { period, t0, last: t1, passes: 2, ...onGrid(run, t0, period, P), score: null, place: P.id, tapped: true };
}

// The riff's root: the pitch class its lowest notes sit on (the first note's, when it's down there too).
function rootOf(notes) {
  const ps = notes.filter((x) => x.p != null);
  if (!ps.length) return 4;
  const lo = Math.min(...ps.map((x) => x.p));
  const w = new Map();
  for (const x of ps) if (x.p <= lo + 5) w.set(pcOf(x.p), (w.get(pcOf(x.p)) || 0) + x.d + (x.t === 0 ? 1 : 0));
  return [...w].sort((a, b) => b[1] - a[1])[0][0];
}

// When the band can come in: the next pass start at least `lead` s from now, after minPasses passes, on a bar line.
export function nextEntry(riff, now, { lead = 0.3, minPasses = 2 } = {}) {
  const per = riff.period, base = riff.last, kBase = Math.round((riff.last - riff.t0) / per);
  for (let k = Math.max(minPasses, kBase + 1); k < kBase + 64; k++) {
    const t = base + (k - kBase) * per, beat = k * riff.n;
    if (t - now >= lead && Math.abs(beat / 4 - Math.round(beat / 4)) < EPS) return { t, beat, pass: k };
  }
  return null;
}

/* ------------------------------------------------------------------------------------------------ the band */
const fold = (p, lo, hi) => { let x = Math.round(p); while (x > hi) x -= 12; while (x < lo) x += 12; return x; };
const CRASH = 49, KICKS = new Set([35, 36]), STICK = 37;
const phraseOf = (P) => (P.form ? P.form.length * 4 : 32);

export function bandFor(place, riff, { from = 0, length = 128, seed = 1, count = false } = {}) {
  const P = placeOf(place), bpm = riff?.bpm || P.prefer, n = riff?.n || 4;
  const drums = [], bass = [];
  const D = P.drums, phrase = phraseOf(P);
  let t0 = 0;
  if (count) { for (let b = 0; b < 4; b++) drums.push({ p: STICK, t: b, d: 0.25, v: b === 0 ? 0.95 : 0.85 }); t0 = 4; }
  const fillLen = getGroove(D.fill)?.length || 1;
  // the riff's low notes (the chugs): where the metal club's kick goes (a riff with no notes heard, only tapped, has
  // none to follow: the groove's own kick, and the bass on the root)
  const rn = riff?.notes || [], follow = !!(D.follow && riff && rn.length);
  const lowP = rn.filter((x) => x.p != null).reduce((m, x) => Math.min(m, x.p), Infinity);
  const chugs = rn.filter((x) => x.p == null || x.p <= lowP + 5);
  for (let k = 0, s = t0; s < length - EPS; k++, s += phrase) {
    const len = Math.min(phrase, length - s), body = Math.max(0, len - (len === phrase ? fillLen : 0));
    const groove = k % 2 === 0 ? D.verse : D.chorus;
    for (const x of realize(groove, { tempo: bpm, seed: seed * 101 + k, length: body })) {
      if (follow && KICKS.has(x.p)) continue;
      drums.push({ ...x, t: r4(s + x.t) });
    }
    if (follow) {
      for (let c = 0; c < body - EPS; c += n) for (const x of chugs) {
        const t = c + x.t;
        if (t < body - EPS) drums.push({ p: 36, t: r4(s + t), d: 0.25, v: Math.abs(x.t) < EPS ? 0.98 : 0.84 });
      }
    }
    if (body < len - EPS) for (const x of realize(D.fill, { tempo: bpm, seed: seed * 101 + k, length: fillLen })) drums.push({ ...x, t: r4(s + body + x.t) });
    drums.push({ p: CRASH, t: r4(s), d: 1, v: 0.92 });
    if (!drums.some((x) => KICKS.has(x.p) && Math.abs(x.t - s) < 0.02)) drums.push({ p: 36, t: r4(s), d: 0.25, v: 0.95 });
  }
  // the bass
  const B = P.bass, root = riff ? riff.root : 4, rootP = fold(root + 24, 28, 39);
  const mode = B.mode === 'double' && !rn.length ? 'eighths' : B.mode;
  if (riff) {
    for (let s = t0; s < length - EPS; s += n) {
      const bar0 = Math.floor((s - t0) / 4);
      if (mode === 'double') {
        rn.forEach((x, i) => {
          const t = s + x.t;
          if (t >= length - EPS) return;
          const p = x.p == null ? rootP : fold(x.p - 12, 28, 47);
          bass.push({ p, t: r4(t), d: r4(Math.min(x.d, 1) * 0.85), v: i === 0 ? 0.95 : 0.84 });
        });
      } else if (mode === 'eighths') {
        for (let e = 0; e < n - EPS; e += 0.5) {
          const t = s + e;
          if (t >= length - EPS) break;
          const at = [...rn].reverse().find((x) => x.t <= e + EPS) || rn[0];
          const p = !at || at.p == null ? rootP : fold(at.p - 12, 28, 47);
          bass.push({ p, t: r4(t), d: 0.42, v: Math.abs(e - Math.round(e)) < EPS ? 0.92 : 0.78 });
        }
      } else if (mode === 'boogie') {
        // the boogie through the twelve-bar: R 3 5 6 b7 6 5 3 on the shuffle's long-short eighths
        const ivs = [0, 4, 7, 9, 10, 9, 7, 4], at = [0, 2 / 3, 1, 5 / 3, 2, 8 / 3, 3, 11 / 3];
        for (let b = 0; b * 4 < n - EPS; b++) {
          const bar = bar0 + b, step = P.form[((bar % P.form.length) + P.form.length) % P.form.length];
          const r = fold(root + step + 24, 28, 40);
          at.forEach((x, j) => {
            const t = s + b * 4 + x;
            if (t < length - EPS) bass.push({ p: r + ivs[j], t: r4(t), d: j % 2 ? 0.3 : 0.6, v: j % 2 ? 0.72 : 0.9 });
          });
        }
      }
    }
  }
  const byT = (a, b) => a.t - b.t || a.p - b.p;
  return { drums: drums.filter((x) => x.t >= 0 && x.t < length - EPS).sort(byT), bass: bass.sort(byT), from, length };
}

// One dispatch: the house band, each part a new track with one clip from `from`.
export function bandOps(place, riff, { from = 0, length = 128, seed = 1, count = false, parts = ['drums', 'bass'] } = {}) {
  const P = placeOf(place), band = bandFor(place, riff, { from, length, seed, count });
  const ops = [];
  if (parts.includes('drums')) {
    ops.push({ type: 'track.add', ref: 'drums', track: { name: 'Drums', kind: 'instrument', color: '#a2a6c6', instrument: { device: P.drums.kit.device, params: { ...P.drums.kit.params } }, gain: P.gain.drums } });
    ops.push({ type: 'clip.add', track: '$drums', ref: 'dclip', clip: { kind: 'notes', start: from, length, name: P.name.replace(/^The /, ''), notes: band.drums } });
  }
  if (parts.includes('bass') && band.bass.length) {
    ops.push({ type: 'track.add', ref: 'bass', track: { name: 'Bass', kind: 'instrument', color: '#95c6a8', instrument: { device: 'core.bassguitar', params: { ...P.bass.params } }, gain: P.gain.bass } });
    ops.push({ type: 'clip.add', track: '$bass', ref: 'bclip', clip: { kind: 'notes', start: from, length, name: 'Bass', notes: band.bass } });
  }
  return { ops, band };
}

// The blues bar's chart at a song beat: the chord, the next one, the bar of the twelve.
export function chordAt(place, riff, beat, from = 0) {
  const P = placeOf(place);
  if (!P.form || !riff) return null;
  const rel = beat - from;
  if (rel < -EPS) return null;
  const bar = Math.floor(rel / 4 + EPS), i = bar % P.form.length, j = (i + 1) % P.form.length;
  const nm = (s) => pcName(riff.root + s) + '7';
  return { name: nm(P.form[i]), next: nm(P.form[j]), change: P.form[j] !== P.form[i], bar: i + 1, of: P.form.length };
}
